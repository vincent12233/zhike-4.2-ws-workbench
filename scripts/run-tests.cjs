'use strict';

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const repo = path.resolve(__dirname, '..');
const app = path.join(repo, 'resources', 'app');
const mode = String(process.argv[2] || 'ws').toLowerCase();
const supported = new Set(['ws', 'all', 'installer']);
if (!supported.has(mode)) throw new Error(`unknown test mode: ${mode}; use ws, all or installer`);

const failures = [];
const results = [];

function run(label, args, options = {}) {
  process.stdout.write(`\n[RUN] ${label}\n`);
  const result = spawnSync(options.command || process.execPath, args, {
    cwd: repo,
    env: { ...process.env, ...options.env },
    encoding: 'utf8',
    stdio: 'inherit',
    windowsHide: true,
  });
  if (result.error || result.status !== 0) {
    failures.push({ label, status: result.status, error: result.error?.message || '' });
    process.stderr.write(`[FAIL] ${label}\n`);
  } else {
    results.push(label);
    process.stdout.write(`[PASS] ${label}\n`);
  }
}

function sourceFiles(dir) {
  const found = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'vendor' || entry.name === 'data') continue;
    const target = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...sourceFiles(target));
    else if (/\.(?:cjs|mjs|js)$/.test(entry.name)) found.push(target);
  }
  return found.sort();
}

function runSyntax() {
  for (const file of sourceFiles(app)) run(`syntax ${path.relative(repo, file)}`, ['--check', file]);
}

function runWs() {
  runSyntax();
  run('WS core rules', [path.join(repo, 'tests', 'ws-workbench-core.test.cjs')]);
  run('WS workbench initialization', [path.join(repo, 'tests', 'ws-workbench-init.test.cjs')]);
  run('WS API and SQLite', [path.join(repo, 'tests', 'ws-workbench-api.test.cjs')]);
  run('WS list preview update', [path.join(repo, 'tests', 'ws-list-preview-update.test.cjs')]);
  run('WS SQLite v6 migration', [path.join(repo, 'tests', 'ws-workbench-migration-v6.test.cjs')]);
  run('WS security contract', [path.join(repo, 'tests', 'ws-workbench-security.test.cjs')]);
  run('WS multi-account database isolation', [path.join(repo, 'tests', 'ws-multi-account.test.cjs')]);
  run('WS multi-account BrowserView contract', [path.join(repo, 'tests', 'ws-multi-account-main.test.cjs')]);
  run('WS ChatKnow UI contract', [path.join(repo, 'tests', 'ws-workbench-ui.test.cjs')]);
  run('WS collection and CRM sync contract', [path.join(repo, 'tests', 'ws-workbench-sync.test.cjs')]);
}

function runAll() {
  runWs();
  run('operations core', [path.join(app, 'modules', 'operations-core.test.cjs')]);
  run('smart import classification', [path.join(repo, 'tests', 'smart-import-classification.test.cjs')]);
  run('ticket record separation', [path.join(repo, 'tests', 'ticket-record-separation.test.cjs')]);
  run('10k/50k performance scale', [path.join(repo, 'tests', 'performance-scale.test.cjs')]);
  run('automatic backup isolation', [path.join(repo, 'tests', 'automatic-backup-test.cjs'), path.join(app, 'main.cjs')]);
  run('HTTP asset smoke', [path.join(repo, 'tests', 'upgrade-http-smoke.test.cjs'), app]);
  run('backup and restore drill', [path.join(repo, 'tests', 'backup-restore-drill.cjs'), app]);
  run('project audit regression', [
    path.join(repo, 'tests', 'project-audit-regression.test.cjs'),
    path.join(app, 'app.js'),
    path.join(app, 'server.mjs'),
    path.join(app, 'index.html'),
    path.join(app, 'package.json'),
    path.join(repo, 'zhike-setup.iss'),
    path.join(app, 'README.md'),
  ]);
}

function runInstaller() {
  run('installer isolation and overlay', [path.join(repo, 'tests', 'ws-installer-qa.cjs')]);
  run('4.1.3 upgrade (explicit SKIP when old installer is unavailable)', [path.join(repo, 'tests', 'ws-upgrade-qa.cjs')]);
}

if (mode === 'ws') runWs();
else if (mode === 'all') runAll();
else runInstaller();

process.stdout.write(`\nCompleted ${results.length + failures.length} checks: ${results.length} passed, ${failures.length} failed.\n`);
if (failures.length) {
  for (const failure of failures) process.stderr.write(`- ${failure.label}: exit ${failure.status ?? 'spawn error'} ${failure.error}\n`);
  process.exitCode = 1;
}
