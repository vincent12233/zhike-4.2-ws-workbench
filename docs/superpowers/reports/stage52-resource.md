# 阶段 5.2 资源观察与临时目录处理

日期：2026-11-16（Asia/Calcutta）。基线 `37449b2`。生产入口 FROZEN。

## 首轮只读核验

UTC 14:20:17，三个阶段 5.1 native 根均存在、解析后与报告精确路径相同、非 reparse point，`.stage51-isolated` 内容均为 `zhike-stage51-isolated-ui-v1`。没有隔离 native 应用进程或根级 lock 文件。

| 精确目录 | 现有类型与归属 | 本轮处理 |
| --- | --- | --- |
| `C:\Users\酷酷\AppData\Local\Temp\zhike-stage51-native-248a3820ba4f4b6abbfa8c09fd957da5` | 原首版启动诊断，事件日志 394 字节和资源日志 | 保留；仅事件日志已归档 |
| `C:\Users\酷酷\AppData\Local\Temp\zhike-stage51-native-92eccfc80f164b15b7fcd1618058cb21` | 原 V2–V4 合成库、空白 profile、资源/事件日志、私密连接文件 | 保留；仅事件日志已归档，未读取/复制私密连接、库或 profile |
| `C:\Users\酷酷\AppData\Local\Temp\zhike-stage51-native-95d5941432654bf9906247471c41ddce` | 未启动 prepare 根，仅隔离标记 | 保留 |

父任务本轮尝试仅删除 95 根的 marker 与空目录（非递归、非 Force）仍在 CreateProcess 前遭 `blocked by policy` 拒绝，未执行删除。自此所有自动删除停止；资源子任务没有改用逐文件、其他 shell 或 GUI 清理这些目录。

用户随后回复已手动清理三处。UTC 14:36:06 再次只读核验三个精确路径均不存在；原始事件备份 SHA 与归档 manifest 仍一致。最终清理状态 `Passed`，执行者为用户；本轮自动删除数量 0。证据：`stage52-old-temp-cleanup.json`。没有恢复这些已删除根，新的原生测试将另建带标记 GUID 根。

## 原始事件证据备份

只复制两个精确 `native-events.jsonl`，源文件保留；目标是 ignored `.tools/stage52-baseline-native-events-20261116/`，并保存 `manifest.json`。没有复制 `connection.private.json`、SQLite、profile 或登录材料。

- 248a 日志 394 字节，SHA-256 `4efd30ead7bdb652f16ba059e6c81bcced0875776e71845a6c32797a445a243f`。
- 92ecc 日志 5602528 字节，SHA-256 `a347dee167ba185a20a52576bca2a655b50a479297d9fb3c274d0433b8341622`。

两份源与副本 hash 均实际相同。没有用有限导航采样代替本备份的完整事件文件。

## 本轮正式资源实测

实际命令：`scripts/stage52/resource-observe.ps1 -RootPid 19572 -TestRoot <本轮隔离根> -Samples 91 -IntervalSeconds 10 -OutputName stage52-observation-final.jsonl -BuildConfiguration Release`。复用阶段 5.1 真实进程采样器，连续 91 个样本，UTC 14:58:00.180 至 15:13:35.209，Stopwatch 935519.7ms（15.59 分钟）；每行进程加和已验证。一次启动消息竞态导致的额外 sampler 已安全中断，不计正式数据。

环境实际核验：Windows 11 专业版 10.0.26300 x64，PowerShell 7.6.9，Release；应用文件版本 6.0.3.0/ProductVersion 6.0.3+37449b2，源码为本轮修复；实际 WebView2 子进程文件版本 `157.0.4341.46`，与安装元数据一致。没有读取 profile 或登录态。样本为 2 账号、4 群、4 成员关系、2 合成现有客户、8 Job、6 候选，真实操作由父任务 CUA 完成。

| 指标 | 首样本 | 末样本 | 观测 |
| --- | ---: | ---: | --- |
| 工作集字节 | 1238093824 | 1273778176 | +35684352；峰值 1387790336 |
| Private Bytes | 644952064 | 677093376 | +32141312；峰值 770334720 |
| 线程 / 句柄 | 359 / 9034 | 338 / 9270 | 峰值 372 / 9340 |
| WebView2 子进程 | 12 | 12 | 不能当作 Core 实例数 |

已观察 CPU 累计增量 57.9844 秒。没有正式性能阈值，本报告不从工作集增长推断泄漏，也不声称无限期稳定。正式窗口覆盖启动后与成员/AI/CRM 部分交互；十页后半、十次账号切换和后续长空闲发生在窗口之后，按操作账本和关键快照单列，不能说全部包含在 15.59 分钟内。

## 原生生命周期与证据限制

第一轮 PID 19572：十页进入/退出、十次切换及审核由父任务实操；正常关闭后，正式样本 16 个身份与关闭前 21 个身份两套检查均 remaining=0/unverified=0，端口 51469 无监听、锁不存在。原 counter 文件没有完成退出前最终 flush，不能把旧 counter 当作完整总数；原始各类日志未达上限，单独保留此限制。

第二轮 PID 3884：在修复最终 flush 及显式刷新命令后，父任务完成短原生复验。`stage52-native-final-close.json` 记录关闭后 21 个身份全部退出、锁不存在；最终 20 类 counter 的 suppressed=0，WS NavigationStarting/Completed 各 5（两账号首次进入、两次显式刷新、一次重新连接），Core 共 3。这次短复验不能冒充第二个 15 分钟窗口。

首轮白名单 23 文件归档 `.tools/stage52-native-evidence-19572/manifest.json`，后续 24 文件由父任务归档 `.tools/stage52-native-evidence-final/manifest.json`；仅日志、计数、资源、上下文与合成 seed 证据，无私密连接、数据库或 profile。早期两条 phase ledger 的嵌套 counter 被默认 JSON depth 字符串化，历史未改；Depth12 修复后实际 native marker 的 stdout/ledger 嵌套数值类型回归 Passed（16 类真实计数）。

## WS 启动诊断与最终清理状态

首轮 WS group-monitor 测试曾报 15 秒 server unavailable，原例 stdio ignore，没有证据唯一确认起因。仅给原测试增加输出捕获的隔离诊断已执行：测试 exit0、1012.2ms；子进程 21152 正常测试清理收到 SIGTERM 后退出，stderr 空，stdout 约 559ms 报自身临时库/4588 启动。未改测试端口、业务断言或超时，不能以重跑成功编造原故障原因。日志：`.tools/stage52-ws-startup-utqX9Y/{result.json,stdout.log,stderr.log}`。父任务随后实际全量 259/259 Passed，含该例；Release 0 warnings/0 errors，以主报告为准。

旧三目录由用户人工清理并只读核验 Passed。本轮新根 `C:\Users\酷酷\AppData\Local\Temp\zhike-stage51-native-9ea0b959844a45e082f7955053e5126e` 用户明确选择暂时保留，未删除，进程与监听已释放；自动删除数量仍为 0。按既有 NotCleaned 门禁，整体 Gate 继续 Blocked，生产入口 FROZEN；不启动阶段 6。
