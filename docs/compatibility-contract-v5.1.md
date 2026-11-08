# 知客桌面 v5.1 兼容桥契约（冻结草案）

所有页面请求都必须带 `requestId`、`bridgeVersion` 和 `timeoutMs`；涉及 WS 时还必须带 `accountId`。响应固定包含 `ok`、`errorCode`、`message`，成功时才包含 `data`。写入必须使用明确的 idempotency key（幂等键）。错误不得把 password、cookie、二维码、token 或完整聊天原文写入日志。

| 旧调用 | v2 适配方向 | 幂等/分页 | 失败语义 |
| --- | --- | --- | --- |
| `/api/state` | `/api/v2/legacy/state` | `X-State-Version` optimistic revision；编辑时 `X-Zhike-State-Format: delta-v1` 的 `upsert/remove/fields` 在服务端合并，不覆盖未触及集合 | `CONFLICT` 保留页面草稿 |
| `/api/state/version` | `/api/v2/legacy/state` | revision | 返回当前版本 |
| `/api/snapshot` | `/api/v2/legacy/snapshot` | owner + retention | 保留页面草稿 |
| `/api/snapshots` | `/api/v2/legacy/snapshots` | owner + retention | 返回空列表而不是假数据 |
| `/api/ws/accounts` | `/api/v2/ws/accounts` | accountId | 仅影响当前账号 |
| `/api/ws/accounts/{id}/status` | `/api/v2/ws/accounts/{id}/status` | accountId | 仅影响当前账号 |
| `/api/ws/followups` | `/api/v2/ws/followups` | accountId + customerId | 只读提醒列表 |
| `/api/ws/ingest/batch` | `/api/v2/ws/ingest/batch` | accountId + messageId | 服务端去重后才算成功 |
| `/api/ws/checkpoints` | `/api/v2/ws/checkpoints` | accountId + conversationKey | 断点按时间/游标单调更新 |
| `/api/ws/heartbeat` | `/api/v2/ws/heartbeat` | accountId | 只更新连接状态 |
| `/api/ws/conversations`, `/api/ws/messages`, `/api/ws/analyses`, `/api/ws/replies` | 暂无 Postgres v2 等价接口 | — | 明确返回 `UNSUPPORTED`，不得伪造本地成功 |
| `/api/ws/collection-*`, `/api/ws/followup-alerts`, `/api/ws/crm-sync` | 暂无 Postgres v2 等价接口 | — | 明确返回 `UNSUPPORTED`，保留页面草稿 |
| `/api/ws/export`, `/api/ws/import`, `/api/data-governance/*`, `/api/import/legacy/*` | 暂无 Postgres v2 等价接口 | — | 使用数据中心/服务器迁移入口 |
| 客户保存 | `/api/v2/customers/upsert` | phone/ws identity | 不返回成功直到服务端确认 |
| 跟进任务 | `/api/v2/followups/upsert` | customerId + dueAt | 冲突返回 `CONFLICT` |

未列出的调用必须返回 `unsupported` 和 `errorCode`，禁止静默模拟成功。具体字段、错误码、分页和超时在 Task 2 实现时与现有 server-v2 接口逐项核对并补充。

WinUI 页面仍复用原版 `__LOCAL_DB__` 数据同步生命周期，但权威状态存储为配对工作区的 PostgreSQL；“本机”文案只表示当前桌面工作区，不表示另建 SQLite 权威库。离线写入失败时保留页面草稿并显示重试，不报成功。
