'use strict';

// Offline, explicitly scoped maintenance. No messages or customers are removed.
const { DatabaseSync, backup } = require('node:sqlite');
const { randomUUID } = require('node:crypto');
const { resolve, dirname, join } = require('node:path');
const { existsSync, mkdirSync } = require('node:fs');
const { isDeepStrictEqual: equal } = require('node:util');
const SOURCE = 'WS direction repair v4';
const REASON = '消息收发方向未经核实，撤回旧 AI 补档并等待双向重采。';
const parse = (text, fallback = {}) => { try { return JSON.parse(text); } catch { return fallback; } };
const clone = value => JSON.parse(JSON.stringify(value));
const containsAny = (value, ids) => [...ids].some(id => String(value || '').includes(id));
const placeholders = values => values.map(() => '?').join(',');

function buildPlan(db, baseline, { since, until = new Date().toISOString(), now = new Date().toISOString() }) {
  if (!since || !Number.isFinite(Date.parse(since)) || !Number.isFinite(Date.parse(until)) || Date.parse(since) > Date.parse(until)) throw new Error('Invalid explicit repair time range.');
  since = new Date(since).toISOString(); until = new Date(until).toISOString();
  const candidates = db.prepare(`SELECT a.* FROM ws_ai_analyses a WHERE a.created_at>=? AND a.created_at<=?
    AND EXISTS(SELECT 1 FROM ws_messages m WHERE m.account_id=a.account_id AND m.conversation_id=a.conversation_id AND json_extract(m.data_json,'$.source')='ws-webview2' AND (COALESCE(json_extract(m.data_json,'$.directionVersion'),0)<4 OR COALESCE(json_extract(m.data_json,'$.directionSource'),'')=''))
    ORDER BY a.created_at,a.id`).all(since, until);
  const repairedIds = new Set(db.prepare("SELECT analysis_id FROM customer_governance_actions WHERE action='restore' AND source=?").all(SOURCE).map(r => r.analysis_id));
  const analyses = candidates.filter(row => Number(parse(row.result_json).transcriptInfo?.directionVersion || 0) < 4 && !repairedIds.has(row.id) && row.error_message !== REASON);
  return buildScopedPlan(db, baseline, { since, until, now, analyses });
}

// Shared mechanics only. Each maintenance entry point must supply its own
// explicit, independently verified selection; the direction CLI still rejects v4.
function buildScopedPlan(db, baseline, { since, until, now, analyses, source = SOURCE, reason = REASON, kind = 'direction', protectedFields = new Map() }) {
  const envelope = db.prepare('SELECT json,revision FROM app_state WHERE id=1').get();
  if (!envelope) throw new Error('Application state is missing.');
  const state = parse(envelope.json, null);
  if (!state || !Array.isArray(state.customers)) throw new Error('Application state is invalid.');
  const beforeIds = state.customers.map(c => String(c.id)).sort();
  if (new Set(beforeIds).size !== beforeIds.length) throw new Error('Customer IDs are not unique.');
  const analysisIds = new Set(analyses.map(row => row.id));
  const actions = db.prepare("SELECT * FROM customer_governance_actions WHERE action='update' AND source='WS AI' AND created_at>=? AND created_at<=? ORDER BY created_at DESC,id DESC").all(since, until).filter(row => analysisIds.has(row.analysis_id));
  const baselineState = parse(baseline.prepare('SELECT json FROM app_state WHERE id=1').get()?.json, null);
  const baselineIds = new Set((baselineState?.customers || []).map(c => String(c.id)));
  if (!Array.isArray(baselineState?.customers) || actions.some(a => !baselineIds.has(String(a.customer_id)))) throw new Error('The explicit baseline does not contain the affected customer identities.');
  const customerMap = new Map(state.customers.map(c => [String(c.id), c]));
  const changes = [], conflicts = [];
  for (const action of actions) {
    const customer = customerMap.get(String(action.customer_id));
    if (!customer) { conflicts.push({ kind: 'missing-customer' }); continue; }
    const before = parse(action.before_json), after = parse(action.after_json), original = clone(customer);
    let restored = 0;
    for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
      if (key === 'id' || equal(before[key], after[key])) continue;
      if (protectedFields.get(String(action.customer_id))?.has(key)) { conflicts.push({ kind: 'verified-later-field', field: key }); continue; }
      if (!equal(customer[key], after[key]) || Object.hasOwn(customer, key) !== Object.hasOwn(after, key)) { conflicts.push({ kind: 'later-edit', field: key }); continue; }
      if (Object.hasOwn(before, key)) customer[key] = clone(before[key]); else delete customer[key];
      restored++;
    }
    changes.push({ customerId: String(action.customer_id), analysisId: action.analysis_id, before: original, after: clone(customer), restored });
  }
  let dismissedTasks = 0, protectedCompletedTasks = 0;
  for (const task of state.settings?.operatingTasks || []) {
    if (!task.aiGenerated || !analysisIds.has(String(task.wsAnalysisId || ''))) continue;
    if (task.done && (task.status === 'completed' || task.completedAt)) { protectedCompletedTasks++; continue; }
    Object.assign(task, { done: true, status: 'dismissed', [kind + 'Invalidated']: true, invalidationReason: reason, updatedAt: now });
    dismissedTasks++;
  }
  for (const activity of state.activities || []) if (analysisIds.has(String(activity.analysisId || '')) && activity.source === 'ws-ai-sync') {
    activity[kind + 'Invalidated'] = true;
    activity.text = kind === 'identity' ? 'WS AI 客户关联因身份未匹配已撤回，聊天分析已保留。' : 'WS AI 补档因消息方向未核实已撤回，等待重新分析。';
  }
  const events = analysisIds.size ? db.prepare(`SELECT * FROM hot_chat_events WHERE analysis_id IN (${placeholders([...analysisIds])}) AND event_type='analysis_profile'`).all(...analysisIds) : [];
  const profiles = [];
  for (const profileId of new Set(events.map(r => r.profile_id))) {
    const current = db.prepare('SELECT * FROM hot_chat_profiles WHERE id=?').get(profileId);
    if (!current) continue;
    const original = baseline.prepare('SELECT * FROM hot_chat_profiles WHERE id=?').get(profileId);
    const fields = db.prepare('SELECT * FROM hot_chat_profile_fields WHERE profile_id=?').all(profileId);
    const baselineFields = new Map(baseline.prepare('SELECT * FROM hot_chat_profile_fields WHERE profile_id=?').all(profileId).map(r => [r.field_key, r]));
    const related = actions.filter(a => events.some(e => e.profile_id === profileId && e.analysis_id === a.analysis_id));
    const cutoff = related.map(a => a.created_at).sort().at(-1) || until;
    const badFacts = events.filter(e => e.profile_id === profileId).flatMap(e => parse(e.payload_json).facts || []);
    const fieldPlans = [];
    for (const field of fields) {
      const prior = baselineFields.get(field.field_key);
      const value = parse(field.value_json, null);
      // Historical normalized hot-chat facts dropped analysisId inside their
      // evidence. The enclosing immutable event still binds the exact field,
      // normalized value and state to the affected analysis.
      const evidence = parse(field.evidence_json, []);
      const allEvidenceFromSelectedEvents = Array.isArray(evidence) && evidence.length > 0 && evidence.every(row => badFacts.some(fact => fact.field === field.field_key && equal(fact.value,row.value) && String(fact.evidence || '') === String(row.text || row.evidence || '')));
      const wasAiWrite = containsAny(field.evidence_json, analysisIds) || allEvidenceFromSelectedEvents || badFacts.some(fact => fact.field === field.field_key && equal(fact.value, value) && fact.state === field.state);
      const emptyAutoField = !prior && field.state === 'missing' && (value == null || value === '' || Array.isArray(value) && !value.length);
      if (field.manual_locked || field.updated_at > cutoff || (!wasAiWrite && !emptyAutoField)) { if (!equal(field, prior)) conflicts.push({ kind: 'protected-profile-field', field: field.field_key }); continue; }
      fieldPlans.push({ current: field, prior: prior || null });
    }
    const canResetMetadata = !current.manual_locked && !current.manual_color && current.updated_at <= cutoff && fieldPlans.length === fields.length;
    profiles.push({ current, original: original || null, fields: fieldPlans, canResetMetadata });
  }
  const afterIds = state.customers.map(c => String(c.id)).sort();
  if (!equal(beforeIds, afterIds)) throw new Error('Repair attempted to change customer identity set.');
  return { envelope, state, analyses, analysisIds, actions, changes, events, profiles, since, until, now, source, reason, kind,
    summary: { analyses: analyses.length, auditedUpdates: actions.length, customers: new Set(changes.map(r => r.customerId)).size, fieldsRestored: changes.reduce((n,r) => n+r.restored,0), conflicts: conflicts.length, dismissedTasks, protectedCompletedTasks, profiles: profiles.length, profileFieldsRestored: profiles.reduce((n,p) => n+p.fields.length,0), customerCount: beforeIds.length }, conflicts };
}

function applyPlan(db, plan, { failAt = '', additionalWrites = () => {} } = {}) {
  if (!plan.analyses.length) return { applied: false, ...plan.summary };
  db.exec('BEGIN IMMEDIATE');
  try {
    const current = db.prepare('SELECT json,revision FROM app_state WHERE id=1').get();
    if (current.json !== plan.envelope.json || current.revision !== plan.envelope.revision) throw new Error('Application state changed after planning; no repair applied.');
    for (const change of plan.changes) {
      db.prepare(`INSERT INTO customer_governance_actions(id,customer_id,action,reason,source,confidence,analysis_id,before_json,after_json,created_at) VALUES(?,?,'restore',?,?,0,?,?,?,?)`)
        .run('cga-repair-'+randomUUID(), change.customerId, plan.reason, plan.source, change.analysisId, JSON.stringify(change.before), JSON.stringify(change.after), plan.now);
    }
    db.prepare('UPDATE app_state SET json=?,revision=revision+1,updated_at=? WHERE id=1').run(JSON.stringify(plan.state), plan.now);
    const projection = db.prepare('UPDATE customers SET phone_normalized=?,name=?,source=?,assistant=?,status=?,stage=?,deleted=?,data_json=? WHERE id=?');
    for (const id of new Set(plan.changes.map(r => r.customerId))) {
      const c = plan.state.customers.find(row => String(row.id) === id);
      const result = projection.run(String(c.phone || ''), String(c.name || ''), String(c.source || ''), String(c.assistant || ''), String(c.status || ''), String(c.phase || ''), c.deleted ? 1 : 0, JSON.stringify(c), id);
      if (Number(result.changes) !== 1) throw new Error('Customer projection missing; repair rolled back.');
    }
    if (failAt === 'state') throw new Error('Injected repair failure.');
    for (const analysis of plan.analyses) {
      db.prepare('UPDATE ws_ai_analyses SET error_message=?,updated_at=? WHERE id=?').run(plan.reason, plan.now, analysis.id);
      db.prepare('UPDATE ai_jobs SET status=?,locked_at=\'\',next_attempt_at=\'\',last_error=?,updated_at=? WHERE analysis_id=?').run(plan.kind === 'identity' ? 'completed' : 'failed', plan.reason, plan.now, analysis.id);
      db.prepare("UPDATE ai_customer_field_evidence SET status='rejected',updated_at=? WHERE analysis_id=?").run(plan.now, analysis.id);
      db.prepare("UPDATE ws_followup_alerts SET status='dismissed',data_json=json_set(data_json,?,json('true')),updated_at=? WHERE analysis_id=? AND status<>'done'").run('$.' + plan.kind + 'Invalidated',plan.now, analysis.id);
    }
    for (const profile of plan.profiles) {
      for (const { current: field, prior } of profile.fields) {
        if (!prior) db.prepare('DELETE FROM hot_chat_profile_fields WHERE id=?').run(field.id);
        else db.prepare('UPDATE hot_chat_profile_fields SET value_json=?,state=?,confidence=?,evidence_json=?,manual_locked=?,updated_at=? WHERE id=?').run(prior.value_json,prior.state,prior.confidence,prior.evidence_json,prior.manual_locked,plan.now,field.id);
      }
      if (profile.canResetMetadata) db.prepare('UPDATE hot_chat_profiles SET status_color=?,completeness=?,data_json=?,version=version+1,updated_at=? WHERE id=?').run(profile.original?.status_color || 'gray',profile.original?.completeness || 0,profile.original?.data_json || '{}',plan.now,profile.current.id);
    }
    for (const event of plan.events) {
      const payload = { ...parse(event.payload_json), [plan.kind + 'Invalidated']: true, originalEventType: 'analysis_profile', repairedAt: plan.now };
      db.prepare("UPDATE hot_chat_events SET event_type='analysis_profile_invalidated',payload_json=? WHERE id=?").run(JSON.stringify(payload),event.id);
      db.prepare("UPDATE hot_chat_sync_outbox SET status='sent',next_attempt_at='',last_error=?,updated_at=? WHERE event_id=?").run(plan.kind + '_unverified_cancelled',plan.now,event.id);
    }
    if (failAt === 'effects') throw new Error('Injected repair failure.');
    additionalWrites();
    const expected = plan.state.customers.map(c => String(c.id)).sort();
    const actual = db.prepare('SELECT id FROM customers ORDER BY id').all().map(c => String(c.id)).sort();
    if (!equal(actual,expected)) throw new Error('Customer identity invariant failed; repair rolled back.');
    if (db.prepare('PRAGMA foreign_key_check').all().length) throw new Error('Foreign key invariant failed; repair rolled back.');
    db.exec('COMMIT');
    return { applied: true, ...plan.summary };
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}

async function main(argv = process.argv.slice(2)) {
  const options = {};
  for (let i=0;i<argv.length;i++) {
    if (argv[i] === '--apply') options.apply=true;
    else if (['--db','--baseline','--since','--until'].includes(argv[i])) options[argv[i].slice(2)] = argv[++i];
    else throw new Error('Unsupported repair argument.');
  }
  if (!options.db || !options.baseline || !options.since) throw new Error('Required: --db <file> --baseline <pre-AI backup> --since <ISO time> [--until <ISO time>] [--apply].');
  const dbPath=resolve(options.db), baselinePath=resolve(options.baseline);
  if (dbPath===baselinePath || !existsSync(dbPath) || !existsSync(baselinePath)) throw new Error('Explicit database and distinct baseline must exist.');
  if (options.apply && existsSync(join(dirname(dbPath),'.workbench.lock'))) throw new Error('Close the desktop application before applying an offline repair.');
  const db = new DatabaseSync(dbPath,{readOnly:!options.apply}), baseline = new DatabaseSync(baselinePath,{readOnly:true});
  try {
    db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000');
    let plan = buildPlan(db,baseline,options);
    if (!options.apply) { console.log(JSON.stringify({ mode:'dry-run',...plan.summary },null,2)); return; }
    let backupPath='';
    if (plan.analyses.length) {
      const dir=join(dirname(dbPath),'backups','pre-ws-direction-repair-'+Date.now());mkdirSync(dir,{recursive:true});backupPath=join(dir,'workspace.sqlite');await backup(db,backupPath);
      plan=buildPlan(db,baseline,options);
    }
    console.log(JSON.stringify({mode:'apply',backupCreated:Boolean(backupPath),backupPath,...applyPlan(db,plan)},null,2));
  } finally { baseline.close();db.close(); }
}
module.exports={buildPlan,buildScopedPlan,applyPlan,main,SOURCE,REASON};
if (require.main===module) main().catch(()=>{console.error('Direction repair failed; no sensitive details are logged. Review the explicit paths, time range, backup, and application shutdown state.');process.exitCode=1;});
