# 知客桌面 v5.1 兼容桥契约（冻结草案）

所有页面请求都必须带 `requestId`、`bridgeVersion` 和 `timeoutMs`；涉及 WS 时还必须带 `accountId`。响应固定包含 `ok`、`errorCode`、`message`，成功时才包含 `data`。写入必须使用明确的 idempotency key（幂等键）。错误不得把 password、cookie、二维码、token 或完整聊天原文写入日志。

| 旧调用 | v2 适配方向 | 幂等/分页 | 失败语义 |
| --- | --- | --- | --- |
| `/api/state` | `/api/v2/state` | snapshot cursor | `SERVICE_UNAVAILABLE` 可重试 |
| `/api/snapshot` | `/api/v2/snapshot` | snapshot cursor | 保留页面草稿 |
| `/api/ws/*` | `/api/v2/ws/*` | accountId + messageId | 仅影响当前账号 |
| 客户保存 | `/api/v2/customers/upsert` | phone/ws identity | 不返回成功直到服务端确认 |
| 跟进任务 | `/api/v2/followups/upsert` | customerId + dueAt | 冲突返回 `CONFLICT` |

未列出的调用必须返回 `unsupported` 和 `errorCode`，禁止静默模拟成功。具体字段、错误码、分页和超时在 Task 2 实现时与现有 server-v2 接口逐项核对并补充。
