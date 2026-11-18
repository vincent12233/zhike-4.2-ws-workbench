# 阶段 1 P0-03：CRM 写入权威隔离验证

审计日期：2026-11-15
代码基线：`6e4d195`  〔阶段 1 前置设计冻结〕
验证命令：`node scripts/stage1/crm-group-authority-test.cjs`
验证范围：只读源码/迁移审计 + 临时 SQLite；未打开应用数据目录，未修改客户资料，未启动服务或 Worker。

## 1. 结果摘要

本次隔离验证结果：**9 Passed / 1 DesignOnly / 3 Blocked**，脚本因发现 P0 阻断以退出码 2 结束。这是预期的 fail-closed 行为，不是测试断言被修改后的成功。

| 检查项 | 状态 | 结论 |
|---|---|---|
| 客户主键与当前持久化字段 | Passed | `customers.id` 为主键，`writeState()` 同步 SQL 客户表 |
| 普通 WS AI 匹配边界 | Passed | 纯匹配器只返回 `new/ambiguous`，不负责自动建档 |
| 群组确认入群登记门 | Passed | `joined + confirmed + confidence >= 0.6` 才进入自动登记路径 |
| 审核/申请状态排除 | Passed | pending/requested/审核中不计入确认入群 |
| 现有 group/catalog 唯一键 | Passed | 015/017 的现有约束存在 |
| 客户手机号并发全局去重 | **Blocked** | 生产 `phone_normalized` 只有普通索引 |
| 群事件不覆盖客户全局状态 | **Blocked** | 当前群关系投影会修改客户 JSON `status` |
| 缺失渠道来源不泛化 | **Blocked** | 当前来源缺失时回退为“群粉” |
| 隔离目标手机号唯一约束 | Passed | 临时 SQLite 两次建档只产生一行 |
| 隔离事件幂等 | Passed | 重放同一 `idempotency_key` 只保留一条事件 |
| 隔离双连接唯一约束 | Passed | 两个 SQLite 连接仍由数据库唯一约束拦截重复 |
| target/catalog 作用域统一 | DesignOnly | 当前 target 是 profile 级、catalog 是 account 级，仍需迁移决策 |

## 2. 真实客户写入路径

### 2.1 基础主档和手动/导入路径

- `resources/app/server.mjs:93-99` 创建 `customers`、`app_state` 和 `schema_migrations`。
- `resources/app/server.mjs:817-848` 的 `writeState()` 以 `state.customers` 为输入，先更新 `app_state`，再 upsert SQL `customers`；因此当前事实语义仍由 `app_state` 驱动，SQL 表是同步档案索引。
- `resources/app/server.mjs:4581-4614` 的 `/api/state` 读写、`resources/app/app.js:119` 的队列化状态写入承载手动新增、客户编辑、Excel/CSV 导入、手机号登记及业务字段变更。
- `resources/app/server.mjs:853-868,4707` 启动时全表重算 `phone_normalized`，它是派生索引修复，不是独立的客户主档写入者。

**冻结结论：**阶段 1 目标权威应为 SQL `customers` 领域记录；`app_state.customers` 只能作为兼容投影/旧 UI 输入，切换前必须双读对账，不能在本轮直接改生产写入顺序。

### 2.2 普通 WS 聊天和 AI

- `resources/app/modules/ws-crm-sync-core.js` 的 `matchCustomerForAutoSync()` 只执行显式 ID、账号范围 WS 身份、可信电话、联系人账号和会话 ID匹配；未唯一命中时返回 `kind: 'new'` 或 `ambiguous`。
- `resources/app/server.mjs:3300-3540` 的 AI CRM 同步会在唯一身份匹配后补齐有证据字段，并写 `ai_customer_field_evidence`、`customer_governance_actions` 和 `hot_chat_sync_outbox`；无唯一客户时进入等待/跳过，不应创建陌生客户。
- `resources/app/modules/ws-workbench.js:4039-4115` 存在“用户明确点击保存客户”路径，该路径可在有 WS 标识/电话且经过人工操作后创建客户。这是手动建档，不是普通 AI 自动建档，必须保留人工意图边界。

**状态：Passed（规则合同）/ DesignOnly（统一写入者未切换）。** 后续实施需把前端手动建档转为 sidecar 命令，不能让前端直接维护第二份主档。

### 2.3 独立 WS 群组管理

- `resources/app/server.mjs:1200-1290` 生成确定性群组登记候选；`server.mjs:1392-1408` 只有确认 joined、身份可用且置信度达到阈值时才加入客户状态。
- `server.mjs:1317-1458` 在同一处理路径中解析身份、计算幂等键、写事件、投影关系、推进 checkpoint，并调用 `writeState()`。
- `resources/app/migrations/010-ai-customer-governance.sql` 的证据和治理表是 AI 字段写入的审计事实，不能因群组登记覆盖或删除。

**冻结规则：**群组确认入群可以创建客户，但必须全局查重；已有客户只关联关系；退群/移除只能改变关系状态，不删除客户、不清除其他群组关系。

## 3. P0 阻断项和修复准入

### Blocked：电话唯一约束

`customers.phone_normalized` 在 `server.mjs:94` 只有普通索引，数据库不能阻止两个并发登记事务创建相同 canonical phone。隔离测试用条件唯一索引验证了目标行为，但不能冒充生产通过。

实施前必须：

1. 生成空/无效/重复号码报告；不自动合并已有客户。
2. 冻结 normalizationVersion；保留 rawPhone。
3. 采用统一身份关系或经审查的条件唯一约束。
4. 在 `BEGIN IMMEDIATE` 内执行查重、创建、关系和事件写入。
5. 冲突返回 `ReviewRequired`，不得静默生成第二客户。

### Blocked：群状态覆盖客户状态

`server.mjs:1433-1440` 当前将群关系投影写入 `customer.groupMemberships`，并可能更新客户 JSON 中全局 `status`。这会让退出一个群覆盖人工客户状态或其他群关系。

实施前必须把群成员关系、进退事件和客户主档状态分离；客户状态只能由客户域规则/只读聚合投影计算，不能由单个群事件直接覆盖。

### Blocked：来源缺失回退“群粉”

`server.mjs:1209-1237` 的来源解析在缺失定义时回退泛化“群粉”，会把单导、FB 群粉和其他来源混为一类。

实施前必须使用系统设置中稳定的 `sourceDefinitionId/channelId`；缺失时记录“未分类，待绑定”，并让统计/导入显示待绑定，不得自动归类。

## 4. 临时 SQLite 验证

脚本只在 `%TEMP%\\zhike-stage1-crm-*` 创建临时库，验证：

- canonical phone 的条件唯一索引拦截重复登记。
- 同一账号同一 `group_jid` 的 catalog 唯一，不同账号可独立存在。
- 同一 profile/target 的 group 不能重复挂载。
- 相同事件幂等键重放只插入一条。
- 两个 SQLite 连接同时执行 `INSERT OR IGNORE` 仍只能保留一个客户。

脚本结束后关闭数据库并删除临时目录；没有读取 `ZHIKE_DATA_DIR`、安装目录或生产 `workspace.sqlite`。

## 5. 结论

CRM 业务规则的边界已通过源码合同和隔离测试确认，但 P0 权威写入尚未通过：生产手机号并发去重、群关系状态隔离、渠道来源稳定分类仍为 **Blocked**。因此不能申请生产 Worker 或 CRM 权威切换；保持设计冻结，等待 P0 修复方案和迁移/回滚审核。
