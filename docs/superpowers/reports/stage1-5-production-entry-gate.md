# 阶段 1.5 生产入口准入结论

## Gate 状态

**FROZEN**。本报告的状态字段为 **NotTested**，因为跨 SID 验收未完成；不得进入生产迁移、生产 Worker 或队列切换。

## 条件矩阵

| 条件 | 状态 | 证据 |
|---|---|---|
| 同 SID WinUI Supervisor/Worker Named Pipe 集成 | Passed | runtime integrationStatus=Passed |
| 第二 Windows 用户跨 SID ACL | NotTested | 当前环境无第二真实用户 |
| IPC 总体验收 | NotTested | 不能由同 SID 结果推断跨 SID |
| sidecar 实际 `ws_messages` fencing 写入 | Passed | A 过期拒绝、B 接管、事实/checkpoint 原子性 |
| BUSY、回滚、幂等和重启恢复 | Passed | fencing failure/sidecar tests |
| 旧队列与 AI/CRM 兼容性 | Passed | manifest v22 临时库保留验证 |
| 全量回归 | Passed | 211/211 |
| 生产 Worker 启动 | Passed（未启动） | `productionWorkerStarted=false` |
| 生产 SQLite 打开/修改 | Passed（未触及） | `productionDatabaseOpened=false` |
| 旧新队列双写 | Passed（未发生） | `noDualWrite=true` |
| 真实 WS 账号连接 | NotTested（本轮禁止） | 未连接真实账号 |

## 必须继续冻结

- `ws.collector.worker.v1`、`ws.ai.outbox.v1`、`ws.ipc.named-pipe.v1`、`ws.group-monitor.worker.v1` 生产开关保持关闭。
- 不执行 `ws_collection_runs/items` 正式回填、不切换 AI outbox、不启动正式采集/分析 Worker。
- 不复制 Cookie、Token 或 WebView 登录态，不以本轮隔离测试替代真实设备验收。

## 数据保护与回滚

本轮只修改代码、隔离测试和报告；普通生产 server 未设置 `ZHIKE_FENCING_MODE=isolated`，不创建 fencing 表、不暴露隔离写入路由。回滚提交：IPC/兼容性 `bce0efb`，fencing `9e482b4` 及后续修复。没有生产数据迁移，故无业务数据回滚动作。

## 下一准入条件

必须在隔离环境完成第二真实 Windows 用户的 ACL/拒绝测试，并重新运行全量回归；通过后才可提交下一阶段申请。即使 IPC 通过，也不能自动启动生产迁移。
