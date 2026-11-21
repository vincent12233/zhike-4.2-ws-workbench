# 2026-11-21 · RC6：群组核验 0 行问题的处理

## 现象

用户安装 RC5 后专用 WS 已正常打开（白屏已解决），但“群组核验”显示：

- 前台列表行 17，带可靠标识的列表行 0，未核实列表行 17。
- 后台群组筛选没有可确认的筛选控件；本轮后台跳过，会话类型无法确认至少 15 行。

## 处理

在 `conversationIdentityFromRow` 中增加包装容器回退：行本身找不到 `data-jid` / `data-group-id` / `data-chat-id` / `data-contact-id` / `data-id` 时，向上最多三层祖先节点继续查找。仍然只接受规范 WhatsApp 标识（`@g.us`、`@s.whatsapp.net`、`@c.us`、`@lid`），找不到就保持“未核实”，不虚构标识。

新增 `tests/ws-row-identity.test.cjs`（5 项）并纳入全量套件。

## 产物

| 项 | 值 |
| --- | --- |
| 安装包 | `work\releases\zhike-6.1.0-rc6-win-x64-setup.exe` |
| 大小 | 114,417,395 字节（109.12 MiB） |
| SHA-256 | `27138BB884408BD9CFBA8E75E874742EA258FFAE84AD9F89BC9E36A25AD550E3` |
| 对应 commit | `67e7fec` |
| Bundle SHA-256 | `8028B355A43B282EA7446B89BC03585671712669DB432AEC7D3F99D00E0BD26B` |

ws 套件 252/252，x64 Release 0 错误，ReleaseGate passed。

## 未确认

包装容器回退能否让这份 WhatsApp Web 构建报出 JID，必须在真实账号里复测才能确认，目前不宣称已修复。若 RC6 仍是 0 行，下一步需要一行列表结构的脱敏样本（标签名、`data-*` 属性名、`role`、`data-testid`，不含任何聊天文字），我据此补选择器，而不是猜。
