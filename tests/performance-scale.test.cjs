'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { performance } = require('node:perf_hooks');

const source = fs.readFileSync(path.join(__dirname, '..', 'resources', 'app', 'modules', 'performance-enhancements.js'), 'utf8');
const sandbox = { window: {}, document: undefined, console, requestAnimationFrame: callback => callback() };
vm.runInNewContext(source, sandbox, { filename: 'performance-enhancements.js' });
const api = sandbox.window.ZhikePerformance;

function customers(count) {
  return Array.from({ length: count }, (_, index) => ({
    id: `C${index}`,
    name: `客户${index}`,
    phone: String(9000000000 + index).slice(-10),
    rawPhone: `+91 ${String(9000000000 + index).slice(-10)}`,
    group: `G${index % 500}`,
    channel: index % 2 ? '单导' : '群粉',
    assistant: `助理${index % 20}`,
    note: index % 997 === 0 ? '重点预算客户' : '',
    deleted: false,
  }));
}

for (const size of [10000, 50000]) {
  const rows = customers(size);
  const started = performance.now();
  const index = api.buildSearchIndex(rows);
  const indexedMs = performance.now() - started;
  const searchStarted = performance.now();
  const result = api.searchIndex(index, '重点预算', rows);
  const searchMs = performance.now() - searchStarted;
  assert.ok(result.size > 0, `${size} 条搜索应返回匹配客户`);
  assert.ok(indexedMs < 8000, `${size} 条索引耗时过长：${indexedMs.toFixed(1)}ms`);
  assert.ok(searchMs < 1500, `${size} 条搜索耗时过长：${searchMs.toFixed(1)}ms`);
  const page = api.pageWindow(rows, 2, 50);
  assert.equal(page.rows.length, 50);
  console.log(`performance ${size}: index=${indexedMs.toFixed(1)}ms search=${searchMs.toFixed(1)}ms`);
}

console.log('performance-scale: 10k/50k synthetic search and pagination pass');
