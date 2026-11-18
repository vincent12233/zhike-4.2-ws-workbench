'use strict';
const { spawnSync } = require('node:child_process'); const path = require('node:path'); const fs = require('node:fs');
const repo = path.resolve(__dirname, '..', '..'); const tests = [
  ['worker flags', 'scripts/stage2/worker-feature-flags.test.cjs'],
  ['worker integration', 'scripts/stage2/worker-controlled-integration.test.cjs'],
  ['fencing', 'scripts/stage1/sqlite-fencing-sidecar-integration.test.cjs'],
  ['IPC contract', 'scripts/stage1/ipc-protocol-contract.test.cjs'],
];
for (const [name, file] of tests) { const r = spawnSync(process.execPath, [path.join(repo, file)], { cwd: repo, encoding: 'utf8', timeout: 120000 }); if (r.status !== 0) { process.stderr.write(`${name} failed\n${r.stdout || ''}${r.stderr || ''}`); process.exit(r.status || 1); } }
const source = fs.readFileSync(path.join(repo, 'resources/app/server.mjs'), 'utf8'); if (!source.includes('stage4Write') || !source.includes('correlation_id')) throw new Error('protected write/correlation path missing');
console.log('stage5 worker/security/performance batch: feature flags, worker isolation, IPC contract and fencing PASS');
