'use strict';
// Explicit isolated-root evidence projection only. Never opens SQLite, profiles,
// private connection files, processes, network endpoints or production resources.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const repo = path.resolve(__dirname, '../..');
assert.equal(process.argv.length, 3, 'Pass exactly one explicit isolated GUID test root.');
const root = path.resolve(process.argv[2]);
assert.equal(path.dirname(root).toLowerCase(), path.resolve(os.tmpdir()).toLowerCase());
assert.match(path.basename(root), /^zhike-stage51-native-[a-f0-9]{32}$/);
const regularDirectory = directory => {
  const info = fs.lstatSync(directory);
  assert.ok(info.isDirectory() && !info.isSymbolicLink(), 'Archive directories must be ordinary directories.');
  assert.equal(fs.realpathSync(directory).toLowerCase(), path.resolve(directory).toLowerCase(), 'Do not traverse junctions.');
};
regularDirectory(root);
const read = (directory, name) => {
  assert.equal(path.basename(name), name);
  const file = path.join(directory, name);
  if (!fs.existsSync(file)) return null;
  const info = fs.lstatSync(file);
  assert.ok(info.isFile() && !info.isSymbolicLink(), 'Archive inputs must be ordinary files.');
  assert.equal(fs.realpathSync(file).toLowerCase(), file.toLowerCase());
  assert.ok(info.size <= 64 * 1024 * 1024, 'Unexpectedly large diagnostic input; inspect it manually.');
  return fs.readFileSync(file);
};
assert.equal(read(root, '.stage51-isolated')?.toString('utf8'), 'zhike-stage51-isolated-ui-v1');
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const json = bytes => JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/, ''));
const output = path.join(repo, 'docs/superpowers/reports/stage55b-evidence');
fs.mkdirSync(output, { recursive: true }); regularDirectory(output);
const previous = read(output, 'archive-context.json');
if (previous) assert.equal(json(previous).isolatedRootName, path.basename(root), 'Do not overwrite evidence from a different test run.');
const generated = new Set(), provenance = [], missing = [];
const write = (name, bytes) => {
  assert.equal(path.basename(name), name);
  const existing = path.join(output, name);
  const existingInfo = fs.lstatSync(existing, { throwIfNoEntry: false });
  if (existingInfo) assert.ok(existingInfo.isFile() && !existingInfo.isSymbolicLink(), 'Do not follow existing or dangling output links.');
  fs.writeFileSync(existing, bytes); generated.add(name);
};
const writeJson = (name, value) => write(name, JSON.stringify(value, null, 2) + '\n');
const absent = (name, scope = 'isolated-root') => missing.push({ source: scope + '/' + name, status: 'NotProvided' });
const recordSource = (name, original, archiveName) => provenance.push({ source: 'isolated-root/' + name, rawBytes: original.length, rawSha256: hash(original), archive: archiveName, projection: true });
const timestamp = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;
const safeDiagnosticString = value => typeof value === 'string' && /^[A-Za-z0-9_. -]{0,120}$/.test(value) && !/password|cookie|bearer|authorization|api.?key|token|secret/i.test(value) ? value : '[omitted]';
const pick = (value, keys) => Object.fromEntries(keys.filter(key => Object.hasOwn(value || {}, key)).map(key => [key, value[key]]));
const safeMetrics = value => Object.fromEntries(Object.entries(value || {}).filter(([key, item]) => metricKeys.has(key) && (item === null || typeof item === 'boolean' || typeof item === 'number' && Number.isFinite(item) || typeof item === 'string' && !/[\\/@]|token|password|cookie|bearer|secret|api.?key/i.test(item))).map(([key, item]) => [key, item]));
const metricKeys = new Set(('schemaVersion atUtc elapsedMs sample rootPid rootAlive processCount webViewProcessCount workingSetBytes privateBytes threads handles status evidenceFile samples durationMs rootAliveAtEnd workingSetFirstBytes workingSetLastBytes workingSetDeltaBytes workingSetPeakBytes privatePeakBytes privateFirstBytes privateLastBytes threadsFirst threadsLast handlesFirst handlesLast threadsPeak handlesPeak observedCpuDeltaSeconds webViewProcessCountFirst webViewProcessCountLast observedProcessCount scope threshold performanceThreshold gateInference').split(' '));
const allowedKinds = new Set(('application-start application-stopping window-created window-presentation-state workspace-page workspace-presentation-enter workspace-presentation-exit webview-created webview-navigation webview-source-changed ws-account-selected navigation-starting navigation-completed ws-bounds-decision application-closing sidecar-stopped host-route-request host-loaded host-unloaded shell-initialize-requested shell-profile-created ws-initialize ws-navigation-blocked external-request-blocked ws-initialization-injected-failure sidecar-created sidecar-ready').split(' '));
const numericFields = new Set(('hwnd changed succeeded rasterizationScale workspaceRouteActive generation created reload browserProcessId navigationId cancelled success retries cycle request sequence lastAcceptedSequence routeActive routeVisible accepted chatActive hostRenderable hasNativeCore hasBounds hidden x y width height running newDocument workerEnabled realWsEnabled paidAiEnabled port routeGeneration').toLowerCase().split(' '));
const stringFields = new Set(('accountId nativeViewAccountId activeAccountId presentationAccountId page phase currentRoute route surface source outcome target role productionEntry').toLowerCase().split(' '));
const geometryKeys = new Set('showcommand flags x y width height ismaximized isminimized'.split(' '));
function eventFields(fields) {
  const result = {};
  for (const [key, value] of Object.entries(fields || {})) {
    const lower = key.toLowerCase();
    if (numericFields.has(lower) && (value === null || typeof value === 'boolean' || typeof value === 'number' && Number.isFinite(value))) result[key] = value;
    else if (stringFields.has(lower)) result[key] = safeDiagnosticString(value);
    else if (['before', 'after', 'placement'].includes(lower) && value && typeof value === 'object') result[key] = Object.fromEntries(Object.entries(value).filter(([name, item]) => geometryKeys.has(name.toLowerCase()) && (typeof item === 'boolean' || typeof item === 'number' && Number.isFinite(item))));
  }
  return result;
}
const nativeBytes = read(root, 'native-events.jsonl');
let events = [];
if (nativeBytes) {
  events = nativeBytes.toString('utf8').split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line)).filter(row => allowedKinds.has(row.kind)).map(row => ({ at: timestamp(row.at), pid: Number.isInteger(row.pid) ? row.pid : null, kind: row.kind, fields: eventFields(row.fields) }));
  write('native-events.jsonl', events.map(row => JSON.stringify(row)).join('\n') + (events.length ? '\n' : ''));
  recordSource('native-events.jsonl', nativeBytes, 'native-events.jsonl');
} else absent('native-events.jsonl');
writeJson('native-summary.json', { status: nativeBytes ? 'Observed' : 'NotProvided', gateInference: 'NotEvaluated', eventRows: events.length, processes: [...new Set(events.map(row => row.pid))].map(pid => {
  const rows = events.filter(row => row.pid === pid), kind = name => rows.filter(row => row.kind === name);
  return { pid, firstAt: rows[0]?.at, lastAt: rows.at(-1)?.at, pagesEntered: [...new Set(kind('workspace-page').filter(row => row.fields.phase === 'enter').map(row => row.fields.page))], visibleCoreCreations: kind('webview-created').filter(row => row.fields.role === 'ws-visible').map(row => row.fields.accountId), visibleNavigations: kind('webview-navigation').filter(row => row.fields.role === 'ws-visible').length, accountSelections: kind('ws-account-selected').map(row => row.fields), presentation: rows.filter(row => /^workspace-presentation-/.test(row.kind)), lastChatDecision: kind('ws-bounds-decision').filter(row => row.fields.page === 'chat').at(-1) || null, observedKindCounts: Object.fromEntries([...new Set(rows.map(row => row.kind))].map(name => [name, kind(name).length])) };
}) });

// Only synthetic aggregate evidence, never source customer/message/provider data.
for (const [name, keys] of [
  ['stage55b-seed-evidence.json', ['stage', 'synthetic', 'contactsDefault', 'auditDefault', 'crmCustomers', 'realWs', 'paidAi', 'productionOpened']],
  ['stage55b-business-evidence.json', ['stage', 'verifiedAt', 'synthetic', 'mode', 'crmCustomerCount', 'emptyFieldApproved', 'rejectedFieldUnchanged', 'manualFieldProtected', 'otherAccountSuggestionsUnchanged', 'contactsTotal', 'secondPageRows', 'duplicateRows', 'diagnosticUnavailable', 'productionOpened', 'realWs', 'paidAi']],
]) {
  const bytes = read(root, name);
  if (!bytes) { absent(name); continue; }
  const value = json(bytes);
  assert.equal(value.stage, '5.5B'); assert.equal(value.synthetic, true);
  for (const key of ['productionOpened', 'realWs', 'paidAi']) assert.equal(value[key], false, 'Only isolated synthetic evidence is permitted.');
  const projected = pick(value, keys);
  for (const item of Object.values(projected)) assert.ok(item == null || typeof item === 'boolean' || typeof item === 'number' && Number.isFinite(item) || typeof item === 'string' && /^[A-Za-z0-9_.: +\-]+$/.test(item), 'Unexpected aggregate evidence value.');
  if (name === 'stage55b-business-evidence.json') projected.reviewActions = (value.reviewActions || []).map(row => ({ action: safeDiagnosticString(row.action), outcome: safeDiagnosticString(row.outcome), source: safeDiagnosticString(row.source) }));
  writeJson(name, projected); recordSource(name, bytes, name);
}
const sampleName = 'stage55b-resource-samples.jsonl', sampleBytes = read(root, sampleName);
if (sampleBytes) {
  const samples = sampleBytes.toString('utf8').split(/\r?\n/).filter(Boolean).map(line => {
    const row = JSON.parse(line), outputRow = safeMetrics(row);
    outputRow.atUtc = timestamp(row.atUtc);
    outputRow.processes = (row.processes || []).map(item => ({ ...pick(item, ['pid', 'workingSetBytes', 'privateBytes', 'threads', 'handles', 'cpuSeconds']), name: /^(?:Zhike\.Stage51\.Acceptance|msedgewebview2|node)$/i.test(item.name) ? item.name : '[process-name-omitted]', startedUtc: timestamp(item.startedUtc) }));
    for (const item of outputRow.processes) for (const key of ['pid', 'workingSetBytes', 'privateBytes', 'threads', 'handles', 'cpuSeconds']) assert.ok(item[key] == null || typeof item[key] === 'number' && Number.isFinite(item[key]));
    return outputRow;
  });
  write(sampleName, samples.map(row => JSON.stringify(row)).join('\n') + (samples.length ? '\n' : '')); recordSource(sampleName, sampleBytes, sampleName);
} else absent(sampleName);
const contextName = 'stage55b-resource-samples.context.json', contextBytes = read(root, contextName);
if (contextBytes) {
  const value = json(contextBytes), keys = ['stage', 'status', 'checkedAtUtc', 'rootPid', 'rootStartedUtc', 'windowsCaption', 'windowsVersion', 'architecture', 'appProductVersion', 'appFileVersion', 'configurationDeclaredByRunner', 'webView2RuntimeFileVersion', 'logicalProcessorCount', 'requestedIntervalSeconds', 'requestedSamples', 'actualSamples', 'elapsedMs', 'completedRequestedObservation', 'contextLimitations', 'privateConnectionRead', 'processMemoryContentsRead', 'productionDataRead'];
  const projected = pick(value, keys);
  for (const key of ['privateConnectionRead', 'processMemoryContentsRead', 'productionDataRead']) assert.equal(value[key], false);
  for (const item of Object.values(projected)) assert.ok(item == null || typeof item === 'boolean' || typeof item === 'number' && Number.isFinite(item) || typeof item === 'string' && !/\\|https?:|bearer|cookie|password|secret|api.?key/i.test(item), 'Unexpected resource context value.');
  projected.resourceObservation = safeMetrics(value.resourceObservation);
  writeJson(contextName, projected); recordSource(contextName, contextBytes, contextName);
} else absent(contextName);

// Raw test logs stay local; publish selected execution/build lines and raw hash.
const tools = path.join(repo, '.tools'); regularDirectory(tools);
const sanitizeSummary = line => line.slice(0, 2000)
  .replace(/(?:[A-Za-z]:\\|\\\\)[^\r\n]*/g, '[local-path-omitted]')
  .replace(/\b(?:Bearer|Basic)\s+\S+/gi, '[authorization-omitted]')
  .replace(/\b(?:api[_-]?key|token|password|secret|cookie|authorization)\s*[:=]\s*[^\s,;]+/gi, '[credential-omitted]')
  .replace(/https?:\/\/\S+/gi, '[url-omitted]')
  .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email-omitted]')
  .replace(/\bS-1-\d+(?:-\d+){2,}\b/g, '[sid-omitted]')
  .replace(/(?<![\w.])\+?\d[\d ()-]{8,}\d(?![\w.])/g, value => { const digits = value.replace(/\D/g, ''); return digits.length >= 10 && digits.length <= 15 ? '[phone-omitted]' : value; });
const logs = fs.readdirSync(tools).filter(name => /^stage55b-[A-Za-z0-9._-]+\.log$/.test(name) && !/(?:^|[-_.])(?:raw|connection|private|token|key|profile|db)(?:[-_.]|$)/i.test(name)).sort();
const executions = logs.map(name => {
  const bytes = read(tools, name);
  const lines = bytes.toString('utf8').replace(/^\uFEFF/, '').split(/\r?\n/);
  const summary = lines.filter(line => /^\[(?:RUN|PASS|FAIL)\](?: |$)|^Completed\b|^- .*\bexit\b|^\s*(?:Build succeeded\.?|Build FAILED\.?|已成功生成。|生成失败。|\d+\s+(?:Warning\(s\)|Error\(s\)|个警告|个错误)|Time Elapsed\b|已用时间\b)|\b(?:PASS|FAIL)\s*$/.test(line)).map(sanitizeSummary);
  return { name, rawLocalPath: '.tools/' + name, rawBytes: bytes.length, rawSha256: hash(bytes), summary, completedSummary: summary.filter(line => /^Completed\b/.test(line)).at(-1) || 'NotProvided', observedMarkers: Object.fromEntries(['RUN', 'PASS', 'FAIL'].map(marker => [marker, summary.filter(line => line.startsWith('[' + marker + ']')).length])), status: 'ObservedOnly', gateInference: 'NotEvaluated' };
});
if (!logs.length) absent('stage55b-*.log', '.tools');
writeJson('test-executions.json', { logs: executions, rawLogsCopied: false, countsAreObservedSummaryLinesOnly: true, missingCompletionDoesNotImplySuccess: true });
const sourcePaths = ['resources/app/modules/ws-workbench.js', 'resources/app/modules/ws-workbench.css', 'resources/app/modules/ws-business-pages.js', 'resources/app/modules/ws-workspace-query.cjs', 'resources/app/modules/gpt-assistant.js', 'resources/app/server.mjs', 'resources/app/index.html'];
writeJson('source-hashes.json', sourcePaths.map(name => {
  const file = path.join(repo, name), bytes = read(path.dirname(file), path.basename(file));
  if (!bytes) { absent(name, 'repository'); return { path: name, status: 'NotProvided' }; }
  return { path: name, bytes: bytes.length, sha256: hash(bytes) };
}));
writeJson('archive-context.json', { stage: '5.5B', isolatedRootName: path.basename(root), generatedAt: new Date().toISOString(), missing, sourceProjections: provenance, productionOpened: false, originalRootModified: false, sensitiveOriginalsCopied: false, gate: 'NotEvaluated', screenshotsRequireOperatorSensitiveContentReview: true });
const manifest = [];
for (const name of [...generated].sort()) {
  const bytes = read(output, name);
  manifest.push({ path: 'stage55b-evidence/' + name, bytes: bytes.length, sha256: hash(bytes) });
}
const screenshots = path.join(repo, 'docs/superpowers/reports/stage55b-screenshots');
if (fs.existsSync(screenshots)) {
  regularDirectory(screenshots);
  for (const name of fs.readdirSync(screenshots).sort().filter(name => /^[A-Za-z0-9._-]+\.(?:png|jpg|jpeg|webp)$/i.test(name))) {
    const bytes = read(screenshots, name);
    manifest.push({ path: 'stage55b-screenshots/' + name, bytes: bytes.length, sha256: hash(bytes), contentReview: 'OperatorRequired' });
  }
}
const screenshotCount = manifest.filter(row => row.path.startsWith('stage55b-screenshots/')).length;
writeJson('sha256-manifest.json', { stage: '5.5B', entries: manifest, screenshotCount, screenshotStatus: screenshotCount ? 'ProvidedRequiresOperatorReview' : 'NotProvided', excluded: ['connection.private.json', 'SQLite databases', 'WebView2 profiles', 'keys and credentials', 'chat content', 'raw test logs', 'unapproved diagnostic fields'], copiedProductionData: false, gate: 'NotEvaluated' });
// Verify every archived projection and screenshot hash after writing.
for (const entry of manifest) {
  const file = path.join(path.dirname(output), entry.path);
  assert.equal(hash(read(path.dirname(file), path.basename(file))), entry.sha256);
}
console.log(JSON.stringify({ stage: '5.5B', output, diagnosticEvents: events.length, logs: executions.length, screenshotCount, manifestEntries: manifest.length, missing: missing.length, hashVerification: 'Matched', gate: 'NotEvaluated', productionOpened: false, originalRootModified: false }));
