'use strict';

const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { performance } = require('node:perf_hooks');
const { observeSidecarStartup, requestWithStartupDiagnostics, READINESS_ATTEMPTS, RETRY_DELAY_MS } = require('./helpers/sidecar-startup-observer.cjs');
const node = process.env.ZHIKE_TEST_NODE || process.execPath;
const active = new Set();
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
function start(code, options = {}) {
  const child = spawn(options.executable || node, options.executable ? [] : ['-e', code], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
  const observation = observeSidecarStartup(child, options);
  active.add(child);
  const closed = new Promise(resolve => child.once('close', () => { active.delete(child); resolve(); }));
  return { child, observation, closed };
}
async function bounded(promise) {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Isolated observer fixture exceeded its own 5-second budget')), 5000); })]); }
  finally { clearTimeout(timer); }
}
async function stop(fixture) {
  if (fixture.child.exitCode === null && fixture.child.signalCode === null) fixture.child.kill('SIGTERM');
  await bounded(fixture.closed);
}
const passed = [];
async function test(name, run) { await run(); passed.push(name); console.log('[PASS] ' + name); }
(async () => {
  await test('actual early child exit reports code and elapsed time instead of exhausting readiness retries', async () => {
    const fixture = start("process.stderr.write('isolated startup rejected\\n');process.exit(37)");
    await bounded(fixture.closed);
    let requests = 0;
    await assert.rejects(requestWithStartupDiagnostics(async () => { requests++; }, fixture.observation), error => {
      assert.equal(error.code, 'SIDECAR_EARLY_EXIT'); assert.equal(error.diagnostics.exitCode, 37);
      assert.ok(error.diagnostics.elapsedMs >= 0); assert.match(error.diagnostics.stderr, /isolated startup rejected/); return true;
    });
    assert.equal(requests, 0);
  });
  await test('actual spawn error is observed and reported without an unhandled process error', async () => {
    const fixture = start('', { executable: node + '-ISOLATED-MISSING-EXECUTABLE' });
    await bounded(fixture.closed);
    await assert.rejects(requestWithStartupDiagnostics(async () => {}, fixture.observation), error => {
      assert.equal(error.code, 'SIDECAR_SPAWN_FAILED'); assert.equal(error.diagnostics.spawnErrorCode, 'ENOENT'); return true;
    });
  });
  await test('actual stderr split over chunks redacts known and labelled credentials before diagnosis', async () => {
    const known = 'ISOLATED_KNOWN_SECRET_1117', bearer = 'ISOLATED_BEARER_SECRET_1117', query = 'ISOLATED_QUERY_SECRET_1117';
    const code = `process.stderr.write(${JSON.stringify('startup token=' + known.slice(0, 12))});setTimeout(()=>{process.stderr.write(${JSON.stringify(known.slice(12) + '\nAuthorization: Bearer ' + bearer + '\nhttps://127.0.0.1/?api_key=' + query + '\n{"password":"ISOLATED_PASSWORD_1117"}\n')});process.exit(9)},20)`;
    const fixture = start(code, { secrets: [known] }); await bounded(fixture.closed);
    const snapshot = fixture.observation.snapshot();
    for (const secret of [known, bearer, query, 'ISOLATED_PASSWORD_1117']) assert.equal(snapshot.stderr.includes(secret), false, 'Credential text must not enter returned diagnostics');
    assert.match(snapshot.stderr, /REDACTED/);
    await assert.rejects(requestWithStartupDiagnostics(async () => {}, fixture.observation), error => {
      for (const secret of [known, bearer, query]) assert.equal(error.message.includes(secret), false); return true;
    });
  });
  await test('oversized actual stderr stays bounded and omits the truncated text entirely', async () => {
    const fixture = start("process.stderr.write('x'.repeat(16384)+'token=ISOLATED_TRUNCATED_SECRET');process.exit(4)", { maxStderrBytes: 96 });
    await bounded(fixture.closed); const snapshot = fixture.observation.snapshot();
    assert.equal(snapshot.stderrTruncated, true); assert.ok(snapshot.stderrBytes > 96); assert.ok(snapshot.stderrRetainedBytes <= 96);
    assert.equal(snapshot.stderr.includes('ISOLATED_TRUNCATED_SECRET'), false); assert.match(snapshot.stderr, /omitted/);
  });
  await test('readiness attempt budget remains 300 by 50ms and a real live child cannot extend a smaller test budget', async () => {
    assert.equal(READINESS_ATTEMPTS, 300); assert.equal(RETRY_DELAY_MS, 50);
    const fixture = start('setInterval(()=>{},1000)');
    try {
      let calls = 0; const started = performance.now();
      await assert.rejects(requestWithStartupDiagnostics(async () => { calls++; const error = new Error('ISOLATED_REQUEST_SECRET'); error.code = 'ECONNREFUSED'; throw error; }, fixture.observation, { attempts: 3, retryDelayMs: 10 }), error => {
        assert.equal(error.code, 'SIDECAR_READINESS_TIMEOUT'); assert.equal(error.diagnostics.attempts, 3); assert.equal(error.diagnostics.retryDelayMs, 10);
        assert.equal(error.diagnostics.lastRequestErrorCode, 'ECONNREFUSED'); assert.equal(error.message.includes('ISOLATED_REQUEST_SECRET'), false); return true;
      });
      assert.equal(calls, 3); assert.ok(performance.now() - started >= 25); assert.equal(fixture.child.exitCode, null);
    } finally { await stop(fixture); }
  });
  await test('an actual child exiting during retry stops requests at the observed failure instead of a timeout', async () => {
    const fixture = start("setTimeout(()=>process.exit(23),40)"); let calls = 0;
    await assert.rejects(requestWithStartupDiagnostics(async () => { calls++; throw new Error('not ready'); }, fixture.observation, { attempts: 300, retryDelayMs: 10 }), error => {
      assert.equal(error.code, 'SIDECAR_EARLY_EXIT'); assert.equal(error.diagnostics.exitCode, 23); return true;
    });
    await bounded(fixture.closed); assert.ok(calls > 0 && calls < 300);
  });
  assert.equal(active.size, 0, 'All isolated observer child processes must be released');
  console.log(JSON.stringify({ suite: 'sidecar-startup-observer', passed: passed.length, actualChildProcesses: true, productionDatabase: false, realWs: false, paidAi: false, childProcessesRemaining: active.size }));
})().catch(async error => {
  for (const child of active) { try { child.kill('SIGTERM'); } catch {} }
  await wait(20); console.error(error); process.exitCode = 1;
});
