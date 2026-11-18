# 阶段 1.6 SQLite fencing 回归

## 状态

**Passed**（隔离 sidecar 的实际 `ws_messages` 写入路径；生产 Worker 接入仍为关闭状态。）

## 实测命令

```text
node scripts/stage1/sqlite-fencing-sidecar-integration.test.cjs
node scripts/stage1/sqlite-fencing-coordinator-failure.test.cjs
node scripts/stage1/sqlite-fenced-writer.test.cjs
node scripts/stage1/sqlite-fencing-verification.cjs
```

结果：

- 真实 `ws_messages` 写入、租约接管、过期写入回滚、checkpoint 原子性和幂等重放通过。
- callback rollback、SQLite `BUSY` 和故障关闭路径通过，未残留业务/fact/checkpoint。
- fenced writer 合约输出 `staleWriterRejected=true`、`idempotentReplay=true`、`checkpointOrder=true`。
- verification 输出 `Passed=9`、`Failed=0`、`tempClean=true`。
- 所有隔离结果均为 `productionDatabaseOpened=false`、`productionWorkerStarted=false`。

## 事务安全证据

受保护写入在同一事务内依次执行：获取 `BEGIN IMMEDIATE`、校验 lease/fencing token/expiry、写入业务事实、再次校验 fencing token、写入 checkpoint、提交。过期 Worker A 在 Worker B 接管后提交时被拒绝，A 的业务写入和 checkpoint 均不推进；B 可提交，重复幂等键不产生第二条事实。

## 边界与回滚

`ZHIKE_FENCING_MODE=isolated` 仅用于隔离测试；普通生产启动不会创建 fencing 表或暴露测试路由。没有真实 WS、生产 SQLite、正式 Worker 或新旧队列双写。回滚不需要业务数据恢复，代码可回滚到本阶段之前的 fencing 提交。

## 基线

本轮测试基线为 `81287a0`；测试临时目录已清理，Worker 进程数为 0。

## 提交与工作区

- fencing 实现基线：`9e482b4`、`03d83d9`、`96206e8`、`68524a2`，本轮复核在 `81287a0` 执行。
- `git diff --check`：`exit 0`；交付提交后工作区为 clean。
