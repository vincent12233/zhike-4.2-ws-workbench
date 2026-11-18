# 阶段 5.2：隔离导航循环修复及回归

日期：2026-11-16（Asia/Calcutta）。输入基线 `37449b2`，阶段 5.1 修复 `3591212`。生产入口保持 FROZEN。本附件负责导航修复和可运行的状态机回归，真实 WinUI 交互、15 分钟资源观察及最终 Gate 由主验收报告登记；不能把下述 console probe 当作真实 WebView2 验收。

## 已确认的根因与证据边界

上一轮真实原生日志证明：V3 `NavigationCompleted` 11208 次、V2 6810 次，失败/成功交替，shell 各仅一次导航。阶段 5.1 中只读保留的调用链是：

1. `WsRuntimeService.ShowAccountAsync` 新建可见 session 时设置 WhatsApp Source，即使 opt-in 隔离构建没有授权网络。
2. 隔离 `OnWsNavigationStarting` 取消外部导航，同时在该回调中 `Navigate(about:blank)`，制造第二次导航。
3. 被主动取消的首次导航进入真实 `NavigationCompleted(false)` 恢复，清缓存后请求 WhatsApp；再次触发隔离取消与 blank 导航。

这条**主动取消被误当作可重试网络失败的反馈链**已经有原始事件及源码证据。旧恢复用 `HashSet<CoreWebView2>` 回调 sender 包装对象限制重试。WebView2 的 managed wrapper 不能作为 owned session 的稳定身份；已有桥接代码明确承认 callback wrapper 可不同。但上一轮没有记录 wrapper identity，不能声称已经实证每一次旧循环都是 wrapper 变化造成。本轮以不同 wrapper 的确定性回放验证这一防御缺陷，并让真实恢复不再依赖 sender identity。

## 最小修复

实际修改文件：

- `desktop/src/Zhike.Desktop/Services/WsRuntimeService.cs`：仅在 `STAGE51_ISOLATED_UI` 下新 session 的初始文档直接使用 `about:blank`；正式构建继续使用 WhatsApp 地址。
- `Views/LegacyUiHostPage.xaml.cs`：隔离 guard 只取消不允许的导航，不在取消回调中发起新导航；按 NavigationId 记录 policy cancellation。可见/采集 Core 的 handler 分开绑定并捕获已拥有的 Core、View、account、generation，不用 callback sender wrapper 判断所属表面。释放时分别解绑。
- 新增 `Services/WsNavigationLifecycle.cs`：每一个 account+pool generation+surface 只有一个稳定状态对象，拥有取消/完成 NavId、有界恢复预算、显式请求代次及异步恢复票据。

恢复范围与边界：

- policy cancellation、OperationCanceled、旧 NavId、重复完成、已释放 generation 均不触发自动恢复；真实未取消网络失败仍可以恢复，未被吞掉。
- 每个 surface 的当前显式生命周期至多一次自动清缓存重试；普通成功、自动重试本身、十页展示切换或选择已存在账号均不自动重置预算。
- 真实用户刷新/重连、用户发起且非 redirect 的新文档导航允许重置；新 pool generation 自有新的预算。没有按 URL 全局去重，不阻止合法同 URL 刷新。
- 清缓存 await 返回后再次检查 pool ownership 和恢复票据，旧异步恢复不能覆盖随后发生的新导航/重连/释放。
- 可见面与后台面、不同账号、不同代次预算独立。没有改变采集、CRM、群组或任务业务规则。

## 有界诊断与真实事件

仍沿用已验证的 `Stage51IsolatedUi=true`、独立程序集名和临时目录 marker，未新增生产开关。诊断不记录原始 URL、聊天文本、Token 或完整 SID。

`Stage51Isolation.Record` 每进程每 kind 最多写 256 条事件；`native-event-counts-<pid>.json` 记录 total/emitted/suppressed。计数文件通过同目录临时文件加 `File.Move(overwrite:true)` 原子替换；每 32 条以及 Core 创建/sidecar 停止时刷新，正常退出最终计数包括所有抑制事件。不能把可见日志行数当事件总数，实时快照可能落后不足 32 条。

新增实际诊断：host Loaded/Unloaded/route request、WS 初始化、账号选择、workspace page enter/exit、navigation-starting/completed 和 SourceChanged。原有 Core 创建、导航完成、应用启动/停止日志保留。导航 start/completed 具有 accountId、generation、surface、NavigationId、请求 source、request sequence、cycle、outcome/retry count，可追踪触发到恢复。SourceChanged API 本身没有 NavigationId，当前只记录角色/账号及时间，不伪称 SDK 提供该字段；关联以实际 start/completed 和 owned surface 为准。

workspace 诊断脚本只在隔离 shell 内观察导航节点的 aria-current 切换，经现有源 origin 检查及固定十页 allowlist 收取 enter/exit；没有读取 WhatsApp 文本或向前台聊天注入采集脚本。

## 隔离初始化失败恢复钩子

测试进程显式设置 `ZHIKE_STAGE52_FAIL_WS_INIT_ONCE=<accountId>`，该账号第一次工厂调用在 **before-Core** 阶段注入一次明确异常；记录 account/generation/阶段，没有创建假 Core 或返回成功。用户下一次打开/重连会走现有真实 factory、profile/environment 及 EnsureCoreWebView2Async。

它验证的是 session factory 初始化失败与真实重试路径，不能冒充 WebView2 Runtime 内部故障本身。钩子不存在于缺省正式构建。原生验收需记录第一次失败、第二次真实 Core 创建、未留下错误 session 或重复事件订阅。

## 实际自动化测试

1. `node scripts/stage52/navigation-lifecycle.test.cjs`：Passed。直接编译并执行正式使用的 `WsNavigationLifecycle` C# 类，不是返回固定 JSON 的空实现。旧 wrapper identity 集合回放 1000 个不同包装对象会允许 1000 次“第一次”；同一稳定 surface 回放只允许一次恢复。覆盖主动取消 999 次零恢复、真实失败、显式刷新/重连、普通成功不无限重置、OperationCanceled、重复完成、stale recovery ticket、释放后拒绝、账号及 collector 独立预算。模拟展示选择不等于实际十页 WebView，输出明确 `realWebViewCore=NotMeasuredByThisProbe`。
2. `node scripts/stage51/native-isolation.test.cjs`：Passed。使用真实临时目录与 ACL、越界构造拒绝，并新增 1024 次诊断事件的实际写入断言：256 emitted、768 suppressed、total=1024，原子计数 JSON 可解析。
3. `node desktop/tests/WsCollectorNavigationRetryRuntimeTests.cjs`：Passed。
4. `node scripts/stage3/ws-workbench-navigation.test.cjs`：Passed。
5. `node desktop/tests/WsProcessSessionPoolContractTests.cjs`：Passed。
6. `node desktop/tests/DesktopSmokeTests.cjs`：Passed。

原生构建第一次发现测试诊断桥误用不存在的 `GetString`，保留失败日志 `.tools/stage52-navigation-native-build.log`；修正为文件现有 `StringValue` 后，父任务执行最终隔离 Release 构建：`.tools/stage52-navigation-native-final-build.log`，0 warnings / 0 errors、30.90 秒。更早缺省构建的 nullable warning 也已增加非空 guard，最终缺省编译以主验收的本轮实际输出为准。

测试输出 `.tools/stage52-native`，准备脚本 `scripts/stage52/navigation-native-prepare.cjs` 仅复制白名单资源/不可变 Node，不复制现有 data/profile/凭据；父任务新建标记根并负责真实 UI，未复建已删除的旧三目录。本子任务没有启动原生应用、登录真实 WS 或操作生产 SQLite。

## 合法刷新按钮的实际联调修复

父任务真实点击概览“刷新页面”后出现 `unsupported WS action`，没有新导航事件。定位为现有前端按钮 `data-ws-action="reload"` 经 `connectionAction(action)` / `wsBridge(action)` 发送 `reload`，而 Native switch 仅实现了 `reconnect`。

最小修复仅增加 `case "reload"` 与已有 `case "reconnect"` 共用 `OpenWsOverlayAsync(reload:true)`。原有账号身份、取消令牌、pool ownership、显式恢复预算边界全部保留，没有新增刷新实现或采集动作。专项增加实际可见按钮与 Native 显式分支的跨层契约检查，并继续执行真实 C# 生命周期 probe；已实际 Passed。这一契约检查不替代下面的真实按钮操作。

## 父任务真实 WinUI 验收证据

详见 `stage52-native-desktop.md` 和资源附件。父任务使用全新标记临时根、真实 WinUI/Core/sidecar，完成初始化一次故障后的真实工厂重试、十页与十次账号切换、成员/AI/CRM 操作和正常退出。正式资源窗为 91 样本、15.59 分钟；后半页面及部分账号切换在采样窗之后有独立快照与事件，不被伪称均位于该曲线内。

刷新 alias 在此观察之后才补齐。随后相同合成隔离根、最终隔离构建（0 warnings / 0 errors，20.24 秒）启动 PID 3884，真实执行 B 概览、刷新两次、重连一次、A 概览及群组/成员返回。未重新 seed 或复制生产 profile。最终正常关闭计数为 navigation-starting=5、navigation-completed=5：B 首次加三次显式刷新/重连、A 首次；均 isolated-document、retries=0。Core 总数为 3（shell+两个账号），刷新及页面选择未重建 Core。完整计数所有 suppressed=0；raw 事件 NavId、source=explicit-refresh-or-reconnect、递增 cycle 和 reload=true 可关联。

计数刷新边界最终另外包含测试专用 `application-stopping` / `host-unloaded`，确保正常关闭后低于 32 的尾部事件也完整落盘；该变化只影响隔离诊断，不改变正式关闭业务或导航状态机。

因此本轮隔离导航循环复现关闭、合法同 URL 刷新和原生恢复路径有真实证据，相关范围 `Passed`。没有把 blank Core 当成真实 WhatsApp 登录或聊天验收。完整回归、Worker 重复验证、最终缺省 Release、临时目录及最终 Gate 仍以 `stage5-acceptance.md` / `stage5-2-stability.md` 汇总为准。

## Worker 修改只读复核

按父任务要求对 WorkerSupervisor 本轮生产 diff 做只读复核，未修改该部分。已核查 requestGate 只由实际获得者释放、生命周期锁内捕获同一认证 pipe/token/session 快照后再做 IO、取消清理只失效被捕获旧 pipe、不误清旋转后的新 generation、既有 750ms 清理预算覆盖取消写入与排空、owned process 而 pipe 失效时真实重启。未发现本轮新增的明确阻断缺陷；没有把未复现的旧 StopCore kill 后退出确认风险写成已证明故障。实际根因和 20 次/并发结果以 Worker 附件为准。

生产入口继续 FROZEN；无真实 WS、正式 Worker、付费 AI、生产迁移、双写或规则变更。撤回本轮源代码可在审查后 revert 本轮独立提交，不覆盖用户数据。
