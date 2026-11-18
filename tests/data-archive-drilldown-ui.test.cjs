'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const ui = fs.readFileSync(path.join(root, 'resources/app/modules/v4-data-center.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'resources/app/modules/v4.css'), 'utf8');

// The data-center archive bridge must expose a lightweight drilldown.  This
// contract intentionally checks markup and behavior hooks, rather than a
// browser snapshot, so it can run in the plain Node test harness.
assert.match(ui, /data-v4-archive-search/, 'archive bridge must expose a customer search input');
assert.match(ui, /data-v4-archive-customers/, 'archive bridge must expose a customer list container');
assert.match(ui, /data-v4-archive-customer-id/, 'archive rows must carry a stable customer id');
assert.match(ui, /data-customer=/, 'archive rows must use the existing customer-center navigation contract');
assert.match(ui, /state\(true\)/, 'archive drilldown must read the current state without loading full chat history');
assert.match(ui, /data-v4-archive-customer-count/, 'archive drilldown must report the filtered customer count');
assert.match(ui, /完整聊天|不加载完整聊天|轻量/, 'archive drilldown must make its lightweight loading scope explicit');

for (const selector of [
  '.v4-archive-drilldown',
  '.v4-archive-drilldown-head',
  '.v4-archive-search',
  '.v4-archive-customer-list',
  '.v4-archive-customer-row'
]) {
  assert.match(css, new RegExp(selector.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&')), `v4 CSS must style ${selector}`);
}

console.log('data-archive-drilldown-ui: lightweight customer archive drilldown contract');
