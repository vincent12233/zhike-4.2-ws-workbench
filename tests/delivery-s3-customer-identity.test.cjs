'use strict';

// Execute the real enhancer (including its scheduled refresh and observers).
// The DOM boundary and deferred read transport contain synthetic records only.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../resources/app/modules/v4-data-center.js'), 'utf8');
const cases = [];
const test = (name, run) => cases.push({ name, run });
const payload = (customers = [{ id: 'A', name: '同名客户' }, { id: 'B', name: '同名客户' }], registrations = [
  { id: 'R-A', customerId: 'A', status: '已报名', date: '2026-11-16', note: 'A_ONLY_EVIDENCE' },
  { id: 'R-B', customerId: 'B', status: '已报名', date: '2026-11-17', note: 'B_ONLY_EVIDENCE' },
]) => ({ customers, registrations });

function fixture(initialId = 'B', initialName = '同名客户') {
  const observers = [], timers = new Map(), requests = [], listeners = new Map();
  let nextTimer = 0, drawer = null, headingReads = 0;
  const empty = { querySelector() { return null; }, querySelectorAll() { return []; } };
  const view = { ...empty }, modal = { ...empty };
  function makeDrawer(id, name) {
    const value = {
      dataset: id === null ? {} : { customerId: String(id) },
      sections: [], name, open: true,
      classList: { contains(name) { return name === 'open' && value.open; } },
      querySelector(selector) {
        if (selector === 'h2') { headingReads++; return { textContent: value.name }; }
        if (selector === '#v4RegistrationHistory') return value.sections.find(section => section.id === 'v4RegistrationHistory') || null;
        if (selector === '.drawer-actions') return value.actions;
        return null;
      },
    };
    value.actions = { before(section) { value.sections.push(section); } };
    return value;
  }
  if (initialId !== false) drawer = makeDrawer(initialId, initialName);
  const document = {
    querySelector(selector) {
      if (selector === '#viewContainer') return view;
      if (selector === '#modal') return modal;
      if (selector === '#customerDrawer') return drawer;
      if (selector === '#customerDrawer.open') return drawer?.open ? drawer : null;
      return null;
    },
    createElement() { return { id: '', className: '', innerHTML: '', dataset: {} }; },
    addEventListener(type, listener) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(listener);
    },
    dispatchEvent(event) { for (const listener of listeners.get(event.type) || []) listener(event); },
  };
  const sandbox = {
    document, window: {}, console, Date, Blob, URL,
    queueMicrotask,
    setTimeout(callback) { const id = ++nextTimer; timers.set(id, callback); return id; },
    clearTimeout(id) { timers.delete(id); },
    MutationObserver: class {
      constructor(callback) { this.callback = callback; }
      observe(target) { observers.push({ target, callback: this.callback }); }
    },
    fetch(route, options = {}) {
      assert.equal(route, '/api/state', 'identity enhancement reads only the existing state authority');
      assert.equal(options.method || 'GET', 'GET', 'history must not write business data');
      assert.equal(options.cache, 'no-store');
      return new Promise((resolve, reject) => requests.push({
        resolve(value, ok = true) { resolve({ ok, async json() { return value; } }); }, reject,
      }));
    },
  };
  vm.runInNewContext(source, sandbox, { filename: 'v4-data-center.js' });
  async function flush() {
    const pending = [...timers.values()]; timers.clear();
    for (const callback of pending) callback();
    for (let index = 0; index < 8; index++) await Promise.resolve();
  }
  function refresh() { for (const observer of observers) if (observer.target === view) observer.callback([]); }
  function open(id, name = '同名客户', replace = false) {
    if (!drawer || replace) drawer = makeDrawer(id, name);
    else {
      drawer.dataset = id === null ? {} : { customerId: String(id) };
      drawer.name = name; drawer.open = true; drawer.sections = [];
      const current = drawer;
      drawer.actions = { before(section) { current.sections.push(section); } };
    }
    return drawer;
  }
  return {
    requests, flush, refresh, open, drawer: () => drawer, headingReads: () => headingReads,
    notifyOpen(customerId = drawer?.dataset.customerId) { document.dispatchEvent({ type: 'zhike:customer-drawer-opened', detail: { customerId } }); },
    retry() {
      const current = drawer;
      const section = current?.sections.find(item => item.id === 'v4RegistrationHistory');
      const target = {
        closest(selector) {
          if (selector === '[data-v4-retry-registration-history]') return target;
          if (selector === '#customerDrawer') return current;
          return null;
        },
      };
      if (section) section.remove = () => { current.sections = current.sections.filter(item => item !== section); };
      document.dispatchEvent({ type: 'click', target });
    },
  };
}

test('same-name customers use the drawer customer ID, never the first name match', async () => {
  const f = fixture('B'); await f.flush();
  assert.equal(f.requests.length, 1); f.requests[0].resolve(payload()); await f.flush();
  assert.equal(f.drawer().sections.length, 1);
  assert.match(f.drawer().sections[0].innerHTML, /B_ONLY_EVIDENCE/);
  assert.doesNotMatch(f.drawer().sections[0].innerHTML, /A_ONLY_EVIDENCE/);
  assert.equal(f.headingReads(), 0, 'display names are not identity evidence');
});

test('renaming the display heading does not change the authoritative customer link', async () => {
  const f = fixture('A', '改过的展示标题'); await f.flush();
  f.requests[0].resolve(payload()); await f.flush();
  assert.equal(f.drawer().sections.length, 1);
  assert.match(f.drawer().sections[0].innerHTML, /A_ONLY_EVIDENCE/);
});

test('unknown or missing drawer IDs never fall back to a matching name', async () => {
  for (const id of ['unknown-id', null, '   ']) {
    const f = fixture(id); await f.flush();
    for (const request of f.requests) request.resolve(payload()); await f.flush();
    assert.equal(f.drawer().sections.length, 0, 'untrusted identity cannot display another customer history');
    assert.equal(f.headingReads(), 0);
  }
});

test('deleted and duplicate master IDs are not silently treated as one active customer', async () => {
  for (const customers of [
    [{ id: 'A', name: '同名客户', deleted: true }],
    [{ id: 'A', name: '同名客户' }, { id: 'A', name: '另一主档' }],
  ]) {
    const f = fixture('A'); await f.flush(); f.requests[0].resolve(payload(customers)); await f.flush();
    assert.equal(f.drawer().sections.length, 0);
  }
});

test('late A response cannot populate reused B drawer before B response', async () => {
  const f = fixture('A', '客户甲'); await f.flush();
  f.open('B', '客户乙'); f.refresh(); await f.flush();
  assert.equal(f.requests.length, 2);
  f.requests[0].resolve(payload([{ id: 'A', name: '客户甲' }, { id: 'B', name: '客户乙' }], [
    { customerId: 'B', note: 'B_OLD_RESPONSE', date: '2026-11-15' },
  ])); await f.flush();
  assert.equal(f.drawer().sections.length, 0, 'the old request owns A, even if its snapshot also contains B');
  f.requests[1].resolve(payload([{ id: 'B', name: '客户乙' }], [
    { customerId: 'B', note: 'B_CURRENT_RESPONSE', date: '2026-11-17' },
  ])); await f.flush();
  assert.equal(f.drawer().sections.length, 1);
  assert.match(f.drawer().sections[0].innerHTML, /B_CURRENT_RESPONSE/);
});

test('closing a drawer before completion prevents late insertion', async () => {
  const f = fixture('A'); await f.flush(); f.drawer().open = false; delete f.drawer().dataset.customerId;
  f.requests[0].resolve(payload()); await f.flush();
  assert.equal(f.drawer().sections.length, 0);
});

test('an older failed read cannot replace the current customer successful history', async () => {
  const f = fixture('A'); await f.flush(); f.open('B'); f.refresh(); await f.flush();
  f.requests[1].resolve(payload()); await f.flush();
  f.requests[0].reject(new Error('synthetic older read failure')); await f.flush();
  assert.equal(f.drawer().sections.length, 1);
  assert.equal(f.drawer().sections[0].dataset.state, 'loaded');
  assert.match(f.drawer().sections[0].innerHTML, /B_ONLY_EVIDENCE/);
  assert.doesNotMatch(f.drawer().sections[0].innerHTML, /读取失败/);
});

test('replacing the drawer DOM prevents insertion into detached old content', async () => {
  const f = fixture('A'); await f.flush(); const old = f.drawer();
  f.open('B', '同名客户', true);
  f.requests[0].resolve(payload()); await f.flush();
  assert.equal(old.sections.length, 0); assert.equal(f.drawer().sections.length, 0);
});

test('same-ID drawer rerender rejects the old actions/content generation', async () => {
  const f = fixture('A'); await f.flush();
  f.open('A'); f.refresh(); await f.flush();
  f.requests[0].resolve(payload()); await f.flush();
  assert.equal(f.drawer().sections.length, 0, 'a same-ID reopen is still a new content generation');
  f.requests[1].resolve(payload()); await f.flush();
  assert.equal(f.drawer().sections.length, 1);
});

test('overlapping refreshes share one read and append at most one current history section', async () => {
  const f = fixture('B'); await f.flush(); f.refresh(); await f.flush();
  assert.equal(f.requests.length, 1, 'an already pending read for the same drawer content is reused');
  f.requests[0].resolve(payload()); await f.flush();
  assert.equal(f.drawer().sections.length, 1);
  assert.match(f.drawer().sections[0].innerHTML, /B_ONLY_EVIDENCE/);
});

test('read failure shows a real retry state, never fake empty history, and explicit retry recovers', async () => {
  for (const failure of ['http', 'network']) {
    const f = fixture('B'); await f.flush();
    if (failure === 'http') f.requests[0].resolve({}, false);
    else f.requests[0].reject(new Error('synthetic unavailable'));
    await f.flush(); assert.equal(f.drawer().sections.length, 1);
    assert.equal(f.drawer().sections[0].dataset.state, 'error');
    assert.match(f.drawer().sections[0].innerHTML, /读取失败/);
    assert.doesNotMatch(f.drawer().sections[0].innerHTML, /暂无报名历史/);
    f.retry(); await f.flush(); f.requests[1].resolve(payload()); await f.flush();
    assert.equal(f.drawer().sections.length, 1);
    assert.match(f.drawer().sections[0].innerHTML, /B_ONLY_EVIDENCE/);
  }
});

test('valid empty history remains distinct and all rendered evidence is escaped', async () => {
  const f = fixture('B'); await f.flush();
  f.requests[0].resolve(payload(undefined, [])); await f.flush();
  assert.match(f.drawer().sections[0].innerHTML, /暂无报名历史/);
  f.open('B'); f.refresh(); await f.flush();
  f.requests[1].resolve(payload(undefined, [{ customerId: 'B', date: '2026-11-17', note: '<img src=x onerror="BAD()">', source: '<script>BAD()</script>', owner: '"&' }])); await f.flush();
  const html = f.drawer().sections[0].innerHTML;
  assert.match(html, /&lt;img/); assert.match(html, /&lt;script&gt;/); assert.doesNotMatch(html, /<img|<script/);
  f.refresh(); await f.flush(); assert.equal(f.requests.length, 2, 'already rendered section must not request again');
});

test('explicit first drawer-open event reaches the enhancer after lazy drawer creation', async () => {
  const f = fixture(false); await f.flush(); assert.equal(f.requests.length, 0);
  f.open('B'); f.notifyOpen(); await f.flush();
  assert.equal(f.requests.length, 1, 'no global body observer is needed to discover the new drawer');
  f.requests[0].resolve(payload()); await f.flush(); assert.match(f.drawer().sections[0].innerHTML, /B_ONLY_EVIDENCE/);
});

test('drawer lifecycle event data cannot override the live authoritative customer ID', async () => {
  const f = fixture(false); await f.flush(); f.open('B');
  f.notifyOpen('A'); await f.flush();
  assert.equal(f.requests.length, 1); f.requests[0].resolve(payload()); await f.flush();
  assert.match(f.drawer().sections[0].innerHTML, /B_ONLY_EVIDENCE/);
  assert.doesNotMatch(f.drawer().sections[0].innerHTML, /A_ONLY_EVIDENCE/);
});

(async () => {
  let failed = 0;
  for (const { name, run } of cases) {
    try { await run(); console.log('PASS ' + name); }
    catch (error) { failed++; console.error('FAIL ' + name + ': ' + error.message); }
  }
  console.log(`Delivery S3 customer identity runtime: ${cases.length - failed}/${cases.length}; real enhancer, synthetic read transport, no browser/database/writes`);
  if (failed) process.exitCode = 1;
})();
