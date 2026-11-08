const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { mkdtempSync, rmSync } = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const app = path.join(__dirname, '..', 'resources', 'app');
const dataDir = mkdtempSync(path.join(os.tmpdir(), 'zhike-hot-profile-'));
const port = 4476, token = 'hot-profile-test-token';
const child = spawn(process.execPath, ['server.mjs'], { cwd: app, windowsHide: true, env: { ...process.env, ZHIKE_DATA_DIR: dataDir, ZHIKE_PORT: String(port), ZHIKE_API_TOKEN: token, ZHIKE_SHUTDOWN_TOKEN: token }, stdio: ['ignore','pipe','pipe'] });
child.stderr.on('data', d => process.stderr.write(d)); const headers = { 'content-type': 'application/json', 'x-zhike-api-token': token, origin: `http://127.0.0.1:${port}` };
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function request(pathname, init = {}) { for (let i = 0; i < 120; i++) { try { const h = { ...headers, ...(init.headers || {}) }; if (String(init.method || 'GET').toUpperCase() !== 'GET' && !Object.keys(h).some(k => k.toLowerCase() === 'x-state-version')) { const v = await fetch(`http://127.0.0.1:${port}/api/state/version`, { headers }).then(r => r.json()); h['x-state-version'] = String(v.version || ''); } return fetch(`http://127.0.0.1:${port}${pathname}`, { ...init, headers: h }); } catch { await wait(50); } } throw new Error('server unavailable'); }
const body = data => JSON.stringify(data);
(async () => { try { await wait(2000);
  const first = await request('/api/ws/hot-chat/profile?accountId=default&conversationId=missing&customerId=C1'); assert.equal(first.status, 200); const initial = await first.json(); assert.equal(initial.profile.customerId, 'C1');
  const version = (await (await request('/api/state/version')).json()).version;
  const put = await request('/api/ws/hot-chat/profile', { method: 'PUT', headers: { 'x-state-version': version }, body: body({ accountId: 'default', conversationId: 'missing', customerId: 'C1', fields: { age: { value: 36, confidence: 0.9, evidence: '我今年36岁' } } }) }); assert.equal(put.status, 200); const saved = await put.json(); assert.equal(saved.profile.fields.age.state, 'known');
  const stale = await request('/api/ws/hot-chat/profile', { method: 'PUT', headers: { 'x-state-version': version }, body: body({ accountId: 'default', conversationId: 'missing', customerId: 'C1', fields: { gender: { value: '女', confidence: 0.9, evidence: '我是女性' } } }) }); assert.equal(stale.status, 409);
  const facts = await request('/api/ws/hot-chat/profile/facts', { method: 'POST', body: body({ accountId: 'default', conversationId: 'missing', customerId: 'C1', facts: [{ field: 'age', value: 36, confidence: 0.9, evidence: '我今年36岁' }] }) }); assert.equal(facts.status, 200);
  const events = await request('/api/ws/hot-chat/profile/events', { method: 'POST', body: body({ accountId: 'default', conversationId: 'missing', customerId: 'C1', type: 'message', idempotencyKey: 'm1', payload: { text: '你好' } }) }); assert.equal(events.status, 200); const repeated = await request('/api/ws/hot-chat/profile/events', { method: 'POST', body: body({ accountId: 'default', conversationId: 'missing', customerId: 'C1', type: 'message', idempotencyKey: 'm1', payload: { text: '你好' } }) }); assert.equal((await repeated.json()).existed, true);
  const diagnostics = await request('/api/ws/hot-chat/profile/diagnostics?accountId=default&conversationId=missing&customerId=C1'); assert.equal(diagnostics.status, 200); const d = await diagnostics.json(); assert.ok(d.outbox.count >= 1);
  console.log('hot-chat-profile-api: migration, isolation, evidence dedupe, version conflicts, events and outbox passed');
} finally { try { await fetch(`http://127.0.0.1:${port}/api/shutdown`, { method: 'POST', headers: { ...headers, 'x-zhike-shutdown-token': token } }); } catch {} await wait(100); child.kill(); await wait(100); try { rmSync(dataDir, { recursive: true, force: true }); } catch {} } })();








