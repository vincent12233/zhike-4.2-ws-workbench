# 阶段 0：采集与 AI 队列映射只读审计

审计日期：2026-11-15  
范围：当前 6.0.3 仓库源码、迁移文件、测试夹具和 API 写入路径  
安全边界：只读审计；未打开生产数据库，未创建迁移表，未启动 Worker，未执行双写。

可重复命令：`node scripts/stage0/audit-queue-mapping.cjs --read-only`
审计合同：`node scripts/stage0/audit-queue-mapping.test.cjs` → 通过。

## 1. 现有事实表与队列

| 领域 | 当前权威表 | 关键字段/状态 | 写入路径 |
|---|---|---|---|
| 会话 | `ws_conversations` | `account_id`、`external_id`、`customer_id`、`unread_count`、`data_json` | `/api/ws/conversations` 与采集批次写入 |
| 消息 | `ws_messages` | `direction(receive/send)`、`external_id`、`order_no`、原文/译文 | `/api/ws/messages`、批量 ingest |
| 采集批次 | `ws_ingest_batches` | `(account_id,conversation_id,fingerprint)` 唯一 | 批量 ingest 幂等写入 |
| 采集运行 | `ws_collection_runs` | `created/discovering/running/paused/completed/failed` 等运行状态、`checkpoint`、`cursor`、`resume_count` | `ws-workbench.js` 通过 `/api/ws/collection-runs` |
| 采集项 | `ws_collection_items` | `(account_id,run_id,conversation_id)` 唯一；`queued/running/completed/failed/skipped/skipped_unread/retryable`；`analysis_status`、`coverage_status` | `ws-workbench.js` 通过 `/api/ws/collection-items` |
| AI 任务 | `ai_jobs` | `queued/running/retryable/completed/failed/cancelled`；attempts/max_attempts；lease token；唯一 `(account_id,idempotency_key)` | `ws-workbench.js` 通过 `/api/ws/ai-jobs`；服务端在启动时恢复过期 running |
| AI 结果 | `ws_ai_analyses` | 分析 JSON、confidence、provider/model、error；没有独立状态列 | `/api/ws/analyses`，结果写入与 AI job 完成同一事务 |
| 字段证据 | `ai_customer_field_evidence` | `accepted/conflict/rejected`，客户/分析/字段唯一 | AI 客户治理路径 |
| 跟进提醒 | `ws_followup_alerts` | `open/snoozed/completed/dismissed` 等业务状态、`alert_key` 唯一 | AI 分析后的跟进链路 |

依据：`resources/app/migrations/005-ws-workbench.sql`、`007-ws-collection-followup.sql`、`008-ws-accounts.sql`、`009-ws-resume-alerts.sql`、`010-ai-customer-governance.sql`，以及 `resources/app/server.mjs:264-299,3129-3260,3781-3861`。

## 2. 旧结构到 6.1 目标结构的 provisional 映射

这张表是阶段 0 的审计结果，不是生产 DDL 授权。目标表只有在字段、状态和回滚合同通过审查后才能确定是否复用、改名或建兼容视图。

| 旧来源 | 目标概念 | 建议映射 | 当前阻断点 |
|---|---|---|---|
| `ws_collection_runs` | `ws_collector_jobs` | `id→job_id`；`account_id` 保留；`status`、计数器、错误、创建/更新时间原样保留；`checkpoint/cursor/resume_count` 下沉到 job checkpoint | 运行状态枚举尚未完全冻结；一个旧 run 是否允许拆成多个 job 未定义 |
| `ws_collection_runs.checkpoint/cursor` | `ws_collector_checkpoints` | 按 `account_id + collector_role + conversation/group/source` 分区；保存 cursor、高水位、最后成功时间、fencing token | 当前前台列表采集与后台群监控已有不同 checkpoint 命名空间，不能共用游标 |
| `ws_collection_items` | collector job item / collection fact | `run_id/conversation_id/status/attempts/last_error` 保留为兼容读取；`coverage_status` 映射为完整历史覆盖状态 | item 是任务状态还是采集事实尚未分离；旧状态 `analysis_status` 与 AI 队列存在交叉 |
| `ai_jobs` | `ws_ai_outbox` + `ws_ai_attempts` | `id/account_id/conversation_id/idempotency_key/payload_json`→outbox；attempts、lease、错误、重试时间→attempt 记录 | 当前 attempts 是累计计数，不是每次尝试事实；没有独立 attempt ID/模型输入哈希 |
| `ws_ai_analyses` | analysis result + `ws_ai_evidence` | 分析主体保留兼容视图；`result_json` 中的字段证据拆到 evidence；`confidence/provider/model/error` 保留 | result JSON 内字段形状需逐样本盘点；不能直接把整行当 evidence |
| `ai_customer_field_evidence` | CRM evidence | 保留现有事实表，补充来源消息/segment、模型版本、人工决策和冲突理由 | 现有字段缺少统一 source cursor/segment 关联 |
| `ws_collection_items.analysis_status` | AI outbox projection | `pending→queued`，`completed→completed`，`retryable/failed→对应 AI 状态` | 不能让 `ws_collection_items` 与 `ai_jobs` 同时写状态；需要单一写入者和只读投影 |
| `ws_group_monitor_checkpoints` | group collector checkpoint | 保持独立 namespace：`account + group_monitor_profile + target` | 当前群监控事件可能在 pending/review 时推进 checkpoint，与 6.1 要求冲突 |

## 3. 实际写入者

1. `resources/app/modules/ws-workbench.js` 负责创建/更新 collection run、collection item、AI job、checkpoint 和分析提交。
2. `resources/app/server.mjs` 负责 SQLite 事务、AI lease、重试恢复、分析落库和 run counter 计算。
3. `desktop/src/Zhike.Desktop/Services/LocalQueue.cs` 仍使用 `pending.json` 作为本地桥接队列；它与 SQLite AI 队列是不同链路，不能直接视为同一 outbox。
4. 启动时 `server.mjs` 会把过期 AI `running` 任务恢复为 `retryable/failed`；这属于现有恢复逻辑，不能在新 Worker 上重复执行而造成双重恢复。
5. 前台采集目前直接通过 API 更新 durable collection 表；阶段 0 不能把新 Worker 接到这些生产接口上，否则会形成双写。

## 4. 发现的冲突与风险

- 迁移 runner 在 `server.mjs:102-263` 以硬编码 `if (user_version < N)` 执行至 018；候选 019–030 文件即使存在也不会自动执行。
- `ai_jobs` 在 `server.mjs:264-299` 内联创建，不在迁移文件中；目标 021 必须先决定是扩展该表、拆分为 outbox/attempts，还是建立只读兼容视图。
- `ws_ai_analyses` 没有独立状态列，结果是否已应用只能结合 `ai_jobs.analysis_id`、error 和证据表判断。
- `ws_collection_items` 同时承载采集状态、历史覆盖状态、AI 状态和跟进状态，直接拆表会影响现有 UI 和清理逻辑。
- `ws_collection_items` 的状态更新来自前台 JS，目标单写入者切换前必须停用或只读化这些路径。
- `ws_ai_analyses` 与 `ai_jobs` 的重试/替换逻辑会把旧任务标记 failed；映射时必须保留原任务和原分析，不能重新排队造成重复 AI 调用。
- `ws_group_monitor_checkpoints` 与会话采集 cursor 必须按角色/来源分区；共用 account cursor 会造成回退或跳过。
- 旧导出/导入路径的对象集合与目标设备包不对称，队列审计记录不能仅靠 manifest 名称推断已恢复。

## 5. 阶段 0 结论

当前可以安全开展的工作只有：

- 在临时 SQLite 中建立 Worker/IPC 可行性探针。
- 对脱敏副本做只读 schema、状态分布、唯一键、孤儿记录和映射校验。
- 生成旧/目标双读对账器，但不写生产数据库。

当前不能做：

- 创建 019–030 生产迁移表。
- 修改 `server.mjs` 的生产写入者。
- 让新 Worker 连接真实 WS 账号或真实客户数据库。
- 通过双写“验证”映射。

