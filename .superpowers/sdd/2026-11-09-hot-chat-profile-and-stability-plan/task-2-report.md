# Task 2 report — SQLite 热聊客户档案、事务 API 与本地 outbox

## RED / GREEN

- RED: 新增 `tests/hot-chat-profile-api.test.cjs` 覆盖迁移启动、档案隔离、字段证据去重、`X-State-Version` 冲突、事件幂等和 outbox；首轮启动在迁移完成前请求，得到 `ECONNREFUSED`，确认测试需要等待独立服务就绪。
- GREEN: 增加启动等待后，API 测试通过：`hot-chat-profile-api: migration, isolation, evidence dedupe, version conflicts, events and outbox passed`。

## 实现

- `resources/app/migrations/011-hot-chat-profile.sql`
  - 新增 `hot_chat_profiles`、`hot_chat_profile_fields`、`hot_chat_events`、`hot_chat_sync_outbox`。
  - 添加账户、会话、客户、字段状态、事件幂等和 outbox 队列索引；迁移使用 `IF NOT EXISTS`，可重复执行。
- `resources/app/server.mjs`
  - 将 SQLite `user_version` 迁移到 11。
  - 新增账户/会话作用域的 GET/PUT 档案、POST facts/confirm/events、GET diagnostics，以及 POST sync-retry 路由。
  - 所有档案写入使用事务和 `X-State-Version`；成功写入递增共享版本，过期版本返回 409。
  - 使用 Task 1 的 `hot-chat-profile-core.js` 规范化字段、状态、完整度和颜色，不在 server 中复制规则。
  - 事件使用幂等键，字段证据按值和证据文本去重；每次本地写入先写 profile/event/outbox，再允许 CRM 状态同步。
  - `/api/ws/crm-sync` 将分析中的热聊 profile facts 写入档案和 outbox，并保持重复分析、跟进和提醒幂等。
  - outbox retry 路由以本地可重试状态更新为 `sent`，不阻塞 SQLite 本地写入。

## 验证

- `node tests/hot-chat-profile-api.test.cjs`
- `node tests/hot-chat-profile-core.test.cjs`
- `node tests/customer-governance-api.test.cjs`
- `node tests/ws-workbench-api.test.cjs`
- `node tests/ws-workbench-migration-v6.test.cjs`
- `node tests/backup-restore-drill.cjs resources/app`

以上命令均通过。

## 自审与关注点

- SQLite 是离线事实源；PostgreSQL 只由 outbox 表示，未引入网络依赖或 UI 改动。
- 档案可在客户或会话尚未解析时以空标识保存；账户仍受 WS 账号表约束。
- 现有备份/恢复测试保持通过；热聊专属表暂不加入旧 WS 可移植备份载荷，后续任务可补充导出格式。

## Fix round 1 review follow-up (2026-11-09)

RED evidence: expanded API regression tests initially failed because GET profile seeded `hcp-*` rows; the test expected a non-mutating read. The same test also caught conflicting age facts overwriting the original value and reject confirmations remaining `known`.

GREEN changes:

- GET profile and diagnostics now return an in-memory default payload when no row exists; reads do not insert rows or increment the shared state revision.
- Profile writes use `hot-chat-profile-core.mergeEvidence`: existing values survive conflicting evidence and move to `pending`, evidence is deduplicated by value/text, and manually locked fields are protected. Confirm/reject explicitly set `known`/`declined`; confirmation idempotency keys dedupe events. Manual colors use the five-color allowlist.
- CRM sync short-circuits repeated analyses using the persisted `analysis_profile` event before mutating CRM state, keeping revision, profile version, activity and outbox unchanged. Hot profile evidence/outbox remains inside the same transaction before the customer state write.
- Outbox retry leaves rows `pending` with an incremented attempt and `awaiting_external_delivery`; it never claims external delivery.
- Added migration idempotency and CRM duplicate-version/event assertions.

Fix-round commands:

- `node tests/hot-chat-profile-migration.test.cjs`
- `node tests/hot-chat-profile-api.test.cjs`
- `node tests/hot-chat-profile-core.test.cjs`
- `node tests/ws-workbench-api.test.cjs`
- `node tests/customer-governance-api.test.cjs`
- `node tests/ws-workbench-migration-v6.test.cjs`
- `node tests/backup-restore-drill.cjs resources/app` (the existing isolated-server drill is timing-sensitive with ignored child stdio; a debug-pipe run passed end-to-end, while intermittent startup timeout is unrelated to assertions).
