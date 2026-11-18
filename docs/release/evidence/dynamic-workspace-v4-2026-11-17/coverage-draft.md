# Dynamic Workspace V4 全项目视觉覆盖草稿

基线：`db4abfb`；生产 **FROZEN**；S3 **Blocked**。本文件是实际源码定位与待验收清单，不是截图通过证明。

## 1. 覆盖判断
已符合：已有真实renderer、共享控件、独立WS轨道和业务服务均复用。需美化：共享主题、导航、业务强调和层次。需布局/主题实测：双主题、compact、小窗、表格与弹窗。原生内部与WhatsApp内部不得用Browser截图替代。

## 2. 页面（23 + 12）

|编号|路由/页面|真实renderer|视觉范围和边界|本轮证据|
|---|---|---|---|---|
|M01|home / 今日工作台|resources/app/app.js:565 / renderHome|已有真实 KPI / 趋势 / 提醒；需升级白底数字地平线与有限动效，不换统计口径|待实际Browser/Native验收|
|M02|intake / 快速录入|resources/app/app.js:855 / renderIntake|原解析/预览/保存流程复用；需分区层次和警告状态一致|待实际Browser/Native验收|
|M03|operations / 任务中心|resources/app/modules/operations-ui.js:174 / taskPage|已有完成率图与真实任务状态；紫色强调，不改完成/恢复规则|待实际Browser/Native验收|
|M04|stage-board / 阶段看板|resources/app/modules/operations-ui.js:287 / boardPage|已有真实阶段图；青色分列，不动画化拖动节点|待实际Browser/Native验收|
|M05|customers / 客户中心|resources/app/app.js:723 / renderCustomers|已有可收预览/主档抽屉和分页；保留16px正文与紧凑密度|待实际Browser/Native验收|
|M06|segments / 分类视图|resources/app/app.js:716 / renderSegments|已有保存筛选；强调分类层次，不改变相对日期语义|待实际Browser/Native验收|
|M07|hot / 热聊管理|resources/app/app.js:888 / renderHot|使用暖橙；来源仍为真实热聊标记及业务记录|待实际Browser/Native验收|
|M08|groups / 本地群组管理|resources/app/app.js:978 / renderGroups|本地关系聚合与 WS 目录不同；绿色/青色状态不能假设实时同步|待实际Browser/Native验收|
|M09|vip / VIP管理|resources/app/app.js:887 / renderVip|金色业务标识；VIP客户不等于VIP平台群|待实际Browser/Native验收|
|M10|tickets / 跟票管理|resources/app/app.js:905 / renderBusiness|靛蓝强调；同客户不同股票/买卖日记录不合并|待实际Browser/Native验收|
|M11|registrations / 报名统计|resources/app/app.js:1165 / renderRegistrations|绿色强调；客户人数与报名记录数区分|待实际Browser/Native验收|
|M12|deposits / 入金管理|resources/app/app.js:905 / renderBusiness|青绿强调；不修改币种合计和已确认语义|待实际Browser/Native验收|
|M13|analytics / 统计分析|resources/app/app.js:990 / renderAnalytics|现有真实图表优先；不造图、不改变分母/来源|待实际Browser/Native验收|
|M14|ws-workbench / WS入口|resources/app/modules/ws-workbench.js:3837 / render|入口与WS03共用原生容器；截图不证明原生Core生命周期|待实际Browser/Native验收|
|M15|gpt / GPT运营助手|resources/app/modules/gpt-assistant.js:128 / render|真实异步renderer；配置仅隔离状态，不调用付费AI|待实际Browser/Native验收|
|M16|automation / 本地自动化|resources/app/app.js:994 / renderAutomation|只展示已有本地规则与建议，不把本地排序叫AI推理|待实际Browser/Native验收|
|M17|quality / 数据治理|resources/app/app.js:1043 / renderQuality|需覆盖复核/冲突/警告色；保留人工审核与去重规则|待实际Browser/Native验收|
|M18|data / 数据中心|resources/app/app.js:1044 / renderData|已有备份/恢复入口与原v4扩展；恢复确认属于低频弹窗|待实际Browser/Native验收|
|M19|activity / 操作记录|resources/app/app.js:1045 / renderActivity|真实本机操作记录；不可把运行快照冒充审计|待实际Browser/Native验收|
|M20|recycle / 回收站|resources/app/app.js:1046 / renderRecycle|危险操作明确、不自动执行；空态需要单独截图|待实际Browser/Native验收|
|M21|settings / 系统设置|resources/app/app.js:1099 / renderSettings|主题/密度/动效/安全等现有设置应统一，不重写存储|待实际Browser/Native验收|
|M22|phone-registry / 手机号登记|resources/app/modules/phone-registry.js:9 / render|独立号码登记库；不自动建 CRM；需导入预览、重复、空态|待实际Browser/Native验收|
|M23|followups / 兼容客户跟进|resources/app/app.js:869 / renderFollowups|实际可达的隐藏route；原客户计划非第二套任务库|待实际Browser/Native验收|
|WS01|overview / WS工作台首页|resources/app/modules/ws-workbench.js:3291 / renderWorkspaceOperationalOverview|已加载范围与未知值明示，不伪造在线状态|待实际Browser/Native验收|
|WS02|accounts / WS账号管理|resources/app/modules/ws-workbench.js:3573 / renderAccountList|真实账号列表/切换入口；隔离fixture不授权平台账号|待实际Browser/Native验收|
|WS03|chat / WS前台聊天|resources/app/modules/ws-workbench.js:3837 / render|仅外壳美化；原生WebView内部不着色、不创建仿制会话|待实际Browser/Native验收|
|WS04|groups / WS群组管理|resources/app/modules/ws-workbench.js:3122 / renderGroupDirectory|原账号目录/筛选/详情；RD02禁止后台路径不恢复|待实际Browser/Native验收|
|WS05|members / WS群成员|resources/app/modules/ws-business-pages.js:118 / renderMembers|账号/群组双scope，不把未知角色说成管理员|待实际Browser/Native验收|
|WS06|collection / WS数据采集|resources/app/modules/ws-workbench.js:3346 / renderCollectionCard|明确FROZEN/后台采集不可用；只读历史，不改能力|待实际Browser/Native验收|
|WS07|contacts / WS通讯录|resources/app/modules/ws-business-pages.js:97 / renderDirectory|仅已保存账号通讯录投影，不是全平台联系人|待实际Browser/Native验收|
|WS08|ai / WS AI助手|resources/app/modules/ws-workbench.js:3626 / renderAnalysis|正式消费者关闭；已有任务/证据/审核，不生成虚假结论|待实际Browser/Native验收|
|WS09|crm / WS CRM客户|resources/app/modules/ws-business-pages.js:132 / renderCustomers|唯一主档+人工字段保护；候选审核仍走原服务|待实际Browser/Native验收|
|WS10|tasks / WS任务中心|resources/app/modules/ws-business-pages.js:140 / renderTasks|真实任务来源、失败和未知，不增加伪操作|待实际Browser/Native验收|
|WS11|logs / WS操作日志|resources/app/modules/ws-business-pages.js:97 / renderDirectory|审计/快照/诊断分别标识且脱敏|待实际Browser/Native验收|
|WS12|settings / WS工具与设置|resources/app/modules/ws-workbench.js:3323 / renderWsWorkspacePage|复用现有翻译/导出/群发/设置；任何禁用能力继续禁用|待实际Browser/Native验收|

## 3. 全局组件、低频入口和原生界面

|编号|组件|真实源码|处理分类|
|---|---|---|---|
|C01|CRM主导航/工作区切换/顶部/底部信息|resources/app/index.html<br>resources/app/modules/workspace-shell.js|需美化，交互尺寸与折叠/滚动保留|
|C02|WS独立导航/顶部/状态|resources/app/modules/ws-workbench.js|需美化，原生宿主边界保护|
|C03|按钮/输入/搜索/分页/批选/标签|resources/app/app.js<br>resources/app/modules/design-system.css|已有共享体系符合；需V4级别/语义色复用，不做第二套控件|
|C04|所有共享Modal、抽屉和原生弹出|resources/app/app.js<br>resources/app/modules/workspace-shell.js|主题/焦点/小窗口滚动需复验；不动确认写入逻辑|
|C05|外观/布局/快捷键/全局搜索/通知/头像|resources/app/app.js<br>resources/app/modules/workspace-shell.js|低频真实入口统一；保留当前偏好和取消恢复|
|C06|客户编辑/跟进/票据/入金/报名/VIP/批量预览|resources/app/app.js<br>resources/app/modules/business-enhancements.js|原有业务表单复用；对比度与危险操作样式覆盖|
|C07|号码导入/数据导入/治理/备份恢复|resources/app/modules/phone-registry.js<br>resources/app/modules/smart-import.js<br>resources/app/modules/customer-governance-ui.js<br>resources/app/modules/v4-data-center.js|低频页/弹窗不可遗漏；本轮不执行导入恢复或删除|
|C08|GPT配置/Provider/Key掩码/计划预览/历史|resources/app/modules/gpt-assistant.js|现有配置通道与脱敏保留；需主页面和弹窗双主题|
|C09|WS辅助翻译/诊断/群发/导出/本地消息|resources/app/modules/ws-workbench.js|可访问辅助组件要覆盖；不启用发送/采集/真实WS|
|C10|AI候选/证据/审核冲突/任务详情|resources/app/modules/ai-review-center-ui.js<br>resources/app/modules/ws-business-pages.js|只读数据/已存在审核交互复用；AI消费者冻结|
|C11|空/加载/错误/未知/禁用/成功/Toast|resources/app/app.js<br>resources/app/modules/ws-workbench.js<br>resources/app/modules/gpt-assistant.js|需不同真实状态截图；未授权不假造成功，未知不等于失败|
|C12|图表/明细/已知来源时间与口径|resources/app/modules/metrics-charts.js<br>resources/app/modules/operations-ui.js<br>resources/app/app.js|已有图表不重写；只改标记/色彩，不新增假图|
|N01|原生启动/加载/连接异常/诊断按钮|desktop/src/Zhike.Desktop/App.xaml<br>desktop/src/Zhike.Desktop/MainWindow.xaml<br>desktop/src/Zhike.Desktop/Views/LegacyUiHostPage.xaml|原生专有，Browser不适用；固定浅色StaticResource可能主题边缘不一致，需要原生观察，不能声明已修复|
|N02|Windows标题栏/最小化/最大化/返回状态|desktop/src/Zhike.Desktop/MainWindow.xaml.cs|已有生命周期逻辑不动；由原生操作验收|
|X01|WhatsApp官方WebView内部/已停用采集层|desktop/src/Zhike.Desktop/Views/LegacyUiHostPage.xaml<br>resources/app/modules/ws-workbench.js|内部视觉不适用/禁止修改；只验证外层不动宿主/不恢复旧采集|

## 4. 已定位弹窗/抽屉入口与相关处理器
完整机器可读清单见JSON的dialogSymbols；包含配置、权限/危险确认、业务编辑、资料抽屉、导入预览和低频帮助。名称扫描只用于定位，具体可达性仍应按实际入口核对。

- resources/app/app.js:328 · workspaceProfileModal · render/entry
- resources/app/app.js:330 · profileAvatarModal · render/entry
- resources/app/app.js:867 · newCustomerModal · render/entry
- resources/app/app.js:891 · vipCustomerModal · render/entry
- resources/app/app.js:893 · hotCustomerModal · render/entry
- resources/app/app.js:1028 · importIssueModal · render/entry
- resources/app/app.js:1067 · clearAllDataModal · render/entry
- resources/app/app.js:1098 · notificationModal · render/entry
- resources/app/app.js:1100 · optionListModal · render/entry
- resources/app/app.js:1105 · securitySettingsModal · render/entry
- resources/app/app.js:1178 · registrationModal · render/entry
- resources/app/app.js:1180 · openModal · render/entry
- resources/app/app.js:1181 · requestText · render/entry
- resources/app/app.js:1184 · globalSearchModal · render/entry
- resources/app/app.js:1185 · customerColumnsModal · render/entry
- resources/app/app.js:1186 · shortcutHelpModal · render/entry
- resources/app/app.js:1187 · closeModal · lifecycle/handler
- resources/app/app.js:1202 · closeCustomerDrawer · lifecycle/handler
- resources/app/app.js:1204 · editCustomerModal · render/entry
- resources/app/app.js:1205 · followModal · render/entry
- resources/app/app.js:1206 · businessModal · render/entry
- resources/app/app.js:1214 · batchModal · render/entry
- resources/app/app.js:1599 · extendedBatchModal · render/entry
- resources/app/modules/workspace-shell.js:57 · appearanceDialog · render/entry
- resources/app/modules/phone-registry.js:14 · newModal · render/entry

## 5. 最小真实截图计划
- **main**：scripts/delivery/s1-main-visual.test.cjs：生产app.js只替换backend bootstrap；目前20页，补followups
- **ws**：tests/helpers/ws-workbench-render-fixture.cjs：真实完整renderer；屏蔽boot/native/network；12页
- **gpt**：scripts/delivery/s1-ws-visual.test.cjs：actual gpt-assistant async renderer + 隔离configured/setup状态
- **helper**：tests/helpers/isolated-edge-runner.cjs：复用原timeout、结果协议、Browser.close与清理检查，不修改
- **plan**：新增scripts/delivery/dynamic-v4-capture.cjs独立命令，不进入自动*.test.cjs全量；35路由双主题，真实popup/drawer/empty/error/compact/small抽检；screenshots BrowserOnly

## 6. 明确保留的未验收/风险
- 本轮未改变数据库/业务规则/Worker/IPC/WebView生命周期
- 截图数据为明确隔离合成夹具；不是平台实时状态或真实业务数据
- 所有源文件来自当前产品renderer；不画fake卡片替代页面
- SourceLocated不等于Passed；实际覆盖由证据和native结果补齐
- 旧全量290/291是历史基线，未拿作本轮结果
- 原生StaticResource背景仍固定浅色，是需要原生复查的视觉边界；不扩大为底层主题架构改造。
- 既有S1 main fixture未包含所有index后挂载增强模块；新harness要明确哪些扩展实际加载，不能把基础render截图称为完整功能验收。
- S3历史Edge偶发退出阻断必须保留；新增截图不得跳过原process cleanup断言。

## 7. 实际常量标题弹窗调用补充

- resources/app/app.js:328 · 工作区资料（调用定位，未据此宣称已截图）
- resources/app/app.js:330 · 本地管理员头像（调用定位，未据此宣称已截图）
- resources/app/app.js:867 · 新增客户（调用定位，未据此宣称已截图）
- resources/app/app.js:891 · 设置 VIP 编号（调用定位，未据此宣称已截图）
- resources/app/app.js:893 · 标记热聊客户（调用定位，未据此宣称已截图）
- resources/app/app.js:1011 · 删除重复值（调用定位，未据此宣称已截图）
- resources/app/app.js:1028 · 复核导入行（调用定位，未据此宣称已截图）
- resources/app/app.js:1072 · 清空本机全库数据（调用定位，未据此宣称已截图）
- resources/app/app.js:1098 · 本地提醒（调用定位，未据此宣称已截图）
- resources/app/app.js:1100 · 管理${item.label}（调用定位，未据此宣称已截图）
- resources/app/app.js:1105 · 安全与备份（调用定位，未据此宣称已截图）
- resources/app/app.js:1178 · 新增报名记录（调用定位，未据此宣称已截图）
- resources/app/app.js:1184 · 全局客户搜索（调用定位，未据此宣称已截图）
- resources/app/app.js:1185 · 客户表格列设置（调用定位，未据此宣称已截图）
- resources/app/app.js:1186 · 快捷键与使用帮助（调用定位，未据此宣称已截图）
- resources/app/app.js:1204 · 编辑客户资料（调用定位，未据此宣称已截图）
- resources/app/app.js:1205 · 登记跟进（调用定位，未据此宣称已截图）
- resources/app/app.js:1217 · 确认${label}（调用定位，未据此宣称已截图）
- resources/app/app.js:1338 · 智能批量导入（调用定位，未据此宣称已截图）
- resources/app/app.js:1599 · 批量${config[0]}（调用定位，未据此宣称已截图）
- resources/app/app.js:1600 · 批量变更预览（调用定位，未据此宣称已截图）
- resources/app/app.js:1737 · 历史日期字段迁移（调用定位，未据此宣称已截图）
- resources/app/modules/workspace-shell.js:62 · 外观偏好（调用定位，未据此宣称已截图）
- resources/app/modules/phone-registry.js:14 · 新增手机号登记（调用定位，未据此宣称已截图）
- resources/app/modules/phone-registry.js:46 · 手机号登记导入预览（调用定位，未据此宣称已截图）
- resources/app/modules/business-enhancements.js:38 · 批量编辑${label}（调用定位，未据此宣称已截图）
- resources/app/modules/business-enhancements.js:65 · 确认批量编辑${label}（调用定位，未据此宣称已截图）
- resources/app/modules/business-enhancements.js:103 · 合并重复客户（调用定位，未据此宣称已截图）
- resources/app/modules/operations-upgrade.js:11 · 本地运营分析（调用定位，未据此宣称已截图）
- resources/app/modules/productivity.js:27 · 批次客户（调用定位，未据此宣称已截图）
- resources/app/modules/productivity.js:52 · 自定义首页（调用定位，未据此宣称已截图）
