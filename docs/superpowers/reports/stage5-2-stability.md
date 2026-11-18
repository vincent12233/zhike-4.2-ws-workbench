# 阶段 5.2 稳定性验收

日期：2026-11-16（Asia/Calcutta）。本轮只处理 Worker 生命周期超时与隔离 WebView2 导航循环，不开发新业务或阶段 6。

## 输入基线

- 仓库：`C:\Users\酷酷\Documents\Codex\2026-11-04\new-chat\work\project-review\知客 4.1 运营增强版`。
- 分支：`fix/zhike-61-p0-infrastructure`。
- 开始 HEAD：`37449b2a8bb0e147a744d360c5ff8e1cf04ff646`；代码 `3591212`、报告 `37449b2` 均通过 `git cat-file -t` 确认为 commit。
- `git status --porcelain` 开始时无输出，未覆盖其他工作；仓库及已检查父目录未发现额外 AGENTS.md。
- 已完整阅读主验收报告、Worker 超时、导航循环与临时资源附件。原 256/257 和性能数据仅作为历史，不当作本轮结果。
- Windows 11 Pro 10.0.26300 x64；Node 24.22.1，仓库 `.tools/dotnet10`。其余实际测试配置在结果部分记录。
- `%LOCALAPPDATA%\Zhike6\worker-feature-flags.json` 不存在，正式 Supervisor 仍禁用；不打开生产 SQLite，不连接真实 WhatsApp，不调用真实付费 AI。

## 最终结论

**阶段 5 Gate：Blocked。生产入口：FROZEN。阶段 6 不允许启动。** 两个技术阻断已经修复并完成本轮真实隔离验证；唯一当前门禁保留项是新隔离根按用户最后选择“暂时保留”，未清理。沿用阶段 5.1 的 NotCleaned 门禁，不将用户暂留选择解释为放宽验收标准。

| 本轮项目 | 结果 | 实际证据 |
| --- | --- | --- |
| Worker 超时根因、重复与并发 | Passed | 原逻辑重现 120 秒挂起；真实 IO 5/5；同一最终代码连续 20/20（3378–5663ms）、四进程并发 4/4；未放宽原预算 |
| 隔离导航反馈循环 | Passed | 真实 Core 初次失败重试、十页、十次账号切换；最终短复验 Starting/Completed 各 5、Core 3（含 shell）、suppressed 0，显式刷新和重连成功 |
| 原生业务交互 | Passed（已测窗口范围） | 真实 WinUI、临时 sidecar/SQLite：成员跨群、候选批准/拒绝/冲突、取消/重试；实际服务回读核对两客户、人工字段保留、审计恰一次、另一账号候选未变 |
| 性能/资源观察 | Passed（观察与退出检查范围） | 91 样本、15.59 分钟，加操作后半独立快照；正常退出两轮均无已观察进程残留。未定义新性能阈值或承诺所有设备帧率 |
| 024 checksum、迁移及恢复 | Passed | 本轮 stage51 与全量实际重新执行；已知旧 EOF 兼容、未知差异拒绝、备份/审计、重复启动及数据保留检查保持通过；未改历史 SQL |
| 阶段 5 / 5.1 / 5.2 专项 | Passed | 分别 9/9、9/9、2/2，最终全量也包含这些路径 |
| WS 分组 | Passed（最终重跑） | 最终全量内同一 149 项全部通过；首轮独立 WS 148/149 的失败保留，未覆盖 |
| 全量自动化 | Passed | 实际 259/259；相对原 257 增加 Worker IO 与导航两个顶层检查，没有删测/跳测 |
| 缺省 WinUI Release x64/win-x64 | Passed | 0 warnings / 0 errors，20.79 秒；未启动正式 exe |
| 阶段 5.1 遗留三目录 | Passed | 用户手工清理后，三个精确路径均不存在 |
| 本轮新 native 根 | Blocked / NotCleaned | 用户选择暂时保留；无活跃进程、监听/锁，非敏感证据已归档，不再尝试删除 |

## 根因与修改范围

Worker 的取消控制帧 `WriteLineAsync` 不受取消/超时约束，阻塞 `StopMonitorAsync`；初始帧写也在原 CTS 创建之前。现在原 request deadline 覆盖排队、同代会话快照、写和读；取消写与 drain 共用原 750ms 清理额度，失败仅失效捕获的旧 pipe。重复验证另暴露失联但仍有 owned process 时 token 轮换未重建会话，已用 owned-process 判断修复，未启动/已停止状态不会自动启动 Worker。保留 TimeoutException/OCE、ACL、proof、schema、session 和 fencing。

导航已证实的触发链是初始 WA 导航 → 隔离 guard 取消并在回调再导航 blank → 失败恢复又请求 WA。现改为隔离入口直接 blank、按 NavId 识别主动取消，恢复预算绑定 owned account/generation/surface，过期异步恢复票据拒绝；显式刷新/重连仍可重置边界。callback COM wrapper 变化属于设计风险，旧日志没有证明具体 RCW 身份变化，不把推断当历史事实。

真实桌面额外发现前端 `reload` 动作未在 native switch 接通；仅添加 alias 复用原 reload:true 路径并实际复验。计数最终刷盘和一次初始化失败注入均为隔离诊断，正式构建无测试注入。没有改数据库、AI/CRM、群组业务规则或正式开关。

主要修改：`WorkerSupervisor.cs`、`WorkerRuntimeController.cs`（测试符号诊断）、`WsRuntimeService.cs`、新增 `WsNavigationLifecycle.cs`、`LegacyUiHostPage.xaml.cs`、`Stage51Isolation.cs`（隔离专用），以及 `scripts/stage2/WorkerRuntimeIntegration`、`scripts/stage51/NativeIsolationProbe`、`scripts/stage52/` 和测试入口。完整 23 文件清单：`git show --stat fed135e`。

## 实际执行命令与证据

```powershell
node scripts/stage2/worker-controlled-integration.test.cjs
node scripts/stage52/worker-repeat.cjs fixed-no-trace 20 coarse
node scripts/stage52/worker-concurrency.test.cjs --no-build
node scripts/run-tests.cjs stage5
node scripts/run-tests.cjs stage51
node scripts/run-tests.cjs stage52
node scripts/run-tests.cjs ws
node scripts/run-tests.cjs all
.tools/dotnet10/dotnet.exe build desktop/src/Zhike.Desktop/Zhike.Desktop.csproj -c Release --no-restore -p:Platform=x64 -r win-x64 --nologo -v:minimal
git diff --check
```

原始命令日志位于 `.tools/stage52-{stage5,stage51,stage52,ws,full}.log`、`.tools/stage52-release-build.log`。计数与 SHA 见 [test-results](stage52-test-results.json)。Worker 逐次结果、原始失败/诊断扰动分类和日志 SHA 见 [Worker 报告](stage52-worker.md)、[逐次证据](stage52-worker-repeat-evidence.json)。没有拼接不同组的成功次数。

原生准备/seed/操作/回读/短复验详见 [桌面验收](stage52-native-desktop.md)、[导航附件](stage52-navigation.md)；性能命令、环境、操作时间线及归档见 [资源附件](stage52-resource.md)、[原始采样汇总](stage52-resource-preclose.json)、[最终关闭](stage52-native-final-close.json)。原生交互由 computer-use 插件执行，不以 console probe 代替。

## 性能数据与限制

Windows 11 Pro 10.0.26300、WebView2 157.0.4341.46、Release、2 个合成账号/4 群/4 成员关系/8 Jobs/6 候选/2 客户。正式窗口 UTC 14:58:00.180–15:13:35.209，91 样本，实际 935.52 秒；进程树工作集合计 1238093824→1273778176 字节（1180.7→1214.8 MiB），Private Bytes 644952064→677093376，线程 359→338、handles 9034→9270，WebView 子进程 12→12，CPU 累计增量 57.9844 秒。

十页后半、十次账号切换及审核发生在这段采样之后，单列操作快照与时间线，没有将它们伪装成全部位于同一 15 分钟窗口。第二账号首次初始化后的进程增长属于新增被保留会话，不能与首段仅一个 WS Core 的占用直接比较。工作集合计可能重复计入共享页，不据此证明有或没有内存泄漏。

第一轮 PID 19572 的 counter 未在退出前最终刷盘，旧快照不能代表完整事件总数；原始事件仍保留。补齐测试关闭边界刷盘后，PID 3884 最终 20 类计数均 suppressed=0，5 次合法导航与 3 个 Core 有完整证据。两次正常退出均通过 PID+创建时间检查，最终 21 个已观察身份剩余 0/unverified 0，锁不存在。没有 kill 正式应用。

## 未隐瞒的失败与风险

- 早期 Worker 基线超时、observer 自身扰动和第一次修复后的会话重建失败全部保留；详细分类见 Worker 附件。
- 首轮独立 WS 的 `WS group monitor sidecar API` 等待启动失败，原测试 stdio=ignore，不能从该次输出确定原因。仅捕获 stdout/stderr 的独立诊断重跑 exit 0（实际子测试约 1.01 秒），最终完整回归该项也通过。此偶发启动失败原因未证实，未无依据延长等待、改断言或声称已修复其未知原因；后续可复用诊断 preload 保存复现证据。
- 所有 WS 文档为受控 blank，没有真实 WhatsApp 或付费 AI 质量验收，也没有干净设备/DPI/长时间生产吞吐的发布结论。当前测量没有正式性能阈值，只有本轮基线和观察结论。

## 临时资源、门禁与下一步

旧三根 `248a3820ba4f4b6abbfa8c09fd957da5`、`92eccfc80f164b15b7fcd1618058cb21`、`95d5941432654bf9906247471c41ddce` 已由用户清理并核验不存在。自动审批曾在非递归删除尝试执行前返回 `blocked by policy`，自动删除数为 0；没有改 shell、提权或绕过。来源与 SHA 见 [旧目录结果](stage52-old-temp-cleanup.json)。

当前保留：`C:\Users\酷酷\AppData\Local\Temp\zhike-stage51-native-9ea0b959844a45e082f7955053e5126e`。用户最后明确选择“暂时保留”。仅本轮合成隔离库、空白 WebView 测试 profile 和测试连接材料，无生产数据；测试服务已关闭，连接 token 不对应活跃监听，目录仍按本轮原私密 ACL 保留。24 个非敏感白名单文件已备份至 `.tools/stage52-native-evidence-final/`，没有复制 connection.private、SQLite 或 profile；归档 manifest SHA、保留决定及最终存在性见 [暂留记录](stage52-temp-retention.json)。

下一步仅在用户改变暂留选择后清理该精确目录并只读核验，更新清理项及门禁报告；无需为此重写已通过功能。当前不自动删除，不申请阶段 6，不发布安装包。

## 数据保护、Git 与回滚

代码提交：`fed135e70c90f320ece568473d4904c3e74b7b60`。本报告及证据另行独立提交，最终 SHA 见交付回复，亦可用 `git log -1 --format=%H -- docs/superpowers/reports/stage5-2-stability.md` 核对。报告编写时工作区仅剩本轮报告，报告提交后再核验 `git status --porcelain`；不覆盖其他工作。

所有执行入口使用显式临时根、合成数据或 Mock Transport。未打开生产 SQLite、未迁移或回填生产库、未连接真实 WS、未启动正式 Worker/AI 消费者、未启用双写。没有为证明未改生产库而读取其内容或复制登录态。正式开关和生产 FROZEN 未改变，缺省正式 exe 只编译未运行。

回滚为审查后 `git revert fed135e`，保留 `3591212`/`37449b2` 和独立报告历史；本轮没有 SQL 迁移或生产数据需要恢复。不要 hard reset、覆盖用户资料或删除用户暂留目录。
