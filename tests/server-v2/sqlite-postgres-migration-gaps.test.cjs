'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { spawnSync } = require('node:child_process');

const repo = path.resolve(__dirname, '..', '..');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zhike-migration-gaps-'));
const source = path.join(root, 'legacy.sqlite');
const createManifest = (name) => path.join(root, `${name}.json`);
const db = new DatabaseSync(source);
db.exec('CREATE TABLE app_state (id INTEGER PRIMARY KEY, json TEXT NOT NULL, updated_at TEXT NOT NULL, revision INTEGER NOT NULL);');
db.prepare('INSERT INTO app_state VALUES (1, ?, ?, 3)').run(JSON.stringify({
  customers: [{ id: 'c1', phone: '+91 98765 43210', name: '客户一' }],
  businessRecords: [
    { customerId: 'c1', product: 'AAPL', direction: '买入', businessDate: '2026/11/01', nextFollowupDate: '2026/11/09' },
    { customerId: 'c1', amount: '500', currency: 'USD', recordType: '入金', date: '2026/11/02', nextFollowupDate: '2026/11/10' },
    { customerId: 'c1', recordType: '报名', registeredDate: '2026/11/03', status: '已报名' },
  ],
}), '2026-11-08T00:00:00Z');
db.close();

function run(name) {
  const manifest = createManifest(name);
  const result = spawnSync(process.execPath, [path.join(repo, 'tools/sqlite-to-postgres/migrate.cjs'), '--source', source, '--manifest', manifest, '--mode', 'dry-run'], { cwd: repo, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(fs.readFileSync(manifest, 'utf8'));
}

const first = run('first');
assert.equal(first.counts.businessRecords, 3, 'mixed businessRecords rows are classified independent of source order');
const second = run('second');
assert.equal(second.sourceHash, first.sourceHash, 'id-less legacy rows produce a deterministic reconciliation hash');
fs.rmSync(root, { recursive: true, force: true });

console.log('SQLite→PostgreSQL migration gaps: mixed legacy rows and deterministic ids pass');
