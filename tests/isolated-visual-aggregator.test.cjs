'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const vm = require('node:vm');

const runnerPath = path.resolve(__dirname, '../scripts/run-tests.cjs');
const runner = fs.readFileSync(runnerPath, 'utf8');

function simulate(mode, { env = {}, buildStatus = 0, hasHost = true, runId = 'abc123' } = {}) {
  const calls = [], output = [];
  const windowsEnv = new Proxy(env, {
    get(source, key) {
      const name = Object.keys(source).find(name => name.toUpperCase() === key.toUpperCase());
      return source[name];
    },
  });
  const state = {
    argv: ['node', runnerPath, mode], execPath: 'node', platform: 'win32', env: windowsEnv,
    stdout: { write: text => output.push(text) }, stderr: { write: text => output.push(text) },
  };
  function fakeRequire(name) {
    if (name === 'node:path') return path;
    if (name === 'node:fs') return {
      mkdirSync() {},
      mkdtempSync: prefix => prefix + runId,
      readdirSync: () => [],
      statSync: () => hasHost ? { isFile: () => true } : undefined,
    };
    assert.equal(name, 'node:child_process');
    return {
      spawnSync(command, args, options) {
        calls.push({ command, args, env: options.env });
        return { status: args[0] === 'build' ? buildStatus : 0 };
      },
    };
  }
  let error;
  try { vm.runInNewContext(runner, { require: fakeRequire, __dirname: path.dirname(runnerPath), process: state }); }
  catch (caught) { error = caught; }
  return { error, calls, output: output.join(''), exitCode: state.exitCode };
}

test('failed host build stops all test children even when an inherited executable exists', () => {
  const run = simulate('delivery-s1', { env: { ZHIKE_TEST_WEBVIEW_HOST: 'stale.exe' }, buildStatus: 1 });
  assert.ifError(run.error);
  assert.equal(run.calls.length, 1);
  assert.equal(run.calls[0].args[0], 'build');
  assert.equal(run.exitCode, 1);
  assert.match(run.output, /Completed 1 checks: 0 passed, 1 failed/);
});

test('successful build exit without the fresh executable still fails the build check', () => {
  const run = simulate('delivery-s1', { hasHost: false });
  assert.ifError(run.error);
  assert.equal(run.calls.length, 1);
  assert.equal(run.exitCode, 1);
  assert.match(run.output, /Completed 1 checks: 0 passed, 1 failed/);
});

test('all test children receive only the fresh host built for that invocation', () => {
  const hosts = ['run123', 'run456'].map(runId => {
    const run = simulate('delivery-s1', { env: { zhike_test_webview_host: 'stale.exe' }, runId });
    assert.ifError(run.error);
    assert.equal(run.exitCode, undefined);
    const [{ args }, ...children] = run.calls;
    assert.ok(children.length > 0);
    const host = path.join(args[args.indexOf('-o') + 1], 'IsolatedWebViewHost.exe');
    assert.ok(children.every(child => child.env.ZHIKE_TEST_WEBVIEW_HOST === host));
    assert.ok(children.every(child => !Object.hasOwn(child.env, 'zhike_test_webview_host')));
    return host;
  });
  assert.notEqual(...hosts);
});

test('focused diagnostics cannot replace a formal design matrix on either backend', () => {
  for (const backend of ['webview2', 'edge']) {
    for (const [mode, key, value] of [
      ['all', 'ZHIKE_LAYOUT_CASE', '1920-1'],
      ['stage55a', 'ZHIKE_LAYOUT_CASE', '1920-1'],
      ['delivery-s1', 'ZHIKE_VISUAL_ONLY', 'snapshots'],
      ['delivery-s1', 'ZHIKE_VISUAL_SNAPSHOTS', '0'],
      ['delivery-s1', 'ZHIKE_GPT_VISUAL_ONLY', '1'],
      ['delivery-s1', 'zhike_gpt_visual_only', '1'],
      ['delivery-s3', 'ZHIKE_TABLE_CAPTURE_PALETTE', 'atelier-dawn'],
    ]) {
      const run = simulate(mode, { env: { ZHIKE_VISUAL_BACKEND: backend, [key]: value } });
      assert.match(run.error?.message || '', new RegExp(key, 'i'));
      assert.deepEqual(run.calls, []);
    }
  }
});

test('Edge is an explicit suite choice and unknown backends fail before launching anything', () => {
  const edge = simulate('delivery-s2', { env: { ZHIKE_VISUAL_BACKEND: 'edge' } });
  assert.ifError(edge.error);
  assert.ok(edge.calls.length > 0);
  assert.ok(edge.calls.every(call => call.args[0] !== 'build' && call.env.ZHIKE_VISUAL_BACKEND === 'edge'));
  const invalid = simulate('delivery-s2', { env: { ZHIKE_VISUAL_BACKEND: 'unknown' } });
  assert.match(invalid.error?.message || '', /ZHIKE_VISUAL_BACKEND/);
  assert.deepEqual(invalid.calls, []);
});
