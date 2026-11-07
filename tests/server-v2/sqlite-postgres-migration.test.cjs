'use strict';

const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { mkdtempSync, readFileSync, rmSync } = require('node:fs');
const { spawnSync } = require('node:child_process');
const os = require('node:os');
const path = require('node:path');

const repo = path.resolve(__dirname, '..', '..');
for (const relative of [
  'tools/sqlite-to-postgres/SqliteToPostgres.csproj',
  'tools/sqlite-to-postgres/Program.cs',
  'tools/sqlite-to-postgres/LegacyReader.cs',
  'tools/sqlite-to-postgres/ReconciliationReport.cs',
]) assert.equal(require('node:fs').existsSync(path.join(repo, relative)), true, `missing ${relative}`);
const temp = mkdtempSync(path.join(os.tmpdir(), 'zhike-migration-'));
const source = path.join(temp, 'workspace.sqlite');
const manifest = path.join(temp, 'manifest.json');
const db = new DatabaseSync(source);
db.exec(`
  CREATE TABLE app_state (id INTEGER PRIMARY KEY, json TEXT NOT NULL, updated_at TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 0);
  CREATE TABLE customers (id TEXT PRIMARY KEY, phone_normalized TEXT NOT NULL DEFAULT '', name TEXT NOT NULL DEFAULT '', data_json TEXT NOT NULL);
  CREATE TABLE ws_accounts (id TEXT PRIMARY KEY, display_name TEXT NOT NULL, status TEXT NOT NULL);
`);
db.prepare('INSERT INTO app_state(id,json,updated_at,revision) VALUES(1,?,?,1)').run(JSON.stringify({
  customers: [
    { id: 'C1', phone: '+8613800000001', name: '客户一' },
    { id: 'C2', phone: '+8613800000002', name: '客户二' },
  ],
  tickets: [
    { id: 'T1', customerId: 'C1', product: 'AAPL', direction: '买入', date: '2026-11-01' },
    { id: 'T2', customerId: 'C1', product: 'TSLA', direction: '买入', date: '2026-11-01' },
  ],
  deposits: [],
  followups: [],
}), '2026-11-08T00:00:00Z');
db.prepare('INSERT INTO customers(id,phone_normalized,name,data_json) VALUES(?,?,?,?)').run('C1', '8613800000001', '客户一', JSON.stringify({ id: 'C1' }));
db.prepare('INSERT INTO customers(id,phone_normalized,name,data_json) VALUES(?,?,?,?)').run('C2', '8613800000002', '客户二', JSON.stringify({ id: 'C2' }));
db.prepare('INSERT INTO ws_accounts(id,display_name,status) VALUES(?,?,?)').run('default', '默认账号', '未连接');
db.close();

const result = spawnSync(process.execPath, [
  path.join(repo, 'tools', 'sqlite-to-postgres', 'migrate.cjs'),
  '--source', source,
  '--manifest', manifest,
  '--mode', 'dry-run',
], { cwd: repo, encoding: 'utf8' });

assert.equal(result.status, 0, result.stderr || result.stdout);
const report = JSON.parse(readFileSync(manifest, 'utf8'));
assert.equal(report.mode, 'dry-run');
assert.equal(report.counts.customers, 2);
assert.equal(report.counts.businessRecords, 2);
assert.equal(report.counts.wsAccounts, 1);
assert.equal(typeof report.sourceHash, 'string');
assert.equal(report.rollbackAvailable, true);
rmSync(temp, { recursive: true, force: true });

console.log('SQLite→PostgreSQL migration dry-run: counts, source hash and rollback metadata pass');
