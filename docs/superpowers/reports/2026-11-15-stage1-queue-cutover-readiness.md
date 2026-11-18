# 阶段 1 队列切换准入报告

验证日期：2026-11-15
基线：`6e4d195`
结论：**Not Ready / Blocked**；本报告不启动迁移、不创建新生产队列表、不执行双写。

## 1. 旧事实与新设计映射状态

| 旧事实 | 当前真实位置 | 目标映射 | 状态 |
|---|---|---|---|
| 采集运行 | `ws_collection_runs`（`resources/app/migrations/007-ws-collection-followup.sql`、008 account rebuild） | collection run/outbox 的 run 事实，保留旧 `id`、account、status、cursor/checkpoint、统计 | DesignOnly；状态/字段混合，未回填 |
| 采集项 | `ws_collection_items` | 一个 conversation item + durable source/checkpoint，保留 `run_id`、`conversation_id`、coverage、attempts | DesignOnly；旧表同时承载采集/AI/跟进状态 |
| 旧 AI 队列 | `ai_jobs`（`resources/app/server.mjs:269-299` 内联 DDL） | 新 AI outbox 的兼容输入；保留 job id、idempotency key、payload hash、analysis_id、最终状态 | **Blocked**；schema 权威未统一 |
| AI 分析结果 | `ws_ai_analyses`（008） | `ws_ai_evidence`/分析结果只读关联；完成/失败历史不可重排 | DesignOnly；隔离回填合同通过 |
| 治理证据 | `ai_customer_field_evidence`（010） | evidence ledger，按 `(customer_id,analysis_id,field_name)` 唯一 | Passed（现有约束）；不允许旧分析伪造缺失 segment/message |
| 热聊同步 outbox | `hot_chat_sync_outbox`（011） | CRM 档案同步边界，不能误当 AI outbox | DesignOnly；需独立排空/适配 |
| 前端队列 | `resources/app/modules/ws-workbench.js`、`resources/app/app.js` | 只读命令入口；最终写入由单一协调者完成 | **Blocked**；前端仍是现有写入路径 |
| 桌面旧桥接队列 | `desktop/src/Zhike.Desktop/Services/LocalQueue.cs` 的 `%LOCALAPPDATA%\\Zhike6\\queue\\pending.json` | 迁移期只读/排空；切换前停止写入或形成明确死信 | **Blocked**；不能与新 Worker 并存写入 |

## 2. 状态和幂等合同

冻结前必须逐字段保留：

- 主键：旧 `run.id`、`item.id`、`ai_jobs.id`、`analysis_id` 不重写；新 outbox 只保存兼容外键。
- 幂等键：沿用 `ai_jobs(account_id,idempotency_key)`、消息 external uniqueness、群事件 `idempotency_key`；不能以显示名或时间近似替代。
- 状态：`queued/running/retryable/completed/failed/cancelled` 需要显式转换表；完成/失败历史不可因回填重新进入 queued。
- checkpoint：按 account + collector role + conversation/group/source 分区；事实、关系、审计或 durable review 事务提交后才推进。
- 重试：只重试明确 `retryable`；过期 lease 由协调者恢复；旧 holder 使用 fencing 拒绝提交。
- 失败恢复：保留原 payload、错误、attempts、checkpoint、analysis_id；迁移失败恢复快照，不靠关闭 UI flag。

## 3. 双读与 feature flag

依据 `2026-11-15-stage1-feature-flag-double-read-plan.md`：

1. `legacy` 默认开启，保持现有生产路径。
2. `shadow` 只读：新映射读取同一事实并生成差异，不触发 AI、建档、群状态修改、发送或 checkpoint 推进。
3. `worker` 只有单写入所有权、fencing、迁移/回滚演练和测试工作区 canary 通过后才允许评估。
4. 任何切换前必须证明旧前端/`LocalQueue` 已停写、in-flight 已 drain、旧租约已撤销；不得新旧队列同时写同一事实。
5. 回滚顺序：停 Worker → 撤销 lease/fencing → 关闭 flag → 隔离新 outbox → 恢复快照/兼容读取。

## 4. 当前准入缺口

- P0-01/P0-02 生产 schema 和迁移权威未通过。
- P0-03/P0-06 CRM/群组关系唯一键和来源稳定 ID 未通过。
- P0-04 正式 WinUI 集成未测；P0-05 生产 writer fence 未接入。
- 没有可证明的旧队列停写、单写入者 lease、checkpoint 原子提交和升级回滚演练。

因此本报告状态为 **Blocked**，不得进入正式阶段 1 实施。

## 5. 本轮审计命令

```text
node scripts/stage0/audit-queue-mapping.cjs --read-only
node scripts/stage1/migration-runner-verification.cjs
node scripts/stage1/ai-schema-authority-verification.cjs
node scripts/stage1/sqlite-fencing-verification.cjs
```

结果分别确认当前生产 runner 上限为 018、`ai_jobs` 仍内联、历史回填隔离合同可幂等、旧 fencing 在临时库被拒绝；这些结果不授权切换生产 writer。
