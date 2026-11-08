# 热聊客户资料与稳定性升级实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:test-driven-development for every implementation task. Each task must follow RED → GREEN → regression.

**Goal:** 在不改变知客现有客户、跟票、入金、VIP、统计和 WS 业务规则的前提下，增加热聊客户结构化档案、自然聊天建议、颜色分层、AI 证据同步，并补齐 12 项稳定性/性能/运维升级。

**Scope:** 现有 `resources/app` 离线桌面链路与 `server/` PostgreSQL v2 链路同时支持；SQLite 为离线事实源，配对后通过幂等 outbox 增量同步；档案证据按客户×WS账号×会话保存，客户主资料只补空字段。

**Workspace ruling:** 当前 `project-review` 是脱离用户真实目录的项目副本。Windows worktree checkout 在本仓库产生未完成初始化标记，因此不再创建嵌套 worktree；实现分支 `feature/hot-chat-profile-upgrade` 保持在该副本内，真实数据目录不参与测试。

## 文件与接口地图

- `resources/app/modules/hot-chat-profile-core.js`：纯函数字段契约、完整度、颜色、缺口、自然话题、未回复判断和状态机。
- `resources/app/modules/ws-workbench-core.js`：扩展 AI 解析与上下文合并，不重复实现身份匹配。
- `resources/app/modules/customer-governance-core.js`：扩展字段映射、证据和冲突保护。
- `resources/app/migrations/011-hot-chat-profile.sql`：SQLite 档案/字段/事件/outbox 结构。
- `resources/app/server.mjs`：SQLite payload、迁移读取和 `/api/ws/hot-chat-profiles`、字段确认、事件、诊断端点。
- `resources/app/modules/ws-workbench.js`、`resources/app/app.js`：WS 辅助栏、热聊页、客户详情和首页雷达。
- `server/migrations/011-hot-chat-profiles.sql`：PostgreSQL 对应表、索引、版本记录。
- `server/src/Zhike.Contracts/*`、`server/src/Zhike.Infrastructure/Repositories/HotChatProfileRepository.cs`、`server/src/Zhike.Api/Routes/HotChatRoutes.cs`：v2 DTO、事务仓储和路由。
- `server/src/Zhike.Worker/Providers/HttpAiAnalysisProvider.cs`、`server/src/Zhike.Worker/Workers/AiAnalysisWorker.cs`：AI 输出契约、脱敏、重试与死信。
- `tests/hot-chat-profile-core.test.cjs`、`tests/hot-chat-profile-api.test.cjs`、`tests/hot-chat-profile-ui.test.cjs`：本地红绿测试。
- `tests/server-v2/hot-chat-profile.test.cjs`：PostgreSQL migration/API/worker 契约。
- `docs/hot-chat-profile-usage.md`、`docs/release-notes-5.2.0.md`：使用说明、迁移/回滚、已知限制和未验证门禁。

## Task 1 — 热聊档案纯函数与 AI 输出契约（RED → GREEN）

1. 写 `tests/hot-chat-profile-core.test.cjs` 的失败测试，覆盖 13 个字段归一化、证据必需、完整度、颜色优先级、人工锁定、自然话题选择、未回复冷却和敏感资料脱敏。
2. 运行测试并确认在缺少模块时失败。
3. 实现 `hot-chat-profile-core.js`：`PROFILE_FIELDS`、`normalizeProfileFact`、`mergeEvidence`、`computeCompleteness`、`deriveStatusColor`、`deriveNextTopics`、`assessNoReply`、`applyManualOverride`、`buildEvent`。
4. 扩展 `ws-workbench-core.parseAiResult` 解析 `profileFacts/missingFields/naturalNextTopics/customerTemperature/statusColor`，低置信度不得自动补库。
5. 扩展 `customer-governance-core` 的字段映射和 evidence key，保留人工值与冲突。
6. 运行核心测试与现有 `ws-workbench-core`、`ws-crm-sync-core`、`customer-governance-core`，提交 `feat: add hot chat profile core contract`。

## Task 2 — SQLite 迁移、事务 API 和本地 outbox

1. 先写 `tests/hot-chat-profile-api.test.cjs` 失败测试：迁移幂等、按 account/conversation 隔离、字段证据去重、确认/拒绝/人工锁定、颜色事件、outbox 重试和版本冲突。
2. 新增 `resources/app/migrations/011-hot-chat-profile.sql`，创建 `hot_chat_profiles`、`hot_chat_profile_fields`、`hot_chat_events`、`hot_chat_sync_outbox` 及索引，不修改旧表字段含义。
3. 在 `server.mjs` 增加 account-scoped payload 和路由：GET/PUT profile、POST facts/confirm、POST events、GET diagnostics；所有写入单事务并带 `X-State-Version`。
4. 将 AI CRM 同步接入热聊档案：先写证据和 outbox，再只补客户空字段；重复消息、重复分析和重复提醒必须幂等。
5. 运行 API、迁移、治理和备份恢复测试，提交 `feat: persist hot chat profiles locally`。

## Task 3 — PostgreSQL v2 迁移、DTO、仓储与同步

1. 先写 `tests/server-v2/hot-chat-profile.test.cjs` 失败测试：迁移 011、唯一键、字段状态机、客户×账号×会话隔离、fill-empty、冲突、outbox 和回滚。
2. 新增 `server/migrations/011-hot-chat-profiles.sql`，包含 JSONB 值、证据引用、版本列、索引、审计事件和 outbox。
3. 扩展 Contracts、`HotChatProfileRepository` 和 `HotChatRoutes`；Postgres 事务失败不得产生半条档案或半条客户更新。
4. 把 v2 `CustomerDto` 增加兼容的 hot/color/tags/profileSummary 投影，但不改变旧业务记录 API。
5. 运行 server-v2 全套契约、迁移 dry-run 和隔离恢复测试，提交 `feat: add postgres hot chat profile sync`。

## Task 4 — AI Worker、自然话题和跟进提醒闭环

1. 先写 worker/provider 失败测试：结构化 JSON、敏感字段脱敏、低置信度 pending、超时重试、额度错误、死信、提醒冷却和 dedupe key。
2. 将 AI prompt 固定为“从聊天自然推断，不生成调查问卷”，要求证据、缺口、下一话题、不回复原因和提醒计划。
3. 扩展 `HttpAiAnalysisProvider` 与 `AiAnalysisWorker`，兼容 TeamoRouter/OpenAI provider，Key 只从现有安全存储读取。
4. 将 `hot_chat_profiles` 更新、客户 fill-empty、followup outbox、颜色事件放入同一事务；人工锁定字段不得被 AI 改写。
5. 运行 server-v2 AI、outbox、security-backup 和本地 AI 核心测试，提交 `feat: automate natural hot chat followups`。

## Task 5 — 热聊管理、WS 辅助栏和客户详情 UI

1. 先写 `tests/hot-chat-profile-ui.test.cjs` 失败测试：资料完成度、颜色筛选、已知/缺失字段、证据、下一话题、人工锁定和不回复状态可见。
2. 热聊管理增加档案状态列、颜色筛选、缺口筛选和下一话题入口；颜色只表达沟通状态，不替代客户评级。
3. WS 右侧 AI 面板增加“本次新增事实、待确认、缺口、自然话题、下一次跟进”，不显示连续问卷。
4. 客户详情增加热聊档案卡片和证据抽屉；人工编辑后写锁定事件，支持解除锁定和回滚。
5. 首页 AI 雷达与 AI 跟进页复用同一 profile 状态，避免重复查询和重复提醒。
6. 运行 UI、视觉、无障碍和全量 Node 测试，提交 `feat: expose hot chat profile workflow`。

## Task 6 — 12 项稳定性、性能和运维升级

1. 写失败回归：关闭前大状态 flush、共享状态轮询退避、容量告警、诊断错误分类、账号启动恢复、导入置信度和 WebView2 运行时检查。
2. 在 `app.js/main.cjs` 增加写入日志/flush grace period/崩溃恢复提示，轮询改为版本探测与可见性退避；保持自动备份不误删其他文件。
3. 为 10k/50k+ 列表启用分页/虚拟化和后台分批导入；接近客户/手机号/导入上限时明确提示，不静默截断。
4. WS 桥接错误分为未配对、网络、会话过期、页面结构变化和服务异常，并提供重试/诊断入口；多账号状态恢复继续隔离。
5. Docker/Postgres 增加启动内存/磁盘/迁移锁检查、恢复演练和脱敏诊断；安装脚本增加 WebView2/runtime 检查、升级回滚说明和代码签名占位门禁。
6. 运行稳定性、性能、备份恢复、安装契约和全量回归，提交 `perf: harden hot chat runtime and operations`。

## Task 7 — 文档、现场验收和发布包

1. 写使用说明：如何让 AI 自然补齐资料、如何看颜色、如何确认冲突、如何处理不回复客户。
2. 写迁移/回滚/备份说明和真实 WS/AI 现场验收清单；明确 fixture 测试不等于真实 WhatsApp 通过。
3. 运行 `node scripts/run-tests.cjs all`、`node tests/server-v2/run-all.cjs`、Docker 隔离 smoke、WinUI Release build、installer/package contract。
4. 在隔离 `LOCALAPPDATA` 下验证首页、热聊、WS 三栏、客户详情、空状态、缩放和关闭保存；不使用真实数据。
5. 生成版本号、更新记录、安装包、源码包、manifest 和 SHA256，提交 `release: hot chat profile upgrade`。

## 全局完成门槛

- 每个 Task 都有先失败后通过的测试记录。
- 全量 Node 与 server-v2 测试通过，且所有新增迁移可重复执行和回滚。
- 现有客户、跟票、入金、VIP、统计、导入和备份契约无回归。
- 真实 WS/手机同步、真实 AI 额度、代码签名和换机安装若未执行，必须列为未验证，不得写成已通过。

