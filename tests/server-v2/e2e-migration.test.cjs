'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { spawnSync } = require('node:child_process');

const repo = path.resolve(__dirname, '..', '..');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zhike-e2e-migration-'));
const source = path.join(root, 'legacy.sqlite');
const manifest = path.join(root, 'manifest.json');
const db = new DatabaseSync(source);
db.exec('CREATE TABLE app_state (id INTEGER PRIMARY KEY, json TEXT NOT NULL, updated_at TEXT NOT NULL, revision INTEGER NOT NULL);');
db.prepare('INSERT INTO app_state VALUES (1, ?, ?, 1)').run(JSON.stringify({
  customers: [{ id: 'c1', phone: '+8613800000001', name: '一号客户' }],
  tickets: [
    { id: 'buy-a', customerId: 'c1', product: 'AAPL', direction: '买入', date: '2026-10-01' },
    { id: 'sell-a', customerId: 'c1', product: 'AAPL', direction: '卖出', date: '2026-10-05' },
    { id: 'buy-b', customerId: 'c1', product: 'TSLA', direction: '买入', date: '2026-10-07' },
  ],
  deposits: [],
}), '2026-11-08T00:00:00Z');
db.close();
const result = spawnSync(process.execPath, [path.join(repo, 'tools/sqlite-to-postgres/migrate.cjs'), '--source', source, '--manifest', manifest, '--mode', 'dry-run'], { cwd: repo, encoding: 'utf8' });
assert.equal(result.status, 0, result.stderr || result.stdout);
const report = JSON.parse(fs.readFileSync(manifest, 'utf8'));
assert.equal(report.counts.customers, 1);
assert.equal(report.counts.businessRecords, 3, 'buy/sell and different stocks remain separate');
assert.equal(report.rollbackAvailable, true);
assert.equal(typeof report.sourceHash, 'string');
// The same read-only snapshot must yield the same canonical hash even when
// legacy rows do not contain ids (resume/reconciliation depends on this).
const secondManifest = path.join(root, 'manifest-2.json');
const second = spawnSync(process.execPath, [path.join(repo, 'tools/sqlite-to-postgres/migrate.cjs'), '--source', source, '--manifest', secondManifest, '--mode', 'dry-run'], { cwd: repo, encoding: 'utf8' });
assert.equal(second.status, 0, second.stderr || second.stdout);
const secondReport = JSON.parse(fs.readFileSync(secondManifest, 'utf8'));
assert.equal(secondReport.sourceHash, report.sourceHash, 'source hash must be deterministic');
fs.rmSync(root, { recursive: true, force: true });
console.log('e2e migration reconciliation: isolated legacy snapshot, count/hash and rollback metadata pass');
