# V4.1 原生隔离复验

2026-11-18 使用 `Stage51IsolatedUi=true` 的 WinUI Release 在全新隔离根复验。可执行文件版本为 `6.0.3+545fbc1cb406e0c444e007ef4abecf0934375a9c`，编译 0 警告、0 错误，耗时 26.24 秒。截图记录当次运行的前端资源，编译版本来自可执行文件属性。隔离种子包含 2 位合成 CRM 客户。以下时间为本机时间 UTC+05:30。**S3 仍为 BLOCKED，生产仍为 FROZEN。** [运行准备](evidence/v41-modern-native/run/native-prepare.json) · [隔离构建](evidence/v41-modern-native/run/native-build.log) · [合成种子](evidence/v41-modern-native/run/native-seed.log)

|检查|状态|实际证据|
|---|---|---|
|首页浅色、深色和客户中心|Observed|同轮最大化截图见两种主题。客户中心显示 2 条合成资料、7 个摘要指标和右侧档案预览。|
|WS 工作台与隔离容器|局部 Passed|02:58:21 为默认账号创建唯一一个 `ws-visible` Core，generation 1。唯一一次 WS 导航成功到 `about:blank`，分类为 `isolated-document`。四条状态记录为创建前 generation 0、容器未打开，随后三条为 generation 1、容器已打开。三张聊天截图均显示「未连接」。|
|聊天 → 总览 → 聊天复用|局部 Passed|03:01:27 离开聊天后 Core 仍存在，覆盖层为隐藏且不接收输入。03:02:00 返回后边界获接受，覆盖层恢复可见并接收输入。全轮未记录新的 Core 或导航。|
|右侧 CRM 面板|局部 Passed|首次聊天截图为收起，下一张为展开；回到聊天后仍为展开，显示当前会话未匹配客户主档的空态。|
|正常关闭|局部 Passed|PID 16544 于 03:02:34 记录应用关闭、sidecar 停止和宿主卸载。03:03:09 的独立复查记录宿主已不在、唯一隔离根的精确进程引用为空。|

原始窗口截图均为 1920 × 1140。生命周期记录了最大化状态和 `rasterizationScale=1` 的样本。 [浅色首页](evidence/v41-modern-native/captures/01-home-light.jpg) · [深色首页](evidence/v41-modern-native/captures/02-home-dark.jpg) · [客户中心](evidence/v41-modern-native/captures/03-customers-dark.jpg) · [WS 总览](evidence/v41-modern-native/captures/04-ws-overview-dark.jpg)

[聊天与检测状态](evidence/v41-modern-native/captures/05-ws-chat-unconnected.jpg) · [CRM 展开](evidence/v41-modern-native/captures/06-ws-crm-expanded.jpg) · [返回聊天](evidence/v41-modern-native/captures/07-ws-chat-returned.jpg) · [生命周期](evidence/v41-modern-native/lifecycle/native-events.jsonl) · [关闭后独立复查](evidence/v41-modern-native/run/native-closed.json)

本轮覆盖一个默认账号和一次聊天页往返。十次交替切号、真实 WhatsApp 登录和收发、完整原生页面和 DPI 矩阵、滚轮及关闭动效均未验收。关闭记录只覆盖宿主和按隔离根匹配的进程引用。RD02 后台采集仍为停用状态。

归档保留 7 张截图原字节和对应 7 份文本，其中 4 份仅记录截图观察。目视确认截图只含隔离界面与合成资料。JPEG 结构检查未发现 EXIF、文本元数据或附加数据。三个文本中的本地浏览器地址已替换，准备、启动、编译和生命周期的本机路径已脱敏。生命周期由 48 行整理为 44 行，省略不属于复验范围的 profile 创建标记和拖动诊断，移除两处本地端口字段。每份来源及归档副本均有 SHA-256 和字节数记录。 [观察摘要](evidence/v41-modern-native/observation.json) · [敏感扫描](evidence/v41-modern-native/sensitive-scan.json) · [SHA-256 清单](evidence/v41-modern-native/manifest-sha256.json)
