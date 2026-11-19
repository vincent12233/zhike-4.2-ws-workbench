import { createServer } from 'node:http';
import { closeSync, createReadStream, createWriteStream, existsSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, extname, join, normalize, resolve, sep } from 'node:path';
import { hostname, uptime } from 'node:os';
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';

const require = createRequire(import.meta.url);
const { applyDelta } = require('./state-delta.cjs');
const wsCore = require('./modules/ws-workbench-core.js');
const wsCrmSync = require('./modules/ws-crm-sync-core.js');
const wsGroupMonitor = require('./modules/ws-group-monitor-core.js');
const wsGroupManager = require('./modules/ws-group-manager-core.js');
const customerGovernance = require('./modules/customer-governance-core.js');
const hotChatProfile = require('./modules/hot-chat-profile-core.js');
const wsMediaCore = require('./modules/ws-media-core.js');
const aiJobPipeline = require('./modules/ai-job-pipeline-core.js');
const aiCrmSuggestions = require('./modules/ai-crm-suggestion-core.js');
const wsWorkspaceQuery = require('./modules/ws-workspace-query.cjs');
const { DatabaseSync } = require('node:sqlite');
const { runMigrations } = require('./migration-runner.cjs');
const { SqliteFencedWriter, FencingError } = require('./sidecar-write-coordinator.cjs');
const { createTestDiagnostic } = require('./test-diagnostics.cjs');
const root = dirname(fileURLToPath(import.meta.url));
const APP_VERSION = '6.1.0';
const configuredDataDir = String(process.env.ZHIKE_DATA_DIR || '').trim();
const dataDir = configuredDataDir ? resolve(configuredDataDir) : join(root, 'data');
const wsMediaDir = join(dataDir, 'ws-media');
const wsExportDir = join(dataDir, 'exports');
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
const testStartupDiagnostics = createTestDiagnostic({
  envName: 'ZHIKE_TEST_STARTUP_DIAGNOSTICS',
  prefix: 'ZHIKE_TEST_SIDECAR_STARTUP',
  allowedFields: ['errorCode', 'schemaVersion', 'appliedCount', 'compatibilityCount'],
});
const testStartupDiagnostic = (phase, details = {}) => testStartupDiagnostics.emit(phase, details);
testStartupDiagnostic('modules-loaded');
// Stage 1.5 fencing is opt-in and fixture-only. Production sidecars do not
// create fencing tables or accept worker writes until a later approved cutover.
const fencingIsolationMode = String(process.env.ZHIKE_FENCING_MODE || '').trim().toLowerCase() === 'isolated';
// Stage 3 group-manager writes are isolated by an explicit environment gate.
// The normal desktop sidecar never enables this path; Mock Transport tests can
// opt in with ZHIKE_GROUP_MANAGER_MODE=isolated and a temporary data root.
const groupManagerIsolationMode = String(process.env.ZHIKE_GROUP_MANAGER_MODE || '').trim().toLowerCase() === 'isolated';
// A second explicit marker is required so an isolated group-manager route
// cannot be enabled accidentally by setting one broad environment variable on
// a normal data directory. Stage 3 API tests set both markers and always use
// a temporary data root; the production sidecar leaves them unset.
const stage3MockMode = groupManagerIsolationMode && String(process.env.ZHIKE_STAGE3_MOCK || '').trim() === '1';
// Stage 4 AI pipeline is isolated and mock-only until a separately approved cutover.
const aiPipelineIsolationMode = String(process.env.ZHIKE_AI_PIPELINE_MODE || '').trim().toLowerCase() === 'isolated';
const stage4MockMode = aiPipelineIsolationMode && String(process.env.ZHIKE_STAGE4_MOCK || '').trim() === '1';
const stage4AiEnabled = aiPipelineIsolationMode && stage4MockMode && fencingIsolationMode;
mkdirSync(dataDir, { recursive: true });
testStartupDiagnostic('data-directory-ready');

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

testStartupDiagnostic('workspace-lock-start');
try {
  acquireWorkspaceLock();
  testStartupDiagnostic('workspace-lock-acquired');
} catch (error) {
  testStartupDiagnostic('workspace-lock-failed', { errorCode: String(error?.code || 'UNKNOWN').slice(0, 40) });
  console.error(error.message || '工作目录已在运行。');
  process.exit(1);
}
process.on('exit', releaseWorkspaceLock);

testStartupDiagnostic('database-open-start');
const db = new DatabaseSync(dbPath);
testStartupDiagnostic('database-opened');
// Migrations are driven exclusively by migrations/manifest.json.  The runner
// checks the schema ceiling before changing SQLite state, coordinates other
// sidecars with a migration-only lease, snapshots the database and verifies
// integrity around every transactional step.
testStartupDiagnostic('migrations-start');
const migrationResult = runMigrations({
  db,
  dbPath,
  migrationDir: join(root, 'migrations'),
  manifestPath: join(root, 'migrations', 'manifest.json'),
  backupDir: join(dataDir, '.backups'),
  lockPath: join(dataDir, '.migration.lock'),
});
testStartupDiagnostic('migrations-completed', {
  schemaVersion: Number(migrationResult.version || 0), appliedCount: migrationResult.applied?.length || 0,
  compatibilityCount: migrationResult.compatibility?.length || 0,
});
if (migrationResult.compatibility?.length) console.warn('迁移兼容复核：024 精确末尾换行历史变体已验证，原校验记录已保留，迁移前备份与独立审计已记录。');
const fencedWriter = new SqliteFencedWriter(db);
if (fencingIsolationMode) fencedWriter.ensureSchema();
// Versioned migrations own every SQLite schema change.  In particular, ai_jobs
// is created by migration 020 and startup performs no ad-hoc queue DDL or
// unconditional recovery write; stale leases are recovered by the claim API.
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
testStartupDiagnostic('workspace-bootstrap-completed');

function databaseDiagnostics() {
  const integrity = db.prepare('PRAGMA integrity_check').all().map(row => Object.values(row)[0]);
  const quickCheck = db.prepare('PRAGMA quick_check').all().map(row => Object.values(row)[0]);
  const foreignKeys = db.prepare('PRAGMA foreign_key_check').all();
  const pageCount = Number(db.prepare('PRAGMA page_count').get().page_count || 0);
  const pageSize = Number(db.prepare('PRAGMA page_size').get().page_size || 0);
  const state = readState();
  const activeCustomers = (state?.customers || []).filter(customer => !customer.deleted);
  const normalizedPhone = customer => wsCrmSync.normalizePhone(customer?.phone || customer?.rawPhone || '');
  const duplicatePhones = activeCustomers.length - new Set(activeCustomers.map(normalizedPhone).filter(Boolean)).size;
  // Soft deletion deliberately keeps the customer master and its independent
  // business records so a restore can recover the complete timeline. Those
  // records are not orphaned merely because the customer is currently hidden.
  const customerIds = new Set((state?.customers || []).filter(Boolean).map(customer => String(customer.id)));
  const orphaned = Object.fromEntries(['tickets','deposits','followups','registrations'].map(key => [key, (state?.[key] || []).filter(row => row.customerId && !customerIds.has(String(row.customerId))).length]));
  const phoneIndexRows = db.prepare('SELECT id,phone_normalized,data_json FROM customers').all();
  const phoneIndexMismatch = phoneIndexRows.filter(row => {
    let customer = null;
    try { customer = JSON.parse(row.data_json || '{}'); } catch {}
    return String(row.phone_normalized || '') !== normalizedPhone(customer);
  }).length;
  const wsOrphanedCustomerLinks = Number(db.prepare(`SELECT COUNT(*) AS count
    FROM ws_conversations c
    LEFT JOIN customers customer_row ON customer_row.id=c.customer_id
    WHERE c.customer_id<>'' AND customer_row.id IS NULL`).get().count || 0);
  const wsCounts = {
    settings: Number(db.prepare('SELECT COUNT(*) AS count FROM ws_settings').get().count || 0),
    conversations: Number(db.prepare('SELECT COUNT(*) AS count FROM ws_conversations').get().count || 0),
    messages: Number(db.prepare('SELECT COUNT(*) AS count FROM ws_messages').get().count || 0),
    analyses: Number(db.prepare('SELECT COUNT(*) AS count FROM ws_ai_analyses').get().count || 0),
    replies: Number(db.prepare('SELECT COUNT(*) AS count FROM ws_replies').get().count || 0),
    batches: Number(db.prepare('SELECT COUNT(*) AS count FROM ws_ingest_batches').get().count || 0),
  };
  return { ok: integrity.length === 1 && integrity[0] === 'ok' && !foreignKeys.length, checkedAt: new Date().toISOString(), schemaVersion: Number(db.prepare('PRAGMA user_version').get().user_version || 0), integrity, quickCheck, foreignKeyErrors: foreignKeys.length, databaseBytes: pageCount * pageSize, journalMode: db.prepare('PRAGMA journal_mode').get().journal_mode, counts: { customers: activeCustomers.length, registrations: state?.registrations?.length || 0, phoneRegistry: state?.phoneRegistry?.length || 0, followups: state?.followups?.length || 0, tickets: state?.tickets?.length || 0, deposits: state?.deposits?.length || 0, snapshots: Number(db.prepare('SELECT COUNT(*) AS count FROM state_snapshots').get().count || 0), ws: wsCounts }, anomalies: { duplicatePhones, orphaned, phoneIndexMismatch, wsOrphanedCustomerLinks } };
}

function json(res, status, value) {
  const body = JSON.stringify(value);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body), 'Cache-Control': 'no-store' });
  res.end(body);
}

function fencingLeaseFromPayload(value) {
  const source = value && typeof value === 'object' ? value : {};
  return {
    scopeKey: wsText(source.scopeKey || source.scope_key, 240),
    leaseId: wsText(source.leaseId || source.lease_id, 160),
    ownerId: wsText(source.ownerId || source.owner_id, 160),
    fencingToken: Number(source.fencingToken ?? source.fencing_token),
  };
}

function fencingLeasePayload(value) {
  return {
    scopeKey: wsText(value?.scopeKey, 240),
    leaseId: wsText(value?.leaseId, 160),
    ownerId: wsText(value?.ownerId, 160),
    fencingToken: Number(value?.fencingToken || 0),
    expiresAt: Number(value?.expiresAt || 0),
  };
}

function fencingErrorStatus(error) {
  return error instanceof FencingError && ['STALE_FENCE', 'LEASE_HELD', 'INVALID_OWNER', 'INVALID_WRITE', 'INVALID_EVENT', 'INVALID_CHECKPOINT'].includes(error.code) ? 409 : 400;
}

function fencingDelay(milliseconds) {
  const delay = Math.max(0, Math.min(10_000, Math.floor(Number(milliseconds) || 0)));
  return delay ? new Promise(resolveDelay => setTimeout(resolveDelay, delay)) : Promise.resolve();
}

// Large WS exports are intentionally streamed. Building nine full arrays and
// then JSON.stringify-ing the enclosing object temporarily kept several
// copies of a complete history in the sidecar process. The callback receives
// a bounded writer and must return false when the client disconnects.
async function streamJsonObject(res, status, writeBody) {
  let closed = false;
  const markClosed = () => { closed = true; };
  res.once('close', markClosed);
  const waitForDrain = () => new Promise(resolve => {
    if (closed || res.destroyed) { resolve(false); return; }
    let settled = false;
    const finish = value => {
      if (settled) return;
      settled = true;
      res.removeListener('drain', onDrain);
      res.removeListener('close', onClose);
      resolve(value);
    };
    const onDrain = () => finish(true);
    const onClose = () => finish(false);
    res.once('drain', onDrain);
    res.once('close', onClose);
  });
  const write = async chunk => {
    if (closed || res.destroyed || res.writableEnded) return false;
    try {
      if (res.write(chunk)) return true;
      return await waitForDrain();
    } catch {
      closed = true;
      return false;
    }
  };
  try {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    const completed = await writeBody(write);
    if (completed !== false && !closed && !res.destroyed && !res.writableEnded) res.end();
  } catch (error) {
    if (!res.headersSent) throw error;
    // Headers are already committed; an error body would corrupt the JSON
    // contract. Closing the stream lets the caller retry the export safely.
    res.destroy();
  } finally {
    res.removeListener('close', markClosed);
  }
}

async function writeJsonArray(write, statement, accountId, mapper) {
  const pageSize = 256;
  const maxChunkChars = 64 * 1024;
  let chunk = '[';
  let first = true;
  let offset = 0;
  while (true) {
    // Fully consume a small SQLite page before awaiting network backpressure.
    // The read cursor is therefore released between writes and cannot hold a
    // long-lived read lock over foreground CRM/WS writes.
    const page = [];
    for (const row of statement.iterate(accountId, pageSize, offset)) page.push(row);
    if (!page.length) break;
    for (const row of page) {
      const fragment = `${first ? '' : ','}${JSON.stringify(mapper(row))}`;
      first = false;
      if (chunk.length + fragment.length > maxChunkChars && chunk !== '[') {
        if (!(await write(chunk))) return false;
        chunk = fragment;
      } else {
        chunk += fragment;
      }
    }
    offset += page.length;
    if (page.length < pageSize) break;
  }
  chunk += ']';
  return write(chunk);
}

async function writeJsonArrayArgs(write, statement, args, mapper, predicate = null) {
  const pageSize = 256;
  const maxChunkChars = 64 * 1024;
  let chunk = '[';
  let first = true;
  let offset = 0;
  while (true) {
    const page = [];
    for (const row of statement.iterate(...args, pageSize, offset)) page.push(row);
    if (!page.length) break;
    for (const row of page) {
      if (predicate && !predicate(row)) continue;
      const fragment = `${first ? '' : ','}${JSON.stringify(mapper(row))}`;
      first = false;
      if (chunk.length + fragment.length > maxChunkChars && chunk !== '[') {
        if (!(await write(chunk))) return false;
        chunk = fragment;
      } else chunk += fragment;
    }
    offset += page.length;
    if (page.length < pageSize) break;
  }
  chunk += ']';
  return write(chunk);
}

function wsExportAccountIds(options = {}) {
  if (options.allAccounts) return db.prepare("SELECT id FROM ws_accounts ORDER BY CASE WHEN id='default' THEN 0 ELSE 1 END, created_at ASC").all().map(row => String(row.id));
  const accountId = wsAccountId(options.accountId);
  wsRequireAccount(accountId);
  return [accountId];
}

function wsExportInClause(accountIds) {
  return accountIds.length ? accountIds.map(() => '?').join(',') : "''";
}

function wsExportSafeValue(value, depth = 0, key = '') {
  if (depth > 32) return null;
  if (/(?:password|secret|token|cookie|api[_-]?key|authorization|credential|private[_-]?key)/i.test(key)) return undefined;
  if (Array.isArray(value)) return value.map(item => wsExportSafeValue(item, depth + 1, key)).filter(item => item !== undefined);
  if (!value || typeof value !== 'object') return value;
  const out = {};
  for (const [childKey, childValue] of Object.entries(value)) {
    const safe = wsExportSafeValue(childValue, depth + 1, childKey);
    if (safe !== undefined) out[childKey] = safe;
  }
  return out;
}

function wsExportCrmState() {
  return wsExportSafeValue(readState() || emptyCrmState()) || emptyCrmState();
}

function wsExportContactPayload(row) {
  const data = wsJson(row.data_json, {});
  const phone = wsText(data.phone || data.phoneNumber || data.contactPhone || data.memberPhone, 80);
  return {
    id: row.id,
    accountId: row.account_id || 'default',
    conversationId: row.id,
    externalId: row.external_id,
    customerId: row.customer_id || '',
    name: row.title || phone || row.external_id,
    phone,
    language: row.language || '',
    data,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// The data center and the WS workbench share one SQLite database, but WS
// records intentionally live in account-scoped tables instead of the CRM
// state JSON. Keep this read-only projection as the explicit bridge between
// those two domains. It is bounded to counts and IDs so opening the data
// center never loads a complete chat archive into the renderer.
function wsDataArchiveSummary(options = {}) {
  const accountIds = options.allAccounts || !options.accountId
    ? wsExportAccountIds({ allAccounts: true })
    : wsExportAccountIds({ accountId: options.accountId });
  const placeholders = wsExportInClause(accountIds);
  const crmState = readState() || emptyCrmState();
  const customers = Array.isArray(crmState.customers) ? crmState.customers.filter(Boolean) : [];
  const activeCustomers = customers.filter(customer => customer.deleted !== true);
  const customerIds = new Set(customers.map(customer => String(customer.id || '')).filter(Boolean));
  const activeCustomerIds = new Set(activeCustomers.map(customer => String(customer.id || '')).filter(Boolean));
  const conversations = db.prepare(`SELECT id,account_id,customer_id,title,data_json,unread_count,updated_at FROM ws_conversations WHERE account_id IN (${placeholders})`).all(...accountIds);
  const direct = conversations.filter(row => wsCore.conversationType(row) === 'direct');
  const vipGroups = conversations.filter(row => wsCore.conversationType(row) === 'vip_group');
  const linkedDirect = direct.filter(row => wsText(row.customer_id, 128));
  const linkedCustomerIds = new Set(linkedDirect.map(row => wsText(row.customer_id, 128)).filter(Boolean));
  const accountRows = db.prepare(`SELECT * FROM ws_accounts WHERE id IN (${placeholders}) ORDER BY CASE WHEN id='default' THEN 0 ELSE 1 END,created_at ASC`).all(...accountIds);
  const accountMap = new Map(accountRows.map(row => [String(row.id), row]));
  const perAccount = accountIds.map(accountId => {
    const accountConversations = conversations.filter(row => String(row.account_id) === accountId);
    const accountDirect = accountConversations.filter(row => wsCore.conversationType(row) === 'direct');
    const accountVipGroups = accountConversations.filter(row => wsCore.conversationType(row) === 'vip_group');
    const accountLinked = accountDirect.filter(row => wsText(row.customer_id, 128));
    const accountCount = (table, where = '') => Number(db.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE account_id=?${where ? ` AND ${where}` : ''}`).get(accountId)?.count || 0);
    const row = accountMap.get(accountId);
    return {
      id: accountId,
      displayName: row?.display_name || accountId,
      status: row?.status || '未连接',
      enabled: Boolean(row?.enabled),
      conversations: accountConversations.length,
      directContacts: accountDirect.length,
      vipGroups: accountVipGroups.length,
      linkedConversations: accountLinked.length,
      unlinkedDirectConversations: Math.max(0, accountDirect.length - accountLinked.length),
      unreadConversations: accountConversations.filter(item => Number(item.unread_count || 0) > 0).length,
      completeHistoryConversations: accountConversations.filter(item => {
        const data = wsJson(item.data_json, {});
        return data.historyLoaded === true && wsText(data.historyFingerprint, 500) && wsText(data.historyFingerprint, 500) === wsText(data.lastMessageFingerprint, 500);
      }).length,
      messages: accountCount('ws_messages'),
      analyses: accountCount('ws_ai_analyses'),
      aiJobs: accountCount('ai_jobs'),
      aiQueue: aiJobStats(accountId),
      collectionPending: accountCount('ws_collection_items', "status IN ('queued','running','retryable')"),
      analysesPending: accountCount('ws_collection_items', "analysis_status IN ('pending','running','retryable','failed')"),
      followupAlertsOpen: accountCount('ws_followup_alerts', "status IN ('open','snoozed')"),
      groups: accountCount('ws_group_catalog'),
      groupMembershipEvents: accountCount('ws_group_membership_events'),
      mediaAssets: accountCount('ws_media_assets'),
      mediaUnavailable: accountCount('ws_media_assets', "status='unavailable' OR status='deleted'"),
      updatedAt: accountConversations.map(item => item.updated_at).filter(Boolean).sort().at(-1) || '',
    };
  });
  const sum = key => perAccount.reduce((total, row) => total + Number(row[key] || 0), 0);
  const orphanedConversationLinks = [...linkedCustomerIds].filter(customerId => !customerIds.has(customerId));
  return {
    schemaVersion: 1,
    source: 'sqlite',
    generatedAt: new Date().toISOString(),
    scope: accountIds.length > 1 || options.allAccounts || !options.accountId ? 'all' : 'account',
    accountIds,
    accounts: perAccount,
    crm: {
      customers: customers.length,
      activeCustomers: activeCustomers.length,
      deletedCustomers: Math.max(0, customers.length - activeCustomers.length),
      linkedCustomers: [...linkedCustomerIds].filter(customerId => activeCustomerIds.has(customerId)).length,
      unlinkedCustomers: Math.max(0, activeCustomers.length - [...linkedCustomerIds].filter(customerId => activeCustomerIds.has(customerId)).length),
    },
    ws: {
      conversations: conversations.length,
      directContacts: direct.length,
      vipGroups: vipGroups.length,
      completeHistoryConversations: sum('completeHistoryConversations'),
      unreadConversations: sum('unreadConversations'),
      messages: sum('messages'),
      analyses: sum('analyses'),
      aiJobs: sum('aiJobs'),
      aiJobsPending: perAccount.reduce((total, row) => total + Number(row.aiQueue?.queued || 0) + Number(row.aiQueue?.retryable || 0) + Number(row.aiQueue?.running || 0), 0),
      aiJobsFailed: perAccount.reduce((total, row) => total + Number(row.aiQueue?.failed || 0), 0),
      analysesPending: sum('analysesPending'),
      collectionPending: sum('collectionPending'),
      followupAlertsOpen: sum('followupAlertsOpen'),
      groups: sum('groups'),
      groupMembershipEvents: sum('groupMembershipEvents'),
      mediaAssets: sum('mediaAssets'),
      mediaUnavailable: sum('mediaUnavailable'),
    },
    links: {
      linkedConversations: linkedDirect.length,
      unlinkedDirectConversations: Math.max(0, direct.length - linkedDirect.length),
      orphanedConversationLinks,
      orphanedConversationLinkCount: orphanedConversationLinks.length,
    },
  };
}

function wsExportManifest(accountIds, createdAt, scope = accountIds.length > 1 ? 'all' : 'account') {
  const placeholders = wsExportInClause(accountIds);
  const count = table => Number(db.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE account_id IN (${placeholders})`).get(...accountIds)?.count || 0);
  const directContacts = Number(db.prepare(`SELECT COUNT(*) AS count FROM ws_conversations WHERE account_id IN (${placeholders}) AND COALESCE(json_extract(data_json,'$.isGroup'),0)=0 AND COALESCE(json_extract(data_json,'$.conversationType'),'direct')='direct'`).get(...accountIds)?.count || 0);
  return {
    format: 'zhike.ws.export.v2',
    scope,
    accountIds,
    schemaVersion: 6,
    createdAt,
    counts: {
      contacts: directContacts,
      settings: count('ws_settings'),
      conversations: count('ws_conversations'),
      messages: count('ws_messages'),
      analyses: count('ws_ai_analyses'),
      replies: count('ws_replies'),
      batches: count('ws_ingest_batches'),
      collectionRuns: count('ws_collection_runs'),
      collectionItems: count('ws_collection_items'),
      followupAlerts: count('ws_followup_alerts'),
      sendAudit: count('ws_send_audit'),
      mediaAssets: count('ws_media_assets'),
      groups: count('ws_group_catalog'),
      groupMembershipEvents: count('ws_group_membership_events'),
    },
  };
}

async function writeWsExport(write, options = {}) {
  const createdAt = options.createdAt || new Date().toISOString();
  const accountIds = options.accountIds || wsExportAccountIds(options);
  const placeholders = wsExportInClause(accountIds);
  const args = accountIds;
  const statement = sql => db.prepare(sql.replaceAll(':accounts', placeholders));
  const arrays = [
    ['settings', statement('SELECT * FROM ws_settings WHERE account_id IN (:accounts) ORDER BY updated_at DESC LIMIT ? OFFSET ?'), wsSettingsPayload],
    ['conversations', statement('SELECT * FROM ws_conversations WHERE account_id IN (:accounts) ORDER BY updated_at DESC LIMIT ? OFFSET ?'), wsConversationPayload],
    ['messages', statement('SELECT * FROM ws_messages WHERE account_id IN (:accounts) ORDER BY account_id,conversation_id,order_no,created_at LIMIT ? OFFSET ?'), wsMessagePayload],
    ['analyses', statement('SELECT * FROM ws_ai_analyses WHERE account_id IN (:accounts) ORDER BY account_id,created_at LIMIT ? OFFSET ?'), wsAnalysisPayload],
    ['replies', statement('SELECT * FROM ws_replies WHERE account_id IN (:accounts) ORDER BY account_id,created_at LIMIT ? OFFSET ?'), wsReplyPayload],
    ['batches', statement('SELECT * FROM ws_ingest_batches WHERE account_id IN (:accounts) ORDER BY account_id,created_at LIMIT ? OFFSET ?'), wsBatchPayload],
    ['collectionRuns', statement('SELECT * FROM ws_collection_runs WHERE account_id IN (:accounts) ORDER BY account_id,created_at LIMIT ? OFFSET ?'), wsCollectionRunPayload],
    ['collectionItems', statement('SELECT * FROM ws_collection_items WHERE account_id IN (:accounts) ORDER BY account_id,created_at LIMIT ? OFFSET ?'), wsCollectionItemPayload],
    ['followupAlerts', statement('SELECT * FROM ws_followup_alerts WHERE account_id IN (:accounts) ORDER BY account_id,created_at LIMIT ? OFFSET ?'), wsFollowupAlertPayload],
    ['sendAudit', statement('SELECT * FROM ws_send_audit WHERE account_id IN (:accounts) ORDER BY account_id,created_at LIMIT ? OFFSET ?'), wsSendAuditPayload],
    ['mediaAssets', statement('SELECT * FROM ws_media_assets WHERE account_id IN (:accounts) ORDER BY account_id,created_at LIMIT ? OFFSET ?'), wsMediaPayload],
    ['groups', statement('SELECT * FROM ws_group_catalog WHERE account_id IN (:accounts) ORDER BY account_id,last_seen_at DESC,group_name LIMIT ? OFFSET ?'), wsGroupCatalogPayload],
    ['groupMembershipEvents', statement(`SELECT e.*,t.group_name AS target_group_name,t.source_id AS target_source_id,t.channel_id AS target_channel_id,t.data_json AS target_data_json
      FROM ws_group_membership_events e LEFT JOIN ws_group_monitor_targets t ON t.id=e.target_id
      WHERE e.account_id IN (:accounts) ORDER BY e.account_id,e.observed_at,e.id LIMIT ? OFFSET ?`), wsGroupMonitorEventPayload],
    ['contacts', statement('SELECT * FROM ws_conversations WHERE account_id IN (:accounts) ORDER BY account_id,updated_at DESC LIMIT ? OFFSET ?'), wsExportContactPayload, row => wsCore.conversationType(row) === 'direct'],
  ];
  const manifest = wsExportManifest(accountIds, createdAt, options.allAccounts ? 'all' : 'account');
  const accounts = accountIds.map(id => wsAccountPayload(wsAccountRow(id))).filter(Boolean);
  if (!(await write(`{"schemaVersion":6,"exportVersion":2,"createdAt":${JSON.stringify(createdAt)},"manifest":${JSON.stringify(manifest)},"accounts":${JSON.stringify(accounts)}`))) return false;
  for (const [name, query, mapper, predicate] of arrays) {
    if (!(await write(`,"${name}":`))) return false;
    if (!(await writeJsonArrayArgs(write, query, args, mapper, predicate))) return false;
  }
  if (!(await write(`,"crmState":${JSON.stringify(wsExportCrmState())}`))) return false;
  return write('}');
}

async function streamWsExport(res, accountId, options = {}) {
  return streamJsonObject(res, 200, write => writeWsExport(write, { ...options, accountId }));
}

const wsExportJobsInFlight = new Set();
function wsExportJobPayload(row) {
  if (!row) return null;
  return {
    id: row.id,
    scope: row.scope,
    accountId: row.account_id || '',
    status: row.status,
    progressTotal: Number(row.progress_total || 0),
    progressDone: Number(row.progress_done || 0),
    progress: Number(row.progress_total || 0) > 0 ? Math.min(1, Number(row.progress_done || 0) / Number(row.progress_total || 1)) : (row.status === 'completed' ? 1 : 0),
    outputPath: row.output_path || '',
    outputSha256: row.output_sha256 || '',
    errorMessage: row.error_message || '',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    expiresAt: row.expires_at || '',
    downloadUrl: row.status === 'completed' ? `/api/ws/export-jobs/${encodeURIComponent(row.id)}/download` : '',
  };
}
function wsExportJobPath(row) {
  const relative = wsText(row?.output_path, 500);
  if (!relative) return '';
  const base = resolve(dataDir);
  const absolute = resolve(dataDir, relative);
  return absolute === base || !absolute.startsWith(`${base}${sep}`) ? '' : absolute;
}
function wsExportJobEstimate(accountIds) {
  const manifest = wsExportManifest(accountIds, new Date().toISOString());
  return Object.values(manifest.counts).reduce((total, count) => total + Number(count || 0), 0) + accountIds.length + 1;
}
async function runWsExportJob(jobId) {
  if (wsExportJobsInFlight.has(jobId)) return;
  wsExportJobsInFlight.add(jobId);
  let tempPath = '';
  try {
    const row = db.prepare('SELECT * FROM ws_export_jobs WHERE id=?').get(jobId);
    if (!row || row.status === 'cancelled') return;
    const accountIds = row.scope === 'all' ? wsExportAccountIds({ allAccounts: true }) : wsExportAccountIds({ accountId: row.account_id });
    const now = new Date().toISOString();
    const total = wsExportJobEstimate(accountIds);
    db.prepare("UPDATE ws_export_jobs SET status='running',progress_total=?,progress_done=0,error_message='',updated_at=? WHERE id=? AND status='queued'").run(total, now, jobId);
    const outputRelative = join('exports', `${jobId}.json`);
    tempPath = join(dataDir, `${jobId}.json.part`);
    mkdirSync(wsExportDir, { recursive: true });
    const output = createWriteStream(tempPath, { flags: 'w', mode: 0o600 });
    const waitForError = new Promise((_, reject) => output.once('error', reject));
    const writeChunk = chunk => new Promise((resolve, reject) => {
      const onError = error => { output.removeListener('drain', onDrain); reject(error); };
      const onDrain = () => { output.removeListener('error', onError); resolve(true); };
      output.once('error', onError);
      if (output.write(chunk)) { output.removeListener('error', onError); resolve(true); }
      else output.once('drain', onDrain);
    });
    const hash = createHash('sha256');
    const completed = await Promise.race([
      writeWsExport(chunk => { hash.update(chunk); return writeChunk(chunk); }, { accountIds, allAccounts: row.scope === 'all', accountId: row.account_id }),
      waitForError,
    ]);
    if (completed === false) throw new Error('导出写入被中断。');
    await new Promise((resolveDone, rejectDone) => output.end(error => error ? rejectDone(error) : resolveDone()));
    const finalPath = join(dataDir, outputRelative);
    renameSync(tempPath, finalPath);
    tempPath = '';
    const finishedAt = new Date().toISOString();
    db.prepare("UPDATE ws_export_jobs SET status='completed',progress_done=?,output_path=?,output_sha256=?,updated_at=? WHERE id=?").run(total, outputRelative, hash.digest('hex'), finishedAt, jobId);
  } catch (error) {
    try { if (tempPath) rmSync(tempPath, { force: true }); } catch {}
    const failedAt = new Date().toISOString();
    db.prepare("UPDATE ws_export_jobs SET status='failed',error_message=?,updated_at=? WHERE id=? AND status<>'cancelled'").run(wsText(error?.message || error, 1000), failedAt, jobId);
  } finally {
    wsExportJobsInFlight.delete(jobId);
  }
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

function crmPhoneConflicts(customers = []) {
  const groups = new Map();
  for (const customer of (Array.isArray(customers) ? customers : [])) {
    if (!customer || customer.deleted === true) continue;
    const phone = wsCrmSync.normalizePhone(customer.phone || customer.rawPhone || '');
    if (!phone) continue;
    const list = groups.get(phone) || [];
    list.push({ id: String(customer.id || ''), name: String(customer.name || ''), phone: String(customer.phone || customer.rawPhone || ''), deleted: false });
    groups.set(phone, list);
  }
  return [...groups.entries()]
    .filter(([, rows]) => rows.length > 1)
    .map(([canonicalPhone, rows]) => ({ canonicalPhone, customerIds: rows.map(row => row.id), customers: rows }));
}

function crmPhoneConflictError(conflicts) {
  const error = new Error('客户手机号标准化后发生重复，已拒绝写入；请在数据治理中人工核对，不会自动合并或删除。');
  error.status = 409;
  error.code = 'CRM_PHONE_CONFLICT';
  error.conflicts = conflicts;
  return error;
}

function validateState(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !Array.isArray(value.customers) || value.customers.length > 250000) throw new Error('客户数据格式无效或超过允许数量。');
  const phoneConflicts = crmPhoneConflicts(value.customers);
  if (phoneConflicts.length) throw crmPhoneConflictError(phoneConflicts);
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
    // Keep the indexed value canonical so phone-based WS/CRM matching and
    // diagnostics use the same digits as the browser-side identity matcher.
    upsert.run(id, wsCrmSync.normalizePhone(customer.phone || customer.rawPhone || ''), String(customer.name || ''), String(customer.source || ''), String(customer.assistant || ''), String(customer.status || ''), String(customer.phase || ''), customer.deleted ? 1 : 0, dataJson);
  }
  const remove = db.prepare('DELETE FROM customers WHERE id=?');
  if (delta) for (const id of delta.remove) remove.run(id);
  for (const id of existingRows.keys()) if (!keepIds.has(id)) remove.run(id);
    if (manageTransaction) db.exec('COMMIT');
  } catch (error) {
    if (manageTransaction) db.exec('ROLLBACK');
    if (/customers\.phone_normalized|idx_customers_phone_active/i.test(String(error?.message || ''))) {
      throw crmPhoneConflictError(crmPhoneConflicts(value.customers));
    }
    throw error;
  }
}

// Older 6.0.3 workspaces may have written the display/raw phone into the
// `phone_normalized` index before the archive bridge was added. Repair only
// the derived index column at boot; the CRM source JSON and revision remain
// untouched. This makes existing data searchable immediately after upgrade.
function repairCustomerPhoneIndex() {
  const rows = db.prepare('SELECT id,phone_normalized,deleted,data_json FROM customers').all();
  const normalizedGroups = new Map();
  for (const row of rows) {
    let customer = null;
    try { customer = JSON.parse(row.data_json || '{}'); } catch {}
    if (Number(row.deleted) === 1 || customer?.deleted === true) continue;
    const normalized = wsCrmSync.normalizePhone(customer?.phone || customer?.rawPhone || '');
    if (!normalized) continue;
    const list = normalizedGroups.get(normalized) || [];
    list.push({ id: String(row.id), name: String(customer?.name || ''), phone: String(customer?.phone || customer?.rawPhone || ''), deleted: false });
    normalizedGroups.set(normalized, list);
  }
  const conflicts = [...normalizedGroups.entries()]
    .filter(([, list]) => list.length > 1)
    .map(([canonicalPhone, customers]) => ({ canonicalPhone, customerIds: customers.map(item => item.id), customers }));
  if (conflicts.length) throw crmPhoneConflictError(conflicts);
  const update = db.prepare('UPDATE customers SET phone_normalized=? WHERE id=?');
  db.exec('BEGIN IMMEDIATE');
  try {
    for (const row of rows) {
      let customer = null;
      try { customer = JSON.parse(row.data_json || '{}'); } catch {}
      const normalized = wsCrmSync.normalizePhone(customer?.phone || customer?.rawPhone || '');
      if (String(row.phone_normalized || '') !== normalized) update.run(normalized, row.id);
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
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
  ['geometry-align-outgoing', 'send'], ['geometry-align-incoming', 'receive'],
  ['geometry-right', 'send'], ['geometry-left', 'receive'],
]);
const WS_NATIVE_DIRECTION_SOURCES = new Set(WS_NATIVE_DIRECTION_SOURCE_MAP.keys());
const WS_REPLY_STATUSES = new Set(['draft', 'copied', 'confirmed']);
const WS_TRANSLATION_STATUSES = new Set(['none', 'pending', 'translated', 'failed', 'skipped']);
const WS_SEND_AUDIT_STATUSES = new Set(['queued', 'sending', 'sent', 'failed', 'rate_limited', 'cancelled']);
// A conservative local-only throttle protects against accidental duplicate
// clicks while still allowing a normal one-to-one follow-up batch.  The
// counter is per isolated WS account, never shared across accounts.
const WS_SEND_RATE_LIMIT = 20;
const WS_SEND_RATE_WINDOW_MS = 60 * 1000;
const WS_BROADCAST_MAX_RECIPIENTS = 50;
const wsSendRateWindows = new Map();
const WS_MESSAGE_MAX_CHARS = 128000;
const WS_MESSAGE_BATCH_MAX_BYTES = 72 * 1024 * 1024;
const WS_MEDIA_REQUEST_MAX_BYTES = 34 * 1024 * 1024;
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

function stage3GroupManagerFlags() {
  return {
    IndependentWsGroupManagerEnabled: stage3MockMode,
    GroupMemberSyncEnabled: stage3MockMode,
    GroupCrmAutoCreateEnabled: stage3MockMode,
    GroupMessageCollectionEnabled: stage3MockMode,
    GroupReadEvidenceEnabled: stage3MockMode,
  };
}

function stage3GroupManagerGuard() {
  if (!stage3MockMode) {
    const error = new Error('独立 WS 群组管理仅在隔离 Mock 环境启用。');
    error.status = 404;
    error.code = 'GROUP_MANAGER_DISABLED';
    throw error;
  }
}

function stage3GroupJid(value) {
  const normalized = wsGroupMonitor.normalizeMemberIdentity(value).value;
  if (!normalized || !/@g\.us$/i.test(normalized)) throw new Error('groupJid 必须是有效的 WS 群组 JID。');
  return normalized.toLocaleLowerCase();
}

function stage3GroupManagerAudit(accountId, groupJid, action, data = {}, outcome = 'accepted', reason = '') {
  const now = new Date().toISOString();
  db.prepare(`INSERT INTO ws_group_audit(id,account_id,group_jid,actor,action,entity_type,entity_id,outcome,reason,data_json,created_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(wsCreateId('wsg-audit'), accountId, groupJid || '', 'isolated-mock', action, 'group', groupJid || '', outcome, reason, JSON.stringify(data || {}), now);
}

function stage3GroupManagerCrm() {
  const state = readState() || emptyCrmState();
  if (!Array.isArray(state.customers)) state.customers = [];
  const pending = [];
  const candidateIdMap = new Map();
  let committed = false;
  const normalize = value => wsGroupMonitor.normalizeMemberIdentity(value).phone || '';
  const findByPhone = phone => {
    const canonical = normalize(phone);
    if (!canonical) return null;
    const matches = [...state.customers, ...pending].filter(item => item && item.deleted !== true && normalize(item.phone || item.rawPhone) === canonical);
    return matches.length === 1 ? matches[0] : matches.length > 1 ? { conflict: true, matches } : null;
  };
  return {
    findByPhone,
    createCustomer(data = {}) {
      const phone = normalize(data.phone || data.rawPhone);
      if (!phone) return null;
      const existing = findByPhone(phone);
      if (existing) return existing;
      const now = new Date().toISOString();
      const customer = {
        id: `C-WG-${randomUUID()}`,
        name: phone,
        rawPhone: wsText(data.rawPhone || phone, 120),
        phone,
        source: '未分类，待绑定',
        channel: '未分类，待绑定',
        status: '未进群',
        phase: '新客户',
        deleted: false,
        groupMemberships: [],
        statusHistory: [],
        createdAt: now,
        updatedAt: now,
        sourceMeta: { accountId: wsText(data.accountId, 120), groupJid: wsText(data.groupJid, 180), origin: 'stage3-isolated-mock' },
      };
      pending.push(customer);
      return customer;
    },
    commit() {
      if (!pending.length) return [];
      const current = readState() || emptyCrmState();
      const currentCustomers = Array.isArray(current.customers) ? current.customers : [];
      candidateIdMap.clear();
      for (const candidate of pending) {
        const canonical = normalize(candidate.phone || candidate.rawPhone);
        const existing = currentCustomers.find(item => item && item.deleted !== true && normalize(item.phone || item.rawPhone) === canonical);
        if (existing) {
          candidateIdMap.set(candidate.id, existing.id);
        } else {
          currentCustomers.push(candidate);
          candidateIdMap.set(candidate.id, candidate.id);
        }
      }
      current.customers = currentCustomers;
      writeState(current, false);
      const committedCandidates = pending.splice(0, pending.length);
      committed = true;
      return committedCandidates;
    },
    resolveCustomerId(id) { return candidateIdMap.get(wsText(id, 128)) || wsText(id, 128); },
    rollback() {
      // writeState participates in the surrounding SQLite transaction. If a
      // later relationship/audit insert fails, clearing the staged candidates
      // is enough for the transaction rollback to remove the CRM write too.
      pending.splice(0, pending.length);
      candidateIdMap.clear();
      committed = false;
    },
  };
}

function stage3GroupMemberPayload(row) {
  const data = wsJson(row.data_json, {});
  return {
    id: row.id,
    accountId: row.account_id,
    groupJid: row.group_jid,
    memberJid: row.member_jid,
    memberPhone: row.member_phone,
    displayName: row.display_name,
    role: row.role,
    status: row.status,
    firstSeenAt: row.first_seen_at,
    lastSeenAt: row.last_seen_at,
    source: row.source,
    manualLocked: Boolean(row.manual_locked),
    evidence: wsJson(row.evidence_json, {}),
    customerId: wsText(data.customerId, 128), correlationId: wsText(data.correlationId, 160),
    data,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
function stage3GroupMessagePayload(row) {
  if (!row) return null;
  return {
    id: row.id,
    accountId: row.account_id,
    groupJid: row.group_jid,
    messageId: row.message_id,
    senderJid: row.sender_jid,
    senderPhone: row.sender_phone,
    sentAt: row.sent_at,
    type: row.message_type,
    processingStatus: row.processing_status,
    sourceEvidence: row.source_evidence,
    bodyHash: row.body_hash, correlationId: wsText(wsJson(row.data_json, {}).correlationId, 160),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
function stage3ReadRank(status) { return ({ unknown: 0, delivered: 1, read: 2 }[String(status || '').toLowerCase()] ?? -1); }
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
function wsAccountTimestamp(value) {
  // Migration 008 seeds the default account with SQLite's UTC datetime('now') format.
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)) {
    return value.replace(' ', 'T') + 'Z';
  }
  return value;
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
    lastSeen: wsAccountTimestamp(row.last_seen_at || null),
    enabled: Boolean(row.enabled),
    createdAt: wsAccountTimestamp(row.created_at),
    updatedAt: wsAccountTimestamp(row.updated_at),
    settings: settings ? {
      translationEnabled: Boolean(settings.translation_enabled),
      aiEnabled: Boolean(settings.ai_enabled),
      autoCollectionEnabled: Boolean(settings.auto_collection_enabled),
    } : { translationEnabled: true, aiEnabled: true, autoCollectionEnabled: false },
  };
}

function wsGroupMonitorProfilePayload(row) {
  if (!row) return null;
  const targets = db.prepare('SELECT * FROM ws_group_monitor_targets WHERE profile_id=? ORDER BY enabled DESC, group_name COLLATE NOCASE, id').all(row.id).map(wsGroupMonitorTargetPayload);
  return {
    id: row.id,
    accountId: row.account_id,
    slotKey: row.slot_key,
    status: row.status,
    enabled: Boolean(row.enabled),
    pollIntervalSec: Number(row.poll_interval_sec || 45),
    lastHeartbeatAt: row.last_heartbeat_at || '',
    lastError: row.last_error || '',
    targets,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
function wsGroupMonitorTargetPayload(row) {
  if (!row) return null;
  return {
    id: row.id,
    profileId: row.profile_id,
    accountId: row.account_id,
    groupJid: row.group_jid,
    groupName: row.group_name,
    sourceId: row.source_id,
    channelId: row.channel_id || row.source_id || '',
    vipOnly: Boolean(row.vip_only),
    enabled: Boolean(row.enabled),
    lastSnapshotHash: row.last_snapshot_hash || '',
    lastSeenAt: row.last_seen_at || '',
    data: wsJson(row.data_json, {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
function wsGroupCatalogPayload(row) {
  if (!row) return null;
  return {
    id: row.id,
    accountId: row.account_id,
    groupJid: row.group_jid,
    groupName: row.group_name || row.group_jid,
    channelId: row.channel_id || '',
    participantCount: Number(row.participant_count || 0),
    lastMessageAt: row.last_message_at || '',
    discoverySource: row.discovery_source || 'ws-collector',
    status: row.status || 'active',
    data: wsJson(row.data_json, {}),
    firstSeenAt: row.first_seen_at || '',
    lastSeenAt: row.last_seen_at || '',
    createdAt: row.created_at || '',
    updatedAt: row.updated_at || '',
  };
}
function wsGroupCatalogUpsert(accountId, item = {}, now = new Date().toISOString()) {
  const groupJid = wsGroupMonitor.normalizeMemberIdentity(item.groupJid || item.group_id || item.groupId || item.conversationKey || item.externalId || item.jid).value;
  if (!groupJid || !/@g\.us$/i.test(groupJid)) return null;
  const groupName = wsText(item.groupName || item.group_name || item.displayName || item.title || item.name, 240);
  const channelId = wsText(item.channelId || item.channel_id || item.sourceId || item.source_id || item.channel || item.source, 160);
  const participantCount = Math.max(0, Math.floor(Number(item.participantCount ?? item.memberCount ?? item.members ?? 0) || 0));
  const lastMessageAt = wsStrictIso(item.lastMessageAt || item.last_message_at || item.updatedAt || item.updated_at) || '';
  const discoverySource = wsText(item.discoverySource || item.discovery_source || item.source || 'ws-collector', 80) || 'ws-collector';
  const status = ['active', 'inactive', 'unknown'].includes(wsText(item.status, 20)) ? wsText(item.status, 20) : 'active';
  const data = item.data && typeof item.data === 'object' && !Array.isArray(item.data) ? item.data : {};
  const existing = db.prepare('SELECT * FROM ws_group_catalog WHERE account_id=? AND group_jid=?').get(accountId, groupJid);
  const id = existing?.id || `wsg-catalog-${randomUUID()}`;
  db.prepare(`INSERT INTO ws_group_catalog(id,account_id,group_jid,group_name,channel_id,participant_count,last_message_at,discovery_source,status,data_json,first_seen_at,last_seen_at,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(account_id,group_jid) DO UPDATE SET
      group_name=CASE WHEN excluded.group_name<>'' THEN excluded.group_name ELSE ws_group_catalog.group_name END,
      channel_id=CASE WHEN excluded.channel_id<>'' THEN excluded.channel_id ELSE ws_group_catalog.channel_id END,
      participant_count=CASE WHEN excluded.participant_count>0 THEN excluded.participant_count ELSE ws_group_catalog.participant_count END,
      last_message_at=CASE WHEN excluded.last_message_at>ws_group_catalog.last_message_at THEN excluded.last_message_at ELSE ws_group_catalog.last_message_at END,
      discovery_source=excluded.discovery_source,status=excluded.status,data_json=excluded.data_json,last_seen_at=excluded.last_seen_at,updated_at=excluded.updated_at`)
    .run(id, accountId, groupJid, groupName, channelId, participantCount, lastMessageAt, discoverySource, status, JSON.stringify(data), existing?.first_seen_at || now, now, existing?.created_at || now, now);
  return db.prepare('SELECT * FROM ws_group_catalog WHERE account_id=? AND group_jid=?').get(accountId, groupJid);
}
function wsGroupMonitorEventPayload(row) {
  if (!row) return null;
  const targetData = row.target_data_json && typeof row.target_data_json === 'string'
    ? wsJson(row.target_data_json, {})
    : (row.target_data && typeof row.target_data === 'object' ? row.target_data : {});
  const targetSourceId = wsText(row.target_source_id || row.target_source || row.source_id || row.sourceId, 160);
  const channelId = wsText(row.target_channel_id || row.target_channel || row.channel_id || row.channelId || targetSourceId, 160);
  const channelName = wsText(targetData.channelName || targetData.channel_name || targetData.channel || targetData.sourceName || targetData.source_name || targetData.sourceLabel, 160);
  const eventSource = wsText(row.source, 160);
  const source = channelName || (eventSource && eventSource !== 'system-event' ? eventSource : '') || (targetSourceId === 'source-direct' ? '单导' : targetSourceId && !/^(?:source|channel)-[a-z0-9_-]+$/i.test(targetSourceId) ? targetSourceId : '群粉');
  const groupName = wsText(row.target_group_name || row.target_group || targetData.groupName || targetData.group_name, 240) || wsText(row.group_jid, 240);
  const groupFanType = wsText(targetData.groupFanType || targetData.group_fan_type || targetData.groupFanSource || targetData.group_fan_source, 160) || source;
  return {
    id: row.id,
    accountId: row.account_id,
    profileId: row.profile_id,
    targetId: row.target_id,
    groupJid: row.group_jid,
    groupName,
    subgroup: groupName,
    memberJid: row.member_jid,
    memberPhone: row.member_phone || '',
    customerId: row.customer_id || '',
    eventType: row.event_type,
    type: row.event_type,
    correlationId: row.correlation_id || '',
    eventAt: row.event_at || '',
    observedAt: row.observed_at,
    source,
    sourceId: targetSourceId || source,
    channelId: channelId || targetSourceId || source,
    groupFanType,
    sourceEventId: row.source_event_id || '',
    idempotencyKey: row.idempotency_key,
    confidence: Number(row.confidence || 0),
    evidenceHash: row.evidence_hash || '',
    status: row.status,
    reviewReason: row.review_reason || '',
    data: wsJson(row.data_json, {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
function wsGroupMembershipEventRows(accountId = '', limit = 5000) {
  const normalizedAccountId = wsText(accountId, 120);
  const safeLimit = Math.min(20000, Math.max(1, Number(limit) || 5000));
  const query = normalizedAccountId
    ? `SELECT e.*, t.group_name AS target_group_name, t.source_id AS target_source_id, t.channel_id AS target_channel_id, t.data_json AS target_data_json
         FROM ws_group_membership_events e LEFT JOIN ws_group_monitor_targets t ON t.id=e.target_id
        WHERE e.account_id=? ORDER BY e.observed_at DESC,e.id DESC LIMIT ?`
    : `SELECT e.*, t.group_name AS target_group_name, t.source_id AS target_source_id, t.channel_id AS target_channel_id, t.data_json AS target_data_json
         FROM ws_group_membership_events e LEFT JOIN ws_group_monitor_targets t ON t.id=e.target_id
        ORDER BY e.observed_at DESC,e.id DESC LIMIT ?`;
  return normalizedAccountId
    ? db.prepare(query).all(normalizedAccountId, safeLimit)
    : db.prepare(query).all(safeLimit);
}
function wsGroupMonitorHealthPayload(profile) {
  if (!profile) return null;
  const counts = db.prepare('SELECT status,COUNT(*) AS count FROM ws_group_membership_events WHERE profile_id=? GROUP BY status').all(profile.id);
  const countMap = Object.fromEntries(counts.map(row => [row.status, Number(row.count || 0)]));
  const autoRegistered = Number(db.prepare("SELECT COUNT(*) AS count FROM ws_group_membership_events WHERE profile_id=? AND status='applied' AND COALESCE(json_extract(data_json,'$.autoRegistered'),0)=1").get(profile.id)?.count || 0);
  const targetCount = Number(db.prepare('SELECT COUNT(*) AS count FROM ws_group_monitor_targets WHERE profile_id=? AND enabled=1').get(profile.id)?.count || 0);
  return {
    profileId: profile.id,
    accountId: profile.account_id,
    status: profile.status,
    enabled: Boolean(profile.enabled),
    targetCount,
    eventCounts: { applied: countMap.applied || 0, autoRegistered, pending: countMap.pending || 0, review: countMap.review || 0, ignored: countMap.ignored || 0 },
    lastHeartbeatAt: profile.last_heartbeat_at || '',
    lastError: profile.last_error || '',
    checkedAt: new Date().toISOString(),
  };
}

// Keep the legacy global slot-key constraint compatible while giving every
// WS account its own deterministic fixed monitoring seat.
function wsGroupMonitorResolvedSlotKey(accountId, requested) {
  const base = wsText(requested, 120) || 'fixed-group-seat';
  const conflict = db.prepare('SELECT account_id FROM ws_group_monitor_profiles WHERE slot_key=? AND account_id<>? LIMIT 1').get(base, accountId);
  if (!conflict) return base;
  const suffix = createHash('sha256').update(String(accountId || '')).digest('hex').slice(0, 12);
  return `${base.slice(0, Math.max(1, 120 - suffix.length - 1))}-${suffix}`;
}

// Group-monitor profile ids are opaque, but they are still account-owned.
// The renderer includes accountId on every /api/ws request; enforce that
// scope here so a stale/malicious profile id cannot read or mutate another
// WS account's monitor seat.
function wsGroupMonitorAccountScoped(profile, requestedAccountId = '') {
  const requested = wsText(requestedAccountId, 120);
  return !requested || requested === String(profile?.account_id || 'default');
}

function wsGroupMonitorTargetRow(profileId, targetId = '', groupJid = '') {
  if (targetId) return db.prepare('SELECT * FROM ws_group_monitor_targets WHERE id=? AND profile_id=?').get(targetId, profileId);
  const normalized = wsGroupMonitor.normalizeMemberIdentity(groupJid).value;
  return normalized ? db.prepare('SELECT * FROM ws_group_monitor_targets WHERE profile_id=? AND group_jid=?').get(profileId, normalized) : null;
}

function wsGroupMonitorAutoCustomerId(accountId, memberKey, phone = '') {
  // A verified phone is the CRM-wide identity.  Only phone-less WhatsApp
  // participant IDs are scoped to the login account because LID values can be
  // account-specific.
  const identityKey = phone ? `phone|${phone}` : `member|${accountId}|${memberKey}`;
  const digest = createHash('sha256').update(`ws-group-customer|${identityKey}`).digest('hex').slice(0, 24);
  return `WS-${digest}`;
}

function wsGroupMonitorSource(target, state = null) {
  const targetData = target?.data_json && typeof target.data_json === 'string'
    ? wsJson(target.data_json, {})
    : (target?.data && typeof target.data === 'object' ? target.data : {});
  const sourceId = wsText(target?.source_id || target?.sourceId || target?.source, 160);
  const definitions = Array.isArray(state?.settings?.sourceDefinitions) ? state.settings.sourceDefinitions : [];
  const definition = sourceId ? definitions.find(item => wsText(item?.id, 160) === sourceId) : null;
  const sourceName = wsText(targetData.sourceName || targetData.source_name || targetData.sourceLabel, 160);
  const channelName = wsText(targetData.channelName || targetData.channel_name || targetData.channel, 160);
  const label = channelName || wsText(definition?.name, 160) || sourceName;
  const groupFanType = wsText(targetData.groupFanType || targetData.group_fan_type || targetData.groupFanSource || targetData.group_fan_source || (/(?:单导|群粉|群导|社群|group)/i.test(sourceName) ? sourceName : '') || (definition?.type === 'group-fan' ? definition?.name : ''), 160);
  if (label) return { id: sourceId || label, label, groupFanType };
  // Legacy identifiers remain explicit mappings for backwards compatibility.
  // An absent/unbound source has no business channel and must stay visibly
  // unclassified until an operator binds it in system settings.
  if (sourceId === 'source-group') return { id: sourceId, label: '群粉', groupFanType: '群粉' };
  if (sourceId === 'source-direct') return { id: sourceId, label: '单导', groupFanType: '单导' };
  if (sourceId && !/^(?:source|channel)-[a-z0-9_-]+$/i.test(sourceId) && sourceId.toLocaleLowerCase() !== 'manual-ws-monitor') return { id: sourceId, label: sourceId, groupFanType };
  return { id: sourceId, label: '', groupFanType: '', unclassified: true };
}

function wsGroupMonitorDeletedIdentityConflict(state, candidate) {
  const rows = Array.isArray(state?.customers) ? state.customers : [];
  const candidatePhone = wsGroupMonitor.normalizeMemberIdentity(candidate?.phone).phone;
  const candidateMember = wsGroupMonitor.normalizeMemberIdentity(candidate?.wsExternalId).value;
  return rows.some(item => {
    if (!item || item.deleted !== true) return false;
    const phone = wsGroupMonitor.normalizeMemberIdentity(item.phone || item.rawPhone).phone;
    const member = wsGroupMonitor.normalizeMemberIdentity(item.wsExternalId || item.wsParticipantId).value;
    return Boolean((candidatePhone && phone && candidatePhone === phone) || (candidateMember && member && candidateMember === member));
  });
}

function wsGroupMonitorAutoCustomer(accountId, target, event, now, state = null) {
  if (!wsGroupMonitor.isConfirmedJoinEvent(event)) return null;
  const member = wsGroupMonitor.normalizeMemberIdentity(event.memberId || event.memberJid || event.participantId || event.member || event.phone);
  const phone = member.phone || wsGroupMonitor.normalizeMemberIdentity(event.memberPhone || event.member_phone).phone;
  const memberKey = member.value || phone;
  const memberLocal = String(member.value || '').split('@', 1)[0];
  if (!memberKey || member.kind === 'unknown' || /^(?:unknown|anonymous|undefined|null)$/i.test(memberLocal) || (!phone && !/@(?:s\.whatsapp\.net|c\.us|lid)$/i.test(member.value))) return null;
  const groupName = wsText(target.group_name || target.groupName || target.name, 240);
  const eventAt = wsStrictIso(event.eventAt || event.event_at) || now;
  const registered = eventAt.slice(0, 10);
  const displayName = wsText(event.memberName || event.member_name || event.displayName || event.display_name || event.name, 160);
  const name = displayName || phone || member.value || '新进群客户';
  const sourceInfo = wsGroupMonitorSource(target, state);
  const source = sourceInfo.label;
  return {
    id: wsGroupMonitorAutoCustomerId(accountId, memberKey, phone),
    name,
    phone,
    rawPhone: phone,
    source,
    sourceId: sourceInfo.id,
    channel: source,
    channelId: sourceInfo.id,
    groupFanType: sourceInfo.groupFanType,
    sourceBindingStatus: sourceInfo.unclassified ? 'unclassified' : 'bound',
    isGroupFan: true,
    group: groupName,
    groupMonitorSourceId: sourceInfo.id,
    status: '已进群',
    groupStatus: '已进群',
    phase: '新客户',
    qualification: '待评估',
    assistant: '未分配',
    hot: false,
    investor: false,
    vipNumber: '',
    ticket: false,
    deposit: false,
    amount: 0,
    lastFollow: '',
    registered,
    registeredAt: eventAt,
    nextFollow: '',
    due: '',
    note: '',
    touched: true,
    deleted: false,
    autoRegistered: true,
    autoRegistrationSource: 'ws-group-monitor',
    wsExternalId: member.value,
    wsParticipantId: member.value,
    groupMemberships: [],
    statusHistory: [],
    createdAt: now,
    updatedAt: now,
  };
}

// A customer can belong to more than one monitored group (and more than one
// WS account).  The customer-level status must therefore be derived from the
// relationship ledger instead of being overwritten by the last event.  A
// single left/removed event must not mark the customer as left while another
// relationship is still active.
function deriveWsCustomerGroupStatus(customer, eventType = '') {
  const active = Array.isArray(customer?.groupMemberships)
    ? customer.groupMemberships.filter(item => item && item.status === '在群')
    : [];
  if (active.some(item => item.status === '在群')) {
    // Keep the first confirmed auto-registration label for the new record;
    // subsequent transitions use the canonical active status.
    if (String(eventType).toLocaleLowerCase() === 'joined'
      && String(customer?.status || '') === '已进群'
      && active.length === 1) return '已进群';
    return '在群';
  }
  if (['left', 'removed'].includes(String(eventType).toLocaleLowerCase())) return '已退群';
  if (String(eventType).toLocaleLowerCase() === 'joined') return '已进群';
  return String(customer?.status || '');
}

function applyWsCustomerGroupStatus(customer, eventType = '') {
  const nextGroupStatus = deriveWsCustomerGroupStatus(customer, eventType);
  // Group membership is a relationship fact. Preserve a manually maintained
  // CRM lifecycle/status value (VIP, lead stage, payment state, etc.) and keep
  // the derived group state in its own field. Auto-created group records and
  // legacy group-only statuses continue to expose the derived value through
  // the compatibility `status` projection.
  customer.groupStatus = nextGroupStatus;
  const current = String(customer.status || '');
  const groupOnlyStatuses = new Set(['', '未进群', '已进群', '在群', '已退群', '被移除', '状态未知']);
  if (customer.autoRegistered === true || groupOnlyStatuses.has(current)) customer.status = nextGroupStatus;
  return nextGroupStatus;
}

function wsPersistCustomerGroupMembershipLedger(accountId, target, relation, event, sourceInfo, now) {
  if (!target || !relation) return;
  const member = wsGroupMonitor.normalizeMemberIdentity(event.memberId || event.memberJid || event.participantId || event.phone);
  const memberPhone = member.phone || wsGroupMonitor.normalizeMemberIdentity(event.memberPhone || event.member_phone).phone;
  const groupJid = wsText(target.group_jid || target.groupJid, 240);
  const memberJid = wsText(member.value || memberPhone, 240);
  if (!groupJid || !memberJid) return;
  const stableRelationId = `membership-${createHash('sha256').update([accountId, groupJid, memberJid].join('|')).digest('hex').slice(0, 24)}`;
  // The JSON compatibility projection may reuse its relationship id when a
  // manual mapping resolves a different participant identifier. The durable
  // ledger primary key is therefore always derived from account/group/member.
  const relationId = stableRelationId;
  db.prepare(`INSERT INTO customer_group_memberships(
      id,account_id,group_jid,group_name,customer_id,member_jid,member_phone,
      source_id,source_label,status,first_joined_at,last_event_at,last_event_id,
      last_event_key,confidence,manual_locked,review_reason,data_json,created_at,updated_at
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(account_id,group_jid,member_jid) DO UPDATE SET
      id=excluded.id,
      group_name=excluded.group_name,
      customer_id=CASE WHEN excluded.customer_id<>'' THEN excluded.customer_id ELSE customer_group_memberships.customer_id END,
      member_phone=CASE WHEN excluded.member_phone<>'' THEN excluded.member_phone ELSE customer_group_memberships.member_phone END,
      source_id=excluded.source_id,
      source_label=excluded.source_label,
      status=excluded.status,
      first_joined_at=CASE WHEN customer_group_memberships.first_joined_at<>'' THEN customer_group_memberships.first_joined_at ELSE excluded.first_joined_at END,
      last_event_at=excluded.last_event_at,
      last_event_id=excluded.last_event_id,
      last_event_key=excluded.last_event_key,
      confidence=excluded.confidence,
      manual_locked=excluded.manual_locked,
      review_reason=excluded.review_reason,
      data_json=excluded.data_json,
      updated_at=excluded.updated_at`).run(
    relationId,
    accountId,
    groupJid,
    wsText(target.group_name || target.groupName || '', 240),
    wsText(relation.customerId, 160),
    memberJid,
    memberPhone,
    wsText(sourceInfo?.id, 160),
    wsText(sourceInfo?.label, 240),
    wsText(relation.status || '状态未知', 40) || '状态未知',
    wsText(relation.firstJoinedAt, 80),
    wsText(relation.lastEventAt || event.eventAt || '', 80),
    wsText(relation.lastEventId || event.id || '', 200),
    wsText(relation.lastEventKey || event.idempotencyKey || '', 240),
    Math.max(0, Math.min(1, Number(relation.confidence || event.confidence || 0))),
    relation.locked ? 1 : 0,
    wsText(relation.reviewReason, 240),
    JSON.stringify({ eventType: event.type || '', sourceEventId: event.sourceEventId || '', unclassified: Boolean(sourceInfo?.unclassified) }),
    now,
    now,
  );
}

function wsGroupMonitorApplyEventsInTransaction(accountId, inputEvents = [], options = {}) {
  const state = readState() || emptyCrmState();
  if (!Array.isArray(state.customers)) state.customers = [];
  if (!Array.isArray(state.activities)) state.activities = [];
  const now = wsStrictIso(options.now) || new Date().toISOString();
  // Older settings snapshots called this collection `groupMembershipMappings`.
  // Read both names so manual identity bindings survive upgrades and can be
  // used by the fixed seat without forcing a settings migration.
  const mappings = [
    ...(Array.isArray(state.settings?.wsGroupMemberMappings) ? state.settings.wsGroupMemberMappings : []),
    ...(Array.isArray(state.settings?.groupMembershipMappings) ? state.settings.groupMembershipMappings : []),
  ];
  const result = { accepted: 0, applied: 0, pending: 0, review: 0, ignored: 0, deduplicated: 0, autoRegistered: 0, events: [] };
  let stateChanged = false;
  let autoRegistrationSnapshotCreated = false;
  for (const input of (Array.isArray(inputEvents) ? inputEvents : []).slice(0, 1000)) {
    const event = input && typeof input === 'object' ? input : {};
    const profileId = wsText(event.profileId || event.profile_id, 160);
    const targetId = wsText(event.targetId || event.target_id, 160);
    const groupJid = wsGroupMonitor.normalizeMemberIdentity(event.groupJid || event.group_id || event.groupId).value;
    const profile = profileId ? db.prepare('SELECT * FROM ws_group_monitor_profiles WHERE id=? AND account_id=?').get(profileId, accountId) : db.prepare('SELECT * FROM ws_group_monitor_profiles WHERE account_id=? AND enabled=1 ORDER BY updated_at DESC LIMIT 1').get(accountId);
    const target = profile ? wsGroupMonitorTargetRow(profile.id, targetId, groupJid) : null;
    if (!profile || !target || !target.enabled || target.account_id !== accountId) {
      result.ignored += 1;
      result.events.push({ status: 'ignored', reason: 'target-disabled-or-missing' });
      continue;
    }
    const normalizedEvent = {
      ...event,
      accountId,
      profileId: profile.id,
      targetId: target.id,
      groupJid: target.group_jid,
      memberId: event.memberId || event.memberJid || event.participantId || event.phone,
      type: wsText(event.type || event.eventType, 24).toLocaleLowerCase(),
      eventAt: wsStrictIso(event.eventAt || event.event_at) || now,
      observedAt: wsStrictIso(event.observedAt || event.observed_at) || now,
      sourceEventId: wsText(event.sourceEventId || event.source_event_id || event.externalEventId, 240),
      correlationId: wsText(event.correlationId || event.correlation_id, 160) || `wsc-${randomUUID()}`,
      confidence: Math.max(0, Math.min(1, Number(event.confidence ?? event.identityConfidence ?? 0))),
      source: wsText(event.source, 80) || 'system-event',
    };
    if (!['joined', 'left', 'removed'].includes(normalizedEvent.type)) {
      result.ignored += 1;
      result.events.push({ status: 'ignored', reason: 'unsupported-event-type' });
      continue;
    }
    const idempotencyKey = wsGroupMonitor.eventIdempotencyKey(normalizedEvent);
    const existing = db.prepare('SELECT * FROM ws_group_membership_events WHERE idempotency_key=?').get(idempotencyKey);
    if (existing) {
      result.deduplicated += 1;
      result.events.push({ status: 'duplicate', event: wsGroupMonitorEventPayload(existing) });
      continue;
    }
    let match = wsGroupMonitor.resolveMembershipIdentity(normalizedEvent, state.customers, mappings, { accountId, groupJid: target.group_jid });
    let customer = match.customer;
    const knownRelation = customer && Array.isArray(customer.groupMemberships)
      ? customer.groupMemberships.find(item => String(item.accountId || '') === accountId && String(item.groupJid || '') === target.group_jid)
      : null;
    const incomingMember = wsGroupMonitor.normalizeMemberIdentity(normalizedEvent.memberId);
    const incomingPhone = incomingMember.phone || wsGroupMonitor.normalizeMemberIdentity(normalizedEvent.memberPhone || normalizedEvent.member_phone).phone;
    const knownMember = wsGroupMonitor.normalizeMemberIdentity(knownRelation?.memberJid || knownRelation?.memberPhone);
    const sameKnownIdentity = Boolean(knownRelation && ((incomingMember.value && knownMember.value === incomingMember.value)
      || (incomingPhone && (knownMember.phone === incomingPhone || wsGroupMonitor.normalizeMemberIdentity(knownRelation.memberPhone).phone === incomingPhone))));
    // A second collector can report the same still-active membership with a
    // different DOM event id. Treat it as a replay; a genuine re-entry is
    // accepted after the relation has transitioned to 已退群/被移除.
    if (normalizedEvent.type === 'joined' && knownRelation?.status === '在群' && sameKnownIdentity) {
      result.deduplicated += 1;
      result.events.push({ status: 'duplicate', reason: 'already-in-group', customerId: String(customer.id) });
      continue;
    }
    let autoRegistered = false;
    // A confirmed join is the only event allowed to create a customer.  A
    // pending/approval row remains an auditable ignored event and never enters
    // the customer master or group relationship projection.
    if (match.status === 'unmatched' && normalizedEvent.type === 'joined' && wsGroupMonitor.isConfirmedJoinEvent(normalizedEvent) && normalizedEvent.confidence >= 0.6) {
      const candidate = wsGroupMonitorAutoCustomer(accountId, target, normalizedEvent, now, state);
      if (candidate) {
        const existingById = state.customers.find(item => String(item?.id || '') === candidate.id);
        if (existingById?.deleted === true || wsGroupMonitorDeletedIdentityConflict(state, candidate)) {
          // Recycled records stay in the recycle bin.  The event remains
          // pending for explicit operator association or restoration.
        } else if (existingById) {
          customer = existingById;
          match = { status: 'matched', kind: 'group-join-existing', customer, candidates: [customer], confidence: 1 };
        } else {
          if (!autoRegistrationSnapshotCreated) {
            saveSnapshot('WS 群组新成员自动登记');
            autoRegistrationSnapshotCreated = true;
          }
          state.customers.push(candidate);
          customer = candidate;
          autoRegistered = true;
          stateChanged = true;
          match = { status: 'matched', kind: 'group-join-auto', customer, candidates: [customer], confidence: 1 };
        }
      }
    }
    const existingRelation = customer && Array.isArray(customer.groupMemberships)
      ? customer.groupMemberships.find(item => String(item.accountId || '') === accountId && String(item.groupJid || '') === target.group_jid)
      : null;
    const projection = wsGroupMonitor.applyMembershipProjection(profile, target, { ...normalizedEvent, idempotencyKey }, customer, { existingRelation, now });
    const member = wsGroupMonitor.normalizeMemberIdentity(normalizedEvent.memberId);
    const eventId = wsText(event.id, 160) || `wsg-event-${randomUUID()}`;
    const evidenceHash = createHash('sha256').update(JSON.stringify({ accountId, groupJid: target.group_jid, memberJid: member.value, type: normalizedEvent.type, sourceEventId: normalizedEvent.sourceEventId, eventAt: normalizedEvent.eventAt })).digest('hex');
    const status = projection.status === 'applied' ? 'applied' : projection.status === 'review' ? 'review' : projection.status === 'pending' ? 'pending' : 'ignored';
    const customerId = projection.relation?.customerId || (customer ? String(customer.id) : '');
    const reviewReason = projection.reviewReason || projection.reason || (match.status === 'ambiguous' ? 'ambiguous-customer' : '');
    const sourceInfo = wsGroupMonitorSource(target, state);
    if (projection.relation) wsPersistCustomerGroupMembershipLedger(accountId, target, projection.relation, { ...normalizedEvent, idempotencyKey }, sourceInfo, now);
    db.prepare(`INSERT INTO ws_group_membership_events(id,account_id,profile_id,target_id,group_jid,member_jid,member_phone,customer_id,event_type,event_at,observed_at,source,source_event_id,correlation_id,idempotency_key,confidence,evidence_hash,status,review_reason,data_json,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(eventId, accountId, profile.id, target.id, target.group_jid, member.value, member.phone || wsGroupMonitor.normalizeMemberIdentity(normalizedEvent.memberPhone || normalizedEvent.member_phone).phone, customerId, normalizedEvent.type, normalizedEvent.eventAt, normalizedEvent.observedAt, normalizedEvent.source, normalizedEvent.sourceEventId, normalizedEvent.correlationId, idempotencyKey, normalizedEvent.confidence, evidenceHash, status, String(reviewReason || ''), JSON.stringify({ identityKind: match.kind || '', identityStatus: match.status || '', groupName: target.group_name, autoRegistered }), now, now);
    result.accepted += 1;
    result[status] += 1;
    if (autoRegistered && projection.status === 'applied') result.autoRegistered += 1;
    const stored = db.prepare('SELECT * FROM ws_group_membership_events WHERE id=?').get(eventId);
    result.events.push({ status, event: wsGroupMonitorEventPayload(stored) });
    if (projection.status === 'applied' && customer) {
      const relations = Array.isArray(customer.groupMemberships) ? customer.groupMemberships.slice() : [];
      const index = relations.findIndex(item => String(item.accountId || '') === accountId && String(item.groupJid || '') === target.group_jid);
      if (index >= 0) relations[index] = projection.relation; else relations.push(projection.relation);
      customer.groupMemberships = relations;
      const history = Array.isArray(customer.statusHistory) ? customer.statusHistory.slice() : [];
      history.push(projection.statusHistoryEvent);
      customer.statusHistory = history.slice(-500);
      applyWsCustomerGroupStatus(customer, normalizedEvent.type);
      customer.updatedAt = now;
      stateChanged = true;
      state.activities.unshift({ id: `AWSG-${Date.now().toString(36)}-${result.accepted}`, text: `WS 群组${normalizedEvent.type === 'joined' ? '进群' : normalizedEvent.type === 'removed' ? '移除成员' : '退群'}：${customer.name || customer.id}`, time: now, color: normalizedEvent.type === 'joined' ? 'green' : 'amber', source: 'ws-group-monitor', customerId: customer.id, groupJid: target.group_jid, eventId });
      state.activities = state.activities.slice(0, 500);
    }
    const checkpointId = `wsg-checkpoint-${profile.id}-${target.id}`;
    db.prepare(`INSERT INTO ws_group_monitor_checkpoints(id,profile_id,target_id,cursor,last_event_at,last_snapshot_hash,retry_count,status,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(profile_id,target_id) DO UPDATE SET cursor=excluded.cursor,last_event_at=CASE WHEN excluded.last_event_at>ws_group_monitor_checkpoints.last_event_at THEN excluded.last_event_at ELSE ws_group_monitor_checkpoints.last_event_at END,updated_at=excluded.updated_at,status='ready'`)
      .run(checkpointId, profile.id, target.id, normalizedEvent.sourceEventId || eventId, normalizedEvent.eventAt, '', 0, 'ready', now);
    db.prepare('UPDATE ws_group_monitor_targets SET last_seen_at=?,updated_at=? WHERE id=?').run(normalizedEvent.observedAt, now, target.id);
    db.prepare('UPDATE ws_group_monitor_profiles SET last_heartbeat_at=?,status=CASE WHEN enabled=1 THEN \'running\' ELSE status END,last_error=\'\',updated_at=? WHERE id=?').run(now, now, profile.id);
  }
  if (stateChanged) writeState(state, false);
  return result;
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
function wsMediaStoragePath(row) {
  const relative = wsText(row?.storage_path, 500);
  if (!relative) return '';
  const base = resolve(dataDir);
  const absolute = resolve(dataDir, relative);
  return absolute === base || !absolute.startsWith(`${base}${sep}`) ? '' : absolute;
}
function wsMediaDownloadUrl(row) {
  if (!row?.id) return '';
  return `/api/ws/media/${encodeURIComponent(row.id)}?accountId=${encodeURIComponent(row.account_id || 'default')}`;
}
function wsMediaPayload(row) {
  if (!row) return null;
  return {
    id: row.id,
    mediaId: row.id,
    accountId: row.account_id || 'default',
    conversationId: row.conversation_id || '',
    messageId: row.message_id || '',
    mediaType: row.media_type || wsMediaCore.mediaTypeForMime(row.mime_type),
    fileName: row.file_name || 'attachment',
    mimeType: row.mime_type || 'application/octet-stream',
    sizeBytes: Number(row.size_bytes || 0),
    sha256: row.sha256 || '',
    status: row.status || 'ready',
    unavailableReason: row.unavailable_reason || '',
    downloadUrl: wsMediaDownloadUrl(row),
    createdAt: row.created_at || '',
    updatedAt: row.updated_at || '',
  };
}
function wsMediaAttachmentPayload(row) {
  if (!row) return null;
  const media = db.prepare('SELECT * FROM ws_media_assets WHERE id=? AND account_id=?').get(row.media_id, row.account_id);
  const attempt = wsJson(row.data_json, {}).sendAttempt || {};
  return {
    ...(media ? wsMediaPayload(media) : { mediaStatus: 'unavailable', unavailableReason: '媒体已删除。' }),
    id: row.id,
    mediaId: row.media_id,
    orderNo: Number(row.order_no || 0),
    caption: row.caption || '',
    status: row.status || 'queued',
    errorMessage: row.error_message || '',
    mediaStatus: media?.status || 'unavailable',
    deliveryState: attempt.deliveryState || (row.status === 'queued' ? 'queued' : 'unknown'),
    attemptId: attempt.id || '',
  };
}
function wsSendAttachmentRows(row) {
  if (!row?.id) return [];
  try {
    return db.prepare('SELECT * FROM ws_send_attachments WHERE account_id=? AND send_audit_id=? ORDER BY order_no ASC,id ASC').all(row.account_id, row.id).map(wsMediaAttachmentPayload);
  } catch { return []; }
}
function wsSendPlanFingerprint(value) {
  const canonical = {
    accountId: value.accountId, conversationIds: [...value.conversationIds].sort(),
    originalText: value.originalText, translatedText: value.translatedText,
    targetLanguage: value.targetLanguage, payloadKind: value.payloadKind, caption: value.caption,
    attachments: value.attachments.map(item => ({ mediaId: item.mediaId, orderNo: item.orderNo, caption: item.caption })).sort((a, b) => a.orderNo - b.orderNo || a.mediaId.localeCompare(b.mediaId)),
  };
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}
function wsSendAuditPayload(row) {
  if (!row) return null;
  let attachmentIds = wsJson(row.attachment_ids_json, []);
  if (!Array.isArray(attachmentIds)) attachmentIds = [];
  const attachments = wsSendAttachmentRows(row);
  const metadata = wsJson(row.native_result_json, {}), attempt = metadata.sendAttempt || {};
  return {
    id: row.id,
    accountId: row.account_id,
    conversationId: row.conversation_id,
    batchId: row.batch_id || '',
    operation: row.operation || 'single',
    idempotencyKey: row.idempotency_key || '',
    originalText: row.original_text || '',
    translatedText: row.translated_text || '',
    targetLanguage: row.target_language || '',
    payloadKind: row.payload_kind || (attachments.length ? wsMediaCore.normalizePayloadKind('', attachments.map(item => item.mediaType)) : 'text'),
    caption: row.caption || row.original_text || '',
    attachmentIds,
    attachments,
    status: row.status || 'queued',
    deliveryState: attempt.deliveryState || (row.status === 'queued' ? 'queued' : 'unknown'),
    attemptPhase: attempt.phase || '',
    attemptId: attempt.id || '',
    retryAllowed: row.status === 'queued' && !attempt.id || row.status === 'failed' && attempt.deliveryState === 'failed' && attempt.safeToRetry === true,
    errorMessage: row.error_message || '',
    nativeResult: wsJson(row.native_result_json, {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
function wsSendRateCheck(accountId, amount = 1, now = Date.now(), consume = true) {
  for (const [expiredKey, window] of wsSendRateWindows) {
    if (now - Number(window?.startedAt || 0) >= WS_SEND_RATE_WINDOW_MS) wsSendRateWindows.delete(expiredKey);
  }
  const key = wsAccountId(accountId);
  const current = wsSendRateWindows.get(key);
  if (!current || now - current.startedAt >= WS_SEND_RATE_WINDOW_MS) {
    const next = { startedAt: now, count: 0 };
    if (amount > WS_SEND_RATE_LIMIT) return { allowed: false, retryAfterMs: WS_SEND_RATE_WINDOW_MS };
    if (consume) { next.count = amount; wsSendRateWindows.set(key, next); }
    return { allowed: true, retryAfterMs: 0, remaining: WS_SEND_RATE_LIMIT - amount };
  }
  if (current.count + amount > WS_SEND_RATE_LIMIT) {
    return { allowed: false, retryAfterMs: Math.max(1, WS_SEND_RATE_WINDOW_MS - (now - current.startedAt)), remaining: Math.max(0, WS_SEND_RATE_LIMIT - current.count) };
  }
  if (consume) current.count += amount;
  return { allowed: true, retryAfterMs: 0, remaining: WS_SEND_RATE_LIMIT - current.count - (consume ? 0 : amount) };
}
function wsSendConversationRow(id, accountId) {
  const row = wsConversationRow(id, accountId);
  if (!row) return { row: null, error: 'WS 会话不存在或不属于当前账号。', status: 404 };
  if (wsIsExcludedGroup(row)) return { row: null, error: '普通群聊不允许发送群发消息。', status: 422 };
  const type = wsCore.conversationType(row);
  if (type !== 'direct') return { row: null, error: '群发当前只支持已确认的一对一会话。', status: 422 };
  return { row };
}
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
function aiJobPayload(row, options = {}) {
  const attempts = Number(row.attempts || 0);
  const maxAttempts = Number(row.max_attempts || 5);
  return {
    id: row.id,
    accountId: row.account_id || 'default',
    conversationId: row.conversation_id,
    idempotencyKey: row.idempotency_key,
    payload: wsJson(row.payload_json, {}),
    status: row.status,
    attempts,
    maxAttempts,
    deadLetter: row.status === 'failed' && attempts >= maxAttempts,
    nextAttemptAt: row.next_attempt_at || '',
    lockedAt: row.locked_at || '',
    leaseToken: options.revealLease === true ? (row.lease_token || '') : '',
    lastError: row.last_error || '',
    analysisId: row.analysis_id || '',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
function aiPipelineJobPayload(row, options = {}) {
  const legacy = aiJobPayload(row, options);
  const checkpoint = row.checkpoint_json ? wsJson(row.checkpoint_json, {}) : (legacy.payload?.checkpoint || {});
  const status = aiJobPipeline.status(row.status) || 'pending';
  return {
    ...legacy,
    jobType: row.job_type || 'ws.ai.analysis',
    customerId: row.customer_id || '',
    groupJid: row.group_jid || '',
    sourceMessageId: row.source_message_id || '',
    sourceEventId: row.source_event_id || '',
    correlationId: row.correlation_id || '',
    sourceType: row.source_type || 'conversation',
    priority: Number(row.priority ?? 50),
    status,
    legacyStatus: aiJobPipeline.legacyStatus(status),
    checkpoint,
    resultRef: row.result_ref || '',
    cancelRequested: Boolean(row.cancel_requested),
    workerOwnerId: row.worker_owner_id || '',
    fencingToken: Number(row.fencing_token || 0),
  };
}
function aiPipelineSuggestionPayload(row) {
  return {
    id: row.id, accountId: row.account_id || 'default', customerId: row.customer_id,
    conversationId: row.conversation_id || '', groupJid: row.group_jid || '',
    jobId: row.job_id || '', analysisId: row.analysis_id || '',
    fieldName: row.field_name, candidateValue: wsJson(row.candidate_value_json, null),
    existingValue: wsJson(row.existing_value_json, null), appliedValue: wsJson(row.applied_value_json, null),
    sourceEvidence: row.source_evidence || '', sourceMessageId: row.source_message_id || '',
    sourceAt: row.source_at || '', confidence: Number(row.confidence || 0),
    correlationId: row.correlation_id || '',
    verificationStatus: row.verification_status, conflictReason: row.conflict_reason || '',
    reviewedBy: row.reviewed_by || '', reviewedAt: row.reviewed_at || '',
    appliedAt: row.applied_at || '', idempotencyKey: row.idempotency_key,
    createdAt: row.created_at, updatedAt: row.updated_at,
  };
}
function aiPipelineEvidencePayload(row) {
  return {
    id: row.id, accountId: row.account_id || 'default', jobId: row.job_id,
    sourceType: row.source_type, sourceId: row.source_id, conversationId: row.conversation_id || '',
    groupJid: row.group_jid || '', messageId: row.message_id || '', quote: row.quote || '',
    correlationId: row.correlation_id || '',
    capturedAt: row.captured_at || '', data: wsJson(row.data_json, {}), createdAt: row.created_at,
  };
}
function aiPipelineAuditPayload(row) {
  return {
    id: row.id, accountId: row.account_id || 'default', jobId: row.job_id,
    action: row.action, fromStatus: row.from_status || '', toStatus: row.to_status || '',
    actor: row.actor || '', reason: row.reason || '', data: wsJson(row.data_json, {}),
    correlationId: row.correlation_id || '',
    createdAt: row.created_at,
  };
}
function stage4AiGuard() {
  if (!stage4AiEnabled) {
    const error = new Error('AI 隔离队列未启用；生产入口保持冻结。');
    error.status = 404; error.code = 'AI_PIPELINE_DISABLED'; throw error;
  }
}
function stage4LeaseFromBody(body) {
  const lease = fencingLeaseFromPayload(body?.lease || body?.writer);
  if (!lease.scopeKey || !lease.leaseId || !lease.ownerId || !Number.isFinite(lease.fencingToken)) {
    const error = new Error('隔离 AI 写入必须提供有效 fencing lease。');
    error.status = 422; error.code = 'AI_FENCING_REQUIRED'; throw error;
  }
  return lease;
}
function stage4Write(body, idempotencyKey, cursor, callback) {
  const lease = stage4LeaseFromBody(body);
  return fencedWriter.runProtectedWrite(lease, { idempotencyKey, cursor, payload: { stage: 'stage4-ai-pipeline' } }, callback);
}
function stage4Correlation(body, job) {
  const requested = wsText(body.correlationId || body.correlation_id, 160), authoritative = wsText(job?.correlation_id, 160);
  if (requested && authoritative && requested !== authoritative) { const error = new Error('业务关联 ID 与源任务不一致。'); error.status = 409; error.code = 'AI_CORRELATION_CONFLICT'; throw error; }
  return authoritative || requested;
}
function stage4Audit(accountId, jobId, action, fromStatus, toStatus, actor, reason, data = {}, correlationId = '') {
  // stage5 correlation id propagation keeps WS group, AI, CRM and task audit records traceable.
  db.prepare('INSERT INTO ai_task_audit(id,account_id,job_id,action,from_status,to_status,actor,reason,data_json,correlation_id,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)')
    .run(wsCreateId('aiaudit'), accountId, jobId, action, fromStatus || '', toStatus || '', wsText(actor || 'stage4-isolated', 160), wsText(reason, 1000), JSON.stringify(data || {}), wsText(correlationId, 160), new Date().toISOString());
}
function stage4CustomerFromState(customerId, state = governanceState()) {
  const id = wsText(customerId, 128);
  return id ? governanceCustomer(state, id) : null;
}
function stage4StateVersionMatches(expected) {
  const current = readStateEnvelope().version;
  return expected !== undefined && String(expected) === current;
}
function aiJobStats(accountId) {
  const rows = db.prepare('SELECT status,COUNT(*) AS count FROM ai_jobs WHERE account_id=? GROUP BY status').all(accountId);
  const stats = Object.fromEntries([...AI_JOB_STATUSES].map(status => [status, 0]));
  for (const row of rows) if (AI_JOB_STATUSES.has(String(row.status))) stats[row.status] = Number(row.count || 0);
  // `failed` is the public terminal status. A dead letter is the subset that
  // exhausted its retry budget; keep both counters so operators can tell a
  // permanent provider failure from an intentionally non-retryable error.
  stats.deadLetter = Number(db.prepare("SELECT COUNT(*) AS count FROM ai_jobs WHERE account_id=? AND status='failed' AND attempts>=max_attempts").get(accountId)?.count || 0);
  stats.retryCount = Number(db.prepare('SELECT COALESCE(SUM(CASE WHEN attempts > 1 THEN attempts - 1 ELSE 0 END),0) AS count FROM ai_jobs WHERE account_id=?').get(accountId)?.count || 0);
  stats.total = [...AI_JOB_STATUSES].reduce((sum, status) => sum + Number(stats[status] || 0), 0);
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
  const account = wsAccountId(accountId);
  const data = wsJson(row.data_json, {});
  const type = wsCore.conversationType(row);
  if (!['direct', 'vip_group'].includes(type)) throw wsConversationPolicyError('WS_CONVERSATION_TYPE_UNCONFIRMED', 'AI 只允许一对一或白名单 VIP 群会话，当前会话类型未获授权。');
  if (data.historyLoaded !== true) throw wsConversationPolicyError('WS_HISTORY_INCOMPLETE', '聊天完整历史尚未加载，暂不能进行 AI 分析或 CRM 同步。');
  const historyFingerprint = wsText(data.historyFingerprint, 500);
  const lastMessageFingerprint = wsText(data.lastMessageFingerprint, 500);
  if (!historyFingerprint || !lastMessageFingerprint || historyFingerprint !== lastMessageFingerprint) {
    throw wsConversationPolicyError('WS_HISTORY_STALE', '聊天历史指纹为空或已变化，暂不能进行 AI 分析或 CRM 同步。');
  }
  if (Number(row.unread_count || 0) !== 0) throw wsConversationPolicyError('WS_UNREAD_MESSAGES', '会话仍有未读消息，标记已读并重新采集后才能进行 AI 分析。');
  const messageCount = Number(db.prepare('SELECT COUNT(*) AS count FROM ws_messages WHERE account_id=? AND conversation_id=?').get(account, row.id).count || 0);
  if (messageCount > 0 && Number(data.directionVersion || 0) < 4) throw wsConversationPolicyError('WS_DIRECTION_UNVERIFIED', '历史消息方向尚未通过 v4 校验，暂不能进行 AI 分析或 CRM 同步。');
  return row;
}
function requireAiJobLease(row, suppliedToken) {
  const token = wsText(suppliedToken, 200);
  const expected = wsText(row?.lease_token, 200);
  if (!row || row.status !== 'running' || !expected || !token || token !== expected) {
    const error = new Error('AI 任务租约已失效或不属于当前运行中的任务，拒绝旧工作器写入。');
    error.code = 'AI_JOB_LEASE_STALE'; error.status = 409; throw error;
  }
  return token;
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
function wsUpsertExcludedGroupConversation(accountId, externalKey, checkpoint = {}, now = new Date().toISOString()) {
  const existing = db.prepare('SELECT * FROM ws_conversations WHERE account_id=? AND external_id=?').get(accountId, externalKey);
  const title = wsText(checkpoint.displayName, 200) || existing?.title || externalKey;
  const preview = wsCleanListPreviewText(checkpoint.lastMessagePreview || checkpoint.previewText || checkpoint.preview);
  const lastAt = wsMaybeIso(checkpoint.lastMessageAt || checkpoint.lastMessageTime);
  const suppliedUnread = wsOptionalCount(checkpoint.unreadCount);
  const unread = suppliedUnread === null ? Number(existing?.unread_count || 0) : suppliedUnread;
  const data = {
    ...wsJson(existing?.data_json, {}),
    source: 'ws-list-discovery',
    conversationType: 'group',
    isGroup: true,
    vipGroup: false,
    coverage: 'excluded-group',
    collectionStatus: 'skipped-group',
    historyLoaded: false,
    historyStale: false,
    visibleOnly: true,
    displayName: title,
    capturedAt: now,
    ...(wsText(checkpoint.cursor, 500) ? { cursor: wsText(checkpoint.cursor, 500) } : {}),
    ...(preview ? { lastMessagePreview: preview } : {}),
  };
  if (!existing) {
    const id = wsCreateId('wsc');
    db.prepare('INSERT INTO ws_conversations(id,account_id,external_id,title,customer_id,last_message_text,intent_level,data_json,created_at,updated_at,last_message_at,unread_count,language) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .run(id, accountId, externalKey, title, '', preview, '', JSON.stringify(data), now, now, lastAt, unread, '');
  } else {
    db.prepare('UPDATE ws_conversations SET title=?,last_message_text=?,last_message_at=?,unread_count=?,data_json=?,updated_at=? WHERE id=? AND account_id=?')
      .run(title, preview || existing.last_message_text || '', lastAt || existing.last_message_at || '', unread, JSON.stringify(data), now, existing.id, accountId);
  }
  return db.prepare('SELECT * FROM ws_conversations WHERE account_id=? AND external_id=?').get(accountId, externalKey);
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

// The WS workbench and the CRM data center use different physical tables by
// design, but they must expose one read-only archive view for operators.  This
// resolver never creates a customer or changes a conversation binding; it only
// follows an explicit customer id, an existing conversation binding, or an
// independently trusted WS identity.
function dataArchiveResolveCustomer(state, accountId, conversation, requestedCustomerId = '') {
  const customers = Array.isArray(state?.customers) ? state.customers : [];
  const explicitId = wsText(requestedCustomerId, 128);
  if (explicitId) {
    const explicit = customers.find(item => String(item?.id || '') === explicitId);
    if (!explicit) return { kind: 'missing', customer: null, candidates: [] };
    if (conversation?.customer_id && String(conversation.customer_id) !== explicitId) return { kind: 'conflict', customer: null, candidates: [explicit] };
    return { kind: 'explicit-id', customer: explicit, candidates: [explicit] };
  }
  if (!conversation) return { kind: 'none', customer: null, candidates: [] };
  const linkedId = wsText(conversation.customer_id, 128);
  if (linkedId) {
    const linked = customers.find(item => String(item?.id || '') === linkedId);
    if (linked) return { kind: 'conversation', customer: linked, candidates: [linked] };
  }
  const data = wsJson(conversation.data_json, {});
  const rawExternal = wsText(conversation.external_id, 200);
  const rawTitle = wsText(conversation.title, 200);
  const rawPhone = [
    rawExternal,
    rawTitle,
    data.phone,
    data.phoneNumber,
    data.contactPhone,
    data.memberPhone,
  ].map(value => wsText(value, 80)).find(value => {
    const digits = value.replace(/\D/g, '');
    return digits.length >= 8 && digits.length <= 15 && /^\+?[\d\s().-]+$/.test(value);
  }) || '';
  const match = wsCrmSync.matchCustomerForAutoSync(customers, {
    wsExternalId: rawExternal,
    wsAccountId: accountId,
    phone: rawPhone,
    phoneVerified: Boolean(rawPhone),
    phoneSource: rawPhone ? 'conversation' : '',
    conversationId: conversation.id,
  });
  if (match?.customer && ['ws-id', 'phone', 'conversation', 'explicit-id'].includes(match.kind)) return match;
  return match?.kind === 'ambiguous' ? match : { kind: 'none', customer: null, candidates: [] };
}

function dataArchiveCustomerAllowed(customer, accountId, conversation) {
  if (!customer) return false;
  const accountLinks = Array.isArray(customer.wsAccountIds) ? customer.wsAccountIds.map(value => wsText(value, 120)).filter(Boolean) : [];
  const legacyAccount = wsText(customer.wsAccountId, 120);
  if ((accountLinks.length || legacyAccount) && !accountLinks.includes(accountId) && legacyAccount !== accountId) {
    return Boolean(conversation && String(conversation.customer_id || '') === String(customer.id || ''));
  }
  return true;
}

function dataArchiveSafeCustomer(customer) {
  if (!customer) return null;
  // Customer fields are extensible (imports and AI profile facts can add
  // nested metadata). Reuse the bounded recursive export sanitizer so a
  // future nested credential cannot leak through this read-only archive API.
  return wsExportSafeValue(customer) || null;
}

function dataArchiveRecords(state, customerId) {
  const id = String(customerId || '');
  const byCustomer = key => (Array.isArray(state?.[key]) ? state[key] : []).filter(item => String(item?.customerId || '') === id);
  const tasks = Array.isArray(state?.settings?.operatingTasks) ? state.settings.operatingTasks.filter(item => String(item?.customerId || '') === id) : [];
  const safe = item => wsExportSafeValue(item);
  return {
    tickets: byCustomer('tickets').map(safe),
    registrations: byCustomer('registrations').map(safe),
    deposits: byCustomer('deposits').map(safe),
    followups: byCustomer('followups').map(safe),
    tasks: tasks.map(safe),
  };
}

function dataArchiveEmptyRecords() { return { tickets: [], registrations: [], deposits: [], followups: [], tasks: [] }; }

function dataArchivePayload(accountId, conversation, customer, match, state, options = {}) {
  const customerId = customer?.id ? String(customer.id) : '';
  const records = customerId ? dataArchiveRecords(state, customerId) : dataArchiveEmptyRecords();
  let hot = null;
  if (customerId) {
    const hotRow = conversation
      ? hotProfileRow({ customerId, accountId, conversationId: conversation.id })
      : db.prepare('SELECT * FROM hot_chat_profiles WHERE customer_id=? AND account_id=? ORDER BY updated_at DESC,id DESC LIMIT 1').get(customerId, accountId);
    hot = hotProfilePayload(hotRow);
  }
  const messagesOffset = Math.max(0, Math.min(10_000_000, Number(options.messagesOffset) || 0));
  const messagesLimit = Math.max(1, Math.min(2000, Number(options.messagesLimit) || 1000));
  const ws = { messages: [], analyses: [], replies: [], followupAlerts: [], groupMembershipEvents: [], messageTotal: 0, messagesOffset, messagesLimit, messagesHasMore: false };
  if (conversation) {
    const conversationId = conversation.id;
    ws.messageTotal = Number(db.prepare('SELECT COUNT(*) AS count FROM ws_messages WHERE account_id=? AND conversation_id=?').get(accountId, conversationId)?.count || 0);
    ws.messages = db.prepare('SELECT * FROM ws_messages WHERE account_id=? AND conversation_id=? ORDER BY order_no ASC,created_at ASC,id ASC LIMIT ? OFFSET ?').all(accountId, conversationId, messagesLimit, messagesOffset).map(wsMessagePayload);
    ws.messagesHasMore = messagesOffset + ws.messages.length < ws.messageTotal;
    ws.analyses = db.prepare('SELECT * FROM ws_ai_analyses WHERE account_id=? AND conversation_id=? ORDER BY created_at DESC,id DESC LIMIT 50').all(accountId, conversationId).map(wsAnalysisPayload);
    ws.replies = db.prepare('SELECT * FROM ws_replies WHERE account_id=? AND conversation_id=? ORDER BY created_at DESC,id DESC LIMIT 50').all(accountId, conversationId).map(wsReplyPayload);
    ws.followupAlerts = db.prepare('SELECT * FROM ws_followup_alerts WHERE account_id=? AND conversation_id=? ORDER BY created_at DESC,id DESC LIMIT 50').all(accountId, conversationId).map(wsFollowupAlertPayload);
  }
  if (customerId) ws.groupMembershipEvents = db.prepare('SELECT e.*,t.group_name AS target_group_name,t.source_id AS target_source_id,t.channel_id AS target_channel_id,t.data_json AS target_data_json FROM ws_group_membership_events e LEFT JOIN ws_group_monitor_targets t ON t.id=e.target_id WHERE e.account_id=? AND e.customer_id=? ORDER BY e.observed_at DESC,e.id DESC LIMIT 200').all(accountId, customerId).map(wsGroupMonitorEventPayload);
  return {
    ok: true,
    matched: Boolean(customer),
    accountId,
    match: { kind: match?.kind || 'none', customerId: customerId || '', candidates: Array.isArray(match?.candidates) ? match.candidates.map(item => ({ id: item.id, name: item.name || '', phone: item.rawPhone || item.phone || '' })) : [] },
    customer: dataArchiveSafeCustomer(customer),
    records,
    hotChatProfile: hot,
    conversation: conversation ? wsExportSafeValue(wsConversationPayload(conversation)) : null,
    ws,
    revision: readStateEnvelope().version,
  };
}
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
    // Stage 1.5 isolated fencing harness. It uses the real sidecar DatabaseSync
    // connection and the same ws_messages table, but remains unreachable in
    // normal production mode until a later approved Worker cutover.
    if (url.pathname === '/api/ws/fencing') {
      if (!fencingIsolationMode) return json(res, 404, { error: '隔离 fencing 接口未启用。' });
      if (req.method !== 'POST') return json(res, 405, { error: 'fencing 接口只支持 POST。' });
      const body = JSON.parse((await readBody(req, 64 * 1024)).toString('utf8'));
      const action = wsText(body.action, 24).toLowerCase();
      try {
        if (action === 'acquire') {
          const lease = fencedWriter.acquire(wsText(body.scopeKey, 240), wsText(body.ownerId, 160), body.leaseMs);
          return json(res, 200, { lease: fencingLeasePayload(lease) });
        }
        const lease = fencingLeaseFromPayload(body.lease);
        if (action === 'renew') return json(res, 200, { lease: fencingLeasePayload(fencedWriter.renew(lease, body.leaseMs)) });
        if (action === 'release') return json(res, 200, { released: fencedWriter.release(lease) });
        if (action === 'inspect') return json(res, 200, fencedWriter.inspect(wsText(body.scopeKey, 240)));
        return json(res, 400, { error: 'fencing action 无效。' });
      } catch (error) {
        if (error instanceof FencingError) return json(res, fencingErrorStatus(error), { error: error.message, code: error.code, scopeKey: error.scopeKey || '' });
        throw error;
      }
    }
    if (url.pathname === '/api/ws/fencing/write' && req.method === 'POST') {
      if (!fencingIsolationMode) return json(res, 404, { error: '隔离 fencing 接口未启用。' });
      const body = JSON.parse((await readBody(req, WS_MESSAGE_BATCH_MAX_BYTES)).toString('utf8'));
      const lease = fencingLeaseFromPayload(body.lease || body.writer);
      const accountId = wsAccountId(body.accountId);
      const conversationId = wsText(body.conversationId, 160);
      const message = body.message && typeof body.message === 'object' ? body.message : {};
      const externalId = wsText(message.externalId || message.external_id, 200);
      const originalText = wsMessageText(message.originalText || message.original_text || message.body);
      const idempotencyKey = wsText(body.idempotencyKey || body.idempotency_key, 240);
      const cursor = wsText(body.cursor, 500);
      if (!conversationId || !externalId || !originalText || !idempotencyKey || !cursor) return json(res, 422, { error: 'fenced 写入缺少会话、消息、幂等键或 checkpoint。' });
      wsRequireAccount(accountId);
      wsRequireConversation(conversationId, accountId);
      // Test-only delay lets a second isolated request take over an expired
      // lease before this request reaches BEGIN IMMEDIATE. It is ignored when
      // the fencing isolation mode is not explicitly enabled.
      await fencingDelay(body.testDelayMs);
      try {
        const result = fencedWriter.runProtectedWrite(lease, {
          idempotencyKey,
          cursor,
          payload: { accountId, conversationId, externalId, source: 'stage1-5-fenced-sidecar' },
        }, (connection, now) => {
          const existing = connection.prepare('SELECT id FROM ws_messages WHERE account_id=? AND conversation_id=? AND external_id=?').get(accountId, conversationId, externalId);
          if (existing) return { messageId: existing.id, deduplicated: true };
          const messageId = wsCreateId('wsm-fenced');
          connection.prepare(`INSERT INTO ws_messages(id,account_id,conversation_id,external_id,direction,original_text,translated_text,source_language,target_language,order_no,data_json,created_at,updated_at,translation_status,translation_error,translation_attempts,last_attempt_at)
            VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
            .run(messageId, accountId, conversationId, externalId, wsText(message.direction, 16) === 'send' ? 'send' : 'receive', originalText, '', '', '', Number(message.order || 1), JSON.stringify({ source: 'stage1-5-fenced-sidecar', fencingProtected: true }), new Date(now).toISOString(), new Date(now).toISOString(), 'none', '', 0, '');
          return { messageId, deduplicated: false };
        });
        return json(res, 200, { ok: true, ...result });
      } catch (error) {
        if (error instanceof FencingError) return json(res, fencingErrorStatus(error), { error: error.message, code: error.code, scopeKey: error.scopeKey || '' });
        throw error;
      }
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
    if (url.pathname === '/api/ws/workspace/contacts' || url.pathname === '/api/ws/workspace/audit') {
      if (req.method !== 'GET') return json(res, 405, { error: '工作区业务查询只支持 GET。' });
      const accountId = wsText(url.searchParams.get('accountId'), 120);
      if (!accountId) return json(res, 400, { error: '工作区业务查询必须提供 accountId。' });
      if (!wsAccountRow(accountId)) return json(res, 404, { error: 'WS 账号不存在。' });
      try {
        const result = url.pathname.endsWith('/contacts') ? wsWorkspaceQuery.contacts(db, accountId, url.searchParams) : wsWorkspaceQuery.audit(db, accountId, url.searchParams);
        return json(res, 200, result);
      } catch (error) {
        if (error?.code === 'INVALID_WORKSPACE_QUERY') return json(res, 400, { error: error.message, code: error.code });
        throw error;
      }
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
    const groupCatalogMatch = url.pathname.match(/^\/api\/ws\/accounts\/([^/]+)\/groups$/);
    if (groupCatalogMatch) {
      const accountId = decodeURIComponent(groupCatalogMatch[1]);
      if (!wsAccountRow(accountId)) return json(res, 404, { error: 'WS 账号不存在。' });
      const requestedAccountId = wsText(url.searchParams.get('accountId'), 120);
      if (requestedAccountId && requestedAccountId !== accountId) return json(res, 404, { error: '群组目录不存在。' });
      if (req.method !== 'GET') return json(res, 405, { error: '群组目录只支持 GET。' });
      const status = wsText(url.searchParams.get('status'), 20);
      const limit = Math.min(2000, Math.max(1, Number(url.searchParams.get('limit')) || 500));
      const rows = status && ['active', 'inactive', 'unknown'].includes(status)
        ? db.prepare('SELECT * FROM ws_group_catalog WHERE account_id=? AND status=? ORDER BY last_seen_at DESC, group_name COLLATE NOCASE, group_jid LIMIT ?').all(accountId, status, limit)
        : db.prepare('SELECT * FROM ws_group_catalog WHERE account_id=? ORDER BY last_seen_at DESC, group_name COLLATE NOCASE, group_jid LIMIT ?').all(accountId, limit);
      const targets = new Map(db.prepare('SELECT group_jid,enabled,id FROM ws_group_monitor_targets WHERE account_id=?').all(accountId).map(row => [row.group_jid, row]));
      return json(res, 200, { accountId, groups: rows.map(row => ({ ...wsGroupCatalogPayload(row), monitorTarget: targets.get(row.group_jid) ? { id: targets.get(row.group_jid).id, enabled: Boolean(targets.get(row.group_jid).enabled) } : null })) });
    }
    if (url.pathname === '/api/ws/group-membership-events') {
      if (req.method !== 'GET') return json(res, 405, { error: '群组进退事件只支持 GET。' });
      const accountId = wsText(url.searchParams.get('accountId'), 120);
      if (accountId && !wsAccountRow(accountId)) return json(res, 404, { error: 'WS 账号不存在。' });
      const limit = Math.min(20000, Math.max(1, Number(url.searchParams.get('limit')) || 5000));
      return json(res, 200, { accountId: accountId || '', events: wsGroupMembershipEventRows(accountId, limit).map(wsGroupMonitorEventPayload) });
    }
    if (url.pathname === '/api/ws/group-monitors/profiles') {
      if (req.method === 'GET') {
        const accountId = wsText(url.searchParams.get('accountId'), 120);
        if (!accountId) return json(res, 400, { error: '查询群组监控席位必须提供 accountId。' });
        if (!wsAccountRow(accountId)) return json(res, 404, { error: 'WS 账号不存在。' });
        const rows = db.prepare('SELECT * FROM ws_group_monitor_profiles WHERE account_id=? ORDER BY updated_at DESC').all(accountId);
        return json(res, 200, { profiles: rows.map(wsGroupMonitorProfilePayload) });
      }
      if (req.method === 'POST') {
        const body = JSON.parse((await readBody(req, 256 * 1024)).toString('utf8') || '{}');
        const accountId = wsAccountId(body.accountId);
        wsRequireAccount(accountId);
        const slotKey = wsGroupMonitorResolvedSlotKey(accountId, body.slotKey || `group-seat-${accountId}`);
        const existing = db.prepare('SELECT * FROM ws_group_monitor_profiles WHERE account_id=? AND slot_key=?').get(accountId, slotKey);
        const now = new Date().toISOString();
        const id = existing?.id || `wsg-profile-${randomUUID()}`;
        db.exec('BEGIN IMMEDIATE');
        try {
          db.prepare(`INSERT INTO ws_group_monitor_profiles(id,account_id,slot_key,status,enabled,poll_interval_sec,last_heartbeat_at,last_error,data_json,created_at,updated_at)
            VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET enabled=excluded.enabled,poll_interval_sec=excluded.poll_interval_sec,status=CASE WHEN excluded.enabled=1 THEN 'starting' ELSE 'paused' END,updated_at=excluded.updated_at`)
            .run(id, accountId, slotKey, body.enabled === false ? 'paused' : 'starting', body.enabled === false ? 0 : 1, Math.max(15, Math.min(3600, Number(body.pollIntervalSec) || 45)), '', '', JSON.stringify({}), existing?.created_at || now, now);
          db.exec('COMMIT');
        } catch (error) { db.exec('ROLLBACK'); throw error; }
        return json(res, existing ? 200 : 201, { profile: wsGroupMonitorProfilePayload(db.prepare('SELECT * FROM ws_group_monitor_profiles WHERE id=?').get(id)) });
      }
      return json(res, 405, { error: '群组监控席位只支持 GET/POST。' });
    }
    const groupMonitorMatch = url.pathname.match(/^\/api\/ws\/group-monitors\/([^/]+)(?:\/(.*))?$/);
    if (groupMonitorMatch) {
      const profileId = decodeURIComponent(groupMonitorMatch[1]);
      const profile = db.prepare('SELECT * FROM ws_group_monitor_profiles WHERE id=?').get(profileId);
      if (!profile) return json(res, 404, { error: '固定群组监控席位不存在。' });
      const requestedAccountId = wsText(url.searchParams.get('accountId'), 120);
      if (!requestedAccountId) return json(res, 400, { error: '群组监控请求必须提供 accountId。' });
      if (!wsGroupMonitorAccountScoped(profile, requestedAccountId)) return json(res, 404, { error: '固定群组监控席位不存在。' });
      const suffix = groupMonitorMatch[2] || '';
      if (!suffix && req.method === 'GET') return json(res, 200, { profile: wsGroupMonitorProfilePayload(profile), health: wsGroupMonitorHealthPayload(profile) });
      if (!suffix && (req.method === 'PATCH' || req.method === 'PUT')) {
        const body = JSON.parse((await readBody(req, 256 * 1024)).toString('utf8') || '{}');
        if (!wsText(body.accountId, 120)) return json(res, 400, { error: '群组监控请求必须提供 accountId。' });
        if (!wsGroupMonitorAccountScoped(profile, body.accountId)) return json(res, 404, { error: '固定群组监控席位不存在。' });
        const now = new Date().toISOString();
        const enabled = body.enabled === false ? 0 : body.enabled === true ? 1 : profile.enabled;
        const status = enabled ? (body.status ? wsText(body.status, 32) : 'starting') : 'paused';
        db.prepare('UPDATE ws_group_monitor_profiles SET enabled=?,status=?,poll_interval_sec=?,last_error=?,updated_at=? WHERE id=?').run(enabled, status, Math.max(15, Math.min(3600, Number(body.pollIntervalSec) || Number(profile.poll_interval_sec) || 45)), wsText(body.lastError, 500), now, profileId);
        return json(res, 200, { profile: wsGroupMonitorProfilePayload(db.prepare('SELECT * FROM ws_group_monitor_profiles WHERE id=?').get(profileId)) });
      }
      if (suffix === 'targets/scan' && req.method === 'POST') {
        const body = JSON.parse((await readBody(req, 512 * 1024)).toString('utf8') || '{}');
        if (!wsText(body.accountId, 120)) return json(res, 400, { error: '群组监控请求必须提供 accountId。' });
        if (!wsGroupMonitorAccountScoped(profile, body.accountId)) return json(res, 404, { error: '固定群组监控席位不存在。' });
        const targets = Array.isArray(body.targets) ? body.targets.slice(0, 1000) : [];
        const now = new Date().toISOString();
        db.exec('BEGIN IMMEDIATE');
        try {
          for (const item of targets) {
            const groupJid = wsGroupMonitor.normalizeMemberIdentity(item?.groupJid || item?.jid || item?.id).value;
            if (!groupJid || !/@g\.us$/.test(groupJid)) continue;
            const existing = db.prepare('SELECT id,group_name,source_id,channel_id,data_json FROM ws_group_monitor_targets WHERE profile_id=? AND group_jid=?').get(profileId, groupJid);
            const id = existing?.id || `wsg-target-${randomUUID()}`;
            const existingMetadata = existing?.data_json ? wsJson(existing.data_json, {}) : {};
            const metadata = { ...(existingMetadata && typeof existingMetadata === 'object' && !Array.isArray(existingMetadata) ? existingMetadata : {}), ...(item?.data && typeof item.data === 'object' && !Array.isArray(item.data) ? item.data : {}) };
            for (const [key, value] of [['sourceName', item?.sourceName], ['channelName', item?.channelName], ['sourceLabel', item?.sourceLabel], ['groupFanType', item?.groupFanType], ['groupFanSource', item?.groupFanSource]]) {
              const normalized = wsText(value, 160);
              if (normalized) metadata[key] = normalized;
            }
            const sourceId = wsText(item.sourceId || item.source, 160) || wsText(existing?.source_id, 160);
            const channelId = wsText(item.channelId || item.channel_id, 160) || wsText(existing?.channel_id, 160) || sourceId;
            const groupName = wsText(item.groupName || item.name, 240) || wsText(existing?.group_name, 240) || groupJid;
            const enabled = item.enabled === true ? 1 : 0;
            if (enabled) {
              const conflict = db.prepare(`SELECT id,profile_id,account_id,group_jid,group_name
                FROM ws_group_monitor_targets
                WHERE account_id=? AND group_jid=? AND enabled=1 AND id<>?
                LIMIT 1`).get(profile.account_id, groupJid, existing?.id || '');
              if (conflict) {
                const error = new Error('同一 WS 账号下的群组已经由其他监测席位启用。');
                error.status = 409;
                error.code = 'GROUP_TARGET_CONFLICT';
                error.conflicts = [{ accountId: profile.account_id, groupJid, targetIds: [String(conflict.id)], profileIds: [String(conflict.profile_id)] }];
                throw error;
              }
            }
            db.prepare(`INSERT INTO ws_group_monitor_targets(id,profile_id,account_id,group_jid,group_name,source_id,channel_id,vip_only,enabled,last_snapshot_hash,last_seen_at,data_json,created_at,updated_at)
              VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(profile_id,group_jid) DO UPDATE SET group_name=CASE WHEN excluded.group_name<>'' THEN excluded.group_name ELSE ws_group_monitor_targets.group_name END,source_id=CASE WHEN excluded.source_id<>'' THEN excluded.source_id ELSE ws_group_monitor_targets.source_id END,channel_id=CASE WHEN excluded.channel_id<>'' THEN excluded.channel_id ELSE ws_group_monitor_targets.channel_id END,vip_only=excluded.vip_only,enabled=excluded.enabled,data_json=excluded.data_json,updated_at=excluded.updated_at`)
              .run(id, profileId, profile.account_id, groupJid, groupName, sourceId, channelId, item.vipOnly === false ? 0 : 1, enabled, '', '', JSON.stringify(metadata), now, now);
            wsGroupCatalogUpsert(profile.account_id, { ...item, groupJid, groupName, sourceId, channelId, discoverySource: 'monitor-target' }, now);
          }
          db.exec('COMMIT');
        } catch (error) { db.exec('ROLLBACK'); throw error; }
        return json(res, 200, { targets: db.prepare('SELECT * FROM ws_group_monitor_targets WHERE profile_id=? ORDER BY enabled DESC, group_name COLLATE NOCASE').all(profileId).map(wsGroupMonitorTargetPayload) });
      }
      const targetAction = suffix.match(/^targets\/([^/]+)\/(enable|disable)$/);
      if (targetAction && req.method === 'POST') {
        const body = JSON.parse((await readBody(req, 256 * 1024)).toString('utf8') || '{}');
        if (!wsText(body.accountId, 120)) return json(res, 400, { error: '群组监控请求必须提供 accountId。' });
        if (!wsGroupMonitorAccountScoped(profile, body.accountId)) return json(res, 404, { error: '固定群组监控席位不存在。' });
        const targetId = decodeURIComponent(targetAction[1]);
        const enabled = targetAction[2] === 'enable' ? 1 : 0;
        const now = new Date().toISOString();
        if (enabled) {
          const currentTarget = db.prepare('SELECT account_id,group_jid FROM ws_group_monitor_targets WHERE id=? AND profile_id=?').get(targetId, profileId);
          if (!currentTarget) return json(res, 404, { error: '群组监控目标不存在。' });
          const conflict = db.prepare(`SELECT id,profile_id FROM ws_group_monitor_targets
            WHERE account_id=? AND group_jid=? AND enabled=1 AND id<>? LIMIT 1`)
            .get(currentTarget.account_id, currentTarget.group_jid, targetId);
          if (conflict) return json(res, 409, {
            error: '同一 WS 账号下的群组已经由其他监测席位启用。',
            code: 'GROUP_TARGET_CONFLICT',
            conflicts: [{ accountId: currentTarget.account_id, groupJid: currentTarget.group_jid, targetIds: [String(conflict.id)], profileIds: [String(conflict.profile_id)] }],
          });
        }
        const changed = db.prepare('UPDATE ws_group_monitor_targets SET enabled=?,updated_at=? WHERE id=? AND profile_id=?').run(enabled, now, targetId, profileId);
        if (!changed.changes) return json(res, 404, { error: '群组监控目标不存在。' });
        return json(res, 200, { target: wsGroupMonitorTargetPayload(db.prepare('SELECT * FROM ws_group_monitor_targets WHERE id=?').get(targetId)) });
      }
      if (suffix === 'events' && req.method === 'GET') {
        const status = wsText(url.searchParams.get('status'), 24);
        const limit = Math.min(500, Math.max(1, Number(url.searchParams.get('limit')) || 100));
        const rows = status && status !== 'all'
          ? db.prepare('SELECT * FROM ws_group_membership_events WHERE profile_id=? AND status=? ORDER BY observed_at DESC,id DESC LIMIT ?').all(profileId, status, limit)
          : db.prepare('SELECT * FROM ws_group_membership_events WHERE profile_id=? ORDER BY observed_at DESC,id DESC LIMIT ?').all(profileId, limit);
        return json(res, 200, { events: rows.map(wsGroupMonitorEventPayload) });
      }
      const resolveEvent = suffix.match(/^events\/([^/]+)\/resolve$/);
      if (resolveEvent && req.method === 'POST') {
        const eventId = decodeURIComponent(resolveEvent[1]);
        const body = JSON.parse((await readBody(req, 256 * 1024)).toString('utf8') || '{}');
        if (!wsText(body.accountId, 120)) return json(res, 400, { error: '群组监控请求必须提供 accountId。' });
        if (!wsGroupMonitorAccountScoped(profile, body.accountId)) return json(res, 404, { error: '固定群组监控席位不存在。' });
        const event = db.prepare('SELECT * FROM ws_group_membership_events WHERE id=? AND profile_id=?').get(eventId, profileId);
        if (!event) return json(res, 404, { error: '群组事件不存在。' });
        const state = readState() || emptyCrmState();
        const customerId = wsText(body.customerId, 128);
        const customer = customerId ? state.customers.find(item => String(item.id) === customerId && item.deleted !== true) : null;
        if (body.action === 'ignore') {
          db.prepare("UPDATE ws_group_membership_events SET status='ignored',review_reason=?,updated_at=? WHERE id=?").run(wsText(body.reason || '人工忽略', 500), new Date().toISOString(), eventId);
          return json(res, 200, { event: wsGroupMonitorEventPayload(db.prepare('SELECT * FROM ws_group_membership_events WHERE id=?').get(eventId)) });
        }
        if (!customer) return json(res, 400, { error: '人工关联需要选择现有客户。' });
        const target = db.prepare('SELECT * FROM ws_group_monitor_targets WHERE id=? AND profile_id=?').get(event.target_id, profileId);
        const profileRow = db.prepare('SELECT * FROM ws_group_monitor_profiles WHERE id=?').get(profileId);
        const now = new Date().toISOString();
        const memberEvent = {
          ...event,
          memberId: event.member_jid,
          memberPhone: event.member_phone,
          type: event.event_type,
          eventAt: event.event_at,
          observedAt: event.observed_at,
          sourceEventId: event.source_event_id,
          idempotencyKey: event.idempotency_key,
          confidence: 1,
        };
        const relations = Array.isArray(customer.groupMemberships) ? customer.groupMemberships.slice() : [];
        const index = relations.findIndex(item => item.accountId === event.account_id && item.groupJid === event.group_jid);
        const projection = wsGroupMonitor.applyMembershipProjection(profileRow, target, memberEvent, customer, { now, existingRelation: relations[index] });
        if (projection.status !== 'applied') return json(res, 409, { error: '事件仍无法安全应用。' });
        const relation = { ...projection.relation, locked: body.lock === true || Boolean(relations[index]?.locked) };
        db.exec('BEGIN IMMEDIATE');
        try {
          if (index >= 0) relations[index] = relation; else relations.push(relation);
          customer.groupMemberships = relations;
          customer.statusHistory = [...(Array.isArray(customer.statusHistory) ? customer.statusHistory : []), { ...projection.statusHistoryEvent, manual: true }].slice(-500);
          customer.status = deriveWsCustomerGroupStatus(customer, event.event_type);
          customer.updatedAt = now;
          writeState(state, false);
          wsPersistCustomerGroupMembershipLedger(event.account_id, target, relation, memberEvent, wsGroupMonitorSource(target, state), now);
          db.prepare("UPDATE ws_group_membership_events SET customer_id=?,status='applied',confidence=1,review_reason='',updated_at=? WHERE id=?").run(customer.id, now, eventId);
          db.exec('COMMIT');
        } catch (error) { db.exec('ROLLBACK'); throw error; }
        return json(res, 200, { event: wsGroupMonitorEventPayload(db.prepare('SELECT * FROM ws_group_membership_events WHERE id=?').get(eventId)), customerId: customer.id });
      }
      if (suffix === 'health' && req.method === 'GET') return json(res, 200, { health: wsGroupMonitorHealthPayload(profile) });
      return json(res, 405, { error: '群组监控接口不支持该操作。' });
    }
    // Stage 3 isolated group-manager boundary.  The ordinary monitor and
    // chat routes remain unchanged; these account-scoped endpoints are only
    // reachable from the Mock Transport/temporary data root gate.
    if (url.pathname.startsWith('/api/ws/group-manager/')) {
      try { stage3GroupManagerGuard(); } catch (error) {
        return json(res, error.status || 404, { error: error.message, code: error.code || 'GROUP_MANAGER_DISABLED' });
      }
      if (!stage3MockMode) return json(res, 404, { error: '独立 WS 群组管理仅在隔离 Mock 环境启用。', code: 'GROUP_MANAGER_DISABLED' });
      const accountId = wsAccountId(url.searchParams.get('accountId'));
      if (!wsAccountRow(accountId)) return json(res, 404, { error: 'WS 账号不存在。' });
      const suffix = url.pathname.slice('/api/ws/group-manager/'.length);
      if (['customer-reading', 'customer-reading/export', 'customer-reading/capability'].includes(suffix)) {
        if (req.method !== 'GET') return json(res, 405, { error: '本地阅读观测只支持 GET。' });
        const params = url.searchParams;
        const requestedGroup = params.get('groupJid') || '';
        const messageId = params.get('messageId') || '';
        if (['accountId', 'groupJid'].some(key => params.getAll(key).length !== 1) ||
            params.get('accountId') !== accountId || !/^[a-z0-9._-]{1,235}@g\.us$/.test(requestedGroup)) {
          return json(res, 400, { error: '请明确选择 WS 账号和群组。', code: 'READING_SCOPE_INVALID' });
        }
        if (!db.prepare('SELECT 1 FROM ws_group_catalog WHERE account_id=? AND group_jid=?').get(accountId, requestedGroup)) {
          return json(res, 404, { error: '当前账号没有所选群组记录。', code: 'READING_GROUP_UNAVAILABLE' });
        }
        if (suffix === 'customer-reading/capability') return json(res, 200, { accountId, groupJid: requestedGroup, localObservation: true });
        if (!messageId || params.getAll('messageId').length !== 1) {
          return json(res, 400, { error: '请明确选择本地消息。', code: 'READING_SCOPE_INVALID' });
        }
        const read = require('./modules/ws-customer-reading-query.cjs');
        const messages = [{ accountId, groupJid: requestedGroup, messageId }];
        const policy = {
          authorize: scope => scope.accountId === accountId && scope.groupJid === requestedGroup && scope.messageId === messageId,
        };
        try {
          if (suffix === 'customer-reading/export') {
            const report = { accountId, groupJid: requestedGroup, messageId, ...read.exportCustomerGroupReadingCsv(db, { messages }, policy) };
            if (Buffer.byteLength(JSON.stringify(report)) > 2 * 1024 * 1024) {
              return json(res, 413, { error: '本地阅读观测导出超过大小限制。', code: 'READING_EXPORT_TOO_LARGE' });
            }
            return json(res, 200, report);
          }
          const offset = params.get('offset') ?? '0';
          const limit = params.get('limit') ?? '50';
          if (!/^\d{1,5}$/.test(offset) || !/^\d{1,3}$/.test(limit)) {
            return json(res, 400, { error: '本地阅读观测分页参数无效。', code: 'READING_PAGE_INVALID' });
          }
          return json(res, 200, read.queryCustomerGroupReading(db, { messages, offset: Number(offset), limit: Number(limit) }, policy));
        } catch (error) {
          if (error.code === 'READING_MESSAGE_UNAVAILABLE') return json(res, 404, { error: '当前账号和群组没有所选消息记录。', code: error.code });
          if (error.code === 'READING_RANGE_TOO_LARGE' || error.code === 'READING_EXPORT_TOO_LARGE') return json(res, 413, { error: '本地阅读观测超过范围限制。', code: error.code });
          if (error.code === 'READING_SCOPE_INVALID' || error.code === 'READING_PAGE_INVALID') return json(res, 400, { error: '本地阅读观测选择或分页无效。', code: error.code });
          throw error;
        }
      }
      const managerFlags = stage3GroupManagerFlags();
      if (suffix === 'groups') {
        if (req.method === 'GET') {
          const rows = db.prepare('SELECT * FROM ws_group_catalog WHERE account_id=? ORDER BY last_seen_at DESC,group_name COLLATE NOCASE,group_jid LIMIT ?').all(accountId, Math.min(2000, Math.max(1, Number(url.searchParams.get('limit')) || 500)));
          return json(res, 200, { accountId, groups: rows.map(row => ({ id: row.id, accountId: row.account_id, groupJid: row.group_jid, name: row.group_name, channelId: row.channel_id, participantCount: row.participant_count, status: row.status, lastSeenAt: row.last_seen_at, data: wsJson(row.data_json, {}) })) });
        }
        if (req.method === 'POST') {
          const body = JSON.parse((await readBody(req, 256 * 1024)).toString('utf8') || '{}');
          const groupJid = stage3GroupJid(body.groupJid || body.group_id);
          const now = new Date().toISOString();
          const existing = db.prepare('SELECT * FROM ws_group_catalog WHERE account_id=? AND group_jid=?').get(accountId, groupJid);
          const id = existing?.id || wsCreateId('wsg');
          db.prepare(`INSERT INTO ws_group_catalog(id,account_id,group_jid,group_name,channel_id,participant_count,last_message_at,discovery_source,status,data_json,first_seen_at,last_seen_at,created_at,updated_at)
            VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(account_id,group_jid) DO UPDATE SET group_name=CASE WHEN excluded.group_name<>'' THEN excluded.group_name ELSE ws_group_catalog.group_name END,channel_id=CASE WHEN excluded.channel_id<>'' THEN excluded.channel_id ELSE ws_group_catalog.channel_id END,participant_count=excluded.participant_count,status=excluded.status,data_json=excluded.data_json,last_seen_at=excluded.last_seen_at,updated_at=excluded.updated_at`)
            .run(id, accountId, groupJid, wsText(body.name || body.groupName, 240), wsText(body.channelId, 160), Math.max(0, Number(body.participantCount) || 0), wsText(body.lastMessageAt, 80), 'stage3-mock', ['active','inactive','unknown'].includes(wsText(body.status, 20)) ? wsText(body.status, 20) : 'active', JSON.stringify(body.data && typeof body.data === 'object' ? body.data : {}), existing?.first_seen_at || now, now, existing?.created_at || now, now);
          stage3GroupManagerAudit(accountId, groupJid, existing ? 'group.update' : 'group.create', { source: 'stage3-mock' });
          return json(res, existing ? 200 : 201, { group: { id, accountId, groupJid } });
        }
        return json(res, 405, { error: '群组目录只支持 GET/POST。' });
      }
      if (suffix === 'members') {
        if (req.method === 'GET') {
          const requestedGroup = url.searchParams.get('groupJid'), groupJid = requestedGroup ? stage3GroupJid(requestedGroup) : '';
          const limit = Math.min(groupJid ? 5000 : 1000, Math.max(1, Number(url.searchParams.get('limit')) || 1000));
          const rows = db.prepare('SELECT m.*,g.group_name FROM ws_group_members m LEFT JOIN ws_group_catalog g ON g.account_id=m.account_id AND g.group_jid=m.group_jid WHERE m.account_id=?' + (groupJid ? ' AND m.group_jid=?' : '') + ' ORDER BY m.updated_at DESC,m.group_jid,m.member_jid LIMIT ?').all(...(groupJid ? [accountId, groupJid, limit] : [accountId, limit]));
          return json(res, 200, { accountId, groupJid, limit, members: rows.map(row => ({ ...stage3GroupMemberPayload(row), groupName: row.group_name || '' })) });
        }
        if (req.method === 'POST') {
          const body = JSON.parse((await readBody(req, 256 * 1024)).toString('utf8') || '{}');
          const groupJid = stage3GroupJid(body.groupJid);
          const crmContext = stage3GroupManagerCrm();
          const manager = wsGroupManager.createGroupManager({ flags: managerFlags, crm: crmContext });
          const result = manager.applyMemberEvent({
            ...body,
            accountId,
            groupJid,
            memberJid: body.memberJid || body.memberId || body.memberPhone || body.phone,
            eventType: body.eventType || body.type,
            approvalStatus: body.approvalStatus || body.approval_status,
          });
          if (result.status === 'ignored' || result.status === 'review') {
            stage3GroupManagerAudit(accountId, groupJid, 'member.event', { memberJid: result.event?.memberJid || body.memberJid || '', status: result.status }, result.status === 'review' ? 'review' : 'rejected', result.reason || '');
            return json(res, result.status === 'review' ? 409 : 202, { ...result, persisted: false });
          }
          const relation = result.relation;
          if (!relation) { crmContext.rollback(); return json(res, 202, { ...result, persisted: false }); }
          const now = new Date().toISOString();
          const existing = db.prepare('SELECT * FROM ws_group_members WHERE account_id=? AND group_jid=? AND member_jid=?').get(accountId, groupJid, relation.memberJid);
          if (existing && wsJson(existing.data_json, {}).lastEventKey === relation.lastEventKey) {
            crmContext.rollback();
            return json(res, 200, { ...result, status: 'duplicate', member: stage3GroupMemberPayload(existing), persisted: true });
          }
          const storedId = existing?.id || relation.id || wsCreateId('wsg-member');
          db.exec('BEGIN IMMEDIATE');
          try {
            crmContext.commit();
            if (relation.customerId) relation.customerId = crmContext.resolveCustomerId(relation.customerId);
            if (result.customer?.id) result.customer.id = relation.customerId || result.customer.id;
            db.prepare(`INSERT INTO ws_group_members(id,account_id,group_jid,member_jid,member_phone,display_name,role,status,first_seen_at,last_seen_at,source,evidence_json,manual_locked,data_json,created_at,updated_at)
              VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
              ON CONFLICT(account_id,group_jid,member_jid) DO UPDATE SET member_phone=excluded.member_phone,display_name=CASE WHEN excluded.display_name<>'' THEN excluded.display_name ELSE ws_group_members.display_name END,status=excluded.status,last_seen_at=excluded.last_seen_at,source=excluded.source,evidence_json=excluded.evidence_json,data_json=excluded.data_json,updated_at=excluded.updated_at`)
              .run(storedId, accountId, groupJid, relation.memberJid, relation.memberPhone, wsText(body.displayName, 240), ['active','left','removed'].includes(relation.status) ? 'member' : 'unknown', relation.status === 'active' ? 'active' : relation.status === 'left' ? 'left' : relation.status === 'removed' ? 'removed' : 'unknown', relation.firstSeenAt, relation.lastEventAt, wsText(body.source, 120) || 'stage3-mock', JSON.stringify({ sourceEventId: body.sourceEventId || '', eventType: relation.lastEventType }), existing?.manual_locked || 0, JSON.stringify({ lastEventKey: relation.lastEventKey, customerId: relation.customerId, eventStatus: result.status, correlationId: wsText(body.correlationId, 160) }), existing?.created_at || now, now);
            const membershipStatus = relation.status === 'active' ? '在群' : relation.status === 'left' ? '已退群' : relation.status === 'removed' ? '被移除' : '状态未知';
            db.prepare(`INSERT INTO customer_group_memberships(id,account_id,group_jid,group_name,customer_id,member_jid,member_phone,source_id,source_label,status,first_joined_at,last_event_at,last_event_id,last_event_key,confidence,manual_locked,review_reason,data_json,created_at,updated_at)
              VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
              ON CONFLICT(account_id,group_jid,member_jid) DO UPDATE SET customer_id=CASE WHEN customer_group_memberships.manual_locked=1 THEN customer_group_memberships.customer_id ELSE excluded.customer_id END,member_phone=CASE WHEN customer_group_memberships.manual_locked=1 THEN customer_group_memberships.member_phone ELSE excluded.member_phone END,status=CASE WHEN customer_group_memberships.manual_locked=1 THEN customer_group_memberships.status ELSE excluded.status END,last_event_at=CASE WHEN customer_group_memberships.manual_locked=1 THEN customer_group_memberships.last_event_at ELSE excluded.last_event_at END,last_event_key=CASE WHEN customer_group_memberships.manual_locked=1 THEN customer_group_memberships.last_event_key ELSE excluded.last_event_key END,confidence=CASE WHEN customer_group_memberships.manual_locked=1 THEN customer_group_memberships.confidence ELSE excluded.confidence END,review_reason=CASE WHEN customer_group_memberships.manual_locked=1 THEN customer_group_memberships.review_reason ELSE excluded.review_reason END,data_json=CASE WHEN customer_group_memberships.manual_locked=1 THEN customer_group_memberships.data_json ELSE excluded.data_json END,updated_at=excluded.updated_at`)
              .run(wsCreateId('wsg-rel'), accountId, groupJid, wsText(body.groupName, 240), relation.customerId || '', relation.memberJid, relation.memberPhone || '', wsText(body.sourceId, 160) || '', wsText(body.sourceLabel, 160) || '未分类，待绑定', membershipStatus, relation.firstSeenAt || '', relation.lastEventAt || '', wsText(body.eventId, 160) || '', relation.lastEventKey || '', 1, existing?.manual_locked || 0, relation.reviewReason || '', JSON.stringify({ origin: 'stage3-isolated-mock', sourceEventId: body.sourceEventId || '', correlationId: wsText(body.correlationId, 160) }), existing?.created_at || now, now);
            stage3GroupManagerAudit(accountId, groupJid, 'member.event', { memberJid: relation.memberJid, customerId: relation.customerId, status: result.status, correlationId: wsText(body.correlationId, 160) });
            db.exec('COMMIT');
          } catch (error) {
            try { db.exec('ROLLBACK'); } catch {}
            crmContext.rollback();
            throw error;
          }
          const row = db.prepare('SELECT * FROM ws_group_members WHERE account_id=? AND group_jid=? AND member_jid=?').get(accountId, groupJid, relation.memberJid);
          return json(res, existing ? 200 : 201, { ...result, member: stage3GroupMemberPayload(row), persisted: true });
        }
        return json(res, 405, { error: '群组成员只支持 GET/POST。' });
      }
      if (suffix === 'sync') {
        if (req.method === 'GET') {
          const groupJid = url.searchParams.get('groupJid') ? stage3GroupJid(url.searchParams.get('groupJid')) : '';
          const limit = Math.min(500, Math.max(1, Number(url.searchParams.get('limit')) || 100));
          const rows = groupJid
            ? db.prepare('SELECT * FROM ws_group_sync_runs WHERE account_id=? AND group_jid=? ORDER BY updated_at DESC,id DESC LIMIT ?').all(accountId, groupJid, limit)
            : db.prepare('SELECT * FROM ws_group_sync_runs WHERE account_id=? ORDER BY updated_at DESC,id DESC LIMIT ?').all(accountId, limit);
          return json(res, 200, { accountId, runs: rows.map(row => ({ id: row.id, groupJid: row.group_jid, kind: row.kind, status: row.status, checkpoint: row.checkpoint, itemCount: row.item_count, retryCount: row.retry_count, errorMessage: row.error_message, startedAt: row.started_at, completedAt: row.completed_at, updatedAt: row.updated_at })) });
        }
        if (req.method !== 'POST') return json(res, 405, { error: '群组同步只支持 GET/POST。' });
        const body = JSON.parse((await readBody(req, 128 * 1024)).toString('utf8') || '{}');
        const groupJid = stage3GroupJid(body.groupJid);
        const kind = ['catalog','members','messages','full'].includes(wsText(body.kind, 20)) ? wsText(body.kind, 20) : 'full';
        const now = new Date().toISOString();
        const runId = wsText(body.runId, 160) || wsCreateId('wsg-run');
        const existing = db.prepare('SELECT * FROM ws_group_sync_runs WHERE id=? AND account_id=?').get(runId, accountId);
        if (existing) return json(res, 200, { run: { id: existing.id, accountId, groupJid: existing.group_jid, kind: existing.kind, status: existing.status, checkpoint: existing.checkpoint, itemCount: existing.item_count, retryCount: existing.retry_count }, duplicate: true });
        db.prepare(`INSERT INTO ws_group_sync_runs(id,account_id,group_jid,kind,status,checkpoint,item_count,retry_count,error_message,started_at,completed_at,created_at,updated_at)
          VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(runId, accountId, groupJid, kind, 'queued', wsText(body.checkpoint, 500), 0, 0, '', '', '', now, now);
        stage3GroupManagerAudit(accountId, groupJid, 'sync.create', { runId, kind });
        return json(res, 201, { run: { id: runId, accountId, groupJid, kind, status: 'queued', checkpoint: wsText(body.checkpoint, 500), itemCount: 0, retryCount: 0 } });
      }
      const syncUpdate = suffix.match(/^sync\/([^/]+)$/);
      if (syncUpdate && req.method === 'POST') {
        const runId = decodeURIComponent(syncUpdate[1]);
        const body = JSON.parse((await readBody(req, 128 * 1024)).toString('utf8') || '{}');
        const existing = db.prepare('SELECT * FROM ws_group_sync_runs WHERE id=? AND account_id=?').get(runId, accountId);
        if (!existing) return json(res, 404, { error: '群组同步任务不存在。' });
        const status = ['queued','running','completed','failed','cancelled'].includes(wsText(body.status, 20)) ? wsText(body.status, 20) : existing.status;
        const now = new Date().toISOString();
        const checkpoint = body.checkpoint == null ? existing.checkpoint : wsText(body.checkpoint, 500);
        const itemCount = body.itemCount == null ? existing.item_count : Math.max(existing.item_count, Math.max(0, Number(body.itemCount) || 0));
        const retryCount = body.retryCount == null ? existing.retry_count : Math.max(existing.retry_count, Math.max(0, Number(body.retryCount) || 0));
        if (['completed','cancelled'].includes(existing.status) && status !== existing.status) return json(res, 409, { error: '已关闭的同步任务不能回退状态。', code: 'SYNC_RUN_CLOSED' });
        db.prepare(`UPDATE ws_group_sync_runs SET status=?,checkpoint=?,item_count=?,retry_count=?,error_message=?,started_at=?,completed_at=?,updated_at=? WHERE id=? AND account_id=?`)
          .run(status, checkpoint, itemCount, retryCount, wsText(body.errorMessage, 1000), wsText(body.startedAt, 80) || existing.started_at, wsText(body.completedAt, 80) || (['completed','failed','cancelled'].includes(status) ? now : existing.completed_at), now, runId, accountId);
        stage3GroupManagerAudit(accountId, existing.group_jid, 'sync.update', { runId, status, checkpoint, itemCount, retryCount });
        const row = db.prepare('SELECT * FROM ws_group_sync_runs WHERE id=? AND account_id=?').get(runId, accountId);
        return json(res, 200, { run: { id: row.id, accountId, groupJid: row.group_jid, kind: row.kind, status: row.status, checkpoint: row.checkpoint, itemCount: row.item_count, retryCount: row.retry_count, errorMessage: row.error_message, updatedAt: row.updated_at } });
      }
      if (suffix === 'errors' && req.method === 'POST') {
        const body = JSON.parse((await readBody(req, 128 * 1024)).toString('utf8') || '{}');
        const groupJid = body.groupJid ? stage3GroupJid(body.groupJid) : '';
        const runId = wsText(body.runId, 160) || 'unscoped';
        const operation = wsText(body.operation, 120) || 'unknown';
        const errorCode = wsText(body.errorCode, 120) || 'UNKNOWN';
        const existing = db.prepare('SELECT * FROM ws_group_sync_errors WHERE account_id=? AND run_id=? AND operation=? AND error_code=?').get(accountId, runId, operation, errorCode);
        const retryCount = Math.max(Number(existing?.retry_count || 0) + (existing ? 1 : 1), Math.max(0, Number(body.retryCount) || 0));
        const status = ['open','retrying','resolved','ignored'].includes(wsText(body.status, 20)) ? wsText(body.status, 20) : 'open';
        const now = new Date().toISOString();
        db.prepare(`INSERT INTO ws_group_sync_errors(id,account_id,group_jid,run_id,operation,error_code,error_message,retry_count,next_retry_at,status,data_json,created_at,updated_at)
          VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(account_id,run_id,operation,error_code) DO UPDATE SET group_jid=excluded.group_jid,error_message=excluded.error_message,retry_count=excluded.retry_count,next_retry_at=excluded.next_retry_at,status=excluded.status,data_json=excluded.data_json,updated_at=excluded.updated_at`)
          .run(existing?.id || wsCreateId('wsg-error'), accountId, groupJid, runId, operation, errorCode, wsText(body.errorMessage, 1000), retryCount, wsText(body.nextRetryAt, 80), status, JSON.stringify(body.data && typeof body.data === 'object' ? body.data : {}), existing?.created_at || now, now);
        stage3GroupManagerAudit(accountId, groupJid, 'sync.error', { runId, operation, errorCode, retryCount }, 'error', wsText(body.errorMessage, 1000));
        return json(res, existing ? 200 : 201, { status: existing ? 'updated' : 'created', retryCount, persisted: true });
      }
      if (suffix === 'messages') {
        if (req.method === 'GET') {
          const groupJid = stage3GroupJid(url.searchParams.get('groupJid'));
          const rows = db.prepare('SELECT * FROM ws_group_messages WHERE account_id=? AND group_jid=? ORDER BY sent_at ASC,id ASC LIMIT ?').all(accountId, groupJid, Math.min(5000, Math.max(1, Number(url.searchParams.get('limit')) || 1000)));
          return json(res, 200, { accountId, groupJid, messages: rows.map(stage3GroupMessagePayload) });
        }
        if (req.method === 'POST') {
          const body = JSON.parse((await readBody(req, WS_MESSAGE_BATCH_MAX_BYTES)).toString('utf8') || '{}');
          const groupJid = stage3GroupJid(body.groupJid);
          const messageId = wsText(body.messageId, 300);
          if (!messageId) return json(res, 400, { error: '群组消息必须提供 messageId。', code: 'MESSAGE_ID_REQUIRED' });
          const processingStatus = wsText(body.processingStatus, 24) || 'captured';
          if (!['captured', 'queued', 'analysed', 'failed', 'skipped'].includes(processingStatus)) return json(res, 400, { error: '群组消息 processingStatus 无效。', code: 'MESSAGE_STATUS_INVALID' });
          const existing = db.prepare('SELECT * FROM ws_group_messages WHERE account_id=? AND group_jid=? AND message_id=?').get(accountId, groupJid, messageId);
          if (existing) return json(res, 200, { status: 'duplicate', message: stage3GroupMessagePayload(existing), persisted: true });
          const manager = wsGroupManager.createGroupManager({ flags: managerFlags });
          const result = manager.upsertMessage({ accountId, groupJid, messageId, senderJid: body.senderJid, sentAt: body.sentAt, type: body.type, processingStatus, sourceEvidence: body.sourceEvidence, bodyHash: body.bodyHash });
          const now = new Date().toISOString();
          db.prepare(`INSERT INTO ws_group_messages(id,account_id,group_jid,message_id,sender_jid,sender_phone,sent_at,message_type,processing_status,source_evidence,body_hash,data_json,created_at,updated_at)
            VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(result.message.id, accountId, groupJid, result.message.messageId, result.message.senderJid, result.message.senderPhone, result.message.sentAt, result.message.type, result.message.processingStatus, result.message.sourceEvidence, result.message.bodyHash, JSON.stringify({ correlationId: wsText(body.correlationId, 160) }), now, now);
          stage3GroupManagerAudit(accountId, groupJid, 'message.capture', { messageId: result.message.messageId, correlationId: wsText(body.correlationId, 160) });
          return json(res, 201, { ...result, message: stage3GroupMessagePayload(db.prepare('SELECT * FROM ws_group_messages WHERE id=?').get(result.message.id)), persisted: true });
        }
        return json(res, 405, { error: '群组消息只支持 GET/POST。' });
      }
      if (suffix === 'read-evidence' && req.method === 'POST') {
        const body = JSON.parse((await readBody(req, 256 * 1024)).toString('utf8') || '{}');
        const groupJid = stage3GroupJid(body.groupJid);
        const messageId = wsText(body.messageId, 300);
        if (!messageId) return json(res, 400, { error: '已读证据必须提供 messageId。', code: 'MESSAGE_ID_REQUIRED' });
        const readStatus = wsText(body.status, 20).toLocaleLowerCase();
        if (!['unknown', 'delivered', 'read'].includes(readStatus)) return json(res, 400, { error: '已读证据状态无效。', code: 'READ_STATUS_INVALID' });
        if (readStatus === 'read' && !wsText(body.evidence || body.evidenceRef || body.evidenceSource, 1000)) return json(res, 400, { error: 'read 状态必须提供平台证据。', code: 'READ_EVIDENCE_REQUIRED' });
        const memberJid = wsGroupMonitor.normalizeMemberIdentity(body.memberJid || body.memberId || body.memberPhone || '').value;
        const existing = db.prepare('SELECT * FROM ws_group_read_evidence WHERE account_id=? AND group_jid=? AND message_id=? AND member_jid=?').get(accountId, groupJid, messageId, memberJid);
        const manager = wsGroupManager.createGroupManager({ flags: managerFlags });
        const result = manager.recordReadEvidence({ accountId, groupJid, messageId, memberJid, status: readStatus, evidence: body.evidence || body.evidenceRef || body.evidenceSource, observedAt: body.observedAt });
        if (existing && stage3ReadRank(result.evidence.status) < stage3ReadRank(existing.status)) return json(res, 200, { status: 'ignored', reason: 'read-evidence-regression', evidence: { id: existing.id, accountId, groupJid, messageId: existing.message_id, memberJid: existing.member_jid, status: existing.status, evidence: existing.evidence_ref || existing.evidence_source, observedAt: existing.observed_at }, persisted: true });
        if (existing && stage3ReadRank(result.evidence.status) === stage3ReadRank(existing.status) && result.evidence.evidence === (existing.evidence_ref || existing.evidence_source)) return json(res, 200, { status: 'duplicate', evidence: { id: existing.id, accountId, groupJid, messageId: existing.message_id, memberJid: existing.member_jid, status: existing.status, evidence: existing.evidence_ref || existing.evidence_source, observedAt: existing.observed_at }, persisted: true });
        const now = new Date().toISOString();
        db.prepare(`INSERT INTO ws_group_read_evidence(id,account_id,group_jid,message_id,member_jid,status,evidence_source,evidence_ref,observed_at,data_json,created_at,updated_at)
          VALUES(?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET status=excluded.status,evidence_source=excluded.evidence_source,evidence_ref=excluded.evidence_ref,observed_at=excluded.observed_at,updated_at=excluded.updated_at`)
          .run(existing?.id || result.evidence.id, accountId, groupJid, result.evidence.messageId, result.evidence.memberJid, result.evidence.status, result.evidence.evidence, result.evidence.evidence, result.evidence.observedAt, '{}', now, now);
        result.evidence.id = existing?.id || result.evidence.id;
        stage3GroupManagerAudit(accountId, groupJid, 'message.read-evidence', { messageId: result.evidence.messageId, status: result.evidence.status });
        return json(res, 200, { ...result, persisted: true });
      }
      if (suffix === 'read-evidence' && req.method === 'GET') {
        const groupJid = stage3GroupJid(url.searchParams.get('groupJid'));
        const rows = db.prepare('SELECT * FROM ws_group_read_evidence WHERE account_id=? AND group_jid=? ORDER BY observed_at ASC,id ASC LIMIT ?').all(accountId, groupJid, Math.min(5000, Math.max(1, Number(url.searchParams.get('limit')) || 1000)));
        return json(res, 200, { accountId, groupJid, evidence: rows.map(row => ({ id: row.id, messageId: row.message_id, memberJid: row.member_jid, status: row.status, evidenceSource: row.evidence_source, evidenceRef: row.evidence_ref, observedAt: row.observed_at })) });
      }
      if (suffix === 'state' && req.method === 'GET') {
        const groupJid = stage3GroupJid(url.searchParams.get('groupJid'));
        const limit = Math.min(5000, Math.max(1, Number(url.searchParams.get('limit')) || 1000));
        const group = db.prepare('SELECT * FROM ws_group_catalog WHERE account_id=? AND group_jid=?').get(accountId, groupJid);
        const members = db.prepare('SELECT * FROM ws_group_members WHERE account_id=? AND group_jid=? ORDER BY updated_at DESC,member_jid LIMIT ?').all(accountId, groupJid, limit);
        const messages = db.prepare('SELECT * FROM ws_group_messages WHERE account_id=? AND group_jid=? ORDER BY sent_at ASC,id ASC LIMIT ?').all(accountId, groupJid, limit);
        const evidence = db.prepare('SELECT * FROM ws_group_read_evidence WHERE account_id=? AND group_jid=? ORDER BY observed_at ASC,id ASC LIMIT ?').all(accountId, groupJid, limit);
        const syncRuns = db.prepare('SELECT * FROM ws_group_sync_runs WHERE account_id=? AND group_jid=? ORDER BY updated_at DESC,id DESC LIMIT ?').all(accountId, groupJid, limit);
        const auditRows = db.prepare('SELECT * FROM ws_group_audit WHERE account_id=? AND group_jid=? ORDER BY created_at DESC,id DESC LIMIT ?').all(accountId, groupJid, limit);
        const errors = db.prepare('SELECT * FROM ws_group_sync_errors WHERE account_id=? AND group_jid=? ORDER BY updated_at DESC,id DESC LIMIT ?').all(accountId, groupJid, limit);
        return json(res, 200, {
          accountId,
          groupJid,
          group: group ? { id: group.id, accountId, groupJid, name: group.group_name, channelId: group.channel_id, participantCount: group.participant_count, status: group.status, lastSeenAt: group.last_seen_at, data: wsJson(group.data_json, {}) } : null,
          members: members.map(stage3GroupMemberPayload),
          messages: messages.map(stage3GroupMessagePayload),
          readEvidence: evidence.map(row => ({ id: row.id, messageId: row.message_id, memberJid: row.member_jid, status: row.status, evidenceSource: row.evidence_source, evidenceRef: row.evidence_ref, observedAt: row.observed_at })),
          syncRuns: syncRuns.map(row => ({ id: row.id, groupJid: row.group_jid, kind: row.kind, status: row.status, checkpoint: row.checkpoint, itemCount: row.item_count, retryCount: row.retry_count, errorMessage: row.error_message, startedAt: row.started_at, completedAt: row.completed_at, updatedAt: row.updated_at })),
          audit: auditRows.map(row => ({ id: row.id, groupJid: row.group_jid, action: row.action, outcome: row.outcome, reason: row.reason, data: wsJson(row.data_json, {}), createdAt: row.created_at })),
          errors: errors.map(row => ({ id: row.id, groupJid: row.group_jid, runId: row.run_id, operation: row.operation, errorCode: row.error_code, errorMessage: row.error_message, retryCount: row.retry_count, status: row.status, updatedAt: row.updated_at })),
        });
      }
      if (suffix === 'audit' && req.method === 'GET') {
        const groupJid = wsText(url.searchParams.get('groupJid'), 180);
        const rows = groupJid ? db.prepare('SELECT * FROM ws_group_audit WHERE account_id=? AND group_jid=? ORDER BY created_at DESC,id DESC LIMIT ?').all(accountId, groupJid, 500) : db.prepare('SELECT * FROM ws_group_audit WHERE account_id=? ORDER BY created_at DESC,id DESC LIMIT ?').all(accountId, 500);
        return json(res, 200, { accountId, audit: rows.map(row => ({ id: row.id, groupJid: row.group_jid, action: row.action, outcome: row.outcome, reason: row.reason, data: wsJson(row.data_json, {}), createdAt: row.created_at })) });
      }
      if (suffix === 'errors' && req.method === 'GET') {
        const rows = db.prepare('SELECT * FROM ws_group_sync_errors WHERE account_id=? ORDER BY updated_at DESC,id DESC LIMIT 500').all(accountId);
        return json(res, 200, { accountId, errors: rows.map(row => ({ id: row.id, groupJid: row.group_jid, runId: row.run_id, operation: row.operation, errorCode: row.error_code, errorMessage: row.error_message, retryCount: row.retry_count, status: row.status, updatedAt: row.updated_at })) });
      }
      return json(res, 405, { error: '独立群组管理接口不支持该操作。' });
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
      const inputGroupEvents = Array.isArray(body.groupEvents) ? body.groupEvents.slice(0, 1000) : [];
      const catalogNow = wsStrictIso(body.capturedAt) || new Date().toISOString();
      // Checkpoints are emitted by the isolated collector while it walks the
      // complete WhatsApp conversation index. Persist group rows separately
      // from ws_conversations so the monitor picker is not limited to the
      // currently rendered/virtualized list.
      for (const checkpoint of inputCheckpoints) {
        const groupJid = wsGroupMonitor.normalizeMemberIdentity(checkpoint?.groupJid || checkpoint?.group_id || checkpoint?.groupId || checkpoint?.conversationKey || checkpoint?.externalId).value;
        const isGroup = checkpoint?.isGroup === true || checkpoint?.conversationType === 'group' || checkpoint?.conversationType === 'vip_group' || /@g\.us$/i.test(groupJid);
        if (!isGroup || !/@g\.us$/i.test(groupJid)) continue;
        wsGroupCatalogUpsert(accountId, { ...checkpoint, groupJid, discoverySource: checkpoint?.discoverySource || checkpoint?.source || 'ws-collector', status: checkpoint?.collectionStatus === 'inactive' ? 'inactive' : 'active' }, catalogNow);
      }
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
      if (!grouped.size && !inputGroupEvents.length) return json(res, 200, { accepted: 0, deduplicated: 0, repairedTimestamps: 0, repairedDirections: 0, messageIds: [], groupEvents: { accepted: 0, applied: 0, pending: 0, review: 0, ignored: 0, deduplicated: 0, autoRegistered: 0, events: [] }, processedAt: new Date().toISOString() });
      let accepted = 0, deduplicated = 0, repairedTimestamps = 0, repairedDirections = 0;
      const messageIds = [];
      let groupEventResult = { accepted: 0, applied: 0, pending: 0, review: 0, ignored: 0, deduplicated: 0, autoRegistered: 0, events: [] };
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
            // Keep ordinary group identity metadata so the fixed monitor can
            // offer a name-based picker. The row is still excluded from the
            // personal customer/AI inventory and never receives messages.
            conversation = wsUpsertExcludedGroupConversation(accountId, externalKey, checkpoint, now);
            wsQuiesceGroup(conversation, now);
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
                      OR COALESCE(json_extract(data_json,'$.directionSource'),'') NOT IN ('class-message-out','class-message-in','data-id-outgoing','data-id-incoming','icon-tail-out','icon-tail-in','palette-outgoing','palette-incoming','geometry-align-outgoing','geometry-align-incoming','geometry-right','geometry-left')
                      OR (direction='send' AND json_extract(data_json,'$.directionSource') NOT IN ('class-message-out','data-id-outgoing','icon-tail-out','palette-outgoing','geometry-align-outgoing','geometry-right'))
                      OR (direction='receive' AND json_extract(data_json,'$.directionSource') NOT IN ('class-message-in','data-id-incoming','icon-tail-in','palette-incoming','geometry-align-incoming','geometry-left')))`).get(accountId, conversation.id).count || 0);
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
        if (inputGroupEvents.length) groupEventResult = wsGroupMonitorApplyEventsInTransaction(accountId, inputGroupEvents, { now });
        db.exec('COMMIT');
      } catch (error) {
        try { db.exec('ROLLBACK'); } catch {}
        throw error;
      }
      return json(res, 200, { accepted, deduplicated, repairedTimestamps, repairedDirections, messageIds, groupEvents: groupEventResult, processedAt: new Date().toISOString() });
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
          // Ordinary groups stay out of the customer/AI inventory, but the
          // WS monitor still needs their stable identity and display name so
          // a logged-in operator can select a group without pasting a JID.
          groupConversations: excludedRows.filter(wsIsExcludedGroup).map(wsConversationPayload),
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
    // Translation persistence is intentionally a separate, narrow endpoint:
    // it can only update the translated columns for an existing message and
    // therefore can never replace the captured original text.
    if (url.pathname === '/api/ws/messages/translate' && req.method === 'POST') {
      const body = JSON.parse((await readBody(req, 512 * 1024)).toString('utf8') || '{}');
      const accountId = wsAccountId(body.accountId);
      if (!wsAccountRow(accountId)) return json(res, 404, { error: 'WS 账号不存在。' });
      const messageId = wsText(body.messageId || body.id, 160);
      if (!messageId) return json(res, 400, { error: '翻译保存缺少消息编号。' });
      const existing = db.prepare('SELECT * FROM ws_messages WHERE id=? AND account_id=?').get(messageId, accountId);
      if (!existing) return json(res, 404, { error: 'WS 消息不存在或不属于当前账号。' });
      const translatedText = wsText(body.translatedText, 12000);
      const targetLanguage = wsText(body.targetLanguage, 40);
      if (!translatedText) return json(res, 400, { error: '译文不能为空；原文仍保留。' });
      const translationStatus = WS_TRANSLATION_STATUSES.has(wsText(body.translationStatus, 24)) ? wsText(body.translationStatus, 24) : 'translated';
      const attempts = Object.hasOwn(body, 'translationAttempts')
        ? Math.max(0, Math.floor(Number(body.translationAttempts) || 0))
        : Number(existing.translation_attempts || 0) + 1;
      const now = new Date().toISOString();
      db.prepare(`UPDATE ws_messages
        SET translated_text=?,target_language=?,source_language=CASE WHEN ?<>'' THEN ? ELSE source_language END,
            translation_status=?,translation_error=?,translation_attempts=?,last_attempt_at=?,updated_at=?
        WHERE id=? AND account_id=?`)
        .run(translatedText, targetLanguage, wsText(body.sourceLanguage, 40), wsText(body.sourceLanguage, 40), translationStatus, wsText(body.translationError, 1000), attempts, now, now, messageId, accountId);
      return json(res, 200, wsMessagePayload(db.prepare('SELECT * FROM ws_messages WHERE id=? AND account_id=?').get(messageId, accountId)));
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
    const stage4AiRoute = url.pathname.match(/^\/api\/ws\/(ai-pipeline|ai-review)(?:\/([^/]+))?(?:\/(.*))?$/);
    if (stage4AiRoute) {
      stage4AiGuard();
      const segment = wsText(stage4AiRoute[2], 80) || (stage4AiRoute[1] === 'ai-review' ? 'suggestions' : '');
      const resourceId = wsText(stage4AiRoute[3], 160);
      const body = req.method === 'POST' ? JSON.parse((await readBody(req, 2 * 1024 * 1024)).toString('utf8') || '{}') : {};
      const accountId = wsAccountId(body.accountId || url.searchParams.get('accountId'));
      wsRequireAccount(accountId);
      const now = new Date().toISOString();
      try {
        if (segment === 'jobs') {
          const jobId = resourceId || wsText(body.jobId || body.id || url.searchParams.get('jobId'), 160);
          if (req.method === 'GET') {
            const rows = jobId ? [db.prepare('SELECT * FROM ai_jobs WHERE id=? AND account_id=?').get(jobId, accountId)].filter(Boolean) : db.prepare('SELECT * FROM ai_jobs WHERE account_id=? ORDER BY priority DESC,created_at,id LIMIT 200').all(accountId);
            if (jobId && !rows.length) return json(res, 404, { error: 'AI 隔离任务不存在。' });
            const jobs = rows.map(aiPipelineJobPayload);
            if (jobId) return json(res, 200, { job: jobs[0], evidence: db.prepare('SELECT * FROM ai_job_evidence WHERE account_id=? AND job_id=? ORDER BY created_at,id').all(accountId, jobId).map(aiPipelineEvidencePayload), suggestions: db.prepare('SELECT * FROM ai_crm_suggestions WHERE account_id=? AND job_id=? ORDER BY created_at,id').all(accountId, jobId).map(aiPipelineSuggestionPayload), audit: db.prepare('SELECT * FROM ai_task_audit WHERE account_id=? AND job_id=? ORDER BY created_at,id').all(accountId, jobId).map(aiPipelineAuditPayload) });
            const stats = Object.fromEntries(aiJobPipeline.STATES.map(value => [value, 0]));
            for (const row of db.prepare('SELECT status,COUNT(*) AS count FROM ai_jobs WHERE account_id=? GROUP BY status').all(accountId)) { const state = aiJobPipeline.status(row.status); if (state) stats[state] = Number(stats[state] || 0) + Number(row.count || 0); }
            stats.total = Object.values(stats).reduce((sum, value) => sum + Number(value || 0), 0);
            return json(res, 200, { jobs, stats, productionFrozen: true, generatedAt: now });
          }
          if (req.method !== 'POST') return json(res, 405, { error: 'AI 隔离任务只支持 GET/POST。' });
          const action = wsText(body.action || 'enqueue', 32).toLowerCase();
          if (action === 'enqueue') {
            const conversationId = wsText(body.conversationId, 160), groupJid = wsText(body.groupJid || body.group_jid, 180);
            if (!conversationId && !groupJid) return json(res, 422, { error: 'AI 任务必须关联会话或群组。' });
            if (conversationId) wsRequireAiConversation(conversationId, accountId);
            if (groupJid && body.identityTrusted !== true) return json(res, 422, { error: '群组 AI 任务必须提供可信身份映射。' });
            const key = aiJobPipeline.makeIdempotencyKey({ accountId, conversationId, groupJid, jobType: body.jobType, idempotencyKey: body.idempotencyKey });
            const result = stage4Write(body, 'enqueue:' + key, 'enqueue:' + key, connection => {
              const existing = connection.prepare('SELECT * FROM ai_jobs WHERE account_id=? AND idempotency_key=?').get(accountId, key); if (existing) return { existed: true, row: existing };
              const id = wsText(body.id, 160) || wsCreateId('aij4'), payload = wsObject(body.payload, 512 * 1024), correlationId = wsText(body.correlationId || body.correlation_id, 160) || `wsc-${randomUUID()}`;
              connection.prepare("INSERT INTO ai_jobs(id,account_id,conversation_id,idempotency_key,payload_json,status,attempts,max_attempts,next_attempt_at,locked_at,lease_token,last_error,analysis_id,created_at,updated_at,job_type,customer_id,group_jid,source_message_id,source_event_id,source_type,priority,checkpoint_json,result_ref,cancel_requested,worker_owner_id,fencing_token,correlation_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").run(id, accountId, conversationId || '', key, JSON.stringify({ ...payload, correlationId }), 'pending', 0, Math.min(10, Math.max(1, Math.floor(Number(body.maxAttempts) || 5))), now, '', '', '', '', now, now, wsText(body.jobType || 'ws.ai.analysis', 120), wsText(body.customerId, 128), groupJid, wsText(body.sourceMessageId || body.source_message_id, 200), wsText(body.sourceEventId || body.source_event_id, 200), wsText(body.sourceType || body.source_type, 40) || (groupJid ? 'group' : 'conversation'), Math.max(0, Math.min(100, Math.floor(Number(body.priority) || 50))), '{}', '', 0, '', 0, correlationId);
              stage4Audit(accountId, id, 'enqueue', '', 'pending', body.actor, 'isolated stage4 enqueue', { idempotencyKey: key }, correlationId); return { existed: false, row: connection.prepare('SELECT * FROM ai_jobs WHERE id=? AND account_id=?').get(id, accountId) };
            });
            return json(res, result.existed ? 200 : 201, { ok: true, existed: result.existed, job: aiPipelineJobPayload(result.row), productionFrozen: true });
          }
          const current = db.prepare('SELECT * FROM ai_jobs WHERE id=? AND account_id=?').get(jobId, accountId); if (!current) return json(res, 404, { error: 'AI 隔离任务不存在。' });
          const leaseToken = wsText(body.leaseToken, 200);
          if (action === 'claim') {
            const result = stage4Write(body, 'claim:' + jobId + ':' + String(Number(current.attempts || 0) + 1), 'claim:' + jobId + ':' + now, connection => {
              const row = connection.prepare('SELECT * FROM ai_jobs WHERE id=? AND account_id=?').get(jobId, accountId), state = aiJobPipeline.status(row.status), due = !row.next_attempt_at || row.next_attempt_at <= now;
              if (row.cancel_requested || !['pending','queued','retry_scheduled'].includes(state) || !due) return { claimed: false, row };
              const attempts = Number(row.attempts || 0) + 1; if (attempts > Number(row.max_attempts || 5)) { connection.prepare("UPDATE ai_jobs SET status='failed',last_error='超过最大重试次数',updated_at=? WHERE id=? AND account_id=?").run(now, jobId, accountId); return { claimed: false, row: connection.prepare('SELECT * FROM ai_jobs WHERE id=? AND account_id=?').get(jobId, accountId) }; }
              const token = randomBytes(32).toString('hex'), changed = connection.prepare("UPDATE ai_jobs SET status='running',attempts=?,locked_at=?,lease_token=?,worker_owner_id=?,fencing_token=?,cancel_requested=0,last_error='',updated_at=? WHERE id=? AND account_id=? AND status IN ('pending','queued','retryable','retry_scheduled') AND (next_attempt_at='' OR next_attempt_at<=?) AND cancel_requested=0").run(attempts, now, token, body.lease?.ownerId || '', Number(body.lease?.fencingToken || 0), now, jobId, accountId, now);
              const next = connection.prepare('SELECT * FROM ai_jobs WHERE id=? AND account_id=?').get(jobId, accountId), claimed = Number(changed?.changes || 0) === 1; if (claimed) stage4Audit(accountId, jobId, 'claim', row.status, 'running', body.actor || body.lease?.ownerId, 'atomic worker claim', { attempts }, row.correlation_id); return { claimed, row: next, revealLease: claimed };
            });
            return json(res, 200, { ok: true, claimed: result.claimed, job: aiPipelineJobPayload(result.row, { revealLease: result.revealLease === true }), productionFrozen: true });
          }
          if (action === 'checkpoint') {
            requireAiJobLease(current, leaseToken);
            const result = stage4Write(body, 'checkpoint:' + jobId + ':' + String(body.completedChunks), body.cursor || jobId + ':' + String(body.completedChunks), connection => { const row = connection.prepare('SELECT * FROM ai_jobs WHERE id=? AND account_id=?').get(jobId, accountId); requireAiJobLease(row, leaseToken); const checkpoint = aiJobPipeline.advanceCheckpoint(wsJson(row.checkpoint_json, {}), { completedChunks: body.completedChunks, chunkCount: body.chunkCount, cursor: body.cursor, result: wsObject(body.result, 256 * 1024) }); connection.prepare("UPDATE ai_jobs SET checkpoint_json=?,payload_json=?,updated_at=? WHERE id=? AND account_id=? AND status='running' AND lease_token=?").run(JSON.stringify(checkpoint), JSON.stringify({ ...wsJson(row.payload_json, {}), checkpoint }), now, jobId, accountId, leaseToken); stage4Audit(accountId, jobId, 'checkpoint', 'running', 'running', body.actor || row.worker_owner_id, 'monotonic checkpoint', { completedChunks: checkpoint.completedChunks }, row.correlation_id); return { row: connection.prepare('SELECT * FROM ai_jobs WHERE id=? AND account_id=?').get(jobId, accountId) }; });
            return json(res, 200, { ok: true, job: aiPipelineJobPayload(result.row), productionFrozen: true });
          }
          if (action === 'cancel') {
            if (current.status === 'running') requireAiJobLease(current, leaseToken);
            const result = stage4Write(body, 'cancel:' + jobId + ':' + now, 'cancel:' + jobId + ':' + now, connection => { const row = connection.prepare('SELECT * FROM ai_jobs WHERE id=? AND account_id=?').get(jobId, accountId); if (row.status === 'running') requireAiJobLease(row, leaseToken); if (aiJobPipeline.isTerminal(row.status)) return { changed: false, row }; const changed = connection.prepare("UPDATE ai_jobs SET status='cancelled',cancel_requested=1,locked_at='',lease_token='',next_attempt_at='',last_error=?,updated_at=? WHERE id=? AND account_id=? AND status NOT IN ('completed','failed','cancelled')").run(wsText(body.reason || '用户取消', 1000), now, jobId, accountId); const next = connection.prepare('SELECT * FROM ai_jobs WHERE id=? AND account_id=?').get(jobId, accountId); stage4Audit(accountId, jobId, 'cancel', row.status, 'cancelled', body.actor, wsText(body.reason || '用户取消', 300), {}, row.correlation_id); return { changed: Number(changed?.changes || 0) === 1, row: next }; });
            return json(res, 200, { ok: true, cancelled: result.changed, job: aiPipelineJobPayload(result.row), productionFrozen: true });
          }
          if (action === 'retry') {
            const result = stage4Write(body, 'retry:' + jobId + ':' + now, 'retry:' + jobId + ':' + now, connection => { const row = connection.prepare('SELECT * FROM ai_jobs WHERE id=? AND account_id=?').get(jobId, accountId); if (!['failed','cancelled'].includes(aiJobPipeline.status(row.status))) return { retried: false, row }; connection.prepare("UPDATE ai_jobs SET status='queued',cancel_requested=0,locked_at='',lease_token='',next_attempt_at=?,last_error='',updated_at=? WHERE id=? AND account_id=?").run(now, now, jobId, accountId); const next = connection.prepare('SELECT * FROM ai_jobs WHERE id=? AND account_id=?').get(jobId, accountId); stage4Audit(accountId, jobId, 'retry', row.status, 'queued', body.actor, 'manual retry', {}, row.correlation_id); return { retried: true, row: next }; });
            return json(res, 200, { ok: true, retried: result.retried, job: aiPipelineJobPayload(result.row), productionFrozen: true });
          }
          if (action === 'complete' || action === 'fail') {
            requireAiJobLease(current, leaseToken); if (current.cancel_requested) return json(res, 409, { error: '已取消的 AI 任务不能提交结果。', code: 'AI_JOB_CANCELLED' });
            const resultObject = action === 'complete' && body.result != null ? aiJobPipeline.validateResult(body.result) : null;
            const result = stage4Write(body, action + ':' + jobId, action + ':' + jobId + ':' + now, connection => { const row = connection.prepare('SELECT * FROM ai_jobs WHERE id=? AND account_id=?').get(jobId, accountId); requireAiJobLease(row, leaseToken); if (action === 'complete') { let analysisId = wsText(body.analysisId, 160); if (resultObject && row.conversation_id) { analysisId = analysisId || wsCreateId('wsa4'); connection.prepare('INSERT OR IGNORE INTO ws_ai_analyses(id,account_id,conversation_id,result_json,confidence,provider_name,model,error_message,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)').run(analysisId, accountId, row.conversation_id, JSON.stringify(resultObject), Math.min(1, Math.max(0, Number(body.confidence ?? resultObject.confidence) || 0)), wsText(body.providerName || 'isolated-mock', 120), wsText(body.model || 'fixture-v1', 120), '', now, now); } connection.prepare("UPDATE ai_jobs SET status='completed',locked_at='',lease_token='',next_attempt_at='',last_error='',analysis_id=?,result_ref=?,updated_at=? WHERE id=? AND account_id=? AND status='running' AND lease_token=?").run(analysisId, wsText(body.resultRef, 240), now, jobId, accountId, leaseToken); stage4Audit(accountId, jobId, 'complete', 'running', 'completed', body.actor || row.worker_owner_id, 'result committed', { analysisId }, row.correlation_id); return { analysisId, row: connection.prepare('SELECT * FROM ai_jobs WHERE id=? AND account_id=?').get(jobId, accountId) }; } const attempts = Number(row.attempts || 0), retry = body.retryable !== false && attempts < Number(row.max_attempts || 5), nextStatus = retry ? 'retry_scheduled' : 'failed', nextAt = retry ? aiJobPipeline.nextRetryAt(attempts) : ''; connection.prepare("UPDATE ai_jobs SET status=?,locked_at='',lease_token='',next_attempt_at=?,last_error=?,updated_at=? WHERE id=? AND account_id=? AND status='running' AND lease_token=?").run(nextStatus, nextAt, wsText(body.error || 'AI 分析失败', 1000), now, jobId, accountId, leaseToken); stage4Audit(accountId, jobId, 'fail', 'running', nextStatus, body.actor || row.worker_owner_id, wsText(body.error || 'AI 分析失败', 300), {}, row.correlation_id); return { row: connection.prepare('SELECT * FROM ai_jobs WHERE id=? AND account_id=?').get(jobId, accountId) }; });
            return json(res, 200, { ok: true, completed: action === 'complete', failed: action === 'fail', analysisId: result.analysisId || '', job: aiPipelineJobPayload(result.row), productionFrozen: true });
          }
          return json(res, 400, { error: '不支持的 AI 隔离任务操作。' });
        }
        if (segment === 'evidence') {
          const jobId = wsText(body.jobId || url.searchParams.get('jobId'), 160); if (!jobId) return json(res, 422, { error: '读取证据缺少 jobId。' });
          if (req.method === 'GET') return json(res, 200, { evidence: db.prepare('SELECT * FROM ai_job_evidence WHERE account_id=? AND job_id=? ORDER BY created_at,id').all(accountId, jobId).map(aiPipelineEvidencePayload) });
          const job = db.prepare('SELECT * FROM ai_jobs WHERE id=? AND account_id=?').get(jobId, accountId), quote = wsText(body.quote || body.text || body.sourceText, 2000); if (!job) return json(res, 404, { error: 'AI 任务不存在。' }); if (!quote) return json(res, 422, { error: '来源证据不能为空。' });
          const result = stage4Write(body, 'evidence:' + jobId + ':' + quote, 'evidence:' + jobId + ':' + quote, connection => { const id = wsCreateId('aie'), correlationId = stage4Correlation(body, job); connection.prepare('INSERT OR IGNORE INTO ai_job_evidence(id,account_id,job_id,source_type,source_id,conversation_id,group_jid,message_id,quote,captured_at,data_json,correlation_id,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)').run(id, accountId, jobId, wsText(body.sourceType || 'message', 40), wsText(body.sourceId, 200), job.conversation_id || '', job.group_jid || '', wsText(body.messageId, 200), quote, wsText(body.capturedAt || now, 80), JSON.stringify(wsObject(body.data, 32 * 1024)), correlationId, now); return { row: connection.prepare('SELECT * FROM ai_job_evidence WHERE account_id=? AND job_id=? AND quote=?').get(accountId, jobId, quote) }; });
          return json(res, 201, { ok: true, evidence: aiPipelineEvidencePayload(result.row), productionFrozen: true });
        }
        if (segment === 'suggestions') {
          if (req.method === 'GET') { const status = aiCrmSuggestions.REVIEW_STATES.includes(wsText(url.searchParams.get('status'), 24)) ? wsText(url.searchParams.get('status'), 24) : ''; const where = ['account_id=?'], params = [accountId]; if (status) { where.push('verification_status=?'); params.push(status); } const rows = db.prepare('SELECT * FROM ai_crm_suggestions WHERE ' + where.join(' AND ') + ' ORDER BY updated_at DESC,id DESC LIMIT 200').all(...params); return json(res, 200, { suggestions: rows.map(aiPipelineSuggestionPayload), total: rows.length, productionFrozen: true }); }
          if (req.method !== 'POST') return json(res, 405, { error: 'CRM 候选只支持 GET/POST。' });
          const action = wsText(body.action || 'create', 32).toLowerCase(), suggestionId = wsText(body.suggestionId || body.id, 160);
          if (action === 'create') { const customerId = wsText(body.customerId, 128), state = governanceState(), customer = stage4CustomerFromState(customerId, state); if (!customer || customer.deleted) return json(res, 409, { error: 'AI 候选只允许关联已存在的客户，未知客户不会自动建档。', code: 'CRM_CUSTOMER_REQUIRED' }); const jobId = wsText(body.jobId, 160), sourceJob = jobId ? db.prepare('SELECT * FROM ai_jobs WHERE id=? AND account_id=?').get(jobId, accountId) : null; if (jobId && !sourceJob) return json(res, 404, { error: 'AI 任务不存在。' }); if (body.groupJid && body.identityTrusted !== true) return json(res, 422, { error: '群组候选必须有可信身份映射。' }); const candidates = Array.isArray(body.candidates) ? body.candidates : aiCrmSuggestions.buildCandidates(body.result || {}, { customerId, sourceMessageId: body.sourceMessageId, sourceAt: body.sourceAt }); if (!candidates.length) return json(res, 422, { error: '没有包含来源证据的 AI 候选字段。' }); const result = stage4Write(body, 'suggestions:' + (body.idempotencyKey || jobId || customerId), 'suggestions:' + (jobId || customerId) + ':' + now, connection => { const rows = []; const correlationId = stage4Correlation(body, sourceJob); for (const raw of candidates) { const candidate = aiCrmSuggestions.validateCandidate({ ...raw, customerId, existingValue: customer[raw.fieldName] }), key = wsText(raw.idempotencyKey, 240) || [jobId || 'manual', customerId, candidate.fieldName, createHash('sha256').update(JSON.stringify(candidate.candidateValue)).digest('hex').slice(0, 16)].join(':'); const prior = connection.prepare('SELECT * FROM ai_crm_suggestions WHERE account_id=? AND idempotency_key=?').get(accountId, key); if (prior) { rows.push(prior); continue; } const id = wsCreateId('aics'); connection.prepare('INSERT INTO ai_crm_suggestions(id,account_id,customer_id,conversation_id,group_jid,job_id,analysis_id,field_name,candidate_value_json,existing_value_json,applied_value_json,source_evidence,source_message_id,source_at,confidence,verification_status,conflict_reason,reviewed_by,reviewed_at,applied_at,idempotency_key,created_at,updated_at,correlation_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(id, accountId, customerId, wsText(body.conversationId, 160), wsText(body.groupJid, 180), jobId, wsText(body.analysisId, 160), candidate.fieldName, JSON.stringify(candidate.candidateValue), JSON.stringify(candidate.existingValue ?? customer[candidate.fieldName] ?? null), 'null', candidate.sourceEvidence, candidate.sourceMessageId, candidate.sourceAt, candidate.confidence, 'pending', '', '', '', '', key, now, now, correlationId); rows.push(connection.prepare('SELECT * FROM ai_crm_suggestions WHERE id=?').get(id)); } return { rows }; }); return json(res, 201, { ok: true, suggestions: result.rows.map(aiPipelineSuggestionPayload), productionFrozen: true }); }
          const suggestion = db.prepare('SELECT * FROM ai_crm_suggestions WHERE id=? AND account_id=?').get(suggestionId, accountId); if (!suggestion) return json(res, 404, { error: 'AI 候选不存在。' });
          if (action === 'reject' || action === 'conflict') { const result = stage4Write(body, action + ':' + suggestionId + ':' + now, action + ':' + suggestionId + ':' + now, connection => { const changed = connection.prepare("UPDATE ai_crm_suggestions SET verification_status=?,conflict_reason=?,reviewed_by=?,reviewed_at=?,updated_at=? WHERE id=? AND account_id=? AND verification_status='pending'").run(action === 'conflict' ? 'conflict' : 'rejected', wsText(body.reason || '人工审核', 500), wsText(body.actor || 'operator', 160), now, now, suggestionId, accountId); if (Number(changed.changes) === 1) stage4Audit(accountId, suggestion.job_id, 'suggestion.' + action, suggestion.verification_status, action === 'conflict' ? 'conflict' : 'rejected', body.actor, body.reason || '人工审核', { suggestionId }, suggestion.correlation_id); return { row: connection.prepare('SELECT * FROM ai_crm_suggestions WHERE id=? AND account_id=?').get(suggestionId, accountId) }; }); return json(res, 200, { ok: true, suggestion: aiPipelineSuggestionPayload(result.row), productionFrozen: true }); }
          if (action === 'approve') { const versionFailure = stateVersionFailure(req); if (versionFailure) return json(res, versionFailure.status, versionFailure.body); const expectedVersion = req.headers['x-state-version']; const result = stage4Write(body, 'approve:' + suggestionId + ':' + now, 'approve:' + suggestionId + ':' + now, connection => { if (!stage4StateVersionMatches(expectedVersion)) { const error = new Error('共享客户资料已更新，请刷新后重新审核。'); error.status = 409; error.code = 'CRM_STATE_STALE'; throw error; } const row = connection.prepare('SELECT * FROM ai_crm_suggestions WHERE id=? AND account_id=?').get(suggestionId, accountId); if (!row || row.verification_status !== 'pending') return { applied: false, row }; const state = governanceState(), customer = stage4CustomerFromState(row.customer_id, state), decision = aiCrmSuggestions.approve(customer, { customerId: row.customer_id, fieldName: row.field_name, candidateValue: wsJson(row.candidate_value_json, null), existingValue: wsJson(row.existing_value_json, null), sourceEvidence: row.source_evidence, confidence: row.confidence }); if (!decision.applied) { connection.prepare("UPDATE ai_crm_suggestions SET verification_status='conflict',conflict_reason=?,reviewed_by=?,reviewed_at=?,updated_at=? WHERE id=? AND account_id=?").run(decision.suggestion.conflictReason, wsText(body.actor || 'operator', 160), now, now, suggestionId, accountId); stage4Audit(accountId, row.job_id, 'suggestion.conflict', 'pending', 'conflict', body.actor, decision.suggestion.conflictReason, { suggestionId, customerId: row.customer_id, fieldName: row.field_name }, row.correlation_id); return { applied: false, row: connection.prepare('SELECT * FROM ai_crm_suggestions WHERE id=? AND account_id=?').get(suggestionId, accountId) }; } const before = JSON.parse(JSON.stringify(customer)); const customerIndex = state.customers.findIndex(item => String(item?.id || '') === String(row.customer_id || '')); if (customerIndex < 0) { const error = new Error('客户主档在审核事务中已不存在。'); error.status = 409; error.code = 'CRM_CUSTOMER_REQUIRED'; throw error; } state.customers[customerIndex] = decision.customer; writeState(state, false); connection.prepare('INSERT OR IGNORE INTO ai_customer_field_evidence(id,customer_id,conversation_id,analysis_id,field_name,value_json,confidence,source_text,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(wsCreateId('aie'), row.customer_id, row.conversation_id || '', row.analysis_id || suggestionId, row.field_name, row.candidate_value_json, Number(row.confidence || 0), row.source_evidence, 'accepted', now, now); recordGovernanceAction('update', row.customer_id, before, decision.customer, { source: 'AI审核中心', reason: '人工批准 AI 候选资料', confidence: row.confidence, analysisId: row.analysis_id || suggestionId }); connection.prepare("UPDATE ai_crm_suggestions SET verification_status='applied',applied_value_json=?,reviewed_by=?,reviewed_at=?,applied_at=?,updated_at=? WHERE id=? AND account_id=?").run(row.candidate_value_json, wsText(body.actor || 'operator', 160), now, now, now, suggestionId, accountId); stage4Audit(accountId, row.job_id, 'suggestion.approve', 'pending', 'applied', body.actor, '人工批准 AI 候选资料', { suggestionId, customerId: row.customer_id, fieldName: row.field_name }, row.correlation_id); return { applied: true, customer: decision.customer, row: connection.prepare('SELECT * FROM ai_crm_suggestions WHERE id=? AND account_id=?').get(suggestionId, accountId) }; }); return json(res, 200, { ok: true, applied: result.applied, customer: result.customer || null, suggestion: aiPipelineSuggestionPayload(result.row), revision: readStateEnvelope().version, productionFrozen: true }); }
          return json(res, 400, { error: '不支持的 CRM 候选操作。' });
        }
        if (segment === 'audit' && req.method === 'GET') { const jobId = wsText(url.searchParams.get('jobId'), 160); const rows = db.prepare('SELECT * FROM ai_task_audit WHERE account_id=?' + (jobId ? ' AND job_id=?' : '') + ' ORDER BY created_at DESC,id DESC LIMIT 200').all(...(jobId ? [accountId, jobId] : [accountId])); return json(res, 200, { audit: rows.map(aiPipelineAuditPayload), productionFrozen: true }); }
        return json(res, 404, { error: 'AI 隔离队列路径不存在。' });
      } catch (error) {
        if (error instanceof FencingError) return json(res, fencingErrorStatus(error), { error: error.message, code: error.code, scopeKey: error.scopeKey || '' });
        if (error?.code === 'AI_JOB_LEASE_STALE') return json(res, 409, { error: error.message, code: error.code });
        throw error;
      }
    }
    if (url.pathname === '/api/ws/ai-jobs') {
      const body = req.method === 'POST' ? JSON.parse((await readBody(req, 256 * 1024)).toString('utf8') || '{}') : {};
      const accountId = wsAccountId(body.accountId || url.searchParams.get('accountId'));
      wsRequireAccount(accountId);
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
      if (action === 'recover-expired') {
        // Explicit legacy-consumer maintenance, never a query side effect.
        // Worker/pipeline ownership remains with its fenced authority.
        const expiredAt = new Date(Date.now() - 10 * 60 * 1000).toISOString();
        const result = db.prepare("UPDATE ai_jobs SET status=CASE WHEN attempts>=max_attempts THEN 'failed' ELSE 'retryable' END,locked_at='',lease_token='',next_attempt_at=?,last_error='上次分析中断，已恢复队列',updated_at=? WHERE account_id=? AND status='running' AND worker_owner_id='' AND fencing_token=0 AND correlation_id='' AND (locked_at='' OR locked_at<?)").run(now, now, accountId, expiredAt);
        return json(res, 200, { recovered: Number(result.changes || 0), stats: aiJobStats(accountId), recoveryAuthority: 'legacy-consumer' });
      }
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
        db.prepare('INSERT INTO ai_jobs(id,account_id,conversation_id,idempotency_key,payload_json,status,attempts,max_attempts,next_attempt_at,locked_at,lease_token,last_error,analysis_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
          .run(id, accountId, conversationId, idempotencyKey, JSON.stringify(payload), 'queued', 0, maxAttempts, now, '', '', '', '', now, now);
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
        const leaseToken = randomBytes(32).toString('hex');
        const claimed = db.prepare("UPDATE ai_jobs SET status='running',attempts=?,locked_at=?,lease_token=?,updated_at=?,last_error='' WHERE id=? AND account_id=? AND status IN ('queued','retryable') AND (next_attempt_at='' OR next_attempt_at<=?)").run(attempts, now, leaseToken, now, jobId, accountId, now);
        const row = db.prepare('SELECT * FROM ai_jobs WHERE id=? AND account_id=?').get(jobId, accountId);
        const didClaim = Number(claimed?.changes || 0) > 0;
        return json(res, 200, { claimed: didClaim, job: aiJobPayload(row, { revealLease: didClaim }), stats: aiJobStats(accountId) });
      }
      if (action === 'checkpoint') {
        requireAiJobLease(existing, body.leaseToken);
        const completedChunks = Math.max(0, Math.floor(Number(body.completedChunks) || 0));
        const chunkCount = Math.max(1, Math.floor(Number(body.chunkCount) || 1));
        const payload = { ...wsJson(existing.payload_json, {}), checkpoint: { completedChunks, chunkCount, result: wsObject(body.result, 128 * 1024) } };
        const updated = db.prepare("UPDATE ai_jobs SET payload_json=?,locked_at=?,updated_at=? WHERE id=? AND account_id=? AND status='running' AND lease_token=?").run(JSON.stringify(payload), now, now, jobId, accountId, body.leaseToken);
        if (Number(updated?.changes || 0) !== 1) requireAiJobLease(db.prepare('SELECT * FROM ai_jobs WHERE id=? AND account_id=?').get(jobId, accountId), body.leaseToken);
        return json(res, 200, { ok: true, job: aiJobPayload(db.prepare('SELECT * FROM ai_jobs WHERE id=? AND account_id=?').get(jobId, accountId)) });
      }
      if (action === 'complete') {
        requireAiJobLease(existing, body.leaseToken);
        const analysisId = wsText(body.analysisId, 160);
        const completed = db.prepare("UPDATE ai_jobs SET status='completed',locked_at='',lease_token='',analysis_id=?,next_attempt_at='',last_error='',updated_at=? WHERE id=? AND account_id=? AND status='running' AND lease_token=?").run(analysisId, now, jobId, accountId, body.leaseToken);
        if (Number(completed?.changes || 0) !== 1) requireAiJobLease(db.prepare('SELECT * FROM ai_jobs WHERE id=? AND account_id=?').get(jobId, accountId), body.leaseToken);
        const row = db.prepare('SELECT * FROM ai_jobs WHERE id=? AND account_id=?').get(jobId, accountId);
        return json(res, 200, { completed: true, job: aiJobPayload(row), stats: aiJobStats(accountId) });
      }
      if (action === 'fail') {
        requireAiJobLease(existing, body.leaseToken);
        const retryable = body.retryable !== false;
        const attempts = Number(existing.attempts || 0);
        const maxAttempts = Number(existing.max_attempts || 5);
        const shouldRetry = retryable && attempts < maxAttempts;
        const nextAttemptAt = shouldRetry ? new Date(Date.now() + aiJobBackoff(attempts)).toISOString() : '';
        const nextStatus = shouldRetry ? 'retryable' : 'failed';
        const failed = db.prepare("UPDATE ai_jobs SET status=?,locked_at='',lease_token='',next_attempt_at=?,last_error=?,updated_at=? WHERE id=? AND account_id=? AND status='running' AND lease_token=?").run(nextStatus, nextAttemptAt, wsText(body.error || 'AI 分析失败', 1000), now, jobId, accountId, body.leaseToken);
        if (Number(failed?.changes || 0) !== 1) requireAiJobLease(db.prepare('SELECT * FROM ai_jobs WHERE id=? AND account_id=?').get(jobId, accountId), body.leaseToken);
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
        if (linkedJob) requireAiJobLease(linkedJob, body.leaseToken);
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
          if (linkedJob) {
            const linkedUpdate = db.prepare("UPDATE ai_jobs SET status='completed',locked_at='',lease_token='',next_attempt_at='',last_error='',analysis_id=?,updated_at=? WHERE id=? AND account_id=? AND status='running' AND lease_token=?").run(id, now, jobId, accountId, body.leaseToken);
            if (Number(linkedUpdate?.changes || 0) !== 1) requireAiJobLease(db.prepare('SELECT * FROM ai_jobs WHERE id=? AND account_id=?').get(jobId, accountId), body.leaseToken);
          }
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
      const confidenceThreshold = Number(customerGovernance.AUTO_SYNC_CONFIDENCE_THRESHOLD || wsCrmSync.AUTO_SYNC_CONFIDENCE_THRESHOLD || 0.6);
      if (!Number.isFinite(confidence) || confidence < confidenceThreshold) {
        return json(res, 200, {
          ok: true, skipped: true, matched: false, created: false, status: 'awaiting-human', awaitingHuman: true,
          reason: `AI 综合置信度低于 ${confidenceThreshold}，已保留分析证据，等待人工确认。`, confidence,
          evidence: Array.isArray(analysis.evidence) ? analysis.evidence : analysis.profileFacts || {}, analysisId: analysisRow.id,
        });
      }
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
      if (match.kind === 'awaiting-restore' || customer?.deleted) {
        return json(res, 200, {
          ok: true, skipped: true, matched: false, created: false, status: 'awaiting-restore', awaitingRestore: true,
          softDeleted: true, customerId: customer?.id || '', customer, confidence, analysisId: analysisRow.id,
          reason: '匹配到已软删除客户档案，已保留 AI 分析证据；请先人工恢复客户后再同步。',
          evidence: Array.isArray(analysis.evidence) ? analysis.evidence : analysis.profileFacts || {},
        });
      }
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
      if (governanceMerge.conflicts?.length) {
        Object.keys(customer).forEach(key => delete customer[key]);
        Object.assign(customer, customerBefore);
        recordAiFieldEvidence(customer.id, governanceMerge.evidenceRows, governanceMerge.conflicts);
        return json(res, 200, {
          ok: true, skipped: true, matched: false, created: false, status: 'awaiting-human', awaitingHuman: true,
          conflict: true, conflicts: governanceMerge.conflicts, customer, confidence, analysisId: analysisRow.id,
          reason: 'AI 识别值与现有客户档案存在冲突，已保留证据，等待人工确认。',
        });
      }
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
    // Media is staged in the account-scoped local data root before a send
    // plan is created.  The native bridge receives only opaque media ids and
    // fetches bytes through this authenticated route, keeping a broadcast
    // request small and making retries idempotent.
    if (url.pathname === '/api/ws/media' && req.method === 'POST') {
      const body = JSON.parse((await readBody(req, WS_MEDIA_REQUEST_MAX_BYTES)).toString('utf8') || '{}');
      const accountId = wsAccountId(body.accountId);
      wsRequireAccount(accountId);
      const mimeType = wsMediaCore.normalizeMime(body.mimeType);
      if (!wsMediaCore.isAllowedMime(mimeType)) return json(res, 415, { error: '不支持的附件类型。请使用图片、视频、音频或常见文档格式。' });
      const fileName = wsMediaCore.sanitizeFileName(body.fileName, 'attachment');
      if (fileName.includes('..')) return json(res, 400, { error: '附件文件名无效。' });
      let bytes;
      try { bytes = wsMediaCore.decodeBase64(body.dataBase64, wsMediaCore.MAX_BYTES); }
      catch (error) { return json(res, 422, { error: error.message || '附件内容无效。' }); }
      const contentPolicy = wsMediaCore.validateContent(fileName, bytes);
      if (!contentPolicy.allowed) return json(res, 415, { error: contentPolicy.reason, code: 'MEDIA_EXECUTABLE_REJECTED' });
      const sha256 = createHash('sha256').update(bytes).digest('hex');
      const suppliedSha = wsText(body.sha256, 128).toLowerCase();
      if (suppliedSha && !/^[a-f0-9]{64}$/.test(suppliedSha)) return json(res, 422, { error: '附件 SHA-256 格式无效。' });
      if (suppliedSha && suppliedSha !== sha256) return json(res, 422, { error: '附件 SHA-256 校验失败。' });
      const existing = db.prepare('SELECT * FROM ws_media_assets WHERE account_id=? AND sha256=? AND status=? LIMIT 1').get(accountId, sha256, 'ready');
      if (existing) { const mediaPayload = wsMediaPayload(existing); return json(res, 200, { existed: true, media: mediaPayload, ...mediaPayload }); }
      const now = new Date().toISOString();
      const id = wsCreateId('wsm');
      const relativePath = join('ws-media', wsAccountId(accountId).replace(/[^A-Za-z0-9._:-]/g, '_').slice(0, 120) || 'default', id);
      const absolutePath = resolve(dataDir, relativePath);
      mkdirSync(dirname(absolutePath), { recursive: true });
      try {
        writeFileSync(absolutePath, bytes, { flag: 'wx', mode: 0o600 });
        db.prepare(`INSERT INTO ws_media_assets
          (id,account_id,conversation_id,message_id,media_type,file_name,mime_type,size_bytes,sha256,storage_path,status,unavailable_reason,created_at,updated_at)
          VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
          .run(id, accountId, wsText(body.conversationId, 160), wsText(body.messageId, 160), wsMediaCore.mediaTypeForMime(mimeType), fileName, mimeType, bytes.length, sha256, relativePath, 'ready', '', now, now);
      } catch (error) {
        rmSync(absolutePath, { force: true });
        if (String(error?.code || '') === 'SQLITE_CONSTRAINT_UNIQUE') {
          const duplicate = db.prepare('SELECT * FROM ws_media_assets WHERE account_id=? AND sha256=? AND status=? LIMIT 1').get(accountId, sha256, 'ready');
          if (duplicate) { const mediaPayload = wsMediaPayload(duplicate); return json(res, 200, { existed: true, media: mediaPayload, ...mediaPayload }); }
        }
        throw error;
      }
      const row = db.prepare('SELECT * FROM ws_media_assets WHERE id=? AND account_id=?').get(id, accountId);
      const mediaPayload = wsMediaPayload(row);
      return json(res, 201, { existed: false, media: mediaPayload, ...mediaPayload });
    }
    const mediaMatch = url.pathname.match(/^\/api\/ws\/media\/([^/]+)$/);
    if (mediaMatch) {
      const mediaId = decodeURIComponent(mediaMatch[1]);
      const accountId = wsAccountId(url.searchParams.get('accountId'));
      if (!url.searchParams.get('accountId')) return json(res, 400, { error: '媒体请求必须提供 accountId。' });
      if (!wsAccountRow(accountId)) return json(res, 404, { error: 'WS 账号不存在。' });
      const media = db.prepare('SELECT * FROM ws_media_assets WHERE id=? AND account_id=?').get(mediaId, accountId);
      if (!media) return json(res, 404, { error: '媒体不存在或不属于当前账号。' });
      if (req.method === 'GET' || req.method === 'HEAD') {
        if (media.status !== 'ready') return json(res, 410, { error: media.unavailable_reason || '媒体已不可用。' });
        const absolutePath = wsMediaStoragePath(media);
        if (!absolutePath || !existsSync(absolutePath)) return json(res, 410, { error: '媒体文件已丢失。' });
        const size = statSync(absolutePath).size;
        res.writeHead(200, {
          'Content-Type': media.mime_type || 'application/octet-stream',
          'Content-Length': size,
          'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(media.file_name || 'attachment')}`,
          'X-Content-Type-Options': 'nosniff',
          'Cache-Control': 'private, no-store',
        });
        if (req.method === 'HEAD') { res.end(); return; }
        createReadStream(absolutePath).on('error', () => { try { res.destroy(); } catch {} }).pipe(res);
        return;
      }
      if (req.method === 'DELETE') {
        // Keep every historical attachment reference, including failed/cancelled.
        // A durable tombstone precedes byte cleanup; failure/crash is retried
        // only by another explicit DELETE, never by an implicit background job.
        db.exec('BEGIN IMMEDIATE');
        try {
          const references = db.prepare('SELECT id FROM ws_send_attachments WHERE account_id=? AND media_id=? LIMIT 1').all(accountId, mediaId);
          const legacyReference = db.prepare("SELECT id FROM ws_send_audit WHERE account_id=? AND EXISTS(SELECT 1 FROM json_each(CASE WHEN json_valid(attachment_ids_json) THEN attachment_ids_json ELSE '[]' END) WHERE value=?) LIMIT 1").get(accountId, mediaId);
          if (references.length || legacyReference) { db.exec('ROLLBACK'); return json(res, 409, { error: '该媒体已进入发送审计，不能删除。', code: 'MEDIA_REFERENCED', references: references.map(item => item.id).concat(legacyReference ? [legacyReference.id] : []) }); }
          const data = wsJson(media.data_json, {});
          data.deletion = { ...(data.deletion || {}), requestedAt: data.deletion?.requestedAt || new Date().toISOString(), cleanupPending: true };
          db.prepare("UPDATE ws_media_assets SET status='deleted',unavailable_reason='媒体已删除，文件清理待完成。',data_json=?,updated_at=? WHERE id=? AND account_id=?").run(JSON.stringify(data), new Date().toISOString(), mediaId, accountId);
          db.exec('COMMIT');
        } catch (error) { db.exec('ROLLBACK'); throw error; }
        const absolutePath = wsMediaStoragePath(media);
        try {
          if (absolutePath) rmSync(absolutePath, { force: true });
          const data = wsJson(db.prepare('SELECT data_json FROM ws_media_assets WHERE id=? AND account_id=?').get(mediaId, accountId)?.data_json, {});
          data.deletion = { ...data.deletion, cleanupPending: false, completedAt: new Date().toISOString() };
          db.prepare("UPDATE ws_media_assets SET unavailable_reason='媒体已删除。',data_json=?,updated_at=? WHERE id=? AND account_id=?").run(JSON.stringify(data), new Date().toISOString(), mediaId, accountId);
          return json(res, 200, { ok: true, mediaId, status: 'deleted', cleanupPending: false });
        } catch {
          return json(res, 202, { ok: true, mediaId, status: 'deleted', cleanupPending: true, code: 'MEDIA_CLEANUP_PENDING', message: '已停用媒体；文件清理未完成，可明确重试删除。' });
        }
      }
      return json(res, 405, { error: '媒体只支持 GET/HEAD/DELETE。' });
    }
    // Explicit, account-scoped send planning.  The sidecar never touches WS
    // credentials or a remote socket: it creates a durable plan which the
    // native WebView bridge must acknowledge after the operator confirms the
    // visible composer/send action.
    if (url.pathname === '/api/ws/broadcast' && req.method === 'POST') {
      const body = JSON.parse((await readBody(req, WS_MEDIA_REQUEST_MAX_BYTES)).toString('utf8') || '{}');
      const accountId = wsAccountId(body.accountId);
      if (!wsAccountRow(accountId)) return json(res, 404, { error: 'WS 账号不存在。' });
      if (body.confirm !== true) return json(res, 400, { error: '群发必须由用户明确确认后才能创建发送计划。' });
      const idempotencyKey = wsText(body.idempotencyKey, 160);
      if (!idempotencyKey) return json(res, 400, { error: '群发缺少幂等键，请勿重复点击发送。' });
      if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(idempotencyKey)) return json(res, 400, { error: '群发幂等键格式无效。' });
      const rawIds = Array.isArray(body.conversationIds)
        ? body.conversationIds
        : (Array.isArray(body.recipients) ? body.recipients.map(item => item?.conversationId || item?.id || item) : []);
      const conversationIds = [...new Set(rawIds.map(item => wsText(item, 160)).filter(Boolean))];
      if (!conversationIds.length) return json(res, 400, { error: '至少选择一个一对一会话。' });
      if (conversationIds.length > WS_BROADCAST_MAX_RECIPIENTS) return json(res, 413, { error: `单次最多选择 ${WS_BROADCAST_MAX_RECIPIENTS} 个会话。` });
      const attachmentRefs = wsMediaCore.normalizeAttachmentRefs(body.attachments);
      if (Array.isArray(body.attachments) && body.attachments.length > wsMediaCore.MAX_ATTACHMENTS) return json(res, 413, { error: `单次最多发送 ${wsMediaCore.MAX_ATTACHMENTS} 个附件。` });
      const mediaRows = [];
      let mediaBytes = 0;
      for (const reference of attachmentRefs) {
        const media = db.prepare('SELECT * FROM ws_media_assets WHERE id=? AND account_id=?').get(reference.mediaId, accountId);
        if (!media) return json(res, 404, { error: '附件不存在或不属于当前 WS 账号。', mediaId: reference.mediaId });
        if (media.status !== 'ready') return json(res, 409, { error: media.unavailable_reason || '附件当前不可用。', mediaId: reference.mediaId });
        const absolutePath = wsMediaStoragePath(media);
        if (!absolutePath || !existsSync(absolutePath)) return json(res, 410, { error: '附件文件已丢失，请重新上传。', mediaId: reference.mediaId });
        mediaBytes += Number(media.size_bytes || 0);
        if (mediaBytes > wsMediaCore.MAX_TOTAL_BYTES) return json(res, 413, { error: '单次发送附件总大小超过限制。' });
        mediaRows.push({ ...media, reference });
      }
      const caption = wsMessageText(Object.hasOwn(body, 'caption') ? body.caption : body.originalText);
      const originalText = wsMessageText(Object.hasOwn(body, 'originalText') ? body.originalText : body.caption);
      if (!originalText.trim() && !caption.trim() && !mediaRows.length) return json(res, 400, { error: '发送内容不能为空。' });
      if (wsMessageTextTooLong(originalText)) return json(res, 413, { error: `发送原文超过 ${WS_MESSAGE_MAX_CHARS} 字符。` });
      const translatedText = wsMessageText(Object.hasOwn(body, 'translatedText') ? body.translatedText : originalText);
      if (wsMessageTextTooLong(translatedText)) return json(res, 413, { error: `发送译文超过 ${WS_MESSAGE_MAX_CHARS} 字符。` });
      const payloadKind = wsMediaCore.normalizePayloadKind(body.payloadKind, mediaRows.map(item => item.media_type || wsMediaCore.mediaTypeForMime(item.mime_type)));
      const attachmentIds = mediaRows.map(item => item.id);
      const targetLanguage = wsText(body.targetLanguage, 40);
      const effectiveAttachments = mediaRows.map((media, index) => ({ mediaId: media.id, orderNo: Number(media.reference.orderNo ?? index), caption: media.reference.caption || caption }));
      const fingerprint = wsSendPlanFingerprint({ accountId, conversationIds, originalText, translatedText, targetLanguage, payloadKind, caption, attachments: effectiveAttachments });
      const keyPrefix = 'plan:' + createHash('sha256').update(idempotencyKey).digest('hex') + ':';
      const legacyPrefix = idempotencyKey + ':';
      const previous = db.prepare('SELECT DISTINCT batch_id FROM ws_send_audit WHERE account_id=? AND (idempotency_key=? OR substr(idempotency_key,1,?)=? OR substr(idempotency_key,1,?)=?) LIMIT 2').all(accountId, idempotencyKey, keyPrefix.length, keyPrefix, legacyPrefix.length, legacyPrefix);
      if (previous.length) {
        const rows = db.prepare('SELECT * FROM ws_send_audit WHERE account_id=? AND batch_id=? ORDER BY created_at ASC,id ASC').all(accountId, previous[0].batch_id);
        const ids = rows.map(row => row.conversation_id);
        const matches = previous.length === 1 && rows.length === conversationIds.length && rows.every(row => {
          const attachments = db.prepare('SELECT media_id AS mediaId,order_no AS orderNo,caption FROM ws_send_attachments WHERE account_id=? AND send_audit_id=? ORDER BY order_no,id').all(accountId, row.id);
          return wsSendPlanFingerprint({ accountId, conversationIds: ids, originalText: row.original_text, translatedText: row.translated_text, targetLanguage: row.target_language, payloadKind: row.payload_kind, caption: row.caption, attachments }) === fingerprint;
        });
        if (!matches) return json(res, 409, { error: '同一幂等键对应不同发送内容；未恢复或改写旧计划。', code: 'IDEMPOTENCY_CONTENT_CONFLICT' });
        return json(res, 200, { existed: true, dispatch: { batchId: previous[0].batch_id, accountId, operation: rows.length > 1 ? 'broadcast' : 'single', requiresNativeBridge: true, items: rows.map(wsSendAuditPayload) } });
      }
      const conversations = [];
      for (const conversationId of conversationIds) {
        const checked = wsSendConversationRow(conversationId, accountId);
        if (!checked.row) return json(res, checked.status, { error: checked.error, conversationId });
        conversations.push(checked.row);
      }
      const now = new Date().toISOString();
      const batchId = wsCreateId('wsbcast');
      const operation = conversations.length > 1 ? 'broadcast' : 'single';
      db.exec('BEGIN IMMEDIATE');
      try {
        for (const conversation of conversations) {
          const itemKey = keyPrefix + createHash('sha256').update(conversation.id).digest('hex');
          db.prepare(`INSERT INTO ws_send_audit
            (id,account_id,conversation_id,batch_id,operation,idempotency_key,original_text,translated_text,target_language,status,error_message,native_result_json,payload_kind,caption,attachment_ids_json,created_at,updated_at)
            VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
              .run(wsCreateId('wsa'), accountId, conversation.id, batchId, operation, itemKey, originalText, translatedText, targetLanguage, 'queued', '', JSON.stringify({ planFingerprint: fingerprint }), payloadKind, caption, JSON.stringify(attachmentIds), now, now);
          const auditId = db.prepare('SELECT id FROM ws_send_audit WHERE account_id=? AND idempotency_key=?').get(accountId, itemKey)?.id;
          if (auditId && mediaRows.length) {
            const insertAttachment = db.prepare(`INSERT INTO ws_send_attachments
              (id,account_id,send_audit_id,media_id,order_no,caption,status,error_message,created_at,updated_at)
              VALUES(?,?,?,?,?,?,?,?,?,?)`);
            mediaRows.forEach((media, index) => insertAttachment.run(wsCreateId('wsa'), accountId, auditId, media.id, Number(media.reference.orderNo ?? index), media.reference.caption || caption, 'queued', '', now, now));
          }
        }
        db.exec('COMMIT');
      } catch (error) { db.exec('ROLLBACK'); throw error; }
      const rows = db.prepare('SELECT * FROM ws_send_audit WHERE account_id=? AND batch_id=? ORDER BY created_at ASC,id ASC').all(accountId, batchId);
      return json(res, 201, { existed: false, dispatch: { batchId, accountId, operation, requiresNativeBridge: true, rateLimit: { appliesTo: 'begin-attempt', localPolicyLimit: WS_SEND_RATE_LIMIT, windowMs: WS_SEND_RATE_WINDOW_MS }, items: rows.map(wsSendAuditPayload) } });
    }
    if (url.pathname === '/api/ws/send' && req.method === 'POST') {
      const body = JSON.parse((await readBody(req, 512 * 1024)).toString('utf8') || '{}');
      const accountId = wsAccountId(body.accountId);
      if (!body.accountId) return json(res, 400, { error: '发送操作必须明确提供 accountId。', code: 'SEND_ACCOUNT_REQUIRED' });
      if (!wsAccountRow(accountId)) return json(res, 404, { error: 'WS 账号不存在。' });
      const auditId = wsText(body.auditId || body.id, 160);
      if (!auditId) return json(res, 400, { error: '发送确认缺少审计编号。' });
      const now = new Date().toISOString();
      let transactionOpen = false;
      const reject = (status, code, message) => { const error = new Error(message); error.httpStatus = status; error.sendCode = code; throw error; };
      try {
        db.exec('BEGIN IMMEDIATE'); transactionOpen = true;
        const existing = db.prepare('SELECT * FROM ws_send_audit WHERE id=? AND account_id=?').get(auditId, accountId);
        if (!existing) reject(404, 'SEND_PLAN_NOT_FOUND', '发送计划不存在或不属于当前账号。');
        const metadata = wsJson(existing.native_result_json, {});
        let attempt = metadata.sendAttempt || {};
        const attachments = db.prepare('SELECT * FROM ws_send_attachments WHERE account_id=? AND send_audit_id=? ORDER BY order_no,id').all(accountId, auditId);
        if (body.action === 'begin-attempt') {
          const allowed = existing.status === 'queued' && !attempt.id || existing.status === 'failed' && attempt.deliveryState === 'failed' && attempt.safeToRetry === true;
          if (!allowed) reject(409, 'SEND_RETRY_BLOCKED', '已有发送尝试或结果待核实；禁止重复授权或盲目重试。');
          const checked = wsSendConversationRow(existing.conversation_id, accountId);
          if (!checked.row) reject(checked.status, 'SEND_TARGET_INVALID', checked.error);
          const amount = Math.max(1, attachments.length), rateNow = Date.now(), rate = wsSendRateCheck(accountId, amount, rateNow, false);
          if (!rate.allowed) { db.exec('ROLLBACK'); transactionOpen = false; return json(res, 429, { error: '本机发送尝试限流，请稍后再试。', code: 'SEND_RATE_LIMITED', retryAfterMs: rate.retryAfterMs, remaining: rate.remaining || 0 }); }
          attempt = { id: randomUUID(), phase: 'prepared', deliveryState: 'unknown', safeToRetry: false, observedUnknown: false, createdAt: now, updatedAt: now };
          metadata.sendAttempt = attempt;
          db.prepare("UPDATE ws_send_audit SET status='sending',error_message='',native_result_json=?,updated_at=? WHERE id=? AND account_id=?").run(JSON.stringify(metadata), now, auditId, accountId);
          for (const attachment of attachments) {
            const data = wsJson(attachment.data_json, {}); data.sendAttempt = { id: attempt.id, deliveryState: 'unknown', phase: 'prepared' };
            db.prepare("UPDATE ws_send_attachments SET status='queued',error_message='',data_json=?,updated_at=? WHERE id=? AND account_id=?").run(JSON.stringify(data), now, attachment.id, accountId);
          }
          db.exec('COMMIT'); transactionOpen = false;
          wsSendRateCheck(accountId, amount, rateNow);
          return json(res, 200, { attemptId: attempt.id, audit: wsSendAuditPayload(db.prepare('SELECT * FROM ws_send_audit WHERE id=? AND account_id=?').get(auditId, accountId)), rateLimit: { remaining: rate.remaining, appliesTo: 'begin-attempt', messageAttempts: amount } });
        }
        let deliveryState = wsText(body.deliveryState, 32), phase = wsText(body.phase, 24) || 'progress';
        if (phase === 'in-progress') phase = 'progress';
        const status = wsText(body.status, 24).toLowerCase(), nativeResult = body.nativeResult && typeof body.nativeResult === 'object' && !Array.isArray(body.nativeResult) ? wsObject(body.nativeResult, 16 * 1024) : {};
        if (['platform_accepted', 'delivered'].includes(deliveryState)) reject(422, 'PLATFORM_RECEIPT_UNVERIFIED', '本轮没有可信平台回执来源，不能升级为平台接受或送达。');
        let legacyAcknowledgement = false;
        if (!attempt.id) {
          // A legacy boolean alone proves neither a local action nor platform
          // acceptance. Keep the historical status but expose unknown outcome.
          if (status === 'sent' && body.nativeConfirmed === true) { deliveryState = nativeResult.ok === true && nativeResult.deliveryState === 'local_attempted' && nativeResult.dispatchAttempted === true ? 'local_attempted' : 'unknown'; phase = 'completed'; legacyAcknowledgement = true; }
          else if (status === 'failed' || status === 'cancelled') { deliveryState = 'unknown'; phase = 'completed'; legacyAcknowledgement = true; }
          else reject(409, 'SEND_ATTEMPT_REQUIRED', '请先取得发送尝试授权。');
          attempt = { id: randomUUID(), createdAt: now, safeToRetry: false, legacyAcknowledgement: true };
        } else if (!body.attemptId || body.attemptId !== attempt.id) reject(409, 'SEND_ATTEMPT_STALE', '发送尝试编号无效或已过期。');
        if (!['local_attempted', 'unknown', 'failed'].includes(deliveryState) || !['sending', 'sent', 'failed', 'cancelled'].includes(status)) reject(400, 'SEND_OUTCOME_INVALID', '发送结果状态无效。');
        if (deliveryState === 'local_attempted' && !legacyAcknowledgement && attempt.deliveryState !== 'local_attempted' && !(nativeResult.ok === true && nativeResult.deliveryState === 'local_attempted' && nativeResult.dispatchAttempted === true)) reject(422, 'LOCAL_ATTEMPT_EVIDENCE_REQUIRED', '缺少明确的本地发送动作确认，不能推定已尝试。');
        if (!['progress', 'completed', 'failed'].includes(phase)) reject(400, 'SEND_PHASE_INVALID', '发送结果阶段无效。');
        if (['completed', 'failed'].includes(attempt.phase)) {
          if (phase === attempt.phase && deliveryState === attempt.deliveryState && !body.attachmentId) { db.exec('ROLLBACK'); transactionOpen = false; return json(res, 200, { existed: true, audit: wsSendAuditPayload(existing) }); }
          reject(409, 'SEND_ATTEMPT_FINALIZED', '发送尝试已经结束；迟到结果不能覆盖已记录的结果。');
        }
        const priorStates = attachments.map(row => wsJson(row.data_json, {}).sendAttempt?.deliveryState || 'unknown');
        const hasAttempted = attempt.deliveryState === 'local_attempted' || priorStates.includes('local_attempted');
        const provenPreflightFailure = nativeResult.ok === false && nativeResult.deliveryState === 'failed' && nativeResult.dispatchAttempted === false && (nativeResult.notAttempted === true || nativeResult.phase === 'preflight');
        if (deliveryState === 'failed' && !provenPreflightFailure) reject(409, 'SEND_FAILURE_UNCERTAIN', '无法证明未发生发送动作；必须保留待核实结果，不能标记为可重试失败。');
        const attachmentId = wsText(body.attachmentId, 160);
        if (attachmentId) {
          const attachment = attachments.find(row => row.id === attachmentId);
          if (!attachment) reject(404, 'SEND_ATTACHMENT_NOT_FOUND', '附件不属于当前账号与发送尝试。');
          const data = wsJson(attachment.data_json, {}), oldState = data.sendAttempt?.deliveryState;
          if (oldState === 'local_attempted' && deliveryState !== 'local_attempted') reject(409, 'SEND_OUTCOME_REGRESSION', '已记录本地发送动作的附件不能降为未尝试。');
          data.sendAttempt = { id: attempt.id, deliveryState, phase: deliveryState === 'failed' ? 'failed' : 'completed', updatedAt: now };
          db.prepare('UPDATE ws_send_attachments SET status=?,error_message=?,data_json=?,updated_at=? WHERE id=? AND account_id=? AND send_audit_id=?').run(deliveryState === 'failed' ? 'failed' : 'sending', wsText(body.errorMessage || body.error, 1000), JSON.stringify(data), now, attachmentId, accountId, auditId);
          const states = attachments.map(row => row.id === attachmentId ? deliveryState : wsJson(row.data_json, {}).sendAttempt?.deliveryState || 'unknown');
          deliveryState = states.every(value => value === 'local_attempted') ? 'local_attempted' : deliveryState === 'failed' && !states.includes('local_attempted') && !attempt.observedUnknown ? 'failed' : 'unknown';
        } else if (attachments.length && deliveryState === 'local_attempted' && !legacyAcknowledgement && !priorStates.every(value => value === 'local_attempted')) reject(409, 'SEND_ATTACHMENT_RESULTS_REQUIRED', '必须先逐附件记录本地结果，不能整体推定成功。');
        if (deliveryState === 'failed' && (hasAttempted || attempt.observedUnknown)) deliveryState = 'unknown';
        attempt = { ...attempt, phase, deliveryState, safeToRetry: deliveryState === 'failed' && provenPreflightFailure && !hasAttempted && !attempt.observedUnknown, observedUnknown: Boolean(attempt.observedUnknown || deliveryState === 'unknown' && phase !== 'prepared'), updatedAt: now };
        metadata.sendAttempt = attempt; metadata.lastNativeResult = nativeResult;
        const storedStatus = legacyAcknowledgement ? status : deliveryState === 'failed' ? 'failed' : 'sending';
        db.prepare('UPDATE ws_send_audit SET status=?,error_message=?,native_result_json=?,updated_at=? WHERE id=? AND account_id=?').run(storedStatus, wsText(body.errorMessage || body.error, 1000), JSON.stringify(metadata), now, auditId, accountId);
        let reply = null;
        if (deliveryState === 'local_attempted' && phase === 'completed') {
          const replyKey = 'ws-send:' + auditId;
          db.prepare('INSERT OR IGNORE INTO ws_replies(id,account_id,conversation_id,original_text,translated_text,status,created_at,updated_at,idempotency_key) VALUES(?,?,?,?,?,?,?,?,?)').run(wsCreateId('wsr'), accountId, existing.conversation_id, existing.original_text, existing.translated_text, 'confirmed', now, now, replyKey);
          reply = db.prepare('SELECT * FROM ws_replies WHERE account_id=? AND conversation_id=? AND idempotency_key=?').get(accountId, existing.conversation_id, replyKey);
        }
        db.exec('COMMIT'); transactionOpen = false;
        return json(res, 200, { existed: false, audit: wsSendAuditPayload(db.prepare('SELECT * FROM ws_send_audit WHERE id=? AND account_id=?').get(auditId, accountId)), reply: reply ? wsReplyPayload(reply) : null });
      } catch (error) {
        if (transactionOpen) db.exec('ROLLBACK');
        if (error.sendCode) return json(res, error.httpStatus, { error: error.message, code: error.sendCode });
        throw error;
      }
    }
    if (url.pathname === '/api/ws/send-audit' && req.method === 'GET') {
      const accountId = wsAccountId(url.searchParams.get('accountId'));
      if (!wsAccountRow(accountId)) return json(res, 404, { error: 'WS 账号不存在。' });
      const batchId = wsText(url.searchParams.get('batchId'), 160);
      const auditId = wsText(url.searchParams.get('id'), 160);
      const where = ['account_id=?'];
      const params = [accountId];
      if (batchId) { where.push('batch_id=?'); params.push(batchId); }
      if (auditId) { where.push('id=?'); params.push(auditId); }
      const limit = Math.min(200, Math.max(1, Number(url.searchParams.get('limit')) || 100));
      const rows = db.prepare(`SELECT * FROM ws_send_audit WHERE ${where.join(' AND ')} ORDER BY created_at ASC,id ASC LIMIT ${limit}`).all(...params);
      return json(res, 200, { accountId, batchId, items: rows.map(wsSendAuditPayload) });
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
        // A complete, sufficiently trusted newer analysis is authoritative
        // even when it decides that no reminder is needed. Claim that slot so
        // an older urgent task cannot resurface. Low-confidence or failed
        // results deliberately leave the slot open for the older evidence.
        const authoritativeCandidate = confidence >= Number(customerGovernance.AUTO_SYNC_CONFIDENCE_THRESHOLD || 0.6);
        const scopedAccountId = row.account_id;
        const task = taskByAnalysis.get(String(row.id))
          || (!alertVipGroup ? taskByConversation.get(String(row.conversation_id))?.find(item => String(item.wsAccountId || scopedAccountId) === scopedAccountId) : null);
        if (!task || !activeCustomerIds.has(String(task.customerId)) || (task.wsAnalysisId && task.wsAnalysisId !== row.id)) {
          if (authoritativeCandidate) seenConversations.add(seenKey);
          continue;
        }
        const strategy = result.followupStrategy && typeof result.followupStrategy === 'object' ? result.followupStrategy : {};
        const alertPlan = wsCrmSync.deriveFollowupPlan({ ...result, confidence }, { id: row.id }, { id: row.conversation_id, externalId: row.external_id }, row.account_id);
        if (!alertPlan.shouldCreate) {
          if (authoritativeCandidate) seenConversations.add(seenKey);
          continue;
        }
        const dueInput = task?.due || alertPlan.nextDate;
        if (!dueDateCache.has(dueInput)) dueDateCache.set(dueInput, wsCrmSync.normalizeDate(dueInput));
        const due = dueDateCache.get(dueInput);
        const priorityScore = alertPlan.priorityScore;
        const urgent = /高|紧急|urgent|hot/i.test(String(result.urgency || '')) || priorityScore >= 80;
        const overdue = Boolean(due && due < today);
        const dueToday = Boolean(due && due === today);
        const upcoming = Boolean(due && due > today && due <= upcomingLimit);
        if (!urgent && !overdue && !dueToday && !upcoming) continue;
        // Only a complete, identity-bound and actionable candidate claims the
        // conversation/member slot. Failed, low-confidence, stale, or
        // non-actionable analyses must not hide an older valid reminder.
        seenConversations.add(seenKey);
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
    if (req.method === 'GET' && url.pathname === '/api/data-archive/customer') {
      const accountId = wsAccountId(url.searchParams.get('accountId'));
      wsRequireAccount(accountId);
      const conversationId = wsText(url.searchParams.get('conversationId'), 160);
      const requestedCustomerId = wsText(url.searchParams.get('customerId'), 128);
      let conversation = null;
      if (conversationId) {
        conversation = wsConversationRow(conversationId, accountId);
        if (!conversation) {
          const crossAccount = db.prepare('SELECT account_id FROM ws_conversations WHERE id=? LIMIT 1').get(conversationId);
          if (crossAccount) return json(res, 403, { error: 'WS 会话不属于当前账号。' });
          return json(res, 404, { error: 'WS 会话不存在或已被清理。' });
        }
      } else if (requestedCustomerId) {
        conversation = db.prepare('SELECT * FROM ws_conversations WHERE account_id=? AND customer_id=? ORDER BY updated_at DESC,id DESC LIMIT 1').get(accountId, requestedCustomerId) || null;
      }
      const state = governanceState();
      const match = dataArchiveResolveCustomer(state, accountId, conversation, requestedCustomerId);
      if (match.kind === 'missing') return json(res, 404, { error: '客户档案不存在。' });
      if (match.kind === 'conflict') return json(res, 409, { error: '会话与客户档案不匹配，已拒绝跨档案读取。' });
      if (match.customer && !dataArchiveCustomerAllowed(match.customer, accountId, conversation)) return json(res, 403, { error: '客户档案未关联当前 WS 账号。' });
      const messagesOffset = Math.max(0, Math.min(10_000_000, Number(url.searchParams.get('messagesOffset')) || 0));
      const messagesLimit = Math.max(1, Math.min(2000, Number(url.searchParams.get('messagesLimit')) || 1000));
      return json(res, 200, dataArchivePayload(accountId, conversation, match.customer, match, state, { messagesOffset, messagesLimit }));
    }
    if (url.pathname === '/api/ws/export-jobs') {
      if (req.method === 'GET') {
        const requestedAccountId = wsText(url.searchParams.get('accountId'), 120);
        if (requestedAccountId) wsRequireAccount(requestedAccountId);
        const rows = requestedAccountId
          ? db.prepare('SELECT * FROM ws_export_jobs WHERE account_id=? ORDER BY created_at DESC,id DESC LIMIT 100').all(requestedAccountId)
          : db.prepare('SELECT * FROM ws_export_jobs ORDER BY created_at DESC,id DESC LIMIT 100').all();
        return json(res, 200, { jobs: rows.map(wsExportJobPayload) });
      }
      if (req.method === 'POST') {
        const body = JSON.parse((await readBody(req, 128 * 1024)).toString('utf8') || '{}');
        const allAccounts = body.allAccounts === true || body.scope === 'all';
        const accountId = wsAccountId(body.accountId);
        if (!allAccounts) wsRequireAccount(accountId);
        const accountIds = wsExportAccountIds(allAccounts ? { allAccounts: true } : { accountId });
        const now = new Date().toISOString();
        const id = wsCreateId('wse');
        const scope = allAccounts ? 'all' : 'account';
        const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
        const total = wsExportJobEstimate(accountIds);
        db.prepare(`INSERT INTO ws_export_jobs(id,scope,account_id,status,progress_total,progress_done,cursor_json,output_path,output_sha256,error_message,created_at,updated_at,expires_at)
          VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(id, scope, allAccounts ? '' : accountId, 'queued', total, 0, JSON.stringify({ accountIds }), '', '', '', now, now, expiresAt);
        setImmediate(() => { runWsExportJob(id).catch(() => {}); });
        return json(res, 201, { job: wsExportJobPayload(db.prepare('SELECT * FROM ws_export_jobs WHERE id=?').get(id)) });
      }
      return json(res, 405, { error: '导出任务只支持 GET/POST。' });
    }
    const exportJobMatch = url.pathname.match(/^\/api\/ws\/export-jobs\/([^/]+)(?:\/(download))?$/);
    if (exportJobMatch) {
      const jobId = decodeURIComponent(exportJobMatch[1]);
      const row = db.prepare('SELECT * FROM ws_export_jobs WHERE id=?').get(jobId);
      if (!row) return json(res, 404, { error: '导出任务不存在。' });
      if (exportJobMatch[2] === 'download') {
        if (req.method !== 'GET' && req.method !== 'HEAD') return json(res, 405, { error: '导出文件只支持 GET/HEAD。' });
        if (row.status !== 'completed') return json(res, 409, { error: '导出尚未完成。', job: wsExportJobPayload(row) });
        const absolute = wsExportJobPath(row);
        if (!absolute || !existsSync(absolute)) return json(res, 410, { error: '导出文件已过期或不存在。' });
        const size = statSync(absolute).size;
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': size, 'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(`zhike-ws-export-${jobId}.json`)}`, 'Cache-Control': 'private, no-store' });
        if (req.method === 'HEAD') { res.end(); return; }
        createReadStream(absolute).on('error', () => { try { res.destroy(); } catch {} }).pipe(res);
        return;
      }
      if (req.method === 'GET') return json(res, 200, { job: wsExportJobPayload(row) });
      if (req.method === 'DELETE' || req.method === 'POST') {
        const now = new Date().toISOString();
        if (row.status === 'queued' || row.status === 'running') db.prepare("UPDATE ws_export_jobs SET status='cancelled',error_message='已取消',updated_at=? WHERE id=?").run(now, jobId);
        return json(res, 200, { job: wsExportJobPayload(db.prepare('SELECT * FROM ws_export_jobs WHERE id=?').get(jobId)) });
      }
      return json(res, 405, { error: '导出任务只支持 GET、POST 或 DELETE。' });
    }
    if (req.method === 'GET' && url.pathname === '/api/ws/export') {
      const allAccounts = url.searchParams.get('allAccounts') === '1' || url.searchParams.get('scope') === 'all';
      const accountId = wsAccountId(url.searchParams.get('accountId'));
      if (!allAccounts) {
        wsRequireAccount(accountId);
        return streamWsExport(res, accountId);
      }
      return streamWsExport(res, '', { allAccounts: true });
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
        // A permanent customer purge must remove every customer-linked WS/AI
        // record in the same transaction.  Leaving conversations detached
        // creates orphaned messages, analyses, queue jobs and profile facts
        // that can still surface in reports or consume background work.
        const conversationRows = db.prepare('SELECT id FROM ws_conversations WHERE customer_id=?').all(customerId);
        const conversationIds = conversationRows.map(row => String(row.id || '')).filter(Boolean);
        const runIds = conversationIds.length
          ? db.prepare(`SELECT DISTINCT run_id FROM ws_collection_items WHERE conversation_id IN (${conversationIds.map(() => '?').join(',')})`).all(...conversationIds).map(row => String(row.run_id || '')).filter(Boolean)
          : [];
        state.customers = state.customers.filter(item => String(item.id) !== customerId);
        for (const key of ['tickets', 'deposits', 'followups', 'registrations']) state[key] = state[key].filter(item => String(item.customerId || '') !== customerId);
        state.settings.operatingTasks = state.settings.operatingTasks.filter(item => String(item.customerId || '') !== customerId);
        writeState(state, false);
        if (conversationIds.length) {
          const placeholders = conversationIds.map(() => '?').join(',');
          // Child tables use ON DELETE CASCADE, so deleting the conversation
          // rows removes messages, analyses, replies, translations, ingest
          // batches, collection items, alerts, send audits and settings.
          db.prepare(`DELETE FROM ai_jobs WHERE conversation_id IN (${placeholders})`).run(...conversationIds);
          db.prepare(`DELETE FROM ws_conversations WHERE id IN (${placeholders})`).run(...conversationIds);
        }
        if (runIds.length) {
          const placeholders = runIds.map(() => '?').join(',');
          db.prepare(`DELETE FROM ws_collection_runs WHERE id IN (${placeholders}) AND NOT EXISTS (SELECT 1 FROM ws_collection_items WHERE ws_collection_items.run_id=ws_collection_runs.id)`).run(...runIds);
        }
        db.prepare('DELETE FROM ai_customer_field_evidence WHERE customer_id=?').run(customerId);
        db.prepare('DELETE FROM hot_chat_profiles WHERE customer_id=?').run(customerId);
        db.prepare('DELETE FROM ws_group_membership_events WHERE customer_id=?').run(customerId);
        db.prepare('DELETE FROM customer_delete_requests WHERE customer_id=?').run(customerId);
        // Retain a non-sensitive governance marker while removing the full
        // pre-purge profile snapshot that would otherwise keep personal data.
        recordGovernanceAction('purge', customerId, { id: customerId }, {}, { source: '数据治理', reason: wsText(body.reason || '永久删除客户', 500) });
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
    if (req.method === 'GET' && url.pathname === '/api/data-archive/summary') {
      const accountId = wsText(url.searchParams.get('accountId'), 120);
      if (accountId && !wsAccountRow(accountId)) return json(res, 404, { error: 'WS 账号不存在或已被删除。' });
      return json(res, 200, wsDataArchiveSummary({ accountId, allAccounts: url.searchParams.get('allAccounts') === '1' }));
    }
    if (req.method === 'GET' && url.pathname === '/api/diagnostics') return json(res, 200, databaseDiagnostics());
    if (req.method === 'GET' && url.pathname === '/api/health') {
      return json(res, 200, {
        ok: true,
        appVersion: APP_VERSION,
        schemaVersion: Number(db.prepare('SELECT COALESCE(MAX(version), 0) AS version FROM schema_migrations').get()?.version || 0),
        // This endpoint proves a successful schema read, not full integrity.
        // The native Supervisor owns Worker liveness; this sidecar cannot
        // truthfully infer it from its own HTTP listener.
        databaseStatus: 'queryable',
        databaseCheck: 'schema-read',
        workerStatus: 'unknown',
        sidecarStatus: 'running',
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
    if (!['/modules/productivity.js', '/modules/performance-enhancements.js', '/modules/desktop-performance.js', '/modules/smart-import.js', '/modules/business-rule-core.js', '/modules/business-enhancements.js', '/modules/business-enhancements.css', '/modules/accessibility-enhancements.js', '/modules/operations-upgrade.js', '/modules/operations-upgrade.css', '/modules/ui-refresh.css', '/modules/horizon-atelier.css', '/modules/business-6.css', '/modules/operations-6.css', '/modules/global-6.css', '/modules/home-6.css', '/modules/scroll-system.css', '/modules/scroll-coordinator.js', '/modules/desktop-host.js', '/assets/zhike-horizon-logo.png', '/assets/atelier-dawn.svg', '/assets/horizon-ridge-6.png', '/assets/horizon-flow-6.png', '/assets/horizon-topline-6.png', '/assets/horizon-rock-6.png', '/assets/horizon-sidebar-shell-6.svg', '/index.html', '/styles.css', '/app.js', '/vendor/xlsx/xlsx.js', '/modules/v4-data-center.js', '/modules/v4.css', '/modules/gpt-assistant.js', '/modules/runtime-customizer.js', '/modules/gpt-assistant.css', '/modules/gpt-workbench.css', '/modules/gpt-modern.css', '/modules/gpt-management.css', '/modules/phone-registry.js', '/modules/phone-registry.css', '/modules/v41-ui.css', '/modules/operations-core.cjs', '/modules/operations-ui.js', '/modules/ticket-record-core.js', '/modules/ws-scope.js', '/modules/ws-workbench-core.js', '/modules/ai-job-pipeline-core.js', '/modules/ai-crm-suggestion-core.js', '/modules/ai-mock-provider.js', '/modules/ai-review-center-ui.js', '/modules/ws-crm-sync-core.js', '/modules/hot-chat-profile-core.js', '/modules/customer-avatar.js', '/modules/workspace-shell.js', '/modules/metrics-charts.js', '/modules/ws-business-pages.js', '/modules/ws-group-reading-ui.js', '/modules/ws-workbench.js', '/modules/ws-workbench.css'].includes(requestPath)) return json(res, 404, { error: '文件不存在。' });
    const filePath = resolve(root, `.${normalize(requestPath)}`);
    if (!filePath.startsWith(root + sep) || !existsSync(filePath) || !statSync(filePath).isFile()) return json(res, 404, { error: '文件不存在。' });
    const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.cjs': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png' };
    res.writeHead(200, { 'Content-Type': types[extname(filePath)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    if (filePath.endsWith('index.html')) {
      let html = await (await import('node:fs/promises')).readFile(filePath, 'utf8');
      const desktopFlag = process.env.ZHIKE_DESKTOP_APP === '1' ? ';window.__DESKTOP_APP__=true' : '';
      html = html.replace('</head>', `<script>window.__LOCAL_DB__=true${desktopFlag}</script></head>`);
      res.end(html);
    } else {
      const assetStream = createReadStream(filePath);
      assetStream.on('error', error => {
        if (res.headersSent) {
          res.destroy();
          return;
        }
        json(res, error.status || 500, { error: error.message || '文件读取失败。' });
      });
      assetStream.pipe(res);
    }
  } catch (error) {
    json(res, error.status || 400, {
      error: error.message || '本地操作失败。',
      ...(error.code ? { code: error.code } : {}),
      ...(Array.isArray(error.conflicts) ? { conflicts: error.conflicts } : {}),
    });
  }
});

function startListening(nextPort) {
  port = nextPort;
  server.listen(port, '127.0.0.1');
}
server.on('listening', () => {
  testStartupDiagnostic('listening');
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
testStartupDiagnostic('phone-index-repair-start');
repairCustomerPhoneIndex();
testStartupDiagnostic('phone-index-repair-completed');
testStartupDiagnostic('listen-start');
startListening(port);
server.on('close', () => { if (parentMonitor) clearInterval(parentMonitor); db.close(); releaseWorkspaceLock(); });
process.on('SIGINT', () => server.close(() => process.exit(0)));
process.on('SIGTERM', () => server.close(() => process.exit(0)));
