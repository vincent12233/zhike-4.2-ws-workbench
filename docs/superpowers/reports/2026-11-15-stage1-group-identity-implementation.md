# P0-06 群组身份与 catalog 整改

## 身份作用域

- 账号：account_id
- 群来源身份：group_jid（不使用群名称去重）
- 监测目标：ws_group_monitor_targets.id，启用唯一范围为 (account_id, group_jid)
- 客户：复用全局 customers.id
- 成员：member_jid/规范化电话，在 (account_id, group_jid, member_jid) 内唯一
- 来源：source_id/source_label/groupFanType，缺失时保持 unclassified，不回退成泛化“群粉”。

## 实现

022-ws-group-identity.sql 新增 customer_group_memberships 关系账本、账号/群/成员唯一约束和查询索引。群 target 启用前由 API 检测同账号同 JID 冲突并返回 409 GROUP_TARGET_CONFLICT。重复入群以确定性 idempotency key 重放不重复建档。

确认入群才允许自动登记；待审核/申请事件跳过。一个客户可有多个群关系，退出一个群只更新该关系；全局 CRM 状态只在兼容 group-only 状态时投影，人工状态保留。

## 验证

~~~
node scripts/stage1/p0-03-p0-06-crm-group-implementation.test.cjs
P0-03/P0-06 CRM authority and group identity: pass

node scripts/stage1/crm-group-authority-test.cjs
13 Passed, 0 DesignOnly, 0 Blocked

node tests/ws-group-monitor-core.test.cjs
ws-group-monitor-core: pass

node tests/ws-group-monitor-api.test.cjs
ws-group-monitor-api: pass

node tests/ws-group-status-projection-runtime.test.cjs
ws-group-status-projection-runtime: pass
~~~

## 数据保护

首次同步不伪造今日进群；退群不删除客户；未绑定来源显示待分类；VIP 客户主档与群监测关系分离。真实 WhatsApp 群发现/账号同步未在本轮执行。

## 提交

d156a7a fix: enforce AI CRM and group identity authority
