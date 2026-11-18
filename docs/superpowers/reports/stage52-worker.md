# 阶段 5.2 Worker 生命周期阻断修复

基线：`37449b2`（阶段 5.1 报告）、`3591212`（代码）。日期：2026-11-16，Asia/Calcutta。生产入口始终 FROZEN。最终提交、全量回归与阶段 Gate 由主报告记录；本附件不单独批准生产启用。

## 原始失败与真实复现

目标完整名称：`stage 2 controlled Worker lifecycle integration`。入口 `scripts/stage2/worker-controlled-integration.test.cjs`；实际程序集 `scripts/stage2/WorkerRuntimeIntegration/WorkerRuntimeIntegration.csproj`，链接真实 `WorkerRuntimeController`、`WorkerSupervisor`、`WorkerIpcProtocol` 和功能开关类。

阶段 5.1 原始失败只有外层 `spawnSync … ETIMEDOUT`，没有可恢复的原始 managed stack，不能虚构旧失败堆栈。旧日志保留于 `.tools/stage51-full-tests.log`。外层 120 秒包含构建、内层 exe 又单独 120 秒的诊断缺口确实存在，但不是本轮确认的挂起根因；本轮没有增大业务或外层超时。

本轮首次独立执行原例通过，原输出 `.tools/stage52-worker-initial.log` 保留，未以一次成功宣称修复。随后只增加粗阶段诊断、不修改产品逻辑，执行计划 20 次的 baseline：第 1 次 3327ms Passed，第 2 次 120020ms ETIMEDOUT，停在 `rotation.begin`。失败即停止，不将后续成功混入这组结果。

增加安全隔离的细分阶段观察后，另一组未修复运行前 7 次 Passed，第 8 次 120024ms ETIMEDOUT。最后有效顺序：

1. `crash.recovered`，generation=2。
2. `heartbeat.write.end` / `heartbeat.read.begin`。
3. `rotation.begin`。
4. `monitor.cancel.begin` / `monitor.cancel.end` / `monitor.await.begin`。
5. `heartbeat.caller.cancel.begin`，之后未产生 cancel-sent 或 drain-completed。

因此实际阻塞点是取消控制帧的 `StreamWriter.WriteLineAsync`；`StopMonitorAsync` 正等待该 heartbeat 任务退出。既有取消写不携带 CancellationToken 或独立边界，750ms drain 预算要等写结束才开始，所以无法约束该挂起。初始业务帧写也位于原 request CTS 创建之前，存在相同的未受约束 IO 窗口。没有进一步声称已取得 .NET/Windows 内部线程栈或唯一解释底层管道为何在该次不完成。

原始复现、每次阶段、耗时和日志 SHA 见 `stage52-worker-repeat-evidence.json`。原始日志保留在其列出的 `.tools/stage52-worker-raw` 子目录，没有公开 token、完整 SID、session 或业务载荷。

## 最小修复

`desktop/src/Zhike.Desktop/Services/WorkerSupervisor.cs`：

- 既有 request deadline 覆盖排队、会话快照、初始帧写和响应读，不再在首次写完后才创建 CTS。
- 获得 `_requestGate` 后所有路径纳入 `try/finally`；通过生命周期 gate 复制同一认证会话的 writer/reader/pipe/token/session，避免并发 Dispose 在进入 finally 前泄漏信号量。
- 取消控制帧使用可取消写入；取消写与 drain **共用原有的 750ms 清理额度**，未扩大业务预算或将错误转换成成功。
- 初始帧可能部分写入，或取消写/确认失败时，只关闭该请求捕获的实际 pipe 对象。绝不通过 `_pipe` 关闭可能已被轮换安装的新 generation；可能半帧的旧连接不可继续复用。
- 超时仍返回 TimeoutException，调用者取消仍返回 OperationCanceledException。ACL、SID、proof、request ID、schema 和 fencing 未放宽。
- 真实重复验证暴露第二个明确缺陷：失效 pipe 后 `IsRunning=false`，但旧 Worker 仍归 Supervisor 所有；原 token rotation 仅在 IsRunning 时重启，因此只改 token 而未重建真实会话。现在依据 `Enabled && owned _worker != null` 决定停止旧进程并启动新会话。从未启动/已停止的 null 状态不会自动启动 Worker。

`WorkerRuntimeController.cs` 只增加测试编译符号下的诊断观察点，没有修改生产生命周期算法或正式开关。所有细分观察点在缺省产品构建中编译移除。测试中的文件观察器做路径限制、序列化、错误计数；错误不能泄漏业务信号量，也不能伪装为测试成功。

## 诊断扰动与未隐藏的中间失败

第一次细分 observer 曾使用同步逐行文件写，存在并发共享风险；该组失败被明确排除出产品根因证据。修正观察器安全性后才捕获上述有效取消写挂起。

首次写入边界修复的第 7 次不再超时，而是快速报 IPC 未连接；这暴露并推动修复了“失联但仍有 owned process 的 token rotation 不重启”问题，失败记录保留。

另一组带同步细分文件观察的第 14 次出现快速 ObjectDisposedException。日志显示 heartbeat 阶段与真正进入请求间存在约 3.8 秒间隙，超过测试原有 500ms 心跳预算，恢复与首次 echo 发生重叠。此组保留为诊断/调度扰动观察，不强行归因给磁盘或操作系统。最终连续验证关闭细分 observer 和文件 IO，只保留粗阶段 stdout，未放宽 500ms 心跳或其他安全预算，也没有把不同组的成功次数拼接。

## 根因回归测试

新增 `scripts/stage52/worker-io-boundaries.test.cjs`，实际 Named Pipe、授权握手、临时 Worker 和临时根，无模拟返回值：

| 场景 | 实际结果 |
| --- | --- |
| 握手后对不读取 peer 写入 128 KiB 合法帧 | 原 150ms deadline 触发，观测 175ms；捕获旧连接失效 |
| 初始写入期间调用者取消 | 原 75ms 取消触发，观测 83ms；保留 OCE |
| Worker 不确认取消 | 100ms 请求 + 原 750ms 总清理额度，观测 865ms；旧流不可继续复用 |
| 请求设置期间 Process 已 Dispose | 真实 HasExited 异常路径拒绝；第二次请求仍能进入，信号量无泄漏 |
| 从未启动及已 Stop 后轮换 | 不启动新 Worker |

前两项通过真正的 `RotateTokenAsync` 恢复新 generation，重新完成认证并 echo 成功。测试对旧 PID＋创建时间在轮换后实际已退出作断言；正常 Stop 后也检查已拥有进程消失。没有通过增加 StopCore 的现有 3 秒等待预算取得通过。

## 连续与并发验证

实际命令：

```powershell
node scripts/stage2/worker-controlled-integration.test.cjs
node scripts/stage52/worker-repeat.cjs baseline 20
node scripts/stage52/worker-repeat.cjs safe-diagnosed-baseline 20
node scripts/stage52/worker-io-boundaries.test.cjs
node scripts/stage52/worker-repeat.cjs fixed-no-trace 20 coarse
node scripts/stage52/worker-concurrency.test.cjs --no-build
```

最后一组 **20/20 连续 Passed**，每次 3378–5663ms，全部以同一最终产品代码、原 120000ms 程序测试预算执行；每次运行包含启动、echo、心跳、取消、崩溃恢复、单次与并发 token 轮换、三次重启、并发生命周期、停止和 Dispose，所有独立临时根均清理。每次结果见 JSON 附件，不仅记录总数。

同一程序集 4 个进程同时执行完整生命周期：**4/4 Passed**，分别 3385、4254、4251、3475ms；每个使用不同实际临时根和管道，`tempRootClean=true`。完成后同一测试 exe 精确路径的存活进程数为 0。并发测试在主任务全量前单独安排，未与“进程应为 0”的其他测试交叉运行。

当前 Worker 专项结论：`Passed`（上述隔离范围）。不能将 20 次通过扩张为所有设备、无限负载或生产启用证明。阶段 5 Gate 仍需导航、原生桌面、性能、全量回归和临时目录处理共同决定。

## 边界与回滚

未访问生产 SQLite、真实 WhatsApp 登录态或真实 AI；未启用正式 Worker、正式消费者或新旧双写。诊断 fixture 的 Enabled=true 仅在实际隔离测试中使用，默认产品开关和 FROZEN 未改变。

新增测试代码与日志均可随本轮 Git 代码提交 revert；没有生产数据迁移需要回滚。阶段 5.1 的历史原始失败保留，不覆盖其验收记录。最终 code/report SHA 和工作区状态见主验收报告。
