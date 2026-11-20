'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const net = require('node:net');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const vm = require('node:vm');

const repo = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(repo, 'resources', 'app', 'app.js'), 'utf8');
const start = source.indexOf('  async function decodeWorkspaceBackupFile(text){');
const end = source.indexOf('  async function restoreBackupFile(file){', start);
assert.ok(start >= 0 && end > start, 'production backup decoder must be available');
const decode = vm.runInNewContext(source.slice(start, end) + '\n;decodeWorkspaceBackupFile', {
  sha256Text: async text => crypto.createHash('sha256').update(String(text), 'utf8').digest('hex'),
});
const helpersStart = source.indexOf('  function prepareBackupWsAccounts(backup){');
const helpersEnd = source.indexOf('  async function restoreBackupFile(file){', helpersStart);
assert.ok(helpersStart >= 0 && helpersEnd > helpersStart);
const prepareAccounts = vm.runInNewContext(source.slice(helpersStart,helpersEnd)+'\n;prepareBackupWsAccounts');

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}

async function restoreIntoIsolatedServer(backup) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zhike-native-restore-'));
  const port = await freePort();
  const origin = `http://127.0.0.1:${port}`;
  const token = 'isolated-native-restore-token';
  const headers = { 'Content-Type': 'application/json', 'X-Zhike-Api-Token': token, Origin: origin };
  const child = spawn(process.env.ZHIKE_TEST_NODE || process.execPath, ['server.mjs'], {
    cwd: path.join(repo, 'resources', 'app'),
    env: { ...process.env, ZHIKE_DATA_DIR: dataDir, ZHIKE_PORT: String(port), ZHIKE_API_TOKEN: token, ZHIKE_SHUTDOWN_TOKEN: token },
    stdio: 'ignore', windowsHide: true,
  });
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  const request = (pathname, init = {}) => fetch(origin + pathname, { ...init, headers: { ...headers, ...(init.headers || {}) } });
  try {
    let ready = false;
    // A clean restore workspace runs every additive migration before health
    // is available. Allow a bounded cold-start window on slower machines.
    for (let attempt = 0; attempt < 1200; attempt++) {
      try { if ((await fetch(origin + '/api/health')).ok) { ready = true; break; } } catch {}
      await wait(50);
    }
    assert.ok(ready, 'isolated restore server must start');

    const stateKeys = ['schemaVersion', 'customers', 'tickets', 'deposits', 'followups', 'registrations',
      'phoneRegistry', 'batchOperations', 'activities', 'settings', 'channelAliases', 'importIssues',
      'qualityDecisions', 'savedViews'];
    const state = Object.fromEntries(stateKeys.filter(key => Object.hasOwn(backup, key)).map(key => [key, backup[key]]));
    const accounts=prepareAccounts(backup);
    const postRestore=body=>request('/api/workspace/restore',{method:'POST',headers:{'X-State-Version':''},body:JSON.stringify(body)});
    const failed=await postRestore({operationId:crypto.randomUUID(),accounts,crm:{customers:null}});
    assert.equal(failed.status,400);
    assert.deepEqual((await request('/api/ws/accounts').then(res=>res.json())).accounts.map(row=>row.id),['default']);
    const payload={operationId:crypto.randomUUID(),crm:state,accounts};
    const dotnet = process.env.ZHIKE_TEST_DOTNET || path.join(repo, '.tools', 'dotnet10', 'dotnet.exe');
    const runtime = path.join(repo,'desktop/tests/BackupRetentionRuntime/bin/Release/net10.0/BackupRetentionRuntime.dll');
    const restored = spawnSync(dotnet, [runtime, '--restore-wire', origin, token], { input: JSON.stringify(payload), encoding: 'utf8', windowsHide: true, timeout: 30000 });
    assert.equal(restored.status, 0, restored.stderr || 'native restore must send an explicitly empty X-State-Version to a new database');
    assert.equal(JSON.parse(restored.stdout).operationId, payload.operationId);
    const response=await postRestore(payload);
    assert.equal(response.status,200,'a replay after commit returns its durable receipt');

    const saved = await (await request('/api/state')).json();
    assert.equal(saved.customers.length, 1);
    assert.equal(saved.customers[0].id, 'C123');
    for (const [accountId, expectedText] of [
      ['default', 'Hello from isolated default account'],
      ['test-account', 'Reply from isolated second account'],
    ]) {
      const exported = await (await request(`/api/ws/export?accountId=${encodeURIComponent(accountId)}`)).json();
      assert.equal(exported.accounts[0].workspaceMode, accountId === 'default' ? 'ordinary' : 'dedicated', 'Native backup restoration preserves each account purpose');
      assert.equal(exported.conversations.length, 1, `${accountId} conversation must survive restore`);
      assert.equal(exported.messages.length, 1, `${accountId} message must survive restore`);
      assert.equal(exported.messages[0].originalText, expectedText);
      const sortDrafts = rows => JSON.parse(JSON.stringify(rows)).sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
      assert.deepEqual(sortDrafts(exported.groupDrafts), sortDrafts(backup.wsAccounts[accountId].groupDrafts || []), 'native envelope preserves every draft field without relying on input order');
    }
    const groups = await (await request('/api/ws/group-drafts?accountId=test-account')).json();
    assert.equal(groups.sendAvailable, false); assert.deepEqual(groups.groups, []);
  } finally {
    try { await request('/api/shutdown', { method: 'POST', headers: { 'X-Zhike-Shutdown-Token': token } }); } catch {}
    await Promise.race([new Promise(resolve => child.once('exit', resolve)), wait(2500)]);
    if (child.exitCode === null) child.kill();
    const resolved = path.resolve(dataDir);
    const temp = path.resolve(os.tmpdir()) + path.sep;
    if (resolved.startsWith(temp) && path.basename(resolved).startsWith('zhike-native-restore-'))
      for (let attempt = 0; attempt < 12; attempt++) {
        try { fs.rmSync(resolved, { recursive: true, force: true }); break; } catch { await wait(200); }
      }
  }
}

async function main() {
  const dotnet = process.env.ZHIKE_TEST_DOTNET || path.join(repo, '.tools', 'dotnet10', 'dotnet.exe');
  const project = path.join(repo, 'desktop', 'tests', 'BackupRetentionRuntime', 'BackupRetentionRuntime.csproj');
  const result = spawnSync(dotnet, ['run', '--project', project, '-c', 'Release', '--', '--emit-envelope'], {
    cwd: repo,
    encoding: 'utf8',
    windowsHide: true,
    timeout: 120000,
  });
  if (result.error || result.status !== 0)
    throw new Error(`isolated native envelope producer failed: ${result.error?.message || result.stderr || result.stdout}`);
  const encoded = /^ENVELOPE:(.+)$/m.exec(result.stdout)?.[1];
  assert.ok(encoded, 'native envelope producer must emit a fixture');
  const nativeJson = Buffer.from(encoded, 'base64').toString('utf8');
  const native = JSON.parse(nativeJson);
  assert.equal(native.backupFormat, 'zhike-6-native-workspace');
  const restored = await decode(nativeJson);
  assert.equal(restored.backupFormat, 'zhike-6-workspace');
  assert.equal(restored.customers[0].id, 'C123');
  assert.ok(restored.wsAccounts['test-account']);
  assert.ok(restored.wsAccounts.default);
  assert.equal(restored.wsAccountMetadata[0].workspaceMode, 'dedicated');
  assert.equal(restored.wsAccounts['test-account'].accounts[0].workspaceMode, 'dedicated');
  assert.deepEqual(Object.keys(restored.wsAccounts['test-account']).sort(), [
    'accounts', 'analyses', 'batches', 'collectionItems', 'collectionRuns', 'conversations',
    'followupAlerts', 'groupDrafts', 'messages', 'replies', 'schemaVersion', 'settings',
  ].sort());

  const tampered = { ...native, payloadJson: native.payloadJson.replace('C123', 'C999') };
  await assert.rejects(() => decode(JSON.stringify(tampered)), /完整性校验失败/);
  const wrongInner = { ...native, payloadJson: native.payloadJson.replace('zhike-6-workspace', 'zhike-5-workspace') };
  wrongInner.integrity = { ...native.integrity, payloadSha256: crypto.createHash('sha256').update(wrongInner.payloadJson).digest('hex') };
  await assert.rejects(() => decode(JSON.stringify(wrongInner)), /内容格式不正确/);

  const manual = { ...restored };
  const manualHash = crypto.createHash('sha256').update(JSON.stringify(manual)).digest('hex');
  manual.integrity = { algorithm: 'SHA-256', payloadSha256: manualHash };
  const manualRestored = await decode(JSON.stringify(manual));
  assert.equal(manualRestored.customers[0].id, 'C123');
  await restoreIntoIsolatedServer(restored);
  console.log('native .NET backup -> production JS decoder -> isolated CRM/2-account WS restore: roundtrip, rollback, tamper rejection and manual format pass');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
