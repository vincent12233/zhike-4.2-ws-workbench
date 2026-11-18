# 知客 6.1 A+B 阶段 1 前置设计冻结：CRM 权威源与客户去重

审计日期：2026-11-15  
范围：6.0.3 当前源码、迁移文件、CRM/WS/群监测规则模块。本文只冻结设计，不执行迁移、不修改生产数据库、不创建新表。

## 1. 当前真实实现

### 客户主档的持久化现状

- `resources/app/server.mjs:93-94` 启动时创建 SQLite `customers` 表，主键为 `id`，并保存 `phone_normalized/name/source/assistant/status/stage/deleted/data_json`。
- `resources/app/server.mjs:817-848` 的 `writeState()` 先写 `app_state.json`，再将 `state.customers` 投影/同步到 `customers` 表；这说明当前写入事实仍由 `app_state` 状态对象驱动，`customers` 是同步索引和档案桥。
- `resources/app/server.mjs:853-868,4707` 启动时还会全表修复 `customers.phone_normalized`，该修复属于派生索引更新，不是客户主档变更。
- 业务记录和客户主档仍通过 `customerId` 字符串关联；`resources/app/migrations/005-ws-workbench.sql:14-68` 的 WS 会话使用 `customer_id`，没有客户外键约束。
- 客户与群的关系目前保存在 `state.customers[*].groupMemberships` JSON（`server.mjs:1288,1372-1373,1415-1416,1433-1440`），没有独立的 `customer_group_memberships` 事实表。

### 标准化和当前去重顺序

- `resources/app/modules/ws-crm-sync-core.js:9` 与 `resources/app/modules/ws-group-monitor-core.js:9-18` 各自实现手机号标准化：去除非数字、去除前缀 `00`、对 11 位印度号码去除前缀 `91`。
- CRM AI 匹配顺序在 `ws-crm-sync-core.js:164-215`：显式客户 ID → 账号范围内 WS 外部身份 → 可信电话号码 → 联系人账号 → 会话 ID；每个候选集必须唯一，否则返回 `ambiguous`。
- 群监测匹配顺序在 `ws-group-monitor-core.js:83-121`：参与者外部身份 → 电话号码 → 人工映射；多客户命中返回 `ambiguous`。
- 当前 `customers.phone_normalized` 只有普通索引（`server.mjs:94`），没有唯一约束；重复号码只能由诊断逻辑报告，不能由数据库阻止。
- WS 外部身份字段散落在 `wsExternalId/wsParticipantId/wsContactId` 及数组字段中，当前没有统一的跨账号身份链接事实表。

### 普通 WS AI 与群组自动登记边界

- 普通 WS AI 在 `server.mjs:3300-3370` 先验证置信度和结构化证据，再通过独立身份匹配；未唯一匹配时返回 `awaiting-human/identityPending/conflict`，不会创建陌生客户。
- `ws-crm-sync-core.js:164-215` 的 `matchCustomerForAutoSync()` 对无匹配只返回 `kind: new`；创建客户的路径不在普通聊天 AI 逻辑中。
- 独立群组登记在 `server.mjs:1200-1290,1317-1445`。只有确认入群事件、身份可用且置信度达到 0.6 时才调用 `wsGroupMonitorAutoCustomer()` 创建客户；审核中/待批准事件由 `isConfirmedJoinEvent()` 拦截。
- 群组自动登记 ID 在 `server.mjs:1200-1208`：有验证电话时使用全局电话键；没有电话时使用 `accountId + memberKey`，符合“电话可全局去重、无电话身份按账号隔离”的基础方向。
- 当前群组来源缺失时仍会在 `server.mjs:1213-1237` 回退为“群粉”，与 6.1 要求的“未分类，待绑定”不一致；进入阶段 1 前必须冻结来源策略。
- 当前群关系应用会在 `server.mjs:1433-1440` 修改 `customer.groupMemberships` 并把客户全局 `status` 改为“在群/已退群”。这会覆盖人工状态，必须在正式迁移前停止旧投影写法。

## 2. 冻结的 CRM 权威设计

### 2.1 唯一事实源

阶段 1 冻结为：

1. SQLite `customers` 表成为客户主档的唯一持久事实源。
2. `app_state.customers` 在过渡期保留为兼容投影和旧 UI 输入格式；迁移完成后只允许由 `CustomerRepository` 从 `customers` 领域记录生成，不再由前端直接决定客户主档写入。
3. `customers.data_json` 保存现有扩展字段，以保持业务规则和旧页面兼容；核心索引字段由结构化列维护。
4. 跟票、报名、入金、跟进等独立业务记录继续使用各自事实源，通过 `customerId` 关联；不能复制客户主档。
5. WS 会话、AI 证据、群事件只能保存客户引用和身份证据，不能维护第二份客户档案。

阶段 1 只完成审计、回填和只读对账；在双读零未解释差异前，禁止切换写入权威。

### 2.2 客户 ID

- 保留现有 `customers.id` 作为全局客户 ID，禁止按账号、群组或会话生成第二个客户 ID。
- 新建客户必须在一个 SQLite `BEGIN IMMEDIATE` 事务内完成：身份查重 → 生成 ID → 插入 `customers` → 写入创建审计 → 写入对应群关系投影/事件引用。
- 重试使用确定性登记幂等键；重复事件只能得到同一客户 ID，不得再次插入。

### 2.3 电话号码标准化

冻结一个共享实现，所有 Node、.NET、前端和导入路径都调用同一版本化规则：

- NFKC/Trim；保留数字；去除 `00` 国际前缀。
- 当前印度号码兼容规则 `91 + 10 位号码 → 10 位号码` 暂时保留，但必须在 `normalizationVersion` 中记录，不能静默改变历史结果。
- 空号码、短号码、无法确认国家的号码只作为原始身份证据，不得进入全局电话唯一键。
- `rawPhone` 原文保留在 `data_json`/证据中，`phone_normalized` 只保存 canonical 值。
- 阶段 1 回填先生成重复号码报告，再决定合并；不得自动把多个已有客户合成一个。

### 2.4 身份匹配和跨账号规则

固定匹配优先级：

1. 人工确认的 `customerId` 或已锁定身份映射。
2. 已验证的全球电话号码。
3. 账号范围内的 WhatsApp participant/JID/LID 身份。
4. 账号范围内的联系人账号。
5. 账号范围内的会话 ID。
6. 昵称、展示名、AI 猜测只作为候选提示，不能建立客户关联。

跨账号只有在电话号码或人工确认身份链相同的情况下复用客户 ID。没有电话的 LID/JID 不得跨账号合并。一个身份同时命中多个客户时进入 `ReviewRequired`，禁止自动合并。

建议阶段 1 增加统一身份映射领域概念（具体表名待队列/迁移报告共同冻结）：`customer_id + account_id + provider_identity + identity_kind + verification_state + evidence`。在该事实表上线前，现有 JSON 字段只能作为兼容读源，不得扩展更多散落字段。

## 3. 并发建档和人工保护

- 自动登记和人工关联都必须通过同一事务协调器；事务内先锁定/查询 canonical 电话和可信身份，再检查现有客户及软删除记录。
- 已删除客户命中电话或可信 WS 身份时，结果为 `awaiting-restore/review`，不得直接新建同一人。
- 普通 WS AI 只允许对唯一匹配客户补齐空字段；低置信度、冲突、缺证据和多个候选保持人工队列。
- AI 更新必须写 `ai_customer_field_evidence` 和 `customer_governance_actions`（`migrations/010-ai-customer-governance.sql:1-30`），人工锁定字段不可被 AI 覆盖。
- 群组进退事件只改变对应账号/群组关系；客户全局状态只能由关系聚合视图派生，不能覆盖人工状态、阶段、资质或其他业务字段。
- 自动登记允许新建客户的唯一入口是独立群组确定性入群登记；必须满足 confirmed join、可信身份、排除名单规则和全局查重。

## 4. 必须在阶段 1 实施前修正的现状冲突

| 现状 | 风险 | 阶段 1 门禁 |
|---|---|---|
| `app_state` 驱动 `writeState()`，`customers` 同步写入 | 两个写入语义，可能产生漂移 | 先建立 CustomerRepository，完成双读对账后切换唯一写入者 |
| `groupMemberships` 在客户 JSON 中 | 关系事实无法按群/账号唯一约束 | 先定义唯一关系账本和 JSON 回填/兼容视图 |
| `phone_normalized` 无唯一索引 | 并发建档可重复建客户 | 重复报告、人工确认、再加条件唯一约束或身份表 |
| WS JID/LID 字段散落在客户 JSON | 跨账号身份可能误合并 | 账号范围和 verification_state 必须结构化 |
| 群组来源缺失回退“群粉” | 单导/FB/其他渠道被错误归类 | 缺失来源统一“未分类，待绑定”，禁止默认覆盖 |
| 群事件写入后修改客户全局 status | 退一个群可覆盖人工状态 | 改为关系级事实 + 派生状态，只读投影 |
| 删除客户保留数据但自动登记只查 active rows | 可能重复建档或复活错误客户 | 软删除身份必须参与冲突检查，恢复需人工确认 |

## 5. 阶段 1 回填、对账和回滚规则

1. 在临时一致性副本中读取 `app_state.customers`、`customers`、WS 会话绑定、群事件和 JSON 群关系。
2. 以 `customers.id` 为首选；缺 ID、重复 ID、电话冲突、孤儿关联、多个客户同一可信身份全部生成报告，不自动合并。
3. 将 canonical 电话、来源版本、WS 身份和群关系转换为候选事实记录，保留原 JSON 和证据哈希。
4. 先只读双查：旧 `app_state` 解析结果与候选领域记录逐客户比较字段、关联数和身份状态；达到零未解释差异后才允许灰度写入。
5. 灰度阶段仅针对测试账号/测试群；任何回滚先停新写入、隔离新记录，再恢复旧兼容路径。禁止通过关闭 feature flag 让旧代码读取未兼容结构。
6. 回滚依赖迁移前快照和审计日志，不删除原始 JSON，不覆盖人工锁定字段。

## 6. 阶段 1 准入结论

CRM 权威设计可以冻结为“`customers` 领域记录唯一持久事实源，`app_state.customers` 过渡期只读投影；普通 WS AI 禁止自动建档；独立群组确认入群登记可在全局去重后创建客户”。

但当前代码仍存在 `app_state` 驱动写入、JSON 群关系、非唯一电话索引、群来源回退和客户全局 status 覆盖等阻断项。以上冲突必须在队列映射、迁移编号、身份事实表和单写入者方案共同冻结后，才能进入阶段 1 实施。
