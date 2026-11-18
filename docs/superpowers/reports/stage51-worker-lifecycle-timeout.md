# 阶段 5.1 Worker 生命周期全量回归超时

## 结论

状态：`Blocked`。本轮全量回归中的 `stage 2 controlled Worker lifecycle integration` 实际出现超时失败。阶段 5 Gate 不能改为 Passed。原生 UI、其他专项或后续同一隔离生命周期的成功样本均不能抹去这次失败。

本附件仅做只读诊断和已确认空测试目录清理。没有修改 WorkerRuntimeController、WorkerSupervisor 或阶段 2 测试源码，没有放宽超时，没有为取得成功结果重复执行失败用例。正式生产入口仍为 FROZEN。

## 实际失败证据

基线：阶段 5 代码 `7667837`、报告 `e11b318`。当前阶段 5.1 工作区尚未提交，文件清单以主验收报告和最终提交为准。

执行命令：`node scripts/run-tests.cjs all`。原始日志：`.tools/stage51-full-tests.log`。

- 日志第 246 行开始该用例；隔离 C# 项目构建通过，0 warnings / 0 errors，构建耗时 2.12 秒。
- 日志第 258 行记录 `[FAIL] stage 2 controlled Worker lifecycle integration`，没有最终 JSON 或可定位生命周期步骤的标准输出。日志本身没有逐行时间戳，因此不能给出精确的失败时刻。
- 当前本地时区为 UTC+05:30。隔离根创建于 `2026-11-16T18:42:48.1922691+05:30`。主验收进程在约 18:44:20 仍观察到用例未结束，随后外层 harness 超时并继续后续用例。
- 主验收观察到测试宿主 PID 5144（父 PID 19488）和测试子 Worker PID 28660；诊断开始时这些进程已结束。同名 `WorkerRuntimeIntegration.exe` 进程数量为 0。诊断没有主动终止进程。
- 临时根 `C:\Users\酷酷\AppData\Local\Temp\zhike-stage2-worker-a32f0bd7d49b42c5a126b8989699fac7` 当时存在且为空，无法从中取得阶段日志、IPC 记录或崩溃转储。既有测试只在全部流程结束时输出最终 JSON。

阶段 5.1 早先的资源包装测试曾成功运行既有生命周期；那是独立成功样本，不能解释本次超时。若全量回归后面的同类资源包装再次成功，仍须保留本次失败与未知根因。

## 确认的诊断预算缺口

`scripts/run-tests.cjs` 对该 Node 用例使用默认外层 120000 毫秒超时。`scripts/stage2/worker-runtime-test-helper.cjs` 先同步构建隔离项目（构建自身上限也是 120000 毫秒），之后给测试 exe 单独 120000 毫秒。

因此外层 120 秒包含构建时间，而内层 exe 的 120 秒是在构建后才开始计时。本次实际构建耗时 2.12 秒，外层可以在内层返回 ETIMEDOUT 和错误详情前先终止 Node 测试壳。这说明为什么本次日志缺少内层超时详情，但不能证明 Worker 停滞根因。仅协调内外诊断预算也不能使业务安全验收自动通过。

## 尚未证明的静态风险

只读检查发现以下缺少总预算的等待点，均为待验证风险，不是本次失败的已证实原因：

- `WorkerRuntimeController.StopMonitorAsync` 取消 monitor 后等待其任务结束，没有独立的退出预算。
- `WorkerSupervisor.RequestAsync` 的初始管道写入，以及 `TrySendCancelAsync` 的取消帧写入，没有独立的取消令牌或写入预算。

WorkerRuntimeController、WorkerSupervisor、`scripts/stage2/worker-controlled-integration.test.cjs` 和 `scripts/stage2/WorkerRuntimeIntegration/Program.cs` 本轮 Git diff 均为空。没有证据足以把本次故障归因于 IPC ACL、fencing、某一锁顺序、系统负载或任何阶段 5.1 代码变动。

这是涉及生命周期并发与恢复的未知故障。建议下一轮明确授权受控诊断，使用更高推理强度分析，不以盲重跑或扩大安全容忍度替代根因调查。

## 下一步受控诊断建议

1. 在既有隔离测试中增加不含凭据的阶段日志：启动、首次请求、心跳、取消、崩溃恢复、单次/并发 token 轮换、连续重启、并发生命周期、停止及清理。记录单调时间、代次和脱敏状态；不得记录 token、完整 SID 或业务载荷。
2. 让外层 harness 在终止前保留已输出阶段与拥有进程树证据；协调构建和运行的诊断预算，使内层有机会提交失败详情，但保持既有业务操作超时与安全标准。
3. 仅使用临时根、隔离 Worker 和既有真实 IPC 实现做有界复现。保留本次首次失败，记录每次复现结果；若无法复现或缺少足够证据，继续 Blocked。
4. 确认根因后才实施最小修复，并增加能复现该竞态的回归；重新执行 Worker/IPC/fencing 与全量测试。不得凭后续一次成功解除门禁。

## 临时资源处理

清理前再次确认：精确路径直接位于当前 TEMP，目录名为本次记录的 GUID 根，创建/修改时间均为 18:42:48.192，目录不是重解析点，没有子项，同名隔离测试进程为 0。该根由本轮测试创建，未发现生产数据或其他用户资料。

仅执行 `Remove-Item -LiteralPath <上述精确空目录>`，未使用 `-Recurse` 或 `-Force`。随后 `Test-Path` 返回 False，目录已删除。未清理其他旧 `zhike-stage2-worker-*` 根目录，没有删除非本次资源。

## 本轮原生编译

实际命令：

```powershell
.tools\dotnet10\dotnet.exe build desktop/src/Zhike.Desktop/Zhike.Desktop.csproj -c Release --no-restore -p:Platform=x64 -r win-x64 --nologo -v:minimal
```

结果：0 warnings / 0 errors，耗时 19.16 秒。这是缺省构建，不带 Stage51IsolatedUi 编译开关；仅编译，没有启动生产 exe。编译成功不能替代本次失败的生命周期运行验收。

## 生产边界

未连接真实 WhatsApp，未访问真实登录态，未修改生产 SQLite，未启动正式 Worker 或 AI 消费者，未开启新旧任务队列双写。生产入口 FROZEN，阶段 6 不具备自动启动条件。最终全量数量、Git commit 与干净工作区结果由主验收报告统一记录。
