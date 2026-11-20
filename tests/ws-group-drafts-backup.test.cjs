'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { spawn } = require('node:child_process');
const { randomBytes, createHash } = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const { test } = require('node:test');
const { runMigrations } = require('../resources/app/migration-runner.cjs');
const { observeSidecarStartup, requestWithStartupDiagnostics } = require('./helpers/sidecar-startup-observer.cjs');
const app = path.resolve(__dirname, '../resources/app');
const now = '2026-11-20T00:00:00.000Z';
const copy = value => JSON.parse(JSON.stringify(value));
test('v31 migration preserves local send attempts, media attachments and account deletion', () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec('PRAGMA foreign_keys=ON; CREATE TABLE ws_accounts(id TEXT PRIMARY KEY); CREATE TABLE ws_conversations(id TEXT PRIMARY KEY);');
    for(const name of ['016-ws-send-audit.sql','018-ws-export-media.sql'])db.exec(fs.readFileSync(path.join(app,'migrations',name),'utf8'));
    db.exec("INSERT INTO ws_accounts VALUES('seat'); INSERT INTO ws_conversations VALUES('chat')");
    db.prepare("INSERT INTO ws_send_audit(id,account_id,conversation_id,idempotency_key,status,native_result_json,created_at,updated_at) VALUES('audit','seat','chat','old-key','sending',?,?,?)").run('{"sendAttempt":{"id":"old-attempt"}}',now,now);
    db.prepare("INSERT INTO ws_media_assets(id,account_id,created_at,updated_at) VALUES('media','seat',?,?)").run(now,now);
    db.prepare("INSERT INTO ws_send_attachments(id,account_id,send_audit_id,media_id,created_at,updated_at) VALUES('attachment','seat','audit','media',?,?)").run(now,now);
    db.exec('BEGIN IMMEDIATE');
    db.exec(fs.readFileSync(path.join(app,'migrations','031-workspace-restore-audit.sql'),'utf8'));
    db.exec('COMMIT');
    db.exec("DELETE FROM ws_conversations WHERE id='chat'");
    const audit=db.prepare('SELECT * FROM ws_send_audit').get();
    assert.equal(audit.idempotency_key,'old-key');assert.equal(JSON.parse(audit.native_result_json).sendAttempt.id,'old-attempt');
    assert.equal(db.prepare('SELECT send_audit_id FROM ws_send_attachments').get().send_audit_id,'audit');
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
    db.exec("DELETE FROM ws_accounts WHERE id='seat'");
    assert.equal(db.prepare('SELECT count(*) n FROM ws_send_audit').get().n,0);
    assert.equal(db.prepare('SELECT count(*) n FROM ws_send_attachments').get().n,0);
  } finally { db.close(); }
});
function seed(root) {
  const db = new DatabaseSync(path.join(root, 'workspace.sqlite'));
  try {
    runMigrations({ db, migrationDir: path.join(app, 'migrations'), lockPath: path.join(root, 'test.lock'), backup: false });
    for (const account of ['desk', 'other', 'fresh']) db.prepare("INSERT INTO ws_accounts(id,display_name,workspace_mode,created_at,updated_at) VALUES(?,?,'dedicated',?,?)").run(account, account, now, now);
    const insert = db.prepare('INSERT INTO ws_group_drafts(account_id,id,message_text,targets_json,status,created_at,cancelled_at) VALUES(?,?,?,?,?,?,?)');
    for (let i = 0; i < 32; i++) insert.run('desk', 'draft-' + i, '  Exact original\n正文 ' + i + '  ', JSON.stringify([{ groupJid: 'g' + i + '@g.us', name: 'Same <title>' }]), i === 1 ? 'CANCELLED' : 'DRAFT', now, i === 1 ? now : null);
    insert.run('other', 'draft-0', 'Other account immutable', JSON.stringify([{ groupJid: 'foreign@g.us', name: 'Same <title>' }]), 'DRAFT', now, null);
  } finally { db.close(); }
}
async function freePort() {
  const socket = net.createServer();
  await new Promise((resolve, reject) => { socket.once('error', reject); socket.listen(0, '127.0.0.1', resolve); });
  const port = socket.address().port;
  await new Promise(resolve => socket.close(resolve));
  return port;
}

test('account backup restores group draft history atomically and never revives or sends it', { timeout: 60000 }, async t => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zhike-draft-backup-'));
  seed(dataDir);
  const port = await freePort(), origin = 'http://127.0.0.1:' + port, token = randomBytes(24).toString('hex');
  const child = spawn(process.env.ZHIKE_TEST_NODE || process.execPath, ['server.mjs'], {
    cwd: app, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'],
    env: { ...process.env, ZHIKE_DATA_DIR: dataDir, ZHIKE_PORT: String(port), ZHIKE_API_TOKEN: token,
      ZHIKE_PARENT_PID: '', ZHIKE_GROUP_MANAGER_MODE: '', ZHIKE_STAGE3_MOCK: '', ZHIKE_AI_PIPELINE_MODE: '', ZHIKE_STAGE4_MOCK: '', ZHIKE_FENCING_MODE: '' },
  });
  const closed = new Promise(resolve => child.once('close', resolve));
  const observation = observeSidecarStartup(child, { secrets: [token] });
  const request = async (route, body, expected = 200, version) => {
    const headers = { origin, 'x-zhike-api-token': token, 'content-type': 'application/json' };
    if (body !== undefined) headers['x-state-version'] = version ?? (await fetch(origin + '/api/state/version', { headers }).then(response => response.json())).version;
    const response = await fetch(origin + route, { method: body === undefined ? 'GET' : 'POST', signal: AbortSignal.timeout(5000), headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const result = await response.json(); assert.equal(response.status, expected, `${route}: ${JSON.stringify(result)}`); return result;
  };
  const exportAccount = id => request('/api/ws/export?accountId=' + id);
  const restore = (body, expected = 200) => request('/api/ws/import', { ...body, accountId: 'desk' }, expected);
  let saved, other;
  try {
    await requestWithStartupDiagnostics(() => request('/api/health'), observation);
    saved = await exportAccount('desk'); other = await exportAccount('other');
    await t.test('export includes all 32 rows beyond the 30-row UI, exact text and account scope', async () => {
      assert.equal((await request('/api/ws/group-drafts?accountId=desk')).drafts.length, 30);
      assert.equal(saved.groupDrafts.length, 32); assert.equal(saved.manifest.counts.groupDrafts, 32);
      assert.equal(saved.groupDrafts[0].message, '  Exact original\n正文 0  ');
      assert.ok(saved.groupDrafts.every(item => item.accountId === 'desk'));
      const all = await request('/api/ws/export?allAccounts=1');
      assert.equal(all.groupDrafts.length, 33); assert.equal(all.manifest.counts.groupDrafts, 33);
    });
    await t.test('legacy missing field and empty new field preserve existing drafts', async () => {
      const legacy = copy(saved); delete legacy.groupDrafts;
      for (const body of [legacy, { ...legacy, schemaVersion: 5 }, { ...saved, groupDrafts: [] }]) {
        const result = await restore(body); assert.equal(result.groupDraftRestore.inserted, 0);
        assert.deepEqual((await exportAccount('desk')).groupDrafts, saved.groupDrafts);
      }
    });
    await t.test('malformed, foreign and executable statuses reject before deleting existing conversation data', async () => {
      // Seed a legacy retained group conversation; production deliberately does
      // not allow renderer POSTs to invent dedicated group history.
      const fixture = new DatabaseSync(path.join(dataDir, 'workspace.sqlite'));
      try { fixture.prepare('INSERT INTO ws_conversations(id,account_id,external_id,title,data_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?)').run('legacy-group', 'desk', 'trusted@g.us', 'Preserved', '{"conversationType":"group","isGroup":true}', now, now); }
      finally { fixture.close(); }
      const before = await exportAccount('desk');
      for (const mutation of [
        value => { value.groupDrafts = null; },
        value => { value.groupDrafts[0].accountId = 'other'; },
        value => { value.groupDrafts[0].status = 'SENT'; },
        value => { value.groupDrafts[0].targets[0].status = 'SENT'; },
        value => { value.groupDrafts[0].targets[0].groupJid = '123@c.us'; },
        value => { value.groupDrafts[0].targets.push(value.groupDrafts[0].targets[0]); },
        value => { value.groupDrafts[0].message = '  '; },
        value => { value.groupDrafts[0].createdAt = 'not-a-date'; },
        value => { value.groupDrafts[0].cancelledAt = now; },
        value => { value.groupDrafts.push(value.groupDrafts[0]); },
      ]) {
        const body = copy(saved); mutation(body); await restore(body, 400);
        const actual = await exportAccount('desk');
        assert.deepEqual(actual.conversations, before.conversations); assert.deepEqual(actual.groupDrafts, before.groupDrafts);
      }
      const ordinary = await exportAccount('default');
      await request('/api/ws/import', { ...ordinary, accountId: 'default', groupDrafts: saved.groupDrafts.map(item => ({ ...item, accountId: 'default' })) }, 409);
    });
    await t.test('conflict after a new row rolls back both draft writes and conversation replacement', async () => {
      const before = await exportAccount('desk');
      const newRow = { ...copy(saved.groupDrafts[0]), id: 'must-rollback' };
      const conflicting = { ...copy(saved.groupDrafts[0]), message: 'different content' };
      const result = await restore({ ...saved, groupDrafts: [newRow, conflicting] }, 409);
      assert.equal(result.code, 'DRAFT_BACKUP_CONFLICT');
      const after = await exportAccount('desk');
      assert.deepEqual(after.groupDrafts, before.groupDrafts); assert.deepEqual(after.conversations, before.conversations);
    });
    await t.test('restore works without catalog and keeps the immutable snapshot on retries', async () => {
      const fresh = { ...saved, accountId: 'fresh', accounts: [{ id: 'fresh', workspaceMode: 'dedicated' }], groupDrafts: saved.groupDrafts.map(item => ({ ...item, accountId: 'fresh' })) };
      const first = await request('/api/ws/import', fresh); assert.equal(first.groupDraftRestore.inserted, 32);
      const second = await request('/api/ws/import', fresh); assert.equal(second.groupDraftRestore.unchanged, 32);
      const actual = await exportAccount('fresh'); assert.deepEqual(actual.groupDrafts, fresh.groupDrafts); assert.deepEqual(actual.groups, []);
    });
    await t.test('cancellation is monotonic in both directions and stale backups never remove new rows', async () => {
      await request('/api/ws/group-drafts?accountId=desk', { accountId: 'desk', action: 'cancel', id: 'draft-0' });
      const stale = copy(saved); stale.groupDrafts.push({ ...copy(saved.groupDrafts[0]), id: 'new-restored' });
      const cancelled = stale.groupDrafts.find(item => item.id === 'draft-2');
      cancelled.status = 'CANCELLED'; cancelled.cancelledAt = now; cancelled.targets.forEach(target => { target.status = 'CANCELLED'; });
      assert.equal((await restore(stale)).groupDraftRestore.cancelled, 1);
      await restore(saved); await restore(saved);
      const rows = (await exportAccount('desk')).groupDrafts;
      assert.equal(rows.length, 33); assert.equal(rows.find(item => item.id === 'draft-0').status, 'CANCELLED');
      assert.equal(rows.find(item => item.id === 'draft-2').status, 'CANCELLED');
      assert.deepEqual((await exportAccount('other')).groupDrafts, other.groupDrafts);
      const db = new DatabaseSync(path.join(dataDir, 'workspace.sqlite'), { readOnly: true });
      try {
        for (const table of ['ws_send_audit','ws_send_attachments','ws_group_monitor_targets']) assert.equal(db.prepare('SELECT COUNT(*) AS n FROM ' + table).get().n, 0);
      } finally { db.close(); }
    });
    await t.test('final workspace draft transaction is atomic across accounts and idempotent by exact content', async () => {
      const beforeFresh = (await exportAccount('fresh')).groupDrafts, beforeOther = (await exportAccount('other')).groupDrafts;
      const added = { ...copy(beforeFresh[0]), id: 'bulk-new' };
      const payload = accounts => ({ accounts, operationId: createHash('sha256').update(JSON.stringify(accounts)).digest('hex') });
      const conflicting = payload([{ accountId: 'fresh', groupDrafts: [added] }, { accountId: 'other', groupDrafts: [{ ...copy(beforeOther[0]), message: 'conflicting content' }] }]);
      await request('/api/ws/group-drafts/restore', conflicting, 409);
      assert.deepEqual((await exportAccount('fresh')).groupDrafts, beforeFresh);
      assert.deepEqual((await exportAccount('other')).groupDrafts, beforeOther);
      await request('/api/ws/group-drafts/restore', { ...conflicting, operationId: 'wrong' }, 400);
      await request('/api/ws/group-drafts/restore', payload([{ accountId: 'fresh', groupDrafts: [added] }, { accountId: 'fresh', groupDrafts: [] }]), 400);
      const cancelled = { ...copy(beforeOther[0]), status: 'CANCELLED', cancelledAt: now };
      cancelled.targets.forEach(target => { target.status = 'CANCELLED'; });
      const valid = payload([{ accountId: 'fresh', groupDrafts: [added] }, { accountId: 'other', groupDrafts: [cancelled] }]);
      const first = await request('/api/ws/group-drafts/restore', valid);
      const again = await request('/api/ws/group-drafts/restore', valid);
      assert.equal(first.operationId, valid.operationId); assert.equal(again.operationId, first.operationId);
      assert.equal(first.sendAvailable, false); assert.equal(again.accounts[0].inserted, 0);
      assert.equal((await exportAccount('fresh')).groupDrafts.length, beforeFresh.length + 1);
      assert.deepEqual((await exportAccount('other')).groupDrafts, [cancelled]);
      const changed = copy(valid); changed.accounts[0].groupDrafts[0].message = 'changed request';
      await request('/api/ws/group-drafts/restore', changed, 400);
      const db = new DatabaseSync(path.join(dataDir, 'workspace.sqlite'), { readOnly: true });
      try { assert.equal(db.prepare('SELECT COUNT(*) AS n FROM ws_send_audit').get().n, 0); }
      finally { db.close(); }
    });
    await t.test('a failing account, CRM conflict or stale version leaves trusted data and unrelated accounts untouched', async () => {
      const fixture = new DatabaseSync(path.join(dataDir, 'workspace.sqlite'));
      try {
        for (const id of ['atomic-a','atomic-b']) {
          fixture.prepare('INSERT INTO ws_accounts(id,display_name,created_at,updated_at) VALUES(?,?,?,?)').run(id,id,now,now);
          fixture.prepare('INSERT INTO ws_conversations(id,account_id,external_id,data_json,created_at,updated_at) VALUES(?,?,?,?,?,?)').run(id,id,id,'{"conversationType":"direct"}',now,now);
          fixture.prepare("INSERT INTO ws_messages(id,account_id,conversation_id,original_text,direction,data_json,created_at,updated_at) VALUES(?,?,?,'synthetic','receive',?,?,?)").run(id,id,id,'{"source":"ws-webview2","nativeAuthorityVerified":true}',now,now);
          fixture.prepare("INSERT INTO ws_ai_authorizations VALUES(?,?,?,'openai','model','quote','consent',1,'active',100,0,'test-runtime',?,?,?,?)").run(id,id,id,now,now,now,now);
        }
        const before = () => ['ws_ai_authorizations','ws_messages'].map(table => fixture.prepare('SELECT * FROM '+table+" WHERE account_id LIKE 'atomic-%' ORDER BY id").all());
        const trusted = before(), a = {...await exportAccount('atomic-a'),accountId:'atomic-a'};
        const newAccount = {accountId:'created-by-restore',schemaVersion:6};
        const restoreWorkspace = (accounts,crm,expected,version) => request('/api/workspace/restore',{operationId:require('node:crypto').randomUUID(),accounts,crm},expected,version);
        await restoreWorkspace([newAccount,a,{accountId:'atomic-b',schemaVersion:999}], {customers:[]},400);
        await restoreWorkspace([a],{customers:null},400);
        await restoreWorkspace([],{customers:null},400);
        await restoreWorkspace([a],{customers:[]},409,'stale');
        assert.deepEqual(before(),trusted);
        assert.equal(fixture.prepare("SELECT COUNT(*) n FROM ws_accounts WHERE id='created-by-restore'").get().n,0);
        const expected = (await request('/api/state/version')).version;
        const body = {operationId:require('node:crypto').randomUUID(),accounts:[a],crm:{customers:[{id:'committed'}]}};
        const first = await request('/api/workspace/restore',body,200,expected);
        const replay = await request('/api/workspace/restore',body,200,expected);
        assert.deepEqual(replay,first);
        assert.equal((await request('/api/state/version')).version,first.version);
        await request('/api/workspace/restore',{...body,accounts:[]},409,expected);
        assert.equal(fixture.prepare("SELECT status FROM ws_ai_authorizations WHERE id='atomic-b'").get().status,'active');
        assert.equal(fixture.prepare("SELECT status FROM ws_ai_authorizations WHERE id='atomic-a'").get().status,'revoked');
        assert.equal(JSON.parse(fixture.prepare("SELECT data_json FROM ws_messages WHERE id='atomic-a'").get().data_json).nativeAuthorityVerified,false);
      } finally { fixture.close(); }
    });
    await t.test('same-account and portable restores retain inert delivery evidence and idempotency keys', async () => {
      const fixture = new DatabaseSync(path.join(dataDir,'workspace.sqlite'));
      try {
        fixture.prepare("INSERT INTO ws_send_audit(id,account_id,conversation_id,idempotency_key,status,native_result_json,created_at,updated_at) VALUES('sent-record','atomic-a','atomic-a','original-key','sent',?,?,?)")
          .run('{"sendAttempt":{"id":"native-attempt","deliveryState":"local_attempted"}}',now,now);
        const original = await exportAccount('atomic-a');
        await request('/api/ws/import',{...original, accountId:'atomic-a'});
        const after = (await exportAccount('atomic-a')).sendAudit[0];
        assert.equal(after.idempotencyKey,'original-key');
        assert.equal(after.status,'sent');assert.equal(after.attemptId,'native-attempt');assert.equal(after.retryAllowed,false);
        assert.equal((await request('/api/ws/send',{accountId:'atomic-a',auditId:after.id,action:'begin-attempt'},409)).code,'SEND_RETRY_BLOCKED');
        // An older backup can omit both the conversation and the audit array.
        await request('/api/ws/import',{schemaVersion:6,accountId:'atomic-a'});
        assert.equal((await exportAccount('atomic-a')).sendAudit[0].id,'sent-record');
        const imported = { ...after,accountId:'atomic-b',id:'foreign-audit',status:'queued',idempotencyKey:'portable-key',conversationId:'removed-conversation',
          originalText:'  '+ 'x'.repeat(15000)+'\n',attachments:[{id:'attachment',mediaId:'missing-file',fileName:'archived.txt',caption:'  kept  '}],attachmentIds:['missing-file'] };
        const file={schemaVersion:6,accountId:'atomic-b',sendAudit:[imported]};
        await request('/api/ws/import',file);await request('/api/ws/import',file);
        const portable=(await exportAccount('atomic-b')).sendAudit;
        assert.equal(portable.length,1);assert.equal(portable[0].retryAllowed,false);assert.equal(portable[0].deliveryState,'unknown');
        assert.equal(portable[0].originalText,imported.originalText);
        assert.equal(portable[0].attachments[0].fileName,'archived.txt');assert.equal(portable[0].attachments[0].caption,'  kept  ');
        assert.equal(portable[0].attachments[0].mediaStatus,'unavailable');
        assert.equal((await request('/api/ws/send',{accountId:'atomic-b',action:'begin-attempt',auditId:imported.id},409)).code,'SEND_RETRY_BLOCKED');
        await request('/api/ws/import',{...file,sendAudit:[{...imported,id:'conflicting-id'}]},409);
        assert.equal((await exportAccount('atomic-b')).sendAudit[0].id,imported.id);
      } finally { fixture.close(); }
    });
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill();
    await closed;
    const resolved = path.resolve(dataDir), temp = path.resolve(os.tmpdir()) + path.sep;
    if (!resolved.startsWith(temp) || !path.basename(resolved).startsWith('zhike-draft-backup-')) throw new Error('Unsafe cleanup path');
    fs.rmSync(resolved, { recursive: true, maxRetries: 8, retryDelay: 100 });
  }
});
