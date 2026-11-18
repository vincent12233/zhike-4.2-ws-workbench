# P0-01 迁移 Runner 实施报告

## 实现

- 文件：resources/app/migration-runner.cjs
- 注册表：resources/app/migrations/manifest.json
- 当前仓库支持最高迁移版本：22（由 manifest 动态读取，不再硬编码 018）。
- 每条记录包含 version/name/file/checksum；执行历史写入 schema_migrations，保留 appliedAt、状态、耗时和错误摘要。
- SQL checksum 先把 CRLF 规范化为 LF，再计算 SHA-256；manifest 中已注册迁移之外的 .sql 会 fail-closed。
- 已执行迁移 checksum 不一致、高版本 user_version、版本缺口、重复版本和锁竞争都会拒绝继续写入。
- 迁移锁使用文件锁元数据并带 generation；迁移前写入 .backups 快照。
- 019/021/022 在迁移事务前执行冲突预检：重复活跃手机号抛出 CRM_PHONE_CONFLICT，重复启用群 target 抛出 GROUP_TARGET_CONFLICT，不推进 schema 版本。

## 新增/调整迁移

- 019-crm-base-schema.sql
- 020-ai-schema-authority.sql
- 021-crm-authority.sql
- 022-ws-group-identity.sql
- 006、011、017 SQL 统一 LF；.gitattributes 固定迁移文件 eol=lf。

## 真实验证命令与结果

~~~
node scripts/stage1/migration-runner-implementation.test.cjs
{"ok":true,"fresh":18,"rerun":true,"checksum":true,"highVersion":true,
 "rollback":true,"concurrency":true,"lock":true,
 "conflictPreflight":{"crmConflict":true,"groupConflict":true}}

node scripts/stage1/migration-runner-conflict-diagnostics.test.cjs
migration conflict diagnostics: duplicate phone and enabled group targets fail closed with conflict lists

node scripts/stage1/migration-runner-verification.cjs
[passed] manifest max/versioned migration and no inline schema blocker

node scripts/stage0/audit-queue-mapping.test.cjs
stage0 queue audit contract: read-only schema and writer findings pass
~~~

全量回归中迁移/备份/恢复相关检查均通过。

## 兼容、失败恢复和回滚

未删除既有迁移；旧数据库从低版本按顺序升级，不能跳过失败版本。冲突会保留原库并返回结构化诊断。回滚使用 .backups 中的校验快照，禁止降级打开高版本库。

## 限制

以上仅为隔离 fixture；本轮未打开生产 SQLite、未执行生产迁移。P0-01 的实现通过不等于生产迁移已获批准。

## 提交

30d927b fix: harden versioned migration runner and schema registry
