# 阶段 4 迁移报告

## 迁移

新增 `024-ai-pipeline-crm-review.sql`，仅追加结构，不修改已执行的 019–023 历史迁移。`manifest.json` 的支持版本提升为 24，并使用迁移运行器实际的内容哈希算法登记校验值。

新增内容：

- `ai_jobs` 可选扩展字段及查询索引
- `ai_crm_suggestions`
- `ai_job_evidence`
- `ai_task_audit`
- 候选状态和幂等索引

## 验证

- `scripts/stage4/ai-pipeline-migration.test.cjs`：在临时 SQLite 上验证迁移顺序、版本和重复执行安全性，Passed。
- 阶段 4 API 测试使用临时数据根；没有打开或修改生产 SQLite。
- 迁移失败时由现有 migration runner 保持事务回滚；发布前必须再执行备份、校验和升级恢复演练。

## 兼容与回滚

旧队列字段和历史 AI 结果保留；阶段 4 路由关闭即可回到旧读取/处理路径。回滚应用版本时保留 schema 24 的新增表，不删除业务数据；如需数据库降级，必须使用经过验证的备份恢复，不执行破坏性 down migration。
