'use strict';

// Read-only projections of the existing account-scoped authorities. This module
// owns no tables, migrations, customer matching, credentials or audit writes.
const { createHash } = require('node:crypto');
const wsCore = require('./ws-workbench-core.js');
const wsCrmSync = require('./ws-crm-sync-core.js');
const installed = new WeakSet();
const text = (value, maximum = 500) => String(value == null ? '' : value).trim().slice(0, maximum);
const parse = value => { try { const out = JSON.parse(value || '{}'); return out && typeof out === 'object' && !Array.isArray(out) ? out : {}; } catch { return {}; } };
function queryError(message) { return Object.assign(new Error(message), { status: 400, code: 'INVALID_WORKSPACE_QUERY' }); }

function redactAudit(value) {
  return text(value, 4000)
    .replace(/https?:\/\/[^\s<>"']+/ig, candidate => {
      try {
        const url = new URL(candidate);
        if (url.username || url.password) { url.username = 'redacted'; url.password = ''; }
        for (const key of [...url.searchParams.keys()]) if (/(?:password|pass|secret|token|api[_-]?key|credential|authorization|cookie)/i.test(key)) url.searchParams.set(key, '[已脱敏]');
        return url.toString();
      } catch { return candidate; }
    })
    .replace(/\b(?:cookie|set-cookie|authorization)\s*[=:：]\s*[^\r\n]*/ig, '[敏感信息已脱敏]')
    .replace(/\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/ig, '[授权信息已脱敏]')
    .replace(/(?:password|passcode|pass|pwd|secret|(?:access|refresh)[_\s-]?token|token|api[_\s-]?key|credential|验证码|校验码|密码|身份证号|银行卡号)["']?\s*[=:：]\s*(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s,;，；}\]\r\n]+)/ig, '[敏感信息已脱敏]')
    .replace(/\bsk-(?:proj-)?[A-Za-z0-9_-]{12,}/g, '[密钥已脱敏]')
    .replace(/(?:[A-Za-z]:\\|\\\\)[^\r\n"'<>|]+/g, '[本地路径已脱敏]')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/ig, address => /@(?:c\.us|g\.us|s\.whatsapp\.net)$/i.test(address) ? address : '[邮件已脱敏]')
    .replace(/\+?\b\d[\d ().-]{7,}\d\b/g, match => {
      const digits = match.replace(/\D/g, '');
      if (digits.length < 10 || digits.length > 15 || /^\d{4}-\d\d-\d\d/.test(match)) return match;
      return digits.slice(0, 2) + '***' + digits.slice(-2);
    })
    .slice(0, 1000);
}

function sourcePhone(externalId, dataJson) {
  const data = parse(dataJson);
  const supplied = text(data.phone || data.phoneNumber || data.contactPhone || data.memberPhone, 80);
  if (supplied) return supplied;
  // @lid is an opaque identity, never a phone number. Titles are display data.
  const jid = text(externalId, 240).match(/^(\+?\d{8,15})@(?:c\.us|s\.whatsapp\.net)$/i);
  return jid ? jid[1] : '';
}

function installFunctions(db) {
  if (installed.has(db)) return;
  db.function('zk_workspace_phone', { deterministic: true }, sourcePhone);
  db.function('zk_workspace_normalize', { deterministic: true }, value => wsCrmSync.normalizePhone(value));
  db.function('zk_workspace_type', { deterministic: true }, (externalId, dataJson) => wsCore.conversationType({ external_id: externalId, data_json: dataJson }));
  db.function('zk_workspace_audit_text', { deterministic: true }, value => redactAudit(value));
  db.function('zk_workspace_fold', { deterministic: true }, value => String(value || '').toLowerCase());
  db.function('zk_workspace_audit_id', { deterministic: true }, (source, id) => String(source) + ':' + createHash('sha256').update(String(id)).digest('hex'));
  installed.add(db);
}

function pagination(params, total) {
  const integer = (name, fallback, max) => {
    const input = params.get(name);
    if (input == null || input === '') return fallback;
    if (!/^\d+$/.test(input) || !Number.isSafeInteger(Number(input)) || Number(input) < 1) throw queryError(`${name} 必须为正整数。`);
    return Math.min(max, Number(input));
  };
  const pageSize = integer('pageSize', 40, 100);
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(integer('page', 1, 1000000), pageCount);
  return { page, pageSize, pageCount, offset: (page - 1) * pageSize };
}

const CONTACTS_CTE = `WITH raw_contacts AS (
  SELECT c.id,c.account_id,c.external_id,c.title,c.customer_id,c.language,c.created_at,c.updated_at,
    zk_workspace_phone(c.external_id,c.data_json) AS phone,
    p.id AS linked_customer_id,p.deleted AS customer_deleted,p.phone_normalized AS crm_phone
  FROM ws_conversations c LEFT JOIN customers p ON p.id=c.customer_id
  WHERE c.account_id=? AND zk_workspace_type(c.external_id,c.data_json)='direct'
), normalized AS (
  SELECT *,zk_workspace_normalize(phone) AS normalized_phone FROM raw_contacts
), counted AS (
  SELECT *,CASE WHEN normalized_phone<>'' THEN COUNT(*) OVER (PARTITION BY normalized_phone) ELSE 0 END AS duplicate_count FROM normalized
)`;

function contacts(db, accountId, params) {
  installFunctions(db);
  const query = text(params.get('q') || params.get('search'), 160).toLowerCase();
  const duplicate = text(params.get('duplicate'), 20) || 'all';
  if (!['all', 'duplicate', 'single'].includes(duplicate)) throw queryError('不支持的重复记录筛选。');
  const where = [], values = [accountId];
  const id = text(params.get('id'), 200);
  if (id) { where.push('id=?'); values.push(id); }
  if (query) {
    where.push("instr(zk_workspace_fold(title||' '||phone||' '||normalized_phone||' '||external_id||' '||customer_id),?)>0");
    values.push(query);
  }
  if (duplicate === 'duplicate') where.push('duplicate_count>1');
  if (duplicate === 'single') where.push('duplicate_count=1');
  const clause = where.length ? ' WHERE ' + where.join(' AND ') : '';
  const total = Number(db.prepare(CONTACTS_CTE + ' SELECT COUNT(*) AS count FROM counted' + clause).get(...values).count);
  const page = pagination(params, total);
  const rows = db.prepare(CONTACTS_CTE + ' SELECT * FROM counted' + clause + ' ORDER BY updated_at DESC,id ASC LIMIT ? OFFSET ?').all(...values, page.pageSize, page.offset).map(row => {
    const valid = /^[+\d\s().-]+$/.test(row.phone) && /^\d{8,15}$/.test(row.normalized_phone);
    const hasLink = Boolean(row.customer_id);
    const compatiblePhone = !row.normalized_phone || !row.crm_phone || row.normalized_phone === row.crm_phone;
    return {
      id: row.id, accountId: row.account_id, conversationId: row.id, name: row.title || '未提供',
      phone: row.phone, normalizedPhone: row.normalized_phone,
      phoneStatus: !row.phone ? 'unprovided' : valid ? 'valid' : 'invalid',
      externalId: row.external_id, customerId: row.customer_id || '',
      crmLinkStatus: !hasLink ? 'unlinked' : row.linked_customer_id && !row.customer_deleted && compatiblePhone ? 'linked' : 'conflict',
      duplicateCount: Number(row.duplicate_count), source: 'ws_conversations', sourceLabel: '本机已同步一对一会话',
      language: row.language || '', createdAt: row.created_at, updatedAt: row.updated_at,
    };
  });
  return { accountId, rows, total, page: page.page, pageSize: page.pageSize, pageCount: page.pageCount,
    source: 'local-synced-conversations', coverage: '仅查询当前账号已同步的本机一对一会话目录，不代表完整 WhatsApp 通讯录；不按姓名或号码自动建立 CRM 关联。',
    filters: { duplicate }, readOnly: true };
}

const jsonSql = column => `CASE WHEN json_valid(${column}) THEN ${column} ELSE '{}' END`;
// Every arm has its own account WHERE; no account-less governance/diagnostic
// history is guessed into an account. Message bodies and raw JSON never leave.
const AUDIT_UNION = `
 SELECT 'ws_group_audit' AS source,id AS record_id,account_id,action,outcome,created_at AS at,actor,
  COALESCE(json_extract(${jsonSql('data_json')},'$.jobId'),json_extract(${jsonSql('data_json')},'$.runId'),'') AS job_id,
  entity_type AS object_type,entity_id AS object_id,group_jid,'' AS correlation_id,reason,
  json_object('runId',json_extract(${jsonSql('data_json')},'$.runId'),'errorCode',json_extract(${jsonSql('data_json')},'$.errorCode'),'retryCount',json_extract(${jsonSql('data_json')},'$.retryCount')) AS detail_json
 FROM ws_group_audit WHERE account_id=?
 UNION ALL
 SELECT 'ai_task_audit',id,account_id,action,to_status,created_at,actor,job_id,'ai_job',job_id,'',correlation_id,reason,
  json_object('fromStatus',from_status,'toStatus',to_status,'fieldName',json_extract(${jsonSql('data_json')},'$.fieldName'),'suggestionId',json_extract(${jsonSql('data_json')},'$.suggestionId'),'customerId',json_extract(${jsonSql('data_json')},'$.customerId'))
 FROM ai_task_audit WHERE account_id=?
 UNION ALL
 SELECT 'ws_send_audit',id,account_id,'send.'||operation,status,updated_at,'未提供',batch_id,'conversation',conversation_id,'','',error_message,
  json_object('payloadKind',payload_kind,'targetLanguage',target_language,'attachmentCount',json_array_length(CASE WHEN json_valid(attachment_ids_json) THEN attachment_ids_json ELSE '[]' END))
 FROM ws_send_audit WHERE account_id=?`;

const SNAPSHOT_UNION = `
 SELECT 'ws_collection_runs' AS source,id AS record_id,account_id,'collection.run' AS action,status AS outcome,updated_at AS at,
  '未提供' AS actor,id AS job_id,'collection_run' AS object_type,id AS object_id,'' AS group_jid,'' AS correlation_id,last_error AS reason,
  json_object('total',total,'completed',completed,'failed',failed,'skipped',skipped,'retryable',retryable,'hasCheckpoint',checkpoint<>'') AS detail_json
 FROM ws_collection_runs WHERE account_id=?
 UNION ALL
 SELECT 'ws_group_sync_runs',id,account_id,'group.sync.'||kind,status,updated_at,'未提供',id,'group',group_jid,group_jid,'',error_message,
  json_object('itemCount',item_count,'retryCount',retry_count,'hasCheckpoint',checkpoint<>'')
 FROM ws_group_sync_runs WHERE account_id=?
 UNION ALL
 SELECT 'ai_jobs',id,account_id,'ai.'||job_type,status,updated_at,'未提供',id,'conversation',conversation_id,group_jid,correlation_id,last_error,
  json_object('attempts',attempts,'maxAttempts',max_attempts,'nextAttemptAt',next_attempt_at,'hasCheckpoint',checkpoint_json<>'{}')
 FROM ai_jobs WHERE account_id=?`;

const coverage = Object.freeze({
  audit: ['ws_group_audit', 'ai_task_audit', 'ws_send_audit'],
  snapshot: ['ws_collection_runs', 'ws_group_sync_runs', 'ai_jobs'],
  unavailable: [
    { source: 'customer_governance_actions / crm_identity_conflicts', reason: '原始记录无可靠账号字段，不按当前客户名称或全局主档推断账号。CRM 审核可查看既有账号作用域 AI 审计。' },
    { source: 'hot_chat_events', reason: '热聊领域事件不等同完整操作审计；未混入正式审计。' },
    { source: 'Worker / diagnostic files', reason: '本查询不读取磁盘诊断、凭据或无账号日志；没有可安全归属的记录来源。' },
  ],
});

function audit(db, accountId, params) {
  installFunctions(db);
  const category = text(params.get('category'), 20) || 'audit';
  if (!['audit', 'snapshot', 'diagnostic'].includes(category)) throw queryError('不支持的日志类别。');
  if (category === 'diagnostic') {
    const page = pagination(params, 0);
    return { accountId, rows: [], total: 0, page: page.page, pageSize: page.pageSize, pageCount: page.pageCount,
      category, types: [], outcomes: [], coverage, available: false, unavailableReason: '诊断文件未接入此查询；不读取原始磁盘日志或凭据。', readOnly: true };
  }
  const union = category === 'audit' ? AUDIT_UNION : SNAPSHOT_UNION;
  const base = `WITH raw AS (${union}), public_records AS (
    SELECT zk_workspace_audit_id(source,record_id) AS id,source,record_id,account_id,
      zk_workspace_audit_text(action) AS action,zk_workspace_audit_text(outcome) AS outcome,at,
      zk_workspace_audit_text(actor) AS actor,zk_workspace_audit_text(job_id) AS job_id,
      zk_workspace_audit_text(object_type) AS object_type,zk_workspace_audit_text(object_id) AS object_id,
      zk_workspace_audit_text(group_jid) AS group_jid,zk_workspace_audit_text(correlation_id) AS correlation_id,
      zk_workspace_audit_text(reason) AS reason,detail_json FROM raw
  )`;
  const scope = [accountId, accountId, accountId];
  const where = [], values = [...scope];
  const eq = (parameter, column) => { const value = text(params.get(parameter), 240); if (value) { where.push(column + '=?'); values.push(value); } };
  eq('id', 'id'); eq('type', 'action'); eq('outcome', 'outcome'); eq('jobId', 'job_id'); eq('objectId', 'object_id');
  const sourceType = text(params.get('sourceType'), 60);
  if (sourceType) { where.push('source=?'); values.push(sourceType); }
  for (const [key, operator] of [['from', '>='], ['to', '<=']]) {
    const raw = text(params.get(key), 80);
    if (!raw) continue;
    const parsed = Date.parse(raw);
    if (!Number.isFinite(parsed)) throw queryError('日志时间格式无效。');
    const boundary = /^\d{4}-\d{2}-\d{2}$/.test(raw) && key === 'to' ? new Date(parsed + 86400000 - 1).toISOString() : new Date(parsed).toISOString();
    where.push('julianday(at)' + operator + 'julianday(?)'); values.push(boundary);
  }
  if (params.get('from') && params.get('to') && Date.parse(params.get('from')) > Date.parse(params.get('to'))) throw queryError('开始时间不能晚于结束时间。');
  const query = text(params.get('q') || params.get('search'), 160).toLowerCase();
  if (query) { where.push("instr(zk_workspace_fold(action||' '||outcome||' '||reason||' '||object_id||' '||job_id||' '||source),?)>0"); values.push(query); }
  const clause = where.length ? ' WHERE ' + where.join(' AND ') : '';
  const total = Number(db.prepare(base + ' SELECT COUNT(*) AS count FROM public_records' + clause).get(...values).count);
  const page = pagination(params, total);
  const rows = db.prepare(base + ' SELECT * FROM public_records' + clause + ' ORDER BY julianday(at) DESC,source ASC,record_id ASC LIMIT ? OFFSET ?').all(...values, page.pageSize, page.offset).map(row => ({
    id: row.id, source: row.source, category, recordId: redactAudit(row.record_id), accountId: row.account_id,
    action: row.action, outcome: row.outcome || '未提供', at: Number.isFinite(Date.parse(row.at)) ? new Date(row.at).toISOString() : '时间未识别', actor: row.actor || '未提供',
    jobId: row.job_id, objectType: row.object_type, objectId: row.object_id, groupJid: row.group_jid,
    correlationId: row.correlation_id, reason: row.reason,
    details: Object.fromEntries(Object.entries(parse(row.detail_json)).map(([key, value]) => [key, typeof value === 'string' ? redactAudit(value) : typeof value === 'number' || typeof value === 'boolean' || value == null ? value : '未提供'])),
  }));
  const types = db.prepare(base + ' SELECT DISTINCT action FROM public_records ORDER BY action LIMIT 100').all(...scope).map(row => row.action);
  const outcomes = db.prepare(base + ' SELECT DISTINCT outcome FROM public_records ORDER BY outcome LIMIT 100').all(...scope).map(row => row.outcome).filter(Boolean);
  return { accountId, rows, total, page: page.page, pageSize: page.pageSize, pageCount: page.pageCount,
    category, types, outcomes, coverage, available: true, readOnly: true };
}

module.exports = { contacts, audit, redactAudit };
