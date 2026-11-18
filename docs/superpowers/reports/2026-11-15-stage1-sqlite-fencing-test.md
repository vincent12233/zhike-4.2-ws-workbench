# 阶段 1 P0-05：SQLite 单写入者与 fencing 隔离实测

验证日期：2026-11-15
基线：`6e4d195` 〔阶段 1 前置设计冻结〕
范围：临时 WAL SQLite 和独立连接；不打开生产 `workspace.sqlite`，不启动 Worker，不写入生产客户/消息。

## 1. 实际验证对象

- `scripts/stage1/sqlite-fencing-verification.cjs`：只在 `%TEMP%\\zhike-stage1-fencing-*` 创建临时库。
- 设计依据：`docs/superpowers/reports/2026-11-15-stage1-ipc-fencing-migration-design.md:83-111`。
- 生产现状审计：`resources/app/server.mjs:292-299,1446-1449,3134-3210`；当前存在 AI job 的任务级 `lease_token`，尚未存在业务 writer lease/fencing 表或统一单写入协调者。

## 2. 实测命令与结果

```text
node --check scripts/stage1/sqlite-fencing-verification.cjs
node scripts/stage1/sqlite-fencing-verification.cjs
```

两条命令均退出码 0。隔离脚本输出 `ok: true`、`Passed: 9`、`Failed: 0`、`tempClean: true`，并明确输出：

- `productionDatabaseOpened: false`
- `productionWorkerStarted: false`

通过的 9 项：

1. Worker A 获得持久化 lease/fencing token 1。
2. A 在同一事务提交业务事实和 checkpoint。
3. A 心跳中断后 lease 过期状态持久化。
4. Worker B 获得严格递增的 token 2。
5. A 带旧 token 恢复提交时影响行数为 0，checkpoint 保持 `cursor-1`。
6. B 带 token 2 提交事实与 `cursor-2`。
7. 重复 `idempotency_key` 不重复写入业务事实。
8. 第二个独立 SQLite 连接也拒绝旧 token，证明不是进程内锁。
9. 最终事实数、checkpoint 和 fencing token 一致。

## 3. 生产实现状态

隔离合同通过不等于生产已接入。当前生产代码没有 `writer_leases`/持久化 fencing token 的统一表和单写入 API；`ai_jobs.lease_token` 只保护单个 AI job，不能覆盖采集、群组、CRM 和 checkpoint 的全局写入所有权。

**P0-05：DesignOnly（隔离 fencing 合同 Passed；生产单写入者尚未实现）。阶段 1 生产准入：Blocked。**

## 4. 必须先完成的修复

- 由 sidecar 成为唯一 SQLite 写入协调者，Worker 不直接打开业务库。
- 在版本化迁移中落地 workspace/scope lease、generation/fencing token 和 holder 审计。
- 所有事实、关系、审计、checkpoint 写入放入同一事务，并在 SQL 条件中校验 token、owner、active 和 expiry。
- 旧 token 统一返回 `STALE_FENCING`；checkpoint 不得在业务事实提交失败时前进。
- 完成两个进程、崩溃恢复、锁竞争、超时和回滚演练后，才允许申请测试工作区 canary。

本轮只提交隔离测试和报告，没有生产迁移、生产表、生产 Worker 或真实账号变更。
