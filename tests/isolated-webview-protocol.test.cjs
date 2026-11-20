'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { hostMessages, validateResult, assertNativeLifecycle } = require('./helpers/isolated-webview-runner.cjs');
const { runIsolatedRenderer } = require('./helpers/isolated-renderer.cjs');
const ready = JSON.stringify({ kind: 'ready', browserPid: 123 }) + '\n';

test('native stream survives partial lines without inventing an initialization result', () => {
  const stream = hostMessages();
  assert.equal(stream.read(ready.slice(0, -2), 'ready'), undefined);
  assert.equal(stream.read(ready, 'ready').browserPid, 123);
  assert.equal(stream.read(ready, 'result'), undefined);
});
test('duplicate phases and out-of-order native results fail closed', () => {
  assert.throws(() => hostMessages().read(ready + ready, 'ready'), /exactly once/);
  assert.throws(() => hostMessages().read('{"kind":"result"}\n', 'result'), /follow native initialization/);
  assert.throws(() => hostMessages().read('{"kind":"closed"}\n', 'closed'), /initialized Core/);
});
test('invalid messages and an explicit native failure cannot become a ready result', () => {
  assert.throws(() => hostMessages().read('bad json\n', 'ready'), { code: 'HOST_PROTOCOL_INVALID' });
  assert.throws(() => hostMessages().read('{"kind":"other"}\n', 'ready'), /protocol/);
  assert.throws(() => hostMessages().read(ready + '{"kind":"error","code":"PROFILE_MISMATCH"}\n', 'ready'), { code: 'HOST_RENDER_FAILED' });
});
test('a preemptive close cannot be replayed as an acknowledged shutdown', () => {
  const resultLine = '{"kind":"result"}\n';
  const closed = '{"kind":"closed"}\n';
  assert.throws(() => hostMessages().read(ready + closed + resultLine, 'result'), /explicit close request/);
  assert.throws(() => hostMessages().read(ready + resultLine + closed, 'result'), /explicit close request/);
  const stream = hostMessages(), output = ready + resultLine;
  stream.read(output, 'result');stream.armClose(output);
  assert.equal(stream.read(output + closed, 'closed').kind, 'closed');
  stream.finish(output + closed);
  assert.throws(() => stream.finish(output + closed + closed), /exactly once/);
});
test('trailing errors and partial protocol records fail after native shutdown', () => {
  for(const trailer of ['{"kind":"error","code":"LATE"}\n','{"kind":']){
    const stream=hostMessages(), output=ready+'{"kind":"result"}\n';
    stream.read(output,'result');stream.armClose(output);
    assert.throws(()=>stream.finish(output+'{"kind":"closed"}\n'+trailer));
  }
});

function lifecycleMetadata(...ending) {
  return {
    timeoutMs: 30000, streamsClosed: true, browserPid: 123, exit: { code: 0, signal: null },
    events: [
      { event: 'webview-core-ready' }, { event: 'result-verified' }, { event: 'result-ready' },
      { event: 'close-requested' }, { event: 'webview-close-requested' }, ...ending,
    ],
  };
}

const processExit = { event: 'process-exit', code: 0, signal: null };
const coreExit = { event: 'webview-browser-exited', normal: true, browserPid: 123 };
const streamsClosed = { event: 'streams-close' };

test('actual host exit and the buffered Core closure can be observed in either order', () => {
  assertNativeLifecycle(lifecycleMetadata(coreExit, processExit, streamsClosed));
  assertNativeLifecycle(lifecycleMetadata(processExit, coreExit, streamsClosed));
});

test('host and Core exit evidence must both follow the explicit close request', () => {
  for (const exit of [processExit, coreExit]) {
    const remaining = exit === processExit ? coreExit : processExit;
    const metadata = lifecycleMetadata(remaining, streamsClosed);
    const closeRequest = metadata.events.findIndex(row => row.event === 'webview-close-requested');
    metadata.events.splice(closeRequest, 0, exit);
    assert.throws(() => assertNativeLifecycle(metadata), new RegExp('in order: ' + exit.event));
  }
});

test('missing or duplicate close evidence and premature stream closure cannot pass', () => {
  for (const event of [processExit, coreExit, streamsClosed]) {
    const ending = [processExit, coreExit, streamsClosed];
    assert.throws(() => assertNativeLifecycle(lifecycleMetadata(...ending.filter(row => row !== event))), /must complete once in order/);
    assert.throws(() => assertNativeLifecycle(lifecycleMetadata(...ending, event)), /must complete once in order/);
  }
  for (const ending of [[processExit, streamsClosed, coreExit], [coreExit, streamsClosed, processExit]]) {
    assert.throws(() => assertNativeLifecycle(lifecycleMetadata(...ending)), /in order: streams-close/);
  }
});

test('the owned PID, actual exit status, complete streams and original deadline remain necessary', () => {
  for (const wrongCore of [{ ...coreExit, browserPid: 124 }, { ...coreExit, normal: false }]) {
    assert.throws(() => assertNativeLifecycle(lifecycleMetadata(processExit, wrongCore, streamsClosed)), /exact Core browser/);
  }
  const metadata = lifecycleMetadata(processExit, coreExit, streamsClosed);
  assert.throws(() => assertNativeLifecycle({ ...metadata, exit: { code: 1, signal: null } }), /Native host must exit normally/);
  assert.throws(() => assertNativeLifecycle(lifecycleMetadata({ ...processExit, signal: 'SIGTERM' }, coreExit, streamsClosed)), /Observed host exit/);
  assert.throws(() => assertNativeLifecycle({ ...metadata, streamsClosed: false }), /streams must actually close/);
  assert.throws(() => assertNativeLifecycle({ ...metadata, timeoutMs: 31000 }), /30-second deadline/);
});

const url = new URL('file:///C:/synthetic/fixture.html?case=1');
const viewport = { width: 1920, height: 1080 };
const result = () => ({ navigation: { id: 1, succeeded: true, url: url.href }, viewport,
  value: JSON.stringify([{ viewport, actualValue: 7 }]) });
test('completed native matrix preserves the actual data and exact viewports', () => {
  assert.equal(validateResult(result(), [viewport], url, viewport)[0].actualValue, 7);
});
test('identical Windows short file paths may use URL-equivalent tilde spellings', () => {
  const target = new URL('file:///C:/Users/RUNNER%7E1/fixture.html?case=1');
  const navigation = { id: 1, succeeded: true, url: 'file:///C:/Users/RUNNER~1/fixture.html?case=1' };
  assert.equal(validateResult({ ...result(), navigation }, [viewport], target, viewport)[0].actualValue, 7);
  assert.throws(() => validateResult({ ...result(), navigation: { ...navigation, url: navigation.url + '0' } }, [viewport], target, viewport), /exact successful native navigation/);
});
test('missing, failed or foreign native navigation is rejected', () => {
  for (const navigation of [null, { id: 1, succeeded: false, url: url.href },
    { id: 1, succeeded: true, url: 'file:///C:/synthetic/previous.html' }]) {
    assert.throws(() => validateResult({ ...result(), navigation }, [viewport], url, viewport), /exact successful native navigation/);
  }
});
test('empty, partial, reordered and incorrectly sized matrices cannot pass', () => {
  assert.throws(() => validateResult({ ...result(), value: '[]' }, [viewport], url, viewport), /Every real renderer case/);
  assert.throws(() => validateResult({ ...result(), value: '[{}]' }, [viewport], url, viewport), /exactly match/);
  assert.throws(() => validateResult({ ...result(), viewport: { width: 640, height: 480 } }, [viewport], url, viewport), /Core viewport/);
  const second = { width: 1280, height: 720 };
  assert.throws(() => validateResult({ ...result(), value: JSON.stringify([{viewport:second},{viewport}]) }, [viewport,second], url, viewport), /exactly match/);
});
test('an unknown backend never silently falls back to another engine', async () => {
  const before = process.env.ZHIKE_VISUAL_BACKEND;
  try {
    process.env.ZHIKE_VISUAL_BACKEND = 'invented';
    await assert.rejects(runIsolatedRenderer({}), /Unknown visual renderer backend/);
  } finally {
    if (before === undefined) delete process.env.ZHIKE_VISUAL_BACKEND;
    else process.env.ZHIKE_VISUAL_BACKEND = before;
  }
});
