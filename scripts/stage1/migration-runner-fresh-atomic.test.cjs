'use strict';

// Real SQLite connections and synthetic files only; never start the product or
// open a user workspace. Registered SQL is copied/read without modification.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');
const { runMigrations, hashMigration, loadManifest, readIntegrity } = require('../../resources/app/migration-runner.cjs');

const source = path.resolve(__dirname, '../../resources/app/migrations');
const shipped = loadManifest({ migrationDir: source });
const fixtureSql = [
  'CREATE TABLE facts(id INTEGER PRIMARY KEY, value TEXT NOT NULL); INSERT INTO facts VALUES(1,\'synthetic\');',
  'CREATE TABLE related(id INTEGER PRIMARY KEY, fact_id INTEGER REFERENCES facts(id)); INSERT INTO related VALUES(1,1);',
  'CREATE INDEX idx_facts_value ON facts(value);',
];

function options(dir, migrationDir = path.join(dir, 'migrations')) {
  return { dbPath: path.join(dir, 'workspace.sqlite'), migrationDir, backupDir: path.join(dir, 'backups'), lockPath: path.join(dir, 'migration.lock'), lockTimeoutMs: 3000 };
}

function writeMigrations(dir, statements = fixtureSql) {
  const migrationDir = path.join(dir, 'migrations');
  fs.mkdirSync(migrationDir, { recursive: true });
  const migrations = statements.map((sql, index) => {
    const version = index + 1;
    const file = String(version).padStart(3, '0') + '-fixture.sql';
    fs.writeFileSync(path.join(migrationDir, file), sql);
    return { version, file, description: 'synthetic migration ' + version, checksum: hashMigration(sql) };
  });
  fs.writeFileSync(path.join(migrationDir, 'manifest.json'), JSON.stringify({ format: 1, supportedSchemaVersion: statements.length, migrations }));
}

function observe(db, hooks = {}) {
  const counts = { begins: 0, commits: 0, rollbacks: 0, integrity: 0, quick: 0, foreignKeys: 0 };
  const wrapper = new Proxy(db, {
    get(target, key) {
      if (key === 'exec') return sql => {
        const normalized = sql.trim().replace(/;$/, '').toUpperCase();
        if (normalized === 'BEGIN IMMEDIATE') counts.begins++;
        if (normalized === 'COMMIT') counts.commits++;
        if (normalized === 'ROLLBACK') counts.rollbacks++;
        hooks.beforeExec?.(sql, counts);
        const result = target.exec(sql);
        hooks.afterExec?.(sql, counts);
        return result;
      };
      if (key === 'prepare') return sql => {
        const statement = target.prepare(sql);
        return new Proxy(statement, {
          get(prepared, method) {
            if (method === 'all') return (...args) => {
              if (sql === 'PRAGMA integrity_check') counts.integrity++;
              if (sql === 'PRAGMA quick_check') counts.quick++;
              if (sql === 'PRAGMA foreign_key_check') counts.foreignKeys++;
              const rows = prepared.all(...args);
              return hooks.afterAll ? hooks.afterAll(sql, rows, counts) : rows;
            };
            const value = prepared[method];
            return typeof value === 'function' ? value.bind(prepared) : value;
          },
        });
      };
      const value = target[key];
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  return { db: wrapper, counts };
}

function schema(db) {
  return db.prepare('SELECT type,name,tbl_name,sql FROM sqlite_master ORDER BY type,name').all().map(row => ({ ...row }));
}

function tableRows(db, name) {
  const identifier = '"' + name.replace(/"/g, '""') + '"';
  return db.prepare('SELECT * FROM ' + identifier).all().map(row => JSON.stringify(row)).sort();
}

function assertEmpty(db) {
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, 0, 'failed fresh initialization must leave user_version zero');
  assert.deepEqual(schema(db), [], 'failed fresh initialization must remove all schema, including migration metadata');
  assert.equal(readIntegrity(db).ok, true);
}

function assertRetry(fx, db) {
  const result = runMigrations({ ...fx, db });
  assert.equal(result.version, fixtureSql.length);
  assert.equal(db.prepare('SELECT value FROM facts WHERE id=1').get().value, 'synthetic');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM schema_migrations').get().n, fixtureSql.length);
  assert.equal(result.integrity.ok, true);
}

function main() {
  if (process.argv[2] === '--crash') {
    const fx = options(process.argv[3]);
    const db = new DatabaseSync(fx.dbPath);
    const watched = observe(db, { afterExec(sql) {
      if (sql === fixtureSql[1]) {
        fs.writeFileSync(path.join(process.argv[3], 'interrupted'), 'after second migration SQL, before commit');
        // Bypass runner finally and DatabaseSync.close, as with abrupt process loss.
        process.exit(73);
      }
    } });
    runMigrations({ ...fx, db: watched.db });
    throw new Error('interruption point not reached');
  }

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zhike-fresh-atomic-'));
  const passed = [], failures = [];
  let comparedShippedTables = 0;
  function check(name, fn) {
    const dir = path.join(root, String(passed.length + failures.length));
    fs.mkdirSync(dir);
    writeMigrations(dir);
    const fx = options(dir);
    try { fn(fx, dir); passed.push(name); console.log('[PASS] ' + name); }
    catch (error) { failures.push({ name, message: error.stack }); console.error('[FAIL] ' + name + ': ' + error.message); }
  }
  try {
    check('shipped fresh schema uses one commit, preserves checksums, backup, integrity and durability', (fx, dir) => {
      const db = new DatabaseSync(fx.dbPath);
      const watched = observe(db);
      try {
        // Migration 008 seeds timestamps with datetime('now'). Fix only that
        // fixture clock on both connections so every persisted field can be
        // compared exactly, even when the runs cross a wall-clock second.
        const fixedNow = value => { assert.equal(value, 'now'); return '2026-11-19 00:00:00'; };
        db.function('datetime', fixedNow);
        const synchronous = db.prepare('PRAGMA synchronous').get().synchronous;
        const result = runMigrations({ ...fx, migrationDir: source, db: watched.db });
        assert.equal(result.version, shipped.supportedSchemaVersion);
        assert.equal(result.applied.length, shipped.migrations.length);
        assert.equal(watched.counts.begins, 1);
        assert.equal(watched.counts.commits, 1, 'all fresh migrations must share one durable commit');
        assert.equal(watched.counts.rollbacks, 0);
        for (const kind of ['integrity', 'quick', 'foreignKeys']) assert.equal(watched.counts[kind], shipped.migrations.length + 2, kind + ' must run before, after each migration, and at the final gate');
        assert.equal(db.prepare('PRAGMA synchronous').get().synchronous, synchronous);
        assert.equal(db.prepare('PRAGMA foreign_keys').get().foreign_keys, 1);
        assert.equal(db.prepare('PRAGMA journal_mode').get().journal_mode, 'wal');
        assert.deepEqual(db.prepare('SELECT version,checksum FROM schema_migrations ORDER BY version').all().map(row => ({ ...row })), shipped.migrations.map(({ version, checksum }) => ({ version, checksum })));
        assert.ok(result.backupPath && fs.existsSync(result.backupPath));
        const backup = new DatabaseSync(result.backupPath);
        try { assertEmpty(backup); } finally { backup.close(); }

        // Compare against the existing per-migration route, selected by a
        // preexisting registry. This checks complete schema parity independently.
        const legacyFx = { ...fx, dbPath: path.join(dir, 'legacy.sqlite'), lockPath: path.join(dir, 'legacy.lock') };
        const legacy = new DatabaseSync(legacyFx.dbPath);
        try {
          legacy.function('datetime', fixedNow);
          legacy.exec('CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL, description TEXT NOT NULL, checksum TEXT NOT NULL)');
          runMigrations({ ...legacyFx, migrationDir: source, db: legacy });
          // CREATE formatting of the preexisting registry is intentionally different.
          assert.deepEqual(schema(db).filter(row => row.name !== 'schema_migrations'), schema(legacy).filter(row => row.name !== 'schema_migrations'));
          const tables = schema(db).filter(row => row.type === 'table' && row.name !== 'schema_migrations');
          for (const table of tables) assert.deepEqual(tableRows(db, table.name), tableRows(legacy, table.name), 'seed rows/defaults differ in ' + table.name);
          comparedShippedTables = tables.length;
        } finally { legacy.close(); }
        const before = db.prepare('SELECT * FROM schema_migrations ORDER BY version').all();
        const repeated = runMigrations({ ...fx, migrationDir: source, db: watched.db });
        assert.equal(repeated.applied.length, 0);
        assert.equal(repeated.backupPath, null);
        assert.equal(watched.counts.commits, 1);
        assert.deepEqual(db.prepare('SELECT * FROM schema_migrations ORDER BY version').all(), before);
      } finally { db.close(); }
    });

    check('a second connection sees no partial schema or version before the only commit', fx => {
      const db = new DatabaseSync(fx.dbPath);
      let observations = 0;
      const watched = observe(db, { afterExec(sql) {
        if (!fixtureSql.includes(sql)) return;
        const reader = new DatabaseSync(fx.dbPath);
        try { assertEmpty(reader); observations++; } finally { reader.close(); }
      } });
      try { assertRetry(fx, watched.db); assert.equal(observations, fixtureSql.length); }
      finally { db.close(); }
    });

    check('a late SQL failure rolls back schema, audit rows and version, then retries', (fx, dir) => {
      writeMigrations(dir, [...fixtureSql, 'CREATE TABLE staged(id INTEGER); INSERT INTO missing_table VALUES(1);']);
      const db = new DatabaseSync(fx.dbPath);
      try {
        assert.throws(() => runMigrations({ ...fx, db }), error => error.code === 'MIGRATION_FAILED' && error.version === 4);
        assertEmpty(db);
        fs.unlinkSync(path.join(fx.migrationDir, '004-fixture.sql'));
        writeMigrations(dir);
        assertRetry(fx, db);
      } finally { db.close(); }
    });

    check('deferred foreign-key violations fail the per-migration integrity gate and roll back all', (fx, dir) => {
      writeMigrations(dir, [...fixtureSql, 'CREATE TABLE invalid_child(id INTEGER REFERENCES facts(id) DEFERRABLE INITIALLY DEFERRED); INSERT INTO invalid_child VALUES(99);']);
      const db = new DatabaseSync(fx.dbPath);
      try {
        assert.throws(() => runMigrations({ ...fx, db }), error => error.code === 'MIGRATION_INTEGRITY_FAILED' && error.integrity.foreignKeys.length === 1);
        assertEmpty(db);
        fs.unlinkSync(path.join(fx.migrationDir, '004-fixture.sql'));
        writeMigrations(dir);
        assertRetry(fx, db);
      } finally { db.close(); }
    });

    check('final integrity failure occurs before commit and rolls back all initialization', fx => {
      const db = new DatabaseSync(fx.dbPath);
      const watched = observe(db, { afterAll(sql, rows, counts) {
        if (sql === 'PRAGMA integrity_check' && counts.integrity === fixtureSql.length + 2) return [{ integrity_check: 'synthetic final integrity failure' }];
        return rows;
      } });
      try {
        assert.throws(() => runMigrations({ ...fx, db: watched.db }), error => error.code === 'MIGRATION_INTEGRITY_FAILED');
        assert.equal(watched.counts.commits, 0);
        assertEmpty(db);
        assertRetry(fx, db);
      } finally { db.close(); }
    });

    check('commit failure rolls back metadata and all migrations and releases the lease', fx => {
      const db = new DatabaseSync(fx.dbPath);
      const watched = observe(db, { beforeExec(sql) {
        if (sql.trim().replace(/;$/, '').toUpperCase() === 'COMMIT') throw new Error('synthetic COMMIT IO failure');
      } });
      try {
        assert.throws(() => runMigrations({ ...fx, db: watched.db }), /synthetic COMMIT IO failure/);
        assertEmpty(db);
        assert.equal(fs.existsSync(fx.lockPath), false);
        assertRetry(fx, db);
      } finally { db.close(); }
    });

    check('abrupt child exit leaves no partial initialization and next process can retry', (fx, dir) => {
      const child = spawnSync(process.execPath, [__filename, '--crash', dir], { encoding: 'utf8', windowsHide: true, timeout: 10000 });
      assert.equal(child.error, undefined);
      assert.equal(child.status, 73, child.stderr);
      assert.equal(fs.readFileSync(path.join(dir, 'interrupted'), 'utf8'), 'after second migration SQL, before commit');
      const db = new DatabaseSync(fx.dbPath);
      try { assertEmpty(db); assertRetry(fx, db); assert.equal(fs.existsSync(fx.lockPath), false); }
      finally { db.close(); }
    });

    for (const existing of ['table', 'view', 'registry', 'sqlite-statistics']) {
      check('version-zero database with existing ' + existing + ' retains incremental upgrade behavior', (fx, dir) => {
        writeMigrations(dir, [...fixtureSql, 'CREATE TABLE staged(id INTEGER); INSERT INTO missing_table VALUES(1);']);
        const db = new DatabaseSync(fx.dbPath);
        try {
          if (existing === 'table') db.exec("CREATE TABLE retained(value TEXT); INSERT INTO retained VALUES('existing data');");
          if (existing === 'view') db.exec("CREATE VIEW retained AS SELECT 'existing data' AS value;");
          if (existing === 'registry') db.exec('CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL, description TEXT NOT NULL, checksum TEXT NOT NULL)');
          if (existing === 'sqlite-statistics') db.exec('ANALYZE');
          assert.ok(schema(db).length);
          assert.equal(db.prepare('PRAGMA user_version').get().user_version, 0);
          const watched = observe(db);
          assert.throws(() => runMigrations({ ...fx, db: watched.db }), error => error.code === 'MIGRATION_FAILED' && error.version === 4);
          assert.equal(db.prepare('PRAGMA user_version').get().user_version, 3);
          assert.equal(watched.counts.commits, 3);
          assert.equal(db.prepare('SELECT COUNT(*) AS n FROM schema_migrations').get().n, 3);
          assert.equal(db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name='staged'").get().n, 0);
          if (existing === 'table' || existing === 'view') assert.equal(db.prepare('SELECT value FROM retained').get().value, 'existing data');
        } finally { db.close(); }
      });
    }

    check('ordinary upgrades retain successful earlier migrations when a later step fails', (fx, dir) => {
      writeMigrations(dir, fixtureSql.slice(0, 1));
      fs.unlinkSync(path.join(fx.migrationDir, '002-fixture.sql'));
      fs.unlinkSync(path.join(fx.migrationDir, '003-fixture.sql'));
      const db = new DatabaseSync(fx.dbPath);
      try {
        runMigrations({ ...fx, db });
        writeMigrations(dir, [...fixtureSql, 'INSERT INTO missing_table VALUES(1);']);
        const watched = observe(db);
        assert.throws(() => runMigrations({ ...fx, db: watched.db }), error => error.code === 'MIGRATION_FAILED' && error.version === 4);
        assert.equal(db.prepare('PRAGMA user_version').get().user_version, 3);
        assert.equal(watched.counts.commits, 2);
        assert.equal(db.prepare('SELECT value FROM facts').get().value, 'synthetic');
        assert.equal(db.prepare('SELECT COUNT(*) AS n FROM schema_migrations').get().n, 3);
      } finally { db.close(); }
    });

    console.log(JSON.stringify({ suite: 'migration-runner-fresh-atomic', passed: passed.length, failed: failures.length, productionDatabaseOpened: false, shippedMigrationCount: shipped.migrations.length, comparedShippedTables }));
    if (failures.length) {
      for (const failure of failures) console.error(failure.name + '\n' + failure.message);
      process.exitCode = 1;
    }
  } finally { fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); }
}

main();
