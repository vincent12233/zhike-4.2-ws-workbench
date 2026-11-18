# 知客 6.1 阶段 1：独立 WS 群组管理边界冻结

审计日期：2026-11-15  
基线：`68749e4`；本文件仅定义边界和数据流，不启用群组 Worker。

## 1. 模块定位

独立 WS 群组管理是 WS 工作台内的独立工作区/侧边栏能力，负责选定账号的群组目录、监测目标、进退群事件、成员关系、看群统计和确定性新成员登记。它不替换知客主侧边栏，不等同于 VIP 管理，也不改变普通 WS 聊天的未读跳过和前台交互规则。

现有基础：

- `015-ws-group-monitor.sql`：`ws_group_monitor_profiles`、`ws_group_monitor_targets`、`ws_group_membership_events`、`ws_group_monitor_checkpoints`。
- `017-ws-group-catalog.sql`：`ws_group_catalog`，按 `(account_id,group_jid)` 唯一；target 仍按 `(profile_id,group_jid)` 唯一。
- `server.mjs:1019-1453,2360-2514`：群目录、事件接收、身份解析、projection、checkpoint 和人工 resolve 路径。
- `ws-group-monitor-core.js`：电话/成员身份标准化、既有客户匹配和关系投影。

## 2. 与普通 WS 的边界

| 能力 | 普通 WS 聊天 | 独立群组管理 |
|---|---|---|
| 前台聊天 | 用户可正常聊天；采集不得改变焦点、滚动、已读状态 | 不操作前台聊天 DOM；读取受授权的群组事件/目录来源 |
| 会话历史 AI | 完整一对一历史后进入 AI 队列 | 群事件/成员事实可进入同一客户档案和分析规则，但必须带 group source/target 证据 |
| 新建客户 | **禁止**普通聊天 AI 自动创建 | 仅确定性“新成员 joined”登记服务可创建；先全局查重，再在同一事务创建/关联 |
| 客户主档 | 只能关联已有 `customers.id`，AI 只补空字段并遵守锁定/冲突规则 | 仍使用同一客户主档；不得新建第二套群组客户表 |
| 群聊消息 | 按既定规则排除或单独处理，不产生普通客户提醒 | VIP/选定监测群按明确授权采集；是否分析由 target policy 决定，不能隐式继承 |
| 提醒/任务 | 由一对一 AI 结果生成 | 群组进退事件本身先写事实和关系；只有批准的客户级证据才可进入任务投影 |
| VIP | VIP 管理是客户业务模块，和群组目标不是同一概念 | `vip_only` 只是监测目标筛选字段，不能把 VIP 客户/管理记录当作 VIP 群组 |

## 3. 事件资格与登记规则

### 3.1 可登记事件

仅满足以下条件的 `joined` 事件可进入自动登记：

1. 账号、目标、group JID、member identity 和 observed time 完整。
2. 事件来自已启用的目标，且不是审核中/邀请中/预备状态；审核状态不计入进群统计和登记。
3. 事件通过稳定 `source_event_id` 或密码学哈希幂等键去重。
4. member phone/JID 经过标准化且可验证；只有昵称或模糊名字不得自动建档。
5. 全局查询现有 `customers` 和已批准的 WS 身份映射；命中一个客户则只建立群组关系，不创建客户。
6. 未命中时，在同一事务中创建客户并写入关系、事件和审计；任何唯一冲突转 `review`，不能静默重试建第二条客户。

`left`/`removed` 只更新群组关系/事件，不能把客户主档全局 `status` 覆盖为离群；客户状态由客户域规则计算。

### 3.2 统计口径

- 进群：`status=applied` 且 `event_type=joined` 且非审核/邀请。
- 退群：`status=applied` 且 `event_type in (left,removed)`。
- `pending/review/ignored` 不计入已确认进退群，但必须在“待核验”中可见。
- `event_at` 缺失时保持空值；`observed_at` 只表示本机观察时间，不能伪造发生时间。
- 统计按 `account_id + group_jid + channel_id/source_id` 分组；缺少来源时标为“未分类，待绑定”，不得合并为泛化“群粉”。

## 4. 身份、去重和关系

- 主档唯一 ID：现有 `customers.id`，不得新增 CRM master。
- 电话规范化：复用 `ws-group-monitor-core.js`/`wsCrmSync.normalizePhone`；空、无效、未验证号码不参与自动合并。
- 群身份：第一阶段暂以 `account_id + group_jid` 作为运行域稳定键；target/profile 多行必须在冻结前形成 catalog 映射，不能因不同 profile 重复登记。
- 成员身份：保存原始 JID、标准化 JID、电话、来源账号和证据哈希；跨账号同号只候选关联，不自动覆盖人工锁定身份。
- 关系数据：群成员关系、进退事件、来源和时间是关系事实；客户阶段、VIP、跟票、报名、入金等主档字段不能由群事件直接覆写。

## 5. checkpoint 与失败恢复

checkpoint 只在事件事实已幂等落库、客户关联/登记事务完成、统计状态可重建后推进。`pending/review` 事件必须有明确的 durable pending 边界；不能先推进游标再丢失待审核事件。

恢复规则：

- 网络/页面暂不可用：保留 cursor，任务 `retryable`，指数退避。
- 身份冲突：事件 `review`，cursor 可推进到“已持久化的待审核事件”，重放必须按 idempotency key 返回既有事件。
- 数据库冲突/过期 fence：拒绝写入，回到待重试，不继续读取下一页。
- 连续失败达到阈值：profile `degraded/error`，告警而非无限重启。

## 6. 模块接口边界

群组模块只向共享层请求：`customer lookup/link/create`、`relation write`、`audit append`、`stats read`。共享层返回 customer ID 和冲突状态，不暴露 app_state 全量写接口。普通 WS 的 AI/跟进队列只能消费已确认的客户级 projection，不能直接读取未审事件。

UI 只显示状态、统计、待审核和关系结果；不以假按钮承诺平台未提供的历史能力。采集源受平台和授权限制时，必须显示 `source-limited`/`needs-reconnect`。

## 7. 阶段 1 冻结检查

- 已确认 VIP 管理与 VIP 群组不是同一概念。
- 已确认普通 WS AI 不自动建客户，群组确定性登记才可创建。
- 已确认审核状态不计入进退群统计。
- 已确认渠道/群粉类型必须使用系统设置中的稳定定义，缺失时不擅自归类。
- 未完成 catalog/target 去重、时间语义、checkpoint 提交顺序和真实来源授权前，不得启用生产群监控 Worker。
