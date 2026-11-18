'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const repo = path.join(__dirname, '..');
const workbenchPath = path.join(repo, 'resources', 'app', 'modules', 'ws-workbench.js');
const core = require(path.join(repo, 'resources', 'app', 'modules', 'ws-workbench-core.js'));
const originalSource = fs.readFileSync(workbenchPath, 'utf8');
const source = originalSource.replace(
  /\r?\n  boot\(\);\r?\n\}\)\(\);\s*$/,
  `\n  Object.assign(window.__test, {\n    state, loadConversations, refreshCollectionSummary, scheduleAiQueuePump, cancelAllAiWork, switchAccount, activate, deactivate, connectionAction, startBackgroundRuntime, stopBackgroundRuntime, analyzeConversation, importVisible, currentDraft, collectionRenderSignature, aiJobIdempotencyKey, fullHistorySourceFingerprint, transcriptDirectionVersion, explicitConversationType, isAutomaticDirectConversation, renderMessageRows, render,\n    getAiPumpState: () => ({ running: Boolean(aiPumpPromise), queued: aiPumpQueued, scheduled: aiPumpScheduled, aborted: Boolean(aiPumpController?.signal?.aborted) })\n  });\n})();`,
);
assert.notEqual(source, originalSource, 'runtime harness must replace boot without changing production source');

let phase = 1;
let aiRequestCount = 0;
let claimCount = 0;
let staleAnalysisWrites = 0;
let aiSignalAborted = false;
let failQueuedJobs = false;
let resolveAiImmediately = false;
let hostRefreshCount = 0;
let messageBatchWrites = 0;
let closeBridgePromise = null;
const claimedJobIds = [];
const completedJobIds = new Set();
const bridgeCalls = [];
const scrollNodes = new Map([
  ['.ws-session-list', { scrollTop: 73, scrollLeft: 2 }],
  ['.ws-message-list', { scrollTop: 41, scrollLeft: 0 }],
  ['.ws-assist-panel', { scrollTop: 99, scrollLeft: 0 }],
  ['.ws-center-panel', { scrollTop: 15, scrollLeft: 0 }],
]);
const view = {
  _html: '',
  set innerHTML(value) { this._html = String(value); },
  get innerHTML() { return this._html; },
};

const readConversation = () => ({
  id: 'conv-read',
  conversationType: 'direct',
  isGroup: false,
  externalId: '+919900000001',
  title: 'Read customer',
  unread: false,
  unreadCount: 0,
  updatedAt: phase === 1 ? '2026-11-13T04:30:00.000Z' : '2026-11-13T04:31:00.000Z',
  lastMessageAt: '2026-11-12T10:00:00.000Z',
  lastMessageText: phase === 1 ? 'first message' : 'second message',
  data: {
    conversationType: 'direct',
    historyLoaded: true,
    historyStale: false,
    historyMessageCount: phase === 1 ? 1 : 2,
    directionVersion: 4,
    historyFingerprint: 'history-fp-1',
    lastMessageFingerprint: 'history-fp-1',
  },
});
const unreadConversation = () => ({
  id: 'conv-unread',
  conversationType: 'direct',
  isGroup: false,
  externalId: '+919900000002',
  title: 'Unread customer',
  unread: true,
  unreadCount: 2,
  updatedAt: '2026-11-13T04:30:00.000Z',
  lastMessageText: 'must remain unread',
  collectionStatus: 'skipped_unread',
  data: {
    conversationType: 'direct',
    historyLoaded: true,
    historyMessageCount: 1,
    directionVersion: 4,
    historyFingerprint: 'unread-fp',
    lastMessageFingerprint: 'unread-fp',
  },
});
const groupConversation = () => ({
  id: 'conv-group',
  externalId: '120363000000000000@g.us',
  title: 'Explicit group',
  conversationType: 'group',
  isGroup: true,
  unread: false,
  unreadCount: 0,
  updatedAt: '2026-11-13T04:30:00.000Z',
  data: {
    conversationType: 'group',
    isGroup: true,
    historyLoaded: true,
    historyMessageCount: 1,
    directionVersion: 4,
    historyFingerprint: 'group-fp',
    lastMessageFingerprint: 'group-fp',
  },
});
const messages = () => [
  { id: 'm1', conversationId: 'conv-read', externalId: 'm1', direction: 'receive', originalText: 'Hello', order: 1, sentAt: '2026-11-12T09:00:00.000Z', data: { source: 'ws-webview2', sentAt: '2026-11-12T09:00:00.000Z' } },
  ...(phase === 1 ? [] : [{ id: 'm2', conversationId: 'conv-read', externalId: 'm2', direction: 'send', originalText: 'Welcome', order: 2, sentAt: '2026-11-12T10:00:00.000Z', data: { source: 'ws-webview2', sentAt: '2026-11-12T10:00:00.000Z' } }]),
];
const stats = () => ({ queued: aiRequestCount ? 0 : 2, running: aiRequestCount ? 1 : 0, retryable: 0, completed: 0, failed: 0, total: 2 });
const jobs = () => [
  { id: 'job-group', conversationId: 'conv-group', status: 'queued', payload: { sourceFingerprint: 'group-fp' } },
  { id: 'job-unread', conversationId: 'conv-unread', status: 'queued', payload: { sourceFingerprint: 'unread-fp' } },
  { id: 'job-read', conversationId: 'conv-read', status: 'queued', payload: { sourceFingerprint: 'history-fp-1' } },
];
const run = () => ({ id: 'run-1', status: 'running', total: 12, discovered: 12, collecting: 0, completed: phase === 1 ? 2 : 11, analyzed: 0, skipped: 1, failed: 0, retryable: 0, updatedAt: phase === 1 ? '2026-11-13T04:30:00.000Z' : '2026-11-13T04:31:00.000Z' });

function response(payload, status = 200) {
  return Promise.resolve({ ok: status >= 200 && status < 300, status, json: async () => payload });
}

async function fetchMock(input, init = {}) {
  const url = new URL(String(input), 'http://127.0.0.1');
  const accountId = url.searchParams.get('accountId') || 'default';
  const method = String(init.method || 'GET').toUpperCase();
  let body = {};
  try { body = init.body ? JSON.parse(init.body) : {}; } catch {}
  if (accountId === 'secondary') {
    if (url.pathname === '/api/ws/conversations') return response({ conversations: [] });
    if (url.pathname === '/api/ws/collection-runs') return response({ run: null });
    if (url.pathname === '/api/ws/followup-alerts') return response({ alerts: [] });
    if (url.pathname === '/api/ws/ai-jobs') return response({ jobs: [], stats: { queued: 0, running: 0, retryable: 0, completed: 0, failed: 0, total: 0 } });
  }
  if (url.pathname === '/api/ws/conversations' && method === 'GET') return response({ conversations: [readConversation(), unreadConversation(), groupConversation()] });
  if (url.pathname === '/api/ws/collection-runs' && method === 'GET') return response({ run: run() });
  if (url.pathname === '/api/ws/followup-alerts') return response({ alerts: [] });
  if (url.pathname === '/api/ws/messages' && method === 'GET') {
    const rows = messages();
    return response({ messages: rows, total: rows.length, hasMore: false });
  }
  if (url.pathname === '/api/ws/messages/batch' && method === 'POST') { messageBatchWrites += 1; return response({ messages: [], inserted: 0, existed: 0 }); }
  if (url.pathname === '/api/ws/analyses' && method === 'GET') return response({ analyses: [] });
  if (url.pathname === '/api/ws/analyses' && method === 'POST') { staleAnalysisWrites += 1; return response({ id: 'analysis-stale' }); }
  if (url.pathname === '/api/ws/crm-sync') { staleAnalysisWrites += 1; return response({ ok: true }); }
  if (url.pathname === '/api/ws/ai-jobs' && method === 'GET') {
    if (url.searchParams.has('status') && failQueuedJobs) return response({ error: 'AI queue temporarily unavailable' }, 503);
    return response(url.searchParams.has('status') ? { jobs: jobs().filter(item => !completedJobIds.has(item.id)), stats: stats() } : { jobs: [], stats: stats() });
  }
  if (url.pathname === '/api/ws/ai-jobs' && method === 'POST') {
    const action = String(body.action || '');
    const requested = jobs().find(item => item.id === body.jobId || item.conversationId === body.conversationId) || jobs().find(item => item.id === 'job-read');
    if (!action) return response({ job: requested, stats: stats() });
    if (action === 'claim') { claimCount += 1; claimedJobIds.push(requested.id); return response({ claimed: true, job: { ...requested, status: 'running' }, stats: { ...stats(), queued: 0, running: 1 } }); }
    if (action === 'fail') return response({ job: { ...requested, status: 'retryable' }, stats: { ...stats(), queued: 0, running: 0, retryable: 1 } });
    if (action === 'checkpoint') return response({ job: { ...requested, payload: body }, stats: stats() });
    if (action === 'complete') { completedJobIds.add(requested.id); return response({ job: { ...requested, status: 'completed' }, stats: { ...stats(), running: 0, completed: 1 } }); }
  }
  if (url.pathname === '/api/ws/collection-items' && method === 'GET') return response({ items: [] });
  if (url.pathname === '/api/ws/settings') return response({ enabled: true, receive: true, send: true, showOriginal: true, targetLanguage: '中文', sendLanguage: '自动识别', aiEnabled: true });
  if (url.pathname === '/api/ws/replies') return response({ replies: [] });
  if (url.pathname === '/api/ws/hot-chat/profile/diagnostics') return response({ profile: null });
  return response({});
}

const documentStub = {
  documentElement: { dataset: {} },
  hidden: false,
  body: { classList: { add() {}, remove() {}, toggle() {} } },
  addEventListener() {},
  querySelector(selector) {
    if (selector === '#viewContainer') return view;
    if (selector === '#crumbCurrent') return { textContent: '' };
    return scrollNodes.get(selector) || null;
  },
  querySelectorAll() { return []; },
};
const storage = new Map();
const host = {
  state: { view: 'ws-workbench', customers: [] },
  esc: value => String(value ?? ''),
  toast() {},
  getStateVersion: () => 1,
  flushStateWrites: async () => {},
  refreshState: async () => { hostRefreshCount += 1; },
};
const windowStub = {
  ZhikeWsCore: core,
  ZhikeHotChatProfile: {},
  ZhikeWsCrmSync: { shouldAutoSync: () => false },
  __zhikeRegistryHost: host,
  __test: {},
  location: { origin: 'http://127.0.0.1' },
  addEventListener() {},
  zhikeDesktop: {
    ws: async payload => {
      bridgeCalls.push(payload);
      if ((payload.action === 'close' || payload.action === 'clear-session') && closeBridgePromise) return closeBridgePromise;
      return { accountId: payload.accountId, status: '已连接' };
    },
    wsAccounts: async () => ({ accounts: [] }),
  },
  zhikeAI: {
    status: async () => ({ configured: true, providerName: 'test' }),
    request: async (payload, options = {}) => {
      aiRequestCount += 1;
      assert.equal(payload.context.conversationId, 'conv-read', 'unread job must be skipped without AI analysis');
      if (resolveAiImmediately) return { text: JSON.stringify({ summary: 'background success', confidence: 0.91, intent: 'follow-up' }), providerName: 'test', model: 'test-model' };
      return new Promise((resolve, reject) => {
        const signal = options.signal;
        const cancel = () => {
          aiSignalAborted = true;
          const error = new Error('desktop bridge cancelled (ai.request)');
          error.code = 'CANCELLED';
          reject(error);
        };
        if (signal?.aborted) cancel();
        else signal?.addEventListener('abort', cancel, { once: true });
      });
    },
  },
};
let nextIntervalId = 1;
const activeIntervals = new Map();
const sandbox = {
  window: windowStub,
  document: documentStub,
  localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, String(value)) },
  console,
  fetch: fetchMock,
  URL,
  AbortController,
  DOMException,
  Headers,
  setTimeout,
  clearTimeout,
  setInterval: (callback, delay) => { const id = nextIntervalId++; activeIntervals.set(id, { callback, delay }); return id; },
  clearInterval: id => { activeIntervals.delete(id); },
  queueMicrotask,
  requestAnimationFrame: callback => setTimeout(() => callback(Date.now()), 0),
  getComputedStyle: () => ({ display: 'block', visibility: 'visible' }),
  ResizeObserver: class { observe() {} disconnect() {} },
  MutationObserver: class { observe() {} disconnect() {} },
  confirm: () => true,
};
windowStub.window = windowStub;
vm.runInNewContext(source, sandbox, { filename: 'ws-workbench.js' });
const runtime = windowStub.__test;

runtime.state.active = true;
runtime.state.backgroundActive = true;
runtime.state.activeAccountId = 'default';
runtime.state.accountLoadSequence = 1;
runtime.state.accounts = [{ id: 'default', displayName: 'Default', status: '未连接' }, { id: 'secondary', displayName: 'Secondary', status: '未连接' }];
runtime.state.currentConversationId = 'conv-read';
runtime.state.conversationSelectionManual = true;
runtime.state.conversations = [readConversation(), unreadConversation(), groupConversation()];
runtime.state.messages = messages();
runtime.state.historyCoverage = { loaded: 1, total: 1, complete: true };
runtime.state.collectionRun = run();
runtime.state.wsStatus = '未连接';
runtime.state.loading = false;
runtime.state.aiEnabled = true;

const productionMessages = runtime.state.messages;
runtime.state.messages = [
  { id: 'legacy-native', direction: 'receive', originalText: 'legacy native direction', data: { source: 'ws-webview2', directionVersion: 3, directionSource: 'class-message-in' } },
  { id: 'native-missing-source', direction: 'receive', originalText: 'native direction without evidence', data: { source: 'ws-webview2', directionVersion: 4 } },
  { id: 'verified-send', direction: 'send', originalText: 'verified operator reply', data: { source: 'ws-webview2', directionVersion: 4, directionSource: 'class-message-out' } },
  { id: 'verified-receive', direction: 'receive', originalText: 'verified customer reply', data: { source: 'ws-webview2', directionVersion: 4, directionSource: 'class-message-in' } },
  { id: 'mismatched-tail-source', direction: 'send', originalText: 'direction evidence mismatch', data: { source: 'ws-webview2', directionVersion: 4, directionSource: 'icon-tail-in' } },
  { id: 'manual-send', direction: 'send', originalText: 'manual operator reply', data: { source: 'manual-import' } },
];
const directionHtml = runtime.renderMessageRows();
const renderedMessage = id => {
  const markerAt = directionHtml.indexOf(`data-message-id="${id}"`);
  assert.notEqual(markerAt, -1, `${id} must be rendered`);
  const start = directionHtml.lastIndexOf('<article', markerAt);
  const end = directionHtml.indexOf('</article>', markerAt);
  return directionHtml.slice(start, end + '</article>'.length);
};
assert.match(renderedMessage('legacy-native'), /direction-pending[\s\S]*发言方向待核实/, 'legacy native direction is neutral until v4 recollection');
assert.doesNotMatch(renderedMessage('legacy-native'), /客户发来|我发送/, 'legacy native card must not imply an unverified speaker');
assert.match(renderedMessage('native-missing-source'), /direction-pending[\s\S]*发言方向待核实/, 'native v4 metadata without explicit DOM direction evidence remains unverified');
assert.match(renderedMessage('verified-send'), /ws-message-row send[\s\S]*我发送/, 'v4 outgoing native message renders as operator');
assert.match(renderedMessage('verified-receive'), /ws-message-row receive[\s\S]*客户发来/, 'v4 incoming native message renders as customer');
assert.match(renderedMessage('mismatched-tail-source'), /direction-pending[\s\S]*发言方向待核实/, 'mismatched source and stored direction remain untrusted in the UI');
assert.match(renderedMessage('manual-send'), /ws-message-row send[\s\S]*我发送/, 'manual/file imports retain their explicit direction');
runtime.render();
assert.match(view.innerHTML, /当前已加载：我方 2 · 客户 1 · 待核实 3/, 'message heading reports only the directions in the currently loaded rows');
runtime.state.messages = productionMessages;

const sameHistoryKey = runtime.aiJobIdempotencyKey({ id: 'conv-read' }, { text: 'same transcript', sourceFingerprint: 'source-v1' });
assert.equal(runtime.aiJobIdempotencyKey({ id: 'conv-read' }, { text: 'same transcript', sourceFingerprint: 'source-v1' }), sameHistoryKey, 'same authoritative history remains idempotent');
assert.notEqual(runtime.aiJobIdempotencyKey({ id: 'conv-read' }, { text: 'same transcript', sourceFingerprint: 'source-v2' }), sameHistoryKey, 'same text with a new authoritative source cannot reuse the old completed job');
assert.equal(runtime.aiJobIdempotencyKey({ id: 'conv-read' }, { text: 'manual transcript', sourceFingerprint: '' }), `ws:conv-read:${core.stableHash('manual transcript')}`, 'manual imports without a source fingerprint keep the legacy idempotency key');
assert.equal(runtime.fullHistorySourceFingerprint({ conversationType: 'direct', data: { conversationType: 'direct', historyLoaded: true, directionVersion: 3, historyFingerprint: 'old-fp', lastMessageFingerprint: 'old-fp' } }), '', 'pre-v4 histories with unverified directions cannot enter automatic AI');
assert.equal(runtime.fullHistorySourceFingerprint({ conversationType: 'direct', data: { conversationType: 'direct', historyLoaded: true, directionVersion: 4, historyFingerprint: 'v4-fp', lastMessageFingerprint: 'v4-fp' } }), 'v4-fp', 'direction-v4 history with matching authoritative fingerprints is eligible');
assert.equal(runtime.fullHistorySourceFingerprint(groupConversation()), '', 'an explicit group conversation never enters automatic AI even with complete v4 history');
assert.equal(runtime.explicitConversationType(groupConversation()), 'group');
assert.equal(runtime.isAutomaticDirectConversation(readConversation()), true);
assert.equal(core.conversationType({ externalId: '919900000001@lid' }), 'direct', 'individual LID metadata is an authoritative direct-chat signal');
assert.equal(core.conversationType({ externalId: '120363000000000000@g.us', conversationType: 'direct' }), 'group', 'group JID wins over conflicting direct metadata');
assert.equal(core.detectChatImportType('[13/11/2026, 10:00] Alice: one\n[13/11/2026, 10:01] Bob: two\n[13/11/2026, 10:02] Carol: three').reason, 'multiple-senders');
assert.equal(core.detectChatImportType('[13/11/2026, 10:00] Alice: one\n[13/11/2026, 10:01] Bob: two').reason, 'insufficient-group-evidence', 'two-party exports remain compatible with manual personal import');
assert.equal(runtime.transcriptDirectionVersion({ data: { directionVersion: 4 } }, 'v4-fp'), 4, 'verified native history records its direction contract in analysis metadata');
assert.equal(runtime.transcriptDirectionVersion({ data: { directionVersion: 4 } }, ''), 0, 'manual imports without an authoritative native fingerprint remain supported without claiming direction-v4 provenance');
assert.equal((originalSource.match(/analysis\.transcriptInfo\s*=\s*\{\s*\.\.\.transcript/g) || []).length, 2, 'saved automatic and manual analyses must both retain the transcript direction metadata');

const timeout = ms => new Promise((_, reject) => setTimeout(() => reject(new Error(`timed out after ${ms} ms`)), ms));
const waitFor = async (predicate, ms = 500) => {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > ms) throw new Error('condition was not reached in time');
    await new Promise(resolve => setTimeout(resolve, 5));
  }
};

(async () => {
  const blockedRefresh = await Promise.race([runtime.refreshCollectionSummary(), timeout(250)]);
  assert.equal(blockedRefresh.code, 'COLLECTION_CAPABILITY_BLOCKED', 'RD02 does not start an automatic collector to wake the AI pump');
  assert.equal(aiRequestCount, 0, 'blocked collector refresh cannot automatically consume an AI job');
  assert.equal(claimCount, 0, 'blocked collector refresh does not claim queued work');
  await runtime.loadConversations();
  assert.equal(aiRequestCount, 0, 'an explicit local-history read does not implicitly request AI');
  assert.equal(claimCount, 0, 'only the following explicit AI action can claim a stored job');
  runtime.scheduleAiQueuePump({ accountId: 'default', conversationId: '', sequence: runtime.state.accountLoadSequence });
  await waitFor(() => aiRequestCount === 1);
  assert.equal(runtime.state.collectionRefreshing, false, 'collection refresh lock must clear while AI request remains pending');
  assert.equal(runtime.getAiPumpState().running, true, 'explicitly requested AI work continues on the independent pump');
  assert.equal(claimCount, 1, 'only the read conversation is claimed');
  assert.deepEqual(claimedJobIds, ['job-read'], 'explicit group and unread jobs never reach the model claim path');
  assert.equal(runtime.state.conversations.some(item => item.id === 'conv-group'), false, 'explicit groups are omitted from the personal workbench list');

  const previousSignature = runtime.collectionRenderSignature();
  runtime.deactivate();
  host.state.view = 'customers';
  view.innerHTML = 'CUSTOMER_PAGE';
  assert.equal(runtime.state.active, false, 'leaving WS only hides the route');
  assert.equal(runtime.state.backgroundActive, true, 'leaving WS preserves the existing manual-session lifetime');
  assert.equal(runtime.getAiPumpState().running, true, 'route leave does not abort a pending AI request');
  assert.equal(aiSignalAborted, false, 'route leave is not treated as an app/account shutdown');
  phase = 2;
  assert.equal((await Promise.race([runtime.refreshCollectionSummary(), timeout(250)])).code, 'COLLECTION_CAPABILITY_BLOCKED');
  assert.equal(runtime.state.collectionRun.completed, 2, 'blocked refresh does not mutate stored collection progress');
  assert.equal(runtime.state.messages.length, 1, 'blocked refresh does not invent a new collected message');
  await runtime.loadConversations();
  assert.equal(runtime.state.collectionRun.completed, 11, 'explicit local-history read loads the saved progress while manual AI is pending');
  assert.equal(runtime.state.messages.length, 2, 'selected stored messages refresh independently from AI');
  assert.equal(runtime.state.historyCoverage.loaded, 2, 'selected stored-history metadata refreshes with the messages');
  assert.notEqual(runtime.collectionRenderSignature(), previousSignature, 'history and run changes participate in the render signature');
  assert.equal(view.innerHTML, 'CUSTOMER_PAGE', 'reading saved WS state never overwrites the currently visible non-WS page');

  runtime.activate();
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(runtime.state.active, true, 'returning to WS remounts the visible route');
  assert.equal(runtime.state.backgroundActive, true);
  assert.equal(activeIntervals.size, 0, 're-entering WS cannot register a blocked hidden-collector timer');
  runtime.activate();
  assert.equal(activeIntervals.size, 0, 'repeated WS activation cannot revive the blocked collector');
  assert.equal(bridgeCalls.filter(call => call.action === 'open').length, 0, 'remounting a live background session does not reopen the account');
  assert.match(view.innerHTML, /11\/12/, 'rendered collection card shows the refreshed progress');

  const collectionTimer = [...activeIntervals.values()].find(item => item.delay === 12000);
  assert.equal(collectionTimer, undefined, 'RD02 registers no automatic 12-second collection refresh');
  runtime.deactivate();
  host.state.view = 'tasks';
  documentStub.hidden = true;
  const captureCallsBeforeHiddenTick = bridgeCalls.filter(call => call.action === 'capture-visible-messages').length;
  const hiddenRefresh = await runtime.refreshCollectionSummary({ background: true });
  await new Promise(resolve => setTimeout(resolve, 25));
  assert.equal(hiddenRefresh.code, 'COLLECTION_CAPABILITY_BLOCKED');
  assert.equal(runtime.state.backgroundActive, true, 'minimising/leaving preserves the manual session without starting collection');
  assert.equal(bridgeCalls.filter(call => call.action === 'capture-visible-messages').length, captureCallsBeforeHiddenTick, 'hidden route never runs current-chat DOM capture');
  documentStub.hidden = false;
  runtime.activate();
  await new Promise(resolve => setTimeout(resolve, 10));
  await new Promise(resolve => setTimeout(resolve, 15));
  assert.equal(scrollNodes.get('.ws-session-list').scrollTop, 73, 'conversation list scroll is preserved');
  assert.equal(scrollNodes.get('.ws-message-list').scrollTop, 41, 'message list scroll is preserved');

  await Promise.race([runtime.refreshCollectionSummary(), timeout(250)]);
  assert.equal(aiRequestCount, 1, 'repeated refreshes do not start a duplicate AI request');
  assert.equal(claimCount, 1, 'repeated refreshes do not claim the same job twice');
  assert.equal(runtime.state.collectionRefreshing, false, 'refresh lock is never held by the AI pump');

  runtime.state.aiEnabled = false;
  await runtime.cancelAllAiWork();
  assert.equal(aiSignalAborted, true, 'turning AI off aborts the pending model request');
  assert.equal(runtime.state.backgroundActive, true, 'turning AI off does not close the manual foreground session');
  await Promise.race([runtime.refreshCollectionSummary(), timeout(250)]);
  assert.equal(runtime.state.collectionRefreshing, false, 'blocked collection cannot leave a stale refresh lock while AI is off');

  aiSignalAborted = false;
  runtime.state.aiEnabled = true;
  runtime.scheduleAiQueuePump({ accountId: 'default', conversationId: '', sequence: runtime.state.accountLoadSequence });
  await waitFor(() => aiRequestCount === 2);
  assert.deepEqual(claimedJobIds, ['job-read', 'job-read'], 're-enabling AI resumes exactly one eligible direct job');

  const switched = await Promise.race([runtime.switchAccount('secondary'), timeout(500)]);
  assert.equal(switched, true);
  await waitFor(() => !runtime.getAiPumpState().running);
  await waitFor(() => !runtime.state.collectionRefreshing);
  assert.equal(aiSignalAborted, true, 'account switch cancels the previous account AI request');
  assert.equal(staleAnalysisWrites, 0, 'cancelled old-account results never write analysis or CRM data');
  assert.equal(runtime.state.activeAccountId, 'secondary');
  assert.equal(runtime.state.collectionRefreshing, false);
  assert.equal(runtime.state.listSyncBusy, false);
  assert.equal(aiRequestCount, 2, 'unread and group conversations are never opened or analyzed');
  assert.deepEqual(claimedJobIds, ['job-read', 'job-read'], 'group jobs remain unclaimed across account cancellation');
  assert.equal(bridgeCalls.some(call => call.accountId === 'default' && call.action === 'open'), false, 'background AI never opens an unread/default account conversation');

  await runtime.switchAccount('default');
  resolveAiImmediately = true;
  runtime.scheduleAiQueuePump({ accountId: 'default', conversationId: '', sequence: runtime.state.accountLoadSequence });
  await waitFor(() => hostRefreshCount === 1, 1000);
  await waitFor(() => !runtime.getAiPumpState().running, 1000);
  assert.equal(aiRequestCount, 3, 'the new account context resumes a single background model request');
  assert.deepEqual(claimedJobIds, ['job-read', 'job-read', 'job-read'], 'only the direct read conversation is ever claimed');
  assert.equal(hostRefreshCount, 1, 'a completed background AI batch refreshes Home/Task shared state once');

  const beforeGroupManualRequest = aiRequestCount;
  runtime.state.conversations = [...runtime.state.conversations, groupConversation()];
  runtime.state.currentConversationId = 'conv-group';
  runtime.state.messages = [{ id: 'gm1', direction: 'receive', originalText: 'group text', data: { source: 'ws-webview2' } }];
  const groupManualResult = await runtime.analyzeConversation({ accountId: 'default', conversationId: 'conv-group', sequence: runtime.state.accountLoadSequence });
  assert.equal(groupManualResult.group, true, 'manual analysis explicitly rejects a group conversation');
  assert.equal(aiRequestCount, beforeGroupManualRequest, 'manual group analysis makes no model request');

  runtime.state.currentConversationId = 'conv-read';
  runtime.state.messages = messages();
  runtime.currentDraft().captureText = '[13/11/2026, 10:00] Alice: one\n[13/11/2026, 10:01] Bob: two\n[13/11/2026, 10:02] Carol: three';
  const writesBeforeGroupExport = messageBatchWrites;
  await runtime.importVisible({ accountId: 'default', conversationId: 'conv-read', sequence: runtime.state.accountLoadSequence });
  assert.equal(messageBatchWrites, writesBeforeGroupExport, 'a multi-sender/group export is rejected before any message write');
  runtime.currentDraft().captureText = '[13/11/2026, 10:00] Alice created this group';
  await runtime.importVisible({ accountId: 'default', conversationId: 'conv-read', sequence: runtime.state.accountLoadSequence });
  assert.equal(messageBatchWrites, writesBeforeGroupExport, 'an explicit WhatsApp group system record is rejected before any message write');
  runtime.state.settings.enabled = false;
  runtime.currentDraft().captureText = '[13/11/2026, 10:00] Alice: hello\n[13/11/2026, 10:01] Bob: welcome';
  await runtime.importVisible({ accountId: 'default', conversationId: 'conv-read', sequence: runtime.state.accountLoadSequence });
  assert.equal(messageBatchWrites, writesBeforeGroupExport + 1, 'a two-party manual export remains importable as a personal conversation');

  failQueuedJobs = true;
  runtime.scheduleAiQueuePump({ accountId: 'default', conversationId: '', sequence: runtime.state.accountLoadSequence });
  await waitFor(() => Boolean(runtime.state.aiBackgroundError));
  assert.match(runtime.state.aiBackgroundError, /AI queue temporarily unavailable/, 'background queue failures remain visible and retryable');
  assert.match(view.innerHTML, /立即重试/, 'visible AI error includes an explicit retry action');
  assert.equal(runtime.state.collectionRefreshing, false, 'AI queue failure cannot lock collection refresh');

  failQueuedJobs = false;
  completedJobIds.delete('job-read');
  resolveAiImmediately = false;
  aiSignalAborted = false;
  runtime.state.aiBackgroundError = '';
  runtime.scheduleAiQueuePump({ accountId: 'default', conversationId: '', sequence: runtime.state.accountLoadSequence });
  await waitFor(() => aiRequestCount === 4);
  const writesBeforeClose = staleAnalysisWrites;
  let rejectCloseBridge;
  closeBridgePromise = new Promise((resolve, reject) => { rejectCloseBridge = reject; });
  const closeAction = runtime.connectionAction('close');
  await waitFor(() => !runtime.state.backgroundActive && aiSignalAborted);
  assert.equal(activeIntervals.size, 0, 'Close WS cancels timers before the native bridge settles');
  rejectCloseBridge(new Error('native close timeout'));
  await closeAction;
  closeBridgePromise = null;
  await waitFor(() => !runtime.getAiPumpState().running);
  assert.equal(runtime.state.backgroundActive, false, 'a failed native Close cannot revive the background runtime');
  assert.equal(activeIntervals.size, 0, 'explicit Close WS keeps every background timer cleared after a bridge failure');
  assert.equal(aiSignalAborted, true, 'explicit Close WS aborts a pending model request before awaiting WebView2');
  assert.equal(staleAnalysisWrites, writesBeforeClose, 'an aborted close-time AI result cannot write analysis or CRM data');

  runtime.state.backgroundActive = true;
  runtime.state.loading = true;
  runtime.state.accountsLoading = true;
  runtime.state.accountBusy = true;
  runtime.stopBackgroundRuntime();
  assert.equal(runtime.state.loading, false, 'shutdown clears an interrupted conversation-load lock');
  assert.equal(runtime.state.accountsLoading, false, 'shutdown clears an interrupted account-load lock');
  assert.equal(runtime.state.accountBusy, false, 'shutdown clears an interrupted account-switch lock');
  runtime.state.aiEnabled = false;
  await runtime.connectionAction('open');
  await waitFor(() => !runtime.state.collectionRefreshing);
  assert.equal(runtime.state.backgroundActive, true, 'manual Open WS restores the session lifetime after an interrupted startup');
  assert.equal(activeIntervals.size, 0, 'manual Open WS does not start a collector or automatic AI timer');
  assert.equal(bridgeCalls.some(call => ['discover-conversations', 'collect-all-read', 'start-group-monitor', 'configure-group-monitor', 'configure-ws-groups', 'configure-vip-groups'].includes(call.action)), false,
    'manual-session and AI regression coverage cannot invoke any blocked native collector action');
  runtime.stopBackgroundRuntime();

  process.stdout.write('WS non-blocking AI pump runtime checks passed.\n');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
