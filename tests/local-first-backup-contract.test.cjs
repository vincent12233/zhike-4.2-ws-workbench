'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createBackupManifest, sha256File } = require('../resources/app/modules/local-first-migration.js');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zhike-local-first-'));
try {
  const a = path.join(dir, 'state.json');
  const b = path.join(dir, 'workspace.sqlite');
  fs.writeFileSync(a, '{"customers":[]}');
  fs.writeFileSync(b, Buffer.from('sqlite-placeholder'));
  const manifest = createBackupManifest([a, b]);
  assert.equal(manifest.files.length, 2);
  assert.equal(manifest.files[0].sha256, sha256File(manifest.files[0].path));
  assert.ok(manifest.createdAt);
  assert.ok(manifest.files.every(file => file.bytes > 0 && /^[a-f0-9]{64}$/.test(file.sha256)));
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}

console.log('local-first backup contract: manifest contains byte counts, timestamps and SHA-256 hashes');
