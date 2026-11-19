# 隔离 WebView2 测试宿主复测

2026-11-19。使用真实 WebView2 和独占临时 profile 复查上一轮两项关闭验证失败。上一轮全量在 `18b0d25` 为 **320/322**，Stage 5.1 工作区布局与 S1 主界面仍按那一轮的结果记录。本文的新证据来自测试宿主。产品 WinUI、业务数据服务和生产入口均沿用原实现。[上一轮运行验收](runtime-release-acceptance.md)

## 保留失败与精确定位

| 运行 | 已观察结果 |
| --- | --- |
| 原 WinUI 测试宿主加诊断，`1795058932783…` | 6 组布局结果已取得。宿主确认收到关闭命令，`view.Close()` 返回，父进程在约 5.75 秒收到该 Core 的正常退出通知。到 30 秒仍未观察到宿主自然退出，受控终止后无法把该次核验计为通过。[运行日志](evidence/renderer-controller-2026-11-19/diagnostic-winui.log) · [宿主阶段](evidence/renderer-controller-2026-11-19/diagnostic-winui.stderr.log) · [生命周期](evidence/renderer-controller-2026-11-19/diagnostic-winui.lifecycle.json) |
| 首次 Win32 Controller 构建，框架依赖部署，`1795059289139…` | 6 组布局结果已取得。宿主约在 21.1 秒记录 `controller.Close()` 返回，在 30 秒期限内未观察到该 Core 正常退出，仍为失败。部署方式与失败之间没有建立因果关系。[运行日志](evidence/renderer-controller-2026-11-19/framework-dependent-layout.log) · [宿主阶段](evidence/renderer-controller-2026-11-19/framework-dependent-layout.stderr.log) · [生命周期](evidence/renderer-controller-2026-11-19/framework-dependent-layout.lifecycle.json) |

共享运行器在关闭协议遇到 stdout EOF 时先检查尾部数据。缺少有效关闭响应会立即失败并保留实际退出码。已经在期限内发生的进程退出和流关闭使用各自的原始时间点。受控负例确实复现旧版把实际退出码 9 报成超时，修正后保留 EOF 与退出码。全局 30 秒期限、正常退出和清理断言维持原有要求。旧的 WinUI 测试宿主崩溃和自然退出延迟的底层原因仍未确认。代码修正为 `44a517b`。

## 自包含 Controller 复测

独立测试程序改用 Windows Forms 提供测试窗口与 STA 消息泵，由真实 `CoreWebView2Controller` 承载渲染，避开 WinUI Composition 这条测试宿主路径。宿主采用自包含构建，运行配置包含 .NET 和 Windows Desktop。仍使用原生产页面夹具、同一 WebView2 SDK、独占临时 profile、资源限制、原始布局断言和截图校验。运行器核对精确 Core 的正常退出、宿主自然退出、输出流关闭和已观察进程身份。通过标准不依赖备用渲染器。

| 专项 | 已完成 |
| --- | --- |
| Stage 5.1 工作区布局 | 6 个有效视口模型和原有布局断言通过。精确 Core 正常退出，宿主以代码 0 自然退出，输出流关闭且资源回查通过。[专项日志](evidence/renderer-controller-2026-11-19/self-contained-layout.log) · [生命周期](evidence/renderer-controller-2026-11-19/self-contained-layout.lifecycle.json) |
| S1 主界面 | 8 个视口 × 20 路由断言通过，随后完成 2 次主题复测和 4 次截图校验。7 次调用各自独立保留生命周期与页面断言完成标记。[专项日志](evidence/renderer-controller-2026-11-19/self-contained-main.log) · [主矩阵标记](evidence/renderer-controller-2026-11-19/self-contained-main-1.assertions.json) |
| 最小合成矩阵 | 5 次串行启动、实际渲染、请求关闭及正常释放全部通过。5 次记录的宿主生命周期约为 2.34 至 3.36 秒。[重复运行日志](evidence/renderer-controller-2026-11-19/self-contained-normal-repeat.log) |
| 网络资源拒绝 | 1 次通过。测试将回环 HTTP 端点当作禁止的网络脚本来源，浏览器报告加载失败，脚本未执行，监听器收到 0 个 TCP 连接、0 个 HTTP 请求。证据只覆盖此受控请求，不接触真实外网服务。[专项日志](evidence/renderer-controller-2026-11-19/self-contained-network.log) · [页面断言](evidence/renderer-controller-2026-11-19/self-contained-network.assertions.json) |

成功的 14 次生命周期与 13 份独立页面断言标记留档。Stage 5.1 页面断言完成记录在专项日志。两份失败生命周期和宿主阶段日志分别保留。构建配置、日志和证据各有原始及归档 SHA-256；测试窗口截图和临时 profile 不纳入归档。[校验清单](evidence/renderer-controller-2026-11-19/manifest.json)

## Controller 首次全量与同一二进制复测

Controller 首次全量 **317/323**，退出状态为 1。Stage 5.1 工作区布局、S1 主界面、S1 WS 和 S3 客户表均在结果期限内未完成验证，四次也未能确认清理安全。受控 PowerShell 文件锁用例在进程退出阶段超时，无旧版迁移契约在业务断言后清理临时目录时得到 `EPERM`。共六项失败，仍按该轮原结果记录。[全量日志](evidence/renderer-controller-2026-11-19/first-controller-full-regression.log) · [Stage 5.1 生命周期](evidence/renderer-controller-2026-11-19/first-controller-failed-stage51-layout.lifecycle.json) · [S1 主界面生命周期](evidence/renderer-controller-2026-11-19/first-controller-failed-s1-main.lifecycle.json) · [S1 WS 生命周期](evidence/renderer-controller-2026-11-19/first-controller-failed-s1-ws.lifecycle.json) · [S3 生命周期](evidence/renderer-controller-2026-11-19/first-controller-failed-s3-table.lifecycle.json)

随后在产品 UI 未启动的条件下，用首次全量的同一宿主二进制单独复测 Stage 5.1 与 S1 主界面，逐次匹配 EXE、程序集和运行时配置的指纹。两项脚本均以代码 0 完成，共 8 次宿主调用均通过正常 Core 退出、宿主退出、输出流关闭和进程身份回查。修正记录显示期间只有迁移测试文件变化。这组复测支持故障有运行条件差异，具体由哪些竞争因素触发仍未确定。[复测命令、结果与指纹](evidence/renderer-controller-2026-11-19/same-binary-no-product.command.json) · [布局专项](evidence/renderer-controller-2026-11-19/same-binary-stage51-layout.stdout.log) · [主界面专项](evidence/renderer-controller-2026-11-19/same-binary-s1-main.stdout.log)

## 测试基础设施复验

| 范围 | 复验 |
| --- | --- |
| 无旧版迁移用例清理 | 首次全量在删除临时根时返回 `EPERM`，当次持锁者仍未确认。隔离红测使用随包 Node，将本次 Sidecar 的正常退出延迟 2,400 毫秒，复现旧测试在退出码仍为 `null` 时已进入清理路径。修正后，正常和延迟退出两种专项均通过。测试先核对本次 PID 所属锁、认证关闭响应、实际正常退出及锁移除，随后才删除已核验的临时根。每个 HTTP 请求和响应体共享 5 秒上限，两个用例在全量中分别运行，保留各自原有的 120 秒外层上限。故障根按原证据保留。相关提交为 `8b533b0`、`43f6a6e` 和 `dc9c372`。 |
| PowerShell 独占文件锁用例 | 失败运行通过真实 `EBUSY` 恢复断言，10 秒期限内没有观察到 PowerShell 退出。新增本机测试诊断记录 stdin 写入、命令分类、退出意图与实际 exit，日志中无端点。10 秒正常路径与 4 秒有界负例分别通过专项。负例保留预期的就绪超时，仍观察到退出码 0 和安全清理。相关提交为 `43f6a6e`。[全量失败生命周期](evidence/renderer-controller-2026-11-19/first-controller-failed-powershell-file-lock.lifecycle.json) · [正常路径](evidence/renderer-controller-2026-11-19/powershell-marker-exclusive.lifecycle.json) · [有界负例](evidence/renderer-controller-2026-11-19/powershell-marker-bounded.lifecycle.json) |

## 冻结点最终串行回归

冻结点 `dc9c372` 的最终串行全量 **324/324**，退出状态为 0。该运行使用默认 WebView2 验收后端，每次原生渲染调用保留 30 秒全生命周期预算。Stage 5.1 布局、S1 主界面与 WS、S2 指标和 S3 客户表自动化全部通过。正常与延迟关闭的迁移测试以及受控进程所有权测试也通过。13 项原生协议断言通过，覆盖不完整输出、提前关闭、失败结果和实际退出证据。[全量日志](evidence/renderer-controller-2026-11-19/final-serial-full-regression.log) · [协议测试](evidence/renderer-controller-2026-11-19/final-serial-webview-protocol.log)

实际在仓库根目录运行：

```powershell
$env:ZHIKE_WS_VISUAL_SCREENSHOTS='1'
& resources/app/node.exe scripts/run-tests.cjs all
```

本轮新增两项聚合检查：实际 Controller 正常释放与网络拒绝、延迟 Sidecar 退出后的清理，原有检查未删除。文档完成后另行通过 `tests/current-docs-consistency.test.cjs`、`tests/release-6.0-consistency.test.cjs` 与 `git diff --check`。本轮相对已发布源码的产品目录 `desktop/` 与 `resources/` 没有改动。

13 次真实 Win32 Controller 调用的记录均与该轮新构建宿主的 EXE、程序集和运行时配置 SHA-256 一致。每次都验证了精确 Core 的正常退出、宿主代码 0、输出流关闭及已观察进程的安全释放。12 次另有页面断言完成标记，Stage 5.1 的断言完成记录在全量日志。S1 主界面四张截图只归档已复核的尺寸、字节数与 SHA-256。S1 WS 矩阵使用默认 WebView2 后端，同一脚本按附加配置使用 Edge 输出两张补充截图。历史显式 Edge 专项的结果仍单独保留。[实际运行与截图指纹](evidence/renderer-controller-2026-11-19/final-serial-native-index.json)

## 产品验收范围

实际产品 WinUI 项目的非隔离 Release 构建使用 x64 和 `win-x64`，退出状态为 0，0 个警告、0 个错误，耗时 22.99 秒。另一次隔离验收 Release 构建同为 0 个警告、0 个错误，耗时 23.34 秒。构建结果独立于安装和产品实操记录。[产品 Release 构建](evidence/renderer-controller-2026-11-19/product-winui-release-build.log) · [隔离验收构建](evidence/renderer-controller-2026-11-19/product-winui-isolated-build.log)

产品 WinUI 的新实操证据见[原生交互与资源观测](native-observation.md)。CSS 视口模型与物理滚轮、原生多 DPI 以及产品退出和写入刷新分别验收。自动化全量通过后，S3 仍为 **Blocked**。真实 WhatsApp、付费 AI、干净目标机与长期资源仍待验收，生产 Worker、自动 AI 消费者和后台采集入口保持 **FROZEN**。已发布安装包仍对应 `a451c40`，本轮未重新打包。[既有预发行交付](runtime-release-delivery.md)
