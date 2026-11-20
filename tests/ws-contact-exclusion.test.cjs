'use strict';
// P3 WS contact exclusion platform.
//
// Verifies the product rules that matter operationally:
//   - exclusion is evaluated BEFORE auto-create and blocks it;
//   - a listed identity never becomes a customer, but existing customers are
//     never deleted by being listed;
//   - matching uses reliable WhatsApp identity only (normalized phone / JID /
//     opaque business id), never nicknames or avatars;
//   - 91 / +91 / bare numbers collapse to one identity;
//   - a disabled rule stops excluding, and hits are recorded for the UI.
//
// Everything runs against a temporary SQLite file with synthetic identities.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');

const repo = path.resolve(__dirname, '..');
const app = path.join(repo, 'resources', 'app');
const core = require(path.join(app, 'modules', 'ws-contact-exclusion-core.cjs'));
const monitor = require(path.join(app, 'modules', 'ws-group-monitor-core.js'));

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'zhike-contact-exclusion-'));
const dbPath = path.join(tmp, 'workspace.sqlite');

function freshEngine() {
  const db = new DatabaseSync(dbPath);
  return { db, engine: core.createExclusionEngine({ db }) };
}

function applySchema(db) {
  // Mirror the migration exactly so the test fails if the production SQL drifts.
  const sql = fs.readFileSync(path.join(app, 'migrations', '026-ws-contact-exclusion.sql'), 'utf8');
  db.exec(sql);
}

const results = [];
function ok(name, fn) {
  try { fn(); results.push({ name, pass: true }); console.log('PASS ' + name); }
  catch (error) { results.push({ name, pass: false, error }); console.log('FAIL ' + name + ' :: ' + error.message); }
}

// --- identity normalization --------------------------------------------------

ok('91 / +91 / bare forms collapse to one phone identity', () => {
  const variants = ['919876543210', '+919876543210', '9876543210', '919876543210@s.whatsapp.net'];
  const values = new Set(variants.map(v => core.normalizeExclusionIdentity(v)?.value));
  assert.equal(values.size, 1, 'expected a single canonical identity, got ' + [...values].join(', '));
});

ok('bare nickname alone cannot be an exclusion identity', () => {
  // A display name without a number or a domain normalizes to a fake jid; the
  // engine must refuse it so nobody is excluded by nickname alone.
  assert.equal(core.normalizeExclusionIdentity('小王'), null);
});

ok('group JID is not an excludable person', () => {
  assert.equal(core.normalizeExclusionIdentity('123456789-987654@g.us'), null);
});

ok('lid-form jid normalizes with its own identity and no phone', () => {
  const r = core.normalizeExclusionIdentity('123456789012345@lid');
  assert.ok(r, 'lid jid should normalize');
  assert.equal(r.kind, 'jid');
  assert.equal(r.value, '123456789012345@lid');
  assert.equal(r.phone, '');
});

// --- engine behaviour --------------------------------------------------------

{
  const { db, engine } = freshEngine();
  applySchema(db);

  ok('unlisted identity is not excluded', () => {
    const r = engine.checkIdentity('919876543210');
    assert.equal(r.excluded, false);
    assert.equal(r.reason, 'not-listed');
  });

  ok('upsert stores the rule under the canonical identity', () => {
    const rule = engine.upsertRule({ identity: '+919876543210', displayName: '同事 A', note: '内部员工', createdBy: 'tester' });
    assert.equal(rule.kind, 'phone');
    assert.equal(rule.value, '9876543210');
    assert.equal(rule.phone, '9876543210');
    assert.equal(rule.enabled, true);
    assert.equal(engine.summary().total, 1);
  });

  ok('a different textual form of the same number is excluded', () => {
    for (const form of ['919876543210', '9876543210', '9876543210@s.whatsapp.net']) {
      const r = engine.checkIdentity(form, { accountId: 'a1', groupJid: 'g1@g.us' });
      assert.equal(r.excluded, true, 'expected excluded for ' + form);
      assert.equal(r.rule.value, '9876543210');
    }
  });

  ok('an unlisted number is still allowed through', () => {
    assert.equal(engine.checkIdentity('911111111111').excluded, false);
  });

  ok('blocked attempts are recorded in the hit ledger', () => {
    const hits = engine.listHits({ limit: 20 });
    assert.ok(hits.length >= 3, 'expected recorded hits, got ' + hits.length);
    assert.equal(hits[0].action, 'auto-create-blocked');
    assert.equal(hits[0].groupJid, 'g1@g.us');
    assert.equal(hits[0].accountId, 'a1');
  });

  ok('disabling a rule stops excluding without deleting the rule', () => {
    const rule = engine.listRules()[0];
    engine.setEnabled(rule.id, false);
    assert.equal(engine.checkIdentity('919876543210').excluded, false);
    assert.equal(engine.summary().enabled, 0);
    assert.equal(engine.summary().total, 1, 'rule must still exist');
    engine.setEnabled(rule.id, true);
    assert.equal(engine.checkIdentity('919876543210').excluded, true);
  });

  ok('re-enabling is idempotent and keeps one row', () => {
    engine.upsertRule({ identity: '919876543210' });
    engine.upsertRule({ identity: '919876543210' });
    assert.equal(engine.summary().total, 1);
  });

  ok('removing a rule deletes it and stops exclusion', () => {
    const rule = engine.listRules()[0];
    assert.equal(engine.removeRule(rule.id), true);
    assert.equal(engine.checkIdentity('919876543210').excluded, false);
    assert.equal(engine.summary().total, 0);
  });

  ok('opaque business-scoped id matches only the same id', () => {
    engine.upsertRule({ identity: 'xx.ENT.12345', displayName: '业务作用域' });
    assert.equal(engine.checkIdentity('xx.ENT.12345').excluded, true);
    assert.equal(engine.checkIdentity('xx.ENT.99999').excluded, false);
  });

  db.close();
}

// --- production wiring -------------------------------------------------------

ok('server.mjs consults the exclusion engine inside the auto-create path', () => {
  const source = fs.readFileSync(path.join(app, 'server.mjs'), 'utf8');
  const autoStart = source.indexOf('function wsGroupMonitorAutoCustomer(');
  const autoEnd = source.indexOf('\nfunction ', autoStart + 10);
  const body = source.slice(autoStart, autoEnd);
  assert.ok(autoStart > 0, 'wsGroupMonitorAutoCustomer must exist');
  assert.match(body, /wsContactExclusionEngine\(\)\?\.checkIdentity\(/, 'auto-create must call the exclusion gate');
  assert.match(body, /if \(exclusion\?\.excluded\) return null;/, 'a listed identity must abort creation');
  // The gate must precede identity normalization/customer construction.
  const gateAt = body.indexOf('checkIdentity');
  const memberAt = body.indexOf('const member = wsGroupMonitor.normalizeMemberIdentity');
  assert.ok(gateAt > 0 && memberAt > gateAt, 'exclusion must run before customer construction');
});

ok('migrations manifest registers version 26 with the canonical checksum', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(app, 'migrations', 'manifest.json'), 'utf8'));
  const entry = manifest.migrations.find(m => m.version === 26);
  assert.ok(entry, 'version 26 must be registered');
  assert.equal(entry.file, '026-ws-contact-exclusion.sql');
  const sql = fs.readFileSync(path.join(app, 'migrations', entry.file), 'utf8').replace(/\r\n?/g, '\n');
  const crypto = require('node:crypto');
  const actual = crypto.createHash('sha256').update(sql, 'utf8').digest('hex');
  assert.equal(actual, entry.checksum, 'manifest checksum must match the file');
  assert.ok(Number(manifest.supportedSchemaVersion) >= 26, 'schema ceiling must include 26');
});

ok('exclusion is scoped to auto-creation, not a second CRM', () => {
  const moduleSource = fs.readFileSync(path.join(app, 'modules', 'ws-contact-exclusion-core.cjs'), 'utf8');
  assert.doesNotMatch(moduleSource, /DELETE\s+FROM\s+customers|UPDATE\s+customers|INSERT\s+INTO\s+customers/i,
    'the directory must never touch the customer master');
  assert.match(moduleSource, /ws_contact_exclusion_hits/, 'hit ledger must be written by the engine');
});

// --- summary -----------------------------------------------------------------

const failed = results.filter(r => !r.pass);
try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
if (failed.length) {
  for (const f of failed) console.error('\n' + f.name + '\n' + (f.error?.stack || f.error));
  console.error(`\ncontact exclusion platform: ${results.length - failed.length}/${results.length} passed`);
  process.exitCode = 1;
} else {
  console.log(`\ncontact exclusion platform: ${results.length}/${results.length} passed`);
}
