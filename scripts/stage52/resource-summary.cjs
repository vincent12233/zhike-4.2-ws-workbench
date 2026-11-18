'use strict';
// Read-only analysis of actual isolated process counters and bounded native logs.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const repo = path.resolve(__dirname, '../..');
const root = path.resolve(process.argv[2] || '');
const sourceName = process.argv[3] || 'stage52-observation-final.jsonl';
const rootPid = Number(process.argv[4]);
assert.equal(path.dirname(root).toLowerCase(), path.resolve(os.tmpdir()).toLowerCase());
assert.match(path.basename(root), /^zhike-stage51-native-[a-f0-9]{32}$/);
assert.equal(fs.lstatSync(root).isSymbolicLink(), false);
assert.equal(fs.realpathSync(root).toLowerCase(), root.toLowerCase());
assert.equal(read('.stage51-isolated'), 'zhike-stage51-isolated-ui-v1');
assert.match(sourceName, /^[a-zA-Z0-9][a-zA-Z0-9._-]*\.jsonl$/);
assert.ok(Number.isSafeInteger(rootPid) && rootPid > 0);
function read(name) {
  const file = path.join(root, name);
  assert.equal(fs.lstatSync(file).isSymbolicLink(), false);
  return fs.readFileSync(file, 'utf8');
}
const lines = text => text.trim().split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line));
const sourceText = read(sourceName);
const rows = lines(sourceText);
assert.ok(rows.length > 0);
const first = rows[0], last = rows.at(-1);
const liveRows = rows.filter(row => row.rootAlive);
const rootStartedUtc = first.rootStartedUtc || liveRows.flatMap(row => row.processes).find(process => process.pid === rootPid)?.startedUtc;
assert.ok(Number.isFinite(Date.parse(rootStartedUtc)), 'Missing root process identity');
const identity = process => `${process.pid}:${process.startedUtc}`;
const identities = new Set();
for (const row of rows) {
  assert.equal(row.rootPid, rootPid);
  if (row.rootStartedUtc) assert.equal(row.rootStartedUtc, rootStartedUtc);
  assert.equal(row.processCount, row.processes.length);
  for (const key of ['workingSetBytes', 'privateBytes', 'threads', 'handles']) {
    const expected = row.processes.reduce((sum, item) => sum + item[key], 0);
    assert.equal(row[key] ?? (row.processCount === 0 ? 0 : null), expected, `${row.sample}/${key}`);
  }
  assert.equal(row.webViewProcessCount, row.processes.filter(item => /^msedgewebview2/i.test(item.name)).length);
  for (const process of row.processes) identities.add(identity(process));
}
const events = lines(read('native-events.jsonl')).filter(row => row.pid === rootPid && Date.parse(row.at) >= Date.parse(rootStartedUtc));
assert.ok(events.some(row => row.kind === 'application-start'));
const visibleCounts = {};
for (const row of events) visibleCounts[row.kind] = (visibleCounts[row.kind] || 0) + 1;
const counterName = `native-event-counts-${rootPid}.json`;
const counters = fs.existsSync(path.join(root, counterName)) ? JSON.parse(read(counterName)) : null;
if (counters) {
  assert.equal(counters.pid, rootPid);
  assert.ok(Date.parse(counters.at) >= Date.parse(rootStartedUtc));
  for (const value of Object.values(counters.counts)) {
    assert.ok(Number.isSafeInteger(value.total) && value.total >= 0);
    assert.equal(value.emitted + value.suppressed, value.total);
  }
}
const ledgerName = 'stage52-operation-ledger.jsonl';
const ledger = fs.existsSync(path.join(root, ledgerName)) ? lines(read(ledgerName)).filter(row => row.rootPid === rootPid) : [];
const coreRows = events.filter(row => row.kind === 'webview-created').map(row => ({ at: row.at, role: row.fields?.role, accountId: row.fields?.accountId, browserProcessId: row.fields?.browserProcessId }));
const contextName = path.basename(sourceName, '.jsonl') + '.context.json';
const context = fs.existsSync(path.join(root, contextName)) ? JSON.parse(read(contextName)) : null;
if (context) {
  assert.equal(context.rootPid, rootPid);
  assert.equal(context.rootStartedUtc, rootStartedUtc);
}
const eventTotals = Object.fromEntries(Object.entries(counters?.counts || {}).map(([key, value]) => [key, value.total]));
const runLedgerName = path.basename(sourceName, '.jsonl') + '.operations.jsonl';
const runLedger = fs.existsSync(path.join(root, runLedgerName)) ? lines(read(runLedgerName)) : [];
const byOperation = new Map();
for (const mark of runLedger) {
  assert.equal(mark.rootPid, rootPid);
  assert.equal(mark.rootStartedUtc, rootStartedUtc);
  assert.equal(mark.observationFile, sourceName);
  assert.equal(mark.monotonicFrequency, first.monotonicFrequency);
  assert.ok(Number.isSafeInteger(mark.monotonicTicks) && mark.monotonicTicks > 0);
  assert.ok(['begin', 'end', 'snapshot'].includes(mark.boundary));
  const pair = byOperation.get(mark.operationId) || { operationId: mark.operationId, phase: mark.phase };
  assert.equal(pair.phase, mark.phase);
  assert.ok(!pair[mark.boundary], `Duplicate ${mark.boundary} marker for ${mark.operationId}`);
  pair[mark.boundary] = mark;
  byOperation.set(mark.operationId, pair);
}

const round = value => Math.round(value * 1000) / 1000;
const elapsed = (from, to) => round((to.monotonicTicks - from.monotonicTicks) * 1000 / from.monotonicFrequency);
const metricKeys = ['workingSetBytes', 'privateBytes', 'threads', 'handles', 'gdiObjects', 'userObjects', 'processCount', 'webViewProcessCount', 'coreCreationsSeen', 'cpuSecondsDelta', 'machineCpuPercent'];
function guiCount(processes, key) {
  const known = processes.filter(process => Number.isSafeInteger(process[key]));
  return { count: known.length === processes.length ? known.reduce((sum, process) => sum + process[key], 0) : null, processCoverage: known.length };
}
const series = rows.map((row, index) => {
  const previous = rows[index - 1];
  const stepMs = previous ? row.elapsedMs - previous.elapsedMs : null;
  assert.ok(stepMs === null || stepMs > 0);
  const before = new Map(previous?.processes.map(process => [identity(process), process.cpuSeconds]));
  let cpuSecondsDelta = 0;
  let cpuCoverage = 0;
  for (const process of row.processes) {
    const baseline = before.get(identity(process)) ?? (Date.parse(process.startedUtc) >= Date.parse(previous?.atUtc) ? 0 : null);
    if (baseline === null || !Number.isFinite(process.cpuSeconds) || process.cpuSeconds < baseline) continue;
    cpuSecondsDelta += process.cpuSeconds - baseline;
    cpuCoverage++;
  }
  const gdi = guiCount(row.processes, 'gdiObjects');
  const user = guiCount(row.processes, 'userObjects');
  return {
    sample: row.sample, atUtc: row.atUtc, elapsedMs: row.elapsedMs, rootAlive: row.rootAlive, rootIdentityState: row.rootIdentityState,
    workingSetBytes: row.workingSetBytes ?? 0, privateBytes: row.privateBytes ?? 0, threads: row.threads ?? 0, handles: row.handles ?? 0,
    processCount: row.processCount, webViewProcessCount: row.webViewProcessCount,
    gdiObjects: gdi.count, gdiProcessCoverage: gdi.processCoverage, userObjects: user.count, userProcessCoverage: user.processCoverage,
    coreCreationsSeen: coreRows.filter(event => Date.parse(event.at) <= Date.parse(row.atUtc)).length,
    cpuSecondsDelta: previous && cpuCoverage > 0 ? round(cpuSecondsDelta) : null,
    machineCpuPercent: previous && cpuCoverage > 0 && context?.logicalProcessorCount > 0 ? round(cpuSecondsDelta * 100000 / stepMs / context.logicalProcessorCount) : null,
    cpuProcessCoverage: cpuCoverage,
    cpuPriorIdentitiesMissing: previous ? previous.processes.filter(process => !row.processes.some(current => identity(current) === identity(process))).length : 0,
    counterUnavailablePids: row.counterUnavailablePids,
    unverifiedPids: row.unverifiedPids
  };
});
const liveSeries = series.filter(row => row.rootAlive);
function trend(window) {
  const start = window[0], end = window.at(-1);
  if (window.length < 2) return null;
  return {
    samples: window.length, firstSample: start.sample, lastSample: end.sample, durationMs: round(end.elapsedMs - start.elapsedMs),
    metrics: Object.fromEntries(metricKeys.map(key => {
      const known = window.map(row => row[key]).filter(value => value != null);
      return [key, { minimum: known.length ? Math.min(...known) : null, maximum: known.length ? Math.max(...known) : null, change: start[key] == null || end[key] == null ? null : round(end[key] - start[key]), samplesWithValue: known.length }];
    }))
  };
}
const operations = [...byOperation.values()].map(pair => {
  const { begin, end, snapshot } = pair;
  const ordered = begin && end && end.monotonicTicks >= begin.monotonicTicks;
  const during = ordered ? series.filter((_, index) => rows[index].monotonicTicks >= begin.monotonicTicks && rows[index].monotonicTicks <= end.monotonicTicks) : [];
  return {
    operationId: pair.operationId, phase: pair.phase, beginUtc: begin?.atUtc, endUtc: end?.atUtc, snapshotUtc: snapshot?.atUtc,
    outcome: end?.outcome || (snapshot ? 'snapshot' : 'end-not-marked'),
    durationMs: ordered ? elapsed(begin, end) : null, timestampOrderValid: begin && end ? !!ordered : null,
    withinContinuousObservation: [begin, end, snapshot].filter(Boolean).every(mark => mark.monotonicTicks >= first.monotonicTicks && mark.monotonicTicks <= last.monotonicTicks),
    nearestSampleBeforeBegin: begin && rows.findLast(row => row.monotonicTicks <= begin.monotonicTicks)?.sample,
    nearestSampleAfterEnd: end && rows.find(row => row.monotonicTicks >= end.monotonicTicks)?.sample,
    samplesDuringOperation: during.length, trends: trend(during)
  };
});

const closeBegin = [...byOperation.values()].filter(pair => pair.phase === 'before-close' && pair.begin).at(-1)?.begin;
const firstDead = rows.find(row => ['exited', 'pid-reused'].includes(row.rootIdentityState));
const knownLiveBeforeExit = firstDead && rows.findLast(row => row.rootAlive && row.monotonicTicks < firstDead.monotonicTicks);
const finalIdentitiesReleased = ['exited', 'pid-reused'].includes(last.rootIdentityState) && !last.unverifiedPids.length && !last.remainingObservedPids.length;
const closeToProbeMs = ticks => closeBegin && ticks >= closeBegin.monotonicTicks ? elapsed(closeBegin, { monotonicTicks: ticks }) : null;
const exit = {
  status: last.schemaVersion !== 2 ? 'identity-states-unavailable' : last.rootAlive ? 'root-still-running' : !firstDead || last.rootIdentityState === 'unverified' || last.unverifiedPids.length ? 'identity-unverified' : last.remainingObservedPids.length ? 'observed-processes-remain' : 'observed-identities-released',
  lastLiveUtc: knownLiveBeforeExit?.rootIdentityProbeEndedUtc ?? knownLiveBeforeExit?.atUtc, firstRootExitObservedUtc: firstDead?.rootIdentityProbeEndedUtc ?? firstDead?.atUtc, finalSampleUtc: last.atUtc,
  remainingObservedPids: last.remainingObservedPids, unverifiedPids: last.unverifiedPids,
  closeRequestedUtc: closeBegin?.atUtc,
  nativeShutdownMarkers: events.filter(event => ['application-stopping', 'host-unloaded', 'sidecar-stopped'].includes(event.kind)).map(event => ({ atUtc: event.at, kind: event.kind })),
  closeToRootExitLowerBoundMs: closeToProbeMs(firstDead?.rootIdentityProbeEndedTicks) == null ? null : closeToProbeMs(knownLiveBeforeExit?.rootIdentityProbeStartedTicks) ?? 0,
  closeToRootExitUpperBoundMs: closeToProbeMs(firstDead?.rootIdentityProbeEndedTicks),
  closeToAllObservedIdentitiesReleasedUpperBoundMs: finalIdentitiesReleased ? closeToProbeMs(last.monotonicTicks) : null
};
const result = {
  stage: '5.2', status: 'Observed', sourceFile: sourceName,
  sourceSha256: crypto.createHash('sha256').update(sourceText).digest('hex'), rootPid,
  samples: rows.length, firstUtc: first.atUtc, lastUtc: last.atUtc, durationMs: last.elapsedMs,
  recommended15MinuteObservationReached: last.elapsedMs >= 900000,
  first: { workingSetBytes: first.workingSetBytes, privateBytes: first.privateBytes, processCount: first.processCount, webViewProcessCount: first.webViewProcessCount, threads: first.threads, handles: first.handles },
  last: { workingSetBytes: last.workingSetBytes, privateBytes: last.privateBytes, processCount: last.processCount, webViewProcessCount: last.webViewProcessCount, threads: last.threads, handles: last.handles, rootAlive: last.rootAlive },
  workingSetDeltaBytes: last.workingSetBytes - first.workingSetBytes,
  privateDeltaBytes: last.privateBytes - first.privateBytes,
  peaks: Object.fromEntries(['workingSetBytes', 'privateBytes', 'threads', 'handles'].map(key => [key, Math.max(...rows.map(row => row[key]))])),
  resourceSeries: series,
  liveObservationPeaks: Object.fromEntries(metricKeys.map(key => {
    const peak = liveSeries.reduce((highest, row) => row[key] != null && (highest == null || row[key] > highest[key]) ? row : highest, null);
    return [key, peak ? { value: peak[key], sample: peak.sample, atUtc: peak.atUtc } : null];
  })),
  liveTrend: trend(liveSeries),
  finalLiveWindowTrend: trend(liveSeries.slice(Math.floor(2 * liveSeries.length / 3))),
  markedIdleWindows: operations.filter(operation => ['steady-idle', 'long-idle'].includes(operation.phase)),
  operations, exit,
  observedProcessIdentities: identities.size, rawProcessSumsVerified: true,
  context, visibleEventCounts: visibleCounts, diagnosticEventTotals: eventTotals,
  diagnosticCountersIncludeSuppressed: !!counters,
  diagnosticCountersFlushedAt: counters?.at || null,
  completeSessionCounters: !!(eventTotals['sidecar-stopped'] && eventTotals['application-stopping']),
  coreCreationEvents: coreRows,
  coreCountEvidence: { visibleCreations: coreRows.length, totalCreations: eventTotals['webview-created'] ?? null, liveCoreCount: null, limit: 'Existing native diagnostics record Core creation without a corresponding per-Core disposal event.' },
  exceptionLikeEventTotals: Object.fromEntries(Object.entries(eventTotals).filter(([kind]) => /exception|failure|failed|error/i.test(kind))),
  expectedInjectedFailureCount: eventTotals['ws-initialization-injected-failure'] || visibleCounts['ws-initialization-injected-failure'] || 0,
  operationTimeline: ledger.map(row => ({ atUtc: row.atUtc, phase: row.phase, boundary: row.boundary, snapshotFile: row.snapshotFile, withinContinuousObservation: Date.parse(row.atUtc) >= Date.parse(first.atUtc) && Date.parse(row.atUtc) <= Date.parse(last.atUtc), counterSnapshotNestedCountsSerialized: row.diagnosticCounterSnapshot?.counts != null && typeof row.diagnosticCounterSnapshot.counts === 'object' })),
  limits: ['Resource trends describe this observation window. Process counters do not prove absence of leaks.', 'Operation durations include observation latency and depend on the supplied outcome.', 'CPU deltas cover identities observed in adjacent samples and new processes whose creation time falls within the interval. CPU time after the last sighting of an exiting process and work from processes created and exited between samples can be missed.', 'GUI resource totals require a readable count for every process included in the sample.', 'Root exit is bounded by samples. Final remaining identities cover only the observed process tree.', 'Visible event counts must not replace total counters when records were suppressed.'],
  privateConnectionRead: false, productionDataRead: false
};
if (process.argv[5] === '--stdout') {
  console.log(JSON.stringify(result, null, 2));
} else if (process.argv[5]) {
  const destination = path.resolve(process.argv[5]);
  assert.equal(path.dirname(destination), path.join(repo, 'docs/superpowers/reports'));
  assert.match(path.basename(destination), /^stage52-[a-zA-Z0-9._-]+\.json$/);
  fs.writeFileSync(destination, JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
}
if (process.argv[5] !== '--stdout') console.log(JSON.stringify({ status: result.status, samples: result.samples, durationMs: result.durationMs, recommended15MinuteObservationReached: result.recommended15MinuteObservationReached, workingSetDeltaBytes: result.workingSetDeltaBytes, rawProcessSumsVerified: true, completeSessionCounters: result.completeSessionCounters, nativeCoreCount: coreRows.length }));
