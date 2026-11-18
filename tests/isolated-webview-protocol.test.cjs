'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { hostMessages, validateResult } = require('./helpers/isolated-webview-runner.cjs');
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

const url = new URL('file:///C:/synthetic/fixture.html?case=1');
const viewport = { width: 1920, height: 1080 };
const result = () => ({ navigation: { id: 1, succeeded: true, url: url.href }, viewport,
  value: JSON.stringify([{ viewport, actualValue: 7 }]) });
test('completed native matrix preserves the actual data and exact viewports', () => {
  assert.equal(validateResult(result(), [viewport], url, viewport)[0].actualValue, 7);
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
