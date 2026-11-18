# S3 原生 DPI、文字破碎与滚轮复验

基线为 `8cb12f4`。现有 PerMonitorV2 和客户表格纵向接续修复已进入基线。专项提交 `8362d83` 增加 Stage 5.1 隔离宿主的原生与 DOM 关联记录、静默后滚动偏移和 WebView2 原始 PNG 捕获。探针契约通过 1/1，滚轮和 WS 滚动定点检查通过 4/4，两条命令退出码均为 0，原有测试条目数保持不变。集成提交 `c19af33` 隔离 Release x64 构建 0 警告、0 错误，PID 25568 完成 100% 原条件复验，客户表格中的垂直滚轮接续到页面。Gate B 和 Gate C 保持 Blocked，Production 保持 FROZEN。 [基线报告](v41-s3-dpi-wheel-acceptance.md) · [探针日志](evidence/v41-s3-dpi-final/native-input-probe.log) · [滚动检查日志](evidence/v41-s3-dpi-final/scroll-contracts.log) · [隔离构建日志](evidence/v41-s3-dpi-final/isolated-release-build.log)

## 历史证据复核

历史目录的 16 个原图均经 SHA-256 对账。文件名扩展为 `.png`，解码格式为 JPEG。100% 最大化捕获宽 1920 px，125% 宽 1536 px，150% 宽 1280 px。后两档的 HWND 客户区仍宽 1920 物理像素。JPEG 文件密度字段依次为 96、120、144，尺寸与物理窗口按缩放比例缩小相符。150% 两张原图有可见的文字笔画缺损。125% 恢复后的后续捕获也报告局部缺损。这一复核确认了历史捕获存在缩小与 JPEG 编码环节。渲染、捕获采样与编码各自的贡献仍待同状态双路留证。 [原始截图](evidence/v41-s3-native/manifest-sha256.json) · [解码元数据](evidence/v41-s3-dpi-final/historical-wheel-and-capture.json) · [HWND、XAML 和 DOM](evidence/v41-s3-dpi/fixed-native-dpi-transitions-and-exit.json)

历史 PID 37872 出现两次额外投递。125% 首页的 WinUI 两次到达相隔 67,437 ms，DOM 两个事件时间相隔 67,444.9 ms，后一次主内容在两帧内从 433.6 移到 468 CSS px。100% 客户中心两次 WinUI 到达相隔 124,407 ms，DOM 相隔 124,403.7 ms，该页在后一次到达前已稳定至 333 CSS px。每组两次 WinUI 回调复用同一个指针时间戳、位置和增量。后一次实际光标分别处于标题栏和应用窗口之外，后者的应用失去前台焦点。DOM 序号、事件时间与接收时间共同证明当时发生了独立的第二次 DOM 派发。旧快照对两层分别限频，缺少 Windows 消息上下文、回调参数标识和全量到达记录，无法判定是注入回放、路由复用或其他输入来源。125% 的独立短测两次指针时间戳不同，HUD 的 45.7 秒描述的是上次指针移动距滚轮事件的时间。 [原始字段切片](evidence/v41-s3-dpi-final/historical-wheel-and-capture.json) · [首页滚动偏移](evidence/v41-s3-dpi/fixed-native-home-wheel-and-scale.json) · [客户中心对照](evidence/v41-s3-dpi/fixed-native-customer-table-wheel.json) · [修复后短测](evidence/v41-s3-dpi/fixed-css-native-customer-table-retest.json)

基线的 WinUI 处理器在 MainWindow 构造时注册一次，在关闭时解除注册。每次获准记录的回调直接调用当次 `args.GetCurrentPoint(RootShell)`，随后重建对象并追加日志。现有实现用弱引用键关联回调参数编号，表中仅保存编号。WinUI 处理器读取 `Handled` 和原始来源，DOM 探针只采集 `isTrusted` 事件，宿主 WebMessage 诊断分支记录后返回。仓库中没有其他原生滚轮订阅或滚轮转发路径。生产 DOM 协调器只移动选中的滚动容器。结合历史两端的新派发证据，应用日志自身回放旧记录的解释缺乏支持，框架收到的指针信息及上游输入或路由仍需在原条件下继续区分。 [WinUI 处理器](../../desktop/src/Zhike.Desktop/MainWindow.xaml.cs) · [宿主消息入口](../../desktop/src/Zhike.Desktop/Views/LegacyUiHostPage.xaml.cs) · [DOM 探针](../../scripts/stage51/native-input-probe.cjs) · [滚动协调器](../../resources/app/modules/scroll-coordinator.js)

## 本轮已采集的原生证据

- **100% 客户表格原条件通过。** 52 条合成客户的深色客户中心最大化，屏幕落点 (1000, 750)，HWND 96 DPI、XAML 1.0、DOM DPR 1.0。一次 Sky 注入纵向滚轮在 WinUI 记录 −400，DOM 记录 +333.33 CSS px。两层均指向表格；DOM 视口 1918×1115，表格纵向 601/601、横向 1221/1559，外层页面纵向 1013/1454。事件未被取消。前两帧全部纵向偏移仍为 0。静默 630.5 ms 后页面由 0 增至 333 CSS px，表格横纵、侧栏和文档均保持 0。该次是注入输入验证，Windows 回调上下文返回输入来源 `Unavailable`。 [原始宿主事件](evidence/v41-s3-dpi-final/native-25568.jsonl) · [截图清单](evidence/v41-s3-dpi-final/native-captures-sha256.json)
- **100% 双路对照。** 同一最大化客户页在滚轮前，F8 生成 1918×1115 的 442,922 字节原始 PNG，随后约 0.37 秒保存 1920×1152 的 Sky JPEG。两者内容布局一致，JPEG 包含 Windows 标题栏。此对照验证独立 PNG 捕获有效，支持后续对 150% 和恢复 125% 逐态配对比较。 [WebView2 原图](evidence/v41-s3-dpi-final/captures/stage51-preview-25568-001-7a29d246918943bab3d2b2fbec6d61ae.png) · [Sky 原图](evidence/v41-s3-dpi-final/captures/02-100-dark-customer-before.jpg)
- **125% 至 100% 切换。** 深色首页先在 125% 最大化，再还原并切换至 100%。同一进程、显示器和一个 shell Core，HWND 120→96，XAML 与 DOM 从 1.25→1，随后在 100% 最大化。实时调整后 `GetDpiForSystem()` 仍为 120，记录为会话系统 DPI 参考。缩放选项与 PMv2 窗口、XAML 和 DOM 实测值用于判定切换完成。名为 `01-125-dark-home-max.jpg` 的原图在原生还原记录后保存，外观也显示还原状态。125% 最大化有原生布局样本。 [原生事件](evidence/v41-s3-dpi-final/native-25568.jsonl) · [125% 原图](evidence/v41-s3-dpi-final/captures/01-125-dark-home-max.jpg)
- **150% 文字破碎定位。** 同一进程从 100% 调高至 150%，最大化的客户区为 1920×1094 px。随后还原至 1896×1070 px，HWND 144 DPI、XAML 1.5、DOM DPR 1.5，窗口仅有一个 shell Core。配对的 1893×1049 原始 WebView2 PNG 中可见侧栏、搜索框、表格与 HUD 文本完整，约 1.6 秒后保存的 1267×745 Sky JPEG 在相同内容有可见笔画断裂。该次破碎发生在 shell 捕获点之后，具体是系统桌面合成、Sky 采样或下采样与 JPEG 编码仍待同屏进一步区分。HUD 保留上一轮 100% 滚轮瞬间的 DPR，以对应这次原图的 `stage51-dom-frame` 为当前 DPI 依据。 [WebView2 原图](evidence/v41-s3-dpi-final/captures/stage51-preview-25568-002-e4fb8a32a0c94c4eacd7614f2633e0d7.png) · [Sky 原图](evidence/v41-s3-dpi-final/captures/06-150-dark-customer-focused-pair.jpg) · [配对事件与文件哈希](evidence/v41-s3-dpi-final/native-captures-sha256.json)
- **额外投递观察。** 100% 原条件滚轮后约 15 分钟至下一批观察到的滚轮，包含窗口状态、焦点和 DPI 变化，未出现历史同一时间戳的附加投递。150% 浅色客户页面随后记录八次外部纵向上滚，每次各有一个 WinUI 和 DOM 到达，指针记录时间戳、帧 ID 和 Win32 消息时间均不同。第一组由 322 CSS px 滚到页面顶部，后两组位于上边界。主控确认当时未发出这八次输入。Windows 回调上下文也未给出可识别来源，本轮物理设备验收保持 NotTested。短时间内的独立派发和历史旧指针复用可按现有记录区分，历史来源仍未闭合。 [关联日志](evidence/v41-s3-dpi-final/native-25568.jsonl)
- **恢复 125% 与第三条捕获路径。** 150% 浅色客户窗口记录了 OS 最小化，恢复后客户区回到 1896×1070 px。随后主控把 Windows 显示缩放改回 125%，同一显示器、PID 和一个 shell Core 下采到 HWND 120 DPI、XAML 1.25、DOM DPR 1.25。三次实时切换中，目标 HWND 记录至首笔相符 XAML／DOM 记录的间隔分别是 469／937 ms、78／578 ms、516／1016 ms。DOM 间隔包含探针消抖。主控尝试用 Windows 截图工具补取桌面图，因前台窗口 PID 不可用或遮挡而未生成结果，工具已关闭。 [恢复事件](evidence/v41-s3-dpi-final/native-25568.jsonl)
- **本机操作结束。** 用户要求暂缓桌面操作，恢复至 125% 后的独立双路图、本轮可见最小窗口和其余页面场景保留 NotTested。隔离宿主于 14:29:34 UTC 使用 Alt+F4 正常关闭，记录应用停止、侧车停止和宿主卸载。14:30:07.847 UTC 的只读检查确认 9 个已观察的进程身份全部释放。 [退出事件](evidence/v41-s3-dpi-final/native-25568.jsonl) · [进程身份检查](evidence/v61-s3-performance/s3-performance-final-25568.cleanup.json)

## 隔离运行与留证

按既有预检构建并准备隔离 fixture。加入 `ZHIKE_STAGE51_NATIVE_INPUT=1` 和 `ZHIKE_STAGE51_NATIVE_PREVIEW=1` 后启动隔离 EXE，并继续使用现有合成 seed。环境变量仅放在启动块内，保留外层原值。记录实际构建提交、PID、启动与退出、使用的系统缩放和窗口输出文件。性能循环使用独立会话。 [隔离构建、预检和种子命令](v41-completion-native-checklist.md)

```powershell
$zhikePriorRoot = $env:ZHIKE_STAGE51_ROOT
$zhikePriorNativeInput = $env:ZHIKE_STAGE51_NATIVE_INPUT
$zhikePriorNativePreview = $env:ZHIKE_STAGE51_NATIVE_PREVIEW
try {
    $env:ZHIKE_STAGE51_ROOT = $zhikeFixture.root
    $env:ZHIKE_STAGE51_NATIVE_INPUT = '1'
    $env:ZHIKE_STAGE51_NATIVE_PREVIEW = '1'
    $zhikeNativeProcess = Start-Process -FilePath $zhikeFixture.binary -WorkingDirectory (Split-Path -Parent $zhikeFixture.binary) -PassThru
} finally {
    $env:ZHIKE_STAGE51_ROOT = $zhikePriorRoot
    $env:ZHIKE_STAGE51_NATIVE_INPUT = $zhikePriorNativeInput
    $env:ZHIKE_STAGE51_NATIVE_PREVIEW = $zhikePriorNativePreview
}
```

- 在 Windows 显示设置确认每档缩放，再从同一运行进程的 `stage51-native-dpi` 和 `stage51-dom-layout` 看 HWND、XAML 和 DOM 的收敛过程。记录过渡与稳定两种状态。对于恢复 125%，确认最大化与还原的几何和视觉后复原初始设置。记录实际屏幕与窗口显示器。
- 在隔离 WebView 聚焦时按 F7 可切换输入 HUD。按一次 F8 获取 `stage51-dom-frame`，同次截图用进程 PID 和 `frameCount` 与 `stage51-preview-start`、`stage51-preview-complete` 对应。等待捕获完成后保持页、配色、滚动位置和窗口状态，取独立桌面/窗口捕获。保留双方的原始文件、字节数、实际编码、尺寸、SHA-256 和先后时间。
- `stage51-dom-frame` 包含实际配色、传统 DOM 主题、页面、弹窗和抽屉状态、应用与系统 DPI、窗口尺寸和最小尺寸、XAML 根及 WebView 可见几何、DOM 视口、物理光标和活动 Core 数。最小窗口按实际拉到边界的可见状态计，AppWindow 的 Minimized 状态另记。进入 WS 若触发自动最大化，应重新操作到目标状态再截图。
- 浏览器捕获来自当前 shell Core。桌面捕获包含窗口合成之后的图像。两者比较的是共同可视的 shell 文本，标题栏和独立的 WS 前台 WebView 由桌面帧检查。浏览器 PNG 清晰而桌面图破碎时，可缩小到 shell 之后的显示或捕获路径。若两者在同一区域同时破碎，检查页面绘制与 WebView 栅格化时间。若只有 DPI 变化附近出现，保留过渡和同状态稳定帧。缺少可独立观察的实际屏幕像素时，显示合成和桌面采样仍可能并存。 [WebView2 WinRT 捕获 API](https://learn.microsoft.com/en-us/microsoft-edge/webview2/reference/winrt/microsoft_web_webview2_core/corewebview2?view=webview2-winrt-1.0.2739.15#capturepreviewasync)

### DPI 外观矩阵

记录限于本轮 PID 25568。几何表示有窗口及 DOM 样本，双路对照表示已采集 WebView2 和 Sky 原图。150% 深色还原的两张原图呈现前述差异。任务栏最小化单独留证。

| 系统缩放与配色 | 可见窗口 | 首页 | 客户中心 | WS 工作台 | 设置 | 弹窗 | 抽屉 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 100% 浅色 | 最小 | NotTested | NotTested | NotTested | NotTested | NotTested | NotTested |
| 100% 浅色 | 最大化 | NotTested | NotTested | NotTested | NotTested | NotTested | NotTested |
| 100% 浅色 | 还原 | NotTested | NotTested | NotTested | NotTested | NotTested | NotTested |
| 100% 深色 | 最小 | NotTested | NotTested | NotTested | NotTested | NotTested | NotTested |
| 100% 深色 | 最大化 | 几何 | 双路对照及滚轮 | NotTested | NotTested | NotTested | NotTested |
| 100% 深色 | 还原 | 几何 | NotTested | NotTested | NotTested | NotTested | NotTested |
| 125% 浅色 | 最小 | NotTested | NotTested | NotTested | NotTested | NotTested | NotTested |
| 125% 浅色 | 最大化 | NotTested | NotTested | NotTested | NotTested | NotTested | NotTested |
| 125% 浅色 | 还原 | NotTested | 恢复后的几何 | NotTested | NotTested | NotTested | NotTested |
| 125% 深色 | 最小 | NotTested | NotTested | NotTested | NotTested | NotTested | NotTested |
| 125% 深色 | 最大化 | 几何 | NotTested | NotTested | NotTested | NotTested | NotTested |
| 125% 深色 | 还原 | Sky 原图及几何 | NotTested | NotTested | NotTested | NotTested | NotTested |
| 150% 浅色 | 最小 | NotTested | NotTested | NotTested | NotTested | NotTested | NotTested |
| 150% 浅色 | 最大化 | NotTested | NotTested | NotTested | NotTested | NotTested | NotTested |
| 150% 浅色 | 还原 | NotTested | 几何 | NotTested | NotTested | 主题预览。 [Sky 原图](evidence/v41-s3-dpi-final/captures/07-150-light-theme-modal.jpg) | NotTested |
| 150% 深色 | 最小 | NotTested | NotTested | NotTested | NotTested | NotTested | NotTested |
| 150% 深色 | 最大化 | NotTested | 几何 | NotTested | NotTested | NotTested | NotTested |
| 150% 深色 | 还原 | NotTested | 双路对照及几何 | NotTested | NotTested | 主题弹窗几何 | NotTested |

### 原生滚轮矩阵

| 用例 | 执行与证据 | 本轮状态 |
| --- | --- | --- |
| 100% 原条件 | 最大化、深色、52 条合成客户，屏幕 (1000, 750)。表格垂直范围为零、水平余量为正、页面有垂直余量。一次纵向输入后仅页面 `scrollTop` 从 0 到 333。 | 通过，Sky 注入 |
| 表内优先 | 在实际产生表内垂直余量的窗口尺寸，单次纵向输入使表内 `scrollTop` 变化，页面保持原值。到边界后的下一次输入单独记录。 | NotTested |
| 横向 | 表格存在水平余量，独立输入横向滚轮后记录原生横向标志、DOM 两轴增量、表格 `scrollLeft` 与页面 `scrollTop`。有 Shift 转换时记为单独路径。 | NotTested |
| 独立面板 | 选有垂直余量的客户抽屉或 WS 独立滚动区。单次纵向输入验证目标面板移动，CRM 页面与侧栏保持原值。边界额外采一次。 | NotTested |
| 额外投递 | 100% 单次注入后的窗口与 DPI 变动期间无旧记录重复。150% 八笔纵向到达的时间戳和帧均不同。 | 本轮未复现，历史来源待定 |
| 真实普通鼠标滚轮 | 使用真实鼠标，标记实际设备与操作时间。 | NotTested |
| 真实高精度滚轮与触控板 | 按实际可用设备分别观察各输入来源与增量，触控板惯性或手势作为单独记录。 | NotTested |
| 真实 Ctrl + 滚轮 | 同时记录原生修饰键、DOM `ctrl`、默认处理、视觉视口缩放和滚动偏移。 | NotTested |

WinUI `sequence` 标识一次回调，`managedArgsId` 只标识托管参数包装。`pointerId`、`pointerFrameId` 和 `pointerTimestampUs` 描述回调取到的指针信息。`lastMessageTimeMs`、消息位置与输入来源描述线程当时的 Windows 消息上下文。消息时间可能来自其他消息，且会回绕。使用 PID、UTC、接收 tick、当时的物理光标、焦点、坐标和增量一起核对。 `dispatchOrigin` 缺失时保留未知。 [Windows 消息时间](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-getmessagetime) · [消息输入来源](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-getcurrentinputmessagesource) · [WinUI 指针时间戳](https://learn.microsoft.com/en-us/windows/windows-app-sdk/api/winrt/microsoft.ui.input.pointerpoint.timestamp)

DOM 到达按 `domTimeOriginMs`、`wheelCount` 和 `eventMs` 追踪。同一路 DOM 文档可用时基加事件时间与宿主 UTC 对照。`stage51-dom-wheel` 保留两帧内的细粒度偏移，`stage51-dom-wheel-settled` 在末次输入静默 500 ms 后每隔 120 ms 检查，最多三次检查。仅 `offsetsStable=true` 且所需候选节点仍连在文档的样本可用于稳定偏移判断。持续输入在同一窗口内用首尾序号对账。记录出现 `wheel-limit` 的边界，超出可观察范围的动作保持待验。
