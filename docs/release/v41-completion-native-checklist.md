# V4.1 原生隔离验收清单

本清单用于执行和归档。下列项目在本文中的状态均为 **待本轮原生验收**。历史截图、纯 Node 和隔离 Edge 测试保留各自范围。生产入口保持冻结。

## 准备一个真实隔离宿主

从仓库根目录运行。复用已核对源码版本的 `Stage51IsolatedUi=true` 测试宿主。准备脚本检查三个 XBF、刷新隔离前端资源，并新建独立的临时根。HUD 只注入 `.tools/stage51-native-v2` 的隔离前端。

```powershell
$zhikeNode = (Resolve-Path -LiteralPath '.\resources\app\node.exe').Path
$zhikeFixture = & $zhikeNode scripts/stage51/native-prepare.cjs | ConvertFrom-Json
if ($LASTEXITCODE -ne 0 -or -not $zhikeFixture.root) { throw '隔离宿主预检失败' }
& $zhikeNode scripts/stage51/native-input-probe.cjs
if ($LASTEXITCODE -ne 0) { throw '隔离输入探针注入失败' }
$zhikePriorRoot = $env:ZHIKE_STAGE51_ROOT
try {
    $env:ZHIKE_STAGE51_ROOT = $zhikeFixture.root
    $zhikeNativeProcess = Start-Process -FilePath $zhikeFixture.binary -WorkingDirectory (Split-Path -Parent $zhikeFixture.binary) -PassThru
} finally {
    $env:ZHIKE_STAGE51_ROOT = $zhikePriorRoot
}
```

等到窗口可交互，`native-events.jsonl` 出现本次 PID 的 `sidecar-ready`，再运行 `& $zhikeNode scripts/stage55b/seed-native.cjs $zhikeFixture.root`。该脚本已经调用 Stage 5.1 基础 seed，同根只执行一次。保留合成夹具、当前显示设置和实际窗口大小。不要归档私有连接文件、认证资料或真实业务数据。

## 先验 WS，再扩充 S3 夹具

|项目|原生操作与留证|
|---|---|
|WS 12 页|遍历 `overview`、`accounts`、`chat`、`groups`、`members`、`collection`、`contacts`、`ai`、`crm`、`tasks`、`logs`、`settings`。检查首页未知状态、群详情开合、成员分群、采集能力提示、通讯录搜索和分页、AI证据、CRM归属、任务跨工作区返回、审计与快照区分及工具弹窗关闭。记录 `workspace-page` 与有数据的截图。逐页的最低案例见[页面验收矩阵](acceptance-matrix.md)。|
|十次切号和账号范围|在 `default` 与 `native-b` 之间实际交替十次，单列初次选择。用 A/B 专属通讯录行核对归属。基础群夹具在两账号内同名同 JID，另核对实际账号请求和响应的 `accountId`。保存十次选择、代次、账号范围 和末次所见列表。|
|Core 与窗口|两账号各保留自己的可见 Core。同一账号返回时检查 `ws-account-selected` 的 `created=false`、`reload=false`，与 `webview-created`、可见 `navigation-completed` 对账。收展 CRM 列，离开聊天后检查边界隐藏，返回知客后检查窗口状态和原工作区入口。隔离 `about:blank` 仅支持容器与生命周期观察。|

如果本轮执行了 WS CRM 候选批准、拒绝和人工字段冲突，先用 `& $zhikeNode scripts/stage55b/verify-native.cjs $zhikeFixture.root` 只读回验。该脚本要求基础客户数为 2，应在扩充前运行。

然后用已有本地 `.tools/delivery-s3/seed-core.cjs <隔离根>` 扩充到 52 位客户和两条人工任务。该脚本是本机验收工具，标准源码 checkout 不包含 `.tools`。执行前核对其存在和本次隔离根，扩充后通过现有 UI 刷新载入。历史 `verify-state.cjs` 绑定旧根及历史日期，不用于此次验收。

|项目|原生操作与留证|
|---|---|
|有效滚轮|在客户表格内部及 WS 可滚动列表分别用真实滚轮往下、往上。两处至少复现一组正反位移。HUD 同时记录 trusted wheel、指针位置、事件及坐标命中、实际滚动容器和前后 `scrollTop`。记录 DPR 和窗口大小。落点移到页脚、只有拖条或按键成功、或未见位移时，按实际观察记录。|
|任务完成率|完成合成任务 `ISOLATED_S3_TASK_MANUAL`。核对任务完成率为 `1/2 = 50%`，打开明细，两主题均记录非空数值和范围。|
|阶段流转|用原生拖动把合成客户移到另一既有阶段。展开「近7天已记录流转」及图内明细，核对当日记录增量、七日时间范围和单位「条」，两主题均记录。|
|动效关闭|在系统设置选择「关闭动效」，切换客户页与 WS 页面，记录实际开关及交互。若需要证明持久化，在按流程正常关闭并确认释放后，用同一隔离根重开并复核设置，不重新 seed。|

## 退出与记录

从 WS 操作前观察本次 PID，直到正常关闭。如果另开 PowerShell，带入准备步骤得到的本次 PID 和临时根。在采样提前结束时，正常关闭前补采一次并分别复核两份样本。

```powershell
& .\scripts\stage51\resource-observe.ps1 -RootPid ($zhikeNativeProcess.Id) -TestRoot ($zhikeFixture.root) -OutputName completion-native-resources.jsonl -IntervalSeconds 10 -Samples 181
& .\scripts\stage51\resource-check-cleanup.ps1 -TestRoot ($zhikeFixture.root) -SourceName completion-native-resources.jsonl
```

关闭后记录 `application-stopping`、`sidecar-stopped`、`host-unloaded`，并保存已观察 PID 和启动时间的释放结果。按步骤记实际状态并链接原始记录。没有完成的项目保留待验或失败原因。真实平台登录、收发、采集和付费 AI 不在本轮隔离验收范围内。
