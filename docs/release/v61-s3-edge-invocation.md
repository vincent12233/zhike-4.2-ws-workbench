# S3 隔离 Edge 同次调用取证

2026-11-18，基线 `9762045`，取证提交 `118b263`。在 Windows 上使用捆绑 Node `v24.22.1`、Edge `157.0.4341.60`、每次新建的合成页面和浏览器配置。10:55:14 至 10:57:47 UTC，按 `scripts/run-tests.cjs` 的四个正式视觉测试入口和默认参数串行执行各一次。每个入口外层 180 秒，每次浏览器调用 30 秒，实际运行 **0/4**，四项均退出码 1，外层均未超时。历史完整回归 **306/310** 保留为独立记录。S3 Edge Gate **Blocked**，生产 **FROZEN**。[命令及退出结果](evidence/v61-s3-edge/original/commands.json) · [历史完整回归](v41-local-integration-completion.md)

所有时间自各浏览器调用开始计。原断言顺序要求浏览器正常退出后再继续外层页面断言。四项均未到达页面断言完成点，原配置和失败产物保留。[四项汇总](evidence/v61-s3-edge/original/summary.json)

| 正式入口 | 同次观测 | 截止判断 |
| --- | --- | --- |
| S1 主渲染 | 1.678s 导航应答，9.533s 收到匹配 `load`，9.799s 核验 8 个矩阵结果，9.959s 收到 `Browser.close` 应答，9.964s CDP 传输关闭。 | `process-exit`。保留句柄最早 30.015s 仍未信号，Node 无 `exit`、子进程 `close` 或输出流关闭。该次表现为关闭应答后的真实根进程退出延迟。 |
| S1 WS 布局 | 5.693s 导航应答，16.879s 匹配 `load`，26.256s 返回 7 个矩阵结果。同步结果解析、验证、哈希与写文件段到 34.982s 才返回。 | 工作期限 28.5s，硬期限 30s。下个 `cdp-connect` 等待直接触发超时，未发送 `Browser.close`。内核最早 30.010s 仍未信号。阻塞点缩小到同步处理段，缺少段内独立计时来区分各操作。 |
| S2 CSS 与图表 | 6.781s 导航应答，10.268s 匹配 `load`，11.222s 核验 4 个矩阵结果，11.336s 收到 `Browser.close` 应答，11.340s CDP 传输关闭。 | `process-exit`。保留句柄最早 30.002s 仍未信号，Node 无 `exit`、子进程 `close` 或输出流关闭。该次表现为关闭应答后的真实根进程退出延迟。 |
| S3 客户表、抽屉、弹窗 | 6.340s 导航应答。收到 21 个 `init`、2 个 `DOMContentLoaded`。唯一 `load` 属于同一主 frame 的上一 loader。28.502s 工作截止时导航仍待目标 loader 的 `load`，矩阵没有结果。28.506s 收到关闭应答。 | `result` 和 `process-exit`。保留句柄最早 30.002s 仍未信号。页面加载未完成，独立内核证据也确认其后释放未赶上硬期限。 |

四次均按首次验证的 PID 和 Windows 创建时间保留独立只读同步句柄。观察器单调样本映射使用 Node 写出时刻与接收时刻夹住原生时钟样本。上表采用映射区间下界。四次的内核等待状态均为 `WAIT_TIMEOUT`（258）。测试保留 `cleanupSafe=false`，随后对其拥有的根句柄请求终止；终止请求与正常退出是两个不同事件。三个诊断子进程自身的关闭被诊断回退定时器打断，已收到的原生句柄样本保留，诊断退出状态未记为通过。[内核记录及原文件 SHA-256](evidence/v61-s3-edge/original/manifest.json) · [Windows 等待状态](https://learn.microsoft.com/en-us/windows/win32/api/synchapi/nf-synchapi-waitforsingleobject) · [Windows 异步终止语义](https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-terminateprocess)

S1 主渲染与 S2 的证据止于浏览器根进程的真实释放延迟，Edge 内部等待原因仍待定位。S3 的对应 loader 仍未完成载入，单个资源或渲染阶段未定位。WS 同次证据支持修复隔离 runner 把同步诊断文件持久化置于关闭之前的问题。记录来自独立启动的 Edge 测试进程，尚无同次数据把这些现象和产品 WebView2 宿主关联起来。[四项逐事件元数据](evidence/v61-s3-edge/original/manifest.json)

原始 stdout、stderr、矩阵文档和失败 profile 留在隔离测试目录。归档去除本机用户路径，保留事件、身份与时间。含 DevTools 端点的原始日志和结果正文仅登记原文件字节数及 SHA-256。[取证清单](evidence/v61-s3-edge/original/manifest.json)

## 隔离 runner 修复与受控复验

`913a9a2` 将原始矩阵 JSON 的落盘移到浏览器资源释放检查之后。JSON 解析、完整用例及视口校验、原始字节哈希、关闭应答、根进程退出、流关闭与进程身份释放均保留。关闭流程仍共享 30 秒期限。写入失败会令测试失败并产生 `RESULT_EVIDENCE_WRITE_FAILED`，若已经存在生命周期失败，元数据保留原失败和独立的写入错误。结果验证开始、生命周期结束及最终状态现在分别记时。[受控测试证据](evidence/v61-s3-edge/controlled/manifest.json)

使用真实 Node 子进程执行旧顺序对照、延迟写入和 `ENOSPC` 三个受控用例。旧顺序将合成写入延迟放在结果返回前，6 秒调用在 6.105 秒失败。修复后，1.500 秒确认正常退出和流释放，诊断文件在 6.113 秒完成，调用通过。`ENOSPC` 用例正常释放后保持 Failed。本地环回 WebSocket **5/5**，包括 `Browser.close` 命令响应关联及旧 loader 的 `load` 无法满足当前导航等待。[命令结果](evidence/v61-s3-edge/controlled/controlled-result-evidence.log) · [环回传输](evidence/v61-s3-edge/controlled/controlled-transport.log)

## 修复后原四入口各执行一次

2026-11-18，`260d29e`，同一 Windows 主机、Node 与 Edge 版本。新版 Windows 观察器 Release 构建通过，0 warnings、0 errors，6.63 秒。实际 Node 子进程的自然退出和截止校准均通过，原生时钟转换区间宽度分别为 2.246ms 和 0.691ms。12:13:32 至 12:14:44 UTC 使用 `ZHIKE_EDGE_OBSERVER_DOTNET` 观察原四入口，以默认参数串行运行各一次，**4/4 通过**。命令外层仍为 180 秒，每次真实 Edge 仍为 30 秒。[命令](evidence/v61-s3-edge/recheck/commands.json) · [校准](evidence/v61-s3-edge/recheck/observer-calibration.json)

| 原入口 | 入口实测耗时 | 同次浏览器证据 |
| --- | ---: | --- |
| S1 主渲染 | 42.367s | 默认八视口矩阵、后续两项主题和四张自动截图共 7 次独立调用。首矩阵 8.677s 匹配 `load`，9.068s 关闭应答，9.988s Node `exit`，10.251s 页面断言完成。 |
| S1 WS 布局 | 13.562s | 2.554s 匹配 `load`，11.855s 核验 7 个视口，结果验证段 5.0ms，12.080s 关闭应答，12.878s Node `exit`，13.029s 页面断言完成。 |
| S2 CSS 与图表 | 3.423s | 1.863s 匹配 `load`，1.870s 核验 4 个图表结果，2.003s 关闭应答，2.860s Node `exit`，3.015s 页面断言完成。 |
| S3 客户表、抽屉、弹窗 | 12.367s | 5.349s 收到当前 loader 的 `load`，10.525s 核验 10 个矩阵结果，10.809s 关闭应答，11.762s Node `exit`，11.937s 页面断言完成。 |

10 次独立 Edge 调用均保留与 PID、创建时间一致的内核句柄退出证据。Windows 根进程退出码为 0，Node `exit`、子进程 `close`、stdout/stderr 关闭、已观察进程身份释放和页面断言完成均有同次记录。`cleanupSafe=true`，未请求强制终止，10 个观察器自身均以 0 退出。历史 0/4 保留。S1 主渲染与 S2 的间歇性内部退出延迟及 S3 的历史加载阻塞仍未定位。独立复验结束时，完整回归仍待执行。[同次汇总](evidence/v61-s3-edge/recheck/summary.json) · [原始账本](evidence/v61-s3-edge/recheck/manifest.json)

## 集成归档字节核验

在集成提交 `4e2af3c` 使用 `git cat-file blob HEAD:<path>` 读取已提交的归档对象，**52/52** 的字节数和 SHA-256 与各自清单一致。主仓工作树中，旧的取证 9 个对象和受控验证 5 个对象已在归档目录设置 `eol=lf` 前以 CRLF 写入。逐条转换为 LF 后，14 个对象的哈希均匹配。复验 38 个对象的工作树原字节已匹配。可直接用 Git 对象字节核验三批档案。[首次取证](evidence/v61-s3-edge/original/manifest.json) · [受控验证](evidence/v61-s3-edge/controlled/manifest.json) · [原入口复验](evidence/v61-s3-edge/recheck/manifest.json)

## 集成完整回归的同次 Edge 记录

2026-11-18 12:30:54–12:43:48 UTC 从 `4e2af3c` 运行 `resources/app/node.exe scripts/run-tests.cjs all`，真实结果 **312/312**，进程退出码 0。命令运行期间新增的是报告和证据提交，完成时读到的 Git HEAD 为 `eacc425`。两次 HEAD 之间的 runner、业务代码及原生宿主源码无差异。全量日志原文件和进程退出记录已登记 SHA-256。[调用映射和全量摘要](evidence/v61-s3-edge/integration/summary.json) · [正式日志摘录](evidence/v61-s3-edge/integration/full-edge-log-extract.json)

| 正式检查 | 调用数 | 生命周期结束距各自启动 |
| --- | ---: | ---: |
| S1 主渲染 | 7 | 3.410–9.879s |
| S1 WS 布局 | 1 | 12.095s |
| S2 CSS 与图表 | 1 | 2.937s |
| S3 客户表、抽屉、弹窗 | 1 | 10.013s |
| Stage 5.1 工作区折叠布局 | 1 | 5.964s |

这 11 次真实 Edge 调用的预算均为 30 秒，Windows 按 PID 和创建时间验证的根退出码均为 0，Node `exit`、子进程 `close`、两条输出流及身份探针关闭均在期限内有记录。各调用均为 `cleanupSafe=true`、`forceTerminated=false`，11 个观察器以 0 退出。四个历史失败入口对应的 10 次调用均保存页面断言完成证据。Stage 5.1 的页面通过由正式全量日志记录。历史首次四次失败及配置目录保留，间歇性退出延迟和加载阻塞的内部原因仍未定位。[逐调用原始证据](evidence/v61-s3-edge/integration/manifest.json)
