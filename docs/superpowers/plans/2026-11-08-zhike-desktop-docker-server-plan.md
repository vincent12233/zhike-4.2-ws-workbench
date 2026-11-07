# 知客桌面版 + Docker PostgreSQL 服务端实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在完全保持 4.4.24 业务逻辑、字段含义、统计口径和页面职责的前提下，交付一个只有 Windows 桌面用户界面的知客新版：WinUI 3 原生工作台 + WebView2 WS 连接器，后台由 Docker 中的 PostgreSQL、API、AI Worker 和可选 WS Connector Worker 提供服务。

**Architecture:** 桌面端不提供浏览器网页版管理界面。WinUI 3 原生控件承载客户、导入、跟票、入金、VIP、任务、看板、统计和 AI 页面；WebView2 只承载用户自行登录的 WS 页面。Docker Compose 运行 PostgreSQL、API、AI Worker、备份/迁移任务和按账号隔离的 WS Connector Worker，桌面端通过版本化 HTTPS API 访问。

**Tech Stack:** .NET 10 LTS / WinUI 3 / WebView2 / ASP.NET Core 10 / Npgsql / PostgreSQL 18（先做兼容验证后固定补丁版本）/ Docker Compose / Node.js 24 + Playwright（仅用于 Docker WS Connector Worker）/ SQL 版本化迁移。

**Spec:** `docs/superpowers/specs/2026-11-08-zhike-full-rewrite-design.md`

## Global Constraints

- 4.4.24 保持为可启动、可回滚基线；不得重置或覆盖现有工作区改动。
- 4.4.24 的业务逻辑是唯一兼容基准；新版只替换技术实现，不重新定义业务。
- 首页数字、统计公式、字段含义、阶段/渠道/状态映射、重复规则和页面职责必须与 4.4.24 对账一致。
- 任何业务行为变化必须先形成差异清单并获得明确确认，默认禁止静默变化。
- 不把知客业务界面发布为网页；唯一用户界面为 WinUI 3 桌面应用。
- WebView2 只用于 WS 登录、聊天和账号 Profile；不读取密码、Cookie、二维码原文或秘密 Token。
- PostgreSQL 为新版主数据库；旧 SQLite 只读用于迁移、对账和回滚。
- 所有数据库变更必须有版本化 SQL 迁移、校验、回滚说明和自动化测试。
- 不预置演示数据，不连接或修改用户真实业务库，除非用户明确提供隔离测试目录/账号。
- WS Connector 只能处理用户已授权且连接器实际采集到的内容；不得宣称未验证的全量历史同步。
- AI 失败、WS 断线或服务器不可用不能阻塞桌面端已有本地缓存和导入功能。
- 所有任务、消息和同步写入必须有幂等键、重试、死信和审计事件。
- 服务器数据库端口不直接暴露公网；远程访问只经过 HTTPS API 和认证。

## Review Focus

- 迁移中断或 PostgreSQL 不可用：桌面端必须保留 4.4.24 回滚路径，不能半迁移后误报成功（由 Task 3 的迁移恢复测试覆盖）。
- 同一客户多股票/买卖/日期：必须生成独立业务记录而不是合并（由 Task 4 的领域键测试覆盖）。
- Docker WS Profile 被删除或容器重启：账号状态、checkpoint 和可恢复性必须清楚显示（由 Task 6 的卷恢复测试覆盖）。
- AI/WS 重试和网络抖动：重复消息、重复客户、重复提醒不得产生（由 Task 5 的 outbox/idempotency 测试覆盖）。
- 820×540、DPI 缩放和 WebView2 重排：关键按钮和 WS中心区域必须可达（由 Task 7 的桌面 smoke 测试覆盖）。
- 同一隔离输入在新旧版本产生不同统计或名单：必须阻止切换并输出差异报告（由 Task 0 的黄金快照测试覆盖）。

---

### Task 0: 冻结 4.4.24 业务逻辑和黄金快照

**Files:**
- Create: `docs/compatibility-contract-v4.4.24.md`
- Create: `tests/compatibility/legacy-golden-fixtures.json`
- Create: `tests/compatibility/legacy-behavior.test.cjs`
- Create: `tests/compatibility/legacy-output-capture.cjs`
- Modify: `tests/project-audit-regression.test.cjs`

**Interfaces:**
- `captureLegacyOutputs(fixtureDir) -> { homepage, customers, imports, businessRecords, tasks, boards, statistics, ws, ai }`.
- `compareBehaviorSnapshots(legacy, candidate) -> { equal, differences[] }`.

- [ ] **Step 1: Build a fully isolated fixture dataset** covering customers, mixed import rows, multiple stocks, buy/sell records, VIPs, tasks, stages, WS messages and AI observations; no real data or demo seed in the application database.
- [ ] **Step 2: Capture 4.4.24 outputs** for homepage totals, customer lists, filters, ticket/deposit/VIP records, task/board counts, statistics and import classifications.
- [ ] **Step 3: Write failing compatibility assertions** that require the candidate implementation to match the captured outputs and record keys.
- [ ] **Step 4: Document every allowed enhancement separately** (PostgreSQL, performance, layout, checkpointing, AI evidence) and mark them as implementation changes rather than business-rule changes.
- [ ] **Step 5: Run the legacy suite and snapshot test**. Expected: the baseline snapshot is internally consistent and becomes a mandatory gate for every later task.

### Task 1: 建立新方案目录、版本和隔离运行入口

**Files:**
- Create: `server/Directory.Build.props`
- Create: `server/src/Zhike.Contracts/Zhike.Contracts.csproj`
- Create: `server/src/Zhike.Domain/Zhike.Domain.csproj`
- Create: `server/src/Zhike.Infrastructure/Zhike.Infrastructure.csproj`
- Create: `server/src/Zhike.Api/Zhike.Api.csproj`
- Create: `server/src/Zhike.Worker/Zhike.Worker.csproj`
- Create: `desktop/Zhike.Desktop.sln`
- Create: `desktop/src/Zhike.Desktop/Zhike.Desktop.csproj`
- Create: `infra/.env.example`
- Create: `infra/compose.yaml`
- Create: `tests/server-v2/bootstrap.test.cjs`
- Modify: `README.md`

**Interfaces:**
- Produces `ZHike.ServerVersion`, `ZHike.ApiVersion`, `ZHike.SchemaVersion` constants and a `/api/v2/health` response containing `appVersion`, `schemaVersion`, `databaseStatus`, `workerStatus`.

- [ ] **Step 1: Write the failing bootstrap test** asserting the new directories, Compose services, version constants and health response shape exist without touching legacy `resources/app`.
- [ ] **Step 2: Run `node tests/server-v2/bootstrap.test.cjs` and verify it fails** because the new solution and Compose files do not yet exist.
- [ ] **Step 3: Create the .NET solution, project references, Compose skeleton and `.env.example`**. Do not add a web UI service; Compose must contain only `postgres`, `api`, `ai-worker`, `ws-connector`, `backup` and an internal network.
- [ ] **Step 4: Implement `/api/v2/health`** with a database probe placeholder and explicit `starting|healthy|degraded` worker status.
- [ ] **Step 5: Run the bootstrap test and `docker compose -f infra/compose.yaml config`**. Expected: PASS and a valid Compose configuration with no published PostgreSQL port.

### Task 2: PostgreSQL schema, migration runner and health checks

**Files:**
- Create: `server/migrations/001-foundation.sql`
- Create: `server/migrations/002-customers-and-identities.sql`
- Create: `server/migrations/003-business-records.sql`
- Create: `server/migrations/004-messages-and-ws.sql`
- Create: `server/migrations/005-ai-followups-outbox.sql`
- Create: `server/src/Zhike.Infrastructure/Database/PostgresConnectionFactory.cs`
- Create: `server/src/Zhike.Infrastructure/Database/MigrationRunner.cs`
- Create: `server/src/Zhike.Infrastructure/Database/DatabaseHealthProbe.cs`
- Create: `tests/server-v2/postgres-migrations.test.cjs`

**Interfaces:**
- `MigrationRunner.ApplyAsync(CancellationToken) -> MigrationReport` with `Applied`, `Skipped`, `Failed` collections.
- `DatabaseHealthProbe.CheckAsync() -> DatabaseHealth`.
- Tables: `customers`, `customer_identities`, `business_records`, `conversations`, `messages`, `ws_accounts`, `ws_checkpoints`, `ai_jobs`, `followup_tasks`, `sync_outbox`, `audit_events`, `import_batches`, `import_rows`, `schema_migrations`.

- [ ] **Step 1: Write migration tests** for clean install, repeat install, failed migration rollback and required indexes.
- [ ] **Step 2: Run the tests against a disposable PostgreSQL Compose profile and verify failure**.
- [ ] **Step 3: Implement idempotent SQL migrations** with explicit transaction boundaries, UTC timestamps, UUID/text external IDs, unique idempotency keys and indexes for normalized phones, account IDs, message fingerprints, business record keys and follow-up deduplication.
- [ ] **Step 4: Implement `MigrationRunner` and health probe**. API startup must fail closed if migrations cannot complete; it must not silently use a partially initialized schema.
- [ ] **Step 5: Run migration tests, `pg_isready`, and `docker compose up --wait`**. Expected: all migrations apply exactly once and API waits for a healthy database.

### Task 3: SQLite 4.4.24 → PostgreSQL migration and rollback tool

**Files:**
- Create: `tools/sqlite-to-postgres/SqliteToPostgres.csproj`
- Create: `tools/sqlite-to-postgres/Program.cs`
- Create: `tools/sqlite-to-postgres/LegacyReader.cs`
- Create: `tools/sqlite-to-postgres/ReconciliationReport.cs`
- Create: `tools/sqlite-to-postgres/README.md`
- Create: `tests/server-v2/sqlite-postgres-migration.test.cjs`
- Modify: `infra/compose.yaml`

**Interfaces:**
- CLI: `dotnet run --project tools/sqlite-to-postgres -- --source <workspace.sqlite> --connection <postgres> --manifest <path> --mode dry-run|apply|rollback|resume`.
- Output: `MigrationReport { sourceCounts, targetCounts, mismatches, conflicts, resumed, rollbackAvailable }`.

- [ ] **Step 1: Create an isolated SQLite fixture** containing legacy customers, mixed imports, multiple stocks, buy/sell records, VIPs, WS accounts, messages and follow-up tasks; do not use real data.
- [ ] **Step 2: Write migration tests** for count/hash reconciliation, same phone with multiple business records, interrupted migration resume and rollback to the pre-migration snapshot.
- [ ] **Step 3: Implement a read-only legacy reader** for `app_state` and existing normalized tables; preserve raw source JSON in `legacy_records`/manifest rather than discarding unknown fields.
- [ ] **Step 4: Implement deterministic mapping and PostgreSQL upserts**. Customer identity matching and business record identity must be separate; conflicts become report rows, not silent overwrites.
- [ ] **Step 5: Implement `dry-run`, `apply`, `resume` and `rollback` modes** with a journal and SHA-256 canonical row fingerprints.
- [ ] **Step 6: Run migration tests and verify** that an intentional process interruption resumes without duplicates and that rollback restores the pre-migration state.

### Task 4: Domain services and API for customers, imports and business records

**Files:**
- Create: `server/src/Zhike.Domain/Customers/CustomerIdentity.cs`
- Create: `server/src/Zhike.Domain/Business/BusinessRecordKey.cs`
- Create: `server/src/Zhike.Domain/Import/SmartFieldClassifier.cs`
- Create: `server/src/Zhike.Infrastructure/Repositories/CustomerRepository.cs`
- Create: `server/src/Zhike.Infrastructure/Repositories/BusinessRecordRepository.cs`
- Create: `server/src/Zhike.Infrastructure/Repositories/ImportRepository.cs`
- Create: `server/src/Zhike.Api/Routes/CustomerRoutes.cs`
- Create: `server/src/Zhike.Api/Routes/ImportRoutes.cs`
- Create: `server/src/Zhike.Api/Routes/BusinessRecordRoutes.cs`
- Create: `tests/server-v2/domain-record-identity.test.cjs`
- Create: `tests/server-v2/import-classification.test.cjs`

**Interfaces:**
- `BusinessRecordKey.Create(customerId, productCode, direction, registeredAt, followupAt, source) -> string`.
- `SmartFieldClassifier.Classify(rows) -> ClassificationPreview` with field role, confidence, source position and conflicts.
- `POST /api/v2/import/batches/preview` and `POST /api/v2/import/batches/commit`.
- `GET /api/v2/customers` and `GET /api/v2/business-records` with cursor pagination.
- `POST /api/v2/customers/{id}/restore` and `POST /api/v2/customers/{id}/recycle`.

- [ ] **Step 1: Write failing tests** for out-of-order columns, dates in the last column, mixed channels/statuses, same phone with two stocks, buy/sell separation and repeat commit idempotency.
- [ ] **Step 2: Run the tests and verify failure**.
- [ ] **Step 3: Implement field classification and canonical identity keys**. Registration date and next follow-up date must remain separate; current date is never substituted silently.
- [ ] **Step 4: Port the existing 4.4.24 identity and import rules through an adapter**; customer deduplication must never block additional business records for the same customer, and no new merge rule may be introduced without a snapshot update and explicit approval.
- [ ] **Step 5: Implement API routes with validation, cursor pagination, soft delete and audit events**.
- [ ] **Step 6: Run domain/API tests against PostgreSQL and compare outputs with Task 0**; any unexpected behavior difference blocks the task.

### Task 5: Persistent WS/AI/outbox worker pipeline

**Files:**
- Create: `server/src/Zhike.Domain/Messaging/MessageFingerprint.cs`
- Create: `server/src/Zhike.Domain/Jobs/JobState.cs`
- Create: `server/src/Zhike.Infrastructure/Repositories/OutboxRepository.cs`
- Create: `server/src/Zhike.Infrastructure/Repositories/WsRepository.cs`
- Create: `server/src/Zhike.Infrastructure/Repositories/AiJobRepository.cs`
- Create: `server/src/Zhike.Worker/JobDispatcher.cs`
- Create: `server/src/Zhike.Worker/Workers/WsIngestWorker.cs`
- Create: `server/src/Zhike.Worker/Workers/AiAnalysisWorker.cs`
- Create: `server/src/Zhike.Worker/Workers/FollowupReminderWorker.cs`
- Create: `tests/server-v2/outbox-idempotency.test.cjs`

**Interfaces:**
- `IngestMessage(MessageEnvelope) -> IngestResult { messageId, deduplicated, conversationId }`.
- `EnqueueAiAnalysis(analysisRequest) -> JobReceipt`.
- `JobDispatcher` claims jobs with `FOR UPDATE SKIP LOCKED`, supports `pending|running|succeeded|retrying|dead` and exponential backoff.
- `POST /api/v2/ws/ingest/batch`, `POST /api/v2/ws/checkpoints`, `GET /api/v2/followups`.

- [ ] **Step 1: Write failing tests** for duplicate message fingerprints, out-of-order messages, worker crash recovery, dead-lettering and duplicate follow-up reminders.
- [ ] **Step 2: Run the tests and verify failure**.
- [ ] **Step 3: Implement message fingerprinting and account-scoped checkpoints**.
- [ ] **Step 4: Implement transactional outbox writes** so message persistence and AI enqueue are atomic.
- [ ] **Step 5: Implement AI provider adapter and field-level observations** with source message IDs, confidence, timestamps and conflict status; AI must only fill empty fields automatically.
- [ ] **Step 6: Implement follow-up task/reminder generation** with deduplication and desktop notification events.
- [ ] **Step 7: Run worker tests under forced network failures and process restarts**. Expected: no duplicate customer or reminder writes and no chat blocking.

### Task 6: Shared WS connector protocol and Docker WS Connector Worker

**Files:**
- Create: `server/src/Zhike.Contracts/WsConnectorContracts.cs`
- Create: `connectors/ws-worker/package.json`
- Create: `connectors/ws-worker/src/runner.mjs`
- Create: `connectors/ws-worker/src/profile-store.mjs`
- Create: `connectors/ws-worker/src/collector.mjs`
- Create: `connectors/ws-worker/src/checkpoint-client.mjs`
- Create: `connectors/ws-worker/Dockerfile`
- Create: `connectors/ws-worker/tests/collector-fixtures.test.cjs`
- Modify: `infra/compose.yaml`

**Interfaces:**
- `WsMessageEnvelope { connectorId, accountId, conversationKey, externalMessageId, sentAt, direction, body, previewOnly, observedAt }`.
- `WsCheckpoint { accountId, conversationKey, cursor, lastMessageFingerprint, updatedAt }`.
- Connector endpoints: `POST /api/v2/ws/ingest/batch`, `POST /api/v2/ws/checkpoints`, `POST /api/v2/ws/heartbeat`.

- [ ] **Step 1: Write DOM fixture tests** for list-level capture, visible message capture, timestamp normalization, preview cleanup and DOM structure changes.
- [ ] **Step 2: Implement the connector protocol and collector** using a visible user-controlled login surface; never export passwords, cookies, QR payloads or secret tokens.
- [ ] **Step 3: Implement one isolated browser profile per WS account** with a named Docker volume and restart-safe checkpoint state.
- [ ] **Step 4: Add connector health, coverage, last-success and paused/expired status reporting**.
- [ ] **Step 5: Add Compose health checks and no-public-5432 network rules**; verify `docker compose down` preserves named volumes and `down -v` is blocked in production scripts.
- [ ] **Step 6: Run fixture tests and a controlled authorized login smoke test**. If the platform rejects or destabilizes the container browser, keep the connector contract and mark Docker WS mode as experimental while enabling the local WinUI connector.

### Task 7: WinUI 3 desktop application and local WebView2 connector

**Files:**
- Create: `desktop/src/Zhike.Desktop/App.xaml`
- Create: `desktop/src/Zhike.Desktop/MainWindow.xaml`
- Create: `desktop/src/Zhike.Desktop/Views/CustomersPage.xaml`
- Create: `desktop/src/Zhike.Desktop/Views/ImportPage.xaml`
- Create: `desktop/src/Zhike.Desktop/Views/OperationsPage.xaml`
- Create: `desktop/src/Zhike.Desktop/Views/WsWorkbenchPage.xaml`
- Create: `desktop/src/Zhike.Desktop/Views/AiFollowupPage.xaml`
- Create: `desktop/src/Zhike.Desktop/Services/ApiClient.cs`
- Create: `desktop/src/Zhike.Desktop/Services/LocalQueue.cs`
- Create: `desktop/src/Zhike.Desktop/Services/WindowLayoutService.cs`
- Create: `desktop/src/Zhike.Desktop/Services/WebViewProfileService.cs`
- Create: `desktop/src/Zhike.Desktop/Services/NotificationService.cs`
- Create: `desktop/tests/DesktopSmokeTests.cs`

**Interfaces:**
- `ApiClient` exposes typed methods for health, customers, import preview/commit, WS account status, followups and sync batches.
- `WebViewProfileService.GetOrCreateProfile(accountId) -> CoreWebView2Profile` and `ClearProfile(accountId)`; the profile directory is account-scoped and never returned to the API.
- `WindowLayoutService.ApplyLayout(width, height, dpi, leftCollapsed, rightCollapsed) -> LayoutState`.

- [ ] **Step 1: Write desktop smoke tests** for navigation, sidebar collapse, 820×540 layout, 125/150/200% DPI, offline banner and API reconnect.
- [ ] **Step 2: Create the WinUI 3 shell and native pages with the same page names, navigation responsibilities and user-visible business semantics as 4.4.24**. Do not create a web frontend or browser-accessible management UI.
- [ ] **Step 3: Implement typed API client, local pending queue and conflict/error states**.
- [ ] **Step 4: Implement WebView2 account profiles and fixed WS host bounds**. The embedded page is the only browser surface.
- [ ] **Step 5: Implement native AI/customer/follow-up panels** and desktop notifications.
- [ ] **Step 6: Run desktop smoke tests on 820×540, 900×600, 1024×768, 1366×768 and DPI 100/125/150/200%**.

### Task 8: Server authentication, secrets, backup and observability

**Files:**
- Create: `server/src/Zhike.Api/Auth/PairingService.cs`
- Create: `server/src/Zhike.Api/Auth/SessionService.cs`
- Create: `server/src/Zhike.Infrastructure/Secrets/SecretRedactor.cs`
- Create: `server/src/Zhike.Worker/BackupWorker.cs`
- Create: `infra/backup/backup.ps1`
- Create: `infra/compose.prod.yaml`
- Create: `infra/README.md`
- Create: `tests/server-v2/security-backup.test.cjs`

**Interfaces:**
- `POST /api/v2/pairing/start`, `POST /api/v2/pairing/complete`, `POST /api/v2/sessions/revoke`.
- `BackupWorker.CreateSnapshot(reason) -> BackupReceipt`.
- `BackupWorker.RestoreSnapshot(path, dryRun) -> RestoreReport`.

- [ ] **Step 1: Write failing tests** for pairing expiry, token rotation, secret redaction, backup retention and restore without deleting unrelated files.
- [ ] **Step 2: Implement one-time desktop pairing and encrypted-at-rest server secrets**; never log API keys, passwords, cookies or WS profile paths.
- [ ] **Step 3: Implement PostgreSQL logical backups plus schema/version metadata** and verify restore into an isolated database.
- [ ] **Step 4: Add Compose health checks, restart policies, resource limits and internal-only database networking**.
- [ ] **Step 5: Run security/backup tests and a clean-machine Compose drill**.

### Task 9: End-to-end migration, performance and real authorized WS verification

**Files:**
- Create: `tests/server-v2/e2e-migration.test.cjs`
- Create: `tests/server-v2/performance-postgres.test.cjs`
- Create: `tests/server-v2/ws-authorized-smoke.test.cjs`
- Create: `docs/server-version-deployment.md`
- Create: `docs/server-version-troubleshooting.md`
- Create: `docs/server-version-rollback.md`
- Modify: `README.md`

**Interfaces:**
- Test runner commands: `npm run test:server-v2`, `npm run test:desktop-v2`, `npm run test:docker-v2`.
- Deployment command: `docker compose -f infra/compose.yaml -f infra/compose.prod.yaml up -d --wait`.

- [ ] **Step 1: Generate isolated 10,000 and 50,000 customer datasets** and measure PostgreSQL search, filtering, save, page switching and worker throughput.
- [ ] **Step 2: Run end-to-end migration reconciliation** and compare counts, canonical hashes, key aggregates and conflict reports.
- [ ] **Step 3: Run desktop-to-API-to-PostgreSQL-to-AI-to-reminder flow** with synthetic messages.
- [ ] **Step 4: Run a user-controlled authorized WS test** for account login, list capture, message ingestion, checkpoint resume, AI analysis and follow-up reminder; record actual latency and coverage, not a “build passed” claim.
- [ ] **Step 5: Run abnormal scenarios**: duplicate click, network loss, API restart, PostgreSQL restart, connector restart, desktop crash and version conflict.
- [ ] **Step 6: Publish a verified server package, desktop installer, migration report, known limitations and rollback instructions**. Do not switch formal data until every migration and restore gate passes.

### Task 10: Cutover and legacy preservation

**Files:**
- Modify: `scripts/build-installer.ps1`
- Modify: `zhike-setup.iss`
- Create: `scripts/build-server-bundle.ps1`
- Create: `docs/release-notes-v5-server-desktop.md`
- Create: `tests/server-v2/installer-cutover.test.cjs`

**Interfaces:**
- `build-server-bundle.ps1` emits a versioned Docker bundle with checksums and `.env.example`.
- Desktop installer keeps user data outside the program directory and supports uninstall-with-data-preserved.

- [ ] **Step 1: Write installer tests** for fresh install, upgrade, server bundle checksum, data preservation and rollback to 4.4.24.
- [ ] **Step 2: Implement versioned server bundle and desktop installer metadata**.
- [ ] **Step 3: Verify the installer on a clean Windows profile and an upgrade profile with isolated fixture data**.
- [ ] **Step 4: Run all legacy 4.4.24 tests plus new server/desktop tests**.
- [ ] **Step 5: Only after all gates pass, produce the final desktop installer and Docker deployment archive**.

## Execution Gates

- Gate 1: PostgreSQL schema and migration report pass before any new UI work.
- Gate 2: Domain/API/outbox tests pass before WS containers are enabled.
- Gate 3: Docker WS connector passes fixture and isolated login smoke before it is marked stable; otherwise local WinUI connector remains the stable path.
- Gate 4: Desktop smoke and 10k/50k performance targets pass before migration of real data.
- Gate 5: Backup restore and installer upgrade pass before release.
