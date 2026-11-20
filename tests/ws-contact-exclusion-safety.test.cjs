'use strict';

// Real SQLite, registered migration SQL, and synthetic identities only.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { test } = require('node:test');
const app = path.resolve(__dirname, '../resources/app');
const core = require(path.join(app, 'modules/ws-contact-exclusion-core.cjs'));
const { runMigrations, loadManifest } = require(path.join(app, 'migration-runner.cjs'));
const migrationDir = path.join(app, 'migrations');

function fixture(fn) {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys=ON');
  db.exec(fs.readFileSync(path.join(migrationDir, '026-ws-contact-exclusion.sql'), 'utf8'));
  db.exec(fs.readFileSync(path.join(migrationDir, '027-ws-exclusion-hit-retention.sql'), 'utf8'));
  try { fn(db, core.createExclusionEngine({ db })); } finally { db.close(); }
}

test('only whole phone syntax and supported personal identifiers are accepted', () => {
  for (const raw of ['employee12345678', 'Alice +917000000001', '7000000001@elsewhere.example', 'abc@lid', 'xx.12345', '1234@g.us', 'x'.repeat(241), {}, []]) {
    assert.equal(core.normalizeExclusionIdentity(raw), null, JSON.stringify(raw));
  }
  for (const raw of ['+91 70000 00001', '917000000001', '7000000001', '917000000001:12@s.whatsapp.net', '917000000001@c.us']) {
    const identity = core.normalizeExclusionIdentity(raw);
    assert.equal(identity.kind, 'phone', raw);
    assert.equal(identity.value, '7000000001', raw);
  }
  assert.equal(core.normalizeExclusionIdentity('123456789012345:9@lid').value, '123456789012345@lid');
  assert.equal(core.normalizeExclusionIdentity('xx.ENT.12345').kind, 'opaque');
});

test('a LID cannot mask a listed observed phone alias', () => fixture((db, engine) => {
  engine.upsertRule({ identity: '+917000000001' });
  const result = engine.checkIdentities(['123456789012345@lid', '+917000000001'], { accountId: 'synthetic-a', groupJid: 'synthetic-group@g.us' });
  assert.equal(result.allowed, false);
  assert.equal(result.excluded, true);
  assert.equal(result.rule.value, '7000000001');
  assert.equal(engine.listHits()[0].memberPhone, '7000000001');
}));

test('equivalent aliases create one hit and rules apply across account contexts', () => fixture((db, engine) => {
  engine.upsertRule({ identity: '+917000000001' });
  engine.checkIdentities(['+917000000001', '7000000001', '917000000001@s.whatsapp.net'], { accountId: 'synthetic-a' });
  assert.equal(engine.summary().hits, 1);
  assert.equal(engine.checkIdentities(['7000000001'], { accountId: 'synthetic-b' }).excluded, true);
  assert.equal(engine.summary().hits, 2);
}));

test('conflicting reliable aliases never authorize automatic writes', () => fixture((db, engine) => {
  for (const aliases of [
    ['7000000001', '7000000002'],
    ['123456789012345@lid', '123456789012346@lid'],
    ['xx.ENT.12345', 'xx.ENT.12346'],
  ]) {
    const result = engine.checkIdentities(aliases);
    assert.equal(result.allowed, false);
    assert.equal(result.conflict, true);
    assert.equal(result.reason, 'identity-conflict');
  }
  engine.upsertRule({ identity: '7000000002' });
  const listed = engine.checkIdentities(['7000000001', '7000000002']);
  assert.equal(listed.allowed, false);
  assert.equal(listed.excluded, true, 'a listed alias remains blocked even if other aliases conflict');
}));

test('empty and partly unreliable identity sets never authorize writes', () => fixture((db, engine) => {
  for (const aliases of [[], [''], [null], ['nickname'], ['7000000001', 'nickname'], '7000000001', Array(33).fill('7000000001')]) {
    const result = engine.checkIdentities(aliases);
    assert.equal(result.allowed, false);
    assert.equal(result.reason, 'identity-unreliable');
  }
  const coherent = engine.checkIdentities(['123456789012345@lid', '7000000001', null, '']);
  assert.equal(coherent.allowed, true);
  assert.equal(coherent.excluded, false);
}));

test('deleted or renamed rules cannot rewrite historical hit evidence', () => fixture((db, engine) => {
  const rule = engine.upsertRule({ identity: '7000000001', displayName: 'Synthetic staff' });
  engine.checkIdentities(['7000000001'], { action: core.ACTION_AUTO_FILL_BLOCKED });
  engine.upsertRule({ identity: '7000000001', displayName: 'Changed name' });
  assert.equal(engine.listHits()[0].ruleName, 'Synthetic staff');
  engine.removeRule(rule.id);
  const hits = engine.listHits();
  assert.equal(hits.length, 1);
  assert.equal(hits[0].ruleName, 'Synthetic staff');
  assert.equal(hits[0].ruleValue, '7000000001');
  assert.equal(hits[0].action, 'auto-fill-blocked');
  assert.equal(hits[0].exclusionId, rule.id);
  assert.deepEqual(engine.summary(), { total: 0, enabled: 0, hits: 1 });
  assert.equal(engine.checkIdentity('7000000001').allowed, true);
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
}));

test('query failures and audit insert failures cannot yield allowed decisions', () => fixture((db, engine) => {
  engine.upsertRule({ identity: '7000000001' });
  db.exec("CREATE TRIGGER reject_hit BEFORE INSERT ON ws_contact_exclusion_hits BEGIN SELECT RAISE(ABORT, 'synthetic audit failure'); END");
  assert.throws(() => engine.checkIdentities(['7000000001']), /synthetic audit failure/);
  db.exec('DROP TABLE ws_contact_exclusions');
  assert.throws(() => engine.checkIdentities(['7000000002']), /no such table/);
}));

test('v26 upgrade preserves original migration, audit data, backup and rerun integrity', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zhike-exclusion-upgrade-'));
  const oldDir = path.join(root, 'migrations26');
  fs.mkdirSync(oldDir);
  const shipped = JSON.parse(fs.readFileSync(path.join(migrationDir, 'manifest.json'), 'utf8'));
  const oldManifest = { ...shipped, supportedSchemaVersion: 26, migrations: shipped.migrations.filter(entry => entry.version <= 26) };
  for (const entry of oldManifest.migrations) fs.copyFileSync(path.join(migrationDir, entry.file), path.join(oldDir, entry.file));
  fs.writeFileSync(path.join(oldDir, 'manifest.json'), JSON.stringify(oldManifest));
  const dbPath = path.join(root, 'synthetic.sqlite');
  const db = new DatabaseSync(dbPath);
  const options = { db, dbPath, backupDir: path.join(root, 'backups'), lockPath: path.join(root, 'migration.lock') };
  try {
    db.exec('PRAGMA foreign_keys=ON');
    assert.equal(runMigrations({ ...options, migrationDir: oldDir }).version, 26);
    db.prepare(`INSERT INTO ws_contact_exclusions(id,identity_value,identity_kind,display_name,created_at,updated_at) VALUES(?,?,?,?,?,?)`)
      .run('synthetic-rule', '7000000001', 'phone', 'Historical staff', '2026-01-01', '2026-01-01');
    db.prepare(`INSERT INTO ws_contact_exclusion_hits(id,exclusion_id,account_id,group_jid,member_jid,action,created_at) VALUES(?,?,?,?,?,?,?)`)
      .run('synthetic-hit', 'synthetic-rule', 'synthetic-account', 'synthetic@g.us', '7000000001', 'auto-create-blocked', '2026-01-02');
    const originalMigration = db.prepare('SELECT * FROM schema_migrations WHERE version=26').get();
    assert.equal(loadManifest({ migrationDir }).supportedSchemaVersion, shipped.supportedSchemaVersion);
    const failingDb = new Proxy(db, {
      get(target, key) {
        if (key === 'exec') return sql => {
          const result = target.exec(sql);
          if (sql.includes('CREATE TABLE ws_contact_exclusion_hits_v27')) throw new Error('synthetic failure after v27 SQL');
          return result;
        };
        const value = target[key];
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    assert.throws(() => runMigrations({ ...options, db: failingDb, migrationDir }), /synthetic failure after v27 SQL/);
    assert.equal(db.prepare('PRAGMA user_version').get().user_version, 26, 'failed upgrade must keep schema 26');
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM ws_contact_exclusion_hits').get().count, 1);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE name='ws_contact_exclusion_hits_v27'").get().count, 0);
    assert.equal(db.prepare('PRAGMA table_info(ws_contact_exclusion_hits)').all().some(column => column.name === 'rule_name_snapshot'), false, 'failed table rebuild must be rolled back');
    assert.deepEqual(db.prepare('SELECT * FROM schema_migrations WHERE version=26').get(), originalMigration);
    const result = runMigrations({ ...options, migrationDir });
    assert.equal(result.version, shipped.supportedSchemaVersion);
    assert.deepEqual(db.prepare('SELECT * FROM schema_migrations WHERE version=26').get(), originalMigration);
    const engine = core.createExclusionEngine({ db });
    assert.equal(engine.listHits()[0].ruleName, 'Historical staff');
    engine.removeRule('synthetic-rule');
    assert.equal(engine.listHits()[0].id, 'synthetic-hit');
    assert.equal(engine.listHits()[0].ruleValue, '7000000001');
    assert.equal(runMigrations({ ...options, migrationDir }).applied.length, 0);
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
    assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
    assert.ok(result.backupPath, 'upgrade must retain its pre-migration SQLite backup');
    const restoredPath = path.join(root, 'restored-v26.sqlite');
    fs.copyFileSync(result.backupPath, restoredPath);
    const restored = new DatabaseSync(restoredPath, { readOnly: true });
    try {
      assert.equal(restored.prepare('PRAGMA user_version').get().user_version, 26);
      assert.equal(restored.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
      assert.equal(restored.prepare('SELECT COUNT(*) AS count FROM ws_contact_exclusion_hits').get().count, 1);
      assert.equal(restored.prepare('SELECT display_name FROM ws_contact_exclusions WHERE id=?').get('synthetic-rule').display_name, 'Historical staff');
    } finally { restored.close(); }
  } finally {
    db.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
