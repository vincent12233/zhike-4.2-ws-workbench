# Horizon Atelier Pro 验收补齐与 Edge 退出诊断（2026-11-17）

**S3 Gate：Blocked；生产入口：FROZEN。** 本轮只完成验收、诊断及一处测试辅助程序修复，没有扩展视觉设计、增加模块或发布安装包。

## 基线与修改范围

- 开始提交 `9aacf56bda2edd4316fcd026d565801cad45a918`，分支 `upgrade/zhike-61-ab-delivery`，开始工作区干净。
- 产品视觉仍是已提交的 Horizon Atelier Pro；检查器修正 `45330dd` 已包含在基线中。
- 本轮代码提交：`ec7f89fb2e572524d5a49eb06d35d0dd66bfc640`。
- 仅修改 `tests/helpers/isolated-edge-runner.cjs` 和 `tests/isolated-edge-runner-lifecycle.test.cjs`。产品页面、CRM、SQLite/迁移、Worker、IPC、WebView2 生命周期及正式开关没有改动。
- 本文及证据为后续独立报告提交；不在文内填写自身提交 hash，使用 Git 日志定位。
- 保留原失败记录，未延长超时、删除测试、降低断言或通过反复重跑挑选绿灯。

## 实际完整回归

两次均实际执行 `resources/app/node.exe scripts/run-tests.cjs all`，不是复用上一轮结果。

|运行|结果|差异与证据|
|---|---|---|
|开始基线，测试辅助修复前|286/291，5 Failed，exit 1|[原始完整日志](evidence/horizon-pro-acceptance-2026-11-17/full-regression.log)|
|测试辅助修复后最终运行|**290/291，1 Failed，exit 1**|[最终完整日志](evidence/horizon-pro-acceptance-2026-11-17/full-regression-after-helper.log)、[结束记录](evidence/horizon-pro-acceptance-2026-11-17/full-regression-after-helper-result.json)|

首轮失败：Stage 5.1 collapsed layout、S1 主 renderer、S2 图表、S3 客户表四项真实 Edge 退出检查，以及 S1 受控子进程清理专项。前四项已有结果，但进程没有在原截止内完成退出；不能按视觉结果已生成而改为 Passed。

最终仅剩 **Delivery S1 actual main renderers and shared design system** 失败：
- invocation：`1794925576024-f768686a-1ef2-4f0f-9f57-f853ad481c31`。
- 布局结果在3,630ms完成校验，result-ready事件在5,068ms；Browser.close ACK 5,074ms，CDP closed 5,075ms。
- 30,000ms 原预算内没有观察到真实父进程退出；exit 为 null，streamsClosed=false，cleanupSafe=false。
- 生命周期失败保留。事后准确身份已释放并清理临时目录，不改变原 Failed 状态。
- [本轮失败元数据索引](evidence/horizon-pro-acceptance-2026-11-17/full-failures/metadata-index.json)。

修正后的全局视觉 scope 检查器在**两次完整回归中均 Passed**。最终运行内 Stage 5.1 layout、受控生命周期、S2 图表、S3 表格、Worker/IPC/fencing、AI/CRM、账号/群组隔离及 024 checksum 相关检查通过；它们不补足唯一失败项，也不替代原生输入验收。runner 检查总数保持291；生命周期内部真实案例从9增至10，不把内部案例数与291直接相加。

## 已证实并修复：测试辅助程序重复查询已退出根进程

首轮受控 Node 的 result-timeout 用例故意耗尽结果等待预算。原3,000ms总预算中，进程在2,269ms已实际 exit 0，child/stdout/stderr均关闭。辅助程序却再次启动 PowerShell 查询同一个、已验证创建身份的根 PID，余下731ms不足，产生清理误报。原 result 超时又遮住了这个次级清理错误。

修复仅限测试基础设施：
1. 对启动时已核对 PID/创建时间、并持有原 ChildProcess 的直接子进程，要求实际 exit、child close及两条流关闭，以这些事件作为该进程释放证据。
2. 其他已观察进程继续执行真实 PID＋创建时间查询；任何存活后代仍阻止清理。
3. 保留原3秒/30秒预算、退出码、预期失败和资源释放断言，记录独立 releaseFailure 便于诊断。
4. 新增真实 IO 反例：同一根进程只查启动身份；额外已观察的存活合成进程必须返回 OWNED_PROCESSES_REMAIN。没有 mock 身份值或 OS 返回值。

实际验证：

|项目|结果|
|---|---|
|`resources/app/node.exe tests/isolated-edge-runner-lifecycle.test.cjs`|13参数/路径检查＋10真实子进程案例 Passed|
|原 result-timeout 聚焦连续运行|20/20；2,263–2,282ms，原3,000ms预算；预期结果超时仍发生，清理通过|
|4个独立测试进程并发|4/4 exit 0，共12个实际案例，包含存活后代拒绝|
|`resources/app/node.exe tests/isolated-edge-transport.test.cjs`|4/4 Passed|
|`git diff --check`|Passed|

[红绿证据和修复说明](evidence/horizon-pro-acceptance-2026-11-17/edge/helper-fix.md)、[专项汇总](evidence/horizon-pro-acceptance-2026-11-17/edge/helper-fix-summary.json)。专项重复驱动只选择相同源码中的用例/次数，实际进程、辅助程序和断言不替换。两个诊断夹具失败也保留，不隐藏开发过程。

## 仍未证实：真实 Edge 退出缓慢的底层原因

真实 Edge `157.0.4341.60` 的关闭延迟与上述受控 Node 冗余查询是不同问题。

- 初始3次原命令观察得到2 Failed、1 Passed。一项为真实 process-exit超时；另一项在29,836ms才正常退出，剩余时间不足完成原后代身份检查。
- 包括上述3次在内，首批有界诊断共14次，另含原参数只读诊断、guest配对、禁用扩展/同步的单次试验及WCT准备。guest三次均无法创建测试标签，方案未采用；禁用扩展/同步单次通过不证明因果，未并入helper。
- OS观察显示部分延迟时父浏览器仍活着、已观察renderer/utility已退出，线程等待且CPU增量有限。这不能定位具体锁、判定死锁或认定扩展责任。
- 最终完整回归结束后，最多3次原参数复验均正常退出；其中一次从close ACK到exit耗时15.124秒。没有追加无限重跑，没有用三次通过覆盖完整回归失败。
- WCT诊断脚本被本机 Windows PowerShell 执行策略拒绝，状态为 **NotTested**。没有修改策略、提权或改用绕过方式，因此尚无有效挂起等待链。
- **真实 Edge 延迟根因仍 Unverified；没有证据要求修改产品 WebView2、Worker 或 IPC。**

[脱敏诊断汇总](evidence/horizon-pro-acceptance-2026-11-17/edge/summary.json)、[最后3次观察及WCT限制](evidence/horizon-pro-acceptance-2026-11-17/edge/wct-final-result.json)。下一步应在允许执行已审查诊断脚本的受控 Windows 测试环境中捕获挂起等待链，维持原失败门禁；不继续无依据改产品或增加超时。

## 本轮 Windows 原生验收

环境：Windows 11 专业版10.0.26300 x64，Release隔离宿主，WebView2 Runtime157.0.4341.46。截图实际1920×1140；不外推多DPI矩阵。测试窗口标题始终含“Stage 5.1 · ISOLATED 验收”，这是复用的测试宿主名称，不表示阶段倒退。

本轮唯一原生根：
`C:\Users\酷酷\AppData\Local\Temp\zhike-stage51-native-93ba09c523d1423e9be6ad07d6779bd8`。

复用 `scripts/stage51/native-prepare.cjs`、`scripts/stage51/seed-native.cjs` 和既有S3合成seed；52位合成客户、2个账号、4组/4成员、3报名、2跟进、1跟票、1入金、2人工任务。禁止真实WS/付费AI网络，仅临时工作区写入；截图不是设计图或生产客户。

|验收项|实际动作与结果|状态/证据|
|---|---|---|
|两主题与图表可读性|实际切换浅色/深色；两张非空图、标题、数值、明细可见，未观察文字被图覆盖|Passed于所见页面；不称全部页面/DPI已验收|
|任务完成率|在真实UI完成ISOLATED_S3_TASK_MANUAL，0/2→1/2=50%，两主题展开明细|[浅色](evidence/horizon-pro-acceptance-2026-11-17/native-light-task-chart-details.png)、[深色](evidence/horizon-pro-acceptance-2026-11-17/native-dark-task-chart-details.png)；Passed|
|阶段近7天流转|原生拖动001及043两位客户各自“新客户→潜在客户”；明细11-17为2，其余0，并明示条数而非人数/完整历史|[浅色图](evidence/horizon-pro-acceptance-2026-11-17/native-light-stage-chart.png)、[浅色完整明细](evidence/horizon-pro-acceptance-2026-11-17/native-light-stage-details-bottom.png)、[深色明细](evidence/horizon-pro-acceptance-2026-11-17/native-dark-stage-details.png)；Passed。不是同一客户正反两次|
|客户列表布局|两主题真实52客户列表及预览可见；关闭动效后仍能导航客户页，深色行悬停可见|[浅色列表](evidence/horizon-pro-acceptance-2026-11-17/native-light-customers.png)、[深色列表](evidence/horizon-pro-acceptance-2026-11-17/native-dark-customers-motion-off.png)；有限Passed，不代表全部筛选/弹窗通过|
|滚动|侧栏滚轮能独立滚动；系统设置主区一次聚焦后滚轮可推进，PageDown可继续；阶段图表外层拖动滚动条、Ctrl+End可达明细。客户表区域及部分card轮次没有可见位移|**Unverified/Blocked**：尚无trusted wheel探针证明输入归属，不能断定软件或工具。不能把拖条成功代替滚轮验收|
|WS聊天容器|打开隔离空白Core、CRM收展后聊天宽度变化、切群组页再返回；后台采集仍不可用，显示连接失败|[展开CRM](evidence/horizon-pro-acceptance-2026-11-17/native-ws-crm-expanded.png)、[收起CRM](evidence/horizon-pro-acceptance-2026-11-17/native-ws-crm-collapsed.png)；有限Passed。不是WhatsApp登录/收发通过|
|WS生命周期|日志shell/chat Core各创建1次，WS导航1次，未见导航循环；只有同一个账号的2次selected|[采样与事件摘要](evidence/horizon-pro-acceptance-2026-11-17/native-observation-summary.json)、[最终计数](evidence/horizon-pro-acceptance-2026-11-17/native-final-lifecycle.json)。多账号切换未完成，不作十次切号结论|
|动效关闭|在系统设置用真实下拉框选择“关闭动效”，随后侧栏滚动和客户导航/悬停仍可使用|[设置截图](evidence/horizon-pro-acceptance-2026-11-17/native-motion-off.png)；操作通过。重载持久化、系统级减少动画及所有组件禁动画仍NotTested|
|安全数据回读|52客户、3报名、2跟进、1跟票、1入金不变；两条phaseHistory、一个完成任务、人工occupation保留|[只读验证](evidence/horizon-pro-acceptance-2026-11-17/native-business-readback.json)。只在合成根GET /api/state；未声称逐字段/生产数据完整性全审计|
|正常退出|用户确认正常关闭；15个已观察PID＋创建时间均无存活，未强杀；application-stopping/sidecar-stopped/host-unloaded各1次|[连续采样身份释放](evidence/horizon-pro-acceptance-2026-11-17/native-process-release.json)、[最终快照身份释放](evidence/horizon-pro-acceptance-2026-11-17/native-final-process-release.json)；Passed于已观察身份范围|

工具曾连续报窗口超出捕获屏幕，用户移回主屏后补测；最后滚动条操作被工具以其他应用覆盖目标拒绝，未实际执行。没有把这些被拒绝或受额外输入影响的动作计为通过。后续滚轮诊断应复用既有 `native-input-probe.cjs`，只在隔离fixture记录trusted事件、owner、scrollTop及preventDefault，先复现再决定是否最小修复；本轮未改滚动产品代码。

两次阶段变化及任务完成保留在本轮合成工作区，未假称已通过UI恢复；它们不会写入生产工作区。

## 性能观察与编译

`scripts/stage52/resource-observe.ps1 -RootPid 2100 -TestRoot <上述隔离根> -Samples 181 -IntervalSeconds 5 -OutputName acceptance-resource.jsonl`：
- 181连续样本，13:39:30.674–13:55:51.351 UTC，实际16.345分钟，间隔5.364–6.280秒。
- 进程树工作集938.602→1244.457MiB，Private556.594→680.715MiB，线程230→355，进程9→15，WebView2子进程6→12。
- 最后5分钟工作集下降20.266MiB、Private上升4.781MiB。期间创建了聊天Core，树的基线发生变化；不能仅凭工作集变化认定泄漏。
- 采样未覆盖启动前71秒、13:55后全部交互或关闭，未测帧时间；没有定义新的放行阈值。**这是观察基线，不授予性能Gate。**
- 关闭前另采1个最终快照并核查退出，见[最终资源记录](evidence/horizon-pro-acceptance-2026-11-17/native-final-resource.log)。

本轮实际编译命令：

```powershell
.tools/dotnet10/dotnet.exe build desktop/src/Zhike.Desktop/Zhike.Desktop.csproj -c Release --no-restore -p:Platform=x64 -r win-x64 --nologo -v:minimal
.tools/dotnet10/dotnet.exe build desktop/src/Zhike.Desktop/Zhike.Desktop.csproj -c Release --no-restore -p:Platform=x64 -r win-x64 -p:Stage51IsolatedUi=true -p:OutputPath=../../../.tools/stage51-native-v2/ --nologo -v:minimal
```

正式配置Release：0 warnings / 0 errors，24.59秒；隔离Release：0/0，48.40秒。见[正式构建](evidence/horizon-pro-acceptance-2026-11-17/release-build.log)、[隔离构建](evidence/horizon-pro-acceptance-2026-11-17/native-build.log)。后续只改两个测试文件，应用源码未变；编译成功不代表测试全绿或正式发布通过。

## 资源、隐私与归档

- 六个本轮完整回归失败根先保存12份metadata并比对SHA-256，再核查117条PID/创建时间记录；Temp直子目录、无reparse、无原身份存活后，按精确路径清理。无Force、提权或终止其他进程；[清理记录](evidence/horizon-pro-acceptance-2026-11-17/full-failure-cleanup.json)。
- 生命周期新增红测试/夹具失败的2根另有[清理记录](evidence/horizon-pro-acceptance-2026-11-17/edge/controlled-cleanup.json)；初始Edge诊断根由[诊断清理记录](evidence/horizon-pro-acceptance-2026-11-17/edge/cleanup.json)覆盖。
- 原生根按现有S0诊断保留规则留存，以备未确认滚轮问题，不删除历史目录，不据此降低其他门禁。
- 归档128份独立白名单证据，逐项source/archive SHA-256相同，见[清单](evidence/horizon-pro-acceptance-2026-11-17/sha256.json)。截图均来自合成工作区。原日志只选已审阅的非敏感测试日志/摘要；不递归复制测试根。
- 未提交 connection.private.json、SQLite、WebView profile、Cookie、Token、真实API Key、原始CDP stderr或含扩展目标ID的observation JSONL。原生事件只归档白名单摘要及最终计数，源事件hash保留。本地未脱敏原件仅在隔离诊断位置。
- 未连接真实WS或真实AI；没有生产数据库迁移、正式Worker/AI消费者、新旧双写；RD02认证profile复制仍停用。

## 未解决事项、回滚与下一步

1. **Edge退出超时**：最终全量唯一失败，已复现，底层等待原因仍Unverified。需要受控环境有效WCT/等价受审查进程等待证据，不能无依据调超时。
2. **原生滚轮**：客户表与部分card未可靠完成；需既有可信输入探针区分输入送达、焦点与浏览器滚动链。静态发现的horizontal表格contain路径只是线索。
3. **剩余原生范围**：关闭动效后刷新保持、补充隔离切号及相应页面边界尚未验证；双主题及Core只在本文明确观察范围通过。
4. 历史sidecar/桥接/WMI延迟没有新确定根因，继续保留。真实WS、多DPI、完整长期性能与后续发布能力不由本轮越级放行。

测试修复可单独反向提交 `ec7f89f`，不涉及业务数据或数据库回滚；证据和失败历史保留。没有修改历史迁移checksum。

**最终：S3 Blocked，生产 FROZEN。不得据本轮UI验收进入后续生产实施或发布安装包。** 本轮已经通过的视觉工作不重新开发，下一步仅处理上述阻断及必要验收。
