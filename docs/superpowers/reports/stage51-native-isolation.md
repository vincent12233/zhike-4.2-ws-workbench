# 阶段 5.1 原生验收隔离入口与启动修复

基线：e11b318 / 7667837。此附件记录测试入口和启动基础设施证据；原生十页点击结果由实际桌面验收记录给出，不以本附件的源码/探针测试替代。

最终限制：归档原生事件后发现测试 WS 空白页存在高频失败/成功导航循环。core 创建数量稳定不能证明视觉稳定，资源样本不能作为正常 WhatsApp 性能验收。详见 `stage51-native-navigation-loop.md`。本轮 Gate 仍为 Blocked，未修正该隔离导航缺陷或重新采样。

## 测试入口边界

WinUI 项目只有显式设置 `Stage51IsolatedUi=true` 才编译 `STAGE51_ISOLATED_UI`，并使用独立程序集/进程名 `Zhike.Stage51.Acceptance`；生产缺省的程序集、版本和入口不变。

- 必须显式提供 `ZHIKE_STAGE51_ROOT`，目录为当前 TEMP 下 `zhike-stage51-native-<32位 GUID>`。
- 必须存在内容恰为 `zhike-stage51-isolated-ui-v1` 的 `.stage51-isolated` 标记；禁止根目录链路中的重解析点。
- 根目录 ACL 去掉宽泛继承，允许当前 Windows 用户 SID 完全控制。
- App、AI 凭据、桌面工具、队列、WebView profile、窗口布局、账号索引、采集日志的默认路径只在测试构建映射到测试根；sidecar 额外检查其数据根精确一致。
- LocalServiceManager 构造函数在任何目录创建前验证/映射传入数据路径；真实构造探针确认不允许的外部路径被拒绝且没有创建目录。
- 测试构建只开启进程级 isolated group/AI/fencing 接口供临时数据联调，持久 Worker flags 文件仍未开启，正式 Worker 无执行路径。
- WebView 外部 HTTP/HTTPS 请求拒绝，WS 导航取消并落到 about:blank；后台 WS tick 不驱动任何真实采集。该空白原生 WebView 用于寿命/布局观察，不冒充 WhatsApp 会话。
- 原生 AI Bridge 除 status/cancel/selectworkspace 外拒绝真实 Provider 操作；审核使用当前临时 sidecar 的独立 fencing lease。
- `connection.private.json` 仅在上述当前用户专用目录保存当前隔离 sidecar 的临时 token。禁止提交或写入报告。无密钥的启动/窗口/WebView 创建、浏览器 PID、导航与关闭事件写入 `native-events.jsonl`。

资源准备脚本 `scripts/stage51/native-prepare.cjs` 只复制已有白名单源码/资源和不可变 Node 运行时，没有复制 app/data、真实 profile、业务库或凭据。

## 实际构建/探针

- `.tools/dotnet10/dotnet.exe build desktop/src/Zhike.Desktop/Zhike.Desktop.csproj -c Release --no-restore -p:Platform=x64 -r win-x64 -p:Stage51IsolatedUi=true -p:OutputPath=../../../.tools/stage51-native-v2/ --nologo -v:minimal`：Passed，0 warnings / 0 errors。
- `node scripts/stage51/native-isolation.test.cjs`：Passed。实际运行 C# 路径映射、越界拒绝、当前用户 ACL 探针。
- 缺省生产构建也实际执行：Passed，0 warnings / 0 errors；未启动生产 exe。
- StorageMode、desktop-startup、ResourceLifecycle、WsRuntimeResilience 既有专项：Passed。

## 冷启动实测与明确缺陷

第一次隔离进程 PID 20132 的时间线（UTC）：

| 事件 | 时间 |
| --- | --- |
| 进程创建 | 12:18:42.852 |
| App.OnLaunched 隔离根初始化 | 12:20:16.396 |
| sidecar 子进程创建 | 12:20:21.207 |
| 原生窗口创建 | 12:20:39.923 |

旧应用默认 15 秒健康等待链会捕获 WinUI SynchronizationContext，冷 XAML 初始化期间不能继续处理健康结果。另一个已直接确认的缺陷是 StopCoreAsync 仅发送 shutdown token；实际 sidecar 在 shutdown 路由之前要求 API token，所以返回 401，随后无界等待退出，重试/关闭停滞。

真实隔离 `NativeReadinessProbe` 用暂停的 SynchronizationContext 和实际 Node sidecar 复现。旧版结果为 “Sidecar readiness incorrectly depends on a running UI synchronization context”，清理也停在未授权的退出等待；核实子进程归属后仅终止该测试子进程 33600，使旧探针正常结束并清理其测试根。没有触碰生产 sidecar。

修复：

1. 退出请求携带 API 与 shutdown 两个临时授权头。
2. 退出使用与原恢复流程一致的 5 秒有界等待；必要时只终止由本对象创建并保存的进程引用，再以 2 秒等待确认退出，保留调用者取消异常。
3. 只对启动/健康的无 UI 服务链（包括启动失败的清理与重试延迟）使用 ConfigureAwait(false)，没有全项目改写 await。补齐重试分支前曾有一次慢环境复测失败，已如实记录，未拿早期两次成功替代后续复核。

`node scripts/stage51/native-readiness.test.cjs`（或 run-tests 中直接执行同一 C# Probe）：Passed，实际输出：

```json
{"ok":true,"readyWithoutUiPump":true,"cancellationPropagated":true,"unauthorizedShutdownRejected":true,"authenticatedGracefulShutdown":true,"exitCode":0,"productionOpened":false,"pendingUiCallbacks":0}
```

这证明独立的启动/关闭缺陷已被回归覆盖。首次原生进程在 App.OnLaunched 前约 93.5 秒的耗时还包括系统/运行时冷启动；未采集原线程栈，不能把全部冷启动耗时归因于该服务链修复。

## 桌面工具边界

第一版本沿用 Zhike.Desktop.exe 名称，CUA 将窗口误绑定到已安装应用身份，重复刷新/重置仍不能操作。第二版本改为独立进程名，仅在测试构建生效，以便真实桌面工具选择精确测试窗口。没有通过 PowerShell UI 自动化或直接调用 Win32 输入绕过该错误。

最终原生 UI、资源曲线和关闭清理是否完成，以父验收报告的实际 CUA/采样结果为准。

## 原生审核操作发现的契约与审计缺陷

第二次原生交互中，批准候选资料后候选仍为 pending。对当前隔离 sidecar 的只读诊断确认健康、任务、候选和审核租约正常，未出现成功审核记录；源码与真实接口核对发现 UI 仅在 URL 中携带候选 ID，但 Service 从 JSON body 读取 suggestionId，因此操作返回候选不存在。该结论不把用户可见的错误提示误归为凭据失效。

最小修复：

- `ai-review-center-ui.js` 的批准/拒绝请求包含 suggestionId；错误展示兼容原生桥接的 message/errorCode 格式。
- `server.mjs` 的人工资料保护产生 conflict 时，记录一次真实的 suggestion.conflict 审计；重复审核已处于 conflict 的候选不伪造新状态转换或重复审计。客户身份、人工字段保护、空字段和证据校验规则未改变。
- 测试壳的临时审核租约每 20 秒通过 renew 续约，不反复 acquire 轮换 fencing token。重新准备测试资源会清理测试 WebView 的磁盘/CacheStorage 缓存，保留当前临时业务记录及页面状态，确保复验使用最新 JS。

实际回归：`node scripts/stage51/ai-review-service-ui.test.cjs` 使用真实临时 sidecar、现有候选创建接口和真实 UI 点击处理器，验证批准后空职业字段补全、拒绝后不写入、人工语言字段保持原值、冲突状态与来源审计、重复冲突审核不追加审计及桥接错误详细信息。修复前批准断言失败；补齐请求后通过；缺少冲突审计的断言再次失败，补齐审计后通过。`scripts/stage5/ai-review-runtime.test.cjs`、`scripts/stage4/ai-review-center-ui.test.cjs`、`scripts/stage4/ai-pipeline-api.test.cjs` 也重新通过。该 Service/UI 事件回归仍不能替代最终原生点击复验，后者由主验收报告记录。
