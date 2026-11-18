# 阶段 5 验收报告

日期：2026-11-16（Asia/Calcutta）。原始阶段 5 基线：ad7749f；实现提交：7667837；分支：fix/zhike-61-p0-infrastructure。当前验收结论以以下阶段 5.3 为准。

环境：Windows 11 专业版 10.0.26300 x64，Node 24.22.1，仓库 .tools/dotnet10。报告随独立文档提交保存，文档最终提交号由 git log -1 给出。生产入口：FROZEN。

## 阶段 5.3 最终门禁（当前结论，2026-11-16）

**阶段 5 Gate：Passed。生产入口：FROZEN，生产 flags 未启用。** 阶段 6 具备准入条件，本轮未启动；仍不授权生产迁移、真实 WS、正式 Worker/AI 消费、双写或发布。

基线 `fed135e` / `814aa8f` 已核实，开始工作区干净，业务源码无变化。唯一暂留目录完成安全归档后，用户明确选择手动移入回收站并回复“完成”；随后只读核验原精确路径不存在。Agent 本阶段删除尝试 0，没有修改或降低清理门禁。

| 复核项 | 结果 |
| --- | --- |
| 归档 | 24 份 native 诊断 + 6 份测试/编译日志，30/30 来源、阶段 5.2 记录及归档 SHA-256 一致；清理后再次核验通过 |
| 敏感数据 | SQLite、Cookie/Profile、私密连接材料未复制。测试日志中的两处完整 SID 只在当前 SID 可访问且 Git 忽略的本地归档；Git 只提交脱敏清单/校验值 |
| 旧清理阻断 | 已关闭：`C:\Users\酷酷\AppData\Local\Temp\zhike-stage51-native-9ea0b959844a45e082f7955053e5126e` 不存在，历史 16／21 个进程身份检查无残留；不枚举或清空回收站 |
| Worker / WebView2 / 原生交互 | 复用阶段 5.2 已核验证据：IO 5/5、连续 20/20、并发 4/4、原生十页/十次账号切换通过，最终导航 5/5、Core 3、suppressed 0 |
| 性能 | 复用 91 样本、15.59 分钟、工作集合计 1180.7→1214.8 MiB 及退出记录；后半操作仍列于窗外，不新增阈值或宣称所有设备达标 |
| 024 / 测试 / 编译 | 日志 SHA 全部匹配，复用 024 Passed、WS 最终 149/149、全量 259/259、Release 0 warnings / 0 errors。本阶段没有重新执行测试或编译 |
| 首轮 WS 风险 | 首次启动失败原因仍未证实；保留原失败、诊断及最终通过证据，不描述为已经修复 |

本地归档 `.tools/stage53-acceptance-evidence-20261116-cf3013f9/`（已确认 Git 忽略、归档对象常规 DACL 仅允许当前 SID），原始 manifest SHA-256 `b9df0f6c61e690411754cb702681463b9d91a1316944d3e3404ac9da0393acfb`。

详情：[阶段 5.3 最终报告](stage5-3-final-gate.md)、[30 文件及 SHA 清单](stage53-evidence-manifest.json)、[用户清理及门禁证据](stage53-cleanup-and-gate.json)。本阶段仅报告提交，最终 SHA 与清洁工作区检查见交付回复。阶段 5.2 及更早的 Blocked 记录按历史保留，不改写旧失败。

## 阶段 5.2 历史复核（2026-11-16）

输入 `37449b2` / `3591212`，开始工作区干净，代码修复提交 `fed135e70c90f320ece568473d4904c3e74b7b60`。报告独立提交，提交号以最终交付回复及 `git log -1` 核验。详细命令、根因、失败记录、实际数据、回滚与保留项见 [阶段 5.2 稳定性验收](stage5-2-stability.md)。

**阶段 5 Gate：Blocked。生产入口：FROZEN，生产 flags OFF。阶段 6 不允许启动。** Worker 与导航技术阻断已关闭；用户最后选择暂留本轮新 native 测试根，继续保留既有 NotCleaned 门禁，不自行降低标准。

| 验收项 | 本轮实际结果 |
| --- | --- |
| Worker 生命周期 | Passed：取消写入无界等待得到真实复现与修复；原 deadline 和原 750ms 清理预算不扩大；真实 IO 5/5、连续 20/20、同程序集四进程并发 4/4，无残留 |
| 隔离 WebView2 导航 | Passed：去除取消回调再次导航的反馈，稳定 account/generation/surface 恢复预算；真实初次失败后重试、十页/十次账号切换；最终原生显式刷新/重连 5 次导航完成、3 个 Core（含 shell）、0 suppressed，未再复现循环 |
| 原生审核和业务交互 | Passed（已测窗口范围）：实际批准/拒绝/冲突、取消/重试及服务回读，已有客户 2 个、人工字段保留、审计恰一次，账号/群关系隔离 |
| 资源观察 | 完成：91 样本、15.59 分钟；进程树工作集 1180.7→1214.8 MiB，Private Bytes +30.65 MiB，WebView 子进程 12→12；后半操作另列快照。未制定新阈值，未证明真实 WS 吞吐或所有设备性能 |
| 正常退出 | Passed：两轮正常关闭，最后 21 个已观察 PID+创建时间身份全部退出、无未验证身份、锁不存在；监听释放证据见资源附件 |
| 024 checksum / 迁移 | Passed：本轮重新运行兼容、未知差异拒绝、数据保留、备份/恢复及重复迁移检查，未改 SQL |
| 专项 | Stage 5 9/9、Stage 5.1 9/9、Stage 5.2 2/2 |
| WS / 全量 | 最终全量内 WS 149/149、全量 259/259；保留首轮独立 WS 148/149 的服务启动失败。仅捕获 stdio 的诊断及最终重跑均通过，原失败原因未证实，未伪称已修复 |
| WinUI Release | 缺省 x64/win-x64：0 warnings / 0 errors，20.79 秒；仅编译正式 exe |
| 临时目录 | 旧三处已由用户清理并核验不存在；新 `zhike-stage51-native-9ea0b959844a45e082f7955053e5126e` 由用户选择“暂时保留”，NotCleaned/Blocked，已归档非敏感证据且无活跃资源 |

附件：[Worker 根因](stage52-worker.md)、[逐次验证](stage52-worker-repeat-evidence.json)、[导航](stage52-navigation.md)、[原生桌面](stage52-native-desktop.md)、[资源](stage52-resource.md)、[最终关闭](stage52-native-final-close.json)、[测试结果与日志 SHA](stage52-test-results.json)、[暂留决定](stage52-temp-retention.json)。

当前停止条件：不再删除暂留根，不启动阶段 6、真实 WS、正式 Worker 或 AI 消费，不迁移生产库、不双写、不生成安装包。以后仅在用户改变暂留选择后清理并核验该精确目录，再更新门禁；不重复开发已通过模块。生产数据库和人工资料未被本任务打开或修改，默认开关及 CRM 规则未改变。

## 阶段 5.1 历史复核（2026-11-16，保留原始结果）

输入基线 HEAD=`e11b318`，开始时工作区干净；确认代码 `7667837` 与报告 `e11b318` 均存在，已阅读阶段 3、4、5 验收及边界约束。阶段 5.1 修复提交：`3591212`。报告另作独立提交，最终提交号及干净状态以 `git log -1`、`git status --porcelain` 核验。

**阶段 5 Gate 继续 Blocked，阶段 6 不具备启动条件。生产入口 FROZEN，生产 flags OFF。** 未执行生产迁移、正式 Worker/AI 消费、真实 WS 登录、双写或安装包开发。

| 本轮验收项 | 最终状态 | 真实证据与限制 |
| --- | --- | --- |
| 原生十页、二级侧栏、任务重试/取消、CRM 批准/拒绝/冲突 | Passed（已测交互范围） | 实际 WinUI 宿主、隔离 sidecar/SQLite，用户提供不被遮挡环境后补齐任务/日志/设置；10 次快速账号切换，候选隔离及真实服务回读通过 |
| 导航/内容滚轮与侧栏回收空间 | Passed（已测范围） | trusted wheel 导航 0→158、内容 0→417→0，外层不动；收起后回收 158 CSS px；审计 pre 内层及其他 DPI/设备组合未实测 |
| 原生 WebView 与资源稳定性 | Blocked | V3 61 样本/622.3 秒；发现隔离取消外部导航→about:blank→失败恢复反馈，11208 次导航。Core 数稳定不等于无重导航/无闪屏，曲线不能代表正常 WS 性能 |
| 旧 024 checksum 兼容 | Passed | 重构精确旧 SQL（只多一个末尾 LF），真实 server 启动/重复启动、原 ledger 保留、备份/审计、未知差异拒绝等 12 类隔离证据 |
| Worker/IPC/fencing 关键回归 | Blocked | fencing、IPC 及专项独立运行通过，但最终全量 Worker 并发生命周期例超时；不能用后续独立通过覆盖该失败，根因尚未实证 |
| 阶段 5 原三处诊断残留 | Passed | 两个 zkdbg 目录及 mig024.sql 已核实归属后清理，最终不存在 |
| 本轮新增三处 native 临时目录 | Blocked / NotCleaned | 自动审批拒绝递归清理，返回 blocked by policy；保留精确目录，未绕过。最终正常关闭后 21 个已观察进程、监听和锁均释放 |
| 全量回归 | Failed | 本轮重新执行 257 项，256 Passed / 1 超时；不是复制上一轮结果 |
| WinUI Release x64/win-x64 | Passed | 缺省构建、不带隔离 symbol，0 warnings / 0 errors，19.16 秒，未启动生产 exe |

实际修复包括：sidecar 退出缺失 API 授权及无界等待、冷启动服务链依赖 UI 消息泵、群成员未绑定真实账本、审核请求遗漏 suggestionId、人工资料冲突缺审计、二级导航/工作页滚轮注册与滚动恢复、收起侧栏残留空轨道，以及严格的已知 024 EOF 兼容。未修改任何已执行 SQL 迁移文件，未修改客户业务规则。

修复与测试文件清单由 `git show --stat 3591212` 给出；核心涉及 `LocalServiceManager.cs`、测试专用 `Stage51Isolation.cs`/WinUI 条件入口、`migration-runner.cjs`、`server.mjs`、`ws-workbench.js/.css`、`scroll-coordinator.js`、`ai-review-center-ui.js` 及 `scripts/stage51/`。完整测试/回滚记录见 [阶段 5.1 回归](stage5-1-tests-and-gate.md)。

详细附件：

- [原生桌面操作与剩余清单](stage5-1-native-desktop-acceptance.md)
- [资源计数与限制](stage51-performance-resources.md)、[正常关闭证据](stage51-native-late-close-resource-evidence.json)
- [隔离导航循环](stage51-native-navigation-loop.md)
- [024 兼容](stage5-1-checksum-compatibility.md)
- [资源清理与精确路径](stage5-1-diagnostic-cleanup.md)
- [Worker 生命周期超时](stage51-worker-lifecycle-timeout.md)
- [生产边界](stage51-production-boundary-review.md)

剩余阻断与下一步：先为现有隔离生命周期例增加脱敏阶段轨迹并有界复现，查明取消/关闭/恢复并发超时；保留原失败和原安全预算。再修复测试隔离导航与失败恢复的反馈边界，重新执行稳定性及必要全量回归。复杂 IPC 并发建议在下一轮使用更高推理强度集中分析，不能通过放宽超时、降低 ACL 或自动启用生产路径解决。新增测试目录按报告由人工核实处理；本轮不重试被拒清理。**这些是阶段 5.1 未关闭项，不是阶段 6 授权。**

回滚：生产库未被本轮修改；若需要撤回源代码，审查后对 `3591212` 使用 Git revert，保留 `e11b318`/`7667837` 基线，不执行 hard reset 或覆盖用户数据。没有正式安装包或生产迁移需要回退。

## 阶段 5 原始结论（历史记录，以下不替代 5.1 复核）

**阶段 5 Gate：Blocked。** 已完成代码与隔离联调，不能宣布整体 100% 或申请正式发布。

| 验收范围 | 状态 | 证据与限制 |
| --- | --- | --- |
| 十页渲染、账号作用域、搜索、筛选、分页、刷新状态 | Passed | 实际执行 JS 渲染/控制器测试，普通列表 40 条、审核列表 25 条窗口 |
| 原生 WinUI 十页交互、DPI、主题、缩放、WebView 视觉稳定性 | Blocked | 未启动实际桌面宿主；App.OnLaunched 使用现有 Zhike6 数据根，当前无完整隔离 UI 启动配置，不能为测试打开现有工作区 |
| Mock WS → 群成员 → CRM → 消息 → AI Job → .NET Worker → Mock AI → 证据 → 候选 → 审核 → 更新 → 审计 | Passed | 真实临时 sidecar、临时 SQLite、实际 Named Pipe 和生产 Worker Runtime/Supervisor 类；不是 WhatsApp 实测 |
| 多账号隔离、全局客户去重、人工资料保护 | Passed | 同 JID 双账号、同成员双账号、越权领取拒绝、资料冲突不覆盖 |
| 正常旧库升级及中断恢复 | Passed | 0/19/22/23/24→25；进程中断、事务失败、重复迁移、历史记录与备份恢复 |
| 旧 024 错误 checksum 元数据兼容 | Blocked | eeff… 与 SQL 实际 9dc… 不符时继续拒绝；未静默改写历史元数据 |
| IPC 同 SID、取消、Token 轮换、恢复及真实 fencing | Passed | 复用并重跑阶段 1.5/2 测试；本轮跨 SID 复测为 NotTested，不把同 SID 替代为跨 SID |
| Flags 默认关闭、旧消费者权威、无双写 | Passed | 全量中阶段 2–4 flags 与兼容测试 |
| 合成 SQLite 压力查询 | Passed | 122004 条数据、700 次索引查询；不等同于桌面帧率或业务 Worker 吞吐 |
| 编译 | Passed | Release x64/win-x64，0 warnings、0 errors |

## 实际修改

- WS 独立侧边栏保留，页内状态按账号隔离；修复刷新触发后台采集、忙碌状态卡住、旧响应污染新页、隐藏设置抽屉。
- AI/CRM 审核读取携带账号；避免 MutationObserver 重挂载循环；隔离租约下真实审核、待执行任务取消/失败任务重试、详情、证据和审计展示。运行中任务取消仍要求任务所有者。
- 群成员及已读证据 ID：完整身份摘要防止前缀碰撞，已有记录继续使用原 ID。
- 025 追加业务关联字段；来源 Job 的关联 ID 为证据/候选权威；无效关联拒绝；无效重复审核不写虚假审计。
- 复制型测试只复制源码/资源，排除 data、凭据目录、日志和 94 MB 运行时，修复不必要的冷启动成本。

## 测试

专项 9/9 Passed；WS 149/149 Passed（本轮独立执行，并包含在全量中）；全量新增 10 个顶层检查。最终计数见 stage5-tests.md。所有命令均实际执行。

## 数据与停止边界

测试显式指定临时 DATA_DIR；未对生产库执行迁移/回填、未启动正式 Worker、未登录真实 WS、未调用付费 AI、未切换消费者。原测试递归复制应用 data 的风险已移除，未将副本当生产数据运行。未生成安装包。

尚未完成：原生隔离 UI 验收、024 错误元数据的审查/修复策略、Worker 业务吞吐与原生 CPU/帧率长期测试。两处诊断临时目录及一份 SQL 副本删除被自动审批拒绝，路径见回滚报告；不能声称零残留。

下一步：先关闭上述阶段 5 阻断项，再审议阶段 6 安装部署；当前不具备阶段 6 准入结论。
