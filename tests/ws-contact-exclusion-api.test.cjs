'use strict';
// WS contact exclusion API and production auto-create gate.
//
// Runs the real sidecar against a temporary data root with synthetic data:
//   - CRUD over /api/ws/contact-exclusions (create, list, search, enable,
//     disable, delete) with API-token protection;
//   - batch import with per-item rejection of unusable identities;
//   - hit ledger and summary counters;
//   - the production group-monitor ingest path: a listed identity must NOT
//     become a customer, an unlisted one must;
//   - existing customers are never deleted by being listed.
//
// No real account, profile, network or paid AI is used.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');

const repo = path.resolve(__dirname, '..');
const app = path.join(repo, 'resources', 'app');
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zhike-exclusion-api-'));
const port = 4791;
const token = crypto.randomBytes(24).toString('hex');
const base = `http://127.0.0.1:${port}`;
const headers = { 'x-zhike-api-token': token, origin: base, 'content-type': 'application/json' };
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

let child;
async function request(pathname, init = {}) {
  for (let attempt = 0; attempt < 400; attempt++) {
    try { return await fetch(base + pathname, { ...init, headers: { ...headers, ...(init.headers || {}) } }); }
    catch { await wait(50); }
  }
  throw new Error('sidecar did not become available');
}
const getJson = async pathname => (await request(pathname)).json();
async function api(pathname, method, body) {
  const response = await request(pathname, { method, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: response.status, value: await response.json().catch(() => ({})) };
}

const results = [];
async function check(name, fn) {
  try { await fn(); results.push({ name, pass: true }); console.log('PASS ' + name); }
  catch (error) { results.push({ name, pass: false, error }); console.log('FAIL ' + name + ' :: ' + error.message); }
}

(async () => {
  child = spawn(process.env.ZHIKE_TEST_NODE || process.execPath, ['server.mjs'], {
    cwd: app, windowsHide: true,
    env: { ...process.env, ZHIKE_DATA_DIR: dataDir, ZHIKE_PORT: String(port), ZHIKE_API_TOKEN: token, ZHIKE_SHUTDOWN_TOKEN: token },
    stdio: 'ignore',
  });
  try {
    const diagnostics = await getJson('/api/diagnostics');
    assert.ok(Number(diagnostics.schemaVersion) >= 26, 'schema 026 must be applied');

    await check('API requires the shared token', async () => {
      const response = await fetch(base + '/api/ws/contact-exclusions');
      assert.equal(response.status, 401);
    });

    await check('list starts empty with zero summary', async () => {
      const value = await getJson('/api/ws/contact-exclusions');
      assert.equal(value.rules.length, 0);
      assert.deepEqual(value.summary, { total: 0, enabled: 0, hits: 0 });
      assert.equal(value.coverage, 'exclusion-only-not-customer-directory');
    });

    let ruleId;
    await check('create normalizes +91 to a canonical phone rule', async () => {
      const { status, value } = await api('/api/ws/contact-exclusions', 'POST', { identity: '+919876543210', displayName: '同事 A', note: '内部员工' });
      assert.equal(status, 201);
      assert.equal(value.rules[0].value, '9876543210');
      assert.equal(value.rules[0].kind, 'phone');
      ruleId = value.rules[0].id;
    });

    await check('duplicate create does not add a second row', async () => {
      await api('/api/ws/contact-exclusions', 'POST', { identity: '919876543210' });
      const value = await getJson('/api/ws/contact-exclusions');
      assert.equal(value.summary.total, 1);
    });

    await check('search matches name and normalizes the query', async () => {
      const byName = await getJson('/api/ws/contact-exclusions?query=' + encodeURIComponent('同事'));
      assert.equal(byName.rules.length, 1);
      const byPhone = await getJson('/api/ws/contact-exclusions?query=9876543210');
      assert.equal(byPhone.rules.length, 1);
      const miss = await getJson('/api/ws/contact-exclusions?query=nomatch');
      assert.equal(miss.rules.length, 0);
    });

    await check('batch import accepts valid identities and rejects nicknames', async () => {
      const { status, value } = await api('/api/ws/contact-exclusions', 'POST', {
        items: [{ identity: '918111111111', displayName: '助理' }, { identity: '小王' }, { identity: 'xx.ENT.12345' }],
        source: 'import',
      });
      assert.equal(status, 201);
      assert.equal(value.rules.length, 2, 'two usable identities imported');
      assert.equal(value.rejected.length, 1, 'nickname rejected');
      assert.match(value.rejected[0].reason, /身份|昵称/);
    });

    await check('an entirely invalid batch is rejected without writing', async () => {
      const before = (await getJson('/api/ws/contact-exclusions')).summary.total;
      const { status } = await api('/api/ws/contact-exclusions', 'POST', { items: [{ identity: '小王' }] });
      assert.equal(status, 400);
      const after = (await getJson('/api/ws/contact-exclusions')).summary.total;
      assert.equal(after, before);
    });

    await check('disable stops asking for an account-absent fallback and keeps the rule', async () => {
      const { status, value } = await api(`/api/ws/contact-exclusions/${ruleId}`, 'PATCH', { enabled: false });
      assert.equal(status, 200);
      assert.equal(value.rule.enabled, false);
      assert.equal(value.summary.total, 3, 'rule still present');
      assert.equal(value.summary.enabled, 2);
    });

    await check('re-enable restores exclusion', async () => {
      const { status, value } = await api(`/api/ws/contact-exclusions/${ruleId}`, 'PATCH', { enabled: true });
      assert.equal(status, 200);
      assert.equal(value.rule.enabled, true);
      assert.equal(value.summary.enabled, 3);
    });

    await check('PATCH requires an explicit boolean', async () => {
      const { status } = await api(`/api/ws/contact-exclusions/${ruleId}`, 'PATCH', { enabled: 'yes' });
      assert.equal(status, 400);
    });

    await check('PATCH on a missing rule returns 404', async () => {
      const { status } = await api('/api/ws/contact-exclusions/wsx-missing', 'PATCH', { enabled: true });
      assert.equal(status, 404);
    });

    await check('delete removes the rule; second delete is 404', async () => {
      const first = await api(`/api/ws/contact-exclusions/${ruleId}`, 'DELETE');
      assert.equal(first.status, 200);
      assert.equal(first.value.summary.total, 2);
      const second = await api(`/api/ws/contact-exclusions/${ruleId}`, 'DELETE');
      assert.equal(second.status, 404);
    });

    await check('writes are audited in the group audit ledger', async () => {
      const db = new DatabaseSync(path.join(dataDir, 'workspace.sqlite'));
      try {
        const rows = db.prepare("SELECT action,outcome FROM ws_group_audit WHERE actor='contact-exclusion' ORDER BY created_at").all();
        assert.ok(rows.length >= 4, 'expected create/import/enable/disable/delete audit rows, got ' + rows.length);
        assert.ok(rows.some(row => row.action === 'contact-exclusion.import'));
        assert.ok(rows.some(row => row.action === 'contact-exclusion.delete'));
      } finally { db.close(); }
    });

    // --- production auto-create gate ---------------------------------------
    // Enable a monitor seat and an enabled target for the synthetic group, then
    // push real join events through the production ingest batch endpoint.
    let profileId;
    await check('prepare a real enabled monitor seat and target', async () => {
      const seat = await api('/api/ws/group-monitors/profiles', 'POST', { accountId: 'default', slotKey: 'exclusion-gate-seat', enabled: true });
      assert.ok([200, 201].includes(seat.status), 'seat created, got ' + seat.status);
      profileId = seat.value.profile.id;
      const scan = await api(`/api/ws/group-monitors/${profileId}/targets/scan?accountId=default`, 'POST', {
        accountId: 'default',
        targets: [{ groupJid: 'exclusiongate1@g.us', groupName: '排除验收群', enabled: true }],
      });
      assert.ok([200, 201].includes(scan.status), 'target created, got ' + scan.status);
    });

    await check('production ingest: listed identity never becomes a customer', async () => {
      await api('/api/ws/contact-exclusions', 'POST', { identity: '917000000001', displayName: '群管理员' });
      const before = await customerCount();
      const ingest = await api('/api/ws/ingest/batch', 'POST', {
        accountId: 'default',
        groupEvents: [{ groupJid: 'exclusiongate1@g.us', memberId: '917000000001@s.whatsapp.net', type: 'joined', eventAt: new Date().toISOString(), sourceEventId: 'evt-listed-1', confidence: 0.95, memberName: 'Group Admin' }],
      });
      assert.equal(ingest.status, 200, 'ingest accepted');
      assert.equal(ingest.value.groupEvents.ignored, 0, 'event must reach the gate, not be ignored: ' + JSON.stringify(ingest.value.groupEvents.events));
      const after = await customerCount();
      assert.equal(after, before, 'a listed member must not create a customer');
    });

    await check('production ingest: unlisted identity still auto-creates', async () => {
      const before = await customerCount();
      const ingest = await api('/api/ws/ingest/batch', 'POST', {
        accountId: 'default',
        groupEvents: [{ groupJid: 'exclusiongate1@g.us', memberId: '917000000999@s.whatsapp.net', type: 'joined', eventAt: new Date().toISOString(), sourceEventId: 'evt-unlisted-1', confidence: 0.95, memberName: 'New Lead' }],
      });
      assert.equal(ingest.status, 200);
      const after = await customerCount();
      assert.ok(after > before, 'an unlisted confirmed join must still create a customer');
      assert.equal(ingest.value.groupEvents.autoRegistered, 1, 'auto-registration counter must reflect it');
    });

    await check('exclusion does not delete an existing customer', async () => {
      const listed = await customerCount();
      await api('/api/ws/contact-exclusions', 'POST', { identity: '917000000999', displayName: '转为员工' });
      const after = await customerCount();
      assert.equal(after, listed, 'customer master must be untouched by exclusion');
    });

    await check('oversized imports are rejected without silent truncation', async () => {
      const before = (await getJson('/api/ws/contact-exclusions')).summary.total;
      const imported = await api('/api/ws/contact-exclusions', 'POST', { items: Array.from({ length: 2001 }, () => ({ identity: '918000000007' })) });
      assert.equal(imported.status, 400);
      assert.equal(imported.value.code, 'CONTACT_EXCLUSION_BATCH_TOO_LARGE');
      assert.equal((await getJson('/api/ws/contact-exclusions')).summary.total, before);
      assert.equal((await api('/api/ws/contact-exclusions', 'POST', { items: [] })).status, 400);
      assert.equal((await api('/api/ws/contact-exclusions', 'POST', null)).status, 400);
    });

    await check('LID and phone aliases cannot bypass the production exclusion gate', async () => {
      const before = await customerCount();
      const ingested = await api('/api/ws/ingest/batch', 'POST', { accountId: 'default', groupEvents: [{
        groupJid: 'exclusiongate1@g.us', memberId: '123456789012345@lid', memberPhone: '+917000000001',
        type: 'joined', eventAt: new Date().toISOString(), sourceEventId: 'evt-alias-excluded', confidence: 0.95,
      }] });
      assert.equal(ingested.status, 200);
      assert.equal(ingested.value.groupEvents.accepted, 1);
      assert.equal(ingested.value.groupEvents.autoRegistered, 0);
      assert.equal(await customerCount(), before);
    });

    await check('conflicting or unreliable aliases remain unconfirmed without creating customers', async () => {
      const before = await customerCount();
      for (const [index, identity] of [
        { memberId: '918000000010@s.whatsapp.net', memberPhone: '918000000011' },
        { memberId: 'employee8000000012', memberPhone: '918000000012' },
        { memberId: '8000000013@untrusted.example' },
      ].entries()) {
        const ingested = await api('/api/ws/ingest/batch', 'POST', { accountId: 'default', groupEvents: [{
          ...identity, groupJid: 'exclusiongate1@g.us', type: 'joined', eventAt: new Date().toISOString(),
          sourceEventId: 'evt-unreliable-' + index, confidence: 0.95,
        }] });
        assert.equal(ingested.status, 200);
        assert.equal(ingested.value.groupEvents.autoRegistered, 0);
      }
      assert.equal(await customerCount(), before);
    });

    await check('audit storage failure rolls back the rule mutation', async () => {
      const db = new DatabaseSync(path.join(dataDir, 'workspace.sqlite'));
      const before = (await getJson('/api/ws/contact-exclusions')).summary.total;
      try {
        db.exec("CREATE TRIGGER reject_exclusion_audit BEFORE INSERT ON ws_group_audit WHEN NEW.actor='contact-exclusion' BEGIN SELECT RAISE(ABORT,'synthetic audit failure'); END");
        const result = await api('/api/ws/contact-exclusions', 'POST', { identity: '918000000014' });
        assert.ok(result.status >= 400, JSON.stringify(result));
        assert.equal((await getJson('/api/ws/contact-exclusions')).summary.total, before);
      } finally { db.exec('DROP TRIGGER IF EXISTS reject_exclusion_audit'); db.close(); }
    });

    await check('rule deletion retains historical hit identity and name', async () => {
      const rules = (await getJson('/api/ws/contact-exclusions')).rules;
      const rule = rules.find(row => row.value === '7000000001');
      assert.ok(rule);
      const before = (await getJson('/api/ws/contact-exclusions/hits?limit=500')).hits.filter(hit => hit.exclusionId === rule.id);
      assert.ok(before.length >= 2);
      assert.equal((await api('/api/ws/contact-exclusions/' + rule.id, 'DELETE')).status, 200);
      const after = (await getJson('/api/ws/contact-exclusions/hits?limit=500')).hits.filter(hit => hit.exclusionId === rule.id);
      assert.deepEqual(after, before);
      assert.equal(after[0].ruleName, '群管理员');
    });

    await check('blocked attempts appear in the hit ledger', async () => {
      const value = await getJson('/api/ws/contact-exclusions/hits?limit=20');
      assert.ok(value.hits.length >= 1, 'expected a recorded hit for the blocked member');
      assert.equal(value.hits[0].action, 'auto-create-blocked');
    });
  } finally {
    try { await fetch(base + '/api/shutdown', { method: 'POST', headers: { ...headers, 'x-zhike-shutdown-token': token }, signal: AbortSignal.timeout(3000) }); } catch {}
    for (let i = 0; i < 100 && child.exitCode == null; i++) await wait(50);
    if (child.exitCode == null) child.kill();
    try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch {}
  }

  const failed = results.filter(row => !row.pass);
  console.log(`\ncontact exclusion API: ${results.length - failed.length}/${results.length} passed`);
  if (failed.length) { for (const row of failed) console.error(row.name + '\n' + (row.error?.stack || row.error)); process.exitCode = 1; }
})().catch(error => { console.error(error.stack || error); process.exitCode = 1; });

async function customerCount() {
  const state = await getJson('/api/state');
  const customers = Array.isArray(state?.data?.customers) ? state.data.customers : Array.isArray(state?.customers) ? state.customers : [];
  return customers.filter(customer => customer && customer.deleted !== true).length;
}
