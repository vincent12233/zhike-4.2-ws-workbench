const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { mkdtempSync, rmSync } = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const app = path.join(__dirname, '..', 'resources', 'app');
const dataDir = mkdtempSync(path.join(os.tmpdir(), 'zhike-data-archive-'));
const port = 4482;
const token = 'data-archive-test-token';
const child = spawn(process.env.ZHIKE_TEST_NODE || process.execPath, ['server.mjs'], {
  cwd: app,
  windowsHide: true,
  env: { ...process.env, ZHIKE_DATA_DIR: dataDir, ZHIKE_PORT: String(port), ZHIKE_API_TOKEN: token, ZHIKE_SHUTDOWN_TOKEN: token },
  stdio: 'ignore',
});
const headers = { 'content-type': 'application/json', 'x-zhike-api-token': token, origin: `http://127.0.0.1:${port}` };
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function request(pathname, init = {}) {
  for (let i = 0; i < 1200; i++) {
    try {
      const nextHeaders = { ...headers, ...(init.headers || {}) };
      if (String(init.method || 'GET').toUpperCase() !== 'GET' && pathname !== '/api/state' && !Object.keys(nextHeaders).some(key => key.toLowerCase() === 'x-state-version')) {
        const version = await fetch(`http://127.0.0.1:${port}/api/state/version`, { headers }).then(response => response.json());
        nextHeaders['x-state-version'] = String(version.version || '');
      }
      return await fetch(`http://127.0.0.1:${port}${pathname}`, { ...init, headers: nextHeaders });
    } catch { await wait(50); }
  }
  throw new Error('isolated server did not become available');
}
const json = response => response.json();
const body = value => JSON.stringify(value);

(async () => {
  try {
    const account = await request('/api/ws/accounts', { method: 'POST', body: body({ id: 'archive-account-b', displayName: 'B' }) });
    assert.equal(account.status, 201);
    const created = await json(await request('/api/ws/conversations', { method: 'POST', body: body({ accountId: 'default', externalId: 'contact-archive', title: '档案客户', conversationType: 'direct', unreadCount: 0, data: { phone: '+91 9876543210', historyLoaded: true, historyFingerprint: 'archive-h', lastMessageFingerprint: 'archive-h', directionVersion: 4 } }) }));
    const stateResponse = await request('/api/state');
    const state = await json(stateResponse);
    const customer = { id: 'ARCHIVE-1', name: '档案客户', phone: '919876543210', rawPhone: '+91 9876543210', wsExternalId: '+919876543210', wsAccountId: 'default', wsConversationId: created.id, registered: '2026-11-15', source: 'WS', metadata: { safe: 'kept', token: 'must-not-leak', nested: { apiKey: 'must-not-leak' } } };
    state.customers = [...(state.customers || []), customer];
    state.tickets = [{ id: 'ticket-archive', customerId: customer.id, code: 'ABC', date: '2026-11-10', metadata: { apiKey: 'must-not-leak', safe: 'ticket-kept' } }];
    state.registrations = [{ id: 'reg-archive', customerId: customer.id, status: '已报名', date: '2026-11-11' }];
    state.deposits = [{ id: 'dep-archive', customerId: customer.id, amount: 1000, date: '2026-11-12' }];
    state.followups = [{ id: 'follow-archive', customerId: customer.id, note: '跟进记录', date: '2026-11-13' }];
    state.settings = { ...(state.settings || {}), operatingTasks: [{ id: 'task-archive', customerId: customer.id, title: 'AI 跟进', aiGenerated: true, status: 'open' }] };
    const saved = await request('/api/state', { method: 'PUT', headers: { 'x-state-version': String(stateResponse.headers.get('x-state-version') || (await (await request('/api/state/version')).json()).version) }, body: body(state) });
    assert.equal(saved.status, 200);
    await request('/api/ws/messages', { method: 'POST', body: body({ accountId: 'default', conversationId: created.id, externalId: 'archive-message-1', direction: 'receive', originalText: '我是客户，想了解方案', order: 1 }) });
    const before = await json(await request('/api/state/version'));
    const archive = await request(`/api/data-archive/customer?accountId=default&conversationId=${encodeURIComponent(created.id)}`);
    assert.equal(archive.status, 200);
    const archiveBody = await json(archive);
    assert.equal(archiveBody.matched, true);
    assert.equal(archiveBody.customer.id, customer.id);
    assert.equal(archiveBody.customer.metadata.safe, 'kept');
    assert.equal(archiveBody.customer.metadata.token, undefined);
    assert.equal(archiveBody.customer.metadata.nested.apiKey, undefined);
    assert.equal(archiveBody.records.tickets[0].metadata.safe, 'ticket-kept');
    assert.equal(archiveBody.records.tickets[0].metadata.apiKey, undefined);
    assert.equal(archiveBody.conversation.data.apiKey, undefined);
    assert.equal(archiveBody.records.tickets.length, 1);
    assert.equal(archiveBody.records.registrations.length, 1);
    assert.equal(archiveBody.records.deposits.length, 1);
    assert.equal(archiveBody.records.followups.length, 1);
    assert.equal(archiveBody.records.tasks.length, 1);
    assert.equal(archiveBody.ws.messages.length, 1);
    assert.equal(archiveBody.ws.messagesOffset, 0);
    assert.equal(archiveBody.ws.messagesHasMore, false);
    const archivePage = await json(await request(`/api/data-archive/customer?accountId=default&conversationId=${encodeURIComponent(created.id)}&messagesOffset=1&messagesLimit=1`));
    assert.equal(archivePage.ws.messageTotal, 1);
    assert.equal(archivePage.ws.messages.length, 0);
    assert.equal(archivePage.ws.messagesHasMore, false);
    const after = await json(await request('/api/state/version'));
    assert.equal(after.version, before.version, 'archive read must not mutate the CRM revision');

    const crossAccount = await request(`/api/data-archive/customer?accountId=archive-account-b&conversationId=${encodeURIComponent(created.id)}`);
    assert.ok([403, 404].includes(crossAccount.status), 'conversation must not cross WS account boundaries');
    const missing = await request('/api/data-archive/customer?accountId=default&customerId=missing-archive-customer');
    assert.equal(missing.status, 404, 'unknown explicit customer ids must fail closed');
    const unmatchedConversation = await json(await request('/api/ws/conversations', { method: 'POST', body: body({ accountId: 'default', externalId: 'archive-unmatched', title: '未匹配', conversationType: 'direct', unreadCount: 0 }) }));
    const unknown = await json(await request(`/api/data-archive/customer?accountId=default&conversationId=${encodeURIComponent(unmatchedConversation.id)}`));
    assert.equal(unknown.matched, false);
    assert.equal(unknown.customer, null);
    assert.deepEqual(unknown.records, { tickets: [], registrations: [], deposits: [], followups: [], tasks: [] });
    console.log('ws-data-archive-api: unified CRM/WS archive read, business records, account isolation and non-mutating contract passed');
  } finally {
    try { await fetch(`http://127.0.0.1:${port}/api/shutdown`, { method: 'POST', headers: { ...headers, 'x-zhike-shutdown-token': token } }); } catch {}
    await wait(100); child.kill(); await wait(100);
    try { rmSync(dataDir, { recursive: true, force: true }); } catch {}
  }
})();
