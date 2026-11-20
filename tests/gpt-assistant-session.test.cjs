'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../resources/app/modules/gpt-assistant.js'), 'utf8');

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { resolve, promise };
}

function workbench() {
  const state = {
    customers: [{ id: 'A', name: 'Alice', qualification: 'B级' }, { id: 'B', name: 'Bob', qualification: 'C级' }],
    deposits: [{ customerId: 'A', currency: 'CNY', amount: 1200 }],
    tickets: [{ customerId: 'A' }],
    registrations: [{ customerId: 'A', status: '已报名' }],
    followups: [{ customerId: 'A' }],
    version: '1',
  };
  const calls = { requests: [], cancelled: [], writes: [], snapshots: [], confirms: [] };
  const listeners = new Map(), stored = new Map();
  const button = { dataset: { gptAction: 'send' } };
  const controls = {
    '#gptAssistantNav': {}, '#viewContainer': {}, '#gptMessages': {}, '#gptAttachments': {},
    '#gptScope': { value: 'all' }, '#gptInput': { value: '' },
    '#gptAssistantMode': { value: 'manage' }, '[data-gpt-metric="actions"]': {},
  };
  const document = {
    body: {}, documentElement: { dataset: { view: 'gpt' } },
    querySelector(selector) {
      return selector === '[data-gpt-action="' + button.dataset.gptAction + '"]' ? button : controls[selector] || null;
    },
    querySelectorAll: () => [],
    addEventListener(type, listener) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(listener);
    },
  };
  const host = {
    load: async () => structuredClone(state),
    respond: async () => ({ text: 'answer' }),
    refreshState: async () => {},
    state: { view: 'gpt' },
  };
  const window = {
    __zhikeRegistryHost: host, dispatchEvent() {},
    zhikeAI: {
      request(payload) {
        calls.requests.push(structuredClone(payload));
        return host.respond(payload);
      },
      cancel: async ({ requestId }) => { calls.cancelled.push(requestId); },
    },
  };
  async function fetch(url, options) {
    if (url === '/api/state' && !options.method) return { ok: true, json: () => host.load() };
    if (url === '/api/snapshot' && options.method === 'POST') {
      calls.snapshots.push(JSON.parse(options.body));
      return { ok: true };
    }
    if (url === '/api/state' && options.method === 'PUT') {
      assert.equal(options.headers['X-State-Version'], state.version);
      const value = JSON.parse(options.body);
      calls.writes.push(value);
      Object.assign(state, value, { version: String(Number(state.version) + 1) });
      return { ok: true };
    }
    throw new Error('Unexpected request to ' + url);
  }
  vm.runInNewContext(source, {
    window, document, fetch, console, MutationObserver: class { observe() {} }, CustomEvent: class {},
    setTimeout: () => 1, clearTimeout() {},
    confirm: prompt => { calls.confirms.push(prompt); return true; },
    localStorage: { getItem: key => stored.get(key), setItem: (key, value) => stored.set(key, value) },
  });
  function click(action, planId) {
    const node = {
      dataset: { gptAction: action, gptPlanId: planId },
      closest(selector) { return selector === '[data-gpt-action]' ? this : null; },
    };
    return Promise.all(listeners.get('click').map(listener => listener({ target: node })));
  }
  function send(input) {
    controls['#gptInput'].value = input;
    return click('send');
  }
  const planIds = () => [...controls['#gptMessages'].innerHTML.matchAll(/data-gpt-plan-id="([^"]+)"/g)].map(match => match[1]);
  const transcript = () => JSON.parse(stored.get('zhike-gpt-last-session')).messages;
  return { host, calls, controls, state, click, send, planIds, transcript };
}

test('each confirmation applies only the displayed plan and stale buttons cannot replay it', async () => {
  const app = workbench();
  app.host.respond = async ({ input }) => ({
    text: 'Plan ' + input, actions: [{ type: 'update_customer', field: 'name', customer_id: input, value: 'Edited ' + input }],
  });
  await app.send('A');
  await app.send('B');
  const [first, second] = app.planIds();
  assert.ok(first && second && first !== second);
  assert.equal(app.controls['[data-gpt-metric="actions"]'].textContent, '2');
  const refreshing = deferred(), complete = deferred();
  app.host.refreshState = () => { refreshing.resolve(); return complete.promise; };
  const writing = app.click('apply-plan', first);
  await refreshing.promise;
  await app.click('apply-plan', first);
  complete.resolve();
  await writing;
  assert.deepEqual(app.state.customers.map(c => c.name), ['Edited A', 'Bob']);
  assert.deepEqual(app.planIds(), [second]);
  assert.equal(app.state.batchOperations[0].value, 'Plan A');
  assert.equal(app.controls['[data-gpt-metric="actions"]'].textContent, '1');
  await app.click('apply-plan', first);
  assert.equal(app.calls.confirms.length, 1);
  await app.click('apply-plan', second);
  assert.deepEqual(app.state.customers.map(c => c.name), ['Edited A', 'Edited B']);
  assert.equal(app.calls.writes.length, 2);
  assert.equal(app.calls.snapshots.length, 2);
  assert.deepEqual(app.planIds(), []);
});

test('stop while loading local state prevents dispatch and permits a new request', async () => {
  const app = workbench(), loaded = deferred(), started = deferred();
  const load = app.host.load;
  app.host.load = () => { started.resolve(); return loaded.promise; };
  const stopped = app.send('old question');
  await started.promise;
  await app.click('cancel');
  app.host.load = load;
  await app.send('new question');
  loaded.resolve(structuredClone(app.state));
  await stopped;
  assert.equal(app.calls.cancelled.length, 1);
  assert.deepEqual(app.calls.requests.map(request => request.input), ['new question']);
  assert.notEqual(app.calls.requests[0].requestId, app.calls.cancelled[0]);
});

test('new chat discards an old in-flight reply and its proposed writes', async () => {
  const app = workbench(), oldReply = deferred(), dispatched = deferred();
  app.host.respond = () => { dispatched.resolve(); return oldReply.promise; };
  const old = app.send('old conversation');
  await dispatched.promise;
  await app.click('clear-chat');
  assert.equal(app.controls['#gptInput'].value, '');
  app.host.respond = async () => ({ text: 'new answer' });
  await app.send('new question');
  oldReply.resolve({ text: 'old answer', actions: [{ type: 'archive_customer', customer_id: 'A' }] });
  await old;
  assert.deepEqual(app.calls.cancelled, [app.calls.requests[0].requestId]);
  assert.deepEqual(app.calls.requests[1].history, []);
  assert.deepEqual(app.transcript().map(message => message.text), ['new question', 'new answer']);
  assert.deepEqual(app.planIds(), []);
});

test('empty and populated filtered scopes and overview produce their own customer and financial totals', async () => {
  const app = workbench();
  app.controls['#gptScope'].value = 'priority';
  await app.send('empty scope');
  const empty = app.calls.requests.at(-1).context;
  const zero = { registrations: 0, tickets: 0, deposits: 0, followups: 0 };
  assert.deepEqual(empty.counts, zero);
  assert.deepEqual(empty.analytics.records, zero);
  assert.equal(empty.totalCustomers, 0);
  assert.equal(empty.analytics.scopeCustomerCount, 0);
  assert.deepEqual(empty.analytics.depositTotalsByCurrency, {});
  app.state.customers[1].hot = true;
  await app.send('Bob only');
  const filtered = app.calls.requests.at(-1).context;
  assert.deepEqual(filtered.customers.map(c => c.id), ['B']);
  assert.equal(filtered.analytics.scopeCustomerCount, 1);
  assert.deepEqual(filtered.analytics.depositTotalsByCurrency, {});
  app.controls['#gptScope'].value = 'overview';
  await app.send('aggregate overview');
  const overview = app.calls.requests.at(-1).context;
  assert.deepEqual(overview.customers, []);
  assert.equal(overview.totalCustomers, 2);
  assert.equal(overview.analytics.grades.B, 1);
  assert.equal(overview.analytics.grades.C, 1);
  assert.deepEqual(overview.analytics.depositTotalsByCurrency, { CNY: 1200 });
});
