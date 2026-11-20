# 知客 6.1 A+B 工作台阶段交付记录

2026-11-20 · Windows x64 · `feature/zhike61-ws-completion`。本记录更新同目录 P0 首次审计中的 GitHub 推送、通讯录排除和安装器状态。表中提交均已推送。

| 阶段 | 当前结果与证据 | 仍需验证 |
| --- | --- | --- |
| P0 账号用途 | IMPLEMENTED_VERIFIED。普通与专用账号分开登记、登录和选择工作台。群授权绑定账号及规范群 JID。数据库仍能读取历史用途标记，CRM VIP 客户分类保留。见 `9c9ea0b`、`7300dcd`、`7ee0c62`。 | 两类账号真实扫码。 |
| P1 普通 WS | IMPLEMENTED_UNVERIFIED · INTEGRATION_TESTED。前台与后台采集分别使用隔离的 WebView2 和独立扫码。采集回调验证账号、会话代数和来源。回复草稿按账号和会话保存，切号、采用建议、长文本和剪贴板回执均有回归。见 `7ee0c62`、`97d748c`、`2c0992f`。 | 已登录前台持续聊天、真实断线重连、后台续采与正常退出的现场验收。 |
| P2 AI、CRM 与提醒 | PARTIALLY_IMPLEMENTED。普通账号可明确授权一个完整原生私聊，默认关闭。任务复用现有队列，原生端预留费用，派发前重查授权、账号与聊天，完成后走分析、CRM 与提醒路径。授权可暂停、恢复、撤销，工作区恢复后需要重新授权。见 `3150427`、`85b72cd`。 | 付费 Provider 与真实客户会话的端到端验证。当前自动适配器限单段、最多 1,000 条和 16,000 字符，群客户的在线付费链路未验收。 |
| P3 专用 WS | IMPLEMENTED_UNVERIFIED · INTEGRATION_TESTED。启用监控的普通群按确切账号和 JID 入库。可信身份及别名先经过通讯录排除，再执行建档或更新关系。缺少成员证据、身份冲突和采集失败均保留未知结果。排除规则的历史命中可追踪。手工消息和业务备份中的消息需要原生重新观测才能获得采集凭据。见 `98fdb06`、`d354328`、`f834789`、`5c608d2`。 | 真机可见的进退群事件、成员名单覆盖度和采集延迟。 |
| P4 群运营 | PARTIALLY_IMPLEMENTED。本地群草稿支持按账号搜索、多选、预览目标、取消、历史和跨账号备份恢复。权限页支持选择群及查看已知状态。指定消息页可检索本地已读证据。见 `ca2a0c6`、`6e0bf04`、`87dfa35`、`de7bf36`。 | BLOCKED。实际逐群发送、原生 @、指定消息实时逐人回执和修改群权限尚缺获授权的测试账号、目标群及平台证据。隐藏式 @ 显示当前适配器的 `B_MODE_BLOCKED_UNSUPPORTED`，管理员权限和逐人状态可为 UNKNOWN。 |
| P5 Windows | PARTIALLY_IMPLEMENTED · WINDOWS_TESTED。GitHub 托管 Windows 运行了实际安装、同包覆盖、卸载和包内 WebView 渲染。另在本机启动过隔离 WinUI 主窗口。安装器与源码提交、哈希和签名状态逐包记录。 | 实际客户电脑、移动设备和已登录账号的验收待执行。 |

## 已取回的 Windows 安装器

中间候选 `6.1.0 / CI 44731381744` 对应 `87dfa35f2c974dc62dc03a6c6248fda546864dab`。安装器生成于 2026-11-20 11:57:47 UTC，114,325,075 字节，SHA-256 为 `3090e3272488414153c9f4b995c10fdde6154cface97af349eb7026c239e1875`，Authenticode 为 `NotSigned`。下载安装器后已复核文件及清单。后续功能由各自提交的 CI 重新构建。[Windows 运行记录](https://github.com/vincent12233/zhike-4.2-ws-workbench/actions/runs/44731381744)

该运行逐文件校验安装目录、验证程序清理和外部合成标记保留。9 个打包页面在两种视口下用真实 WebView2 渲染，页面使用合成数据。另一次本机隔离桌面观测记录了主窗口及 sidecar 就绪，180 次采样覆盖约 416 秒，记录到 6 个 WebView2 子进程。该窗口的正常退出和已登录 WhatsApp 未取证。

## 专用账号登记规模

Windows 10.0.26300 x64、Node 24.22.1，服务源码与 `3150427` 一致。每个专用账号包含 3 个停用的合成群目录项，每级另有 1 个默认普通账号。每次从已登记的 SQLite 库启动实际服务。目录请求预热后串行测量 7 次。

| 专用登记数 | 服务启动 ms | 账号目录 HTTP 中位数 ms | HTTP P95 ms | 服务进程工作集 MiB |
| ---: | ---: | ---: | ---: | ---: |
| 1 | 155.262 | 0.809 | 0.887 | 64.7 |
| 5 | 166.698 | 1.012 | 1.492 | 66.6 |
| 10 | 167.163 | 1.618 | 2.043 | 66.4 |
| 20 | 155.995 | 1.406 | 1.620 | 67.9 |
| 30 | 165.260 | 1.860 | 2.127 | 68.6 |
| 50 | 151.741 | 2.047 | 2.159 | 66.7 |

新库首次启动 282.520 ms。7 个隔离服务均正常退出，临时库已清理。各级采样中服务拥有的 WebView2 数均为 0，消息、群事件、采集和 AI 队列计数均为 0。账号切换、已登录会话的 CPU、真实采集吞吐和网络在线数需另行实测。[复现说明](../release/ws-account-scale-diagnostic.md)

## 测试与源码

- 在 `6e0bf04` 的独立工作树执行 `node scripts/run-tests.cjs all`，355 项检查全部通过。此次数仅对应该提交。
- `de7bf36` 的草稿备份专项 18 项通过，包含两账号恢复、拒绝后回滚、丢失应答以及实际原生备份文件。恢复说明见 [群草稿备份](../release/ws-group-draft-backup-recovery.md)。
- 合并后的原生来源、AI 授权和备份 45 项专项通过。付费请求出口使用注入的 HTTP 替身。后续凭据等待、撤销与过期授权专项 13 项通过。Windows x64 本地增量 Release 编译通过。
- 主要实现位于 `resources/app/server.mjs`、`resources/app/modules/ws-workbench.js`、`ws-contact-exclusion-core.cjs`、`ws-ai-budget.cjs`、`ws-group-drafts.cjs`、`ws-group-reading-ui.js`、`ws-group-permissions-ui.js`，以及 `desktop/src/Zhike.Desktop/Services` 和 `Views/LegacyUiHostPage.xaml.cs`。迁移 027–030 分别保留历史排除证据、账号用途、群草稿和授权预算账本。
