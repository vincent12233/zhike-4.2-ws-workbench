'use strict';
// Explicit, read-only isolated-root archive. No database/profile/connection copy.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const repo = path.resolve(__dirname, '../..');
const root = path.resolve(process.argv[2] || '');
assert.equal(path.dirname(root).toLowerCase(), path.resolve(os.tmpdir()).toLowerCase());
assert.match(path.basename(root), /^zhike-stage51-native-[a-f0-9]{32}$/);
assert.equal(fs.lstatSync(root).isSymbolicLink(), false);
assert.equal(fs.readFileSync(path.join(root, '.stage51-isolated'), 'utf8'), 'zhike-stage51-isolated-ui-v1');
const output = path.join(repo, 'docs/superpowers/reports/stage55a-evidence');
fs.mkdirSync(output, { recursive: true });
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const writeJson = (name, value) => fs.writeFileSync(path.join(output, name), JSON.stringify(value, null, 2) + '\n');
const allowedKinds = new Set(['application-start', 'window-created', 'window-presentation-state', 'workspace-page', 'workspace-presentation-enter', 'workspace-presentation-exit', 'webview-created', 'webview-navigation', 'ws-account-selected', 'navigation-starting', 'navigation-completed', 'ws-bounds-decision', 'application-closing', 'sidecar-stopped']);
const events = fs.readFileSync(path.join(root, 'native-events.jsonl'), 'utf8').trim().split(/\r?\n/).map(line => JSON.parse(line)).filter(row => allowedKinds.has(row.kind));
// These diagnostic kinds contain only synthetic identities, lifecycle and geometry.
for (const row of events) {
  assert.equal(/"(?:apiKey|apiToken|shutdownToken|cookie|password|authorization)"\s*:/i.test(JSON.stringify(row)), false);
}
fs.writeFileSync(path.join(output, 'native-events.jsonl'), events.map(row => JSON.stringify(row)).join('\n') + '\n');
writeJson('native-summary.json', [...new Set(events.map(row => row.pid))].map(pid => {
  const rows = events.filter(row => row.pid === pid);
  const kind = name => rows.filter(row => row.kind === name);
  return {
    pid,
    pagesEntered: [...new Set(kind('workspace-page').filter(row => row.fields.phase === 'enter').map(row => row.fields.page))],
    visibleCoreCreations: kind('webview-created').filter(row => row.fields.role === 'ws-visible').map(row => row.fields.accountId),
    visibleNavigations: kind('webview-navigation').filter(row => row.fields.role === 'ws-visible').length,
    accountSelections: kind('ws-account-selected').map(row => row.fields),
    presentation: rows.filter(row => /^workspace-presentation-/.test(row.kind)),
    lastChatDecision: kind('ws-bounds-decision').filter(row => row.fields.page === 'chat').at(-1) || null,
  };
}));
for (const name of ['stage55a-final-resource-samples.jsonl', 'stage55a-final-resource-samples.context.json']) {
  fs.copyFileSync(path.join(root, name), path.join(output, name));
}
const rawLogs = ['stage55a-full.log', 'stage55a-full-final.log', 'stage55a-full-frozen.log', 'stage55a-ws-initial.log', 'stage55a-ws-final.log', 'stage55a-ui-frozen.log', 'stage55a-release-frozen.log', 'stage55a-native-diagnostic-build.log', 'stage55a-local-ingest-recheck.log', 'stage55a-worker-resource-recheck.log'];
const sources = [];
for (const name of rawLogs) {
  const bytes = fs.readFileSync(path.join(repo, '.tools', name));
  const raw = bytes.toString('utf8');
  const summary = raw.split(/\r?\n/).filter(line => /^\[(?:RUN|PASS|FAIL)\]|^Completed |^\- .*exit |个警告|个错误|已用时间/.test(line));
  sources.push({ name, rawLocalPath: '.tools/' + name, bytes: bytes.length, rawSha256: hash(bytes), summary });
}
writeJson('test-executions.json', sources);
for (const name of ['stage55a-native-close-check.json', 'stage55a-final-native-close-check.json']) {
  writeJson(name, JSON.parse(fs.readFileSync(path.join(repo, '.tools', name), 'utf8').replace(/^\uFEFF/, '').trim()));
}
const final = sources.find(row => row.name === 'stage55a-full-frozen.log');
const wsLog = fs.readFileSync(path.join(repo, '.tools/stage55a-ws-final.log'), 'utf8');
const wsLabels = [...wsLog.matchAll(/^\[RUN\] (.+)$/gm)].map(match => match[1].trim());
const passed = new Set(final.summary.filter(line => line.startsWith('[PASS] ')).map(line => line.slice(7).trim()));
writeJson('test-counts.json', { finalFull: final.summary.find(line => line.startsWith('Completed ')), wsChecks: wsLabels.length, wsPassedInFinalFull: wsLabels.filter(label => passed.has(label)).length, ui: sources.find(row => row.name === 'stage55a-ui-frozen.log').summary.find(line => line.startsWith('Completed ')), previousFailuresRetained: true, realWhatsAppTested: false, paidAiTested: false });
const builds = ['resources/app/modules/ws-workbench.js', 'resources/app/modules/ws-workbench.css', 'resources/app/app.js', 'desktop/src/Zhike.Desktop/Views/LegacyUiHostPage.xaml.cs', 'desktop/src/Zhike.Desktop/MainWindow.xaml.cs'];
writeJson('source-hashes.json', builds.map(name => ({ path: name, sha256: hash(fs.readFileSync(path.join(repo, name))) })));
const screenshots = path.join(repo, 'docs/superpowers/reports/stage55a-screenshots');
const manifest = [];
for (const dir of [output, screenshots]) for (const name of fs.readdirSync(dir).sort()) {
  const file = path.join(dir, name);
  if (!fs.statSync(file).isFile() || name === 'sha256-manifest.json') continue;
  const bytes = fs.readFileSync(file);
  manifest.push({ path: path.relative(path.dirname(output), file).split(path.sep).join('/'), bytes: bytes.length, sha256: hash(bytes) });
}
writeJson('sha256-manifest.json', { stage: '5.5A', entries: manifest, excluded: ['connection.private.json', 'SQLite databases', 'all WebView2 profiles', 'credentials', 'raw business messages'], copiedProductionData: false });
console.log(JSON.stringify({ output, diagnosticEvents: events.length, manifestEntries: manifest.length, productionOpened: false, originalRootModified: false }));
