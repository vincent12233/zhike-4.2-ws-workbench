# 知客 6.1 阶段 1 前置设计冻结：IPC、单写入者、fencing、迁移与回滚

审计日期：2026-11-15  
审计范围：WinUI 本机服务、Desktop Bridge、LocalQueue、WebView profile、SQLite migration runner、WS 导入/导出与备份路径。  
安全边界：只读审计；未创建生产表、未修改生产 SQLite、未启动新 Worker、未连接真实 WS。

## 1. 现状证据

### 本机 sidecar 与 IPC

- `LocalServiceManager.StartAsync` 在 `desktop/src/Zhike.Desktop/Services/LocalServiceManager.cs:40-75` 查找空闲端口、生成 32 字节随机 token，并通过 `ZHIKE_DATA_DIR`、`ZHIKE_PORT`、`ZHIKE_API_TOKEN`、`ZHIKE_PARENT_PID` 启动随包 Node sidecar（约 197-221 行）。
- `RestartAsync` 在 `LocalServiceManager.cs:78-108` 首次复用旧端口和旧 token，再在失败后切换端口；这能保持旧客户端会话，但不满足阶段 1 的“重启立即撤销旧 token”目标。
- `ApiClient.SetSessionToken` 在 `desktop/src/Zhike.Desktop/Services/ApiClient.cs:121-132` 同时发送 Bearer 和 `X-Zhike-Api-Token`。
- sidecar 在 `resources/app/server.mjs:2287-2298` 仅校验 loopback Host、Origin 和单一 `x-zhike-api-token`；当前没有 Windows SID、角色 capability 或 IPC 会话权限。
- Bridge 层已有 `requestId`、`bridgeVersion`、账号和超时校验，见 `desktop/src/Zhike.Desktop/Views/LegacyUiHostPage.xaml.cs:818-925`；该协议目前只覆盖 WebView→WinUI Bridge，不等于 Worker→sidecar 的权限协议。
- 阶段 0 探针已验证动态 loopback、一次性 token、心跳、取消和崩溃恢复；尚未验证命名管道 ACL/SID、.NET Worker 与 WinUI 的真实握手。

### 队列和本地离线路径

- `desktop/src/Zhike.Desktop/Services/LocalQueue.cs:8-37` 使用 `%LOCALAPPDATA%\\Zhike6\\queue\\pending.json` 与 `dead-letter.json`；`Enqueue/Remove/MarkFailure` 在 39-121 行通过进程内 `SemaphoreSlim` 串行化并完整重写 JSON 文件。
- 该队列与 SQLite `ai_jobs` 是两个事实链路，不能作为同一 outbox 处理；阶段 1 必须先明确迁移和停写顺序。

### WebView profile

- `desktop/src/Zhike.Desktop/Services/WebViewProfileService.cs:18-27` 为前台和 collector 创建两个 WebView2 profile。
- `PrepareCollectorProfileAsync` 在 30-109 行把前台 profile 复制到 collector staging 目录，再交换目录；这会复制 WebView 授权态，和 6.1“不得复制 Cookie/Token/WebView 登录态”的安全约束冲突。新 Worker 启用前必须关闭该路径。

### SQLite 迁移、版本和队列

- `resources/app/server.mjs:102-261` 以硬编码 `if (user_version < N)` 逐段运行 005–018；当前迁移目录最高为 018。
- `server.mjs:264-299` 内联创建 `ai_jobs`、索引和 `lease_token`，不属于版本化迁移文件；启动时还会将 `running` 任务直接恢复为 `queued`。
- `server.mjs:639-675` 的 WS 导出按表分页读取；`server.mjs:4217-4339` 的导入只接受最多 50 MB JSON，版本只允许 v5/v6，并按账号删除后重建 settings、conversation、message、analysis、reply、batch、collection 和 followup 数据。
- 导出/导入对象不对称，导入未恢复全部发送审计、媒体、群目录和完整 CRM 作用域；导出前也没有 Worker quiesce/WAL snapshot barrier。
- `server.mjs:853-884` 在启动阶段执行 `repairCustomerPhoneIndex()`，会全表读取和更新客户索引，与“启动只检查版本、全量修复后台化”设计冲突。

## 2. 冻结的 IPC 安全协议

### 传输选择

- Worker 使用 Windows Named Pipe 作为正式通道；命名格式：`\\.\\pipe\\Zhike6-{workspaceHash}-{sessionId}`。
- loopback HTTP 仅保留给现有 sidecar 兼容路径和阶段 0 探针；新 Worker 不直接暴露可扫描 TCP 端口。
- Worker 由 WinUI 进程以受控子进程启动，sidecar 仍是 SQLite 唯一写入者。

### ACL、身份和 token

- 创建管道时使用当前 Windows 用户 SID 的显式允许规则，仅允许当前用户和应用进程身份；拒绝 `Everyone`、匿名和交互式其他用户。
- Worker 启动生成 32 字节随机 session token，token 只存在 WinUI 内存和 Worker 握手内存，不写入业务数据库、日志或迁移包。
- 握手采用 nonce challenge：WinUI 发送 `hello`，Worker 返回 nonce，双方使用 session token 计算 HMAC；成功后生成 `sessionId`。每次 Worker 重启、WinUI 重连或身份变化都轮换 token 并撤销旧 session。
- 旧 token、旧 `sessionId`、旧 `fencingToken` 统一返回 `AUTH_REVOKED` 或 `STALE_FENCING`，不能继续调用业务接口。

### 消息封套

每条请求和响应都必须包含：

```json
{
  "schemaVersion": 1,
  "requestId": "uuid",
  "sessionId": "uuid",
  "traceId": "uuid",
  "accountId": "account-id",
  "capabilities": ["collector.read", "queue.claim"],
  "issuedAt": "ISO-8601",
  "deadlineAt": "ISO-8601",
  "fencingToken": "lease-token",
  "kind": "request|response|event|heartbeat|cancel",
  "payload": {}
}
```

- `requestId` 在 session 内幂等；重复请求只能返回第一次结果或明确 `DUPLICATE_REQUEST`。
- `schemaVersion` 不支持时返回 `UNSUPPORTED_SCHEMA`，不猜测字段。
- `accountId`、作用域和 capability 由 WinUI 会话注入，Worker 不接受前端自报的更高权限。
- 错误固定为 `AUTH_REVOKED`、`CAPABILITY_DENIED`、`INVALID_REQUEST`、`TIMEOUT`、`CANCELLED`、`STALE_FENCING`、`CONFLICT`、`SOURCE_LIMITED`、`RETRYABLE`、`FAILED`，日志只保留脱敏 ID 和错误码。

### 心跳、取消和断线

- Worker 每 5 秒发送 heartbeat；连续 3 次未收到确认（15 秒）视为失联。
- WinUI 发送 cancel 后必须收到 `cancel-ack`；2 秒内未确认则关闭本次请求，5 秒内未退出的 Worker 由宿主终止进程树。
- 请求默认 30 秒 deadline，历史扫描/导出使用显式更长 deadline，但不能超过 5 分钟的单次 IPC 请求；长任务通过 job ID 查询。
- 重连流程：撤销旧 session → 重新握手 → 读取租约与 checkpoint → 仅恢复过期任务；不自动重放未确认的发送操作。

## 3. 冻结的 SQLite 单写入者与 fencing

### 唯一写入协调者

- sidecar SQLite 进程是唯一数据库写入者。Worker 只负责获取来源数据、维护内存状态和发送带证据的事件；Worker 不直接打开业务 SQLite。
- 所有采集、AI、群事件、客户关联和 checkpoint 写入通过 sidecar 的事务 API 完成。
- `LocalQueue.pending.json` 在阶段 1 作为旧桥接队列保留只读/排空状态；停止其写入后才能启用 Worker 写入。

### 租约模型

阶段 1 实施迁移前冻结以下逻辑字段（实际表名和 DDL 需在映射审计批准后落地）：

- `leaseId`、`scopeType`、`scopeKey`、`ownerId`、`sessionId`。
- `fencingToken`（每次重新取得租约递增且不可复用）。
- `status`（`active/expired/revoked`）、`acquiredAt`、`expiresAt`、`lastHeartbeatAt`。
- 唯一约束：同一 `scopeType + scopeKey` 只能有一个 active lease。

所有写入事务必须带 fencing token，并在 SQL 更新条件中校验 token 和租约状态；旧 Worker 的写入影响行数为 0 时返回 `STALE_FENCING`。

### 事务和 checkpoint 顺序

1. Worker 读取来源并生成带 `sourceCursor`、`sourceEventId`、`evidenceHash` 的事件。
2. sidecar 开启 `BEGIN IMMEDIATE`，验证 lease/fencing/capability。
3. 插入幂等事件或消息；重复键只返回既有结果。
4. 更新客户关系、AI outbox 投影或任务状态。
5. 只有事实、关联和审计全部提交成功后，才推进对应 checkpoint。
6. `COMMIT` 后发送 ack；未提交或 `ReviewRequired` 事件不得推进可丢失游标。

崩溃恢复只重放最后一个未 ack 的事件，依靠 `sourceEventId + accountId + scopeKey` 幂等键去重。旧 checkpoint 必须按 `accountId + collectorRole + conversation/group/source` 分区，不能让普通会话采集和群监控共用游标。

## 4. 冻结的迁移和回滚格式

### 当前版本矩阵

| 数据/程序 | 当前 | 阶段 1 目标 | 规则 |
|---|---:|---:|---|
| `PRAGMA user_version` | 18 | 18→后续正式迁移 | 未批准前不创建新版本 |
| migration runner | 硬编码 005–018 | 按版本清单顺序加载 | 先改 runner，再发布迁移 |
| `ai_jobs` | server 内联创建 | 纳入正式迁移或兼容视图 | 不能继续隐藏 DDL |
| 6.0.3 客户/WS 数据 | 可运行 | 原地升级或 `.zkdevice` 导入 | 两种路径必须统一规则 |
| 旧版本数据库 | 0–18 | 低于目标可升级 | 高于支持版本只读拒绝 |

### 原地迁移流程

1. sidecar 获得 workspace lock，暂停旧前端队列和后台采集，等待 in-flight 写入完成。
2. 使用 SQLite backup API 创建校验快照，记录源 schema、文件大小、WAL checkpoint、高水位和 SHA-256。
3. 在临时数据库复制迁移，执行完整 integrity/foreign-key/业务计数校验。
4. 仅当校验通过，停止 sidecar，原子替换工作库；原库保留为可恢复快照。
5. 新 sidecar 启动后执行只读对账；任一差异未解释则回滚快照并禁用新 feature flag。
6. 原地升级失败不得让旧版打开部分迁移库；恢复时用快照整体替换。

### `.zkdevice` 与旧备份

- `.zkdevice` 是跨设备迁移格式，另行定义加密封套、manifest、媒体分片和冲突报告；不包含 Cookie、Token、WebView profile 或 AI Key。
- 当前 `NativeBackupEnvelope` 仍是完整性封装，`/api/ws/import` 仍是 50 MB JSON v5/v6 路径；阶段 1 只能把它视为旧兼容入口，不能宣称已经满足加密迁移。
- 旧 JSON/`zhike-6-native-workspace` 必须先转换为 `.zkdevice` 临时数据库，转换失败保留原文件并报告，不覆盖目标库。
- 已有数据合并默认关闭；目标工作区必须先 dry-run，发现客户、账号、消息、媒体或删除墓碑冲突时停止导入。

## 5. feature flag、双读和切换

阶段 1 使用以下默认关闭的持久化 flags：

- `ws.collector.worker.v1`
- `ws.ai.outbox.v1`
- `ws.crm.domain-authority.v1`
- `ws.ipc.named-pipe.v1`
- `ws.group-monitor.worker.v1`

切换顺序：

1. flag 全部关闭，旧路径正常运行。
2. 只读 schema/写入者审计和脱敏副本回填。
3. 开启双读适配器，比较旧结构与目标投影的数量、状态、关键字段、唯一键和关联；差异必须有解释。
4. 停止旧写入者、排空 `pending.json`、撤销旧租约，确认无旧写入者后才允许 Worker/sidecar 新写入。
5. 灰度单账号/单工作区，持续检查重复采集、重复 AI、checkpoint 回退、CRM 关联和任务丢失。
6. 扩大范围前完成故障注入、重启、断电和回滚演练。

双读永远是只读验证，不允许旧队列和新 Worker 同时写同一业务事实。回滚顺序为：停新 Worker → 撤销租约 → 关闭新 flag → 隔离新任务 → 恢复快照/兼容读取；不得仅关闭 UI flag 后继续让旧代码写入新结构。

## 6. 阶段 1 实施任务清单

1. 完成逐表逐字段队列/AI 映射合同，确认 `ws_collection_items` 的任务、覆盖和 AI 状态拆分方式。
2. 把 `ai_jobs` 从 server 内联 DDL 纳入版本化迁移设计，并定义 attempts/evidence 的兼容视图。
3. 关闭前台队列写入，定义 sidecar 写入 API 和旧 `LocalQueue` 排空/死信策略。
4. 在隔离测试环境实现 Named Pipe ACL/SID、nonce-HMAC、token 轮换和 capability 校验。
5. 实现租约/fencing 状态机和 stale writer 拒绝测试。
6. 定义 checkpoint 分区、事件幂等键和 ReviewRequired 重放规则。
7. 冻结 CRM 权威源、跨账号身份映射和冲突审核规则。
8. 完成动态 migration runner、高版本库拒绝、临时库迁移、完整性校验和原子替换演练。
9. 设计旧 JSON 备份到 `.zkdevice` 的转换报告和失败恢复流程。
10. 仅在以上项目通过隔离验证后申请阶段 1 生产实施。

## 7. 已验证与未验证

已验证：

- 阶段 0 Node Worker 探针的动态端口、token、心跳、取消、崩溃恢复和临时 SQLite。
- 现有 6.0.3 全量回归 205/205。
- 当前 sidecar/Bridge 的 loopback token、requestId、bridgeVersion、超时和资源生命周期合同。

未验证、因此属于阶段 1 准入门禁：

- .NET Worker 与 WinUI 的真实 Named Pipe 通信。
- Windows ACL/SID 和 capability 不能越权。
- token 轮换和旧 session/fencing 写入拒绝。
- SQLite 单写入者与 checkpoint 原子提交。
- 旧队列排空、双读零差异和 feature flag 切换。
- 原地迁移、版本拒绝、快照替换和回滚。
- `.zkdevice` 加密、媒体流、旧备份转换和设备导入。
- WebView2 独立授权会话与前台聊天隔离。

本报告只冻结设计和准入条件，不授权生产迁移、生产 Worker 或新旧队列并行写入。
