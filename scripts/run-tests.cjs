'use strict';

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const repo = path.resolve(__dirname, '..');
const app = path.join(repo, 'resources', 'app');
// The bundled runtime (resources/app/node.exe) is gitignored and only exists in
// packaged output. When running the suite from a source checkout, fall back to
// the Node.js binary executing this harness so child sidecars can still start.
const bundledNode = path.join(app, 'node.exe');
const testNode = fs.statSync(bundledNode, { throwIfNoEntry: false })?.isFile() ? bundledNode : process.execPath;
// Native compile/run suites default to `dotnet` on PATH. Source checkouts keep
// the SDK at .tools/dotnet10 (see CONTRIBUTING.md), so inject it when present.
const bundledDotnet = path.join(repo, '.tools', 'dotnet10', 'dotnet.exe');
const testDotnet = fs.statSync(bundledDotnet, { throwIfNoEntry: false })?.isFile() ? bundledDotnet : 'dotnet';
const mode = String(process.argv[2] || 'ws').toLowerCase();
const supported = new Set(['ws', 'all', 'installer', 'stage3', 'stage4', 'stage5', 'stage51', 'stage52', 'stage55a', 'stage55b', 'stage55c1a', 'delivery-s1', 'delivery-s2', 'delivery-s3', 'delivery-rd02']);
if (!supported.has(mode)) throw new Error(`unknown test mode: ${mode}; use ws, all, stage3, stage4, stage5, stage51, stage52, stage55a, stage55b, stage55c1a, delivery-s1, delivery-s2, delivery-s3, delivery-rd02 or installer`);

const failures = [];
const results = [];
const childEnvironment = { ...process.env };

function run(label, args, options = {}) {
  process.stdout.write(`\n[RUN] ${label}\n`);
  const result = spawnSync(options.command || process.execPath, args, {
    cwd: repo,
    env: {
      ...childEnvironment,
      ZHIKE_TEST_NODE: testNode,
      ZHIKE_TEST_DOTNET: testDotnet,
      ...options.env,
    },
    encoding: 'utf8',
    stdio: 'inherit',
    windowsHide: true,
    timeout: Number(options.timeout) || 120000,
  });
  const missingOutput = !result.error && result.status === 0 && options.requiredFile &&
    !fs.statSync(options.requiredFile, { throwIfNoEntry: false })?.isFile();
  if (result.error || result.status !== 0 || missingOutput) {
    failures.push({
      label,
      status: missingOutput ? 1 : result.status,
      error: missingOutput ? 'Expected build output missing: ' + options.requiredFile : result.error?.message || '',
    });
    process.stderr.write(`[FAIL] ${label}\n`);
    return false;
  }
  results.push(label);
  process.stdout.write(`[PASS] ${label}\n`);
  return true;
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

function runStage3(options = {}) {
  if (options.includeSyntax) runSyntax();
  run('Stage 3 group feature flags', [path.join(repo, 'scripts', 'stage3', 'worker-group-flags.test.cjs')]);
  run('Stage 3 Worker and group-manager isolation gate', [path.join(repo, 'scripts', 'stage3', 'worker-group-isolation.test.cjs')]);
  run('Stage 3 group manager migration', [path.join(repo, 'scripts', 'stage3', 'ws-group-manager-migration.test.cjs')]);
  run('Stage 3 group manager core', [path.join(repo, 'scripts', 'stage3', 'ws-group-manager.test.cjs')]);
  run('Stage 3 group manager isolated API and Mock Transport', [path.join(repo, 'scripts', 'stage3', 'ws-group-manager-api.test.cjs')], { timeout: 180000 });
  run('Production group manager local data and account isolation', [path.join(repo, 'tests', 'ws-group-manager-production.test.cjs')], { timeout: 180000 });
  run('WS ingest purpose and group evidence', [path.join(repo, 'tests', 'ws-ingest-workspace-mode.test.cjs')]);
  run('WS AI execution queue eligibility', [path.join(repo, 'tests', 'ws-ai-queue-workspace-mode.test.cjs')]);
  run('WS AI account purpose and member evidence', [path.join(repo, 'tests', 'ws-ai-workspace-mode.test.cjs')]);
  run('WS automated AI authorization and cost reservation', [path.join(repo, 'tests', 'ws-ai-authorization-budget.test.cjs')], { timeout: 180000 });
  run('Native WS capture authority and server evidence', [path.join(repo, 'tests', 'ws-native-write-authority-core.test.cjs')]);
  run('Native WS capture authority over loopback', [path.join(repo, 'tests', 'ws-native-write-authority.test.cjs')]);
  run('Native WS collector purpose and group evidence', [path.join(repo, 'tests', 'ws-native-purpose-policy.test.cjs')]);
  run('Dedicated WS group message draft editor', [path.join(repo, 'tests', 'ws-group-drafts-ui.test.cjs')]);
  run('WS unsent reply recovery across account changes', [path.join(repo, 'tests', 'ws-reply-draft-recovery-runtime.test.cjs')]);
  run('Dedicated group permissions and mention capabilities', [path.join(repo, 'tests', 'ws-group-permission-pages.test.cjs')]);
  run('Dedicated WS local group reading history', [path.join(repo, 'tests', 'ws-group-reading-workspace.test.cjs')]);
  run('Dedicated WS group drafts and cancellation', [path.join(repo, 'tests', 'ws-group-drafts-api.test.cjs')]);
  run('Dedicated WS group draft backup account transaction', [path.join(repo, 'tests', 'ws-group-drafts-backup.test.cjs')]);
  run('Dedicated WS draft merge and workspace restore failure', [path.join(repo, 'tests', 'ws-group-drafts-restore-core.test.cjs')]);
  run('WS account purpose operations', [path.join(repo, 'tests', 'ws-workspace-policy.test.cjs')]);
  run('WS account purpose in group monitor writes', [path.join(repo, 'tests', 'ws-group-monitor-workspace-mode.test.cjs')]);
  run('WS group monitor identity and paused-profile safety', [path.join(repo, 'tests', 'ws-group-monitor-identity-safety.test.cjs')], { timeout: 180000 });
  run('WS contact exclusion platform', [path.join(repo, 'tests', 'ws-contact-exclusion.test.cjs')]);
  run('WS contact exclusion identity and migration safety', [path.join(repo, 'tests', 'ws-contact-exclusion-safety.test.cjs')]);
  run('WS contact exclusion API and production gate', [path.join(repo, 'tests', 'ws-contact-exclusion-api.test.cjs')], { timeout: 180000 });
  run('WS contact exclusion page contract', [path.join(repo, 'tests', 'ws-contact-exclusion-ui.test.cjs')]);
  run('WS reply draft persistence', [path.join(repo, 'tests', 'ws-reply-draft-persistence.test.cjs')]);
  run('Stage 3 WS workspace navigation', [path.join(repo, 'scripts', 'stage3', 'ws-workbench-navigation.test.cjs')]);
}

function runStage4(options = {}) {
  if (options.includeSyntax) runSyntax();
  run('Stage 4 AI job pipeline core', [path.join(repo, 'scripts', 'stage4', 'ai-job-pipeline-core.test.cjs')]);
  run('Stage 4 CRM suggestion core', [path.join(repo, 'scripts', 'stage4', 'ai-crm-suggestion-core.test.cjs')]);
  run('Stage 4 migration and schema', [path.join(repo, 'scripts', 'stage4', 'ai-pipeline-migration.test.cjs')]);
  run('Stage 4 Worker AI flags', [path.join(repo, 'scripts', 'stage4', 'worker-ai-flags.test.cjs')]);
  run('Stage 4 Mock AI provider', [path.join(repo, 'scripts', 'stage4', 'ai-mock-provider.test.cjs')]);
  run('Stage 4 AI review center UI', [path.join(repo, 'scripts', 'stage4', 'ai-review-center-ui.test.cjs')]);
  run('Stage 4 desktop ApiClient queue and CRM contract', [path.join(repo, 'scripts', 'stage4', 'api-client-stage4-contract.test.cjs')]);
  run('Stage 4 isolated AI pipeline API', [path.join(repo, 'scripts', 'stage4', 'ai-pipeline-api.test.cjs')], { timeout: 240000 });
}

function runStage5(options = {}) {
  run('Stage 5 baseline', [path.join(repo, 'scripts', 'stage5', 'stage5-baseline.test.cjs')]);
  run('Stage 5 WS workspace pages', [path.join(repo, 'scripts', 'stage5', 'ws-workspace-pages.test.cjs')]);
  run('Stage 5 business integration', [path.join(repo, 'scripts', 'stage5', 'business-integration.test.cjs')], { timeout: 240000 });
  run('Fresh database atomic initialization and recovery', [path.join(repo, 'scripts', 'stage1', 'migration-runner-fresh-atomic.test.cjs')]);
  run('Stage 5 migration drill', [path.join(repo, 'scripts', 'stage5', 'migration-drill.test.cjs')], { timeout: 180000 });
  run('Stage 5 backup and restore drill', [path.join(repo, 'scripts', 'stage5', 'backup-restore-drill.test.cjs')], { timeout: 180000 });
  run('Stage 5 Worker security and performance', [path.join(repo, 'scripts', 'stage5', 'worker-security-performance.test.cjs')]);
  run('Stage 5 UI automation contract', [path.join(repo, 'scripts', 'stage5', 'ui-automation-contract.test.cjs')]);
  run('Stage 5 review center runtime', [path.join(repo, 'scripts', 'stage5', 'ai-review-runtime.test.cjs')]);
  run('Stage 5 indexed business data performance', [path.join(repo, 'scripts', 'stage5', 'performance.test.cjs')], { timeout: 120000 });
}

function runStage51() {
  run('S3 isolated native input probe provenance and bounds', [path.join(repo, 'scripts/stage51/native-input-probe.test.cjs')]);
  run('Stage 5.1 real workspace collapsed layout', [path.join(repo, 'scripts/stage51/workspace-layout.test.cjs')], { timeout: 120000 });
  run('Stage 5.1 historical 024 compatibility and real startup', [path.join(repo, 'scripts/stage51/checksum-compatibility.test.cjs')], { timeout: 300000 });
  run('Stage 5.1 isolated native entry safety', [path.join(repo, 'scripts/stage51/native-isolation.test.cjs')], { timeout: 120000 });
  run('Stage 5.1 Worker lifecycle resource observation', [path.join(repo, 'scripts/stage51/resource-worker-regression.test.cjs')], { timeout: 120000 });
  run('Stage 5.1 real member API and account-scoped UI binding', [path.join(repo, 'scripts/stage51/members-binding.test.cjs')], { timeout: 180000 });
  run('Stage 5.1 review actions through real isolated service', [path.join(repo, 'scripts/stage51/ai-review-service-ui.test.cjs')], { timeout: 180000 });
  run('Stage 5.1 workspace wheel ownership and navigation restoration', [path.join(repo, 'tests/scroll-coordinator-runtime.test.cjs')]);
  run('Stage 5.1 resource observer process identity safety', ['-NoProfile', '-File', path.join(repo, 'scripts/stage51/resource-observer-safety.test.ps1')], { command: 'pwsh.exe', timeout: 120000 });
  run('Stage 5.1 sidecar readiness without UI pump and bounded shutdown', [path.join(repo, 'scripts/stage51/native-readiness.test.cjs')], { timeout: 120000 });
}

function runStage52() {
  run('S3 isolated readiness probe startup and trusted-input timing', [path.join(repo, 'scripts/stage52/resource-readiness-probe.test.cjs')]);
  run('S3 continuous resources and observed child exit tail', ['-NoProfile', '-File', path.join(repo, 'scripts/stage52/resource-continuous.test.ps1'), '-NodePath', testNode], { command: 'pwsh.exe', timeout: 120000 });
  run('Stage 5.2 Worker real pipe IO deadlines and recovery', [path.join(repo, 'scripts', 'stage52', 'worker-io-boundaries.test.cjs')]);
  run('Stage 5.2 navigation cancellation and bounded session recovery', [path.join(repo, 'scripts/stage52/navigation-lifecycle.test.cjs')], { timeout: 120000 });
}

function runStage55a(options = {}) {
  if (options.includeExisting) {
    run('Stage 5.5A twelve-page UI and scoped group table', [path.join(repo, 'scripts/stage5/ws-workspace-pages.test.cjs')]);
    run('Stage 5.5A UI actions and real bridge response contract', [path.join(repo, 'scripts/stage5/ui-automation-contract.test.cjs')]);
    run('Stage 5.5A main sidebar preservation', [path.join(repo, 'tests/sidebar-ws-route-runtime.test.cjs')]);
    run('Stage 5.5A six effective-viewport computed layout', [path.join(repo, 'scripts/stage51/workspace-layout.test.cjs')]);
  }
  run('Stage 5.5A same-window presentation and exact restoration', ['run', '--project', path.join(repo, 'desktop/tests/WorkspaceWindowPresentationRuntime/WorkspaceWindowPresentationRuntime.csproj'), '-c', 'Release'], { command: path.join(repo, '.tools/dotnet10/dotnet.exe') });
  run('Stage 5.5A account switch monitor request ownership', [path.join(repo, 'tests/ws-group-monitor-account-race.test.cjs')]);
  run('Stage 5.5A reply copy uses real native acknowledgement', [path.join(repo, 'tests/ws-reply-copy-runtime.test.cjs')]);
}

function runStage55b() {
  run('Stage 5.5B read-only contacts and authoritative audit queries', [path.join(repo, 'scripts/stage55b/workspace-queries.test.cjs')]);
  run('Stage 5.5B business pages and scoped async ownership', [path.join(repo, 'scripts/stage55b/business-pages-runtime.test.cjs')]);
  run('Stage 5.5B existing GPT settings from WS', [path.join(repo, 'scripts/stage55b/gpt-settings-runtime.test.cjs')]);
}

function runDeliveryS1() {
  run('Isolated visual aggregation rejects stale host builds and focused runs', [path.join(repo, 'tests/isolated-visual-aggregator.test.cjs')]);
  run('Native WebView2 isolated renderer protocol and strict matrix contract', [path.join(repo, 'tests/isolated-webview-protocol.test.cjs')]);
  if ((process.env.ZHIKE_VISUAL_BACKEND || 'webview2') === 'webview2') {
    run('Native WebView2 controller normal exit and blocked network resource', [path.join(repo, 'tests/isolated-webview-native.test.cjs')]);
  }
  run('Visual customer column minimum and preference compatibility', [path.join(repo, 'tests/customer-column-width-runtime.test.cjs')]);
  run('Visual shared Unicode avatar and safe image fallback', [path.join(repo, 'tests/customer-avatar-runtime.test.cjs')]);
  run('Visual customer 360 real-data and retained action contract', [path.join(repo, 'tests/customer-360-visual-contract.test.cjs')]);
  run('Visual WS avatar presentation and account scope', [path.join(repo, 'tests/ws-avatar-presentation.test.cjs')]);
  run('Delivery S1 isolated browser process ownership and safe release', [path.join(repo, 'tests/isolated-edge-runner-lifecycle.test.cjs')]);
  run('Delivery isolated browser transport acknowledgement and release', [path.join(repo, 'tests/isolated-edge-transport.test.cjs')]);
  run('Delivery S1 actual workspace shell and preference rollback', [path.join(repo, 'tests/delivery-s1-workspace-shell-runtime.test.cjs')]);
  run('Delivery S1 native wheel gestures and modal ownership', [path.join(repo, 'tests/delivery-s1-scroll-gestures-runtime.test.cjs')]);
  run('Delivery S1 actual main renderers and shared design system', [path.join(repo, 'scripts/delivery/s1-main-visual.test.cjs')], { timeout: 180000 });
  run('Delivery S1 WS computed layout and retained host', [path.join(repo, 'scripts/delivery/s1-ws-visual.test.cjs')], { timeout: 180000 });
}

function runDeliveryS2() {
  run('Delivery S2 authoritative read-only metrics projection', [path.join(repo, 'tests/delivery-s2-metrics-projection.test.cjs')]);
  run('Delivery S2 safe and bounded accessible charts', [path.join(repo, 'tests/delivery-s2-metrics-charts.test.cjs')]);
  run('Delivery S2 actual shipped CSS and accessible chart rendering', [path.join(repo, 'scripts/delivery/s2-metrics-visual.test.cjs')], { timeout: 180000 });
}

function runDeliveryS3() {
  run('Delivery isolated Native XBF preflight rejects malformed build resources', [path.join(repo, 'scripts/stage51/native-prepare-preflight.test.cjs')]);
  run('Delivery S3 customer history identity and stale-response ownership', [path.join(repo, 'tests/delivery-s3-customer-identity.test.cjs')]);
  run('Delivery S3 actual core page renderers and preserved operations', [path.join(repo, 'tests/delivery-s3-core-pages.test.cjs')]);
  run('Delivery S3 stage movement persistence and isolated task boundaries', [path.join(repo, 'tests/delivery-s3-operations-runtime.test.cjs')]);
  run('Delivery S3 full-CSS customer table, drawer and modal ownership', [path.join(repo, 'scripts/delivery/s3-customer-table-visual.test.cjs')], { timeout: 180000 });
}

function runDeliveryRd02() {
  run('RD02 actual Native authenticated-profile and hidden-collector boundary', [path.join(repo, 'tests/rd02-authenticated-profile-boundary.test.cjs')]);
  run('RD02 WS blocked collection capability and preserved foreground actions', [path.join(repo, 'tests/delivery-rd02-ws-capability.test.cjs')]);
  run('Independent collector login, status, controls and manual AI boundary', [path.join(repo, 'tests/ws-independent-collector-runtime.test.cjs')]);
}

function runStage55c1a(options = {}) {
  run('Stage 5.5C-1A real isolated send/media/AI risk API', [path.join(repo, 'tests/stage55c-send-media-api.test.cjs')], { timeout: 180000 });
  run('Stage 5.5C-1A send UI evidence and async ownership', [path.join(repo, 'scripts/stage55c1a/ws-send-runtime.test.cjs')]);
  run('Stage 5.5C-1A production native send qualification', [path.join(repo, 'scripts/stage55c/native-send-safety.test.cjs')]);
  run('Stage 5.5C-1A actual send DOM and bridge outcomes', [path.join(repo, 'scripts/stage55c/native-send-dom.test.cjs')]);
  if (options.includeCredentials !== false) run('Stage 5.5C-1A DPAPI corruption and process-safe mutation', [
    'run', '--project', path.join(repo, 'desktop/tests/AiBridgeCredentialRuntime/AiBridgeCredentialRuntime.csproj'), '-c', 'Release',
  ], { command: path.join(repo, '.tools/dotnet10/dotnet.exe') });
  run('Stage 5.5C-1A provider modal generation and stale responses', [path.join(repo, 'scripts/stage55c/gpt-provider-race-runtime.test.cjs')]);
}

function runWs() {
  runSyntax();
  run('WS secondary index recovery and WAL-consistent snapshot', [path.join(repo, 'tests', 'ws-index-recovery.test.cjs')]);
  runStage3();
  runStage4();
  run('WS core rules', [path.join(repo, 'tests', 'ws-workbench-core.test.cjs')]);
  run('WS customer group reading query and evidence boundaries', [path.join(repo, 'tests', 'ws-customer-reading-query.test.cjs')]);
  run('WS isolated group reading routes and UI account lifetime', [path.join(repo, 'tests', 'ws-group-reading-isolated.test.cjs')]);
  run('WS direct-only collection and AI policy', [path.join(repo, 'tests', 'ws-direct-only-policy.test.cjs')]);
  run('WS VIP member task and alert isolation', [path.join(repo, 'tests', 'ws-vip-member-alerts.test.cjs')]);
  run('WS and GPT Horizon visual reachability', [path.join(repo, 'tests', 'ws-gpt-horizon-visual.test.cjs')]);
  run('V4.1 layered visual contrast regression', [path.join(repo, 'tests', 'ws-visual-alpha-composition.test.cjs')]);
  run('WS AI CRM sync rules', [path.join(repo, 'tests', 'ws-crm-sync-core.test.cjs')]);
  run('WS unified customer archive UI contract', [path.join(repo, 'tests', 'ws-hot-chat-profile-ui.test.cjs')]);
  run('WS CRM customer-link trust boundary', [path.join(repo, 'tests', 'ws-crm-link-trust.test.cjs')]);
  run('WS workbench initialization', [path.join(repo, 'tests', 'ws-workbench-init.test.cjs')]);
  run('WS native account registration consistency', [path.join(repo, 'tests', 'ws-native-account-registration.test.cjs')]);
  run('WS account metrics native observation boundaries', [path.join(repo, 'tests', 'ws-account-metrics-native.test.cjs')]);
  run('WS account metrics ordinary/dedicated presentation', [path.join(repo, 'tests', 'ws-account-metrics-ui.test.cjs')]);
  run('WS account purpose migration and backup restoration', [path.join(repo, 'tests', 'ws-account-workspace-mode.test.cjs')], { timeout: 180000 });
  run('WS ordinary and dedicated workspace isolation', [path.join(repo, 'tests', 'ws-workspace-mode-ui.test.cjs')]);
  run('WS API and SQLite', [path.join(repo, 'tests', 'ws-workbench-api.test.cjs')]);
  run('WS export streaming contract', [path.join(repo, 'tests', 'ws-export-streaming-contract.test.cjs')]);
  run('WS export and media schema', [path.join(repo, 'tests', 'ws-export-media-schema.test.cjs')]);
  run('WS complete export and export jobs', [path.join(repo, 'tests', 'ws-export-complete.test.cjs')]);
  run('WS media staging and attachment broadcast', [path.join(repo, 'tests', 'ws-media-api.test.cjs')]);
  run('WS media send runtime contract', [path.join(repo, 'tests', 'ws-media-send-runtime.test.cjs')]);
  run('WS broadcast, translation and send audit', [path.join(repo, 'tests', 'ws-broadcast-translation.test.cjs')]);
  run('WS VIP customer and group-monitor scope separation', [path.join(repo, 'tests', 'vip-scope-separation.test.cjs')]);
  run('WS ordinary group authorization scope', [path.join(repo, 'tests', 'ws-group-scope-authorization.test.cjs')]);
  run('WS collector exact group authorization bridge', [path.join(repo, 'tests', 'ws-group-scope-bridge.test.cjs')]);
  run('WS conversation cursor pagination', [path.join(repo, 'tests', 'ws-conversation-pagination.test.cjs')]);
  run('WS conversation incremental watermark runtime', [path.join(repo, 'tests', 'ws-conversation-delta-runtime.test.cjs')]);
  run('WS list preview update', [path.join(repo, 'tests', 'ws-list-preview-update.test.cjs')]);
  run('WS follow-up chain dedupe and refresh', [path.join(repo, 'tests', 'ws-followup-chain.test.cjs')]);
  run('WS task lifecycle and multi-account history ingest', [path.join(repo, 'tests', 'ws-task-lifecycle.test.cjs')]);
  run('WS complete original text and backup roundtrip', [path.join(repo, 'tests', 'ws-original-text-roundtrip.test.cjs')]);
  run('WS intelligent follow-up strategy and CRM persistence', [path.join(repo, 'tests', 'ws-followup-intelligence.test.cjs')]);
  run('WS live refresh event contract', [path.join(repo, 'tests', 'ws-live-refresh-contract.test.cjs')]);
  run('WS non-blocking AI pump runtime', [path.join(repo, 'tests', 'ws-ai-pump-runtime.test.cjs')]);
  run('Home WS follow-up runtime', [path.join(repo, 'tests', 'home-ws-followups-runtime.test.cjs')]);
  run('WS SQLite v6 migration', [path.join(repo, 'tests', 'ws-workbench-migration-v6.test.cjs')]);
  run('WS external-id uniqueness migration', [path.join(repo, 'tests', 'ws-external-id-migration.test.cjs')]);
  run('WS local security contract', [path.join(repo, 'tests', 'ws-workbench-security.test.cjs')]);
  run('WS multi-account database isolation', [path.join(repo, 'tests', 'ws-multi-account.test.cjs')]);
  run('WS account runtime recovery', [path.join(repo, 'tests', 'ws-account-runtime-recovery.test.cjs')]);
  run('WS native collector async full-list scan contract', [path.join(repo, 'desktop', 'tests', 'WsCollectorScriptContractTests.cjs')]);
  run('WS native collector P0 durability contract', [path.join(repo, 'desktop', 'tests', 'WsCollectorP0ContractTests.cjs')]);
  run('WS native collector diagnostics contract', [path.join(repo, 'desktop', 'tests', 'WsCollectorDiagnosticsContractTests.cjs')]);
  run('WS native group monitor bridge contract', [path.join(repo, 'desktop', 'tests', 'WsGroupMonitorNativeContractTests.cjs')]);
  run('WS group monitor core', [path.join(repo, 'tests', 'ws-group-monitor-core.test.cjs')]);
  run('V4.1 opaque identities and atomic membership ledger', [path.join(repo, 'tests', 'v41-ws-capability-audit.test.cjs')]);
  run('WS group monitor migration', [path.join(repo, 'tests', 'ws-group-monitor-migration.test.cjs')]);
  run('WS group monitor sidecar API', [path.join(repo, 'tests', 'ws-group-monitor-api.test.cjs')]);
  run('WS group monitor ingest', [path.join(repo, 'tests', 'ws-group-monitor-ingest.test.cjs')]);
  run('WS customer group status projection', [path.join(repo, 'tests', 'customer-group-membership.test.cjs')]);
  run('WS customer group status projection runtime', [path.join(repo, 'tests', 'ws-group-status-projection-runtime.test.cjs')]);
  run('WS native background lifecycle and bounds contract', [path.join(repo, 'desktop', 'tests', 'WsBackgroundLifecycleContractTests.cjs')]);
  run('WS process runtime coordinator contract', [path.join(repo, 'desktop', 'tests', 'WsRuntimeCoordinatorContractTests.cjs')]);
  run('WS process WebView session pool contract', [path.join(repo, 'desktop', 'tests', 'WsProcessSessionPoolContractTests.cjs')]);
  run('WS process runtime coordinator scheduling', [
    'run', '--project', path.join(repo, 'desktop', 'tests', 'WsRuntimeCoordinatorRuntime', 'WsRuntimeCoordinatorRuntime.csproj'), '-c', 'Release',
  ], { command: path.join(repo, '.tools', 'dotnet10', 'dotnet.exe') });
  run('WS parent-route visibility runtime', [path.join(repo, 'desktop', 'tests', 'WsRouteVisibilityRuntimeTests.cjs')]);
  run('WS hidden native scheduler runtime', [path.join(repo, 'desktop', 'tests', 'WsHiddenBackgroundSchedulerRuntimeTests.cjs')]);
  run('WS native group exclusion runtime', [path.join(repo, 'desktop', 'tests', 'WsGroupExclusionRuntimeTests.cjs')]);
  run('WS native open-chat and preview identity evidence', [path.join(repo, 'desktop', 'tests', 'WsOpenGroupDiscoveryRuntimeTests.cjs')]);
  run('WS native conversation identity runtime', [path.join(repo, 'desktop', 'tests', 'WsConversationIdentityRuntimeTests.cjs')]);
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
  run('WS native collector foreground isolation runtime', [path.join(repo, 'desktop', 'tests', 'WsCollectorForegroundIsolationRuntimeTests.cjs')]);
  run('WS native media bridge contract', [path.join(repo, 'tests', 'WsMediaBridgeContractTests.cjs')]);
  run('WS unread skip contract', [path.join(repo, 'desktop', 'tests', 'WsUnreadSkipContractTests.cjs')]);
  run('WS strict unread detection runtime', [path.join(repo, 'desktop', 'tests', 'WsUnreadDetectionRuntimeTests.cjs')]);
  run('WS read-history collector runtime', [path.join(repo, 'desktop', 'tests', 'WsReadHistoryCollectorRuntimeTests.cjs')]);
  run('WS ChatKnow UI contract', [path.join(repo, 'tests', 'ws-workbench-ui.test.cjs')]);
  run('WS group monitor UI contract', [path.join(repo, 'tests', 'ws-group-monitor-ui.test.cjs')]);
  run('WS group discovery contract', [path.join(repo, 'tests', 'ws-group-discovery-contract.test.cjs')]);
  run('WS broadcast and translation UI contract', [path.join(repo, 'tests', 'ws-broadcast-ui.test.cjs')]);
  run('WS collection and CRM sync contract', [path.join(repo, 'tests', 'ws-workbench-sync.test.cjs')]);
  run('WS complete per-customer history contract', [path.join(repo, 'tests', 'ws-full-history.test.cjs')]);
  run('WS chunked full-history AI and checkpoint contract', [path.join(repo, 'tests', 'ws-chunked-ai-analysis.test.cjs')]);
  run('WS durable AI queue contract', [path.join(repo, 'tests', 'ai-queue-contract.test.cjs')]);
  run('WS AI queue UI metrics contract', [path.join(repo, 'tests', 'ai-queue-ui-metrics-contract.test.cjs')]);
  run('WS resize performance contract', [path.join(repo, 'tests', 'ws-resize-performance-contract.test.cjs')]);
  run('WS frontend high-priority fixes', [path.join(repo, 'tests', 'frontend-high-priority-fixes.test.cjs')]);
  run('project stability and lifecycle contract', [path.join(repo, 'tests', 'project-stability-contract.test.cjs')]);
  run('WS 50k conversation list render budget', [path.join(repo, 'tests', 'ws-conversation-list-performance.test.cjs')]);
  run('WS bridge recovery contract', [path.join(repo, 'tests', 'ws-bridge-recovery-contract.test.cjs')]);
  run('WS scroll routing contract', [path.join(repo, 'tests', 'ws-scroll-routing-contract.test.cjs')]);
  run('WS A+ dual-layer layout contract', [path.join(repo, 'tests', 'ws-workbench-a-plus-layout.test.cjs')]);
  run('WS data archive customer bridge', [path.join(repo, 'tests', 'ws-data-archive-api.test.cjs')]);
  run('WS data archive summary bridge', [path.join(repo, 'tests', 'data-archive-summary.test.cjs')]);
  run('WS data archive UI bridge', [path.join(repo, 'tests', 'data-archive-ui.test.cjs')]);
  run('WS data archive drilldown UI', [path.join(repo, 'tests', 'data-archive-drilldown-ui.test.cjs')]);
  run('WS group catalog runtime', [path.join(repo, 'tests', 'ws-group-catalog-runtime.test.cjs')]);
  run('WS background isolation runtime', [path.join(repo, 'tests', 'ws-background-isolation.test.cjs')]);
  run('WS multi-account detection contract', [path.join(repo, 'tests', 'ws-multi-account-detection.test.cjs')]);
  run('WS migrated account timestamp wire compatibility', [path.join(repo, 'tests', 'ws-account-wire-timestamps.test.cjs')]);
  run('WS scroll stability contract', [path.join(repo, 'tests', 'ws-scroll-stability.test.cjs')]);
  run('WS assistant drawer runtime', [path.join(repo, 'tests', 'ws-assist-drawer-runtime.test.cjs')]);
  run('hot-chat profile API', [path.join(repo, 'tests', 'hot-chat-profile-api.test.cjs')]);
  run('hot-chat profile core', [path.join(repo, 'tests', 'hot-chat-profile-core.test.cjs')]);
  run('hot-chat profile migration', [path.join(repo, 'tests', 'hot-chat-profile-migration.test.cjs')]);
  run('request coalescer cancellation', [path.join(repo, 'tests', 'request-coalescer-cancellation.test.cjs')]);
  run('task6 stability contract', [path.join(repo, 'tests', 'task6-stability.test.cjs')]);
  run('desktop performance contract', [path.join(repo, 'tests', 'desktop-performance-contract.test.cjs')]);
  run('CRM phone index and archive diagnostics', [path.join(repo, 'tests', 'customer-phone-index.test.cjs')]);
  run('unified scroll system contract', [path.join(repo, 'tests', 'scroll-system-contract.test.cjs')]);
  run('unified scroll coordinator runtime', [path.join(repo, 'tests', 'scroll-coordinator-runtime.test.cjs')]);
  run('WS route sidebar policy runtime', [path.join(repo, 'tests', 'sidebar-ws-route-runtime.test.cjs')]);
  // Full regression already executes the expanded credential runtime once.
  runStage55c1a({ includeCredentials: false });
  runDeliveryRd02();
}

function runAll() {
  run('isolated app fixture safety', [path.join(repo, 'tests', 'isolated-app-fixture.test.cjs')]);
  run('6.0 no legacy data migration contract', [path.join(repo, 'tests', 'no-legacy-data-migration-contract.test.cjs')]);
  run('6.0 no legacy migration with delayed sidecar shutdown', [path.join(repo, 'tests', 'no-legacy-data-migration-contract.test.cjs'), '--delayed-shutdown']);
  run('backup integrity contract', [path.join(repo, 'tests', 'backup-integrity-contract.test.cjs')]);
  run('manual multi-account backup contract', [path.join(repo, 'tests', 'manual-backup-all-accounts.test.cjs')]);
  run('encrypted device package integrity and isolated extraction', [path.join(repo, 'tests', 'device-migration-package.test.cjs')]);
  run('device migration schema snapshot and compatibility projection', [path.join(repo, 'tests', 'device-migration-snapshot.test.cjs')]);
  // New suite performs several independent scrypt authenticated round-trips.
  // Its initial budget is separate from existing lifecycle/Edge deadlines.
  run('isolated v2 device envelope and exact compatibility', [path.join(repo, 'tests', 'device-migration-package-v2.test.cjs')], { timeout: 180000 });
  // New crash/crypto suite measured 149 seconds on Windows; existing test deadlines stay unchanged.
  run('isolated v2 generation restore, frozen recovery and publication faults', [path.join(repo, 'tests', 'device-migration-restore.test.cjs')], { timeout: 240000 });
  run('local-first sidecar contract', [path.join(repo, 'tests', 'local-first-sidecar-contract.test.cjs')]);
  run('isolated sidecar startup observation and redaction', [path.join(repo, 'tests', 'sidecar-startup-observer.test.cjs')]);
  run('test-only device migration and sidecar startup phase diagnostics', [path.join(repo, 'tests', 'test-only-phase-diagnostics-contract.test.cjs')]);
  run('WS local ingest runtime', [path.join(repo, 'tests', 'ws-local-ingest-runtime.test.cjs')]);
  run('WS direction effects repair runtime', [path.join(repo, 'tests', 'ws-direction-effects-repair.test.cjs')]);
  run('WS identity effects repair runtime', [path.join(repo, 'tests', 'ws-identity-effects-repair.test.cjs')]);
  run('WS unverified association-only scoped repair', [path.join(repo, 'tests', 'ws-unverified-association-repair.test.cjs')]);
  run('local service manager contract', [path.join(repo, 'desktop', 'tests', 'LocalServiceManagerContractTests.cjs')]);
  run('native window DPI-aware minimum bounds', [path.join(repo, 'tests', 'native-window-minimum-contract.test.cjs')]);
  run('resource lifecycle contract', [path.join(repo, 'desktop', 'tests', 'ResourceLifecycleContractTests.cjs')]);
  run('local service hang recovery', [path.join(repo, 'desktop', 'tests', 'LocalServiceRecoveryTests.cjs')]);
  run('local service port race regression', [path.join(repo, 'tests', 'local-service-port-race-regression.test.cjs')]);
  run('local bridge contract', [path.join(repo, 'desktop', 'tests', 'LocalBridgeContractTests.cjs')]);
  run('design system contract', [path.join(repo, 'tests', 'design-system-contract.test.cjs')]);
  run('Horizon Atelier 6.0 dynamic UI contract', [path.join(repo, 'tests', 'horizon-atelier-contract.test.cjs')]);
  run('Horizon Atelier AI alert ordering', [path.join(repo, 'tests', 'home-horizon-alert-order.test.cjs')]);
  run('GPT Horizon 6.0 workspace contract', [path.join(repo, 'tests', 'gpt-horizon-workspace.test.cjs')]);
  run('GPT plan confirmations, session cancellation and scoped analytics', [path.join(repo, 'tests', 'gpt-assistant-session.test.cjs')]);
  run('Horizon Atelier governance/settings UI contract', [path.join(repo, 'tests', 'governance-horizon-contract.test.cjs')]);
  run('6.0 linked business workspace shell', [path.join(repo, 'tests', 'business-6-shell-contract.test.cjs')]);
  run('6.0 global Horizon visual finish', [path.join(repo, 'tests', 'global-6-visual-contract.test.cjs')]);
  run('save error regression', [path.join(repo, 'tests', 'save-error-regression.test.cjs')]);
  run('snapshot before write regression', [path.join(repo, 'tests', 'snapshot-before-write-regression.test.cjs')]);
  run('local health contract', [path.join(repo, 'tests', 'local-health-contract.test.cjs')]);
  run('database diagnostic validity and asynchronous log route ownership', [path.join(repo, 'tests', 'v4-data-center-status-routing.test.cjs')]);
  run('registration export scope and truthful analytics presentation', [path.join(repo, 'tests', 'registration-analytics-presentation.test.cjs')]);
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
  ], { command: path.join(repo, '.tools', 'dotnet10', 'dotnet.exe') });
  run('AI provider 503 recovery and model fallback', [
    'run',
    '--project',
    path.join(repo, 'desktop', 'tests', 'AiBridgeProviderRuntime', 'AiBridgeProviderRuntime.csproj'),
    '-c',
    'Release',
  ], { command: path.join(repo, '.tools', 'dotnet10', 'dotnet.exe') });
  run('AI provider health and retry contract', [path.join(repo, 'tests', 'ai-provider-health-contract.test.cjs')]);
  run('WS runtime login detection and ingest resilience', [path.join(repo, 'desktop', 'tests', 'WsRuntimeResilienceTests.cjs')]);
  run('desktop responsive contract', [path.join(repo, 'desktop', 'tests', 'DesktopResponsiveContractTests.cjs')]);
  run('desktop icon contract', [path.join(repo, 'tests', 'desktop-icon-contract.test.cjs')]);
  run('customer governance core', [path.join(repo, 'tests', 'customer-governance-core.test.cjs')]);
  run('business rule baseline and compatibility migration', [path.join(repo, 'tests', 'business-rule-core.test.cjs')]);
  run('business P1 batching, source subtype, ledger rollback and import rollback', [path.join(repo, 'tests', 'business-p1-regression.test.cjs')]);
  run('customer governance API', [path.join(repo, 'tests', 'customer-governance-api.test.cjs')]);
  run('customer purge completeness', [path.join(repo, 'tests', 'customer-purge-completeness.test.cjs')]);
  run('customer governance UI', [path.join(repo, 'tests', 'customer-governance-ui.test.cjs')]);
  run('settings option synchronization', [path.join(repo, 'tests', 'settings-option-sync.test.cjs')]);
  run('cross-workspace business chain', [path.join(repo, 'tests', 'cross-workspace-chain-contract.test.cjs')]);
  run('stage 1.5 queue compatibility review', [path.join(repo, 'scripts', 'stage1', 'stage1-5-queue-compatibility.test.cjs')]);
  run('stage 1.5 IPC real WinUI supervisor integration', [
    'run', '--project', path.join(repo, 'scripts', 'stage1', 'WorkerSupervisorRuntime', 'WorkerSupervisorRuntime.csproj'), '-c', 'Release',
  ], { command: path.join(repo, '.tools', 'dotnet10', 'dotnet.exe') });
  run('stage 1.5 sidecar fencing real writer integration', [path.join(repo, 'scripts', 'stage1', 'sqlite-fencing-sidecar-integration.test.cjs')]);
  run('stage 1.5 fencing failure and BUSY recovery', [path.join(repo, 'scripts', 'stage1', 'sqlite-fencing-coordinator-failure.test.cjs')]);
  run('stage 2 controlled worker fencing gate', [path.join(repo, 'scripts', 'stage2', 'worker-fencing-gate.test.cjs')]);
  run('stage 2 read-only legacy queue adapter', [path.join(repo, 'scripts', 'stage2', 'worker-queue-adapter.test.cjs')]);
  run('stage 2 controlled Worker lifecycle integration', [path.join(repo, 'scripts', 'stage2', 'worker-controlled-integration.test.cjs')]);
  run('stage 2 Worker feature flags', [path.join(repo, 'scripts', 'stage2', 'worker-feature-flags.test.cjs')]);
  run('stage 2 Worker disabled-path integration', [path.join(repo, 'scripts', 'stage2', 'worker-runtime-disabled.test.cjs')]);
  runWs();
  runStage5();
  runStage51();
  runStage52();
  runStage55a();
  runStage55b();
  runDeliveryS1();
  runDeliveryS2();
  runDeliveryS3();
  run('operations core', [path.join(repo, 'tests', 'operations-core.test.cjs')]);
  run('operations task center UI contract', [path.join(repo, 'tests', 'operations-ui-contract.test.cjs')]);
  run('operations and stage-board 6.0 workspace', [path.join(repo, 'tests', 'operations-6-workspace-contract.test.cjs')]);
  run('group management malformed-data regression', [path.join(repo, 'tests', 'group-management-regression.test.cjs')]);
  run('group configured-channel runtime separation', [path.join(repo, 'tests', 'group-channel-runtime.test.cjs')]);
  run('group summary server event link', [path.join(repo, 'tests', 'group-summary-server-link.test.cjs')]);
  run('smart import classification', [path.join(repo, 'tests', 'smart-import-classification.test.cjs')]);
  run('customer center registration date column', [path.join(repo, 'tests', 'customer-center-date-column.test.cjs')]);
  run('customer import routing (163 rows)', [path.join(repo, 'tests', 'customer-import-routing.test.cjs')]);
  run('phone registry file import', [path.join(repo, 'tests', 'phone-registry-import.test.cjs')]);
  run('ticket record separation', [path.join(repo, 'tests', 'ticket-record-separation.test.cjs')]);
  run('10k/50k performance scale', [path.join(repo, 'tests', 'performance-scale.test.cjs')]);
  run('50k customer list cached ordering budget', [path.join(repo, 'tests', 'customer-list-performance-contract.test.cjs')]);
  run('50k analytics aggregation budget', [path.join(repo, 'tests', 'analytics-performance-contract.test.cjs')]);
  run('desktop packaging contract', [path.join(repo, 'tests', 'desktop-packaging-contract.test.cjs')]);
  run('GitHub prerelease draft recovery guards', [path.join(repo, 'tests', 'github-prerelease-resume-guards.test.cjs')]);
  run('Previous Windows installer upgrade verification', [path.join(repo, 'tests', 'previous-installer-upgrade.test.cjs')]);
  run('6.0 publish anti-rollback gate', [path.join(repo, 'tests', 'release-gate-contract.test.cjs')]);
  run('legacy Electron installation retirement', [path.join(repo, 'tests', 'legacy-install-retirement.test.cjs')]);
  run('release output single-version contract', [path.join(repo, 'tests', 'release-output-only-6.0.test.cjs')]);
  run('desktop reminders and automatic backup contract', [path.join(repo, 'tests', 'desktop-tools-contract.test.cjs')]);
  run('native backup retention runtime', [
    'run', '--project', path.join(repo, 'desktop', 'tests', 'BackupRetentionRuntime', 'BackupRetentionRuntime.csproj'), '-c', 'Release',
  ], { command: path.join(repo, '.tools', 'dotnet10', 'dotnet.exe') });
  run('native backup to browser restore roundtrip', [path.join(repo, 'tests', 'native-backup-restore.test.cjs')]);
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
  run('WinUI GitHub prerelease draft recovery guards', [path.join(repo, 'tests', 'github-prerelease-resume-guards.test.cjs')]);
  run('Previous Windows installer upgrade verification', [path.join(repo, 'tests', 'previous-installer-upgrade.test.cjs')]);
  run('WinUI 6.0 publish anti-rollback gate', [path.join(repo, 'tests', 'release-gate-contract.test.cjs')]);
  run('WinUI legacy installation retirement', [path.join(repo, 'tests', 'legacy-install-retirement.test.cjs')]);
  run('WinUI release output single-version contract', [path.join(repo, 'tests', 'release-output-only-6.0.test.cjs')]);
  run('WinUI isolated data-root contract', [path.join(repo, 'tests', 'data-root-compatibility.test.cjs')]);
  run('WinUI single runtime and route contract', [path.join(repo, 'tests', 'single-runtime-route-contract.test.cjs')]);
  run('WinUI icon contract', [path.join(repo, 'tests', 'desktop-icon-contract.test.cjs')]);
  run('WinUI desktop tools and cleanup contract', [path.join(repo, 'tests', 'desktop-tools-contract.test.cjs')]);
  run('WinUI native backup retention runtime', [
    'run', '--project', path.join(repo, 'desktop', 'tests', 'BackupRetentionRuntime', 'BackupRetentionRuntime.csproj'), '-c', 'Release',
  ], { command: path.join(repo, '.tools', 'dotnet10', 'dotnet.exe') });
  run('WinUI native backup to browser restore roundtrip', [path.join(repo, 'tests', 'native-backup-restore.test.cjs')]);
}

function prepareVisualHost() {
  if (!['all', 'stage51', 'stage55a', 'delivery-s1', 'delivery-s2', 'delivery-s3'].includes(mode)) return true;
  const env = process.env;
  const focusedOptions = [];
  if (['all', 'stage51', 'stage55a'].includes(mode) && env.ZHIKE_LAYOUT_CASE) focusedOptions.push('ZHIKE_LAYOUT_CASE');
  if (['all', 'delivery-s1'].includes(mode)) {
    if (env.ZHIKE_VISUAL_ONLY) focusedOptions.push('ZHIKE_VISUAL_ONLY');
    if (env.ZHIKE_VISUAL_SNAPSHOTS === '0') focusedOptions.push('ZHIKE_VISUAL_SNAPSHOTS=0');
    if (env.ZHIKE_GPT_VISUAL_ONLY === '1') focusedOptions.push('ZHIKE_GPT_VISUAL_ONLY=1');
  }
  if (['all', 'delivery-s3'].includes(mode) && env.ZHIKE_TABLE_CAPTURE_PALETTE) focusedOptions.push('ZHIKE_TABLE_CAPTURE_PALETTE');
  if (focusedOptions.length) {
    throw new Error('Remove focused visual options for the formal suite or run the individual diagnostic: ' + focusedOptions.join(', '));
  }

  const backend = env.ZHIKE_VISUAL_BACKEND || 'webview2';
  if (backend === 'edge') return true;
  if (backend !== 'webview2') throw new Error('Unsupported ZHIKE_VISUAL_BACKEND: ' + backend);
  if (process.platform !== 'win32') throw new Error('The WebView2 visual suite requires Windows.');

  const outputRoot = path.join(repo, '.tools', 'isolated-webview-host');
  fs.mkdirSync(outputRoot, { recursive: true });
  const output = fs.mkdtempSync(path.join(outputRoot, 'run-'));
  const host = path.join(output, 'IsolatedWebViewHost.exe');
  const built = run('Native WebView2 visual test host build', [
    'build', path.join(repo, 'tests/native/IsolatedWebViewHost/IsolatedWebViewHost.csproj'),
    '-c', 'Release', '-p:Platform=x64', '-r', 'win-x64',
    '-o', output, '--nologo', '-v:minimal',
  ], { command: path.join(repo, '.tools/dotnet10/dotnet.exe'), timeout: 180000, requiredFile: host });
  if (built) {
    // Windows treats environment names case-insensitively.
    for (const key of Object.keys(childEnvironment)) {
      if (key.toUpperCase() === 'ZHIKE_TEST_WEBVIEW_HOST') delete childEnvironment[key];
    }
    childEnvironment.ZHIKE_TEST_WEBVIEW_HOST = host;
  }
  return built;
}

if (prepareVisualHost()) {
  if (mode === 'ws') runWs();
  else if (mode === 'all') runAll();
  else if (mode === 'stage3') runStage3({ includeSyntax: true });
  else if (mode === 'stage4') runStage4({ includeSyntax: true });
  else if (mode === 'stage5') runStage5({ includeSyntax: true });
  else if (mode === 'stage51') runStage51();
  else if (mode === 'stage52') runStage52();
  else if (mode === 'stage55a') runStage55a({ includeExisting: true });
  else if (mode === 'stage55b') runStage55b();
  else if (mode === 'stage55c1a') runStage55c1a();
  else if (mode === 'delivery-s1') runDeliveryS1();
  else if (mode === 'delivery-s2') runDeliveryS2();
  else if (mode === 'delivery-s3') runDeliveryS3();
  else if (mode === 'delivery-rd02') runDeliveryRd02();
  else runInstaller();
}

process.stdout.write(`\nCompleted ${results.length + failures.length} checks: ${results.length} passed, ${failures.length} failed.\n`);
if (failures.length) {
  for (const failure of failures) process.stderr.write(`- ${failure.label}: exit ${failure.status ?? 'spawn error'} ${failure.error}\n`);
  process.exitCode = 1;
}
