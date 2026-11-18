# 阶段 4 AI 队列报告

## 统一任务边界

`ai_jobs` 仍是旧表兼容入口；阶段 4 通过适配层补充 `job_type`、`customer_id`、`group_jid`、`source_message_id/source_event_id`、`priority`、`checkpoint_json`、`cancel_requested`、`worker_owner_id` 和 `fencing_token`。历史状态不被重写，旧 `/api/ws/ai-jobs` 仍保持生产权威。

## 生命周期

隔离 Pipeline 支持：`pending → queued → running → completed`、`running → retry_scheduled/failed`、未终态任务 `→ cancelled`。领取使用条件更新和 lease token；checkpoint 只允许单调推进；完成/失败必须携带当前 lease；重复提交使用幂等键；取消后的完成会被拒绝。

## 来源和证据

任务可关联账号、客户、会话、群组和消息/事件。`ai_job_evidence` 保存来源类型、来源 ID、引用文本、捕获时间和受限数据 JSON；`ai_task_audit` 记录状态变化、操作者和原因。日志和测试不保存 API Key、Cookie、Token 或真实聊天凭据。

## 验证状态

- `node scripts/run-tests.cjs stage4`：`47/47 Passed`
- `scripts/stage4/ai-pipeline-api.test.cjs`：Passed（隔离服务、lease、fencing、checkpoint、取消、重试、结果、证据和幂等）
- `scripts/stage4/api-client-stage4-contract.test.cjs`：Passed

真实 Worker 消费、真实 AI Provider 和生产切换：`NotTested`（按本阶段禁止事项保持）。
