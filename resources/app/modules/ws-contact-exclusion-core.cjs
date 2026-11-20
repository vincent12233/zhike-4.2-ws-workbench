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

const path = require('node:path');
const crypto = require('node:crypto');
const monitor = require('./ws-group-monitor-core.js');

const ACTION_AUTO_CREATE_BLOCKED = 'auto-create-blocked';
const ACTION_AUTO_FILL_BLOCKED = 'auto-fill-blocked';
const ACTION_LOOKUP = 'lookup';
const ACTIONS = new Set([ACTION_AUTO_CREATE_BLOCKED, ACTION_AUTO_FILL_BLOCKED, ACTION_LOOKUP]);

const SOURCES = new Set(['manual', 'import', 'hit-log']);
const KINDS = new Set(['phone', 'jid', 'opaque']);

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
  const identity = monitor.normalizeMemberIdentity(value);
  if (!identity.value) return null;
  if (identity.kind === 'group') return null; // a group JID is not an excludable person
  // A bare display name normalizes to a fake jid (no @, no digits). Excluding on
  // it would list whoever happens to share the nickname, so it is refused.
  if (identity.kind === 'jid' && !identity.value.includes('@')) return null;
  if (identity.kind === 'unknown') return null;
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

  const selectEnabled = () => db.prepare('SELECT * FROM ws_contact_exclusions WHERE enabled = 1').all().map(rowToRule);

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

  // The single gate every auto-create/auto-fill path must call first.
  // Returns { excluded:false } when the identity may proceed, or
  // { excluded:true, rule, identity } when it must be skipped. Records a hit row
  // so the directory page can show why a member was skipped.
  function checkIdentity(rawIdentity, context = {}) {
    const identity = normalizeExclusionIdentity(rawIdentity);
    if (!identity) return { excluded: false, identity: null, reason: 'identity-unreliable' };
    const rule = findRule(identity);
    if (!rule) return { excluded: false, identity, reason: 'not-listed' };
    const action = ACTIONS.has(context.action) && context.action !== ACTION_LOOKUP ? context.action : ACTION_AUTO_CREATE_BLOCKED;
    try {
      recordHit(rule, identity, { ...context, action });
    } catch { /* hit logging must never block the exclusion decision itself */ }
    return { excluded: true, identity, rule, reason: 'listed', action };
  }

  function recordHit(rule, identity, context = {}) {
    const action = ACTIONS.has(context.action) ? context.action : ACTION_LOOKUP;
    db.prepare(`INSERT INTO ws_contact_exclusion_hits(id,exclusion_id,account_id,group_jid,member_jid,member_phone,action,evidence_json,created_at)
      VALUES(?,?,?,?,?,?,?,?,?)`).run(
      newId('wsx-hit'), rule.id, text(context.accountId, 120) || 'default',
      text(context.groupJid, 180), identity.value, identity.phone || '', action,
      JSON.stringify({ source: text(context.source, 80) || 'exclusion-engine', kind: identity.kind, ruleKind: rule.kind }), nowIso(clock),
    );
  }

  function upsertRule(input = {}) {
    const identity = normalizeExclusionIdentity(input.identity || input.phone || input.memberJid || input.value);
    if (!identity) throw new Error('排除规则需要可用的 WhatsApp 身份（规范化号码、JID 或业务作用域 ID）；昵称和头像不能用于排除。');
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
    const size = Math.min(500, Math.max(1, Number(limit) || 50));
    return db.prepare(`SELECT h.*, e.identity_value AS rule_value, e.display_name AS rule_name
      FROM ws_contact_exclusion_hits h LEFT JOIN ws_contact_exclusions e ON e.id = h.exclusion_id
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

  return { listRules, findRule, checkIdentity, recordHit, upsertRule, setEnabled, removeRule, listHits, summary, normalizeExclusionIdentity };
}

module.exports = Object.freeze({
  createExclusionEngine,
  normalizeExclusionIdentity,
  candidateKeys,
  ACTION_AUTO_CREATE_BLOCKED,
  ACTION_AUTO_FILL_BLOCKED,
  ACTION_LOOKUP,
});
