# 阶段 1 P0-02：`ai_jobs` Schema 权威与 AI 队列隔离验证

验证日期：2026-11-15
基线：`6e4d195`  〔设计冻结基线〕
范围：AI schema/写入路径只读审计 + 临时 SQLite 回填合同验证。未启动 AI Worker，未调用真实 AI，未修改生产数据库。

## 1. 实际检查文件与入口

- `resources/app/server.mjs:264-299`：`ai_jobs` 内联 `CREATE TABLE`、索引、`lease_token` 补列和启动恢复。
- `resources/app/server.mjs:3129-3211`：AI 入队、claim、checkpoint、complete、fail、lease 校验和重试状态。
- `resources/app/server.mjs:3220-3258`：`ws_ai_analyses` 读取、结果写入和 `analysis_id` 回写。
- `resources/app/server.mjs:3300-3533`：分析结果到 CRM/字段证据/热聊档案/跟进任务的同步边界。
- `resources/app/migrations/008-ws-accounts.sql:107-120`：`ws_ai_analyses` 版本化表。
- `resources/app/migrations/010-ai-customer-governance.sql:1-30`：`ai_customer_field_evidence` 与治理审计。
- `resources/app/migrations/011-hot-chat-profile.sql:31-71`：`hot_chat_events`、`hot_chat_sync_outbox` 既有档案事件/同步 outbox。
- `resources/app/modules/ws-workbench.js`：前端命令入口，不能在切换前继续作为第二事实写入者。
- `scripts/stage1/ai-schema-authority-verification.cjs`：隔离回填和幂等验证程序。

## 2. 生产现状与状态

| 检查项 | 状态 | 证据/结论 |
|---|---|---|
| `ai_jobs` 是否存在内联建表 | Passed | `server.mjs:269` 有唯一 `CREATE TABLE IF NOT EXISTS ai_jobs` |
| `ai_jobs` 是否由版本化迁移管理 | Failed | 005–018 SQL 中没有 `ai_jobs`；结构/补列由 server 启动时处理 |
| AI 入队幂等 | Passed | `(account_id,idempotency_key)` 唯一，重复 enqueue 返回既有 job |
| claim/lease 写保护 | Passed | `lease_token` + 条件更新 + `requireAiJobLease` 已存在 |
| 启动恢复 | DesignOnly | server 启动和 `/api/ws/ai-jobs` 都有 running 恢复逻辑；新 Worker 不能重复执行 |
| `ws_ai_analyses` 历史结果保留 | Passed | 独立版本化表，结果以 `analysis_id` 关联 job |
| AI evidence 唯一性 | Passed | `UNIQUE(customer_id,analysis_id,field_name)`；旧证据缺少 segment/message 时不能伪造 |
| 既有 `hot_chat_sync_outbox` 边界 | DesignOnly | 它是档案同步 outbox，不等同 `ai_jobs`，切换前需单独排空/适配 |
| 新 `ws_ai_outbox` 生产写入 | NotTested | 本轮禁止创建/启用新 outbox 或 Worker |
| AI schema 单一权威 | Failed | 当前业务表由版本化 SQL + server 内联 DDL 两套来源共同维护 |

## 3. 隔离验证命令与实际结果

命令：

```text
node scripts/stage1/ai-schema-authority-verification.cjs
node --check scripts/stage1/ai-schema-authority-verification.cjs
```

结果：退出码 0；临时 SQLite 输出：

```json
{
  "staticAudit": {
    "aiJobsInlineCreateCount": 1,
    "versionedAiJobsMigrations": 0,
    "writeEntrypoints": ["enqueue", "claim", "checkpoint", "complete", "fail", "analysis"],
    "productionAuthority": "Failed"
  },
  "isolated": {
    "historicalJobs": 2,
    "outboxRows": 2,
    "repeatedBackfillIdempotent": true,
    "completedNotRequeued": true,
    "orphanAnalyses": 1,
    "evidenceUniqueness": true,
    "tempClean": true
  }
}
```

隔离验证覆盖：

1. 已完成且有 `analysis_id` 的旧任务回填为 completed，不重新排队。
2. queued 旧任务保持 queued。
3. 同一旧数据重复回填不会重复创建 outbox。
4. 无对应 job 的历史分析被识别为 orphan，不触发模型调用。
5. 相同分析/字段的 evidence 重复插入被唯一约束拒绝。
6. 临时 SQLite 与目录在结束后清理。

## 4. P0 修复建议（未实施）

- 先冻结 `ai_jobs` 真实字段、状态和 lease 语义，再把 DDL 纳入版本化迁移；生产迁移前不得创建第二套并行业务表。
- 历史映射保留旧 job ID、`idempotency_key`、`analysis_id` 和原 payload 哈希；完成/失败/取消历史不得重新执行。
- 新 outbox/attempt/evidence 只能由批准的单一 writer 写入；前端改为命令入口/只读投影，不能同时 PATCH 旧状态。
- `hot_chat_sync_outbox` 保持独立边界，避免把档案同步事件重复投递到 AI outbox。
- 启动恢复逻辑归属单一协调者，旧 server 恢复和新 Worker 恢复不得并行。

## 5. 验收结论

**P0-02：Failed（生产 schema 权威仍分裂）；隔离历史回填合同：Passed；正式 AI Worker 准入：Blocked。**

本报告不授权创建 `ws_ai_outbox`、`ws_ai_attempts` 或启动新 AI Worker。
