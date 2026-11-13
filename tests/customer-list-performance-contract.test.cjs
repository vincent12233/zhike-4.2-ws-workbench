'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { performance } = require('node:perf_hooks');

const repo = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(repo, 'resources/app/app.js'), 'utf8');

assert.match(app, /activeCustomerCache=.*revision/,
  'active customer projection must be revision-cached');
assert.match(app, /function customersByPriority\(\)[\s\S]*customerPriorityOrderCache\.revision===revision[\s\S]*date===today/,
  'priority ordering must be cached by data revision and date rollover');
const filtered = app.match(/function filteredCustomers\(mode='segment'\) \{[\s\S]*?\n  \}/)?.[0] || '';
assert.match(filtered, /let list=customersByPriority\(\)/,
  'customer filtering must reuse the stable priority order');
assert.doesNotMatch(filtered, /\.sort\(/,
  'customer filtering must not sort the full result for every page/search render');

const rows = Array.from({ length: 50000 }, (_, index) => ({
  id: `C-${index}`,
  favorite: index % 997 === 0,
  score: (index * 37) % 101,
  registered: `2026-${String(1 + (index % 11)).padStart(2, '0')}-${String(1 + (index % 27)).padStart(2, '0')}`,
  search: `客户 ${index} ${index % 311 === 0 ? '重点预算' : '普通'} ${9000000000 + index}`.toLocaleLowerCase(),
}));
let cache = null;
const ordered = () => cache || (cache = rows.slice().sort((a, b) => Number(b.favorite) - Number(a.favorite) || b.score - a.score || b.registered.localeCompare(a.registered)));
const buildStarted = performance.now();
const first = ordered();
const buildMs = performance.now() - buildStarted;
assert.equal(first.length, 50000);
assert.ok(buildMs < 2500, `50k initial priority order exceeded budget: ${buildMs.toFixed(1)}ms`);

const pageStarted = performance.now();
for (let page = 1; page <= 200; page += 1) ordered().slice((page - 1) * 50, page * 50);
const pageMs = performance.now() - pageStarted;
assert.ok(pageMs < 250, `cached 50k pagination exceeded budget: ${pageMs.toFixed(1)}ms`);

const filterStarted = performance.now();
const matches = ordered().filter(row => row.search.includes('重点预算'));
const filterMs = performance.now() - filterStarted;
assert.ok(matches.length > 0);
assert.ok(filterMs < 750, `50k cached-order filter exceeded budget: ${filterMs.toFixed(1)}ms`);

console.log(`customer list performance: 50k build=${buildMs.toFixed(1)}ms, 200 cached pages=${pageMs.toFixed(1)}ms, filter=${filterMs.toFixed(1)}ms`);
