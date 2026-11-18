# 阶段 5 测试记录

日期：2026-11-16（Asia/Calcutta）。基线：ad7749f；实现提交：7667837；分支：fix/zhike-61-p0-infrastructure。

环境：Windows 11 专业版 10.0.26300 x64，Node 24.22.1，仓库 .tools/dotnet10。报告随独立文档提交保存，文档最终提交号由 git log -1 给出。生产入口：FROZEN。

## 实际命令

| 命令 | 结果 |
| --- | --- |
| node scripts/run-tests.cjs stage5 | 9/9 Passed |
| node scripts/run-tests.cjs ws | 149/149 Passed |
| node scripts/run-tests.cjs all | 248/248 Passed，最终复核时实现 HEAD 为 7667837 |
| .tools/dotnet10/dotnet.exe build desktop/src/Zhike.Desktop/Zhike.Desktop.csproj -c Release --no-restore -p:Platform=x64 -r win-x64 --nologo -v:minimal | Passed，0 warnings / 0 errors |
| .tools/dotnet10/dotnet.exe build scripts/stage5/WorkerAiIntegration/WorkerAiIntegration.csproj -c Release --nologo -v:minimal | Passed，0 warnings / 0 errors |
| git diff --check / git diff --cached --check | Passed |

新增 9 个阶段 5 顶层检查与 1 个测试副本安全检查。9 项中包含复用基础设施脚本的组合检查，不把内部断言重复算新增测试。all 已纳入 Stage 5，因此 248 包含原 238 与新增 10，不再把专项与全量相加。

文档生成时工作区只剩本轮七份新报告；实现代码已提交。文档提交后的最终状态通过 git status --porcelain 再次确认，最终交付提交号由 git log -1 给出。

专项覆盖：基线、十页渲染、真实隔离业务链路、迁移演练、快照恢复、Worker/IPC/fencing 复用、UI 刷新控制器、审核模块运行、122k 合成索引查询。

## 失败与修复记录

1. baseline manifest 024 checksum 与 SQL 不符，迁移真实失败；仅清单纠正，历史 SQL 未改。旧错误元数据兼容仍 Blocked。
2. 第一轮全量 232/238，第二轮 231/238，失败集中冷启动或复制型测试超时。曾扩大部分启动等待；随后根因复核发现 app 全目录复制读取 data、重复复制大型运行时，改源码白名单。恢复默认单检查 120 秒，定向重跑 fencing/备份/HTTP/旧队列通过。
3. 双账号/同群第二成员写入暴露 ID 前缀碰撞，改完整键 SHA256；审查发现旧 read-evidence ID 升级回归，补测试复用已有 ID。
4. 来源 Job correlationId 被请求覆盖和重复审核伪审计已修正，隔离 API 新增 409 和 no-op 审计验证。
5. 审核 UI 无账号请求、重挂载循环、审核按钮永远禁用、页刷新忙碌卡住均有执行测试。

## 安全与环境限制

Named Pipe 同 SID 的实际测试通过；本轮没有创建第二 Windows 用户，跨 SID 复测 NotTested，旧阶段 1.7 证据没有冒充本轮执行。生产 flags 没有修改。所有新 Worker 与 sidecar 测试配置指向临时目录；无真实 WS 登录、无付费 AI、无正式生产迁移/消费者切换。

WinUI 编译不能替代原生交互；DPI/主题/多屏与 WebView 抖动验收仍 Blocked。测试通过不使 Stage 5 Gate 自动通过。
