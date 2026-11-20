'use strict';
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { mkdtempSync, rmSync } = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { DatabaseSync } = require('node:sqlite');

const app = path.join(__dirname, '../resources/app');
const data = mkdtempSync(path.join(os.tmpdir(), 'zhike-vip-member-alerts-'));
const port = 30000 + (process.pid % 18000);
const token = 'isolated-vip-member-alerts';
const headers = { 'content-type':'application/json', 'x-zhike-api-token':token };
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
let child, logs = '';

async function call(route, body, expected = 200) {
  const version = await fetch(`http://127.0.0.1:${port}/api/state/version`, { headers }).then(response => response.json());
  const response = await fetch(`http://127.0.0.1:${port}${route}`, {
    method:body === undefined ? 'GET' : 'POST',
    headers:{ ...headers, 'x-state-version':version.version },
    body:body === undefined ? undefined : JSON.stringify(body),
  });
  const result = await response.json();
  assert.equal(response.status, expected, JSON.stringify(result));
  return result;
}
async function start() {
  child = spawn(process.env.ZHIKE_TEST_NODE || process.execPath, ['server.mjs'], {
    cwd:app,
    env:{ ...process.env, ZHIKE_DATA_DIR:data, ZHIKE_PORT:String(port), ZHIKE_API_TOKEN:token, ZHIKE_SHUTDOWN_TOKEN:token },
    windowsHide:true, stdio:['ignore','pipe','pipe'],
  });
  child.stdout.on('data', value => logs += value);
  child.stderr.on('data', value => logs += value);
  for (let attempt = 0; attempt < 1000; attempt++) {
    try { await call('/api/health'); return; }
    catch { if (child.exitCode !== null) break; await wait(30); }
  }
  throw Error(`isolated server did not start: ${logs}`);
}
async function stop() {
  if (!child || child.exitCode !== null) return;
  const exit = new Promise(resolve => child.once('exit', resolve));
  try { await fetch(`http://127.0.0.1:${port}/api/shutdown`, { method:'POST', headers:{ ...headers, 'x-zhike-shutdown-token':token } }); } catch {}
  if (!await Promise.race([exit.then(() => true), wait(3000).then(() => false)])) { child.kill(); await exit; }
}
function inspect(fn) {
  const db = new DatabaseSync(path.join(data, 'workspace.sqlite'), { readOnly:true });
  try { return fn(db); } finally { db.close(); }
}

(async () => { try {
  await start();
  await call('/api/state', {
    customers:[{ id:'C1', name:'Member One', phone:'9876543210' }, { id:'C2', name:'Member Two', phone:'1111111111' }, { id:'C3', name:'Direct Customer', phone:'9876000000' }],
    settings:{ operatingTasks:[] }, tickets:[], deposits:[], followups:[], activities:[],
  });
  await call('/api/ws/ingest/batch', {
    checkpoints:[{ conversationKey:'vip-two-members@g.us', conversationType:'vip_group', vipGroup:true, isGroup:true, displayName:'VIP Two Members', unreadCount:0, historyLoaded:true, historyMessageCount:2, coverage:'read-history', directionVersion:4, directionUnresolvedCount:0, historyFingerprint:'vip-list', lastMessageFingerprint:'vip-list' }],
    messages:[
      { conversationKey:'vip-two-members@g.us', conversationType:'vip_group', externalMessageId:'member-one', body:'I manage a shop', direction:'incoming', directionSource:'class-message-in', senderId:'919876543210@c.us', senderPhone:'9876543210', senderName:'Member One', senderIdentitySource:'sender-jid', sentAt:'2026-11-13T10:01:00Z' },
      { conversationKey:'vip-two-members@g.us', conversationType:'vip_group', externalMessageId:'member-two', body:'I work in banking', direction:'incoming', directionSource:'class-message-in', senderId:'911111111111@c.us', senderPhone:'1111111111', senderName:'Member Two', senderIdentitySource:'sender-jid', sentAt:'2026-11-13T10:02:00Z' },
    ],
  });
  const group = (await call('/api/ws/conversations')).conversations.find(item => item.externalId === 'vip-two-members@g.us');
  assert.ok(group);
  const one = { senderId:'919876543210@c.us', senderPhone:'9876543210', senderName:'Member One', identitySource:'sender-jid', trusted:true };
  const two = { senderId:'911111111111@c.us', senderPhone:'1111111111', senderName:'Member Two', identitySource:'sender-jid', trusted:true };
  async function analyzeMember(identity, label, priorityScore) {
    const occupation = identity.senderPhone === '9876543210' ? { value:'Shop manager', evidence:'I manage a shop' } : { value:'Banker', evidence:'I work in banking' };
    const analysis = await call('/api/ws/analyses', { conversationId:group.id, result:{
      summary:label, confidence:.9, memberIdentity:identity,
      transcriptInfo:{ memberScoped:true, memberIdentity:identity, directionVersion:4 },
      profileFacts:{ occupation:{ ...occupation, state:'known', confidence:.9, sourceRole:'customer' } },
      followupStrategy:{ shouldFollowUp:true, priorityScore, qualificationScore:75, engagementScore:80, scoreConfidence:.9, reason:`Follow up ${label}`, objective:'Discuss needs' },
    }, confidence:.9 });
    const synced = await call('/api/ws/crm-sync', { conversationId:group.id, analysisId:analysis.id });
    assert.equal(synced.matched, true, JSON.stringify(synced));
    assert.ok(synced.task, 'member analysis creates a task');
    return { analysis, synced };
  }
  const first = await analyzeMember(one, 'First member', 91);
  const second = await analyzeMember(two, 'Second member', 84);
  assert.notEqual(first.synced.task.id, second.synced.task.id, 'two members of one VIP group need separate tasks');
  assert.deepEqual(new Set((await call('/api/state')).settings.operatingTasks.filter(item => item.aiGenerated).map(item => item.customerId)), new Set(['C1','C2']));
  let alerts = (await call('/api/ws/followup-alerts?allAccounts=1&limit=10')).alerts;
  assert.equal(alerts.length, 2, 'both member analyses must appear in reminders');
  assert.deepEqual(alerts.map(item => item.customerId), ['C1','C2'], 'equal urgency sorts by priority score');
  assert.equal(new Set(alerts.map(item => item.alertKey)).size, 2, 'alert identity includes VIP member');
  const initialAlertIds = new Map(alerts.map(item => [item.customerId, item.id]));
  const initialUpdated = inspect(db => db.prepare('SELECT alert_key,updated_at FROM ws_followup_alerts').all());
  await wait(20);
  await call('/api/ws/followup-alerts?allAccounts=1&limit=10');
  assert.deepEqual(inspect(db => db.prepare('SELECT alert_key,updated_at FROM ws_followup_alerts').all()), initialUpdated, 'unchanged polling must not rewrite alerts');
  const repeated = await call('/api/ws/crm-sync', { conversationId:group.id, analysisId:first.analysis.id });
  assert.equal(repeated.duplicate, true);
  assert.equal(repeated.task.id, first.synced.task.id, 'same analysis is idempotent');
  const newerFirst = await analyzeMember(one, 'First member updated', 95);
  assert.equal(newerFirst.synced.task.id, first.synced.task.id, 'new analysis reuses only the same member task');
  assert.notEqual(newerFirst.synced.task.id, second.synced.task.id);
  const tasks = (await call('/api/state')).settings.operatingTasks.filter(item => item.aiGenerated);
  assert.equal(tasks.length, 2, 'new analysis does not duplicate tasks');
  assert.equal(tasks.find(item => item.customerId === 'C2').wsAnalysisId, second.analysis.id, 'other member task remains intact');
  alerts = (await call('/api/ws/followup-alerts?allAccounts=1&limit=10')).alerts;
  assert.equal(alerts.length, 2);
  assert.equal(alerts.find(item => item.customerId === 'C1').analysisId, newerFirst.analysis.id);
  assert.equal(alerts.find(item => item.customerId === 'C2').analysisId, second.analysis.id);
  assert.equal(alerts.find(item => item.customerId === 'C1').id, initialAlertIds.get('C1'), 'new analysis updates the member alert');
  assert.equal(alerts.find(item => item.customerId === 'C2').id, initialAlertIds.get('C2'), 'other member alert remains intact');
  const direct = await call('/api/ws/conversations', { externalId:'9876000000', title:'Direct Customer', conversationType:'direct', unreadCount:0, data:{ conversationType:'direct', historyLoaded:true, historyFingerprint:'direct-history', lastMessageFingerprint:'direct-history', directionVersion:4 } });
  const directAnalysis = await call('/api/ws/analyses', { conversationId:direct.id, result:{ summary:'Direct customer asks for a call', confidence:.9, profileFacts:{ occupation:{ value:'Synthetic shopkeeper', state:'known', confidence:.9, evidence:'I run a synthetic shop', sourceRole:'customer' } }, followupStrategy:{ shouldFollowUp:true, priorityScore:55, reason:'Customer requested a call', objective:'Return call' } }, confidence:.9 });
  const directState = await call('/api/state');
  directState.settings.operatingTasks.unshift({ id:'legacy-direct-task', aiGenerated:true, wsAccountId:'default', wsConversationId:direct.id, customerId:'C3', due:'2020-01-01', done:false, status:'open' });
  await call('/api/state', directState);
  alerts = (await call('/api/ws/followup-alerts?allAccounts=1&limit=10')).alerts;
  assert.deepEqual(alerts.map(item => item.customerId), ['C3','C1','C2'], 'overdue direct fallback precedes VIP priority scoring');
  assert.equal(alerts[0].taskId, 'legacy-direct-task', 'ordinary direct chats retain conversation-only task fallback');
  // Historical vip_group rows remain readable; exclusion is a group-member
  // auto-fill gate and never a ban on ordinary direct CRM maintenance.
  await call('/api/ws/contact-exclusions', { identity: one.senderPhone, displayName: 'Synthetic excluded staff' }, 201);
  const beforeBlockedSync = await call('/api/state');
  const blockedSync = await call('/api/ws/crm-sync', { conversationId: group.id, analysisId: newerFirst.analysis.id });
  assert.equal(blockedSync.excluded, true);
  assert.equal(blockedSync.code, 'CONTACT_EXCLUDED');
  assert.equal(blockedSync.skipped, true);
  assert.deepEqual(await call('/api/state'), beforeBlockedSync, 'excluded member sync does not mutate CRM or tasks');
  const hits = await call('/api/ws/contact-exclusions/hits');
  assert.ok(hits.hits.some(hit => hit.action === 'auto-fill-blocked' && hit.memberPhone === one.senderPhone));
  async function analyzeObservedAliases(key, phones, phoneOnly = false) {
    const senderId = '123456789012345@lid';
    await call('/api/ws/ingest/batch', {
      checkpoints: [{ conversationKey:key, conversationType:'vip_group', vipGroup:true, isGroup:true, unreadCount:0,
        historyLoaded:true, historyMessageCount:phones.length, coverage:'read-history', directionVersion:4,
        directionUnresolvedCount:0, historyFingerprint:key, lastMessageFingerprint:key }],
      messages: phones.map((phone, index) => ({ conversationKey:key, conversationType:'vip_group',
        externalMessageId:key + '-' + index, body:'I manage a synthetic shop', direction:'incoming',
        directionSource:'class-message-in', senderId, senderPhone:phone, senderIdentitySource:'sender-jid',
        sentAt:'2026-11-13T10:05:00Z' })),
    });
    const conversation = (await call('/api/ws/conversations')).conversations.find(row => row.externalId === key);
    const identity = phoneOnly ? { senderPhone: phones[0], identitySource:'sender-phone' } : { senderId, identitySource:'sender-jid' }; // intentionally omits a trusted alias
    const analysis = await call('/api/ws/analyses', { conversationId:conversation.id, result:{
      summary:'Synthetic alias evidence', confidence:.9, memberIdentity:identity,
      transcriptInfo:{ memberScoped:true, memberIdentity:identity, directionVersion:4 },
      profileFacts:{ occupation:{ value:'Synthetic shopkeeper', evidence:'I manage a synthetic shop', state:'known', confidence:.9, sourceRole:'customer' } },
    }, confidence:.9 });
    const before = await call('/api/state');
    const result = await call('/api/ws/crm-sync', { conversationId:conversation.id, analysisId:analysis.id });
    assert.deepEqual(await call('/api/state'), before, 'failed observed-alias gates never mutate CRM');
    return result;
  }
  const omittedPhone = await analyzeObservedAliases('legacy-excluded-alias@g.us', ['9876543210']);
  assert.equal(omittedPhone.code, 'CONTACT_EXCLUDED', 'omitting an observed phone cannot bypass exclusion');
  const conflictingPhones = await analyzeObservedAliases('legacy-conflicting-alias@g.us', ['8000000001', '8000000002']);
  assert.equal(conflictingPhones.code, 'CONTACT_IDENTITY_UNRELIABLE', 'conflicting observed phone aliases stay unconfirmed');
  const phoneOnly = await analyzeObservedAliases('legacy-phone-only-alias@g.us', ['8000000003', '9876543210'], true);
  assert.equal(phoneOnly.code, 'CONTACT_EXCLUDED', 'phone-only requests must traverse observed LID aliases before deciding');
  const phoneOnlyConflict = await analyzeObservedAliases('legacy-phone-only-conflict@g.us', ['8000000004', '8000000005'], true);
  assert.equal(phoneOnlyConflict.code, 'CONTACT_IDENTITY_UNRELIABLE', 'phone-only requests cannot hide a conflicting observed phone');
  await call('/api/ws/contact-exclusions', { identity: '9876000000', displayName: 'Synthetic direct staff' }, 201);
  const directSync = await call('/api/ws/crm-sync', { conversationId: direct.id, analysisId: directAnalysis.id });
  assert.equal(directSync.matched, true, JSON.stringify(directSync));
  assert.notEqual(directSync.excluded, true, 'ordinary direct maintenance is outside group exclusion scope');
  console.log('Legacy group member reminders and exclusion: per-member tasks, immutable blocked CRM, direct maintenance PASS');
} finally { await stop(); rmSync(data, { recursive:true, force:true }); } })().catch(error => { console.error(error); process.exitCode = 1; });
