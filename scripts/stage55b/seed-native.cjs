'use strict';
// Extends the existing synthetic fixture through real isolated APIs only.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');
const root = path.resolve(process.argv[2] || '');
assert.equal(path.dirname(root).toLowerCase(), path.resolve(os.tmpdir()).toLowerCase());
assert.match(path.basename(root), /^zhike-stage51-native-[a-f0-9]{32}$/);
assert.equal(fs.lstatSync(root).isSymbolicLink(), false);
assert.equal(fs.readFileSync(path.join(root, '.stage51-isolated'), 'utf8'), 'zhike-stage51-isolated-ui-v1');
assert.equal(fs.existsSync(path.join(root, 'seed-evidence.json')), false, 'Never reseed an existing acceptance workspace.');
execFileSync(process.execPath, [path.resolve(__dirname, '../stage51/seed-native.cjs'), root], { stdio: 'inherit', windowsHide: true });
const connection = JSON.parse(fs.readFileSync(path.join(root, 'connection.private.json'), 'utf8'));
assert.equal(connection.isolated, true); assert.equal(path.resolve(connection.root), root);
const endpoint = new URL(connection.endpoint);
assert.equal(endpoint.hostname, '127.0.0.1'); assert.equal(endpoint.protocol, 'http:');
const headers = { 'content-type': 'application/json', 'x-zhike-api-token': connection.apiToken, origin: endpoint.origin };
async function api(route, body, method = 'POST') {
  const response = await fetch(new URL(route, endpoint), { method, headers, ...(method === 'GET' ? {} : { body: JSON.stringify(body || {}) }), signal: AbortSignal.timeout(15000) });
  const data = await response.json();
  assert.ok(response.ok, route + ': ' + String(data.error || response.status));
  return data;
}
(async () => {
  const lease = (await api('/api/ws/fencing', { action: 'acquire', scopeKey: 'stage55b-seed', ownerId: 'stage55b-synthetic', leaseMs: 120000 })).lease;
  for (const accountId of ['default', 'native-b']) {
    for (let index = 0; index < 45; index++) {
      const phone = '919900000' + String(100 + index);
      await api('/api/ws/conversations', {
        id: `stage55b-contact-${accountId}-${index}`, accountId, externalId: phone + '@s.whatsapp.net',
        title: `隔离通讯录 ${accountId === 'default' ? 'A' : 'B'} ${String(index + 1).padStart(2, '0')}`,
        data: { conversationType: 'direct', phone: '+91 ' + phone.slice(2), source: 'stage55b-synthetic' },
      });
    }
    await api('/api/ws/conversations', { accountId, externalId: '919000000051@s.whatsapp.net', title: '隔离已关联客户', customerId: 'C-native', bindingSource: 'manual', data: { conversationType: 'direct', phone: '+91 9000000051' } });
    await api('/api/ws/conversations', { accountId, externalId: '9000000051@c.us', title: '隔离重复号码提示', data: { conversationType: 'direct', phone: '0091 9000000051' } });
    await api('/api/ws/conversations', { accountId, externalId: 'stage55b-opaque@lid', title: '号码未提供的隔离联系人', data: { conversationType: 'direct' } });
    for (let index = 0; index < 42; index++) {
      await api('/api/ws/ai-pipeline/jobs', { accountId, conversationId: 'native-chat-' + accountId, customerId: 'C-native', jobType: 'stage55b-synthetic-review', idempotencyKey: 'stage55b-audit-' + accountId + '-' + index, lease });
    }
  }
  const state = await api('/api/state', null, 'GET');
  assert.equal(state.customers.length, 2, 'Contact fixture must not create CRM customers.');
  const contacts = await api('/api/ws/workspace/contacts?accountId=default', null, 'GET');
  const audit = await api('/api/ws/workspace/audit?accountId=default', null, 'GET');
  assert.ok(contacts.total > 40); assert.ok(audit.total > 40);
  const evidence = { stage: '5.5B', synthetic: true, contactsDefault: contacts.total, auditDefault: audit.total, crmCustomers: state.customers.length, realWs: false, paidAi: false, productionOpened: false };
  fs.writeFileSync(path.join(root, 'stage55b-seed-evidence.json'), JSON.stringify(evidence, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  console.log(JSON.stringify(evidence));
})().catch(error => { console.error(error.message); process.exitCode = 1; });
