'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repo = path.resolve(__dirname, '..', '..');
const index = fs.readFileSync(path.join(repo, 'resources/app/index.html'), 'utf8');
const host = fs.readFileSync(path.join(repo, 'resources/app/modules/desktop-host.js'), 'utf8');
const css = fs.readFileSync(path.join(repo, 'resources/app/modules/desktop-host.css'), 'utf8');
assert.match(index, /modules\/desktop-host\.css/);
assert.match(index, /modules\/desktop-host\.js/);
assert.match(css, /data-desktop-host/);
assert.match(host, /__desktopHostReady/);
assert.match(host, /__desktopHostRefresh/);

console.log('legacy UI host contract: original shell assets are wired for desktop lifecycle refresh');
