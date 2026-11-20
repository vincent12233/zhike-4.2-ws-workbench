'use strict';
// WS contact exclusion page contract.
//
// Verifies the workspace navigation exposes a dedicated exclusion page, that
// the page renders from the real business-pages module (search / add / batch
// import / bulk enable-disable-delete / hit ledger), and that it stays a
// directory of exclusion rules — never a second CRM.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const repo = path.resolve(__dirname, '..');
const app = path.join(repo, 'resources', 'app');
const read = relative => fs.readFileSync(path.join(app, relative), 'utf8');
const workbench = read('modules/ws-workbench.js');
const pages = read('modules/ws-business-pages.js');
const css = read('modules/ws-workbench.css');

// --- navigation and routing --------------------------------------------------

assert.match(workbench, /id:\s*'exclusions',\s*label:\s*'通讯录排除'/,
  'the workspace navigation must register a dedicated exclusion page');
assert.match(workbench, /activeView === 'exclusions'\) body = businessPages \? businessPages\.renderExclusions\(/,
  'the exclusions route must render the business-pages exclusion renderer');
assert.match(workbench, /view === 'exclusions'/,
  'the page data loader must handle the exclusions view');
assert.doesNotMatch(workbench, /['"]exclusions['"][^]{0,200}?deleteCustomer|exclusion[\s\S]{0,120}DELETE FROM customers/i,
  'exclusion flows must never touch a customer master directly');
// Icon must exist in the shared sprite.
assert.match(read('index.html'), /<symbol id="i-shield"/, 'the nav icon must exist in the sprite');

// --- renderer over the real module -------------------------------------------

// The module is UMD: in Node it exports via module.exports, so require it
// directly rather than re-evaluating it in a sandbox.
const business = require(path.join(app, 'modules/ws-business-pages.js'));
const { renderExclusions, exclusionState, loadExclusions, updateExclusions, invalidateExclusions } = business;
const fixturePage = {
  exclusion: {
    loaded: true, loading: false, query: '', error: '',
    rules: [
      { id: 'wsx-1', kind: 'phone', value: '9876543210', phone: '9876543210', displayName: '同事 A', note: '内部员工', source: 'manual', enabled: true, updatedAt: '2026-11-20T00:00:00Z' },
      { id: 'wsx-2', kind: 'jid', value: '123@lid', phone: '', displayName: '群管理员', note: '', source: 'import', enabled: false, updatedAt: '2026-11-20T01:00:00Z' },
    ],
    hits: [{ id: 'h1', ruleName: '同事 A', accountId: 'default', groupJid: 'g@g.us', memberPhone: '9876543210', action: 'auto-create-blocked', createdAt: '2026-11-20T02:00:00Z' }],
    summary: { total: 2, enabled: 1, hits: 1 },
  },
};
// renderExclusions takes the workspace page object (it derives state via
// exclusionState), so pass the page, not the state.
const html = renderExclusions(fixturePage);

assert.ok(html.includes('此通讯录用于排除专用 WS 群成员自动建档'), 'the page must state its exclusion purpose');
assert.ok(html.includes('不是 CRM 客户通讯录'), 'the page must disclaim the second-CRM reading');
assert.match(html, /排除中 1 \/ 共 2/, 'the header must show enabled/total counts');
assert.match(html, /<strong>1<\/strong>/, 'summary tiles must include enabled count');
assert.ok(html.includes('同事 A') && html.includes('9876543210'), 'rules must render with names and numbers');
assert.ok(html.includes('已停用'), 'disabled rules must be distinguishable');
assert.ok(html.includes('data-ws-action="exclusion-toggle"'), 'rows must offer enable/disable');
assert.ok(html.includes('data-ws-action="exclusion-delete"'), 'rows must offer removal');
assert.ok(html.includes('data-ws-action="exclusion-bulk-enable"') && html.includes('data-ws-action="exclusion-bulk-disable"'), 'bulk enable/disable must exist');
assert.ok(html.includes('data-ws-exclusion-form="import"'), 'batch import form must exist');
assert.ok(html.includes('data-ws-exclusion-form="add"'), 'single-add form must exist');
assert.ok(html.includes('data-ws-exclusion-select-all'), 'select-all must exist');
assert.ok(html.includes('auto-create-blocked'), 'the hit ledger must render blocked evidence');
assert.ok(html.includes('g@g.us'), 'hit rows must show the group');
assert.match(css, /ws-business-bulk/, 'bulk toolbar styles must exist');
assert.match(css, /ws-exclusion-add/, 'add/import panel styles must exist');

// Empty and loading states must not fake data.
const emptyPage = { exclusion: { loaded: true, loading: false, query: '', error: '', rules: [], hits: [], summary: { total: 0, enabled: 0, hits: 0 } } };const emptyHtml = renderExclusions(emptyPage);
assert.ok(emptyHtml.includes('当前没有排除规则'), 'empty list must be explicit');
assert.ok(emptyHtml.includes('尚无命中记录'), 'empty hit ledger must be explicit');

const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const pageFixture = () => ({ exclusion: { loaded: true, loading: false, requestSerial: 0, rules: [{ id: 'r1', value: '123@lid', enabled: true }, { id: 'r2', value: '456@lid', enabled: true }], hits: [], summary: { total: 2, enabled: 2, hits: 0 }, query: '' }, exclusionSelected: ['r1', 'r2'] });
const readReply = (page, route) => route.includes('/hits?') ? { hits: [] } : { rules: page.exclusion.rules, summary: page.exclusion.summary };

function workbenchFixture(fetchReply) {
  const listeners = {}, requests = [], toasts = [];
  const container = { addEventListener(name, callback) { (listeners[name] ||= []).push(callback); } };
  const host = { state: { view: 'home', settings: {}, customers: [], activities: [] }, toast: value => toasts.push(value) };
  const sandbox = {
    console, URL, URLSearchParams, AbortController, DOMException, performance,
    setTimeout: () => 1, clearTimeout() {}, setInterval: () => 1, clearInterval() {}, requestAnimationFrame: () => 0, cancelAnimationFrame() {},
    localStorage: { getItem: () => null, setItem() {} },
    FormData: class { constructor(form) { this.data = form.data; } entries() { return Object.entries(this.data || {}); } },
    MutationObserver: class { observe() {} disconnect() {} },
    document: { querySelector: selector => selector === '#viewContainer' ? container : null, querySelectorAll: () => [], getElementById: () => null, addEventListener() {}, removeEventListener() {}, body: { classList: { remove() {} } }, activeElement: null },
    window: { location: { origin: 'http://127.0.0.1:1' }, addEventListener() {}, innerWidth: 1440, innerHeight: 900, ZhikeWsCore: require(path.join(app, 'modules/ws-workbench-core.js')), ZhikeWsBusinessPages: business, __zhikeRegistryHost: host, zhikeDesktop: { ws: async () => ({}) } },
    async fetch(route, init) {
      requests.push({ route, init });
      const body = fetchReply ? await fetchReply(route, init) : route.includes('/hits?') ? { hits: [] } : { rules: [], summary: { total: 0, enabled: 0, hits: 0 } };
      return { ok: true, status: 200, json: async () => body };
    },
  };
  const boot = /  boot\(\);\s*\}\)\(\);\s*$/;
  assert.match(workbench, boot);
  vm.runInNewContext(workbench.replace(boot, 'globalThis.exclusionsTest = { state, boot, handleAction, submitExclusionForm, invalidateExclusionPage, resetAccountPresentation, deactivate, wsWorkspacePageState };\n})();'), sandbox);
  const api = sandbox.exclusionsTest;
  api.state.active = true;
  api.state.activeAccountId = 'a';
  api.state.wsWorkspaceView = 'exclusions';
  Object.assign(api.wsWorkspacePageState('exclusions'), pageFixture());
  api.boot();
  return { ...api, requests, toasts, listeners };
}

(async () => {
  let passed = 0;
  async function check(name, run) { await run(); passed++; console.log('PASS ' + name); }

  await check('newer query wins even when the older query finishes later', async () => {
    const page = pageFixture(), old = deferred();
    const first = loadExclusions(page, { request: () => old.promise, query: 'old' });
    await loadExclusions(page, { request: route => route.includes('/hits?') ? { hits: [] } : { rules: [{ id: 'new' }] }, query: 'new' });
    old.resolve({ rules: [{ id: 'old' }], hits: [{ id: 'stale' }] });
    assert.equal(await first, false);
    assert.equal(page.exclusion.rules[0].id, 'new');
    assert.equal(page.exclusion.query, 'new');
    assert.deepEqual(page.exclusionSelected, [], 'hidden or removed rules cannot remain bulk targets');
  });

  for (const reject of [false, true]) await check('invalidated read cannot publish ' + (reject ? 'errors' : 'data'), async () => {
    const page = pageFixture(), pending = deferred();
    const loading = loadExclusions(page, { request: () => pending.promise });
    invalidateExclusions(page);
    const before = JSON.stringify(page);
    if (reject) pending.reject(new Error('old account failed')); else pending.resolve({ rules: [{ id: 'stale' }], hits: [] });
    assert.equal(await loading, false);
    assert.equal(JSON.stringify(page), before);
  });

  await check('partial import keeps rejected identities and escaped rejection reasons visible', async () => {
    const page = pageFixture(), calls = [];
    page.exclusion.importText = '123@lid\n<bad-name>';
    await updateExclusions(page, { action: 'import', request: (route, init = {}) => {
      calls.push({ route, init });
      return init.method === 'POST' ? { rules: [{ id: 'r1' }], rejected: [{ identity: '<bad-name>', reason: '<script>invalid</script>' }] } : readReply(page, route);
    } });
    assert.equal(JSON.parse(calls[0].init.body).items.length, 2);
    assert.equal(page.exclusion.importText, '<bad-name>');
    const output = renderExclusions(page);
    assert.match(output, /1 条成功，1 条被拒/);
    assert.ok(output.includes('&lt;script&gt;invalid&lt;/script&gt;'));
    assert.ok(!output.includes('<script>invalid</script>'));
  });

  await check('oversized imports are rejected without a write or silent truncation', async () => {
    const page = pageFixture(), writes = [];
    page.exclusion.importText = Array.from({ length: 2001 }, (_, i) => `${i}@lid`).join('\n');
    assert.equal(await updateExclusions(page, { action: 'import', request: (route, init = {}) => { if (init.method) writes.push(init); return readReply(page, route); } }), false);
    assert.equal(writes.length, 0);
    assert.match(page.exclusion.error, /2001.*2000/);
    assert.equal(page.exclusion.importText.split('\n').length, 2001);
  });

  await check('bulk failure reports progress and retains only unprocessed selection', async () => {
    const page = pageFixture(); page.exclusionSelected.push('hidden');
    const calls = [];
    await updateExclusions(page, { action: 'bulk-disable', request: (route, init = {}) => {
      if (init.method) { calls.push(route); assert.equal(JSON.parse(init.body).enabled, false); if (route.endsWith('/r2')) throw new Error('synthetic write rejected'); return { rule: {} }; }
      return readReply(page, route);
    } });
    assert.equal(calls.length, 2);
    assert.deepEqual(page.exclusionSelected, ['r2']);
    assert.match(page.exclusion.error, /已完成 1 条，剩余 1 条未完成.*synthetic write rejected/);
  });

  await check('leaving during a bulk request stops subsequent writes and publishes nothing', async () => {
    const page = pageFixture(), pending = deferred(), calls = [];
    let current = true;
    const updating = updateExclusions(page, { action: 'bulk-delete', isCurrent: () => current, request: route => { calls.push(route); return pending.promise; } });
    current = false;
    invalidateExclusions(page);
    const before = JSON.stringify(page);
    pending.resolve({ ok: true });
    assert.equal(await updating, false);
    assert.equal(calls.length, 1);
    assert.equal(JSON.stringify(page), before);
  });

  await check('duplicate mutations are ignored while the first one is pending', async () => {
    const page = pageFixture(), pending = deferred(); let writes = 0;
    const request = (route, init = {}) => { if (init.method) { writes++; return pending.promise; } return readReply(page, route); };
    const first = updateExclusions(page, { action: 'toggle', id: 'r1', body: { enabled: false }, request });
    assert.equal(await updateExclusions(page, { action: 'toggle', id: 'r1', body: { enabled: true }, request }), false);
    pending.resolve({}); await first;
    assert.equal(writes, 1);
  });

  await check('recent hit filtering is searchable and states its 500-record boundary', async () => {
    const page = pageFixture();
    page.exclusion.hits = [{ ruleName: 'first', accountId: 'account-a', groupJid: 'group-one' }, { ruleName: 'second', accountId: 'account-b', groupJid: 'group-two' }];
    page.exclusion.hitQuery = 'ACCOUNT-B';
    const output = renderExclusions(page);
    assert.ok(output.includes('group-two') && !output.includes('group-one'));
    assert.match(output, /最近最多 500 条.*当前匹配 1 条.*不代表全部历史/);
    let requested = '';
    await loadExclusions(page, { request: route => { if (route.includes('/hits?')) requested = route; return readReply(page, route); } });
    assert.match(requested, /limit=500/);
  });

  await check('real delegated change listener handles row and select-all before propagation stops', () => {
    const f = workbenchFixture();
    const page = f.wsWorkspacePageState('exclusions'); page.exclusionSelected = [];
    function change(selector, checked, id) {
      let stopped = false;
      const target = { checked, dataset: { wsExclusionSelect: id }, closest: match => match === '.ws-workbench-page' || match === selector ? target : null };
      for (const listener of f.listeners.change) { listener({ target, stopImmediatePropagation() { stopped = true; } }); if (stopped) break; }
    }
    change('[data-ws-exclusion-select]', true, 'r1');
    assert.deepEqual(Array.from(page.exclusionSelected), ['r1']);
    change('[data-ws-exclusion-select-all]', true);
    assert.deepEqual(Array.from(page.exclusionSelected), ['r1', 'r2']);
    assert.match(renderExclusions(page), /data-ws-exclusion-select-all checked/);
    change('[data-ws-exclusion-select-all]', false);
    assert.equal(page.exclusionSelected.length, 0);
  });

  await check('real action captures original account and stops bulk work after account switch', async () => {
    const pending = deferred();
    const f = workbenchFixture(() => pending.promise);
    const operation = f.handleAction('exclusion-bulk-disable', {});
    const original = f.wsWorkspacePageState('exclusions');
    f.resetAccountPresentation('b'); f.state.accountLoadSequence++;
    assert.equal(original.exclusion.mutating, false, 'returning to the old account cannot strand its busy state');
    const other = f.wsWorkspacePageState('exclusions');
    const before = JSON.stringify(other);
    pending.resolve({ rule: {} }); await operation;
    assert.equal(f.requests.length, 1);
    assert.match(f.requests[0].route, /accountId=a/);
    assert.equal(JSON.parse(f.requests[0].init.body).accountId, 'a');
    assert.equal(JSON.stringify(other), before);
    assert.equal(f.toasts.length, 0);
  });

  await check('form response after leaving and returning cannot overwrite the new page lifetime', async () => {
    const pending = deferred();
    const f = workbenchFixture(() => pending.promise);
    const operation = f.submitExclusionForm({ dataset: { wsExclusionForm: 'import' }, data: { items: '123@lid' } });
    f.invalidateExclusionPage(); f.state.wsWorkspaceView = 'chat'; f.state.wsWorkspaceView = 'exclusions';
    const page = f.wsWorkspacePageState('exclusions'); const before = JSON.stringify(page);
    pending.resolve({ rules: [{ id: 'stale' }], rejected: [] }); await operation;
    assert.equal(f.requests.length, 1);
    assert.equal(JSON.stringify(page), before);
    assert.equal(f.toasts.length, 0);
  });

  await check('deactivating the workbench discards pending form failures and releases controls', async () => {
    const pending = deferred();
    const f = workbenchFixture(() => pending.promise);
    const operation = f.submitExclusionForm({ dataset: { wsExclusionForm: 'add' }, data: { identity: '123@lid' } });
    f.deactivate();
    const page = f.wsWorkspacePageState('exclusions'), before = JSON.stringify(page);
    pending.reject(new Error('stale submission failed')); await operation;
    assert.equal(f.state.active, false);
    assert.equal(page.exclusion.mutating, false);
    assert.equal(JSON.stringify(page), before);
    assert.equal(f.requests.length, 1);
    assert.equal(f.toasts.length, 0);
  });

  console.log(`contact exclusion UI: contracts and ${passed} isolated runtime cases passed; no real API, account or database`);
})().catch(error => { console.error(error); process.exitCode = 1; });
