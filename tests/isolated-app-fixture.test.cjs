'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { copyIsolatedAppFixture } = require('./helpers/isolated-app-fixture.cjs');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zhike-source-fixture-'));
try {
  const source = path.join(root, 'source'); const destination = path.join(root, 'copy');
  for (const folder of ['data', 'profiles', 'migrations', 'modules', 'assets', 'logs']) fs.mkdirSync(path.join(source, folder), { recursive: true });
  for (const file of ['server.mjs', 'migrations/025-test.sql', 'modules/ui.js', 'assets/image.svg', 'data/workspace.sqlite', 'profiles/Cookies', 'logs/output.log', 'node.exe', 'ai-credentials.json']) fs.writeFileSync(path.join(source, file), 'synthetic test marker');
  copyIsolatedAppFixture(source, destination);
  for (const file of ['server.mjs', 'migrations/025-test.sql', 'modules/ui.js', 'assets/image.svg']) assert.ok(fs.existsSync(path.join(destination, file)), file);
  for (const file of ['data', 'profiles', 'logs', 'node.exe', 'ai-credentials.json']) assert.equal(fs.existsSync(path.join(destination, file)), false, file);
} finally { fs.rmSync(root, { recursive: true, force: true }); }
console.log('isolated app fixture: source/assets copied; user data, credentials and redundant runtime excluded');
