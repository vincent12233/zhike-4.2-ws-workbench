# 阶段 1.6 P0 最终门禁复核

## Gate 状态

**FROZEN**

## 总体状态

**NotTested**。六项 P0 中跨 SID Named Pipe ACL 尚未获得第二真实 Windows 用户的实际拒绝证据，因此不能把基础设施门禁标为 `Passed`，也不能进入生产迁移或正式 Worker 上线。

## P0 矩阵

| P0 项目 | 状态 | 本轮证据 |
|---|---|---|
| Migration Runner | Passed | `migration-runner-verification.cjs`：manifest v22、重复运行、并发与失败回滚通过 |
| AI Schema 权威 | Passed | `ai-schema-authority-verification.cjs`：020 权威迁移、状态集合、幂等和隔离库通过 |
| CRM 去重与写入权威 | Passed | `crm-group-authority-test.cjs`：客户主键、全局电话去重、普通 WS 不自动建档、群组确认建档通过 |
| 群组身份与关系账本 | Passed | CRM/group authority 与 211 项全量回归通过；关系状态不覆盖人工 CRM 生命周期 |
| Named Pipe IPC | NotTested | 同 SID `integrationStatus=Passed`；跨 SID ACL/应用拒绝缺少第二用户凭据 |
| SQLite fencing | Passed | 实际 sidecar `ws_messages` 写入、过期 Worker 拒绝、接管、checkpoint 原子性、BUSY/回滚/幂等通过 |

## 兼容性复核

- 019–022 迁移结构和旧队列兼容性通过；旧 `ws_collection_runs/items`、AI 历史、旧 `ai_jobs` 保留。
- 没有第二套生产 AI outbox，没有正式回填，没有新旧队列双写；旧队列仍是当前生产权威。
- feature flag 默认关闭，`ws.collector.worker.v1`、`ws.ai.outbox.v1`、`ws.ipc.named-pipe.v1`、`ws.group-monitor.worker.v1` 均未获得生产执行权限。
- WinUI x64/win-x64 构建为 0 warnings/0 errors；完整回归为 211/211。

## 数据保护结论

本轮没有打开或修改生产 SQLite，没有连接真实 WS，没有启动正式 Worker/AI Worker，没有复制 Cookie、Token 或 WebView 登录态。临时进程、临时数据库和临时目录已清理。

## 下一准入条件

1. 使用两个 SID 不同的真实 Windows 用户（或受控测试 VM）。
2. 用现有凭据完成 A host/B client ACL 拒绝、应用握手拒绝、无写入和清理证据。
3. 重新运行 IPC、fencing、队列兼容性、全量回归和 WinUI 构建。
4. 由单独审批决定是否解冻；本报告不自动执行迁移、Worker 上线或发布。

## 提交与工作区

- 复核代码基线：`81287a0`。
- 本轮 `git diff --check` 为 `exit 0`；交付提交后工作区为 clean。
