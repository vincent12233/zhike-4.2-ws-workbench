# 知客 6.1 A+B 阶段 1 前置设计冻结报告

审计日期：2026-11-15  
代码基线：`68749e4`  〔阶段 0 技术探针与回归测试提交〕  
范围：阶段 1 设计冻结；**未执行生产迁移、未启动生产 Worker、未修改生产 SQLite、未启用旧/新队列双写**。

## 1. 结论

本报告及其七份配套文件形成“阶段 1 冻结候选设计”。它们把现有代码和真实迁移 schema 中已经存在的事实、拟议目标合同、未验证项和准入门槛分开记录。阶段 1 **尚未获准实施**；在用户/项目审核完成前必须保持当前 6.0.3/ schema 018 写入路径和生产 Worker 禁用状态。

阶段 0 的隔离 Worker 探针通过只证明动态 loopback、token、心跳、取消、崩溃恢复和资源指标可行；它不证明 .NET↔WinUI 正式 IPC、SQLite fencing、真实 WS、真实 AI 或跨设备安装已经完成。

## 2. 真实基线和审计依据

- `resources/app/server.mjs:90-299`：启动时创建 `app_state`、`customers`、`schema_migrations`，并内联创建 `ai_jobs`；迁移 runner 以硬编码条件执行 005–018。
- `resources/app/migrations/005-ws-workbench.sql` 至 `018-ws-export-media.sql`：当前版本化 schema。
- `resources/app/modules/ws-workbench.js`：当前前端队列/采集/分析 API 写入者。
- `desktop/src/Zhike.Desktop/Services/LocalQueue.cs`：独立于 SQLite 的 `pending.json` 本地桥接队列。
- `desktop/src/Zhike.Desktop/Services/LocalServiceManager.cs:40-228`：动态 loopback 端口、token、Node sidecar 启停和健康检查；当前重启路径会复用 token，需在实施前按 IPC 冻结合同修正。
- `resources/app/modules/ws-group-monitor-core.js` 与 `server.mjs:1019-1453,2360-2514`：群目录、身份匹配、事件、客户关联、checkpoint 和 resolve。
- `docs/superpowers/reports/2026-11-15-stage0-queue-mapping-audit.md`、`2026-11-15-stage0-feasibility-report.md`、`2026-11-15-stage0-worker-probe.md`：阶段 0 只读审计和隔离探针证据。

阶段 0 验证命令及结果：`node scripts/stage0/worker-probe.cjs` 退出 0；`node scripts/stage0/audit-queue-mapping.test.cjs` 通过；`node scripts/run-tests.cjs all` 为 205/205。以上命令没有连接生产账号或打开生产数据库。

## 3. 冻结决策

### 3.1 队列与 AI

- `ws_collection_runs/items`、`ai_jobs`、`ws_ai_analyses`、`ai_customer_field_evidence` 和现有 `hot_chat_sync_outbox` 先保留为现有事实和兼容读取；不以新表替换或并行写入。
- 旧 run/item 的状态、checkpoint、coverage、AI 状态必须按逐字段/逐状态合同映射；`ws_collection_items` 同时承载采集、AI、跟进状态是迁移阻断项。
- `ai_jobs` 是服务端内联表，唯一键为 `(account_id,idempotency_key)`；新 outbox/attempt 只在映射和回填通过后才可实现。
- 双读只读旧结构和目标适配器，逐记录对账；不创建生产双写。

详见：[旧队列与 AI 表完整字段映射](2026-11-15-stage1-queue-ai-mapping-freeze.md)。

### 3.2 CRM 权威源

- 客户主键冻结为现有 `customers.id`；不创建第二套 CRM 主档。
- `app_state.customers` 与 SQL `customers` 当前由服务端镜像同步，尚未完成单一权威切换；阶段 1 只冻结权威和冲突处理，不在本阶段偷偷改变写入顺序。
- 普通 WS AI 只能关联唯一已有客户并补空字段；独立群组管理的确定性新成员登记可在全局去重后创建客户，冲突进入人工审核。
- 电话标准化沿用当前 `wsCrmSync.normalizePhone`/群组 core 规则；空或未验证号码不自动合并；人工锁定字段不得覆盖。

详见：[CRM 权威源及客户去重设计](2026-11-15-stage1-crm-authority-dedup-design.md)。

### 3.3 IPC 与写入所有权

- 阶段 1 正式 Worker 通道冻结为 Windows Named Pipe，并使用当前用户 SID 的显式 ACL；现有动态 loopback HTTP 只保留给旧 sidecar 兼容路径和阶段 0 探针，不作为新 Worker 的正式写入通道。
- 协议 envelope 固定 `schemaVersion/requestId/correlationId/accountId/capability/idempotencyKey/fencingToken/deadline`；旧 token、旧 fencing、越权账号和超时必须有分类错误。
- SQLite 业务写入只有一个协调者；Worker、前端和群组登记都须持有持久化 lease + generation/fencing token，旧 holder 的写入必须拒绝。
- 当前 `.NET Worker ↔ WinUI`、Named Pipe SID/ACL 和生产事实表 fencing 尚未通过实测，不能宣称 IPC 已完成。

详见：[IPC 安全、SQLite 单写入者与 fencing、迁移设计](2026-11-15-stage1-ipc-fencing-migration-design.md)。

### 3.4 迁移、回滚和 flags

- schema 018 是当前生产基线；019 先用于受控 migration runner/版本门禁的隔离验证，020+ 只是候选目标，不得直接创建生产并行表。
- 迁移必须先 drain writer、WAL checkpoint、备份、完整性校验，再在临时副本回填；失败恢复使用切换前快照，不能仅关闭 UI flag 伪回滚。
- 默认 flags 保持 legacy；`shadow` 只读；`worker` 只有 fence 交接、零旧写入和灰度批准后才能启用。

详见：[迁移与回滚格式](2026-11-15-stage1-schema-rollback-design.md) 和 [Feature Flag/双读/切换方案](2026-11-15-stage1-feature-flag-double-read-plan.md)。

### 3.5 独立 WS 群组管理

- 群组管理是 WS 内部独立工作区，使用共享客户主档，但不等同于 VIP 管理，也不替换知客主侧边栏。
- 只对已选择、已授权的目标群读取群事件；审核/邀请状态不计入确认进退群。
- 只有已验证的 `joined` 且全局查重未命中的成员允许确定性自动登记；`left/removed` 只更新群关系，不覆盖客户全局状态。
- 统计按 `account_id + group_jid + channel/source`，缺来源显示“未分类，待绑定”，不能将不同群粉类型合并为泛化“群粉”。
- checkpoint 只能在事件事实、关系/登记事务或 durable review 已落库后推进。

详见：[独立 WS 群组管理边界](2026-11-15-stage1-ws-group-management-boundary.md)。

## 4. 阶段 1 准入清单

| 门禁 | 当前状态 | 进入实施所需证据 |
|---|---|---|
| 旧队列/AI 逐字段映射 | 冻结候选，待专项报告审核 | 字段/状态/键/回填/不可映射/双读合同 |
| CRM 权威源与去重 | 冻结候选，待专项报告审核 | 并发建档、人工锁定、跨账号/群关系测试 |
| IPC 协议 | 设计候选，SID/ACL 未实测 | .NET↔WinUI 合同测试、token 轮换、错误矩阵 |
| SQLite writer/fencing | 设计候选，未接生产表 | 租约、代际号、旧写入拒绝、崩溃恢复演练 |
| 迁移/回滚 | 设计候选，未执行 019+ | 脱敏副本回填、重复回填、快照恢复、版本矩阵 |
| feature flag/双读 | 设计候选 | 只读对账器、零未解释差异、切换/回滚状态机 |
| 群组边界 | 冻结候选 | catalog/target 去重、时间语义、审核统计和登记事务 |
| 生产安全边界 | 通过 | 当前阶段不启动 Worker、不生产写、不真实账号联调 |

## 5. 当前明确阻断项

1. migration runner 仍硬编码到 018，且 `ai_jobs` 未版本化。
2. `app_state` 与 `customers` 仍是镜像关系，权威写入者尚未切换。
3. 当前 `LocalServiceManager.RestartAsync` 复用 token，与“重启即轮换、旧 token 失效”的冻结安全合同不一致。
4. `ws_group_monitor_targets` 的 profile 级唯一键与 `ws_group_catalog` 的 account 级唯一键不一致，跨 profile 重复组映射仍需解决。
5. 群事件 `pending/review` 的 checkpoint 提交顺序和缺失 `event_at` 语义必须在实现前固定。
6. .NET↔WinUI IPC ACL/SID、真实 SQLite fencing、真实 WS/AI、跨设备安装和迁移仍未验收。

这些是设计冻结后首先要关闭的 P0/P1 任务；不能用 UI 状态、模拟数据或自动化脚本通过替代真实验证。

## 6. 阶段 1 实施顺序

详见：[阶段 1 实施任务清单](../plans/2026-11-15-zhike-6.1-stage1-implementation-tasks.md)。实施顺序为：只读契约和夹具 → 隔离 IPC/fencing → 脱敏副本迁移演练 → shadow 双读 → 测试工作区 canary → 审核后再申请生产切换。

## 7. 本阶段停止点

本报告完成后停止在设计冻结，不执行任何生产迁移或 Worker 接入，等待审核。审核批准不等于生产切换批准；每个后续阶段仍需提交实际修改、测试结果、遗留问题和风险说明。
