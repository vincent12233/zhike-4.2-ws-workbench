'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { DatabaseSync } = require('node:sqlite');
const { runMigrations, readIntegrity } = require('../resources/app/migration-runner.cjs');
const migrationDir = path.resolve(__dirname, '../resources/app/migrations');
const index = 'idx_ws_group_catalog_account_status';

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zhike-ws-index-'));
  const options = { dbPath: path.join(dir, 'fixture.sqlite'), migrationDir, lockPath: path.join(dir, 'fixture.lock') };
  let db = new DatabaseSync(options.dbPath);
  t.after(() => { db.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  runMigrations({ ...options, db, backup: false });
  db.exec("INSERT INTO ws_group_catalog(id,account_id,group_jid,group_name,first_seen_at,last_seen_at,created_at,updated_at) VALUES('g','default','group@g.us','sample','0','0','0','0')");
  return {
    get db() { return db; }, options,
    reopen() { db.close(); db = new DatabaseSync(options.dbPath); },
    migrate(extra = {}) { return runMigrations({ ...options, db, ...extra }); },
  };
}

// Make only this isolated fixture's index contents disagree with its schema
// while retaining the original table rows and the reviewed CREATE statement.
function emptyIndex(f, name) {
  const definition = f.db.prepare('SELECT sql FROM sqlite_schema WHERE name=?').get(name).sql;
  f.db.exec('DROP INDEX ' + name);
  f.db.exec(definition + ' WHERE 0');
  f.db.enableDefensive(false);
  f.db.exec('PRAGMA writable_schema=ON');
  f.db.prepare("UPDATE sqlite_schema SET sql=? WHERE type='index' AND name=?").run(definition, name);
  f.db.exec('PRAGMA writable_schema=OFF');
  f.reopen();
  assert.ok(readIntegrity(f.db).integrity.some(issue => issue.endsWith('missing from index ' + name)));
}

test('missing reviewed WS index is recreated after a consistent snapshot including committed WAL rows', t => {
  const f = fixture(t);
  const reader = new DatabaseSync(f.options.dbPath, { readOnly: true });
  try {
    reader.exec('BEGIN');
    assert.equal(reader.prepare('SELECT group_name FROM ws_group_catalog').get().group_name, 'sample');
    f.db.exec("UPDATE ws_group_catalog SET group_name='in WAL'; DROP INDEX " + index);
    assert.throws(() => f.migrate({ backup: false }), error => error.code === 'MIGRATION_INDEX_BACKUP_REQUIRED');
    const result = f.migrate();
    assert.deepEqual(result.repairedIndexes, [index]);
    const snapshot = new DatabaseSync(result.backupPath, { readOnly: true });
    try {
      assert.equal(snapshot.prepare('SELECT group_name FROM ws_group_catalog').get().group_name, 'in WAL');
      assert.equal(snapshot.prepare('SELECT 1 FROM sqlite_schema WHERE name=?').get(index), undefined);
      assert.equal(readIntegrity(snapshot).ok, true);
    } finally { snapshot.close(); }
    assert.equal(f.db.prepare('SELECT group_name FROM ws_group_catalog INDEXED BY ' + index).get().group_name, 'in WAL');
    const second = f.migrate();
    assert.deepEqual(second.repairedIndexes, []); assert.equal(second.backupPath, null);
  } finally { reader.close(); }
});

test('a single damaged reviewed index is rebuilt and its original diagnostic is retained in the snapshot', t => {
  const f = fixture(t);
  emptyIndex(f, index);
  const before = readIntegrity(f.db);
  const result = f.migrate();
  assert.deepEqual(result.repairedIndexes, [index]); assert.equal(result.integrity.ok, true);
  const original = new DatabaseSync(result.backupPath, { readOnly: true });
  try { assert.deepEqual(readIntegrity(original), before); }
  finally { original.close(); }
  assert.equal(f.db.prepare('SELECT group_name FROM ws_group_catalog INDEXED BY ' + index).get().group_name, 'sample');
});

test('unrecognized or multiple damaged indexes keep their original data and report the integrity failure', t => {
  const f = fixture(t), custom = 'idx_ws_fixture_custom';
  f.db.exec('CREATE INDEX ' + custom + ' ON ws_group_catalog(group_name)');
  emptyIndex(f, custom);
  const refused = () => {
    const before = readIntegrity(f.db);
    assert.throws(() => f.migrate(), error => error.code === 'MIGRATION_INTEGRITY_FAILED' && JSON.stringify(error.integrity) === JSON.stringify(before));
    assert.deepEqual(readIntegrity(f.db), before);
    assert.equal(f.db.prepare('SELECT group_name FROM ws_group_catalog NOT INDEXED').get().group_name, 'sample');
  };
  refused();
  emptyIndex(f, index);
  refused();
});
