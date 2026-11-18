# 阶段 5 迁移与恢复

日期：2026-11-16（Asia/Calcutta）。基线：ad7749f；实现提交：7667837；分支：fix/zhike-61-p0-infrastructure。

环境：Windows 11 专业版 10.0.26300 x64，Node 24.22.1，仓库 .tools/dotnet10。报告随独立文档提交保存，文档最终提交号由 git log -1 给出。生产入口：FROZEN。

命令：node scripts/stage5/migration-drill.test.cjs；node scripts/stage5/backup-restore-drill.test.cjs；全量中复用 tests/backup-restore-drill.cjs。

## 实际变更

新增 025-stage5-correlation-id.sql，五张表追加 correlation_id（默认空字符串）及按账号的关联查询索引：ws_group_membership_events、ai_jobs、ai_job_evidence、ai_crm_suggestions、ai_task_audit。历史 SQL 文件未改写，历史关联值不伪造、不进行正式回填。

修正 manifest 中 024 checksum 到当前已提交 SQL 的规范 LF SHA-256：9dc642557b9007b9de83c73aab035e017caa7d41a2ed58b1cb275e9fb9dd640f。原 manifest 为 eeff6bc11ed4de1573199d1cb71897b7853b5f750c0b7cd353dfff4a1cbda4b6；基线文件与清单不一致在本轮真实运行中报 MIGRATION_CHECKSUM_MISMATCH。

## 已执行场景

- 合成 0、19、22、23、24 版本库顺序迁移到 25；历史客户、群关系、旧 AI Job、checkpoint、人工锁定值保持。
- 重复入口无迁移、无额外备份；user_version/schema_migrations 一致；integrity_check/foreign_key_check 通过。
- 子进程在事务中异常退出，未提交 DDL 与 user_version 被 SQLite 恢复；迁移失败回滚没有残留表。
- 文件被篡改时 checksum 拒绝；重复号码在身份唯一性迁移中阻断并保留两条原记录。
- Runner 生成的 pre-upgrade backup 恢复到另一个临时数据库，版本仍为 24、历史数据一致。
- sidecar 快照真实还原业务状态；原多记录/多账号 portable roundtrip 在全量中通过。

## 兼容性阻断

如果旧库的 schema_migrations 中确实记录原 eeff…，当前迁移会拒绝启动。测试明确构造该元数据并验证拒绝，**这只证明安全阻止，不证明该旧库升级成功**。没有读取生产库判断实际影响范围，也没有允许列表绕过、静默更新 checksum 或修改已执行 SQL。

旧错误元数据的支持状态：Blocked。后续需单独审查实际发布 SQL 的来源、脱敏样库与 schema 指纹，形成受控修复工具/迁移策略后再验收；不得仅为了放行而替换记录。

025 没有 down migration；回滚是关闭应用后恢复确切的迁移前备份及匹配二进制，不能宣称任意旧版可以直接打开 25。
