# 阶段 5.1 性能与资源观察

基线：`e11b318`；日期：2026-11-16（Asia/Calcutta）。本附件只记录实际运行结果，生产入口保持 FROZEN。

## Worker / IPC 生命周期

实际命令：

```powershell
node scripts/stage51/resource-worker-regression.test.cjs docs/superpowers/reports/stage51-worker-resource-evidence.json
```

结果：Passed。复用既有 `WorkerRuntimeIntegration` 与正式 `WorkerRuntimeController`、`WorkerSupervisor` 和 Named Pipe；本轮重新编译为 0 warnings / 0 errors。

- 生命周期与退出检查总耗时：4651.2 ms（不含先行构建）。
- 心跳、取消、崩溃恢复、Token 轮换、并发轮换、重启与并发生命周期：Passed。
- 停止和临时根目录清理：Passed。
- 检查结束时该测试可执行文件路径对应的剩余进程：0。
- 父 Node 测试进程 CPU：user 31 ms / system 16 ms；这不是 Worker CPU 消耗。
- Worker CPU、内存峰值：本包装测试未测量，不推断其达标。

上述是本轮初次专项实际执行的结果。父任务后续全量回归中，同一 Worker runtime 生命周期检查发生超时；初次 Passed 不能覆盖后续超时，也不能用资源最终清零推断本轮所有生命周期回归均通过。最终测试状态以父任务全量报告为准。

可机器读取的脱敏结果见 `stage51-worker-resource-evidence.json`，不保存 SID、IPC token 或业务凭据。

## 原生桌面观察工具

命令模板：

```powershell
pwsh -NoProfile -File scripts/stage51/resource-observe.ps1 -RootPid <隔离桌面PID> -TestRoot <已验证临时根> -IntervalSeconds 10 -Samples 31 -OutputName resource-samples.jsonl
```

工具要求临时目录名为 `zhike-stage51-native-<GUID>`、标记为 `.stage51-isolated`，并验证真实进程曾在该目录写入原生事件。只采集根进程及后代的内存、线程、句柄和 CPU 计数；退出后仅检查已观察且创建时间相符的进程，防止 PID 重用混淆。不会读取进程命令行、应用内存、凭据或生产数据目录。

状态：工具语法解析 Passed。第一份原生观察已运行于真实隔离应用 PID 20132，21 个有效样本、约 205.6 秒，详见 `stage51-native-startup-resource-evidence.json`。

| 第一轮原生启动等待观察 | 首样本 | 末样本 | 变化 |
| --- | ---: | ---: | ---: |
| 应用及子进程工作集（字节） | 233984000 | 234520576 | +536576 |
| 私有内存（字节） | 120971264 | 121495552 | +524288 |
| 线程总数 | 32 | 35 | +3 |
| 句柄总数 | 1489 | 1485 | -4 |
| 进程数 | 3 | 3 | 0 |
| WebView 子进程数 | 0 | 0 | 0 |

该观察期间未成功绑定原生操作窗口，不能验证十页切换。进程有原生窗口句柄，但桌面控制工具将测试程序和已安装程序的相同标识混淆；后续使用不同测试程序集标识重试。观察 CPU 增量 0 秒不能解释成高性能，可能是等待。WebView **进程数不是实例数**。第一轮的十页操作、账号反复切换、WebView 生命周期与原生输入延迟为 NotTested / Blocked；后续原生交互由父任务另行记录，不能以本表代替。

早先 `prewindow-resource.jsonl` 的每进程原始计数有效，但 PowerShell 聚合值为 null；已修正观察器为 PSCustomObject，并仅使用修正后的 `native-startup-resources.jsonl` 派生本表，不把无效聚合计入证据。

追加一轮 10 个样本、约 92.7 秒的观察正常结束，详见 `stage51-native-startup-continuation-evidence.json`：工作集变化 -126976 字节、私有内存变化 -245760 字节、线程 36→30、句柄 1487→1483；仍未观察到 WebView 子进程或新的 CPU 消耗。两轮共 31 个有效样本，UTC 12:22:29.170→12:28:12.100，跨度约 342.93 秒，中间存在重启观察器的间隔，不能声称连续 31 次的交互稳定性测试完成。

安全负例实际执行：`& .\\scripts\\stage51\\resource-observe.ps1 -RootPid 1 -TestRoot . -Samples 1` 返回 exit 1，报“test directory is outside the required temporary root”，在查询指定进程或创建证据文件前拒绝非隔离路径。

未定义性能阈值；工具输出 `Observed` 与实际基线，不能自动推导性能 Gate 为 Passed。

## 第二轮原生可操作窗口资源基线

使用独立测试程序集 `Zhike.Stage51.Acceptance` 后，父任务通过真实 Windows 桌面工具成功取得应用截图并操作界面。资源观察进程不负责点击，不将截图/业务交互结论伪造为计数测试结果。

实际命令：

```powershell
& .\scripts\stage51\resource-observe.ps1 -RootPid 18128 -TestRoot <本轮验证的 native-92ecc... 临时根> -IntervalSeconds 10 -Samples 31 -OutputName native-ui-resource.jsonl
```

31 个连续样本，UTC 12:34:54.533→12:40:06.718，观察时长约 312.66 秒；命令正常结束 exit 0。`stage51-native-ui-resource-evidence.json` 保留已核对各进程加和的摘要。

| 原生界面操作期间 | 首样本 | 末样本 | 变化 |
| --- | ---: | ---: | ---: |
| 总工作集（字节） | 954773504 | 1357787136 | +403013632 |
| 总私有内存（字节） | 549580800 | 755875840 | +206295040 |
| 线程总数 | 225 | 356 | +131 |
| 句柄总数 | 5780 | 9172 | +3392 |
| WebView 子进程数 | 6 | 12 | +6 |

观察 CPU 总增量为 183.9531 秒；线程峰值 387、句柄峰值 9536。本轮没有设定性能阈值，也不把此 CPU 总量擅自换算为目标设备达标百分比。

原生日志中仅有两个 `webview-created` 事件：shell（browser PID 3208）以及首次打开 WS 后的 default 前台（browser PID 3220）。因此首末资源差包含首次创建 WS WebView 的开销；WebView 子进程数不是实例数。第二个 Core 创建十秒后的样本 8 到末样本，工作集仍增加 68689920 字节、私有内存增加 54697984 字节、线程减少 12、句柄增加 50。这些是实际基线，未证明存在泄漏，也未证明无泄漏；长期多账号压力和更长时间运行仍需与业务交互证据一起评估。

样本结束时应用仍运行，以便父任务继续界面验收。关闭后的资源释放结果另行记录，不能从观察器正常退出推断应用已释放所有资源。

## V2 正常关闭及释放

父任务完成账号切换后、关闭前另取单次真实快照，发现 21 个进程身份、18 个 WebView 子进程；总工作集 1781374976 字节，私有内存 959905792 字节，527 线程、12699 句柄。它包含后来打开第二账号的成本，没有用早先两个 Core 的样本冒充整个账号切换后的实例状态。

实际命令分别使用 `resource-check-cleanup.ps1 -SourceName native-ui-resource.jsonl` 及 `-SourceName native-before-close.jsonl`。在父任务 Alt+F4 并确认原生窗口消失后，UTC 12:48:24.967 / 12:48:25.013 检查结果均为 Passed，分别核对 17 / 21 个 PID+创建时间身份，剩余均为 0。检查过程只读，没有杀进程。Native 日志记录 application-stopping（12:47:47.363Z）和 sidecar-stopped/running=false（12:47:47.622Z）；后续本机端口 54239 无监听、隔离 `.workbench.lock` 不存在。本轮测试 Worker 进程也为 0。

清理检查器曾在应用仍运行时做负例验证，发现 PowerShell 7 自动解析日期后的重复字符串解析会丢失小数秒，已改为保留 DateTime/DateTimeOffset ticks 或严格 roundtrip 解析。修正后存活应用正确显示 15 个剩余进程；新增 `resource-observer-safety.test.ps1` 使用真实当前 PowerShell PID 验证存活检测、创建时间不符拒绝和隔离标记拒绝，实际 Passed，避免仅在进程已退出时“碰巧通过”。早先错误探针未计入关闭通过证据。

V2 关闭证据不替代后续 V3 修复后的复验。原生临时根暂时保留用于父任务归档脱敏证据，不含真实 WhatsApp 登录态。

## V3 最终版本等待与实际操作阶段基线

V3 的 PID 30308 使用 Hidden 启动后因原生操作工具无法激活而被父任务按精确测试身份结束，**未计作正常退出通过**。随后明确可见启动的 PID 32904 用于本轮 61 个连续样本；Native event 关联严格只筛选 32904，未混入 V2 或 30308。

实际命令使用 `resource-observe.ps1 -RootPid 32904 -IntervalSeconds 10 -Samples 61 -OutputName native-final-resource.jsonl`。UTC 12:59:30.124→13:09:51.999，时长 622274.6 ms（约 10.37 分钟），正常结束 exit 0，各进程加和均重新核对通过。详见 `stage51-native-final-resource-evidence.json`。

| V3 观察值 | 首样本 | 末样本 | 变化 |
| --- | ---: | ---: | ---: |
| 总工作集（字节） | 889303040 | 1335459840 | +446156800 |
| 总私有内存（字节） | 496951296 | 732925952 | +235974656 |
| 线程总数 | 228 | 382 | +154 |
| 句柄总数 | 5860 | 9286 | +3426 |
| WebView 子进程数 | 6 | 12 | +6 |

峰值工作集 1367166976 字节、私有内存 767340544 字节、392 线程、9304 句柄；累计观察 CPU 增量 273.6406 秒。Native 日志仅记录本 PID 两个 Core：shell/browser 11476，以及 native-b 前台/browser 11216。第二 Core 创建十秒后到末样本，工作集增加 38981632 字节、私有内存增加 12201984 字节、线程增加 28、句柄增加 477。

父任务随后确认：用户约在 UTC 13:03 将指定 ISOLATED 窗口置前，已通过真实原生工具完成前七页导航、AI 重试/取消、CRM 批准/拒绝/冲突，且 API 回读验证通过；之后 Telegram 再次遮挡，原生操作暂停。这组数据因此包括**等待和已确认操作阶段**，不能全部标为空闲，也不能全部标为连续压力。

以父任务给出的约 13:03 为粗略阶段边界：样本 0–20 共 21 条在边界前；样本 21–60 共 40 条在边界后，后者包含真实操作与暂停。边界前末样本工作集 854122496 字节、私有内存 463077376 字节；边界后首样本工作集 861343744 字节、私有内存 471285760 字节。实际 WS Core 在 13:03:32.512 创建，与操作阶段重合。这里没有推定每条样本都对应输入事件，具体原生动作以父任务验收矩阵/CUA 证据为准。

仍**不能认定完整十页交互压力、双账号反复切换或预期三个 Core 的生命周期验证全部通过**：本 PID 日志只有 shell 和 native-b 两个 Core，滚轮工具送达尚待独立验证。不存在已定义阈值；没有从“进程未崩溃”推导稳定不卡顿或长期无泄漏。

采样结束时应用仍活着；其后受控结束与释放检查见下节。

## V3 受控结束后的释放证据

因再次遮挡和桌面操作暂停，父任务核实确切测试 exe、UTC 创建时间与唯一 owned Node 路径后受控结束 PID 32904 及其测试 sidecar。此过程**不计作正常 Alt+F4 验收通过**。结束前额外单次快照为 15 个进程、12 个 WebView 子进程，总工作集 1380143104 字节、私有内存 784896000 字节、353 线程、9270 句柄。

UTC 13:20:00 对最终 61 样本与结束前快照分别核对 15 个 PID+创建时间身份，剩余均为 0、不可核实项均为 0。UTC 13:20:03 检查端口 58574 无监听，隔离 Worker 测试进程为 0。`.workbench.lock` 仍存在，ownerPid=7408 已不存活，明确分类为强制结束后的测试残留，不假称自动锁清理通过。检查器没有终止任何进程或删除任何数据，见 `stage51-native-final-close-resource-evidence.json`。

父任务随后对本轮三个已验证 native 测试根申请清理，自动审批在命令创建阶段拒绝，删除与复制均未执行。本轮三个根保留，临时资源清理状态为 **Blocked / NotCleaned（policy）**；包括 stale lock 与短期隔离配置在内，不再尝试替代删除或绕过审批。父任务将另行归档必要的非敏感样本和原生日志。本项不能与此前已成功清理的阶段 5 三处历史诊断资源混淆。

进程和监听端口清零仅说明本轮已观察运行资源释放，不代表临时文件已删除或 V3 正常退出通过。后续人工清理应依据父任务主报告列出的三个精确路径，仅处理确认归属的本轮隔离资源。

## 归档后的导航干扰复核

对已脱敏的 `stage51-native-lifecycle-events.jsonl` 按 session PID 重新统计，V2（18128）有 6810 条 `ws-visible` 的 `webview-navigation` 事件，success=false/true 各 3405 条；V3（32904）有 11208 条，其中 false 5605 条、true 5603 条。两轮 shell 导航事件各仅 1 条。V3 存在频密失败/成功交替导航，出现约 50 ms 级的短间隔；全体 WS 导航相邻间隔中位数为 25.965 ms（V2 为 16.1593 ms）。

这些事件说明 **Core 实例数量稳定不能证明视图没有反复导航或视觉稳定**。隔离构建将真实 WhatsApp 导航约束至 `about:blank`，可能在该测试替换路径中形成重复导航；准确调用链由原生隔离附件继续记录，不能直接归因为真实 WhatsApp 服务。该干扰会影响 CPU、内存增长、句柄及可交互性观察。

原始进程资源计数和时间戳仍是实测值，保留原样；但上述数值只表示本次受导航干扰的隔离运行，**不能作为正常 WS 聊天或后台采集的性能结论，也不能据此宣布视觉无抖动、长期稳定或无泄漏**。须先修复并隔离验证测试导航循环，再重新取得无此干扰的原生交互及资源基线。本附件不修改产品源代码。

本轮保留的第三个 native 根为 `%TEMP%/zhike-stage51-native-95d5941432654bf9906247471c41ddce`；另两个分别为 `zhike-stage51-native-248a3820ba4f4b6abbfa8c09fd957da5` 与 `zhike-stage51-native-92eccfc80f164b15b7fcd1618058cb21`。三个根均为 NotCleaned（policy），未再次尝试删除。

## 用户恢复前台后的 V4 补验及正常关闭

用户后续允许保持窗口前台，父任务用同一隔离测试构建和根启动 PID 31928（创建 UTC 13:26:58.6677573）。本观察器按要求只采启动后和关闭前两个单次快照，未将其包装成长时间性能复验：

| 快照 | UTC | 工作集字节 | 私有内存字节 | 线程 | 句柄 | 进程 / WebView 子进程 |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| 启动后、尚未创建 WS Core | 13:27:24.449 | 865468416 | 491659264 | 227 | 5779 | 9 / 6 |
| 实际交互后、关闭前 | 13:33:30.141 | 1707606016 | 901382144 | 534 | 12639 | 21 / 18 |

本 PID 共三个 Core：shell/browser 28452、native-b/browser 23984、default/browser 19180。父任务完成剩余 tasks/logs/settings 页面、导航与内容区可信滚轮正反向输入、10 次快速账号切换及 2 次账号数据独立性核对；这期间没有第四个 Core 创建事件。具体输入与数据结果以父任务原生验收证据为准。本次仍未修复上节的隔离导航干扰，因此三个 Core 稳定及这两个快照**不能用来宣布正常 WS 性能或视觉稳定已通过**。

父任务随后实际 CUA Alt+F4，二次窗口列表确认句柄消失，未强杀。应用日志为 UTC 13:33:47.6419029 `application-stopping`，13:33:47.7761993 `sidecar-stopped/running=false`。本观察器在 13:34:18 对关闭前 21 个 PID+创建时间身份只读检查，剩余 0、不可核实 0；13:34:22 端口 56876 无监听，根下 `.workbench.lock` 为 0，**本 V4 正常关闭及观察资源释放为 Passed**。先前 V3 的 stale lock 属于其 13:20 历史检查结果；V4 生命周期正常退出后的当前锁状态为已清除，非人工删除。

三处 native 测试根仍保留，清理审批拒绝未绕过；V3 受控结束历史与 V4 正常关闭证据分别保存。附件 `stage51-native-late-close-resource-evidence.json` 不把运行资源清零扩大成目录清理完成或整体 Gate 通过。
