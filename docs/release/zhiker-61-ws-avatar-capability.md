# 知客 6.1 WS 头像能力

**真实 WhatsApp 客户头像获取为 Blocked。** 在基线 `fbeeaf8` 的现有授权路径、数据投影和桌面桥接中，未发现受支持的联系人头像读取接口、可信头像字段或缓存。工作台已接入共享姓名首字母及默认人物头像。联系人、成员和客户详情展示当前头像可用性。

## 仓库审计

| 范围 | 证据 |
| --- | --- |
| WS 账号和会话 | `ws_accounts.id` 是账号作用域。会话持有 `account_id`、`external_id` 和现有 `customer_id`，并对 `(account_id, external_id)` 唯一。会话分类优先使用结构化群证据，区分群聊、一对一和未知类型。[账号及会话表](../../resources/app/migrations/008-ws-accounts.sql) · [会话类型](../../resources/app/modules/ws-workbench-core.js#L10) |
| 联系人与号码 | `GET /api/ws/workspace/contacts` 由当前账号的一对一会话投影出原始号码、规范号码、重复记录和 CRM 关联状态。号码型个人 JID 支持提取号码。LID 保持为不透明标识。目录的 `updatedAt` 是记录时间。[通讯录投影](../../resources/app/modules/ws-workspace-query.cjs#L37) · [路由账号校验](../../resources/app/server.mjs#L2608) |
| CRM 客户 | WS CRM 列表沿用当前账号会话的持久 `customerId`。当前会话档案沿用原只读服务的账号检查、已有会话关联、可信身份匹配和冲突返回。客户主档表以及现有录入、导入和档案展示没有已定义的客户头像字段。现存 `settings.profileAvatar` 仅供本地管理员侧栏及顶栏使用。[CRM 表](../../resources/app/migrations/019-crm-base-schema.sql#L16) · [匹配](../../resources/app/modules/ws-crm-sync-core.js) · [归档路由](../../resources/app/server.mjs#L4947) · [管理员头像](../../resources/app/app.js#L326) |
| 群成员 | 持久成员关系使用 `(account_id, group_jid, member_jid)`。独立成员清单走原隔离 Mock 门禁，普通运行使用已有进退群历史。历史事件保留成员标识和号码，界面为这类记录显示默认人物图标。[群成员关系](../../resources/app/migrations/022-ws-group-identity.sql) · [隔离成员表](../../resources/app/migrations/023-ws-group-manager.sql#L6) · [隔离门禁](../../resources/app/server.mjs#L2879) |
| 图片与授权 | 既有 WS 媒体是消息和发送附件的媒体索引。前台可见聊天和导入属于 RD02 已核定能力。头像媒体绑定、读取授权、更新时点、失效及撤销均无可用的源接口，本轮没有启用头像读取或缓存。[消息媒体表](../../resources/app/migrations/018-ws-export-media.sql) · [原生桥接](../../desktop/src/Zhike.Desktop/Views/LegacyUiHostPage.xaml.cs#L1198) · [RD02 能力验收](./rd02-authenticated-profile-acceptance.md) |

## 展示与隔离

- 群成员列表和详情、联系人列表和详情、WS CRM 只读客户主档、前台聊天的统一数据档案，以及已确认的一对一会话列表，都接入 `ZhikeAvatar`。群会话使用独立群聊图标，类型未知的会话使用通用聊天图标。
- 工作台只把姓名、尺寸、已选中状态和已有 CRM VIP 标记传给头像组件。会话列表要求条目属于当前账号且已确认是一对一。当前会话档案头像还核对档案账号、档案中的会话账号与当前会话 ID。
- 工作区列表、详情卡片和主页快捷入口采用共享主题描边。头像与图标继承工作台主题，联系人目录、成员明细和会话列表保留既有分页或窗口化。头像展示没有网络请求、写入、头像缓存或刷新入口。
- 真实图片接入需要已有授权凭证范围内的受支持来源，以及可核验的账号、联系人和 CRM 客户绑定。还需确认每个绑定的访问权限、更新时间，并具备按账号移除缓存与撤销访问的能力。RD02 后台采集为 **Blocked**，Production 为 **FROZEN**。

## 本轮证据

| 验证 | 结果 |
| --- | --- |
| `node --test tests/ws-avatar-presentation.test.cjs` | 5/5 通过。覆盖跨账号目录响应和迟到响应、成员范围、有无姓名、一对一和群聊区分、同名客户及当前档案校验。测试探针确认图片、任意远程 URL 和工作区管理员头像字段不进入共享组件。 |
| WS 相关 Node 回归 | 23/23 通过，含上述 5 项。包含列表 120 行窗口契约、滚动路由、助手抽屉、WS 页面切换、群监控、增量列表、安全和调整尺寸等既有测试。 |
| 共享头像渲染联调 | 使用设计系统工作树的真实 `customer-avatar.js` 与本分支 WS 目录进行离线 Node 渲染。印地语和泰米尔语字形、默认人物图标和拒绝来源不明的图片均通过。 |
| 原生 Windows 实际截图、DPI、浏览器视觉、WebView2 资源释放 | Agent C 分支阶段 **NotTested**；随后主控集成的实际截图、125% DPI、局部页面切换及退出检查见[整体验收报告](zhiker-61-visual-upgrade-report.md)。不要把分支测试或局部原生结果当作完整 S3 放行。 |
| 真实 WhatsApp、真实客户数据和生产数据库 | **NotTested**，本轮证据均使用隔离合成记录与源码。 |
