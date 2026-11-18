# 知客 6.1 阶段 2 受控 Worker 集成实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将已通过隔离验收的 Named Pipe Worker Supervisor、旧队列只读适配和 SQLite fencing 接入正式代码边界，同时保持所有生产执行入口默认关闭。

**Architecture:** WinUI 只持有一个 `WorkerRuntimeController`，由 `WorkerFeatureFlags` 明确控制生命周期、队列适配和 fencing 三个能力。队列适配器只把现有 `ws_collection_*`/`ai_jobs` 记录转换成稳定的 Worker Job 描述，不消费、不写入；实际写入继续由旧 sidecar 路径拥有。隔离测试显式启用三项 flag，并复用已验收的 `WorkerSupervisor` 与临时 SQLite。

**Tech Stack:** WinUI 3 / .NET 10 C#, Windows Named Pipe, Node.js ESM/CommonJS, SQLite, 现有 `scripts/run-tests.cjs`。

**Spec:** 用户提供的《知客 6.1 A+B — 阶段 2 Worker 受控集成开发指令》以及阶段 1.7 P0 Gate 报告。

## Global Constraints

- 生产入口继续保持 `FROZEN`。
- `WorkerRuntimeEnabled`、`WorkerQueueAdapterEnabled`、`WorkerFencingEnabled` 默认全部为 `false`。
- 不连接真实 WhatsApp，不读取真实登录凭据，不启动正式 Worker，不执行生产 SQLite 迁移。
- 旧队列仍为当前生产权威；禁止新旧执行器同时消费同一任务和双写。
- 所有 fencing/Worker 集成测试仅使用隔离进程和临时 SQLite。
- 现有客户、群组、AI、WS、CRM 业务规则和历史状态保持不变。

## Review Focus

- 缺失或损坏的 flag 文件必须安全回落到全关闭，而不是自动启用 Worker；由 `worker-feature-flags.test.cjs` 固定。
- Worker 启动、停止、心跳超时、崩溃恢复和 token 轮换不得让 WinUI 退出；由隔离 .NET runtime 测试固定。
- 相同旧队列记录必须得到稳定 job/idempotency key，且适配器不能执行或写回旧表；由 `worker-queue-adapter.test.cjs` 固定。
- 过期 fencing owner 必须在真实 sidecar 事务内被拒绝；阶段 1.5 fencing 集成测试继续作为阶段 2 Gate。
- flag 关闭时旧代码路径和生产 server 源码不得出现 Worker 消费或双写；由 `worker-controlled-integration.test.cjs` 固定。

---

### Task 1: Feature flags and formal WinUI runtime boundary

**Files:**
- Create: `desktop/src/Zhike.Desktop/Services/WorkerFeatureFlags.cs`
- Create: `desktop/src/Zhike.Desktop/Services/WorkerRuntimeController.cs`
- Modify: `desktop/src/Zhike.Desktop/App.xaml.cs`
- Test: `scripts/stage2/worker-controlled-integration.test.cjs`

**Interfaces:**
- `WorkerFeatureFlags.Load(string dataRoot) -> WorkerFeatureFlagsSnapshot`
- `WorkerRuntimeController.StartAsync/StopAsync/RestartAsync/RequestAsync/RotateTokenAsync`
- `WorkerRuntimeController.Status -> WorkerRuntimeStatus`

- [ ] **Step 1: Write failing contract tests** for default-off flags, no automatic Worker start in `App.xaml.cs`, and controller lifecycle API.
- [ ] **Step 2: Run the targeted contract test** and verify it fails because the new types and boundary do not exist.
- [ ] **Step 3: Implement the flag snapshot/store** with strict boolean parsing, source/revision metadata, and safe default-off behavior.
- [ ] **Step 4: Implement the controller** as a single-owner wrapper over `WorkerSupervisor`; it must be inert when runtime flag is off, expose bounded heartbeat/recovery in enabled isolation, and never start from `App.OnLaunched`.
- [ ] **Step 5: Expose the controller and snapshot from `App`** without invoking `StartAsync` during launch.
- [ ] **Step 6: Run targeted tests and the WinUI build**; commit the boundary.

### Task 2: Read-only legacy queue adapter

**Files:**
- Create: `resources/app/worker-queue-adapter.cjs`
- Create: `scripts/stage2/worker-queue-adapter.test.cjs`
- Modify: `scripts/run-tests.cjs`

**Interfaces:**
- `mapCollectionItemToWorkerJob(row)`
- `mapAiJobToWorkerJob(row)`
- `assertSingleConsumer({ legacyConsumerActive, workerConsumerActive })`

- [ ] **Step 1: Write failing adapter tests** for stable job IDs, idempotency keys, status mapping, retry/checkpoint preservation, and dual-consumer rejection.
- [ ] **Step 2: Run the adapter test** and verify the module is missing.
- [ ] **Step 3: Implement pure mapping functions** with no DB access and no side effects; preserve legacy IDs/status/checkpoint and mark source as legacy.
- [ ] **Step 4: Add the adapter test to the all-suite runner** and run it with the stage 1.5 compatibility test.
- [ ] **Step 5: Commit the adapter and test.**

### Task 3: Controlled fencing integration surface

**Files:**
- Create: `resources/app/worker-fencing-gate.cjs`
- Create: `scripts/stage2/worker-fencing-gate.test.cjs`
- Modify: `resources/app/sidecar-write-coordinator.cjs` only if the test exposes a concrete gate defect.

**Interfaces:**
- `createWorkerFencingGate({ enabled, writer })`
- `gate.runProtectedWrite(lease, input, callback)`

- [ ] **Step 1: Write failing tests** proving disabled fencing rejects controlled writes and enabled fencing delegates to the already verified transactional writer.
- [ ] **Step 2: Run the test and observe the missing gate failure.
- [ ] **Step 3: Implement the explicit flag gate** without changing production sidecar startup or creating fencing tables when disabled.
- [ ] **Step 4: Run the gate test plus real sidecar fencing integration and failure/BUSY tests.
- [ ] **Step 5: Commit the controlled fencing surface.

### Task 4: Stage 2 integration evidence and regression gate

**Files:**
- Create: `docs/superpowers/reports/stage2-worker-controlled-integration.md`
- Create: `docs/superpowers/reports/stage2-feature-flags.md`
- Create: `docs/superpowers/reports/stage2-queue-adapter.md`
- Create: `docs/superpowers/reports/stage2-fencing-integration.md`
- Create: `docs/superpowers/reports/stage2-integration-tests.md`
- Create: `docs/superpowers/reports/stage2-rollback.md`
- Create: `docs/superpowers/reports/stage2-acceptance.md`

- [ ] **Step 1: Run targeted stage 2 tests, old queue compatibility, and fencing integration from a clean temporary-data environment.
- [ ] **Step 2: Run `node scripts/run-tests.cjs all`, WinUI x64/win-x64 build, and `git diff --check`.
- [ ] **Step 3: Record actual counts, commands, modified files, rollback steps, untested production paths, and double-write proof in the reports.
- [ ] **Step 4: Verify no production SQLite/WS/Worker was touched, inspect diff, and commit all stage 2 code and reports.

## Stop Condition

The stage 2 Gate covers controlled integration only. Even if all tests pass, the reports must state that production Worker startup, queue cutover, AI automation, migration, and release remain `FROZEN` pending a separate authorization.
