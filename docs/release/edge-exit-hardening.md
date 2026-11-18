# 隔离 Edge 退出加固

日期 2026-11-19（Asia/Calcutta）。基线 `266ef9d`，本轮诊断提交 `eb9d402`，测试辅助器提交 `3c35db1`。已补上本次测试页的实际销毁确认。正式 S1 在修复后仍复现进程退出超时，根因尚未证实。

**最终全量回归 317/319，两项失败均发生在隔离 Edge 的进程退出阶段。本轮验收 Gate 与 S3 均为 Blocked，Production 为 FROZEN。**

## 实际变更

| 提交 | 文件 | 变更 |
|---|---|---|
| `eb9d402` | `scripts/diagnostics/edge-exit-observer/observer/Program.cs`、`calibrate-invocation.cjs`、`README.md` | 独立 Windows 观察器区分同一进程句柄的提前退出状态和真正有信号的等待结果。只在进程句柄已发出信号时确认退出，记录采样失败的具体步骤及身份核验。 |
| `3c35db1` | `tests/helpers/isolated-edge-runner.cjs`、`tests/isolated-edge-transport.test.cjs` | 先分离本次创建的会话，再向本次创建的精确目标发送关闭命令。预先登记销毁等待，同时要求命令返回 `success:true` 且收到同一 ID 的浏览器级 `Target.targetDestroyed` 事件，随后请求 `Browser.close`。回环测试覆盖提前或延迟事件、重复事件、错误 ID 或会话、超时、断连和拒绝关闭。 |

相对基线共有 5 个诊断或测试文件变更。原 30 秒单次运行总期限、页面及截图断言、退出码、流关闭、PID 创建时间身份和清理判定保留。本轮没有修改产品、WinUI/WebView2 生命周期、账号或 profile 实现、数据库、Worker、IPC 或生产配置，没有新增原生验收或发布安装包。

为使修复可复现，本轮重新运行一次负对照：只在内存中去掉等待精确销毁事件的那一行，原测试文件不变。前五项通过，`target-delayed` 的原断言明确拒绝“只有 ACK 和无关目标销毁就释放目标”，命令退出码为 1。随后正式实现的独立专项仍为 10/10。这是本轮重新执行的红/绿证据，不冒充首次修改前的历史日志；预期红测试不计入全量 319 项。

## 隔离试验

每个 A/B 样本单独运行原 S1 Operations / Atelier Dawn 截图用例，保留该用例全部断言。各轮的变量不同，统计按轮和按组保留。

| 试验 | 实际结果 | 证据边界 |
|---|---|---|
| 测试页销毁屏障 | A 组 9/10，B 组 10/10。A06 主失败为 `result` 阶段等待导航加载，随后出现释放失败。B 组十次均收到精确销毁事件后才请求浏览器关闭，独立观察退出码均为 0，无强制终止。关闭响应到销毁事件 33.520–64.695 ms，中位数约 36.34 ms。 | 这轮 A/B 均未复现页面结果已就绪、浏览器与传输已确认关闭但进程未在期限内退出的原故障，证据支持销毁顺序。 |
| 浏览器端先关闭传输 | A、B 各 7/8。首对均已完成页面结果、精确测试页销毁、浏览器关闭响应和传输关闭，最终在 `process-exit` 失败。 | B 在 `Browser.close` 响应后等待对端关闭，仍复现同类失败。该策略只用于实验。 |
| 提前关闭浏览器启动页 | A、B 各 7/8。A01 枚举出两个初始 page，保护断言拒绝继续。B01 确认初始空白页销毁后，主失败为 `navigation-load`，随后释放失败。 | 两个失败处于不同阶段。该轮无法确定关闭初始空白页对原进程退出故障的影响，该策略只用于实验。 |

原 S1 主界面完整入口在 `3c35db1` 上连续执行三轮，前两轮通过，第三轮在结果已就绪、精确测试页已销毁、浏览器关闭已响应并且传输已关闭后，仍在原期限内等待不到进程退出。`original-network` 的原顺序加网络观察单轮通过，仅是一次独立诊断执行。三轮正式 S1 和该诊断执行分别保留，各轮结果不能合并成一次通过。

最后追加一次完整原 S1 的退出日志诊断，只增加该隔离浏览器的日志参数，没有改变期限、断言或关闭次序。6 次调用中 5 次通过，第 6 次仍为 `process-exit` 失败。6 次均未采集到允许的 `ExitIgnoreUnloadHandlers` 标记，标记状态为 **Unverified**；解析器分别校验了本机 `filename:line` 与 Chromium `filename(line)` 两种格式，仍不能因缺日志而断言没有进入关闭路径。该诊断不替代默认完整回归，也没有合入额外启动参数。

本轮归档目录为 [Edge 加固证据](evidence/edge-exit-hardening/)。此前故障的独立 Windows 句柄证据及有限原生操作见[可用性稳定化报告](usable-stabilization-report.md)。

## 最终回归

| 检查 | 结果 |
|---|---|
| `scripts/run-tests.cjs all`，`3c35db1` | **317/319，2 Failed**。S1 主界面和 S1 WS 工作台均在 `process-exit` 超时。 |
| `tests/isolated-edge-transport.test.cjs` | **Passed，10/10**。实际本机回环 WebSocket，另有 1 项诊断资源检查。 |
| WinUI Release x64 / win-x64 | **Passed，0 warnings / 0 errors，21.60 秒**。本轮重新编译，无产品改动。 |
| 本轮验收 Gate | **Blocked**。两项退出超时保留失败，S3 及后续阶段未放行。 |

失败项均记录了 `resultReady=true`、本次测试页已销毁、`Browser.close` 响应和 CDP 传输关闭，但在原 30 秒期限内未收到退出事件。调用方后置布局断言没有全部完成，两项视觉检查均为 Failed。

- S1 主界面 `Delivery S1 actual main renderers and shared design system`。调用 ID `1795032000054-fea1f6bb-8194-4c73-98f6-3260e129ae65`。
- S1 WS 工作台 `Delivery S1 WS computed layout and retained host`。调用 ID `1795032031001-3872a7c8-571d-4778-89ae-df1749cdd377`。

仍未验收真实 WhatsApp 登录、收发及群组同步，付费 AI 实际调用，干净 Windows 安装，完整多 DPI、多屏及物理输入矩阵。此前原生证据范围以[可用性稳定化报告](usable-stabilization-report.md)为准。

实际命令（本工作树）：

```powershell
& resources/app/node.exe tests/isolated-edge-transport.test.cjs
$env:ZHIKE_EDGE_OBSERVER_DOTNET=(Resolve-Path '.tools/dotnet10/dotnet.exe').Path
& resources/app/node.exe scripts/run-tests.cjs all
& resources/app/node.exe .tools/edge-exit-fix/shutdown-log-harness.cjs shutdown-log-1
& .tools/dotnet10/dotnet.exe build desktop/src/Zhike.Desktop/Zhike.Desktop.csproj -c Release --no-restore -p:Platform=x64 -r win-x64 --nologo -v:minimal
git diff --check
```

## 归因限制、资源与保护

本次两条最终失败的页面结果均已返回，但在原 30 秒期限内浏览器进程没有确认退出，调用方后置布局断言没有全部完成，因此不能将其表述为视觉验收通过。其他 317 项通过也不能抵消这两项失败。此前独立 Win32 观测已证明不只是 Node 的退出通知或 stdio 未完成；没有线程调用栈或可靠退出路径标记，尚不能确定 Edge 内部哪个组件阻塞。

公开的 [Playwright #41210](https://github.com/microsoft/playwright/issues/41210) 描述的是 macOS Edge 149 已正常退出、EdgeUpdater 延迟释放 stdio 的情况，与本次 Windows 原进程句柄仍存活的证据不同，不能直接作为根因。微软 [Edge 发布说明](https://learn.microsoft.com/en-us/deployedge/microsoft-edge-relnote-stable-channel) 没有提供足以确认本次原因的信息；未更新浏览器、修改系统策略或关闭防护。

已完成的前三轮实验及重复 S1 共 81 次调用做了显式 PID + 创建时间只读点检：1,212 个已记录身份中 1,207 不再存在，3 个 PID 已复用，0 个匹配仍存活，2 个身份无法核实。后两条用 Win32 有限查询权限再次检查均被系统拒绝，保留 **Unknown**；162 条辅助进程 PID 记录均已不在。不能将此写成全部后代进程都已清理，更不能强杀无法确认身份的进程。失败调用保留其隔离临时目录，没有删除用户资料。

最终两次全量失败和六次日志诊断另外点检了 135 个身份：两次全量的 35 个全部已不在；日志诊断的 100 个中 99 个已不在，1 个只读权限拒绝而保持 Unknown。16 条辅助 PID 记录已不在。两份点检分开归档，不把 PID 缺失、已复用、无权限和确认匹配混为同一结论。

本轮只访问合成测试页面、测试元数据及隔离进程。未打开生产 SQLite、真实 WS profile 或密钥；未恢复 RD02 停用采集、启用正式 Worker/AI、双写队列或发布安装包。原生 WinUI 交互沿用先前明确范围的证据，本轮没有声称重新进行了桌面操作。

证据只归档明确选择的诊断文本、原始摘要和实验脚本，记录源文件与脱敏归档的双 SHA-256；profile、SQLite、登录态及完整页面原始结果不提交。具体清单见 [manifest.json](evidence/edge-exit-hardening/manifest.json)。

回滚可在隔离分支逆序撤回 `3c35db1`、`eb9d402`，保留基线 `266ef9d`；没有数据库迁移需要恢复。原故障没有解决，不能以回滚、延长期限或强制终止后重标成功来放行。整体 **S3 Blocked / S4 Pending / Production FROZEN** 保持。
