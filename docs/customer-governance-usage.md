# AI 客户档案自动治理使用说明

## 自动建档与补全

WS 会话完成 AI 分析后，知客会按 WS 联系人标识、电话号码、联系人账号、会话标识或人工确认绑定匹配客户。只有唯一匹配的现有客户才会补齐空字段；找不到或出现多个候选时只保留未关联分析结果，不自动创建客户。姓名、来源、年龄、职业、国家/地区、语言、产品兴趣、预算等已有非空值不会被 AI 覆盖。分析结果还必须包含可验证客户字段或明确跟进信号；超时、错误、只有泛化摘要的结果只保存原始分析，不会建档或改写客户库。

AI 识别到的字段会写入 `ai_customer_field_evidence`，包含分析编号、原始证据文本、置信度和状态。冲突值保留原值并标记为 `conflict`，可在数据治理页查看。

## 自动删除边界

当 AI 以至少 0.85 的置信度识别出“明确拒绝联系、号码无效、重复客户”等信号时，客户会自动移入回收站，不会物理删除。恢复客户会保留原档案、WS 消息和治理审计。

## 数据治理接口

- `GET /api/data-governance/customers/:id/profile`：查看客户档案、AI 字段证据和治理历史。
- `GET /api/data-governance/audit`：分页查看自动治理动作和字段冲突。
- `POST /api/data-governance/customers/:id/soft-delete`：移入回收站。
- `POST /api/data-governance/customers/:id/restore`：恢复客户。
- `POST /api/data-governance/customers/batch-soft-delete`：批量移入回收站，单次最多 500 位客户。
- `POST /api/data-governance/customers/:id/purge-request`：申请永久删除并返回一次性确认令牌。
- `POST /api/data-governance/customers/:id/purge-confirm`：提交确认令牌执行永久删除；关联跟进、任务和提醒会清理，WS 原始消息与分析保留。

## 回滚与备份

每次治理写入前自动创建 SQLite 快照。误操作时优先在数据治理页恢复客户；永久删除只能从删除前快照恢复。永久删除令牌有效期为 15 分钟，且只允许一次事务确认；治理写入和 WS AI 同步需要携带当前 `X-State-Version`，发现多窗口冲突会返回 409。升级前请先使用现有自动备份或数据中心导出完整工作区。
