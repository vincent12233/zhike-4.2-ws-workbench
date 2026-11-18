# 阶段 4 验收报告

## 阶段与门禁

- 阶段：阶段 4 AI 队列与 CRM 深度集成（隔离开发）
- 基线：阶段 3 `058407e`
- 生产入口：`FROZEN`
- 新 Worker、真实 WS、真实付费 AI、生产 SQLite 和新旧队列双写：均未启用

## 实际实现

- 迁移 `024-ai-pipeline-crm-review.sql`：AI Job 扩展字段、CRM 候选、来源证据、任务审计及幂等索引。
- 统一隔离 AI Job 状态机：原子领取、lease、fencing、checkpoint 单调推进、取消、重试、结果校验和幂等。
- CRM 候选审核：唯一现有客户、空白字段和人工保护、证据、状态版本、审计；未知客户不会自动建档。
- Mock Provider：仅隔离测试，支持取消/超时/结构化结果，不发起网络请求。
- 审核中心 UI：读取真实 API 状态；生产冻结时显示明确禁用状态，不展示写死样例。
- WinUI `ApiClient`：保留旧队列真实读取，并增加隔离 AI queue、fencing lease、CRM suggestion 和审核调用契约。

## 实际验收结果

| 门项 | 状态 | 证据 |
|---|---|---|
| 阶段 4 专项测试 | Passed | `node scripts/run-tests.cjs stage4`，当前版本 47/47 |
| AI Job 生命周期/幂等/fencing | Passed（隔离） | `scripts/stage4/ai-job-pipeline-core.test.cjs`、`ai-pipeline-api.test.cjs` |
| CRM 候选/审核/人工保护 | Passed（隔离） | `scripts/stage4/ai-crm-suggestion-core.test.cjs`、`ai-pipeline-api.test.cjs` |
| 迁移 024 | Passed（临时 SQLite） | `scripts/stage4/ai-pipeline-migration.test.cjs` |
| AI 开关默认关闭 | Passed | `scripts/stage4/worker-ai-flags.test.cjs` |
| 桌面 ApiClient 契约 | Passed | `scripts/stage4/api-client-stage4-contract.test.cjs` |
| WS 回归 | Passed | `node scripts/run-tests.cjs ws`，149/149 |
| 全量回归 | Passed | `node scripts/run-tests.cjs all`，238/238 |
| WinUI Release x64/win-x64 | Passed | `.tools\\dotnet10\\dotnet.exe build ... -p:Platform=x64 -r win-x64`，0 warnings/0 errors |
| `git diff --check` | Passed | 无 whitespace 错误（仅 Git 的换行提示） |

## 仍未验收项目

真实 AI Provider 质量、真实 WhatsApp/WS 登录和消息完整性、正式 Worker 上线、跨设备安装/升级/迁移、生产数据回放均为 `NotTested`，不能据此宣称正式发布。

## 结论

阶段 4 隔离实现 Gate：`Passed`。生产入口继续 `FROZEN`，等待单独批准；本阶段没有生产数据变更。
