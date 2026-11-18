# V4.1 完成批次原生观察记录

**S3 原生门禁仍为 Blocked，生产入口保持 FROZEN。** 本记录仅覆盖同一个隔离 WinUI 进程的实际观察。前端资源运行点为 `f0daaf1`，宿主嵌入版本为 Release `6.0.3+545fbc1cb406e0c444e007ef4abecf0934375a9c`，两点之间没有 `desktop/src` 变化。环境为 Windows 11 `10.0.26300`、WebView2 `157.0.4341.46`，应用 PID `2928`。本次运行早于 WS 账号时间修复 `701d551` 及诊断导出最终修复 `0e05c82`。后续代码未装载进本次窗口。下列时间统一为 UTC。 [只读事实摘要](evidence/v41-completion-native/native-readonly-status.json) · [采样环境](evidence/v41-completion-native/completion-resources.context.json)

## 原生实际操作

|项目|本次观察|证据|
|---|---|---|
|WS 首页|进入并最大化。显示 1 个已加载账号、49 条合成会话、2 个合成群组。后台采集不可用，未读任务和提醒保留未知。原生事件只记录进入 `overview`、`accounts`、`chat` 三页。|[01 首页](evidence/v41-completion-native/captures/01-ws-home.jpg)|
|账号刷新|合成 seed 记录默认账号及 `native-b`，账号管理页刷新后仍只有默认账号，显示已加载 1 条。`native-b` 无法选择，十次切换与账号隔离未完成。默认账号的旧 SQLite 时间与宿主 DTO 的解析差异已定位。后续修复的原生复验另行记录。|[02 刷新仍一条](evidence/v41-completion-native/captures/02-account-refresh-one.jpg) · [只读事实摘要](evidence/v41-completion-native/native-readonly-status.json)|
|前台 Core 与状态|默认账号 generation 1 仅创建一个前台 Core，可见 `about:blank` 成功导航一次。后续再次打开记录同 generation、`created=false`、`reload=false`。状态探针记录 `isolatedPreview=true`，画面仍显示「未连接」。|[03 前台](evidence/v41-completion-native/captures/03-chat-open.jpg) · [原生事件](evidence/v41-completion-native/native-events.jsonl)|
|CRM 收展与返回|原生容器接受的宽度约为 1188.4 → 860.4 → 1188.4。返回知客时会话容器隐藏且退出命中测试。进入前与离开后的 HWND 相同，窗口放置记录逐字段一致，恢复窗口化。前五张截图为 1920×1140，返回截图为 1422×815。|[04 展开](evidence/v41-completion-native/captures/04-chat-crm-expanded.jpg) · [05 收起](evidence/v41-completion-native/captures/05-chat-crm-collapsed.jpg) · [06 返回](evidence/v41-completion-native/captures/06-return-restored.jpg) · [原生事件](evidence/v41-completion-native/native-events.jsonl)|

可信输入诊断显示本轮截图没有接收到实际滚轮。可重复滚轮、两张非空只读图表明细、关闭动效后的交互、WS 12 页和十次切号均待本轮原生复验。合成空白 Core 支持容器及生命周期观察。真实平台登录、收发及付费 AI 未执行。 [操作清单](v41-completion-native-checklist.md)

## 资源与关闭

实际采样 91 次，03:55:59.6327065 至 04:11:37.1496341，耗时 937,892.2 ms（15.63 分钟）。采样在宿主启动约 52 秒后开始，覆盖早段 WS 操作，在前台聊天收展及返回之前结束。没有配置性能门槛。 [采样原文](evidence/v41-completion-native/completion-resources.jsonl) · [采样上下文](evidence/v41-completion-native/completion-resources.context.json)

|指标|首样本|末样本|观察峰值|
|---|---:|---:|---:|
|工作集，字节|847,716,352|1,227,309,056|1,281,765,376|
|私有内存，字节|480,686,080|641,814,528|699,232,256|
|线程|228|325|362|
|句柄|5,572|8,879|8,882|
|WebView 进程数|6|12|—|

04:20:18.6453619 的只读关闭检查记录 `ObservedProcessesRemain`，15 个已观察进程身份仍在，无法核验数为 0。04:36:50.1555058 的独立检查仍看到相同 PID 和启动时间的隔离宿主，当时原生日志尚无应用停止、Sidecar 停止及宿主卸载事件。检查没有终止进程。 [只读事实摘要](evidence/v41-completion-native/native-readonly-status.json)

用户随后正常关闭窗口。同一 PID 在 04:51:54.9353838 至 04:51:55.2894244 依次记录应用停止、Sidecar 停止及宿主卸载。04:52:34.1832326 的只读复核确认 15 个已采样进程身份全部退出，仍存活与无法核验均为 0，检查没有终止进程。关闭结论限本次观察的进程身份。六张原截图仍为修复前版本，修复后的原生复验继续待执行。 [追加关闭事件](evidence/v41-completion-native/native-events.jsonl) · [关闭复核](evidence/v41-completion-native/native-readonly-status.json)

## 证据范围

六张截图均经目视检查，在原生隔离合成场景中取得。源文件扩展名为 PNG，字节为 JPEG/JFIF，以 JPG 原样归档。事件逐字段扫描，移除绝对临时数据根和动态 Sidecar 端口。资源及上下文只做 UTF-8/LF 规范化。只读摘要只保留已核对的进程、事件和计数字段。归档不包含连接文件、SQLite、浏览器配置、凭据、业务记录明细或截图的辅助文本。清单记录原始来源和归档字节各自的 SHA-256。 [证据清单与扫描记录](evidence/v41-completion-native/manifest-sha256.json)
