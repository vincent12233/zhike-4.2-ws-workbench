# 知客 V4.1 原生隔离验收记录

2026-11-18 在 Windows 11 隔离 WinUI 验收程序中使用合成资料操作。运行元数据记录 Release、产品版本 `6.0.3+c586250`、WebView2 `157.0.4341.46`，应用 PID 为 24196。以下结论限这次运行所见。S3 整体门禁保持 **BLOCKED**，生产入口保持 **FROZEN**。

## 原生检查表

| 检查项 | 状态 | 实际观察 |
| --- | --- | --- |
| 浅色首页，窗口化和最大化 | 已操作 | 首页分别捕获 1422×815、1920×1140。原生事件在 00:27:49 记录 `IsMaximized=true`。 [窗口化](evidence/v41-native/captures/01-home-light-windowed.jpg) · [最大化](evidence/v41-native/captures/02-home-light-maximized.jpg) |
| 浅色、深色外观及客户中心 | 已操作 | 从外观偏好预览浅色和 Horizon 夜色，返回深色首页并进入客户中心，截图数据为隔离样本。 [浅色外观](evidence/v41-native/captures/03-appearance-light.jpg) · [深色外观](evidence/v41-native/captures/04-appearance-dark.jpg) · [深色首页](evidence/v41-native/captures/05-home-dark.jpg) · [客户中心](evidence/v41-native/captures/06-customer-dark.jpg) |
| 首页图表与客户表滚轮 | **BLOCKED** | 首页滚动后可见近 7 日趋势。客户表有一次滚动从 0 到 67 px。另一次在 DPR 1.25 下，前一指针命中 `td.phone-cell`，客户端坐标为 (831.2, 687.2)，随后滚轮在 (1039, 864) 命中 `footer.app-footer`。还有一次原始尝试未移动。当前证据确认输入落点偏差及单次有效滚动，尚未建立可重复的原生滚轮验收。 [未移动](evidence/v41-native/captures/07-wheel-no-movement.jpg) · [首页图表](evidence/v41-native/captures/08-home-chart-scroll.jpg) · [页脚命中](evidence/v41-native/captures/09-wheel-footer-hit-diagnostic.jpg) · [表格 67 px](evidence/v41-native/captures/10-wheel-table67.jpg) · [坐标诊断](evidence/v41-native/captures/13-wheel-coordinate-mismatch.jpg) |
| WS 首次进入、前台容器与复用 | 已观察，隔离范围 | 默认账号创建 1 个可见 Core，初次成功导航 `about:blank`。聊天区边界被接受，00:48:31 重开和 00:57:44 返回时均为 generation 1、`created=false`、`reload=false`。界面仍显示「连接失败」，其状态探测异常未记录。真实 WhatsApp 登录、聊天与收发未测。 [WS 首页](evidence/v41-native/captures/11-ws-home-dark.jpg) · [打开尝试](evidence/v41-native/captures/12-ws-open-attempt.jpg) · [生命周期](evidence/v41-native/lifecycle/native-events.jsonl) |
| WS 与知客工作台往返 | 已操作 | 00:49:36 从 WS 返回知客，00:57:43 再进聊天区。日志记录窗口展示切换成功，返回前后维持最大化，聊天区按路由隐藏及重新显示。 [生命周期](evidence/v41-native/lifecycle/native-events.jsonl) |
| 十次交替切号 | 未完成 | 本轮安全日志仅记录默认账号创建后复用。合成账号数量为 2 的展示未形成第二个 Core 或十次交替证据。 [WS 首页](evidence/v41-native/captures/11-ws-home-dark.jpg) · [生命周期](evidence/v41-native/lifecycle/native-events.jsonl) |
| 动效关闭 | 已操作 | 系统设置的「渐变流动与交互动画」显示选择「关闭动效」。本截图记录开关状态。 [动效关闭](evidence/v41-native/captures/14-motion-off.jpg) |
| 窗口捕获与关闭 | 用户已确认关闭 | 窗口捕获两次返回 outside monitor 后停止继续捕获。00:57:44 的操作截止点仍等待用户关闭，随后用户明确确认已关闭。核验范围见下文。 |

## 关闭后复核

用户确认已关闭。原生事件在 01:05:24 记录 `application-stopping`、`sidecar-stopped` 和 `host-unloaded`，这些事件证明应用进入并记录关闭流程。后续两次只读检查分别提供进程证据。 [生命周期](evidence/v41-native/lifecycle/native-events.jsonl)

- **01:06:52，采样进程身份。** 复核资源采样已记录的 9 个 PID 与启动时间，原身份仍存活 0 个，无法核实 0 个。资源采样在 00:42:43 结束，随后启动的 WS 进程不在这 9 个身份之内。 [进程身份复核](evidence/v41-native/lifecycle/native-cleanup.json)
- **01:12:34，隔离数据根引用。** 独立筛查命令行中精确引用该唯一隔离数据根的相关进程，结果为 0。此范围仅覆盖当时的精确路径引用。两次检查均未终止进程。 [目录引用筛查](evidence/v41-native/lifecycle/native-owned-processes.json)

隔离目录保留用于滚轮阻塞诊断。监听端口、文件锁和目录清理未作独立验收。

## 资源观察

共 **91 个样本，观察耗时 933815.3 ms**。进程计数样本覆盖当地时间 **00:27:10.127 至 00:42:43.543**。00:45 后的 WS 操作另见生命周期，处于这段资源采样窗口之外。样本末尾应用仍存活。

| 指标 | 首个样本 | 末个样本 | 观察峰值 |
| --- | ---: | ---: | ---: |
| 工作集，字节 | 794,517,504 | 908,697,600 | 985,419,776 |
| 私有内存，字节 | 418,877,440 | 511,844,352 | 571,383,808 |
| 线程 | 196 | 206 | 213 |
| 句柄 | 5,551 | 6,065 | 6,065 |
| WebView 进程数 | 6 | 6 | — |

资源状态为 **Observed**，性能阈值为 **NotDefined**，无自动通过结论。 [采样原文](evidence/v41-native/resources/v41-resources.jsonl) · [观察摘要](evidence/v41-native/resources/resource-observe.log)

## 归档与脱敏

留存 14 张原生窗口截图、14 个原始文本附件、2 份生命周期记录、2 份资源文件和 2 份关闭后复核记录。08、12、13、14 的 TXT 源文件为 0 字节，原样保留。截图源名使用 `.png`，实际字节为 JPEG，归档使用 `.jpg`，内容完整保留。逐张目视检查了隔离界面、合成数据与滚轮诊断。文件结构校验未发现 EXIF、文本元数据或末尾附加数据。

生命周期日志中启动时的本机绝对数据路径被替换为 `<isolated-root>/data`。其余 33 份源证据保持原始字节，包含新增的两份关闭后复核记录。文本模式扫描未命中凭据、CDP 临时地址或 Windows 用户 SID，归档中也没有本机绝对路径命中。源和归档 SHA-256 分列保存，共核验 35 个清单条目，含扫描记录。新增证据的扫描结果记在清单，原 33 个条目的哈希保持一致。归档阶段未重新运行应用、连接真实 WhatsApp 或访问 profile、数据库和连接文件。 [敏感内容扫描](evidence/v41-native/sensitive-scan.json) · [SHA-256 清单](evidence/v41-native/manifest-sha256.json)
