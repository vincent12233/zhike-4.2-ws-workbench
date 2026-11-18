# 知客 6.1 A+B 阶段 1 P0 基础设施受控整改报告

- 日期：2026-11-15/16
- 分支：'fix/zhike-61-p0-infrastructure'
- 基线：'7927419'（阶段 1 P0 隔离验证），实际实现提交：'30d927b'、'd156a7a'
- 范围：只在隔离临时 SQLite、源码静态检查和临时服务中整改/验证。
- 明确未执行：生产数据库迁移、真实客户数据写入、真实 WS 登录、正式 Worker、AI Worker、新旧队列双写、新 AI outbox。

## 结论

| P0 | 状态 | 本轮结果 |
|---|---|---|
| P0-01 迁移 Runner | **Passed** | 清单注册、规范化 checksum、高版本拒绝、锁、备份、失败恢复和冲突 fail-closed 已实现并通过隔离测试。 |
| P0-02 AI schema 权威 | **Passed** | ai_jobs 由 020 迁移唯一负责；启动不再内联建表/无条件恢复；旧 schema 19→22 隔离升级通过。 |
| P0-03 CRM 权威去重 | **Passed** | 活跃 canonical 手机号数据库唯一索引、冲突报告、普通 WS AI 禁止建档、群组确定性登记隔离验证通过。 |
| P0-04 WinUI/Worker IPC | **DesignOnly** | Named Pipe 协议和静态门禁通过；真实 WinUI/.NET Worker、跨 Windows SID ACL 尚未在隔离设备完成。 |
| P0-05 SQLite fencing | **DesignOnly** | 9/9 fencing 机制和独立 writer 测试通过；尚未接入生产 Worker/真实写入链路。 |
| P0-06 群组身份/catalog | **Passed** | 账号/群 JID 作用域、启用 target 唯一性、关系账本、进群登记、退群关系投影和未分类来源规则通过隔离测试。 |

## 关键修改

1. resources/app/migration-runner.cjs：动态读取 manifest，规范化 SQL checksum，拒绝未注册迁移和高版本库，持久化锁 generation，迁移前备份，迁移前 CRM/群 target 冲突检查。
2. resources/app/migrations/019-crm-base-schema.sql：客户主档/状态基础 schema 纳入版本链。
3. resources/app/migrations/020-ai-schema-authority.sql：完整 15 字段 ai_jobs、唯一幂等键和 claim 索引。
4. resources/app/migrations/021-crm-authority.sql：crm_identity_conflicts 与活跃 canonical 手机号 partial unique index。
5. resources/app/migrations/022-ws-group-identity.sql：customer_group_memberships 关系账本及启用 target 唯一索引。
6. resources/app/server.mjs：删除内联 AI DDL/租约 ALTER/无条件 running→queued；增加 CRM 冲突拒写、群关系账本和群状态不覆盖人工 CRM 状态。
7. scripts/stage1/*、tests/*：隔离迁移、AI、CRM、群组、fencing、IPC 和回归门禁。

## 队列映射与切换冻结

旧 ws_collection_runs/items、ai_jobs、ws_ai_analyses、evidence、follow-up 和消息批次的逐字段映射、状态转换、幂等键、checkpoint、回填和双读规则继续以冻结报告为准：

- docs/superpowers/reports/2026-11-15-stage1-queue-ai-mapping-freeze.md
- docs/superpowers/reports/2026-11-15-stage1-feature-flag-double-read-plan.md

本轮没有迁移旧队列、没有创建生产 outbox、没有运行双读生产写入。feature flag 仍保持关闭；后续切换必须先停旧 writer、撤销租约、对账零差异，再由批准的 Worker 单写入。

## 数据兼容与回滚

- 旧字段和 ws_ai_analyses 历史记录未删除；ai_jobs 历史状态、attempts、analysis 引用和幂等键保留。
- CRM 重复号码只报告冲突，不删除、不合并、不覆盖人工资料。
- 群关系允许一个客户关联多个群；退单群只改变对应关系。
- 迁移前由 runner 创建并校验 .backups 快照；失败不推进 user_version/迁移状态，恢复使用原子快照替换。
- 所有本轮测试数据库均为临时目录，测试结束清理；未触及生产路径。

## 准入建议

正式生产入口继续 **FROZEN**。原因是 P0-04 仍为 DesignOnly，跨 SID 子项为 NotTested，P0-05 仍未接入生产写入链路，且真实干净 Windows 设备、真实 WS 账号和设备迁移验收未在本轮执行。即使隔离 P0 全通过，也不能启动生产迁移或 Worker；等待下一次审核授权。
