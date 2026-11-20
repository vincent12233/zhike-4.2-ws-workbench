'use strict';
/**
 * Dedicated WS group channel configuration rules (pure, no I/O).
 *
 * - Group codes such as A-501 / F-550 are detected from the group name with no
 *   hard-coded range. A name carrying two different codes is ambiguous and is
 *   left for the user instead of being guessed.
 * - A code prefix never implies a channel. The effective channel comes from
 *   an explicit user value or a user-confirmed exact-code rule only.
 * - The real group JID is the key; the group name is display data.
 */

const BUILTIN_CHANNELS = Object.freeze(['单导K', '单导B', 'FB群粉', 'API群粉', '短信群粉']);
const CONFIG_FIELDS = Object.freeze(['groupCode', 'channel', 'pageCategory', 'assistant', 'defaultTags', 'autoCreateCustomers', 'monitorMembership']);
const FIELD_COLUMNS = Object.freeze({
  groupCode: 'group_code', channel: 'channel', pageCategory: 'page_category', assistant: 'assistant',
  defaultTags: 'default_tags_json', autoCreateCustomers: 'auto_create_customers', monitorMembership: 'monitor_membership',
});
const FIELD_LABELS = Object.freeze({
  groupCode: '群组编号', channel: '渠道', pageCategory: '页面分类', assistant: '跟进助理',
  defaultTags: '默认标签', autoCreateCustomers: '自动建档', monitorMembership: '进退群监测',
});
const CSV_COLUMNS = Object.freeze([
  ['accountId', '所属账号'], ['groupJid', '群组ID'], ['groupName', '群组名称'], ['groupCode', '群组编号'],
  ['channel', '渠道'], ['pageCategory', '页面分类'], ['assistant', '跟进助理'], ['defaultTags', '默认标签'],
  ['autoCreateCustomers', '自动建档'], ['monitorMembership', '进退群监测'],
]);
const HEADER_ALIASES = Object.freeze({
  accountId: ['所属账号', '账号', 'account', 'accountid'],
  groupJid: ['群组id', '群id', '群组jid', 'groupjid', 'groupid', 'jid'],
  groupName: ['群组名称', '群名称', '群名', 'groupname', 'name'],
  groupCode: ['群组编号', '群编号', '编号', 'groupcode', 'code'],
  channel: ['渠道', '来源渠道', 'channel', 'source'],
  pageCategory: ['页面分类', '页面', 'pagecategory', 'page'],
  assistant: ['跟进助理', '助理', '负责助理', 'assistant'],
  defaultTags: ['默认标签', '默认客户标签', '标签', 'defaulttags', 'tags'],
  autoCreateCustomers: ['自动建档', '自动建档开关', 'autocreatecustomers', 'autocreate'],
  monitorMembership: ['进退群监测', '进退群监测开关', '监测', 'monitormembership', 'monitor'],
});

const text = (value, max = 120) => String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
const GROUP_JID = /^[a-z0-9._-]+@g\.us$/i;
// Letters, a dash (ASCII or typographic), then 2–5 digits. Bounded on both
// sides so "VIP2024", phone numbers and dates are not mistaken for codes.
const CODE_PATTERN = /(?<![A-Za-z0-9])([A-Za-z]{1,3})\s*[-‐‑–—]\s*(\d{2,5})(?![0-9])/g;

function normalizeGroupCode(value) {
  const raw = text(value, 40);
  if (!raw) return '';
  const match = /^([A-Za-z]{1,3})\s*[-‐‑–—_]?\s*(\d{2,5})$/.exec(raw);
  return match ? `${match[1].toUpperCase()}-${match[2]}` : '';
}

/** @returns {{code:string, status:'detected'|'none'|'ambiguous', candidates:string[]}} */
function detectGroupCode(groupName) {
  const name = String(groupName ?? '');
  const candidates = [...new Set([...name.matchAll(CODE_PATTERN)].map(match => `${match[1].toUpperCase()}-${match[2]}`))];
  if (candidates.length === 1) return { code: candidates[0], status: 'detected', candidates };
  return { code: '', status: candidates.length ? 'ambiguous' : 'none', candidates };
}

function normalizeTags(value) {
  const list = Array.isArray(value) ? value : String(value ?? '').split(/[,，;；|、\n]/);
  return [...new Set(list.map(item => text(item, 40)).filter(Boolean))].slice(0, 20);
}

function parseSwitch(value) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value === 1 ? true : value === 0 ? false : null;
  const raw = text(value, 10).toLowerCase();
  if (['1', 'true', 'yes', 'y', 'on', '是', '开', '开启', '启用'].includes(raw)) return true;
  if (['0', 'false', 'no', 'n', 'off', '否', '关', '关闭', '停用'].includes(raw)) return false;
  return null;
}

/**
 * Validate a partial config edit. Only keys present in `input` are returned,
 * so a CSV with blank optional cells or a single-field batch edit never
 * clears unrelated fields. An explicit empty string clears text fields.
 */
function validateConfigPatch(input = {}) {
  const patch = {};
  const errors = [];
  if (!input || typeof input !== 'object') return { patch, errors: ['配置内容无效。'] };
  if (Object.hasOwn(input, 'groupCode')) {
    const raw = text(input.groupCode, 40);
    const code = normalizeGroupCode(raw);
    if (raw && !code) errors.push(`群组编号“${raw}”格式无效，应为字母-数字，如 A-501。`);
    else patch.groupCode = code;
  }
  if (Object.hasOwn(input, 'channel')) {
    const channel = text(input.channel, 60);
    if (/[<>]/.test(channel)) errors.push('渠道名称包含无效字符。');
    else patch.channel = channel;
  }
  for (const key of ['pageCategory', 'assistant']) {
    if (!Object.hasOwn(input, key)) continue;
    const value = text(input[key], 60);
    if (/[<>]/.test(value)) errors.push(`${FIELD_LABELS[key]}包含无效字符。`);
    else patch[key] = value;
  }
  if (Object.hasOwn(input, 'defaultTags')) patch.defaultTags = normalizeTags(input.defaultTags);
  for (const key of ['autoCreateCustomers', 'monitorMembership']) {
    if (!Object.hasOwn(input, key)) continue;
    const parsed = parseSwitch(input[key]);
    if (parsed === null) errors.push(`${FIELD_LABELS[key]}只能填写 是/否。`);
    else patch[key] = parsed;
  }
  return { patch, errors };
}

function configFromRow(row) {
  if (!row) return null;
  let tags = [];
  try { tags = normalizeTags(JSON.parse(row.default_tags_json || '[]')); } catch { tags = []; }
  return {
    id: row.id, accountId: row.account_id, groupJid: row.group_jid,
    groupCode: row.group_code || '', groupCodeOrigin: row.group_code_origin || '',
    channel: row.channel || '', channelOrigin: row.channel_origin || '',
    pageCategory: row.page_category || '', assistant: row.assistant || '', defaultTags: tags,
    autoCreateCustomers: Boolean(row.auto_create_customers), monitorMembership: Boolean(row.monitor_membership),
    revision: Number(row.revision || 1), createdAt: row.created_at || '', updatedAt: row.updated_at || '',
  };
}

const sameValue = (a, b) => JSON.stringify(a) === JSON.stringify(b);
/**
 * Values a group has before it is configured. Auto-create defaults to on so
 * that configuring only a channel does not silently stop auto-provisioning,
 * which is how unconfigured monitored groups already behave.
 */
const UNCONFIGURED = Object.freeze({ groupCode: '', channel: '', pageCategory: '', assistant: '', defaultTags: [], autoCreateCustomers: true, monitorMembership: false });

/** Field-level diff between the stored config and a validated patch. */
function diffConfig(current, patch) {
  const base = current || UNCONFIGURED;
  const changes = {};
  for (const key of CONFIG_FIELDS) {
    if (!Object.hasOwn(patch, key)) continue;
    if (!sameValue(base[key], patch[key])) changes[key] = { from: base[key], to: patch[key] };
  }
  return changes;
}

/**
 * Effective channel. Explicit config wins; otherwise an enabled exact-code
 * rule; otherwise unconfigured. The collector hint is reported, never used.
 */
function resolveChannel(config, rulesByCode, catalogHint = '') {
  if (config?.channel) return { channel: config.channel, origin: config.channelOrigin || 'manual', pending: false, hint: catalogHint || '' };
  const code = config?.groupCode || '';
  const rule = code ? rulesByCode?.get(code) : null;
  if (rule && rule.enabled) return { channel: rule.channel, origin: 'rule', pending: false, hint: catalogHint || '' };
  return { channel: '', origin: '', pending: true, hint: catalogHint || '' };
}

/**
 * Batch preview / conflict check. `entries` are {accountId, groupJid, input}.
 * `context` provides the catalog, existing configs and rules. Pure: returns
 * per-row outcomes; the caller decides whether to apply.
 */
function previewBatch(entries, context) {
  const { catalog, configs, rules } = context;
  const seen = new Map();
  const codeOwners = new Map();
  for (const config of configs.values()) if (config.groupCode) codeOwners.set(config.groupCode, `${config.accountId}\u0000${config.groupJid}`);
  const rows = [];
  entries.forEach((entry, index) => {
    const accountId = text(entry.accountId, 120);
    const groupJid = text(entry.groupJid, 200).toLowerCase();
    const key = `${accountId}\u0000${groupJid}`;
    const row = { index, accountId, groupJid, status: 'ok', errors: [], conflicts: [], changes: {} };
    rows.push(row);
    if (!accountId || !GROUP_JID.test(groupJid)) { row.status = 'rejected'; row.errors.push('缺少有效的所属账号或群组ID。'); return; }
    if (!catalog.has(key)) { row.status = 'rejected'; row.errors.push('群组不在该账号的群组目录中，请先由专用 WS 发现该群组。'); return; }
    if (seen.has(key)) { row.status = 'rejected'; row.errors.push(`与第 ${seen.get(key) + 1} 行重复配置同一群组。`); return; }
    seen.set(key, index);
    const { patch, errors } = validateConfigPatch(entry.input || {});
    if (errors.length) { row.status = 'rejected'; row.errors.push(...errors); return; }
    const current = configs.get(key) || null;
    row.patch = patch;
    row.changes = diffConfig(current, patch);
    const code = Object.hasOwn(patch, 'groupCode') ? patch.groupCode : current?.groupCode || '';
    if (code) {
      const owner = codeOwners.get(code);
      if (owner && owner !== key) row.conflicts.push(`群组编号 ${code} 已被另一个群组使用。`);
      else codeOwners.set(code, key);
    }
    const channel = Object.hasOwn(patch, 'channel') ? patch.channel : current?.channel || '';
    const rule = code ? rules.get(code) : null;
    if (rule && rule.enabled && channel && channel !== rule.channel) row.conflicts.push(`编号 ${code} 的已确认规则渠道为“${rule.channel}”，本行填写为“${channel}”。`);
    if (row.conflicts.length) row.status = 'conflict';
    else if (!Object.keys(row.changes).length) row.status = 'unchanged';
  });
  const summary = rows.reduce((acc, row) => { acc[row.status] = (acc[row.status] || 0) + 1; return acc; }, { ok: 0, unchanged: 0, conflict: 0, rejected: 0 });
  return { rows, summary };
}

// ---------- CSV ----------

function parseCsv(source) {
  const input = String(source ?? '').replace(/^﻿/, '');
  const firstLine = input.split(/\r?\n/, 1)[0] || '';
  const delimiter = (firstLine.match(/\t/g) || []).length > (firstLine.match(/,/g) || []).length ? '\t' : ',';
  const records = [];
  let field = '', record = [], quoted = false;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (quoted) {
      if (ch === '"' && input[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"' && field === '') quoted = true;
    else if (ch === delimiter) { record.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && input[i + 1] === '\n') i++;
      record.push(field); records.push(record); record = []; field = '';
    } else field += ch;
  }
  if (field !== '' || record.length) { record.push(field); records.push(record); }
  return records.filter(cells => cells.some(cell => cell.trim() !== ''));
}

const unguard = value => String(value ?? '').replace(/^'(?=[=+\-@\t\r])/, '');

/** Map CSV rows to config entries. Blank optional cells are omitted. */
function importRows(source, defaults = {}) {
  const records = parseCsv(source);
  if (!records.length) return { entries: [], errors: ['文件为空。'] };
  const header = records[0].map(cell => text(cell, 40).toLowerCase().replace(/\s+/g, ''));
  const columnOf = {};
  for (const [key, aliases] of Object.entries(HEADER_ALIASES)) {
    const index = header.findIndex(cell => aliases.includes(cell));
    if (index >= 0) columnOf[key] = index;
  }
  if (columnOf.groupJid === undefined) return { entries: [], errors: ['缺少“群组ID”列。群组名称会变化，导入必须以真实群组ID定位群组。'] };
  const entries = records.slice(1).map((cells, offset) => {
    const value = key => columnOf[key] === undefined ? undefined : unguard(cells[columnOf[key]]).trim();
    const input = {};
    for (const key of CONFIG_FIELDS) {
      const cell = value(key);
      if (cell !== undefined && cell !== '') input[key] = cell;
    }
    return { line: offset + 2, accountId: value('accountId') || defaults.accountId || '', groupJid: value('groupJid') || '', input };
  });
  return { entries, errors: [] };
}

function csvCell(value) {
  let cell = Array.isArray(value) ? value.join('、') : typeof value === 'boolean' ? (value ? '是' : '否') : String(value ?? '');
  // Neutralise spreadsheet formula injection without changing the meaning.
  if (/^[=+\-@\t\r]/.test(cell)) cell = `'${cell}`;
  return /[",\r\n]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell;
}

function exportCsv(rows) {
  const lines = [CSV_COLUMNS.map(([, label]) => label).join(',')];
  for (const row of rows) lines.push(CSV_COLUMNS.map(([key]) => csvCell(row[key])).join(','));
  return `﻿${lines.join('\r\n')}\r\n`;
}

module.exports = {
  BUILTIN_CHANNELS, CONFIG_FIELDS, UNCONFIGURED, FIELD_COLUMNS, FIELD_LABELS, CSV_COLUMNS,
  normalizeGroupCode, detectGroupCode, normalizeTags, parseSwitch, validateConfigPatch,
  configFromRow, diffConfig, resolveChannel, previewBatch, parseCsv, importRows, exportCsv,
};
