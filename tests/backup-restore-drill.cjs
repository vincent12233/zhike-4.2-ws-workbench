const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { cpSync, mkdtempSync, rmSync, writeFileSync } = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const app = process.argv[2];
if (!app) throw new Error('app path required');

const root = mkdtempSync(path.join(os.tmpdir(), 'zhike-restore-drill-'));
const first = path.join(root, 'first');
const second = path.join(root, 'second');
cpSync(app, first, { recursive: true });
cpSync(app, second, { recursive: true });
const token = 'restore-drill-token';
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

function start(dir, port) {
  const child = spawn(process.execPath, ['server.mjs'], {
    cwd: dir,
    windowsHide: true,
    env: { ...process.env, ZHIKE_PORT: String(port), ZHIKE_API_TOKEN: token, ZHIKE_SHUTDOWN_TOKEN: token, ZHIKE_DATA_DIR: path.join(dir, 'isolated-data') },
    stdio: 'ignore',
  });
  return child;
}
async function healthy(port) {
  for (let i = 0; i < 120; i++) {
    try { if ((await fetch(`http://127.0.0.1:${port}/api/health`)).ok) return true; } catch {}
    await wait(50);
  }
  return false;
}
async function stop(child, port) {
  if (child.exitCode === null) await fetch(`http://127.0.0.1:${port}/api/shutdown`, { method: 'POST', headers: { 'X-Zhike-Api-Token': token, 'X-Zhike-Shutdown-Token': token } }).catch(() => {});
  await new Promise(resolve => {
    if (child.exitCode !== null) return resolve();
    const done = () => resolve();
    child.once('exit', done);
    setTimeout(() => { if (child.exitCode === null) child.kill(); resolve(); }, 2500);
  });
}
const headers = version => ({ 'Content-Type': 'application/json', 'X-Zhike-Api-Token': token, 'X-State-Version': version });

(async () => {
  let child1, child2;
  try {
    child1 = start(first, 4390);
    assert(await healthy(4390), 'first isolated server did not start');
    const initial = {
      schemaVersion: 4,
      customers: [
        { id: 'C-1', name: '甲', phone: '9876543210', rawPhone: '9876543210', source: '单导', status: '已进群', deleted: false },
        { id: 'C-2', name: '乙', phone: '9876543211', rawPhone: '9876543211', source: '群粉', status: '在群', deleted: false },
      ],
      tickets: [
        { id: 'T-1', customerId: 'C-1', date: '2026-11-05', product: 'ABC', direction: '关注', note: '第一只票' },
        { id: 'T-2', customerId: 'C-1', date: '2026-11-06', product: 'XYZ', direction: '买入', note: '第二只票' },
      ],
      deposits: [
        { id: 'D-1', customerId: 'C-1', date: '2026-11-05', amount: 100, currency: 'INR', note: '首笔' },
        { id: 'D-2', customerId: 'C-1', date: '2026-11-06', amount: 200, currency: 'INR', note: '第二笔' },
      ],
      followups: [{ id: 'F-1', customerId: 'C-1', date: '2026-11-05', note: '跟进' }],
      registrations: [{ id: 'R-1', customerId: 'C-1', date: '2026-11-05', status: '已报名' }],
      phoneRegistry: [], batchOperations: [], activities: [],
      settings: { workspaceName: '隔离恢复演练', importProfiles: [{ name: '模板', signature: '姓名|手机', mapping: { name: 0, phone: 1 } }] },
      channelAliases: { 社群: '群粉' }, importIssues: [], qualityDecisions: {}, savedViews: [],
    };
    let version = '';
    let response = await fetch('http://127.0.0.1:4390/api/state', { method: 'PUT', headers: headers(version), body: JSON.stringify(initial) });
    assert.equal(response.status, 200);
    version = String((await response.json()).version);
    response = await fetch('http://127.0.0.1:4390/api/ws/conversations', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Zhike-Api-Token': token }, body: JSON.stringify({ externalId: 'wa-drill-1', title: '隔离 WS 客户' }) });
    assert.equal(response.status, 200);
    const wsConversation = await response.json();
    response = await fetch('http://127.0.0.1:4390/api/ws/messages', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Zhike-Api-Token': token }, body: JSON.stringify({ conversationId: wsConversation.id, externalId: 'wa-msg-1', direction: 'receive', originalText: '隔离消息', translatedText: 'Isolated message', order: 1 }) });
    assert.equal(response.status, 200);
    const wsBackup = await (await fetch('http://127.0.0.1:4390/api/ws/export', { headers: { 'X-Zhike-Api-Token': token } })).json();
    response = await fetch('http://127.0.0.1:4390/api/snapshot', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Zhike-Api-Token': token }, body: JSON.stringify({ reason: '恢复演练前快照' }) });
    assert.equal(response.status, 200);
    const snap = await (await fetch('http://127.0.0.1:4390/api/snapshots', { headers: { 'X-Zhike-Api-Token': token } })).json();
    assert.equal(snap.snapshots.length, 1);
    const changed = { ...initial, customers: initial.customers.slice(0, 1), tickets: initial.tickets.slice(0, 1), deposits: initial.deposits.slice(0, 1), settings: { workspaceName: '被修改' } };
    response = await fetch('http://127.0.0.1:4390/api/state', { method: 'PUT', headers: headers(version), body: JSON.stringify(changed) });
    assert.equal(response.status, 200);
    version = String((await response.json()).version);
    response = await fetch(`http://127.0.0.1:4390/api/snapshots/${snap.snapshots[0].id}/restore`, { method: 'POST', headers: { 'X-Zhike-Api-Token': token, 'X-State-Version': version } });
    assert.equal(response.status, 200);
    const restored = await (await fetch('http://127.0.0.1:4390/api/state', { headers: { 'X-Zhike-Api-Token': token } })).json();
    assert.equal(restored.customers.length, 2);
    assert.equal(restored.tickets.length, 2);
    assert.equal(restored.deposits.length, 2);
    assert.equal(restored.settings.workspaceName, '隔离恢复演练');
    assert.equal(restored.settings.importProfiles[0].name, '模板');
    const backupPath = path.join(root, 'portable-backup.json');
    writeFileSync(backupPath, JSON.stringify({ ...restored, ws: wsBackup }));
    await stop(child1, 4390); child1 = null;

    child2 = start(second, 4391);
    assert(await healthy(4391), 'second isolated server did not start');
    const portable = JSON.parse(require('node:fs').readFileSync(backupPath, 'utf8'));
    response = await fetch('http://127.0.0.1:4391/api/state', { method: 'PUT', headers: headers(''), body: JSON.stringify(portable) });
    assert.equal(response.status, 200);
    response = await fetch('http://127.0.0.1:4391/api/ws/import', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Zhike-Api-Token': token }, body: JSON.stringify(portable.ws) });
    assert.equal(response.status, 200);
    const migrated = await (await fetch('http://127.0.0.1:4391/api/state', { headers: { 'X-Zhike-Api-Token': token } })).json();
    assert.equal(migrated.customers.length, 2);
    assert.equal(migrated.tickets.length, 2);
    assert.equal(migrated.deposits.length, 2);
    assert.equal(migrated.settings.workspaceName, '隔离恢复演练');
    const wsDiagnostics = await (await fetch('http://127.0.0.1:4391/api/ws/diagnostics', { headers: { 'X-Zhike-Api-Token': token } })).json();
    assert.equal(wsDiagnostics.counts.messages, 1);
    assert.equal((await (await fetch('http://127.0.0.1:4391/api/diagnostics', { headers: { 'X-Zhike-Api-Token': token } })).json()).ok, true);
    await stop(child2, 4391); child2 = null;
    const db = new DatabaseSync(path.join(second, 'isolated-data', 'workspace.sqlite'), { readOnly: true });
    assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
    db.close();
    console.log('backup-restore drill: snapshot restore, portable backup, multi-ticket/deposit preservation, integrity check passed');
  } finally {
    if (child1) await stop(child1, 4390);
    if (child2) await stop(child2, 4391);
    for (let i = 0; i < 12; i++) { try { rmSync(root, { recursive: true, force: true }); break; } catch { await wait(200); } }
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
