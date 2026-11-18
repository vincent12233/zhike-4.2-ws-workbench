# 业务契约与数据边界基线

基线：`e0426932b9efa77f85e5b7d8ad5d6953024bfc94`；分支 `upgrade/zhike-61-ab-delivery`；日期2026-11-17（Asia/Calcutta）。这是当前源码盘点，不把设计图或历史通过当新增功能证据。生产入口FROZEN。

## 数据源、写入服务与业务权威

### 主工作区状态与后端

- `app.js:112` statePayload 明确包含 customers、tickets、deposits、followups、registrations、phoneRegistry、batchOperations、settings、activities、savedViews、channelAliases、importIssues、qualityDecisions。
- `:1837` initializeBackend、`:124–159` syncFromBackend/data-sync、`:1838` refreshSharedState 使用 `GET /api/state`（版本读另有 /api/state/version）。
- `:117–121` stateWriteBody/enqueueStateWrite/flushStateWrites/persist：带 X-State-Version，优先客户 delta-v1，180ms 合并写；409 后三方按 ID/字段合并，真实冲突保留本地恢复副本并阻止继续盲写。
- 服务 `server.mjs:5322–5337` GET/PUT/POST /api/state，缺版本 428，旧版本 409；`:697–729` writeState 在同一事务内写 app_state 与 customers 关系主档/号码索引。不是允许 UI 再建一套 CRM。
- `server.mjs:608–613` readState/Envelope，`:733+` 号码索引修复；主客户 phone_normalized 来自既有 ws-crm-sync 规范化，唯一性错误转明确冲突。
- `app.js:181` snapshotBeforeWrite 先 flush，再 POST /api/snapshot；快照失败即取消批量/破坏性写入。
- 模块经 `window.__zhikeRegistryHost`（app.js:1848）复用 state、persist、flush、snapshot、activity、refreshState、showCustomer，不得用假 Promise 成功代替。
- `operations-ui.js:23–28` 手工任务保存到 settings.operatingTasks；AI 任务完成/延期/忽略通过 host.followupAction → `POST /api/ws/followup-action`，显式账号/客户/会话/提醒标识与版本（app.js:1839–1846；operations-ui.js:49–104）。不能统一为简单 done=true。

### 必须保留的业务语义

依据 app.js:56–94、:267–289、:328–370 及 business-rule-core.js:20–34：

1. 客户是唯一主档；手工客户 ID/标准号码查重，禁止普通 AI 自动创建未知客户或覆盖人工字段。
2. 当前 UI 的人工/快速导入号码规则是印度业务规则：去格式、处理 91 前缀后标准 10 位。不能在 UI 重构时暗改为任意国家号码或把 @lid 当号码。
3. 一位客户可有多张票、多个入金、多个报名；业务记录按完整业务字段/日期区分，不按号码把多条业务互相覆盖。
4. VIP 由同一客户主档的唯一 vipNumber 等属性表示，不是 WhatsApp VIP 群名单；设置 VIP 不应复制客户或绑定群。
5. 渠道/页面/助理/阶段使用系统设置 option lists 及来源定义/别名。单导、群粉、FB 等具体渠道和进群状态不能互相当成同一字段。
6. 群组管理是 CRM 群关系/逻辑群汇总并结合已确认进退事件；不是实际 WhatsApp 平台管理命令界面。
7. 今日进退群是事件口径，当前在群/退群是存量口径，初始状态基线和待审核不能冒充今日实际加入。
8. 客户跟票/入金标记与金额优先从有效关联的独立记录计算；号码回退只在唯一可归属时使用（app.js:270–273）。
9. 规则优先级、SLA/本地分析和真实 WS AI 提醒要区分；投资经验不纳入 AI 跟进权重。首页真实 AI 流域读取既有提醒及证据，不能本地排序伪装模型结论。
10. 手机号登记是独立业务数组，不自动建客户，不改跟票/报名/入金；字段“所属角色”也不是软件权限角色。

## 筛选、选择、导出、导入、回收站与权限的具体契约

### 筛选与选择

- 客户/分类共用 app.js:527–568 filteredCustomers；客户按 extraFilters、分类按 segment；不是对DOM当前页做全部数据筛选。
- 列配置 `:103,613–623`；客户分页通常10/20/50/100，选择集合跨页，工具栏显示已选数量；批处理预览后再确认，不能静默仅处理当前页。
- 系统保存视图有作用域(customer/segment)、filters、search、相对日期@today；内置不可当自定义删掉（:21–33,:104–108,:1479–1500）。
- 票/入金 `:815–835` 先按有效客户关联、时间/助理/渠道及票产品/方向过滤；业务批改使用记录ID+预览前快照校验，不按姓名/号码大范围覆盖。
- 报名 :1075–1087 支持来源、负责人、搜索、分页；操作日志 :1733 是当前已渲染30条DOM过滤，不是历史全量搜索。
- 群组逻辑分页和具体渠道，手机号登记独立device/channel/role/search及分页；保持筛选作用域，不把手机号“角色”当CRM权限。

### 导出与文件安全

- app.js:1128 download 创建Blob并回收URL；:1129 csvCell 对引号转义，并对以空白+[=+-@]开头内容加单引号，阻止CSV公式执行；CSV统一BOM。
- 客户/分类 `:1130,:1142` 导出全部匹配结果（不是只当前分页）；已选导出 `:1631` 明确按选择集合。
- 跟票/入金 `:1138` 重算相同筛选、补关联显示字段并输出独立买卖日期/方向或入金金额/币种。
- 热聊/VIP/群汇总有各自导出，`:1136–1140`；进退群明细 `:1141` 区分初始基线、事件、客户在册/回收状态。
- **已确认范围差异：报名导出 :1731 忽略 registrationSource/Owner/Search，导出全部有效客户的已报名记录；操作记录 :1633 导出全部state.activities而页面搜索只30条。** 这是现有实现，后续需明确“导出全部/导出筛选”两个命令或统一，不能报告当前筛选已覆盖。
- analytics主导出 :1140 是全局汇总；v4转化筛选/CSV是另一增强入口。新设计必须标明作用域，不能一个按钮混用两种口径。
- 业务JSON完整备份 `:1585–1624` 先flush，再枚举真实WS账号、逐账号校验schema/恢复上限，生成SHA256完整性信息；没有WS服务时明确拒绝不完整备份。它不是用户未来要求的加密.zkdevice包，不能宣称跨设备所有媒体/凭据已解决。

### 导入、恢复与事务

- 快速录入 :184–205 / :1449，普通CSV/Excel :1215–1367，ticket导入 :1118，phone-registry独立parser、GPT本机Excel导入均是真实入口，不能统一成一个没有契约的“上传”按钮。
- 先预览字段映射、逐行来源/渠道/日期；失败/未知/同批重复应保留和导出异常；AI映射只是建议，不能阻止本地规则正常导入。
- 备份恢复 :1371–1447：格式/大小/hash/差异预览→快照→当前全部WS导出作为回滚材料→创建/恢复明确账号→主状态版本写入→失败回滚WS及本轮账号。不能直接复制Cookie/Key/Profile。
- snapshots /api/snapshots、/api/snapshot、/api/snapshots/{id}/restore 为现有服务；本机备份下载触发不等于已验证磁盘文件完成，不能虚假显示远端已备份。
- 单条/批量客户软删除与恢复 :1507–1508 复用快照、版本、号码/VIP冲突；不因为UI升级清空旧数据。

### 权限、破坏性操作与审计

- 当前是本地工作区；侧栏“本地管理员”和手机号登记“角色”是资料/展示字段，未发现业务用户登录、按角色授权和租户隔离的完整RBAC。不能画出权限设置假页面后宣称已实现。
- Native可信消息源/本机API token是进程通信安全边界，不等于客户记录级业务权限。主CRM是全局权威，不可误把“当前WS账号”自动变成所有主业务的租户边界。
- app.js:975–1005 清空密码是当前UI的SHA256口令校验+二次confirm+快照+失败恢复；这不是对任意可信API调用的服务器授权证明。禁止在新设计中把“安全密码”描述成完整访问控制。
- 旧回收站清空 :957–974 是整体state写入路径；治理panel `customer-governance-ui.js:70–95` 使用客户ID、原因、X-State-Version和purge-request/purge-confirm令牌，且保留真实治理审计。
- 普通state.activities、batchOperations、治理customer_governance_actions、WS发送/AI审计等来源不同，不能把本地操作记录表包装成所有行为的完整审计日志。
- 客户历史/候选证据包含敏感业务资料；导出、原始日志、截图、备份不得进Git。API Key继续现有当前用户DPAPI唯一存储，不在主状态/新主题配置里复制。

## 生产、隔离与权威边界

- `desktop/src/Zhike.Desktop/App.xaml.cs:27–42`：动态LocalAppData/Zhike6，隔离编译映射Stage51临时DataRoot；生产Supervisor固定 `Enabled:false`，没有生产Worker Start。`WorkerFeatureFlags.cs:10–57` 默认false，群/AI受控路径依赖三个Worker gates。此审计没有读取用户实际flags文件。
- `LocalServiceManager.cs:226–239,260`：desktop给sidecar显式数据目录、动态loopback端口和临时token；仅STAGE51编译设置group/AI隔离Mock环境。不要手工直接跑 `server.mjs` 做“隔离验收”：其 `:26–38` 无显式参数会落resources/app/data并默认4173。
- FROZEN不是“所有旧按钮完全不写”。旧run/翻译/跟进/native采集服务仍存在；禁止以“新Worker关闭”作为可随意操作正式数据的理由。S0只读基线与后续隔离变更必须分开记录。
- `WorkerIpcProtocol.cs:12–64`：版本1、1MiB帧、request/session/trace、HMAC proof；`WorkerSupervisor.cs:140–148,345–394`：真实peer SID、协议/会话/请求检查、显式当前SID ACL、随机token。继续复用，不重写另一套IPC。
- `sidecar-write-coordinator.cjs:112–118,153–173`：事务内验证lease/owner/fencing token/expiry，业务变更、fact、checkpoint一起提交，前后多次校验，失败ROLLBACK。`server.mjs:1987–1989` 的受控AI写走该入口；不能据此声称所有旧API或平台动作都自动受新Worker保护。
- 最新发送语义复用5.5C-1A：`LegacyUiHostPage.xaml.cs:1432–1576`、`WsSendOperationGuard.cs`、`LegacyBridgeScript.cs:142–163`。本地点击只是local_attempted，执行后取消/失联为unknown，明确preflight失败才可重试。SQLite fencing不能证明平台exactly-once；本轮无平台送达验证。
- 普通聊天AI不自动创建未知客户、人工字段保护、独立群管理已确认入群/全局去重建档边界保持；不能借新目录或模拟同步扩大写权限。

## WebView/窗口生命周期复用

- `WsWebViewSessionPool.cs:74–81,83–164,181–188,274+`：容量3，generation、同实例校验、LRU退役时保护前后台席位；新建成功才退役旧视图。不能实现成“每页一个WebView”。
- `WsRuntimeService.cs:62–89`：只有新session才设Source，隔离为about:blank；重复选账号复用。`LegacyUiHostPage.xaml.cs:417+` session工厂分visible和collector；前台保留正常聊天，采集仅collector角色。不要给前台注入历史滚动/采集脚本。
- `ws-workbench.js:3642–3772` patch保留 `#wsBrowserHost` 与assistant body；`:3984–4007`恢复滚动、单个ResizeObserver和有界resize触发；`:1728–1765`几何去重/单飞。Native `:2039–2165` 确认路由/账号、raster snap/几何稳定，不能每tick重设XAML几何。
- `MainWindow.xaml.cs:92–113` 只有进入/退出WS边界最大化/恢复，复用同HWND；保存原placement。`WorkspaceWindowPresentationService.cs` 是原Win32 helper。页切换/账号切换不能再次最大化盖过用户主动还原/最小化。
- `ApplyTrustedWsRouteVisibility`根据有序documentId/sequence和账号决定聊天hit-test/可见。S0证据应记录每账号Core/visible navigation次数，不只看“WebView进程总数”。

## 动态路径、端口与首次启动

- `App.xaml.cs:27–30` 资源取 AppContext.BaseDirectory/resources/app；数据根取 Windows LocalApplicationData/Zhike6。profiles、backup、配置、缓存均由相应服务在此根派生；所查主启动路径不写死开发者用户名或盘符。
- `LocalServiceManager.cs:62,101,258–262` 用 Loopback TcpListener(port=0) 分配端口，遇端口竞争重试完整启动/health；服务显式收到 ZHIKE_DATA_DIR/ZHIKE_PORT，资源 exe 取随包路径 `:218–227`。
- sidecar 独立开发入口仍默认 4173（server `:38`），但 WinUI 正常入口会覆写为动态端口；不可把此默认误报为正式桌面硬绑定。仍应保证正式运行文档不要求用户单独启动固定端口服务。
- HTTP 监听 loopback，校验 Host、Origin 和本次 token；生产 Worker 使用已存在 Named Pipe 安全边界，不能加第二写源/服务。
- 这是静态源路径审查，不是“任何电脑均独立可用”证明。不同用户名/路径/磁盘/DPI/普通权限、离线恢复、WebView2 缺失和无开发工具设备仍需实际正式包验证。
- `LocalServiceManager.EnsureResources:208–211` 仅检查 node.exe/server.mjs，不能提前发现 RD01 的 CJS 缺失，需和正式打包必需清单对齐。

## 迁移、checksum、备份与恢复

### 只读核对结果

- manifest format=1、supportedSchemaVersion=25，列出 004–025 共 22 个 SQL 文件。
- 本轮仅使用 PowerShell SHA-256 对源码 SQL 按与 runner 相同的 CRLF/CR→LF 规则规范化后校验：**22/22 文件与 manifest 相同，0 mismatch**。没有 require 产品 migration module、没有创建/打开 SQLite、没有运行迁移或测试。
- runner `:30–102` 验证不可变 SQL checksum；已应用记录 mismatch 默认拒绝。024 仅接受两个明确尾部换行 checksum，且验证真实 schema fingerprint、备份及兼容审计，不静默覆盖旧记录（`:205–266,286–298`）。
- 迁移前执行完整性/foreign_key 检查与 WAL checkpoint、备份（`:303–323,417–425`）；逐迁移 BEGIN IMMEDIATE、登记 checksum/user_version、验证、COMMIT，失败回滚当前迁移（`:441–455`）；未来 schema 版本拒写（`:416`）。

### 需要正确理解的边界

- 迁移是**逐个版本提交**，不是整批全有全无；后续迁移失败时前面已完成的版本可能已提交。前置备份存在，但 runner 没有自动替换回旧数据库的全流程；部署文档/恢复工具需说明停服务、校验备份与兼容版本，不能一键假回滚。
- 原生 JSON 自动备份包含客户业务状态和逐账号 WS JSON，带 SHA-256 完整性封装、250 MiB 总包/95 MiB状态/48 MiB账号及行数上限。它不是加密包，且数据覆盖/媒体字节往返不完整，见 RD03/RD04。
- 本机 `state_snapshots` 是 CRM app_state 的快照，不包含全部 WS 表或媒体文件。恢复前快照与版本检查现存（server `:5338–5355`），不等同全部 SQLite/媒体事务回滚。
- 不应迁移 WebView 登录态或 DPAPI 密钥；新设备重新扫码并重新配置个人 AI Key。缺少 .zkdevice 的完成证据不能由当前 JSON checksum 补足。
- 所有现有迁移历史与 checksum 保持不变；后续确有必要新增字段/表才用向前迁移，不新建第二客户主档。

### 当前可视化依赖与度量定义

- package 没有 Chart.js/ECharts/D3 运行依赖；index `:132–160` 加载本机 XLSX 和现有业务模块。实际趋势为手写 SVG，分布/漏斗为 CSS/HTML。可以保持此轻量基础，不能只为高端效果引入第二 UI 框架。
- 首页 `app.js:514–523`：最近 7 个**本机日历日**；新增按 customer.registered 日期计数，跟进按 followups.date 计数；空序列明确暂无数据。不是报名/入金趋势，也不是可自动推断 AI 转化曲线。
- `buildCounts:260–267`：非删除客户为分母，进群来自当前 status，hot 为布尔，VIP 来源 vipNumber/id/code；ticket/deposit 复用业务记录汇总。`renderAnalytics:900` 的进群率/热聊率/入金转化率均以当前有效客户总数为分母，是快照比值而非 cohort 漏斗。
- `statusSourceSummary:334–353`：具体渠道来自现有设置/别名；今日入/退排除 baseline，按客户+渠道+事件类型去重；当前总量按当前状态计客户。即同日反复入退不能把“人数”和“事件次数”混称。不能退回单导/群粉两大类而丢具体渠道。
- 联系人数是账号会话目录条数；跨账号相同客户/号码不等于一个全局联系人；linkedCustomers 使用客户 ID Set 去重。群目录数量也不是跨账号去重后的唯一群总数。
- completeHistoryConversations（server `:403–405`）依赖 historyLoaded 和两个指纹匹配，属于已有检查点覆盖指标；不能把此标记升级成平台端全部历史已完整证明。
- 群消息阅读的 Unknown 不计 Unread；若做阅读率，必须明确目标消息、成员快照/有效分母、观察时间、被排除成员与未知比例，不能只对已返回 LIMIT 行算完整群阅读率。
- 目前没有统一带来源版本、范围、生成时间、时区、币种及完整分母的图表 DTO。金额显示 `app.js:253` 默认 ¥；跨币种业务不能直接相加并标单一货币。S2 应先冻结指标口径，再在既有只读模块上做限定聚合/分页/缓存，不扩展平行架构。
- 统计分析页面仍有行内 9px 等旧规则（`app.js:900`）；实际最终字号取决于覆盖 CSS，本轮没有桌面/DPI 验证，不宣称已经适配全部缩放。

## 变更审批边界

业务语义、历史迁移、第三方能力、生产Flag或数据删除需要变更时，停止对应变更并提交兼容性/备份/回滚方案；其他安全的局部工作继续。视觉改造不得自行扩大AI建档、群控、密钥或数据外发权限。不得修改历史迁移或checksum，不新建第二客户权威或消费者。
