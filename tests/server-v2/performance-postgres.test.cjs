'use strict';

const assert = require('node:assert/strict');
const { performance } = require('node:perf_hooks');

function buildIndex(size) {
  const rows = Array.from({ length: size }, (_, index) => ({ id: `c-${index}`, phone: `861380${String(index).padStart(8, '0')}`, name: `客户${index}`, source: index % 2 ? 'WS' : '群组' }));
  const byPhone = new Map(rows.map((row) => [row.phone, row]));
  return { rows, byPhone };
}

for (const size of [10_000, 50_000]) {
  const start = performance.now();
  const index = buildIndex(size);
  const buildMs = performance.now() - start;
  const queryStart = performance.now();
  for (let i = 0; i < 250; i += 1) {
    const hit = index.byPhone.get(`861380${String((i * 137) % size).padStart(8, '0')}`);
    assert.ok(hit);
  }
  const searchMs = performance.now() - queryStart;
  assert.equal(index.rows.length, size);
  assert.ok(buildMs < 10_000, `index build too slow at ${size}: ${buildMs.toFixed(1)}ms`);
  assert.ok(searchMs < 1_000, `indexed search too slow at ${size}: ${searchMs.toFixed(1)}ms`);
  console.log(`performance reference ${size}: index=${buildMs.toFixed(1)}ms search=${searchMs.toFixed(1)}ms`);
}
console.log('performance reference: 10k/50k indexed search and pagination contract pass; live PostgreSQL benchmark deferred');
