'use strict';
// Execute production UI functions with delayed isolated transports; no WS/network.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.resolve(__dirname, '../../resources/app/modules/ws-workbench.js'), 'utf8');
function extract(start, end) {
  const a = source.indexOf(start), b = source.indexOf(end, a);
  assert.ok(a > 0 && b > a, 'production function boundaries');
  return source.slice(a, b);
}
const sendSource = extract('  async function createBroadcastPlan(', '  function clearBroadcastPlan(');
const keySource = extract('  function broadcastIdempotencyKey(', '  function broadcastPlanRows(');
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const clone = value => JSON.parse(JSON.stringify(value));
function fixture(options = {}) {
  const item = { id: 'audit-a', accountId: 'a', conversationId: 'chat-a', status: 'queued',
    originalText: 'fixture source', translatedText: 'fixture translation', payloadKind: options.media ? 'image' : 'text',
    attachments: options.media ? [{ id: 'att-1', mediaId: 'm1' }, { id: 'att-2', mediaId: 'm2' }] : [] };
  Object.assign(item, options.item || {});
  const state = { activeAccountId: 'a', accountLoadSequence: 1, currentConversationId: 'chat-a', settings: {},
    broadcast: { loading: false, error: '', attachments: [], plan: { items: [item] } } };
  const calls = [], bridgeCalls = [], notices = [];
  let attempt = 0;
  const sandbox = {
    state, console, setTimeout: done => { done(); return 0; }, clearTimeout() {},
    text: value => String(value ?? '').trim(), confirm: () => true, render() {},
    toast: message => notices.push(message),
    captureContext: conversationId => ({ accountId: state.activeAccountId, sequence: state.accountLoadSequence, conversationId }),
    contextCurrent: context => context.accountId === state.activeAccountId && context.sequence === state.accountLoadSequence,
    assertContext(context) { if (!sandbox.contextCurrent(context)) throw new Error('STALE_CONTEXT'); },
    activeConversation: () => ({ id: state.currentConversationId, title: 'isolated contact' }),
    broadcastPlanRows: () => state.broadcast.plan?.items || [],
    broadcastPayloadKind: () => 'image',
    wsBridge: async (action, context, body) => {
      bridgeCalls.push({ action, accountId: context.accountId, body: clone(body) });
      if (options.bridge) return options.bridge(bridgeCalls.length);
      return { ok: true, deliveryState: 'local_attempted', dispatchAttempted: true, method: 'dom-composer' };
    },
    api: async (route, init, context) => {
      // Match the real api() wrapper: captured context owns the request.
      const body = { ...JSON.parse(init.body), accountId: context?.accountId || state.activeAccountId }; calls.push(clone(body));
      if (body.action === 'begin-attempt') {
        if (attempt) throw new Error('SEND_RETRY_BLOCKED');
        attempt++;
        if (options.begin) await options.begin();
        return { attemptId: 'attempt-a', audit: { ...item, status: 'sending', deliveryState: 'unknown', retryAllowed: false } };
      }
      if (options.ack) await options.ack(body);
      const deliveryState = body.deliveryState || (body.status === 'sent' ? 'local_attempted' : body.status);
      return { audit: { ...item, status: body.status, deliveryState, retryAllowed: deliveryState === 'failed', attemptId: 'attempt-a' } };
    },
  };
  vm.runInNewContext(sendSource + '\nglobalThis.send=sendBroadcastItem;', sandbox);
  return { state, calls, bridgeCalls, notices, sandbox, item, send: () => sandbox.send({ dataset: { broadcastAuditId: item.id } }) };
}
const cases = [];
const test = (name, body) => cases.push({ name, body });
test('R01 fingerprint includes every effective payload field', () => {
  const base = { accountId: 'a', conversationIds: ['c1', 'c2'], originalText: 'source', translatedText: 'translation',
    targetLanguage: 'en', caption: 'caption', payloadKind: 'image', attachments: [{ mediaId: 'm1', orderNo: 0 }] };
  const sandbox = { state: { activeAccountId: 'a', broadcast: base },
    broadcastSelectedRows: () => base.conversationIds.map(id => ({ id })),
    text: value => String(value ?? '').trim(), stableHash: value => require('node:crypto').createHash('sha256').update(String(value)).digest('hex') };
  vm.runInNewContext(keySource + '\nglobalThis.key=broadcastIdempotencyKey;', sandbox);
  const initial = sandbox.key(base);
  for (const patch of [{ caption: 'other' }, { targetLanguage: 'fr' }, { payloadKind: 'file' },
    { attachments: [{ mediaId: 'm2', orderNo: 0 }] }, { translatedText: 'other translation' }]) {
    assert.notEqual(sandbox.key({ ...base, ...patch }), initial, 'changed payload must not reuse plan identity');
  }
  assert.equal(sandbox.key({ ...base, conversationIds: ['c2', 'c1'] }), initial, 'recipient set order is not content');
});
test('R03 local click is not platform acceptance or delivery and cannot blindly retry', async () => {
  const f = fixture(); await f.send();
  assert.equal(f.calls[0]?.action, 'begin-attempt', 'durable intent must precede external action');
  assert.ok(f.calls.some(body => body.deliveryState === 'local_attempted'));
  assert.ok(f.calls.every(body => body.status !== 'sent'), 'UI cannot upgrade a click to sent');
  assert.ok(f.notices.every(message => !/^已发送/.test(message)));
  const before = f.bridgeCalls.length; await f.send();
  assert.equal(f.bridgeCalls.length, before, 'unconfirmed local attempt is not replayable');
});
test('R03 partial attachment execution is unknown and does not replay first attachment', async () => {
  const f = fixture({ media: true, bridge: async count => count === 1
    ? { ok: true, deliveryState: 'local_attempted', dispatchAttempted: true }
    : { ok: false, deliveryState: 'failed', dispatchAttempted: false, error: 'isolated pre-dispatch refusal' } });
  await f.send();
  assert.ok(f.calls.some(body => body.attachmentId === 'att-1' && body.deliveryState === 'local_attempted'),
    'record completed attachment before proceeding');
  assert.equal(f.state.broadcast.plan.items[0].deliveryState, 'unknown', 'partially dispatched item is not a wholly failed item');
  const before = f.bridgeCalls.length; await f.send();
  assert.equal(f.bridgeCalls.length, before, 'retry cannot replay partial external effects');
});
test('R06 switch while native response is pending never writes new account state', async () => {
  const gate = deferred(), started = deferred();
  const f = fixture({ bridge: async () => { started.resolve(); return gate.promise; } });
  const pending = f.send(); await started.promise;
  f.state.activeAccountId = 'b'; f.state.accountLoadSequence++; f.state.currentConversationId = 'chat-b';
  f.state.broadcast = { loading: false, error: '', marker: 'new-account', plan: { items: [] } };
  gate.resolve({ ok: true, deliveryState: 'local_attempted', dispatchAttempted: true });
  await pending;
  assert.ok(f.calls.every(body => body.accountId === 'a'), 'captured owner must be used for every durable acknowledgement');
  assert.deepEqual(f.state.broadcast, { loading: false, error: '', marker: 'new-account', plan: { items: [] } });
  assert.equal(f.bridgeCalls.length, 1);
});
test('R03 transport loss after authorization is unknown and blocked from replay', async () => {
  const f = fixture({ bridge: async () => { throw new Error('isolated transport loss'); } });
  await f.send();
  assert.equal(f.state.broadcast.plan.items[0].deliveryState, 'unknown');
  const before = f.bridgeCalls.length; await f.send();
  assert.equal(f.bridgeCalls.length, before);
});
test('R03 duplicate manual clicks cannot start concurrent native attempts', async () => {
  const gate = deferred(), started = deferred();
  const f = fixture({ bridge: async () => { started.resolve(); return gate.promise; } });
  const one = f.send(); await started.promise;
  const two = f.send();
  gate.resolve({ ok: true, deliveryState: 'local_attempted', dispatchAttempted: true });
  await Promise.all([one, two]);
  assert.equal(f.bridgeCalls.length, 1);
});
test('R06 switch during authorization aborts before touching native UI', async () => {
  const gate = deferred(), started = deferred();
  const f = fixture({ begin: async () => { started.resolve(); return gate.promise; } });
  const pending = f.send(); await started.promise;
  f.state.activeAccountId = 'b'; f.state.accountLoadSequence++;
  f.state.broadcast = { loading: false, error: '', marker: 'b', plan: { items: [] } };
  gate.resolve(); await pending;
  assert.equal(f.bridgeCalls.length, 0);
  assert.ok(f.calls.every(body => body.accountId === 'a'));
  assert.equal(f.state.broadcast.marker, 'b'); assert.equal(f.state.broadcast.error, '');
});
test('R03 acknowledgement loss preserves unknown and stops remaining attachments', async () => {
  let rejectFirst = true;
  const f = fixture({ media: true, ack: async () => {
    if (rejectFirst) { rejectFirst = false; throw new Error('isolated acknowledgement loss'); }
  } });
  await f.send();
  assert.equal(f.bridgeCalls.length, 1, 'do not continue after uncertain persistence');
  assert.equal(f.state.broadcast.plan.items[0].deliveryState, 'unknown');
  await f.send(); assert.equal(f.bridgeCalls.length, 1);
});
test('R03 lost authorization response is not presented as a fresh replayable item', async () => {
  const f = fixture({ begin: async () => { throw new Error('isolated lost authorization response'); } });
  await f.send();
  assert.equal(f.bridgeCalls.length, 0);
  assert.equal(f.state.broadcast.plan.items[0].deliveryState, 'unknown');
  const requests = f.calls.length; await f.send();
  assert.equal(f.calls.length, requests, 'refresh the durable plan instead of repeating uncertain authorization');
});
test('R03 definite preflight refusal is distinct from an uncertain attempt', async () => {
  const f = fixture({ bridge: async () => {
    const error = new Error('isolated foreground qualification rejection');
    error.deliveryState = 'failed'; error.dispatchAttempted = false; error.notAttempted = true;
    throw error;
  } });
  await f.send();
  assert.equal(f.state.broadcast.plan.items[0].deliveryState, 'failed');
  assert.equal(f.state.broadcast.plan.items[0].retryAllowed, true);
  assert.equal(f.calls.at(-1).nativeResult.notAttempted, true);
});
test('R03 incomplete native proof stays unknown instead of inventing a local attempt', async () => {
  for (const proof of [{ ok: true }, { ok: false, deliveryState: 'failed', dispatchAttempted: false },
    { ok: true, deliveryState: 'failed', dispatchAttempted: false, notAttempted: true },
    { ok: false, deliveryState: 'failed', dispatchAttempted: true, notAttempted: true }]) {
    const f = fixture({ bridge: async () => proof });
    await f.send();
    assert.equal(f.state.broadcast.plan.items[0].deliveryState, 'unknown');
    assert.ok(f.calls.every(body => body.deliveryState !== 'local_attempted'));
  }
});
test('R03 actual attachment captions are exactly those frozen in the plan', async () => {
  const f = fixture({ media: true, item: { caption: 'global fallback',
    attachments: [{ id: 'att-1', mediaId: 'm1', caption: 'first planned' }, { id: 'att-2', mediaId: 'm2', caption: 'second planned' }] } });
  await f.send();
  assert.equal(f.bridgeCalls[0].body.caption, 'first planned');
  assert.equal(f.bridgeCalls[1].body.caption, 'second planned');
});
test('R03 rejected native promise records the individual preflight refusal', async () => {
  const f = fixture({ media: true, bridge: async count => {
    if (count === 1) return { ok: true, deliveryState: 'local_attempted', dispatchAttempted: true };
    const error = new Error('isolated second attachment refusal');
    error.deliveryState = 'failed'; error.dispatchAttempted = false; error.notAttempted = true; error.phase = 'preflight';
    throw error;
  } });
  await f.send();
  assert.ok(f.calls.some(body => body.attachmentId === 'att-2' && body.deliveryState === 'failed'));
  assert.equal(f.state.broadcast.plan.items[0].deliveryState, 'unknown');
});
test('R03 UI labels preserve all five evidence levels and distrust legacy sent', () => {
  const f = fixture();
  const labels = vm.runInNewContext(
    extract('  function broadcastDeliveryState(', '  async function sendBroadcastItem(') +
    '\nglobalThis.result={label:broadcastDeliveryLabel,retry:broadcastCanRetry};',
    { text: value => String(value ?? '').trim() });
  for (const [state, pattern] of [['local_attempted', /本地已尝试/], ['platform_accepted', /平台已接受/],
    ['delivered', /已送达/], ['unknown', /结果未知/], ['failed', /明确失败/]]) {
    assert.match(labels.label({ status: 'sending', deliveryState: state }), pattern);
  }
  assert.match(labels.label({ status: 'sent' }), /结果未知/);
  assert.equal(labels.retry({ status: 'sent' }), false);
  assert.equal(f.state.activeAccountId, 'a');
});
(async () => {
  let failures = 0;
  for (const entry of cases) {
    try { await entry.body(); console.log('PASS ' + entry.name); }
    catch (error) { failures++; console.error('FAIL ' + entry.name + ': ' + error.message); }
  }
  console.log('Stage 5.5C-1A WS UI: ' + (cases.length - failures) + '/' + cases.length);
  if (failures) process.exitCode = 1;
})().catch(error => { console.error(error); process.exitCode = 1; });
