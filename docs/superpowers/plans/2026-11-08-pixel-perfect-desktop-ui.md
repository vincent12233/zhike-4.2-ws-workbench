# 知客 5.1 原版页面体系复用与桌面 UI 重整 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不改变知客业务逻辑和数据口径的前提下，让 WinUI 3 桌面版复用原 Electron 页面体系，并提供稳定的原生 WS 连接器、完整路由、响应式窗口和可回退升级路径。

**Architecture:** WinUI 3 负责窗口生命周期、DPI、导航、窗口记忆、WS profile 和 Docker 服务探活；单一 `LegacyUiHost` WebView2 在桌面窗口内加载仓库中的 `resources/app`。版本化 desktop bridge 将原 Electron bridge/旧 `/api/*` 调用适配到 Docker API v2，PostgreSQL 仍是唯一权威数据源；现有简化 XAML 页面保留为逐路由 fallback。

**Tech Stack:** C#/.NET 10、WinUI 3/Windows App SDK 2.6.4、WebView2 1.0.3719.77、Node.js contract tests、Docker Compose、PostgreSQL、现有 Electron HTML/CSS/JS。

**Spec:** `docs/superpowers/specs/2026-11-08-pixel-perfect-desktop-ui-design.md`

## Global Constraints

- 当前 `main`/提交 `819cf0f` 和 `resources/app` 是唯一视觉与业务基线。
- WebView2 只嵌入桌面应用；不得把项目改成公网 Web SaaS。
- PostgreSQL/Docker API 是唯一权威数据源，不新增第二套 SQLite 权威库。
- 不保存密码、Cookie、二维码或秘密 Token；日志不得输出完整聊天原文和隐私字段。
- 820×540 必须可用；`>1150px` 三栏、`901–1150px` 缩窄、`651–900px` 右栏折叠+标签、`<=650px` 单栏。
- 壳层/导航/卡片/表格/WS 栅格感知差异目标不超过 2%，文本抗锯齿区域单独遮罩。
- 首屏壳层可交互 <=1.5s，普通路由切换 <=300ms（不含网络），WS WebView 首次挂载 <=3s。
- 实际业务数据不用于破坏性测试；测试使用隔离 PostgreSQL schema 和固定 fixture。

## Review Focus

- **旧页面直接调用缺失 bridge**：页面必须得到明确 `unsupported`/重试错误，不能显示假成功。由 Task 2 的 bridge contract tests 固定。
- **窗口缩放导致 WS 中栏不可达**：左右 rail/标签切换后中心 WebView 仍可见、可聚焦。由 Task 5 的 responsive tests 固定。
- **API 写入失败仍提示成功**：只有服务端幂等写入成功才更新页面状态。由 Task 2/Task 6 的 adapter 与回归测试固定。
- **升级后布局或 WS 会话丢失**：布局 JSON、配置和 profile 迁移失败时使用默认值而不删数据。由 Task 3/Task 7 的 upgrade tests 固定。
- **完整路由被临时演示页替代**：所有原版路由必须存在、可进入、可显示空/加载/错误态。由 Task 1/Task 4 的 route matrix tests 固定。

---

### Task 1: 冻结视觉、路由与兼容契约测试（先红灯）

**Files:**
- Create: `desktop/tests/DesktopVisualContractTests.cjs`
- Create: `desktop/tests/DesktopResponsiveContractTests.cjs`
- Create: `desktop/tests/LegacyBridgeContractTests.cjs`
- Create: `docs/compatibility-contract-v5.1.md`
- Modify: `desktop/tests/DesktopSmokeTests.cjs`
- Test fixtures: `tests/compatibility/legacy-golden-fixtures.json`

**Interfaces:**
- Produces route list `LEGACY_ROUTES` (the 21 `data-view` routes plus the separately wired `gptAssistantNav` route), token map `LEGACY_VISUAL_TOKENS`, breakpoint table `LEGACY_BREAKPOINTS` and bridge method/event table consumed by later tasks.
- `compatibility-contract-v5.1.md` defines old `/api/*`/IPC name, v2 endpoint, field mapping, error code, timeout, pagination and idempotency key.

- [ ] **Step 1: Write the failing route and visual tests**

  Assert the 21 `data-view` routes plus `gptAssistantNav` from `resources/app/index.html`, exact token values from `styles.css`/`v41-ui.css`, sidebar widths 244/68, topbar 57, WS columns 198–240 / 360+ / 300–360, and required empty/loading/error states.

- [ ] **Step 2: Write the failing responsive tests**

  Assert behavior at 820×540, 1024×768, 1366×768 and 125%/150% DPI, including both WS rail states, single scroll container, keyboard focus reachability and no horizontal overflow.

- [ ] **Step 3: Write the failing bridge contract tests**

  Assert every legacy bridge call used by `resources/app/app.js`, `preload.cjs` and WS modules has either an adapter row or an explicit `unsupported` response with `errorCode` and `requestId`.

- [ ] **Step 4: Run the new tests and verify they fail for the current WinUI shell**

  Run `node desktop/tests/DesktopVisualContractTests.cjs`, `node desktop/tests/DesktopResponsiveContractTests.cjs` and `node desktop/tests/LegacyBridgeContractTests.cjs`.
  Expected: FAIL with missing legacy routes/host/bridge, proving the tests protect the requested gap.

- [ ] **Step 5: Commit the red contract baseline**

  `git add desktop/tests docs/compatibility-contract-v5.1.md tests/compatibility/legacy-golden-fixtures.json && git commit -m "test: freeze legacy desktop visual and bridge contracts"`

### Task 2: 实现版本化 desktop bridge 与旧 API 适配层

**Files:**
- Create: `desktop/src/Zhike.Desktop/Services/DesktopBridgeService.cs`
- Create: `desktop/src/Zhike.Desktop/Services/LegacyApiAdapter.cs`
- Create: `desktop/src/Zhike.Desktop/Services/LegacyBridgeScript.cs`
- Create: `desktop/src/Zhike.Desktop/Services/BridgeContracts.cs`
- Modify: `desktop/src/Zhike.Desktop/Services/ApiClient.cs`
- Modify: `server/server-v2/*` only where the frozen contract requires a compatibility route
- Test: `desktop/tests/LegacyBridgeContractTests.cjs`, `tests/server-v2/api-contract.test.cjs`

**Interfaces:**
- `Task<BridgeResponse> DesktopBridgeService.InvokeAsync(string requestId, string method, JsonElement payload, CancellationToken cancellationToken)`.
- `Task<LegacyApiResponse> LegacyApiAdapter.SendAsync(string legacyPath, HttpMethod method, JsonElement? body, CancellationToken cancellationToken)`.
- `void DesktopBridgeService.Publish(string eventName, JsonElement payload)` for `ws.status`, `ws.message`, `ai.followup`, `sync.updated`.
- JavaScript surface: `window.zhikeDesktop.version`, `window.zhikeDesktop.invoke(method,payload)`, `window.zhikeDesktop.on(event,handler)`.

- [ ] **Step 1: Add failing adapter tests for mapping, timeout and idempotency**

  Cover `/api/state`, `/api/snapshot`, `/api/ws/*`, customer save, follow-up save and unsupported calls; assert original field names and no success result on HTTP failure.

- [ ] **Step 2: Implement typed bridge contracts and error envelope**

  Use `requestId`, `bridgeVersion`, `timeoutMs`, `accountId`; redact secrets in exception messages; map network/timeout/unsupported to stable error codes.

- [ ] **Step 3: Implement old-to-v2 adapter**

  Translate pagination, dates, ticket buy/sell identity, customer upsert and WS message idempotency without altering business rules. Keep API base URL and authentication in existing local/private configuration.

- [ ] **Step 4: Inject the bridge script into WebView2**

  Expose only the versioned surface and minimal legacy aliases; reject unknown methods instead of evaluating arbitrary native commands.

- [ ] **Step 5: Run adapter and server contract tests**

  Run `node desktop/tests/LegacyBridgeContractTests.cjs` and `node tests/server-v2/api-contract.test.cjs`.
  Expected: PASS with deterministic error envelopes and no sensitive values in captured logs.

- [ ] **Step 6: Commit the bridge**

  `git add desktop/src/Zhike.Desktop/Services server/server-v2 desktop/tests tests/server-v2 docs/compatibility-contract-v5.1.md && git commit -m "feat: add versioned legacy desktop bridge"`

### Task 3: 建立 LegacyUiHost 与桌面壳层

**Files:**
- Create: `desktop/src/Zhike.Desktop/Views/LegacyUiHostPage.xaml`
- Create: `desktop/src/Zhike.Desktop/Views/LegacyUiHostPage.xaml.cs`
- Create: `desktop/src/Zhike.Desktop/Services/LegacyUiHostService.cs`
- Modify: `desktop/src/Zhike.Desktop/MainWindow.xaml`
- Modify: `desktop/src/Zhike.Desktop/MainWindow.xaml.cs`
- Modify: `desktop/src/Zhike.Desktop/App.xaml`
- Modify: `desktop/src/Zhike.Desktop/Services/WindowLayoutService.cs`
- Test: `desktop/tests/DesktopSmokeTests.cjs`, `desktop/tests/DesktopResponsiveContractTests.cjs`

**Interfaces:**
- `Task NavigateRouteAsync(string route, CancellationToken cancellationToken)` on `LegacyUiHostPage`.
- `Task<bool> TryReloadAsync(CancellationToken cancellationToken)` and `Task<bool> TryFallbackAsync(string route)`.
- `WindowLayoutService.Restore(Window window, string layoutKey)` and `WindowLayoutService.Persist(Window window, string layoutKey)` use versioned JSON.

- [ ] **Step 1: Add failing host/shell tests**

  Assert `MainWindow` contains one host, legacy route map, fallback action, feature flag, and `SizeChanged`/closing hooks; assert no second vertical scroll container.

- [ ] **Step 2: Implement the WebView2 host**

  Use a fixed local virtual host for `resources/app`, wait for WebView2 initialization before navigation, show loading/error/retry states, and dispose event handlers on close.

- [ ] **Step 3: Replace the six-item navigation with the complete grouped route map**

  Keep native fallback pages tagged by the same route; preserve title/status pill, compact top bar and original sidebar geometry.

- [ ] **Step 4: Wire window layout restore/persist**

  Restore before first layout, subscribe to `SizeChanged` and window closing, clamp to 820×540 minimum and recover safely from invalid/DPI-mismatched JSON.

- [ ] **Step 5: Run desktop smoke and responsive contract tests**

  Run `node desktop/tests/DesktopSmokeTests.cjs` and `node desktop/tests/DesktopResponsiveContractTests.cjs`.
  Expected: PASS for shell contracts; runtime rendering is covered in Task 7.

- [ ] **Step 6: Commit the host/shell**

  `git add desktop/src/Zhike.Desktop desktop/tests && git commit -m "feat: host the legacy Zhike UI inside WinUI"`

### Task 4: 接管原版页面、组件和路由状态

**Files:**
- Modify: `resources/app/index.html`
- Modify: `resources/app/app.js`
- Modify: `resources/app/styles.css`
- Modify: `resources/app/modules/v41-ui.css`
- Modify: `resources/app/modules/ws-workbench.css`
- Create: `resources/app/modules/desktop-host.css`
- Create: `resources/app/modules/desktop-host.js`
- Modify: `desktop/src/Zhike.Desktop/Views/HomePage.xaml*`, `CustomersPage.xaml*`, `ImportPage.xaml*`, `OperationsPage.xaml*`, `AiFollowupPage.xaml*` only for fallback parity
- Test: `desktop/tests/DesktopVisualContractTests.cjs`, `tests/compatibility/legacy-behavior.test.cjs`

**Interfaces:**
- `desktop-host.js` calls only `window.zhikeDesktop.invoke/on` and exposes `window.__zhikeDesktopHost` for diagnostics.
- Each route must render `page-heading`, `panel`, `table-toolbar`, `data-table`, `status-tag`, `empty-state`, and modal contracts where applicable.

- [ ] **Step 1: Add failing route-state tests**

  For each route assert title, empty state, loading state, error state, filter reset and modal close behavior; assert task center and stage board remain distinct.

- [ ] **Step 2: Add host-specific CSS/JS adapter**

  Keep old tokens and DOM hierarchy, remove only Electron-only calls, and route them through the bridge; do not introduce demo rows or alter business labels.

- [ ] **Step 3: Implement route fallback policy**

  If WebView2/bridge fails, keep the last route draft and activate the native fallback page with a visible retry/diagnostic action.

- [ ] **Step 4: Verify data semantics in compatibility fixtures**

  Assert registration date is not replaced by today, follow-up date remains separate, mixed imports classify by headers/values regardless of column order, and different ticket symbols/buy-sell events remain separate records.

- [ ] **Step 5: Run legacy compatibility tests**

  Run `node tests/compatibility/legacy-behavior.test.cjs` and `node desktop/tests/DesktopVisualContractTests.cjs`.
  Expected: PASS without changing existing fixture outputs.

- [ ] **Step 6: Commit page integration**

  `git add resources/app desktop/src/Zhike.Desktop tests/compatibility desktop/tests && git commit -m "feat: restore legacy page system and route states"`

### Task 5: 重整 WS 工作台的固定布局与多账号桥接

**Files:**
- Modify: `resources/app/modules/ws-workbench.css`
- Modify: `resources/app/modules/ws-workbench.js`
- Modify: `desktop/src/Zhike.Desktop/Views/WsWorkbenchPage.xaml`
- Modify: `desktop/src/Zhike.Desktop/Views/WsWorkbenchPage.xaml.cs`
- Modify: `desktop/src/Zhike.Desktop/Services/WebViewProfileService.cs`
- Modify: `desktop/src/Zhike.Desktop/Services/WsAccountStore.cs`
- Create: `desktop/tests/WsWorkbenchResponsiveContractTests.cjs`
- Test: `tests/ws-multi-account.test.cjs`, `tests/ws-workbench-sync.test.cjs`, `tests/server-v2/ws-authorized-smoke.test.cjs`

**Interfaces:**
- `Task<WsAccountState> WsAccountStore.GetStatusAsync(string accountId)`.
- `Task SetActiveAccountAsync(string accountId)` and `Task RemoveAccountAsync(string accountId, bool clearProfile)`.
- Native connector events publish `ws.status`, `ws.message`, `ws.capture.cursor` through the bridge; account profile paths never cross into page text.

- [ ] **Step 1: Add failing layout/account tests**

  Assert 3-column widths, both side rails, breakpoint transitions, stable scroll ownership, account list non-empty after first open, independent profile directories and active-account restoration after restart.

- [ ] **Step 2: Replace hard-coded WS widths with shared layout variables**

  Use the exact breakpoint table from the spec; left/right collapse state is persisted by `WindowLayoutService`, while per-session translation/AI toggles stay in page storage.

- [ ] **Step 3: Keep the native connector as session owner**

  Ensure login, reconnect, collection cursor, phone-to-workbench sync and cleanup are routed through the native profile/account store; the WebView only displays and requests actions.

- [ ] **Step 4: Add non-blocking sync and AI reminder refresh**

  Deduplicate messages by account/message ID, publish incremental updates, preserve original text on translation/AI failure, and refresh customer/follow-up panels without reloading the whole page.

- [ ] **Step 5: Run WS tests**

  Run `node desktop/tests/WsWorkbenchResponsiveContractTests.cjs`, `node tests/ws-multi-account.test.cjs`, `node tests/ws-workbench-sync.test.cjs` and `node tests/server-v2/ws-authorized-smoke.test.cjs`.
  Expected: PASS; no password/Cookie/QR/token appears in logs or page state.

- [ ] **Step 6: Commit WS integration**

  `git add resources/app/modules/ws-workbench* desktop/src/Zhike.Desktop tests desktop/tests && git commit -m "feat: stabilize fixed WS workbench layout and sync"`

### Task 6: 性能、DPI、空状态与可访问性优化

**Files:**
- Modify: `resources/app/modules/desktop-host.css`
- Modify: `resources/app/modules/v41-ui.css`
- Modify: `resources/app/modules/ws-workbench.css`
- Modify: `desktop/src/Zhike.Desktop/MainWindow.xaml.cs`
- Modify: `desktop/src/Zhike.Desktop/Services/WindowLayoutService.cs`
- Create: `tests/desktop-performance-contract.test.cjs`
- Test: `tests/performance-scale.test.cjs`

**Interfaces:**
- `PerformanceBudget` constants: shell 1500ms, route 300ms excluding network, WS mount 3000ms.
- `WindowLayoutService.CalculateLayout(double width, double height, double scale)` returns clamped pane widths and collapse flags.

- [ ] **Step 1: Add failing performance and DPI tests**

  Use deterministic 10k/50k customer fixtures to assert debounced search, virtualized rows, bounded DOM/message list and route transition timing.

- [ ] **Step 2: Implement lazy page loading and request coalescing**

  Avoid duplicate `/api/state`/snapshot calls, virtualize long lists, pause hidden WS polling, and cancel stale searches.

- [ ] **Step 3: Implement DPI-safe layout calculation and focus behavior**

  Clamp panes before rendering, use effective pixels consistently, and ensure collapsed controls remain keyboard reachable.

- [ ] **Step 4: Run scale and performance tests**

  Run `node tests/desktop-performance-contract.test.cjs` and `node tests/performance-scale.test.cjs`.
  Expected: PASS with recorded timings and no unbounded polling.

- [ ] **Step 5: Commit performance work**

  `git add resources/app desktop/src/Zhike.Desktop tests && git commit -m "perf: optimize desktop rendering and high DPI layout"`

### Task 7: 全量回归、安装覆盖升级与交付

**Files:**
- Modify: `scripts/build-winui-bundle.ps1`
- Modify: `scripts/build-winui-installer.ps1`
- Modify: `desktop/tests/DesktopSmokeTests.cjs`
- Create: `docs/native-desktop-5.1-ui-rework.md`
- Create: `docs/native-desktop-5.1-test-report.md`
- Create: `docs/native-desktop-5.1-rollback.md`
- Output: `outputs/知客-5.1.0-原版页面复用桌面版/*`

**Interfaces:**
- Installer keeps `WindowsAppSDKSelfContained=true`, quoted Inno paths, user-data backup/restore and optional WebView2 runtime bootstrap.
- Release manifest lists source commit, installer/bundle/source hashes, tests and known limitations.

- [ ] **Step 1: Add failing packaging/upgrade assertions**

  Assert self-contained flags, WebView2 prerequisite handling, quoted stage/output paths, backup scope, uninstall data retention and rollback switch.

- [ ] **Step 2: Run all automated tests before packaging**

  Run `node scripts/run-tests.cjs all`, `node tests/server-v2/run-all.cjs`, `node desktop/tests/DesktopSmokeTests.cjs` and all new desktop/WS tests. Expected: all pass.

- [ ] **Step 3: Build and install to an isolated target**

  Run the WinUI build and installer scripts, install over a copy of the current version, launch, close, restart, and verify user data/config/profile retention. Do not use the real business database for destructive checks.

- [ ] **Step 4: Execute runtime acceptance matrix**

  Check all routes, empty/loading/error/success states, sidebar collapse, WS login/account switching, phone-to-workbench incremental sync, AI analysis/follow-up reminder refresh, 820×540 and 125%/150% DPI.

- [ ] **Step 5: Generate hashes and delivery documents**

  Produce installer, self-contained bundle, complete source archive, compatibility contract, test report, rollback instructions and known-limitations list; verify SHA-256 and record commit.

- [ ] **Step 6: Commit release metadata and final review**

  `git add scripts desktop/tests docs outputs && git commit -m "release: ship pixel-aligned desktop UI rework"`
  Run `git status --short --branch` and a fresh whole-branch code review before reporting completion.

