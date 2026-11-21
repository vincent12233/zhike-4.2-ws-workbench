'use strict';

// Runs the shipped business-enhancements module against a synthetic host to
// verify that repeated duplicate-customer merges keep the undo backup bounded
// (each merge must not embed the previous merge's full-state backup), that a
// failed save restores the previous undo point, and that undo still restores
// the pre-merge customers and business records.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const repo = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(repo, 'resources/app/modules/business-enhancements.js'), 'utf8');

function customer(id, phone) {
  return { id, name: `客户${id}`, phone, rawPhone: phone, tags: [], note: '', deleted: false };
}

function createHarness() {
  const state = {
    view: 'customers',
    customers: [],
    tickets: [],
    deposits: [],
    followups: [],
    registrations: [],
    phoneRegistry: [],
    settings: { theme: 'light', lastCustomerMerge: null },
    activities: [],
    batchOperations: [],
  };
  const selection = { group: '0', survivor: '' };
  let failNextFlush = false;
  const toasts = [];
  let clickHandler = null;
  const host = {
    state,
    toast(message, tone) { toasts.push({ message, tone }); },
    openModal() {},
    closeModal() {},
    persist() {},
    render() {},
    activity() {},
    async snapshotBeforeWrite() { return true; },
    async flushStateWrites() {
      if (failNextFlush) { failNextFlush = false; throw new Error('synthetic save failure'); }
    },
  };
  const element = (props = {}) => ({ ...props, closest() { return null; }, querySelector() { return null; }, insertAdjacentHTML() {} });
  const document = {
    querySelector(selector) {
      if (selector === '#viewContainer') return element();
      if (selector === '#mergeDuplicateGroup') return { value: selection.group };
      if (selector === '#mergeSurvivor') return { value: selection.survivor };
      return null;
    },
    addEventListener(name, handler) { if (name === 'click') clickHandler = handler; },
  };
  const window = { __zhikeRegistryHost: host };
  vm.runInNewContext(source, {
    window,
    document,
    confirm: () => true,
    MutationObserver: class { observe() {} },
    queueMicrotask,
    console,
  });
  assert.equal(typeof clickHandler, 'function', 'module must register its click handler');
  const click = (attribute, value) => clickHandler({
    target: {
      closest(selector) {
        if (selector === `[${attribute}]`) return { dataset: attribute === 'data-be-action' ? { beAction: value } : { businessEnhance: value } };
        return null;
      },
    },
  });
  return {
    state,
    toasts,
    async merge(survivorId) { selection.survivor = survivorId; click('data-be-action', 'merge-apply'); await new Promise(resolve => setImmediate(resolve)); },
    async undo() { click('data-business-enhance', 'undo-merge'); await new Promise(resolve => setImmediate(resolve)); },
    failNextFlush() { failNextFlush = true; },
  };
}

function mergeDepth(merge) {
  let depth = 0;
  for (let current = merge; current; current = current.backup?.settings?.lastCustomerMerge) depth += 1;
  return depth;
}

(async () => {
  const h = createHarness();
  const rounds = 6;
  const sizes = [];
  for (let round = 0; round < rounds; round += 1) {
    const phone = `98765${String(round).padStart(5, '0')}`;
    h.state.customers.push(customer(`S${round}`, phone), customer(`D${round}`, phone));
    h.state.tickets.push({ id: `T${round}`, customerId: `D${round}`, date: '2026-11-01' });
    await h.merge(`S${round}`);
    const merge = h.state.settings.lastCustomerMerge;
    assert.ok(merge?.backup, `merge ${round} must record an undo backup`);
    assert.equal(merge.survivorId, `S${round}`);
    assert.equal(h.state.tickets.find(t => t.id === `T${round}`).customerId, `S${round}`, 'records move to the survivor');
    assert.equal(mergeDepth(merge), 1, 'the undo backup must not embed earlier merge backups');
    sizes.push(JSON.stringify(h.state.settings).length);
  }
  // Every round adds two customers and one ticket, so growth must stay linear
  // in the data, not compound with each previous backup.
  const growthFirst = sizes[1] - sizes[0];
  const growthLast = sizes[rounds - 1] - sizes[rounds - 2];
  assert.ok(growthLast < growthFirst * 2, `settings growth per merge must stay bounded: ${sizes.join(', ')}`);

  // A failed save restores the data and keeps the previous undo point.
  const before = h.state.settings.lastCustomerMerge;
  const phone = '9123400000';
  h.state.customers.push(customer('SF', phone), customer('DF', phone));
  h.failNextFlush();
  await h.merge('SF');
  assert.ok(h.toasts.some(t => t.tone === 'x' && /合并失败/.test(t.message)), 'failure must be reported');
  assert.equal(h.state.customers.find(c => c.id === 'DF').deleted, false, 'failed merge restores the duplicate');
  assert.deepEqual(h.state.settings.lastCustomerMerge, before, 'failed merge keeps the previous undo point');

  // Undo still restores the most recent successful merge.
  h.state.customers = h.state.customers.filter(c => c.id !== 'SF' && c.id !== 'DF');
  const lastRound = rounds - 1;
  await h.undo();
  assert.equal(h.state.settings.lastCustomerMerge, null, 'undo clears the undo point');
  assert.equal(h.state.customers.find(c => c.id === `D${lastRound}`).deleted, false, 'undo restores the merged duplicate');
  assert.equal(h.state.tickets.find(t => t.id === `T${lastRound}`).customerId, `D${lastRound}`, 'undo restores record ownership');
  assert.equal(h.state.customers.find(c => c.id === `D${lastRound - 1}`).deleted, true, 'earlier merges stay applied');
  assert.equal(h.state.settings.theme, 'light', 'other settings survive undo');

  console.log(`customer merge backup bounds: ${rounds} merges stay single-level (${sizes.join(' → ')} bytes); failure and undo preserve data`);
})().catch(error => { console.error(error); process.exitCode = 1; });
