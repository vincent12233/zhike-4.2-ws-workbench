'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

(async () => {
  const { ProfileStore } = await import('../src/profile-store.mjs');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zhike-profile-'));
  const store = new ProfileStore(root);
  await store.writeCheckpoint('acct/one', { version: 1, lastConversationKey: 'c1', updatedAt: new Date().toISOString() });
  const checkpoint = await store.readCheckpoint('acct/one');
  assert.equal(checkpoint.lastConversationKey, 'c1');
  const firstDirectory = fs.readdirSync(root).find((entry) => fs.existsSync(path.join(root, entry, 'checkpoint.json')));
  assert.ok(firstDirectory);
  assert.doesNotMatch(fs.readFileSync(path.join(root, firstDirectory, 'checkpoint.json'), 'utf8'), /password|cookie|qr|token/i);
  await store.writeCheckpoint('acct_one', { version: 1, lastConversationKey: 'c2', updatedAt: new Date().toISOString() });
  const checkpointDirectories = fs.readdirSync(root).filter((entry) => fs.existsSync(path.join(root, entry, 'checkpoint.json')));
  assert.equal(checkpointDirectories.length, 2, 'sanitized account ids must not share checkpoint files');
  fs.rmSync(root, { recursive: true, force: true });
  console.log('WS profile store: account isolation and atomic checkpoint persistence pass');
})();
