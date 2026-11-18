# 阶段 1 P0-06：群组 target/catalog 唯一键与身份约束验证

审计日期：2026-11-15
验证命令：`node scripts/stage1/crm-group-authority-test.cjs`
范围：`015-ws-group-monitor.sql`、`017-ws-group-catalog.sql`、群组 core、server 事件处理和临时 SQLite；不连接真实 WS，不修改生产数据。

## 1. 当前真实字段和唯一范围

| 概念 | 当前字段/表 | 当前唯一范围 | 状态 |
|---|---|---|---|
| WS 账号 | `ws_accounts.id` | 全局主键 | Passed |
| 群目录身份 | `ws_group_catalog.account_id + group_jid` | 同账号同 JID 唯一 | Passed |
| 监测席位 | `ws_group_monitor_profiles.id` | 全局主键；`account_id + slot_key` 由服务逻辑协调 | DesignOnly |
| 监测目标 | `ws_group_monitor_targets.profile_id + group_jid` | 同 profile 同 JID 唯一 | Passed，但跨 profile 可重复 |
| 渠道来源 | target `source_id/channel_id`、catalog `channel_id` | 当前为可空文本，无稳定外键 | **Blocked** |
| 群成员 | 事件 `member_jid/member_phone/customer_id`；客户 JSON `groupMemberships` | 事件无客户/群关系唯一约束；事件只靠 idempotency_key | **Blocked/DesignOnly** |
| 客户 | `customers.id` | 全局主键 | Passed |
| 进退事件 | `ws_group_membership_events.idempotency_key` | 全局唯一 | Passed |
| checkpoint | `profile_id + target_id` | 监测席位/目标唯一 | Passed，但不能与会话采集 cursor 共用 |

依据：`resources/app/migrations/015-ws-group-monitor.sql:1-93`、`017-ws-group-catalog.sql:1-30`、`server.mjs:1023-1458,2360-2514`。

## 2. 事件身份和状态规则

`ws-group-monitor-core.js` 的当前规则：

- `normalizeMemberIdentity()` 将 WhatsApp phone JID、c.us、g.us 和普通 JID 区分；phone 会按共享规则 canonicalize。
- `eventIdempotencyKey()` 组合账号、群、成员、事件类型、来源事件 ID 和事件时间生成 replay key。
- `isConfirmedJoinEvent()` 拒绝 pending/requested/审核中/待批准的加入申请。
- `applyMembershipProjection()` 只接受 `joined/left/removed`；人工锁定、低置信度和乱序事件进入 review。

这些规则在隔离测试中通过，但不能解决生产 target/catalog 作用域和客户关系账本的结构缺陷。

## 3. 隔离测试结果

| 测试 | 结果 | 说明 |
|---|---|---|
| 同账号同群 catalog 重复发现 | Passed | 临时 SQLite `UNIQUE(account_id,group_jid)` 拒绝第二行 |
| 不同账号相同 JID | Passed | 允许作为不同账号的独立来源 |
| 同 profile 同 group target 重复 | Passed | 临时 SQLite `UNIQUE(profile_id,group_jid)` 拒绝第二行 |
| 不同 profile 同账号同群 | DesignOnly | 现有约束允许重复 target，必须制定 catalog→target 归并规则 |
| 同一 joined 事件重放 | Passed | `UNIQUE(idempotency_key)` 只保存一条 |
| phone 跨群/跨账号客户去重 | Passed（隔离目标合同） | 临时库条件唯一索引通过；生产 customers 尚无同等约束 |
| pending/审核状态统计排除 | Passed（规则） | core guard 拒绝进入确认 projection |
| 来源缺失 | **Blocked** | server 仍回退为“群粉” |

## 4. P0-06 必须冻结的目标约束

### 4.1 群组身份

第一阶段采用 `account_id + canonical group_jid` 作为运行域稳定身份；显示名称、头像、成员数量和最后消息只能是可变属性，不能参与合并。

同账号同 JID 只允许一个 catalog 事实和一个有效监测目标。多个 profile 发现同组时，保留最早/最完整的 target 作为 canonical，其他 target 记录迁移别名和历史 source，不生成第二监测流。

不同账号即使 JID 相同也必须保持账号隔离，除非后续人工确认是同一业务群；不能因为名称相同自动合并。

### 4.2 渠道/来源

来源权威来自系统设置中的稳定 source definition；target 和 catalog 都应保存 `sourceDefinitionId`、`channelId`、显示标签和来源版本。缺失来源统一 `unclassified/pending-binding`，不写泛化“群粉”。渠道变更是新版本事件，不覆盖历史统计。

### 4.3 成员和客户关系

成员关系键至少包含 `account_id + group_jid + member_identity`；客户关系用 `customer_id` 关联。phone 可作为跨账号候选全局身份，但空/未验证号码不能自动合并。一个客户可以关联多个账号、多个群；退群只关闭对应关系。

事件幂等优先使用 provider `source_event_id`；没有来源 ID 时使用包含账号/群/成员/类型/发生时间的加密哈希。重复事件返回既有事件，不重复进退群统计、不重复建档。

### 4.4 时间和 checkpoint

`event_at` 是平台发生时间，缺失时保持空；`observed_at` 是本机观察时间，不能替代发生时间。checkpoint 按 `account + group monitor profile + target` 分区，且只有事件事实、客户关系/登记事务或 durable review 已提交后才能推进。

## 5. 当前阻断和建议修复顺序

1. 在隔离副本统计 profile 级重复 target，建立 catalog canonical/alias 映射，不直接删除历史事件。
2. 设计 source definition 稳定 ID 与缺失来源状态，回填时保留原始 source 文本。
3. 将客户 JSON `groupMemberships` 迁移为关系事实或兼容投影，禁止单群事件覆盖全局客户 `status`。
4. 为已验证 phone/WS identity 建立并发安全查重事务；冲突进入人工审核。
5. 为 `account + group + member` 关系和 provider event 建立唯一/幂等合同，保留 `pending/review/ignored` 事件。
6. 通过双读和回滚演练后，再申请启用群组 Worker；当前不得创建生产并行表或启动 Worker。

## 6. 结论

现有 catalog、target 和事件的基础约束已被真实 schema 和临时库验证，但 target/catalog 作用域、来源稳定 ID、客户关系账本和群状态隔离仍未完成。P0-06 状态为 **DesignOnly/Blocked**，不满足阶段 1 生产准入条件。
