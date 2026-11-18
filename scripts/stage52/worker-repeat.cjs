'use strict';
// Runs the real isolated lifecycle executable repeatedly, retaining every run.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { performance } = require('node:perf_hooks');
const repo = path.resolve(__dirname, '../..');
const label = process.argv[2] || 'verification';
assert.match(label, /^[a-z0-9-]+$/);
const count = Number(process.argv[3] || 20);
assert.ok(Number.isInteger(count) && count >= 1 && count <= 30);
const traceMode = process.argv[4] || 'file';
assert.ok(['file', 'coarse'].includes(traceMode));
const directory = path.join(repo, '.tools', 'stage52-worker-raw', label + '-' + crypto.randomUUID());
fs.mkdirSync(directory, { recursive: true });
const executable = require('../stage2/worker-runtime-test-helper.cjs').ensureRuntimeExecutable(repo);
const runs = [];
for (let index = 1; index <= count; index++) {
  const trace = path.join(directory, 'run-' + index + '.progress.jsonl');
  const begin = performance.now();
  const environment = { ...process.env };
  if (traceMode === 'file') environment.ZHIKE_WORKER_TEST_TRACE = trace;
  else delete environment.ZHIKE_WORKER_TEST_TRACE;
  const result = spawnSync(executable, [], { cwd: repo, encoding: 'utf8', windowsHide: true, timeout: 120000, env: environment });
  fs.writeFileSync(path.join(directory, 'run-' + index + '.stdout.log'), result.stdout || '');
  fs.writeFileSync(path.join(directory, 'run-' + index + '.stderr.log'), result.stderr || '');
  const phases = fs.existsSync(trace) ? fs.readFileSync(trace, 'utf8').trim().split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line)) : (result.stdout || '').trim().split(/\r?\n/).filter(Boolean).flatMap(line => { try { const value = JSON.parse(line); return value.phase ? [value] : []; } catch { return []; } });
  let payload;
  try { payload = JSON.parse((result.stdout || '').trim().split(/\r?\n/).at(-1)); } catch {}
  const passed = result.status === 0 && !result.error && payload?.ok === true && payload?.tempRootClean === true;
  const record = { index, passed, status: result.status, signal: result.signal, errorCode: result.error?.code || null, elapsedMs: Math.round(performance.now() - begin), lastPhase: phases.at(-1)?.phase || null, phases, payload };
  // These snapshots intentionally omit SID/token/pipe/session identifiers.
  if (record.payload) { delete record.payload.currentSid; }
  runs.push(record);
  fs.writeFileSync(path.join(directory, 'results.json'), JSON.stringify({ label, count, traceMode, runs }, null, 2));
  console.log(JSON.stringify({ label, index, passed, elapsedMs: record.elapsedMs, lastPhase: record.lastPhase, errorCode: record.errorCode }));
  if (!passed) break;
}
console.log(JSON.stringify({ label, planned: count, executed: runs.length, passed: runs.filter(row => row.passed).length, failed: runs.filter(row => !row.passed).length, evidenceDirectory: directory }));
if (runs.some(row => !row.passed) || runs.length !== count) process.exitCode = 1;
