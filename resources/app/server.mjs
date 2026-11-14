import { createServer } from 'node:http';
import { closeSync, createReadStream, existsSync, mkdirSync, openSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, extname, join, normalize, resolve, sep } from 'node:path';
import { hostname, uptime } from 'node:os';
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';

const require = createRequire(import.meta.url);
const { applyDelta } = require('./state-delta.cjs');
const wsCore = require('./modules/ws-workbench-core.js');
const wsCrmSync = require('./modules/ws-crm-sync-core.js');
const customerGovernance = require('./modules/customer-governance-core.js');
const hotChatProfile = require('./modules/hot-chat-profile-core.js');
const { DatabaseSync } = require('node:sqlite');
const root = dirname(fileURLToPath(import.meta.url));
const APP_VERSION = '6.0.1';
const configuredDataDir = String(process.env.ZHIKE_DATA_DIR || '').trim();
const dataDir = configuredDataDir ? resolve(configuredDataDir) : join(root, 'data');
const dbPath = join(dataDir, 'workspace.sqlite');
const lockPath = join(dataDir, '.workbench.lock');
const lockToken = randomUUID();
const runtimeHost = hostname();
const bootTime = Math.floor(Date.now() / 1000 - uptime());
const parentProcessId = Number(process.env.ZHIKE_PARENT_PID || 0);
let parentMonitor = null;
let ownsWorkspaceLock = false;
let port = Number(process.env.ZHIKE_PORT || 4173);
const apiToken = String(process.env.ZHIKE_API_TOKEN || randomBytes(32).toString('hex'));
mkdirSync(dataDir, { recursive: true });

function processIsAlive(pid) {
  if (!Number.isInteger(pid) || pid < 1) return false;
  try { process.kill(pid, 0); return true; } catch (error) { return error.code !== 'ESRCH'; }
}

function acquireWorkspaceLock() {
  for (let attempt = 0; attempt < 2; attempt++) {
    let descriptor;
    try {
      descriptor = openSync(lockPath, 'wx');
      writeFileSync(descriptor, JSON.stringify({ pid: process.pid, host: runtimeHost, bootTime, token: lockToken }));
      closeSync(descriptor);
      descriptor = undefined;
      ownsWorkspaceLock = true;
      return;
    } catch (error) {
      if (descriptor !== undefined) closeSync(descriptor);
      if (error.code !== 'EEXIST') throw error;
      const recoveryPath = `${lockPath}.recovery`;
      let recoveryDescriptor;
      try { recoveryDescriptor = openSync(recoveryPath, 'wx'); } catch (recoveryError) {
        if (recoveryError.code === 'EEXIST') throw new Error('工作目录启动状态正在检查，请稍候再打开。');
        throw recoveryError;
      }
      try {
        let owner;
        try { owner = JSON.parse(readFileSync(lockPath, 'utf8')); } catch {}
        let lockAge = 0;
        try { lockAge = Date.now() - statSync(lockPath).mtimeMs; } catch (statError) { if (statError.code === 'ENOENT') continue; throw statError; }
        if (!owner && lockAge < 10000) throw new Error('工作目录正在启动，请稍候再打开。');
        if (owner?.host === runtimeHost && Math.abs(Number(owner.bootTime) - bootTime) <= 3 && processIsAlive(Number(owner.pid))) throw new Error('这个工作目录已在运行。请切回已打开的工作台，不要重复启动同一文件夹。');
        rmSync(lockPath, { force: true });
      } finally {
        closeSync(recoveryDescriptor);
        rmSync(recoveryPath, { force: true });
      }
    }
  }
  throw new Error('无法取得本地工作目录启动锁，请关闭重复窗口后重试。');
}

function releaseWorkspaceLock() {
  if (!ownsWorkspaceLock) return;
  try { if (JSON.parse(readFileSync(lockPath, 'utf8')).token === lockToken) rmSync(lockPath, { force: true }); } catch {}
  ownsWorkspaceLock = false;
}

try { acquireWorkspaceLock(); } catch (error) { console.error(error.message || '工作目录已在运行。'); process.exit(1); }
process.on('exit', releaseWorkspaceLock);

const db = new DatabaseSync(dbPath);
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
  PRAGMA busy_timeout = 5000;
  CREATE TABLE IF NOT EXISTS app_state (id INTEGER PRIMARY KEY CHECK(id = 1), json TEXT NOT NULL, updated_at TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 0);
  CREATE TABLE IF NOT EXISTS state_snapshots (id INTEGER PRIMARY KEY, created_at TEXT NOT NULL, reason TEXT NOT NULL, json TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS customers (id TEXT PRIMARY KEY, phone_normalized TEXT NOT NULL DEFAULT '', name TEXT NOT NULL DEFAULT '', source TEXT NOT NULL DEFAULT '', assistant TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT '', stage TEXT NOT NULL DEFAULT '', deleted INTEGER NOT NULL DEFAULT 0, data_json TEXT NOT NULL);
  CREATE INDEX IF NOT EXISTS idx_customers_phone ON customers(phone_normalized);
  CREATE INDEX IF NOT EXISTS idx_customers_source_assistant ON customers(source, assistant);
  CREATE INDEX IF NOT EXISTS idx_customers_status ON customers(status);
  CREATE INDEX IF NOT EXISTS idx_customers_stage ON customers(stage);
  CREATE INDEX IF NOT EXISTS idx_customers_deleted ON customers(deleted);
  CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL, description TEXT NOT NULL);
`);
if (!db.prepare('PRAGMA table_info(app_state)').all().some(column => column.name === 'revision')) db.exec('ALTER TABLE app_state ADD COLUMN revision INTEGER NOT NULL DEFAULT 0');
let currentSchemaVersion = Number(db.prepare('PRAGMA user_version').get().user_version || 0);
if (currentSchemaVersion < 4) {
  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare('INSERT OR IGNORE INTO schema_migrations(version,applied_at,description) VALUES(?,?,?)').run(4, new Date().toISOString(), '4.0 客户运营、报名、批量审计与诊断结构');
    db.exec('PRAGMA user_version = 4; COMMIT');
    currentSchemaVersion = 4;
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}
if (Number(db.prepare('PRAGMA user_version').get().user_version || 0) < 5) {
  const migrationPath = join(root, 'migrations', '005-ws-workbench.sql');
  if (!existsSync(migrationPath)) throw new Error('缺少 WS 工作台数据库迁移文件。');
  const migration = readFileSync(migrationPath, 'utf8');
  db.exec('BEGIN IMMEDIATE');
  try {
    db.exec(migration);
    db.prepare('INSERT OR IGNORE INTO schema_migrations(version,applied_at,description) VALUES(?,?,?)').run(5, new Date().toISOString(), '4.2 WS 工作台独立会话、消息、翻译与 AI 数据');
    db.exec('PRAGMA user_version = 5; COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}
if (Number(db.prepare('PRAGMA user_version').get().user_version || 0) < 6) {
  const migrationPath = join(root, 'migrations', '006-ws-workbench-hardening.sql');
  if (!existsSync(migrationPath)) throw new Error('缺少 WS 工作台 v6 数据库迁移文件。');
  const migration = readFileSync(migrationPath, 'utf8');
  db.exec('BEGIN IMMEDIATE');
  try {
    db.exec(migration);
    db.prepare('INSERT OR IGNORE INTO schema_migrations(version,applied_at,description) VALUES(?,?,?)').run(6, new Date().toISOString(), '4.2 WS 工作台消息批次、翻译恢复与幂等强化');
    db.exec('PRAGMA user_version = 6; COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}
if (Number(db.prepare('PRAGMA user_version').get().user_version || 0) < 7) {
  const migrationPath = join(root, 'migrations', '007-ws-collection-followup.sql');
  const migration = readFileSync(migrationPath, 'utf8');
  db.exec('BEGIN IMMEDIATE');
  try {
    db.exec(migration);
    db.prepare('INSERT OR IGNORE INTO schema_migrations(version,applied_at,description) VALUES(?,?,?)').run(7, new Date().toISOString(), '4.2 WS 全会话采集、AI 分析与跟进队列');
    db.exec('PRAGMA user_version = 7; COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}
if (Number(db.prepare('PRAGMA user_version').get().user_version || 0) < 8) {
  const migrationPath = join(root, 'migrations', '008-ws-accounts.sql');
  if (!existsSync(migrationPath)) throw new Error('缺少 WS 多账号数据库迁移文件。');
  const migration = readFileSync(migrationPath, 'utf8');
  db.exec('BEGIN IMMEDIATE');
  try {
    db.exec(migration);
    db.prepare('INSERT OR IGNORE INTO schema_migrations(version,applied_at,description) VALUES(?,?,?)').run(8, new Date().toISOString(), '4.3 WS 多账号隔离与账号设置');
    db.exec('PRAGMA user_version = 8; COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}
if (Number(db.prepare('PRAGMA user_version').get().user_version || 0) < 9) {
  const migrationPath = join(root, 'migrations', '009-ws-resume-alerts.sql');
  if (!existsSync(migrationPath)) throw new Error('缺少 WS 断点采集与提醒迁移文件。');
  const migration = readFileSync(migrationPath, 'utf8');
  db.exec('BEGIN IMMEDIATE');
  try {
    db.exec(migration);
    db.prepare('INSERT OR IGNORE INTO schema_migrations(version,applied_at,description) VALUES(?,?,?)').run(9, new Date().toISOString(), '4.3 WS 断点采集与 AI 提醒状态');
    db.exec('PRAGMA user_version = 9; COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}
if (Number(db.prepare('PRAGMA user_version').get().user_version || 0) < 10) {
  const migrationPath = join(root, 'migrations', '010-ai-customer-governance.sql');
  if (!existsSync(migrationPath)) throw new Error('缺少 AI 客户档案治理迁移文件。');
  const migration = readFileSync(migrationPath, 'utf8');
  db.exec('BEGIN IMMEDIATE');
  try {
    db.exec(migration);
    db.prepare('INSERT OR IGNORE INTO schema_migrations(version,applied_at,description) VALUES(?,?,?)').run(10, new Date().toISOString(), '4.4 AI 客户档案自动治理、字段证据与删除审计');
    db.exec('PRAGMA user_version = 10; COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}
if (Number(db.prepare('PRAGMA user_version').get().user_version || 0) < 11) {
  const migrationPath = join(root, 'migrations', '011-hot-chat-profile.sql');
  if (!existsSync(migrationPath)) throw new Error('缺少热聊客户档案迁移文件。');
  const migration = readFileSync(migrationPath, 'utf8');
  db.exec('BEGIN IMMEDIATE');
  try {
    db.exec(migration);
    db.prepare('INSERT OR IGNORE INTO schema_migrations(version,applied_at,description) VALUES(?,?,?)').run(11, new Date().toISOString(), '4.5 热聊客户档案、事件与本地同步 outbox');
    db.exec('PRAGMA user_version = 11; COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}
if (Number(db.prepare('PRAGMA user_version').get().user_version || 0) < 12) {
  db.exec('BEGIN IMMEDIATE');
  try {
    // Version 12 is intentionally a schema marker only. Zhike 6.0 owns an
    // isolated data root and never reads, imports or mutates an older Zhike
    // workspace during startup.
    db.prepare('INSERT OR IGNORE INTO schema_migrations(version,applied_at,description) VALUES(?,?,?)').run(12, new Date().toISOString(), '6.0 独立空白数据空间');
    db.exec('PRAGMA user_version = 12; COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}
if (Number(db.prepare('PRAGMA user_version').get().user_version || 0) < 13) {
  const migrationPath = join(root, 'migrations', '013-ws-account-runtime.sql');
  if (!existsSync(migrationPath)) throw new Error('缺少 WS 账号运行状态迁移文件。');
  const migration = readFileSync(migrationPath, 'utf8');
  db.exec('BEGIN IMMEDIATE');
  try {
    db.exec(migration);
    db.prepare('INSERT OR IGNORE INTO schema_migrations(version,applied_at,description) VALUES(?,?,?)').run(13, new Date().toISOString(), '5.3 WS 账号运行状态与上次连接记录分离');
    db.exec('PRAGMA user_version = 13; COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}

// Durable AI work items live in the same local SQLite workspace as WS
// messages.  The queue is intentionally created inline so older desktop data
// directories upgrade without a separate migration package.  Only analysis
// request metadata is retained; provider credentials never enter this table.
db.exec(`
  CREATE TABLE IF NOT EXISTS ai_jobs (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL DEFAULT 'default',
    conversation_id TEXT NOT NULL,
    idempotency_key TEXT NOT NULL,
    payload_json TEXT NOT NULL DEFAULT '{}',
    status TEXT NOT NULL DEFAULT 'queued',
    attempts INTEGER NOT NULL DEFAULT 0,
    max_attempts INTEGER NOT NULL DEFAULT 5,
    next_attempt_at TEXT NOT NULL,
    locked_at TEXT NOT NULL DEFAULT '',
    last_error TEXT NOT NULL DEFAULT '',
    analysis_id TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(account_id, idempotency_key)
  );
  CREATE INDEX IF NOT EXISTS idx_ai_jobs_claim ON ai_jobs(account_id,status,next_attempt_at,updated_at);
  CREATE INDEX IF NOT EXISTS idx_ai_jobs_conversation ON ai_jobs(account_id,conversation_id,created_at);
`);
// A desktop process may exit while a browser-side AI request is in flight.
// Returning those jobs to queued makes restart recovery deterministic and
// keeps the original idempotency key available for the next attempt.
const aiRecoveryNow = new Date().toISOString();
db.prepare("UPDATE ai_jobs SET status='queued',locked_at='',last_error=CASE WHEN last_error='' THEN 'recovered_after_restart' ELSE last_error END,updated_at=? WHERE status='running'").run(aiRecoveryNow);

// BrowserViews do not survive a process restart. Any persisted "connected"
// state from the previous process is therefore stale until the new view is
// opened and probed by the WinUI host process. Preserve the last observation
// separately so the desktop UI can explain why reconnect is expected.
{
  const now = new Date().toISOString();
  db.prepare(`UPDATE ws_accounts
    SET last_status=CASE WHEN status <> '未连接' AND last_status='' THEN status ELSE last_status END,
        last_seen_at=CASE WHEN status='已连接' AND last_seen_at='' THEN updated_at ELSE last_seen_at END,
        status='未连接', updated_at=?
    WHERE status <> '未连接'`).run(now);
}
// Create the default account before the first renderer request so the initial
// account list cannot be empty while the service is still warming up.
ensureDefaultWsAccount();

function databaseDiagnostics() {
  const integrity = db.prepare('PRAGMA integrity_check').all().map(row => Object.values(row)[0]);
  const quickCheck = db.prepare('PRAGMA quick_check').all().map(row => Object.values(row)[0]);
  const foreignKeys = db.prepare('PRAGMA foreign_key_check').all();
  const pageCount = Number(db.prepare('PRAGMA page_count').get().page_count || 0);
  const pageSize = Number(db.prepare('PRAGMA page_size').get().page_size || 0);
  const state = readState();
  const activeCustomers = (state?.customers || []).filter(customer => !customer.deleted);
  const duplicatePhones = activeCustomers.length - new Set(activeCustomers.map(customer => String(customer.phone || '')).filter(Boolean)).size;
  // Soft deletion deliberately keeps the customer master and its independent
  // business records so a restore can recover the complete timeline. Those
  // records are not orphaned merely because the customer is currently hidden.
  const customerIds = new Set((state?.customers || []).filter(Boolean).map(customer => String(customer.id)));
  const orphaned = Object.fromEntries(['tickets','deposits','followups','registrations'].map(key => [key, (state?.[key] || []).filter(row => row.customerId && !customerIds.has(String(row.customerId))).length]));
  const wsCounts = {
    settings: Number(db.prepare('SELECT COUNT(*) AS count FROM ws_settings').get().count || 0),
    conversations: Number(db.prepare('SELECT COUNT(*) AS count FROM ws_conversations').get().count || 0),
    messages: Number(db.prepare('SELECT COUNT(*) AS count FROM ws_messages').get().count || 0),
    analyses: Number(db.prepare('SELECT COUNT(*) AS count FROM ws_ai_analyses').get().count || 0),
    replies: Number(db.prepare('SELECT COUNT(*) AS count FROM ws_replies').get().count || 0),
    batches: Number(db.prepare('SELECT COUNT(*) AS count FROM ws_ingest_batches').get().count || 0),
  };
  return { ok: integrity.length === 1 && integrity[0] === 'ok' && !foreignKeys.length, checkedAt: new Date().toISOString(), schemaVersion: Number(db.prepare('PRAGMA user_version').get().user_version || 0), integrity, quickCheck, foreignKeyErrors: foreignKeys.length, databaseBytes: pageCount * pageSize, journalMode: db.prepare('PRAGMA journal_mode').get().journal_mode, counts: { customers: activeCustomers.length, registrations: state?.registrations?.length || 0, phoneRegistry: state?.phoneRegistry?.length || 0, followups: state?.followups?.length || 0, tickets: state?.tickets?.length || 0, deposits: state?.deposits?.length || 0, snapshots: Number(db.prepare('SELECT COUNT(*) AS count FROM state_snapshots').get().count || 0), ws: wsCounts }, anomalies: { duplicatePhones, orphaned } };
}

function json(res, status, value) {
  const body = JSON.stringify(value);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body), 'Cache-Control': 'no-store' });
  res.end(body);
}

function readState() {
  const row = db.prepare('SELECT json FROM app_state WHERE id = 1').get();
  return row ? JSON.parse(row.json) : null;
}

function readStateEnvelope() {
  const row = db.prepare('SELECT json,revision FROM app_state WHERE id = 1').get();
  if (!row) return { state: null, version: '' };
  return { state: JSON.parse(row.json), version: String(row.revision) };
}

function emptyCrmState() {
  return {
    schemaVersion: 4,
    customers: [],
    savedViews: [],
    activities: [],
    tickets: [],
    deposits: [],
    followups: [],
    registrations: [],
    phoneRegistry: [],
    batchOperations: [],
    settings: { operatingTasks: [] },
    channelAliases: {},
    importIssues: [],
    qualityDecisions: {},
  };
}

function validateState(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !Array.isArray(value.customers) || value.customers.length > 250000) throw new Error('客户数据格式无效或超过允许数量。');
  const ids = new Set();
  for (const customer of value.customers) {
    const id = customer && typeof customer === 'object' && !Array.isArray(customer) ? String(customer.id ?? '').trim() : '';
    if (!/^[\p{L}\p{N}_-]{1,128}$/u.test(id) || ids.has(id)) throw new Error('客户编号缺失、重复或包含不支持的字符，未保存本次数据。');
    ids.add(id);
  }
  for (const key of ['tickets', 'deposits', 'followups', 'registrations', 'phoneRegistry', 'batchOperations', 'activities', 'importIssues']) {
    if (Object.hasOwn(value, key) && (!Array.isArray(value[key]) || value[key].some(record => !record || typeof record !== 'object' || Array.isArray(record)))) throw new Error(`${key} 清单格式异常，未保存本次数据。`);
    if (Array.isArray(value[key])) {
      const recordIds = new Set();
      for (const record of value[key]) {
        const id = String(record?.id ?? '').trim();
        if (id && recordIds.has(id)) throw new Error(`${key} 中存在重复记录编号，未保存本次数据。`);
        if (id) recordIds.add(id);
      }
    }
  }
  if (value.phoneRegistry?.length > 100000) throw new Error('手机号登记超过 100,000 条上限，未保存本次数据。');
  if (value.phoneRegistry) {
    const registryIds = new Set();
    for (const record of value.phoneRegistry) {
      const id = String(record.id ?? '').trim();
      if (!/^[\p{L}\p{N}_-]{1,128}$/u.test(id) || registryIds.has(id)) throw new Error('手机号登记编号缺失、重复或包含不支持的字符，未保存本次数据。');
      if ([record.device, record.code, record.phone, record.role, record.channel].some(field => String(field ?? '').length > 200)) throw new Error('手机号登记字段过长，未保存本次数据。');
      registryIds.add(id);
    }
  }
  if (Object.hasOwn(value, 'savedViews') && (!Array.isArray(value.savedViews) || value.savedViews.some(view => typeof view !== 'string' && (!view || typeof view !== 'object' || Array.isArray(view))))) throw new Error('savedViews 清单格式异常，未保存本次数据。');
  for (const key of ['tickets', 'deposits', 'followups', 'registrations']) if (value[key]?.some(record => record.customerId != null && record.customerId !== '' && !/^[\p{L}\p{N}_-]{1,128}$/u.test(String(record.customerId)))) throw new Error(`${key} 中存在无效的客户关联编号，未保存本次数据。`);
  for (const key of ['settings', 'channelAliases', 'qualityDecisions']) if (Object.hasOwn(value, key) && (!value[key] || typeof value[key] !== 'object' || Array.isArray(value[key]))) throw new Error(`${key} 格式异常，未保存本次数据。`);
}

function writeState(value, manageTransaction = true, delta = null) {
  validateState(value);
  if (manageTransaction) db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare('INSERT INTO app_state(id,json,updated_at,revision) VALUES(1,?,?,1) ON CONFLICT(id) DO UPDATE SET json=excluded.json, updated_at=excluded.updated_at, revision=app_state.revision+1').run(JSON.stringify(value), new Date().toISOString());
  const upsert = db.prepare(`INSERT INTO customers(id,phone_normalized,name,source,assistant,status,stage,deleted,data_json)
    VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET
    phone_normalized=excluded.phone_normalized,name=excluded.name,source=excluded.source,
    assistant=excluded.assistant,status=excluded.status,stage=excluded.stage,
    deleted=excluded.deleted,data_json=excluded.data_json`);
  const existingRows = delta ? new Map() : new Map(db.prepare('SELECT id,data_json FROM customers').all().map(row => [row.id, row.data_json]));
  const keepIds = new Set();
  for (const customer of (delta ? delta.upsert : value.customers)) {
    const id = String(customer.id ?? '').trim();
    if (!id || keepIds.has(id)) throw new Error('客户编号缺失或重复，未保存本次数据。');
    keepIds.add(id);
    const dataJson = JSON.stringify(customer);
    if (existingRows.get(id) === dataJson) continue;
    upsert.run(id, String(customer.phone || ''), String(customer.name || ''), String(customer.source || ''), String(customer.assistant || ''), String(customer.status || ''), String(customer.phase || ''), customer.deleted ? 1 : 0, dataJson);
  }
  const remove = db.prepare('DELETE FROM customers WHERE id=?');
  if (delta) for (const id of delta.remove) remove.run(id);
  for (const id of existingRows.keys()) if (!keepIds.has(id)) remove.run(id);
    if (manageTransaction) db.exec('COMMIT');
  } catch (error) {
    if (manageTransaction) db.exec('ROLLBACK');
    throw error;
  }
}

function saveSnapshot(reason) {
  // A write-before-snapshot can happen while the sidecar is still creating
  // the initial app_state row. Preserve an empty, valid workspace baseline so
  // the first destructive or batch operation is still recoverable.
  const current = readState() || emptyCrmState();
  const retention = Math.min(100, Math.max(1, Number(current.settings?.snapshotRetention) || 20));
  // Use a savepoint instead of BEGIN/COMMIT. Snapshot creation is called by
  // several guarded write paths and must also work when the caller already
  // owns an IMMEDIATE transaction.
  db.exec('SAVEPOINT zhike_snapshot');
  try {
    db.prepare('INSERT INTO state_snapshots(created_at,reason,json) VALUES(?,?,?)').run(new Date().toISOString(), reason, JSON.stringify(current));
    db.prepare('DELETE FROM state_snapshots WHERE id NOT IN (SELECT id FROM state_snapshots ORDER BY id DESC LIMIT ?)').run(retention);
    db.exec('RELEASE SAVEPOINT zhike_snapshot');
  } catch (error) {
    try { db.exec('ROLLBACK TO SAVEPOINT zhike_snapshot'); } catch {}
    try { db.exec('RELEASE SAVEPOINT zhike_snapshot'); } catch {}
    throw error;
  }
  return true;
}

async function readBody(req, limit = 25 * 1024 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new Error('文件超过本地导入上限。');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

const WS_STATUSES = new Set(['未连接', '等待登录', '登录中', '已连接', '会话过期', '连接失败', '正在重连']);
const WS_DIRECTIONS = new Set(['receive', 'send']);
const WS_NATIVE_DIRECTION_SOURCE_MAP = new Map([
  ['class-message-out', 'send'], ['class-message-in', 'receive'],
  ['data-id-outgoing', 'send'], ['data-id-incoming', 'receive'],
  ['icon-tail-out', 'send'], ['icon-tail-in', 'receive'],
  ['palette-outgoing', 'send'], ['palette-incoming', 'receive'],
]);
const WS_NATIVE_DIRECTION_SOURCES = new Set(WS_NATIVE_DIRECTION_SOURCE_MAP.keys());
const WS_REPLY_STATUSES = new Set(['draft', 'copied', 'confirmed']);
const WS_TRANSLATION_STATUSES = new Set(['none', 'pending', 'translated', 'failed', 'skipped']);
const WS_MESSAGE_MAX_CHARS = 128000;
const WS_MESSAGE_BATCH_MAX_BYTES = 72 * 1024 * 1024;
function wsText(value, max = 12000) { return String(value ?? '').trim().slice(0, max); }
function wsMessageText(value) { return String(value ?? ''); }
function wsMessageTextTooLong(value) { return wsMessageText(value).length > WS_MESSAGE_MAX_CHARS; }
function wsObject(value, maxBytes = 64 * 1024) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const textValue = JSON.stringify(value);
  if (Buffer.byteLength(textValue) > maxBytes) throw new Error('WS 结构化数据过大。');
  return value;
}
function wsIso(value) { const date = value ? new Date(value) : new Date(); return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString(); }
function wsStrictIso(value) {
  const raw = wsText(value, 80);
  if (!raw) return '';
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString();
}
function wsMaybeIso(value) {
  const raw = wsText(value, 80);
  if (!raw) return '';
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? raw : date.toISOString();
}
function wsMessageTimeMetadata(input = {}, fallbackObservedAt = '') {
  const embedded = input?.data && typeof input.data === 'object' && !Array.isArray(input.data) ? input.data : {};
  const sentAt = wsStrictIso(input?.sentAt || embedded.sentAt);
  const observedAt = wsStrictIso(input?.observedAt || embedded.observedAt || fallbackObservedAt) || wsStrictIso(fallbackObservedAt) || new Date().toISOString();
  const timestampText = wsText(input?.timestampText ?? embedded.timestampText, 500);
  const suppliedSource = wsText(input?.timestampSource ?? embedded.timestampSource, 40);
  const timestampSource = sentAt && suppliedSource !== 'unparsed' ? 'whatsapp-preamble' : 'unparsed';
  return { sentAt, observedAt, timestampText, timestampSource, sentAtKnown: Boolean(sentAt) && timestampSource === 'whatsapp-preamble' };
}
function wsMessageDataWithTime(value, metadata) {
  return {
    ...wsObject(value, 32 * 1024),
    observedAt: metadata.observedAt,
    sentAt: metadata.sentAt,
    sentAtKnown: metadata.sentAtKnown,
    timestampText: metadata.timestampText,
    timestampSource: metadata.timestampSource,
  };
}
function wsOptionalCount(value) {
  if (value === null || value === undefined || value === '') return null;
  const count = Number(value);
  return Number.isFinite(count) && count >= 0 ? Math.min(1000000, Math.floor(count)) : null;
}
function wsAccountId(value) { return wsText(value, 120) || 'default'; }
function wsConversationCursor(row) {
  if (!row) return '';
  return Buffer.from(JSON.stringify([String(row.updated_at || ''), String(row.id || '')]), 'utf8').toString('base64url');
}
function wsDecodeConversationCursor(value) {
  const raw = wsText(value, 2048);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
    if (!Array.isArray(parsed) || parsed.length !== 2) return null;
    const updatedAt = wsText(parsed[0], 80), id = wsText(parsed[1], 160);
    return updatedAt && id ? { updatedAt, id } : null;
  } catch { return null; }
}
function wsAccountRow(id) { return db.prepare('SELECT * FROM ws_accounts WHERE id=?').get(wsAccountId(id)); }
function wsRequireAccount(id) { const row = wsAccountRow(id); if (!row) throw new Error('WS 账号不存在或已被删除。'); return row; }
function ensureDefaultWsAccount() {
  const now = new Date().toISOString();
  db.prepare(`INSERT OR IGNORE INTO ws_accounts(id,display_name,provider,origin,partition_key,status,last_status,last_seen_at,enabled,created_at,updated_at)
    VALUES('default','默认账号','WhatsApp Web','https://web.whatsapp.com','persist:default','未连接','','',1,?,?)`).run(now, now);
  db.prepare(`INSERT OR IGNORE INTO ws_account_settings(account_id,created_at,updated_at) VALUES('default',?,?)`).run(now, now);
}
function wsAccountPayload(row) {
  if (!row) return null;
  const settings = db.prepare('SELECT * FROM ws_account_settings WHERE account_id=?').get(row.id);
  return {
    id: row.id,
    displayName: row.display_name,
    provider: row.provider,
    origin: row.origin,
    partitionKey: row.partition_key,
    status: WS_STATUSES.has(String(row.status || '')) ? row.status : '未连接',
    runtimeStatus: WS_STATUSES.has(String(row.status || '')) ? row.status : '未连接',
    lastKnownStatus: WS_STATUSES.has(String(row.last_status || '')) ? row.last_status : '',
    // Use JSON null (not an empty string) so the WinUI DateTimeOffset?
    // property can deserialize accounts that have never connected.
    lastSeen: row.last_seen_at || null,
    enabled: Boolean(row.enabled),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    settings: settings ? {
      translationEnabled: Boolean(settings.translation_enabled),
      aiEnabled: Boolean(settings.ai_enabled),
      autoCollectionEnabled: Boolean(settings.auto_collection_enabled),
    } : { translationEnabled: true, aiEnabled: true, autoCollectionEnabled: false },
  };
}
function wsSaveAccountSettings(accountId, input, now) {
  const current = db.prepare('SELECT * FROM ws_account_settings WHERE account_id=?').get(accountId);
  const source = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const settingsJson = Object.hasOwn(source, 'settings') ? wsObject(source.settings, 32 * 1024) : wsJson(current?.settings_json);
  const translationEnabled = source.translationEnabled ?? source.translation ?? current?.translation_enabled ?? 1;
  const aiEnabled = source.aiEnabled ?? source.ai ?? current?.ai_enabled ?? 1;
  const autoCollectionEnabled = source.autoCollectionEnabled ?? source.autoCollection ?? current?.auto_collection_enabled ?? 0;
  db.prepare(`INSERT INTO ws_account_settings(account_id,translation_enabled,ai_enabled,auto_collection_enabled,settings_json,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?) ON CONFLICT(account_id) DO UPDATE SET translation_enabled=excluded.translation_enabled,ai_enabled=excluded.ai_enabled,auto_collection_enabled=excluded.auto_collection_enabled,settings_json=excluded.settings_json,updated_at=excluded.updated_at`)
    .run(accountId, translationEnabled === false ? 0 : 1, aiEnabled === false ? 0 : 1, autoCollectionEnabled === true ? 1 : 0, JSON.stringify(settingsJson), current?.created_at || now, now);
}
function wsSettingsPayload(row) {
  if (!row) return { accountId: 'default', conversationId: '', enabled: true, receive: true, send: true, targetLanguage: '中文', sendLanguage: '', showOriginal: true, aiEnabled: true, status: '未连接', createdAt: '', updatedAt: '' };
  return { accountId: row.account_id || 'default', conversationId: row.conversation_id, enabled: Boolean(row.enabled), receive: Boolean(row.receive_enabled), send: Boolean(row.send_enabled), targetLanguage: row.target_language || '中文', sendLanguage: row.send_language || '', showOriginal: Boolean(row.show_original), aiEnabled: Boolean(row.ai_enabled), status: row.status, createdAt: row.created_at, updatedAt: row.updated_at };
}
function wsJson(value, fallback = {}) { try { return JSON.parse(value || '{}'); } catch { return fallback; } }
function wsConversationPayload(row) { return { id: row.id, accountId: row.account_id || 'default', externalId: row.external_id, title: row.title, customerId: row.customer_id, lastMessageText: row.last_message_text, lastMessageAt: row.last_message_at, unreadCount: Number(row.unread_count || 0), language: row.language, intentLevel: row.intent_level, data: wsJson(row.data_json), createdAt: row.created_at, updatedAt: row.updated_at }; }
function wsStoredMessageTime(row, data = wsJson(row?.data_json)) {
  const sentAt = wsStrictIso(data.sentAt);
  const observedAt = wsStrictIso(data.observedAt);
  const createdAt = wsStrictIso(row?.created_at);
  const oldWebViewFallback = data.source === 'ws-webview2' && !sentAt && observedAt && createdAt === observedAt;
  const explicitlyUnknown = data.sentAtKnown === false || data.timestampSource === 'unparsed' || oldWebViewFallback;
  const sentAtKnown = Boolean(sentAt) && !explicitlyUnknown;
  return {
    sentAt: sentAtKnown ? sentAt : '',
    observedAt,
    timestampText: wsText(data.timestampText, 500),
    timestampSource: sentAtKnown ? 'whatsapp-preamble' : (data.source === 'ws-webview2' || data.timestampSource ? 'unparsed' : ''),
    sentAtKnown,
  };
}
function wsMessagePayload(row) {
  const data = wsJson(row.data_json);
  const time = wsStoredMessageTime(row, data);
  return { id: row.id, accountId: row.account_id || 'default', conversationId: row.conversation_id, externalId: row.external_id, direction: row.direction, originalText: row.original_text, translatedText: row.translated_text, sourceLanguage: row.source_language, targetLanguage: row.target_language, order: row.order_no, translationStatus: row.translation_status || (row.translated_text ? 'translated' : 'none'), translationError: row.translation_error || '', translationAttempts: Number(row.translation_attempts || 0), lastAttemptAt: row.last_attempt_at || '', sentAt: time.sentAt, observedAt: time.observedAt, timestampText: time.timestampText, timestampSource: time.timestampSource, sentAtKnown: time.sentAtKnown, data, createdAt: row.created_at, updatedAt: row.updated_at };
}
function wsRepairCollectedMessageTime(row, incoming, now) {
  if (!row || !incoming?.externalId || incoming?.data?.source !== 'ws-webview2' || incoming?.data?.sentAtKnown !== true || !incoming?.data?.sentAt) return null;
  const previousData = wsJson(row.data_json);
  if (previousData.source !== 'ws-webview2') return null;
  const previousObservedAt = wsStrictIso(previousData.observedAt);
  const previousCreatedAt = wsStrictIso(row.created_at);
  const wasFallback = previousData.sentAtKnown === false
    || previousData.timestampSource === 'unparsed'
    || (!wsStrictIso(previousData.sentAt) && previousObservedAt && previousCreatedAt === previousObservedAt);
  if (!wasFallback) return null;
  const repairedData = {
    ...previousData,
    observedAt: previousObservedAt || incoming.data.observedAt,
    sentAt: incoming.data.sentAt,
    sentAtKnown: true,
    timestampText: incoming.data.timestampText,
    timestampSource: 'whatsapp-preamble',
  };
  db.prepare('UPDATE ws_messages SET created_at=?,data_json=?,updated_at=? WHERE id=? AND account_id=?')
    .run(incoming.data.sentAt, JSON.stringify(repairedData), now, row.id, row.account_id || 'default');
  return db.prepare('SELECT * FROM ws_messages WHERE id=? AND account_id=?').get(row.id, row.account_id || 'default');
}
function wsCanRepairCollectedMessageDirection(row, incoming, allowLegacyAlias = false) {
  if (!row || !incoming || incoming?.data?.source !== 'ws-webview2') return false;
  const directionSource = wsText(incoming?.data?.directionSource, 40);
  if (!WS_NATIVE_DIRECTION_SOURCES.has(directionSource) || WS_NATIVE_DIRECTION_SOURCE_MAP.get(directionSource) !== incoming.direction) return false;
  const previousData = wsJson(row.data_json);
  if (previousData.source !== 'ws-webview2' || wsMessageText(row.original_text) !== wsMessageText(incoming.originalText)) return false;
  if (allowLegacyAlias) {
    const oldId = wsText(row.external_id, 200), alias = wsText(incoming.legacyExternalMessageId, 200), canonical = wsText(incoming.externalId, 200);
    if (oldId !== alias || !canonical || oldId === canonical || !/^wa-row-[a-z0-9]+$/i.test(oldId)) return false;
    return row.direction === incoming.direction || (row.direction === 'receive' && incoming.direction === 'send');
  }
  return row.direction === incoming.direction || (row.direction === 'receive' && incoming.direction === 'send');
}
function wsRepairCollectedMessageDirection(row, incoming, now, allowLegacyAlias = false) {
  if (!wsCanRepairCollectedMessageDirection(row, incoming, allowLegacyAlias)) return null;
  const previousData = wsJson(row.data_json);
  const directionSource = wsText(incoming.data.directionSource, 40);
  const canonicalExternalMessageId = wsText(incoming.externalId, 200);
  const directionChanged = row.direction !== incoming.direction;
  const externalIdChanged = allowLegacyAlias && row.external_id !== canonicalExternalMessageId;
  if (!directionChanged && !externalIdChanged && Number(previousData.directionVersion || 0) >= 4
      && previousData.directionSource === directionSource && previousData.canonicalExternalMessageId === canonicalExternalMessageId) return null;
  const repairedData = {
    ...previousData,
    directionVersion: 4,
    directionSource,
    canonicalExternalMessageId,
    legacyExternalMessageId: wsText(incoming.legacyExternalMessageId, 200),
    directionVerifiedAt: now,
    ...(directionChanged ? { previousDirection: row.direction, directionCorrectedAt: now } : {}),
    ...(externalIdChanged ? { previousExternalMessageId: row.external_id } : {}),
  };
  db.prepare('UPDATE ws_messages SET external_id=?,direction=?,data_json=?,updated_at=? WHERE id=? AND account_id=?')
    .run(externalIdChanged ? canonicalExternalMessageId : row.external_id, incoming.direction, JSON.stringify(repairedData), now, row.id, row.account_id || 'default');
  return db.prepare('SELECT * FROM ws_messages WHERE id=? AND account_id=?').get(row.id, row.account_id || 'default');
}
function wsAnalysisPayload(row) { return { id: row.id, accountId: row.account_id || 'default', conversationId: row.conversation_id, result: wsJson(row.result_json), confidence: Number(row.confidence || 0), providerName: row.provider_name, model: row.model, errorMessage: row.error_message, createdAt: row.created_at, updatedAt: row.updated_at }; }
function wsReplyPayload(row) { return { id: row.id, accountId: row.account_id || 'default', conversationId: row.conversation_id, originalText: row.original_text, translatedText: row.translated_text, status: row.status, idempotencyKey: row.idempotency_key || '', createdAt: row.created_at, updatedAt: row.updated_at }; }
function wsCleanListPreviewText(value) {
  return wsText(value, 12000)
    .replace(/[\u200e\u200f\u202a-\u202e]/g, '')
    .replace(/此聊天中的新消息将在发送(?:7|90)天后自动消失（除非消息已保留）。?/g, '')
    .replace(/\d+\s*条未读消息/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
function wsCanonicalListPreviewTitle(title, lastMessageText, data = {}) {
  const cleanTitle = wsCleanListPreviewText(title);
  const preview = wsCleanListPreviewText(lastMessageText);
  if (!data?.previewOnly || !cleanTitle || !preview || cleanTitle.toLocaleLowerCase() === preview.toLocaleLowerCase()) return cleanTitle;
  const lowerTitle = cleanTitle.toLocaleLowerCase(), lowerPreview = preview.toLocaleLowerCase();
  if (lowerTitle.endsWith(lowerPreview) && cleanTitle.length > preview.length) return cleanTitle.slice(0, -preview.length).trim();
  // A few WhatsApp accessibility rows expose the contact name as both the
  // declared title and the preview prefix. Keep the contact portion as title.
  if (lowerTitle.startsWith(lowerPreview) && cleanTitle.length > preview.length) return preview;
  return cleanTitle;
}
function wsListPreviewOriginal(item, data) {
  const original = wsMessageText(item?.originalText);
  if (data?.source !== 'ws-list-preview' || data?.previewOnly !== true) return original;
  const listText = wsCleanListPreviewText(data?.listText);
  const cleanedOriginal = wsCleanListPreviewText(original);
  if (cleanedOriginal && cleanedOriginal !== original) return cleanedOriginal;
  if (!listText || !cleanedOriginal) return cleanedOriginal || original;
  if (listText.toLocaleLowerCase().startsWith(cleanedOriginal.toLocaleLowerCase()) && listText.length > cleanedOriginal.length) {
    const remainder = listText.slice(cleanedOriginal.length).trim()
      .replace(/^(?:(?:上午|下午|AM|PM)\s*\d{1,2}:?\d{2}|星期[一二三四五六日天]|昨天|今天|前天)\s+/i, '')
      .trim();
    if (remainder && remainder !== cleanedOriginal) return remainder.slice(0, WS_MESSAGE_MAX_CHARS);
  }
  return cleanedOriginal || original;
}
function normalizeStoredWsListPreviews() {
  const rows = db.prepare("SELECT id,account_id,conversation_id,original_text,data_json,created_at,updated_at FROM ws_messages WHERE json_extract(data_json,'$.source')='ws-list-preview'").all();
  if (!rows.length) return 0;
  let updated = 0;
  db.exec('BEGIN IMMEDIATE');
  try {
    for (const row of rows) {
      const canonical = wsListPreviewOriginal({ originalText: row.original_text }, wsJson(row.data_json, {}));
      if (canonical && canonical !== row.original_text) {
        const updatedAt = new Date().toISOString();
        db.prepare('UPDATE ws_messages SET original_text=?,updated_at=? WHERE id=? AND account_id=?').run(canonical, updatedAt, row.id, row.account_id);
        row.original_text = canonical;
        row.updated_at = updatedAt;
        updated += 1;
      }
    }
    const latestByConversation = new Map();
    for (const row of rows) {
      const key = `${row.account_id}\u0000${row.conversation_id}`;
      const prior = latestByConversation.get(key);
      if (!prior || `${row.updated_at || ''}|${row.created_at || ''}` > `${prior.updated_at || ''}|${prior.created_at || ''}`) latestByConversation.set(key, row);
    }
    const currentByConversation = new Map(db.prepare('SELECT id,account_id,title,last_message_text FROM ws_conversations').all().map(row => [`${row.account_id}\u0000${row.id}`, row]));
    for (const [key, latest] of latestByConversation) {
      const current = currentByConversation.get(key);
      if (latest && current) {
        const cleanedTitle = wsCleanListPreviewText(current.title);
        const title = cleanedTitle && latest.original_text && cleanedTitle.toLocaleLowerCase().endsWith(latest.original_text.toLocaleLowerCase())
          ? cleanedTitle.slice(0, -latest.original_text.length).trim()
          : cleanedTitle;
        if (title !== current.title || latest.original_text !== current.last_message_text) {
          db.prepare('UPDATE ws_conversations SET title=?,last_message_text=?,updated_at=? WHERE id=? AND account_id=?').run(title, latest.original_text.slice(0, 4000), new Date().toISOString(), current.id, current.account_id);
        }
      }
    }
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
  return updated;
}
normalizeStoredWsListPreviews();
function wsBatchPayload(row) { return { id: row.id, accountId: row.account_id || 'default', conversationId: row.conversation_id, fingerprint: row.fingerprint, messageCount: Number(row.message_count || 0), insertedCount: Number(row.inserted_count || 0), messageIds: wsJson(row.message_ids_json, []), createdAt: row.created_at, updatedAt: row.updated_at }; }
function wsCollectionRunPayload(row) { return { id: row.id, accountId: row.account_id || 'default', status: row.status, total: Number(row.total||0), discovered: Number(row.discovered||0), completed: Number(row.completed||0), analyzing: Number(row.analyzing||0), analyzed: Number(row.analyzed||0), failed: Number(row.failed||0), skipped: Number(row.skipped||0), retryable: Number(row.retryable||0), lastError: row.last_error||'', checkpoint: row.checkpoint||'', cursor: row.cursor||'', resumeCount: Number(row.resume_count||0), lastSuccessAt: row.last_success_at||'', createdAt: row.created_at, updatedAt: row.updated_at }; }
function wsCollectionItemPayload(row) { return { id: row.id, accountId: row.account_id || 'default', runId: row.run_id, conversationId: row.conversation_id, status: row.status, attempts: Number(row.attempts||0), analysisStatus: row.analysis_status, followupStatus: row.followup_status, nextFollowupAt: row.next_followup_at||'', coverageStatus: row.coverage_status||'unknown', lastError: row.last_error||'', checkpoint: row.checkpoint||'', createdAt: row.created_at, updatedAt: row.updated_at }; }
function refreshWsCollectionRunCounters(accountId, runId) {
  const run = db.prepare('SELECT * FROM ws_collection_runs WHERE id=? AND account_id=?').get(runId, accountId);
  if (!run) return null;
  const counts = db.prepare(`SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN status='completed' THEN 1 ELSE 0 END) AS completed,
       SUM(CASE WHEN status IN ('skipped','skipped_unread') THEN 1 ELSE 0 END) AS skipped,
      SUM(CASE WHEN status IN ('analyzing','running') THEN 1 ELSE 0 END) AS analyzing,
      SUM(CASE WHEN analysis_status='completed' THEN 1 ELSE 0 END) AS analyzed,
      SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END) AS failed,
      SUM(CASE WHEN status='retryable' OR analysis_status IN ('retryable','failed') THEN 1 ELSE 0 END) AS retryable
    FROM ws_collection_items WHERE account_id=? AND run_id=?`).get(accountId, runId);
  const total = Number(counts?.total || 0);
  const now = new Date().toISOString();
  db.prepare(`UPDATE ws_collection_runs SET total=?,discovered=?,completed=?,analyzing=?,analyzed=?,failed=?,skipped=?,retryable=?,updated_at=? WHERE id=? AND account_id=?`)
    .run(total, total, Number(counts?.completed || 0), Number(counts?.analyzing || 0), Number(counts?.analyzed || 0), Number(counts?.failed || 0), Number(counts?.skipped || 0), Number(counts?.retryable || 0), now, runId, accountId);
  return wsCollectionRunPayload(db.prepare('SELECT * FROM ws_collection_runs WHERE id=? AND account_id=?').get(runId, accountId));
}
function wsFollowupAlertPayload(row) { return { id: row.id, accountId: row.account_id || 'default', conversationId: row.conversation_id, analysisId: row.analysis_id, alertKey: row.alert_key, priority: row.priority, reason: row.reason, followupTime: row.followup_time || '', status: row.status || 'open', snoozedUntil: row.snoozed_until || '', data: wsJson(row.data_json, {}), createdAt: row.created_at, updatedAt: row.updated_at }; }
const AI_JOB_STATUSES = new Set(['queued', 'running', 'retryable', 'completed', 'failed', 'cancelled']);
function aiJobPayload(row) {
  return {
    id: row.id,
    accountId: row.account_id || 'default',
    conversationId: row.conversation_id,
    idempotencyKey: row.idempotency_key,
    payload: wsJson(row.payload_json, {}),
    status: row.status,
    attempts: Number(row.attempts || 0),
    maxAttempts: Number(row.max_attempts || 5),
    nextAttemptAt: row.next_attempt_at || '',
    lockedAt: row.locked_at || '',
    lastError: row.last_error || '',
    analysisId: row.analysis_id || '',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
function aiJobStats(accountId) {
  const rows = db.prepare('SELECT status,COUNT(*) AS count FROM ai_jobs WHERE account_id=? GROUP BY status').all(accountId);
  const stats = Object.fromEntries([...AI_JOB_STATUSES].map(status => [status, 0]));
  for (const row of rows) if (AI_JOB_STATUSES.has(String(row.status))) stats[row.status] = Number(row.count || 0);
  stats.total = Object.values(stats).reduce((sum, count) => sum + Number(count || 0), 0);
  return stats;
}
function supersedeStaleAiJobs(accountId, conversationId, sourceFingerprint, now) {
  const fingerprint = wsText(sourceFingerprint, 500);
  if (!fingerprint) return 0;
  const result = db.prepare(`UPDATE ai_jobs
    SET status='failed',locked_at='',next_attempt_at='',last_error='聊天历史已更新，已由新分析替代',updated_at=?
    WHERE account_id=? AND conversation_id=?
      AND status IN ('queued','retryable','running')
      AND json_valid(payload_json)
      AND COALESCE(json_extract(payload_json,'$.sourceFingerprint'),'')<>''
      AND json_extract(payload_json,'$.sourceFingerprint')<>?`)
    .run(now, accountId, conversationId, fingerprint);
  return Number(result?.changes || 0);
}
function aiJobBackoff(attempts) { return Math.min(15 * 60 * 1000, 1000 * (2 ** Math.max(0, Math.min(10, Number(attempts || 1) - 1)))); }
function wsConversationRow(id, accountId = 'default') { return db.prepare('SELECT * FROM ws_conversations WHERE id=? AND account_id=?').get(String(id || ''), wsAccountId(accountId)); }
function wsConversationPolicyError(code, message) { const error = new Error(message); error.code = code; error.status = 422; return error; }
function wsIsVipGroup(value) { return wsCore.isVipGroupConversation(value); }
function wsIsExcludedGroup(value) { return wsCore.isExcludedGroupConversation(value); }
const WS_TRUSTED_GROUP_SENDER_SOURCES = new Set(['data-jid','data-contact-id','message-author-jid','message-preamble','sender-phone','sender-jid']);
function wsVipMemberIdentity(value = {}) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const nested = source.memberIdentity && typeof source.memberIdentity === 'object' && !Array.isArray(source.memberIdentity) ? source.memberIdentity : {};
  const senderId = wsText(nested.senderId || nested.wsId || source.senderId || source.wsId, 200);
  const senderPhone = wsCrmSync.normalizePhone(nested.senderPhone || nested.phone || source.senderPhone || source.phone);
  const senderName = wsText(nested.senderName || nested.name || source.senderName || source.name, 200);
  const identitySource = wsText(nested.identitySource || nested.senderIdentitySource || source.identitySource || source.senderIdentitySource, 40).toLowerCase();
  const idTrusted = /@(?:c\.us|s\.whatsapp\.net|lid)$/i.test(senderId);
  const phoneTrusted = /^\d{8,15}$/.test(senderPhone);
  const trustedSource = WS_TRUSTED_GROUP_SENDER_SOURCES.has(identitySource);
  return {
    senderId,
    senderPhone,
    senderName,
    identitySource,
    trusted: source.senderIdentityTrusted === true || nested.trusted === true
      ? trustedSource && (idTrusted || phoneTrusted)
      : trustedSource && (idTrusted || phoneTrusted),
  };
}
function wsSameVipMemberIdentity(left, right) {
  const a = wsVipMemberIdentity(left), b = wsVipMemberIdentity(right);
  if (a.senderId && b.senderId && a.senderId.toLowerCase() === b.senderId.toLowerCase()) return true;
  return Boolean(a.senderPhone && b.senderPhone && a.senderPhone === b.senderPhone);
}
function wsVipMemberEvidence(conversation, value = {}) {
  if (!wsIsVipGroup(conversation)) return { required:false, valid:true, identity:null, messageCount:0 };
  const identity = wsVipMemberIdentity(value);
  if (!identity.trusted) return { required:true, valid:false, identity, messageCount:0, reason:'VIP 群分析缺少可信发言人 WS 标识或手机号。' };
  const rows = db.prepare("SELECT data_json FROM ws_messages WHERE account_id=? AND conversation_id=? AND direction='receive'").all(conversation.account_id, conversation.id);
  const messageCount = rows.reduce((count, row) => {
    const data = wsJson(row.data_json, {});
    return count + (data.senderIdentityTrusted === true && wsSameVipMemberIdentity(data, identity) ? 1 : 0);
  }, 0);
  if (!messageCount) return { required:true, valid:false, identity, messageCount:0, reason:'VIP 群内没有找到该发言人的可信原始消息，已拒绝跨客户写入。' };
  return { required:true, valid:true, identity, messageCount };
}
function wsVipScopedAnalysis(conversation, analysis, identity) {
  if (!wsIsVipGroup(conversation)) return analysis;
  const targetTexts = db.prepare("SELECT original_text,data_json FROM ws_messages WHERE account_id=? AND conversation_id=? AND direction='receive'").all(conversation.account_id, conversation.id)
    .filter(row => { const data = wsJson(row.data_json, {}); return data.senderIdentityTrusted === true && wsSameVipMemberIdentity(data, identity); })
    .map(row => wsMessageText(row.original_text).toLocaleLowerCase()).filter(Boolean);
  const facts = analysis?.profileFacts && typeof analysis.profileFacts === 'object' && !Array.isArray(analysis.profileFacts) ? analysis.profileFacts : {};
  const profileFacts = {};
  for (const [field, fact] of Object.entries(facts)) {
    if (!fact || typeof fact !== 'object' || Array.isArray(fact)) continue;
    const role = wsText(fact.sourceRole || fact.source_role, 40).toLowerCase();
    const evidence = wsText(fact.evidence || fact.sourceText || fact.quote, 2000).toLocaleLowerCase();
    if (!['customer','client','contact','客户','顾客','对方'].includes(role) || evidence.length < 2) continue;
    if (targetTexts.some(source => source.includes(evidence) || (source.length >= 8 && evidence.includes(source)))) profileFacts[field] = fact;
  }
  // Group-wide model output may use another member's biography. Keep the
  // target member's scoring/summary, but profile persistence is sourced only
  // from evidence-backed profileFacts above.
  return {
    ...analysis,
    profileFacts,
    contact:{}, profile:{},
    name:'', customerName:'', phone:'', country:'', origin:'', age:'', occupation:'', job:'', work:'',
    budget:'', productInterest:[],
    memberIdentity:identity,
    transcriptInfo:{ ...(analysis?.transcriptInfo || {}), memberScoped:true, memberIdentity:identity },
  };
}
function wsRequireConversation(id, accountId = 'default') {
  const row = wsConversationRow(id, accountId);
  if (!row) throw new Error('WS 会话不存在或已被清理。');
  if (wsIsExcludedGroup(row)) throw wsConversationPolicyError('WS_GROUP_EXCLUDED', '普通群聊未列入 VIP 白名单，不采集、不分析，也不生成跟进提醒。');
  return row;
}
function wsRequireAiConversation(id, accountId = 'default', joinedRow = null) {
  const row = joinedRow || wsRequireConversation(id, accountId);
  if (joinedRow && wsIsExcludedGroup(row)) throw wsConversationPolicyError('WS_GROUP_EXCLUDED', '普通群聊未列入 VIP 白名单，不采集、不分析，也不生成跟进提醒。');
  const data = wsJson(row.data_json, {});
  // Confirmed conversation types do not need a message-table probe. The
  // native-history guard only applies while the type remains unconfirmed.
  if (!['direct', 'vip_group'].includes(wsCore.conversationType(row))) {
    const nativeHistory = data.source === 'ws-list-discovery' || data.source === 'ws-webview2'
      || db.prepare("SELECT 1 FROM ws_messages WHERE account_id=? AND conversation_id=? AND json_valid(data_json) AND json_extract(data_json,'$.source')='ws-webview2' LIMIT 1").get(accountId, id);
    if (nativeHistory) throw wsConversationPolicyError('WS_CONVERSATION_TYPE_UNCONFIRMED', '尚未确认是一对一或白名单 VIP 群会话，请等待 WS 重新识别后分析。');
  }
  return row;
}
function wsAiEligible(id, accountId) { try { wsRequireAiConversation(id, accountId); return true; } catch { return false; } }
function wsAiEligibleConversation(id, accountId, joinedRow) { try { return wsRequireAiConversation(id, accountId, joinedRow); } catch { return null; } }
function wsQuiesceGroup(row, now = new Date().toISOString()) {
  if (!wsIsExcludedGroup(row)) return;
  db.prepare("UPDATE ai_jobs SET status='cancelled',locked_at='',next_attempt_at='',last_error='群聊已排除',updated_at=? WHERE account_id=? AND conversation_id=? AND status IN ('queued','running','retryable')").run(now, row.account_id, row.id);
  db.prepare("UPDATE ws_followup_alerts SET status='dismissed',snoozed_until='',updated_at=? WHERE account_id=? AND conversation_id=? AND status IN ('open','snoozed')").run(now, row.account_id, row.id);
  db.prepare("UPDATE ws_collection_items SET status='skipped-group',analysis_status='excluded',followup_status='dismissed',coverage_status='excluded-group',last_error='群聊已排除',updated_at=? WHERE account_id=? AND conversation_id=? AND coverage_status<>'excluded-group'").run(now, row.account_id, row.id);
  const state = governanceState();
  let changed = false;
  for (const task of state.settings.operatingTasks) {
    if (!task.aiGenerated || String(task.wsConversationId || '') !== row.id || String(task.wsAccountId || 'default') !== row.account_id || task.groupExcluded === true) continue;
    Object.assign(task, { status:'dismissed', done:true, groupExcluded:true, dismissedReason:'群聊已排除', updatedAt:now });
    changed = true;
  }
  if (changed) writeState(state, false);
}
function wsCreateId(prefix) { return `${prefix}-${Date.now().toString(36)}-${randomBytes(5).toString('hex')}`; }
function governanceActionId() { return wsCreateId('cga'); }
function governanceEvidenceId() { return wsCreateId('cge'); }
function recordGovernanceAction(action, customerId, before, after, options = {}) {
  const row = customerGovernance.buildGovernanceAction(customerId, action, before, after, options);
  db.prepare('INSERT INTO customer_governance_actions(id,customer_id,action,reason,source,confidence,analysis_id,before_json,after_json,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)')
    .run(governanceActionId(), row.customerId, row.action, row.reason, row.source, row.confidence, row.analysisId, JSON.stringify(row.before), JSON.stringify(row.after), row.createdAt);
  return row;
}
function recordAiFieldEvidence(customerId, evidenceRows, conflicts = []) {
  const conflictFields = new Set(conflicts.map(item => wsText(item.field, 120)));
  const insert = db.prepare(`INSERT OR IGNORE INTO ai_customer_field_evidence
    (id,customer_id,conversation_id,analysis_id,field_name,value_json,confidence,source_text,status,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?)`);
  const now = new Date().toISOString();
  let inserted = 0;
  for (const row of evidenceRows || []) {
    const status = conflictFields.has(wsText(row.field, 120)) ? 'conflict' : 'accepted';
    const result = insert.run(governanceEvidenceId(), customerId, wsText(row.conversationId, 160), wsText(row.analysisId, 160), wsText(row.field, 120), JSON.stringify(row.value ?? null), Number(row.confidence) || 0, wsText(row.sourceText, 2000), status, now, now);
    inserted += Number(result?.changes || 0);
  }
  return inserted;
}
function governanceState() {
  const state = readState() || emptyCrmState();
  for (const key of ['customers', 'tickets', 'deposits', 'followups', 'registrations', 'phoneRegistry', 'batchOperations', 'activities', 'importIssues']) if (!Array.isArray(state[key])) state[key] = [];
  if (!state.settings || typeof state.settings !== 'object' || Array.isArray(state.settings)) state.settings = {};
  if (!Array.isArray(state.settings.operatingTasks)) state.settings.operatingTasks = [];
  return state;
}
function governanceCustomer(state, id) { return state.customers.find(item => String(item?.id || '') === String(id || '')); }
function stateVersionFailure(req) {
  const expected = req.headers['x-state-version'];
  const current = readStateEnvelope().version;
  if (expected === undefined) return { status: 428, body: { error: '本次写入必须提供数据版本，请先同步后重试。', version: current } };
  if (String(expected) !== current) return { status: 409, body: { error: '共享数据已在其他窗口更新，请先同步后重试。', version: current } };
  return null;
}
function hotProfileId(customerId, accountId, conversationId) {
  return `hcp-${createHash('sha256').update(`${customerId}\u0000${accountId}\u0000${conversationId}`).digest('hex').slice(0, 32)}`;
}
function hotProfileIdentity(input = {}) {
  return { customerId: wsText(input.customerId, 128), accountId: wsAccountId(input.accountId), conversationId: wsText(input.conversationId, 160) };
}
function hotProfileRow(identity) {
  return db.prepare('SELECT * FROM hot_chat_profiles WHERE customer_id=? AND account_id=? AND conversation_id=?').get(identity.customerId, identity.accountId, identity.conversationId);
}
function hotProfilePayload(row, fields = null) {
  const list = fields || (row ? db.prepare('SELECT * FROM hot_chat_profile_fields WHERE profile_id=? ORDER BY field_key').all(row.id) : []);
  const fieldMap = Object.fromEntries(list.map(item => [item.field_key, { field: item.field_key, value: wsJson(item.value_json, null), state: item.state, confidence: Number(item.confidence || 0), evidence: wsJson(item.evidence_json, []), manualLocked: Boolean(item.manual_locked), updatedAt: item.updated_at }]));
  const meta = row ? wsJson(row.data_json, {}) : {};
  const safeMeta = meta && typeof meta === 'object' && !Array.isArray(meta) ? meta : {};
  const nextTopics = Array.isArray(safeMeta.nextTopics) ? safeMeta.nextTopics.map(item => wsText(item, 240)).filter(Boolean).slice(0, 3) : [];
  const noReply = safeMeta.noReply && typeof safeMeta.noReply === 'object' && !Array.isArray(safeMeta.noReply)
    ? { noReply: Boolean(safeMeta.noReply.noReply), reason: wsText(safeMeta.noReply.reason, 500), cooldownDays: Math.max(1, Math.min(30, Number(safeMeta.noReply.cooldownDays) || 3)), suggestedAt: wsText(safeMeta.noReply.suggestedAt, 80) }
    : { noReply: false, reason: '', cooldownDays: 3, suggestedAt: '' };
  return {
    id: row?.id || '', customerId: row?.customer_id || '', accountId: row?.account_id || 'default', conversationId: row?.conversation_id || '',
    statusColor: row?.status_color || 'gray', manualColor: row?.manual_color || '', manualLocked: Boolean(row?.manual_locked), completeness: Number(row?.completeness || 0), version: Number(row?.version || 0),
    conversationProgress: wsText(safeMeta.conversationProgress, 2000), customerTemperature: wsText(safeMeta.customerTemperature, 32), profileSummary: wsText(safeMeta.profileSummary, 4000),
    nextTopics, noReply, nextFollowupAt: wsText(safeMeta.nextFollowupAt, 80), tags: Array.isArray(safeMeta.tags) ? safeMeta.tags.map(item => wsText(item, 80)).filter(Boolean).slice(0, 100) : [],
    fields: fieldMap, fieldList: Object.values(fieldMap), createdAt: row?.created_at || '', updatedAt: row?.updated_at || '', lastProgressAt: safeMeta.lastProgressAt || row?.updated_at || '',
  };
}
function hotProfileDefaultPayload(identity) {
  const fields = Object.fromEntries(hotChatProfile.PROFILE_FIELDS.map(field => [field, { field, value: null, state: 'missing', confidence: 0, evidence: [], manualLocked: false, updatedAt: '' }]));
  return { id: '', customerId: identity.customerId, accountId: identity.accountId, conversationId: identity.conversationId, statusColor: 'gray', manualColor: '', manualLocked: false, completeness: 0, version: 0, conversationProgress: '', customerTemperature: '', profileSummary: '', nextTopics: [], noReply: { noReply: false, reason: '', cooldownDays: 3, suggestedAt: '' }, nextFollowupAt: '', tags: [], fields, fieldList: Object.values(fields), createdAt: '', updatedAt: '', lastProgressAt: '' };
}
function ensureHotProfile(identity, now = new Date().toISOString()) {
  let row = hotProfileRow(identity);
  if (row) return row;
  const id = hotProfileId(identity.customerId, identity.accountId, identity.conversationId);
  db.prepare('INSERT OR IGNORE INTO hot_chat_profiles(id,customer_id,account_id,conversation_id,status_color,manual_color,manual_locked,completeness,version,data_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)')
    .run(id, identity.customerId, identity.accountId, identity.conversationId, 'gray', '', 0, 0, 0, '{}', now, now);
  row = db.prepare('SELECT * FROM hot_chat_profiles WHERE id=?').get(id);
  for (const field of hotChatProfile.PROFILE_FIELDS) db.prepare('INSERT OR IGNORE INTO hot_chat_profile_fields(id,profile_id,field_key,value_json,state,confidence,evidence_json,manual_locked,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)').run(wsCreateId('hcpf'), id, field, 'null', 'missing', 0, '[]', 0, now, now);
  return db.prepare('SELECT * FROM hot_chat_profiles WHERE id=?').get(id);
}
function bumpStateVersion() {
  const now = new Date().toISOString();
  const changed = db.prepare('UPDATE app_state SET revision=revision+1,updated_at=? WHERE id=1').run(now);
  if (Number(changed?.changes || 0) === 0) writeState(emptyCrmState(), false);
}
function normalizeHotFacts(body = {}) {
  const facts = [];
  if (body.fields && typeof body.fields === 'object' && !Array.isArray(body.fields)) for (const [field, value] of Object.entries(body.fields)) facts.push({ field, ...(value && typeof value === 'object' && !Array.isArray(value) ? value : { value }) });
  if (Array.isArray(body.facts)) facts.push(...body.facts);
  if (body.field) facts.push(body);
  const merged = new Map();
  for (const item of facts) { const field = wsText(item?.field, 80); if (!hotChatProfile.PROFILE_FIELDS.includes(field)) continue; merged.set(field, hotChatProfile.normalizeProfileFact(field, item)); }
  return [...merged.values()];
}
function hotFactsFromAnalysis(analysis = {}, analysisId = '') {
  const facts = [];
  const source = analysis.profileFacts && typeof analysis.profileFacts === 'object' ? analysis.profileFacts : {};
  for (const [field, item] of Object.entries(source)) {
    if (!hotChatProfile.PROFILE_FIELDS.includes(field)) continue;
    facts.push(hotChatProfile.normalizeProfileFact(field, { ...(item && typeof item === 'object' ? item : { value: item }), analysisId }));
  }
  for (const item of Array.isArray(analysis.evidence) ? analysis.evidence : []) {
    const field = wsText(item?.field, 80);
    if (!hotChatProfile.PROFILE_FIELDS.includes(field)) continue;
    facts.push(hotChatProfile.normalizeProfileFact(field, { ...item, evidence: item.evidence || item.text, analysisId }));
  }
  return facts;
}
function saveHotProfile(identity, facts = [], options = {}) {
  const now = new Date().toISOString();
  const row = ensureHotProfile(identity, now);
  const existing = db.prepare('SELECT * FROM hot_chat_profile_fields WHERE profile_id=?').all(row.id);
  const byField = new Map(existing.map(item => [item.field_key, item]));
  const upsert = db.prepare('UPDATE hot_chat_profile_fields SET value_json=?,state=?,confidence=?,evidence_json=?,manual_locked=?,updated_at=? WHERE profile_id=? AND field_key=?');
  const incoming = facts.filter(fact => hotChatProfile.PROFILE_FIELDS.includes(fact.field));
  const current = Object.fromEntries(existing.map(item => [item.field_key, { value: wsJson(item.value_json, null), state: item.state, confidence: Number(item.confidence || 0), evidence: wsJson(item.evidence_json, []) }]));
  const priorObservations = existing.flatMap(item => (Array.isArray(current[item.field_key].evidence) ? current[item.field_key].evidence : []).map(evidence => ({ field: item.field_key, value: evidence.value, confidence: evidence.confidence, evidence: evidence.text })));
  const observations = [...priorObservations, ...incoming.map(fact => ({ field: fact.field, value: fact.value, confidence: fact.confidence, evidence: fact.evidence }))];
  const mergedProfile = hotChatProfile.mergeEvidence(current, observations);
  for (const field of new Set(incoming.map(item => item.field))) {
    const prior = byField.get(field);
    if (prior?.manual_locked && options.allowManual !== true) continue;
    const merged = mergedProfile[field];
    const explicit = incoming.find(item => item.field === field);
    if (options.allowManual === true && (explicit?.state === 'known' || explicit?.state === 'declined')) {
      merged.value = explicit.value;
      merged.state = explicit.state;
      merged.confidence = explicit.confidence;
    }
    const evidence = (Array.isArray(merged.observations) ? merged.observations : []).filter((item, index, all) => index === all.findIndex(other => other.evidence === item.evidence && JSON.stringify(other.value) === JSON.stringify(item.value))).map(item => ({ value: item.value, confidence: item.confidence, text: item.evidence }));
    // An explicit manual unlock must clear the field lock as well as the
    // profile-level lock; otherwise the UI reports “解除锁定” but AI facts
    // remain permanently blocked for this field.
    const fieldManualLocked = Object.hasOwn(options, 'manualLocked') ? (options.manualLocked ? 1 : 0) : Number(prior?.manual_locked || 0);
    upsert.run(JSON.stringify(merged.value ?? null), merged.state, Number(merged.confidence || 0), JSON.stringify(evidence), fieldManualLocked, now, row.id, field);
  }
  const fields = db.prepare('SELECT * FROM hot_chat_profile_fields WHERE profile_id=?').all(row.id);
  const profileObj = Object.fromEntries(fields.map(item => [item.field_key, { value: wsJson(item.value_json, null), state: item.state }]));
  const completeness = hotChatProfile.computeCompleteness(profileObj);
  const requestedColor = Object.hasOwn(options, 'manualColor') ? wsText(options.manualColor, 20) : row.manual_color;
  const manualColor = ['green', 'blue', 'amber', 'red', 'gray'].includes(requestedColor) ? requestedColor : (row.manual_color || '');
  const manualLocked = Object.hasOwn(options, 'manualLocked') ? (options.manualLocked ? 1 : 0) : row.manual_locked;
  const statusColor = hotChatProfile.deriveStatusColor({ completeness, manualOverride: manualLocked ? { color: manualColor, locked: true } : null, aiColor: options.statusColor || row.status_color });
  const previousMeta = wsJson(row.data_json, {});
  const meta = previousMeta && typeof previousMeta === 'object' && !Array.isArray(previousMeta) ? { ...previousMeta } : {};
  if (Object.hasOwn(options, 'conversationProgress')) meta.conversationProgress = wsText(options.conversationProgress, 2000);
  if (Object.hasOwn(options, 'customerTemperature')) meta.customerTemperature = wsText(options.customerTemperature, 32);
  if (Object.hasOwn(options, 'profileSummary')) meta.profileSummary = wsText(options.profileSummary, 4000);
  if (Object.hasOwn(options, 'nextTopics')) meta.nextTopics = Array.isArray(options.nextTopics) ? options.nextTopics.map(item => wsText(item, 240)).filter(Boolean).slice(0, 3) : [];
  if (Object.hasOwn(options, 'noReply')) {
    const value = options.noReply && typeof options.noReply === 'object' ? options.noReply : {};
    meta.noReply = { noReply: Boolean(value.noReply), reason: wsText(value.reason, 500), cooldownDays: Math.max(1, Math.min(30, Number(value.cooldownDays) || 3)), suggestedAt: wsText(value.suggestedAt, 80) };
  }
  if (Object.hasOwn(options, 'nextFollowupAt')) meta.nextFollowupAt = options.nextFollowupAt ? wsIso(options.nextFollowupAt) : '';
  if (Object.hasOwn(options, 'tags')) meta.tags = Array.isArray(options.tags) ? options.tags.map(item => wsText(item, 80)).filter(Boolean).slice(0, 100) : [];
  meta.lastProgressAt = now;
  db.prepare('UPDATE hot_chat_profiles SET status_color=?,manual_color=?,manual_locked=?,completeness=?,data_json=?,version=version+1,updated_at=? WHERE id=?').run(statusColor, manualColor, manualLocked, completeness, JSON.stringify(meta), now, row.id);
  return db.prepare('SELECT * FROM hot_chat_profiles WHERE id=?').get(row.id);
}
function enqueueHotOutbox(profileRow, eventId, payload, operation = 'upsert_profile') {
  const now = new Date().toISOString();
  const id = wsCreateId('hco');
  db.prepare('INSERT OR IGNORE INTO hot_chat_sync_outbox(id,profile_id,event_id,account_id,operation,payload_json,status,attempts,next_attempt_at,last_error,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)')
    .run(id, profileRow.id, eventId || '', profileRow.account_id, operation, JSON.stringify(payload || {}), 'pending', 0, now, '', now, now);
  return db.prepare('SELECT * FROM hot_chat_sync_outbox WHERE profile_id=? AND event_id=?').get(profileRow.id, eventId || '') || db.prepare('SELECT * FROM hot_chat_sync_outbox WHERE id=?').get(id);
}
function hotOutboxPayload(row) { return { id: row.id, profileId: row.profile_id, eventId: row.event_id, accountId: row.account_id, operation: row.operation, payload: wsJson(row.payload_json, {}), status: row.status, attempts: Number(row.attempts || 0), nextAttemptAt: row.next_attempt_at || '', lastError: row.last_error || '', createdAt: row.created_at, updatedAt: row.updated_at }; }
function governanceActionPayload(row) {
  return { id: row.id, customerId: row.customer_id, action: row.action, reason: row.reason, source: row.source, confidence: Number(row.confidence || 0), analysisId: row.analysis_id, before: wsJson(row.before_json, {}), after: wsJson(row.after_json, {}), createdAt: row.created_at };
}
function governanceEvidencePayload(row) {
  return { id: row.id, customerId: row.customer_id, conversationId: row.conversation_id, analysisId: row.analysis_id, fieldName: row.field_name, value: wsJson(row.value_json, row.value_json), confidence: Number(row.confidence || 0), sourceText: row.source_text, status: row.status, createdAt: row.created_at, updatedAt: row.updated_at };
}
function wsTranslationFields(body, existing = null) {
  const translatedText = Object.hasOwn(body, 'translatedText') ? wsText(body.translatedText, 12000) : (existing?.translated_text || '');
  let translationStatus = Object.hasOwn(body, 'translationStatus') && WS_TRANSLATION_STATUSES.has(wsText(body.translationStatus, 24)) ? wsText(body.translationStatus, 24) : (existing?.translation_status || (translatedText ? 'translated' : 'none'));
  if (translatedText && !Object.hasOwn(body, 'translationStatus')) translationStatus = 'translated';
  const translationError = Object.hasOwn(body, 'translationError') ? wsText(body.translationError, 1000) : (existing?.translation_error || '');
  const translationAttempts = Object.hasOwn(body, 'translationAttempts') ? Math.max(0, Math.floor(Number(body.translationAttempts) || 0)) : Number(existing?.translation_attempts || 0);
  const lastAttemptAt = Object.hasOwn(body, 'lastAttemptAt') ? (body.lastAttemptAt ? wsIso(body.lastAttemptAt) : '') : (existing?.last_attempt_at || '');
  return { translatedText, translationStatus, translationError, translationAttempts, lastAttemptAt };
}
function wsBatchFingerprint(conversationId, messages, value) {
  const supplied = wsText(value, 160);
  if (supplied) return supplied;
  const canonical = messages.map(item => ({ externalId: wsText(item?.externalId, 200), direction: wsText(item?.direction, 16), senderId:wsText(item?.data?.senderId || item?.senderId, 200), senderPhone:wsCrmSync.normalizePhone(item?.data?.senderPhone || item?.senderPhone), originalText: wsMessageText(item?.originalText), order: Number.isFinite(Number(item?.order)) ? Number(item.order) : 0 }));
  return createHash('sha256').update(JSON.stringify([conversationId, canonical])).digest('hex');
}
function wsAuthoritativeHistoryFingerprint(accountId, conversationId) {
  const rows = db.prepare(`SELECT external_id,direction,original_text,order_no,data_json,created_at
    FROM ws_messages
    WHERE account_id=? AND conversation_id=? AND COALESCE(json_extract(data_json,'$.previewOnly'),0)<>1
    ORDER BY order_no ASC,external_id ASC,direction ASC,original_text ASC`).all(accountId, conversationId);
  const canonical = rows.map(row => {
    const data = wsJson(row.data_json, {});
    const time = wsStoredMessageTime(row, data);
    return {
      externalId: wsText(row.external_id, 200),
      direction: wsText(row.direction, 16),
      senderId: wsText(data.senderId, 200),
      senderPhone: wsCrmSync.normalizePhone(data.senderPhone),
      sentAtKnown: time.sentAtKnown === true,
      sentAt: time.sentAtKnown === true ? time.sentAt : '',
      originalText: wsMessageText(row.original_text),
      order: Number.isFinite(Number(row.order_no)) ? Number(row.order_no) : 0,
    };
  });
  return createHash('sha256').update(JSON.stringify(['zhike-ws-history-v1', canonical])).digest('hex');
}

// Metadata-only retirement. Original messages and customer business records
// remain intact; previously scheduled group work cannot resume on restart.
db.exec('BEGIN IMMEDIATE');
try {
  for (const row of db.prepare('SELECT * FROM ws_conversations').all()) if (wsIsExcludedGroup(row)) wsQuiesceGroup(row);
  db.exec('COMMIT');
} catch (error) { db.exec('ROLLBACK'); throw error; }

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://127.0.0.1:${port}`);
    if (req.headers.host !== `127.0.0.1:${port}` && req.headers.host !== `localhost:${port}`) return json(res, 403, { error: '仅允许本机访问。' });
    if (url.pathname.startsWith('/api/') && url.pathname !== '/api/health') {
      const origin = String(req.headers.origin || '');
      const allowedOrigins = new Set([`http://127.0.0.1:${port}`, `http://localhost:${port}`]);
      if (origin && !allowedOrigins.has(origin)) return json(res, 403, { error: '请求来源未获授权。' });
      const supplied = String(req.headers['x-zhike-api-token'] || '');
      const valid = supplied.length === apiToken.length && timingSafeEqual(Buffer.from(supplied), Buffer.from(apiToken));
      if (!valid) return json(res, 401, { error: '本机会话已失效，请重新打开工作台。' });
    }
    if (req.method === 'POST' && url.pathname === '/api/shutdown') {
      const expected = process.env.ZHIKE_SHUTDOWN_TOKEN || '';
      const supplied = String(req.headers['x-zhike-shutdown-token'] || '');
      const valid = expected.length === supplied.length && expected.length > 0 && timingSafeEqual(Buffer.from(expected), Buffer.from(supplied));
      if (!valid) return json(res, 403, { error: '关闭请求未获授权。' });
      json(res, 200, { ok: true });
      setImmediate(() => server.close(() => process.exit(0)));
      return;
    }
    if (url.pathname === '/api/ws/accounts') {
      if (req.method === 'GET') {
        // A damaged or manually migrated profile can miss the seed row even
        // though the rest of the WS schema is present. Repair that invariant
        // before the first account-list response so the renderer never boots
        // into an empty account picker.
        ensureDefaultWsAccount();
        return json(res, 200, { accounts: db.prepare('SELECT * FROM ws_accounts ORDER BY CASE WHEN id=\'default\' THEN 0 ELSE 1 END, created_at ASC').all().map(wsAccountPayload) });
      }
      if (req.method === 'POST') {
        const body = JSON.parse((await readBody(req, 256 * 1024)).toString('utf8'));
        const id = wsText(body.id, 120);
        if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/.test(id)) return json(res, 400, { error: 'WS 账号编号无效。' });
        if (wsAccountRow(id)) return json(res, 409, { error: 'WS 账号已存在。' });
        const now = new Date().toISOString();
        db.exec('BEGIN IMMEDIATE');
        try {
          const status = WS_STATUSES.has(wsText(body.status, 32)) ? wsText(body.status, 32) : '未连接';
          db.prepare('INSERT INTO ws_accounts(id,display_name,provider,origin,partition_key,status,last_status,last_seen_at,enabled,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)')
            .run(id, wsText(body.displayName, 200) || id, wsText(body.provider, 120), wsText(body.origin, 500), wsText(body.partitionKey, 200) || `persist:${id}`, status, status === '未连接' ? '' : status, status === '已连接' ? now : '', body.enabled === false ? 0 : 1, now, now);
          wsSaveAccountSettings(id, body.settings || body, now);
          db.exec('COMMIT');
        } catch (error) { db.exec('ROLLBACK'); throw error; }
        return json(res, 201, { account: wsAccountPayload(wsAccountRow(id)) });
      }
      return json(res, 405, { error: 'WS 账号只支持 GET/POST。' });
    }
    const accountMatch = url.pathname.match(/^\/api\/ws\/accounts\/([^/]+)$/);
    if (accountMatch) {
      const accountId = decodeURIComponent(accountMatch[1]);
      const account = wsAccountRow(accountId);
      if (!account) return json(res, 404, { error: 'WS 账号不存在。' });
      if (req.method === 'PATCH') {
        const body = JSON.parse((await readBody(req, 256 * 1024)).toString('utf8'));
        const now = new Date().toISOString();
        db.exec('BEGIN IMMEDIATE');
        try {
          const status = Object.hasOwn(body, 'status') && WS_STATUSES.has(wsText(body.status, 32)) ? wsText(body.status, 32) : (WS_STATUSES.has(String(account.status || '')) ? account.status : '未连接');
          const lastStatus = status === '未连接' ? (account.last_status || '') : status;
          const lastSeenAt = status === '已连接' ? now : (account.last_seen_at || '');
          db.prepare('UPDATE ws_accounts SET display_name=?,provider=?,origin=?,partition_key=?,status=?,last_status=?,last_seen_at=?,enabled=?,updated_at=? WHERE id=?')
            .run(Object.hasOwn(body, 'displayName') ? wsText(body.displayName, 200) : account.display_name, Object.hasOwn(body, 'provider') ? wsText(body.provider, 120) : account.provider, Object.hasOwn(body, 'origin') ? wsText(body.origin, 500) : account.origin, Object.hasOwn(body, 'partitionKey') ? wsText(body.partitionKey, 200) : account.partition_key, status, lastStatus, lastSeenAt, body.enabled === false ? 0 : (body.enabled === true ? 1 : account.enabled), now, accountId);
          if (body.settings || Object.hasOwn(body, 'translationEnabled') || Object.hasOwn(body, 'aiEnabled') || Object.hasOwn(body, 'autoCollectionEnabled')) wsSaveAccountSettings(accountId, body.settings || body, now);
          db.exec('COMMIT');
        } catch (error) { db.exec('ROLLBACK'); throw error; }
        return json(res, 200, { account: wsAccountPayload(wsAccountRow(accountId)) });
      }
      if (req.method === 'DELETE') {
        if (accountId === 'default') return json(res, 400, { error: '默认 WS 账号不能删除。' });
        db.exec('BEGIN IMMEDIATE');
        try { db.prepare('DELETE FROM ws_accounts WHERE id=?').run(accountId); db.exec('COMMIT'); } catch (error) { db.exec('ROLLBACK'); throw error; }
        return json(res, 200, { ok: true, accountId });
      }
      return json(res, 405, { error: 'WS 账号只支持 PATCH/DELETE。' });
    }
    // Desktop WebView2 collector endpoint. The retired remote connector used a
    // versioned server route whose payload assumed a server
    // generated conversation id.  The local-first collector only knows the
    // WhatsApp conversation key, so this adapter creates/updates the local
    // conversation and then performs an idempotent message insert in one
    // SQLite transaction.  It deliberately accepts list-only checkpoints so
    // background collection can register every visible contact without
    // opening each chat.
    if (url.pathname === '/api/ws/ingest/batch' && req.method === 'POST') {
      const body = JSON.parse((await readBody(req, WS_MESSAGE_BATCH_MAX_BYTES)).toString('utf8'));
      const accountId = wsAccountId(body.accountId);
      wsRequireAccount(accountId);
      const capturedAt = wsStrictIso(body.capturedAt) || new Date().toISOString();
      const inputMessages = Array.isArray(body.messages) ? body.messages.slice(0, 1000) : [];
      const inputCheckpoints = Array.isArray(body.checkpoints) ? body.checkpoints.slice(0, 5000) : [];
      const grouped = new Map();
      const addConversation = key => {
        const normalized = wsText(key, 200);
        if (!normalized) return null;
        if (!grouped.has(normalized)) grouped.set(normalized, { messages: [], checkpoints: [] });
        return grouped.get(normalized);
      };
      for (const item of inputCheckpoints) {
        const key = wsText(item?.conversationKey, 200);
        const group = addConversation(key);
        if (group) group.checkpoints.push(item);
      }
      for (const item of inputMessages) {
        const key = wsText(item?.conversationKey, 200);
        const checkpoints = grouped.get(key)?.checkpoints || [];
        const checkpointIsVip = checkpoints.some(cp => wsIsVipGroup(cp));
        const checkpointIsOrdinaryGroup = !checkpointIsVip && checkpoints.some(cp => wsIsExcludedGroup(cp));
        const itemType = wsCore.conversationType(item);
        if (checkpointIsOrdinaryGroup || (itemType === 'group' && !checkpointIsVip)
          || (!checkpointIsVip && checkpoints.some(cp => cp?.conversationType === 'unknown'))) continue;
        if (wsMessageTextTooLong(item?.body)) return json(res, 413, { error: `WS 原文超过 ${WS_MESSAGE_MAX_CHARS} 字符，未保存且原值未修改。` });
        const bodyText = wsMessageText(item?.body);
        if (!key || !bodyText.trim()) continue;
        const group = addConversation(key);
        const rawDirection = String(item?.direction || '').toLowerCase();
        const direction = ['outgoing', 'send', 'sent'].includes(rawDirection)
          ? 'send'
          : ['incoming', 'receive', 'received'].includes(rawDirection) ? 'receive' : '';
        if (!direction) return json(res, 422, { error: 'WS 消息方向无法确认，批次已拒绝并保留等待重试。' });
        const directionSource = wsText(item?.directionSource, 40);
        if (directionSource && !WS_NATIVE_DIRECTION_SOURCES.has(directionSource)) return json(res, 422, { error: 'WS 消息方向证据无效，批次已拒绝并保留等待重试。' });
        if (directionSource && WS_NATIVE_DIRECTION_SOURCE_MAP.get(directionSource) !== direction) return json(res, 422, { error: 'WS 消息方向与页面证据不一致，批次已拒绝并保留等待重试。' });
        const legacyExternalMessageId = directionSource ? wsText(item?.legacyExternalMessageId, 200) : '';
        const time = wsMessageTimeMetadata(item, capturedAt);
        const senderIdentity = wsVipMemberIdentity(item);
        group.messages.push({
          externalId: wsText(item?.externalMessageId || item?.externalId, 200),
          legacyExternalMessageId,
          direction,
          originalText: bodyText,
          sentAt: time.sentAt,
          createdAt: time.sentAt || time.observedAt,
          order: Number.isFinite(Number(item?.order)) ? Number(item.order) : group.messages.length + 1,
          data: wsMessageDataWithTime({
            source: item?.previewOnly === true ? 'ws-list-preview' : 'ws-webview2',
            previewOnly: item?.previewOnly === true,
            cursor: wsText(item?.cursor, 500),
            ...(checkpointIsVip || itemType === 'vip_group' ? { conversationType:'vip_group', vipGroup:true, isGroup:true } : {}),
            ...(senderIdentity.senderId ? { senderId:senderIdentity.senderId } : {}),
            ...(senderIdentity.senderPhone ? { senderPhone:senderIdentity.senderPhone } : {}),
            ...(senderIdentity.senderName ? { senderName:senderIdentity.senderName } : {}),
            ...(senderIdentity.identitySource ? { senderIdentitySource:senderIdentity.identitySource } : {}),
            senderIdentityTrusted: direction === 'send' ? true : senderIdentity.trusted,
            ...(directionSource ? { directionSource, directionVersion: 4, canonicalExternalMessageId: wsText(item?.externalMessageId || item?.externalId, 200), legacyExternalMessageId } : {}),
          }, time),
        });
      }
      if (!grouped.size) return json(res, 200, { accepted: 0, deduplicated: 0, repairedTimestamps: 0, repairedDirections: 0, messageIds: [], processedAt: new Date().toISOString() });
      let accepted = 0, deduplicated = 0, repairedTimestamps = 0, repairedDirections = 0;
      const messageIds = [];
      const now = new Date().toISOString();
      db.exec('BEGIN IMMEDIATE');
      try {
        for (const [externalKey, group] of grouped) {
          let conversation = db.prepare('SELECT * FROM ws_conversations WHERE account_id=? AND external_id=?').get(accountId, externalKey);
          const checkpoint = group.checkpoints.at(-1) || {};
          const checkpointTypes = group.checkpoints.map(item => wsCore.conversationType(item));
          const type = checkpointTypes.includes('vip_group')
            ? 'vip_group'
            : checkpointTypes.includes('group')
              ? 'group'
              : (checkpointTypes.includes('direct') ? 'direct' : wsCore.conversationType({ ...checkpoint, externalId:externalKey }) === 'unknown' && conversation ? wsCore.conversationType(conversation) : wsCore.conversationType({ ...checkpoint, externalId:externalKey }));
          if (type === 'group') {
            if (conversation) {
              db.prepare('UPDATE ws_conversations SET data_json=?,updated_at=? WHERE id=? AND account_id=?').run(JSON.stringify({ ...wsJson(conversation.data_json, {}), conversationType:'group', isGroup:true, coverage:'excluded-group', collectionStatus:'skipped-group', historyLoaded:false }), now, conversation.id, accountId);
              wsQuiesceGroup(conversation, now);
            }
            continue;
          }
          const typeUnresolved = type === 'unknown';
          if (typeUnresolved) { group.messages = []; Object.assign(checkpoint, {historyLoaded:false, coverage:'conversation-type-unresolved', collectionStatus:'retryable'}); }
          const last = group.messages.at(-1);
          const checkpointPreview = wsCleanListPreviewText(checkpoint.lastMessagePreview || checkpoint.previewText || checkpoint.preview);
          const checkpointLastAt = wsMaybeIso(checkpoint.lastMessageAt || checkpoint.lastMessageTime);
          const checkpointUnread = wsOptionalCount(checkpoint.unreadCount);
          const hasCheckpointPreview = Boolean(checkpointPreview);
          const hasCheckpointLastAt = Boolean(checkpointLastAt);
          const hasCheckpointUnread = checkpointUnread !== null;
          const previousData = conversation ? wsJson(conversation.data_json, {}) : {};
          const previousWasPreviewOnly = previousData.lastMessageSource === 'ws-list-preview' || previousData.previewOnly === true;
          const checkpointCoverage = wsText(checkpoint.coverage, 40);
          const isReadHistoryCheckpoint = /read-history/.test(checkpointCoverage);
          const historyLoaded = checkpoint.historyLoaded === true;
          const historyMessageCount = Number.isFinite(Number(checkpoint.historyMessageCount)) ? Math.max(0, Math.floor(Number(checkpoint.historyMessageCount))) : 0;
          const checkpointDirectionVersion = Math.max(0, Math.floor(Number(checkpoint.directionVersion) || 0));
          const directionUnresolvedCount = Math.max(0, Math.floor(Number(checkpoint.directionUnresolvedCount) || 0));
          // The row fingerprint is deliberately separate from the full-chat
          // fingerprint. WhatsApp list previews, relative time labels and
          // unread badges change with layout/time even when the transcript is
          // identical; they may schedule a native re-open but must never make
          // a completed AI result stale by themselves.
          const listFingerprint = wsText(checkpoint.listFingerprint || checkpoint.lastMessageFingerprint || checkpoint.cursor, 500);
          const previousHistoryFingerprint = wsText(previousData.historyFingerprint, 500);
          const checkpointSource = last?.originalText
            ? 'ws-message'
            : (hasCheckpointPreview || hasCheckpointLastAt || hasCheckpointUnread
              ? (conversation && !previousWasPreviewOnly && wsText(conversation.last_message_text, 4000) ? 'ws-message' : 'ws-list-preview')
              : previousData.lastMessageSource || '');
          const checkpointData = {
            source: 'ws-list-discovery',
            ...(type === 'direct' || typeUnresolved ? { conversationType:type, isGroup:false, vipGroup:false } : {}),
            ...(type === 'vip_group' ? { conversationType:'vip_group', isGroup:true, vipGroup:true } : {}),
            visibleOnly: true,
            displayName: wsText(checkpoint.displayName, 200),
            cursor: wsText(checkpoint.cursor, 500),
            ...(listFingerprint ? { listFingerprint } : {}),
            ...(checkpointCoverage && !(previousData.historyLoaded === true && !isReadHistoryCheckpoint) ? { coverage: checkpointCoverage } : {}),
            ...(Object.hasOwn(checkpoint, 'historyLoaded') && isReadHistoryCheckpoint ? { historyLoaded: false, historyStale: true } : {}),
            ...(isReadHistoryCheckpoint && Number.isFinite(Number(checkpoint.historyMessageCount)) && Number(checkpoint.historyMessageCount) >= 0 ? { historyMessageCount: Math.floor(Number(checkpoint.historyMessageCount)) } : {}),
            ...(checkpointDirectionVersion ? { directionCaptureVersion: checkpointDirectionVersion, directionUnresolvedCount } : {}),
            ...(wsText(checkpoint.collectionStatus, 30) ? { collectionStatus: wsText(checkpoint.collectionStatus, 30) } : {}),
            ...(hasCheckpointPreview ? { lastMessagePreview: checkpointPreview } : {}),
            ...(hasCheckpointLastAt ? { lastMessageAt: checkpointLastAt } : {}),
            ...(hasCheckpointUnread ? { unreadCount: checkpointUnread } : {}),
            ...(checkpointSource ? { lastMessageSource: checkpointSource } : {}),
            capturedAt,
          };
          if (typeUnresolved) Object.assign(checkpointData, { historyLoaded:false, historyStale:true, coverage:'conversation-type-unresolved' });
          if (!conversation) {
            const id = wsCreateId('wsc');
            const initialText = last?.originalText?.slice(0, 4000) || checkpointPreview;
            const initialAt = last?.sentAt || checkpointLastAt;
            const initialUnread = hasCheckpointUnread ? checkpointUnread : 0;
            db.prepare(`INSERT INTO ws_conversations(id,account_id,external_id,title,customer_id,last_message_text,intent_level,data_json,created_at,updated_at,last_message_at,unread_count,language)
              VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`)
            .run(id, accountId, externalKey, wsText(checkpoint.displayName, 200) || externalKey, '', initialText, '', JSON.stringify(checkpointData), now, now, initialAt, initialUnread, '');
            conversation = db.prepare('SELECT * FROM ws_conversations WHERE id=? AND account_id=?').get(id, accountId);
          } else {
            const mergedData = { ...wsJson(conversation.data_json, {}), ...checkpointData };
            const currentText = wsText(conversation.last_message_text, 4000);
            const nextText = last?.originalText
              ? last.originalText.slice(0, 4000)
              : (hasCheckpointPreview && (previousWasPreviewOnly || !currentText) ? checkpointPreview : currentText);
            const currentAt = wsText(conversation.last_message_at, 80);
            const nextAt = last?.sentAt || (hasCheckpointLastAt && (previousWasPreviewOnly || !currentAt) ? checkpointLastAt : currentAt);
            const nextUnread = hasCheckpointUnread ? checkpointUnread : Number(conversation.unread_count || 0);
            const title = wsText(checkpoint.displayName, 200) || conversation.title || externalKey;
            db.prepare('UPDATE ws_conversations SET title=?,last_message_text=?,last_message_at=?,unread_count=?,data_json=?,updated_at=? WHERE id=? AND account_id=?')
              .run(title, nextText, nextAt, nextUnread, JSON.stringify(mergedData), now, conversation.id, accountId);
          }
          if (checkpoint.collectionStatus === 'retryable') {
            const coverage = wsText(checkpoint.coverage, 40);
            const reason = /identity/.test(coverage) ? '打开后的聊天身份未能确认，已跳过并等待重试。' : /click/.test(coverage) ? '会话打开失败，已继续下一个客户。' : /pane/.test(coverage) ? '聊天消息区域暂时无法识别，已继续下一个客户。' : '历史聊天尚未采集完整，断点已保留。';
            db.prepare("UPDATE ws_collection_items SET status='retryable',coverage_status=?,last_error=?,updated_at=? WHERE account_id=? AND conversation_id=?").run(coverage, reason, now, accountId, conversation.id);
          }
          if (!group.messages.length && !historyLoaded) continue;
          const findCollectedMessage = item => {
            let row = item.externalId ? db.prepare('SELECT * FROM ws_messages WHERE account_id=? AND conversation_id=? AND external_id=?').get(accountId, conversation.id, item.externalId) : null;
            let allowLegacyAlias = false;
            if (!row && item.legacyExternalMessageId && item.legacyExternalMessageId !== item.externalId) {
              const candidate = db.prepare('SELECT * FROM ws_messages WHERE account_id=? AND conversation_id=? AND external_id=?').get(accountId, conversation.id, item.legacyExternalMessageId);
              if (wsCanRepairCollectedMessageDirection(candidate, item, true)) { row = candidate; allowLegacyAlias = true; }
            }
            if (!row && item.externalId) {
              // A v3 packet may already be in the durable queue when v4
              // changes the exact same row to its canonical native id. Resolve
              // only the recorded alias plus byte-identical original; never
              // search by message text alone and never downgrade v4 direction.
              const candidates = db.prepare(`SELECT * FROM ws_messages
                WHERE account_id=? AND conversation_id=? AND original_text=?
                  AND json_extract(data_json,'$.legacyExternalMessageId')=?`).all(accountId, conversation.id, item.originalText, item.externalId);
              if (candidates.length === 1) {
                const data = wsJson(candidates[0].data_json);
                if (data.source === 'ws-webview2' && Number(data.directionVersion || 0) >= 4
                    && wsText(data.canonicalExternalMessageId, 200) === wsText(candidates[0].external_id, 200)) row = candidates[0];
              }
            }
            return { row, allowLegacyAlias };
          };
          const fingerprint = wsBatchFingerprint(conversation.id, group.messages, '');
          const previous = db.prepare('SELECT * FROM ws_ingest_batches WHERE account_id=? AND conversation_id=? AND fingerprint=?').get(accountId, conversation.id, fingerprint);
          if (previous) {
            deduplicated += group.messages.length;
            for (const item of group.messages) {
              const found = findCollectedMessage(item);
              let existing = found.row;
              const directionRepaired = wsRepairCollectedMessageDirection(existing, item, now, found.allowLegacyAlias);
              if (directionRepaired) { existing = directionRepaired; repairedDirections += 1; }
              if (wsRepairCollectedMessageTime(existing, item, now)) repairedTimestamps += 1;
            }
            const previousIds = wsJson(previous.message_ids_json, []);
            for (const id of previousIds) messageIds.push(String(id));
            // A retried final packet still needs to finalize the checkpoint.
          }
          const batchId = previous?.id || wsCreateId('wsb');
          let batchInserted = 0;
          if (!previous && group.messages.length) db.prepare('INSERT INTO ws_ingest_batches(id,account_id,conversation_id,fingerprint,message_count,inserted_count,message_ids_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)')
            .run(batchId, accountId, conversation.id, fingerprint, group.messages.length, 0, '[]', now, now);
          const ids = [];
          for (const item of (previous ? [] : group.messages)) {
            const found = findCollectedMessage(item);
            let row = found.row;
            if (row) {
              const directionRepaired = wsRepairCollectedMessageDirection(row, item, now, found.allowLegacyAlias);
              if (directionRepaired) { row = directionRepaired; repairedDirections += 1; }
              const repaired = wsRepairCollectedMessageTime(row, item, now);
              if (repaired) { row = repaired; repairedTimestamps += 1; }
              deduplicated += 1;
              ids.push(row.id);
              messageIds.push(row.id);
              continue;
            }
            const id = wsCreateId('wsm');
            db.prepare(`INSERT INTO ws_messages(id,account_id,conversation_id,external_id,direction,original_text,translated_text,source_language,target_language,order_no,data_json,created_at,updated_at,translation_status,translation_error,translation_attempts,last_attempt_at)
              VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
              .run(id, accountId, conversation.id, item.externalId, item.direction, item.originalText, '', '', '', item.order, JSON.stringify(item.data), item.createdAt, now, 'none', '', 0, '');
            ids.push(id);
            messageIds.push(id);
            accepted += 1;
            batchInserted += 1;
          }
          if (!previous && group.messages.length) db.prepare('UPDATE ws_ingest_batches SET inserted_count=?,message_ids_json=?,updated_at=? WHERE id=? AND account_id=?')
            .run(batchInserted, JSON.stringify(ids), now, batchId, accountId);
          if (last && batchInserted > 0) {
            const nextUnread = hasCheckpointUnread ? checkpointUnread : Number(conversation.unread_count || 0);
            const currentConversation = db.prepare('SELECT last_message_at FROM ws_conversations WHERE id=? AND account_id=?').get(conversation.id, accountId);
            const lastMessageAt = last.sentAt || currentConversation?.last_message_at || '';
            db.prepare('UPDATE ws_conversations SET last_message_text=?,last_message_at=?,unread_count=?,updated_at=? WHERE id=? AND account_id=?')
              .run(last.originalText.slice(0, 4000), lastMessageAt, nextUnread, now, conversation.id, accountId);
          }
          if (historyLoaded) {
            const storedCount = Number(db.prepare("SELECT count(*) count FROM ws_messages WHERE account_id=? AND conversation_id=? AND COALESCE(json_extract(data_json,'$.previewOnly'),0)<>1").get(accountId, conversation.id).count || 0);
            if (storedCount >= historyMessageCount) {
              if (checkpointDirectionVersion >= 4) {
                const unverifiedDirectionCount = Number(db.prepare(`SELECT COUNT(*) count FROM ws_messages
                  WHERE account_id=? AND conversation_id=?
                    AND COALESCE(json_extract(data_json,'$.previewOnly'),0)<>1
                    AND json_extract(data_json,'$.source')='ws-webview2'
                    AND (COALESCE(json_extract(data_json,'$.directionVersion'),0)<4
                      OR COALESCE(json_extract(data_json,'$.directionSource'),'') NOT IN ('class-message-out','class-message-in','data-id-outgoing','data-id-incoming','icon-tail-out','icon-tail-in','palette-outgoing','palette-incoming')
                      OR (direction='send' AND json_extract(data_json,'$.directionSource') NOT IN ('class-message-out','data-id-outgoing','icon-tail-out','palette-outgoing'))
                      OR (direction='receive' AND json_extract(data_json,'$.directionSource') NOT IN ('class-message-in','data-id-incoming','icon-tail-in','palette-incoming')))`).get(accountId, conversation.id).count || 0);
                if (directionUnresolvedCount > 0 || unverifiedDirectionCount > 0) {
                  const saved = db.prepare('SELECT data_json FROM ws_conversations WHERE id=? AND account_id=?').get(conversation.id, accountId);
                  const data = {
                    ...wsJson(saved.data_json, {}),
                    historyLoaded: false,
                    historyStale: true,
                    directionCaptureVersion: checkpointDirectionVersion,
                    directionUnresolvedCount: directionUnresolvedCount + unverifiedDirectionCount,
                    coverage: 'read-history-direction-unresolved',
                  };
                  db.prepare('UPDATE ws_conversations SET data_json=?,updated_at=? WHERE id=? AND account_id=?').run(JSON.stringify(data), now, conversation.id, accountId);
                  db.prepare("UPDATE ws_collection_items SET status='retryable',analysis_status='pending',coverage_status='read-history-direction-unresolved',last_error='消息方向尚未全部验证，已保留原文并等待安全重采。',updated_at=? WHERE account_id=? AND conversation_id=?").run(now, accountId, conversation.id);
                  continue;
                }
              }
              const historyFingerprint = wsAuthoritativeHistoryFingerprint(accountId, conversation.id);
              // A resumable re-scan temporarily marks the conversation as
              // collecting.  That state transition is not a transcript
              // change: only the final authoritative content hash may
              // invalidate completed AI work.  The empty previous hash still
              // identifies the first confirmed snapshot.
              const historyAdvanced = !previousHistoryFingerprint || historyFingerprint !== previousHistoryFingerprint;
              const saved = db.prepare('SELECT data_json FROM ws_conversations WHERE id=? AND account_id=?').get(conversation.id, accountId);
              const data = {
                ...wsJson(saved.data_json, {}),
                historyLoaded: true,
                historyStale: false,
                historyInvalidatedAt: '',
                staleHistoryFingerprint: '',
                previewOnly: false,
                historyMessageCount: storedCount,
                historyFingerprint,
                ...(listFingerprint ? { listFingerprint } : {}),
                ...(historyFingerprint ? { lastMessageFingerprint: historyFingerprint } : {}),
                ...(checkpointDirectionVersion >= 4 ? { directionVersion: checkpointDirectionVersion, directionCaptureVersion: checkpointDirectionVersion, directionUnresolvedCount: 0 } : {}),
                coverage: 'full-history',
              };
              db.prepare('UPDATE ws_conversations SET data_json=?,updated_at=? WHERE id=? AND account_id=?').run(JSON.stringify(data), now, conversation.id, accountId);
              if (historyAdvanced) {
                db.prepare("UPDATE ws_collection_items SET status='queued',analysis_status='pending',coverage_status='full-history',last_error='',checkpoint=?,updated_at=? WHERE account_id=? AND conversation_id=?").run(`full-history:${storedCount}:${historyFingerprint}`, now, accountId, conversation.id);
                supersedeStaleAiJobs(accountId, conversation.id, historyFingerprint, now);
              }
            }
          }
        }
        db.exec('COMMIT');
      } catch (error) {
        try { db.exec('ROLLBACK'); } catch {}
        throw error;
      }
      return json(res, 200, { accepted, deduplicated, repairedTimestamps, repairedDirections, messageIds, processedAt: new Date().toISOString() });
    }
    if (url.pathname === '/api/ws/settings') {
      const conversationId = wsText(url.searchParams.get('conversationId'), 160);
      const accountId = wsAccountId(url.searchParams.get('accountId'));
      wsRequireAccount(accountId);
      if (!conversationId) return json(res, 400, { error: 'WS 设置缺少会话编号。' });
      if (req.method === 'GET') {
        const payload = wsSettingsPayload(db.prepare('SELECT * FROM ws_settings WHERE conversation_id=? AND account_id=?').get(conversationId, accountId));
        if (!payload.conversationId) payload.conversationId = conversationId;
        return json(res, 200, payload);
      }
      if (req.method === 'PUT' || req.method === 'POST') {
        const body = JSON.parse((await readBody(req, 256 * 1024)).toString('utf8'));
        const scopedAccountId = wsAccountId(body.accountId || accountId);
        wsRequireConversation(conversationId, scopedAccountId);
        const existingSettings = db.prepare('SELECT account_id FROM ws_settings WHERE conversation_id=?').get(conversationId);
        if (existingSettings && String(existingSettings.account_id || 'default') !== scopedAccountId) return json(res, 409, { error: '该 WS 会话设置已属于另一个账号，请先切换到对应账号。' });
        const now = new Date().toISOString();
        const status = WS_STATUSES.has(wsText(body.status, 32)) ? wsText(body.status, 32) : '未连接';
        db.prepare(`INSERT INTO ws_settings(conversation_id,account_id,enabled,receive_enabled,send_enabled,target_language,send_language,show_original,ai_enabled,status,created_at,updated_at)
          VALUES(?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(conversation_id) DO UPDATE SET account_id=excluded.account_id,enabled=excluded.enabled,receive_enabled=excluded.receive_enabled,send_enabled=excluded.send_enabled,target_language=excluded.target_language,send_language=excluded.send_language,show_original=excluded.show_original,ai_enabled=excluded.ai_enabled,status=excluded.status,updated_at=excluded.updated_at`)
          .run(conversationId, scopedAccountId, body.enabled === false ? 0 : 1, body.receive === false ? 0 : 1, body.send === false ? 0 : 1, wsText(body.targetLanguage, 40) || '中文', wsText(body.sendLanguage, 40), body.showOriginal === false ? 0 : 1, body.aiEnabled === false ? 0 : 1, status, now, now);
        return json(res, 200, wsSettingsPayload(db.prepare('SELECT * FROM ws_settings WHERE conversation_id=? AND account_id=?').get(conversationId, scopedAccountId)));
      }
      return json(res, 405, { error: 'WS 设置只支持 GET/PUT。' });
    }
    if (url.pathname === '/api/ws/conversations') {
      if (req.method === 'GET') {
        const accountId = wsAccountId(url.searchParams.get('accountId'));
        wsRequireAccount(accountId);
        // Keep every response bounded while allowing the desktop workbench to
        // walk an account of any size.  The stable (updated_at,id) keyset avoids
        // offset drift when real-time messages update rows during pagination.
        const limit = Math.min(1000, Math.max(1, Number(url.searchParams.get('limit')) || 200));
        const suppliedCursor = url.searchParams.get('cursor');
        const cursor = wsDecodeConversationCursor(suppliedCursor);
        if (suppliedCursor && !cursor) return json(res, 400, { error: 'WS 会话分页游标无效。' });
        const rows = cursor
          ? db.prepare(`SELECT * FROM ws_conversations WHERE account_id=? AND (updated_at<? OR (updated_at=? AND id<?)) ORDER BY updated_at DESC,id DESC LIMIT ${limit + 1}`).all(accountId, cursor.updatedAt, cursor.updatedAt, cursor.id)
          : db.prepare(`SELECT * FROM ws_conversations WHERE account_id=? ORDER BY updated_at DESC,id DESC LIMIT ${limit + 1}`).all(accountId);
        const scanned = rows.slice(0, limit);
        const excludedRows = scanned.filter(wsIsExcludedGroup);
        const nextCursor = rows.length > limit && scanned.length ? wsConversationCursor(scanned.at(-1)) : '';
        return json(res, 200, {
          conversations: scanned.filter(row => !wsIsExcludedGroup(row)).map(wsConversationPayload),
          excludedConversationIds: excludedRows.map(row => row.id),
          scannedNewest: scanned.length ? { updatedAt: scanned[0].updated_at, id: scanned[0].id } : null,
          scannedThrough: scanned.length ? { updatedAt: scanned.at(-1).updated_at, id: scanned.at(-1).id } : null,
          nextCursor,
          hasMore: Boolean(nextCursor),
        });
      }
      if (req.method === 'POST') {
        const body = JSON.parse((await readBody(req, 512 * 1024)).toString('utf8'));
        const accountId = wsAccountId(body.accountId);
        wsRequireAccount(accountId);
        const externalId = wsText(body.externalId, 160);
        if (!externalId) return json(res, 400, { error: 'WS 会话缺少外部会话标识。' });
        const now = new Date().toISOString();
        const existing = db.prepare('SELECT * FROM ws_conversations WHERE account_id=? AND external_id=?').get(accountId, externalId);
        const hasTypeDirective = ['conversationType','isGroup','vipGroup'].some(key => Object.hasOwn(body, key))
          || (body.data && typeof body.data === 'object' && ['conversationType','isGroup','vipGroup'].some(key => Object.hasOwn(body.data, key)));
        const requestedType = existing && wsIsVipGroup(existing) && !hasTypeDirective ? 'vip_group' : wsCore.conversationType(body);
        if (requestedType === 'group') throw wsConversationPolicyError('WS_GROUP_EXCLUDED', '普通群聊未列入 VIP 白名单，不保存群聊导入。');
        const effectiveType = requestedType === 'unknown' && existing ? wsCore.conversationType(existing) : requestedType;
        if (existing) {
          const customerId = effectiveType === 'vip_group' ? '' : (wsText(body.customerId, 128) || existing.customer_id);
          const lastMessageText = Object.hasOwn(body, 'lastMessageText') ? wsText(body.lastMessageText, 4000) : existing.last_message_text;
          const previousData = wsJson(existing.data_json, {});
          const data = { ...previousData, ...(Object.hasOwn(body, 'data') ? wsObject(body.data, 32 * 1024) : {}), ...(effectiveType === 'direct' ? {conversationType:'direct',isGroup:false,vipGroup:false} : {}), ...(effectiveType === 'vip_group' ? {conversationType:'vip_group',isGroup:true,vipGroup:true} : {}) };
          const requestedBindingSource = wsText(body.bindingSource || body.customerBindingSource || body.data?.customerBindingSource, 40).toLowerCase();
          // The current desktop customer editor posts the known conversation
          // id when the operator explicitly saves a customer link. Preserve
          // that compatibility while requiring an unambiguous marker for new
          // API consumers. Background discovery/phone matching never sends
          // the conversation id and therefore cannot silently become manual.
          const explicitManualBinding = Boolean(wsText(body.customerId, 128)) && (
            requestedBindingSource === 'manual'
            || (wsText(body.id, 160) === existing.id && !Object.hasOwn(body, 'data'))
          );
          if (explicitManualBinding) Object.assign(data, { customerMatch:'manual', customerBindingSource:'manual', customerBindingVerifiedAt:now });
          else if (previousData.customerBindingSource === 'manual' && previousData.customerMatch === 'manual') {
            Object.assign(data, { customerMatch:'manual', customerBindingSource:'manual', customerBindingVerifiedAt:previousData.customerBindingVerifiedAt || existing.updated_at || now });
          }
          if (body.data?.previewOnly && previousData.historyLoaded) Object.assign(data, { historyLoaded: true, previewOnly: false });
          const title = Object.hasOwn(body, 'title') ? wsCanonicalListPreviewTitle(body.title, lastMessageText, data) : existing.title;
          const lastMessageAt = Object.hasOwn(body, 'lastMessageAt') ? wsIso(body.lastMessageAt) : existing.last_message_at;
          const unreadCount = Object.hasOwn(body, 'unreadCount') ? Math.max(0, Math.floor(Number(body.unreadCount) || 0)) : Number(existing.unread_count || 0);
          const language = Object.hasOwn(body, 'language') ? wsText(body.language, 40) : existing.language;
          const intentLevel = Object.hasOwn(body, 'intentLevel') ? wsText(body.intentLevel, 40) : existing.intent_level;
          db.prepare('UPDATE ws_conversations SET title=?,customer_id=?,last_message_text=?,last_message_at=?,unread_count=?,language=?,intent_level=?,data_json=?,updated_at=? WHERE id=? AND account_id=?')
            .run(title, customerId, lastMessageText, lastMessageAt, unreadCount, language, intentLevel, JSON.stringify(data), now, existing.id, accountId);
        } else {
          const id = wsText(body.id, 160) || wsCreateId('wsc');
          const lastMessageText = wsText(body.lastMessageText, 4000);
          const lastMessageAt = Object.hasOwn(body, 'lastMessageAt') ? wsIso(body.lastMessageAt) : (lastMessageText ? now : '');
          const data = { ...wsObject(body.data, 32 * 1024), ...(requestedType === 'direct' ? {conversationType:'direct',isGroup:false,vipGroup:false} : {}), ...(requestedType === 'vip_group' ? {conversationType:'vip_group',isGroup:true,vipGroup:true} : {}) };
          const requestedBindingSource = wsText(body.bindingSource || body.customerBindingSource || body.data?.customerBindingSource, 40).toLowerCase();
          if (wsText(body.customerId, 128) && requestedBindingSource === 'manual') Object.assign(data, { customerMatch:'manual', customerBindingSource:'manual', customerBindingVerifiedAt:now });
          db.prepare(`INSERT INTO ws_conversations(id,account_id,external_id,title,customer_id,last_message_text,intent_level,data_json,created_at,updated_at,last_message_at,unread_count,language)
            VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`)
            .run(id, accountId, externalId, wsCanonicalListPreviewTitle(body.title, lastMessageText, data), requestedType === 'vip_group' ? '' : wsText(body.customerId, 128), lastMessageText, wsText(body.intentLevel, 40), JSON.stringify(data), now, now, lastMessageAt, Math.max(0, Math.floor(Number(body.unreadCount) || 0)), wsText(body.language, 40));
        }
        const row = db.prepare('SELECT * FROM ws_conversations WHERE account_id=? AND external_id=?').get(accountId, externalId);
        return json(res, 200, wsConversationPayload(row));
      }
      return json(res, 405, { error: 'WS 会话只支持 GET/POST。' });
    }
    if (url.pathname === '/api/ws/messages/batch' && req.method === 'POST') {
      const body = JSON.parse((await readBody(req, WS_MESSAGE_BATCH_MAX_BYTES)).toString('utf8'));
      const conversationId = wsText(body.conversationId, 160);
      const accountId = wsAccountId(body.accountId);
      wsRequireConversation(conversationId, accountId);
      if (!Array.isArray(body.messages) || !body.messages.length) return json(res, 400, { error: 'WS 批次没有可保存的消息。' });
      if (body.messages.length > 500) return json(res, 413, { error: '单次最多保存 500 条 WS 消息，请拆分批次。' });
      const messages = body.messages;
      for (const item of messages) {
        if (item && typeof item === 'object' && wsMessageTextTooLong(item.originalText)) return json(res, 413, { error: `WS 原文超过 ${WS_MESSAGE_MAX_CHARS} 字符，未保存且原值未修改。` });
        if (!item || typeof item !== 'object' || !WS_DIRECTIONS.has(wsText(item.direction, 16)) || !wsMessageText(item.originalText).trim()) return json(res, 400, { error: 'WS 批次包含无效的消息方向或空原文。' });
      }
      const fingerprint = wsBatchFingerprint(conversationId, messages, body.fingerprint || body.batchFingerprint || body.idempotencyKey);
      const previous = db.prepare('SELECT * FROM ws_ingest_batches WHERE account_id=? AND conversation_id=? AND fingerprint=?').get(accountId, conversationId, fingerprint);
      if (previous) {
        if (Number(previous.message_count) !== messages.length) return json(res, 409, { error: '该批次指纹已用于不同数量的消息，请生成新的批次指纹。' });
        const ids = wsJson(previous.message_ids_json, []);
        let updated = 0;
        const rows = ids.map((id, index) => {
          let row = db.prepare('SELECT * FROM ws_messages WHERE id=? AND account_id=?').get(String(id), accountId);
          const item = messages[index], data = wsObject(item?.data, 32 * 1024);
          const canonical = wsListPreviewOriginal(item, data);
          if (row && canonical && canonical !== row.original_text) {
            db.prepare('UPDATE ws_messages SET original_text=?,updated_at=? WHERE id=? AND account_id=?').run(canonical, new Date().toISOString(), row.id, accountId);
            row = db.prepare('SELECT * FROM ws_messages WHERE id=? AND account_id=?').get(row.id, accountId);
            updated += 1;
          }
          return row;
        }).filter(Boolean).map(wsMessagePayload);
        // A repeated idempotency batch must still repair the conversation summary.
        // The message row is intentionally not duplicated, but older builds could
        // leave last_message_text at the contact name after the first discovery.
        // Keep this update side-effect free for unread counts and timestamps.
        if (rows.length) {
          const latestText = rows.at(-1).originalText.slice(0, 4000);
          const currentConversation = db.prepare('SELECT last_message_text FROM ws_conversations WHERE id=? AND account_id=?').get(conversationId, accountId);
          // Repeated list scans are expected. Avoid rewriting the conversation
          // row when the preview did not change, otherwise every poll changes
          // updated_at and makes large accounts look perpetually dirty.
          if (String(currentConversation?.last_message_text || '') !== latestText) db.prepare('UPDATE ws_conversations SET last_message_text=?,updated_at=? WHERE id=? AND account_id=?').run(latestText, new Date().toISOString(), conversationId, accountId);
        }
        return json(res, 200, { batch: wsBatchPayload(previous), inserted: 0, updated, existed: rows.length, messages: rows, repeated: true });
      }
      const now = new Date().toISOString(), batchId = wsCreateId('wsb'), messageIds = [], resultRows = [];
      let inserted = 0, updated = 0, existed = 0, unreadAdded = 0;
      db.exec('BEGIN IMMEDIATE');
      try {
        db.prepare('INSERT INTO ws_ingest_batches(id,account_id,conversation_id,fingerprint,message_count,inserted_count,message_ids_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)')
          .run(batchId, accountId, conversationId, fingerprint, messages.length, 0, '[]', now, now);
        for (let index = 0; index < messages.length; index++) {
          const item = messages[index], externalId = wsText(item.externalId, 200);
          const rawData = wsObject(item.data, 32 * 1024);
          const previewOnly = rawData?.source === 'ws-list-preview' && rawData?.previewOnly === true;
          let row = externalId ? db.prepare('SELECT * FROM ws_messages WHERE account_id=? AND conversation_id=? AND external_id=?').get(accountId, conversationId, externalId) : null;
          let wasUpdated = false;
          if (!row && previewOnly) {
            row = db.prepare("SELECT * FROM ws_messages WHERE account_id=? AND conversation_id=? AND json_extract(data_json,'$.source')='ws-list-preview' ORDER BY updated_at DESC,created_at DESC LIMIT 1").get(accountId, conversationId);
            if (row) {
              const originalText = wsListPreviewOriginal(item, rawData), direction = wsText(item.direction, 16), translation = wsTranslationFields(item), nowUpdated = new Date().toISOString();
              const data = { ...rawData, ingestBatchId: batchId };
              db.prepare('UPDATE ws_messages SET external_id=?,direction=?,original_text=?,translated_text=?,source_language=?,target_language=?,order_no=?,data_json=?,updated_at=?,translation_status=?,translation_error=?,translation_attempts=?,last_attempt_at=? WHERE id=? AND account_id=?')
                .run(externalId, direction, originalText, translation.translatedText, wsText(item.sourceLanguage, 40), wsText(item.targetLanguage, 40), Number.isFinite(Number(item.order)) ? Number(item.order) : index + 1, JSON.stringify(data), nowUpdated, translation.translationStatus, translation.translationError, translation.translationAttempts, translation.lastAttemptAt, row.id, accountId);
              row = db.prepare('SELECT * FROM ws_messages WHERE id=? AND account_id=?').get(row.id, accountId);
              updated += 1;
              wasUpdated = true;
            }
          }
          if (row) {
            if (!wasUpdated) existed += 1;
          } else {
            const id = wsText(item.id, 160) || wsCreateId('wsm');
            const originalText = wsListPreviewOriginal(item, rawData), direction = wsText(item.direction, 16);
            const translation = wsTranslationFields(item);
            const createdAt = item.createdAt ? wsIso(item.createdAt) : now;
            const data = { ...rawData, ingestBatchId: batchId };
            db.prepare(`INSERT INTO ws_messages(id,account_id,conversation_id,external_id,direction,original_text,translated_text,source_language,target_language,order_no,data_json,created_at,updated_at,translation_status,translation_error,translation_attempts,last_attempt_at)
              VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(id, accountId, conversationId, externalId, direction, originalText, translation.translatedText, wsText(item.sourceLanguage, 40), wsText(item.targetLanguage, 40), Number.isFinite(Number(item.order)) ? Number(item.order) : index + 1, JSON.stringify(data), createdAt, now, translation.translationStatus, translation.translationError, translation.translationAttempts, translation.lastAttemptAt);
            row = db.prepare('SELECT * FROM ws_messages WHERE id=? AND account_id=?').get(id, accountId);
            inserted += 1;
            if (direction === 'receive') unreadAdded += 1;
          }
          messageIds.push(row.id);
          resultRows.push(wsMessagePayload(row));
        }
        const last = resultRows.at(-1);
        if (last) {
          const existingConversation = db.prepare('SELECT title,data_json FROM ws_conversations WHERE id=? AND account_id=?').get(conversationId, accountId);
          const data = wsJson(existingConversation?.data_json, {});
          const title = wsCanonicalListPreviewTitle(existingConversation?.title || '', last.originalText, { ...data, previewOnly: data.previewOnly || data.discovery === 'visible-page' });
          db.prepare('UPDATE ws_conversations SET title=?,last_message_text=?,last_message_at=?,unread_count=unread_count+?,updated_at=? WHERE id=? AND account_id=?')
            .run(title, last.originalText.slice(0, 4000), last.createdAt || now, unreadAdded, now, conversationId, accountId);
        }
        db.prepare('UPDATE ws_ingest_batches SET inserted_count=?,message_ids_json=?,updated_at=? WHERE id=? AND account_id=?').run(inserted, JSON.stringify(messageIds), now, batchId, accountId);
        db.exec('COMMIT');
      } catch (error) { db.exec('ROLLBACK'); throw error; }
      const batch = db.prepare('SELECT * FROM ws_ingest_batches WHERE id=? AND account_id=?').get(batchId, accountId);
      return json(res, 200, { batch: wsBatchPayload(batch), inserted, updated, existed, messages: resultRows, repeated: false });
    }
    if (url.pathname === '/api/ws/messages') {
      if (req.method === 'GET') {
        const conversationId = wsText(url.searchParams.get('conversationId'), 160);
        const accountId = wsAccountId(url.searchParams.get('accountId'));
        if (!conversationId) return json(res, 400, { error: '读取 WS 消息缺少会话编号。' });
        const limit = Math.min(1000, Math.max(1, Number(url.searchParams.get('limit')) || 500));
        const offset = Math.max(0, Math.floor(Number(url.searchParams.get('offset')) || 0));
        wsRequireConversation(conversationId, accountId);
        const total = Number(db.prepare('SELECT COUNT(*) AS count FROM ws_messages WHERE account_id=? AND conversation_id=?').get(accountId, conversationId)?.count || 0);
        const rows = db.prepare('SELECT * FROM ws_messages WHERE account_id=? AND conversation_id=? ORDER BY order_no ASC,created_at ASC,id ASC LIMIT ? OFFSET ?').all(accountId, conversationId, limit, offset);
        return json(res, 200, { messages: rows.map(wsMessagePayload), total, limit, offset, hasMore: offset + rows.length < total });
      }
      if (req.method === 'POST') {
        const body = JSON.parse((await readBody(req, 2 * 1024 * 1024)).toString('utf8'));
        const conversationId = wsText(body.conversationId, 160);
        const accountId = wsAccountId(body.accountId);
        wsRequireConversation(conversationId, accountId);
        const externalId = wsText(body.externalId, 200);
        const id = wsText(body.id, 160) || wsCreateId('wsm');
        if (!WS_DIRECTIONS.has(wsText(body.direction, 16))) return json(res, 400, { error: 'WS 消息方向无效。' });
        const direction = wsText(body.direction, 16);
        if (wsMessageTextTooLong(body.originalText)) return json(res, 413, { error: `WS 原文超过 ${WS_MESSAGE_MAX_CHARS} 字符，未保存且原值未修改。` });
        const originalText = wsMessageText(body.originalText);
        if (!originalText.trim()) return json(res, 400, { error: 'WS 原文不能为空。' });
        if (externalId) {
          const existing = db.prepare('SELECT * FROM ws_messages WHERE account_id=? AND conversation_id=? AND external_id=?').get(accountId, conversationId, externalId);
          if (existing) {
            const hasTranslationUpdate = ['translatedText','targetLanguage','sourceLanguage','translationStatus','translationError','translationAttempts','lastAttemptAt'].some(key => Object.hasOwn(body, key));
            if (hasTranslationUpdate) {
              const translation = wsTranslationFields(body, existing), updatedAt = new Date().toISOString();
              db.prepare('UPDATE ws_messages SET translated_text=?,source_language=?,target_language=?,translation_status=?,translation_error=?,translation_attempts=?,last_attempt_at=?,updated_at=? WHERE id=? AND account_id=?')
                .run(translation.translatedText, Object.hasOwn(body, 'sourceLanguage') ? wsText(body.sourceLanguage, 40) : existing.source_language, Object.hasOwn(body, 'targetLanguage') ? wsText(body.targetLanguage, 40) : existing.target_language, translation.translationStatus, translation.translationError, translation.translationAttempts, translation.lastAttemptAt, updatedAt, existing.id, accountId);
              return json(res, 200, { ...wsMessagePayload(db.prepare('SELECT * FROM ws_messages WHERE id=? AND account_id=?').get(existing.id, accountId)), existed: true, updated: true });
            }
            return json(res, 200, { ...wsMessagePayload(existing), existed: true });
          }
        }
        const now = new Date().toISOString();
        const data = wsObject(body.data, 32 * 1024);
        const translation = wsTranslationFields(body);
        db.exec('BEGIN IMMEDIATE');
        try {
          db.prepare(`INSERT INTO ws_messages(id,account_id,conversation_id,external_id,direction,original_text,translated_text,source_language,target_language,order_no,data_json,created_at,updated_at,translation_status,translation_error,translation_attempts,last_attempt_at)
            VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(id, accountId, conversationId, externalId, direction, originalText, translation.translatedText, wsText(body.sourceLanguage, 40), wsText(body.targetLanguage, 40), Number.isFinite(Number(body.order)) ? Number(body.order) : 0, JSON.stringify(data), now, now, translation.translationStatus, translation.translationError, translation.translationAttempts, translation.lastAttemptAt);
          db.prepare('UPDATE ws_conversations SET last_message_text=?,last_message_at=?,unread_count=unread_count+?,updated_at=? WHERE id=? AND account_id=?').run(originalText.slice(0, 4000), now, direction === 'receive' ? 1 : 0, now, conversationId, accountId);
          db.exec('COMMIT');
        } catch (error) { db.exec('ROLLBACK'); throw error; }
        return json(res, 200, { ...wsMessagePayload(db.prepare('SELECT * FROM ws_messages WHERE id=? AND account_id=?').get(id, accountId)), existed: false });
      }
      return json(res, 405, { error: 'WS 消息只支持 GET/POST。' });
    }
    if (url.pathname === '/api/ws/ai-jobs') {
      const body = req.method === 'POST' ? JSON.parse((await readBody(req, 256 * 1024)).toString('utf8') || '{}') : {};
      const accountId = wsAccountId(body.accountId || url.searchParams.get('accountId'));
      wsRequireAccount(accountId);
      const leaseExpiredAt = new Date(Date.now() - 10 * 60 * 1000).toISOString();
      db.prepare("UPDATE ai_jobs SET status=CASE WHEN attempts>=max_attempts THEN 'failed' ELSE 'retryable' END,locked_at='',next_attempt_at=?,last_error='上次分析中断，已恢复队列',updated_at=? WHERE account_id=? AND status='running' AND (locked_at='' OR locked_at<?)").run(new Date().toISOString(), new Date().toISOString(), accountId, leaseExpiredAt);
      if (req.method === 'GET') {
        const conversationId = wsText(url.searchParams.get('conversationId'), 160);
        const statuses = String(url.searchParams.get('status') || '').split(',').map(value => wsText(value, 24)).filter(value => AI_JOB_STATUSES.has(value));
        const limit = Math.min(200, Math.max(1, Number(url.searchParams.get('limit')) || 50));
        const where = ['account_id=?'];
        const params = [accountId];
        if (conversationId) { where.push('conversation_id=?'); params.push(conversationId); }
        if (statuses.length) { where.push(`status IN (${statuses.map(() => '?').join(',')})`); params.push(...statuses); }
        if (statuses.length && statuses.every(status => ['queued', 'retryable'].includes(status))) { where.push("(next_attempt_at='' OR next_attempt_at<=?)"); params.push(new Date().toISOString()); }
        const rows = db.prepare(`SELECT * FROM ai_jobs WHERE ${where.join(' AND ')} ORDER BY created_at ASC,id ASC LIMIT ${limit}`).all(...params);
        return json(res, 200, { jobs: rows.filter(row => wsAiEligible(row.conversation_id, accountId)).map(aiJobPayload), stats: aiJobStats(accountId), generatedAt: new Date().toISOString() });
      }
      if (req.method !== 'POST') return json(res, 405, { error: 'AI 队列只支持 GET/POST。' });
      const action = wsText(body.action || 'enqueue', 24) || 'enqueue';
      const now = new Date().toISOString();
      if (action === 'enqueue') {
        const conversationId = wsText(body.conversationId, 160);
        const idempotencyKey = wsText(body.idempotencyKey, 320);
        if (!conversationId || !idempotencyKey) return json(res, 400, { error: 'AI 入队缺少会话编号或幂等键。' });
        wsRequireAiConversation(conversationId, accountId);
        const existing = db.prepare('SELECT * FROM ai_jobs WHERE account_id=? AND idempotency_key=?').get(accountId, idempotencyKey);
        if (existing) return json(res, 200, { job: aiJobPayload(existing), existed: true, stats: aiJobStats(accountId) });
        const id = wsText(body.id, 160) || wsCreateId('aij');
        const maxAttempts = Math.min(10, Math.max(1, Math.floor(Number(body.maxAttempts) || 5)));
        const payload = wsObject(body.payload, 128 * 1024);
        db.prepare('INSERT INTO ai_jobs(id,account_id,conversation_id,idempotency_key,payload_json,status,attempts,max_attempts,next_attempt_at,locked_at,last_error,analysis_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
          .run(id, accountId, conversationId, idempotencyKey, JSON.stringify(payload), 'queued', 0, maxAttempts, now, '', '', '', now, now);
        return json(res, 201, { job: aiJobPayload(db.prepare('SELECT * FROM ai_jobs WHERE id=? AND account_id=?').get(id, accountId)), existed: false, stats: aiJobStats(accountId) });
      }
      const jobId = wsText(body.jobId || body.id, 160);
      if (!jobId) return json(res, 400, { error: 'AI 队列操作缺少任务编号。' });
      const existing = db.prepare('SELECT * FROM ai_jobs WHERE id=? AND account_id=?').get(jobId, accountId);
      if (!existing) return json(res, 404, { error: 'AI 队列任务不存在。' });
      wsRequireAiConversation(existing.conversation_id, accountId);
      if (action === 'claim') {
        const eligible = ['queued', 'retryable'].includes(existing.status) && (!existing.next_attempt_at || existing.next_attempt_at <= now);
        if (!eligible) return json(res, 200, { claimed: false, job: aiJobPayload(existing), stats: aiJobStats(accountId) });
        const attempts = Number(existing.attempts || 0) + 1;
        if (attempts > Number(existing.max_attempts || 5)) {
          db.prepare("UPDATE ai_jobs SET status='failed',updated_at=?,last_error=CASE WHEN last_error='' THEN '超过最大重试次数' ELSE last_error END WHERE id=? AND account_id=?").run(now, jobId, accountId);
          const failed = db.prepare('SELECT * FROM ai_jobs WHERE id=? AND account_id=?').get(jobId, accountId);
          return json(res, 200, { claimed: false, job: aiJobPayload(failed), stats: aiJobStats(accountId) });
        }
        const claimed = db.prepare("UPDATE ai_jobs SET status='running',attempts=?,locked_at=?,updated_at=?,last_error='' WHERE id=? AND account_id=? AND status IN ('queued','retryable') AND (next_attempt_at='' OR next_attempt_at<=?)").run(attempts, now, now, jobId, accountId, now);
        const row = db.prepare('SELECT * FROM ai_jobs WHERE id=? AND account_id=?').get(jobId, accountId);
        return json(res, 200, { claimed: Number(claimed?.changes || 0) > 0, job: aiJobPayload(row), stats: aiJobStats(accountId) });
      }
      if (action === 'checkpoint') {
        if (existing.status !== 'running') return json(res, 409, { error: 'AI 任务未在运行，分段进度未保存。' });
        const completedChunks = Math.max(0, Math.floor(Number(body.completedChunks) || 0));
        const chunkCount = Math.max(1, Math.floor(Number(body.chunkCount) || 1));
        const payload = { ...wsJson(existing.payload_json, {}), checkpoint: { completedChunks, chunkCount, result: wsObject(body.result, 128 * 1024) } };
        db.prepare('UPDATE ai_jobs SET payload_json=?,locked_at=?,updated_at=? WHERE id=? AND account_id=?').run(JSON.stringify(payload), now, now, jobId, accountId);
        return json(res, 200, { ok: true, job: aiJobPayload(db.prepare('SELECT * FROM ai_jobs WHERE id=? AND account_id=?').get(jobId, accountId)) });
      }
      if (action === 'complete') {
        const analysisId = wsText(body.analysisId, 160);
        db.prepare("UPDATE ai_jobs SET status='completed',locked_at='',analysis_id=?,next_attempt_at='',last_error='',updated_at=? WHERE id=? AND account_id=? AND status IN ('queued','running','retryable','completed')").run(analysisId, now, jobId, accountId);
        const row = db.prepare('SELECT * FROM ai_jobs WHERE id=? AND account_id=?').get(jobId, accountId);
        return json(res, 200, { completed: true, job: aiJobPayload(row), stats: aiJobStats(accountId) });
      }
      if (action === 'fail') {
        const retryable = body.retryable !== false;
        const attempts = Number(existing.attempts || 0);
        const maxAttempts = Number(existing.max_attempts || 5);
        const shouldRetry = retryable && attempts < maxAttempts;
        const nextAttemptAt = shouldRetry ? new Date(Date.now() + aiJobBackoff(attempts)).toISOString() : '';
        const nextStatus = shouldRetry ? 'retryable' : 'failed';
        db.prepare('UPDATE ai_jobs SET status=?,locked_at=\'\',next_attempt_at=?,last_error=?,updated_at=? WHERE id=? AND account_id=?').run(nextStatus, nextAttemptAt, wsText(body.error || 'AI 分析失败', 1000), now, jobId, accountId);
        const row = db.prepare('SELECT * FROM ai_jobs WHERE id=? AND account_id=?').get(jobId, accountId);
        return json(res, 200, { failed: true, job: aiJobPayload(row), stats: aiJobStats(accountId) });
      }
      return json(res, 400, { error: '不支持的 AI 队列操作。' });
    }
    if (url.pathname === '/api/ws/analyses') {
      if (req.method === 'GET') {
        const conversationId = wsText(url.searchParams.get('conversationId'), 160);
        const accountId = wsAccountId(url.searchParams.get('accountId'));
        if (!conversationId) return json(res, 400, { error: '读取 WS 分析缺少会话编号。' });
        wsRequireConversation(conversationId, accountId);
        if (!wsAiEligible(conversationId, accountId)) return json(res, 200, {analysis:null, analyses:[], total:0, awaitingConversationType:true});
        const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit')) || 20));
        const offset = Math.max(0, Math.floor(Number(url.searchParams.get('offset')) || 0));
        const rows = db.prepare(`SELECT * FROM ws_ai_analyses WHERE account_id=? AND conversation_id=? ORDER BY created_at DESC,id DESC LIMIT ${limit} OFFSET ${offset}`).all(accountId, conversationId).map(wsAnalysisPayload);
        const total = Number(db.prepare('SELECT COUNT(*) AS count FROM ws_ai_analyses WHERE account_id=? AND conversation_id=?').get(accountId, conversationId).count || 0);
        return json(res, 200, { analysis: rows[0] || null, analyses: rows, total, limit, offset });
      }
      if (req.method === 'POST' || req.method === 'PUT') {
        const body = JSON.parse((await readBody(req, 1024 * 1024)).toString('utf8'));
        const conversationId = wsText(body.conversationId, 160);
        const accountId = wsAccountId(body.accountId);
        wsRequireAiConversation(conversationId, accountId);
        const result = wsObject(body.result, 128 * 1024);
        const confidence = Math.min(1, Math.max(0, Number(body.confidence ?? result.confidence) || 0));
        const now = new Date().toISOString(), id = wsCreateId('wsa');
        const jobId = wsText(body.jobId, 160);
        const linkedJob = jobId ? db.prepare('SELECT * FROM ai_jobs WHERE id=? AND account_id=? AND conversation_id=?').get(jobId, accountId, conversationId) : null;
        if (jobId && !linkedJob) return json(res, 409, { error: 'AI 分析任务不存在或会话不匹配。' });
        if (linkedJob?.analysis_id) {
          const prior = db.prepare('SELECT * FROM ws_ai_analyses WHERE id=? AND account_id=?').get(linkedJob.analysis_id, accountId);
          if (prior) return json(res, 200, { ...wsAnalysisPayload(prior), existed: true, job: aiJobPayload(linkedJob) });
        }
        const intentLevel = wsText(body.intentLevel ?? result.intentLevel ?? result.intent, 40);
        const language = wsText(body.language ?? result.language, 40);
        db.exec('BEGIN IMMEDIATE');
        try {
          db.prepare('INSERT INTO ws_ai_analyses(id,account_id,conversation_id,result_json,confidence,provider_name,model,error_message,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)').run(id, accountId, conversationId, JSON.stringify(result), confidence, wsText(body.providerName, 120), wsText(body.model, 120), wsText(body.errorMessage, 1000), now, now);
          db.prepare(`UPDATE ws_conversations SET intent_level=CASE WHEN ?<>'' THEN ? ELSE intent_level END,language=CASE WHEN ?<>'' THEN ? ELSE language END,updated_at=? WHERE id=? AND account_id=?`).run(intentLevel, intentLevel, language, language, now, conversationId, accountId);
          if (linkedJob) db.prepare("UPDATE ai_jobs SET status='completed',locked_at='',next_attempt_at='',last_error='',analysis_id=?,updated_at=? WHERE id=? AND account_id=?").run(id, now, jobId, accountId);
          db.exec('COMMIT');
        } catch (error) { db.exec('ROLLBACK'); throw error; }
        const saved = wsAnalysisPayload(db.prepare('SELECT * FROM ws_ai_analyses WHERE id=? AND account_id=?').get(id, accountId));
        return json(res, 200, { ...saved, job: linkedJob ? aiJobPayload(db.prepare('SELECT * FROM ai_jobs WHERE id=? AND account_id=?').get(jobId, accountId)) : null });
      }
      return json(res, 405, { error: 'WS 分析只支持 GET/POST/PUT。' });
    }
    if (req.method === 'POST' && url.pathname === '/api/ws/crm-sync') {
      const versionFailure = stateVersionFailure(req);
      if (versionFailure) return json(res, versionFailure.status, versionFailure.body);
      const body = JSON.parse((await readBody(req, 512 * 1024)).toString('utf8'));
      const accountId = wsAccountId(body.accountId);
      const conversationId = wsText(body.conversationId, 160);
      const conversation = wsRequireAiConversation(conversationId, accountId);
      const analysisId = wsText(body.analysisId, 160);
      const analysisRow = analysisId
        ? db.prepare('SELECT * FROM ws_ai_analyses WHERE id=? AND account_id=? AND conversation_id=?').get(analysisId, accountId, conversationId)
        : db.prepare('SELECT * FROM ws_ai_analyses WHERE account_id=? AND conversation_id=? ORDER BY created_at DESC,id DESC LIMIT 1').get(accountId, conversationId);
      if (!analysisRow) return json(res, 404, { error: '找不到要同步的 WS 分析结果。' });
      let analysis = wsJson(analysisRow.result_json, {});
      const analyzedFingerprint = wsText(analysis.transcriptInfo?.sourceFingerprint, 500);
      const conversationData = wsJson(conversation.data_json, {});
      const vipGroup = wsIsVipGroup(conversation);
      const memberScope = wsVipMemberEvidence(conversation, body.memberIdentity || analysis.memberIdentity || analysis.transcriptInfo?.memberIdentity || {});
      if (vipGroup && (analysis.transcriptInfo?.memberScoped !== true || !memberScope.valid)) {
        return json(res, 200, {
          ok:true, skipped:true, matched:false, created:false, identityPending:true,
          reason: memberScope.reason || 'VIP 群分析必须按单一发言人生成；其他成员消息只能作为上下文，不能写入个人客户档案或跟进评分。',
          confidence:Number(analysisRow.confidence || analysis.confidence || 0),
        });
      }
      if (vipGroup) analysis = wsVipScopedAnalysis(conversation, analysis, memberScope.identity);
      const currentFingerprint = wsText(conversationData.historyFingerprint, 500);
      const latestFingerprint = wsText(conversationData.lastMessageFingerprint, 500);
      const nativeHistoryCount = Number(db.prepare("SELECT COUNT(*) count FROM ws_messages WHERE account_id=? AND conversation_id=? AND json_extract(data_json,'$.source')='ws-webview2' AND COALESCE(json_extract(data_json,'$.previewOnly'),0)<>1").get(accountId, conversationId).count || 0);
      if (nativeHistoryCount > 0 && (Number(conversationData.directionVersion || 0) < 4 || Number(analysis.transcriptInfo?.directionVersion || 0) < 4)) {
        return json(res, 409, { error: '历史消息方向尚未通过 v4 双向校验，旧分析已保留但不会写入客户档案；请等待安全重采。', stale: true, directionRecollectionRequired: true });
      }
      if (analyzedFingerprint && (
        conversationData.historyLoaded !== true ||
        !currentFingerprint ||
        !latestFingerprint ||
        currentFingerprint !== latestFingerprint ||
        analyzedFingerprint !== currentFingerprint
      )) return json(res, 409, { error: '采集期间聊天已更新，旧分析已保留；将使用最新聊天重新分析。', stale: true });
      const confidence = Number(analysisRow.confidence || analysis.confidence || 0);
      if (!wsCrmSync.shouldAutoSync({ ...analysis, confidence })) return json(res, 200, { ok: true, skipped: true, matched: false, created: false, reason: 'AI 没有可用于补齐客户档案的结构化证据。', confidence });
      const memberIdentity = memberScope.identity;
      const conversationRef = {
        id: conversation.id,
        externalId: vipGroup ? (memberIdentity.senderId || memberIdentity.senderPhone) : conversation.external_id,
        title: vipGroup ? (memberIdentity.senderName || memberIdentity.senderPhone || memberIdentity.senderId) : conversation.title,
        customerId: '', analysisId: analysisRow.id,
      };
      const derivedProfile = wsCrmSync.deriveCustomerProfile({ ...analysis, confidence }, conversationRef, accountId);
      const normalizedProfile = customerGovernance.normalizeAiProfile({ ...analysis, confidence }, conversationRef, accountId);
      const profile = { ...derivedProfile, ...Object.fromEntries(Object.entries(normalizedProfile).filter(([, value]) => value !== '' && value != null && (!Array.isArray(value) || value.length))) };
      if (vipGroup) Object.assign(profile, {
        customerId:'', customer_id:'',
        wsExternalId:memberIdentity.senderId,
        phone:memberIdentity.senderPhone,
        phoneVerified:Boolean(memberIdentity.senderPhone),
        phoneSource:memberIdentity.senderPhone ? 'vip-group-sender' : '',
        conversationId:'',
      });
      const followupPlan = wsCrmSync.deriveFollowupPlan({ ...analysis, confidence }, { id: analysisRow.id }, { id: conversation.id, externalId: conversation.external_id }, accountId);
      let state = readState() || emptyCrmState();
      for (const key of ['customers', 'tickets', 'deposits', 'followups', 'registrations', 'phoneRegistry', 'batchOperations', 'activities', 'importIssues']) if (!Array.isArray(state[key])) state[key] = [];
      if (!state.settings || typeof state.settings !== 'object' || Array.isArray(state.settings)) state.settings = {};
      if (!Array.isArray(state.settings.operatingTasks)) state.settings.operatingTasks = [];
      // A legacy/pending customer_id is only a hint. Never let it bypass the
      // independent identity matcher: otherwise one stale link can cause AI
      // facts and follow-up tasks to be written to the wrong existing person.
      // Shared WS login accounts are scope only, never customer evidence.
      const associatedCustomerId = vipGroup ? '' : wsText(conversation.customer_id, 128);
      const associatedCustomer = associatedCustomerId
        ? state.customers.find(item => String(item?.id || '') === associatedCustomerId) || null
        : null;
      const manualBinding = !vipGroup && Boolean(associatedCustomer) && conversationData.customerMatch === 'manual' && conversationData.customerBindingSource === 'manual';
      // AI-extracted phone numbers can describe a relative, payment recipient
      // or quoted message. They remain usable as profile evidence after a
      // customer is independently identified, but never establish identity.
      // Only a phone-shaped visible conversation identity is eligible here.
      const conversationIdentityPhone = vipGroup ? memberIdentity.senderPhone : [conversation.external_id, conversation.title].map(value => {
        const raw = wsText(value, 200);
        const digits = raw.replace(/\D/g, '');
        return digits.length >= 8 && digits.length <= 15 && /^\+?[\d\s().-]+$/.test(raw) ? raw : '';
      }).find(Boolean) || '';
      const independentProfile = {
        ...profile,
        customerId:'', customer_id:'',
        wsExternalId:vipGroup ? memberIdentity.senderId : profile.wsExternalId,
        wsAccountId:accountId,
        phone:conversationIdentityPhone,
        phoneVerified:Boolean(conversationIdentityPhone),
        phoneSource:conversationIdentityPhone ? (vipGroup ? 'vip-group-sender' : 'conversation') : '',
        conversationId:vipGroup ? '' : profile.conversationId,
      };
      const independentMatch = wsCrmSync.matchCustomerForAutoSync(state.customers, independentProfile);
      const independentKinds = new Set(vipGroup ? ['ws-id', 'phone'] : ['ws-id', 'phone', 'conversation']);
      const independentlyVerified = independentKinds.has(independentMatch.kind) && Boolean(independentMatch.customer);
      if (associatedCustomer && !manualBinding && !independentlyVerified) {
        return json(res, 200, {
          ok: true, skipped: true, matched: false, created: false, identityPending: true,
          reason: '当前会话的历史客户关联尚未由独立 WS 标识、会话标识或电话号码确认；AI 分析已保留，但不会自动修改客户档案或创建提醒。',
          confidence,
        });
      }
      if (!manualBinding && independentMatch.customer && !independentKinds.has(independentMatch.kind)) {
        return json(res, 200, {
          ok: true, skipped: true, matched: false, created: false, identityPending: true,
          reason: '当前会话缺少独立 WS 标识、会话标识或电话号码证据；AI 分析已保留，但不会按共享账号或联系人别名自动补档。',
          confidence,
        });
      }
      if (manualBinding) profile.customerId = associatedCustomerId;
      else profile.customerId = '';
      const match = manualBinding
        ? { kind:'explicit-manual', customer:associatedCustomer, candidates:[associatedCustomer] }
        : independentMatch;
      const associationCorrected = !vipGroup && Boolean(
        associatedCustomer && !manualBinding && independentlyVerified
        && String(independentMatch.customer.id) !== associatedCustomerId
      );
      if (match.kind === 'ambiguous') return json(res, 200, { ok: true, skipped: true, matched: false, created: false, conflict: true, reason: 'AI 识别到多个候选客户，保留原档案并记录未关联结果，不自动新增或合并。', candidates: match.candidates.map(item => ({ id: item.id, name: item.name, phone: item.rawPhone || item.phone || '' })), confidence });
      let customer = match.customer;
      if (!customer) {
        return json(res, 200, { ok: true, skipped: true, matched: false, created: false, reason: '未匹配到现有客户档案，已保留 WS 分析结果但不会新增客户。', confidence, profile: { wsExternalId: profile.wsExternalId, phone: profile.phone, contactAccount: profile.contactAccount, conversationId: profile.conversationId } });
      }
      // Idempotent duplicate responses must pass the same live identity gate.
      // A historical event is not proof that a pending legacy association was
      // correct; returning matched:true before this point could falsely imply
      // that an unsafe customer link remained eligible for future automation.
      const existingHotEvent = db.prepare("SELECT * FROM hot_chat_events WHERE account_id=? AND analysis_id=? AND event_type='analysis_profile' ORDER BY created_at DESC LIMIT 1").get(accountId, analysisRow.id);
      if (existingHotEvent) {
        if (String(existingHotEvent.customer_id || '') !== String(customer.id || '')) {
          return json(res, 200, {
            ok: true, skipped: true, matched: false, created: false, identityPending: true,
            reason: '当前分析的历史联动记录与最新独立身份校验结果不一致；旧记录已保留，但不会自动修改客户档案或创建提醒。',
            confidence,
          });
        }
        const existingCustomer = (state.customers || []).find(item => String(item.id) === String(existingHotEvent.customer_id)) || null;
        const existingFollowup = (state.followups || []).find(item => String(item.wsAnalysisId || '') === String(analysisRow.id)) || null;
        const existingTask = state.settings?.operatingTasks?.find(item => item.aiGenerated && String(item.customerId || '') === String(existingCustomer?.id || '') && item.done !== true && !['done','dismissed','cancelled'].includes(String(item.status || '').toLowerCase()))
          || (!vipGroup ? state.settings?.operatingTasks?.find(item => String(item.wsConversationId || '') === conversationId && String(item.wsAccountId || accountId) === accountId) : null) || null;
        return json(res, 200, { ok: true, skipped: false, matched: Boolean(existingCustomer), created: false, duplicate: true, softDeleted: Boolean(existingCustomer?.deleted), conflicts: [], customer: existingCustomer, followup: existingFollowup, task: existingTask, updatedFields: [], revision: readStateEnvelope().version });
      }
      const customerBefore = JSON.parse(JSON.stringify(customer));
      const beforeCustomer = JSON.stringify(customer);
      const profileMerge = wsCrmSync.mergeCustomerProfileSafely(customer, profile);
      const governanceMerge = customerGovernance.mergeAiProfileSafely(customer, profile);
      customer.wsAnalysisId = analysisRow.id;
      customer.aiSyncedAt = new Date().toISOString();
      if (profile.origin && !customer.origin) customer.origin = profile.origin;
      if (profile.age !== '' && (customer.age === '' || customer.age == null)) customer.age = profile.age;
      if (profile.occupation && !customer.occupation) customer.occupation = profile.occupation;
      // WS analysis may supplement an existing customer and may suppress a
      // follow-up recommendation, but it must never delete that customer.
      // Deletion remains an explicit data-governance operation with its own
      // snapshot, audit trail and user action.
      const softDeleted = false;
      let followup = null;
      let task = null;
      let duplicate = false;
      if (followupPlan.shouldCreate) {
        // Return the proposed plan for existing consumers; only the task is
        // persisted until an actual contact result is registered.
        const now = new Date().toISOString();
        followup = {
          id: `FWS-${wsCore.stableHash(followupPlan.dedupeKey)}`,
          customerId: customer.id, customer: customer.name, phone: customer.rawPhone || customer.phone || '', date: now,
          method: 'WhatsApp', registration: '', wsConversationId: conversation.id, wsAnalysisId: analysisRow.id,
          wsFollowupKey: followupPlan.dedupeKey, aiGenerated: true,
        };
        Object.assign(followup, {
          customerId: customer.id, customer: customer.name, phone: customer.rawPhone || customer.phone || '',
          result: followupPlan.note, note: followupPlan.note, nextDate: followupPlan.nextDate || '',
          wsConversationId: conversation.id, wsAnalysisId: analysisRow.id, wsFollowupKey: followupPlan.dedupeKey,
          aiGenerated: true, status: 'planned', recordType: 'ai-plan', priority: followupPlan.priority, priorityScore: followupPlan.priorityScore,
          aiReason: followupPlan.reason, aiObjective: followupPlan.objective, aiOpener: followupPlan.opener,
          aiTalkingPoints: followupPlan.talkingPoints, aiAvoidTopics: followupPlan.avoidTopics,
          aiReanalyzeWhen: followupPlan.reanalyzeWhen, updatedAt: now,
        });
        // A proposed action is a task, not an interaction that already happened.
        // Keep manual CRM due dates and completed-contact statistics intact.
        const tasks = state.settings.operatingTasks;
        const activeAiTask = item => item?.aiGenerated && item.done !== true && !['done','dismissed','cancelled'].includes(String(item.status || '').toLowerCase());
        const existingTask = tasks.find(item => activeAiTask(item) && String(item.customerId || '') === String(customer.id))
          || tasks.find(item => item?.aiGenerated && String(item.customerId || '') === String(customer.id))
          // A VIP room can contain many existing customers. Its conversation
          // alone is never enough to reuse another member's reminder task.
          || (!vipGroup ? tasks.find(item => activeAiTask(item) && String(item.wsConversationId || '') === String(conversation.id) && String(item.wsAccountId || accountId) === accountId) : null)
          || (!vipGroup ? tasks.find(item => item?.aiGenerated && String(item.wsConversationId || '') === String(conversation.id) && String(item.wsAccountId || accountId) === accountId) : null);
        const scoreSummary = `AI 综合 ${followupPlan.priorityScore}/100（资金实力 ${followupPlan.qualificationScore}/100，聊天粘度 ${followupPlan.engagementScore}/100）`;
        const taskInput = { title: `跟进 ${customer.name || customer.rawPhone || customer.phone}`, due: followupPlan.nextDate || '', customerId: customer.id, customerName: customer.name || '', phone: customer.rawPhone || customer.phone || '', wsAccountId: accountId, wsAnalysisId: analysisRow.id, wsMemberIdentity: vipGroup ? memberIdentity : null, owner: customer.assistant || '未分配', priority: followupPlan.priority, priorityBand: followupPlan.priorityBand, priorityScore: followupPlan.priorityScore, qualificationScore: followupPlan.qualificationScore, qualificationReason: followupPlan.qualificationReason, engagementScore: followupPlan.engagementScore, engagementReason: followupPlan.engagementReason, scoreReason: followupPlan.scoreReason, scoreConfidence: followupPlan.scoreConfidence, scoringVersion: followupPlan.scoringVersion, evidenceGate: followupPlan.evidenceGate, scoringWeights: followupPlan.scoringWeights, note: [scoreSummary, followupPlan.scoreReason, followupPlan.note].filter(Boolean).join('；'), objective: followupPlan.objective, suggestedOpener: followupPlan.opener, talkingPoints: followupPlan.talkingPoints, avoidTopics: followupPlan.avoidTopics, wsConversationId: conversation.id, wsFollowupKey: followupPlan.dedupeKey, aiGenerated: true, directionInvalidated: false, invalidationReason: '' };
        if (existingTask) { duplicate = !existingTask.done; Object.assign(existingTask, taskInput, { done: false, status: 'open', completedAt: '', snoozedUntil: '', updatedAt: now }); task = existingTask; }
        else { task = { id: `TWS-${wsCore.stableHash(followupPlan.dedupeKey)}`, ...taskInput, done: false, createdAt: now, updatedAt: now }; tasks.unshift(task); }
        for (const other of tasks) if (other !== task && activeAiTask(other) && String(other.customerId || '') === String(customer.id)) Object.assign(other, { status:'dismissed', dismissed:true, dismissedReason:'superseded-by-newer-ai-reminder', updatedAt:now });
      }
      const activity = { id: `AWS-${Date.now().toString(36)}`, text: `AI 自动同步 WS 客户${followupPlan.shouldCreate ? '并生成跟进提醒' : ''}：${customer.name || customer.id}`, time: new Date().toISOString(), color: 'blue', source: 'ws-ai-sync', conversationId: conversation.id, analysisId: analysisRow.id };
      state.activities.unshift(activity);
      state.activities = state.activities.slice(0, 1000);
      if (readState()) saveSnapshot('WS AI 自动补充前自动快照');
      db.exec('BEGIN IMMEDIATE');
      try {
        const hotIdentity = { customerId: customer.id, accountId, conversationId: conversation.id };
        const hotRow = ensureHotProfile(hotIdentity);
        const hotFacts = hotFactsFromAnalysis(analysis, analysisRow.id);
        const hotUpdated = saveHotProfile(hotIdentity, hotFacts, {
          statusColor: analysis.statusColor || hotChatProfile.deriveStatusColor({ intent: analysis.intent, urgent: analysis.urgency === '高', completeness: hotChatProfile.computeCompleteness(Object.fromEntries(hotFacts.map(item => [item.field, item]))) }),
          customerTemperature: analysis.customerTemperature,
          conversationProgress: analysis.conversationProgress || analysis.progress || analysis.nextStep,
          profileSummary: analysis.summary,
          nextTopics: analysis.naturalNextTopics,
          noReply: analysis.noReply || analysis.noReplyAssessment,
          nextFollowupAt: followupPlan.nextDate,
          tags: analysis.tags,
        });
        const hotEventId = wsCreateId('hce');
        const hotEventResult = db.prepare('INSERT OR IGNORE INTO hot_chat_events(id,profile_id,customer_id,account_id,conversation_id,event_type,payload_json,source,analysis_id,idempotency_key,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(hotEventId, hotUpdated.id, customer.id, accountId, conversation.id, 'analysis_profile', JSON.stringify({ facts: hotFacts }), 'AI', analysisRow.id, `analysis:${analysisRow.id}`, new Date().toISOString());
        if (Number(hotEventResult?.changes || 0) > 0) enqueueHotOutbox(hotUpdated, hotEventId, { facts: hotFacts, customerId: customer.id }, 'crm_sync');
        writeState(state, false);
        if (profileMerge.changedFields.length || governanceMerge.changedFields.length || softDeleted) {
          recordGovernanceAction('update', customer.id, customerBefore, customer, { analysisId: analysisRow.id, source: 'WS AI', confidence, reason: 'AI 自动补充现有客户档案' });
        }
        recordAiFieldEvidence(customer.id, governanceMerge.evidenceRows, governanceMerge.conflicts);
        for (const conflict of governanceMerge.conflicts) {
          const row = { key: `${analysisRow.id}:${conflict.field}`, field: conflict.field, value: conflict.incoming, conversationId: conversation.id, analysisId: analysisRow.id, confidence, sourceText: `AI 识别值与现有值冲突：${String(conflict.existing).slice(0, 200)}` };
          recordAiFieldEvidence(customer.id, [row], [conflict]);
        }
        const bindingTime = new Date().toISOString();
        const latestConversationData = wsJson(db.prepare('SELECT data_json FROM ws_conversations WHERE id=? AND account_id=?').get(conversation.id, accountId)?.data_json, {});
        const memberBindingKey = vipGroup ? (memberIdentity.senderId || memberIdentity.senderPhone) : '';
        const verifiedBindingData = vipGroup
          ? {
              ...latestConversationData,
              vipMemberBindings:{
                ...(latestConversationData.vipMemberBindings && typeof latestConversationData.vipMemberBindings === 'object' ? latestConversationData.vipMemberBindings : {}),
                [memberBindingKey]:{ customerId:customer.id, senderId:memberIdentity.senderId, senderPhone:memberIdentity.senderPhone, verifiedAt:bindingTime, analysisId:analysisRow.id },
              },
            }
          : manualBinding
          ? latestConversationData
          : {
              ...latestConversationData,
              customerMatch:match.kind,
              customerBindingSource:'verified-identity',
              customerBindingVerifiedAt:bindingTime,
              ...(associationCorrected ? {
                previousCustomerAssociationInvalidated:true,
                previousCustomerId:associatedCustomerId,
                associationCorrectionAnalysisId:analysisRow.id,
              } : {}),
            };
        db.prepare('UPDATE ws_conversations SET customer_id=?,data_json=?,updated_at=? WHERE id=? AND account_id=?').run(vipGroup ? '' : customer.id, JSON.stringify(verifiedBindingData), bindingTime, conversation.id, accountId);
        db.exec('COMMIT');
      } catch (error) { db.exec('ROLLBACK'); throw error; }
      return json(res, 200, { ok: true, skipped: false, matched: true, created: false, duplicate, associationCorrected, softDeleted, conflicts: governanceMerge.conflicts, customer, followup, task, updatedFields: [...new Set([...profileMerge.changedFields, ...governanceMerge.changedFields, ...(beforeCustomer === JSON.stringify(customer) ? [] : ['aiSyncedAt'])])], revision: readStateEnvelope().version });
    }
    if (url.pathname === '/api/ws/replies') {
      if (req.method === 'GET') {
        const conversationId = wsText(url.searchParams.get('conversationId'), 160);
        const accountId = wsAccountId(url.searchParams.get('accountId'));
        if (!conversationId) return json(res, 400, { error: '读取 WS 回复缺少会话编号。' });
        wsRequireConversation(conversationId, accountId);
        const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit')) || 20));
        const offset = Math.max(0, Math.floor(Number(url.searchParams.get('offset')) || 0));
        const rows = db.prepare(`SELECT * FROM ws_replies WHERE account_id=? AND conversation_id=? ORDER BY created_at DESC,id DESC LIMIT ${limit} OFFSET ${offset}`).all(accountId, conversationId).map(wsReplyPayload);
        const total = Number(db.prepare('SELECT COUNT(*) AS count FROM ws_replies WHERE account_id=? AND conversation_id=?').get(accountId, conversationId).count || 0);
        return json(res, 200, { replies: rows, total, limit, offset });
      }
      if (req.method === 'POST' || req.method === 'PUT') {
        const body = JSON.parse((await readBody(req, 512 * 1024)).toString('utf8'));
        const conversationId = wsText(body.conversationId, 160);
        const accountId = wsAccountId(body.accountId);
        wsRequireConversation(conversationId, accountId);
        const idempotencyKey = wsText(body.idempotencyKey, 160);
        if (idempotencyKey) {
          const existing = db.prepare('SELECT * FROM ws_replies WHERE account_id=? AND conversation_id=? AND idempotency_key=?').get(accountId, conversationId, idempotencyKey);
          if (existing) return json(res, 200, { ...wsReplyPayload(existing), existed: true });
        }
        const status = WS_REPLY_STATUSES.has(wsText(body.status, 16)) ? wsText(body.status, 16) : 'draft';
        const now = new Date().toISOString(), id = wsCreateId('wsr');
        db.prepare('INSERT INTO ws_replies(id,account_id,conversation_id,original_text,translated_text,status,created_at,updated_at,idempotency_key) VALUES(?,?,?,?,?,?,?,?,?)').run(id, accountId, conversationId, wsText(body.originalText, 12000), wsText(body.translatedText, 12000), status, now, now, idempotencyKey);
        return json(res, 200, { ...wsReplyPayload(db.prepare('SELECT * FROM ws_replies WHERE id=? AND account_id=?').get(id, accountId)), existed: false });
      }
      return json(res, 405, { error: 'WS 回复只支持 GET/POST/PUT。' });
    }
    if (url.pathname === '/api/ws/collection-runs') {
      const accountId = wsAccountId(url.searchParams.get('accountId'));
      wsRequireAccount(accountId);
      if (req.method === 'GET') {
        const row = url.searchParams.get('id')
          ? db.prepare('SELECT * FROM ws_collection_runs WHERE id=? AND account_id=?').get(url.searchParams.get('id'), accountId)
          : db.prepare('SELECT * FROM ws_collection_runs WHERE account_id=? ORDER BY created_at DESC LIMIT 1').get(accountId);
        // A renderer refresh can be interrupted between the item write and
        // its summary PATCH (for example when WebView2 is backgrounded or the
        // desktop is resumed from sleep).  Reconcile on every read so the UI
        // never shows a stale 3/7-style summary when the durable items already
        // contain the completed records.  This is intentionally idempotent and
        // scoped to the selected account/run.
        const refreshed = row ? refreshWsCollectionRunCounters(accountId, row.id) : null;
        return json(res,200,{run:refreshed || (row ? wsCollectionRunPayload(row) : null)});
      }
      if (req.method === 'POST') { const body=JSON.parse((await readBody(req,64*1024)).toString('utf8')); const scopedAccountId=wsAccountId(body.accountId || accountId); wsRequireAccount(scopedAccountId); const now=new Date().toISOString(), id=wsText(body.id,160)||wsCreateId('wsr'); db.prepare('INSERT INTO ws_collection_runs(id,account_id,status,created_at,updated_at) VALUES(?,?,?,?,?)').run(id,scopedAccountId,'created',now,now); return json(res,201,{run:wsCollectionRunPayload(db.prepare('SELECT * FROM ws_collection_runs WHERE id=? AND account_id=?').get(id,scopedAccountId))}); }
      if (req.method === 'PATCH') { const body=JSON.parse((await readBody(req,64*1024)).toString('utf8')); const id=wsText(body.id,160), existing=db.prepare('SELECT * FROM ws_collection_runs WHERE id=? AND account_id=?').get(id, accountId); if(!existing)return json(res,404,{error:'采集任务不存在。'}); const n=k=>Math.max(0,Math.floor(Number(body[k] ?? existing[k])||0)); const now=new Date().toISOString(),status=wsText(body.status,30)||existing.status,lastSuccessAt=Object.hasOwn(body,'lastSuccessAt')?wsText(body.lastSuccessAt,80):existing.last_success_at,cursor=Object.hasOwn(body,'cursor')?wsText(body.cursor,500):existing.cursor,resumeCount=Object.hasOwn(body,'resumeCount')?Math.max(0,Math.floor(Number(body.resumeCount)||0)):existing.resume_count+(status==='running'&&existing.status==='paused'?1:0); db.prepare('UPDATE ws_collection_runs SET status=?,total=?,discovered=?,completed=?,analyzing=?,analyzed=?,failed=?,skipped=?,retryable=?,last_error=?,checkpoint=?,cursor=?,resume_count=?,last_success_at=?,updated_at=? WHERE id=? AND account_id=?').run(status,n('total'),n('discovered'),n('completed'),n('analyzing'),n('analyzed'),n('failed'),n('skipped'),n('retryable'),wsText(body.lastError??existing.last_error,1000),wsText(body.checkpoint??existing.checkpoint,500),cursor,resumeCount,lastSuccessAt,now,id,accountId); return json(res,200,{run:wsCollectionRunPayload(db.prepare('SELECT * FROM ws_collection_runs WHERE id=? AND account_id=?').get(id,accountId))}); }
      return json(res,405,{error:'采集任务只支持 GET/POST/PATCH。'});
    }
    if (url.pathname === '/api/ws/collection-items') {
      const accountId = wsAccountId(url.searchParams.get('accountId'));
      wsRequireAccount(accountId);
      if (req.method === 'GET') {
        const runId = wsText(url.searchParams.get('runId'), 160);
        if (!runId) return json(res, 400, { error: '采集项缺少任务编号。' });
        const limit = Math.min(5000, Math.max(1, Number(url.searchParams.get('limit')) || 5000));
        const statuses = String(url.searchParams.get('status') || '').split(',').map(value => wsText(value, 30)).filter(Boolean);
        const analysisStatuses = String(url.searchParams.get('analysisStatus') || '').split(',').map(value => wsText(value, 30)).filter(Boolean);
        const where = ['account_id=?', 'run_id=?'];
        const params = [accountId, runId];
        if (statuses.length) { where.push(`status IN (${statuses.map(() => '?').join(',')})`); params.push(...statuses); }
        if (analysisStatuses.length) { where.push(`analysis_status IN (${analysisStatuses.map(() => '?').join(',')})`); params.push(...analysisStatuses); }
        if (url.searchParams.get('historyReady') === '1') {
          where.push("conversation_id IN (SELECT id FROM ws_conversations WHERE account_id=? AND json_extract(data_json,'$.historyLoaded')=1 AND COALESCE(json_extract(data_json,'$.historyFingerprint'),'')<>'' AND json_extract(data_json,'$.historyFingerprint')=json_extract(data_json,'$.lastMessageFingerprint') AND unread_count=0)");
          params.push(accountId);
        }
        const rows = db.prepare(`SELECT * FROM ws_collection_items WHERE ${where.join(' AND ')} ORDER BY updated_at ASC,id ASC LIMIT ${limit}`).all(...params);
        return json(res, 200, { items: rows.filter(row => !wsIsExcludedGroup(wsConversationRow(row.conversation_id, accountId) || {}) && (url.searchParams.get('historyReady') !== '1' || wsAiEligible(row.conversation_id, accountId))).map(wsCollectionItemPayload) });
      }
      if (req.method === 'POST' || req.method === 'PATCH') {
        const body = JSON.parse((await readBody(req, 128 * 1024)).toString('utf8'));
        const scopedAccountId = wsAccountId(body.accountId || accountId);
        const runId = wsText(body.runId, 160), conversationId = wsText(body.conversationId, 160);
        if (!db.prepare('SELECT 1 FROM ws_collection_runs WHERE id=? AND account_id=?').get(runId, scopedAccountId)) return json(res, 404, { error: '采集任务不存在。' });
        const conversationRow = wsRequireConversation(conversationId, scopedAccountId);
        const now = new Date().toISOString();
        const existing = db.prepare('SELECT * FROM ws_collection_items WHERE account_id=? AND run_id=? AND conversation_id=?').get(scopedAccountId, runId, conversationId);
        const id = existing?.id || wsText(body.id, 160) || wsCreateId('wsi');
        const val = (key, old, max = 1000) => wsText(body[key] ?? old, max);
        const conversationData = wsJson(conversationRow.data_json, {});
        const historyFingerprint = wsText(conversationData.historyFingerprint, 500);
        const latestFingerprint = wsText(conversationData.lastMessageFingerprint, 500);
        const fullHistoryCurrent = conversationData.historyLoaded === true && Boolean(historyFingerprint) && historyFingerprint === latestFingerprint;
        const listRefreshCoverage = ['list-preview', 'list-only'].includes(wsText(body.coverageStatus, 30));
        // Renderer list refreshes are discovery metadata.  If the service has
        // already verified a current full transcript, preserve its item state
        // even if an older renderer tries to PATCH list-preview/pending.
        const protectFullHistory = Boolean(existing && fullHistoryCurrent && listRefreshCoverage);
        const requestedStatus = protectFullHistory ? existing.status : val('status', existing?.status || 'queued', 30);
        // Re-discovering a chat is idempotent.  A repeated list scan posts the
        // same item with the initial `queued` status; it must never downgrade
        // an item that was already collected (or explicitly skipped).
        const nextStatus = existing && req.method === 'POST' && requestedStatus === 'queued' && ['completed', 'skipped', 'skipped_unread'].includes(existing.status)
          ? existing.status
          : requestedStatus;
        const requestedCheckpoint = protectFullHistory ? existing.checkpoint : val('checkpoint', existing?.checkpoint || '', 500);
        const requestedAnalysisStatus = protectFullHistory ? existing.analysis_status : val('analysisStatus', existing?.analysis_status || 'pending', 30);
        const sameCheckpoint = Boolean(existing && requestedCheckpoint && requestedCheckpoint === existing.checkpoint);
        const successfulAnalysis = Boolean(db.prepare("SELECT 1 FROM ws_ai_analyses WHERE account_id=? AND conversation_id=? AND confidence>0 AND error_message='' LIMIT 1").get(scopedAccountId, conversationId));
        const analysisStatus = requestedAnalysisStatus === 'pending' && sameCheckpoint && successfulAnalysis ? 'completed' : requestedAnalysisStatus;
        if (existing) db.prepare('UPDATE ws_collection_items SET status=?,attempts=?,analysis_status=?,followup_status=?,next_followup_at=?,coverage_status=?,last_error=?,checkpoint=?,updated_at=? WHERE id=? AND account_id=?').run(nextStatus, Math.max(0, Math.floor(Number(body.attempts ?? existing.attempts) || 0)), analysisStatus, val('followupStatus', existing.followup_status, 30), val('nextFollowupAt', existing.next_followup_at, 80), protectFullHistory ? existing.coverage_status : val('coverageStatus', existing.coverage_status, 30), protectFullHistory ? existing.last_error : val('lastError', existing.last_error), requestedCheckpoint, now, id, scopedAccountId);
        else db.prepare('INSERT INTO ws_collection_items(id,account_id,run_id,conversation_id,status,attempts,analysis_status,followup_status,next_followup_at,coverage_status,last_error,checkpoint,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(id, scopedAccountId, runId, conversationId, val('status', 'queued', 30), Math.max(0, Math.floor(Number(body.attempts) || 0)), analysisStatus, val('followupStatus', 'none', 30), val('nextFollowupAt', '', 80), val('coverageStatus', 'unknown', 30), val('lastError', ''), requestedCheckpoint, now, now);
        // Keep the run summary authoritative at the service boundary.  The
        // renderer may be backgrounded or interrupted between item writes;
        // deriving counters here prevents a stale 3/7 display after the
        // individual list-only items have already completed.
        const refreshedRun = refreshWsCollectionRunCounters(scopedAccountId, runId);
        return json(res, 200, { item: wsCollectionItemPayload(db.prepare('SELECT * FROM ws_collection_items WHERE id=? AND account_id=?').get(id,scopedAccountId)), run: refreshedRun });
      }
      return json(res,405,{error:'采集项只支持 GET/POST/PATCH。'});
    }
    if (url.pathname === '/api/ws/followup-action' && req.method === 'POST') {
      const failure = stateVersionFailure(req);
      if (failure) return json(res, failure.status, failure.body);
      const body = JSON.parse((await readBody(req, 64 * 1024)).toString('utf8'));
      const action = wsText(body.action, 30);
      if (!['complete', 'snooze', 'dismiss', 'reopen'].includes(action)) return json(res, 400, { error: '不支持的跟进操作。' });
      const state = governanceState();
      const task = state.settings.operatingTasks.find(item => body.taskId
        ? String(item.id) === String(body.taskId)
        : item.aiGenerated && String(item.wsConversationId) === String(body.conversationId) && String(item.wsAccountId || 'default') === wsAccountId(body.accountId));
      if (!task?.aiGenerated) return json(res, 404, { error: '关联的 AI 跟进任务不存在，请刷新后重试。' });
      const accountId = wsAccountId(task.wsAccountId || body.accountId);
      const conversationId = wsText(task.wsConversationId, 160);
      if (task.groupExcluded === true || wsIsExcludedGroup(wsConversationRow(conversationId, accountId) || {})) throw wsConversationPolicyError('WS_GROUP_EXCLUDED', '普通群聊跟进已排除，不能重新开启或记为完成。');
      const customer = governanceCustomer(state, task.customerId);
      if (!customer || customer.deleted) return json(res, 409, { error: '关联客户已失效，请刷新任务。' });
      const result = wsText(body.result, 2000);
      if (action === 'complete' && !result) return json(res, 400, { error: '完成跟进前请填写实际沟通结果。' });
      const linkedAnalysis = task.wsAnalysisId
        ? db.prepare('SELECT error_message FROM ws_ai_analyses WHERE id=? AND account_id=? AND conversation_id=?').get(wsText(task.wsAnalysisId, 160), accountId, conversationId)
        : null;
      if (action !== 'dismiss' && (task.directionInvalidated === true || wsText(linkedAnalysis?.error_message, 1000))) {
        return json(res, 409, { error: '该跟进建议来自已失效的聊天方向或失败分析，只能忽略；请等待最新双向聊天重新分析。', directionInvalidated: true });
      }
      const now = new Date().toISOString();
      const due = wsCrmSync.normalizeDate(body.due);
      if (action === 'snooze' && !due) return json(res, 400, { error: '请选择有效的延期日期。' });
      const closed = action === 'complete' || action === 'dismiss';
      const status = action === 'complete' ? 'done' : action === 'dismiss' ? 'dismissed' : action === 'snooze' ? 'snoozed' : 'open';
      const previousStatus = task.status || (task.done ? 'done' : 'open');
      task.done = closed;
      task.status = status;
      task.updatedAt = now;
      task.completedAt = closed ? (task.completedAt || now) : '';
      task.snoozedUntil = action === 'snooze' ? `${due}T00:00:00` : '';
      if (action === 'snooze') task.due = due;
      task.history = [...(task.history || []), { action, at: now, due: task.due || '', reason: wsText(body.reason, 500) }].slice(-100);
      let followup = null;
      if (action === 'complete' && result) {
        const recordId = `F-${wsCore.stableHash(`${task.id}:${task.wsAnalysisId || ''}`)}`;
        followup = state.followups.find(item => item.id === recordId);
        if (!followup) {
          followup = { id: recordId, customerId: customer.id, date: now, method: 'WhatsApp', result, note: result, nextDate: wsCrmSync.normalizeDate(body.nextDate), taskId: task.id, wsAnalysisId: task.wsAnalysisId || '', status: 'completed', aiGenerated: false };
          state.followups.unshift(followup);
          customer.lastFollow = now.slice(0, 10);
          if (followup.nextDate) customer.due = followup.nextDate;
        }
      }
      db.exec('BEGIN IMMEDIATE');
      try {
        const taskMember = wsVipMemberIdentity(task.wsMemberIdentity || {});
        const alertKey = `${accountId}:${conversationId}${taskMember.trusted ? `:${taskMember.senderId || taskMember.senderPhone}` : ''}`;
        db.prepare('UPDATE ws_followup_alerts SET status=?,snoozed_until=?,followup_time=CASE WHEN ?<>\'\' THEN ? ELSE followup_time END,updated_at=? WHERE account_id=? AND alert_key=?').run(status, task.snoozedUntil, action === 'snooze' ? due : '', due, now, accountId, alertKey);
        db.prepare('UPDATE ws_collection_items SET followup_status=?,next_followup_at=CASE WHEN ?<>\'\' THEN ? ELSE next_followup_at END,updated_at=? WHERE account_id=? AND conversation_id=?').run(status, action === 'snooze' ? due : '', due, now, accountId, conversationId);
        if (previousStatus !== status || followup) state.activities.unshift({ id: wsCreateId('act'), text: `${action === 'complete' ? '完成' : action === 'dismiss' ? '忽略' : action === 'snooze' ? '延期' : '恢复'} AI 跟进：${customer.name || customer.id}`, time: now, source: 'ws-followup-action', taskId: task.id });
        writeState(state, false);
        db.exec('COMMIT');
      } catch (error) { db.exec('ROLLBACK'); throw error; }
      return json(res, 200, { ok: true, task, followup, revision: readStateEnvelope().version });
    }
    if (url.pathname === '/api/ws/followup-alerts' && req.method !== 'GET') {
      const body = JSON.parse((await readBody(req, 64 * 1024)).toString('utf8'));
      const accountId = wsAccountId(body.accountId);
      wsRequireAccount(accountId);
      const id = wsText(body.id, 160), conversationId = wsText(body.conversationId, 160), alertKey = wsText(body.alertKey, 320);
      const existing = id ? db.prepare('SELECT * FROM ws_followup_alerts WHERE id=? AND account_id=?').get(id, accountId) : alertKey ? db.prepare('SELECT * FROM ws_followup_alerts WHERE account_id=? AND alert_key=?').get(accountId, alertKey) : null;
      if (!existing) return json(res, 404, { error: '跟进提醒不存在。' });
      wsRequireConversation(existing.conversation_id, accountId);
      if (conversationId && conversationId !== existing.conversation_id) return json(res, 409, { error: '跟进提醒会话不匹配。' });
      const allowed = new Set(['open','snoozed','done','dismissed']);
      const status = allowed.has(wsText(body.status, 20)) ? wsText(body.status, 20) : existing.status;
      const snoozedUntil = wsText(body.snoozedUntil ?? existing.snoozed_until, 80);
      const now = new Date().toISOString();
      const state = governanceState();
      const task = state.settings.operatingTasks.find(item => item.aiGenerated && String(item.wsConversationId || '') === existing.conversation_id && String(item.wsAccountId || accountId) === accountId);
      const linkedAnalysis = task?.wsAnalysisId
        ? db.prepare('SELECT error_message FROM ws_ai_analyses WHERE id=? AND account_id=? AND conversation_id=?').get(wsText(task.wsAnalysisId, 160), accountId, existing.conversation_id)
        : null;
      if (task && status !== 'dismissed' && (task.directionInvalidated === true || wsText(linkedAnalysis?.error_message, 1000))) {
        return json(res, 409, { error: '该跟进建议已失效，只能忽略；请等待最新双向聊天重新分析。', directionInvalidated: true });
      }
      db.exec('BEGIN IMMEDIATE');
      try {
        db.prepare('UPDATE ws_followup_alerts SET status=?,snoozed_until=?,updated_at=? WHERE id=? AND account_id=?').run(status, snoozedUntil, now, existing.id, accountId);
        if (task) { task.done = ['done', 'dismissed'].includes(status); task.status = status; task.snoozedUntil = snoozedUntil; task.updatedAt = now; if (status === 'snoozed' && wsCrmSync.normalizeDate(snoozedUntil)) task.due = wsCrmSync.normalizeDate(snoozedUntil); writeState(state, false); }
        db.exec('COMMIT');
      } catch(error) { db.exec('ROLLBACK'); throw error; }
      return json(res, 200, { alert: wsFollowupAlertPayload(db.prepare('SELECT * FROM ws_followup_alerts WHERE id=? AND account_id=?').get(existing.id,accountId)) });
    }
    if (req.method === 'GET' && url.pathname === '/api/ws/followup-alerts') {
      const allAccounts = url.searchParams.get('allAccounts') === '1';
      const accountId = wsAccountId(url.searchParams.get('accountId'));
      if (!allAccounts) wsRequireAccount(accountId);
      const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit')) || 30));
      // Deduplicate after reading the member identity from each result. A
      // conversation-level SQL anti-join would hide every other VIP member.
      const rows = db.prepare(`SELECT a.*, c.title, c.external_id, c.customer_id, c.data_json AS conversation_data_json, c.unread_count AS conversation_unread_count FROM ws_ai_analyses a JOIN ws_conversations c ON c.id=a.conversation_id AND c.account_id=a.account_id WHERE ${allAccounts ? '1=1' : 'a.account_id=?'} AND a.confidence>=0.3 ORDER BY a.created_at DESC,a.id DESC`).iterate(...(allAccounts ? [] : [accountId]));
      const currentCrm = governanceState();
      const currentTasks = currentCrm.settings.operatingTasks;
      const activeCustomerIds = new Set(currentCrm.customers.filter(customer => !customer.deleted).map(customer => String(customer.id)));
      const taskByAnalysis = new Map(), taskByConversation = new Map();
      for (const item of currentTasks) {
        if (!item?.aiGenerated) continue;
        const analysisKey = String(item.wsAnalysisId || '');
        if (analysisKey && !taskByAnalysis.has(analysisKey)) taskByAnalysis.set(analysisKey, item);
        const conversationKey = String(item.wsConversationId || '');
        if (conversationKey) {
          if (!taskByConversation.has(conversationKey)) taskByConversation.set(conversationKey, []);
          taskByConversation.get(conversationKey).push(item);
        }
      }
      const existingAlerts = new Map(db.prepare(`SELECT * FROM ws_followup_alerts ${allAccounts ? '' : 'WHERE account_id=?'}`).all(...(allAccounts ? [] : [accountId])).map(row => [`${row.account_id}:${row.alert_key}`, row]));
      const localDateKey = date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
      const today = localDateKey(new Date());
      const upcomingLimitDate = new Date(); upcomingLimitDate.setDate(upcomingLimitDate.getDate() + 7);
      const upcomingLimit = localDateKey(upcomingLimitDate);
      const alerts = [];
      const seenConversations = new Set();
      const conversationChecks = new Map(), vipMemberChecks = new Map(), dueDateCache = new Map();
      for (const row of rows) {
        const conversationKey = `${row.account_id}:${row.conversation_id}`;
        if (!conversationChecks.has(conversationKey)) {
          const conversation = wsAiEligibleConversation(row.conversation_id, row.account_id, { id:row.conversation_id, account_id:row.account_id, external_id:row.external_id, title:row.title, customer_id:row.customer_id, data_json:row.conversation_data_json, unread_count:row.conversation_unread_count });
          conversationChecks.set(conversationKey, conversation ? { row:conversation, vipGroup:wsIsVipGroup(conversation) } : null);
        }
        const alertContext = conversationChecks.get(conversationKey);
        if (!alertContext) continue;
        const alertConversation = alertContext.row, alertVipGroup = alertContext.vipGroup;
        const result = wsJson(row.result_json, {});
        let alertVipMember = null, alertMemberKey = '';
        if (alertVipGroup) {
          if (result.transcriptInfo?.memberScoped !== true) continue;
          const rawMemberIdentity = result.memberIdentity || result.transcriptInfo?.memberIdentity || {};
          const memberCheckKey = `${conversationKey}:${JSON.stringify(wsVipMemberIdentity(rawMemberIdentity))}`;
          if (!vipMemberChecks.has(memberCheckKey)) vipMemberChecks.set(memberCheckKey, wsVipMemberEvidence(alertConversation, rawMemberIdentity));
          alertVipMember = vipMemberChecks.get(memberCheckKey);
          if (!alertVipMember.valid) continue;
          alertMemberKey = alertVipMember.identity.senderId || alertVipMember.identity.senderPhone;
        }
        const seenKey = `${row.account_id}:${row.conversation_id}:${alertMemberKey}`;
        if (seenConversations.has(seenKey)) continue;
        const confidence = Number(row.confidence || 0);
        if (result.error || confidence < 0.3) continue;
        // A newer failed or low-confidence analysis must not hide an older
        // valid analysis that still contains an actionable follow-up date.
        seenConversations.add(seenKey);
        const scopedAccountId = row.account_id;
        const task = taskByAnalysis.get(String(row.id))
          || (!alertVipGroup ? taskByConversation.get(String(row.conversation_id))?.find(item => String(item.wsAccountId || scopedAccountId) === scopedAccountId) : null);
        if (!task || !activeCustomerIds.has(String(task.customerId)) || (task.wsAnalysisId && task.wsAnalysisId !== row.id)) continue;
        const strategy = result.followupStrategy && typeof result.followupStrategy === 'object' ? result.followupStrategy : {};
        const alertPlan = wsCrmSync.deriveFollowupPlan({ ...result, confidence }, { id: row.id }, { id: row.conversation_id, externalId: row.external_id }, row.account_id);
        if (!alertPlan.shouldCreate) continue;
        const dueInput = task?.due || alertPlan.nextDate;
        if (!dueDateCache.has(dueInput)) dueDateCache.set(dueInput, wsCrmSync.normalizeDate(dueInput));
        const due = dueDateCache.get(dueInput);
        const priorityScore = alertPlan.priorityScore;
        const urgent = /高|紧急|urgent|hot/i.test(String(result.urgency || '')) || priorityScore >= 80;
        const overdue = Boolean(due && due < today);
        const dueToday = Boolean(due && due === today);
        const upcoming = Boolean(due && due > today && due <= upcomingLimit);
        if (!urgent && !overdue && !dueToday && !upcoming) continue;
        const alertKey = `${row.account_id}:${row.conversation_id}${alertMemberKey ? `:${alertMemberKey}` : ''}`;
        if (task?.done && (!task.wsAnalysisId || task.wsAnalysisId === row.id)) continue;
        const existingAlert = existingAlerts.get(`${scopedAccountId}:${alertKey}`);
        const priority = overdue ? 'overdue' : dueToday ? 'today' : urgent ? 'urgent' : 'upcoming';
        const reason = wsText(strategy.reason, 500) || (urgent && overdue ? '高意向且已逾期' : urgent ? '高意向客户' : overdue ? '跟进已逾期' : dueToday ? '今日应跟进' : '未来 7 天内应跟进');
        const alertData = {
          title: row.title,
          externalId: row.external_id,
          customerId: task.customerId,
          memberIdentity: alertVipGroup ? alertVipMember.identity : null,
          summary: result.summary || '',
          nextStep: result.nextStep || '',
          followupTime: due || '',
          priorityScore,
          qualificationScore: alertPlan.qualificationScore,
          qualificationReason: alertPlan.qualificationReason,
          engagementScore: alertPlan.engagementScore,
          engagementReason: alertPlan.engagementReason,
          scoreReason: alertPlan.scoreReason,
          scoreConfidence: alertPlan.scoreConfidence,
          priorityBand: alertPlan.priorityBand,
          scoringVersion: alertPlan.scoringVersion,
          reminderCadence: alertPlan.reminderCadence,
          objective: alertPlan.objective || '',
          opener: alertPlan.opener || '',
          talkingPoints: alertPlan.talkingPoints || [],
          avoidTopics: alertPlan.avoidTopics || [],
          reanalyzeWhen: alertPlan.reanalyzeWhen || [],
          urgency: result.urgency || '',
          intent: result.intent || '',
          confidence,
          needsConfirmation: true,
        };
        const now = new Date().toISOString();
        const dataJson = JSON.stringify(alertData);
        let savedAlert = existingAlert;
        if (!existingAlert) {
          savedAlert = { id:wsCreateId('wfa'), account_id:scopedAccountId, conversation_id:row.conversation_id, analysis_id:row.id, alert_key:alertKey, priority, reason, followup_time:due || '', status:'open', snoozed_until:'', data_json:dataJson, created_at:now, updated_at:now };
          db.prepare('INSERT INTO ws_followup_alerts(id,account_id,conversation_id,analysis_id,alert_key,priority,reason,followup_time,status,snoozed_until,data_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)').run(savedAlert.id, scopedAccountId, row.conversation_id, row.id, alertKey, priority, reason, due || '', 'open', '', dataJson, now, now);
          existingAlerts.set(`${scopedAccountId}:${alertKey}`, savedAlert);
        } else {
          // A newer analysis is a new reminder decision. Reopen an alert that
          // was completed, dismissed, or snoozed for the older analysis so a
          // fresh incoming message cannot silently suppress the next action.
          const newAnalysis = String(existingAlert.analysis_id || '') !== String(row.id);
          const nextStatus = newAnalysis && ['done', 'dismissed', 'snoozed'].includes(String(existingAlert.status || '')) ? 'open' : existingAlert.status;
          const nextSnoozedUntil = newAnalysis ? '' : existingAlert.snoozed_until;
          if (String(existingAlert.analysis_id || '') !== String(row.id) || existingAlert.priority !== priority || existingAlert.reason !== reason || existingAlert.followup_time !== (due || '') || existingAlert.status !== nextStatus || existingAlert.snoozed_until !== nextSnoozedUntil || existingAlert.data_json !== dataJson) {
            db.prepare('UPDATE ws_followup_alerts SET analysis_id=?,priority=?,reason=?,followup_time=?,status=?,snoozed_until=?,data_json=?,updated_at=? WHERE id=? AND account_id=?').run(row.id, priority, reason, due || '', nextStatus, nextSnoozedUntil, dataJson, now, existingAlert.id, scopedAccountId);
            savedAlert = { ...existingAlert, analysis_id:row.id, priority, reason, followup_time:due || '', status:nextStatus, snoozed_until:nextSnoozedUntil, data_json:dataJson, updated_at:now };
            existingAlerts.set(`${scopedAccountId}:${alertKey}`, savedAlert);
          }
        }
        if (savedAlert.status === 'done' || savedAlert.status === 'dismissed') continue;
        if (savedAlert.status === 'snoozed' && savedAlert.snoozed_until && savedAlert.snoozed_until > new Date().toISOString()) continue;
        alerts.push({
          alertKey,
          id: savedAlert.id,
          taskId: task?.id || '',
          analysisId: row.id,
          analyzedAt: row.created_at,
          accountId: row.account_id,
          conversationId: row.conversation_id,
          title: row.title,
          externalId: row.external_id,
          customerId: task.customerId,
          summary: result.summary || '',
          nextStep: result.nextStep || '',
          followupTime: due || '',
          priorityScore,
          qualificationScore: alertPlan.qualificationScore,
          qualificationReason: alertPlan.qualificationReason,
          engagementScore: alertPlan.engagementScore,
          engagementReason: alertPlan.engagementReason,
          scoreReason: alertPlan.scoreReason,
          scoreConfidence: alertPlan.scoreConfidence,
          priorityBand: alertPlan.priorityBand,
          scoringVersion: alertPlan.scoringVersion,
          reminderCadence: alertPlan.reminderCadence,
          objective: alertPlan.objective || '',
          opener: alertPlan.opener || '',
          talkingPoints: alertPlan.talkingPoints || [],
          avoidTopics: alertPlan.avoidTopics || [],
          reanalyzeWhen: alertPlan.reanalyzeWhen || [],
          urgency: result.urgency || '',
          intent: result.intent || '',
          confidence,
          priority,
          reason,
          status: savedAlert.status,
          snoozedUntil: savedAlert.snoozed_until || '',
          needsConfirmation: true,
        });
      }
      const priorityRank = { overdue: 0, today: 1, urgent: 2, upcoming: 3 };
      alerts.sort((a, b) => (priorityRank[a.priority] ?? 9) - (priorityRank[b.priority] ?? 9)
        || Number(b.priorityScore || 0) - Number(a.priorityScore || 0)
        || String(a.followupTime || '9999-12-31').localeCompare(String(b.followupTime || '9999-12-31')));
      return json(res, 200, { alerts: alerts.slice(0, limit), generatedAt: new Date().toISOString() });
    }
    if (req.method === 'GET' && url.pathname === '/api/ws/diagnostics') {
      const accountId = wsAccountId(url.searchParams.get('accountId')); wsRequireAccount(accountId);
      return json(res, 200, { schemaVersion: Number(db.prepare('PRAGMA user_version').get().user_version || 0), counts: { settings: Number(db.prepare('SELECT COUNT(*) AS count FROM ws_settings WHERE account_id=?').get(accountId).count || 0), conversations: Number(db.prepare('SELECT COUNT(*) AS count FROM ws_conversations WHERE account_id=?').get(accountId).count || 0), messages: Number(db.prepare('SELECT COUNT(*) AS count FROM ws_messages WHERE account_id=?').get(accountId).count || 0), analyses: Number(db.prepare('SELECT COUNT(*) AS count FROM ws_ai_analyses WHERE account_id=?').get(accountId).count || 0), aiJobs: aiJobStats(accountId), replies: Number(db.prepare('SELECT COUNT(*) AS count FROM ws_replies WHERE account_id=?').get(accountId).count || 0), batches: Number(db.prepare('SELECT COUNT(*) AS count FROM ws_ingest_batches WHERE account_id=?').get(accountId).count || 0), collectionRuns: Number(db.prepare('SELECT COUNT(*) AS count FROM ws_collection_runs WHERE account_id=?').get(accountId).count || 0), collectionItems: Number(db.prepare('SELECT COUNT(*) AS count FROM ws_collection_items WHERE account_id=?').get(accountId).count || 0) } });
    }
    if (req.method === 'GET' && url.pathname === '/api/ws/export') {
      const accountId = wsAccountId(url.searchParams.get('accountId')); wsRequireAccount(accountId);
      const conversations = db.prepare('SELECT * FROM ws_conversations WHERE account_id=? ORDER BY updated_at DESC').all(accountId).map(wsConversationPayload);
      const settings = db.prepare('SELECT * FROM ws_settings WHERE account_id=? ORDER BY updated_at DESC').all(accountId).map(wsSettingsPayload);
      const messages = db.prepare('SELECT * FROM ws_messages WHERE account_id=? ORDER BY conversation_id,order_no,created_at').all(accountId).map(wsMessagePayload);
      const analyses = db.prepare('SELECT * FROM ws_ai_analyses WHERE account_id=? ORDER BY created_at').all(accountId).map(wsAnalysisPayload);
      const replies = db.prepare('SELECT * FROM ws_replies WHERE account_id=? ORDER BY created_at').all(accountId).map(wsReplyPayload);
      const batches = db.prepare('SELECT * FROM ws_ingest_batches WHERE account_id=? ORDER BY created_at').all(accountId).map(wsBatchPayload);
      const collectionRuns = db.prepare('SELECT * FROM ws_collection_runs WHERE account_id=? ORDER BY created_at').all(accountId).map(wsCollectionRunPayload);
      const collectionItems = db.prepare('SELECT * FROM ws_collection_items WHERE account_id=? ORDER BY created_at').all(accountId).map(wsCollectionItemPayload);
      const followupAlerts = db.prepare('SELECT * FROM ws_followup_alerts WHERE account_id=? ORDER BY created_at').all(accountId).map(wsFollowupAlertPayload);
      return json(res, 200, { schemaVersion: 6, createdAt: new Date().toISOString(), settings, conversations, messages, analyses, replies, batches, collectionRuns, collectionItems, followupAlerts });
    }
    if (req.method === 'POST' && url.pathname === '/api/ws/import') {
      const body = JSON.parse((await readBody(req, 50 * 1024 * 1024)).toString('utf8'));
      const accountId = wsAccountId(body.accountId);
      wsRequireAccount(accountId);
      const schemaVersion = Number(body.schemaVersion || 5);
      if (!Number.isInteger(schemaVersion) || schemaVersion < 5 || schemaVersion > 6) return json(res, 400, { error: 'WS 备份版本不受支持，只能恢复 v5 或 v6 数据。' });
      for (const key of ['settings','conversations','messages','analyses','replies','batches','collectionRuns','collectionItems','followupAlerts']) if (Object.hasOwn(body, key) && !Array.isArray(body[key])) return json(res, 400, { error: `WS 备份中的 ${key} 不是有效数组。` });
      const settings = body.settings || [];
      const conversations = body.conversations || [];
      const messages = body.messages || [];
      const analyses = body.analyses || [];
      const replies = body.replies || [];
      const batches = body.batches || [];
      const collectionRuns = body.collectionRuns || [];
      const collectionItems = body.collectionItems || [];
      const followupAlerts = body.followupAlerts || [];
      const limits = { settings: 5000, conversations: 5000, messages: 100000, analyses: 20000, replies: 20000, batches: 20000, collectionRuns: 5000, collectionItems: 100000, followupAlerts: 20000 };
      for (const [key, limit] of Object.entries(limits)) if ({ settings, conversations, messages, analyses, replies, batches, collectionRuns, collectionItems, followupAlerts }[key].length > limit) return json(res, 413, { error: `WS 备份中的 ${key} 超过 ${limit} 条上限，未执行恢复。` });
      const conversationIds = new Set(conversations.map(item => wsText(item.id, 160)).filter(Boolean));
      const externalIds = new Set(conversations.map(item => wsText(item.externalId, 160)).filter(Boolean));
      if (conversations.some(item => !wsText(item.id, 160) || !wsText(item.externalId, 160)) || conversationIds.size !== conversations.length || externalIds.size !== conversations.length) return json(res, 400, { error: 'WS 备份中的会话编号或外部标识缺失或重复。' });
      if (settings.some(item => !conversationIds.has(wsText(item.conversationId, 160)))) return json(res, 400, { error: 'WS 备份中的设置关联了不存在的会话。' });
      if (new Set(settings.map(item => wsText(item.conversationId, 160))).size !== settings.length) return json(res, 400, { error: 'WS 备份中同一会话存在重复设置。' });
      if (messages.some(item => wsMessageTextTooLong(item.originalText))) return json(res, 413, { error: `WS 备份中的消息原文超过 ${WS_MESSAGE_MAX_CHARS} 字符，未恢复且现有数据未修改。` });
      if (messages.some(item => !conversationIds.has(wsText(item.conversationId, 160)) || !WS_DIRECTIONS.has(wsText(item.direction, 16)) || !wsMessageText(item.originalText).trim())) return json(res, 400, { error: 'WS 备份中的消息格式无效。' });
      if (analyses.some(item => !conversationIds.has(wsText(item.conversationId, 160)))) return json(res, 400, { error: 'WS 备份中的 AI 分析关联无效。' });
      if (replies.some(item => !conversationIds.has(wsText(item.conversationId, 160)))) return json(res, 400, { error: 'WS 备份中的回复关联无效。' });
      if (batches.some(item => !conversationIds.has(wsText(item.conversationId, 160)) || !wsText(item.fingerprint, 160))) return json(res, 400, { error: 'WS 备份中的消息批次关联或指纹无效。' });
      const messageIds = new Set(messages.map(item => wsText(item.id, 160)).filter(Boolean));
      if (messageIds.size !== messages.filter(item => wsText(item.id, 160)).length) return json(res, 400, { error: 'WS 备份中存在重复消息编号。' });
      const messageExternalKeys = messages.map(item => { const externalId = wsText(item.externalId, 200); return externalId ? `${wsText(item.conversationId, 160)}\u0000${externalId}` : ''; }).filter(Boolean);
      if (new Set(messageExternalKeys).size !== messageExternalKeys.length) return json(res, 400, { error: 'WS 备份中同一会话存在重复外部消息标识。' });
      const replyIds = new Set(replies.map(item => wsText(item.id, 160)).filter(Boolean));
      if (replyIds.size !== replies.filter(item => wsText(item.id, 160)).length) return json(res, 400, { error: 'WS 备份中存在重复回复编号。' });
      const replyIdempotencyKeys = replies.map(item => { const key = wsText(item.idempotencyKey, 160); return key ? `${wsText(item.conversationId, 160)}\u0000${key}` : ''; }).filter(Boolean);
      if (new Set(replyIdempotencyKeys).size !== replyIdempotencyKeys.length) return json(res, 400, { error: 'WS 备份中同一会话存在重复回复幂等键。' });
      const batchIds = new Set(batches.map(item => wsText(item.id, 160)).filter(Boolean));
      if (batchIds.size !== batches.filter(item => wsText(item.id, 160)).length) return json(res, 400, { error: 'WS 备份中存在重复批次编号。' });
      const batchKeys = batches.map(item => `${wsText(item.conversationId, 160)}\u0000${wsText(item.fingerprint, 160)}`);
      if (new Set(batchKeys).size !== batchKeys.length) return json(res, 400, { error: 'WS 备份中同一会话存在重复批次指纹。' });
      if (batches.some(item => Object.hasOwn(item, 'messageIds') && (!Array.isArray(item.messageIds) || item.messageIds.some(id => !messageIds.has(wsText(id, 160)))))) return json(res, 400, { error: 'WS 备份中的消息批次引用了不存在的消息。' });
      const collectionRunIds = new Set(collectionRuns.map(item => wsText(item.id, 160)).filter(Boolean));
      if (collectionRuns.some(item => !wsText(item.id, 160)) || collectionRunIds.size !== collectionRuns.length) return json(res, 400, { error: 'WS 备份中的采集任务编号缺失或重复。' });
      const analysisIds = new Set(analyses.map(item => wsText(item.id, 160)).filter(Boolean));
      if (analysisIds.size !== analyses.filter(item => wsText(item.id, 160)).length) return json(res, 400, { error: 'WS 备份中的 AI 分析编号重复。' });
      const collectionItemIds = new Set(collectionItems.map(item => wsText(item.id, 160)).filter(Boolean));
      if (collectionItemIds.size !== collectionItems.filter(item => wsText(item.id, 160)).length) return json(res, 400, { error: 'WS 备份中的采集项目编号重复。' });
      const alertIds = new Set(followupAlerts.map(item => wsText(item.id, 160)).filter(Boolean));
      if (alertIds.size !== followupAlerts.filter(item => wsText(item.id, 160)).length) return json(res, 400, { error: 'WS 备份中的跟进提醒编号重复。' });
      const collectionItemKeys = collectionItems.map(item => `${wsText(item.runId, 160)}\u0000${wsText(item.conversationId, 160)}`);
      if (new Set(collectionItemKeys).size !== collectionItemKeys.length) return json(res, 400, { error: 'WS 备份中同一采集任务存在重复会话项目。' });
      if (collectionItems.some(item => !collectionRunIds.has(wsText(item.runId, 160)) || !conversationIds.has(wsText(item.conversationId, 160)))) return json(res, 400, { error: 'WS 备份中的采集项目关联无效。' });
      if (followupAlerts.some(item => !conversationIds.has(wsText(item.conversationId, 160)) || !wsText(item.alertKey, 240) || (wsText(item.analysisId, 160) && !analysisIds.has(wsText(item.analysisId, 160))))) return json(res, 400, { error: 'WS 备份中的跟进提醒关联无效。' });
      const alertKeys = followupAlerts.map(item => wsText(item.alertKey, 240));
      if (new Set(alertKeys).size !== alertKeys.length) return json(res, 400, { error: 'WS 备份中存在重复跟进提醒标识。' });
      const knownGroups = db.prepare('SELECT id,external_id,data_json FROM ws_conversations WHERE account_id=?').all(accountId).filter(wsCore.isGroupConversation);
      const vipGroupExternalIds = new Set(knownGroups.filter(wsIsVipGroup).map(row => row.external_id));
      const vipGroupIds = new Set(knownGroups.filter(wsIsVipGroup).map(row => row.id));
      const groupExternalIds = new Set(knownGroups.filter(wsIsExcludedGroup).map(row => row.external_id));
      const groupIds = new Set(knownGroups.filter(wsIsExcludedGroup).map(row => row.id));
      db.exec('BEGIN IMMEDIATE');
      try {
        db.prepare('DELETE FROM ws_followup_alerts WHERE account_id=?').run(accountId);
        db.prepare('DELETE FROM ws_collection_items WHERE account_id=?').run(accountId);
        db.prepare('DELETE FROM ws_collection_runs WHERE account_id=?').run(accountId);
        db.prepare('DELETE FROM ws_ingest_batches WHERE account_id=?').run(accountId);
        db.prepare('DELETE FROM ws_messages WHERE account_id=?').run(accountId);
        db.prepare('DELETE FROM ws_ai_analyses WHERE account_id=?').run(accountId);
        db.prepare('DELETE FROM ws_replies WHERE account_id=?').run(accountId);
        db.prepare('DELETE FROM ws_settings WHERE account_id=?').run(accountId);
        db.prepare('DELETE FROM ws_conversations WHERE account_id=?').run(accountId);
        const now = new Date().toISOString();
        const addConversation = db.prepare('INSERT INTO ws_conversations(id,account_id,external_id,title,customer_id,last_message_text,intent_level,data_json,created_at,updated_at,last_message_at,unread_count,language) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)');
        for (const item of conversations) {
          const type = vipGroupExternalIds.has(wsText(item.externalId, 160)) || vipGroupIds.has(wsText(item.id, 160))
            ? 'vip_group'
            : groupExternalIds.has(wsText(item.externalId, 160)) || groupIds.has(wsText(item.id, 160))
              ? 'group'
              : wsCore.conversationType(item);
          const data = { ...wsObject(item.data, 32 * 1024), ...(type !== 'unknown' ? {conversationType:type, isGroup:['group','vip_group'].includes(type), vipGroup:type === 'vip_group'} : {}) };
          const lastMessage = wsText(item.lastMessageText, 4000);
          addConversation.run(wsText(item.id, 160), accountId, wsText(item.externalId, 160), wsText(item.title, 200), type === 'vip_group' ? '' : wsText(item.customerId, 128), lastMessage, wsText(item.intentLevel, 40), JSON.stringify(data), wsIso(item.createdAt || now), wsIso(item.updatedAt || now), item.lastMessageAt ? wsIso(item.lastMessageAt) : (lastMessage ? wsIso(item.updatedAt || now) : ''), Math.max(0, Math.floor(Number(item.unreadCount) || 0)), wsText(item.language, 40));
        }
        const addSetting = db.prepare('INSERT INTO ws_settings(conversation_id,account_id,enabled,receive_enabled,send_enabled,target_language,send_language,show_original,ai_enabled,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)');
        for (const item of settings) addSetting.run(wsText(item.conversationId, 160), accountId, item.enabled === false ? 0 : 1, item.receive === false ? 0 : 1, item.send === false ? 0 : 1, wsText(item.targetLanguage, 40) || '中文', wsText(item.sendLanguage, 40), item.showOriginal === false ? 0 : 1, item.aiEnabled === false ? 0 : 1, WS_STATUSES.has(wsText(item.status, 32)) ? wsText(item.status, 32) : '未连接', wsIso(item.createdAt || now), wsIso(item.updatedAt || now));
        const addMessage = db.prepare('INSERT INTO ws_messages(id,account_id,conversation_id,external_id,direction,original_text,translated_text,source_language,target_language,order_no,data_json,created_at,updated_at,translation_status,translation_error,translation_attempts,last_attempt_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
        for (const item of messages) {
          const translation = wsTranslationFields(item);
          const rawData = wsObject(item.data, 32 * 1024);
          const hasTimestampMetadata = rawData.source === 'ws-webview2'
            || ['sentAt','observedAt','timestampText','timestampSource','sentAtKnown'].some(key => Object.hasOwn(rawData, key))
            || Boolean(item.sentAt || item.observedAt || item.timestampText || item.timestampSource)
            || item.sentAtKnown === true;
          const time = wsMessageTimeMetadata({ ...item, data: rawData }, item.observedAt || rawData.observedAt || item.createdAt || now);
          const data = hasTimestampMetadata ? wsMessageDataWithTime(rawData, time) : rawData;
          const createdAt = rawData.source === 'ws-webview2' && time.sentAtKnown ? time.sentAt : wsIso(item.createdAt || now);
          addMessage.run(wsText(item.id, 160) || wsCreateId('wsm'), accountId, wsText(item.conversationId, 160), wsText(item.externalId, 200), wsText(item.direction, 16), wsMessageText(item.originalText), translation.translatedText, wsText(item.sourceLanguage, 40), wsText(item.targetLanguage, 40), Number.isFinite(Number(item.order)) ? Number(item.order) : 0, JSON.stringify(data), createdAt, wsIso(item.updatedAt || now), translation.translationStatus, translation.translationError, translation.translationAttempts, translation.lastAttemptAt);
        }
        const addAnalysis = db.prepare('INSERT INTO ws_ai_analyses(id,account_id,conversation_id,result_json,confidence,provider_name,model,error_message,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)');
        for (const item of analyses) addAnalysis.run(wsText(item.id, 160) || wsCreateId('wsa'), accountId, wsText(item.conversationId, 160), JSON.stringify(wsObject(item.result, 128 * 1024)), Math.min(1, Math.max(0, Number(item.confidence) || 0)), wsText(item.providerName, 120), wsText(item.model, 120), wsText(item.errorMessage, 1000), wsIso(item.createdAt || now), wsIso(item.updatedAt || now));
        const addReply = db.prepare('INSERT INTO ws_replies(id,account_id,conversation_id,original_text,translated_text,status,created_at,updated_at,idempotency_key) VALUES(?,?,?,?,?,?,?,?,?)');
        for (const item of replies) addReply.run(wsText(item.id, 160) || wsCreateId('wsr'), accountId, wsText(item.conversationId, 160), wsText(item.originalText, 12000), wsText(item.translatedText, 12000), WS_REPLY_STATUSES.has(wsText(item.status, 16)) ? wsText(item.status, 16) : 'draft', wsIso(item.createdAt || now), wsIso(item.updatedAt || now), wsText(item.idempotencyKey, 160));
        const addBatch = db.prepare('INSERT INTO ws_ingest_batches(id,account_id,conversation_id,fingerprint,message_count,inserted_count,message_ids_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)');
        for (const item of batches) { const ids = Array.isArray(item.messageIds) ? item.messageIds.map(id => wsText(id, 160)).filter(id => messageIds.has(id)) : []; addBatch.run(wsText(item.id, 160) || wsCreateId('wsb'), accountId, wsText(item.conversationId, 160), wsText(item.fingerprint, 160), Math.max(0, Math.floor(Number(item.messageCount) || ids.length)), Math.max(0, Math.floor(Number(item.insertedCount) || 0)), JSON.stringify(ids), wsIso(item.createdAt || now), wsIso(item.updatedAt || now)); }
         const addRun = db.prepare('INSERT INTO ws_collection_runs(id,account_id,status,total,discovered,completed,analyzing,analyzed,failed,skipped,retryable,last_error,checkpoint,cursor,resume_count,last_success_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
         for (const item of collectionRuns) addRun.run(wsText(item.id, 160), accountId, wsText(item.status, 30) || 'created', Math.max(0, Math.floor(Number(item.total) || 0)), Math.max(0, Math.floor(Number(item.discovered) || 0)), Math.max(0, Math.floor(Number(item.completed) || 0)), Math.max(0, Math.floor(Number(item.analyzing) || 0)), Math.max(0, Math.floor(Number(item.analyzed) || 0)), Math.max(0, Math.floor(Number(item.failed) || 0)), Math.max(0, Math.floor(Number(item.skipped) || 0)), Math.max(0, Math.floor(Number(item.retryable) || 0)), wsText(item.lastError, 1000), wsText(item.checkpoint, 500), wsText(item.cursor, 500), Math.max(0, Math.floor(Number(item.resumeCount) || 0)), wsText(item.lastSuccessAt, 80), wsIso(item.createdAt || now), wsIso(item.updatedAt || now));
         const addItem = db.prepare('INSERT INTO ws_collection_items(id,account_id,run_id,conversation_id,status,attempts,analysis_status,followup_status,next_followup_at,last_error,checkpoint,created_at,updated_at,coverage_status) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
         for (const item of collectionItems) addItem.run(wsText(item.id, 160) || wsCreateId('wsi'), accountId, wsText(item.runId, 160), wsText(item.conversationId, 160), wsText(item.status, 30) || 'queued', Math.max(0, Math.floor(Number(item.attempts) || 0)), wsText(item.analysisStatus, 30) || 'pending', wsText(item.followupStatus, 30) || 'none', wsText(item.nextFollowupAt, 80), wsText(item.lastError, 1000), wsText(item.checkpoint, 500), wsIso(item.createdAt || now), wsIso(item.updatedAt || now), wsText(item.coverageStatus, 30) || 'unknown');
         const addAlert = db.prepare('INSERT INTO ws_followup_alerts(id,account_id,conversation_id,analysis_id,alert_key,priority,reason,followup_time,status,snoozed_until,data_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)');
         for (const item of followupAlerts) addAlert.run(wsText(item.id, 160) || wsCreateId('wfa'), accountId, wsText(item.conversationId, 160), wsText(item.analysisId, 160), wsText(item.alertKey, 240), wsText(item.priority, 20) || 'today', wsText(item.reason, 500), wsText(item.followupTime, 80), wsText(item.status, 20) || 'open', wsText(item.snoozedUntil, 80), JSON.stringify(wsObject(item.data, 32 * 1024)), wsIso(item.createdAt || now), wsIso(item.updatedAt || now));
        for (const row of db.prepare('SELECT * FROM ws_conversations WHERE account_id=?').all(accountId)) if (wsIsExcludedGroup(row)) wsQuiesceGroup(row, now);
        db.exec('COMMIT');
      } catch (error) { db.exec('ROLLBACK'); throw error; }
      return json(res, 200, { ok: true, schemaVersion: 6, counts: { settings: settings.length, conversations: conversations.length, messages: messages.length, analyses: analyses.length, replies: replies.length, batches: batches.length, collectionRuns: collectionRuns.length, collectionItems: collectionItems.length, followupAlerts: followupAlerts.length } });
    }
    const hotProfileMatch = url.pathname.match(/^\/api\/(?:ws\/)?hot-chat\/profile(?:\/(facts|confirm|events|diagnostics|sync-retry))?$/);
    if (hotProfileMatch) {
      const subpath = hotProfileMatch[1] || '';
      if (req.method === 'GET' && (subpath === '' || subpath === 'diagnostics')) {
        const identity = hotProfileIdentity({ customerId: url.searchParams.get('customerId'), accountId: url.searchParams.get('accountId'), conversationId: url.searchParams.get('conversationId') });
        wsRequireAccount(identity.accountId);
        const knownConversation = identity.conversationId ? db.prepare('SELECT account_id FROM ws_conversations WHERE id=?').get(identity.conversationId) : null;
        if (knownConversation && String(knownConversation.account_id || 'default') !== identity.accountId) return json(res, 409, { error: 'WS 会话属于另一个账号。' });
        if (knownConversation) wsRequireConversation(identity.conversationId, identity.accountId);
        const row = hotProfileRow(identity);
        const profile = row ? hotProfilePayload(row) : hotProfileDefaultPayload(identity);
        if (subpath === 'diagnostics') {
          const events = row ? db.prepare('SELECT * FROM hot_chat_events WHERE profile_id=? ORDER BY created_at DESC,id DESC LIMIT 100').all(row.id).map(item => ({ id: item.id, type: item.event_type, payload: wsJson(item.payload_json, {}), source: item.source, analysisId: item.analysis_id, idempotencyKey: item.idempotency_key, createdAt: item.created_at })) : [];
          const outbox = row ? db.prepare('SELECT * FROM hot_chat_sync_outbox WHERE profile_id=? ORDER BY created_at DESC,id DESC').all(row.id).map(hotOutboxPayload) : [];
          return json(res, 200, { profile, events, outbox: { count: outbox.length, pending: outbox.filter(item => item.status === 'pending').length, rows: outbox } });
        }
        return json(res, 200, { profile, version: readStateEnvelope().version });
      }
      if (req.method !== 'PUT' && req.method !== 'POST') return json(res, 405, { error: '热聊档案仅支持 GET/PUT/POST。' });
      const versionFailure = stateVersionFailure(req);
      if (versionFailure) return json(res, versionFailure.status, versionFailure.body);
      const body = JSON.parse((await readBody(req, 512 * 1024)).toString('utf8') || '{}');
      const identity = hotProfileIdentity(body);
      wsRequireAccount(identity.accountId);
      const knownConversation = identity.conversationId ? db.prepare('SELECT account_id FROM ws_conversations WHERE id=?').get(identity.conversationId) : null;
      if (knownConversation && String(knownConversation.account_id || 'default') !== identity.accountId) return json(res, 409, { error: 'WS 会话属于另一个账号。' });
      if (knownConversation) wsRequireConversation(identity.conversationId, identity.accountId);
      db.exec('BEGIN IMMEDIATE');
      try {
        let row;
        if (subpath === 'sync-retry') {
          if (!identity.customerId && !identity.conversationId) { db.exec('ROLLBACK'); return json(res, 400, { error: '重试 outbox 必须指定客户或会话范围。' }); }
          const where = ['p.account_id=?', "o.status IN ('pending','failed')"], params = [identity.accountId];
          if (identity.customerId) { where.push('p.customer_id=?'); params.push(identity.customerId); }
          if (identity.conversationId) { where.push('p.conversation_id=?'); params.push(identity.conversationId); }
          const rows = db.prepare(`SELECT o.* FROM hot_chat_sync_outbox o JOIN hot_chat_profiles p ON p.id=o.profile_id WHERE ${where.join(' AND ')} ORDER BY o.created_at LIMIT 100`).all(...params);
          const now = new Date().toISOString();
          for (const item of rows) db.prepare("UPDATE hot_chat_sync_outbox SET status='pending',attempts=attempts+1,next_attempt_at=?,last_error='awaiting_external_delivery',updated_at=? WHERE id=?").run(now, now, item.id);
          bumpStateVersion(); db.exec('COMMIT');
          return json(res, 200, { retried: rows.length, outbox: rows.map(item => hotOutboxPayload({ ...item, status: 'pending', attempts: Number(item.attempts || 0) + 1, next_attempt_at: now, last_error: 'awaiting_external_delivery', updated_at: now })), version: readStateEnvelope().version });
        }
        row = ensureHotProfile(identity);
        if (subpath === 'events') {
          const idempotencyKey = wsText(body.idempotencyKey || body.eventId, 240);
          const existing = idempotencyKey ? db.prepare('SELECT * FROM hot_chat_events WHERE profile_id=? AND idempotency_key=?').get(row.id, idempotencyKey) : null;
          if (existing) { db.exec('COMMIT'); return json(res, 200, { event: { id: existing.id, type: existing.event_type, payload: wsJson(existing.payload_json, {}) }, existed: true, version: readStateEnvelope().version }); }
          const now = new Date().toISOString(), eventId = wsText(body.id, 160) || wsCreateId('hce');
          db.prepare('INSERT INTO hot_chat_events(id,profile_id,customer_id,account_id,conversation_id,event_type,payload_json,source,analysis_id,idempotency_key,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(eventId, row.id, identity.customerId, identity.accountId, identity.conversationId, wsText(body.type || body.eventType, 80) || 'message', JSON.stringify(body.payload && typeof body.payload === 'object' ? body.payload : {}), wsText(body.source, 80) || 'AI', wsText(body.analysisId, 160), idempotencyKey, now);
          enqueueHotOutbox(row, eventId, body.payload || {}, 'event');
          bumpStateVersion(); db.exec('COMMIT');
          return json(res, 200, { event: { id: eventId, type: wsText(body.type || body.eventType, 80) || 'message', payload: body.payload || {}, createdAt: now }, existed: false, version: readStateEnvelope().version });
        }
        let updated = row;
        if (subpath === 'confirm' || subpath === 'facts' || req.method === 'PUT') {
          const confirmKey = subpath === 'confirm' ? wsText(body.idempotencyKey || body.eventId, 240) : '';
          if (confirmKey) {
            const priorEvent = db.prepare("SELECT * FROM hot_chat_events WHERE profile_id=? AND idempotency_key=? AND event_type IN ('fact_confirmed','fact_rejected')").get(row.id, confirmKey);
            if (priorEvent) { db.exec('COMMIT'); return json(res, 200, { profile: hotProfilePayload(row), existed: true, version: readStateEnvelope().version }); }
          }
          const facts = subpath === 'confirm' && body.field
            ? [hotChatProfile.normalizeProfileFact(body.field, { ...body, state: body.declined ? 'declined' : 'known' })]
            : normalizeHotFacts(body);
          const profileOptions = { allowManual: subpath === 'confirm', manualColor: body.manualColor ?? body.color, statusColor: body.statusColor };
          for (const key of ['conversationProgress', 'customerTemperature', 'profileSummary', 'nextTopics', 'noReply', 'nextFollowupAt', 'tags']) {
            if (Object.hasOwn(body, key)) profileOptions[key] = body[key];
          }
          if (subpath === 'confirm') profileOptions.manualLocked = body.locked !== false;
          updated = saveHotProfile(identity, facts, profileOptions);
          const eventId = wsCreateId('hce');
          db.prepare('INSERT INTO hot_chat_events(id,profile_id,customer_id,account_id,conversation_id,event_type,payload_json,source,analysis_id,idempotency_key,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(eventId, updated.id, identity.customerId, identity.accountId, identity.conversationId, subpath === 'confirm' ? (body.declined ? 'fact_rejected' : 'fact_confirmed') : 'facts_updated', JSON.stringify({ facts }), wsText(body.source, 80) || 'operator', wsText(body.analysisId, 160), confirmKey || wsText(body.idempotencyKey, 240), new Date().toISOString());
          enqueueHotOutbox(updated, eventId, { facts }, 'profile');
          bumpStateVersion();
        }
        db.exec('COMMIT');
        return json(res, 200, { profile: hotProfilePayload(updated), version: readStateEnvelope().version });
      } catch (error) { db.exec('ROLLBACK'); throw error; }
    }
    const governanceProfileMatch = url.pathname.match(/^\/api\/data-governance\/customers\/([^/]+)\/profile$/);
    if (req.method === 'GET' && governanceProfileMatch) {
      const customerId = decodeURIComponent(governanceProfileMatch[1]);
      const state = governanceState();
      const customer = governanceCustomer(state, customerId);
      if (!customer) return json(res, 404, { error: '客户不存在。' });
      const evidence = db.prepare('SELECT * FROM ai_customer_field_evidence WHERE customer_id=? ORDER BY updated_at DESC,id DESC').all(customerId).map(governanceEvidencePayload);
      const actions = db.prepare('SELECT * FROM customer_governance_actions WHERE customer_id=? ORDER BY created_at DESC,id DESC LIMIT 100').all(customerId).map(governanceActionPayload);
      return json(res, 200, { customer, evidence, actions, conflicts: evidence.filter(item => item.status === 'conflict') });
    }
    const governanceAuditPath = url.pathname === '/api/data-governance/audit';
    if (req.method === 'GET' && governanceAuditPath) {
      const customerId = wsText(url.searchParams.get('customerId'), 128);
      const action = wsText(url.searchParams.get('action'), 32);
      const limit = Math.min(200, Math.max(1, Number(url.searchParams.get('limit')) || 50));
      const offset = Math.max(0, Math.floor(Number(url.searchParams.get('offset')) || 0));
      const where = [], params = [];
      if (customerId) { where.push('customer_id=?'); params.push(customerId); }
      if (action) { where.push('action=?'); params.push(action); }
      const clause = where.length ? ` WHERE ${where.join(' AND ')}` : '';
      const rows = db.prepare(`SELECT * FROM customer_governance_actions${clause} ORDER BY created_at DESC,id DESC LIMIT ${limit} OFFSET ${offset}`).all(...params).map(governanceActionPayload);
      const total = Number(db.prepare(`SELECT COUNT(*) AS count FROM customer_governance_actions${clause}`).get(...params).count || 0);
      const conflicts = db.prepare(`SELECT * FROM ai_customer_field_evidence WHERE status='conflict'${customerId ? ' AND customer_id=?' : ''} ORDER BY updated_at DESC,id DESC LIMIT ${limit} OFFSET ${offset}`).all(...(customerId ? [customerId] : [])).map(governanceEvidencePayload);
      return json(res, 200, { actions: rows, conflicts, total, limit, offset });
    }
    const softDeleteMatch = url.pathname.match(/^\/api\/data-governance\/customers\/([^/]+)\/soft-delete$/);
    if (req.method === 'POST' && softDeleteMatch) {
      const versionFailure = stateVersionFailure(req);
      if (versionFailure) return json(res, versionFailure.status, versionFailure.body);
      const customerId = decodeURIComponent(softDeleteMatch[1]);
      const body = JSON.parse((await readBody(req, 64 * 1024)).toString('utf8') || '{}');
      const state = governanceState();
      const customer = governanceCustomer(state, customerId);
      if (!customer) return json(res, 404, { error: '客户不存在。' });
      if (customer.deleted) return json(res, 200, { ok: true, changed: false, customer });
      if (readState()) saveSnapshot('数据治理软删除前自动快照');
      const before = JSON.parse(JSON.stringify(customer));
      const now = new Date().toISOString();
      customer.deleted = true; customer.deletedAt = now; customer.deleteReason = wsText(body.reason || '数据治理软删除', 500);
      db.exec('BEGIN IMMEDIATE');
      try { writeState(state, false); recordGovernanceAction('soft_delete', customerId, before, customer, { source: wsText(body.source || '数据治理', 120), reason: customer.deleteReason, confidence: Number(body.confidence) || 0 }); db.exec('COMMIT'); }
      catch (error) { db.exec('ROLLBACK'); throw error; }
      return json(res, 200, { ok: true, changed: true, customer, revision: readStateEnvelope().version });
    }
    const restoreMatch = url.pathname.match(/^\/api\/data-governance\/customers\/([^/]+)\/restore$/);
    if (req.method === 'POST' && restoreMatch) {
      const versionFailure = stateVersionFailure(req);
      if (versionFailure) return json(res, versionFailure.status, versionFailure.body);
      const customerId = decodeURIComponent(restoreMatch[1]);
      const body = JSON.parse((await readBody(req, 64 * 1024)).toString('utf8') || '{}');
      const state = governanceState();
      const customer = governanceCustomer(state, customerId);
      if (!customer) return json(res, 404, { error: '客户不存在。' });
      if (!customer.deleted) return json(res, 200, { ok: true, changed: false, customer });
      if (readState()) saveSnapshot('数据治理恢复客户前自动快照');
      const before = JSON.parse(JSON.stringify(customer));
      customer.deleted = false; delete customer.deletedAt; delete customer.aiDeletedAt; delete customer.deleteReason; delete customer.aiDeleteReason;
      db.exec('BEGIN IMMEDIATE');
      try { writeState(state, false); recordGovernanceAction('restore', customerId, before, customer, { source: '数据治理', reason: wsText(body.reason || '恢复客户', 500) }); db.exec('COMMIT'); }
      catch (error) { db.exec('ROLLBACK'); throw error; }
      return json(res, 200, { ok: true, changed: true, customer, revision: readStateEnvelope().version });
    }
    if (req.method === 'POST' && url.pathname === '/api/data-governance/customers/batch-soft-delete') {
      const versionFailure = stateVersionFailure(req);
      if (versionFailure) return json(res, versionFailure.status, versionFailure.body);
      const body = JSON.parse((await readBody(req, 128 * 1024)).toString('utf8') || '{}');
      const ids = [...new Set((Array.isArray(body.customerIds) ? body.customerIds : []).map(item => wsText(item, 128)).filter(Boolean))];
      if (!ids.length) return json(res, 400, { error: '没有可删除的客户编号。' });
      if (ids.length > 500) return json(res, 413, { error: '单次最多软删除 500 位客户。' });
      const state = governanceState(), now = new Date().toISOString(), changed = [];
      const beforeRows = [];
      for (const id of ids) { const customer = governanceCustomer(state, id); if (!customer || customer.deleted) continue; beforeRows.push({ id, before: JSON.parse(JSON.stringify(customer)) }); customer.deleted = true; customer.deletedAt = now; customer.deleteReason = wsText(body.reason || '批量软删除', 500); changed.push(customer); }
      if (!changed.length) return json(res, 200, { ok: true, count: 0, customers: [] });
      if (readState()) saveSnapshot('数据治理批量软删除前自动快照');
      db.exec('BEGIN IMMEDIATE');
      try { writeState(state, false); for (const row of beforeRows) { const customer = governanceCustomer(state, row.id); recordGovernanceAction('soft_delete', row.id, row.before, customer, { source: wsText(body.source || '数据治理', 120), reason: customer.deleteReason }); } db.exec('COMMIT'); }
      catch (error) { db.exec('ROLLBACK'); throw error; }
      return json(res, 200, { ok: true, count: changed.length, customers: changed, revision: readStateEnvelope().version });
    }
    const purgeRequestMatch = url.pathname.match(/^\/api\/data-governance\/customers\/([^/]+)\/purge-request$/);
    if (req.method === 'POST' && purgeRequestMatch) {
      const versionFailure = stateVersionFailure(req);
      if (versionFailure) return json(res, versionFailure.status, versionFailure.body);
      const customerId = decodeURIComponent(purgeRequestMatch[1]);
      const state = governanceState();
      if (!governanceCustomer(state, customerId)) return json(res, 404, { error: '客户不存在。' });
      const token = randomBytes(24).toString('hex');
      const hash = createHash('sha256').update(token).digest('hex');
      const now = new Date().toISOString();
      if (readState()) saveSnapshot('数据治理永久删除申请前自动快照');
      db.exec('BEGIN IMMEDIATE');
      try {
        db.prepare("UPDATE customer_delete_requests SET status='cancelled' WHERE customer_id=? AND mode='purge' AND status='pending'").run(customerId);
        db.prepare('INSERT INTO customer_delete_requests(id,customer_id,mode,confirmation_token_hash,status,requested_at,confirmed_at,created_at) VALUES(?,?,?,?,?,?,?,?)').run(governanceActionId(), customerId, 'purge', hash, 'pending', now, '', now);
        db.exec('COMMIT');
      } catch (error) { db.exec('ROLLBACK'); throw error; }
      return json(res, 200, { ok: true, customerId, confirmationToken: token, expiresInSeconds: 900 });
    }
    const purgeConfirmMatch = url.pathname.match(/^\/api\/data-governance\/customers\/([^/]+)\/purge-confirm$/);
    if (req.method === 'POST' && purgeConfirmMatch) {
      const versionFailure = stateVersionFailure(req);
      if (versionFailure) return json(res, versionFailure.status, versionFailure.body);
      const customerId = decodeURIComponent(purgeConfirmMatch[1]);
      const body = JSON.parse((await readBody(req, 64 * 1024)).toString('utf8') || '{}');
      const token = wsText(body.confirmationToken, 200);
      const hash = createHash('sha256').update(token).digest('hex');
      if (readState()) saveSnapshot('数据治理永久删除前自动快照');
      const now = new Date().toISOString();
      db.exec('BEGIN IMMEDIATE');
      try {
        const requestRow = db.prepare("SELECT * FROM customer_delete_requests WHERE customer_id=? AND mode='purge' AND confirmation_token_hash=? AND status='pending' ORDER BY created_at DESC LIMIT 1").get(customerId, hash);
        if (!requestRow) { db.exec('ROLLBACK'); return json(res, 409, { error: '永久删除确认令牌无效、已使用或已取消。' }); }
        const requestedAt = Date.parse(requestRow.requested_at || '');
        if (!Number.isFinite(requestedAt) || Date.now() - requestedAt > 15 * 60 * 1000) {
          db.prepare("UPDATE customer_delete_requests SET status='expired' WHERE id=? AND status='pending'").run(requestRow.id);
          db.exec('COMMIT');
          return json(res, 409, { error: '永久删除确认令牌已过期，请重新申请。' });
        }
        const state = governanceState(), customer = governanceCustomer(state, customerId);
        if (!customer) { db.exec('ROLLBACK'); return json(res, 404, { error: '客户不存在。' }); }
        const claimed = db.prepare("UPDATE customer_delete_requests SET status='confirmed',confirmed_at=? WHERE id=? AND status='pending'").run(now, requestRow.id);
        if (Number(claimed?.changes || 0) !== 1) { db.exec('ROLLBACK'); return json(res, 409, { error: '永久删除确认令牌已被其他操作使用。' }); }
        const before = JSON.parse(JSON.stringify(customer));
        state.customers = state.customers.filter(item => String(item.id) !== customerId);
        for (const key of ['tickets', 'deposits', 'followups', 'registrations']) state[key] = state[key].filter(item => String(item.customerId || '') !== customerId);
        state.settings.operatingTasks = state.settings.operatingTasks.filter(item => String(item.customerId || '') !== customerId);
        writeState(state, false);
        db.prepare("UPDATE ws_followup_alerts SET status='dismissed',updated_at=? WHERE conversation_id IN (SELECT id FROM ws_conversations WHERE customer_id=? )").run(now, customerId);
        db.prepare('UPDATE ws_conversations SET customer_id=?,updated_at=? WHERE customer_id=?').run('', now, customerId);
        recordGovernanceAction('purge', customerId, before, {}, { source: '数据治理', reason: wsText(body.reason || '永久删除客户', 500) });
        db.exec('COMMIT');
      } catch (error) { db.exec('ROLLBACK'); throw error; }
      return json(res, 200, { ok: true, customerId, removed: true, revision: readStateEnvelope().version });
    }
    if (req.method === 'GET' && url.pathname === '/api/state/version') {
      const row = db.prepare('SELECT revision FROM app_state WHERE id=1').get();
      return json(res, 200, { initialized: Boolean(row), version: row ? String(row.revision) : '' });
    }
    if (req.method === 'GET' && url.pathname === '/api/state') {
      const envelope = readStateEnvelope();
      const state = envelope.state;
      return json(res, 200, { ...(state || { customers: [], tickets: [], deposits: [], followups: [], settings: {}, activities: [], savedViews: [], channelAliases: {} }), initialized: Boolean(state), version: envelope.version });
    }
    if ((req.method === 'PUT' || req.method === 'POST') && url.pathname === '/api/state') {
      let value = JSON.parse((await readBody(req, 100 * 1024 * 1024)).toString('utf8'));
      const expectedVersion = req.headers['x-state-version'];
      if (expectedVersion === undefined) return json(res, 428, { error: '保存必须提供数据版本，请刷新后重试。' });
      const currentVersion = readStateEnvelope().version;
      if (expectedVersion !== undefined && String(expectedVersion) !== currentVersion) return json(res, 409, { error: '共享数据已在其他窗口更新，请先同步后再保存。', version: currentVersion });
      const delta = req.headers['x-zhike-state-format'] === 'delta-v1' ? value : null;
      if (delta) value = applyDelta(readState(), delta);
      writeState(value, true, delta);
      return json(res, 200, { ok: true, customers: value.customers.length, version: readStateEnvelope().version });
    }
    if (req.method === 'GET' && url.pathname === '/api/snapshots') {
      const retention = Math.min(100, Math.max(1, Number(readState()?.settings?.snapshotRetention) || 20));
      const snapshots = db.prepare(`SELECT id,created_at,reason,json FROM state_snapshots ORDER BY id DESC LIMIT ${retention}`).all().map(row => ({ id: row.id, createdAt: row.created_at, reason: row.reason, customers: JSON.parse(row.json).customers?.length || 0, phoneRegistry: JSON.parse(row.json).phoneRegistry?.length || 0, registrations: JSON.parse(row.json).registrations?.length || 0, businessRecords: (JSON.parse(row.json).tickets?.length || 0) + (JSON.parse(row.json).deposits?.length || 0) }));
      return json(res, 200, { snapshots });
    }
    const restoreSnapshotMatch = url.pathname.match(/^\/api\/snapshots\/(\d+)\/restore$/);
    if (req.method === 'POST' && restoreSnapshotMatch) {
      const expectedVersion = req.headers['x-state-version'];
      if (expectedVersion === undefined) return json(res, 428, { error: '恢复必须提供数据版本，请刷新后重试。' });
      const currentVersion = readStateEnvelope().version;
      if (expectedVersion !== undefined && String(expectedVersion) !== currentVersion) return json(res, 409, { error: '共享数据已在其他窗口更新，请先同步后再恢复快照。', version: currentVersion });
      const snapshot = db.prepare('SELECT json FROM state_snapshots WHERE id=?').get(Number(restoreSnapshotMatch[1]));
      if (!snapshot) return json(res, 404, { error: '找不到该本机快照。' });
      const value = JSON.parse(snapshot.json);
      try { validateState(value); } catch (error) { return json(res, 400, { error: `快照数据格式异常：${error.message}` }); }
      saveSnapshot('恢复快照前自动保存当前工作区');
      writeState(value);
      return json(res, 200, { ok: true, customers: value.customers.length, version: readStateEnvelope().version });
    }
    if (req.method === 'POST' && url.pathname === '/api/snapshot') {
      const bodyBytes = await readBody(req, 1024 * 1024);
      const body = bodyBytes.length ? JSON.parse(bodyBytes.toString('utf8')) : {};
      return json(res, 200, { ok: true, snapshotCreated: saveSnapshot(String(body.reason || '用户恢复备份前自动快照').slice(0, 120)) });
    }
    if (req.method === 'GET' && url.pathname === '/api/diagnostics') return json(res, 200, databaseDiagnostics());
    if (req.method === 'GET' && url.pathname === '/api/health') {
      return json(res, 200, {
        ok: true,
        appVersion: APP_VERSION,
        schemaVersion: Number(db.prepare('SELECT COALESCE(MAX(version), 0) AS version FROM schema_migrations').get()?.version || 0),
        databaseStatus: 'healthy',
        workerStatus: 'running',
        storage: 'sqlite',
        workspace: root,
      });
    }

    const requestPath = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
    if (requestPath === '/modules/customer-governance-ui.js') {
      const governanceUiPath = resolve(root, `.${normalize(requestPath)}`);
      if (!governanceUiPath.startsWith(root + sep) || !existsSync(governanceUiPath)) return json(res, 404, { error: '文件不存在。' });
      const body = readFileSync(governanceUiPath);
      res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Content-Length': body.length, 'Cache-Control': 'no-store' });
      res.end(body);
      return;
    }
    if (requestPath === '/modules/design-system.css') {
      const designPath = resolve(root, `.${normalize(requestPath)}`);
      if (!designPath.startsWith(root + sep) || !existsSync(designPath)) return json(res, 404, { error: '文件不存在。' });
      const body = readFileSync(designPath);
      res.writeHead(200, { 'Content-Type': 'text/css; charset=utf-8', 'Content-Length': body.length, 'Cache-Control': 'no-store' });
      res.end(body);
      return;
    }
    if (!['/modules/productivity.js', '/modules/performance-enhancements.js', '/modules/desktop-performance.js', '/modules/smart-import.js', '/modules/business-rule-core.js', '/modules/business-enhancements.js', '/modules/business-enhancements.css', '/modules/accessibility-enhancements.js', '/modules/operations-upgrade.js', '/modules/operations-upgrade.css', '/modules/ui-refresh.css', '/modules/horizon-atelier.css', '/modules/business-6.css', '/modules/operations-6.css', '/modules/global-6.css', '/modules/home-6.css', '/modules/scroll-system.css', '/modules/scroll-coordinator.js', '/modules/desktop-host.js', '/assets/zhike-horizon-logo.png', '/assets/horizon-ridge-6.png', '/assets/horizon-flow-6.png', '/assets/horizon-topline-6.png', '/assets/horizon-rock-6.png', '/assets/horizon-sidebar-shell-6.svg', '/index.html', '/styles.css', '/app.js', '/vendor/xlsx/xlsx.js', '/modules/v4-data-center.js', '/modules/v4.css', '/modules/gpt-assistant.js', '/modules/runtime-customizer.js', '/modules/gpt-assistant.css', '/modules/gpt-workbench.css', '/modules/gpt-modern.css', '/modules/gpt-management.css', '/modules/phone-registry.js', '/modules/phone-registry.css', '/modules/v41-ui.css', '/modules/operations-core.cjs', '/modules/operations-ui.js', '/modules/ticket-record-core.js', '/modules/ws-workbench-core.js', '/modules/ws-crm-sync-core.js', '/modules/hot-chat-profile-core.js', '/modules/ws-workbench.js', '/modules/ws-workbench.css'].includes(requestPath)) return json(res, 404, { error: '文件不存在。' });
    const filePath = resolve(root, `.${normalize(requestPath)}`);
    if (!filePath.startsWith(root + sep) || !existsSync(filePath) || !statSync(filePath).isFile()) return json(res, 404, { error: '文件不存在。' });
    const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.cjs': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png' };
    res.writeHead(200, { 'Content-Type': types[extname(filePath)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    if (filePath.endsWith('index.html')) {
      let html = await (await import('node:fs/promises')).readFile(filePath, 'utf8');
      const desktopFlag = process.env.ZHIKE_DESKTOP_APP === '1' ? ';window.__DESKTOP_APP__=true' : '';
      html = html.replace('</head>', `<script>window.__LOCAL_DB__=true${desktopFlag}</script></head>`);
      res.end(html);
    } else createReadStream(filePath).pipe(res);
  } catch (error) {
    json(res, error.status || 400, { error: error.message || '本地操作失败。', ...(error.code ? {code:error.code} : {}) });
  }
});

function startListening(nextPort) {
  port = nextPort;
  server.listen(port, '127.0.0.1');
}
server.on('listening', () => {
  const url = `http://127.0.0.1:${port}`;
  console.log(`知客离线工作台已启动：${url}`);
  console.log(`SQLite 数据库：${dbPath}`);
  if (process.env.ZHIKE_OPEN_BROWSER === '1') console.warn('网页版入口已停用：请使用知客桌面应用，普通浏览器不会获得本机 API 会话授权。');
  if (parentProcessId > 0 && !parentMonitor) {
    parentMonitor = setInterval(() => {
      try { process.kill(parentProcessId, 0); }
      catch { server.close(() => process.exit(0)); }
    }, 5000);
    parentMonitor.unref?.();
  }
});
server.on('error', error => {
  // Do not silently move to another port.  The desktop owner waits on the
  // exact port it assigned and retries the complete startup handshake when a
  // race or stale process has claimed it; changing ports here causes a false
  // bridge timeout and leaves an orphan sidecar behind.
  console.error(`本地服务无法启动：${error.message}`);
  process.exit(1);
});
startListening(port);
server.on('close', () => { if (parentMonitor) clearInterval(parentMonitor); db.close(); releaseWorkspaceLock(); });
process.on('SIGINT', () => server.close(() => process.exit(0)));
process.on('SIGTERM', () => server.close(() => process.exit(0)));
