const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', 'resources', 'app');
const uiPath = path.join(root, 'modules', 'customer-governance-ui.js');
const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const server = fs.readFileSync(path.join(root, 'server.mjs'), 'utf8');
assert.ok(fs.existsSync(uiPath), 'customer governance UI module should exist');
const ui = fs.readFileSync(uiPath, 'utf8');
assert.match(index, /modules\/customer-governance-ui\.js/);
assert.match(server, /modules\/customer-governance-ui\.js/);
assert.match(ui, /data-gov-action="soft-delete"/);
assert.match(ui, /data-gov-action="restore"/);
assert.match(ui, /purge-request/);
assert.match(ui, /purge-confirm/);
assert.match(ui, /api\/data-governance\/audit/);
console.log('customer governance ui: loaded and exposes audit, soft-delete, restore and purge confirmation controls');
