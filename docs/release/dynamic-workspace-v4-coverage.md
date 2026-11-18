# Horizon Atelier Pro · Dynamic Workspace V4 覆盖与证据矩阵

本轮源码盘点覆盖 **M01–M23 共 23 个知客页面、WS01–WS12 共 12 个 WS 页面，以及 15 组共享、低频和原生组件**。源码覆盖不等于全部页面通过运行验收。本报告把源码定位、浏览器夹具、原生操作分别记录，不能相互替代。

开始基线：`db4abfb`，分支 `upgrade/zhike-61-ab-delivery`。本轮产品代码提交为 `63bea50`；本报告为随后独立报告提交，不在文内填写自身提交哈希。生产入口 **FROZEN**；S3 **Blocked**；不得据此发布安装包或进入正式 WS/AI 执行。

## 1. 依据、责任与判断口径

- 业务现状复用[知客项目现状审核](../review/2026-11-17/知客项目现状审核_2026-11-17.md)及[既有验收矩阵](acceptance-matrix.md)，没有重建业务规则。
- 机器可读源码清单：[coverage-draft.json](evidence/dynamic-workspace-v4-2026-11-17/coverage-draft.json)。其中 `NotTested-current-V4` 是盘点生成时状态；本报告下表补充后续实际证据，不能反向覆盖失败历史。
- **R（共享视觉）**：根代理负责 `design-system.css`、`global-6.css`、`horizon-atelier.css`、`home-6.css`，首页展示性标记及原生主题资源。
- **B（业务页面）**：业务视觉代理负责 `business-6.css`、`operations-6.css`、`phone-registry.css`。
- **W（WS / GPT）**：WS/GPT 视觉代理负责 `ws-workbench.css`、`gpt-modern.css`、`gpt-management.css`。
- **V（证据）**：覆盖代理负责本矩阵、独立截图命令及 S1 主视觉检查中三处明确失效的旧颜色期望；不修改产品业务逻辑。
- **保留**：已有真实 renderer、控件、业务服务和导航行为符合复用原则；不是把旧功能重写一次。
- **视觉升级**：复用共享主题及模块语义色调整层次、导航、卡片与控件。无须每个页面都有独立代码改动才能覆盖。
- **未验**：尚未执行指定主题、尺寸或交互，不能因同一 CSS 被其它页面使用而标记 Passed。
- **有限原生证据**：仅确认下表列明的页面、主题和动作；截图不能证明全业务链、完整回归、全 DPI 或平台收发能力。

## 2. 35 个页面的源码与实际覆盖

源码缩写：

- **APP**：[app.js](../../resources/app/app.js)
- **OPS**：[operations-ui.js](../../resources/app/modules/operations-ui.js)
- **REG**：[phone-registry.js](../../resources/app/modules/phone-registry.js)
- **WS**：[ws-workbench.js](../../resources/app/modules/ws-workbench.js)
- **WSB**：[ws-business-pages.js](../../resources/app/modules/ws-business-pages.js)
- **GPT**：[gpt-assistant.js](../../resources/app/modules/gpt-assistant.js)

所有页面均已定位实际 renderer。下表的“未验”针对本轮对应页面证据，不否定历史功能验收，也不拿历史结果代替本轮结果。

|编号 / 路由|实际 renderer|本轮视觉范围 / owner|本轮浏览器结果|本轮原生结果与限制|
|---|---|---|---|---|
|M01 `home` 今日工作台|APP `renderHome`、`renderHorizonHero`|R：首页数字地平线、已有 KPI / 趋势 / 提醒与共享导航|浅色截图 Passed；捕获批次有成功退出证据|02 浅色、06 深色有限显示证据；不是所有图表明细、动效和偏好操作验收|
|M02 `intake` 快速录入|APP `renderIntake`|B+R：录入与预览层次、原解析保存流程保留|浅色截图 Passed|未验原生录入、解析、保存和错误恢复|
|M03 `operations` 任务中心|OPS `taskPage`|B+R：紫色任务语义、完成率图与状态标签|任务页 renderer JSON / PNG 已生成，但 Edge 退出超时，整项 **Failed**|07 深色任务页有限显示证据；不代表任务完成/恢复交互通过|
|M04 `stage-board` 阶段看板|OPS `boardPage`|B+R：青色分列与阶段预览；原拖动逻辑保留|未验截图|08 概览、09 列区域、15 返回后的深色页面；本轮不证明拖动持久化、横滚修复|
|M05 `customers` 客户中心|APP `renderCustomers`|B+R：表格、筛选、状态、可收档案预览与共享控件|未验独立截图|01 是**修复前重叠缺陷证据**，不是通过图；最终修复后的原生横滚未验|
|M06 `segments` 分类视图|APP `renderSegments`|B+R：保存视图与分类强调，原筛选语义保留|未验|未验|
|M07 `hot` 热聊管理|APP `renderHot`|B+R：暖橙强调；已有热聊及业务状态保留|未验|未验|
|M08 `groups` 本地群组管理|APP `renderGroups`|B+R：真实本地关系表；不等同 WS 实时目录|未验|未验|
|M09 `vip` VIP管理|APP `renderVip`|B+R：金色标识与原客户主档关联|未验|未验；不与 WS 平台群混为一谈|
|M10 `tickets` 跟票管理|APP `renderBusiness('tickets')`|B+R：靛蓝业务强调与真实独立记录表|未验|未验|
|M11 `registrations` 报名统计|APP `renderRegistrations`|B+R：绿色强调；客户数/记录数区分保留|未验|未验|
|M12 `deposits` 入金管理|APP `renderBusiness('deposits')`|B+R：青绿强调；币种及确认语义不变|未验|未验|
|M13 `analytics` 统计分析|APP `renderAnalytics`|B+R：已有真实图表、分布及数据来源|未验|未验本页图表与钻取|
|M14 `ws-workbench` WS入口|WS `render` / workspace route|W+R：独立导航与共享顶部、原宿主保留|同 renderer 的 WS03 浅色截图通过；未单独验证主入口点击|10 进入 WS、15 返回知客阶段看板有限动作证据；不扩展为全部窗口状态矩阵|
|M15 `gpt` GPT运营助手|GPT `render`、`renderMessages`|W+R：紫粉层次、现有会话/配置/计划入口|配置状态为隔离夹具的浅色实际 renderer 截图 Passed|未验原生 GPT 页面或设置；未调用真实 AI|
|M16 `automation` 本地自动化|APP `renderAutomation` / `renderAssistantSuggestions`|R：治理型标题与规则卡片；本地规则不冒充 AI 推理|未验|未验|
|M17 `quality` 数据治理|APP `renderQuality` + governance 扩展|R：冲突、复核、警告与共享表单层次|未验|未验；不自动执行去重或删除|
|M18 `data` 数据中心|APP `renderData` + `v4-data-center.js`|R：数据操作分区与已有备份恢复入口|未验|未验恢复/导入低频弹窗|
|M19 `activity` 操作记录|APP `renderActivity`|R：真实本机活动列表与审计区别保留|未验|未验|
|M20 `recycle` 回收站|APP `renderRecycle`|R：危险操作、空态、表格与恢复入口|未验|未验；未执行清空或永久删除|
|M21 `settings` 系统设置|APP `renderSettings` + workspace-shell|R：原主题/密度/动效/字典设置统一|未验完整页面|04–05 是共享外观弹窗证据，**不算完整系统设置页验收**|
|M22 `phone-registry` 手机号登记|REG `render`|B+R：原登记表、输入与分页；修正旧暗色/小字号覆盖|未验当前独立截图|未验原生导入/编辑/滚动；不自动建 CRM|
|M23 `followups` 兼容客户跟进|APP `renderFollowups`|B+R：可达隐藏 route，原客户计划/历史保留|已纳入截图计划但未执行|未验；不因无主导航入口而漏计|
|WS01 `overview` 工作台首页|WS `renderWorkspaceOperationalOverview`|W+R：已加载概况与未知值；原服务范围保留|未验|未验|
|WS02 `accounts` 账号管理|WS `renderAccountList` / `renderAccountForm`|W+R：账号归属、状态、搜索与原切换入口|未验|14 深色账号页有限显示证据；**未做本轮十次切号**|
|WS03 `chat` 前台聊天|WS `render`、`#wsBrowserHost`|W+R：仅外层 toolbar / CRM；保留真实 WebView2|浅色真实外壳截图 Passed；Browser 中是原官方容器占位|11 深色容器、12 CRM 辅助面板展开；未登录真实 WS，不证明输入收发或 Core 全生命周期|
|WS04 `groups` 群组管理|WS `renderGroupDirectory`|W+R：当前账号目录、筛选、分页与详情|未验|13 深色群组页有限显示证据；不证明平台监测或群操作|
|WS05 `members` 群成员管理|WSB `renderMembers`|W+R：账号/群组关系表与角色/未知状态|未验|未验|
|WS06 `collection` 数据采集|WS `renderCollectionCard` / WSB `renderRunDetails`|W+R：历史状态、断点、错误与冻结提示|未验独立页|其它 WS 页面可见停用提示；**不是采集页或采集能力验收**|
|WS07 `contacts` 通讯录|WSB `renderDirectory`|W+R：已有本机目录、搜索、详情、分页|未验|未验；仅保存目录投影，不声称全部平台通讯录|
|WS08 `ai` AI助手|WS `renderAnalysis` + ai-review-center|W+R：原队列/证据/候选；正式消费者保持关闭|未验|未验|
|WS09 `crm` CRM客户|WSB `renderCustomers` + 原审核中心|W+R：唯一主档关联、候选/冲突/审核展示|未验|12 是**聊天右侧 CRM 面板**，不算此独立 CRM 页面验收|
|WS10 `tasks` 任务中心|WSB `renderTasks`|W+R：原任务列表、状态、来源与未知值|未验|10 深色任务页/独立导航有限显示证据；未操作任务执行|
|WS11 `logs` 操作日志|WSB `renderDirectory`|W+R：审计 / 快照 / 诊断分类与脱敏|未验|未验|
|WS12 `settings` 工具与设置|WS `renderWsWorkspacePage`|W+R：复用翻译、配置、诊断、导出和原工具|未验|未验；无新增发送或采集权限|

## 3. 15 组共享、低频与原生组件

表中“源码覆盖”只说明已找到实际可达组件与样式责任，不保证所有展开状态、数据组合和操作均已运行。

|编号|组件 / 实际来源|处理分类与 owner|本轮实际证据 / 尚未验证|
|---|---|---|---|
|C01|`index.html` 的 `#sidebar`、`#mainNav`、`.workspace-switch`、`.sidebar-bottom`、`.topbar`；`workspace-shell.js`|R：已有导航行为保留，海蓝层次、图标/选中态、底部信息美化|03 浅色展开、15 深色返回与主导航；未覆盖全部项目的键盘、折叠、滚动和 DPI 组合|
|C02|WS `renderWsWorkspaceNav`、`.ws-workspace-nav-item`、`.ws-workspace-nav-status`、`.ws-login-toolbar`|W+R：独立 WS 轨道保留，视觉升级|10–14 深色有限页面；03-chat browser浅色；没有证明全部12页原生导航|
|C03|APP 与共享 DS 的 `.btn`、输入、分页、批选、`.status-tag`、`.tag`、chips|R+B+W：保留共享控制体系，统一主次/危险/禁用与语义状态|已截页面只覆盖其中可见状态；完整键盘焦点、禁用、hover、compact 和状态组合未验|
|C04|APP `openModal` / `showCustomer`；`#modalBackdrop`、`#modal`、`#customerDrawer`|R+B：共享弹窗与档案分组，保留关闭/焦点/审核契约|04–05 实际外观 Modal；01是客户中心预览而非完整档案抽屉；其它真实业务 Modal 未验|
|C05|`workspace-shell.js` 外观偏好；APP 搜索/通知/帮助/工作区/头像|R：原偏好和取消恢复复用，低频入口统一|04–05 双主题外观展示并有保存动作；未将其推广为布局恢复、动效关闭或所有设置通过|
|C06|APP 客户编辑、登记跟进、票据、入金、报名、VIP、批量预览|B+R：真实业务表单/选项/警告统一；业务逻辑保留|已定位入口，独立截图计划已准备；本轮尚未执行这些弹窗|
|C07|`phone-registry.js`、`smart-import.js`、`customer-governance-ui.js`、`v4-data-center.js`|B+R：导入预览/冲突/备份恢复低频表单复用|源码覆盖；未做原生导入、恢复、危险确认；无生产写入|
|C08|`gpt-assistant.js` 的设置/Provider/历史/计划；GPT CSS|W+R：原配置通道及密钥掩码保留|浅色主页面实际 renderer；API设置、Provider切换、计划审批等未验，不调用真实 AI|
|C09|WS 辅助面板、翻译、诊断、群发预览、导出、本地消息|W+R：现有抽屉/工具视觉统一；不增权|12仅CRM辅助面板展开；翻译/群发/导出细项未验，未恢复旧后台采集|
|C10|`ai-review-center-ui.js`、WSB 任务/候选/证据/冲突/审计详情|W+R：真实审核界面保留；消费者冻结|源码覆盖，未做本轮原生批准/拒绝/冲突操作|
|C11|真实 `.empty-state`、`.ws-empty`、`.ws-error-line`、`.toast`、禁用与未知提示|R+B+W：各状态有区别；Unknown 不转成失败/离线/未读|WS原生图可见空记录、未提供、停用提示；完整错误、加载、Toast和空态矩阵未验|
|C12|`metrics-charts.js`、APP、OPS 的既有图表/明细|R+B：原数据口径和图表实现保留，只优化颜色/层次|本轮首页、任务与看板可见部分图表；未完成本轮全部明细联动与全主题图表矩阵|
|N01|`App.xaml`、`MainWindow.xaml`、`LegacyUiHostPage.xaml` 启动/连接异常/HostBorder/InfoBar|R：原固定浅色资源已改 Light/Dark/HighContrast ThemeResource；仅资源与控件样式|有正常原生工作区截图；启动错误、重试、诊断、Windows系统主题和高对比模式**未验**。嵌入页面主题与Windows主题仍是原有独立机制，没有新增IPC|
|N02|`MainWindow.xaml.cs` 的窗口与 presenter、系统标题栏按钮|保留原生窗口行为，V记录边界；无生命周期重构|有进入WS及返回原知客阶段页的有限证据；最小化/最大化/关闭/多显示器全矩阵未验|
|X01|`#wsBrowserHost`、`WsOverlayHost` 及官方 WhatsApp 内部；已停用 collector 层|**不适用/禁止改内部**：仅外壳美化；不复制认证态、不重建聊天 UI|隔离容器展示与右侧面板截图不证明平台内容/实时消息；真实WS未连接，旧采集保持不可用|

## 4. 低频入口定位补充

完整机器清单的 `dialogSymbols` 有 25 个入口或生命周期函数，`modalCalls` 有 31 个实际弹窗标题调用；动态标题在清单中保留模板，不伪造静态功能名称。包括：

- 工作区资料、本地管理员头像、新增客户、VIP 编号、热聊标记、编辑客户、登记跟进、票据/入金、报名。
- 外观偏好、安全与备份、全局客户搜索、表格列设置、快捷键与帮助、本地提醒。
- 导入待复核、智能批量导入、批量变更预览、号码登记导入预览、合并重复客户、批量编辑、本地运营分析、自定义首页和历史日期字段迁移。
- 额外增强脚本依然实际加载于产品；当前 S1 main browser fixture 只加载其既有模块子集，**不能用基础 renderer 截图替代这些增强组件的功能验收**。
- 危险、恢复、迁移或发送入口仅定位，不因美化而执行；其权限与业务契约保持原样。

## 5. 浏览器证据与失败记录

独立命令：[dynamic-v4-capture.cjs](../../scripts/delivery/dynamic-v4-capture.cjs)。它不是 `*.test.cjs`，不会因全量测试发现而自动运行 122 次截图。使用真实产品 renderer 和明确隔离的合成记录，不启动 sidecar、不接触生产库、真实账号或真实密钥。

- [smoke 第一轮](evidence/dynamic-workspace-v4-2026-11-17/smoke-browser/capture-manifest.json)：首页通过；GPT 初次在新截图脚本中先发单对象、后转数组，被原 helper 的数组协议断言拒绝。仅修正新截图脚本的一次性最终结果发布，保留失败记录，没有修改 helper/断言/超时。
- [smoke v2](evidence/dynamic-workspace-v4-2026-11-17/smoke-browser-v2/capture-manifest.json)：首页、GPT、WS前台聊天 **3/3 browser capture Passed**，图片已实际查看。GPT 图片路径基址问题在新夹具中修正，不是产品修复。
- [页面正式批次](evidence/dynamic-workspace-v4-2026-11-17/actual-browser/pages/capture-manifest.json)：首页、快速录入成功；第3个 `main-operations-atelier-dawn` renderer与PNG完成，但 Edge 退出超时，整项 **Failed**。未完成全部70张页面截图及52张附加状态截图。
- [退出失败原记录](evidence/dynamic-workspace-v4-2026-11-17/actual-browser/pages/1794933464472-d7e0af4e-af1e-48cb-ba31-43e476f1f5c0.json)：9.49秒身份确认，23.57秒结果确认，24.58秒 `Browser.close` 已确认，30秒 `process-exit` 超时。不能把时间分布解释成已定位产品根因。
- [只读身份复查](evidence/dynamic-workspace-v4-2026-11-17/actual-browser/pages/post-failure-identities.json)：17个已观察身份中16个PID已不存在，PID6896当前为 `SoftLandingTask`、StartTime不可读取，记录 `IdentityUnavailable`；未据此强杀、提权或宣称全部资源清理完成。
- 失败根目录 `C:\Users\酷酷\AppData\Local\Temp\zhike-s1-main-style-JCgVB2` 保留；具体后续处理以最终总报告为准，不改写原失败结果。
- 新脚本末版增加本次 CSS 字节冻结和输入SHA清单；完成语法检查，但没有为这项夹具改善再次重试失败场景。此前成功截图对应各自运行时版本，不冒称最终代码所有页面都重新验证。

已执行场景数量不能相加为独立页面数：首页在两个批次重复，GPT与WS来自smoke。当前明确有成功browser capture的独立页面是首页、快速录入、GPT和WS前台聊天共4页。任务页有可查阅截图，但资源退出失败保持 Failed。

## 6. 本轮15张原生截图的准确含义

截图来自标题含 `ISOLATED 验收` 的 WinUI 测试窗口；数据为本轮隔离样本。以下只记录实际画面与根代理执行的有限动作，不给整页业务功能签署通过。

|证据|实测范围|不能由此推导的结论|
|---|---|---|
|[01 customer light](evidence/dynamic-workspace-v4-2026-11-17/native/01-customer-light-overlap.png)|修复前客户列表横滚/固定列文字重叠可见|不能作为修复后 Passed；未原生复验最终横滚|
|[02 home light](evidence/dynamic-workspace-v4-2026-11-17/native/02-home-light.png)|浅色首页显示|不证明全部首页图表与动效|
|[03 CRM rail expanded](evidence/dynamic-workspace-v4-2026-11-17/native/03-crm-rail-expanded-light.png)|主侧栏展开、浅色工作区|不证明全23导航滚轮/键盘/DPI|
|[04 appearance light](evidence/dynamic-workspace-v4-2026-11-17/native/04-appearance-light.png)|原外观弹窗浅色状态|不证明系统设置整页|
|[05 appearance dark](evidence/dynamic-workspace-v4-2026-11-17/native/05-appearance-dark.png)|深色选择/预览，原保存动作已操作|不证明取消回滚、动效OFF、高对比模式|
|[06 home dark](evidence/dynamic-workspace-v4-2026-11-17/native/06-home-dark.png)|切换保存后的深色首页|不代表所有35页深色已查|
|[07 tasks dark](evidence/dynamic-workspace-v4-2026-11-17/native/07-tasks-dark.png)|深色任务页面显示|不代表任务完成/恢复/失败写回|
|[08 stage overview](evidence/dynamic-workspace-v4-2026-11-17/native/08-stage-board-dark.png)|深色阶段概览|不代表本轮拖动持久化|
|[09 stage columns](evidence/dynamic-workspace-v4-2026-11-17/native/09-stage-columns-dark.png)|深色阶段列区域|不代表全部横滚与卡片操作|
|[10 WS tasks rail](evidence/dynamic-workspace-v4-2026-11-17/native/10-ws-rail-tasks-dark.png)|进入WS、独立侧栏、任务页和停用提示|不证明真实任务执行/12页完整导航|
|[11 WS chat](evidence/dynamic-workspace-v4-2026-11-17/native/11-ws-chat-dark.png)|深色原生WS聊天容器外壳|不证明真实WhatsApp登录/收发/翻译|
|[12 WS CRM panel](evidence/dynamic-workspace-v4-2026-11-17/native/12-ws-crm-panel-dark.png)|聊天右侧CRM辅助面板展开|不算WS09独立CRM客户页或审核通过|
|[13 WS groups](evidence/dynamic-workspace-v4-2026-11-17/native/13-ws-groups-dark.png)|深色群组管理页面显示|不证明真实同步/群操作|
|[14 WS accounts](evidence/dynamic-workspace-v4-2026-11-17/native/14-ws-accounts-dark.png)|深色账号管理页面显示|未做本轮十次切号/竞态矩阵|
|[15 return CRM](evidence/dynamic-workspace-v4-2026-11-17/native/15-return-crm-dark.png)|返回知客后恢复**阶段看板**及主导航|这里的CRM意为知客主工作区，**不是客户中心或WS09**|

本轮原生截图完成后，另有两项最终 CSS 修正：14px 字号相关修正及表格行绘制（rowpaint）修正。这两项没有重新启动隔离窗口进行原生复验；上述截图反映其余本轮视觉 CSS，而不是这两项最终修复后的效果。其浏览器或自动化结果须单独引用，不能代替原生复验。

全 DPI（100%/125%/150%）、多显示器、compact完整矩阵、动效 OFF、十次账号切换、最终客户列表原生横滚修复仍未验。不能将历史通过结果或本轮单尺寸截图推广到这些项目。

## 7. 历史 before 资料使用规则

- [此前视觉升级报告](visual-usability-upgrade-2026-11-17.md)的产品视觉代码是 `20d01e41ab336944e4fa5df66b358c9032bb8f04`；随后 `45330dd` 修正检查器，`9aacf56` 是后续报告基线。
- [历史 before 图片目录](evidence/visual-usability-2026-11-17/before/)与该报告只作为**历史版本对照**；不是本轮基线 `db4abfb` 逐页重新截图，也不是本轮运行证明。
- [此前验收补齐报告](horizon-pro-acceptance-followup-2026-11-17.md)的检查辅助修复为 `ec7f89f`，历史290/291等结果不搬作本轮测试数字。
- 本轮01客户重叠图属于此次修复前原生证据，应与最终修复后证据区分；不能删掉失败图只保留有利画面。

## 8. 未完成覆盖与门禁

源码定位与视觉样式覆盖已完成记录；**全项目35页、所有弹窗、状态和显示规格的真实运行验收没有完成**。独立截图计划支持后续继续未执行场景，但已有退出失败不得因后续其它场景通过而消失。

需补齐：未验页面双主题截图；低频业务弹窗/抽屉；加载、错误、禁用和空态组合；compact与小窗口；最终客户横滚原生复验；动效OFF；十次切号及该操作矩阵后的资源释放；原生启动错误/重试/诊断及系统主题资源；全DPI/多显示器。已通过的历史业务测试不重复开发，是否需要重新执行按实际改动与门禁决定。

本文的覆盖与归档整理没有重新运行测试。根代理随后实际执行的最终回归为 **289/291**，下列两项仍为 Failed；这与独立截图批次的失败分别保存，不互相替代：

|最终回归项目|实际结果|证据|
|---|---|---|
|Stage 5.1 real workspace collapsed layout|Edge `process-exit` 超时，Failed|[原始元数据](evidence/dynamic-workspace-v4-2026-11-17/final-regression/stage51/1794936944713-5e93f3ef-8e30-4a57-94d1-7958951ecfb3.json)、[已产生的 renderer 结果](evidence/dynamic-workspace-v4-2026-11-17/final-regression/stage51/1794936944713-5e93f3ef-8e30-4a57-94d1-7958951ecfb3.result.json)|
|Delivery S1 actual main renderers and shared design system|Edge `identity` 阶段超时，Failed|[原始元数据](evidence/dynamic-workspace-v4-2026-11-17/final-regression/main/1794937090207-b9cbe0f2-2291-40c2-8c13-d4fedbc08485.json)、[已保存的观察值](evidence/dynamic-workspace-v4-2026-11-17/final-regression/main/1794937090207-b9cbe0f2-2291-40c2-8c13-d4fedbc08485.result.json)|

[最终回归日志（SID 脱敏副本）](evidence/dynamic-workspace-v4-2026-11-17/full-regression-final.sid-redacted.log)保留全部测试输出及失败。基于同一次最终回归的[只读子集核对](evidence/dynamic-workspace-v4-2026-11-17/final-test-subsets.json)，WS 模式的160项标签全部实际执行并通过；主页面保存结果中8视口×20页的字号观察值满足原有字号断言，但**不把整体超时测试改成 Passed**，也不替代原生 DPI 验收。

[最终 Release 编译](evidence/dynamic-workspace-v4-2026-11-17/release-build-final.log)：0 warnings / 0 errors，20.86秒。[最终 Edge 身份只读检查](evidence/dynamic-workspace-v4-2026-11-17/final-edge-identities.json)记录所检查的30个已观察PID已经退出；这不抹去历史超时，也不证明所有先前截图场景均正常清理。两处 collapsed-layout 临时目录的后续处理由总报告单独记录。完整回归、运行风险及最终提交仍由本轮总验收报告汇总。视觉局部通过不解除 **S3 Blocked**，生产继续 **FROZEN**。

## 9. 证据归档与敏感数据检查

归档根目录：[dynamic-workspace-v4-2026-11-17](evidence/dynamic-workspace-v4-2026-11-17/)。共99个证据文件（26张PNG，其中15张原生截图；73个文本、JSON或日志），另有3个归档控制文件。93个不同内容SHA-256；相同内容的空stdout等文件仍以各运行身份分别保存。

- [SHA-256清单](evidence/dynamic-workspace-v4-2026-11-17/manifest-sha256.json)逐项保存原始源路径、源hash、归档hash、字节数和复制期间源稳定性。97份为原字节副本；2份全量日志包含完整Windows用户SID，明确标记为 `SID redaction`，**源与归档hash不同**。
- 两份脱敏日志分别为 [首轮全量](evidence/dynamic-workspace-v4-2026-11-17/full-regression.sid-redacted.log)与[最终全量](evidence/dynamic-workspace-v4-2026-11-17/full-regression-final.sid-redacted.log)，各替换2处完整用户SID。原始日志保留在 `.tools/dynamic-v4/`，没有把它们作为未经脱敏的附件提交。
- [敏感模式扫描与hash核验](evidence/dynamic-workspace-v4-2026-11-17/sensitive-scan.json)：99份源和归档hash与清单一致；73份文本的8类实际凭据模式及完整用户SID均无匹配；不存在未登记的证据附件。`token`、`key`等变量名称不作为凭据命中。
- PNG来自隔离合成数据会话，扫描工具不对图片进行OCR，因此不把文本regex扫描扩大为图片像素的自动敏感性证明。
- 未复制SQLite、journal、WebView2 profile、Cookie、`connection.private.json`、密钥配置或生产业务资料。`.gitattributes` 将归档设为原字节保留，并关闭日志空白告警；这不会改变产品源码规则。
- [最终范围审核](evidence/dynamic-workspace-v4-2026-11-17/final-scope-audit.md)作为独立只读检查附录归档，不代表新增业务验收。
