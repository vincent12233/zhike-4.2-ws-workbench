# 阶段 1 P0 生产入口 Gate

## Gate 状态

**FROZEN — 不准进入生产迁移或生产 Worker 阶段**

## 条件检查

| 条件 | 结果 |
|---|---|
| 迁移 Runner 实现与隔离验证 | Passed |
| AI schema 单一权威 | Passed |
| CRM 主档/手机号冲突保护 | Passed（隔离范围） |
| 群组身份/catalog/关系账本 | Passed（隔离范围） |
| Named Pipe 真实 WinUI/.NET 集成 | DesignOnly |
| SQLite fencing 生产路径集成 | DesignOnly |
| 全量回归 | 206/206 passed |
| 生产数据库/客户数据是否触及 | 否 |
| 正式 Worker 是否启动 | 否 |
| 新旧队列是否双写 | 否 |
| 真实 WS 登录/干净设备验收 | 未执行 |

## 必须保持冻结

- ws.collector.worker.v1、ws.ai.outbox.v1、ws.ipc.named-pipe.v1、ws.group-monitor.worker.v1 等生产切换保持关闭。
- 不执行 ws_collection_runs/items 正式回填，不执行 AI outbox 切换。
- 不复制 Cookie、Token 或 WebView 登录态。
- 不将隔离 fixture 的成功状态当作真实设备/真实账号验收。

## 回滚

代码回滚到 7927419 或指定批准 commit；数据库迁移未触及生产，因此无需数据回滚。隔离数据库和临时 Worker 状态可直接销毁；生产安装包和用户数据不受影响。

## 审核建议

当前建议：继续保持阶段 1 正式实施冻结，先补齐真实 WinUI/.NET Named Pipe 与跨 SID 验证、fencing sidecar 接入设计、干净 Windows 10/11 安装测试和真实 WS 只读联调。下一次批准必须明确测试设备、账号范围、数据快照和停止条件。
