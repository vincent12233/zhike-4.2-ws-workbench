'use strict';
// P3 WS contact exclusion engine.
//
// The WS directory exists to keep listed WhatsApp identities out of automatic
// customer creation (staff, assistants, group admins, manual picks). It is NOT a
// second CRM: it never creates, edits or deletes customers.
//
// Two hard rules from the product brief:
//   1. Exclusion must be evaluated BEFORE any auto-create / auto-fill decision.
//   2. Matching may only rely on a reliable WhatsApp identity (normalized phone,
//      or an opaque business-scoped id). Nicknames and avatars are never used to
//      exclude or merge, because they are not stable identity.
//
// This module reuses the production identity normalizer from ws-group-monitor-core
// so that a number written to the directory as +91…/91…/bare matches the member
// identity produced by real group collection.

const crypto = require('node:crypto');
const monitor = require('./ws-group-monitor-core.js');

const ACTION_AUTO_CREATE_BLOCKED = 'auto-create-blocked';
const ACTION_AUTO_FILL_BLOCKED = 'auto-fill-blocked';
const ACTION_LOOKUP = 'lookup';
const ACTIONS = new Set([ACTION_AUTO_CREATE_BLOCKED, ACTION_AUTO_FILL_BLOCKED, ACTION_LOOKUP]);

const SOURCES = new Set(['manual', 'import', 'hit-log']);

function text(value, max = 240) {
  return String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max);
}

function nowIso(clock) {
  const value = typeof clock === 'function' ? clock() : new Date().toISOString();
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : new Date().toISOString();
}

function newId(prefix) {
  return `${prefix}-${crypto.randomUUID()}`;
}

// Normalize one candidate identity to the same canonical shape the collector
// produces. Returns null when the value carries no reliable identity, so callers
// cannot accidentally exclude somebody on a display name alone.
function normalizeExclusionIdentity(value) {
  // Validate the whole identifier before using the legacy normalizer, which
  // extracts digits from free-form collector text. A nickname such as
  // employee12345678 must never become a phone exclusion rule.
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  if (typeof value === 'number' && (!Number.isSafeInteger(value) || value <= 0)) return null;
  const raw = String(value).normalize('NFKC').trim().replace(/^whatsapp:/i, '').trim();
  if (!raw || raw.length > 240 || /[\u0000-\u001f\u007f]/.test(raw)) return null;
  const phoneText = /^\+?[\d\s().-]+$/.test(raw);
  const phoneJid = /^\d+(?::\d+)?@(?:s\.whatsapp\.net|c\.us)$/i.test(raw);
  const lidJid = /^\d+(?::\d+)?@lid$/i.test(raw);
  const opaque = /^[a-z]{2}\.ENT\.[a-z0-9]{1,128}$/i.test(raw);
  if (!phoneText && !phoneJid && !lidJid && !opaque) return null;
  const identity = monitor.normalizeMemberIdentity(lidJid ? raw.replace(/:\d+(?=@)/, '') : raw);
  if (!identity.value) return null;
  if ((phoneText || phoneJid) && identity.kind !== 'phone') return null;
  return {
    kind: identity.kind === 'phone' ? 'phone' : identity.kind === 'opaque' ? 'opaque' : 'jid',
    value: identity.value,
    phone: identity.phone || '',
    raw: identity.raw || text(value),
  };
}

// Build the lookup keys an incoming member may match on. A phone identity is
// also indexed under its canonical phone so a stored JID-form rule still hits.
function candidateKeys(identity) {
  if (!identity) return [];
  const keys = [{ kind: identity.kind, value: identity.value }];
  if (identity.phone) keys.push({ kind: 'phone', value: identity.phone });
  return keys.filter((key, index) => keys.findIndex(other => other.kind === key.kind && other.value === key.value) === index);
}

function rowToRule(row) {
  if (!row) return null;
  return {
    id: text(row.id, 128),
    kind: text(row.identity_kind, 16),
    value: text(row.identity_value, 240),
    phone: text(row.identity_phone, 32),
    displayName: text(row.display_name, 240),
    note: text(row.note, 500),
    source: text(row.source, 32),
    enabled: Number(row.enabled) === 1,
    createdBy: text(row.created_by, 120),
    createdAt: text(row.created_at, 40),
    updatedAt: text(row.updated_at, 40),
  };
}

// --- engine over a database handle -------------------------------------------

function createExclusionEngine({ db, clock } = {}) {
  if (!db) throw new TypeError('db is required');

  function listRules({ includeDisabled = false } = {}) {
    const rows = includeDisabled
      ? db.prepare('SELECT * FROM ws_contact_exclusions ORDER BY updated_at DESC, id').all()
      : db.prepare('SELECT * FROM ws_contact_exclusions WHERE enabled = 1 ORDER BY updated_at DESC, id').all();
    return rows.map(rowToRule).filter(Boolean);
  }

  function findRule(identity) {
    const keys = candidateKeys(identity);
    if (!keys.length) return null;
    for (const key of keys) {
      const row = db.prepare('SELECT * FROM ws_contact_exclusions WHERE identity_kind=? AND identity_value=? AND enabled=1').get(key.kind, key.value);
      if (row) return rowToRule(row);
      if (key.kind === 'phone') {
        const byPhone = db.prepare("SELECT * FROM ws_contact_exclusions WHERE identity_kind='phone' AND identity_phone=? AND enabled=1").get(key.value);
        if (byPhone) return rowToRule(byPhone);
      }
    }
    return null;
  }

  // Callers must test allowed, not merely !excluded: an unreliable or conflicting
  // identity is not an exclusion match, but still cannot authorize CRM writes.
  // Values must be observed aliases of one member, never names or AI guesses.
  function checkIdentity(rawIdentity, context = {}) {
    return checkIdentities([rawIdentity], context);
  }

  function checkIdentities(rawIdentities, context = {}) {
    if (!Array.isArray(rawIdentities) || rawIdentities.length > 32) {
      return { allowed: false, excluded: false, identity: null, identities: [], conflict: false, reason: 'identity-unreliable' };
    }
    const supplied = rawIdentities.filter(value => value != null && value !== '');
    const normalized = supplied.map(normalizeExclusionIdentity);
    const identities = normalized.filter((identity, index) => identity && normalized.findIndex(other => other?.kind === identity.kind && other?.value === identity.value) === index);
    const conflict = ['phone', 'jid', 'opaque'].some(kind => identities.filter(identity => identity.kind === kind).length > 1);
    const matches = identities.map(identity => ({ identity, rule: findRule(identity) })).filter(match => match.rule);
    const uniqueMatches = matches.filter((match, index) => matches.findIndex(other => other.rule.id === match.rule.id) === index);
    const common = { identity: identities[0] || null, identities, conflict };
    if (uniqueMatches.length) {
      const action = ACTIONS.has(context.action) ? context.action : ACTION_AUTO_CREATE_BLOCKED;
      // SQL errors propagate. An unavailable decision or audit store must never
      // be interpreted as permission to create/fill a customer.
      for (const match of uniqueMatches) recordHit(match.rule, match.identity, { ...context, action });
      return { ...common, allowed: false, excluded: true, reason: 'listed', action, rule: uniqueMatches[0].rule };
    }
    if (!identities.length || normalized.some(identity => !identity)) return { ...common, allowed: false, excluded: false, reason: 'identity-unreliable' };
    if (conflict) return { ...common, allowed: false, excluded: false, reason: 'identity-conflict' };
    return { ...common, allowed: true, excluded: false, reason: 'not-listed' };
  }

  function recordHit(rule, identity, context = {}) {
    const action = ACTIONS.has(context.action) ? context.action : ACTION_LOOKUP;
    db.prepare(`INSERT INTO ws_contact_exclusion_hits(id,exclusion_id,account_id,group_jid,member_jid,member_phone,action,evidence_json,created_at,rule_value_snapshot,rule_name_snapshot,rule_kind_snapshot)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      newId('wsx-hit'), rule.id, text(context.accountId, 120) || 'default',
      text(context.groupJid, 180), identity.value, identity.phone || '', action,
      JSON.stringify({ source: text(context.source, 80) || 'exclusion-engine', kind: identity.kind, ruleKind: rule.kind }), nowIso(clock),
      rule.value, rule.displayName, rule.kind,
    );
  }

  function upsertRule(input = {}) {
    const identity = normalizeExclusionIdentity(input.identity || input.phone || input.memberJid || input.value);
    if (!identity) {
      const error = new Error('排除规则需要可用的 WhatsApp 身份（规范化号码、JID 或明确的业务作用域 ID）；昵称和头像不能用于排除。');
      error.code = 'CONTACT_EXCLUSION_INVALID_IDENTITY';
      throw error;
    }
    const source = SOURCES.has(text(input.source, 32)) ? text(input.source, 32) : 'manual';
    const at = nowIso(clock);
    const existing = db.prepare('SELECT * FROM ws_contact_exclusions WHERE identity_kind=? AND identity_value=?').get(identity.kind, identity.value);
    const id = existing?.id || newId('wsx');
    db.prepare(`INSERT INTO ws_contact_exclusions(id,identity_value,identity_kind,identity_phone,display_name,note,source,enabled,created_by,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(identity_kind,identity_value) DO UPDATE SET
        identity_phone=excluded.identity_phone,
        display_name=CASE WHEN excluded.display_name<>'' THEN excluded.display_name ELSE ws_contact_exclusions.display_name END,
        note=CASE WHEN excluded.note<>'' THEN excluded.note ELSE ws_contact_exclusions.note END,
        enabled=excluded.enabled,
        updated_at=excluded.updated_at`).run(
      id, identity.value, identity.kind, identity.phone, text(input.displayName, 240), text(input.note, 500), source,
      input.enabled === false ? 0 : 1, text(input.createdBy, 120), existing?.created_at || at, at,
    );
    return rowToRule(db.prepare('SELECT * FROM ws_contact_exclusions WHERE id=?').get(id));
  }

  function setEnabled(id, enabled) {
    const key = text(id, 128);
    if (!key) throw new Error('缺少排除规则 ID。');
    const at = nowIso(clock);
    const result = db.prepare('UPDATE ws_contact_exclusions SET enabled=?,updated_at=? WHERE id=?').run(enabled ? 1 : 0, at, key);
    if (!result.changes) throw new Error('排除规则不存在。');
    return rowToRule(db.prepare('SELECT * FROM ws_contact_exclusions WHERE id=?').get(key));
  }

  function removeRule(id) {
    const key = text(id, 128);
    if (!key) throw new Error('缺少排除规则 ID。');
    return db.prepare('DELETE FROM ws_contact_exclusions WHERE id=?').run(key).changes > 0;
  }

  function listHits({ limit = 50 } = {}) {
    const size = Math.min(500, Math.max(1, Math.floor(Number(limit) || 50)));
    return db.prepare(`SELECT h.*, h.rule_value_snapshot AS rule_value, h.rule_name_snapshot AS rule_name
      FROM ws_contact_exclusion_hits h
      ORDER BY h.created_at DESC, h.id LIMIT ?`).all(size).map(row => ({
      id: text(row.id, 128),
      exclusionId: text(row.exclusion_id, 128),
      ruleValue: text(row.rule_value, 240),
      ruleName: text(row.rule_name, 240),
      accountId: text(row.account_id, 120),
      groupJid: text(row.group_jid, 180),
      memberJid: text(row.member_jid, 240),
      memberPhone: text(row.member_phone, 32),
      action: text(row.action, 40),
      createdAt: text(row.created_at, 40),
    }));
  }

  function summary() {
    const row = db.prepare("SELECT COUNT(*) AS total, SUM(CASE WHEN enabled=1 THEN 1 ELSE 0 END) AS enabled FROM ws_contact_exclusions").get();
    const hits = db.prepare('SELECT COUNT(*) AS count FROM ws_contact_exclusion_hits').get();
    return { total: Number(row?.total || 0), enabled: Number(row?.enabled || 0), hits: Number(hits?.count || 0) };
  }

  return { listRules, findRule, checkIdentity, checkIdentities, recordHit, upsertRule, setEnabled, removeRule, listHits, summary, normalizeExclusionIdentity };
}

module.exports = Object.freeze({
  createExclusionEngine,
  normalizeExclusionIdentity,
  candidateKeys,
  ACTION_AUTO_CREATE_BLOCKED,
  ACTION_AUTO_FILL_BLOCKED,
  ACTION_LOOKUP,
});
