import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { closeSync, createReadStream, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { basename, dirname, extname, join, normalize, resolve, sep } from 'node:path';
import { hostname, tmpdir, uptime } from 'node:os';
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';

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
function wsText(value, max = 12000) { return String(value ?? '').trim().slice(0, max); }
function wsObject(value, maxBytes = 64 * 1024) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const textValue = JSON.stringify(value);
  if (Buffer.byteLength(textValue) > maxBytes) throw new Error('WS 结构化数据过大。');
  return value;
}
function wsIso(value) { const date = value ? new Date(value) : new Date(); return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString(); }
function wsSettingsPayload(row) {
  if (!row) return { conversationId: '', enabled: true, receive: true, send: true, targetLanguage: '中文', showOriginal: true, aiEnabled: true, status: '未连接', createdAt: '', updatedAt: '' };
  return { conversationId: row.conversation_id, enabled: Boolean(row.enabled), receive: Boolean(row.receive_enabled), send: Boolean(row.send_enabled), targetLanguage: row.target_language || '中文', showOriginal: Boolean(row.show_original), aiEnabled: Boolean(row.ai_enabled), status: row.status, createdAt: row.created_at, updatedAt: row.updated_at };
}
function wsJson(value, fallback = {}) { try { return JSON.parse(value || '{}'); } catch { return fallback; } }
function wsConversationPayload(row) { return { id: row.id, externalId: row.external_id, title: row.title, customerId: row.customer_id, lastMessageText: row.last_message_text, intentLevel: row.intent_level, data: wsJson(row.data_json), createdAt: row.created_at, updatedAt: row.updated_at }; }
function wsMessagePayload(row) { return { id: row.id, conversationId: row.conversation_id, externalId: row.external_id, direction: row.direction, originalText: row.original_text, translatedText: row.translated_text, sourceLanguage: row.source_language, targetLanguage: row.target_language, order: row.order_no, data: wsJson(row.data_json), createdAt: row.created_at, updatedAt: row.updated_at }; }
function wsAnalysisPayload(row) { return { id: row.id, conversationId: row.conversation_id, result: wsJson(row.result_json), confidence: Number(row.confidence || 0), providerName: row.provider_name, model: row.model, errorMessage: row.error_message, createdAt: row.created_at, updatedAt: row.updated_at }; }
function wsReplyPayload(row) { return { id: row.id, conversationId: row.conversation_id, originalText: row.original_text, translatedText: row.translated_text, status: row.status, createdAt: row.created_at, updatedAt: row.updated_at }; }
function wsConversationRow(id) { return db.prepare('SELECT * FROM ws_conversations WHERE id=?').get(String(id || '')); }
function wsRequireConversation(id) { const row = wsConversationRow(id); if (!row) throw new Error('WS 会话不存在或已被清理。'); return row; }
function wsCreateId(prefix) { return `${prefix}-${Date.now().toString(36)}-${randomBytes(5).toString('hex')}`; }

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
    if (url.pathname === '/api/ws/settings') {
      const conversationId = wsText(url.searchParams.get('conversationId'), 160);
      if (!conversationId) return json(res, 400, { error: 'WS 设置缺少会话编号。' });
      if (req.method === 'GET') return json(res, 200, wsSettingsPayload(db.prepare('SELECT * FROM ws_settings WHERE conversation_id=?').get(conversationId)));
      if (req.method === 'PUT' || req.method === 'POST') {
        const body = JSON.parse((await readBody(req, 256 * 1024)).toString('utf8'));
        const now = new Date().toISOString();
        const status = WS_STATUSES.has(wsText(body.status, 32)) ? wsText(body.status, 32) : '未连接';
        db.prepare(`INSERT INTO ws_settings(conversation_id,enabled,receive_enabled,send_enabled,target_language,show_original,ai_enabled,status,created_at,updated_at)
          VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(conversation_id) DO UPDATE SET enabled=excluded.enabled,receive_enabled=excluded.receive_enabled,send_enabled=excluded.send_enabled,target_language=excluded.target_language,show_original=excluded.show_original,ai_enabled=excluded.ai_enabled,status=excluded.status,updated_at=excluded.updated_at`)
          .run(conversationId, body.enabled === false ? 0 : 1, body.receive === false || body.enabled === false ? 0 : 1, body.send === false || body.enabled === false ? 0 : 1, wsText(body.targetLanguage, 40) || '中文', body.showOriginal === false ? 0 : 1, body.aiEnabled === false ? 0 : 1, status, now, now);
        return json(res, 200, wsSettingsPayload(db.prepare('SELECT * FROM ws_settings WHERE conversation_id=?').get(conversationId)));
      }
      return json(res, 405, { error: 'WS 设置只支持 GET/PUT。' });
    }
    if (url.pathname === '/api/ws/conversations') {
      if (req.method === 'GET') {
        const limit = Math.min(200, Math.max(1, Number(url.searchParams.get('limit')) || 50));
        const rows = db.prepare(`SELECT * FROM ws_conversations ORDER BY updated_at DESC LIMIT ${limit}`).all();
        return json(res, 200, { conversations: rows.map(wsConversationPayload) });
      }
      if (req.method === 'POST') {
        const body = JSON.parse((await readBody(req, 512 * 1024)).toString('utf8'));
        const externalId = wsText(body.externalId, 160);
        if (!externalId) return json(res, 400, { error: 'WS 会话缺少外部会话标识。' });
        const id = wsText(body.id, 160) || wsCreateId('wsc');
        const now = new Date().toISOString();
        const data = wsObject(body.data, 32 * 1024);
        db.prepare(`INSERT INTO ws_conversations(id,external_id,title,customer_id,last_message_text,intent_level,data_json,created_at,updated_at)
          VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(external_id) DO UPDATE SET title=excluded.title,customer_id=excluded.customer_id,last_message_text=excluded.last_message_text,intent_level=excluded.intent_level,data_json=excluded.data_json,updated_at=excluded.updated_at`)
          .run(id, externalId, wsText(body.title, 200), wsText(body.customerId, 128), wsText(body.lastMessageText, 4000), wsText(body.intentLevel, 40), JSON.stringify(data), now, now);
        const row = db.prepare('SELECT * FROM ws_conversations WHERE external_id=?').get(externalId);
        return json(res, 200, wsConversationPayload(row));
      }
      return json(res, 405, { error: 'WS 会话只支持 GET/POST。' });
    }
    if (url.pathname === '/api/ws/messages') {
      if (req.method === 'GET') {
        const conversationId = wsText(url.searchParams.get('conversationId'), 160);
        if (!conversationId) return json(res, 400, { error: '读取 WS 消息缺少会话编号。' });
        const limit = Math.min(1000, Math.max(1, Number(url.searchParams.get('limit')) || 500));
        const rows = db.prepare(`SELECT * FROM ws_messages WHERE conversation_id=? ORDER BY order_no ASC,created_at ASC LIMIT ${limit}`).all(conversationId);
        return json(res, 200, { messages: rows.map(wsMessagePayload) });
      }
      if (req.method === 'POST') {
        const body = JSON.parse((await readBody(req, 2 * 1024 * 1024)).toString('utf8'));
        const conversationId = wsText(body.conversationId, 160);
        wsRequireConversation(conversationId);
        const externalId = wsText(body.externalId, 200);
        const id = wsText(body.id, 160) || wsCreateId('wsm');
        if (!WS_DIRECTIONS.has(wsText(body.direction, 16))) return json(res, 400, { error: 'WS 消息方向无效。' });
        const direction = wsText(body.direction, 16);
        const originalText = wsText(body.originalText, 12000);
        if (!originalText) return json(res, 400, { error: 'WS 原文不能为空。' });
        if (externalId) {
          const existing = db.prepare('SELECT * FROM ws_messages WHERE conversation_id=? AND external_id=?').get(conversationId, externalId);
          if (existing) {
            const translatedText = wsText(body.translatedText, 12000);
            if (translatedText && translatedText !== existing.translated_text) {
              db.prepare('UPDATE ws_messages SET translated_text=?,target_language=?,updated_at=? WHERE id=?').run(translatedText, wsText(body.targetLanguage, 40), new Date().toISOString(), existing.id);
              return json(res, 200, { ...wsMessagePayload(db.prepare('SELECT * FROM ws_messages WHERE id=?').get(existing.id)), existed: true, updated: true });
            }
            return json(res, 200, { ...wsMessagePayload(existing), existed: true });
          }
        }
        const now = new Date().toISOString();
        const data = wsObject(body.data, 32 * 1024);
        db.exec('BEGIN IMMEDIATE');
        try {
          db.prepare(`INSERT INTO ws_messages(id,conversation_id,external_id,direction,original_text,translated_text,source_language,target_language,order_no,data_json,created_at,updated_at)
            VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run(id, conversationId, externalId, direction, originalText, wsText(body.translatedText, 12000), wsText(body.sourceLanguage, 40), wsText(body.targetLanguage, 40), Number.isFinite(Number(body.order)) ? Number(body.order) : 0, JSON.stringify(data), now, now);
          db.prepare('UPDATE ws_conversations SET last_message_text=?,updated_at=? WHERE id=?').run(originalText.slice(0, 4000), now, conversationId);
          db.exec('COMMIT');
        } catch (error) { db.exec('ROLLBACK'); throw error; }
        return json(res, 200, { ...wsMessagePayload(db.prepare('SELECT * FROM ws_messages WHERE id=?').get(id)), existed: false });
      }
      return json(res, 405, { error: 'WS 消息只支持 GET/POST。' });
    }
    if (url.pathname === '/api/ws/analyses' && (req.method === 'POST' || req.method === 'PUT')) {
      const body = JSON.parse((await readBody(req, 1024 * 1024)).toString('utf8'));
      const conversationId = wsText(body.conversationId, 160);
      wsRequireConversation(conversationId);
      const result = wsObject(body.result, 128 * 1024);
      const confidence = Math.min(1, Math.max(0, Number(body.confidence) || 0));
      const now = new Date().toISOString(), id = wsCreateId('wsa');
      db.prepare('INSERT INTO ws_ai_analyses(id,conversation_id,result_json,confidence,provider_name,model,error_message,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)').run(id, conversationId, JSON.stringify(result), confidence, wsText(body.providerName, 120), wsText(body.model, 120), wsText(body.errorMessage, 1000), now, now);
      return json(res, 200, wsAnalysisPayload(db.prepare('SELECT * FROM ws_ai_analyses WHERE id=?').get(id)));
    }
    if (url.pathname === '/api/ws/replies' && (req.method === 'POST' || req.method === 'PUT')) {
      const body = JSON.parse((await readBody(req, 512 * 1024)).toString('utf8'));
      const conversationId = wsText(body.conversationId, 160);
      wsRequireConversation(conversationId);
      const status = WS_REPLY_STATUSES.has(wsText(body.status, 16)) ? wsText(body.status, 16) : 'draft';
      const now = new Date().toISOString(), id = wsCreateId('wsr');
      db.prepare('INSERT INTO ws_replies(id,conversation_id,original_text,translated_text,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?)').run(id, conversationId, wsText(body.originalText, 12000), wsText(body.translatedText, 12000), status, now, now);
      return json(res, 200, wsReplyPayload(db.prepare('SELECT * FROM ws_replies WHERE id=?').get(id)));
    }
    if (req.method === 'GET' && url.pathname === '/api/ws/diagnostics') {
      return json(res, 200, { schemaVersion: Number(db.prepare('PRAGMA user_version').get().user_version || 0), counts: { settings: Number(db.prepare('SELECT COUNT(*) AS count FROM ws_settings').get().count || 0), conversations: Number(db.prepare('SELECT COUNT(*) AS count FROM ws_conversations').get().count || 0), messages: Number(db.prepare('SELECT COUNT(*) AS count FROM ws_messages').get().count || 0), analyses: Number(db.prepare('SELECT COUNT(*) AS count FROM ws_ai_analyses').get().count || 0), replies: Number(db.prepare('SELECT COUNT(*) AS count FROM ws_replies').get().count || 0) } });
    }
    if (req.method === 'GET' && url.pathname === '/api/ws/export') {
      const conversations = db.prepare('SELECT * FROM ws_conversations ORDER BY updated_at DESC').all().map(wsConversationPayload);
      const settings = db.prepare('SELECT * FROM ws_settings ORDER BY updated_at DESC').all().map(wsSettingsPayload);
      const messages = db.prepare('SELECT * FROM ws_messages ORDER BY conversation_id,order_no,created_at').all().map(wsMessagePayload);
      const analyses = db.prepare('SELECT * FROM ws_ai_analyses ORDER BY created_at').all().map(wsAnalysisPayload);
      const replies = db.prepare('SELECT * FROM ws_replies ORDER BY created_at').all().map(wsReplyPayload);
      return json(res, 200, { schemaVersion: 5, createdAt: new Date().toISOString(), settings, conversations, messages, analyses, replies });
    }
    if (req.method === 'POST' && url.pathname === '/api/ws/import') {
      const body = JSON.parse((await readBody(req, 50 * 1024 * 1024)).toString('utf8'));
      const settings = Array.isArray(body.settings) ? body.settings.slice(0, 200) : [];
      const conversations = Array.isArray(body.conversations) ? body.conversations.slice(0, 5000) : [];
      const messages = Array.isArray(body.messages) ? body.messages.slice(0, 100000) : [];
      const analyses = Array.isArray(body.analyses) ? body.analyses.slice(0, 20000) : [];
      const replies = Array.isArray(body.replies) ? body.replies.slice(0, 20000) : [];
      const conversationIds = new Set(conversations.map(item => wsText(item.id, 160)).filter(Boolean));
      if (conversations.some(item => !wsText(item.id, 160) || !wsText(item.externalId, 160))) return json(res, 400, { error: 'WS 备份中的会话编号或外部标识无效。' });
      if (messages.some(item => !conversationIds.has(wsText(item.conversationId, 160)) || !WS_DIRECTIONS.has(wsText(item.direction, 16)) || !wsText(item.originalText, 12000))) return json(res, 400, { error: 'WS 备份中的消息格式无效。' });
      if (analyses.some(item => !conversationIds.has(wsText(item.conversationId, 160)))) return json(res, 400, { error: 'WS 备份中的 AI 分析关联无效。' });
      if (replies.some(item => !conversationIds.has(wsText(item.conversationId, 160)))) return json(res, 400, { error: 'WS 备份中的回复关联无效。' });
      db.exec('BEGIN IMMEDIATE');
      try {
        db.exec('DELETE FROM ws_messages; DELETE FROM ws_ai_analyses; DELETE FROM ws_replies; DELETE FROM ws_settings; DELETE FROM ws_conversations;');
        const now = new Date().toISOString();
        const addConversation = db.prepare('INSERT INTO ws_conversations(id,external_id,title,customer_id,last_message_text,intent_level,data_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)');
        for (const item of conversations) addConversation.run(wsText(item.id, 160), wsText(item.externalId, 160), wsText(item.title, 200), wsText(item.customerId, 128), wsText(item.lastMessageText, 4000), wsText(item.intentLevel, 40), JSON.stringify(wsObject(item.data, 32 * 1024)), wsIso(item.createdAt || now), wsIso(item.updatedAt || now));
        const addSetting = db.prepare('INSERT INTO ws_settings(conversation_id,enabled,receive_enabled,send_enabled,target_language,show_original,ai_enabled,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)');
        for (const item of settings) { const conversationId = wsText(item.conversationId, 160); if (!conversationIds.has(conversationId)) continue; addSetting.run(conversationId, item.enabled === false ? 0 : 1, item.receive === false || item.enabled === false ? 0 : 1, item.send === false || item.enabled === false ? 0 : 1, wsText(item.targetLanguage, 40) || '中文', item.showOriginal === false ? 0 : 1, item.aiEnabled === false ? 0 : 1, WS_STATUSES.has(wsText(item.status, 32)) ? wsText(item.status, 32) : '未连接', wsIso(item.createdAt || now), wsIso(item.updatedAt || now)); }
        const addMessage = db.prepare('INSERT INTO ws_messages(id,conversation_id,external_id,direction,original_text,translated_text,source_language,target_language,order_no,data_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)');
        for (const item of messages) addMessage.run(wsText(item.id, 160) || wsCreateId('wsm'), wsText(item.conversationId, 160), wsText(item.externalId, 200), wsText(item.direction, 16), wsText(item.originalText, 12000), wsText(item.translatedText, 12000), wsText(item.sourceLanguage, 40), wsText(item.targetLanguage, 40), Number.isFinite(Number(item.order)) ? Number(item.order) : 0, JSON.stringify(wsObject(item.data, 32 * 1024)), wsIso(item.createdAt || now), wsIso(item.updatedAt || now));
        const addAnalysis = db.prepare('INSERT INTO ws_ai_analyses(id,conversation_id,result_json,confidence,provider_name,model,error_message,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)');
        for (const item of analyses) addAnalysis.run(wsText(item.id, 160) || wsCreateId('wsa'), wsText(item.conversationId, 160), JSON.stringify(wsObject(item.result, 128 * 1024)), Math.min(1, Math.max(0, Number(item.confidence) || 0)), wsText(item.providerName, 120), wsText(item.model, 120), wsText(item.errorMessage, 1000), wsIso(item.createdAt || now), wsIso(item.updatedAt || now));
        const addReply = db.prepare('INSERT INTO ws_replies(id,conversation_id,original_text,translated_text,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?)');
        for (const item of replies) addReply.run(wsText(item.id, 160) || wsCreateId('wsr'), wsText(item.conversationId, 160), wsText(item.originalText, 12000), wsText(item.translatedText, 12000), WS_REPLY_STATUSES.has(wsText(item.status, 16)) ? wsText(item.status, 16) : 'draft', wsIso(item.createdAt || now), wsIso(item.updatedAt || now));
        db.exec('COMMIT');
      } catch (error) { db.exec('ROLLBACK'); throw error; }
      return json(res, 200, { ok: true, counts: { settings: settings.length, conversations: conversations.length, messages: messages.length, analyses: analyses.length, replies: replies.length } });
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
