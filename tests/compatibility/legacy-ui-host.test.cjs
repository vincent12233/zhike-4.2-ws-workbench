'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repo = path.resolve(__dirname, '..', '..');
const index = fs.readFileSync(path.join(repo, 'resources/app/index.html'), 'utf8');
const host = fs.readFileSync(path.join(repo, 'resources/app/modules/desktop-host.js'), 'utf8');
const css = fs.readFileSync(path.join(repo, 'resources/app/modules/scroll-system.css'), 'utf8');
assert.doesNotMatch(index, /modules\/desktop-host\.css/);
assert.equal(fs.existsSync(path.join(repo, 'resources/app/modules/desktop-host.css')), false);
assert.match(index, /modules\/desktop-host\.js/);
assert.match(css, /data-desktop-host/);
assert.match(host, /__desktopHostReady/);
assert.match(host, /__desktopHostRefresh/);

console.log('legacy UI host contract: desktop lifecycle remains wired and host bounds use the consolidated scroll layer');
