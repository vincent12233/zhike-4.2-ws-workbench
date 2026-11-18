# 真实功能与页面清单

基线：`e0426932b9efa77f85e5b7d8ad5d6953024bfc94`；分支 `upgrade/zhike-61-ab-delivery`；日期2026-11-17（Asia/Calcutta）。这是当前源码盘点，不把设计图或历史通过当新增功能证据。生产入口FROZEN。

主导航22项，其中WS入口进入12个独立子页；另有followups兼容route。WS入口不重复解释为额外完整业务页。源码行号以本基线为准。

## 真实导航与渲染控制

`resources/app/index.html:38–64` 有 22 个主导航入口：

- 工作：home、intake、operations、stage-board。
- 客户：customers、segments、hot、groups、vip。
- 业务：tickets、registrations、deposits、analytics。
- 系统：ws-workbench、gpt、automation、quality、data、activity、recycle、settings、phone-registry。

另有兼容 route `followups`（app.js:779；导航名映射到客户中心，不是新增主导航）。

主控制：`app.js:100` navNames，`:314` setView，`:1060–1073` render，`:1524–1730` handleAction，`:1740+` 输入/切页事件。app.js render 对 WS 没有独立 case，WS 模块使用自己的入口/挂载，不可仅改 app.js switch 后误判 WS 已实现。GPT、任务/看板、手机号登记由真实扩展 renderer 接管：

- `operations-ui.js:261–279` → `window.ZhikeOperationsUI.render`。
- `phone-registry.js:9,55` → `window.zhikePhoneRegistry.render`。
- `gpt-assistant.js` → `window.ZhikeGPT.render`。
- `ws-workbench.js` 保留自己的独立导航/Native 生命周期，不属于本次可随意替换的主导航。

不能将几个完整模块改成单个静态卡片。现有用户可见动作不仅来自 app.js，还来自后加载扩展（index.html:138–160）：

- operations-ui/core：任务、看板和 AI 跟进动作。
- productivity：拖动阶段、客户快捷菜单、列宽、首页局部布局、批量快捷功能。
- business-enhancements：业务批量编辑、撤销、客户合并、产品/方向筛选。
- v4-data-center：诊断、迁移/导入报告、档案库钻取、转化过滤、跟进模板、批量记录及报名历史。
- operations-upgrade：本地运营分析、SLA 优先列表、日报、统计/设置增强。
- customer-governance-ui：真正治理 API、审计和二阶段永久删除。
- smart-import：导入识别辅助；runtime-customizer：菜单/标题/主题/动效和设备转移说明。
- accessibility-enhancements、scroll-coordinator、performance-enhancements：真实交互/焦点/滚动/大数据呈现契约。

后续结构化重构必须盘点这些额外事件和挂载条件；不少旧模块通过页面标题文本/DOM selector 判断归属，单改标题可能使功能消失。

## 逐页 renderer / 动作 / 数据与最少验收案例

以下为待执行验收，不是本轮结果；数据使用合成隔离工作区。

| 页面/route | 实际 renderer 与重要 actions | 数据与实际边界 | 至少一个隔离验收案例 |
| --- | --- | --- | --- |
| 今日工作台 home | app.js:473 renderHome；:405 Horizon hero；:417 loadHomeWsFollowups；go-operations/go-customers/home-overdue/home-high-value/retry-home-ai | 主档/任务/票据/报名/入金本地汇总；真实提醒经 __zhikeWsFollowups.load 或 GET /api/ws/followup-alerts?allAccounts=1&limit=5，处理请求序列/离页迟到 | 给一个逾期客户和一个有效 AI 提醒；提醒打开指定 taskId，当前/今日进退分开；切出后迟到响应不覆盖其他页；服务失败显示可重试而非假 0 |
| 快速录入 intake | :765 renderIntake；organize-intake/apply-intake-smart-defaults/quick-intake-file/save-intake/clear-intake；:184 saveIntakeWithSnapshot | 粘贴/CSV/Excel→逐行识别/去重/异常→明确确认→快照→同一客户主档；默认值只填空，10 位规则，VIP 去重 | 混合一条有效、一条已有、一条无效及一条日期资料；仅有效新增，未录入原文保留，快照/写入失败不清空草稿；Ctrl+Enter 不重复建档 |
| 任务中心 operations | operations-ui.js:124 taskPage；:30 newTask；:78 runAiAction；:108 toggleManualTask | settings.operatingTasks，按状态/今日逾期/AI来源/负责人/搜索过滤；AI 与手工不同写服务 | 手工任务完成/恢复持久化；AI 完成必须填写结果并经 followup-action，同步 lastFollow/统计；pendingActions 防重复，409 失败恢复原状态 |
| 阶段看板 stage-board | operations-ui.js:229 boardPage；:244 阶段名单；productivity.js:54–58 stageDrag | 客户 phase 与设置 phases 驱动列；卡片前80条、完整阶段列表入口；拖动写同一主档及 phaseHistory | 将客户拖到已有阶段，重载后仍在新列，ID与其他业务不变；同阶段拖动无额外写，保存失败恢复；键盘可用名单打开档案 |
| 客户中心 customers | app.js:635 renderCustomers、:613 tableBlock；new/edit/follow/new-ticket/new-deposit/batch-* /columns/save-view/export-filtered/export-selected/soft-delete | 全局主客户，同 ID 档案、关联业务/群关系、侧栏360°；默认不显示 deleted | 搜索+渠道+阶段筛选、跨页选中、列设置后导出应核对全部筛选结果而非当前页；手工号码冲突拒绝；编辑后其他工作区同 ID 更新 |
| 分类视图 segments | :628 renderSegments；:527 filteredCustomers；saved-view/go-segments/clear-filters/batch actions | 同一主档的多条件视图，事件日期/具体渠道/页面/助理/状态/阶段/热聊/VIP/跟票/入金/跟进条件 | 保存“今日进群+具体渠道”视图，重新进入/日期切换保持相对日期语义；存量在群不能冒充今日加入；清空筛选不删除资料 |
| 热聊管理 hot | :798 renderHot、:803–804 setCustomerHot；new-hot/follow/remove-hot/export-filtered | customer.hot 布尔+独立业务汇总；全部/今日/超过3天未跟进/未进群/未入金 | 给已有客户标记热聊，不新增主档；登记入金后“未入金”名单移出；取消热聊只改标记、原聊天/业务保留 |
| 群组管理 groups | :888 renderGroups、:856 groupSummaryRows、:838 refreshGroupMembershipEvents；data-group-source/data-search=group/go-segments/export-filtered | 主档/客户关系账本+GET /api/ws/group-membership-events；按具体渠道及群编号分页汇总，不对平台发进退/踢人命令 | 单导和FB群粉同群号、不同来源分别统计；确认 join/left 与当前关系联动且不重复；待审核不算入群；导出与渠道/搜索结果一致 |
| VIP 管理 vip | :797 renderVip、:801–802 设置VIP；new-vip/save-vip/remove-vip/follow/export-filtered | 同一客户 vipNumber，编号唯一；全部/今日新增/待跟进 | 已有客户设唯一VIP号，第二客户重复号被拒；取消VIP保留客户，普通/WS群监测关系不受VIP标记影响 |
| 跟票管理 tickets | :815 renderBusiness；new-ticket/new-customer-ticket/import-tickets/edit-business-record/delete-business-record/export-filtered；business-enhancements.js:32–86 批改/撤销 | state.tickets，独立 buyDate/sellDate/product/direction/status，日期/助理/渠道/产品/方向/文字过滤；ticket-record-core 展开/规范化 | 同客户两股票或不同买卖日期保持两独立记录；批改有预览、完全重复冲突检查与撤销；筛选导出保留买卖日期、方向而非误用登记日 |
| 报名统计 registrations | app.js:1075 renderRegistrations；new/save/delete-registration-record；:1731 export-registrations | state.registrations，只有明确“已报名”计入；按客户去重统计和记录条数分开；来源/负责人/搜索/分页 | 同客户两次报名记录保留、客户数1条/记录数2条；未选已报名不能入账；过滤后导出范围需按第4节缺口确认 |
| 入金管理 deposits | :815 renderBusiness；new-deposit/new-customer-deposit/save-business/edit/delete-business-record；business-enhancements 批改/撤销 | state.deposits，多条入金、金额/币种/日期/状态；关联客户ID，存量汇总与“待确认”区分 | 同客户两个日期/币种两笔均保留；待确认不充当已确认入金；正数/日期校验、删除与撤销后汇总一致，不误合并客户 |
| 统计分析 analytics | :900 renderAnalytics；:514 trend；v4-data-center.js:14 转化；operations-upgrade.js:14；export-filtered | 本地计数、渠道柱/转化漏斗、日期/渠道/页面/助理/评级增强筛选；部分输出是全库报告非当前增强筛选 | 用已知小样本逐项核算进群率/热聊率/入金率，空库不NaN；点击渠道钻取同一名单；区分主报告与增强筛选导出 |
| WS 工作台 ws-workbench | index.html:56；ws-workbench.js 独立工作区/12页/native host | 只记录主系统衔接：原主侧栏与窗口状态恢复，前后台隔离，FROZEN | 进入/返回保留知客主导航及原窗口状态，反复返回不重建聊天Core、不启用正式Worker；详细验收由WS审计补齐 |
| GPT 运营助手 gpt | gpt-assistant.js render/send/settings/applyPlan；app.js:1065转发 | Native AI bridge；当前用户DPAPI唯一Key存储、来源范围选择、管理操作先预览确认/快照/版本；真实模型另验 | 隔离桥接打开设置/快速Provider切换/关闭后迟到返回不污染；管理计划未确认不改主档；配置错误不伪装在线，勿调用真实付费AI |
| 本地自动化 automation | app.js:904 renderAutomation/:902 renderAssistantSuggestions/:903 applyAssistantSuggestions；v4-data-center.js:13 模板；operations-upgrade.js:11 | 本地规则开关/复核、助理历史样本建议、模板、逾期提醒；不是已上线智能agent/后台平台自动操作 | 关闭热聊超时提醒后对应本地提醒消失；有足够样本建议仍需人工确认才改助理；“本地分析”明确不联网不当成模型结论 |
| 数据治理 quality | app.js:919 qualityScan/:953 renderQuality；deduplicate/import issue/historical-date actions；business-enhancements 合并；customer-governance-ui.js:35–95 真服务 | 重复号码/VIP/无效号/导入异常、人工复核标记/撤销、独立CRM审计与两阶段永久删除；不能把仅复核当修复数据 | 标记复核不删除/改号码；修正冲突+合并预览保留独立业务并可撤销；purge申请token换客户ID不能生效，过期/重放拒绝 |
| 数据中心 data | app.js:954 renderData、:1017快照；backup/import-csv/import-backup/export-all/download-template/clear-all；v4-data-center.js:9–14/:20 | 客户主档/全部账号WS业务JSON备份、SHA256、快照、恢复差异、诊断API、档案库摘要；不等于已完成加密.zkdevice/媒体字节迁移 | 修改备份hash必须拒绝；恢复前快照失败则不替换；中途WS账号恢复失败回滚本轮创建账号及数据；诊断失败不展示硬写“正常” |
| 操作记录 activity | app.js:955 renderActivity，:313 activity；export-activity；v4-data-center.js:15 批量记录 | 近30条state.activities展示、全量本地activity导出；批量操作另表，本地记录不是覆盖所有Worker/CRM/平台的统一审计 | 发生一次合成修改仅出现一条可定位记录；搜索只当前30条应标明范围；导出内容/时间及审计来源不能虚构，原生/CRM审计不应误标本机UI |
| 回收站 recycle | app.js:956 renderRecycle；restore-customer→:1507；empty-recycle→:957–974 | deleted主档、恢复唯一号码/VIP检查；旧清空路径只显式过滤客户和四类关联数组，需见风险 | 软删后全局统计排除；恢复与现有号码或VIP冲突拒绝；永久清空后检查任务/WS/群关系是否有孤儿，快照回滚可恢复，见P0审查项 |
| 系统设置 settings | app.js:1009 renderSettings、:1010–1019选项安全；appearance save :1710；runtime-customizer.js:17/34/54 | 渠道/群粉来源/页面/助理/群号/状态/阶段、快照保留/清空密码、主题密度、菜单文案、头像和动效；不是企业RBAC | 重命名渠道同时更新引用、保存视图/别名；禁用值不能被旧默认重新补回；更换主题后导航/表格/弹窗皆可读，开启系统减弱动画生效 |
| 手机号登记 phone-registry | phone-registry.js:9 render/:13 mutate/:15 saveNew/:47–51 import/export/actions | 独立phoneRegistry；手机位置/编号/号码/角色/接码渠道，可新增、内联改、批量/去重、Excel预览及分页 | 导入含新增/更新/重复/异常文件，预览一致；确认只改registry不建客户；清空仅本模块；写失败恢复原值及选择，CSV转义安全 |
| 兼容跟进页 followups（隐藏route） | app.js:779 renderFollowups；:1135 exportFollowups；go-followups通常转客户中心 | 客户/跟进摘要兼容入口，无新主导航 | 旧快捷入口可达有效客户范围而非空白；导航名称、逾期范围及导出跟进记录一致，不产生第二套任务 |

## 十二页实际入口、数据、按钮与最少验收 case

页面集合来自 `resources/app/modules/ws-workbench.js:16–30`，实际独立侧栏 `:3020–3024`；统一页面标题/刷新 `:3134–3138`；路由点击委托 `:5466–5484`；页面刷新状态机 `:3152–3228`。页面对象按账号、页面分开，不能把导航存在当业务完整或平台可用。

| 页面 / case | 实际内容与入口 | 真实服务 / 边界 | S0 最少操作与证据（均 NotTested） |
|---|---|---|---|
| WS01 工作台首页 | `ws-workbench.js:3269`，进入聊天、十个功能入口、CRM 审核入口；`:3230–3238` 概况 | `refreshWorkspacePage:3191–3213` 查询 collection-runs / followup-alerts / ai-jobs；`summaryLoaded` 区分未读取和零值。账号/会话/群数量为本机已加载范围 | 进入→刷新→进入 CRM 再返回。核对未读服务时显示“—/未提供”，读取失败不得变为零或“正常”；截图+workspace-page enter/exit，确认没有产生采集/AI执行任务 |
| WS02 账号管理 | `:3270` 账号列表、添加表单、搜索/分页、切号；`renderAccountList:3510`；创建 `:561`，切换 `:602`，清投影 `:653` | `loadAccounts:412` native ws.accounts/list；创建优先 native 索引/sidecar 回退；`server.mjs:2614` 账号 API。前台账号 Core 池不是每次切换重建 | 仅隔离账号 A/B 反复切十次；验证列表、群成员、摘要、CRM详情归属，故障/迟到响应不恢复旧资料；记录 ws-account-selected、每账号 Core 数与导航数。添加只能向本次合成索引写入，不能授权真实账号 |
| WS03 前台聊天 | 独立真实 `#wsBrowserHost`，`:3830–3865` 标题/账号/连接工具、CRM收放；`toggle-right:5145`；本地工具折叠 | `wsBridge:1284` → `LegacyUiHostPage.xaml.cs:1358+`；native 保留 WebView2。隔离编译的 `WsRuntimeService.cs:76–82` 只 about:blank，不是假聊天界面 | 进入聊天→收/展 CRM→十二页往返→回聊天；真实 Core 不增加、bounds正确、原生可见/隐藏正确，窗口不周期抖动。隔离空白 Core 不能验证 WhatsApp 输入、收发、真实登录或翻译 |
| WS04 群组管理 | `renderGroupDirectory:3061–3068` 账号/成员数/发言权限/采集状态筛选、40条分页、复选、可关详情；批量仅查看/复制JID/清选择 `:5102–5124` | `loadGroupMonitor:1509–1542` 读取 `/api/ws/accounts/:id/groups`、profiles/detail/events；`server.mjs:2669` 群目录、`:2691` 监测。权限缺失明确“未提供”。添加监测目标不是进群；停监测不是退群 | A/B同JID不同名称；搜索/筛选/翻页/多选并复制JID；打开/收详情时表格扩宽、滚轮主区不误动侧栏。截图+scope API日志；不进行平台群操作 |
| WS05 群成员管理 | `renderWorkspaceMembers:3240`，成员搜索、状态/所属群过滤、角色、详情、已加载进退事件；`ws-business-pages.js:115–122` | `loadGroupMembers:3139` → `/api/ws/group-manager/members?limit=1000`；`server.mjs:2856+` 仅隔离Mock群服务。按 accountId+groupJid+memberJid，不按姓名合并；生产返回 GROUP_MANAGER_DISABLED 是有意边界 | 同成员在两个群分别两行，切 B 不显示 A；未知role显示未提供，不能当管理员。记录角色/群/成员详情截图、disabled与错误状态。Mock成员不证明实际平台成员同步 |
| WS06 数据采集 | `:3273`、`renderCollectionCard:3285` 显示run/统计/失败/checkpoint、创建/继续/暂停/停止/补采、任务历史；`:5086` 历史入口 | `server.mjs:4522/4542` run/item；页刷新读取最多1000项。`createCollectionRun:2791` 会POST，已连接时继续native collect-all-read；这不是纯只读按钮。旧JS/native采集与新Worker是不同执行路径 | 在本次临时库查看合成运行/项目/历史、错误/checkpoint；离页返回保留服务状态。未授权真实采集时不以该按钮启动真实WS。检查“列表发现”和完整双向历史计数不混用；截图+临时run只读回读 |
| WS07 通讯录 | `renderWorkspaceReadDirectory:3259`、`ws-business-pages.js:25–109`，账号/搜索/规范号/重复/来源/详情/40分页 | GET `/api/ws/workspace/contacts`，`server.mjs:2601`；`ws-workspace-query.cjs` 只投影本机direct会话，不是完整平台通讯录，不导入、不自动创建CRM。响应根及每行scope严格验证，requestSerial挡迟到结果 | 合成49行：Enter搜索→详情收放→重置→2/2页9行→切号；@lid号码未提供不标“确认唯一”；核对联系人/CRM总数不增加。保存截图及只读回读 |
| WS08 AI助手 | `:3275` 摘要/原分析；`ai-review-center-ui.js:9–49` 任务/候选/分页/详情/错误，`:56–85` 重试/取消等原服务入口 | `/api/ws/ai-pipeline/jobs/suggestions`；`server.mjs:1973–1989` 隔离Guard+fenced writer，`:3694+` 任务路由。没有 lease 时写控件禁用；生产消费者关闭。原 GPT Provider 是另一接口，不能视为新队列已接通真实AI | 临时Mock数据列表→详情证据→筛选/页码→取消/重试（仅有本轮隔离lease且获准）；任务页切换不取消后台实体。记录真实服务状态，不能把合成结果作AI质量验收 |
| WS09 CRM客户 | `:3247–3252/3276` 当前账号已明确关联主档列表/详情与旧档案区；`ws-business-pages.js:124–135` 明确customerId关联 | 客户唯一主档来自 host.state.customers；会话scope必须明确；`loadDataArchive:3389` `/api/data-archive/customer`，`loadHotProfile:3360` diagnostics GET；原审核接口仍经CRM权威/state version/fencing | 查唯一匹配、未知客户不建档、缺scope不猜关联；批准空字段/拒绝候选/人工值冲突保留（仅临时合成库）。截图+审核后原主档与ai_task_audit回读；跨账号候选不变 |
| WS10 任务中心 | `renderWorkspaceTaskPage:3254`、`:3277` 跟进任务筛选/详情、采集摘要、打开知客任务中心 | `/api/ws/followup-alerts?limit=8`、collection-runs、ai-jobs 是已加载窗口，不能称全部任务。原任务服务操作继续复用，未知摘要显示“—” | 任务筛选→详情→打开知客任务中心→返回WS；核对任务/客户链接、未知不显示假0、窗口还原及原Core保留，截图与scope证据 |
| WS11 操作日志 | `:3278`、`ws-business-pages.js:66–109` 账号/时间/来源/类型/结果/任务/对象、搜索、40分页、详情 | GET `/api/ws/workspace/audit`，正式审计3源与运行快照3源分开；diagnostic明确未接入。scope每源过滤，SQL脱敏后检索，不读取磁盘私密日志，不新建第二审计 | 查询正式审计→明细→snapshot→diagnostic未提供→切账号；时间/类型无效值和错误可见；不能把快照重标审计。截图+HTTP回读，敏感字段不入图/报告 |
| WS12 工具与设置 | `:3279–3281` 翻译、群监测、导入/导出、群发、会话清除、GPT设置、运行诊断 | `:3185` GET settings；保存 `saveSettings:4009+` 为账号+会话级，未选会话直接返回；GPT仍原加密服务。`focus-assist:5153` 实际先回chat，再打开小辅助栏（尚非所有工具完整独立页） | 打开GPT设置但不填真实Key/不联网测试→Escape关闭→焦点恢复且WS路由不变；翻译/监测入口核对跳转行为；导出/群发仅核已有真实入口，不点清会话等破坏性动作。记录未选会话反馈及嵌套滚动 |

上述不少渲染函数是长模板单行，应按函数名+起始行定位，不把一条长行的视觉片段误当独立组件。新工作应提取明确职责，不再堆进同一长模板。

## 包、运行时、版本与签名

### 当前已有基础

- 一套正式框架：WinUI 3 unpackaged + WebView2 + 随包 Node SQLite sidecar；不建议替换框架或新建平行客户端。
- `resources/app/package.json`：版本 6.0.3，Node engines >=24，元数据 Node 24.22.1；无 npm runtime dependencies。仅元数据读取了 `resources/app/node.exe` 的 FileVersion/ProductVersion，均为 24.22.1，未运行该 exe。
- `.csproj`：.NET 10、Windows App SDK 2.6.4、WebView2 NuGet 1.0.3719.77；WindowsAppSDKSelfContained=true，架构发布脚本固定 x64；bundle 默认 .NET/Windows App SDK 自包含（`build-winui-bundle.ps1:141–162`）。目标机不应依赖 Visual Studio/Node SDK，构建机需要的 .NET SDK/Inno/Windows SDK 不应混写为终端使用条件。
- Installer 默认当前用户安装 `%LOCALAPPDATA%\Programs\ZhikeNative`、PrivilegesRequired=lowest（`.iss:20–22`），数据在独立 `%LOCALAPPDATA%\Zhike6`；正常卸载不删除数据根，这是数据保护基础。
- bundle manifest 校验版本/源 commit/dirty 状态/文件哈希；installer 对 staged 文件集合逐项校验。版本统一门禁可以复用，不能因此称目标功能或干净机已通过。

### 当前版本事实与剩余差距

- package/csproj/server、打包默认参数、版本图标和部署文档仍为 **6.0.3**。6.1 是开发目标，不是已存在正式安装包；本轮不做版本号伪升级。
- `releases/release-output-manifest.json` 只有历史 `知客-6.0.3-WinUI桌面版.exe`：114131976 bytes。本轮只读 Get-FileHash/文件长度核对与清单一致；Authenticode 公共元数据结果 **NotSigned**。没有读取证书或签名私钥。
- 签名脚本提供证书/时间戳/verify，但仅当环境要求时强制；`-AllowUnsigned` 可绕过 signingRequired。必须明确最终分发的签名策略和用户提示，不能称现产物已签名。签名不会代替哈希或功能验收。
- ReleaseGate 当前主要检查提交干净及一致性后按 switch 写 `releaseGate='passed'`（bundle `:129–131,225`），未自动消费全量回归、安装/干净机验收证明；发布总 Gate 必须继续由真实验收证据控制。
- 未发现依赖锁定文件/SDK global.json；NuGet 版本固定，但 bundle restore 明确 `RestoreLockedMode=false`（`:139`）。依赖闭包、许可证/SBOM、Node/Microsoft 运行时来源与可再分发清单仍需正式发布核实。
- 正式 App 当前主动构造 disabled Supervisor 且未配置生产 WorkerExecutablePath（`App.xaml.cs:36–41`；Supervisor `:92–106`）。这是 FROZEN 的有意边界；不能据“IPC测试通过”宣称正式 Worker 已随安装包可启用，亦不得本轮解除它。
- Installer 会先卸载旧 Electron 入口、InstallDelete 替换旧应用文件；未看到安装事务失败后的旧程序 payload 自动恢复和用户数据清理选项。须做升级失败/重复安装/卸载数据保留真实演练。此处不能以旧安装日志替代当前源码包验收。

原始业务接口、事件扩展及平台未验证范围均须保留，不因重构标题或DOM丢失增强功能。每页完整操作验收在acceptance-matrix中登记，S0并未逐页宣布通过。
