# P0-03 CRM 去重与写入权威整改

## 事实源

保留 customers.id 作为唯一客户主键。app_state.customers 仍是兼容输入/投影，业务记录继续以 customerId 关联；没有创建第二套客户主档。

## 实现

- 019-crm-base-schema.sql 将客户基础结构纳入迁移链。
- 021-crm-authority.sql 创建 crm_identity_conflicts，并为非删除客户的 phone_normalized 创建 partial unique index。
- server.mjs 在状态写入、手机号派生索引修复和 SQLite 唯一错误处统一返回 CRM_PHONE_CONFLICT；不自动合并、删除或覆盖客户。
- 普通 WS AI 的匹配器无匹配只返回候选/人工处理状态，不具备自动创建权限。
- 独立群组确认入群仍是确定性自动登记入口，先全局查重，再在事务中登记。

## 验证

~~~
node scripts/stage1/p0-03-p0-06-crm-group-implementation.test.cjs
P0-03/P0-06 CRM authority and group identity: pass

node scripts/stage1/crm-group-authority-test.cjs
{"ok":true,"scope":"isolated-only","productionDatabaseOpened":false,
 "productionWorkerStarted":false,"counts":{"Passed":13,"DesignOnly":0,"Blocked":0}}

node tests/customer-group-membership.test.cjs
customer-group-membership: status projection contract present

node tests/ws-group-monitor-ingest.test.cjs
ws-group-monitor-ingest: pass
~~~

## 兼容与人工保护

已存在的重复号码只在迁移预检/状态校验中生成冲突明细；不会删除任一历史客户。人工维护的 CRM status、阶段、资质等字段不会被群关系事件覆盖；群状态保存在 groupStatus 和关系账本中。

## 未验证项

真实生产客户库冲突清单、跨设备导入冲突和人工审核 UI 未在本轮执行，因为生产数据库和真实数据明确禁止触碰。

## 提交

d156a7a fix: enforce AI CRM and group identity authority
