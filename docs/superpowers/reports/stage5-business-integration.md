# 阶段 5 业务联调

日期：2026-11-16（Asia/Calcutta）。基线：ad7749f；实现提交：7667837；分支：fix/zhike-61-p0-infrastructure。

环境：Windows 11 专业版 10.0.26300 x64，Node 24.22.1，仓库 .tools/dotnet10。报告随独立文档提交保存，文档最终提交号由 git log -1 给出。生产入口：FROZEN。

命令：node scripts/stage5/business-integration.test.cjs。状态：Passed（隔离环境）。

## 执行链路

1. 既有 MockTransport 创建 default、account-b 两个明确标记的 Mock 账号，并验证断线/恢复。
2. 实际 sidecar 以临时目录启动，启用 isolated group/AI/fencing gate；创建同名同 JID 的两个账号群目录。
3. 确认入群成员关联现有 C-stage5；群消息经实际 /api/ws/group-manager/messages 保存，保留原证据和关联 ID。
4. 建立已授权的隔离会话和 AI Job；实际 fencing lease、原子 claim。
5. WorkerAiIntegration 使用链接的 WorkerRuntimeController、WorkerSupervisor、WorkerIpcProtocol，启动独立 .NET 测试 Worker，经 Named Pipe 传输 jobId/correlationId；Worker 子进程调用现有 Mock Provider。显式 mock=true，未评价 AI 质量。
6. 结果通过实际 AI API 提交；保存证据和 CRM 候选。人工批准通过现有 CRM 权威函数及共享版本检查补全 occupation。
7. 读取共享客户主档和任务审计，检查实际更新与 suggestion.approve 关联 ID。

## 回归断言

- 同 JID 跨账号成员账本独立，相同电话号码跨账号复用 CRM 主档；成员退出不删除客户。
- 其他账号无法领取该任务；未知客户 AI 候选被拒绝；非空 occupation 不被新候选覆盖，产生 conflict。
- 旧格式已读证据 ID 在 delivered→read 时保持不变，避免新算法破坏历史关系。
- 证据关联 ID 与源 Job 冲突返回 409；已 applied 的候选再次拒绝不生成虚假审计转换。
- 阶段 3/4 原有 pending 入群、取消、重试、checkpoint 单调、重复提交、人工保护测试通过全量复用。

## 限制

该测试调度器在测试进程中显式编排各 API；没有上线自动生产调度器。UI 读取与交互运行测试独立于本 API 链路，没有宣称“真实原生窗口到数据库”端到端通过。真实 WS、真实付费 AI、真实聊天质量验收均 NotTested。正式消费者仍关闭。
