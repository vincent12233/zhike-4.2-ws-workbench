# V4.1 隔离 Edge 稳定性专项

核对日期为 2026-11-18。专项以 `eb94848` 为基线，使用 Windows 上的 Microsoft Edge `157.0.4341.60` 和仓库 Node。浏览器测试使用每次新建的隔离配置目录和合成页面。范围限于测试进程身份核验、CDP 生命周期和原渲染断言。S3 的偶发 Edge 退出超时仍为 **Blocked**，生产发布继续 **FROZEN**。

## 1. 基线失败与单跑

上一轮完整回归仍为 **289/291**。折叠布局保留 6 场景结果，`Browser.close` 于 14.956 秒确认，进程退出在 30 秒超时。主渲染保留 8 视口结果，27.888 秒完成结果校验，28.511 秒开始关闭，29.290 秒退出，原调用已经在 Windows 身份核验阶段触及 28.5 秒工作截止。两条历史记录保持 Failed。[历史完整回归与失败元数据](dynamic-workspace-v4-acceptance.md#51-最终两项失败)

| 本轮基线单跑 | 结果 |
| --- | --- |
| Stage51 折叠布局原命令 | 6 场景通过，生命周期 5.163 秒。[元数据](evidence/v41-stability/baseline/stage51-original-pass.json) |
| 主渲染原命令 | 整条命令 Failed。8 视口矩阵与后续两种主题先通过，首张截图场景在 28.5 秒工作截止未返回结果，关闭请求亦未在 30 秒内完成。[原命令日志](evidence/v41-stability/baseline/main-original-failure.log) · [本次失败元数据](evidence/v41-stability/baseline/main-first-screenshot-timeout.json) |
| Stage51 加时序记录后的原流程 | 再次复现 `process-exit`。11.162 秒收到 `Browser.close` 响应，11.166 秒 CDP 已关闭，30 秒仍未观察到根进程退出。浏览器生命周期 Failed。[元数据](evidence/v41-stability/baseline/stage51-reproduced-timeout.json) |

另有一批临时对照在 PowerShell 输出管道参数绑定失败后重叠启动。该批从因果对照和通过统计中排除。对本专项此前元数据与诊断日志中记录的 263 个唯一 PID 进行了只读核对，检查时全部已不存在。[PID 核对记录](evidence/v41-stability/baseline/invalid-overlap-batch-process-audit.json)

## 2. 两次测试工具修复

- `95094e2` 在同一次浏览器生命周期内复用一个 Windows PowerShell 查询进程。启动后、结果完成时和退出后仍核验原有的 PID 与创建时间。冷启动对照中，第二和第三次复用为 12 和 7 毫秒，对应新启动查询为 865 和 2,920 毫秒，三次查询的身份值一致。后续冷查询超时保留在同一日志。真实主渲染矩阵对 18 个 PID 的结果后核验用 126 毫秒，退出后查 17 个 PID 用 56 毫秒。[查询对照](evidence/v41-stability/identity/benchmark.log) · [矩阵生命周期](evidence/v41-stability/identity/95094e2-main-matrix.json)
- `3b7c25c` 为该探针记录终止调用的返回值与独立的真实 `close` 事件。浏览器根进程与流的 30 秒总期限保留。探针在同一期限内最多提前 500 毫秒开始退出，最多预留最后 250 毫秒确认其句柄终止。截止时缺少关闭证据会记录 `unknown`，整项继续 Failed。受控跟踪子进程在 `finally` 接收停止文件，并设有 15 秒自退出上限。[终止已确认](evidence/v41-stability/review/3b7c25c-probe-termination-confirmed.json) · [关闭证据缺失](evidence/v41-stability/review/3b7c25c-probe-termination-unknown.json) · [根进程超时时探针自行关闭](evidence/v41-stability/review/3b7c25c-root-timeout.json)

两次修复均只涉及隔离测试助手及其受控测试。真实结果断言、`Browser.close` 应答、实际进程退出、流关闭和身份释放证明均保留。生产 WebView2、Windows 策略和 Edge 启动参数未改。

## 3. Stage51 关闭顺序对照

五组对照串行执行。除第 7 例最小 HTML，各例均使用字节相同的原 Stage51 文件夹具，保留六视口和原布局断言，浏览器启动参数及 30 秒期限相同。枚举页面前确认 CDP 端点报告的浏览器 PID 与本次子进程一致。10 例的事后只读身份核验均为零残留。日志保留第 2 例保护性中止和第 4 例真实退出失败。

| 例 | 变动 | 结果 |
| --- | --- | --- |
| 1 | 观察原关闭顺序 | 4.128 秒通过，关闭夹具后只剩启动空白页。[记录](evidence/v41-stability/comparison/01-baseline/summary.json) |
| 2 | 试图先关闭已知启动空白页 | 出现第三个页面目标，保护断言中止，未发送 `Browser.close`。该例不参与退出比较。[记录](evidence/v41-stability/comparison/02-launch-tab-guard/summary.json) |
| 3 | 先关闭已识别的启动空白页，再关闭夹具 | 27.083 秒通过，但 `Browser.close` 前已无任何页面目标。10.309 秒收到关闭响应，14.960 秒按启动时间核对时仅根进程仍存活，27.016 秒才自然退出。响应到退出相隔 **16.707 秒**。[调用事件](evidence/v41-stability/comparison/03-zero-page-targets/invocation.json) |
| 4 | 观察原关闭顺序 | **Failed**。页面目标列表只剩启动空白页。14.118 秒关闭响应，14.123 秒 CDP 关闭，30 秒未观察到根进程退出。[调用事件](evidence/v41-stability/comparison/04-baseline-timeout/invocation.json) |
| 5 | 等待夹具 `Target.targetDestroyed` | 4.019 秒通过，观察到空白页和浏览器内部同步确认页面。[记录](evidence/v41-stability/comparison/05-observed-target-destruction/summary.json) |
| 6 | 观察原关闭顺序 | 6.111 秒通过，同样观察到浏览器内部同步确认页面。[记录](evidence/v41-stability/comparison/06-baseline/summary.json) |
| 7 | 最小 HTML，不加载产品脚本或 CSS | 4.069 秒通过。该例仅观察浏览器退场。[记录](evidence/v41-stability/comparison/07-minimal-html/summary.json) |
| 8 | 观察原关闭顺序 | 4.114 秒通过。[记录](evidence/v41-stability/comparison/08-baseline/summary.json) |
| 9 | 等待服务端关闭 CDP 传输 | 5.748 秒通过。响应到传输关闭为 208 毫秒，随后 2,288 毫秒才退出。[记录](evidence/v41-stability/comparison/09-peer-close/summary.json) |
| 10 | 观察原关闭顺序 | 5.260 秒通过。[记录](evidence/v41-stability/comparison/10-baseline/summary.json) |

第 3 例记录了没有页面目标时的根进程退出延迟，第 4 例记录了关闭应答和传输完成后依然发生的 OS 进程退出超时。浏览器内部同步确认页出现在多次正常退出的调用里，复现失败时的最后一次关闭前快照未见该页。单次等待服务端断开也不足以推断失败率变化。记录目前把问题缩小到浏览器回应关闭之后的实际进程退出，具体内部阻塞点仍未定位。上游 Chromium 的实现会把实际关闭调度到 UI 线程，与协议响应先于 OS 退出的现象一致。[Chromium 关闭调度源码](https://chromium.googlesource.com/chromium/src/+/bdf8b9b6d67b77a6b6e1dc98550cf2e417c14ec2/chrome/browser/devtools/chrome_devtools_manager_delegate.cc)

## 4. 修复后实际验证

| 检查 | 实际结果 |
| --- | --- |
| `95094e2` 受控测试 | 13 条参数或路径断言、10 个实际子进程用例、4 个本地传输用例通过。[生命周期](evidence/v41-stability/identity/95094e2-lifecycle.log) · [传输](evidence/v41-stability/identity/95094e2-transport.log) |
| `95094e2` 真实主渲染矩阵 | 8 视口 × 20 页，原矩阵断言全部通过，生命周期 10.748 秒，18 个已观察身份释放。范围止于矩阵，完整命令的后续主题和截图未复验。[原矩阵输出](evidence/v41-stability/identity/95094e2-main-matrix.log) · [生命周期](evidence/v41-stability/identity/95094e2-main-matrix.json) |
| `3b7c25c` 受控测试 | 13 条参数或路径断言、12 个实际子进程用例、4 个本地传输用例通过。新增两例分别验证真实终止证明和关闭证据缺失时保留 Failed。[生命周期](evidence/v41-stability/review/3b7c25c-lifecycle.log) · [传输](evidence/v41-stability/review/3b7c25c-transport.log) |
| `3b7c25c` 原 Stage51 | 六视口单次通过，生命周期 4.569 秒，16 个已观察的浏览器进程身份均退出，探针正常关闭。[命令日志](evidence/v41-stability/review/3b7c25c-stage51.log) · [身份审计](evidence/v41-stability/review/3b7c25c-stage51-audit.json) |

本专项留下了可重复核验的单跑、对照和受控证据。完整回归仍需独立执行，历史失败不因局部单跑通过而改写。

[SHA-256 清单](evidence/v41-stability/manifest-sha256.json)记录每份原日志与归档副本的哈希、字节数和实际脱敏处理。归档包含时序、PID 及启动时间、夹具与结果哈希和测试日志。浏览器配置目录、页面正文、布局结果原文及调试端点不进入归档。

## 5. V4.1 集成全量首轮

主控首轮全量运行完成 **289/292**，3 项 Failed。Stage51 折叠布局与主渲染测试均在标题断言上失败，实际字号为 `21px`，旧预期为 `28px`。S1 WS computed 测试在总览栏和 KPI 文本对比度断言上失败，日志实测为约 `1.81:1`。首轮未记录真实 Edge 退出超时。第 3 节已复现的偶发退出超时仍待定位，局部成功和这一轮的退出结果仅证明各自的调用。首轮原始日志保存在主仓 `.tools/v41/full-regression.log`。

## 6. 隔离原生客户表滚轮输入

在 Stage51 隔离 WinUI/WebView2 窗口打开深色 M05 客户表，窗口最大化，截图为 1920 × 1140 像素。复现时把自动输入定位到截图坐标 `(1040, 890)`，发送单次 `scrollY=240`。HUD 记录的可信指针和滚轮相隔 7.9 毫秒，来自同一次自动操作。[坐标不一致截图](evidence/v41-native/captures/13-wheel-coordinate-mismatch.jpg)

| HUD 记录 | 客户区坐标 | 屏幕坐标 | 命中 |
| --- | --- | --- | --- |
| 滚轮前最近一次可信 `pointermove` | `(831.2, 687.2)` | `(831.2, 710.4)` | `td.phone-cell` |
| 同次操作的可信 `wheel` | `(1039, 864)` | `(1039, 887)` | 事件目标和 `elementFromPoint` 均为 `footer.app-footer` |

该次观测的 DPR 为 `1.25`，`innerWidth × innerHeight` 为 `1534 × 875`，可视视口为 `1534.4 × 875.2`，缩放为 `1`、偏移为 `(0, 0)`。表格容器的客户区坐标从 `(286.8, 529.3)` 到 `(1124.4, 1071.91)`。页脚从 `(506, 845.2)` 到 `(1784.4, 875.2)`。滚轮记录为 `deltaY=200`，前后均未被取消，在该事件路径上也未找到注册的滚动区域。指针与滚轮坐标的比例接近 DPR，滚轮坐标落入页脚区间，解释了同一自动操作中表格未滚动的现象。[原生 HUD 截图](evidence/v41-native/captures/13-wheel-coordinate-mismatch.jpg)

另一轮将自动输入放在截图坐标约 `(830, 680)`，发送同样的 `scrollY=240`。滚轮事件实际命中表格的 `td.phone-cell`，`scrollTop` 从 `0` 增至 `67`，表格可见高度为 `531`，内容高度为 `598`。这一次测得表格收到滚轮时可以移动。[命中表格的对照截图](evidence/v41-native/captures/10-wheel-table67.jpg)

M05 这组条件下的自动原生滚轮验收仍为 **Blocked**。现有证据证明该次自动输入的指针与滚轮使用了不同坐标，未单独验证实物鼠标或其他 DPI 条件。诊断只扩展了隔离 HUD，没有调整产品 CSS 或 WinUI 输入处理。

## 7. V4.1 集成全量第二轮再次复现退出超时

第二轮全量在 Stage51 折叠布局复现真实 Edge 退出超时。调用 `1794944767849-becbeef9-9456-49ab-b0a7-64b4d2e69892` 于 11.052 秒校验六个场景，11.179 秒收到 `Browser.close` 应答，11.183 秒确认 CDP 关闭。30 秒截止时未取得根进程退出或流关闭证据。该调用保留 **Failed**，阶段为 `process-exit`，`cleanupSafe=false`。测试工具记录了向自己持有的浏览器根进程句柄发出终止请求。独立身份探针也发出了终止请求，原期限内的关闭证据为 `unknown`。[第二轮失败元数据](evidence/v41-stability/integration/stage51-second-full-timeout.json)

事后于 2026-11-17 19:51:12 UTC 只读核验该次记录的 12 个浏览器进程身份和 1 个探针 PID，核对时 13 个 PID 均已不存在。该核验只描述核对时的进程状态，原 30 秒失败及探针证据仍按当时记录。核验期间未额外终止进程，保留了该次隔离目录。S3 的偶发退出问题继续 **Blocked**。[事后只读核验](evidence/v41-stability/integration/stage51-second-full-read-only-audit.json)

## 8. GPT 专项同步启动超时

`ZHIKE_GPT_VISUAL_ONLY=1` 专项在 `scripts/delivery/s1-ws-visual.test.cjs:123` 的同步 Edge 调用处触发 `ETIMEDOUT`。原期限为 **45 秒**，退出状态记录为 `null`，专项保留 **Failed**。该调用使用隔离的合成夹具，预定检查两种主题、两组视口和两种配置状态，共八个场景。超时断言只输出错误消息与 stderr。下一行才读 stdout 并解析结果标记，后续布局断言和截图阶段均未执行。因此场景是否已产出结果、是否在等待进程退出或输出流关闭，当前均为 **Unknown**。stderr 中的渲染器任务提供者消息只保留为诊断线索。[脱敏原日志](evidence/v41-stability/integration/gpt-visual-fixed-timeout.log)

该次 stderr 只记录了一个 PID（38792）。2026-11-17 20:07:17 UTC 的只读核验确认该 PID 已不存在。原测试没有记录实际启动 PID 与创建时间、准确的隔离根目录或后代身份，因此完整进程释放仍为 **Unknown**。本次只检查了日志中出现的 PID。测试代码及 45 秒期限维持原状。[只读 PID 核验](evidence/v41-stability/integration/gpt-visual-fixed-read-only-audit.json)

## 9. 第三轮全量与 GPT 专项复跑

以 `88cf98b` 为基线的第三轮全量为 **292/293**。唯一失败项是 `Delivery S1 WS computed layout and retained host`。同步 Edge `--dump-dom` 调用在原 **45 秒**期限触发 `ETIMEDOUT`，退出状态为 `null`，保留 **Failed**。[第三轮全量归档](evidence/v41-integration/r3/full-regression-r3.log) · [超时摘要](evidence/v41-integration/r3/ws-browser-timeout.json)

失败断言附带 stdout 的最后 6000 个字符，仍能看到合成矩阵结果的部分尾部、`</pre>` 和文档结束标记。结果起始标记已经截断，归档前的原始日志也无法解析出完整矩阵。脚本先校验退出状态，后续场景数和布局断言未执行。现有记录证明 Edge 输出过包含结果尾部的 DOM，全部场景完成情况和具体阻塞阶段仍为 **Unknown**，无法据此区分 OS 进程退出等待与输出流收尾。2026-11-17 20:34:17 UTC 仅对该失败区段 stderr 中唯一的 PID 36556 做了只读检查，该 PID 已不存在。准确隔离根目录、启动进程创建时间和后代身份未记录，因此进程树完整释放仍未验证。[只读 PID 核验](evidence/v41-stability/integration/ws-r3-timeout-read-only-audit.json)

随后以 `0228a36` 单独复跑带失败元数据记录的 GPT 专项，实际输出 **8/8** 场景并以状态码 0 结束。第 8 节的首次 GPT 超时保留为 Failed。第三轮的 WS 超时和第 7 节复现的 Stage51 退出超时均保留，S3 仍为 **Blocked**。[GPT 复跑日志](evidence/v41-integration/diagnostics/gpt-visual-diagnostic.log) · [GPT 退出码](evidence/v41-integration/diagnostics/gpt-visual-diagnostic.exit)
