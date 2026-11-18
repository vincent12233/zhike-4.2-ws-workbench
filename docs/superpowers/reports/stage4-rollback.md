# 阶段 4 回滚与安全报告

## 应用回滚

1. 保持 `WorkerRuntimeEnabled`、`WorkerQueueAdapterEnabled`、`WorkerFencingEnabled` 及全部 AI 开关关闭。
2. 不启用 `ZHIKE_AI_PIPELINE_MODE=isolated` 或 `ZHIKE_STAGE4_MOCK=1`。
3. 关闭后 `/api/ws/ai-pipeline` 与 `/api/ws/ai-review` 返回 `AI_PIPELINE_DISABLED`，旧队列接口继续作为生产路径。
4. 如需版本回退，保留客户、消息和历史 AI 数据；先做备份，再按版本兼容矩阵恢复应用。

## 数据回滚

审核写入经过 CRM 状态版本校验和治理审计。迁移 024 为追加式；不执行删除表或覆盖历史迁移。出现异常时停止隔离 Worker，保存日志和临时数据库，使用备份恢复或人工核对，不直接编辑生产 SQLite。

## 风险

- 真实 AI 提供商输出、网络错误和模型质量尚未验收。
- 真实 WS 会话、历史完整采集和多账号切换尚未验收。
- 跨设备安装、升级和迁移不属于本阶段证据。
- 若未来打开 AI 自动补全，必须另行批准并完成生产数据回放、并发和人工保护验收。
