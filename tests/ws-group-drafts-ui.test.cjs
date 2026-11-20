'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const repo = path.resolve(__dirname, '..');
const moduleSource = fs.readFileSync(path.join(repo, 'resources/app/modules/ws-group-drafts-ui.js'), 'utf8');
const workbench = fs.readFileSync(path.join(repo, 'resources/app/modules/ws-workbench.js'), 'utf8');
const core = require(path.join(repo, 'resources/app/modules/ws-workbench-core.js'));
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const group = (n, name = 'Group ' + n) => ({ groupJid:n + '@g.us', name });
const listed = (groups = [group(1), group(2)], drafts = [], extras = {}) => ({ accountId:'d', groups, drafts, nextOffset:null, sendAvailable:false, ...extras });
const record = (payload, status = 'DRAFT') => ({ id:payload.id, accountId:payload.accountId, message:payload.message || 'Saved message', status,
  createdAt:'2026-11-20T12:00:00Z', cancelledAt:status === 'CANCELLED' ? '2026-11-20T12:01:00Z' : '', targets:(payload.targets || ['1@g.us']).map(target => { const groupJid = typeof target === 'string' ? target : target.groupJid; return { groupJid, name:'Saved ' + groupJid, status }; }) });
function fixture(handler) {
  let scope = { accountId:'d', sequence:1 }, redraws = 0, serial = 0;
  const requests = [], context = { window:{}, URLSearchParams, console };
  vm.createContext(context); vm.runInContext(moduleSource, context);
  const controller = context.window.ZhikeWsGroupDrafts.create({ getScope:() => scope,
    uuid:() => `00000000-0000-4000-8000-${String(++serial).padStart(12, '0')}`,
    redraw:() => { redraws++; },
    request:async (url, init, requestScope) => {
      const entry = { url, init, scope:requestScope, body:init.body ? JSON.parse(init.body) : null }; requests.push(entry);
      return handler ? handler(entry) : entry.body ? { draft:record(entry.body), sendAvailable:false } : listed();
    } });
  return { ...controller, requests, setScope:value => { scope = value; }, get redraws() { return redraws; } };
}
async function compose(f, message = 'Hello group') { await f.load(); f.select('1@g.us', true); f.input('message', message); }

test('search, pagination and multi-selection preserve exact targets across searches', async () => {
  const f = fixture(({ url }) => { const query = new URL(url, 'http://localhost').searchParams;
    if (query.get('q') === 'next') return listed([group(query.get('offset') === '0' ? 3 : 4)], [], { nextOffset:query.get('offset') === '0' ? 1 : null });
    return listed(); });
  await f.load(); f.select('1@g.us', true); f.input('query', 'next'); await f.run('search');
  assert.match(f.render(), /已选 1 \/ 100/); f.select('3@g.us', true); await f.run('more'); f.select('4@g.us', true);
  f.input('message', 'Review all'); await f.run('preview');
  for (const jid of ['1@g.us','3@g.us','4@g.us']) assert.match(f.render(), new RegExp(jid.replace('.', '\\.')));
  await f.run('save'); const payload = f.requests.at(-1).body;
  assert.deepEqual(payload.targets, ['1@g.us','3@g.us','4@g.us']); assert.equal(payload.action, 'create');
  assert.ok(f.requests.some(row => row.url.includes('q=next') && row.url.includes('offset=1')));
});

test('empty body, 4001 characters, missing targets and over-100 page selection make no POST', async () => {
  const f = fixture(() => listed(Array.from({ length:101 }, (_, index) => group(index + 1))));
  await f.load(); await f.run('save'); assert.match(f.render(), /请输入草稿正文/);
  f.input('message', 'a'.repeat(4001)); await f.run('save'); assert.match(f.render(), /不能超过 4000/);
  f.input('message', 'valid'); await f.run('save'); assert.match(f.render(), /请选择 1 至 100/);
  await f.run('select-page'); assert.match(f.render(), /超过 100/); assert.match(f.render(), /已选 0 \/ 100/);
  for (let n = 1; n <= 100; n++) f.select(n + '@g.us', true);
  f.select('101@g.us', true); assert.match(f.render(), /已选 100 \/ 100/);
  assert.equal(f.requests.filter(row => row.body).length, 0);
});

test('unresolved names and malformed JIDs cannot become selected targets; all user strings are escaped', async () => {
  const saved = record({ id:'saved', accountId:'d', message:'<script>body</script>', targets:['1@g.us'] });
  saved.targets[0].name = '<img src=x onerror=oops>';
  const f = fixture(() => listed([group(1, '<script>name</script>'), { groupJid:'Same title', name:'Alias' }, { groupJid:'x@g.us\" onclick=evil', name:'Wrong' }], [saved]));
  await f.load(); assert.equal(f.select('Same title', true), false);
  const html = f.render(); assert.doesNotMatch(html, /<script>|<img src=x/); assert.match(html, /&lt;script&gt;/); assert.match(html, /&lt;img/);
  assert.match(html, /data-ws-group-draft-select="1@g.us"/); assert.doesNotMatch(html, /data-ws-group-draft-select="Same title/);
});

test('network retry reuses UUID only for the same content; edits allocate a new UUID', async () => {
  let attempts = 0;
  const f = fixture(entry => { if (!entry.body) return listed(); if (++attempts === 1) throw new Error('Network interrupted'); return { draft:record(entry.body) }; });
  await compose(f); await f.run('save'); assert.match(f.render(), /内容已保留/);
  await f.run('save'); const first = f.requests.filter(row => row.body);
  assert.equal(first[0].body.id, first[1].body.id); assert.equal(first[0].body.message, first[1].body.message);
  await f.run('save'); assert.equal(f.requests.filter(row => row.body).length, 2, 'successful duplicate click creates no further mutation');
  f.input('message', 'Changed body'); await f.run('save'); const secondId = f.requests.at(-1).body.id;
  assert.notEqual(secondId, first[0].body.id);
  f.select('2@g.us', true); await f.run('save'); assert.notEqual(f.requests.at(-1).body.id, secondId);
});

test('actual send remains disabled even if service advertises it; direct broadcast is never called', async () => {
  const f = fixture(() => listed([], [], { sendAvailable:true })); await f.load(); await f.run('send');
  assert.match(f.render(), /disabled aria-disabled="true"[^>]*>实际发送 · BLOCKED/);
  assert.equal(f.requests.length, 1); assert.ok(f.requests.every(row => row.url.startsWith('/api/ws/group-drafts?')));
});

test('later search wins when responses arrive out of order', async () => {
  const old = deferred(); const f = fixture(({ url }) => url.includes('q=new') ? listed([group(9, 'New result')]) : old.promise);
  const first = f.load(); f.input('query', 'new'); await f.run('search'); old.resolve(listed([group(1, 'Stale result')])); await first;
  assert.match(f.render(), /New result/); assert.doesNotMatch(f.render(), /Stale result/);
});

test('input change invalidates a pending search without clearing selection', async () => {
  const gate = deferred(); let calls = 0; const f = fixture(() => ++calls === 1 ? listed() : gate.promise);
  await f.load(); f.select('1@g.us', true); const pending = f.load(); f.input('query', 'typed after request');
  gate.resolve(listed([group(8, 'Wrong search result')])); await pending;
  assert.doesNotMatch(f.render(), /Wrong search result/); assert.match(f.render(), /已选 1 \/ 100/);
});

test('account sequence and page reset discard late GET and prevent same-account ABA resurrection', async () => {
  for (const change of ['account','sequence','page']) {
    const gate = deferred(); const f = fixture(() => gate.promise); const pending = f.load();
    if (change === 'account') f.setScope({ accountId:'d2', sequence:2 });
    if (change === 'sequence') f.setScope({ accountId:'d', sequence:2 });
    if (change === 'page') { f.setScope(null); f.discardStale(); f.setScope({ accountId:'d', sequence:1 }); }
    f.render(); gate.resolve(listed([group(7, 'Old account result')])); await pending;
    assert.doesNotMatch(f.render(), /Old account result/); assert.equal(f.redraws, 1);
  }
});

test('late saved version never overwrites newer edited text or reuses its UUID', async () => {
  const gate = deferred(); let post = 0; const f = fixture(entry => !entry.body ? listed() : ++post === 1 ? gate.promise : { draft:record(entry.body) });
  await compose(f, 'Old edited body'); const saving = f.run('save'); const first = f.requests.at(-1).body;
  f.input('message', 'New edited body'); gate.resolve({ draft:record(first) }); await saving;
  assert.match(f.render(), />New edited body<\/textarea>/); assert.doesNotMatch(f.render(), /草稿已保存/);
  await f.run('save'); assert.notEqual(f.requests.at(-1).body.id, first.id); assert.equal(f.requests.at(-1).body.message, 'New edited body');
});

test('late save and cancel cannot write history or notices into another page or account', async () => {
  for (const action of ['save','cancel']) {
    const gate = deferred(); const draft = record({ id:'saved', accountId:'d', message:'Original', targets:['1@g.us'] });
    const f = fixture(entry => entry.body ? gate.promise : listed(undefined, [draft])); await compose(f);
    const pending = f.run(action, 'saved'); const sent = f.requests.at(-1).body;
    f.reset(); f.setScope({ accountId:'d2', sequence:2 }); const before = f.render();
    gate.resolve({ draft:record({ ...draft, ...sent }, action === 'cancel' ? 'CANCELLED' : 'DRAFT') }); await pending;
    assert.equal(f.render(), before); assert.equal(sent.accountId, 'd');
  }
});

test('only DRAFT is cancellable; cancellation displays per-target CANCELLED without claiming delivery', async () => {
  const draft = record({ id:'saved', accountId:'d', message:'Original', targets:['1@g.us','2@g.us'] });
  const f = fixture(entry => entry.body ? { draft:record(draft, 'CANCELLED') } : listed(undefined, [draft]));
  await f.load(); await f.run('cancel', 'saved');
  assert.deepEqual(f.requests.at(-1).body, { accountId:'d', action:'cancel', id:'saved' });
  const html = f.render(); assert.match(html, /已取消 · 未发送/); assert.doesNotMatch(html, /data-ws-action="group-draft-cancel"/);
  const total = f.requests.length; await f.run('cancel', 'saved'); await f.run('cancel', 'not-in-history'); assert.equal(f.requests.length, total);
});

test('retry of an already-cancelled create remains CANCELLED', async () => {
  const f = fixture(entry => entry.body ? { draft:record(entry.body, 'CANCELLED') } : listed());
  await compose(f); await f.run('save'); assert.match(f.render(), /该草稿已取消，未发送/); assert.match(f.render(), /已取消 · 未发送/);
});

test('response account, draft ID and body/target mismatch fail closed', async () => {
  for (const mutate of [draft => ({ ...draft, accountId:'other' }), draft => ({ ...draft, id:'other' }), draft => ({ ...draft, message:'Different content' }), draft => ({ ...draft, targets:[{ groupJid:'2@g.us', name:'Wrong', status:'DRAFT' }] })]) {
    const f = fixture(entry => entry.body ? { draft:mutate(record(entry.body)) } : listed());
    await compose(f); await f.run('save'); assert.match(f.render(), /内容已保留/); assert.doesNotMatch(f.render(), /草稿已保存/);
  }
  const f = fixture(() => listed([group(9, 'Other account')], [], { accountId:'other' })); await f.load();
  assert.doesNotMatch(f.render(), /Other account/); assert.match(f.render(), /响应不属于当前账号/);
});

test('GET begun before save cannot erase a newly saved history entry', async () => {
  const gate = deferred(); let reads = 0;
  const f = fixture(entry => entry.body ? { draft:record(entry.body) } : ++reads === 1 ? listed() : gate.promise);
  await compose(f); const loading = f.load(); await f.run('save'); gate.resolve(listed()); await loading;
  assert.match(f.render(), /草稿 · 未发送/); assert.match(f.render(), /取消未发送草稿/);
});

test('history is limited to 30 and unknown states never expose cancellation', async () => {
  const drafts = Array.from({ length:40 }, (_, index) => ({ ...record({ id:'history-' + index, accountId:'d', targets:['1@g.us'] }), status:'UNKNOWN' }));
  const f = fixture(() => listed([], drafts)); await f.load();
  assert.equal((f.render().match(/<details class="ws-group-draft-history"/g) || []).length, 30);
  assert.doesNotMatch(f.render(), /data-ws-action="group-draft-cancel"/);
});

function workbenchFixture() {
  const requests = [], target = { innerHTML:'' }, host = { state:{ view:'ws-workbench', settings:{}, customers:[], activities:[] }, toast() {} };
  const context = { window:{ ZhikeWsCore:core, __zhikeRegistryHost:host, location:{ origin:'http://localhost' }, innerWidth:1440, innerHeight:900, zhikeDesktop:{ ws:async () => ({}) } },
    document:{ querySelector:selector => selector === '#viewContainer' ? target : null, querySelectorAll:() => [], getElementById:() => null, addEventListener(){}, activeElement:null, documentElement:{ dataset:{} }, body:{ classList:{ add(){}, remove(){}, toggle(){} } } },
    localStorage:{ getItem:() => null, setItem(){} }, setTimeout:() => 0, clearTimeout(){}, setInterval:() => 0, clearInterval(){}, requestAnimationFrame:() => 0,
    URL, URLSearchParams, AbortController, DOMException, console, crypto:{ randomUUID:() => '00000000-0000-4000-8000-000000000001' },
    fetch:async (url, init) => { const body = init.body ? JSON.parse(init.body) : null; requests.push({ url, body }); return { ok:true, json:async () => body ? { draft:record(body) } : listed() }; } };
  vm.createContext(context); vm.runInContext(moduleSource, context);
  const boot = /  boot\(\);\s*\}\)\(\);\s*$/; assert.match(workbench, boot);
  vm.runInContext(workbench.replace(boot, '  globalThis.ui = { state, groupDrafts, refreshWorkspacePage, renderWsWorkspacePage, handleAction, applyInput, applyControlChange, resetAccountPresentation, deactivate, render };\n})();'), context);
  const ui = context.ui; ui.state.workspaceMode = 'dedicated'; ui.state.accounts = [{ id:'d', workspaceMode:'dedicated' }]; ui.resetAccountPresentation('d'); ui.state.active = true; ui.state.wsWorkspaceView = 'group-broadcast';
  return { ...ui, requests, context, target, host };
}
test('actual workbench route, input and action integration uses only account-scoped group-drafts', async () => {
  const f = workbenchFixture(); await f.refreshWorkspacePage();
  f.applyControlChange({ matches:selector => selector === '[data-ws-group-draft-select]', dataset:{ wsGroupDraftSelect:'1@g.us' }, checked:true });
  f.applyInput({ matches:selector => selector === '[data-ws-group-draft-input]', dataset:{ wsGroupDraftInput:'message' }, value:'Integrated body' });
  await f.handleAction('group-draft-preview', {}); await f.handleAction('group-draft-save', {});
  assert.equal(f.requests.at(-1).body.accountId, 'd'); assert.equal(f.requests.at(-1).body.message, 'Integrated body');
  assert.ok(f.requests.every(row => row.url.startsWith('/api/ws/group-drafts?accountId=d')));
  assert.match(f.renderWsWorkspacePage('group-broadcast'), /群组发送草稿/); assert.match(f.target.innerHTML, /实际发送 · BLOCKED/);
  assert.deepEqual(Array.from(f.state.broadcast.selectedIds), []); assert.equal(f.state.broadcast.originalText, '');
  await assert.rejects(f.handleAction('create-broadcast-plan', {}), /BLOCKED/);
});

test('actual workbench rejects draft actions with no dedicated account, wrong mode or after leaving', async () => {
  const f = workbenchFixture(); f.resetAccountPresentation(''); await f.refreshWorkspacePage(); await f.handleAction('group-draft-save', {});
  assert.equal(f.requests.length, 0); assert.match(f.renderWsWorkspacePage('group-broadcast'), /专用账号尚未启用/);
  f.resetAccountPresentation('d'); f.state.workspaceMode = 'ordinary'; await f.handleAction('group-draft-search', {}); assert.equal(f.requests.length, 0);
  f.state.workspaceMode = 'dedicated'; f.state.wsWorkspaceView = 'groups'; await f.handleAction('group-draft-search', {}); assert.equal(f.requests.length, 0);
  f.state.wsWorkspaceView = 'group-broadcast'; await f.refreshWorkspacePage(); f.deactivate(); const count = f.requests.length;
  await f.handleAction('group-draft-search', {}); assert.equal(f.requests.length, count);
});

test('workbench navigation invalidates draft requests and loads the module before use', () => {
  assert.match(workbench, /if \(!workspaceViewAllowed\(nextView\)\) return;\s*invalidateExclusionPage\(\);\s*groupDrafts\?\.reset\(\);/);
  assert.match(workbench, /data-ws-group-draft-search/);
  const html = fs.readFileSync(path.join(repo, 'resources/app/index.html'), 'utf8');
  assert.ok(html.indexOf('./modules/ws-group-drafts-ui.js') < html.indexOf('./modules/ws-workbench.js'));
});
