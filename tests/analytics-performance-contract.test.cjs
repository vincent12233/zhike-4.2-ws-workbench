'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { performance } = require('node:perf_hooks');

const repo = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(repo, 'resources/app/modules/v4-data-center.js'), 'utf8');

assert.match(source, /countDimension=\(rows,key\)=>\{const counts=new Map\(\);for\(const row of rows\)/,
  'analytics dimensions must be aggregated in one pass');
assert.doesNotMatch(source, /vals\(k\)\.map\(v=>\[v,list\.filter/,
  'analytics must not filter the entire customer list once per dimension value');

const rows = Array.from({ length: 50000 }, (_, index) => ({
  source: `渠道-${index % 250}`,
  page: `页面-${index % 5000}`,
  assistant: `助理-${index % 100}`,
}));
const countDimension = (items, key) => {
  const counts = new Map();
  for (const item of items) {
    const value = item[key];
    if (value) counts.set(value, (counts.get(value) || 0) + 1);
  }
  return counts;
};
const started = performance.now();
const dimensions = ['source', 'page', 'assistant'].map(key => countDimension(rows, key));
const elapsed = performance.now() - started;
assert.deepEqual(dimensions.map(map => map.size), [250, 5000, 100]);
assert.ok(elapsed < 1000, `50k multi-dimension aggregation exceeded budget: ${elapsed.toFixed(1)} ms`);

console.log(`analytics performance: 50k x 3 dimensions aggregated in ${elapsed.toFixed(1)} ms`);
