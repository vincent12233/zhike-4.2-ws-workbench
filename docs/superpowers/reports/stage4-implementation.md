# 知客 6.1 A+B 阶段 4 实施报告

## 范围与门禁

- 阶段：阶段 4 AI 队列与 CRM 深度集成（隔离开发）
- 基线：阶段 3 `058407e`（本轮实际提交号以最终 Git commit 为准）
- 生产入口：`FROZEN`
- 允许范围：隔离数据库、隔离进程、Mock AI、自动化测试和桌面端契约接入
- 明确未启用：正式 Worker、真实 WhatsApp/WS、真实付费 AI、生产队列切换、生产 SQLite 回填、新旧队列双写

## 已实现模块

1. `024-ai-pipeline-crm-review.sql`：为 `ai_jobs` 增加任务类型、来源、优先级、checkpoint、取消和 fencing 关联字段；新增 `ai_crm_suggestions`、`ai_job_evidence`、`ai_task_audit`。
2. `ai-job-pipeline-core.js`：统一任务状态、原子领取、checkpoint 单调推进、取消、重试、结果校验和幂等键；保留旧队列兼容辅助函数。
3. `ai-crm-suggestion-core.js`：只允许唯一匹配现有客户，保护人工字段和非空字段，保留证据并支持审核批准/拒绝/冲突。
4. `ai-mock-provider.js`：仅用于隔离测试的可取消、可超时结构化 Mock Provider，不发起网络请求。
5. `server.mjs`：新增隔离 AI Pipeline/CRM Review API；默认关闭，所有写入经 fencing writer 和 lease 校验；旧 `/api/ws/ai-jobs` 保持不变。
6. `ai-review-center-ui.js`：读取真实 API 状态、证据与候选，不生成固定示例数据；生产冻结时明确提示。
7. `WorkerFeatureFlags.cs`：新增 AI pipeline、AI worker、CRM suggestion、CRM autofill、review center 开关，默认 fail-closed。
8. `ApiClient.cs`：保留旧队列的真实只读读取，并提供隔离 AI 队列查询、任务操作、fencing lease、CRM 候选查询和审核调用契约；未在旧路径上静默模拟重试成功。

## 关键边界

普通聊天 AI 不创建未知客户；群组候选必须有可信身份映射；CRM 审核通过仍经 CRM 权威状态写入、状态版本校验、证据记录和治理审计。关闭隔离开关时，AI Pipeline 路由返回 `AI_PIPELINE_DISABLED`，旧生产路径不被替换。

## 真实限制

本报告不代表真实 AI 质量、真实 WhatsApp 消息完整性、正式 Worker 发布或跨设备安装验收已完成；这些必须在独立授权和真实环境验收阶段完成。

## 本轮实际验证

- 阶段 4 专项：47/47 Passed。
- WS 回归：149/149 Passed。
- 全量回归：238/238 Passed。
- WinUI Release x64/win-x64：0 warnings / 0 errors。
- `git diff --check`：Passed。
