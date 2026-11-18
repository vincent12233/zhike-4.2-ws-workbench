# 阶段 3 数据库迁移报告

## 迁移

- 迁移编号：`023`
- 文件：`resources/app/migrations/023-ws-group-manager.sql`
- manifest `supportedSchemaVersion`：`23`
- 迁移 checksum：`78db5f4c79b164d342df4565d1926e7ad17110d968f039a383adb6f115ea71a9`

## 新增表

- `ws_group_members`
- `ws_group_sync_runs`
- `ws_group_messages`
- `ws_group_read_evidence`
- `ws_group_sync_errors`
- `ws_group_audit`

迁移只增加群组成员、消息、证据、同步和审计边界；既有 `ws_group_catalog`、`customer_group_memberships`、CRM 主档、AI 队列和旧 WS 队列仍为权威来源，没有创建第二套 CRM 或 AI 主表。

## 验证

测试：`node scripts/stage3/ws-group-manager-migration.test.cjs`

结果：`Passed`。测试在内存 SQLite 和临时迁移锁目录中执行，并验证所有表、唯一约束和状态约束。

## 数据保护

本轮未打开或修改用户生产 SQLite，未执行生产回填和迁移切换。正常应用启动仍会按既有 Migration Runner 机制处理已注册迁移，因此发布前必须在用户数据副本上完成一次升级备份、校验和回滚演练。

