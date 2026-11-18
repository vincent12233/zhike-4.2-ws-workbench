# 阶段 3 独立 WS 群组管理报告

## 数据边界

群组身份使用 `account_id + group_jid`，成员关系使用 `account_id + group_jid + member_jid`，消息使用 `account_id + group_jid + message_id`，已读证据使用 `account_id + group_jid + message_id + member_jid`。

独立群组管理不创建第二套 CRM 主档。确认加入事件通过现有客户状态源按标准化手机号全局查重；只有没有匹配客户时才在显式开关开启的隔离流程中准备新客户。多匹配、审核中和不完整身份均进入待处理状态。

## 事件规则

- `pending` 审核事件不计入确认进群，也不创建客户。
- `joined`、`left`、`removed` 保留原始事件和幂等键。
- 过期事件不会覆盖较新关系，转入 review。
- 手工锁定关系不被自动状态覆盖。
- 消息重复提交返回 `duplicate`，不会重复写入。
- 已读证据只能从 `unknown -> delivered -> read` 推进；重复证据返回 `duplicate`，回退返回 `ignored`。
- 同步任务 checkpoint 和 item count 单调推进，关闭任务不能回退。

## API

隔离前缀：`/api/ws/group-manager/`

- `GET/POST groups`
- `GET/POST members`
- `GET/POST sync` 与 `POST sync/:runId`
- `GET/POST messages`
- `GET/POST read-evidence`
- `GET/POST errors`
- `GET audit`
- `GET state` 聚合状态

生产环境未启用这些写入口；未设置隔离 Mock 标记时返回 `GROUP_MANAGER_DISABLED` / HTTP 404。

## 验证

测试：`node scripts/stage3/ws-group-manager.test.cjs`、`node scripts/stage3/ws-group-manager-api.test.cjs`

结果：`Passed`。API 测试覆盖账号隔离、审核跳过、确认加入建档、消息幂等、已读证据、同步幂等、聚合状态和审计。

## 风险与后续

真实 WhatsApp 群组目录、成员同步和群消息读取仍为 `NotTested`；本阶段只验证隔离 Mock Transport 与真实本机 sidecar API 路径，不得把 Mock 结果解释为平台联调通过。

