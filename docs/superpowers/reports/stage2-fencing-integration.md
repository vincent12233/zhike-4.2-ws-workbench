# 知客 6.1 阶段 2 SQLite Fencing 集成报告

## 状态

**Passed（隔离写入入口）**

`worker-fencing-gate.cjs` 是对已经验收的 `resources/app/sidecar-write-coordinator.cjs` 的显式 gate：

- `enabled !== true` 时立即抛出 `WORKER_FENCING_DISABLED`，不会调用 writer。
- `enabled === true` 时只委托既有 `runProtectedWrite`，继续使用同一 SQLite 事务内的 lease/fencing 校验、幂等键和 checkpoint。
- gate 本身不创建表、不打开数据库、不改变生产 sidecar 启动条件。

## 实测命令

```text
node scripts/stage2/worker-fencing-gate.test.cjs
node scripts/stage1/sqlite-fencing-sidecar-integration.test.cjs
node scripts/stage1/sqlite-fencing-coordinator-failure.test.cjs
node scripts/stage1/sqlite-fenced-writer.test.cjs
```

结果：Passed。关闭 gate fail-closed；开启 gate 的临时 SQLite 业务写入与事实/checkpoint 在同一事务提交；阶段 1.5 的租约接管、过期 owner 拒绝、重复幂等、回滚和 SQLite BUSY 回归均通过。

## 数据保护

所有本阶段写入均为临时 SQLite。生产 SQLite 未打开或修改。
