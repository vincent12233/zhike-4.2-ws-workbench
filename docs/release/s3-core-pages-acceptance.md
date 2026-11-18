# S3 核心主工作区验收报告

日期：2026-11-17（Asia/Calcutta）。分支 `upgrade/zhike-61-ab-delivery`，开发起点 `8de6078a6d5640bbd0d60eb207d4e6b16a7c164c`（S2报告），S2代码 `f55873b002d8c980a16d6e53d667d73332bb3d73`。S3独立代码提交：`eee5ac9da0fc69a4742bbdeb307782b3480eab94`（当前HEAD）；RD02独立提交：`c970d400df1c885398eb5caf79cfc425da309150`。报告提交为**包含本文的独立报告提交，git log可查**，不填写自引用hash。检查时仅此轮release报告仍有未提交修改，不能提前称工作区干净。

**当前 S3 Gate：Blocked。2026-11-17 Dynamic Workspace V4 视觉代码已提交 `63bea50`；本轮最终回归 289/291（2 Failed），最终全量中的 WS 子集 160/160，Release 0 warnings / 0 errors。两项隔离 Edge 生命周期超时、完整原生页面/滚轮/切号/动效矩阵等仍未关闭。生产入口 FROZEN；后续阶段和发布不放行。** 详见[本轮 V4 实施与验收](dynamic-workspace-v4-acceptance.md)及[35页覆盖清单](dynamic-workspace-v4-coverage.md)。此前290/291及两图原生补验保留在[上一轮补验报告](horizon-pro-acceptance-followup-2026-11-17.md)，不是本轮结果；下文继续保留早前 S3 冻结记录，不改写历史。

本文记录本轮真实执行的源码修改、测试、原生操作及限制。Passed只适用于明确列出的范围；旧结果、单跑结果及Mock不能替代最终完整回归或原生验收。

## 实际范围及保留权威

本阶段完善首页、客户中心、原跟进兼容route、任务中心和阶段看板，继续使用原客户ID、state/version/snapshot/persist/flush、任务服务和已配置阶段枚举。没有第二客户主档、任务状态库、迁移、Worker或消费者，不改已有业务统计公式。主侧栏、S1双工作台和WS独立导航保留；S2只读指标投影与图形模块复用，不新增指标轮询或伪造AI结论。

RD02是用户单独批准的安全变更，与S3视觉分别提交，见 [RD02决定](decisions/RD02-authenticated-profile-boundary.md) 和 [RD02验收草案](rd02-authenticated-profile-acceptance.md)。禁止profile复制、隐藏collector和前台采集回退；这不是本阶段开发了安全后台平台替代能力。

## 实际修改与红绿证据

### 首页与客户列表优先布局

- `app.js`及原`home-6.css`：读取来源/保存状态/实际最后读取时间置于首页hero前；趋势区更宽，活动空态和健康面板按内容自然高度，不用占位大块拉齐。正常已读取的KPI不重复“本机业务数据”，异常/未读取仍明确，不把未知当0。原提醒来源与原业务入口保持。
- 客户7项原指标保留在默认关闭的原生`details.customer-business-overview`，summary显示真实全局/今日/逾期计数；展开状态只为临时UI记忆。高级筛选默认收起，原44px按钮、当前生效条件和真实筛选/导出谓词保留，收起不会清除有效筛选。
- 客户预览可真实收起释放主列宽；恢复仍使用原selected customer ID。关闭时只保留空hidden aria-controls目标，没有隐藏客户资料副本。表格说明跨页选中、当前筛选全集与导出范围；没有改选择或导出服务。
- 1280×800且存在重点关注客户时，标题和4按钮的首选宽度985.44px超过可用949px，整组按钮落下一行，表格首行被页面底栏遮挡。保留该真实非空seed及全部原断言，仅在原heading owner对客户页>=1100px设置标题区`flex:1 1 0/min-width:0`，副标题自然换行。实测标题高162.55→123.30px，4按钮仍16px/44px、全部可见，首行中心790.23→750.98并实际hit-test到客户行。窄屏仍允许原换行/滚动，不缩字或隐藏操作。

### 客户档案身份与原组件样式

- `app.js`的真实`showCustomer`显式设置drawer customerId，发出真实生命周期事件；`v4-data-center.js`的报名历史增强按稳定ID关联，不按h2显示姓名猜客户。首次懒创建、同ID重绘、同名A/B、关闭、移除/替换节点、晚响应及失效事件payload均有实际运行时反例/回归。
- 真实Native发现表头与冻结列z层级冲突、半透明偶数行重复叠色及搜索双focus ring。全生产CSS与实际enhancer的Edge红用例定位原owner后，只将客户TH z1→4（冻结body为3）、原stripe改为opaque DS surface、组合搜索保留一个外层3px focus ring。没有关闭sticky、改滚动所有权或取消键盘焦点。
- 完整body sibling drawer不在viewContainer文字作用域，残留8–12px标签、旧深色head/footer。原drawer组件统一DS、14–24px文字和44px操作。open的identity transform形成fixed footer containing block，滚动把y737 footer带至-188；原open transform改none后，footer精确贴同520px drawer左右而非铺满viewport。底部留白覆盖实际GPT＋4业务操作，末条条件内容能滚到footer上方。
- 夜色真实红发现旧浅底标签对比1.89/1.01；原drawer owner按DS语义设置标签底/字色。合成note/hot/VIP/两条既有群关系/四类本地历史均实际渲染，不创建任何客户或WS事件。

### 首页计划→跟进→主档闭环

- `go-followups`原先进入未设置到期范围的客户中心，并继承旧渠道/搜索，首页13位到期客户却显示15位。现复用既有`followups/open`route与原日期谓词，清理页面状态但不删除客户筛选偏好；不新建任务中心。
- 计划客户和已登记跟进记录分开标注，原nextDate列更正为“下次跟进”；日期验证与导出同口径，未来/无效/空/未安排不误算到期，完成历史不因计划日期异常被删除。
- 原简单表曾限制前100位；已有跟进route复用原分页和每页设置，合成263位到期客户全部可达，页码/页签/恢复边界正确，导出仍为全量筛选集合，VIP/热聊的原单独scope不被修改。
- 数值ID导出最初反例使用普通Set，漏掉产品真实SelectionSet的标准化，不能证明产品缺陷；已明确撤回该误报并保留原失败日志。回归执行原SelectionSet源码，不为夹具错误修改产品选择规则。

### 任务与阶段原操作

- 人工任务仍写`settings.operatingTasks`；AI完成/延期/忽略沿原`followupAction`服务、身份和失败恢复。人工来源显示人工任务，不冒充“AI建议”；due展示为截止时间，不推测最佳联系窗口。没有真实AI调用或正式消费者。
- 阶段目标取既有`data-stage-name`，不从装饰标题strong取值；同有效阶段、未知阶段、外部/删除客户不写。阶段分布空/零计数画真实0，不再用最低4%制造正长度。
- 真实延迟snapshot反例表明两个客户并发时，共享activities失败回滚会覆盖另一成功操作的日志；原modify事务保持，阶段移动采用一个UI单飞边界和明确等待反馈，finally释放，不建立新队列或跨模块全局事务。
- 原生阶段和首页原HTML drag均有真实失败，曾做一次`AllowDrop=true`单变量试验仍失败，不能称其为解决方案或确定WebView/SDK缺陷。最终用同一文档内pointer生命周期、两个小adapter复用既有操作：阶段仍沿modify/snapshot/persist/flush，首页仍只在原home-main/home-bottom内部排序并保存本机layout key，不碰新dashboard或业务状态。6有效像素后捕获，阶段实际位置命中当前board的canonical column，松手及snapshot await后再次校验客户、阶段、DOM/route和目标归属；取消/失焦/Escape/切页清理，迟到up不提交。
- 只抑制一次拖动后浏览器点击，后续正常点击与键盘激活保留；不添加ghost或原生overlay、无动画循环。阶段卡不挪DOM，首页仅在有效释放时执行原本的DOM顺序提交。源句柄虚/点线、有效目标实线DS内描边，无拖动过程布局位移、缩字或透明度损失。共享pointer已有47例（阶段39＋首页8），之后新增4项只读图表边界后总计 **51/51**。PID28884已实际完成共享控制器阶段正反、首页重排及Ctrl+R保留，不把VM事件当该原生证据的来源。
- 两项只读图表复用原`metrics-charts.js`：任务完成率按原completed/open判定，全局分母open＋completed、dismissed明确排除、零分母不伪造0%；阶段近7日只统计现有有效客户中时间、来源/目标可验证的phaseHistory条目，明示是已记录条数、不是去重人数或完整历史。没有记录时为空，不从当前阶段倒推历史。它们没有业务写入；新增4项实际运行时测试通过，但这两图的原生显示/明细交互仍 **NotTested**。

## 已执行测试与编译

|命令/来源|实际结果|范围与证据|
|---|---|---|
|`node scripts/run-tests.cjs delivery-s3`|**5/5检查 Passed**|`.tools/delivery-s3-final-special.log`，本轮执行，不是历史基线|
|`node scripts/stage51/native-prepare-preflight.test.cjs`|7/7 Passed|精确XBF路径、错误拼名、缺失/空/目录资源、失败只读、复制/分配临时根前门禁|
|`node tests/delivery-s3-customer-identity.test.cjs`|14/14 Passed|真实增强层/实际ID/迟到结果；合成读取边界，不冒充浏览器或DB|
|`node tests/delivery-s3-core-pages.test.cjs`|Passed|真实过滤/导出/SelectionSet、列表优先折叠、首页13位精确钻取、有效日期和263位分页/全集导出；见5项runner输出，不编造额外汇总case数|
|`node tests/delivery-s3-operations-runtime.test.cjs`|**最新51/51 Passed（原47＋4只读图表边界）**|`.tools/delivery-s3/operations-metrics-after.log`；原47项完整保留，新增任务分母/过滤scope及阶段已记录历史/无效/空态；不冒充原生图表验收|
|`node scripts/delivery/s3-customer-table-visual.test.cjs`|**10/10 case Passed（9生产＋1诊断）**|原index全CSS顺序＋实际renderer/enhancer；1280/1920×昼夜×legacy主题冲突，另1536有效视口。非空/favorite种子全保留；font>=14、最低对比4.74/6.98、44px操作、footer/末内容、原跟进modal、TH/焦点/stripe通过；不等于原生DPI|
|前轮`node scripts/run-tests.cjs ws`|**160/160 Passed（历史检查点）**|`.tools/delivery-rd02-s3-ws-final.log`；含RD02真实模块边界，不能拿其代替全量|
|正式Release x64/win-x64|最新0 warnings / 0 errors，26.06秒|`.tools/delivery-s3-rd02-release-post-native-fixes.log`；先前36.31及32.52秒编译留存，最新仅表示编译，不代替交互|
|最终隔离Release构建|0 warnings / 0 errors，26.80秒|`.tools/delivery-s3-final-native-build.log`；启动不等于交互通过|
|首次`all`完整回归|**285/290，5 Failed**|`.tools/delivery-s3-rd02-full-final.log`；失败不删除或重标Passed，见后文归因|
|前一冻结点`all`完整回归|290/290 Passed（历史检查点）|`.tools/delivery-s3-rd02-full-rerun.log`；不是后续原生发现修复后的最终源结果|
|前轮原生修复后`all`完整回归|289/290，1 Failed|`.tools/delivery-s3-rd02-full-post-native-fixes.log`；唯一WS local ingest runtime启动未完成，根因未确定；后续冻结运行见下一行|
|最终冻结`all`完整回归|**286/291，5 Failed，exit 1**|`evidence/s3/full-regression.log`；S2基线283项后新增RD02两项、S3五项及observer一项；未删除检查。该次实际runWs段为155/160，5项失败均在此段；不能用历史160/160代替|

5项runner检查、各模块case数量与WS160项不是可直接相加的独立测试总数。保留原Failed日志（阶段命名/并发、drawer ID、计划scope/日期/分页、原生drag、表格/抽屉/标题），没有删除旧测试追绿。

首次全量5项失败中，4项为原contract/夹具与已批准的新实现不一致，逐项最小适配后实际单跑通过：Horizon数据化布局、WS运行恢复、资源生命周期及stage5页面夹具（日志`delivery-s3-horizon-layout-adapted.log`、`...-runtime-resilience-adapted.log`、`...-resource-lifecycle-adapted.log`、`...-workspace-pages-fixture-adapted.log`）。没有据单跑直接宣称全量通过。

另1项是真实RD02聊天布局回归：重复blocked banner多占65.59px，不能改188px host基线掩盖。总控把完整原因保留在状态chip的title/aria及相关页说明，取消聊天重复banner；原188px及聊天面积断言保持。实际S1 WS computed 7组尺寸/主题通过，`.tools/delivery-rd02-compact-layout-final.log`，能力专项再次19/19，`...-compact-status-final.log`。这仍不是最终全量或真实WhatsApp收发验收。

原生新发现展开首页运营概览仍继承旧深色渐变/无限动画。仅在原`home-6.css`详情组件owner设置DS surface/text并去该局部旧装饰，不动四项值公式/grid或其它组件；既有全CSS10case加入真实renderHome并打开原details，四标签/值节点保留，最低字号15、对比日4.74/夜6.98、无渐变/无限动画/文档溢出，原客户所有断言同时Passed。红绿日志`delivery-s3-home-reference-red.log`/`...-green.log`保留；此浏览器通过不冒充最终Native截图。

随后真实客户跟进页的统计卡被原business6含ID的`!important`深渐变/形状覆盖DS，页签也保留暗透明/浅金文字。仅将followups从3组旧装饰paint selector移除、复用现有DS KPI，页签原owner使用仅followups生效的DS变量，hot等页不变。全CSS10case扩展真实followups renderer，四统计及六页签原值/动作保留；页签16px/44px，统计对比日5.28/夜8.09、页签最低4.84，无渐变/文档溢出，原客户和首页断言同时通过，见`delivery-s3-followups-visual-{red,green}.log`。PID19588随后实际观察新配色统计26/13/13/13及从WS返回followups，已获有限Native通过。

前一full唯一失败发生于原WS本地ingest测试首次health readiness，原日志忽略child stderr/exit，没有证据区分退出、端口冲突或启动延迟。原样用默认/打包Node的两次单跑均通过，之后总控仅在测试设施增加有界stderr脱敏、child error/exit观测，保留原46321端口和300×50ms预算、原全部业务断言，不做自动全项重试。observer用实际隔离子进程6/6通过且无残留；打包Node原ingest连续5/5，整项进程耗时1194/1105/1126/1217/1164ms，不是sidecar-only启动时间。日志`delivery-s3-ingest-observer-{red,green}.log`、`...-ingest-startup-review.md`、`...-ingest-bundled-repeats.json`和5条原始log均保留。这补足可观测性，不证明历史启动根因已定位或修复，也不能替代新冻结全量；本草案不执行或预先放行该轮。

## 已发生的原生操作和最终配置限制

只在stage51隔离宿主和明确合成临时根执行，52位客户、3报名、1跟票、1入金；不访问正式知客数据。此处复核总控实际截图及只读验证JSON，不把设计图当产品截图。

|实际操作|已观察/回读|证据与状态|
|---|---|---|
|首页与客户列表/同名筛选|实际进入首页、客户页，发现后修复压缩首屏和样式遗漏；同名客户使用稳定ID|`native-home.jpg`、`native-customer-before-compact.jpg`、`native-customer-overlap-observed.jpg`、`native-same-name-filter.jpg`；最终默认配置复验仍待补|
|真实完整档案与跟进表单|旧drawer不合主题/小字已原生观察，修复后真实截图；登记一次合成跟进|`native-drawer-legacy-style.jpg`、`native-drawer-refined.jpg`、`native-follow-form.jpg`；`native-follow-verification.json`确认C-native仅1条marker，lastFollow=11-17、due=11-24、人工字段及其它客户保留|
|手工任务完成与恢复|真实点击完成后done=true/status=done，再恢复done=false/status=open；跟进及独立记录不丢|`native-tasks-before.jpg`、`native-tasks-completed.jpg`、`native-tasks-restored-source.jpg`及两份task验证JSON；Passed于该次观察，不外推AI任务实网|
|阶段卡原生移动与恢复|首次pointer移列后，重启默认AllowDrop=false宿主PID18712，实际反向拖回成功；两个阶段历史条目均保留|`native-pointer-stage-moved.jpg`、`native-pointer-stage-restored-final.jpg`及`native-stage-{moved,restored}-verification.json`：ISOLATED_S3_001新客户→潜在客户→新客户，52位客户、其它阶段/ID、人工字段、跟进和独立业务均完整，当前阶段原生操作Passed于该已观察范围|
|最终共享47控制器与首页CTA|PID28884实际阶段正反、首页原eligible分组重排、Ctrl+R后顺序保留；CTA进入26位客户计划followups|`native-shared47-{stage-moved,stage-restored,home-reordered,home-persisted}.jpg`、`native-followups-26-source.jpg`；原生Passed于上述具体动作，不能据此说新增两图已验收|
|最终跟进配色与WS返回route|PID19588实际显示跟进统计26/13/13/13，返回WS后再返回原followups正确|`native-followups-palette-final.jpg`、`native-followups-ws-return-final.jpg`；不冒充WhatsApp实网聊天|
|两项新增只读图表原生交互|NotTested|操作工具报unknown screenshotId，后续captureoutside；没有完成两图点击/明细的原生操作，不以运行时51/51或截图设计替代|
|RD02前台切号与Core|PID3532初始2条A选择后十次A/B交替，3个Core各1，collectorDirs为空；CRM面板及返回主工作区实际观察|`native-rd02-*` JSON/JPG，21/21准确身份正常退出无强杀；about:blank不等于WS登录/收发|

上述PID3532构建包含未解决HTML drag问题的单变量`AllowDrop=true`试验；源码已恢复默认false，RD02/WS源码未变。PID18712反向阶段及15/15正常释放之后，PID28884已完成最终共享pointer/首页/CTA，`native-recheck-process-release.json`记录15/15准确身份正常释放。PID19588由用户正常关闭，`native-final2-process-release.json`仅验证已记录root/sidecar/Core三个PID无活体、usedForce=false；工具异常前未采完整树，**不能写成完整进程树全部释放**。未完成两图原生验收的事实与此关闭限制继续保留。

## 测试构建输出失败的已证实原因与边界

本轮一次**隔离测试构建**的OutputPath末尾缺少目录分隔符，实际文件变成`stage51-native-v2App.xbf`、`stage51-native-v2MainWindow.xbf`，标准`App.xbf`等缺失，见`native-output-path-failure.json`。

只读核对本机NuGet的`Microsoft.WindowsAppSDK.WinUI/2.6.4/build/Microsoft.UI.Xaml.Markup.Compiler.interop.targets`：908–909将`$(OutputPath)`与Link/项目相对路径直接拼接；918–919将后缀换为xbf；`CopyGeneratedXaml`在950–954将生成文件复制至这些目标。该链与错误拼名一致；显式`-p:OutputPath=../../../.tools/stage51-native-v2/`后的实际隔离构建0/0并具备正确资源。新增prepare preflight在复制资源/创建或复用验收根之前验证三个精确非空regular XBF，不修补成假的空文件。

这是本轮调用参数/资源准备的可复现原因，不宣称SDK存在bug，也不把它解释成阶段5历史首轮WS服务启动失败的根因。旧桥接超时、WS服务启动延迟、WMI延迟没有新根因证据，继续保留未知风险。preflight最初“模块导入即执行”红用例及修复后的7/7也分别留存。

## 性能、保护与尚需完成

原生PID3532关闭前仅1次资源快照（680.6ms）：进程树工作集1,659,871,232 bytes、Private850,997,248 bytes、481线程、18个WebView子进程/21个观察身份。没有持续增长数据和正式阈值，不能判断泄漏或宣称性能Passed；3个Core与18个WebView子进程不是18个聊天实例。S2大库冷计算及S7多DPI/长时预算继续保留，不因布局紧凑声称“全项目不卡顿”。

PID18712关闭前另1次快照（631.2ms）：工作集1,239,396,352 bytes、Private656,334,848 bytes、329线程、12个WebView子进程/15个观察身份，见`native-final-resource-before-close.json`。两批进程树/操作负载不同，不据此计算内存优化百分比；单次快照仍无长期性能Gate推论。

生产SQLite、真实WS/profile/密钥未读取或修改，无正式Worker/AI/双写、无迁移/checksum变化。证据仅合成截图、计数与日志；归档白名单、SHA-256、当前临时根处理和最终Git状态由总控补齐，不提交连接私有文件、浏览器profile或数据库。

剩余准入：

1. 两项新增只读图表原生交互仍NotTested，需要可操作窗口完成并保存真实证据；其它已完成的阶段/首页/CTA和返回route不重复标未测。
2. PID28884准确15/15已释放；PID19588仅3个已记录PID无活体，缺完整树观察须如实保留并由总控按既定门禁处理，临时根按现有S0诊断保留规则留存，不删除用户或测试数据。
3. 最终全量286/291的5项失败必须完成诊断、必要修复及整套重跑。原API场景再次Failed；其它4项原样单跑Passed。临时加观测的API六次Passed仍未捕获失败根因，不能声称修复。Release最新26.06秒0/0不替代该阻断。
4. 首张`native-home-reorder-no-handle.jpg`位于不属于原重排范围的新dashboard，不能作为原功能缺陷；真正eligible HTML drag失败图保留，新的共享pointer已在PID28884原生重排并重启保留，现该项Passed于既定分组范围。
5. 核心范围以外的全业务、WS十二页、多DPI、长时/大库和干净设备发布验收继续按S4–S8推进，不由本草案提前放行。

可在隔离分支按独立S3代码提交回滚主界面/原业务接线，不需要数据库回滚；RD02禁止认证复制的批准边界不能因回滚重新启用。当前总Gate **Blocked**；完成上述本阶段必需项后由总控更新实际证据、结论及commit。生产入口始终 **FROZEN**，S8不允许启动。

## 最终失败、证据归档与工作区

最终命令 `node scripts/run-tests.cjs all`：291项中286 Passed、5 Failed，exit 1；原始失败完整保存在 [full-regression.log](evidence/s3/full-regression.log)。五项为：

1. `tests/ws-workbench-api.test.cjs`：首次请求启动等待失败，原样单跑仍Failed。
2. `tests/ws-export-media-schema.test.cjs`：finally内“ws_media_assets must exist”；原样单跑Passed。该finally可在前序失败后创建空库并覆盖原异常，不能据此断言产品迁移已损坏。
3. `tests/ws-broadcast-translation.test.cjs`：runner 120秒ETIMEDOUT；原样单跑Passed。存在晚订阅exit/无界等待的夹具风险，尚未证明它就是本次超时原因。
4. `tests/ws-list-preview-update.test.cjs`：首次请求启动等待失败；原样单跑Passed。
5. `tests/ws-followup-chain.test.cjs`：首次请求启动等待失败；原样单跑Passed。

五项原样复现、原预算/断言/stdio未变的结果及诊断见 [final-five-failure-review.md](evidence/s3/final-five-failure-review.md) 和 [final-five-original-repros.json](evidence/s3/final-five-original-repros.json)。随后只对API进行临时内存编译观测，原正式源码hash不变；6次各69个真实请求均Passed，stderr为空且无spawn error。它不能重标原始失败，也不能认定日志观测消除了启动问题。未对五项问题作无证据的产品修复或延长超时。

归档执行只白名单复制合成截图、已执行测试日志及只读验证结果；没有递归复制隔离根、数据库、profile或connection.private.json。两目录共153份证据＋2份SHA清单，13,232,093 bytes（不含清单）；逐文件SHA-256复核全部一致，清单明确finalRegressionPassed=286、failed=5、stageGate=Blocked。文本统一UTF-8/LF并按明确规则脱敏，JPEG保持原始字节；source hash与归档hash分别记录于 [S3清单](evidence/s3/sha256.json)、[RD02清单](evidence/rd02/sha256.json)。失败日志没有删除或用旧绿灯替换。

临时根 `C:\Users\酷酷\AppData\Local\Temp\zhike-stage51-native-f56a007ff0f6450a9219665979d9475c` 由明确marker保护，按当前基线的诊断保留规则留存，未删除；未将其私有连接或WebView profile提交Git。最终窗口由用户正常关闭，相关记录PID均未发现活体；完整树观察限制见上文。

代码提交RD02 `c970d40`、S3 `eee5ac9`。本文、验收矩阵、风险登记及归档在独立报告提交内；最终工作区状态以提交后`git status --porcelain`检查为准。生产SQLite/迁移文件未变，正式Worker/AI和真实WS未启用，无新旧双写。

下一步仅处理这5项回归失败与两项图表的原生复验，并取得新一轮退出证据；S3 Passed后才能进入S4。当前不能宣布“核心阶段全部完成”或“全项目无BUG”。
