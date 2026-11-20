# 2026-11-21 · VIP 群逻辑审计（V5.0 §3.1）

结论：**不需要改代码。** “VIP 群”作为业务概念已经从产品中移除，VIP 只是 CRM 客户分类。旧代码中保留的 `vip_group` 只是内部类型标记，不构成业务限制。

## 核查结果

| 检查项 | 结果 | 依据 |
| --- | --- | --- |
| 界面上是否还有“VIP 群 / VIP 群组”文字 | 没有 | `app.js`、`index.html`、`modules/*.js`、`server.mjs` 全文检索无结果 |
| VIP 统计是否受群组影响 | 不受影响 | `ws-scope.js` `countVipCustomers` 只看客户主档 VIP 编号 |
| 群组监测是否读取客户 VIP 字段 | 不读取 | `ws-scope.js` `normalizeWsGroupBindings` 注释与实现；`tests/vip-scope-separation.test.cjs` |
| 旧配置键 `wsVipGroupAllowlist / wsVipGroups / vipGroupBindings` | 只在新键 `wsGroupAllowlist` 缺失时作为迁移回退读取；新键为空即撤销旧授权 | `ws-scope.js` |
| `ws_group_monitor_targets.vip_only` | 只写入、只回显，不参与任何判断 | `server.mjs` 中仅在 payload 与 INSERT 处出现 |
| `conversationType === 'vip_group'` | 含义是“被可信采集端或显式绑定授权的群组”，用于按成员范围分析；与客户 VIP 无关 | `ws-workbench-core.js` `conversationType` |
| 普通 WS `whatsapp.directOnly` | 与 V5.0 一致：群组由专用 WS 负责 | `business-rule-core.js` |

## 为什么不改名

`vip_group` 已经保存在现有用户的 `ws_conversations.data_json` 中。改名需要一次数据迁移，而用户看不到任何变化；V5.0 也要求“不得盲目删除历史代码或绕过安全校验”。因此保留这个内部标记，靠现有测试锁定“VIP 与群组无关”。

## 后续注意

- 新代码不要引入以 VIP 命名的群组概念。群组业务配置统一使用 schema 34 的 `ws_group_channel_configs`。
- 如果以后清理 `vip_group` 这个标记，需要同时迁移 `ws_conversations.data_json`，并保留对旧值的读取兼容。
