'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const modules = path.join(__dirname, '../resources/app/modules');
const source = fs.readFileSync(path.join(modules, 'productivity.js'), 'utf8');
const css = fs.readFileSync(path.join(modules, 'business-6.css'), 'utf8');
const minRule = css.match(/html:is\(\[data-view="customers"\],\[data-view="segments"\]\) \.data-table :is\(th,td\)\[data-column="customer"\]\{min-width:(\d+px)\}/);
assert.equal(minRule?.[1], '152px', 'substantive column width applies to both header and cell');
const start = source.indexOf('  function columnSizes()');
const end = source.indexOf('  function businessEditButtons()', start);
assert.ok(start >= 0 && end > start);

function fixture(route, saved) {
  const key = `zhike-columns-${route}`;
  const writes = [];
  const reads = [];
  const layouts = [];
  const makeHeader = (column, hidden = false) => ({
    dataset: { column }, hidden, style: {}, handle: null,
    append(handle) { this.handle = handle; },
    getBoundingClientRect() { return { width: Number.parseFloat(this.style.width) || 180 }; },
  });
  const headers = [
    makeHeader('select'), makeHeader('customer'), makeHeader('rawPhone', true), makeHeader('phone'),
  ];
  const table = { dataset: {}, querySelectorAll: () => headers };
  const sandbox = vm.createContext({
    host: () => ({ state: { view: route } }),
    view: { querySelectorAll: () => [table] },
    document: { createElement: () => ({ setPointerCapture(id) { this.captured = id; } }) },
    getComputedStyle(header) { layouts.push(header.dataset.column); return { minWidth: minRule[1] }; },
    readLocal(requestedKey, fallback) {
      reads.push(requestedKey);
      return requestedKey === key ? { ...saved } : fallback;
    },
    writeLocal(writeKey, value) { writes.push([writeKey, JSON.parse(JSON.stringify(value))]); },
  });
  vm.runInContext(source.slice(start, end), sandbox);
  sandbox.columnSizes();
  sandbox.columnSizes();
  assert.deepEqual(reads, [key], 'already-enhanced tables keep their handles and captured state');
  assert.equal(writes.length, 0, 'applying the floor does not modify stored preferences');
  function drag(index, delta) {
    const handle = headers[index].handle;
    handle.onpointerdown({ clientX: 20, pointerId: 5, preventDefault() {}, stopPropagation() {} });
    assert.equal(handle.captured, 5);
    handle.onpointermove({ clientX: 20 + delta });
    handle.onpointerup();
    assert.equal(handle.onpointermove, null);
  }
  return { headers, writes, layouts, drag };
}

const customer = fixture('customers', { 0: 72, 1: 90, 2: 190, 3: 216 });
assert.deepEqual(customer.layouts, ['customer'], 'CSS minimum is only consulted for this column');
assert.deepEqual(customer.headers.map(header => header.style.width), ['72px', '152px', '190px', '216px']);
customer.drag(1, -100);
assert.deepEqual(customer.writes.at(-1), ['zhike-columns-customers', { 0: 72, 1: 152, 2: 190, 3: 216 }]);
customer.drag(3, -500);
assert.deepEqual(customer.writes.at(-1), ['zhike-columns-customers', { 0: 72, 1: 152, 2: 190, 3: 48 }]);
customer.drag(1, 1000);
assert.deepEqual(customer.writes.at(-1), ['zhike-columns-customers', { 0: 72, 1: 800, 2: 190, 3: 48 }]);

const segments = fixture('segments', { 1: 280 });
assert.deepEqual(segments.headers[1].style, { width: '280px', minWidth: '280px' });
segments.drag(1, -400);
assert.deepEqual(segments.writes.at(-1), ['zhike-columns-segments', { 1: 152 }]);

const other = fixture('tickets', { 1: 90 });
assert.deepEqual(other.layouts, []);
assert.equal(other.headers[1].style.width, '90px');
other.drag(1, -50);
assert.deepEqual(other.writes.at(-1), ['zhike-columns-tickets', { 1: 48 }]);
console.log('Customer column CSS floor governs legacy restore and drag without changing column indexes, wider widths, or other minimums.');
