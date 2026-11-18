'use strict';
// Align synthetic API fixtures with the native account-metadata authority.
// No profile, Cookie, credential or production workspace is read or copied.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const root = path.resolve(process.argv[2] || '');
assert.equal(path.dirname(root).toLowerCase(), path.resolve(os.tmpdir()).toLowerCase());
assert.match(path.basename(root), /^zhike-stage51-native-[a-f0-9]{32}$/);
assert.equal(fs.lstatSync(root).isSymbolicLink(), false);
assert.equal(fs.readFileSync(path.join(root, '.stage51-isolated'), 'utf8'), 'zhike-stage51-isolated-ui-v1');
assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'seed-evidence.json'), 'utf8')).synthetic, true);
const connection = JSON.parse(fs.readFileSync(path.join(root, 'connection.private.json'), 'utf8'));
assert.equal(connection.isolated, true); assert.equal(path.resolve(connection.root), root);
const endpoint = new URL(connection.endpoint);
assert.equal(endpoint.hostname, '127.0.0.1'); assert.equal(endpoint.protocol, 'http:');
const headers = { 'content-type': 'application/json', 'x-zhike-api-token': connection.apiToken, origin: endpoint.origin };
(async () => {
  const res = await fetch(new URL('/api/ws/accounts', endpoint), { headers });
  assert.equal(res.status, 200);
  const body = await res.json();
  const accounts = body.accounts;
  assert.ok(Array.isArray(accounts));
  assert.ok(accounts.every(row => ['default', 'native-b'].includes(row.id)), 'Unexpected account in test workspace');
  if (!accounts.some(row => row.id === 'native-b')) {
    const added = await fetch(new URL('/api/ws/accounts', endpoint), { method: 'POST', headers, body: JSON.stringify({ id: 'native-b', displayName: '隔离账号 B' }) });
    assert.equal(added.status, 200);
  }
  const dir = path.join(root, 'data', 'ws-accounts');
  fs.mkdirSync(dir, { recursive: true });
  assert.equal(fs.lstatSync(dir).isSymbolicLink(), false);
  const target = path.join(dir, 'accounts.json');
  const existing = fs.existsSync(target) ? JSON.parse(fs.readFileSync(target, 'utf8')) : [];
  assert.ok(existing.every(row => ['default', 'native-b'].includes(row.id)), 'Native metadata contains an unexpected account');
  const rows = ['default', 'native-b'].map(id => existing.find(row => row.id === id) || { id, displayName: id === 'default' ? '默认账号' : '隔离账号 B', status: '未连接', lastSeen: null, lastKnownStatus: '未连接' });
  const temp = target + '.stage52.tmp';
  fs.writeFileSync(temp, JSON.stringify(rows, null, 2), { flag: 'wx', mode: 0o600 });
  fs.renameSync(temp, target);
  console.log(JSON.stringify({ ok: true, syntheticNativeAccountMetadata: rows.length, profilesCopied: false, credentialsCopied: false, productionOpened: false }));
})().catch(error => { console.error(error.message); process.exitCode = 1; });
