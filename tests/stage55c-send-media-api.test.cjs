'use strict';
// Real sidecar + temporary SQLite only. No WhatsApp, AI provider or Worker.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { createServer } = require('node:net');
const { DatabaseSync } = require('node:sqlite');
const app = path.resolve(__dirname, '../resources/app');
// Schema version follows the manifest; a new migration legitimately raises it.
const expectedSchemaVersion = require(path.join(app, 'migrations/manifest.json')).supportedSchemaVersion;
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zhike-stage55c-api-'));
fs.writeFileSync(path.join(root, '.stage55c-api-test'), 'owned-synthetic-only');
const dbPath = path.join(root, 'workspace.sqlite');
const token = crypto.randomBytes(32).toString('hex');
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
let child, endpoint;
const results = [];
const check = async (name, action) => {
  try { await action(); results.push({ name, result: 'PASS' }); console.log('[PASS] ' + name); }
  catch (error) { results.push({ name, result: 'FAIL', reason: error.message }); console.log('[FAIL] ' + name + ': ' + error.message); }
};
async function api(route, body, method = body ? 'POST' : 'GET') {
  const response = await fetch(endpoint + route, { method, headers: { origin: endpoint, 'x-zhike-api-token': token, 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(20000) });
  const value = await response.json(); return { status: response.status, value };
}
const db = action => { const connection = new DatabaseSync(dbPath); try { return action(connection); } finally { connection.close(); } };
const mediaPath = id => db(connection => path.resolve(root, connection.prepare('SELECT storage_path FROM ws_media_assets WHERE id=?').get(id).storage_path));
const upload = async name => { const result = await api('/api/ws/media', { accountId: 'default', fileName: name + '.txt', mimeType: 'text/plain', dataBase64: Buffer.from(name).toString('base64') }); assert.ok([200, 201].includes(result.status)); return result.value.media; };
const plan = (key, media, extra = {}) => api('/api/ws/broadcast', { accountId: 'default', conversationIds: ['c-a'], confirm: true, idempotencyKey: key, originalText: 'synthetic notice', translatedText: 'synthetic translation', targetLanguage: 'English', ...(media ? { payloadKind: 'document', caption: 'synthetic caption', attachments: [{ mediaId: media.id }] } : {}), ...extra });
const readAudit = async id => (await api('/api/ws/send-audit?accountId=default&id=' + encodeURIComponent(id))).value.items[0];
(async () => {
  const probe = createServer(); await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve));
  const port = probe.address().port; await new Promise(resolve => probe.close(resolve)); endpoint = 'http://127.0.0.1:' + port;
  child = spawn(process.env.ZHIKE_TEST_NODE || process.execPath, ['server.mjs'], { cwd: app, windowsHide: true, env: { ...process.env, ZHIKE_DATA_DIR: root, ZHIKE_PORT: String(port), ZHIKE_API_TOKEN: token, ZHIKE_SHUTDOWN_TOKEN: token, ZHIKE_FENCING_MODE: '', ZHIKE_AI_PIPELINE_MODE: '', ZHIKE_STAGE4_MOCK: '', ZHIKE_GROUP_MANAGER_MODE: '', ZHIKE_STAGE3_MOCK: '' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let startupError = ''; child.stderr.on('data', data => { startupError = (startupError + data).slice(-1500); }); child.stdout.on('data', () => {});
  for (let attempt = 0; attempt < 150; attempt++) { try { if ((await api('/api/ws/accounts')).status === 200) break; } catch {} if (child.exitCode != null) throw Error('isolated sidecar startup failed: ' + startupError); await wait(50); if (attempt === 149) throw Error('isolated sidecar startup timeout'); }
  await api('/api/ws/accounts', { id: 'other', displayName: 'synthetic other' });
  for (let index = 0; index < 30; index++) await api('/api/ws/conversations', { id: 'c-' + (index === 0 ? 'a' : index), accountId: 'default', externalId: String(919900000000 + index) + '@c.us', title: 'Synthetic ' + index, data: { conversationType: 'direct' } });

  await check('direct plans and durable attempts require an explicit ordinary account', async () => {
    const id = 'old-send-purpose', conversationIds = ['old-send-conversation'];
    await api('/api/ws/accounts', { id, displayName: 'Synthetic restored account' });
    await api('/api/ws/conversations', { id:conversationIds[0], accountId:id, externalId:'919911111111@c.us', conversationType:'direct' });
    const options = { accountId:id, conversationIds };
    const oldPlan = await plan('existing-purpose-plan', null, options);
    assert.equal(oldPlan.status, 201);
    const auditId = oldPlan.value.dispatch.items[0].id;
    // Simulate a restored legacy queue. The public API cannot change purpose.
    db(c => c.prepare("UPDATE ws_accounts SET workspace_mode='dedicated' WHERE id=?").run(id));
    for (const key of ['existing-purpose-plan', 'new-purpose-plan']) {
      const refused = await plan(key, null, { ...options, workspaceMode:'ordinary' });
      assert.equal(refused.status, 403);
      assert.equal(refused.value.code, 'WS_WORKSPACE_MODE_MISMATCH');
    }
    const noAccount = await plan('missing-purpose-account', null, { accountId:undefined });
    assert.equal(noAccount.status, 400);
    const begin = await api('/api/ws/send', { accountId:id, auditId, action:'begin-attempt', workspaceMode:'ordinary' });
    assert.equal(begin.status, 403);
    const rows = db(c => c.prepare('SELECT status,native_result_json FROM ws_send_audit WHERE account_id=?').all(id));
    assert.equal(rows.length, 1);
    assert.equal(rows[0].status, 'queued');
    assert.equal(JSON.parse(rows[0].native_result_json).sendAttempt, undefined);
  });
  await check('R04 all attachment states retain bytes and references', async () => {
    for (const status of ['queued', 'sending', 'sent', 'failed', 'cancelled']) {
      const media = await upload('reference-' + status), planned = await plan('reference-' + status, media); assert.equal(planned.status, 201);
      db(connection => connection.prepare('UPDATE ws_send_attachments SET status=? WHERE media_id=?').run(status, media.id));
      const storedPath = mediaPath(media.id), result = await api('/api/ws/media/' + media.id + '?accountId=default', null, 'DELETE');
      console.log('[OBSERVED] ' + JSON.stringify({ scenario: 'referenced-media-deletion', referenceState: status, httpStatus: result.status, bytesPreserved: fs.existsSync(storedPath), rowPreserved: Boolean(db(connection => connection.prepare('SELECT id FROM ws_media_assets WHERE id=?').get(media.id))) }));
      assert.equal(fs.existsSync(storedPath), true, status + ' referenced bytes preserved'); assert.equal(result.status, 409, status + ' references must block deletion');
    }
  });
  await check('R04 database failure leaves original bytes intact', async () => {
    const media = await upload('db-failure'), storedPath = mediaPath(media.id);
    db(connection => connection.exec("CREATE TRIGGER stage55c_block_media_tombstone BEFORE UPDATE OF status ON ws_media_assets WHEN NEW.status='deleted' BEGIN SELECT RAISE(ABORT,'synthetic tombstone failure'); END;"));
    try { const result = await api('/api/ws/media/' + media.id + '?accountId=default', null, 'DELETE'); assert.ok(result.status >= 400, 'database failure must not report successful deletion'); assert.equal(fs.existsSync(storedPath), true); assert.equal(db(connection => connection.prepare('SELECT status FROM ws_media_assets WHERE id=?').get(media.id).status), 'ready'); }
    finally { db(connection => connection.exec('DROP TRIGGER stage55c_block_media_tombstone')); }
  });
  await check('R04 cleanup failure has a durable tombstone and explicit retry', async () => {
    const media = await upload('cleanup-failure'), storedPath = mediaPath(media.id);
    // A directory in place of a file gives a real filesystem refusal without
    // changing ACLs, system policies or relying on machine-specific locks.
    fs.unlinkSync(storedPath); fs.mkdirSync(storedPath); fs.writeFileSync(path.join(storedPath, 'synthetic-child'), 'synthetic');
    const result = await api('/api/ws/media/' + media.id + '?accountId=default', null, 'DELETE');
    assert.equal(result.status, 202); assert.equal(result.value.cleanupPending, true);
    const saved = db(connection => connection.prepare('SELECT status,data_json FROM ws_media_assets WHERE id=?').get(media.id)); assert.equal(saved.status, 'deleted'); assert.equal(JSON.parse(saved.data_json).deletion.cleanupPending, true);
    assert.equal((await api('/api/ws/media/' + media.id + '?accountId=default')).status, 410);
    fs.unlinkSync(path.join(storedPath, 'synthetic-child')); fs.rmdirSync(storedPath); fs.writeFileSync(storedPath, 'synthetic restored file');
    const retried = await api('/api/ws/media/' + media.id + '?accountId=default', null, 'DELETE'); assert.equal(retried.status, 200); assert.equal(retried.value.cleanupPending, false); assert.equal(fs.existsSync(storedPath), false);
    assert.equal((await api('/api/ws/media/' + media.id + '?accountId=other', null, 'DELETE')).status, 404);
  });
  await check('R04 legacy audit references and post-cleanup database failure remain recoverable', async () => {
    const referenced = await upload('legacy-media'), planned = await plan('legacy-media', referenced); assert.equal(planned.status, 201);
    db(connection => connection.prepare('DELETE FROM ws_send_attachments WHERE media_id=?').run(referenced.id));
    assert.equal((await api('/api/ws/media/' + referenced.id + '?accountId=default', null, 'DELETE')).status, 409, 'legacy attachment_ids_json remains authoritative evidence');
    assert.equal(fs.existsSync(mediaPath(referenced.id)), true);
    const media = await upload('cleanup-finalize-failure'), storedPath = mediaPath(media.id);
    db(connection => connection.exec("CREATE TRIGGER stage55c_block_cleanup_completion BEFORE UPDATE OF data_json ON ws_media_assets WHEN NEW.status='deleted' AND json_extract(NEW.data_json,'$.deletion.cleanupPending')=0 BEGIN SELECT RAISE(ABORT,'synthetic cleanup completion failure'); END;"));
    try { const result = await api('/api/ws/media/' + media.id + '?accountId=default', null, 'DELETE'); assert.equal(result.status, 202); assert.equal(fs.existsSync(storedPath), false); assert.equal(db(connection => connection.prepare('SELECT status FROM ws_media_assets WHERE id=?').get(media.id).status), 'deleted'); }
    finally { db(connection => connection.exec('DROP TRIGGER stage55c_block_cleanup_completion')); }
    assert.equal((await api('/api/ws/media/' + media.id + '?accountId=default', null, 'DELETE')).status, 200, 'missing bytes after committed tombstone are safely idempotent');
  });
  await check('R01 same-key changed full content is rejected without changing the old plan', async () => {
    const first = await upload('first-content'), second = await upload('second-content');
    const original = await plan('content-fingerprint', first, { conversationIds: ['c-a', 'c-1'] }); assert.equal(original.status, 201);
    for (const changed of [{ attachments: [{ mediaId: second.id }] }, { caption: 'changed caption' }, { targetLanguage: 'Hindi' }, { payloadKind: 'media' }, { translatedText: 'changed translation' }, { conversationIds: ['c-a'] }]) {
      const result = await plan('content-fingerprint', first, { conversationIds: ['c-a', 'c-1'], ...changed }); assert.equal(result.status, 409, 'changed request must not silently restore the old plan'); assert.equal(result.value.code, 'IDEMPOTENCY_CONTENT_CONFLICT');
    }
    const repeated = await plan('content-fingerprint', first, { conversationIds: ['c-1', 'c-a'] }); assert.equal(repeated.status, 200); assert.equal(repeated.value.dispatch.batchId, original.value.dispatch.batchId);
  });
  await check('R01 legacy rows and maximum-length idempotency keys remain compatible', async () => {
    const legacy = await plan('legacy-fingerprint', null, { conversationIds: ['c-a', 'c-1'] }); assert.equal(legacy.status, 201);
    db(connection => { for (const row of legacy.value.dispatch.items) connection.prepare("UPDATE ws_send_audit SET idempotency_key=?,native_result_json='{}' WHERE id=?").run('legacy-fingerprint:' + row.conversationId, row.id); });
    assert.equal((await plan('legacy-fingerprint', null, { conversationIds: ['c-1', 'c-a'] })).status, 200);
    const key = 'x'.repeat(160), created = await plan(key, null, { conversationIds: ['c-a', 'c-1'] }); assert.equal(created.status, 201); assert.equal((await plan(key, null, { conversationIds: ['c-1', 'c-a'] })).status, 200);
    const conflicting = await plan('legacy-fingerprint', null, { originalText: 'different' }); assert.equal(conflicting.status, 409);
  });
  await check('R02 planning 30 targets does not reserve actual send quota', async () => {
    const recipients = Array.from({ length: 30 }, (_, index) => 'c-' + (index === 0 ? 'a' : index));
    const planned = await plan('thirty-planned', null, { conversationIds: recipients }); assert.equal(planned.status, 201); assert.equal(planned.value.dispatch.items.length, 30); assert.equal(planned.value.dispatch.rateLimit.appliesTo, 'begin-attempt');
  });
  await check('R03 begin token, per-attachment outcome, unknown blocking and untrusted receipt rejection', async () => {
    const media = await upload('attempt-media'), planned = await plan('attempt-protocol', media); assert.equal(planned.status, 201); const auditId = planned.value.dispatch.items[0].id;
    const started = await api('/api/ws/send', { accountId: 'default', auditId, action: 'begin-attempt' }); assert.equal(started.status, 200); assert.ok(started.value.attemptId); assert.equal(started.value.audit.deliveryState, 'unknown'); assert.equal(started.value.audit.attemptPhase, 'prepared'); assert.equal(started.value.audit.retryAllowed, false);
    const attemptId = started.value.attemptId, attachmentId = started.value.audit.attachments[0].id;
    assert.equal((await api('/api/ws/send', { accountId: 'default', auditId, action: 'begin-attempt' })).status, 409);
    assert.equal((await api('/api/ws/send', { accountId: 'other', auditId, attemptId, status: 'sending', deliveryState: 'local_attempted' })).status, 404);
    assert.equal((await api('/api/ws/send', { accountId: 'default', auditId, attemptId: 'stale-token', status: 'sending', deliveryState: 'local_attempted', attachmentId })).status, 409);
    assert.equal((await api('/api/ws/send', { accountId: 'default', auditId, attemptId, status: 'sent', deliveryState: 'delivered', nativeConfirmed: true })).status, 422);
    const local = await api('/api/ws/send', { accountId: 'default', auditId, attemptId, status: 'sending', deliveryState: 'local_attempted', attachmentId, nativeResult: { ok: true, deliveryState: 'local_attempted', dispatchAttempted: true, method: 'dom-media' } }); assert.equal(local.status, 200); assert.equal(local.value.audit.attachments[0].deliveryState, 'local_attempted');
    const final = await api('/api/ws/send', { accountId: 'default', auditId, attemptId, status: 'sending', phase: 'completed', deliveryState: 'local_attempted' }); assert.equal(final.status, 200); assert.equal(final.value.audit.deliveryState, 'local_attempted'); assert.equal(final.value.audit.retryAllowed, false);
    assert.equal((await api('/api/ws/send', { accountId: 'default', auditId, action: 'begin-attempt' })).status, 409);
    assert.equal((await api('/api/ws/send', { accountId: 'default', auditId, attemptId, status: 'failed', deliveryState: 'failed' })).status, 409, 'late failure cannot downgrade a locally attempted result into retryable');
    assert.equal((await readAudit(auditId)).deliveryState, 'local_attempted');
  });
  await check('R03 concurrent begin grants one token and a proven preflight failure can retry safely', async () => {
    const planned = await plan('concurrent-attempt', null); assert.equal(planned.status, 201); const auditId = planned.value.dispatch.items[0].id;
    assert.equal(planned.value.dispatch.items[0].deliveryState, 'queued'); assert.equal(planned.value.dispatch.items[0].retryAllowed, true);
    const starts = await Promise.all(Array.from({ length: 5 }, () => api('/api/ws/send', { accountId: 'default', auditId, action: 'begin-attempt' })));
    assert.equal(starts.filter(row => row.status === 200).length, 1); assert.equal(starts.filter(row => row.status === 409).length, 4);
    const attemptId = starts.find(row => row.status === 200).value.attemptId;
    const failed = await api('/api/ws/send', { accountId: 'default', auditId, attemptId, status: 'failed', deliveryState: 'failed', phase: 'completed', nativeResult: { ok: false, deliveryState: 'failed', notAttempted: true, phase: 'preflight', dispatchAttempted: false } }); assert.equal(failed.status, 200); assert.equal(failed.value.audit.retryAllowed, true);
    const retried = await api('/api/ws/send', { accountId: 'default', auditId, action: 'begin-attempt' }); assert.equal(retried.status, 200); assert.notEqual(retried.value.attemptId, attemptId);
    assert.equal((await api('/api/ws/send', { accountId: 'default', auditId, attemptId, status: 'sending', deliveryState: 'unknown' })).status, 409, 'old attempt cannot change its replacement');
    assert.equal((await api('/api/ws/send', { accountId: 'default', auditId, attemptId: retried.value.attemptId, status: 'failed', deliveryState: 'failed' })).status, 409, 'a generic failure is not preflight evidence');
  });
  await check('R03 partial attachment attempt plus later failure is unknown and cannot resend', async () => {
    const first = await upload('partial-first'), second = await upload('partial-second'), planned = await plan('partial-attempt', first, { attachments: [{ mediaId: first.id }, { mediaId: second.id }] }); assert.equal(planned.status, 201);
    const auditId = planned.value.dispatch.items[0].id, begin = await api('/api/ws/send', { accountId: 'default', auditId, action: 'begin-attempt' }); assert.equal(begin.status, 200);
    const attemptId = begin.value.attemptId, attachments = begin.value.audit.attachments;
    assert.equal((await api('/api/ws/send', { accountId: 'default', auditId, attemptId, status: 'sending', deliveryState: 'local_attempted', phase: 'in-progress', attachmentId: attachments[0].id, nativeResult: { ok: true, deliveryState: 'local_attempted', dispatchAttempted: true } })).status, 200);
    const partial = await api('/api/ws/send', { accountId: 'default', auditId, attemptId, status: 'failed', deliveryState: 'failed', phase: 'in-progress', attachmentId: attachments[1].id, nativeResult: { ok: false, deliveryState: 'failed', notAttempted: true, phase: 'preflight', dispatchAttempted: false } });
    assert.equal(partial.status, 200); assert.equal(partial.value.audit.deliveryState, 'unknown'); assert.equal(partial.value.audit.retryAllowed, false); assert.deepEqual(partial.value.audit.attachments.map(row => row.deliveryState), ['local_attempted', 'failed']);
    const finalBody = { accountId: 'default', auditId, attemptId, status: 'sending', deliveryState: 'unknown', phase: 'completed' };
    assert.equal((await api('/api/ws/send', finalBody)).status, 200); const repeated = await api('/api/ws/send', finalBody); assert.equal(repeated.status, 200); assert.equal(repeated.value.existed, true);
    assert.equal((await api('/api/ws/send', { accountId: 'default', auditId, action: 'begin-attempt' })).status, 409);
  });
  await check('R03 contradictory or missing local-attempt evidence cannot upgrade unknown intent', async () => {
    const planned = await plan('local-evidence-consistency', null), auditId = planned.value.dispatch.items[0].id;
    const begin = await api('/api/ws/send', { accountId: 'default', auditId, action: 'begin-attempt' }); assert.equal(begin.status, 200);
    for (const nativeResult of [{ ok: true, deliveryState: 'unknown', dispatchAttempted: true }, { ok: true, dispatchAttempted: true }, { ok: true, deliveryState: 'local_attempted', dispatchAttempted: false }]) {
      const result = await api('/api/ws/send', { accountId: 'default', auditId, attemptId: begin.value.attemptId, status: 'sending', deliveryState: 'local_attempted', nativeResult });
      console.log('[OBSERVED] ' + JSON.stringify({ scenario: 'local-evidence-consistency', httpStatus: result.status, storedDeliveryState: (await readAudit(auditId)).deliveryState }));
      assert.equal(result.status, 422); assert.equal(result.value.code, 'LOCAL_ATTEMPT_EVIDENCE_REQUIRED'); assert.equal((await readAudit(auditId)).deliveryState, 'unknown');
    }
  });
  await check('R03 contradictory or missing preflight evidence cannot authorize retry', async () => {
    const planned = await plan('failed-evidence-consistency', null), auditId = planned.value.dispatch.items[0].id;
    const begin = await api('/api/ws/send', { accountId: 'default', auditId, action: 'begin-attempt' }); assert.equal(begin.status, 200);
    for (const nativeResult of [{ ok: false, deliveryState: 'failed', dispatchAttempted: true, notAttempted: true, phase: 'preflight' }, { ok: false, dispatchAttempted: false, notAttempted: true, phase: 'preflight' }, { ok: false, deliveryState: 'unknown', dispatchAttempted: false, notAttempted: true, phase: 'preflight' }, { ok: false, deliveryState: 'failed', notAttempted: true, phase: 'preflight' }]) {
      const result = await api('/api/ws/send', { accountId: 'default', auditId, attemptId: begin.value.attemptId, status: 'failed', deliveryState: 'failed', phase: 'completed', nativeResult });
      console.log('[OBSERVED] ' + JSON.stringify({ scenario: 'failed-evidence-consistency', httpStatus: result.status, retryAllowed: (await readAudit(auditId)).retryAllowed }));
      assert.equal(result.status, 409); assert.equal(result.value.code, 'SEND_FAILURE_UNCERTAIN'); assert.equal((await readAudit(auditId)).retryAllowed, false);
    }
  });
  await check('R02 actual attempt reservations are per account and bounded', async () => {
    await api('/api/ws/accounts', { id: 'rate-test', displayName: 'synthetic throttle account' }); await api('/api/ws/conversations', { id: 'c-rate', accountId: 'rate-test', externalId: '919900099999@c.us', title: 'rate-only', data: { conversationType: 'direct' } });
    for (let index = 0; index < 21; index++) {
      const planned = await plan('rate-' + index, null, { accountId: 'rate-test', conversationIds: ['c-rate'] }); assert.equal(planned.status, 201);
      const begun = await api('/api/ws/send', { accountId: 'rate-test', auditId: planned.value.dispatch.items[0].id, action: 'begin-attempt' }); assert.equal(begun.status, index < 20 ? 200 : 429);
      if (index === 20) { assert.equal(begun.value.code, 'SEND_RATE_LIMITED'); assert.ok(begun.value.retryAfterMs > 0); assert.equal((await api('/api/ws/send-audit?accountId=rate-test&id=' + planned.value.dispatch.items[0].id)).value.items[0].status, 'queued'); }
    }
    const other = await plan('not-shared-rate', null); assert.equal(other.status, 201); assert.equal((await api('/api/ws/send', { accountId: 'default', auditId: other.value.dispatch.items[0].id, action: 'begin-attempt' })).status, 200, 'one account cannot consume another account quota');
  });
  await check('R03 prepared unknown intent survives a real isolated sidecar restart', async () => {
    const planned = await plan('restart-prepared', null); assert.equal(planned.status, 201); const auditId = planned.value.dispatch.items[0].id;
    const begun = await api('/api/ws/send', { accountId: 'default', auditId, action: 'begin-attempt' }); assert.equal(begun.status, 200);
    await fetch(endpoint + '/api/shutdown', { method: 'POST', headers: { origin: endpoint, 'x-zhike-api-token': token, 'x-zhike-shutdown-token': token }, signal: AbortSignal.timeout(3000) });
    for (let count = 0; count < 100 && child.exitCode == null; count++) await wait(50); assert.equal(child.exitCode, 0, 'created isolated sidecar exits normally');
    child = spawn(process.env.ZHIKE_TEST_NODE || process.execPath, ['server.mjs'], { cwd: app, windowsHide: true, env: { ...process.env, ZHIKE_DATA_DIR: root, ZHIKE_PORT: new URL(endpoint).port, ZHIKE_API_TOKEN: token, ZHIKE_SHUTDOWN_TOKEN: token, ZHIKE_FENCING_MODE: '', ZHIKE_AI_PIPELINE_MODE: '', ZHIKE_STAGE4_MOCK: '', ZHIKE_GROUP_MANAGER_MODE: '', ZHIKE_STAGE3_MOCK: '' }, stdio: ['ignore', 'pipe', 'pipe'] }); child.stdout.on('data', () => {}); child.stderr.on('data', () => {});
    for (let count = 0; count < 100; count++) { try { if ((await api('/api/ws/accounts')).status === 200) break; } catch {} await wait(50); if (count === 99) throw Error('isolated restart timeout'); }
    const saved = await readAudit(auditId); assert.equal(saved.attemptId, begun.value.attemptId); assert.equal(saved.deliveryState, 'unknown'); assert.equal(saved.retryAllowed, false);
    assert.equal((await api('/api/ws/send', { accountId: 'default', auditId, action: 'begin-attempt' })).status, 409, 'restart is not permission to repeat an uncertain external operation');
  });
  await check('R05 24 MiB upper bound and executable signature or extension rejection', async () => {
    for (const [fileName, bytes] of [['innocent.txt', Buffer.from('MZsynthetic executable')], ['payload.ps1', Buffer.from('synthetic script')]]) {
      const result = await api('/api/ws/media', { accountId: 'default', fileName, mimeType: 'text/plain', dataBase64: bytes.toString('base64') }); assert.ok([415, 422].includes(result.status), fileName + ' executable screening');
    }
    const over = await api('/api/ws/media', { accountId: 'default', fileName: 'oversize.txt', mimeType: 'text/plain', dataBase64: Buffer.alloc(24 * 1024 * 1024 + 1, 97).toString('base64') }); assert.ok([413, 422].includes(over.status), 'upload boundary must match native 24 MiB');
  });
  await check('R07 AI GET is read-only and explicit legacy recovery does not touch Worker jobs', async () => {
    const old = new Date(Date.now() - 11 * 60 * 1000).toISOString();
    db(connection => { const insert = connection.prepare("INSERT INTO ai_jobs(id,account_id,conversation_id,idempotency_key,status,next_attempt_at,locked_at,lease_token,worker_owner_id,fencing_token,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)"); insert.run('legacy-expired', 'default', 'c-a', 'legacy-expired', 'running', old, old, 'legacy-lease', '', 0, old, old); insert.run('worker-expired', 'default', 'c-a', 'worker-expired', 'running', old, old, 'worker-lease', 'controlled-worker', 9, old, old); insert.run('pipeline-tagged', 'default', 'c-a', 'pipeline-tagged', 'running', old, old, 'pipeline-lease', '', 0, old, old); connection.prepare("UPDATE ai_jobs SET correlation_id='isolated-pipeline-correlation' WHERE id='pipeline-tagged'").run(); });
    const before = db(connection => JSON.stringify(connection.prepare('SELECT * FROM ai_jobs ORDER BY id').all()));
    assert.equal((await api('/api/ws/ai-jobs?accountId=default')).status, 200); assert.equal(db(connection => JSON.stringify(connection.prepare('SELECT * FROM ai_jobs ORDER BY id').all())), before, 'GET must never recover or mutate task rows');
    const recovered = await api('/api/ws/ai-jobs', { accountId: 'default', action: 'recover-expired' }); assert.equal(recovered.status, 200); assert.equal(recovered.value.recovered, 1);
    assert.equal(db(connection => connection.prepare('SELECT status FROM ai_jobs WHERE id=?').get('legacy-expired').status), 'retryable'); assert.equal(db(connection => connection.prepare('SELECT status FROM ai_jobs WHERE id=?').get('worker-expired').status), 'running');
    assert.equal(db(connection => connection.prepare('SELECT status FROM ai_jobs WHERE id=?').get('pipeline-tagged').status), 'running', 'new pipeline authority is not inferred from an empty owner');
    assert.equal(db(connection => connection.prepare('PRAGMA user_version').get().user_version), expectedSchemaVersion);
  });
  console.log(JSON.stringify({ stage: '5.5C-1A', checks: results.length, passed: results.filter(row => row.result === 'PASS').length, failed: results.filter(row => row.result === 'FAIL').length, results, productionOpened: false, realWs: false, paidAi: false, workerStarted: false }));
  if (results.some(row => row.result === 'FAIL')) process.exitCode = 1;
})().catch(error => { console.error(error.stack); process.exitCode = 1; }).finally(async () => {
  if (child && child.exitCode == null) {
    try { await fetch(endpoint + '/api/shutdown', { method: 'POST', headers: { origin: endpoint, 'x-zhike-api-token': token, 'x-zhike-shutdown-token': token }, signal: AbortSignal.timeout(3000) }); } catch {}
    for (let count = 0; count < 100 && child.exitCode == null; count++) await wait(50);
    if (child.exitCode == null) child.kill();
    for (let count = 0; count < 50 && child.exitCode == null; count++) await wait(50);
  }
  if (!child || child.exitCode != null) { assert.equal(path.dirname(root).toLowerCase(), path.resolve(os.tmpdir()).toLowerCase()); assert.match(path.basename(root), /^zhike-stage55c-api-/); assert.equal(fs.readFileSync(path.join(root, '.stage55c-api-test'), 'utf8'), 'owned-synthetic-only'); fs.rmSync(root, { recursive: true, force: true }); }
  else console.error('Isolated test root retained because its created process did not exit.');
});
