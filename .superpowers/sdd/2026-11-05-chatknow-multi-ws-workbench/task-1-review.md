# Task 1 review：WS 多账号数据库隔离

审查基线：commit `3a268b8e43b74ec17850ffb8a62f1c82a786b2d8`（`feat: add multi-account WS database isolation`），对照 task brief、implementer report 及 review package 检查 `008-ws-accounts.sql`、`server.mjs`、`ws-multi-account.test.cjs`。

## Spec verdict

✅ **符合规格**。

迁移在 `server.mjs` 中以 `BEGIN IMMEDIATE`/`COMMIT` 包裹，异常执行 `ROLLBACK`；008 迁移可重复执行，第二次执行仍能完成重建且保留数据。新账号、账号设置、默认账号及旧 WS 表回填均已实现；会话唯一约束改为 `(account_id, external_id)`。WS 读写、导入导出、分析、回复、采集及诊断路径均解析并校验 `accountId`，缺省走 `default`。账号删除通过 `account_id` 外键级联清理 WS 表，CRM `customers` 未建立关联。账号响应只返回固定显示字段和三项偏好，不会把 settings JSON 中的任意字段（例如 cookies/password/token/QR）回传。

## Quality verdict

✅ **质量通过**。

事务边界、外键、级联删除和旧客户端 schemaVersion 6 兼容路径清晰；账号 CRUD 返回状态码及不存在/默认账号保护合理。当前测试覆盖真实本地 HTTP 服务、旧库回填、跨账号相同 external ID、默认账号兼容、删除隔离和账号响应字段安全。

## Critical findings

无。

## Important findings

无。

## Minor findings

无实现级缺陷。现有 focused 测试未单独断言迁移失败后的数据库回滚，也未逐表断言删除账号会清理 settings/messages/analyses/replies/collection runs/items；这些是测试覆盖增强项，不影响当前实现对已检查路径的规格符合性。

## 测试证据

- `node tests/ws-multi-account.test.cjs` → `ws-multi-account: pass`
- `node scripts/run-tests.cjs all` → `Completed 31 checks: 31 passed, 0 failed.`
- `git diff --check ba69038 3a268b8` → 无输出（补丁格式干净）。
- 只读额外检查：重复执行 008 迁移成功；注入孤立旧消息触发外键失败后回滚，旧表、孤立行保留且未留下 `ws_accounts`；创建账号并写入消息、分析、回复、采集运行/采集项后删除账号，账号诊断计数全部归零；CRM 状态路由仍可读。

