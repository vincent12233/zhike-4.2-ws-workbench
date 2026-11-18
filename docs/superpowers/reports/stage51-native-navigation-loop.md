# 阶段 5.1 原生隔离 WS 导航循环局限

## 验收结论

状态：`Blocked`。归档原生事件后发现，隔离空白 WS WebView 存在高频失败/成功导航交替。稳定的 CoreWebView2 创建数量只说明没有反复创建 core，不能证明 WS 视觉、导航或资源稳定。本轮资源曲线反映的是包含该异常导航负载的隔离测试进程，不能据此宣称正常 WhatsApp 聊天已达到性能目标。

该现象来自未登录、阻断外网的测试构建；没有真实 WhatsApp 页面或生产账号参与。不能把它直接等同于生产闪屏根因，也不能忽略它对本轮原生验收有效性的影响。

## 真实日志统计

只读解析本轮保留根内的 `native-events.jsonl`，没有重启应用、修改源码或清理目录。脱敏归档见 `stage51-native-lifecycle-events.jsonl`。

| 指标 | V2 / PID 18128 | V3 / PID 32904 |
| --- | ---: | ---: |
| ws-visible NavigationCompleted | 6810 | 11208 |
| success = true | 3405 | 5603 |
| success = false | 3405 | 5605 |
| 测试隔离 guard 阻断导航 | 3405 | 5604 |
| 相邻 WS 完成事件间隔中位数 | 16.16 ms | 25.96 ms |
| shell NavigationCompleted | 1 | 1 |
| WebView core 创建事件 | 3 | 2 |

V2 首末 WS 完成事件：`2026-11-16T18:06:02.7222916+05:30` 至 `18:17:47.1711556+05:30`。

V3 首末 WS 完成事件：`2026-11-16T18:33:32.5560304+05:30` 至 `18:49:28.1984017+05:30`。

V3 初始序列中，18:33:32.5401 阻断外部导航，18:33:32.5560304 记录 about:blank 失败，18:33:32.6081093 再次阻断，18:33:32.6113331 再次失败，随后记录 about:blank 成功。后续大量失败/成功事件继续交替。事件日志未记录原始 URL、凭据或完整 SID。

## 已确认的调用链与证据边界

代码路径位于 `desktop/src/Zhike.Desktop/Services/WsRuntimeService.cs` 和 `desktop/src/Zhike.Desktop/Views/LegacyUiHostPage.xaml.cs`：

1. `WsRuntimeService.ShowAccountAsync` 创建新 session 时，仍把 View.Source 设置为 WhatsApp 地址。
2. 仅在 `STAGE51_ISOLATED_UI` 编译分支中，`OnWsNavigationStarting` 对非 about:blank 导航设置 Cancel=true，并在同一事件回调调用 `core.Navigate("about:blank")`。
3. `CreatePooledWsSessionAsync` 内的实际 `NavigationCompleted` 恢复处理没有把“测试 guard 主动取消”与真实导航失败分开。失败时尝试把 completedCore 放入 `retriedAfterNavigationFailure` HashSet，清理缓存后重新 Navigate 到 WhatsApp 地址。
4. 恢复发起的 WhatsApp 导航会再次触发测试 guard 的取消和 about:blank 导航。原始日志中 blocker 与失败/成功数量相符，证明该取消与恢复链在本轮被高频触发。

测试构建的 `WsRuntimeService.TickAsync` 已直接返回，不运行后台采集或 10 秒心跳适配；因此不能把本轮约数十毫秒的事件交替归为后台采集 tick。

失败恢复原本有“每 core 一次”的 HashSet 保护。为何它未限制本轮反复恢复，现有日志不足以唯一定位。源码其他位置已明确 CoreWebView2 事件可能返回不同 managed wrapper，因此基于 callback sender 包装对象的 HashSet 身份是一个待验证点；本轮未记录 wrapper 身份、NavigationId 或恢复计数，不能把该可能性写成已经证明的根因。也未做生产页面或真实网络复现。

## 对已有结果的修正

- 本轮 shell 页面交互、真实临时 Service 的审核写入/拒绝/冲突证据仍是各自操作结果，不能扩展为真实 WS 聊天稳定验收。
- core 数量和浏览器进程寿命可作为计数观察保留，但“core 未重建”等于“没有抖动/闪屏”的结论不成立。
- 进程内存、线程、句柄样本必须保留异常导航负载这一限定条件；不能用它们证明正常前后台 WS 隔离运行的资源目标。
- 本轮没有验证真实 WhatsApp 登录、聊天、后台采集或登录态，相关验收继续 Blocked。

## 后续必要工作

下一轮需先修正测试隔离导航语义，让空白测试入口不触发真实网络失败恢复；不能通过放开网络、使用生产登录态或吞掉所有真实导航错误来绕过。应补充脱敏 NavigationId、是否主动隔离取消、恢复次数与 session generation，验证恢复保护确实有界。完成最小修复及回归后，重新进行原生交互和资源采样。

当前授权要求只读诊断，本次没有修改该逻辑、重新运行或删除任何临时资源。V3 原始资源根仍为 `C:\Users\酷酷\AppData\Local\Temp\zhike-stage51-native-92eccfc80f164b15b7fcd1618058cb21`，按主验收的清理审批结果保留。最终 Gate 继续 Blocked，生产入口继续 FROZEN。
