# RD02 认证 profile 安全边界整改验收报告

日期：2026-11-17（Asia/Calcutta）。分支 `upgrade/zhike-61-ab-delivery`，开发起点 `8de6078a6d5640bbd0d60eb207d4e6b16a7c164c`。RD02独立代码提交：`c970d400df1c885398eb5caf79cfc425da309150`；S3独立代码提交及当前HEAD：`eee5ac9da0fc69a4742bbdeb307782b3480eab94`。报告提交为**包含本文的独立报告提交，git log可查**，不填写自引用hash。检查时仅本轮release报告待提交，不能提前称工作区干净。

**用户决定：Approved by user。代码已提交；RD02实际边界专项9/9、JS19/19。最终共用全量286/291（5 Failed），RD02最终Gate保持Blocked，不以历史通过代替当前失败。生产入口：FROZEN。**

本报告遵循 [阶段验收矩阵](acceptance-matrix.md)、[业务边界基线](business-contract-baseline.md) 及 [RD02批准决定](decisions/RD02-authenticated-profile-boundary.md)。这是对已有真实日志和当前源码的文档复核；本报告任务没有重新运行测试、浏览器、编译或应用。既有S1/S2报告保留其当时的未批准状态，不重写历史证据。

## 授权、影响和禁止边界

用户已明确批准：不复制认证profile；停用依赖旧复制路径的隐藏采集；保留正常前台聊天、手动切号、既有profile、客户/群组/消息/队列/checkpoint；正式Worker与AI消费者保持关闭。

旧自动历史、会话发现和后台群监测在当前版本明确不可用，不是“正在运行但无数据”。这是一项已批准的功能可用性变化，不是完成了安全后台采集替代方案。账号已连接仍只表示前台连接状态，不能推导后台采集可用。VIP客户业务与WS监测群仍互相独立。

本批准没有允许读取/复制Cookie、Token或登录态，没有允许清除旧profile或业务数据，没有允许生产迁移、真实WS登录、正式Worker/AI、新旧双写或放宽IPC/fencing。未来安全的独立后台平台能力必须另行验证及授权。

## 已落盘的真实代码边界

|文件/既有所有者|实际整改|保留范围|
|---|---|---|
|`desktop/src/Zhike.Desktop/Services/WebViewProfileService.cs`|保留两个collector公开方法签名，但在任何文件系统/环境创建前返回固定能力拒绝异常；移除复制、staging、swap/backup实现|正常前台按账号环境缓存；现有用户明确清理会话动作保留；本整改未执行清理|
|`desktop/src/Zhike.Desktop/Services/WsCollectionCapability.cs`|单一不可变typed能力DTO；拒绝不是可由生产feature flag重新打开的旁路|前台连接状态与能力分开；既有flags保持原值|
|`desktop/src/Zhike.Desktop/Services/WsRuntimeService.cs`|普通tick不再自动租用、创建、导航或驱动隐藏账号/collector，不再重复尝试被封锁路径|显式手动前台账号创建、A-B-A池化、稀疏前台登录探测、本地耐久队列flush、正常关闭|
|`desktop/src/Zhike.Desktop/Views/LegacyUiHostPage.xaml.cs`|不创建隐藏WebView、不注册collector bootstrap，不回退到前台采集脚本/自动滚动；自动actions先拒绝再接触账号/Core|正常前台WebView/Core生命周期、手动可见/选中文本导入、既有发送generation/资格/取消/unknown语义、账号边界|
|同一Native action/status层|status/probe和ws.status事件统一带能力；pause/stop仅返回localOnly安全停用状态；后台capture包不能借前台登录身份获授权|原桥错误字段白名单未放宽，不透传任意敏感payload；队列/历史资料不删除|
|`resources/app/modules/ws-workbench.js`、`ws-business-pages.js`|按账号接收能力；缺失/未知能力同样fail-closed；自动入口在桥/任务或enabled配置写入前阻断；状态页解释历史记录与当前不可用差别|打开前台、手动切号、原手动导入/明确人工发送入口；缺scope不猜账号，不把blocked误作登录失败|

能力契约为：`state=blocked`、`code=COLLECTION_CAPABILITY_BLOCKED`、`reason`明确说明；`backgroundCollection`、`automaticHistory`、`groupMonitoring`、`foregroundFallback`均false，`manualVisibleImport`为true。Native阻断 `discover-conversations`、`collect-all-read`、`configure-group-monitor`、`start-group-monitor`、`configure-ws-groups`、`configure-vip-groups`。历史`configure-vip-groups`只是旧入口名称，不新增VIP客户与WS群的关系。

旧Collector模型/调度算法的兼容数据结构可以继续存在并接受静态历史测试；这不代表它们具备可执行平台权限。不得因旧enabled配置或历史run状态显示实时运行。

## 复现、修复与本轮实际证据

|实际命令/检查|结果|原始日志及限制|
|---|---|---|
|`dotnet run --project desktop/tests/Rd02CollectionBoundaryRuntime/Rd02CollectionBoundaryRuntime.csproj -c Release`，整改前合成红|2 Passed / 4 Failed|`.tools/rd02-native-boundary-red.log`；实际生产profile服务复制/替换合成标记，普通scheduler自动创建非手动选择账号。未使用任何真实profile|
|同一真实链接服务的初步修复验证|6/6 Passed|`.tools/rd02-native-services-green.log`；无复制/目录创建/collector环境；合成adapter不等于WinUI桌面|
|`node tests/rd02-authenticated-profile-boundary.test.cjs`|**9/9＋静态检查 Passed**|`.tools/delivery-rd02-native-boundary.log`首次有2个CS8669生成源码警告；显式加入`#nullable enable`后的`.tools/rd02-native-boundary-final.log`无警告。链接真实服务，并抽取实际Native action/monitor方法执行，不是空stub成功|
|`node tests/delivery-rd02-ws-capability.test.cjs`|**19/19 Passed**|`.tools/delivery-rd02-capability-final.log`；实际模块，合成桥边界，无网络/浏览器/profile/DB。覆盖缺能力、旧配置、自动入口、账号切换、手动操作和状态展示|
|`node scripts/run-tests.cjs ws`|**160/160 Passed**|`.tools/delivery-rd02-s3-ws-final.log`；本轮真实执行结果，含上述专项，不能再与19案例相加称新增179项|
|正式WinUI Release x64/win-x64编译|**0 warnings / 0 errors，37.89秒**|`.tools/delivery-rd02-release.log`；由总控串行执行，不把C#harness当作正式编译|
|S3/RD02先前正式Release|0 warnings / 0 errors，36.31秒|`.tools/delivery-s3-rd02-release-final.log`；历史编译检查点，不凭编译自动放行原生功能|
|原生后续修复后的正式Release|**最新0 warnings / 0 errors，26.06秒**|`.tools/delivery-s3-rd02-release-post-native-fixes.log`；不以新编译替代失败的最新全量|
|原Native发送安全专项|18/18实际C#case保留并通过；harness编译0/0|`.tools/rd02-native-send-safety.log`；资格generation、A-B-A、Core替换、取消、点击前failed/点击后unknown语义未放宽，不等于实际平台接受或送达|

旧WS首次147/158、11项失败保留在`.tools/delivery-rd02-ws-initial.log`。受批准变化影响的旧contract由正向“复制/hidden执行”改成负向“任何IO前拒绝/不建hidden/无bootstrap”，没有删除测试或假返回通过。五个Native/安全contract逐项差异及保留断言见`.tools/rd02-five-contract-adaptations.md`；其余WS旧期望适配见`.tools/delivery-rd02-legacy-tests.md`。原foreground/Core/LRU/generation/账号/IPC/队列/发送安全断言继续保留。

这份草案没有重跑上述命令。首次S3/RD02全量真实285/290、5项失败保留；4项旧contract/夹具适配后单跑通过，另1项真实RD02重复banner占高65.59px已由总控修复。完整原因仍在chip title/aria和相应页面；188px原host断言未放宽，S1 WS computed7组尺寸与能力19/19实际通过。日志`delivery-rd02-compact-layout-final.log`、`...-compact-status-final.log`保留。随后`.tools/delivery-s3-rd02-full-rerun.log`曾290/290 Passed，属于该时源码检查点；后续原生修复后的最新`.tools/delivery-s3-rd02-full-post-native-fixes.log`实际289/290，唯一WS local ingest readiness失败，原日志未保留足够child启动证据，根因未确定。原样用默认Node及bundled Node两次专项通过不替代失败全量；仅测试观测helper已实际6/6、bundled原ingest连续5/5；历史原因仍未知。最终冻结全量`delivery-s3-rd02-final-frozen-full.log`已结束：286/291，5 Failed，exit 1；本地ingest在该轮Passed，另5项WS检查失败，详见S3报告。

## 数据安全、迁移和回滚

验证profileIO只使用带明确标记的`zhike-rd02-native-*`合成临时根；Native host方法测试生成文件在独立测试根。没有打开生产SQLite、真实profile、API Key、Cookie/Token或WhatsApp账号；没有执行正式采集/AI。新增能力字段为桥状态兼容字段，不改数据库schema/checksum，不回填业务表，不切换队列消费者，不改变既有客户自动建档及人工资料保护规则。

本报告不归档profile、数据库、私有连接文件或原始凭据。现有`.tools`日志是本机开发证据；进入正式release/evidence归档时须由总控按白名单复核、脱敏、生成SHA-256清单，不把源路径中的真实用户身份当作需要公开的内容。

RD02代码与S3已按总控要求分别提交并保留版本（hash见本文开头）。回滚仅在隔离分支做代码复核；不得为恢复旧可用性重新启用已禁止的认证复制。没有数据库变更需要回滚，已有用户profile及业务资料不删除、不复制。旧collector目录的存在、来源及删除另行核验和授权，当前不处理。

## 本轮已观察的原生证据及剩余验收

本次文档更新只读核对总控产出的`.tools/delivery-s3/native-rd02-account-core-evidence.json`、`native-rd02-process-release.json`、相关JPG，没有重新运行应用。测试宿主PID3532，按实际事件顺序为两条初始default选择，再十条native-b/default交替（总12条selected）。default generation1、native-b generation2各只在首次选中时created=true，后续均created=false/reload=false；Core创建总数精确3个（shell、default前台、native-b前台各1）。`collectorDirs=[]`、`externalRequests=0`。

这批聊天容器只导航隔离`about:blank`，没有真实WhatsApp登录或收发。零外网请求表示本次没有产生外网请求，不是“实际发出了平台请求并成功被阻断”的证据。`native-rd02-ten-account-switches.jpg`和`native-rd02-chat-expanded.jpg`保存了实际界面；CRM面板展开/收起、返回知客主工作区由总控真实观察。`native-rd02-process-release.json`逐项记录PID及startedUtc，已观察21个身份全部sameIdentityAlive=false，usedForce=false。

**构建条件限制：** PID3532二进制包含一个与RD02无关、没有解决S3原生拖动问题的`AllowDrop=true`单变量试验。源码已恢复默认false；RD02和WS源码未变化，不能把试验当产品必要配置。PID18712完成原生阶段反向并15/15释放；后续PID28884实际共享pointer/首页/CTA通过，15/15准确身份正常释放。PID19588实际新跟进配色与WS返回followups通过后由用户正常关闭；仅3个预先记录root/sidecar/Core PID无活体，未取得完整退出前树样本，不能称全树清理Passed。十次WS切号仍只具有PID3532的about:blank有限证据；所有真实WS登录/收发继续未测。

|项目|当前状态|通过证据要求|
|---|---|---|
|本轮隔离前台容器及CRM面板|Passed（PID3532有限范围）|实际界面及展开/收起截图；about:blank，不冒充已登录WhatsApp正常聊天质量|
|手动十次账号切换与Core保留|Passed（PID3532有限范围）|总12条选择，其中初始两条A后十次A/B交替；3个Core各只创建一次，collector目录为空；最终默认配置复验仍待补|
|返回主工作区|Passed（PID3532有限范围）|总控实际返回知客；完整多页面/窗口状态组合由最终默认配置复验补齐，不据单次返回推定全部通过|
|手动入口与原生错误反馈|NotTested|手动可见/选中导入与安全停用入口在隔离环境按既有规则反馈；自动动作明确blocked、不创建隐藏视图或循环重试；不进行真实WS操作|
|本轮应用退出与资源释放|部分Passed，最新树观察有限|PID3532为21/21、18712和28884各15/15准确身份释放；19588仅3个已记录PID无活体，未观察完整树；各批均无force，不能夸大最新清理范围|
|默认AllowDrop=false原生范围|Passed于已记录动作|阶段正反、首页排序/刷新保留、26位跟进CTA及WS返回followups已有本轮实际证据；十切号仍只有3532 about:blank范围，不补写真实平台|
|共用完整回归与测试观测补充|Failed：286/291|[full-regression.log](evidence/s3/full-regression.log)为本次最终结果；实际runWs段155/160。helper6/6、原ingest5/5、原5项复现及临时API诊断均不替代该失败结果；启动根因尚未证实|
|真实WhatsApp登录/收发、未来后台替代能力|NotTested，超出本轮范围|需要之后单独授权和真实平台证据，不能用Mock结果声称已支持|

RD02最终准入仍 **Blocked**，等待最新共用全量通过及总控归档收尾。这不撤销9个隔离Native案例、19个JS案例、160项WS检查和已完成的本轮有限原生动作；但不能以更早290/290覆盖当前289/290失败，也不能把3个已记录PID扩成完整树验收。S3两项新增只读图表仍未原生验证，记录于S3报告，不冒充RD02平台能力。

## 当前结论

用户批准已记录，禁止路径的代码边界及隔离回归证据完整。本轮有限原生范围已更新，当前共用全量5项失败原因仍未全部证实；证据已白名单归档并完成SHA-256复核；RD02最终Gate暂为 **Blocked**。S3其它功能门禁由S3报告独立记录。生产始终 **FROZEN**，不允许由本批准启动正式Worker、AI、真实WS或生产迁移；S8仍需S0–S7全部Passed及其它发布前置条件。

## 归档与停止点

RD02清单见 [sha256.json](evidence/rd02/sha256.json)，当前完整回归及五项复现见S3报告/归档；两目录合计153份合成证据＋2份清单全部SHA-256一致，没有提交profile、DB或私有连接凭据。

代码`c970d40`及S3 `eee5ac9`可独立审查；本文在后续独立报告提交内。本轮不以失败全量解锁RD02/S3门禁，不启用旧采集替代、不连接真实WhatsApp、不打开或迁移生产SQLite；FROZEN保持。
