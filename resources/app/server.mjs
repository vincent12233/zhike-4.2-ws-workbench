import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { closeSync, createReadStream, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { basename, dirname, extname, join, normalize, resolve, sep } from 'node:path';
import { hostname, tmpdir, uptime } from 'node:os';
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';

const require = createRequire(import.meta.url);
const { applyDelta } = require('./state-delta.cjs');
const { DatabaseSync } = require('node:sqlite');
const root = dirname(fileURLToPath(import.meta.url));
const configuredDataDir = String(process.env.ZHIKE_DATA_DIR || '').trim();
const dataDir = configuredDataDir ? resolve(configuredDataDir) : join(root, 'data');
const dbPath = join(dataDir, 'workspace.sqlite');
const lockPath = join(dataDir, '.workbench.lock');
const lockToken = randomUUID();
const runtimeHost = hostname();
const bootTime = Math.floor(Date.now() / 1000 - uptime());
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

function databaseDiagnostics() {
  const integrity = db.prepare('PRAGMA integrity_check').all().map(row => Object.values(row)[0]);
  const quickCheck = db.prepare('PRAGMA quick_check').all().map(row => Object.values(row)[0]);
  const foreignKeys = db.prepare('PRAGMA foreign_key_check').all();
  const pageCount = Number(db.prepare('PRAGMA page_count').get().page_count || 0);
  const pageSize = Number(db.prepare('PRAGMA page_size').get().page_size || 0);
  const state = readState();
  const activeCustomers = (state?.customers || []).filter(customer => !customer.deleted);
  const duplicatePhones = activeCustomers.length - new Set(activeCustomers.map(customer => String(customer.phone || '')).filter(Boolean)).size;
  const activeIds = new Set(activeCustomers.map(customer => String(customer.id)));
  const orphaned = Object.fromEntries(['tickets','deposits','followups','registrations'].map(key => [key, (state?.[key] || []).filter(row => row.customerId && !activeIds.has(String(row.customerId))).length]));
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
  const current = readState();
  if (!current) return false;
  const retention = Math.min(100, Math.max(1, Number(current.settings?.snapshotRetention) || 20));
  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare('INSERT INTO state_snapshots(created_at,reason,json) VALUES(?,?,?)').run(new Date().toISOString(), reason, JSON.stringify(current));
    db.prepare('DELETE FROM state_snapshots WHERE id NOT IN (SELECT id FROM state_snapshots ORDER BY id DESC LIMIT ?)').run(retention);
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
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

function openLegacy(path) {
  const source = new DatabaseSync(path, { readOnly: true, enableForeignKeyConstraints: true });
  const tables = new Set(source.prepare('SELECT name FROM sqlite_master WHERE type=?').all('table').map(x => x.name));
  if (!tables.has('customers')) throw new Error('所选数据库没有可识别的客户表。');
  const columns = new Set(source.prepare('PRAGMA table_info(customers)').all().map(x => x.name));
  for (const needed of ['id', 'phone_raw', 'phone_normalized']) if (!columns.has(needed)) throw new Error(`旧数据库缺少必要字段：${needed}`);
  return { source, tables, columns };
}

function value(row, key, fallback = '') { return Object.hasOwn(row, key) && row[key] != null ? String(row[key]) : fallback; }
function cleanPhone(raw, normalized) {
  const standard = String(normalized || '').replace(/\D/g, '');
  if (standard) return standard;
  const digits = String(raw || '').replace(/\D/g, '');
  return digits.length === 12 && digits.startsWith('91') ? digits.slice(2) : digits;
}

function convertLegacy(path) {
  const { source, tables, columns } = openLegacy(path);
  try {
    const legacyRows = source.prepare('SELECT * FROM customers ORDER BY id').all();
    const customers = [];
    const idMap = new Map();
    const activeRows = legacyRows.filter(row => !Number(row.archived || 0) && !row.merged_into);
    for (const row of activeRows) {
      const id = `legacy-${row.id}`;
      idMap.set(String(row.id), id);
      const sourceSheet = value(row, 'source_sheet', '');
      const sourceType = /群粉/.test(sourceSheet) ? '群粉' : '单导';
      const rawPhone = value(row, 'phone_raw');
      const phone = cleanPhone(rawPhone, value(row, 'phone_normalized'));
      const customer = {
        id, name: value(row, 'customer_name').trim() || '未命名客户', rawPhone, phone,
        source: sourceType, page: '', importSource: sourceSheet,
        channel: value(row, 'channel', sourceType) || sourceType, assistant: value(row, 'assistant', '未分配') || '未分配',
        thirdParty: value(row, 'third_party_followup'), status: value(row, 'group_status', '未进群') || '未进群',
        phase: value(row, 'customer_stage', '新客户') || '新客户', qualification: value(row, 'qualification') || value(row, 'customer_value'),
        hot: /^(热聊|是|有)$/i.test(value(row, 'hot_chat_status').trim()), investor: /^(是|股民|有)$/i.test(value(row, 'is_investor').trim()),
        phoneFollowup: value(row, 'phone_followup'), group: value(row, 'group_code') || '—', vipGroup: value(row, 'vip_group'),
        age: value(row, 'age'), registered: value(row, 'registered_at').slice(0, 10), lastFollow: value(row, 'last_followup').slice(0, 10),
        due: value(row, 'next_followup').slice(0, 10), note: value(row, 'notes'), ticket: false, deposit: false, amount: 0,
        deleted: false, touched: Boolean(value(row, 'modified_fields', '[]') !== '[]'), importedFrom: '3.28.0',
        legacyFields: Object.fromEntries([...columns].filter(k => !['id'].includes(k)).map(k => [k, row[k] ?? null])),
      };
      customer.ticket = value(row, 'customer_stage') === '已跟票';
      customers.push(customer);
    }
    const customerByPhone = new Map();
    for (const customer of customers) if (customer.phone && !customerByPhone.has(customer.phone)) customerByPhone.set(customer.phone, customer);
    for (const row of legacyRows) {
      if (!row.merged_into) continue;
      const survivingId = idMap.get(String(row.merged_into));
      if (survivingId) idMap.set(String(row.id), survivingId);
    }
    const legacyById = new Map(legacyRows.map(row => [String(row.id), row]));

    const tickets = [];
    if (tables.has('stock_records')) {
      for (const row of source.prepare('SELECT * FROM stock_records ORDER BY id').all()) {
        const phone = cleanPhone(value(row, 'phone_raw'), value(row, 'phone_normalized'));
        const customer = customerByPhone.get(phone);
        tickets.push({ id: `legacy-stock-${row.id}`, customer: customer?.name || '', phone: value(row, 'phone_raw'), customerId: customer?.id || '', date: value(row, 'record_date'), channel: value(row, 'channel'), group: value(row, 'group_code') || '—', assistant: value(row, 'assistant'), product: value(row, 'stock_code'), shares: value(row, 'shares'), price: value(row, 'buy_price'), direction: '买入', note: value(row, 'notes'), status: '已确认' });
        if (customer) customer.ticket = true;
      }
    }
    const deposits = [];
    if (tables.has('deposits')) {
      for (const row of source.prepare('SELECT * FROM deposits ORDER BY id').all()) {
        const phone = cleanPhone(value(row, 'phone_raw'), value(row, 'phone_normalized'));
        const customer = customerByPhone.get(phone);
        const amount = Number(value(row, 'amount').replace(/[^\d.-]/g, '')) || 0;
        deposits.push({ id: `legacy-deposit-${row.id}`, customer: customer?.name || '', phone: value(row, 'phone_raw'), customerId: customer?.id || '', date: value(row, 'deposit_date'), channel: value(row, 'channel'), group: value(row, 'group_code') || '—', assistant: value(row, 'assistant'), amount, currency: 'INR', note: value(row, 'notes'), status: '已确认' });
        if (customer) { customer.deposit = true; customer.amount += amount; }
      }
    }
    const followups = [];
    if (tables.has('followup_history')) {
      for (const row of source.prepare('SELECT * FROM followup_history ORDER BY id').all()) {
        const legacyCustomer = legacyById.get(String(row.customer_id));
        const customerId = idMap.get(String(row.customer_id)) || '';
        followups.push({ id: `legacy-followup-${row.id}`, customerId, customer: value(legacyCustomer || {}, 'customer_name', '未关联客户'), phone: value(legacyCustomer || {}, 'phone_raw'), legacyCustomerId: String(row.customer_id ?? ''), date: value(row, 'followup_date'), method: value(row, 'method'), result: value(row, 'result'), note: value(row, 'note'), nextDate: value(row, 'next_date') });
      }
    }
    const settings = {};
    if (tables.has('settings')) for (const row of source.prepare('SELECT key,value FROM settings').all()) settings[`legacy:${row.key}`] = row.value;
    const result = { schemaVersion: 4, customers, tickets, deposits, followups, registrations: [], batchOperations: [], settings, activities: [], savedViews: ['全部客户','今日新增','已进群','热聊客户'], channelAliases: {} };
    const statusCounts = {};
    const pageCounts = {};
    for (const customer of customers) {
      statusCounts[customer.status] = (statusCounts[customer.status] || 0) + 1;
      pageCounts[customer.page] = (pageCounts[customer.page] || 0) + 1;
    }
    const archivedCustomers = legacyRows.filter(row => Number(row.archived || 0)).length;
    const mergedCustomers = legacyRows.filter(row => Boolean(row.merged_into)).length;
    return { result, preview: { customers: customers.length, tickets: tickets.length, deposits: deposits.length, followups: followups.length, archivedCustomers, mergedCustomers, excludedCustomers: legacyRows.length - activeRows.length, unlinkedFollowups: followups.filter(item => !item.customerId).length, statusCounts, pageCounts, duplicatePhones: customers.length - new Set(customers.map(c => c.phone).filter(Boolean)).size } };
  } finally {
    source.close();
  }
}

const WS_STATUSES = new Set(['未连接', '等待登录', '登录中', '已连接', '会话过期', '连接失败', '正在重连']);
const WS_DIRECTIONS = new Set(['receive', 'send']);
const WS_REPLY_STATUSES = new Set(['draft', 'copied', 'confirmed']);
const WS_TRANSLATION_STATUSES = new Set(['none', 'pending', 'translated', 'failed', 'skipped']);
function wsText(value, max = 12000) { return String(value ?? '').trim().slice(0, max); }
function wsObject(value, maxBytes = 64 * 1024) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const textValue = JSON.stringify(value);
  if (Buffer.byteLength(textValue) > maxBytes) throw new Error('WS 结构化数据过大。');
  return value;
}
function wsIso(value) { const date = value ? new Date(value) : new Date(); return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString(); }
function wsAccountId(value) { return wsText(value, 120) || 'default'; }
function wsAccountRow(id) { return db.prepare('SELECT * FROM ws_accounts WHERE id=?').get(wsAccountId(id)); }
function wsRequireAccount(id) { const row = wsAccountRow(id); if (!row) throw new Error('WS 账号不存在或已被删除。'); return row; }
function wsAccountPayload(row) {
  if (!row) return null;
  const settings = db.prepare('SELECT * FROM ws_account_settings WHERE account_id=?').get(row.id);
  return {
    id: row.id,
    displayName: row.display_name,
    provider: row.provider,
    origin: row.origin,
    partitionKey: row.partition_key,
    status: row.status,
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
function wsMessagePayload(row) { return { id: row.id, accountId: row.account_id || 'default', conversationId: row.conversation_id, externalId: row.external_id, direction: row.direction, originalText: row.original_text, translatedText: row.translated_text, sourceLanguage: row.source_language, targetLanguage: row.target_language, order: row.order_no, translationStatus: row.translation_status || (row.translated_text ? 'translated' : 'none'), translationError: row.translation_error || '', translationAttempts: Number(row.translation_attempts || 0), lastAttemptAt: row.last_attempt_at || '', data: wsJson(row.data_json), createdAt: row.created_at, updatedAt: row.updated_at }; }
function wsAnalysisPayload(row) { return { id: row.id, accountId: row.account_id || 'default', conversationId: row.conversation_id, result: wsJson(row.result_json), confidence: Number(row.confidence || 0), providerName: row.provider_name, model: row.model, errorMessage: row.error_message, createdAt: row.created_at, updatedAt: row.updated_at }; }
function wsReplyPayload(row) { return { id: row.id, accountId: row.account_id || 'default', conversationId: row.conversation_id, originalText: row.original_text, translatedText: row.translated_text, status: row.status, idempotencyKey: row.idempotency_key || '', createdAt: row.created_at, updatedAt: row.updated_at }; }
function wsBatchPayload(row) { return { id: row.id, accountId: row.account_id || 'default', conversationId: row.conversation_id, fingerprint: row.fingerprint, messageCount: Number(row.message_count || 0), insertedCount: Number(row.inserted_count || 0), messageIds: wsJson(row.message_ids_json, []), createdAt: row.created_at, updatedAt: row.updated_at }; }
function wsCollectionRunPayload(row) { return { id: row.id, accountId: row.account_id || 'default', status: row.status, total: Number(row.total||0), discovered: Number(row.discovered||0), completed: Number(row.completed||0), analyzing: Number(row.analyzing||0), analyzed: Number(row.analyzed||0), failed: Number(row.failed||0), skipped: Number(row.skipped||0), retryable: Number(row.retryable||0), lastError: row.last_error||'', checkpoint: row.checkpoint||'', cursor: row.cursor||'', resumeCount: Number(row.resume_count||0), lastSuccessAt: row.last_success_at||'', createdAt: row.created_at, updatedAt: row.updated_at }; }
function wsCollectionItemPayload(row) { return { id: row.id, accountId: row.account_id || 'default', runId: row.run_id, conversationId: row.conversation_id, status: row.status, attempts: Number(row.attempts||0), analysisStatus: row.analysis_status, followupStatus: row.followup_status, nextFollowupAt: row.next_followup_at||'', coverageStatus: row.coverage_status||'unknown', lastError: row.last_error||'', checkpoint: row.checkpoint||'', createdAt: row.created_at, updatedAt: row.updated_at }; }
function wsFollowupAlertPayload(row) { return { id: row.id, accountId: row.account_id || 'default', conversationId: row.conversation_id, analysisId: row.analysis_id, alertKey: row.alert_key, priority: row.priority, reason: row.reason, followupTime: row.followup_time || '', status: row.status || 'open', snoozedUntil: row.snoozed_until || '', data: wsJson(row.data_json, {}), createdAt: row.created_at, updatedAt: row.updated_at }; }
function wsConversationRow(id, accountId = 'default') { return db.prepare('SELECT * FROM ws_conversations WHERE id=? AND account_id=?').get(String(id || ''), wsAccountId(accountId)); }
function wsRequireConversation(id, accountId = 'default') { const row = wsConversationRow(id, accountId); if (!row) throw new Error('WS 会话不存在或已被清理。'); return row; }
function wsCreateId(prefix) { return `${prefix}-${Date.now().toString(36)}-${randomBytes(5).toString('hex')}`; }
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
  const canonical = messages.map(item => ({ externalId: wsText(item?.externalId, 200), direction: wsText(item?.direction, 16), originalText: wsText(item?.originalText, 12000), order: Number.isFinite(Number(item?.order)) ? Number(item.order) : 0 }));
  return createHash('sha256').update(JSON.stringify([conversationId, canonical])).digest('hex');
}

let pendingImport = null;
let pendingImportTimer = null;
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
          db.prepare('INSERT INTO ws_accounts(id,display_name,provider,origin,partition_key,status,enabled,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)')
            .run(id, wsText(body.displayName, 200) || id, wsText(body.provider, 120), wsText(body.origin, 500), wsText(body.partitionKey, 200) || `persist:${id}`, wsText(body.status, 32) || '未连接', body.enabled === false ? 0 : 1, now, now);
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
          db.prepare('UPDATE ws_accounts SET display_name=?,provider=?,origin=?,partition_key=?,status=?,enabled=?,updated_at=? WHERE id=?')
            .run(Object.hasOwn(body, 'displayName') ? wsText(body.displayName, 200) : account.display_name, Object.hasOwn(body, 'provider') ? wsText(body.provider, 120) : account.provider, Object.hasOwn(body, 'origin') ? wsText(body.origin, 500) : account.origin, Object.hasOwn(body, 'partitionKey') ? wsText(body.partitionKey, 200) : account.partition_key, Object.hasOwn(body, 'status') ? wsText(body.status, 32) : account.status, body.enabled === false ? 0 : (body.enabled === true ? 1 : account.enabled), now, accountId);
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
        const limit = Math.min(200, Math.max(1, Number(url.searchParams.get('limit')) || 50));
        const rows = db.prepare(`SELECT * FROM ws_conversations WHERE account_id=? ORDER BY updated_at DESC LIMIT ${limit}`).all(accountId);
        return json(res, 200, { conversations: rows.map(wsConversationPayload) });
      }
      if (req.method === 'POST') {
        const body = JSON.parse((await readBody(req, 512 * 1024)).toString('utf8'));
        const accountId = wsAccountId(body.accountId);
        wsRequireAccount(accountId);
        const externalId = wsText(body.externalId, 160);
        if (!externalId) return json(res, 400, { error: 'WS 会话缺少外部会话标识。' });
        const now = new Date().toISOString();
        const existing = db.prepare('SELECT * FROM ws_conversations WHERE account_id=? AND external_id=?').get(accountId, externalId);
        if (existing) {
          const title = Object.hasOwn(body, 'title') ? wsText(body.title, 200) : existing.title;
          const customerId = Object.hasOwn(body, 'customerId') ? wsText(body.customerId, 128) : existing.customer_id;
          const lastMessageText = Object.hasOwn(body, 'lastMessageText') ? wsText(body.lastMessageText, 4000) : existing.last_message_text;
          const lastMessageAt = Object.hasOwn(body, 'lastMessageAt') ? wsIso(body.lastMessageAt) : existing.last_message_at;
          const unreadCount = Object.hasOwn(body, 'unreadCount') ? Math.max(0, Math.floor(Number(body.unreadCount) || 0)) : Number(existing.unread_count || 0);
          const language = Object.hasOwn(body, 'language') ? wsText(body.language, 40) : existing.language;
          const intentLevel = Object.hasOwn(body, 'intentLevel') ? wsText(body.intentLevel, 40) : existing.intent_level;
          const data = Object.hasOwn(body, 'data') ? wsObject(body.data, 32 * 1024) : wsJson(existing.data_json);
          db.prepare('UPDATE ws_conversations SET title=?,customer_id=?,last_message_text=?,last_message_at=?,unread_count=?,language=?,intent_level=?,data_json=?,updated_at=? WHERE id=? AND account_id=?')
            .run(title, customerId, lastMessageText, lastMessageAt, unreadCount, language, intentLevel, JSON.stringify(data), now, existing.id, accountId);
        } else {
          const id = wsText(body.id, 160) || wsCreateId('wsc');
          const lastMessageText = wsText(body.lastMessageText, 4000);
          const lastMessageAt = Object.hasOwn(body, 'lastMessageAt') ? wsIso(body.lastMessageAt) : (lastMessageText ? now : '');
          db.prepare(`INSERT INTO ws_conversations(id,account_id,external_id,title,customer_id,last_message_text,intent_level,data_json,created_at,updated_at,last_message_at,unread_count,language)
            VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`)
            .run(id, accountId, externalId, wsText(body.title, 200), wsText(body.customerId, 128), lastMessageText, wsText(body.intentLevel, 40), JSON.stringify(wsObject(body.data, 32 * 1024)), now, now, lastMessageAt, Math.max(0, Math.floor(Number(body.unreadCount) || 0)), wsText(body.language, 40));
        }
        const row = db.prepare('SELECT * FROM ws_conversations WHERE account_id=? AND external_id=?').get(accountId, externalId);
        return json(res, 200, wsConversationPayload(row));
      }
      return json(res, 405, { error: 'WS 会话只支持 GET/POST。' });
    }
    if (url.pathname === '/api/ws/messages/batch' && req.method === 'POST') {
      const body = JSON.parse((await readBody(req, 12 * 1024 * 1024)).toString('utf8'));
      const conversationId = wsText(body.conversationId, 160);
      const accountId = wsAccountId(body.accountId);
      wsRequireConversation(conversationId, accountId);
      if (!Array.isArray(body.messages) || !body.messages.length) return json(res, 400, { error: 'WS 批次没有可保存的消息。' });
      if (body.messages.length > 500) return json(res, 413, { error: '单次最多保存 500 条 WS 消息，请拆分批次。' });
      const messages = body.messages;
      for (const item of messages) {
        if (!item || typeof item !== 'object' || !WS_DIRECTIONS.has(wsText(item.direction, 16)) || !wsText(item.originalText, 12000)) return json(res, 400, { error: 'WS 批次包含无效的消息方向或空原文。' });
      }
      const fingerprint = wsBatchFingerprint(conversationId, messages, body.fingerprint || body.batchFingerprint || body.idempotencyKey);
      const previous = db.prepare('SELECT * FROM ws_ingest_batches WHERE account_id=? AND conversation_id=? AND fingerprint=?').get(accountId, conversationId, fingerprint);
      if (previous) {
        if (Number(previous.message_count) !== messages.length) return json(res, 409, { error: '该批次指纹已用于不同数量的消息，请生成新的批次指纹。' });
        const ids = wsJson(previous.message_ids_json, []);
        const rows = ids.map(id => db.prepare('SELECT * FROM ws_messages WHERE id=?').get(String(id))).filter(Boolean).map(wsMessagePayload);
        return json(res, 200, { batch: wsBatchPayload(previous), inserted: 0, existed: rows.length, messages: rows, repeated: true });
      }
      const now = new Date().toISOString(), batchId = wsCreateId('wsb'), messageIds = [], resultRows = [];
      let inserted = 0, existed = 0, unreadAdded = 0;
      db.exec('BEGIN IMMEDIATE');
      try {
        db.prepare('INSERT INTO ws_ingest_batches(id,account_id,conversation_id,fingerprint,message_count,inserted_count,message_ids_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)')
          .run(batchId, accountId, conversationId, fingerprint, messages.length, 0, '[]', now, now);
        for (let index = 0; index < messages.length; index++) {
          const item = messages[index], externalId = wsText(item.externalId, 200);
          let row = externalId ? db.prepare('SELECT * FROM ws_messages WHERE conversation_id=? AND external_id=?').get(conversationId, externalId) : null;
          if (row) {
            existed += 1;
          } else {
            const id = wsText(item.id, 160) || wsCreateId('wsm');
            const originalText = wsText(item.originalText, 12000), direction = wsText(item.direction, 16);
            const translation = wsTranslationFields(item);
            const createdAt = item.createdAt ? wsIso(item.createdAt) : now;
            const data = { ...wsObject(item.data, 32 * 1024), ingestBatchId: batchId };
            db.prepare(`INSERT INTO ws_messages(id,account_id,conversation_id,external_id,direction,original_text,translated_text,source_language,target_language,order_no,data_json,created_at,updated_at,translation_status,translation_error,translation_attempts,last_attempt_at)
              VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(id, accountId, conversationId, externalId, direction, originalText, translation.translatedText, wsText(item.sourceLanguage, 40), wsText(item.targetLanguage, 40), Number.isFinite(Number(item.order)) ? Number(item.order) : index + 1, JSON.stringify(data), createdAt, now, translation.translationStatus, translation.translationError, translation.translationAttempts, translation.lastAttemptAt);
            row = db.prepare('SELECT * FROM ws_messages WHERE id=?').get(id);
            inserted += 1;
            if (direction === 'receive') unreadAdded += 1;
          }
          messageIds.push(row.id);
          resultRows.push(wsMessagePayload(row));
        }
        const last = resultRows.at(-1);
        if (last) db.prepare('UPDATE ws_conversations SET last_message_text=?,last_message_at=?,unread_count=unread_count+?,updated_at=? WHERE id=?').run(last.originalText.slice(0, 4000), last.createdAt || now, unreadAdded, now, conversationId);
        db.prepare('UPDATE ws_ingest_batches SET inserted_count=?,message_ids_json=?,updated_at=? WHERE id=?').run(inserted, JSON.stringify(messageIds), now, batchId);
        db.exec('COMMIT');
      } catch (error) { db.exec('ROLLBACK'); throw error; }
      const batch = db.prepare('SELECT * FROM ws_ingest_batches WHERE id=?').get(batchId);
      return json(res, 200, { batch: wsBatchPayload(batch), inserted, existed, messages: resultRows, repeated: false });
    }
    if (url.pathname === '/api/ws/messages') {
      if (req.method === 'GET') {
        const conversationId = wsText(url.searchParams.get('conversationId'), 160);
        const accountId = wsAccountId(url.searchParams.get('accountId'));
        if (!conversationId) return json(res, 400, { error: '读取 WS 消息缺少会话编号。' });
        const limit = Math.min(1000, Math.max(1, Number(url.searchParams.get('limit')) || 500));
        wsRequireConversation(conversationId, accountId);
        const rows = db.prepare(`SELECT * FROM ws_messages WHERE account_id=? AND conversation_id=? ORDER BY order_no ASC,created_at ASC LIMIT ${limit}`).all(accountId, conversationId);
        return json(res, 200, { messages: rows.map(wsMessagePayload) });
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
        const originalText = wsText(body.originalText, 12000);
        if (!originalText) return json(res, 400, { error: 'WS 原文不能为空。' });
        if (externalId) {
          const existing = db.prepare('SELECT * FROM ws_messages WHERE conversation_id=? AND external_id=?').get(conversationId, externalId);
          if (existing) {
            const hasTranslationUpdate = ['translatedText','targetLanguage','sourceLanguage','translationStatus','translationError','translationAttempts','lastAttemptAt'].some(key => Object.hasOwn(body, key));
            if (hasTranslationUpdate) {
              const translation = wsTranslationFields(body, existing), updatedAt = new Date().toISOString();
              db.prepare('UPDATE ws_messages SET translated_text=?,source_language=?,target_language=?,translation_status=?,translation_error=?,translation_attempts=?,last_attempt_at=?,updated_at=? WHERE id=?')
                .run(translation.translatedText, Object.hasOwn(body, 'sourceLanguage') ? wsText(body.sourceLanguage, 40) : existing.source_language, Object.hasOwn(body, 'targetLanguage') ? wsText(body.targetLanguage, 40) : existing.target_language, translation.translationStatus, translation.translationError, translation.translationAttempts, translation.lastAttemptAt, updatedAt, existing.id);
              return json(res, 200, { ...wsMessagePayload(db.prepare('SELECT * FROM ws_messages WHERE id=?').get(existing.id)), existed: true, updated: true });
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
          db.prepare('UPDATE ws_conversations SET last_message_text=?,last_message_at=?,unread_count=unread_count+?,updated_at=? WHERE id=?').run(originalText.slice(0, 4000), now, direction === 'receive' ? 1 : 0, now, conversationId);
          db.exec('COMMIT');
        } catch (error) { db.exec('ROLLBACK'); throw error; }
        return json(res, 200, { ...wsMessagePayload(db.prepare('SELECT * FROM ws_messages WHERE id=?').get(id)), existed: false });
      }
      return json(res, 405, { error: 'WS 消息只支持 GET/POST。' });
    }
    if (url.pathname === '/api/ws/analyses') {
      if (req.method === 'GET') {
        const conversationId = wsText(url.searchParams.get('conversationId'), 160);
        const accountId = wsAccountId(url.searchParams.get('accountId'));
        if (!conversationId) return json(res, 400, { error: '读取 WS 分析缺少会话编号。' });
        wsRequireConversation(conversationId, accountId);
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
        wsRequireConversation(conversationId, accountId);
        const result = wsObject(body.result, 128 * 1024);
        const confidence = Math.min(1, Math.max(0, Number(body.confidence ?? result.confidence) || 0));
        const now = new Date().toISOString(), id = wsCreateId('wsa');
        const intentLevel = wsText(body.intentLevel ?? result.intentLevel ?? result.intent, 40);
        const language = wsText(body.language ?? result.language, 40);
        db.exec('BEGIN IMMEDIATE');
        try {
          db.prepare('INSERT INTO ws_ai_analyses(id,account_id,conversation_id,result_json,confidence,provider_name,model,error_message,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)').run(id, accountId, conversationId, JSON.stringify(result), confidence, wsText(body.providerName, 120), wsText(body.model, 120), wsText(body.errorMessage, 1000), now, now);
          db.prepare(`UPDATE ws_conversations SET intent_level=CASE WHEN ?<>'' THEN ? ELSE intent_level END,language=CASE WHEN ?<>'' THEN ? ELSE language END,updated_at=? WHERE id=?`).run(intentLevel, intentLevel, language, language, now, conversationId);
          db.exec('COMMIT');
        } catch (error) { db.exec('ROLLBACK'); throw error; }
        return json(res, 200, wsAnalysisPayload(db.prepare('SELECT * FROM ws_ai_analyses WHERE id=?').get(id)));
      }
      return json(res, 405, { error: 'WS 分析只支持 GET/POST/PUT。' });
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
        return json(res, 200, { ...wsReplyPayload(db.prepare('SELECT * FROM ws_replies WHERE id=?').get(id)), existed: false });
      }
      return json(res, 405, { error: 'WS 回复只支持 GET/POST/PUT。' });
    }
    if (url.pathname === '/api/ws/collection-runs') {
      const accountId = wsAccountId(url.searchParams.get('accountId'));
      wsRequireAccount(accountId);
      if (req.method === 'GET') { const row = url.searchParams.get('id') ? db.prepare('SELECT * FROM ws_collection_runs WHERE id=? AND account_id=?').get(url.searchParams.get('id'), accountId) : db.prepare('SELECT * FROM ws_collection_runs WHERE account_id=? ORDER BY created_at DESC LIMIT 1').get(accountId); return json(res,200,{run:row?wsCollectionRunPayload(row):null}); }
      if (req.method === 'POST') { const body=JSON.parse((await readBody(req,64*1024)).toString('utf8')); const scopedAccountId=wsAccountId(body.accountId || accountId); wsRequireAccount(scopedAccountId); const now=new Date().toISOString(), id=wsText(body.id,160)||wsCreateId('wsr'); db.prepare('INSERT INTO ws_collection_runs(id,account_id,status,created_at,updated_at) VALUES(?,?,?,?,?)').run(id,scopedAccountId,'created',now,now); return json(res,201,{run:wsCollectionRunPayload(db.prepare('SELECT * FROM ws_collection_runs WHERE id=?').get(id))}); }
      if (req.method === 'PATCH') { const body=JSON.parse((await readBody(req,64*1024)).toString('utf8')); const id=wsText(body.id,160), existing=db.prepare('SELECT * FROM ws_collection_runs WHERE id=? AND account_id=?').get(id, accountId); if(!existing)return json(res,404,{error:'采集任务不存在。'}); const n=k=>Math.max(0,Math.floor(Number(body[k] ?? existing[k])||0)); const now=new Date().toISOString(),status=wsText(body.status,30)||existing.status,lastSuccessAt=Object.hasOwn(body,'lastSuccessAt')?wsText(body.lastSuccessAt,80):existing.last_success_at,cursor=Object.hasOwn(body,'cursor')?wsText(body.cursor,500):existing.cursor,resumeCount=Object.hasOwn(body,'resumeCount')?Math.max(0,Math.floor(Number(body.resumeCount)||0)):existing.resume_count+(status==='running'&&existing.status==='paused'?1:0); db.prepare('UPDATE ws_collection_runs SET status=?,total=?,discovered=?,completed=?,analyzing=?,analyzed=?,failed=?,skipped=?,retryable=?,last_error=?,checkpoint=?,cursor=?,resume_count=?,last_success_at=?,updated_at=? WHERE id=? AND account_id=?').run(status,n('total'),n('discovered'),n('completed'),n('analyzing'),n('analyzed'),n('failed'),n('skipped'),n('retryable'),wsText(body.lastError??existing.last_error,1000),wsText(body.checkpoint??existing.checkpoint,500),cursor,resumeCount,lastSuccessAt,now,id,accountId); return json(res,200,{run:wsCollectionRunPayload(db.prepare('SELECT * FROM ws_collection_runs WHERE id=?').get(id))}); }
      return json(res,405,{error:'采集任务只支持 GET/POST/PATCH。'});
    }
    if (url.pathname === '/api/ws/collection-items') {
      const accountId = wsAccountId(url.searchParams.get('accountId'));
      wsRequireAccount(accountId);
      if (req.method === 'GET') { const runId=wsText(url.searchParams.get('runId'),160); return json(res,200,{items:db.prepare('SELECT * FROM ws_collection_items WHERE account_id=? AND run_id=? ORDER BY updated_at DESC').all(accountId, runId).map(wsCollectionItemPayload)}); }
      if (req.method === 'POST' || req.method === 'PATCH') { const body=JSON.parse((await readBody(req,128*1024)).toString('utf8')); const scopedAccountId=wsAccountId(body.accountId || accountId), runId=wsText(body.runId,160), conversationId=wsText(body.conversationId,160); if(!db.prepare('SELECT 1 FROM ws_collection_runs WHERE id=? AND account_id=?').get(runId, scopedAccountId))return json(res,404,{error:'采集任务不存在。'}); wsRequireConversation(conversationId, scopedAccountId); const now=new Date().toISOString(), existing=db.prepare('SELECT * FROM ws_collection_items WHERE account_id=? AND run_id=? AND conversation_id=?').get(scopedAccountId, runId,conversationId), id=existing?.id||wsText(body.id,160)||wsCreateId('wsi'); const val=(key,old,max=1000)=>wsText(body[key]??old,max); if(existing) db.prepare('UPDATE ws_collection_items SET status=?,attempts=?,analysis_status=?,followup_status=?,next_followup_at=?,coverage_status=?,last_error=?,checkpoint=?,updated_at=? WHERE id=? AND account_id=?').run(val('status',existing.status,30),Math.max(0,Math.floor(Number(body.attempts??existing.attempts)||0)),val('analysisStatus',existing.analysis_status,30),val('followupStatus',existing.followup_status,30),val('nextFollowupAt',existing.next_followup_at,80),val('coverageStatus',existing.coverage_status,30),val('lastError',existing.last_error),val('checkpoint',existing.checkpoint,500),now,id,scopedAccountId); else db.prepare('INSERT INTO ws_collection_items(id,account_id,run_id,conversation_id,status,attempts,analysis_status,followup_status,next_followup_at,coverage_status,last_error,checkpoint,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(id,scopedAccountId,runId,conversationId,val('status','queued',30),Math.max(0,Math.floor(Number(body.attempts)||0)),val('analysisStatus','pending',30),val('followupStatus','none',30),val('nextFollowupAt','',80),val('coverageStatus','unknown',30),val('lastError',''),val('checkpoint','',500),now,now); return json(res,200,{item:wsCollectionItemPayload(db.prepare('SELECT * FROM ws_collection_items WHERE id=?').get(id))}); }
      return json(res,405,{error:'采集项只支持 GET/POST/PATCH。'});
    }
    if (url.pathname === '/api/ws/followup-alerts' && req.method !== 'GET') {
      const body = JSON.parse((await readBody(req, 64 * 1024)).toString('utf8'));
      const accountId = wsAccountId(body.accountId);
      wsRequireAccount(accountId);
      const id = wsText(body.id, 160), conversationId = wsText(body.conversationId, 160), alertKey = wsText(body.alertKey, 320);
      const existing = id ? db.prepare('SELECT * FROM ws_followup_alerts WHERE id=? AND account_id=?').get(id, accountId) : alertKey ? db.prepare('SELECT * FROM ws_followup_alerts WHERE account_id=? AND alert_key=?').get(accountId, alertKey) : null;
      if (!existing) return json(res, 404, { error: '跟进提醒不存在。' });
      if (conversationId && conversationId !== existing.conversation_id) return json(res, 409, { error: '跟进提醒会话不匹配。' });
      const allowed = new Set(['open','snoozed','done','dismissed']);
      const status = allowed.has(wsText(body.status, 20)) ? wsText(body.status, 20) : existing.status;
      const snoozedUntil = wsText(body.snoozedUntil ?? existing.snoozed_until, 80);
      const now = new Date().toISOString();
      db.prepare('UPDATE ws_followup_alerts SET status=?,snoozed_until=?,updated_at=? WHERE id=? AND account_id=?').run(status, snoozedUntil, now, existing.id, accountId);
      return json(res, 200, { alert: wsFollowupAlertPayload(db.prepare('SELECT * FROM ws_followup_alerts WHERE id=?').get(existing.id)) });
    }
    if (req.method === 'GET' && url.pathname === '/api/ws/followup-alerts') {
      const accountId = wsAccountId(url.searchParams.get('accountId'));
      wsRequireAccount(accountId);
      const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit')) || 30));
      const rows = db.prepare(`SELECT a.*, c.title, c.external_id, c.customer_id FROM ws_ai_analyses a JOIN ws_conversations c ON c.id=a.conversation_id AND c.account_id=a.account_id WHERE a.account_id=? ORDER BY a.created_at DESC LIMIT ${limit * 3}`).all(accountId);
      const today = new Date().toISOString().slice(0, 10);
      const alerts = [];
      const seenConversations = new Set();
      for (const row of rows) {
        if (seenConversations.has(row.conversation_id)) continue;
        seenConversations.add(row.conversation_id);
        const result = wsJson(row.result_json, {});
        const confidence = Number(row.confidence || 0);
        if (result.error || confidence < 0.3) continue;
        const due = String(result.followupTime || '').slice(0, 10);
        const urgent = /高|紧急|urgent|hot/i.test(String(result.urgency || '')) || Number(result.intentScore || 0) >= 80;
        const overdue = Boolean(due && due < today);
        const dueToday = Boolean(due && due === today);
        if (!urgent && !overdue && !dueToday) continue;
        const alertKey = `${row.account_id}:${row.conversation_id}`;
        const existingAlert = db.prepare('SELECT * FROM ws_followup_alerts WHERE account_id=? AND alert_key=?').get(accountId, alertKey);
        const priority = urgent ? 'urgent' : overdue ? 'overdue' : 'today';
        const reason = urgent && overdue ? '高意向且已逾期' : urgent ? '高意向客户' : overdue ? '跟进已逾期' : '今日应跟进';
        const alertData = {
          title: row.title,
          externalId: row.external_id,
          customerId: row.customer_id,
          summary: result.summary || '',
          nextStep: result.nextStep || '',
          followupTime: result.followupTime || '',
          urgency: result.urgency || '',
          intent: result.intent || '',
          confidence,
          needsConfirmation: true,
        };
        const now = new Date().toISOString();
        if (!existingAlert) db.prepare('INSERT INTO ws_followup_alerts(id,account_id,conversation_id,analysis_id,alert_key,priority,reason,followup_time,status,snoozed_until,data_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)').run(wsCreateId('wfa'), accountId, row.conversation_id, row.id, alertKey, priority, reason, result.followupTime || '', 'open', '', JSON.stringify(alertData), now, now);
        else db.prepare('UPDATE ws_followup_alerts SET analysis_id=?,priority=?,reason=?,followup_time=?,data_json=?,updated_at=? WHERE id=? AND account_id=?').run(row.id, priority, reason, result.followupTime || '', JSON.stringify(alertData), now, existingAlert.id, accountId);
        const savedAlert = db.prepare('SELECT * FROM ws_followup_alerts WHERE account_id=? AND alert_key=?').get(accountId, alertKey);
        if (savedAlert.status === 'done' || savedAlert.status === 'dismissed') continue;
        if (savedAlert.status === 'snoozed' && savedAlert.snoozed_until && savedAlert.snoozed_until > new Date().toISOString()) continue;
        alerts.push({
          alertKey: `${row.account_id}:${row.conversation_id}`,
          id: savedAlert.id,
          analysisId: row.id,
          analyzedAt: row.created_at,
          accountId: row.account_id,
          conversationId: row.conversation_id,
          title: row.title,
          externalId: row.external_id,
          customerId: row.customer_id,
          summary: result.summary || '',
          nextStep: result.nextStep || '',
          followupTime: result.followupTime || '',
          urgency: result.urgency || '',
          intent: result.intent || '',
          confidence,
          priority,
          reason,
          status: savedAlert.status,
          snoozedUntil: savedAlert.snoozed_until || '',
          needsConfirmation: true,
        });
        if (alerts.length >= limit) break;
      }
      return json(res, 200, { alerts, generatedAt: new Date().toISOString() });
    }
    if (req.method === 'GET' && url.pathname === '/api/ws/diagnostics') {
      const accountId = wsAccountId(url.searchParams.get('accountId')); wsRequireAccount(accountId);
      return json(res, 200, { schemaVersion: Number(db.prepare('PRAGMA user_version').get().user_version || 0), counts: { settings: Number(db.prepare('SELECT COUNT(*) AS count FROM ws_settings WHERE account_id=?').get(accountId).count || 0), conversations: Number(db.prepare('SELECT COUNT(*) AS count FROM ws_conversations WHERE account_id=?').get(accountId).count || 0), messages: Number(db.prepare('SELECT COUNT(*) AS count FROM ws_messages WHERE account_id=?').get(accountId).count || 0), analyses: Number(db.prepare('SELECT COUNT(*) AS count FROM ws_ai_analyses WHERE account_id=?').get(accountId).count || 0), replies: Number(db.prepare('SELECT COUNT(*) AS count FROM ws_replies WHERE account_id=?').get(accountId).count || 0), batches: Number(db.prepare('SELECT COUNT(*) AS count FROM ws_ingest_batches WHERE account_id=?').get(accountId).count || 0), collectionRuns: Number(db.prepare('SELECT COUNT(*) AS count FROM ws_collection_runs WHERE account_id=?').get(accountId).count || 0), collectionItems: Number(db.prepare('SELECT COUNT(*) AS count FROM ws_collection_items WHERE account_id=?').get(accountId).count || 0) } });
    }
    if (req.method === 'GET' && url.pathname === '/api/ws/export') {
      const accountId = wsAccountId(url.searchParams.get('accountId')); wsRequireAccount(accountId);
      const conversations = db.prepare('SELECT * FROM ws_conversations WHERE account_id=? ORDER BY updated_at DESC').all(accountId).map(wsConversationPayload);
      const settings = db.prepare('SELECT * FROM ws_settings WHERE account_id=? ORDER BY updated_at DESC').all(accountId).map(wsSettingsPayload);
      const messages = db.prepare('SELECT * FROM ws_messages WHERE account_id=? ORDER BY conversation_id,order_no,created_at').all(accountId).map(wsMessagePayload);
      const analyses = db.prepare('SELECT * FROM ws_ai_analyses WHERE account_id=? ORDER BY created_at').all(accountId).map(wsAnalysisPayload);
      const replies = db.prepare('SELECT * FROM ws_replies WHERE account_id=? ORDER BY created_at').all(accountId).map(wsReplyPayload);
      const batches = db.prepare('SELECT * FROM ws_ingest_batches WHERE account_id=? ORDER BY created_at').all(accountId).map(wsBatchPayload);
      return json(res, 200, { schemaVersion: 6, createdAt: new Date().toISOString(), settings, conversations, messages, analyses, replies, batches });
    }
    if (req.method === 'POST' && url.pathname === '/api/ws/import') {
      const body = JSON.parse((await readBody(req, 50 * 1024 * 1024)).toString('utf8'));
      const accountId = wsAccountId(body.accountId);
      wsRequireAccount(accountId);
      const schemaVersion = Number(body.schemaVersion || 5);
      if (!Number.isInteger(schemaVersion) || schemaVersion < 5 || schemaVersion > 6) return json(res, 400, { error: 'WS 备份版本不受支持，只能恢复 v5 或 v6 数据。' });
      for (const key of ['settings','conversations','messages','analyses','replies','batches']) if (Object.hasOwn(body, key) && !Array.isArray(body[key])) return json(res, 400, { error: `WS 备份中的 ${key} 不是有效数组。` });
      const settings = body.settings || [];
      const conversations = body.conversations || [];
      const messages = body.messages || [];
      const analyses = body.analyses || [];
      const replies = body.replies || [];
      const batches = body.batches || [];
      const limits = { settings: 5000, conversations: 5000, messages: 100000, analyses: 20000, replies: 20000, batches: 20000 };
      for (const [key, limit] of Object.entries(limits)) if ({ settings, conversations, messages, analyses, replies, batches }[key].length > limit) return json(res, 413, { error: `WS 备份中的 ${key} 超过 ${limit} 条上限，未执行恢复。` });
      const conversationIds = new Set(conversations.map(item => wsText(item.id, 160)).filter(Boolean));
      const externalIds = new Set(conversations.map(item => wsText(item.externalId, 160)).filter(Boolean));
      if (conversations.some(item => !wsText(item.id, 160) || !wsText(item.externalId, 160)) || conversationIds.size !== conversations.length || externalIds.size !== conversations.length) return json(res, 400, { error: 'WS 备份中的会话编号或外部标识缺失或重复。' });
      if (settings.some(item => !conversationIds.has(wsText(item.conversationId, 160)))) return json(res, 400, { error: 'WS 备份中的设置关联了不存在的会话。' });
      if (new Set(settings.map(item => wsText(item.conversationId, 160))).size !== settings.length) return json(res, 400, { error: 'WS 备份中同一会话存在重复设置。' });
      if (messages.some(item => !conversationIds.has(wsText(item.conversationId, 160)) || !WS_DIRECTIONS.has(wsText(item.direction, 16)) || !wsText(item.originalText, 12000))) return json(res, 400, { error: 'WS 备份中的消息格式无效。' });
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
      db.exec('BEGIN IMMEDIATE');
      try {
        db.prepare('DELETE FROM ws_ingest_batches WHERE account_id=?').run(accountId);
        db.prepare('DELETE FROM ws_messages WHERE account_id=?').run(accountId);
        db.prepare('DELETE FROM ws_ai_analyses WHERE account_id=?').run(accountId);
        db.prepare('DELETE FROM ws_replies WHERE account_id=?').run(accountId);
        db.prepare('DELETE FROM ws_settings WHERE account_id=?').run(accountId);
        db.prepare('DELETE FROM ws_conversations WHERE account_id=?').run(accountId);
        const now = new Date().toISOString();
        const addConversation = db.prepare('INSERT INTO ws_conversations(id,account_id,external_id,title,customer_id,last_message_text,intent_level,data_json,created_at,updated_at,last_message_at,unread_count,language) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)');
        for (const item of conversations) { const lastMessage = wsText(item.lastMessageText, 4000); addConversation.run(wsText(item.id, 160), accountId, wsText(item.externalId, 160), wsText(item.title, 200), wsText(item.customerId, 128), lastMessage, wsText(item.intentLevel, 40), JSON.stringify(wsObject(item.data, 32 * 1024)), wsIso(item.createdAt || now), wsIso(item.updatedAt || now), item.lastMessageAt ? wsIso(item.lastMessageAt) : (lastMessage ? wsIso(item.updatedAt || now) : ''), Math.max(0, Math.floor(Number(item.unreadCount) || 0)), wsText(item.language, 40)); }
        const addSetting = db.prepare('INSERT INTO ws_settings(conversation_id,account_id,enabled,receive_enabled,send_enabled,target_language,send_language,show_original,ai_enabled,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)');
        for (const item of settings) addSetting.run(wsText(item.conversationId, 160), accountId, item.enabled === false ? 0 : 1, item.receive === false ? 0 : 1, item.send === false ? 0 : 1, wsText(item.targetLanguage, 40) || '中文', wsText(item.sendLanguage, 40), item.showOriginal === false ? 0 : 1, item.aiEnabled === false ? 0 : 1, WS_STATUSES.has(wsText(item.status, 32)) ? wsText(item.status, 32) : '未连接', wsIso(item.createdAt || now), wsIso(item.updatedAt || now));
        const addMessage = db.prepare('INSERT INTO ws_messages(id,account_id,conversation_id,external_id,direction,original_text,translated_text,source_language,target_language,order_no,data_json,created_at,updated_at,translation_status,translation_error,translation_attempts,last_attempt_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
        for (const item of messages) { const translation = wsTranslationFields(item); addMessage.run(wsText(item.id, 160) || wsCreateId('wsm'), accountId, wsText(item.conversationId, 160), wsText(item.externalId, 200), wsText(item.direction, 16), wsText(item.originalText, 12000), translation.translatedText, wsText(item.sourceLanguage, 40), wsText(item.targetLanguage, 40), Number.isFinite(Number(item.order)) ? Number(item.order) : 0, JSON.stringify(wsObject(item.data, 32 * 1024)), wsIso(item.createdAt || now), wsIso(item.updatedAt || now), translation.translationStatus, translation.translationError, translation.translationAttempts, translation.lastAttemptAt); }
        const addAnalysis = db.prepare('INSERT INTO ws_ai_analyses(id,account_id,conversation_id,result_json,confidence,provider_name,model,error_message,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)');
        for (const item of analyses) addAnalysis.run(wsText(item.id, 160) || wsCreateId('wsa'), accountId, wsText(item.conversationId, 160), JSON.stringify(wsObject(item.result, 128 * 1024)), Math.min(1, Math.max(0, Number(item.confidence) || 0)), wsText(item.providerName, 120), wsText(item.model, 120), wsText(item.errorMessage, 1000), wsIso(item.createdAt || now), wsIso(item.updatedAt || now));
        const addReply = db.prepare('INSERT INTO ws_replies(id,account_id,conversation_id,original_text,translated_text,status,created_at,updated_at,idempotency_key) VALUES(?,?,?,?,?,?,?,?,?)');
        for (const item of replies) addReply.run(wsText(item.id, 160) || wsCreateId('wsr'), accountId, wsText(item.conversationId, 160), wsText(item.originalText, 12000), wsText(item.translatedText, 12000), WS_REPLY_STATUSES.has(wsText(item.status, 16)) ? wsText(item.status, 16) : 'draft', wsIso(item.createdAt || now), wsIso(item.updatedAt || now), wsText(item.idempotencyKey, 160));
        const addBatch = db.prepare('INSERT INTO ws_ingest_batches(id,account_id,conversation_id,fingerprint,message_count,inserted_count,message_ids_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)');
        for (const item of batches) { const ids = Array.isArray(item.messageIds) ? item.messageIds.map(id => wsText(id, 160)).filter(id => messageIds.has(id)) : []; addBatch.run(wsText(item.id, 160) || wsCreateId('wsb'), accountId, wsText(item.conversationId, 160), wsText(item.fingerprint, 160), Math.max(0, Math.floor(Number(item.messageCount) || ids.length)), Math.max(0, Math.floor(Number(item.insertedCount) || 0)), JSON.stringify(ids), wsIso(item.createdAt || now), wsIso(item.updatedAt || now)); }
        db.exec('COMMIT');
      } catch (error) { db.exec('ROLLBACK'); throw error; }
      return json(res, 200, { ok: true, schemaVersion: 6, counts: { settings: settings.length, conversations: conversations.length, messages: messages.length, analyses: analyses.length, replies: replies.length, batches: batches.length } });
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
    if (req.method === 'POST' && url.pathname === '/api/import/legacy/preview') {
      const bytes = await readBody(req, 20 * 1024 * 1024);
      const workDir = mkdtempSync(join(tmpdir(), 'zhike-legacy-preview-'));
      const tempPath = join(workDir, 'selected.sqlite');
      let converted;
      try {
        writeFileSync(tempPath, bytes, { flag: 'wx' });
        converted = convertLegacy(tempPath);
      } catch (error) {
        rmSync(workDir, { recursive: true, force: true });
        throw error;
      }
      clearTimeout(pendingImportTimer);
      if (pendingImport?.workDir) rmSync(pendingImport.workDir, { recursive: true, force: true });
      const token = randomUUID();
      pendingImport = { workDir, converted, token, expiresAt: Date.now() + 10 * 60 * 1000 };
      pendingImportTimer = setTimeout(() => {
        if (pendingImport?.token !== token) return;
        rmSync(pendingImport.workDir, { recursive: true, force: true });
        pendingImport = null;
      }, 10 * 60 * 1000);
      pendingImportTimer.unref();
      return json(res, 200, { ...converted.preview, token: pendingImport.token, filename: basename(req.headers['x-filename'] || 'selected database') });
    }
    if (req.method === 'POST' && url.pathname === '/api/import/legacy/commit') {
      const body = JSON.parse((await readBody(req, 1024 * 1024)).toString('utf8'));
      const expectedVersion = req.headers['x-state-version'];
      if (expectedVersion === undefined) return json(res, 428, { error: '迁移必须提供数据版本，请刷新后重试。' });
      const currentVersion = readStateEnvelope().version;
      if (expectedVersion !== undefined && String(expectedVersion) !== currentVersion) return json(res, 409, { error: '共享数据已在其他窗口更新，请重新同步后再迁移。', version: currentVersion });
      if (!pendingImport || body.token !== pendingImport.token) return json(res, 409, { error: '迁移预览已失效，请重新选择数据库。' });
      if (pendingImport.expiresAt <= Date.now()) {
        clearTimeout(pendingImportTimer);
        rmSync(pendingImport.workDir, { recursive: true, force: true });
        pendingImport = null;
        return json(res, 409, { error: '迁移预览已过期，请重新选择数据库。' });
      }
      const previous = readState();
      const nextState = pendingImport.converted.result;
      try { validateState(nextState); } catch (error) { return json(res, 400, { error: `迁移数据验证失败：${error.message}` }); }
      db.exec('BEGIN IMMEDIATE');
      let snapshotCreated = false;
      try {
        if (previous) {
          db.prepare('INSERT INTO state_snapshots(created_at,reason,json) VALUES(?,?,?)').run(new Date().toISOString(), '旧版数据库迁移前自动快照', JSON.stringify(previous));
          const retention = Math.min(100, Math.max(1, Number(previous.settings?.snapshotRetention) || 20));
          db.prepare('DELETE FROM state_snapshots WHERE id NOT IN (SELECT id FROM state_snapshots ORDER BY id DESC LIMIT ?)').run(retention);
          snapshotCreated = true;
        }
        writeState(nextState, false);
        db.exec('COMMIT');
      } catch (error) { db.exec('ROLLBACK'); throw error; }
      const count = pendingImport.converted.preview.customers;
      clearTimeout(pendingImportTimer);
      rmSync(pendingImport.workDir, { recursive: true, force: true });
      pendingImport = null;
      return json(res, 200, { ok: true, customers: count, snapshotCreated, version: readStateEnvelope().version });
    }
    if (req.method === 'GET' && url.pathname === '/api/diagnostics') return json(res, 200, databaseDiagnostics());
    if (req.method === 'GET' && url.pathname === '/api/health') return json(res, 200, { ok: true, storage: 'sqlite', workspace: root });

    const requestPath = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
    if (!['/modules/productivity.js', '/modules/performance-enhancements.js', '/modules/smart-import.js', '/modules/business-enhancements.js', '/modules/business-enhancements.css', '/modules/accessibility-enhancements.js', '/modules/operations-upgrade.js', '/modules/operations-upgrade.css', '/modules/ui-refresh.css', '/index.html', '/styles.css', '/app.js', '/modules/v4-data-center.js', '/modules/v4.css', '/modules/gpt-assistant.js', '/modules/runtime-customizer.js', '/modules/gpt-assistant.css', '/modules/gpt-workbench.css', '/modules/gpt-modern.css', '/modules/gpt-upgrade.css', '/modules/gpt-management.css', '/modules/phone-registry.js', '/modules/phone-registry.css', '/modules/phone-registry-seed.json', '/modules/v41-ui.css', '/modules/operations-core.cjs', '/modules/operations-ui.js', '/modules/ws-workbench-core.js', '/modules/ws-workbench.js', '/modules/ws-workbench.css'].includes(requestPath)) return json(res, 404, { error: '文件不存在。' });
    const filePath = resolve(root, `.${normalize(requestPath)}`);
    if (!filePath.startsWith(root + sep) || !existsSync(filePath) || !statSync(filePath).isFile()) return json(res, 404, { error: '文件不存在。' });
    const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.cjs': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml' };
    res.writeHead(200, { 'Content-Type': types[extname(filePath)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    if (filePath.endsWith('index.html')) {
      let html = await (await import('node:fs/promises')).readFile(filePath, 'utf8');
      const desktopFlag = process.env.ZHIKE_DESKTOP_APP === '1' ? ';window.__DESKTOP_APP__=true' : '';
      html = html.replace('</head>', `<script>window.__LOCAL_DB__=true${desktopFlag}</script></head>`);
      res.end(html);
    } else createReadStream(filePath).pipe(res);
  } catch (error) {
    json(res, 400, { error: error.message || '本地操作失败。' });
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
  if (process.env.ZHIKE_OPEN_BROWSER === '1') execFile('cmd.exe', ['/c', 'start', '', url], { windowsHide: true }, () => {});
});
server.on('error', error => {
  if (error.code === 'EADDRINUSE' && port < 4199) return startListening(port + 1);
  console.error(`本地服务无法启动：${error.message}`);
  process.exit(1);
});
startListening(port);
server.on('close', () => { clearTimeout(pendingImportTimer); if (pendingImport?.workDir) rmSync(pendingImport.workDir, { recursive: true, force: true }); db.close(); releaseWorkspaceLock(); });
process.on('SIGINT', () => server.close(() => process.exit(0)));
process.on('SIGTERM', () => server.close(() => process.exit(0)));
