# Task 4 report — AI Worker、自然话题和跟进提醒闭环

## 状态

实现已提交：`dce1b1f`（与当时已暂存的 Task 3/UI 文件一起提交；发布前须按最终合并树复核）。

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

## 未验证/限制

- 当前环境没有 .NET SDK，无法执行 `dotnet build`；已完成 C# 静态自审、括号平衡和 Node 契约回归。
- 未连接真实 PostgreSQL/TeamoRouter，真实额度、网络、Schema 和事务回滚需在 Docker 隔离环境执行。
- 真实 WhatsApp/手机同步、真实 AI 结果和桌面安装包不属于本任务的本地可重复测试，发布报告必须单列为未验证。
- Task 3 的热聊表迁移/仓储与本任务同提交，必须先通过 Task 3 专项 review，再进行发布打包。
