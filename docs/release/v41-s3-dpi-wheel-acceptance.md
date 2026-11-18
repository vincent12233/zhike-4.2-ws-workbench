# S3 原生 DPI 与滚轮验收

2026-11-18 本机 Windows 11 隔离 Release x64。固定版 PID 37872 在同一屏幕上完成 125% → 100% → 150% → 125%，HWND、XAML 与 DOM 在每档收敛。DPI 感知缺陷已验证修复，视觉矩阵及滚轮门禁仍有未完成项。生产保持 FROZEN。

## DPI 感知修复

基线 PID 41092 的实际 EXE 内嵌 manifest 没有 DPI 声明。现有窗口记录 `unaware`、96 DPI、XAML 1.0，同时 DOM DPR 为 1.25。共享 manifest 加入 `PerMonitorV2` 后，Windows SDK 对隔离 Release EXE 的 RT_MANIFEST #1 提取校验通过。修复前尺寸契约 3/4，新增声明检查按预期失败。修复后 4/4，探针专项另通过 1/1。隔离 Release 构建 0 warnings、0 errors。 [嵌入 manifest 与红绿回归](evidence/v41-s3-dpi/manifest-proof.json)

普通 Release x64 在 `eacc425` 构建通过，0 warnings、0 errors。Windows SDK 从 `Zhike.Desktop.exe` 提取并验证的 RT_MANIFEST #1 含唯一 `PerMonitorV2` 声明、29 项 SDK 文件注册和 `asInvoker`。提取前后 EXE 哈希一致。运行时证据来自隔离 EXE。 [普通 Release 嵌入 manifest](evidence/v41-s3-dpi/manifest-proof.json)

| 系统缩放 | 固定版 HWND / XAML / DOM | 实际窗口操作与外观 |
| --- | --- | --- |
| 125% | 120 DPI / 1.25 / 1.25 | 在 Windows 设置确认推荐的初始值。浅色首页和深色外观有截图，观察到还原及最大化。还原客户区 1534×881，最大化 1920×1111。 |
| 100% | 96 DPI / 1.0 / 1.0 | 深色还原及最大化有截图。还原 1226×703，最大化 1920×1129。完成客户表格内外滚轮对照与隔离 WS 预览。 |
| 150% | 144 DPI / 1.5 / 1.5 | 深色页面完成还原及最大化，客户区分别为 1840×1058 和 1920×1094。截图局部文字破碎，视觉完整性待复核。浅色和实际最小尺寸未执行。 |
| 恢复 125% | 120 DPI / 1.25 / 1.25 | 最大化客户区返回 1920×1111。Windows 设置复核回到 125% 推荐值，应用捕获中仍有局部文字破碎。 |

三次变化均维持 `per-monitor-v2`、PID 和同一显示器句柄。100% → 150% 时，HWND 先记录 144，约 78 ms 后 XAML 为 1.5，约 609 ms 后 DOM 报 1.5。150% → 125% 时，XAML 和 DOM 分别约 47 ms、547 ms 后收敛。WinUI 控件自身 `RasterizationScale` 字段始终为 1。WebView2 私有 controller 的 Bounds、BoundsMode 与缩放值无法从当前 WinUI 公共接口直接取得，几何实际以 WinUI 布局矩形和 DOM 视口核对。 [125% 至 100% 事件](evidence/v41-s3-dpi/fixed-native-home-wheel-and-scale.json) · [后续切换和退出事件](evidence/v41-s3-dpi/fixed-native-dpi-transitions-and-exit.json)

125% 浅色使用可见的 atelier-dawn 外观。探针记录的旧版 `data-theme=dark` 和宿主 `ActualTheme=Light` 属于不同字段。150% 的还原、最大化截图以及恢复 125% 后的捕获出现局部文字破碎，Windows 设置捕获也有相同现象。现有观察保留为捕获或渲染异常，具体来源待确认。150% 两张原始截图仍保存在本机 `.tools/s3-20261118/native`，文件名与 SHA-256 已入档。 [截图哈希](evidence/v41-s3-dpi/fixed-native-dpi-transitions-and-exit.json)

## 滚轮路由与隔离 WS

- **125% 浅色今日工作台。** 一次 CUA 垂直滚轮在 WinUI 和 DOM 同时取得投递证据。主内容两帧内从 0 移到 109.6 CSS px，侧栏与文档保持 0。约 67.4 秒后标题栏操作期间，另一条记录复用了第一次的底层指针时间戳、坐标和增量，主内容又有位移。额外投递来源尚未定位。 [首页滚轮记录](evidence/v41-s3-dpi/fixed-native-home-wheel-and-scale.json)
- **100% 深色客户中心。** 同样原生增量的两次独立输入，一次命中表格，一次命中表格外页面。表格命中时横纵偏移均为 0，父页有 441 CSS px 垂直范围但未移动。表格外命中后操作员观察到页面下滚，后续原生日志在另一条复用底层时间戳的事件进入前记录已经稳定到 333 CSS px。客户表格的 CSS 纵向边界限制与观测一致。提交 `1dfdba2`，集成为 `d768550`，仅允许客户中心横向表格将未处理的纵向输入交给页面。新增契约修复前失败，修复后四个定点文件通过，包含现有 13 项滚轮运行检查。PID 37872 使用 CSS 修复前资源，修复后原生短复验另记。 [客户表格内外对照](evidence/v41-s3-dpi/fixed-native-customer-table-wheel.json)
- **隔离 WS。** 登录与真实平台网络未启用。空白聊天面板对应预期的 `about:blank` 隔离预览，同次日志记录 Core 创建、导航成功及前台容器接受几何，未出现导航超时。 [隔离 WS 预览事件](evidence/v41-s3-dpi/fixed-native-ws-isolated-preview.json)

固定版 PID 37872 的隔离日志只记录两个 Core 创建，启动后的 shell 与进入群组页后创建的 WS 可见 Core 各一次。各次 DPI 切换和滚轮后均无新增 Core。12:10:44 UTC 正常关闭，随后记录侧车停止和宿主卸载。12:11:47.886 UTC 只读复查的 15 个已观察进程身份全部释放。 [原生退出事件](evidence/v41-s3-dpi/fixed-native-dpi-transitions-and-exit.json) · [持续资源与退出观察](../superpowers/reports/s3-performance-2026-11-18.md)

## 客户表格 CSS 修复后原生短测

125% 深色隔离 PID 39916 使用修复后的 CSS，记录 120 DPI、XAML 1.25、DOM DPR 1.25。窗口最大化。两次原生到达位置相同，均命中表格。第一次表内从 0 移至 66.4 CSS px，DOM 事件被表格接管，页面与横向偏移保持 0。第二次到达时表格已达边界，表内偏移保持 66.4，事件未被取消。两帧内页面偏移仍为 0，稍后截图可见页面整体约下滚 333 px，表内仍显示相同首行，HUD 表内偏移仍为 66 px。

两次 WinUI 底层指针时间戳分别为 `251340544382` 和 `251386279727` 微秒。第二次 HUD 所示约 45.7 秒是上次指针移动的年龄。该轮验证覆盖表内还有垂直范围和已到边界两种情形。100% 的零表内溢出场景未按原条件复验，注入来源和无额外投递的通用结论仍未闭合。截图仍可见局部文字破碎。该短测仅记录一个 shell Core，随后正常关闭。 [短测原生偏移、截图哈希与退出](evidence/v41-s3-dpi/fixed-css-native-customer-table-retest.json)

## 验收范围

- 本机三档系统 DPI 感知切换通过。各档真实最小外窗与双主题完整矩阵未闭合，100% 浅色组合、150% 浅色、150% 最小尺寸、跨屏和完整 UIA 复核未执行。
- 滚轮证据来自 CUA 注入，物理鼠标、高精度滚轮、触控板、原生 Ctrl+滚轮和完整内外层矩阵仍待验证。额外投递仍是独立未决项。
