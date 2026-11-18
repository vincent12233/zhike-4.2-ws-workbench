# 阶段 5.1：024 Migration Checksum 兼容复核

日期：2026-11-16（Asia/Calcutta）。检查基线：e11b318（报告），7667837（阶段 5 实现）；阶段 4 引入提交：ad7749f9475d79dabaabe94d89874fcfdd95ed5f。

## 历史与字节证据

实际执行：

- `git log --all --oneline -- resources/app/migrations/024-ai-pipeline-crm-review.sql resources/app/migrations/manifest.json`
- `git show ad7749f:resources/app/migrations/024-ai-pipeline-crm-review.sql`，使用 Node 对原始字节及规范 LF 内容计算 SHA-256。
- 在 resources/scripts/docs/tests 中检索所有文件名和旧 hash 引用；仓库内只有一个 024 SQL 文件。全 Git 可达历史里 SQL 只在 ad7749f 引入，阶段 5 没有修改该 SQL；阶段 5 仅修正 manifest checksum。
- Git SQL blob：`be1b68b704bbad21d47caaece87f0edd1dff56e3`。

| 内容 | 字节数 | SHA-256 |
| --- | ---: | --- |
| 当前及 ad7749f 已提交 SQL，最后一个分号后 1 个 LF | 3777 | 9dc642557b9007b9de83c73aab035e017caa7d41a2ed58b1cb275e9fb9dd640f |
| 上述 SQL **精确再加 1 个末尾 LF**，无其他变化 | 3778 | eeff6bc11ed4de1573199d1cb71897b7853b5f750c0b7cd353dfff4a1cbda4b6 |

因此旧清单 hash 的内容可以被字节精确重建；差异是末尾空行，不含 DDL 差异。没有找到包含 3778 字节的已提交 SQL blob，故不能声称找到了历史生产数据库或原始发布包。测试在隔离目录重建此 3778 字节文件，以原清单 hash 真实执行迁移 024 并生成旧注册记录；不是只把当前数据库的 checksum 字符串改成旧值。

## 修复

修改 `resources/app/migration-runner.cjs`：

1. 严格保持 migration 文件与 manifest 的 SHA-256 校验。已知额外 LF 也不能绕过当前文件校验。
2. 只有 version=24、确切文件名、当前完整 hash、旧完整 hash、以及“当前 SQL + 单个 LF”重新计算匹配时，才能进入兼容复核。
3. 在内存 SQLite 中重放同一已登记迁移链，比较 024 所属 4 张表的真实 table/index/trigger SQL 指纹（按当前 schema 版本含后续迁移）。未知 hash、缺表、额外列、索引/约束漂移均拒绝，不凭字段名称相同放行。
4. 不修改 `schema_migrations` 的原始 checksum、applied_at 或 description，不修改 024 历史 SQL，不创建新数据库权威表，不增加消费者权限。
5. 在任何兼容审计/迁移写入前，通过既有 runner 创建迁移前备份；首次兼容不能禁用备份。
6. 原子保存独立不可覆写审计 `.backups/compatibility/migration-024-extra-terminal-lf.json`，记录旧/新完整 hash、schema 指纹、工作区路径、原因、原备份路径、原备份 SHA-256 和审计自身完整性摘要。备份 hash 按 64 KiB 分块计算，避免整库读入内存。
7. 重复启动保留原审计文件字节，验证其证据及原备份 hash；迁移不重复执行。返回明确的 `compatibility[]`（accepted-with-audit）和 `compatibilityAuditPath`。sidecar 真实启动在控制台输出脱敏兼容提示，不包含业务内容、token 或凭据。
8. 移动 journal_mode 配置至迁移前备份之后；审计持久化失败即停止后续迁移。

`scripts/stage5/migration-drill.test.cjs` 原来预期“已知旧 hash 拒绝”的场景更新为“字节精确 EOF 变体审计兼容”，保留原记录。未放宽其他 checksum 错误。

## 实际验证

命令：`node scripts/stage51/checksum-compatibility.test.cjs`。结果：**Passed**，12 类证据：

- 精确旧 SQL 真正执行为 024，升级到 025；客户人工字段、已完成 AI Job、原 checksum 不丢失。
- 不同未知 hash 拒绝。
- 真实 schema 漂移拒绝。
- 首次备份被禁用时拒绝。
- 全新库直接保存当前 9dc…，不产生兼容审计。
- 后续故障迁移 026 的 DDL 事务回滚；已完成 025 保持 checkpoint，恢复备份仍为完整旧 024 与 eeff…。
- 审计目录写入失败时升级未继续。
- 审计文件篡改拒绝且不覆写。
- 当前文件被改成额外 LF，但清单仍为当前 hash 时拒绝。
- 原始备份缺失时拒绝。
- 原始备份被篡改时拒绝。
- **真实当前 server.mjs** 从该旧库实际启动，health 为 25，读取共享 CRM 保留人工字段；关闭后再次实际启动，历史 AI 及旧 checksum 保留。仅临时数据目录、随机 loopback 端口与合成客户。

兼容审计、原备份恢复、重复入口不写审计均在测试中实际断言。测试临时根在 finally 清理；一个已停止的过时测试运行临时根已核实进程不存在，逐文件、逐空目录清理，未使用递归强制删除，最终不存在。

其他实际命令：

- `node scripts/stage1/migration-runner-implementation.test.cjs`：Passed（fresh、rerun、checksum、高版本拒绝、rollback、并发、锁和冲突预检）。
- `node scripts/stage1/migration-runner-conflict-diagnostics.test.cjs`：Passed。
- `node scripts/stage5/migration-drill.test.cjs`：Passed。
- `node scripts/stage4/ai-pipeline-migration.test.cjs`：Passed。
- `node --check resources/app/migration-runner.cjs`：Passed。

## 影响与限制

- 全新库：仍使用当前清单和 SQL，不触发兼容例外。
- 已应用字节精确旧 024 且 schema 等价的库：受控兼容，原 ledger 永久保留，以独立审计记录差异来源。
- 其他 hash、其他 SQL、不同 schema：继续拒绝；没有声称任意手改或未知旧库都兼容。
- 审计与其原始迁移前备份必须同时保留；丢失/篡改会返回明确错误并阻止继续。不得把自动备份清理策略应用于此兼容证据。审计绑定本机工作区路径；业务迁移不应直接复制原工作区审计到新路径。
- 没有打开、修改或迁移生产 SQLite；没有连接真实 WS；未调用真实 AI；未启用 Worker/AI 消费者或双写。

**本项结论：024 已知终止 LF 旧变体兼容 Passed（隔离可复现范围）。** 整体阶段 5 Gate 仍由原生桌面/性能、全部回归及资源处理结果联合决定，本附件不单独解除生产 FROZEN。
