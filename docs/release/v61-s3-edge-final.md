# S3 Edge 最终专项验收

2026-11-18，专项分支 `fix/61-edge-final` 从 `8cb12f4` 开始。用 `af71fd9` 在 Windows 上串行执行原四个视觉入口，各一次。浏览器 Edge 157.0.4341.60，捆绑 Node v24.22.1。每个命令使用原有默认参数、180 秒入口预算和 30 秒单次 Edge 预算。**原入口 3/4 通过，Edge Gate Blocked。Production FROZEN。** 原入口的新运行和历史完整回归分别归档。[本次命令及退出码](evidence/v61-s3-edge/final/commands.json) · [历史取证和 312/312 集成回归](v61-s3-edge-invocation.md)

## 原入口实测

下表的浏览器事件均以对应调用启动为起点。主渲染入口的重点时间取首个八视口矩阵，另有两个主题检查和四次截图调用。

| 原入口 | 命令耗时 / 退出码 | 浏览器同次观测 |
| --- | --- | --- |
| S1 主渲染 | 39.353s / 0 | 7/7 调用证据完整。首矩阵 1.729s 导航应答，9.193s 匹配 `load`，9.619s 关闭应答，10.466s Node `exit`，10.757s 页面断言完成。 |
| S1 WS 布局 | 18.074s / 0 | 4.305s 导航应答，5.448s 匹配 `load`，16.486s 核验 7 个结果，结果验证历时 6.933ms，16.672s 关闭应答，17.500s Node `exit`，17.596s 页面断言完成。 |
| S2 CSS 与图表 | 2.820s / 0 | 1.269s 导航应答，1.692s 匹配 `load`，1.699s 核验 4 个结果，1.814s 关闭应答，2.488s Node `exit`，2.571s 页面断言完成。 |
| S3 客户表、抽屉、弹窗 | 31.896s / 1 | 当前 loader 到达 `DOMContentLoaded` 后未出现 `load`。28.500s 工作预算到期，28.504s 收到关闭协议应答，30 秒硬截止时根进程仍存活。页面断言未到达。 |

九次成功调用均匹配导航 loader、frame、`Browser.close` 请求和协议应答。Windows 保留句柄身份与 Node 启动时的 PID、创建时间一致，根进程退出码均为 0。Node `exit`、子进程 `close`、stdout/stderr 各自关闭、身份探针释放和视觉断言均有同次记录。整体流关闭比 Node `exit` 晚 7.4–9.0ms。九次的 `cleanupSafe=true` 且无强制终止请求，浏览器生命周期最长 17.585s。独立观察器 Release 构建退出码 0、0 警告、0 错误。自然退出和截止校准通过，时钟转换区间宽 2.249ms、0.535ms。[时间线与关联 ID](evidence/v61-s3-edge/final/summary.json) · [观察器校准](evidence/v61-s3-edge/final/observer-calibration.json)

## 客户表失败的两条证据链

调用 `1795008167315-6c18f709-e9e2-47f1-b031-eb97532cfa19` 的根进程 PID 为 `31260`，启动时 Windows 创建时间为 `639306049673204605`。

1. **当前导航未完成。** 3.085s 发出导航，3.250s 收到应答，3.638s 当前主 frame 和 loader 收到 `DOMContentLoaded`。唯一的 `load` 在 3.084s 来自同一主 frame 的上一 loader。十个子 frame 开始加载，共报告二十次子 frame `init`。十个子 frame 到截止时均无 `DOMContentLoaded`、`load` 或停止加载事件。在历史通过调用中，十个子 frame 均报告了这三类完成事件。runner 在收到协议消息时直接记录这些事件与 ID。失败调用未进入矩阵结果验证阶段。[本次生命周期](evidence/v61-s3-edge/final/s3-customer-table-visual-1.lifecycle.json) · [历史同入口通过的生命周期](evidence/v61-s3-edge/recheck/s3-customer-table-visual-1.lifecycle.json)
2. **关闭应答之后根进程仍在运行。** 28.504s 发出 `Browser.close`，28.504s 收到同命令 ID 的应答，28.509s CDP 关闭。独立保留句柄回报 `WAIT_TIMEOUT=258`，映射到 runner 时钟为 **30.006536–30.007014s**。根进程仍存活的采样早于 **30.007056s** 的拥有句柄终止请求。该请求返回已发出。截止时 Node 尚未收到根 `exit`、子进程 `close` 或两条输出流关闭，随后发生本地流释放。记录保留 `cleanupSafe=false` 与独立的 `process-exit` 超时。13:25:01 UTC 的限定 PID 复核发现五个已记录 PID 均已消失，失败 profile 仍在。观察器自身退出码为 0。[内核原始记录](evidence/v61-s3-edge/final/s3-customer-table-visual-1.kernel.jsonl) · [后续限定 PID 检查](evidence/v61-s3-edge/final/failed-profile-follow-up.json)

本次证据确定导航缺少完成事件、浏览器根进程释放跨过期限两个阶段。19 张本地样式表和本地品牌图由十个同源文件 fixture 共享。当前观测粒度无法确认发生等待的具体资源或 Chromium 内部阶段。S1 主渲染和 S2 的原始调用也曾在更早收到关闭应答后仍活到硬截止，本轮所测入口均正常退出，历史间歇性风险保留。以上影响隔离 Edge 验收稳定性，产品原生 WebView2 需要独立证据。[历史失败记录](evidence/v61-s3-edge/original/summary.json)

## 资源阶段定向取证

`6fd74a5` 为独立、已拥有的页面会话增加显式启用的 `Network` 资源取证。只接收该会话事件，最多记录 512 条资源请求。每条记录保留本地文件允许名单标签、关联 frame 和 loader、请求、应答、完成或失败时间。关闭前冻结采样，记录仍等待的请求数。原始 URL、参数和请求头不进入元数据，`Network` 事件与页面等待队列隔离。默认入口不启用。

13:28:23–13:28:39 UTC 单独执行一次带 `ZHIKE_EDGE_NETWORK_DIAGNOSTICS=1` 的原 S3 客户表入口。退出 0，命令耗时 15.884s，十个视觉用例均完成。关联 ID `1795008503415-f9c8481f-4b5f-4566-b1d0-783c7296aba2`。4.230s 收到当前主 loader 的 `load`，十个子 frame 均有完成事件。记录 11 个 frame 的 241 条资源请求全部完成，采样上限未触及，关闭前待处理 0。10.760s Node 收到根进程正常退出，10.871s 页面断言结束，`cleanupSafe=true`。定向采集未复现超时，提供了一次健康资源时序基线。原四入口的 3/4 结果和失败 profile 保留，哪一项资源或渲染工作阻塞原失败仍未确定。[定向命令与退出码](evidence/v61-s3-edge/final/s3-resource-probe.commands.json) · [资源分类与同次汇总](evidence/v61-s3-edge/final/s3-resource-probe.summary.json) · [逐请求生命周期](evidence/v61-s3-edge/final/s3-resource-probe.lifecycle.json)

## Runner 时间边界

`af71fd9` 增加单调时间检查。Node 主线程阻塞时，履约微任务可以在已经过期的定时器之前被调度。受控旧写入顺序配合 `8cb12f4` helper 时，6 秒调用在阻塞后先报告 `resultReady=true`，然后才在 `request-close` 失败。相同用例与新 helper 在 `result` 阶段拒绝超出 4.5 秒工作预算的履约，`resultReady` 保持未设置。原来的失败结果保留，准确标记首个已越界阶段。延迟落盘仍发生在资源释放之后，诊断写入错误仍令调用失败。

受控证据子集 3/3，通过完整 lifecycle 组的 13 个参数检查和 15 个独立子进程用例，CDP 环回 5/5。资源诊断在现有 CDP 组内增加了一项数据边界和脱敏检查，检查通过。原 312 项注册入口和四个原视觉文件均保留，完整回归由集成侧另行记录。[边界对照及命令结果](evidence/v61-s3-edge/final/controlled-summary.json) · [旧 helper 原记录](evidence/v61-s3-edge/final/control-old-inline-baseline.json) · [新 helper 原记录](evidence/v61-s3-edge/final/control-old-inline-fixed.json)

原始命令 stdout/stderr、失败 profile 和结果文件留在隔离目录。证据清单登记原件字节数与 SHA-256，并记录已归档对象的独立哈希。核验 79 个原件和 46 个 Git 归档对象，字节数和 SHA-256 均匹配。归档生命周期中的本机路径和原始失败正文使用占位符。[归档清单](evidence/v61-s3-edge/final/manifest.json)

## 集成完整回归的独立 Edge 证据

14:32:48–14:46:05 UTC 从集成提交 `e0b534c` 执行一次 `resources/app/node.exe scripts/run-tests.cjs all`。完整回归 **312/313，退出 1**。313 项保留原 312 项，并增加一项隔离窗口就绪顺序检查。此轮启用了 Windows 保留句柄观察器和 `ZHIKE_EDGE_NETWORK_DIAGNOSTICS=1`。原四个真实 Edge 入口 **4/4 通过**，全部 10 次浏览器调用均记录视觉断言完成。Stage 5.1 的一项附加真实调用由官方入口日志记录断言结果。早先按默认参数单独执行的 **3/4** 及其失败证据继续独立保留。[全量命令与退出](evidence/v61-s3-edge/final-integration/full-outcome.json) · [逐入口与关联 ID](evidence/v61-s3-edge/final-integration/summary.json)

| 集成真实 Edge 入口 | 调用数 | 生命周期结束距各次启动 |
| --- | ---: | ---: |
| Stage 5.1 工作区折叠 | 1 | 6.021s |
| S1 主渲染 | 7 | 4.255–9.475s |
| S1 WS 布局 | 1 | 15.458s |
| S2 CSS 与图表 | 1 | 3.309s |
| S3 客户表、抽屉、弹窗 | 1 | 11.470s |

全部 11 次调用的保留句柄均匹配 PID、创建时间且确认根进程退出码 0。Node `exit`、子进程 `close`、两条输出流和身份探针均在 30 秒内正常释放，`cleanupSafe=true`，无强制终止请求。观察器共记录 702 条资源请求，全部完成，无失败、溢出或待处理。客户表调用 `1795013125958-ee628f90-2cda-4440-9dae-e05b51f69bbc` 的当前主 loader 在 4.551s 完成 `load`，十个子 frame 均到达 `DOMContentLoaded`、`load` 和停止加载，视觉断言在 11.504s 结束。该批次未复现先前的资源等待与关闭超时。历史故障的内部原因仍未定位。[客户表同次事件](evidence/v61-s3-edge/final-integration/s3-customer-table-visual-1.lifecycle.json) · [集成归档清单](evidence/v61-s3-edge/final-integration/manifest.json)

唯一失败是 `Delivery S1 isolated browser process ownership and safe release` 中的受控 Windows 文件共享用例。先行的独占文件用例观察到一次 `EBUSY` 并成功释放。随后预算为 4 秒的持续锁用例 `1795013048193-61a6e96f-9b79-43f2-ac2c-1ec9faa9ceae` 在 1.019s 验证 PowerShell 身份，3.004s 到达 `lock-ready` 超时。两条流均无输出，保留的夹具目录里没有发现预期端点文件。4.003s 达到根进程退出期限，发出拥有句柄的终止请求，`cleanupSafe=false`。该次未走到 `EBUSY` 轮询，测试读取未初始化的 `devToolsReadiness.ebusy`，使全量日志最终显示 TypeError。证据定位到锁夹具就绪和错误呈现，PowerShell 未就绪的内部原因未知。失败受控目录继续保留，本轮未重跑。[文件锁受控汇总](evidence/v61-s3-edge/final-integration/controlled-readiness-summary.json) · [失败调用原始生命周期](evidence/v61-s3-edge/final-integration/controlled-bounded-readiness.lifecycle.json)

已核对 50 个原始文件及 38 个 Git 归档对象的字节数和 SHA-256。全量原始日志以指纹引用，浏览器和受控调用的已归档元数据移除了本机路径和原始失败正文。[集成归档清单](evidence/v61-s3-edge/final-integration/manifest.json)
