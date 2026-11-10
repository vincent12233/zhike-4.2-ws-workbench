# 本机单一存储、Docker 移除与 WS 稳定性实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (this session) and superpowers:test-driven-development. Execute tasks in order and keep the SDD ledger updated.

**Goal:** 将知客改为不依赖 Docker 的单一本机 SQLite 桌面应用，同时保持所有现有业务页面可用，并确保 WS 聊天采集、AI 档案补齐和跟进提醒稳定运行。

**Architecture:** WinUI 3 负责窗口、路由、WebView2 和统一 LegacyBridge；随安装包携带固定版本 Node runtime，启动受控的 `resources/app/server.mjs` sidecar；sidecar 使用本机 SQLite/WAL/迁移/快照，所有页面和 WS/AI 数据都经过 C# bridge。Docker/PostgreSQL 只做一次性只读迁移，完成验证后从正式运行链路和安装包移除。

**Tech Stack:** C#/.NET 10 WinUI 3、WebView2、Node.js 运行时、SQLite (`node:sqlite`)、现有 CommonJS 页面与测试、Inno Setup。

**Spec:** `docs/superpowers/specs/2026-11-10-local-first-docker-removal-and-stability-design.md`

## Global Constraints

- 不删除或覆盖用户业务数据；任何迁移/删除前必须有 JSON、SQLite 和配置备份。
- 不改变客户主档案、手机号登记独立、跟票买入/卖出独立和现有统计口径。
- Docker 正式运行代码最终移除，但 Docker 数据卷在用户确认前不物理删除。
- WS 采集只处理用户已登录并授权查看的聊天；不保存密码、Cookie、二维码或秘密 Token。
- 页面请求统一经过 C# `LegacyBridge`，WebView 不直接调用本机服务。
- 继续交付唯一 WinUI 3 x64 per-user Inno Setup 安装包，版本保持 5.3.6，除非测试发现必须升版。

## Review Focus

- localStorage、Docker 导出和 SQLite 同时存在时不丢失、不静默覆盖：Task 1/4。
- sidecar 启动失败、端口冲突、锁残留、父进程退出和数据库损坏：Task 2。
- WS 列表采集、消息去重、断点恢复、手机新消息和 AI 失败不阻塞聊天：Task 7。
- 820×540/125%/150% 下侧栏滚轮、键盘和路由点击真实可用：Task 5/6。
- 1 万/5 万客户搜索、导入、切页和保存不冻结 UI：Task 8。

### Task 1: 保护现有工作区并建立迁移/兼容测试

**Files:**
- Create: `tests/local-first-migration-contract.test.cjs`
- Create: `tests/local-first-backup-contract.test.cjs`
- Modify: `scripts/run-tests.cjs`
- Create: `.superpowers/sdd/2026-11-10-local-first-ws-stability-plan/progress.md`

**Interfaces:**
- Produces migration source inventory, backup manifest contract and RED tests used by Tasks 2–4.

- [ ] **Step 1: Write failing tests** for localStorage export preservation, Docker export isolation, SHA-256 manifest creation, and cancellation without writes.
- [ ] **Step 2: Run the focused tests** and verify they fail because no local-first migration contract exists.
- [ ] **Step 3: Record the current dirty-worktree inventory** and create a recoverable patch/list under `work/` without resetting or stashing user changes.
- [ ] **Step 4: Implement only the migration contract helpers** in the existing test/runtime utility layer.
- [ ] **Step 5: Run focused tests and the existing suite; verify RED→GREEN.**
- [ ] **Step 6: Commit the task changes and append the command/result to the ledger.**

### Task 2: Add a guarded local SQLite sidecar manager

**Files:**
- Create: `desktop/src/Zhike.Desktop/Services/LocalServiceManager.cs`
- Create: `desktop/tests/LocalServiceManagerContractTests.cjs`
- Modify: `desktop/src/Zhike.Desktop/Zhike.Desktop.csproj`
- Modify: `desktop/src/Zhike.Desktop/App.xaml.cs`
- Modify: `desktop/src/Zhike.Desktop/MainWindow.xaml.cs`
- Modify: `scripts/build-winui-bundle.ps1`
- Modify: `scripts/build-winui-installer.ps1`

**Interfaces:**
- Produces `LocalServiceManager.StartAsync()`, `HealthAsync()`, `StopAsync()` and an authenticated loopback base URL for the bridge.
- Consumes `resources/app/server.mjs`, a fixed Node runtime staged under the bundle, and `%LOCALAPPDATA%\\Zhike` for data.

- [ ] **Step 1: Write failing C#-contract tests** for deterministic port selection, per-launch token, parent PID, stale lock recovery, crash detection and bounded shutdown.
- [ ] **Step 2: Run tests and verify failure.**
- [ ] **Step 3: Implement `LocalServiceManager`** with no Docker branches: launch the staged Node runtime, set `ZHIKE_DATA_DIR`, `ZHIKE_PORT`, `ZHIKE_API_TOKEN`, `ZHIKE_PARENT_PID`, wait for `/api/health`, and stop/restart safely.
- [ ] **Step 4: Stage a fixed Node runtime and `server.mjs`** in the WinUI bundle while keeping user data outside the bundle.
- [ ] **Step 5: Run focused desktop tests and a local health smoke; verify GREEN.**
- [ ] **Step 6: Commit and ledger the result.**

### Task 3: Make LegacyBridge use the local sidecar as the only storage path

**Files:**
- Modify: `desktop/src/Zhike.Desktop/Services/LegacyBridgeScript.cs`
- Modify: `desktop/src/Zhike.Desktop/Services/LegacyApiAdapter.cs`
- Modify: `desktop/src/Zhike.Desktop/Views/LegacyUiHostPage.xaml.cs`
- Modify: `desktop/src/Zhike.Desktop/Views/HomePage.xaml` and `.xaml.cs`
- Create: `desktop/tests/LocalBridgeContractTests.cjs`

**Interfaces:**
- Consumes `LocalServiceManager` loopback URL/token.
- Produces a single bridge response contract for `/api/state`, snapshots, imports, WS accounts/messages/checkpoints and AI/follow-up endpoints.

- [ ] **Step 1: Write failing tests** proving local mode never falls back to WebView localStorage and that bridge errors are visible and typed.
- [ ] **Step 2: Run focused tests and observe RED.**
- [ ] **Step 3: Route all legacy API calls through the local adapter and remove the Docker/local boolean split.**
- [ ] **Step 4: Add bounded timeout, retry classification, conflict response and diagnostic IDs without reporting false success.**
- [ ] **Step 5: Run import/save/snapshot/restore bridge tests and the full suite.**
- [ ] **Step 6: Commit and ledger.**

### Task 4: Migrate localStorage and Docker data into SQLite safely

**Files:**
- Create: `resources/app/modules/local-first-migration.js`
- Modify: `resources/app/server.mjs`
- Modify: `resources/app/app.js`
- Create: `tests/local-first-migration-runtime.test.cjs`
- Modify: `resources/app/migrations/` (new numbered migration only)

**Interfaces:**
- Produces `POST /api/local-migration/preview`, `POST /api/local-migration/commit`, `GET /api/local-migration/status`.
- Uses source priority: stable customer ID → normalized phone → WS account/session ID; unresolved conflicts remain pending.

- [ ] **Step 1: Write failing runtime tests** for localStorage payload import, Docker export import, duplicate business records, separate buy/sell dates, cancellation and rollback.
- [ ] **Step 2: Run tests and verify RED.**
- [ ] **Step 3: Implement preview/commit in one SQLite transaction** with snapshots, counts, field-level conflict report and idempotency key.
- [ ] **Step 4: Add first-run migration UI** with backup location, preview counts, conflict list, cancel and retry.
- [ ] **Step 5: Run isolated migration tests and backup/restore drill.**
- [ ] **Step 6: Commit and ledger.**

### Task 5: Consolidate shell layout and repair sidebar scrolling

**Files:**
- Create: `resources/app/modules/shell-layout.css`
- Modify: `resources/app/index.html`
- Modify: `resources/app/styles.css`
- Modify: `resources/app/modules/design-system.css`
- Modify: `resources/app/modules/v41-ui.css`
- Modify: `resources/app/modules/ui-refresh.css`
- Create: `tests/sidebar-scroll-contract.test.cjs`

**Interfaces:**
- Produces canonical rules for `.app-shell`, `.sidebar`, `.nav-groups`, `.main-area`, `.view-container` and breakpoints.

- [ ] **Step 1: Write failing CSS contract tests** for `min-height:0`, independent `overflow-y:auto`, `overscroll-behavior`, `body min-width:0`, collapsed widths and route nav placement.
- [ ] **Step 2: Run tests and verify RED.**
- [ ] **Step 3: Add the canonical shell block**, remove conflicting duplicate shell declarations, and keep module CSS scoped to components.
- [ ] **Step 4: Add wheel/keyboard behavior only if CSS smoke shows body scroll capture; never prevent scrolling when the sidebar cannot scroll.**
- [ ] **Step 5: Run 820×540, 1100, 1440 and DPI contract tests plus visual smoke.**
- [ ] **Step 6: Commit and ledger.**

### Task 6: Add route registry and page-level error boundaries

**Files:**
- Modify: `resources/app/app.js`
- Create: `resources/app/modules/route-registry.js`
- Create: `tests/route-navigation-contract.test.cjs`

**Interfaces:**
- Produces `navigate(view)` and `renderRoute(view)` with a visible error state and retry action.

- [ ] **Step 1: Write failing tests** for all 20 route IDs, click navigation, non-empty render and isolated exception handling.
- [ ] **Step 2: Run tests and verify RED.**
- [ ] **Step 3: Implement the registry and wrap each render entry in a page-level error boundary; preserve existing route semantics.**
- [ ] **Step 4: Run all route tests with empty, malformed and populated fixtures.**
- [ ] **Step 5: Commit and ledger.**

### Task 7: Stabilize WS collection, AI profile completion and follow-up reminders

**Files:**
- Modify: `resources/app/modules/ws-workbench.js`
- Modify: `resources/app/modules/ws-workbench-core.js`
- Modify: `resources/app/modules/ws-crm-sync-core.js`
- Modify: `resources/app/server.mjs`
- Modify: `resources/app/app.js`
- Create: `tests/ws-local-first-live-sync.test.cjs`
- Create: `tests/ws-ai-profile-followup.test.cjs`

**Interfaces:**
- Consumes the local bridge endpoints from Task 3 and migration identity rules from Task 4.
- Produces idempotent message ingest/checkpoints, customer profile patches, AI analysis jobs and follow-up alerts.

- [ ] **Step 1: Write failing tests** for list capture without opening a conversation, phone/session matching, duplicate message replay, out-of-order messages, AI timeout, low confidence, profile fill-only-empty-fields, and real-time reminder refresh.
- [ ] **Step 2: Run tests and verify RED.**
- [ ] **Step 3: Implement checkpointed background capture and durable idempotency in SQLite.**
- [ ] **Step 4: Implement AI profile patch rules** (source, age, occupation, name, investor status/experience, holdings/preferences, family/interests/plans) with evidence and confidence; do not overwrite existing non-empty fields automatically.
- [ ] **Step 5: Implement follow-up scheduling/refresh** with no-reply cooldown, next-action text and retryable AI failures.
- [ ] **Step 6: Run WS/AI tests with an isolated fixture and a real logged-in session only after automated tests pass.**
- [ ] **Step 7: Commit and ledger.**

### Task 8: Performance, Docker code removal and formal packaging

**Files:**
- Modify/remove Docker-only files listed in the approved spec (`infra/`, PostgreSQL server/worker, Docker connection UI/services/tests/docs).
- Modify: `scripts/run-tests.cjs`
- Create: `tests/docker-removal-contract.test.cjs`
- Modify: `README.md`, `docs/current-release-index.md`, release notes.

**Interfaces:**
- Consumes local sidecar/bridge and route contracts from Tasks 2–7.
- Produces a Docker-free formal bundle and installer with migration archive excluded.

- [ ] **Step 1: Write failing tests** asserting no Docker/PostgreSQL runtime files enter the bundle, no Docker UI route remains, and local mode survives restart.
- [ ] **Step 2: Run tests and verify RED.**
- [ ] **Step 3: Remove Docker runtime code and build inputs only after migration and WS/AI parity tests pass; preserve external archive and user data.**
- [ ] **Step 4: Run 10k/50k performance tests, full 20-route smoke, backup/restore, install/upgrade/uninstall checks.**
- [ ] **Step 5: Build the single WinUI installer, verify version 5.3.6, hash, shortcut, and bundle manifest.**
- [ ] **Step 6: Commit and ledger.**

## Plan self-review

- All design requirements map to Tasks 1–8; no task deletes Docker code before migration and parity gates pass.
- Every production behavior change has a preceding RED test step.
- WS collection, AI extraction, profile synchronization and reminders have explicit tests and are not hidden inside the storage migration task.
- The only destructive action is Docker runtime-source removal in Task 8, gated by backups, migration verification and a failing-then-passing removal contract.
