# 阶段 4 CRM 审核报告

## 权威数据源

客户主档继续使用 `app_state` 的 `customers`，SQLite 仅作为任务、证据和审计投影。普通聊天 AI 只能对已存在且唯一匹配的客户提出候选更新；未知客户、显示名称匹配、多客户匹配和身份冲突不会自动建档或覆盖。

## 候选与审核

`ai_crm_suggestions` 保存字段名、候选值、已有值、来源证据、来源消息、来源时间、客户 ID、置信度、验证状态、冲突原因、审核人、应用时间和幂等键。审核批准使用 `X-State-Version` 防止并发覆盖；仅空白且未被人工保护的字段可写入。拒绝和冲突均保留审计记录。

群组受控建档边界仍由阶段 3 群组服务负责，不被普通聊天 AI 绕过。群组候选必须带可信身份映射。

## 验证状态

- `scripts/stage4/ai-crm-suggestion-core.test.cjs`：Passed
- `scripts/stage4/ai-pipeline-api.test.cjs`：Passed；覆盖唯一客户、未知客户拒绝、候选幂等、审核批准、状态版本和审计
- 页面 `ai-review-center-ui.js`：读取真实任务/候选；生产冻结时显示明确禁用状态

真实人工操作验收、真实 AI 质量和生产资料迁移：`NotTested`，不得据此宣称已发布。
