# 阶段 1 前置冻结：WS 采集与 AI 队列逐字段映射

审计日期：2026-11-15  
审计基线：知客 6.0.3，提交 `68749e4` 之后的工作区  
安全边界：只读源码/迁移审计；未打开运行时客户数据库，未创建 019–030 表，未连接真实 WS，未启用 Worker，未执行双写。

## 1. 事实源与真实写入者

当前迁移链由 `resources/app/server.mjs:99–263` 以内联 `PRAGMA user_version` 分支执行，最高分支为 018；迁移文件实际为 `005–018`（缺少 012 文件名但 runner 内有 012 逻辑）。`ai_jobs` 在 `resources/app/server.mjs:269–299` 内联创建，未由版本化 SQL 管理。

当前写入者：

- `resources/app/modules/ws-workbench.js`：通过 `/api/ws/collection-runs`、`/api/ws/collection-items`、`/api/ws/ai-jobs`、`/api/ws/analyses` 驱动采集、AI 入队和结果提交。
- `resources/app/server.mjs`：执行 SQLite 事务、状态校验、AI 租约、重试恢复、分析落库和跟进提醒生成。
- `desktop/src/Zhike.Desktop/Services/LocalQueue.cs`：仍有独立 `pending.json` 本地桥接队列；它不是 `ai_jobs` 的同一事实源。

阶段 1 的目标是把前端改成只读投影/命令入口，由单一 Worker 写入事实表。完成切换前不得让两条路径同时写同一逻辑任务。

## 2. 当前表结构逐字段清单

### 2.1 `ws_collection_runs`

来源：`resources/app/migrations/008-ws-accounts.sql:151–168`、`resources/app/migrations/007-ws-collection-followup.sql:1–40`。

| 当前字段 | 类型/约束 | 业务含义 | 目标 `ws_collector_jobs` 映射 |
|---|---|---|---|
| `id` | TEXT PK | 采集运行标识 | `job_id`，保持原值；不得按会话重建 |
| `account_id` | TEXT FK `ws_accounts` | WS 账号范围 | `account_id`，必填 |
| `status` | TEXT | `created/discovering/running/paused/completed/failed` 等运行状态 | `state`，使用显式状态转换表 |
| `total` | INTEGER | 任务总量 | `total_count`，兼容投影 |
| `discovered` | INTEGER | 已发现会话量 | `discovered_count` |
| `completed` | INTEGER | 已完成采集量 | `completed_count` |
| `analyzing` | INTEGER | 采集项处于分析阶段的计数 | 只读派生指标，不作为 Worker 事实状态 |
| `analyzed` | INTEGER | 已有完成分析的项数 | 只读派生指标 |
| `failed` | INTEGER | 失败项数 | 只读派生指标；失败事实在 item/attempt |
| `skipped` | INTEGER | 跳过项数 | 只读派生指标，需区分未读/群组/未知 |
| `retryable` | INTEGER | 可重试项数 | 只读派生指标 |
| `last_error` | TEXT | 最近错误摘要 | `last_error`，脱敏并限长 |
| `checkpoint` | TEXT | 旧批次 checkpoint | 不直接作为新游标；回填到分区 checkpoint |
| `cursor` | TEXT | 采集游标（009 后） | `source_cursor` |
| `resume_count` | INTEGER | 恢复次数 | `resume_count` |
| `last_success_at` | TEXT | 最近成功时间 | `last_success_at` |
| `created_at/updated_at` | TEXT | 审计时间 | 原样保留 |

唯一键只有 `id`；旧 007 在迁移 008 中重建为按账号隔离的表。目标必须增加 `account_id + collector_role + source_scope` 的唯一任务/租约边界，不能用 `id` 单独防并发。

### 2.2 `ws_collection_items`

来源：`resources/app/migrations/008-ws-accounts.sql:170–194`、`resources/app/migrations/007-ws-collection-followup.sql:17–40`、payload 映射 `resources/app/server.mjs:1731–1732`。

| 当前字段 | 类型/约束 | 目标映射 |
|---|---|---|
| `id` | TEXT PK | `job_item_id` |
| `account_id` | TEXT FK | `account_id` |
| `run_id` | TEXT FK `ws_collection_runs` | `job_id` |
| `conversation_id` | TEXT FK `ws_conversations` | `conversation_id`，保持历史关联 |
| `status` | TEXT | `item_state`；现有 `queued/running/completed/failed/skipped/skipped_unread/retryable/skipped-group` 必须逐一转换 |
| `attempts` | INTEGER | 采集尝试累计值；新结构应拆出 attempt 事实 |
| `analysis_status` | TEXT | 当前与 AI 队列交叉的投影字段；切换后只读 |
| `followup_status` | TEXT | 跟进投影；事实在 `ws_followup_alerts`/任务域 |
| `next_followup_at` | TEXT | 跟进投影 |
| `last_error` | TEXT | 最近错误 |
| `checkpoint` | TEXT | 会话级采集 checkpoint；需按 source cursor 分区 |
| `coverage_status` | TEXT | `unknown/full-history/excluded-group/read-history-direction-unresolved` 等覆盖状态 |
| `created_at/updated_at` | TEXT | 审计时间 |

唯一键：`UNIQUE(account_id, run_id, conversation_id)`；外键删除会级联。目标不能把同一 `conversation_id` 在不同 source/collector role 下强行合并；应保留历史 item 并由新任务映射表关联。

### 2.3 `ai_jobs`

来源：`resources/app/server.mjs:269–299`、payload `server.mjs:1752–1770`。

| 当前字段 | 类型/约束 | 目标 `ws_ai_outbox` / `ws_ai_attempts` |
|---|---|---|
| `id` | TEXT PK | `outbox_id`，原值保持 |
| `account_id` | TEXT NOT NULL | `account_id` |
| `conversation_id` | TEXT NOT NULL | `conversation_id` |
| `idempotency_key` | TEXT NOT NULL；`UNIQUE(account_id,idempotency_key)` | `dedupe_key`，保持原值并记录规范化版本 |
| `payload_json` | TEXT | 输入快照引用；目标拆为 `input_ref/input_hash`，原文不能无证据重写 |
| `status` | TEXT | `queued/running/retryable/completed/failed/cancelled` |
| `attempts` | INTEGER | 当前累计次数；目标由 attempt 事件累计 |
| `max_attempts` | INTEGER DEFAULT 5 | `max_attempts` |
| `next_attempt_at` | TEXT | `next_retry_at` |
| `locked_at` | TEXT | 租约开始时间 |
| `lease_token` | TEXT | 当前版本 fencing/lease；旧值只用于审计，不直接复用 |
| `last_error` | TEXT | 脱敏错误摘要 |
| `analysis_id` | TEXT | 完成结果引用 `ws_ai_analyses.id` |
| `created_at/updated_at` | TEXT | 审计时间 |

当前索引：`idx_ai_jobs_claim(account_id,status,next_attempt_at,updated_at)`、`idx_ai_jobs_conversation(account_id,conversation_id,created_at)`（`server.mjs:286–287`）。

### 2.4 `ws_ai_analyses`

来源：`resources/app/migrations/008-ws-accounts.sql:107–124`、`server.mjs:1551`、`server.mjs:3249`。

| 当前字段 | 目标 |
|---|---|
| `id` PK | `analysis_id`，保持原值 |
| `account_id`、`conversation_id` | 原样保留并作为证据范围 |
| `result_json` | 结果快照；拆分字段证据前保留原 JSON |
| `confidence` | 分析级置信度 |
| `provider_name`、`model` | 模型和提供方版本 |
| `error_message` | 分析错误；空值才表示无错误 |
| `created_at`、`updated_at` | 审计时间 |

当前没有独立状态列，完成状态依赖 `ai_jobs.analysis_id`、`error_message` 和证据表联查。目标必须提供兼容视图，不能直接删除旧结果。

### 2.5 `ai_customer_field_evidence`

来源：`resources/app/migrations/010-ai-customer-governance.sql:1–18`、`server.mjs:1963–1970`。

字段：`id`、`customer_id`、`conversation_id`、`analysis_id`、`field_name`、`value_json`、`confidence`、`source_text`、`status(accepted/conflict/rejected)`、`created_at`、`updated_at`；唯一键为 `UNIQUE(customer_id, analysis_id, field_name)`。

目标 `ws_ai_evidence` 必须保留客户/分析/字段唯一关系，并增加 `message_id/segment_id/input_hash/model_version/decision_source`。旧记录缺少这些字段时只能标记 `legacy_unscoped`，不能伪造消息证据。

### 2.6 `ws_followup_alerts`

来源：`resources/app/migrations/009-ws-resume-alerts.sql:6–26`、`server.mjs:1751`、`server.mjs:3914–3950`。

字段：`id` PK、`account_id`、`conversation_id`、`analysis_id`、`alert_key`、`priority`、`reason`、`followup_time`、`status`、`snoozed_until`、`data_json`、`created_at`、`updated_at`。

唯一键：`UNIQUE(account_id, alert_key)`；索引：`idx_ws_followup_alerts_queue(account_id,status,followup_time,updated_at)`。目标任务中心继续复用该事实表或兼容视图；`ws_collection_items.followup_status` 只能作为投影。

### 2.7 采集事实、批次和既有档案 outbox

这些表不是新的 Worker 队列表，但它们决定历史关联、幂等和回填结果，必须纳入双读对账：

| 当前表 | 真实关键字段/唯一键 | 目标关系 |
|---|---|---|
| `ws_conversations` | `id` PK；`UNIQUE(account_id,external_id)`；`customer_id`、`unread_count`、`last_message_at` | 采集任务的会话事实；保留原会话 ID，`external_id` 是来源身份，不得用标题替代 |
| `ws_messages` | `id` PK；`(account_id,conversation_id,external_id)` 条件唯一索引；`direction`、`order_no`、原文/译文、翻译状态 | 完整历史消息事实；`receive` 和 `send` 都必须回填，不能只迁移客户发送方向 |
| `ws_ingest_batches` | `id` PK；`UNIQUE(account_id,conversation_id,fingerprint)`；`message_ids_json`、inserted_count | 批次幂等/断点证据；同 fingerprint 重放返回既有批次，不重复插消息 |
| `hot_chat_profiles` / `hot_chat_profile_fields` | profile 身份 `UNIQUE(customer_id,account_id,conversation_id)`；字段 `UNIQUE(profile_id,field_key)` | AI 档案投影和人工锁定字段；不生成第二客户主档 |
| `hot_chat_events` | `id` PK；`UNIQUE(profile_id,idempotency_key)` 条件索引 | AI/人工档案事件历史；缺消息证据的旧事件标记 legacy，不伪造证据 |
| `hot_chat_sync_outbox` | `id` PK；`UNIQUE(event_id)` 条件索引；`pending/processing/sent/failed`、attempts、next_attempt_at | 现有热聊档案同步 outbox；不能与 `ai_jobs` 合并或被新 Worker 重复投递 |

`ws_messages` 的 `send` 行必须与 `receive` 行使用同一 `conversation_id` 和消息外部 ID 规则；任何仅有列表预览、没有消息原文的记录只能标记为覆盖不足，不能标记完整历史或进入“分析已完成”。`hot_chat_sync_outbox` 的 `event_id` 和 `hot_chat_events` 仍需保留原引用；新 AI outbox 不得吞并这条已有同步链路，除非另有经批准的兼容适配器。

## 3. 状态转换冻结表

| 旧状态 | 新状态 | 规则 |
|---|---|---|
| run `created/discovering` | `Queued` | 未开始处理；不创建 AI 任务 |
| run `running` | `Running` | 存在有效 job lease |
| run `paused` | `Paused` | 用户暂停或断线；保留 cursor |
| run `completed` | `Completed` | 所有 item 已得到终态或明确跳过 |
| run `failed` | `Failed` | 不可恢复或超过政策阈值 |
| item `queued` | `Queued` | 等待采集 |
| item `running` | `Running` | 仅持有有效 fencing lease |
| item `retryable` | `RetryPending` | next retry 到期后重新 claim |
| item `failed` | `Failed` | 采集失败；若 AI 尚未执行不得误标完成 |
| item `skipped_unread` | `SkippedUnread` | 未读会话严格跳过，永不自动打开 |
| item `skipped-group/skipped` | `SkippedExcluded` | 群组或规则排除，保留原因 |
| AI `queued` | `Queued` | outbox 待 claim |
| AI `running` | `Running` | 只有有效 lease token 可更新 |
| AI `retryable` | `RetryPending` | 指数退避，attempt 递增 |
| AI `completed` | `Completed` | analysis 结果已落库并关联 |
| AI `failed` | `Failed/DeadLetter` | `attempts >= max_attempts` 才是 DeadLetter |
| AI `cancelled` | `Cancelled` | 用户/规则取消，禁止自动复活 |
| evidence `accepted/conflict/rejected` | `Accepted/ReviewRequired/Rejected` | 低置信度和冲突进入人工队列 |

状态转换必须由 Worker/sidecar 事务执行；前端只能发送命令，不能直接 PATCH 任意状态组合。

## 4. 历史关联、幂等键与 checkpoint

1. `ws_collection_runs.id` → `ws_collection_items.run_id` → `conversation_id` → `ws_conversations.account_id` 是采集历史主链；回填必须保留原 ID，不得用显示标题重建。
2. `ai_jobs.analysis_id` → `ws_ai_analyses.id` → `ai_customer_field_evidence.analysis_id` 是 AI 结果链；缺失分析引用的 job 标记 `OrphanedAnalysis`，不重新调用模型。
3. 跟进链为 `ws_followup_alerts.analysis_id` → `ws_ai_analyses.id`，`alert_key` 保持全局账号内幂等；重复提醒只更新现有提醒。
4. 采集幂等键优先使用平台消息/会话 ID；批次使用现有 `(account_id,conversation_id,fingerprint)`；不能用显示文本或时间近似去重。
5. AI 幂等键保持 `(account_id,idempotency_key)`，新 outbox 另存 `input_hash`；同键不同输入必须进入冲突报告，不覆盖旧任务。
6. checkpoint 按 `account_id + collector_role + source_scope + conversation/group` 分区。普通聊天采集、完整历史和群组监测不能共用 cursor。
7. checkpoint 只有在事实写入、关联成功、事务提交后推进；`ReviewRequired`、`Pending`、`Conflict` 不得越过 checkpoint。重放必须可安全幂等。

## 5. 回填与无法自动映射

回填顺序：先在脱敏副本建立快照 → 统计行数/状态/孤儿/重复键 → 写入临时目标结构 → 双读对账 → 生成差异报告 → 仅在批准后切换 feature flag。回填不得触发 WS、AI、客户字段更新或消息发送。

无法自动映射的记录：

- 旧 item 缺失 `account_id/run_id/conversation_id`：`UnmappedCollectionItem`，只读保留。
- 同一 `(account_id,idempotency_key)` 对应不同 payload/input hash：`QueueConflict`，人工处理。
- `ws_ai_analyses` 无对应 `ai_jobs`：`OrphanedAnalysis`，保留结果，不重复调用。
- evidence 缺少消息/segment 证据：`LegacyUnscopedEvidence`，禁止自动覆盖人工字段。
- followup alert 缺失 analysis 或 conversation：`OrphanedFollowup`，不生成新提醒。
- item 状态与 analysis/followup 状态互相矛盾：`StateConflict`，不自动纠正。
- checkpoint 缺失或跨 collector role：`CheckpointNeedsReview`，从安全起点重新扫描。

## 6. 双读与 feature flag 切换方案

### 双读阶段

只读适配器同时查询旧表和临时目标投影，按账号、run/job、conversation、时间区间和状态比较：数量、主键集合、状态、游标、attempt、analysis 引用、followup 引用和哈希。要求零未解释差异；允许的差异必须在批准的转换表中列出。

### Flag 状态

- `legacy-writer`：6.0.3 前端/sidecar 唯一写入者，Worker 不启动。
- `dual-read`：旧事实表写入保持不变，目标只读投影，Worker 不执行生产任务。
- `worker-shadow`：仅隔离/脱敏环境运行 Worker，结果写临时库，不触碰生产。
- `worker-canary`：经审批的测试账号范围，旧写入暂停，Worker 单写入；失败可退回 `legacy-writer`。
- `worker-primary`：全量切换；前端 API 仅发命令和订阅投影。

禁止 `legacy-writer + worker-primary` 同时对同一逻辑任务写入。切换必须有写入世代号、租约撤销、旧客户端拒绝和审计事件。回滚先停止 Worker、隔离新任务、确认未提交 lease，再恢复旧 writer；不能只关闭 UI flag。

## 7. 阶段 1 准入阻断项

- 需要把 019–030 目标迁移改为真实版本链，并决定复用旧表、兼容视图或受控重建；当前 runner 最高只到 018。
- `ai_jobs` 的内联建表和启动恢复必须纳入版本化迁移和单写入者策略。
- `ws_collection_items` 当前同时承载采集、AI、跟进三种状态，必须先冻结拆分/投影关系。
- `LocalQueue.pending.json` 与 SQLite `ai_jobs` 是两条队列，必须定义桥接和收敛顺序。
- 未完成上述映射审查前，不创建目标生产表，不启用 Worker，不做双写。

本报告是阶段 1 前置设计冻结材料，不构成生产迁移授权。
