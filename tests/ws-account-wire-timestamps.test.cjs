'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { DatabaseSync } = require('node:sqlite');
const { runMigrations } = require('../resources/app/migration-runner.cjs');

const app = path.join(__dirname, '../resources/app');
const source = fs.readFileSync(path.join(app, 'server.mjs'), 'utf8');
function between(start, end) {
  const offset = source.indexOf(start);
  const through = source.indexOf(end, offset);
  assert.ok(offset >= 0 && through > offset, 'Find the actual server block: ' + start);
  return source.slice(offset, through);
}

const accountList = new vm.Script([
  source.match(/^const WS_STATUSES = .*;$/m)[0],
  between('function wsAccountRow(', 'function wsGroupMonitorProfilePayload('),
  '(() => {',
  between("    if (url.pathname === '/api/ws/accounts') {", "      if (req.method === 'POST')"),
  '}})()',
].join('\n'));

const db = new DatabaseSync(':memory:');
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'zhike-ws-account-timestamps-'));
const migrationDir = path.join(app, 'migrations');
try {
  runMigrations({ db, migrationDir, manifestPath: path.join(migrationDir, 'manifest.json'),
    lockPath: path.join(work, 'migration.lock'), backup: false });

  const iso = '2026-11-18T03:55:55.375Z';
  db.prepare('INSERT INTO ws_accounts(id, display_name, status, updated_at, created_at) VALUES (?, ?, ?, ?, ?)')
    .run('native-b', '隔离账号 B', '未连接', iso, iso);
  db.prepare('INSERT INTO ws_account_settings(account_id, auto_collection_enabled, created_at, updated_at) VALUES (?, ?, ?, ?)')
    .run('native-b', 0, iso, iso);
  const rows = () => db.prepare('SELECT * FROM ws_accounts ORDER BY id').all();
  const list = () => accountList.runInNewContext({
    db,
    url: { pathname: '/api/ws/accounts' },
    req: { method: 'GET' },
    res: {},
    json(_res, status, body) {
      assert.equal(status, 200);
      return JSON.parse(JSON.stringify(body)).accounts;
    },
  });

  const [sqliteDefault, storedSecond] = rows();
  assert.match(sqliteDefault.updated_at, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/, 'real migration 008 seed uses a SQLite UTC time');
  assert.equal(storedSecond.updated_at, iso);
  const [defaultAccount, secondAccount] = list();
  assert.deepEqual([defaultAccount.id, secondAccount.id], ['default', 'native-b']);
  assert.equal(defaultAccount.updatedAt, sqliteDefault.updated_at.replace(' ', 'T') + 'Z');
  assert.equal(defaultAccount.createdAt, sqliteDefault.created_at.replace(' ', 'T') + 'Z');
  assert.equal(defaultAccount.lastSeen, null);
  assert.equal(defaultAccount.status, '未连接');
  assert.equal(secondAccount.updatedAt, iso);
  assert.equal(secondAccount.createdAt, iso);
  assert.equal(secondAccount.lastSeen, null);
  assert.equal(secondAccount.displayName, '隔离账号 B');
  assert.equal(secondAccount.settings.autoCollectionEnabled, false);
  assert.deepEqual(rows(), [sqliteDefault, storedSecond], 'serving the account list does not migrate stored metadata');

  const legacySeen = '2026-11-17 19:42:16';
  db.prepare('UPDATE ws_accounts SET last_seen_at=? WHERE id=?').run(legacySeen, 'default');
  assert.equal(list()[0].lastSeen, '2026-11-17T19:42:16Z');
  assert.equal(rows()[0].last_seen_at, legacySeen);
} finally {
  db.close();
  fs.rmdirSync(work);
}

console.log('WS account wire timestamps: actual GET handles migration-008 default and ISO account together without altering storage');
