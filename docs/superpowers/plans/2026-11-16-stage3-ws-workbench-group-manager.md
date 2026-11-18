# 知客 6.1 阶段 3 WS 工作台与群组管理实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 7273f27 基线上，把现有 WS 工作台扩展为保持单一 WebView 会话的独立侧边栏工作区，并补齐隔离、可审计、可恢复的 Mock WS 群组管理能力。

**Architecture:** 继续使用现有 WinUI 单壳和本地 sidecar，不新建第二个桌面壳。WS 工作台内增加独立的工作区导航层，导航只切换页面状态，不重连 WS、不重启 Worker；群组管理复用已有 015/017/022 群组与关系账本，在后续迁移中只补齐消息索引、已读证据、同步错误和审计模型。正式 Worker、正式队列和真实 WS 仍由生产门禁保护，阶段 3 仅在隔离 Mock 环境启用。

**Tech Stack:** WinUI 3/C#, WebView2 前端 JavaScript/CSS，Node.js sidecar，SQLite versioned migration runner，现有 Node/C# contract/runtime tests。

**Spec:** `C:/Users/酷酷/.codex/attachments/534cf4c2-4a48-419d-8f24-8269305c75cd/已粘贴的文本.txt`

## Global Constraints

- 生产入口始终 `FROZEN`；不连接真实 WhatsApp，不读取真实凭据，不修改生产 SQLite，不启动正式 Worker，不执行新旧队列双写。
- 保留现有单一 WinUI/WebView shell、客户权威主档、业务规则和已通过功能；不创建第二套客户主档或重复迁移表。
- 新增群组 Feature Flags 默认全部关闭，隔离测试必须显式启用并记录审计。
- 群组目录唯一键为 `(account_id, group_jid)`；所有成员、消息、任务、日志查询必须带账号作用域。
- `Unknown` 已读证据不得被推断为 `Unread`；缺少渠道只能是“未分类，待绑定”。
- 页面切换不得重新连接 WS、重复启动 Worker 或依赖页面生命周期维持后台任务。

## Review Focus

- 旧导航/旧功能没有被二次实现；测试要求同一 WebView anchor 和运行时状态在十个页面间保持。
- 同名群组跨账号绝不能合并；测试要求数据库层 account_id 作用域和唯一键。
- 乱序、重复和断点恢复事件不能回退关系状态；测试要求事件幂等和 checkpoint 顺序。
- 受控自动建档不能覆盖人工字段或创建重复客户；测试要求全局去重、冲突留痕和未分类渠道。
- Unknown 已读和正式 AI 禁用状态不能被 UI 伪装；测试要求证据状态和 disabled 文案真实可见。

### Task 1: 基线映射与阶段 3 合同测试

**Files:**
- Create: `scripts/stage3/ws-workbench-navigation.test.cjs`
- Create: `scripts/stage3/ws-group-manager.test.cjs`
- Create: `scripts/stage3/ws-group-manager-migration.test.cjs`
- Create: `scripts/stage3/worker-group-flags.test.cjs`
- Modify: `scripts/run-tests.cjs`

**Interfaces:**
- Tests consume existing `resources/app/modules/ws-workbench.js`, `resources/app/server.mjs`, migration manifest and `WorkerFeatureFlags.cs`.
- Tests produce the exact contracts for ten navigation IDs, account isolation, event/message/read evidence idempotency, migration version continuity and fail-closed flags.

- [x] 写四组最小 failing tests，并只断言公开行为/源码契约，不连接生产目录。
- [x] 运行每个新测试，确认因阶段 3 能力尚不存在而失败。
- [x] 将新测试接入 `scripts/run-tests.cjs` 的 `runWs()` 或隔离 stage3 组。

### Task 2: Worker 群组 Feature Flags

**Files:**
- Modify: `desktop/src/Zhike.Desktop/Services/WorkerFeatureFlags.cs`
- Modify: `scripts/stage2/WorkerRuntimeIntegration/Program.cs` only if constructor fixtures require explicit fields.
- Test: `scripts/stage3/worker-group-flags.test.cjs`

**Interfaces:**
- Extend `WorkerFeatureFlagsSnapshot` with the five named group flags and a derived `GroupManagerPathsEnabled` property.
- `Disabled()` and malformed/unknown JSON must return all eight flags false; production `App.xaml.cs` remains disabled.

- [x] 先运行 flags failing test。
- [x] 实现向后兼容的 record/JSON 读取：缺失字段 false，未知字段不启用任何路径，依赖不满足时派生值 false。
- [x] 运行 stage2 既有 flags 测试和 stage3 flags 测试。

### Task 3: WS 独立工作区导航层

**Files:**
- Modify: `resources/app/modules/ws-workbench.js`
- Modify: `resources/app/modules/ws-workbench.css`
- Test: `scripts/stage3/ws-workbench-navigation.test.cjs`

**Interfaces:**
- Add `state.wsWorkspaceView` with ten stable IDs: `overview`, `accounts`, `groups`, `members`, `collection`, `ai`, `crm`, `tasks`, `logs`, `settings`.
- Add `renderWsWorkspaceNav()` and `renderWsWorkspacePage(view)`; clicks use `data-ws-workspace-view` and only update view state.
- Preserve `#wsBrowserHost`, `WsRuntime`, collection timers and assist drawer across renders.

- [x] 运行导航 failing test。
- [x] 实现导航 rail、collapse/tooltips、active state、responsive CSS 和 page title；每个页面复用已有真实 state/API，未启用的 AI/Worker 能力明确显示 disabled 状态。
- [x] 为页面状态保存筛选/滚动引用，避免页面切换造成连接、任务和 WebView 重建。
- [x] 运行导航测试、现有 WS UI/scroll/performance 测试。

### Task 4: Stage 3 群组数据迁移与 repository/service

**Files:**
- Create: `resources/app/migrations/023-ws-group-manager.sql`
- Modify: `resources/app/migrations/manifest.json`
- Create/Modify: `resources/app/modules/ws-group-manager-core.js`
- Modify: `resources/app/server.mjs`
- Test: `scripts/stage3/ws-group-manager-migration.test.cjs`, `scripts/stage3/ws-group-manager.test.cjs`

**Interfaces:**
- Add version 23 tables only where absent: group message index, read evidence, sync errors/retries, and group audit; retain 015/017/022 as authorities.
- Repository methods must be account scoped and idempotent: `upsertGroupMessage`, `recordReadEvidence`, `recordSyncError`, `appendGroupAudit`, `listGroupState`.
- Read evidence accepts only `unknown|delivered|read`; `read` requires source evidence. Messages are unique by `(account_id,group_jid,message_id)`.

- [x] 运行迁移/服务 failing tests。
- [x] 在临时 SQLite 上实现事务、唯一键、索引、重复提交、乱序事件和 checkpoint 保护。
- [x] 加入 sidecar endpoints only for isolated/mock-capable paths; production gate remains off and no new queue consumer is added。
- [x] 运行 migration runner and group core tests。

### Task 5: Mock WS 群组同步、CRM 关联和任务/日志 API

**Files:**
- Create: `resources/app/modules/ws-group-mock-transport.js`
- Modify: `resources/app/server.mjs`
- Modify: `resources/app/modules/ws-group-manager-core.js`
- Test: `scripts/stage3/ws-group-manager.test.cjs`

**Interfaces:**
- Mock transport exposes deterministic account/group/member/message fixtures only to isolated tests; it never reads real WebView credentials.
- Group service reuses existing `ws_group_catalog`, membership event ledger, `customer_group_memberships`, and CRM authority; controlled creation requires explicit flag and reliable normalized phone.
- Add read-only/list and isolated write endpoints for group state, messages, evidence, errors and audit; all reject missing/foreign account scope.

- [x] 运行 Mock/group/CRM failing tests。
- [x] 实现首次、增量、重复、断点恢复、乱序和改名同步；已存在客户只建关系，多匹配进入 conflict，不覆盖人工字段，缺失渠道为未分类待绑定。
- [x] 运行 group isolation, CRM and API tests。

### Task 6: 页面接入与阶段 4 边界

**Files:**
- Modify: `resources/app/modules/ws-workbench.js`
- Modify: `resources/app/modules/ws-workbench.css`
- Test: `scripts/stage3/ws-workbench-navigation.test.cjs`

**Interfaces:**
- Overview/accounts/groups/members/collection/AI/CRM/tasks/logs/settings pages must display real state and real service results; no placeholder buttons or fixed customer data.
- AI page must display queue/result/evidence/error status and a clear “正式 AI 自动处理未启用” state while stage 4 remains pending.

- [x] 为每个页面补真实 empty/loading/error/disabled states and actions backed by existing services。
- [x] 运行 navigation and relevant UI contract tests。

### Task 7: 受控 Worker/IPC/fencing 接线与测试

**Files:**
- Modify only necessary stage2 adapter/service files after tests identify interface gaps.
- Create: `scripts/stage3/worker-group-isolation.test.cjs`
- Test: existing stage2 runtime tests plus stage3 worker test.

**Interfaces:**
- Group jobs use existing supervisor, IPC identity and fencing boundaries in isolated mode; no formal consumer registration, no production task execution, no dual write.

- [x] 写 failing isolation tests for disabled production path and enabled Mock path。
- [x] Implement the minimal adapter hooks and auditable flags.
- [x] Run Stage2 and Stage3 worker/fencing/IPC tests。

### Task 8: Full verification, reports and commit

**Files:**
- Create: `docs/superpowers/reports/stage3-implementation.md`
- Create: `docs/superpowers/reports/stage3-navigation.md`
- Create: `docs/superpowers/reports/stage3-group-manager.md`
- Create: `docs/superpowers/reports/stage3-migrations.md`
- Create: `docs/superpowers/reports/stage3-tests.md`
- Create: `docs/superpowers/reports/stage3-rollback.md`
- Create: `docs/superpowers/reports/stage3-acceptance.md`

- [x] Run targeted stage3 tests, then `node scripts/run-tests.cjs all` from the current commit.
- [x] Build WinUI x64/win-x64 with the established no-restore command and run `git diff --check`.
- [x] Verify no production DB/WS/formal Worker access, record actual pass/fail/not-tested states, and commit only after the workspace is reviewable.

