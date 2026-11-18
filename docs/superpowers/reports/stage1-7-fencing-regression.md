# 阶段 1.7 SQLite fencing 回归

## 状态

**Passed**

## 实测命令

```text
node scripts/stage1/sqlite-fencing-sidecar-integration.test.cjs
node scripts/stage1/sqlite-fencing-coordinator-failure.test.cjs
node scripts/stage1/sqlite-fenced-writer.test.cjs
node scripts/stage1/sqlite-fencing-verification.cjs
```

结果：真实 `ws_messages` 写入、租约接管、过期 Worker 拒绝、checkpoint 原子性、幂等重放、SQLite `BUSY`、回滚和两连接 fencing 均通过；verification 为 `Passed=9`、`Failed=0`、`tempClean=true`。

所有结果均为隔离临时 SQLite，`productionDatabaseOpened=false`、`productionWorkerStarted=false`。

## 提交与工作区

测试基线：`8ca8bc5`；`git diff --check` 通过；没有业务数据迁移。
