'use strict';
// Preload only the existing isolated group-monitor test; preserve assertions,
// child arguments and credentials, while retaining its normally ignored pipes.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const cp = require('node:child_process');
const repo = path.resolve(__dirname, '../..');
assert.equal(path.resolve(process.argv[1]), path.join(repo, 'tests/ws-group-monitor-api.test.cjs'));
const output = fs.mkdtempSync(path.join(repo, '.tools/stage52-ws-startup-'));
const events = [];
const streams = { stdout: '', stderr: '' };
const started = performance.now();
const original = cp.spawn;
const metadata = { source: 'actual existing isolated test with output capture only', test: 'tests/ws-group-monitor-api.test.cjs', output, startedUtc: new Date().toISOString(), child: null };
cp.spawn = function (command, args, options) {
  if (args?.[0] !== 'server.mjs') return original.apply(this, arguments);
  const dataRoot = path.resolve(options.env.ZHIKE_DATA_DIR);
  assert.equal(path.dirname(dataRoot), path.resolve(os.tmpdir()));
  assert.match(path.basename(dataRoot), /^zhike-group-monitor-api-/);
  assert.equal(path.resolve(options.cwd), path.join(repo, 'resources/app'));
  assert.equal(options.env.ZHIKE_PORT, '4588');
  const secrets = [options.env.ZHIKE_API_TOKEN, options.env.ZHIKE_SHUTDOWN_TOKEN].filter(Boolean);
  const redact = text => secrets.reduce((result, secret) => result.split(secret).join('[test-token-redacted]'), text);
  const child = original.call(this, command, args, { ...options, stdio: ['ignore', 'pipe', 'pipe'] });
  metadata.child = { pid: child.pid, port: 4588, dataRoot, spawnedMs: performance.now() - started };
  for (const kind of ['stdout', 'stderr']) child[kind].on('data', chunk => {
    streams[kind] = (streams[kind] + redact(chunk.toString())).slice(-128 * 1024);
    events.push({ atMs: +(performance.now() - started).toFixed(1), stream: kind, bytes: chunk.length });
  });
  child.on('error', error => { metadata.child.error = { code: error.code, message: redact(error.message) }; });
  child.on('exit', (code, signal) => { Object.assign(metadata.child, { exitCode: code, exitSignal: signal, exitedMs: performance.now() - started }); });
  return child;
};
process.on('exit', code => {
  for (const kind of ['stdout', 'stderr']) fs.writeFileSync(path.join(output, kind + '.log'), streams[kind]);
  fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify({ ...metadata, testExitCode: code, durationMs: performance.now() - started, events }, null, 2));
  console.error('Stage 5.2 startup diagnostic retained: ' + output + ' ; test exit=' + code);
});
