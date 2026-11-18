# 知客 ZHIKER 6.1 A+B · S4 隔离准备审计

2026-11-18。代码审计基线为 `8cb12f4`，本次五项轻量检查从 `5db1d31` 运行。范围为既有实现、合成用例与后续最小验收设计。本次只提交审计文档。正式阶段 6 尚未启动，Production **FROZEN**。数据库迁移、真实 WS 会话与成员采集、生产 Worker、双消费者及付费 AI 不在本轮执行范围。[S3 执行记录](s3-stability-execution.md) · [历史全量原始输出](evidence/v41-s3-integration/integration-full-regression.log)

## WS 多账号

- `GET /api/ws/accounts` 校验并修复默认账号行，`POST` 保存独立账号及设置，`PATCH` 维护当前状态、上次状态和最近见到时间；sidecar 启动时将旧运行态清回「未连接」。工作台 `accountStatusLabel` 在上次曾连接且有观测时间时可显示「待检测」。登录观察和采集能力在状态模型中分别披露。手动选择经 `open` 桥接进入前台账号，现有周期探测限于已存在的前台实例。 [账号路由](../../resources/app/server.mjs#L2621) · [运行态重置](../../resources/app/server.mjs#L132) · [账号显示状态](../../resources/app/modules/ws-workbench.js#L355) · [桌面桥接](../../desktop/src/Zhike.Desktop/Views/LegacyUiHostPage.xaml.cs#L1126) · [前台探测](../../desktop/src/Zhike.Desktop/Services/WsRuntimeService.cs#L117) · [RD02 能力边界](decisions/RD02-authenticated-profile-boundary.md)
- `switchAccount` 递增 `accountLoadSequence`，清空旧账号页面投影，逐个核对打开、会话、群目录和成员加载的请求所有权。当期切换失败会回到前一账号，显示该次错误并重载前一账号。群目录按账号查 `ws_group_catalog`，请求迟到时不写入当前页面。 [切换与回滚](../../resources/app/modules/ws-workbench.js#L636) · [群目录加载](../../resources/app/modules/ws-workbench.js#L1556) · [目录端点](../../resources/app/server.mjs#L2678)
- 历史完整回归覆盖临时 SQLite 中两个合成账号相同外部会话 ID 的隔离、账号删除边界及重启后的状态清理。现有 VM 测试覆盖 A→B→C、逐个异步边界、过期成功与失败、最新失败回滚，以及热聊档案和群监测状态清除。原生跨账号时，账号栏选中态、宿主前台身份和群详情同时一致的失败回滚证据仍缺。 [多账号 API 测试](../../tests/ws-multi-account.test.cjs#L32) · [切换竞争测试](../../tests/ws-group-monitor-account-race.test.cjs#L90)

## 群组成员与 CRM

- 数据职责由 017 群目录、015 进退事件、022 持久 CRM 关系、023 隔离成员样本分别承担。目录的 `participant_count` 可缺失，只表示该账号的单群元数据。WS05 从隔离 `GET /api/ws/group-manager/members` 查询，禁用时沿用旧历史显示。已存事件读取和人工关联在现有端点，正常写入与人工确认均持久化 022 关系和 CRM 投影。历史事件读取有行数上限，完整可追溯台账和可信成员基线仍缺。 [017 群目录](../../resources/app/migrations/017-ws-group-catalog.sql#L6) · [015 事件](../../resources/app/migrations/015-ws-group-monitor.sql#L37) · [022 关系台账](../../resources/app/migrations/022-ws-group-identity.sql#L4) · [023 成员](../../resources/app/migrations/023-ws-group-manager.sql#L6) · [WS05 成员加载](../../resources/app/modules/ws-workbench.js#L3221) · [持久化](../../resources/app/server.mjs#L1388) · [人工确认事务](../../resources/app/server.mjs#L2865)
- 以 `customers.id` 为 CRM 主键，并由 021 的部分唯一索引约束在册规范号码。成员规范化处理电话与电话 JID、旧印度区号兼容、LID 和现有规则识别的 opaque ID。opaque 原串保留大小写，只有账号与群均匹配的显式映射才关联 CRM。同名、歧义及删除客户不会通过这条关联路径变成确认身份；多个匹配保持待决。应分别以现有成员规范化器与 CRM 号码规范化器为准，审计发现两者对输入范围有不同约束。 [021 CRM 权威](../../resources/app/migrations/021-crm-authority.sql#L4) · [成员识别与映射](../../resources/app/modules/ws-group-monitor-core.js#L11) · [CRM 号码规范化](../../resources/app/modules/ws-crm-sync-core.js#L7) · [CRM 原有去重整改证据](../superpowers/reports/2026-11-15-stage1-crm-dedup-implementation.md)
- 历史自动化已有隔离成员查询的两个账号、群和上限、禁用回退、迟到响应、读取不创建 CRM，以及 opaque ID、作用域唯一约束和人工关联事务回滚。缺少同一组合用例贯穿「成员详情 → CRM 档案」的隔离原生证据。未匹配、待审及冲突成员的统计覆盖仍需另行核定。 [隔离成员 API/UI](../../scripts/stage51/members-binding.test.cjs#L13) · [opaque、唯一性与原子确认](../../tests/v41-ws-capability-audit.test.cjs#L116) · [现有能力缺口](v41-ws-capability-audit.md)

## WS04 客户级阅读观测

- WS04 的群资料面板在群和账号有效时检查隔离能力。读取、分页和 CSV 均为 GET，服务端按账号、群、消息验证作用域。界面按账号、群及请求序列核验所有权；过期的查询与下载结果不能替换当前显示或触发下载。页面每次 25 条。查询核心复用 019、022、023 持久结构，并用同一投影生成查询和 CSV；CSV 保留号码文本并处理公式前缀。单次调用的一致读取基于 SQLite 保存点，同一界面先后多个请求读取各自当时的数据。 [服务端隔离门禁和路由](../../resources/app/server.mjs#L2880) · [WS04 接线](../../resources/app/modules/ws-workbench.js#L3094) · [界面、作用域与分页](../../resources/app/modules/ws-group-reading-ui.js#L9) · [只读查询与导出](../../resources/app/modules/ws-customer-reading-query.cjs#L257)
- 隔离端点只提供授权回调，现有读标记、送达、无证据或无可信关联均显示 Unknown。查询核心只有在服务端独立验证具体证据、身份和核实时点后才可给出 Read。已确认未读及完整历史分母为空。023 是当前证据状态，022 为当前关系；真实历史分母还需要可信历史成员集合和排除版本。本地查询核心已支持按消息输入 `excludedMemberIds` 的去重预览，现有 WS04 路由无持久排除管理。 [作用域及排除输入](../../resources/app/modules/ws-customer-reading-query.cjs#L44) · [回执核验与覆盖语义](../../resources/app/modules/ws-customer-reading-query.cjs#L137) · [数据契约审计](v41-customer-group-reading-query.md)
- 历史 loopback 测试覆盖隔离门禁、Unknown、分界、CSV、跨账号和消息参数；实际页面模块的 DOM fixture 覆盖翻页、下载与换号后迟到导出。已归档的一次 WinUI 观察用 26 条合成 Unknown 记录实测第一页 25 条、第二页 1 条，最后一页正确禁用下一页。尚缺 Windows 原生下载产物和请求在途换号的证据。 [核心测试](../../tests/ws-customer-reading-query.test.cjs#L134) · [隔离 API 与 UI 测试](../../tests/ws-group-reading-isolated.test.cjs#L98) · [原生观测](v41-local-integration-completion.md#本轮原生观察)

## RD09 与 V4.1 品牌

- **RD09** 的 `writeDevicePackageV2` 校验隔离源库并使用侧车工作区锁获取快照。恢复只接受已核验的空白隔离目标，从现有 025 结构恢复 42 张审核表的可移植列和通过验证的素材，认证暂存、候选代次验收、指针发布、回滚和显式恢复均已有实现。返回 `gate=frozen` 和 `coverage=partial`。现有 v1 与 JSON 的兼容范围保留。历史全量 v2 **15/15**，空白隔离恢复 **12/12**，包括源替换、SQLite 唯一键故障、进程退出点、锁和发布回滚。真实断电、磁盘满、干净第二设备验证仍无证据。正式启动接线与完整设备迁移超出本轮授权。 [RD09 已批准范围](decisions/RD09-device-package-v2.md) · [v2 包实现](../../resources/app/device-migration-package-v2.cjs#L275) · [恢复实现](../../resources/app/device-migration-restore.cjs#L554) · [发布故障及回归证据](v41-rd09-isolated-restore.md)
- **品牌与共享 UI** 已有网页侧栏 Logo、内嵌图标库、浅色 `atelier-dawn` / 深色 `horizon-night` 语义 token，以及原生窗口标题和 `Assets/zhike.ico`。共享 shell 管理 CRM/WS 入口与主题预览、取消、应用。现有网页品牌标题是「知客 6.0」，正常 WinUI 窗口标题是「知客 6.0.3 Horizon Atelier」，隔离构建另有验收标题。统一对外版本标签前应以已批准命名为准。已有主题、对比度、共享组件、图标资源接线与偏好回滚的自动化证据。还需核对同一受控构建的窗口标题、任务栏图标及两主题缩窄时的侧栏 Logo、图标线宽与标签可读性。 [网页品牌和图标](../../resources/app/index.html#L33) · [共享 shell](../../resources/app/modules/workspace-shell.js#L18) · [双主题 token](../../resources/app/modules/design-system.css#L4) · [原生标题与窗口图标](../../desktop/src/Zhike.Desktop/MainWindow.xaml.cs#L72) · [可执行文件图标](../../desktop/src/Zhike.Desktop/Zhike.Desktop.csproj#L12) · [已测视觉范围](v41-visual-coverage.md)

## 本次检查与 READY 项

随附 Node v24.22.1 本次单独执行下列源契约或 VM 检查，全部退出 0。这些命令通过其现有入口运行，使用合成对象与本地源码。数据库、WinUI 和浏览器结果引用各自已归档的回归或原生观测。

| 本次通过的现有检查 | 实测范围 |
| --- | --- |
| `node tests/ws-group-monitor-account-race.test.cjs` | 群监测迟到响应、错误回滚竞争、三账号请求所有权 |
| `node tests/ws-multi-account-detection.test.cjs` | 手动探测、账号栏、登录与采集状态分离、后台轮换边界的源码契约 |
| `node tests/customer-group-membership.test.cjs` | 客户群关系状态投影源码契约 |
| `node tests/design-system-contract.test.cjs` | token、文字、断点、动效和资源接线 |
| `node tests/delivery-s1-workspace-shell-runtime.test.cjs` | 工作区导航、外观、弹窗与兼容偏好回滚 |

| READY | 最小验证与通过条件 |
| --- | --- |
| S4-01 合成账号状态 | 用相同群 JID、不同名称的隔离 A/B 切换序列补原生证据。模拟 B 打开失败并确认回到 A，释放一条过期响应后核对账号栏、错误、详情和宿主当前账号仍一致。只读既有合成范围。 |
| S4-02 成员与 CRM 关联 | 在现有隔离 025 夹具加入号码、电话 JID、LID、opaque、重复候选及跨账号映射组合。核对独立成员关系、同一在册 CRM ID 去重、冲突保持待决和纯读取不创建客户。补一条成员详情到 CRM 的结果证据。 |
| S4-03 WS04 导出和排除规则 | 在已验证的 26 条合成 Unknown 集上检查原生下载名称、行数、转义及在途换号；按同一消息验证重复排除计一次、跨账号排除无效。先以只读输入预览设计规则的作用域、覆盖和版本语义，当前模型保留未核实状态。 |
| S4-04 RD09 合并后回归 | 执行已注册的 v2 与空白隔离恢复套件，记录退出码、发布回滚和 frozen/partial。范围沿用 RD09 决定，不修改启动或迁移。 |
| S4-05 品牌资源 | 同一隔离构建下对照现有网页 Logo、共享图标、窗口与任务栏资源。记录两主题和缩窄视口的可读性及与已批准品牌规范的差异，优先在共享样式和资源层处理经确认的问题。 |

后续 READY 项均以本地合成数据和既有契约为前提。跨请求可重放历史报表、真实成员来源与回执验证、持久排除规则和正式启动接线需要各自的产品及数据契约评审。
