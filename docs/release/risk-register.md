# 发布与升级风险登记

基线：`e0426932b9efa77f85e5b7d8ad5d6953024bfc94`；分支 `upgrade/zhike-61-ab-delivery`；日期2026-11-17（Asia/Calcutta）。这是当前源码盘点，不把设计图或历史通过当新增功能证据。生产入口FROZEN。

## 状态规则

以下为源码定位/待隔离复现，除明确校验结果外均为Open，不是已发生生产故障。S0 Gate Passed仅指审计和保护基线完整；这些风险分别阻断对应实施/发布Gate，不代表产品已具备全部6.1能力。

## 当前只读发现的优先风险（未复现，不是本轮已修复）

| 优先级 | 证据 | 下一步验收/处置建议 |
| --- | --- | --- |
| P0复核 | app.js:957–974旧emptyRecycle仅明确过滤customers/tickets/deposits/followups/registrations；没有对应settings.operatingTasks、WS/群关系等完整清理。与治理API二阶段purge是两条路径 | 用临时关联客户验证主回收站永久清空后任务、AI/WS/群关系/审计是否仍一致；以已有全量purge契约收敛入口，先设计不可直接全局删除。未据此断言实际用户已存在孤儿 |
| P1 | v4-data-center.js:16 registrationHistory按抽屉h2姓名find第一位客户，而主档允许同名、ID才权威 | 同名不同ID客户分别打开，报名历史必须按ID；避免增强层覆盖正确主时间线 |
| P1 | app.js:1731报名导出与页面筛选不一致；:1633 activity导出与30条DOM搜索作用域不同 | 明确全部/筛选标签和export selector；加入筛选→CSV条数/内容一致测试 |
| P1 | app.js:954硬写“SQLite 正常/完全离线”；:955把近30条activity标作“审计状态持续记录”；governance-ui标题含“AI自动建档”无明确聊天/群建档边界 | 展示实际状态/来源/采样时间/覆盖；本地业务可离线不等于AI/WS完全离线，普通聊天AI不得自动建档 |
| P1 | styles/global/horizon多层!important、主题selector不一致、主表多处小字，首页/模块对不同布局容器约定不统一 | 主设计系统和page shell先盘点收敛；保留导航/业务并在100/125/150%DPI、滚轮/键盘实测，不能只新增另一层补丁 |
| P1 | app.js:1710、runtime-customizer同改主题；标题文本/DOM selector驱动多模块注入 | 新route/renderer显式挂载生命周期，避免更名/换骨架后按钮/监听丢失或重复；先为原有增强能力建立可追溯清单 |
| P1验证 | 全局selected跨分页/筛选；批量撤销存在主app与business-enhancements/productivity多套入口；批量客户扩展撤销与较新字段并发关系需保护 | 预览时显示全部已选范围、隐藏选择数量；预览后字段变更不得被撤销无声覆盖；不增加第二套业务权威 |
| P2 | securitySettingsModal:1015仍有“工作区随应用文件夹迁移”旧说明，runtime-customizer另有JSON迁移指导 | 与实际动态AppData/重新授权规则统一说明；不能用搬安装目录当完整数据迁移 |
| P2已处理 | business-enhancements 客户合并曾将含 settings 的全工作区备份存入 settings.lastCustomerMerge：前次备份层层嵌入，撤销整体覆盖合并后的设置与其他记录 | 已处理。撤销点改为第 2 版范围化记录：仅保存参与合并客户的合并前/后副本与被转移业务记录的引用，不含 settings 和全工作区备份，不嵌套。撤销只恢复这些客户与记录归属，合并后新增或修改的无关设置、客户和记录保持不变；合并操作在操作记录中标为“已撤销”。参与客户在合并后被修改、被转移记录改归属或被删除、客户/记录编号重复、撤销记录版本未知时拒绝撤销并保留撤销点，提示人工处理或使用合并前自动快照。合并或撤销保存失败只回滚本次涉及的对象并保留撤销点。仍为单次撤销。旧版完整备份撤销点按同一范围解释，不再整体恢复 settings。验证：`tests/customer-merge-undo-scope.test.cjs` 运行真实模块 10 个场景，修复前 7a4b47a 与 main 均有 7 项失败。真实 SQLite 重载后的字段规范化差异可能使撤销被保守拒绝，尚未在 Windows 实机验证。V9.2 集成：合并不再改写保留客户已锁定（manualLockedFields/aiLockedFields）的标签与备注；合并后新设的锁视为后续修改，撤销拒绝 |
| P0已处理 | V9.2 专用 WS 群组管理页在安装版不可用：①Sidecar 精确静态白名单缺 `/modules/ws-managed-groups-ui.js`，页面 404 并显示“群组管理模块未加载”；②页面把 workbench `api()` 的已解析 JSON 当作 fetch Response 读取，每次读取都失败；③`bind()` 从未被调用，新增/编辑/停用/搜索/导入按钮无效，表单回退为原生提交并重载页面。Windows CI 自 `8b40f77` 起因打包 WebView2 冒烟未预期新导航项而持续失败 | 已处理：白名单只增加该精确路径，路径包含校验不变；页面改用 workbench 已解析响应约定；事件改为按页面根委托的文档级监听，读取事件发生时的页面状态。打包门禁要求该模块、ws-managed-groups-core.cjs 与 035 迁移；`tests/ws-managed-groups-page-load.test.cjs` 以真实隔离 Sidecar 覆盖源码与打包目录；打包 WebView2 冒烟覆盖列表、新增、编辑、停用/启用、导入预览后提交、AI 候选、解除绑定与就地错误。真实 Windows 安装后的人工页面操作仍待验收 |
| P2 | 操作记录只30条、主要依赖文案时间；增强模块有另外500条批量记录，客户治理审计另表 | 做真实审计来源清单/统一只读查询，不以状态快照冒充完整历史 |

## 滚动、焦点、缩放机制与待测风险

已有可复用点：

1. `scroll-coordinator.js:30–62,174–211`统一region与input-time lazy注册；contain节点可见tabIndex，非滚动子节点向contain父级递交；`:318–359`普通wheel只在能消费时preventDefault，Shift/横向意图交表格；`:366–396`键盘滚动不劫持输入控件；`:437–453` observer不扫整个WS子树。
2. `scroll-system.css:150–180`固定WS外画布与真实scroll owner，11px可抓滚动条（`:9`），稳定gutter；`ws-workbench.css:456–460,549,575,732–765` WS外层hidden、导航/业务内容/辅助体各自滚动。原生WhatsApp WebView独立输入表面不能通过父HTML滚轮逻辑模拟验收。
3. `ws-workbench.js:1867–1905,3003–3017,3984–3993` 同步/小阈值恢复scrollTop，保留导航和辅助body，不用每tick重建滚动容器；`:3690–3705`保留编辑输入焦点；`:4957–4969`抽屉开关还焦。业务列表详情在小窗口scrollIntoView（`:5073`）。
4. 新设计系统 `ws-workbench.css:462–491` 250px/76px侧栏、16px正文/44px控件；`:814–868`按有效CSS像素折叠详情/侧栏，不缩小字体；reduce motion覆盖。Native `LegacyUiHostPage.xaml.cs:2109–2165` raster scale snap；`MainWindow.xaml.cs:272–279`使用XamlRoot scale。仍需真正100/125/150%显示缩放，不把Edge有效视口当原生DPI证据。

静态风险（尚未本轮复现，不能写成已发生故障）：

- **P1候选：热刷新重建成本与焦点。** `render:3774–3820`即使DOM增量patch，仍构造完整大markup、扫描全部conversations、解析隐藏capture草稿。120会话window（`:115,3484`）与40页只界定DOM，不界定所有内存/字符串工作；大量会话/大粘贴时测主线程耗时，再按source version缓存/局部更新，不能再叠另一套全局刷新器。
- **P1候选：AI/CRM重复请求。** `ai-review-center-ui.js:87–103`监听body子树，host节点替换会重新mount/刷新；主工作台 `refreshWorkspacePage` 又显式调用其refresh。当前generation/abort防串号，不代表没有重复GET和中途清空/焦点丢失。测12页快速切换及刷新时实际请求次数，之后合并刷新所有权，不另造新队列。
- **P1候选：内外滚轮/DPI。** 多层overflow与全局capture handler需以鼠标位置、顶/底边界、表格横滚、详情/弹窗、native表面分别实测。`scroll-coordinator.js:318`没有Ctrl/meta wheel早退，而keydown有；Ctrl+滚轮可能被当滚动消费，应确认缩放策略并实测，不直接断言已修复。
- **P2候选：旧CSS叠加。** `ws-workbench.css:364–420`还存在旧9/10px监测/群发规则，后半新作用域覆盖提高字体。需computed style验证每个子控件，避免新页漏作用域落回旧小字体；不再用更多高优先级override补丁解决。
- **P2候选：名义独立设置、实为chat辅助入口。** `focus-assist:5153–5163`将settings页工具移回chat小栏，造成多功能混合/额外Core展示。S1以后优先复用真实工具服务为完整子页；本次不把入口存在当完整独立功能。
- **P2候选：已加载范围。** members最多1000、AI/候选各50、跟进8、collection-items1000，客户端分页不能冒充全部记录。后续真正大数据分页需共用service查询边界，不在UI把所有记录一次拉完。

## 必须先处理的发布/数据阻断

| 编号 | 源码事实/证据 | 阻断与下一步最小处理 |
| --- | --- | --- |
| RD01 / P0 | `server.mjs:22` 无条件 require `./migration-runner.cjs`；`scripts/build-winui-bundle.ps1:32–50` 的资源白名单包含 node/server/coordinator/state-delta/modules/migrations，但没有 migration-runner.cjs；`:183–196` 只按白名单复制且必需文件检查同样漏此依赖 | 当前打包脚本对现源码的运行依赖闭包不完整。静态可确认新 bundle 会漏文件；本轮未构建/启动，不能把启动失败写成已实测。必须补白名单/必需清单并用隔离正式 bundle 启动验证，不靠开发目录补文件。 |
| RD02 / P0 | S0历史源码曾通过`PrepareCollectorProfileAsync`复制前台认证profile；排除Cookies不等于排除授权状态。当前代码`c970d40`已按用户批准移除复制实现，并在任何IO前拒绝相关公开入口，Native不创建隐藏collector，JS明确不可用 | 已实施受控整改，见`rd02-authenticated-profile-acceptance.md`及批准决定。既有profile/业务/队列保留；真实后台替代能力未实现或授权，不得通过回滚重新启用旧复制路径。当前前台容器证据不冒充真实WhatsApp收发。 |
| RD03 / P0 | 未在所查 runtime/scripts 中找到 `.zkdevice`、AES-GCM/PBKDF 设备迁移实现；`NativeBackupEnvelope.cs:55–76` 实际为明文 payloadJson + SHA-256 完整性封装，文件扩展 `.json`（`BackupRetention.cs:8–14`） | 已有备份不是加密设备迁移包。不得以 SHA 完整性代替加密、身份隔离和完整业务迁移验收。迁移功能需复用现有客户权威和备份，不复制登录态/DPAPI Key。 |
| RD04 / P0 | WS 导出 `server.mjs:494–526` 额外输出 sendAudit/mediaAssets/groups/groupMembershipEvents；恢复 `:4967–4974` 只接收旧 settings/conversations/messages/analyses/replies/batches/collectionRuns/collectionItems/followupAlerts。原生备份 `DesktopToolsService.cs:152–183` 收集此 JSON；媒体 DTO 只含下载 URL/索引，不封装文件字节；群管理/AI 新账本也不在完整往返恢复清单中 | 不能宣称完整恢复 6.1 全部数据、素材和发送安全状态。需逐表/文件覆盖对账、版本兼容及隔离往返演练；尤其不能丢 sendAttempt unknown 墓碑后允许盲重发。当前旧 JSON 备份能力保留，但必须诚实标范围。 |
| RD05 / 发布前阻断 | `Zhike.Desktop.csproj:4` 为 net10.0-windows10.0.22621.0；未见显式 SupportedOSPlatformVersion/TargetPlatformMinVersion；Inno Setup 无 MinVersion。已保存的原生验收环境是 Windows 11 10.0.26300，不能替代干净 Win10/Win11 测试 | TargetFramework 的 Windows SDK 版本不等同经过证实的运行最低版本。本仓库尚不能给出已验收 Win10 支持承诺。需基于实际依赖明确受支持版本并在安装前拒绝不支持系统，再进行干净设备 B/C 验收。 |
| RD06 / 发布前阻断 | 安装器 `zhike-desktop-setup.iss:243–251` 缺 WebView2 时只询问打开下载页，允许继续安装；构建脚本 WebView2 检查也只是构建机注册表探测/警告 | 没有目标机可验证、可恢复的必需运行时部署流程。需可靠安装/提示/重试和缺运行时实测，不能把开发机检测到 Runtime 当作目标机满足依赖。 |
| RD07 / P0 观测真实性 | `/api/health` 的 `server.mjs:5368–5375` 固定返回 databaseStatus=healthy、workerStatus=running；生产 `App.xaml.cs:40` Supervisor Enabled:false | 此字段不是 Worker 活体指标，也不是数据库完整性证明。应明确 sidecar 存活、数据库检查状态和 Worker disabled/unknown 的真实含义；禁止新仪表直接显示“Worker运行正常”。 |
| RD08 / P0 门禁复核 | `LocalServiceManager.cs:214–240` 的 ProcessStartInfo 默认继承父进程环境；正常构建路径只覆写 data/port/token 等，没有明确移除父环境的隔离 AI/group/fencing 变量。`server.mjs:42–55` 按这些环境变量及 mock 标记启用隔离接口 | 存在开发环境变量流入正式启动上下文的静态风险；未读取本机实际环境/配置，也未声称已发生。需正式路径显式隔离开发测试开关并以临时根验证；不可因应用层 Supervisor=false 就忽略 sidecar 的独立 Gate。 |

## 处置顺序与授权

1. 立即维持旧认证profile复制路径不执行、不验证真实登录态；只有安全替代或明确拒绝后才能评审生产采集，不用复制绕过平台。
2. S1/S2复现并改真实状态、滚轮与重复渲染问题；S3-S6逐页保留业务并修局部缺陷。
3. 涉及回收站永久删除契约、完整设备迁移/恢复的数据格式，先形成兼容设计，不擅自改业务或真实数据。
4. S8前补打包依赖闭包、最低系统、可靠运行时部署、受信任签名与安装/升级/卸载/失败回滚实测。
5. 干净机、原生DPI/多显示器或证书条件不足时标Blocked/NotTested，不把开发机运行视为跨设备通过。

本阶段尚未验证可用的签名证书、干净VM或独立Windows设备；本轮没有新建账户、更改安全策略或读取签名私钥。

## S3 收尾风险

- 两项新增只读图表的原生复验被窗口捕获错误阻断；自动化51/51不能替代原生证据，S3 Gate保持Blocked。
- 本轮曾发生WS本地导入测试启动失败，原测试忽略子进程输出，根因未证实；原场景原样重跑通过，现仅增强有界脱敏启动诊断，未延长预算或削弱断言。最终完整重跑结果以S3报告为准，不能据一次通过称根因已修。
- 最终冻结全量286/291，另有WS API/媒体schema/广播/列表预览/跟进链5项失败；原样复现API仍Failed、其余4项Passed。临时加诊断的API六次通过仍未捕获原因。schema夹具finally可覆盖原异常、广播退出等待有同步风险，尚不能将它们冒称为本次产品故障根因；必须继续诊断并完整重跑，不能只取单跑绿灯放行。
- 新阶段图只统计当前有效客户现存的可验证流转，历史不完整；同步聚合较大保留历史的成本仍需S7实测，不能称全项目性能已优化完成。
- 最新隔离宿主由用户正常关闭，仅预先记录的root/sidecar/Core三个PID未发现活体；本次未取得完整退出前进程树。较早两个默认配置宿主15/15准确身份释放的证据保留，不把其结果复制到最新宿主。
