# 阶段 1.5 SQLite fencing 真实写入路径验收

## 状态

**Passed**（隔离 sidecar 真实写入路径；生产 Worker 接入仍未开启。）

## 实际修改

- `resources/app/sidecar-write-coordinator.cjs`：持久化 lease、单调 fencing token、事务内 token 校验、事实/幂等键/checkpoint 原子提交。
- `resources/app/server.mjs`：仅在 `ZHIKE_FENCING_MODE=isolated` 下初始化 fencing 表，并提供隔离测试路由；写入使用实际 `ws_messages` 表和同一 `DatabaseSync` 连接。
- `scripts/build-winui-bundle.ps1`：将 coordinator 纳入正式 WinUI bundle allowlist/required 检查，防止打包后缺少 `server.mjs` 运行依赖。
- `scripts/stage1/sqlite-fenced-writer.cjs`：同一 fencing 合约的隔离验证实现。
- `scripts/stage1/sqlite-fencing-sidecar-integration.test.cjs`、`sqlite-fencing-coordinator-failure.test.cjs`：租约接管、过期写入、幂等、崩溃/回滚/BUSY 场景。

## 事务边界

`runProtectedWrite` 执行顺序固定为：`BEGIN IMMEDIATE` → 校验当前 lease/token/expiry → 写入 `ws_messages` → 再次校验 → 写入 fact → 写入 checkpoint → 再次校验 → `COMMIT`。任意失败均 `ROLLBACK`，所以过期 Worker 不能留下业务消息、fact 或 checkpoint。

## 真实测试命令与结果

```text
node scripts/stage1/sqlite-fencing-sidecar-integration.test.cjs
real ws_messages write, lease takeover, stale rollback, checkpoint atomicity and idempotent replay passed

node scripts/stage1/sqlite-fencing-coordinator-failure.test.cjs
callback rollback and SQLite BUSY fail closed without business/fact/checkpoint residue passed

node scripts/stage1/sqlite-fenced-writer.test.cjs
Passed

node scripts/stage1/sqlite-fencing-verification.cjs
9/9 Passed; productionDatabaseOpened=false; productionWorkerStarted=false; tempClean=true
```

验证情景：A 获取 1000 ms lease 并延迟 1500 ms，B 在 A 过期后接管并提交；A 返回 `409 STALE_FENCE`，其业务写入与 checkpoint 均不存在；B 重放同一幂等键不重复；sidecar 重启后新 owner 可接管。

## 生产保护、回滚与提交

- 未增加 migration/manifest；普通生产模式不建 fencing 表、不暴露隔离路由。
- `ZHIKE_FENCING_MODE=isolated` 是唯一测试开关，生产入口保持关闭。
- 回滚到 `9e482b4` 之前可移除接入；临时 SQLite 测试目录结束后清理。
- 主要提交：`9e482b4`、`03d83d9`、`96206e8`、`68524a2`。

