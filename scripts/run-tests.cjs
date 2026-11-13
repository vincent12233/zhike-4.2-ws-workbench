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
    env: {
      ...process.env,
      ZHIKE_TEST_NODE: path.join(app, 'node.exe'),
      ...options.env,
    },
    encoding: 'utf8',
    stdio: 'inherit',
    windowsHide: true,
    timeout: Number(options.timeout) || 120000,
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
  run('WS direct-only collection and AI policy', [path.join(repo, 'tests', 'ws-direct-only-policy.test.cjs')]);
  run('WS AI CRM sync rules', [path.join(repo, 'tests', 'ws-crm-sync-core.test.cjs')]);
  run('WS CRM customer-link trust boundary', [path.join(repo, 'tests', 'ws-crm-link-trust.test.cjs')]);
  run('WS workbench initialization', [path.join(repo, 'tests', 'ws-workbench-init.test.cjs')]);
  run('WS API and SQLite', [path.join(repo, 'tests', 'ws-workbench-api.test.cjs')]);
  run('WS list preview update', [path.join(repo, 'tests', 'ws-list-preview-update.test.cjs')]);
  run('WS follow-up chain dedupe and refresh', [path.join(repo, 'tests', 'ws-followup-chain.test.cjs')]);
  run('WS task lifecycle and multi-account history ingest', [path.join(repo, 'tests', 'ws-task-lifecycle.test.cjs')]);
  run('WS complete original text and backup roundtrip', [path.join(repo, 'tests', 'ws-original-text-roundtrip.test.cjs')]);
  run('WS intelligent follow-up strategy and CRM persistence', [path.join(repo, 'tests', 'ws-followup-intelligence.test.cjs')]);
  run('WS live refresh event contract', [path.join(repo, 'tests', 'ws-live-refresh-contract.test.cjs')]);
  run('WS non-blocking AI pump runtime', [path.join(repo, 'tests', 'ws-ai-pump-runtime.test.cjs')]);
  run('Home WS follow-up runtime', [path.join(repo, 'tests', 'home-ws-followups-runtime.test.cjs')]);
  run('WS SQLite v6 migration', [path.join(repo, 'tests', 'ws-workbench-migration-v6.test.cjs')]);
  run('WS local security contract', [path.join(repo, 'tests', 'ws-workbench-security.test.cjs')]);
  run('WS multi-account database isolation', [path.join(repo, 'tests', 'ws-multi-account.test.cjs')]);
  run('WS account runtime recovery', [path.join(repo, 'tests', 'ws-account-runtime-recovery.test.cjs')]);
  run('WS native collector async full-list scan contract', [path.join(repo, 'desktop', 'tests', 'WsCollectorScriptContractTests.cjs')]);
  run('WS native collector P0 durability contract', [path.join(repo, 'desktop', 'tests', 'WsCollectorP0ContractTests.cjs')]);
  run('WS native collector diagnostics contract', [path.join(repo, 'desktop', 'tests', 'WsCollectorDiagnosticsContractTests.cjs')]);
  run('WS native background lifecycle and bounds contract', [path.join(repo, 'desktop', 'tests', 'WsBackgroundLifecycleContractTests.cjs')]);
  run('WS process runtime coordinator contract', [path.join(repo, 'desktop', 'tests', 'WsRuntimeCoordinatorContractTests.cjs')]);
  run('WS process WebView session pool contract', [path.join(repo, 'desktop', 'tests', 'WsProcessSessionPoolContractTests.cjs')]);
  run('WS process runtime coordinator scheduling', [
    'run', '--project', path.join(repo, 'desktop', 'tests', 'WsRuntimeCoordinatorRuntime', 'WsRuntimeCoordinatorRuntime.csproj'), '-c', 'Release',
  ], { command: path.join(repo, '.tools', 'dotnet10', 'dotnet.exe') });
  run('WS parent-route visibility runtime', [path.join(repo, 'desktop', 'tests', 'WsRouteVisibilityRuntimeTests.cjs')]);
  run('WS hidden native scheduler runtime', [path.join(repo, 'desktop', 'tests', 'WsHiddenBackgroundSchedulerRuntimeTests.cjs')]);
  run('WS native group exclusion runtime', [path.join(repo, 'desktop', 'tests', 'WsGroupExclusionRuntimeTests.cjs')]);
  run('WS durable queue Web JSON and API roundtrip', [
    'run',
    '--project',
    path.join(repo, 'desktop', 'tests', 'WsQueuePayloadRuntime', 'WsQueuePayloadRuntime.csproj'),
    '-c',
    'Release',
    '-p:Platform=x64',
    '-r',
    'win-x64',
  ], { command: path.join(repo, '.tools', 'dotnet10', 'dotnet.exe') });
  run('WS native collector chunk runtime', [path.join(repo, 'desktop', 'tests', 'WsCollectorChunkRuntimeTests.cjs')]);
  run('WS native collector physical-bottom runtime', [path.join(repo, 'desktop', 'tests', 'WsFullListBottomRuntimeTests.cjs')]);
  run('WS native collector in-flight discovery runtime', [path.join(repo, 'desktop', 'tests', 'WsDiscoverAllProgressRuntimeTests.cjs')]);
  run('WS native collector full-list stall runtime', [path.join(repo, 'desktop', 'tests', 'WsFullListStallRuntimeTests.cjs')]);
  run('WS native collector navigation/retry runtime', [path.join(repo, 'desktop', 'tests', 'WsCollectorNavigationRetryRuntimeTests.cjs')]);
  run('WS native collector history packet runtime', [path.join(repo, 'desktop', 'tests', 'WsHistoryPacketRuntimeTests.cjs')]);
  run('WS unread skip contract', [path.join(repo, 'desktop', 'tests', 'WsUnreadSkipContractTests.cjs')]);
  run('WS strict unread detection runtime', [path.join(repo, 'desktop', 'tests', 'WsUnreadDetectionRuntimeTests.cjs')]);
  run('WS read-history collector runtime', [path.join(repo, 'desktop', 'tests', 'WsReadHistoryCollectorRuntimeTests.cjs')]);
  run('WS ChatKnow UI contract', [path.join(repo, 'tests', 'ws-workbench-ui.test.cjs')]);
  run('WS collection and CRM sync contract', [path.join(repo, 'tests', 'ws-workbench-sync.test.cjs')]);
  run('WS complete per-customer history contract', [path.join(repo, 'tests', 'ws-full-history.test.cjs')]);
  run('WS chunked full-history AI and checkpoint contract', [path.join(repo, 'tests', 'ws-chunked-ai-analysis.test.cjs')]);
  run('WS durable AI queue contract', [path.join(repo, 'tests', 'ai-queue-contract.test.cjs')]);
  run('WS resize performance contract', [path.join(repo, 'tests', 'ws-resize-performance-contract.test.cjs')]);
  run('WS bridge recovery contract', [path.join(repo, 'tests', 'ws-bridge-recovery-contract.test.cjs')]);
  run('WS scroll routing contract', [path.join(repo, 'tests', 'ws-scroll-routing-contract.test.cjs')]);
  run('unified scroll system contract', [path.join(repo, 'tests', 'scroll-system-contract.test.cjs')]);
  run('unified scroll coordinator runtime', [path.join(repo, 'tests', 'scroll-coordinator-runtime.test.cjs')]);
}

function runAll() {
  run('6.0 no legacy data migration contract', [path.join(repo, 'tests', 'no-legacy-data-migration-contract.test.cjs')]);
  run('backup integrity contract', [path.join(repo, 'tests', 'backup-integrity-contract.test.cjs')]);
  run('local-first sidecar contract', [path.join(repo, 'tests', 'local-first-sidecar-contract.test.cjs')]);
  run('WS local ingest runtime', [path.join(repo, 'tests', 'ws-local-ingest-runtime.test.cjs')]);
  run('WS direction effects repair runtime', [path.join(repo, 'tests', 'ws-direction-effects-repair.test.cjs')]);
  run('WS identity effects repair runtime', [path.join(repo, 'tests', 'ws-identity-effects-repair.test.cjs')]);
  run('WS unverified association-only scoped repair', [path.join(repo, 'tests', 'ws-unverified-association-repair.test.cjs')]);
  run('local service manager contract', [path.join(repo, 'desktop', 'tests', 'LocalServiceManagerContractTests.cjs')]);
  run('local service hang recovery', [path.join(repo, 'desktop', 'tests', 'LocalServiceRecoveryTests.cjs')]);
  run('local service port race regression', [path.join(repo, 'tests', 'local-service-port-race-regression.test.cjs')]);
  run('local bridge contract', [path.join(repo, 'desktop', 'tests', 'LocalBridgeContractTests.cjs')]);
  run('design system contract', [path.join(repo, 'tests', 'design-system-contract.test.cjs')]);
  run('Horizon Atelier 6.0 dynamic UI contract', [path.join(repo, 'tests', 'horizon-atelier-contract.test.cjs')]);
  run('GPT Horizon 6.0 workspace contract', [path.join(repo, 'tests', 'gpt-horizon-workspace.test.cjs')]);
  run('Horizon Atelier governance/settings UI contract', [path.join(repo, 'tests', 'governance-horizon-contract.test.cjs')]);
  run('6.0 linked business workspace shell', [path.join(repo, 'tests', 'business-6-shell-contract.test.cjs')]);
  run('6.0 global Horizon visual finish', [path.join(repo, 'tests', 'global-6-visual-contract.test.cjs')]);
  run('save error regression', [path.join(repo, 'tests', 'save-error-regression.test.cjs')]);
  run('snapshot before write regression', [path.join(repo, 'tests', 'snapshot-before-write-regression.test.cjs')]);
  run('local health contract', [path.join(repo, 'tests', 'local-health-contract.test.cjs')]);
  run('desktop/runtime version anti-rollback contract', [path.join(repo, 'desktop', 'tests', 'VersionLockContractTests.cjs')]);
  run('6.0 isolated data-root contract', [path.join(repo, 'tests', 'data-root-compatibility.test.cjs')]);
  run('6.0 single runtime and route contract', [path.join(repo, 'tests', 'single-runtime-route-contract.test.cjs')]);
  run('local write flush race contract', [path.join(repo, 'tests', 'local-write-flush-race.test.cjs')]);
  run('desktop startup XAML contract', [path.join(repo, 'tests', 'desktop-startup-contract.test.cjs')]);
  run('desktop visual single-shell contract', [path.join(repo, 'desktop', 'tests', 'DesktopVisualContractTests.cjs')]);
  run('desktop native smoke contract', [path.join(repo, 'desktop', 'tests', 'DesktopSmokeTests.cjs')]);
  run('desktop local service flow', [path.join(repo, 'desktop', 'tests', 'ServerConnectionFlowTests.cjs')]);
  run('desktop local SQLite storage mode', [path.join(repo, 'desktop', 'tests', 'StorageModeContractTests.cjs')]);
  run('desktop bridge response matching and import timeout', [path.join(repo, 'desktop', 'tests', 'LegacyBridgeContractTests.cjs')]);
  run('desktop ApiClient local-only routes', [path.join(repo, 'desktop', 'tests', 'ApiClientLocalContractTests.cjs')]);
  run('AI followup startup recovery', [path.join(repo, 'desktop', 'tests', 'AiFollowupStartupRecoveryTests.cjs')]);
  run('AI credential DPAPI persistence', [
    'run',
    '--project',
    path.join(repo, 'desktop', 'tests', 'AiBridgeCredentialRuntime', 'AiBridgeCredentialRuntime.csproj'),
    '-c',
    'Release',
    '--no-restore',
  ], { command: path.join(repo, '.tools', 'dotnet10', 'dotnet.exe') });
  run('AI provider 503 recovery and model fallback', [
    'run',
    '--project',
    path.join(repo, 'desktop', 'tests', 'AiBridgeProviderRuntime', 'AiBridgeProviderRuntime.csproj'),
    '-c',
    'Release',
    '--no-restore',
  ], { command: path.join(repo, '.tools', 'dotnet10', 'dotnet.exe') });
  run('WS runtime login detection and ingest resilience', [path.join(repo, 'desktop', 'tests', 'WsRuntimeResilienceTests.cjs')]);
  run('desktop responsive contract', [path.join(repo, 'desktop', 'tests', 'DesktopResponsiveContractTests.cjs')]);
  run('desktop icon contract', [path.join(repo, 'tests', 'desktop-icon-contract.test.cjs')]);
  run('customer governance core', [path.join(repo, 'tests', 'customer-governance-core.test.cjs')]);
  run('business rule baseline and compatibility migration', [path.join(repo, 'tests', 'business-rule-core.test.cjs')]);
  run('business P1 batching, source subtype, ledger rollback and import rollback', [path.join(repo, 'tests', 'business-p1-regression.test.cjs')]);
  run('customer governance API', [path.join(repo, 'tests', 'customer-governance-api.test.cjs')]);
  run('customer governance UI', [path.join(repo, 'tests', 'customer-governance-ui.test.cjs')]);
  run('settings option synchronization', [path.join(repo, 'tests', 'settings-option-sync.test.cjs')]);
  run('cross-workspace business chain', [path.join(repo, 'tests', 'cross-workspace-chain-contract.test.cjs')]);
  runWs();
  run('operations core', [path.join(repo, 'tests', 'operations-core.test.cjs')]);
  run('operations task center UI contract', [path.join(repo, 'tests', 'operations-ui-contract.test.cjs')]);
  run('operations and stage-board 6.0 workspace', [path.join(repo, 'tests', 'operations-6-workspace-contract.test.cjs')]);
  run('group management malformed-data regression', [path.join(repo, 'tests', 'group-management-regression.test.cjs')]);
  run('smart import classification', [path.join(repo, 'tests', 'smart-import-classification.test.cjs')]);
  run('customer center registration date column', [path.join(repo, 'tests', 'customer-center-date-column.test.cjs')]);
  run('customer import routing (163 rows)', [path.join(repo, 'tests', 'customer-import-routing.test.cjs')]);
  run('ticket record separation', [path.join(repo, 'tests', 'ticket-record-separation.test.cjs')]);
  run('10k/50k performance scale', [path.join(repo, 'tests', 'performance-scale.test.cjs')]);
  run('desktop packaging contract', [path.join(repo, 'tests', 'desktop-packaging-contract.test.cjs')]);
  run('6.0 publish anti-rollback gate', [path.join(repo, 'tests', 'release-gate-contract.test.cjs')]);
  run('legacy Electron installation retirement', [path.join(repo, 'tests', 'legacy-install-retirement.test.cjs')]);
  run('release output single-version contract', [path.join(repo, 'tests', 'release-output-only-6.0.test.cjs')]);
  run('desktop reminders and automatic backup contract', [path.join(repo, 'tests', 'desktop-tools-contract.test.cjs')]);
  run('retired runtime removal contract', [path.join(repo, 'tests', 'docker-removal-contract.test.cjs')]);
  run('HTTP asset smoke', [path.join(repo, 'tests', 'upgrade-http-smoke.test.cjs'), app]);
  run('static assets contract', [path.join(repo, 'tests', 'static-assets-contract.test.cjs')]);
  run('CSS cleanup contract', [path.join(repo, 'tests', 'css-cleanup-contract.test.cjs')]);
  run('sidebar scroll contract', [path.join(repo, 'tests', 'sidebar-scroll-contract.test.cjs')]);
  run('release 6.0 consistency', [path.join(repo, 'tests', 'release-6.0-consistency.test.cjs')]);
  run('current docs consistency', [path.join(repo, 'tests', 'current-docs-consistency.test.cjs')]);
  run('session persistence contract', [path.join(repo, 'tests', 'session-persistence-contract.test.cjs')]);
  run('backup and restore drill', [path.join(repo, 'tests', 'backup-restore-drill.cjs'), app]);
  run('project audit regression', [
    path.join(repo, 'tests', 'project-audit-regression.test.cjs'),
    path.join(app, 'app.js'),
    path.join(app, 'server.mjs'),
    path.join(app, 'index.html'),
    path.join(app, 'package.json'),
    path.join(repo, 'zhike-desktop-setup.iss'),
    path.join(app, 'README.md'),
  ]);
}

function runInstaller() {
  run('WinUI packaging contract', [path.join(repo, 'tests', 'desktop-packaging-contract.test.cjs')]);
  run('WinUI 6.0 publish anti-rollback gate', [path.join(repo, 'tests', 'release-gate-contract.test.cjs')]);
  run('WinUI legacy installation retirement', [path.join(repo, 'tests', 'legacy-install-retirement.test.cjs')]);
  run('WinUI release output single-version contract', [path.join(repo, 'tests', 'release-output-only-6.0.test.cjs')]);
  run('WinUI isolated data-root contract', [path.join(repo, 'tests', 'data-root-compatibility.test.cjs')]);
  run('WinUI single runtime and route contract', [path.join(repo, 'tests', 'single-runtime-route-contract.test.cjs')]);
  run('WinUI icon contract', [path.join(repo, 'tests', 'desktop-icon-contract.test.cjs')]);
  run('WinUI desktop tools and cleanup contract', [path.join(repo, 'tests', 'desktop-tools-contract.test.cjs')]);
}

if (mode === 'ws') runWs();
else if (mode === 'all') runAll();
else runInstaller();

process.stdout.write(`\nCompleted ${results.length + failures.length} checks: ${results.length} passed, ${failures.length} failed.\n`);
if (failures.length) {
  for (const failure of failures) process.stderr.write(`- ${failure.label}: exit ${failure.status ?? 'spawn error'} ${failure.error}\n`);
  process.exitCode = 1;
}
