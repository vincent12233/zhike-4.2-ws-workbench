# P0-02 AI Schema Consolidation

## 权威结论

ai_jobs 的 schema 权威已收敛到 resources/app/migrations/020-ai-schema-authority.sql。resources/app/server.mjs 不再执行 CREATE TABLE ai_jobs、索引 DDL 或启动时 lease ALTER TABLE，也不再无条件把所有 running 任务改回 queued。

保留的状态集合：

queued、running、retryable、completed、failed、cancelled

保留的 15 个字段：

id, account_id, conversation_id, idempotency_key, payload_json, status, attempts, max_attempts, next_attempt_at, locked_at, lease_token, last_error, analysis_id, created_at, updated_at

唯一键：UNIQUE(account_id,idempotency_key)。claim/conversation 索引和原有 ws_ai_analyses、ai_customer_field_evidence 结构继续保留。

## 兼容行为

- 旧表缺失 lease_token 的隔离库通过迁移兼容钩子补齐，不清空任务。
- 已完成/失败/取消历史不被重排。
- 过期 lease 仅在 /api/ws/ai-jobs claim/recovery 入口按 attempts/max_attempts 转为 retryable 或 terminal failed，保留 attempt、错误和分析引用。
- 普通 WS AI 队列仍使用既有 ai_jobs，没有启用新的 outbox 或第二写入者。

## 验证

~~~
node scripts/stage1/ai-schema-authority-verification.cjs
{"ok":true,"scope":"isolated-only","productionDatabaseOpened":false,
 "productionWorkerStarted":false,
 "staticAudit":{"status":"Passed","inlineCreate":0,"inlineLeaseAlter":0,
 "authoritativeMigration":"020-ai-schema-authority.sql","fieldCount":15},
 "isolated":{"status":"Passed","duplicateIdempotencyRejected":true,"tempClean":true}}

node scripts/stage1/p0-02-ai-schema-implementation.test.cjs
... "isolated-legacy-schema-migration": "Passed",
legacy user_version 19 -> 22; lease column and P0 indexes present

node tests/ai-queue-contract.test.cjs
AI durable queue contract: idempotent enqueue, restart recovery, claim, backoff and stats passed
~~~

## 数据和回滚

隔离迁移保留历史 job、analysis 和 evidence；冲突或 checksum 错误停止，不删除旧表。生产迁移未执行；后续如获批准，必须先备份、临时库演练、对账后再原子替换。

## 限制

没有启动 AI Worker、真实 provider 或真实 WS；没有启用 ws.ai.outbox.v1。P0-02 表示 schema/兼容实现已通过隔离门禁，不表示生产队列已经切换。

## 提交

d156a7a fix: enforce AI CRM and group identity authority
