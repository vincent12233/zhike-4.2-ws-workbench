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
- PostgreSQL 真实 Docker 实例、真实 AI/WS、备份恢复、桌面安装包和 .NET 编译尚未在本任务环境运行，分别交由后续任务/发布门禁验证。
- 服务器默认值已改为 schema 11；现有部署升级时必须先执行迁移，再检查 `/api/v2/health`。

## 追加审查（客户身份隔离）

- 复核发现旧版 `is_investor -> customers.status` 映射会污染原有业务状态；已移除该映射。`is_investor` 仍保存在热聊档案字段表及证据链中，旧客户表的 `status` 不再被 AI/热聊事实写入。
- 新增 `tests/server-v2/hot-chat-customer-isolation.test.cjs`，覆盖旧状态安全、账号×会话×客户范围校验，以及电话号码多候选时拒绝自动合并。
- AI 客户解析顺序保持为“已绑定会话 → 显式客户编号 → 电话身份/号码”；已有会话客户不会被替换，多个候选会进入人工确认路径。
