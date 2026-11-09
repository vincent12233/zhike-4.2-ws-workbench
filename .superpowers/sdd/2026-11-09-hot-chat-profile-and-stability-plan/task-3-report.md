# Task 3 — PostgreSQL 热聊档案投影

## 状态

已完成实现，等待主控分支的独立 review。实现只使用隔离 fixture，没有连接或修改真实业务数据。

## RED / GREEN 证据

### RED

- 新增 `tests/server-v2/hot-chat-profile.test.cjs` 后首次运行失败：`Postgres migration 011 is required`。
- 新增 `tests/hot-chat-profile-api.test.cjs` 的“锁定后解除锁定”断言后首次运行失败：字段 `manualLocked` 仍为 `true`。

### GREEN

- `node tests/server-v2/hot-chat-profile.test.cjs` — 通过。
- `node tests/server-v2/api-contract.test.cjs` — 通过。
- `node tests/server-v2/postgres-migrations.test.cjs` — 通过（包含迁移 011、非破坏、幂等和唯一键检查）。
- `node tests/hot-chat-profile-api.test.cjs` — 通过（迁移、非变更读取、账号/会话隔离、证据合并、确认/拒绝/锁定/解除锁定、颜色、事件幂等、outbox 范围重试）。

当前容器没有 .NET SDK，无法在本机执行 `dotnet build`；C# 改动已通过静态契约和源代码检查，需在 CI/含 SDK 的构建机完成编译门禁。

## 实现内容

- `server/migrations/011-hot-chat-profiles.sql`
  - 新增 `hot_chat_profiles`、`hot_chat_profile_fields`、`hot_chat_events`、`hot_chat_sync_outbox`。
  - JSONB 事实值/标签/事件载荷、证据消息与分析引用、字段状态、置信度、版本、索引、唯一键和迁移登记。
  - 无 DROP/TRUNCATE；重复执行安全。
- `server/src/Zhike.Contracts/HotChatContracts.cs`
  - 新增热聊档案/字段/事件/诊断契约和兼容 `CustomerDto`，旧客户字段保持原样并仅增加热聊投影字段。
- `server/src/Zhike.Infrastructure/Repositories/HotChatProfileRepository.cs`
  - 账号×会话×客户范围校验、版本冲突、状态机、证据、人工锁、只补空客户字段、审计和同步 outbox 在同一事务内完成。
  - 通过 advisory transaction lock 和唯一键防止并发重复档案/事件。
- `server/src/Zhike.Api/Routes/HotChatRoutes.cs`
  - 新增 `/api/v2/ws/hot-chat/...`，并保留 `/api/v2/hot-chat/...` 兼容别名；支持 profile、field、event、diagnostics 和状态版本头。
- `server/src/Zhike.Api/Program.cs`
  - 注册仓储并映射路由；沿用现有配对会话与 workspace-owner 中间件。
- `server/src/Zhike.Infrastructure/Repositories/CustomerRepository.cs`、`server/src/Zhike.Api/Routes/CustomerRoutes.cs`
  - 客户列表/保存响应增加 `statusColor`、`tags`、`profileSummary`、`completenessScore`、`nextFollowupAt`，不删除旧字段。
- `infra/compose.yaml`、`infra/.env.example`、`docs/server-version-deployment.md`
  - 默认 schema 版本更新为 11，避免迁移目录与健康检查不一致。
- `resources/app/server.mjs`、`tests/hot-chat-profile-api.test.cjs`
  - 修复本地热聊资料“确认并锁定”后无法解除字段锁定的问题；显式 `locked:false` 现在同时清除字段级锁。
- `tests/server-v2/run-all.cjs`、`tests/server-v2/postgres-migrations.test.cjs`
  - 纳入迁移 011 和 PostgreSQL 热聊契约回归。

## 自检与边界

- 所有写入均使用参数化 SQL；动态客户列来自固定白名单。
- 账号/会话范围在读取和写入前校验，跨账号读取/重试被拒绝；未知会话不会被静默绑定到其他账号。
- 已知客户值不被 AI 覆盖；冲突进入 `pending`/事件，人工锁定优先。
- 隔离 PostgreSQL 18 Docker 实例已从 001–011 干净执行迁移（`schema_migrations.max(version)=11`），并核验 `source_message_id`/`analysis_id` 为软引用文本列；真实 AI/WS、备份恢复和桌面安装包仍交由后续任务/发布门禁验证。
- .NET SDK 未安装在宿主机；使用隔离 `mcr.microsoft.com/dotnet/sdk:10.0` 容器完成 API/Worker restore + build（0 警告、0 错误）。
- 服务器默认值已改为 schema 11；现有部署升级时必须先执行迁移，再检查 `/api/v2/health`。

## 追加审查（客户身份隔离）

- 复核发现旧版 `is_investor -> customers.status` 映射会污染原有业务状态；已移除该映射。`is_investor` 仍保存在热聊档案字段表及证据链中，旧客户表的 `status` 不再被 AI/热聊事实写入。
- 新增 `tests/server-v2/hot-chat-customer-isolation.test.cjs`，覆盖旧状态安全、账号×会话×客户范围校验，以及电话号码多候选时拒绝自动合并。
- AI 客户解析顺序保持为“已绑定会话 → 显式客户编号 → 电话身份/号码”；已有会话客户不会被替换，多个候选会进入人工确认路径。

## 追加审查（WS 列表级采集与断点链路）

### RED / GREEN 证据

- RED：新增 `tests/server-v2/ws-list-capture-contract.test.cjs` 后首次运行在缺少 `WsConversationEnvelope` 契约处失败（证明原实现只生成列表，未把列表传入 v2 API）。
- GREEN：该契约、`connectors/ws-worker/tests/transport-flush.test.cjs`、`connectors/ws-worker/tests/connector-protocol.test.cjs` 均通过；`node tests/server-v2/run-all.cjs` 通过 `24/24`。
- GREEN：隔离 Docker 构建 `docker build --target api -t zhike-task3-api-test -f server/Dockerfile server` 完成 API/Worker net10 publish，0 error；宿主机无 .NET SDK，未修改真实部署容器。

### 本轮实现

- `WsConversationEnvelope`、批次 `Conversations` 和兼容的 `ConversationsAccepted` 响应字段；旧消息/断点位置参数保持不变。
- Connector API 客户端转发可见会话列表，给每行补齐批次账号并拒绝跨账号行；list-only capture 不再因为空消息而丢失。
- WS ingest 路由校验列表数量、账号、键/预览长度、未读数和 visible-only 范围，并在同一仓储事务中写入会话标题/最后消息时间。
- PostgreSQL 会话自动创建的电话号码匹配改为“仅唯一候选自动绑定”；多个客户命中时保持 `customer_id = NULL`，不再使用 `LIMIT 1` 随机绑定。
- AI 上下文排序改为 `COALESCE(sent_at, observed_at)`，避免 `sent_at` 为空的手机同步消息被最新窗口漏掉；账号与会话过滤保持不变。

### 自审与边界

- 提交：`4ad5240 fix: persist WS list captures and guard ambiguous phones`。
- 当前轮的列表行已传递并持久化标题/时间；`unread_count`、`last_message_preview`、`visible_only`、`list_captured_at` 的新增列和预览 AI 触发由后续 012 元数据补丁负责，避免重复迁移。
- 只读审计发现 Playwright `onState` 目前只写日志，Connector heartbeat 仅在 flush 成功后发送；若登录等待或连续采集失败，服务端状态可能滞后。后续应将状态事件接入按账号串行的 heartbeat/status 更新，并在启动时恢复运行态。
- 本轮所有验证均使用静态 fixture、隔离测试文件和构建容器；未连接真实 WS、未读取或写入真实业务数据。
