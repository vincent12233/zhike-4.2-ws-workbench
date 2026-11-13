'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createBackupManifest, sha256File } = require('../resources/app/modules/backup-integrity.js');

const app = fs.readFileSync(path.resolve(__dirname, '../resources/app/app.js'), 'utf8');
assert.match(app, /backupFormat:'zhike-6-workspace'/);
assert.match(app, /version:6,productVersion:'6\.0\.0'/);
assert.match(app, /integrity=\{algorithm:'SHA-256',payloadSha256:await sha256Text/);
assert.match(app, /backup\?\.backupFormat!==['"]zhike-6-workspace['"]/);
assert.match(app, /备份完整性校验失败/);
assert.doesNotMatch(app, /知客4\.2完整备份|version:5,schemaVersion:5/);

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zhike6-backup-integrity-'));
try {
  const state = path.join(dir, 'state.json');
  const database = path.join(dir, 'workspace.sqlite');
  fs.writeFileSync(state, '{"customers":[]}');
  fs.writeFileSync(database, Buffer.from('sqlite-placeholder'));
  const manifest = createBackupManifest([state, database]);
  assert.equal(manifest.files.length, 2);
  assert.equal(manifest.files[0].sha256, sha256File(manifest.files[0].path));
  assert.ok(Number.isFinite(Date.parse(manifest.createdAt)));
  assert.ok(manifest.files.every(file => file.bytes > 0 && /^[a-f0-9]{64}$/.test(file.sha256)));

  fs.appendFileSync(state, '\nchanged');
  assert.notEqual(manifest.files[0].sha256, sha256File(state), 'a modified backup file must fail its recorded SHA-256');
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}

console.log('backup integrity contract: byte counts, timestamps, SHA-256 verification and tamper detection pass');
