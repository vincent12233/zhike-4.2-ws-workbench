'use strict';

// Runs the shipped business-enhancements module against a synthetic host and
// drives the real merge / undo click handlers. It checks that undoing a
// duplicate-customer merge restores only the merged customers and moved
// records, keeps unrelated settings and records changed after the merge,
// refuses on conflicts, keeps the undo point on failures, never nests
// backups and only ever undoes the most recent merge.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const repo = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(repo, 'resources/app/modules/business-enhancements.js'), 'utf8');
const clone = value => JSON.parse(JSON.stringify(value));
// Objects created inside the VM have that realm's prototypes; compare as plain data.
const plain = value => value === undefined ? undefined : clone(value);
const same = (actual, expected, message) => assert.deepEqual(plain(actual), plain(expected), message);
const tick = () => new Promise(resolve => setImmediate(resolve));

function customer(id, phone, extra = {}) {
  return { id, name: `客户${id}`, phone, rawPhone: phone, tags: [], note: '', deleted: false, ...extra };
}

function createHarness(initial = {}) {
  const state = {
    view: 'customers',
    customers: [], tickets: [], deposits: [], followups: [], registrations: [], phoneRegistry: [],
    settings: { theme: 'light', optionLists: { sources: ['单导'] }, lastCustomerMerge: null },
    activities: [], batchOperations: [],
    ...clone(initial),
  };
  const selection = { group: '0', survivor: '' };
  const toasts = [];
  let failFlushes = 0;
  let clickHandler = null;
  const host = {
    state,
    toast(message, tone) { toasts.push({ message, tone }); },
    openModal() {}, closeModal() {}, persist() {}, render() {},
    activity(text) { state.activities.unshift({ id: `A${state.activities.length + 1}`, text }); },
    async snapshotBeforeWrite() { return true; },
    async flushStateWrites() { if (failFlushes > 0) { failFlushes -= 1; throw new Error('synthetic save failure'); } },
  };
  const document = {
    querySelector(selector) {
      if (selector === '#viewContainer') return { querySelector() { return null; } };
      if (selector === '#mergeDuplicateGroup') return { value: selection.group };
      if (selector === '#mergeSurvivor') return { value: selection.survivor };
      return null;
    },
    addEventListener(name, handler) { if (name === 'click') clickHandler = handler; },
  };
  const window = { __zhikeRegistryHost: host };
  vm.runInNewContext(source, { window, document, confirm: () => true, MutationObserver: class { observe() {} }, queueMicrotask, console });
  assert.equal(typeof clickHandler, 'function', 'module must register its click handler');
  const click = (attribute, value) => clickHandler({ target: { closest(selector) {
    if (selector !== `[${attribute}]`) return null;
    return { dataset: attribute === 'data-be-action' ? { beAction: value } : { businessEnhance: value } };
  } } });
  return {
    state, toasts,
    async merge(survivorId) {
      const groups = window.ZhikeBusinessEnhancements.duplicateGroups();
      const index = groups.findIndex(([, rows]) => rows.some(row => String(row.id) === String(survivorId)));
      assert.ok(index >= 0, `survivor ${survivorId} must be in a duplicate group`);
      selection.group = String(index); selection.survivor = survivorId;
      click('data-be-action', 'merge-apply'); await tick();
    },
    async undo() { click('data-business-enhance', 'undo-merge'); await tick(); },
    failNextFlush() { failFlushes = 1; },
    lastToast() { return toasts[toasts.length - 1] || {}; },
    find(list, id) { return state[list].find(row => String(row.id) === String(id)); },
  };
}

const cases = [];
const test = (name, fn) => cases.push({ name, fn });

function baseline() {
  return {
    customers: [
      customer('A', '9876500001', { tags: ['A标签'], note: 'A备注' }),
      customer('B', '9876500001', { tags: ['B标签'], note: 'B备注', hot: true }),
      customer('C', '9876500099'),
    ],
    tickets: [{ id: 'TB', customerId: 'B', date: '2026-11-01' }, { id: 'TC', customerId: 'C', date: '2026-11-02' }],
    deposits: [{ customerId: 'B', amount: 500, date: '2026-11-03' }],
  };
}

test('1-6: undo restores A/B and records but keeps unrelated settings and later work', async () => {
  const h = createHarness(baseline());
  const before = clone({ A: h.find('customers', 'A'), B: h.find('customers', 'B') });
  await h.merge('A');
  assert.equal(h.find('customers', 'B').deleted, true, 'merge marks B as duplicate');
  assert.equal(h.find('tickets', 'TB').customerId, 'A', 'merge moves the ticket to A');
  assert.equal(h.state.deposits[0].customerId, 'A', 'merge moves the id-less deposit to A');

  h.state.settings.theme = 'dark';
  h.state.settings.optionLists.sources.push('群粉');
  h.state.settings.newAfterMerge = { enabled: true };
  h.find('customers', 'C').note = '合并后修改';
  h.state.tickets.push({ id: 'TNEW', customerId: 'C', date: '2026-11-04' });

  await h.undo();
  assert.equal(h.lastToast().message, '已撤销客户合并');
  same(h.find('customers', 'A'), before.A, 'A is restored exactly');
  same(h.find('customers', 'B'), before.B, 'B is restored exactly');
  assert.equal(h.find('tickets', 'TB').customerId, 'B', 'ticket ownership is restored');
  assert.equal(h.state.deposits[0].customerId, 'B', 'id-less record ownership is restored');
  assert.equal(h.state.settings.theme, 'dark', 'unrelated setting change is kept');
  same(h.state.settings.optionLists.sources, ['单导', '群粉'], 'unrelated option change is kept');
  same(h.state.settings.newAfterMerge, { enabled: true }, 'setting added after the merge is kept');
  assert.equal(h.find('customers', 'C').note, '合并后修改', 'unrelated customer edit is kept');
  assert.ok(h.find('tickets', 'TNEW'), 'record created after the merge is kept');
  assert.equal(h.state.settings.lastCustomerMerge, null, 'undo clears the undo point');
  assert.equal(h.state.batchOperations[0]?.status, '已撤销', 'the merge operation is kept in history as undone');
});

test('7: a failed merge save keeps the previous undo point and restores data', async () => {
  const h = createHarness(baseline());
  await h.merge('A');
  const undoPoint = clone(h.state.settings.lastCustomerMerge);
  h.state.customers.push(customer('D', '9876500002'), customer('E', '9876500002'));
  h.state.tickets.push({ id: 'TE', customerId: 'E' });
  h.failNextFlush();
  await h.merge('D');
  assert.match(h.lastToast().message, /合并失败/);
  assert.equal(h.find('customers', 'E').deleted, false, 'failed merge restores E');
  assert.equal(h.find('tickets', 'TE').customerId, 'E', 'failed merge restores the ticket');
  same(h.state.settings.lastCustomerMerge, undoPoint, 'failed merge keeps the previous undo point');
  assert.ok(!h.state.batchOperations.some(op => op.value === '客户D'), 'failed merge leaves no operation entry');
  await h.undo();
  assert.equal(h.find('customers', 'B').deleted, false, 'the retained undo point still works');
});

test('7b: a failed undo save keeps the undo point and the merged state', async () => {
  const h = createHarness(baseline());
  await h.merge('A');
  const merged = clone(h.state.customers);
  const undoPoint = clone(h.state.settings.lastCustomerMerge);
  h.failNextFlush();
  await h.undo();
  assert.match(h.lastToast().message, /撤销失败/);
  same(h.state.customers, merged, 'failed undo keeps the merged customers');
  assert.equal(h.find('tickets', 'TB').customerId, 'A', 'failed undo keeps record ownership');
  same(h.state.settings.lastCustomerMerge, undoPoint, 'failed undo keeps the undo point');
});

test('8: consecutive merges never nest backups', async () => {
  const h = createHarness();
  const sizes = [];
  for (let round = 0; round < 6; round += 1) {
    const phone = `91234${String(round).padStart(5, '0')}`;
    h.state.customers.push(customer(`S${round}`, phone), customer(`D${round}`, phone));
    h.state.tickets.push({ id: `T${round}`, customerId: `D${round}` });
    await h.merge(`S${round}`);
    const point = h.state.settings.lastCustomerMerge;
    assert.equal(point.survivorId, `S${round}`);
    assert.ok(!('backup' in point), 'the undo point holds no full workspace backup');
    assert.ok(!stableIncludes(point, 'lastCustomerMerge'), 'the undo point never embeds another undo point');
    sizes.push(JSON.stringify(point).length);
  }
  assert.ok(Math.max(...sizes) - Math.min(...sizes) < 64, `undo point size must not grow with history: ${sizes.join(', ')}`);
});

function stableIncludes(value, key) {
  if (!value || typeof value !== 'object') return false;
  return Object.entries(value).some(([name, item]) => name === key || stableIncludes(item, key));
}

test('9a: a later edit to the survivor is not silently overwritten', async () => {
  const h = createHarness(baseline());
  await h.merge('A');
  h.find('customers', 'A').note = '人工补充';
  const snapshot = clone(h.state);
  await h.undo();
  assert.match(h.lastToast().message, /无法安全撤销/);
  assert.equal(h.lastToast().tone, 'x');
  same(h.state, snapshot, 'nothing changes when undo is refused');
  assert.ok(h.state.settings.lastCustomerMerge, 'the undo point is kept for manual handling');
});

test('9b: a moved record reassigned to another customer is a conflict', async () => {
  const h = createHarness(baseline());
  await h.merge('A');
  h.find('tickets', 'TB').customerId = 'C';
  const snapshot = clone(h.state);
  await h.undo();
  assert.match(h.lastToast().message, /无法安全撤销/);
  same(h.state, snapshot);
});

test('9c: an ID collision is a conflict', async () => {
  const h = createHarness(baseline());
  await h.merge('A');
  h.state.customers.push(customer('B', '9000000000', { name: '新客户B' }));
  const snapshot = clone(h.state);
  await h.undo();
  assert.match(h.lastToast().message, /无法安全撤销/);
  same(h.state, snapshot);
});

test('9d: a deleted moved record and an unknown undo version are conflicts', async () => {
  const h = createHarness(baseline());
  await h.merge('A');
  h.state.tickets = h.state.tickets.filter(t => t.id !== 'TB');
  let snapshot = clone(h.state);
  await h.undo();
  assert.match(h.lastToast().message, /无法安全撤销/);
  same(h.state, snapshot);
  h.state.settings.lastCustomerMerge = { version: 99, survivorId: 'A' };
  snapshot = clone(h.state);
  await h.undo();
  assert.match(h.lastToast().message, /无法安全撤销/);
  same(h.state, snapshot);
});

test('10: undo only affects the most recent merge', async () => {
  const h = createHarness(baseline());
  await h.merge('A');
  h.state.customers.push(customer('D', '9876500002'), customer('E', '9876500002'));
  h.state.tickets.push({ id: 'TE', customerId: 'E' });
  await h.merge('D');
  await h.undo();
  assert.equal(h.find('customers', 'E').deleted, false, 'the latest merge is undone');
  assert.equal(h.find('tickets', 'TE').customerId, 'E');
  assert.equal(h.find('customers', 'B').deleted, true, 'the earlier merge stays applied');
  assert.equal(h.find('tickets', 'TB').customerId, 'A');
  await h.undo();
  assert.equal(h.lastToast().message, '没有可撤销的客户合并', 'there is only one undo step');
  assert.equal(h.find('customers', 'B').deleted, true);
});

test('V9.2 field locks: merge keeps locked survivor fields and undo respects later lock changes', async () => {
  const initial = baseline();
  Object.assign(initial.customers[0], { manualLockedFields: ['note'], aiLockedFields: ['tags'] });
  const h = createHarness(initial);
  const before = clone(h.find('customers', 'A'));
  await h.merge('A');
  const A = h.find('customers', 'A');
  assert.equal(A.note, 'A备注', 'a locked note is not rewritten by the merge');
  same(A.tags, ['A标签'], 'locked tags are not rewritten by the merge');
  assert.equal(A.hot, true, 'unlocked merge fields still merge');
  same(A.manualLockedFields, ['note'], 'the merge keeps the lock list');
  assert.equal(h.find('customers', 'B').note, 'B备注', 'the duplicate keeps its own values');
  await h.undo();
  same(h.find('customers', 'A'), before, 'undo restores the survivor with its locks');

  const h2 = createHarness(baseline());
  await h2.merge('A');
  h2.find('customers', 'A').manualLockedFields = ['phone'];
  const snapshot = clone(h2.state);
  await h2.undo();
  assert.match(h2.lastToast().message, /无法安全撤销/, 'a lock set after the merge is a later edit');
  same(h2.state, snapshot, 'the newer lock is not silently overwritten');
});

test('legacy full-backup undo points are applied with the same scope', async () => {
  const initial = baseline();
  const backup = clone({ ...initial, settings: { theme: 'light' }, phoneRegistry: [], followups: [], registrations: [], activities: [], batchOperations: [] });
  const h = createHarness(initial);
  const createdAt = '2026-11-20T10:00:00.000Z';
  const A = h.find('customers', 'A'), B = h.find('customers', 'B');
  A.legacyPhones = ['9876500001']; A.tags = ['A标签', 'B标签']; A.note = 'A备注\nB备注'; A.hot = true; A.favorite = false; A.investor = false;
  Object.assign(B, { deleted: true, deletedAt: createdAt, duplicateOf: 'A' });
  h.find('tickets', 'TB').customerId = 'A'; h.state.deposits[0].customerId = 'A';
  h.state.batchOperations.unshift({ id: 'MERGE-legacy', type: '合并重复客户', value: '客户A', count: 1, createdAt, status: '已执行' });
  h.state.settings.lastCustomerMerge = { createdAt, survivorId: 'A', duplicateIds: ['B'], backup };
  h.state.settings.theme = 'dark';
  await h.undo();
  assert.equal(h.lastToast().message, '已撤销客户合并');
  same(h.find('customers', 'A'), initial.customers[0]);
  same(h.find('customers', 'B'), initial.customers[1]);
  assert.equal(h.find('tickets', 'TB').customerId, 'B');
  assert.equal(h.state.deposits[0].customerId, 'B');
  assert.equal(h.state.settings.theme, 'dark', 'legacy undo keeps later settings');
  assert.equal(h.state.batchOperations[0].status, '已撤销');
});

(async () => {
  let failed = 0;
  for (const { name, fn } of cases) {
    try { await fn(); console.log(`[PASS] ${name}`); }
    catch (error) { failed += 1; console.error(`[FAIL] ${name}\n${error.stack || error}`); }
  }
  if (failed) { process.exitCode = 1; return; }
  console.log(`customer merge undo scope: ${cases.length} cases passed`);
})();
