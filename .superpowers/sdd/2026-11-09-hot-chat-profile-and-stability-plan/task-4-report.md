# Task 4 report — AI Worker、自然话题和跟进提醒闭环

## 状态

实现已提交：`dce1b1f`（与当时已暂存的 Task 3/UI 文件一起提交；发布前须按最终合并树复核）。后续稳定性、上下文和提醒并发补丁分别为 `9606fc4`、`4b692ce`、`b3c8765`、`643223a`、`e210f19`、`733529f`。

## RED → GREEN

先新增 `tests/server-v2/ai-hot-chat-worker.test.cjs`，在旧实现上运行失败，首个失败点为 Provider 缺少 `BuildPrompt`/自然聊天输出契约。随后补齐实现并运行：

```text
node tests/server-v2/ai-hot-chat-worker.test.cjs
server-v2 AI hot-chat worker contract: natural profile, safety and reminder gates pass
node tests/server-v2/ai-unconfigured.test.cjs
ai-unconfigured: no-key jobs defer without empty customer sync and remain resumable
node tests/server-v2/ai-provider-lifetime.test.cjs
ai-provider-lifetime: successful AI JSON values outlive the parser document
node tests/server-v2/outbox-idempotency.test.cjs
outbox/idempotency pipeline: duplicate, ordering, retry, dead-letter, AI merge and follow-up dedupe pass
node tests/server-v2/ws-ai-context.test.cjs
ws-ai-context: bounded, account-scoped chronological AI context contract passes
node tests/server-v2/ai-followup-concurrency.test.cjs
ai-followup-concurrency: customer/reason advisory lock precedes cooldown and dedupe
node tests/server-v2/run-all.cjs
server-v2 suite: 23/23 reference/static checks passed
docker compose -f infra/compose.yaml build ai-worker
[+] build ... FINISHED (API + Worker net10 publish)
```

## 已实现

- 版本化自然聊天 Prompt：明确禁止调查问卷、连续追问和自动发送；输出 13 个热聊字段、状态、证据、缺口、自然话题、不回复评估、客户温度、颜色和跟进计划。
- Provider 解析 `known/missing/pending/declined`，低置信度自动降为 `pending`；结构化 JSON、响应超时、429/额度、网络、Schema 错误分类并进入现有重试/延期/死信流程。
- 回复建议强制 `requiresConfirmation=true`；付款、退款、密码、验证码、身份、金融/法律/医疗、价格或交付保证命中敏感标记，只保存预览，不调用发送接口。
- Worker 在账号/会话缺失、低置信度或无有效信号时阻止客户创建、资料覆盖和跟进提醒；原始作业不再作为未脱敏 JSON 兜底保存。
- PostgreSQL AI 同步在同一事务内写分析、证据、热聊档案、事件/outbox、客户空字段和跟进任务；重复 job 使用 job id 幂等短路，并使用并发安全的 `ON CONFLICT DO NOTHING`。
- 热聊字段人工锁定时保留人工值，仅更新证据；冲突保留为 pending/observation。
- 客户/会话解析按“会话绑定 → 显式客户 → 电话”稳定优先级，并校验 account×conversation 归属；不匹配拒绝写入。
- 跟进提醒增加 3 天冷却和 outbox 去重，旧的已完成提醒不会永久阻塞后续自然跟进。
- 跟进提醒冷却检查前使用客户+原因的 PostgreSQL 事务级 advisory lock，避免并发 AI 分析各自通过窗口检查后双写提醒。
- Provider 对语义不完整的 JSON（缺少 `profileFacts`/`missingFields`/`naturalNextTopics`）标记为非结构化，Worker 仅留证据不自动同步 CRM。
- 所有热聊 JSONB 读取显式使用 `::text`，避免 Npgsql 9 将 JSONB 物化为 `JsonDocument` 后 `GetString` 失败。
- WS 入库在同一事务内查询当前账号会话最近 20 条消息（单条 2,000 字符、总计 20,000 字符，按时间正序），写入 AI 作业 `context`，并在 Provider 出站前再次脱敏。

## 未验证/限制

- 主机环境没有 .NET SDK，无法直接执行 `dotnet build`；已通过 Docker SDK 10 的 API + Worker 发布构建（无编译错误）。
- 未连接真实 PostgreSQL/TeamoRouter，真实额度、网络、Schema 和事务回滚需在 Docker 隔离环境执行。
- 真实 WhatsApp/手机同步、真实 AI 结果和桌面安装包不属于本任务的本地可重复测试，发布报告必须单列为未验证。
- Task 3 的热聊表迁移/仓储与本任务同提交，必须先通过 Task 3 专项 review，再进行发布打包。
