# V4.1 WS 隔离 Edge 生命周期对照

本轮以 `bca8813` 为基线。既有集成回归在 WS 默认矩阵的 `spawnSync --dump-dom` 调用中触发 45 秒超时，日志仅保留结果尾部。此次用同一合成 WS 矩阵比较原同步入口和显式 CDP 关闭入口。[既有失败记录](v41-edge-stability.md#9-第三轮全量与-gpt-专项复跑)

## 运行结果

| 调用 | 总期限 | 结果 |
| --- | --- | --- |
| 原同步入口 | 45 秒 | 11.372 秒通过，取得完整 7 视口结果，日志中已知浏览器 PID 随后不存在。[生命周期](evidence/v41-modern-edge/legacy-sync.json) · [只读核验](evidence/v41-modern-edge/legacy-sync-audit.json) |
| 临时 CDP 入口 | 30 秒 | 11.005 秒通过，取得完整 7 视口结果并确认正常退出、流关闭及已观察身份释放。[生命周期](evidence/v41-modern-edge/temporary-cdp.json) |
| 正式 CDP 入口首次运行 | 30 秒 | **Failed**。9.851 秒校验 7 视口，9.998 秒收到 `Browser.close` 应答，10.002 秒 CDP 已关闭。截止时缺少根进程退出和流关闭证明，失败阶段为 `process-exit`。[生命周期](evidence/v41-modern-edge/formal-timeout.json) |
| 正式 CDP 入口加只读活性探针 | 30 秒 | 25.005 秒通过。CDP 关闭后 750 毫秒观察到退出码 0，18 个已观察浏览器身份和身份探针均已释放。达到预定采样前根进程已退出。[生命周期](evidence/v41-modern-edge/formal-pass.json) · [只读核验](evidence/v41-modern-edge/formal-pass-audit.json) |

原同步入口与正式 CDP 首次运行的 `case.html`、`matrix.html` 字节 SHA-256 分别一致。临时入口统一了源码换行，生成文件的字节哈希不同。四次均取得七个视口，结果 JSON 原字节的 SHA-256 均为 `4d581359cbe55b6f82d1a5f9bd59b029b66cd691b4b3274c0ae3a607e3b178e8`。[原入口夹具哈希](evidence/v41-modern-edge/legacy-sync.json) · [正式夹具哈希](evidence/v41-modern-edge/formal-fixture-hashes.json) · [临时夹具哈希](evidence/v41-modern-edge/temporary-cdp-fixture-hashes.json)

`6ebdc41` 让默认 WS 矩阵复用既有 30 秒隔离 CDP 工具，并要求取得明确的结果、关闭应答、进程退出、流关闭和身份释放证明。页面夹具与 WS 布局断言保留。受控生命周期测试 12/12、参数及路径检查 13/13、传输测试 4/4、调用方清理测试 3/3 通过。[对照汇总](evidence/v41-modern-edge/comparison-summary.json)

正式失败的隔离目录保留，当时的 `cleanupSafe=false` 和探针关闭状态 `unknown` 保留。事后只读核验显示 18 个已观察浏览器身份与探针 PID 已不存在。该核验只说明事后的状态。最新对照把新失败定位到取得完整结果及 CDP 关闭之后的退出验证阶段，内部阻塞点仍未证实。偶发退出超时为 **Unresolved**，S3 仍为 **Blocked**。[失败后只读核验](evidence/v41-modern-edge/formal-timeout-audit.json)

[证据 SHA-256 清单](evidence/v41-modern-edge/manifest-sha256.json)记录原始来源和脱敏归档的字节数与哈希。归档仅包含生命周期和身份核验元数据。

## 身份探针提前关闭的后续修复

主控首次集成全量完成 **286/293**。其中 WS 默认矩阵在 `PROCESS_IDENTITY_UNVERIFIED` 失败，消息为 `Process identity probe is closing`。这次调用的 30 秒元数据表明，10.300 秒已确认 CDP 关闭，29.538 秒身份探针关闭，29.620 秒浏览器根进程以 0 退出，29.629 秒全部流关闭。随后对 16 个已观察后代发起最后的身份查询时，提前关闭的探针拒绝了查询，绝对截止仍剩约 371 毫秒。原调用保留 Failed。[首次全量 WS 失败元数据](evidence/v41-modern-edge/late-release/initial-full-ws-race.json)

`117eace`（集成提交 `4804e08`）纠正测试工具的关闭顺序。工具在浏览器根退出和流关闭后，先入队最后一次后代身份查询，再向探针发送 EOF，查询结果和探针退出均在原绝对期限内核验。相同的受控晚退出夹具在 6 秒预算下复现并验证了修复。

| 受控调用 | 根退出 | 后代查询 | 探针关闭 | 结果 |
| --- | --- | --- | --- | --- |
| 修复前 | 5.643 秒 | 5.644 秒被拒绝 | 5.538 秒 | Failed，同样报探针已在关闭。[元数据](evidence/v41-modern-edge/late-release/controlled-red.json) |
| 修复后，定向执行 | 5.636 秒 | 5.655 秒确认无剩余身份 | 5.685 秒 | Passed。[元数据](evidence/v41-modern-edge/late-release/controlled-green-focused.json) |
| 修复后，受控套件 | 5.632 秒 | 5.654 秒确认无剩余身份 | 5.685 秒 | Passed。[元数据](evidence/v41-modern-edge/late-release/controlled-green-suite.json) |

本专项的 13 条参数及路径检查和 13 个实际受控子进程案例均通过，另有 4 个本地传输案例通过。这些是测试工具验证，最终集成全量结果另以主控运行记录为准。修复范围限于已证实的探针关闭竞态。上文正式 CDP 调用在没有根退出或流关闭证明时触发的 `process-exit` 超时仍为 **Unresolved**，S3 仍为 **Blocked**。[受控生命周期汇总](evidence/v41-modern-edge/late-release/lifecycle-suite-summary.json) · [传输汇总](evidence/v41-modern-edge/late-release/transport-suite-summary.json)

## 最终集成回归的主渲染结果超时

集成提交 `4804e08` 的最终全量完成 **292/293**。唯一失败项为 `Delivery S1 actual main renderers and shared design system`。该次调用在 `1280 × 720` 配置下进入默认八视口矩阵，1.236 秒发起导航，28.506 秒到达结果阶段的工作截止。元数据中没有视口核验或结果核验事件，同调用也没有保存结果文件。主渲染测试先等待浏览器返回完整矩阵，再检查布局。因此本次失败发生在测试取得浏览器结果之前，布局断言未执行。现有记录无法区分导航响应、页面加载事件和后续结果采集的具体等待点，原因保持 **Unknown**。[失败元数据](evidence/v41-modern-edge/final-main/result-timeout.json)

随后 28.514 秒收到 `Browser.close` 应答，28.517 秒 CDP 关闭。原 30 秒总截止时，根进程退出和流关闭仍未证实，释放阶段另记为 `process-exit`，探针关闭为 `unknown`，整个调用保留 `Failed` 与 `cleanupSafe=false`。原始全量日志见主仓 `.tools/v41-modern/full-regression-r2.log`。这次结果阶段超时与先前已经取得完整结果后的退出超时分别保留，二者的共同原因尚无证据。

2026-11-17 22:13:15 UTC 事后只读核验了本次记录的 4 个浏览器进程身份和 1 个探针 PID，核对时 5 个 PID 均已不存在，隔离根目录仍保留。该检查只说明事后已观察身份的状态。没有额外终止进程或删除目录。原失败及 S3 **Blocked** 状态保留。[事后只读核验](evidence/v41-modern-edge/final-main/read-only-process-audit.json)

## 主渲染 CDP 分阶段取证

以 `34951cc` 为基线，`158b7b7` 在隔离 Edge 测试工具中分别记录导航应答、加载事件、视口读回、矩阵结果、截图和结果身份查询的开始与完成。如果关闭入口触发时仍有操作未完成，记录该操作。30 秒总期限、结果断言、进程退出和身份释放要求保留。

使用原合成主渲染夹具顺序运行两次，各自执行原有八个视口下二十条路由的矩阵断言。运行范围止于矩阵断言，随后主题和截图检查未执行。两次结果 JSON 的字节 SHA-256 一致，均为 `64fe3c1c31142c9a0ddbb371565acd93fe228048db4c588a3fb868e09bfc4062`。

| 距启动时间 | 首次隔离矩阵 | 隔离矩阵加只读页面采样 |
| --- | --- | --- |
| 导航应答 | 2.784 秒 | 2.791 秒 |
| 对应导航的加载事件 | 10.290 秒 | 9.250 秒 |
| 视口核验 | 10.302 秒 | 9.299 秒 |
| 矩阵结果核验 | 10.526 秒 | 9.482 秒 |
| CDP 传输关闭 | 10.779 秒 | 9.690 秒 |
| 根进程正常退出 | 11.826 秒 | 10.763 秒 |
| 流关闭 | 11.835 秒 | 10.771 秒 |
| 总结果 | 11.911 秒，Passed | 10.847 秒，Passed |

首次根 PID 为 3688，第二次为 37336。事后分别只读核验各自观察过的 18 个浏览器进程身份及 1 个身份探针 PID，均已不存在。[首次生命周期](evidence/v41-modern-edge/cdp-phases/main-run-1.json) · [首次身份核验](evidence/v41-modern-edge/cdp-phases/main-run-1-audit.json) · [第二次生命周期](evidence/v41-modern-edge/cdp-phases/main-run-2.json) · [第二次身份核验](evidence/v41-modern-edge/cdp-phases/main-run-2-audit.json)

两次通过的调用均以等待加载事件耗时最长。第二次采样于 9.157 秒返回，页面为 `interactive`，存在 8 个 iframe，结果标记尚未生成。93 毫秒后观察到与当前主 frame 和 loader 一致的 `load` 事件。导航应答到达前收到的事件可由 CDP 通知缓冲匹配。历史失败未保留必要的分阶段记录，具体等待操作仍为 **Unknown**。历史退出超时仍为 **Unresolved**，S3 仍为 **Blocked**。

本地环回传输测试 **5/5** 通过，其中一例确认已收到应答的操作记录完成，未收到匹配加载事件的操作仍显示为未完成。另一次受控生命周期套件完成 13 条参数及路径检查与前 6 个子进程案例，随后在 `controlled-node-probe-close-timeout` 失败。本次调用在 Windows 身份确认截止时仍处于 `identity`，因此未进入该用例期望的 `identity-probe-close` 阶段。探针终止请求和探针退出均已记录，套件保留 **Failed**。[传输用例](evidence/v41-modern-edge/cdp-phases/transport-suite.json) · [受控套件汇总](evidence/v41-modern-edge/cdp-phases/controlled-lifecycle-summary.json) · [受控失败元数据](evidence/v41-modern-edge/cdp-phases/controlled-identity-timeout.json)

## 关闭用例的身份探针预备

受控关闭用例的 3 秒总预算包含 2.25 秒工作窗口。之前的失败在 16 毫秒时发起身份查询，在 2.263 秒进入关闭处理，根进程正常退出后探针才返回。这会让用例在身份确认阶段提前失败，实际要检验的探针关闭分支仍未到达。保持真实探针响应并在测试端让首条响应最早在启动后 2.4 秒送达，可稳定复现原用例的 `identity` 失败。[原始失败](evidence/v41-modern-edge/cdp-phases/controlled-identity-timeout.json) · [受控复现](evidence/v41-modern-edge/probe-preparation/controlled-unprepared.json)

`dd57704` 仅为两个关闭专项增加独立预备。预备阶段由真实 PowerShell 探针查询测试父进程 PID 与创建时间，最迟 4.75 秒须收到响应，预留至 5 秒确认准备失败后的探针退出。同一探针随后在原 3 秒生命周期内重新查询受控子进程身份，并在收到结果、根进程正常退出及流关闭后进入探针关闭。实际隔离 Edge 入口沿用原启动方式和 30 秒期限。

在同一 2.4 秒首响应条件下，准备分别耗时 2.416 和 2.415 秒，真实受控子进程身份在测量开始后 20 和 27 毫秒确认。两案均到达 `identity-probe-close`，底层调用仍为 `Failed`。能观察到终止事件时记录 `confirmed`。测试向工具屏蔽终止事件时保留 `unknown`，并由外层观察真实探针关闭。[定向汇总](evidence/v41-modern-edge/probe-preparation/controlled-delayed-suite.json) · [确认终止](evidence/v41-modern-edge/probe-preparation/controlled-prepared-confirmed.json) · [证据不足分支](evidence/v41-modern-edge/probe-preparation/controlled-prepared-unknown.json)

另一次实验额外叠加了 2.4 秒 PowerShell 启动等待，预备在原定边界超时，未进入生命周期，保留 **Failed**。随后无注入的完整受控套件通过 **13/13** 参数与路径检查、**13/13** 真实受控进程用例；运行时原生窗口闲置，无 Edge 或 .NET 重测。早期主渲染结果超时根因仍为 **Unknown**，偶发 Edge 退出超时仍为 **Unresolved**。[预备失败](evidence/v41-modern-edge/probe-preparation/additive-cold-start-fixture-timeout.json) · [完整受控套件](evidence/v41-modern-edge/probe-preparation/controlled-lifecycle-suite.json)

## 完成批次的全量失败与独立句柄实验

完成批次全量回归 **295/298**。三个失败来自实际隔离 Edge 调用，原期限均为 30 秒。表中的结果核验指浏览器工具读取和核对矩阵结果，外层布局断言在这三个调用中均未执行。

| 调用 | 工作阶段 | 浏览器关闭应答 / CDP 传输关闭 | 后续释放 |
| --- | --- | --- | --- |
| 主渲染 | 11.831 秒核验 8 个结果，12.017 秒完成结果身份查询 | 12.125 / 12.132 秒 | 根进程退出及流关闭未证实，`process-exit` 失败。[元数据](evidence/v41-modern-edge/completion-kernel-watch/main-process-exit.json) |
| WS 默认矩阵 | 初始身份查询耗时 13.547 秒，20.106 秒 CDP 就绪。21.831 秒导航加载完成，随后 `Runtime.evaluate` 等待矩阵至工作截止，无结果文件 | 28.507 / 28.511 秒 | 另有 `process-exit` 释放失败，根退出及流关闭未证实。[元数据](evidence/v41-modern-edge/completion-kernel-watch/ws-matrix-result-and-exit.json) |
| 客户表格 | 20.641 秒核验 10 个结果，20.800 秒完成结果身份查询 | 20.804 / 20.808 秒 | 根进程退出及流关闭未证实，`process-exit` 失败。[元数据](evidence/v41-modern-edge/completion-kernel-watch/customer-table-process-exit.json) |

三次均完成所拥有的 CDP 会话分离和目标关闭。实际退出事件缺失，工具未进入常规释放身份查询，截止时仅记录自己句柄上的终止请求，探针退出证明均为 `unknown`。WS 已确认导航加载完成，随后没有取得矩阵结果。现有记录无法区分夹具仍在计算、发布结果或返回 CDP 应答的具体等待。主渲染和客户表格均已取得完整矩阵结果。

计划由独立观察器核验根 PID 和创建时间，并通过同一受限 Windows 进程句柄记录 OS 退出时间，以区分根进程尚未终止与测试未收到事件。首次 PowerShell 文件入口 `UnauthorizedAccess`，观察器退出码 1。改用测试工具既有的内联命令入口后，观察器输出 `observer-ready`，但在受控 Node 子进程的启动身份、正常退出及流关闭均已记录的情况下，仍未确认独立句柄就绪或记录 OS 退出事件。随后观察器关闭等待到达期限，退出确认未保留。此时用户已正常关闭隔离 WinUI。自校验失败，实际小型 Edge 运行未启动。[文件启动失败](evidence/v41-modern-edge/completion-kernel-watch/observer-file-start-failure.json) · [观察器就绪证据](evidence/v41-modern-edge/completion-kernel-watch/observer-readiness-only.json) · [受控进程事件](evidence/v41-modern-edge/completion-kernel-watch/observer-control-runner-phases.json) · [实验结果](evidence/v41-modern-edge/completion-kernel-watch/observation-attempt.json)

WS 矩阵结果未返回和三个根进程缺少退出证明的原因仍未证实。**S3 保持 Blocked。**

### 关闭应答后仍未完成 Windows 退出的证据

本机测试使用 Node `v24.22.1` 和 libuv `1.52.1`。三个失败的 `failure-owned-handle-termination` 都记录 `requested=true`。该版本 Windows libuv 仅在对保留的子进程句柄调用 `TerminateProcess` 成功时才返回这一值。Windows 对已终止进程的句柄返回 `ERROR_ACCESS_DENIED`。因此三次的根进程在约 30.007 至 30.009 秒发出终止请求时，尚未完成 OS 级退出。成功接受异步终止请求只证明请求发出，退出码、流关闭和释放仍无确认。[Node 与 libuv 源码](https://raw.githubusercontent.com/nodejs/node/v24.22.1/deps/uv/src/win/process.c#L1212) · [Windows 进程终止语义](https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-terminateprocess)

单一合成 Node 子进程对照刻意延迟父进程的事件派发。通过保留句柄观察到子进程已结束时，JS `exit` 仍未派发，对同一句柄发出的终止调用返回 `false`。恢复事件派发后收到退出码 0 和流关闭。退出监听在 `spawn` 返回后、首次 `await` 之前注册，Node 的 `exit` 也独立于 stdio `close`。[受控句柄记录](evidence/v41-modern-edge/completion-kernel-watch/controlled-node-handle.json) · [Node 事件语义](https://nodejs.org/download/release/v24.22.1/docs/api/child_process.html#event-exit)

三次全量调用均已关闭工具拥有的 CDP 会话和目标，并观察到传输关闭。此前零页面目标对照也在关闭应答及传输关闭后精确核验到同一根进程仍存活，直至 27.016 秒才自然退出。上游 Chromium 会在 UI 线程调度实际退出并放弃 DevTools 保活。现有证据支持关闭应答后真实退出延迟，内部等待原因仍未知，未调整退出顺序或验收期限。[零页面目标对照](evidence/v41-stability/comparison/03-zero-page-targets/invocation.json) · [Chromium 关闭调度](https://chromium.googlesource.com/chromium/src/+/bdf8b9b6d67b77a6b6e1dc98550cf2e417c14ec2/chrome/browser/devtools/chrome_devtools_manager_delegate.cc)

## 最后一轮全量的三项 Edge 失败

最后一轮全量回归完成 **292/298**，其中三项为实际隔离 Edge 测试，另外三项为 sidecar 检查。本节只记录 Edge，上一轮 **295/298** 的三项失败在上节独立保留。原始全量日志留在主仓 `.tools/v41-completion/final-full-regression.log`。以下时间自各自调用启动计。

| 调用 | 结果阶段 | 关闭与验收结果 |
| --- | --- | --- |
| Stage 5.1 折叠布局 | 17.862 秒取得并核验 6 个场景，18.045 秒完成结果身份查询。 | 18.076 秒收到 `Browser.close` 应答，18.081 秒确认 CDP 传输关闭。30 秒内缺少根进程退出及流关闭证明，`process-exit` 失败，`cleanupSafe=false`。[调用元数据](evidence/v41-modern-edge/final-full/stage51-layout-process-exit.json) |
| 主渲染 | 28.303 秒完成导航加载，28.324 秒核验视口并开始等待矩阵结果，28.499 秒进入关闭，`Runtime.evaluate` 未返回且无结果文件。 | 28.609 秒收到关闭应答，28.614 秒确认传输关闭。29.520 秒正常退出，退出码 0。29.530 秒确认流关闭，29.571 秒确认无剩余已观察身份，29.605 秒探针关闭。`cleanupSafe=true`，只有结果阶段失败。[调用元数据](evidence/v41-modern-edge/final-full/main-result-timeout-normal-release.json) |
| WS 默认矩阵 | 23.358 秒 CDP 就绪，24.896 秒完成加载并开始等待矩阵结果，28.505 秒进入关闭，`Runtime.evaluate` 未返回且无结果文件。 | 28.508 秒收到关闭应答，28.511 秒确认传输关闭。30 秒内缺少根进程退出和流关闭证明，另记 `process-exit` 释放失败，`cleanupSafe=false`。[调用元数据](evidence/v41-modern-edge/final-full/ws-result-and-release-timeout.json) |

三项均保留 **Failed**，外层布局断言均未执行。折叠布局与 WS 各记录了拥有句柄的终止请求，探针退出确认均为 `unknown`。主渲染的正常释放与其矩阵结果超时分别记录。矩阵结果未返回和偶发退出延迟的根因仍未证实，**S3 保持 Blocked**。

## 第三轮全量的运营任务截图退出超时

第三轮全量以 `63404b4` 为运行基线，完成 **297/298**。唯一失败项是 `Delivery S1 actual main renderers and shared design system`。此前独立的主渲染 8 视口 × 20 路由、两项主题检查和截图均通过，第三轮全量仍以本次运行结果为准。[第三轮全量摘要](evidence/v41-modern-edge/settled-full/full-run-summary.json) · [独立渲染运行](evidence/v41-completion-validation/kpi-final/runs.json)

失败发生在 Dawn 主题的运营任务截图 `operations-atelier-dawn.png`。2.129 秒核验本次调用的单路由结果，3.068 秒写入 `1920 × 1080` PNG，3.238 秒完成 14 个浏览器身份查询并置 `resultReady=true`。随后分离会话、关闭目标，3.244 秒收到 `Browser.close` 应答，3.245 秒确认 CDP 传输关闭。30 秒内未观察到根进程退出或流关闭。30.006 秒记录拥有句柄的终止请求已接受，探针退出仍为 `unknown`。调用保留 `Failed`、`process-exit` 和 `cleanupSafe=false`。结果与图像文件 SHA-256 均已核验。[调用元数据](evidence/v41-modern-edge/settled-full/operations-screenshot-process-exit.json)

2026-11-18 07:36:50 UTC 的事后只读检查仅核对本次记录的 14 个浏览器 PID 及原 Windows 创建时间，以及探针 PID。15 个 PID 均已不存在。检查期间未终止进程或删除目录。这份记录只反映事后已观察身份的状态。退出延迟根因仍未证实，**S3 保持 Blocked**。[只读检查](evidence/v41-modern-edge/settled-full/read-only-process-audit.json)

## 独立观察器核对关闭后的 Windows 进程

在 `c01c126` 上以一个受控 Node 子进程完成校准。独立观察器只在 PID 和 Windows 创建时间一致后使用只读同步句柄。校准测得收到关闭请求后 1.308 秒内核出口为 0，符合夹具约 1.3 秒的行为。子进程、流和观察器本身均已确认关闭。未启用调试权限，也未收集内存、堆栈或配置正文。[诊断工具](../../scripts/diagnostics/edge-exit-observer/README.md) · [受控生命周期](evidence/v41-modern-edge/owned-shutdown-observer/control-standard-lifecycle.json) · [内核校准](evidence/v41-modern-edge/owned-shutdown-observer/control-standard-kernel.json)

两个实际 Edge 调用均复用历史失败中的 Dawn 运营任务截图夹具、30 秒期限及该截图的原断言。两次结果和 PNG 的 SHA-256 均与第三轮全量失败对应的文件一致。两次只运行该截图，均验证退出码 0、流关闭、身份释放及观察器正常退出。[第三轮失败元数据](evidence/v41-modern-edge/settled-full/operations-screenshot-process-exit.json)

| 调用 | 总耗时 | 从 `Browser.close` 应答到 Node 退出事件 | 最晚已观察子进程比根先退出 |
| --- | --- | --- | --- |
| 常规参数 | 16.465 秒 | 11.654 秒 | 3.533 秒。[浏览器](evidence/v41-modern-edge/owned-shutdown-observer/edge-standard-lifecycle.json) · [内核](evidence/v41-modern-edge/owned-shutdown-observer/edge-standard-kernel.json) |
| 仅增加 `shutdown` 启动跟踪 | 9.870 秒 | 5.928 秒 | 0.363 秒。[浏览器](evidence/v41-modern-edge/owned-shutdown-observer/edge-trace-lifecycle.json) · [内核](evidence/v41-modern-edge/owned-shutdown-observer/edge-trace-kernel.json) |

常规调用的 10 个已观察渲染进程在传输关闭后 2.044 秒均已退出。7.078 秒时，内核仍确认浏览器根、GPU 进程及两个其他已观察进程存活，根进程 CPU 时钟继续增长。已观察子进程全部退出之后，根进程又存活约 3.5 秒。线程状态没有给出可归因的内部等待。

跟踪调用只对新建合成浏览器加入 `--trace-startup=shutdown`、`--trace-startup-duration=20`、`--trace-startup-format=json` 和明确的隔离文件输出，保留原测试期限。取得 128 条该根进程 `shutdown` 类事件，覆盖渲染、合成和窗口清理，未捕获 `BrowserMainRunner` 后续线程清理。上游 Chromium 在 `PreShutdown` 会先停止 startup tracing，不能据缺失事件定位 Edge 的晚段等待。跟踪原文未进入归档。[跟踪计数](evidence/v41-modern-edge/owned-shutdown-observer/edge-trace-category-summary.json) · [Chromium 停止跟踪顺序](https://chromium.googlesource.com/chromium/src/+/HEAD/content/browser/browser_main_loop.cc#1244)

这两次已明确观测到真实 OS 退出延迟。均未触发历史 30 秒超时，无法用通过次数或运行时间归因于某项启动参数。此次交付只读取证工具和证据，偶发超时根因仍未证实，**S3 保持 Blocked**。
