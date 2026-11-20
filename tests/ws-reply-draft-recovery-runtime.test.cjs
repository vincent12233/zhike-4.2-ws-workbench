'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const { test } = require('node:test');
const repo = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(repo, 'resources/app/modules/ws-workbench.js'), 'utf8');
const core = require(path.join(repo, 'resources/app/modules/ws-workbench-core.js'));
const key = 'zhike.ws.reply-drafts';
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
function fixture(options = {}) {
  const storage = new Map(Object.entries(options.storage || {})), timers = new Map(), allTimers = new Map(), requests = [], copies = [];
  let timerId = 0;
  const target = { innerHTML:'' }, persistLabel = { textContent:'' }, retryButton = { hidden:true }, host = { state:{ view:'ws-workbench', settings:{}, customers:[], activities:[] }, toast() {} };
  const sandbox = { window:{ ZhikeWsCore:core, __zhikeRegistryHost:host, innerWidth:1440, innerHeight:900, location:{ origin:'http://localhost' },
    zhikeDesktop:{ ws:async () => ({}), wsAccounts:async () => ({ accounts:[{ id:'D', workspaceMode:'dedicated' }] }), tools:async payload => { copies.push(payload); return options.copy ? options.copy(payload) : { copied:true }; } } },
    document:{ querySelector:selector => selector === '#viewContainer' ? target : selector === '#wsDraftPersistenceStatus' ? persistLabel : selector === '#wsDraftPersistRetry' ? retryButton : selector === '#crumbCurrent' ? { textContent:'' } : null,
      querySelectorAll:() => [], getElementById:() => null, addEventListener(){}, activeElement:null, documentElement:{ dataset:{} }, body:{ classList:{ add(){}, remove(){}, toggle(){} } } },
    localStorage:{ getItem:name => storage.get(name) ?? null, setItem:(name, value) => { options.beforeStorageWrite?.(name, value); storage.set(name, value); } },
    setTimeout:(fn, delay) => { const id = ++timerId; timers.set(id, { fn, delay }); allTimers.set(id, { fn, delay }); return id; }, clearTimeout:id => timers.delete(id),
    setInterval:() => 0, clearInterval(){}, requestAnimationFrame:() => 0, URL, URLSearchParams, AbortController, DOMException, confirm:() => true, console,
    fetch:async (url, init) => { const body = init.body ? JSON.parse(init.body) : null; const row = { url, body }; requests.push(row);
      const data = url.startsWith('/api/ws/replies') ? options.audit ? await options.audit(row) : { id:'reply-' + requests.length } : { conversations:[], profiles:[], events:[], items:[], stats:{} };
      return { ok:true, json:async () => data }; } };
  vm.createContext(sandbox);
  const boot = /  boot\(\);\s*\}\)\(\);\s*$/; assert.match(source, boot);
  vm.runInContext(source.replace(boot, '  globalThis.ui={state,currentDraft,applyInput,scheduleDraftPersist,flushDraftPersist,persistDraftReply,copyReply,useAiReply,handleAction,draftPersistenceMessage,resetAccountPresentation,switchAccount,activate,deactivate,getStartup:()=>backgroundStartPromise};\n})();'), sandbox);
  const ui = sandbox.ui; ui.state.workspaceMode = 'ordinary'; ui.state.accounts = [{ id:'A', workspaceMode:'ordinary' }, { id:'B', workspaceMode:'ordinary' }]; ui.state.activeAccountId='A'; ui.state.currentConversationId='cA'; ui.state.conversations=[{ id:'cA', title:'Synthetic A' }]; ui.state.settings = core.normalizeTranslationSettings({ enabled:false });
  const type = value => ui.applyInput({ id:'wsReplyInput', value, matches:() => false });
  const fire = () => { for (const [id, timer] of [...timers]) if (timer.delay === 250) { timers.delete(id); timer.fn(); } };
  const stored = () => JSON.parse(storage.get(key) || '{}');
  return { ...ui, type, fire, stored, storage, timers, allTimers, requests, copies, sandbox, persistLabel, retryButton };
}

test('250ms edits in A and B both survive reset and shutdown without cross-account writes', () => {
  const f = fixture(); f.type('A reply'); f.resetAccountPresentation('B'); f.state.currentConversationId='cB'; f.type('B reply'); f.flushDraftPersist();
  assert.deepEqual(f.stored(), { 'A:cA':'A reply', 'B:cB':'B reply' });
  const reopened = fixture({ storage:Object.fromEntries(f.storage) }); assert.equal(reopened.currentDraft().replyInput, 'A reply');
  reopened.resetAccountPresentation('B'); reopened.state.currentConversationId='cB'; assert.equal(reopened.currentDraft().replyInput, 'B reply');
});

test('flush uses the queued snapshot key when active conversation changes without another input', () => {
  const f = fixture(); f.type('Original A'); f.state.activeAccountId='B'; f.state.currentConversationId='never-edited'; f.flushDraftPersist();
  assert.deepEqual(f.stored(), { 'A:cA':'Original A' });
});

test('multiple pending conversations and A/B/A retain the latest value for each exact key', () => {
  const f = fixture(); f.type('A first'); f.state.currentConversationId='c2'; f.type('A second chat');
  f.resetAccountPresentation('B'); f.state.currentConversationId='cB'; f.type('B only');
  f.resetAccountPresentation('A'); f.state.currentConversationId='cA'; f.type('A newest'); f.fire();
  assert.deepEqual(f.stored(), { 'A:cA':'A newest', 'A:c2':'A second chat', 'B:cB':'B only' });
});

test('successful copy clears the queued input and an expired callback cannot resurrect it', async () => {
  const f = fixture(); f.type('Ready to copy'); const old = [...f.allTimers.values()].find(timer => timer.delay === 250).fn;
  await f.copyReply(); assert.equal(f.currentDraft().replyInput, ''); assert.equal(f.stored()['A:cA'], undefined);
  f.fire(); old(); assert.equal(f.stored()['A:cA'], undefined);
});

test('immediate clear affects only that draft and leaves another pending key intact', () => {
  const f = fixture(); f.scheduleDraftPersist('A:cA', 'Copied A'); f.scheduleDraftPersist('B:cB', 'Unsent B');
  f.persistDraftReply('A:cA', ''); f.fire(); assert.deepEqual(f.stored(), { 'B:cB':'Unsent B' });
});

test('typing while clipboard/audit is pending retains the new draft after old copy finishes', async () => {
  for (const phase of ['copy', 'audit']) {
    const gate = deferred(); const f = fixture(phase === 'copy' ? { copy:() => gate.promise } : { audit:() => gate.promise });
    f.type('Old reply'); const pending = f.copyReply();
    if (phase === 'audit') for (let i=0; i<8 && !f.requests.some(row => row.url.startsWith('/api/ws/replies')); i++) await Promise.resolve();
    f.type('New unsent reply'); gate.resolve(phase === 'copy' ? { copied:true } : { id:'saved-old' }); await pending;
    assert.equal(f.currentDraft().replyInput, 'New unsent reply'); f.fire(); assert.equal(f.stored()['A:cA'], 'New unsent reply');
    assert.equal(f.requests.find(row => row.url.startsWith('/api/ws/replies')).body.originalText, 'Old reply');
  }
});

test('editing away and back during copy is a new draft revision and remains recoverable', async () => {
  const gate = deferred(); const f = fixture({ copy:() => gate.promise }); f.type('Same text'); const pending = f.copyReply();
  f.type('Temporary edit'); f.type('Same text'); gate.resolve({ copied:true }); await pending; f.flushDraftPersist();
  assert.equal(f.currentDraft().replyInput, 'Same text'); assert.equal(f.stored()['A:cA'], 'Same text');
});

test('audit retry reuses its key only for identical copied text', async () => {
  let attempts=0; const f = fixture({ audit:() => { if (++attempts <= 2) throw new Error('Sidecar unavailable'); return { id:'saved-new' }; } });
  f.type('First reply'); await f.copyReply(); await f.copyReply(); const first = f.requests.filter(row => row.url.startsWith('/api/ws/replies'));
  assert.equal(first[0].body.idempotencyKey, first[1].body.idempotencyKey);
  f.type('Second reply'); await f.copyReply(); const last = f.requests.filter(row => row.url.startsWith('/api/ws/replies')).at(-1);
  assert.notEqual(last.body.idempotencyKey, first[0].body.idempotencyKey); assert.equal(last.body.originalText, 'Second reply');
});

test('actual switchAccount flushes the outgoing draft before its native await; stale copy cannot audit B', async () => {
  const gate = deferred(); const f = fixture({ copy:() => gate.promise }); f.type('A pending'); const copying = f.copyReply();
  const switched = f.switchAccount('B'); assert.equal(f.stored()['A:cA'], 'A pending');
  gate.resolve({ copied:true }); await copying; await switched;
  assert.equal(f.requests.filter(row => row.url.startsWith('/api/ws/replies')).length, 0); assert.equal(f.stored()['B:cA'], undefined);
});

test('deactivate and workspace-mode activate flush before any 250ms timer fires', async () => {
  const f = fixture(); f.state.active=true; f.type('Leaving A'); f.deactivate(); assert.equal(f.stored()['A:cA'], 'Leaving A');
  const g = fixture(); g.state.active=true; g.type('Mode switch A'); g.activate('dedicated'); assert.equal(g.stored()['A:cA'], 'Mode switch A'); await g.getStartup();
});

test('incomplete clipboard copy preserves the draft and does not write a copied audit', async () => {
  const f = fixture({ copy:async () => ({ copied:true, truncated:true }) }); f.type('Unsent original'); await f.copyReply(); f.fire();
  assert.equal(f.currentDraft().replyInput, 'Unsent original'); assert.equal(f.stored()['A:cA'], 'Unsent original'); assert.equal(f.requests.length, 0);
});

test('long Unicode drafts and trailing whitespace survive debounce, close and reopen in full', () => {
  const full = '完整草稿🙂'.repeat(2000) + '  \n\n';
  const f = fixture(); f.type(full); f.fire(); f.flushDraftPersist();
  assert.equal(f.stored()['A:cA'], full);
  const reopened = fixture({ storage:Object.fromEntries(f.storage) }); assert.equal(reopened.currentDraft().replyInput, full);
});

test('saving another reply never silently evicts older unsent drafts', () => {
  const previous = Object.fromEntries(Array.from({ length:65 }, (_, index) => ['A:old-' + index, 'Unsent ' + index]));
  const f = fixture({ storage:{ [key]:JSON.stringify(previous) } }); f.type('Newest unsent'); f.fire();
  assert.deepEqual(f.stored(), { ...previous, 'A:cA':'Newest unsent' });
});

test('quota failure retains complete memory and queued recovery text, shows failure and can retry', async () => {
  let unavailable = true;
  const full = 'Unsaved complete draft '.repeat(1000);
  const f = fixture({ storage:{ [key]:JSON.stringify({ 'A:cA':'Previously saved' }) },
    beforeStorageWrite:() => { if (unavailable) throw new Error('Synthetic storage quota exceeded'); } });
  f.type(full); f.fire();
  assert.equal(f.currentDraft().replyInput, full); assert.equal(f.stored()['A:cA'], 'Previously saved');
  assert.match(f.persistLabel.textContent, /保存失败/); assert.equal(f.retryButton.hidden, false);
  // Even rebuilding the in-memory draft view must not revert to the old disk copy.
  f.state.drafts.clear(); assert.equal(f.currentDraft().replyInput, full);
  f.state.activeAccountId='B'; f.state.currentConversationId='cB'; assert.match(f.draftPersistenceMessage(), /另有 1 份草稿尚未保存/);
  unavailable = false; await f.handleAction('retry-draft-persist');
  assert.equal(f.stored()['A:cA'], full); assert.equal(f.draftPersistenceMessage(), ''); assert.equal(f.retryButton.hidden, true);
});

test('adopting an AI suggestion persists immediately through shutdown without an input event', () => {
  const suggestion = 'Synthetic adopted suggestion '.repeat(300);
  const f = fixture(); f.state.analysis = { replySuggestion:suggestion.trim() }; const before = f.currentDraft().replyRevision;
  f.useAiReply(); assert.equal(f.currentDraft().replyRevision, before + 1); f.flushDraftPersist();
  const reopened = fixture({ storage:Object.fromEntries(f.storage) }); assert.equal(reopened.currentDraft().replyInput, suggestion.trim());
});

test('adopting even the same suggestion during an old copy creates a new durable revision', async () => {
  for (const suggestion of ['Original reply', 'New suggestion '.repeat(400).trim()]) {
    const gate = deferred(), f = fixture({ copy:() => gate.promise });
    f.type('Original reply'); const before = f.currentDraft().replyRevision, pending = f.copyReply();
    f.state.analysis = { replySuggestion:suggestion }; f.useAiReply();
    assert.equal(f.currentDraft().replyRevision, before + 1);
    gate.resolve({ copied:true }); await pending; f.fire();
    assert.equal(f.currentDraft().replyInput, suggestion); assert.equal(f.stored()['A:cA'], suggestion);
  }
});
