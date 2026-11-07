# AI 客户档案自动治理设计

## 意图

让知客在 WS AI 分析完成后自动维护客户档案：能识别新客户并建档，补齐姓名、来源、年龄、职业、国家/地区、语言、产品兴趣、预算等空字段，生成或更新跟进任务和提醒；同时提供可审计、可恢复的数据治理删除接口，减少手工维护。

## 目标

- AI 分析结果自动同步到现有 `customers` 客户库、`followups` 跟进记录、`settings.operatingTasks` 任务和 WS 提醒。
- 已有非空客户字段优先保留；AI 只能补空字段或更新允许自动更新的低风险字段。
- 每个 AI 字段保存来源、置信度和分析证据，冲突字段进入待确认记录，不覆盖人工内容。
- AI 可自动新增客户、补齐字段、更新低风险字段、将明确无效/拒绝联系/重复客户移入回收站；永久删除必须通过数据治理接口二次确认。
- 删除客户、批量删除和 WS 会话清理均提供接口，默认软删除并创建快照与审计记录。
- 不改变现有业务数据格式；新增字段放入客户 `data_json` 和 AI 治理表，旧版本可继续读取客户主体字段。

## 非目标

- 不自动发送 WhatsApp 消息。
- 不保存密码、Cookie、二维码或秘密 Token。
- 不把同一 WS 登录账号当作客户唯一身份。
- 不在低置信度或无法建立可靠身份时自动合并客户。

## 约束

- 继续使用现有 Node.js `server.mjs`、SQLite、Electron 前端和现有 WS CRM 同步流程。
- 所有数据库变更必须使用新的迁移文件，并保持 `PRAGMA user_version` 递增。
- 所有写操作必须先创建快照，失败时回滚，不影响原有知客页面。
- AI 自动删除只允许写入回收站（`deleted=true`），物理删除必须显式调用治理接口并二次确认。

## 方案对比

### 方案 A：在现有 WS CRM 同步中增加字段级治理（已选择）

复用当前 `/api/ws/crm-sync`，增加统一的客户匹配、字段合并、AI 证据、回收站和删除审计逻辑。优点是改动集中、兼容现有客户库和提醒链路；风险是需要严格区分自动补全字段和人工字段。

### 方案 B：新增独立客户画像服务

把 AI 画像和治理放到新服务，由主应用异步消费。隔离性更强，但会引入新的队列、同步延迟和部署复杂度，当前本机桌面应用不需要。

### 方案 C：AI 直接覆盖客户 JSON

实现最快，但会覆盖人工修订、难以审计、无法可靠恢复，和现有业务数据保护要求冲突。

采用方案 A，因为它最大化复用现有数据和接口，同时能用字段级规则保证“不重复记录、不覆盖已有内容”。

## 数据模型

新增迁移 `010-ai-customer-governance.sql`：

- `ai_customer_field_evidence`：`id`、`customer_id`、`conversation_id`、`analysis_id`、`field_name`、`value_json`、`confidence`、`source_text`、`status`（accepted/conflict/rejected）、创建和更新时间；唯一约束为客户、分析、字段。
- `customer_governance_actions`：`id`、`customer_id`、`action`（create/update/restore/soft_delete/purge）、`reason`、`source`、`confidence`、`before_json`、`after_json`、`analysis_id`、`created_at`；用于审计和回滚定位。
- `customer_delete_requests`：`id`、`customer_id`、`mode`（soft/purge）、`confirmation_token`、`status`、`requested_at`、`confirmed_at`、`created_at`；物理删除只接受一次性确认令牌。

客户 `data_json` 新增兼容字段：`age`、`occupation`、`origin`、`aiProfile`、`aiFieldSources`、`aiDeletedAt`、`aiDeleteReason`。旧字段仍保留，`source` 继续表示渠道，`origin` 表示 AI 从聊天识别的来源描述。

## AI 字段与合并规则

AI 结果规范化为：

```text
contact: { name, phone, account, country, language }
profile: { origin, age, occupation, productInterest, budget }
intent: { label, score, emotion, urgency, stage }
summary, nextStep, followupTime, tags, confidence, evidence[]
```

- 身份匹配顺序：WS 联系人唯一标识 → 电话 → 联系人账号 → 会话标识；不使用 WS 登录账号作为客户身份。
- 非空人工字段（姓名、电话、来源、年龄、职业、国家、语言、产品兴趣、预算、备注）不被 AI 覆盖。
- 空字段由置信度不低于 0.6 的 AI 值补齐；每次写入都保存证据文本和分析编号。
- 低风险动态字段（意向、情绪、意向分、AI 摘要、标签、下次跟进日期）允许 AI 更新，但保留上一次分析结果。
- 同一字段出现不同非空值时不覆盖，写入 `conflict` 证据并保留现值。
- AI 识别到明确“号码无效、拒绝联系、重复客户”且置信度不低于 0.85 时，自动软删除并写治理审计；无法确认时只加标签和提醒。

## 接口

- `POST /api/data-governance/customers/:id/soft-delete`：AI 或用户将客户移入回收站。
- `POST /api/data-governance/customers/:id/restore`：恢复客户并记录审计。
- `POST /api/data-governance/customers/:id/purge-request`：生成物理删除确认令牌，不执行删除。
- `POST /api/data-governance/customers/:id/purge-confirm`：带令牌执行物理删除；同时清理关联 WS 客户关联、跟进、任务和提醒，但保留治理审计摘要。
- `POST /api/data-governance/customers/batch-soft-delete`：批量软删除，限制数量并逐条记录审计。
- `GET /api/data-governance/audit`：分页查询治理动作和字段冲突。
- `GET /api/data-governance/customers/:id/profile`：读取客户档案、AI 字段证据、冲突和最近自动操作。

`/api/ws/crm-sync` 保持原接口兼容，改为调用统一治理服务；返回 `created`、`updatedFields`、`conflicts`、`softDeleted`、`followup`、`task` 和 `revision`。

## 错误处理与回滚

- 任何客户/跟进/任务/提醒联动写入包在同一 SQLite 事务中；失败整体回滚。
- AI 服务超时、余额不足、格式错误时保留原分析和原始消息，不改变客户档案。
- 发生版本冲突返回 409，前端刷新后重试，不覆盖其他窗口写入。
- 每次自动治理前创建快照；治理审计记录保存变更前后 JSON。

## 验收标准

- 新 WS 联系人自动创建一个客户，重复分析不重复创建。
- 已有姓名/电话/来源/年龄/职业等非空值保持不变，空值被 AI 补齐。
- AI 能从聊天识别来源、年龄、职业和姓名，并保存字段证据。
- 同一客户的新号码或会话能按规则关联；不同联系人不会因同一 WS 登录账号合并。
- AI 生成的跟进任务、客户 due 日期和提醒在一次同步后同时可见且可去重。
- 明确无效联系人自动进入回收站；恢复后资料和关联数据仍在。
- 永久删除必须二次确认，误用令牌或重复使用令牌均失败。
- 全量回归、迁移、覆盖安装、升级后数据保留和安装器检查通过。
