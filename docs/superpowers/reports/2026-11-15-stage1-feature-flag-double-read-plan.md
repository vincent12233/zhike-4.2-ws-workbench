# 知客 6.1 阶段 1：Feature Flag、双读对账与切换方案

审计日期：2026-11-15  
基线：`68749e4`；本文件仅为只读设计冻结。

## 1. 当前写入者与切换风险

当前至少有三条持久化路径：

1. `resources/app/modules/ws-workbench.js` 直接调用 `/api/ws/collection-runs`、`/api/ws/collection-items`、`/api/ws/ai-jobs` 和 `/api/ws/analyses`。
2. `resources/app/server.mjs` 在同一 sidecar 内执行 SQLite 事务、AI claim/lease/retry/recovery 和客户治理。
3. `desktop/src/Zhike.Desktop/Services/LocalQueue.cs` 使用 `%LOCALAPPDATA%\\Zhike6\\queue\\pending.json` 的本地桥接队列；它不是 SQLite `ai_jobs`，不能作为同一 outbox 直接合并。

因此，不能以“新 Worker 也调用旧 API”作为灰度，也不能以关闭页面按钮代替撤销旧写入者。

## 2. Flags 设计

Flags 必须按工作区/账号持久化，默认值保持旧路径；启动时只读取和校验，不自动切换。建议键：

| Flag | 默认 | 作用 | 安全边界 |
|---|---|---|---|
| `collector.writer` | `legacy` | `legacy` 旧前端/API；`shadow` 只读探针；`worker` 新写入者 | `shadow` 不得写业务表、AI、CRM 或群组事件 |
| `collector.readModel` | `legacy` | 旧表读或批准的兼容读 | 切换前必须允许逐账号回退 |
| `ai.writer` | `legacy` | 旧 `ai_jobs` 路径或新 outbox | 同一账号同一时刻只能一个 writer |
| `crm.writer` | `legacy` | 现有 `app_state`/customers 同步或协调者 | 普通聊天 AI 永远不能以 flag 获得自动建档权限 |
| `groupMonitor.writer` | `legacy` | 现有群监控服务或新协调者 | 仅选定目标群；不影响 VIP 管理主档 |
| `ipc.protocol` | `v1` | 阶段 1 冻结的本机协议版本 | 未完成握手/能力协商不得执行写入 |

Flags 的有效值、账号范围、修改者、时间、上一值/下一值写入操作日志；未知值按安全失败处理。不能用全局环境变量绕过账号级门禁。

## 3. 双读对账

### 3.1 读取范围

仅在隔离数据库或已批准的只读副本上同时读取旧结构和目标适配器，按 `account_id`、时间窗和稳定任务键比较：

- 采集 run/item：行数、主键、账号/会话、状态、attempts、coverage、checkpoint、错误和时间。
- AI：idempotency key、payload 输入哈希、状态、attempt、analysis_id、模型/版本和错误。
- 分析/证据：分析 ID、客户 ID、字段名、证据哈希、置信度、人工状态。
- 群组：账号、group JID、target/catalog 稳定 ID、事件 source_event_id/idempotency_key、checkpoint。

### 3.2 差异分类

`equal`、`legacy-only`、`target-only`、`field-conflict`、`duplicate-key`、`orphan`、`unmapped`。每一条差异必须带 source row、target row（若有）、规则编号和处置结论；禁止以数量相等替代逐记录对账。

### 3.3 通过门槛

- 关键主键和幂等键无未解释 duplicate。
- 任务、分析、证据、客户、群事件没有未解释 orphan。
- status/checkpoint 差异均有批准的转换规则。
- 只读对账连续两个完整窗口为零未解释差异。
- 双读期间不调用真实 AI、不发送消息、不修改 CRM、不推进生产 checkpoint。

## 4. 切换状态机

```text
legacy-active
  -> shadow-read
  -> drain-requested
  -> legacy-drained
  -> fence-issued
  -> worker-canary
  -> worker-active
```

- `legacy-active`：生产默认。新 Worker 不得接账号。
- `shadow-read`：只读目标适配器/探针，结果写隔离日志或临时数据库。
- `drain-requested`：停止新旧队列接收，等待在途批次结束/取消。
- `legacy-drained`：确认旧 writer 数为 0、旧 lease 已过期/撤销。
- `fence-issued`：写入新世代 fence token，旧 token 的写请求必须得到 `StaleFence`。
- `worker-canary`：仅测试账号/隔离工作区，开启新 writer；持续双读。
- `worker-active`：经批准后逐账号启用；仍保留旧兼容读取和回滚开关。

任何状态迁移都要持久化 `transition_id`、操作者、old/new flag、fencing token、时间、对账摘要和回滚点。

## 5. 回滚

回滚顺序固定为：暂停新 writer → 保存目标任务/事件/错误快照 → 使新 fence 失效 → 标记未确认批次为 retryable（不删除）→ 验证旧 schema/兼容读可用 → 恢复 legacy writer → 重新对账。禁止同时打开 legacy 和 worker 写入；禁止仅关闭 UI 开关而保留旧 Worker 进程。

## 6. 阶段 1 禁止事项

- 不创建 `ws_collector_jobs`/`ws_ai_outbox` 等生产并行表。
- 不让前端和 Worker 同时 claim、checkpoint、写分析或写客户。
- 不把 `pending.json` 当作 SQLite outbox 的第二写入口。
- 不以模拟数据或固定成功返回证明切换成功。
- 不在真实 WS 账号上执行 shadow 读取，除非隔离授权和账号范围已通过审核。

## 7. 交付物

必须提交 flag schema、状态机审计日志格式、对账器输出样例、故障注入记录、单 writer/fence 交接记录和回滚演练报告；本文件完成后仍需审核，不代表生产切换获批。
