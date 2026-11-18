# 阶段 1 实施准入审核

审核日期：2026-11-15
基线：`6e4d195`
审核结论：**不准入（Blocked）**。

## 1. 准入清单

| 条件 | 状态 | 依据 |
|---|---|---|
| 旧队列与新队列字段/状态/幂等映射冻结 | DesignOnly | `stage1-queue-ai-mapping-freeze.md`；真实 `ws_collection_*`/`ai_jobs` 仍需迁移夹具和回填 |
| AI schema 单一权威 | Failed | `server.mjs:269-299` 内联 `ai_jobs` |
| CRM 唯一权威与全局去重 | Blocked | phone 唯一、群状态隔离、来源稳定 ID 未完成 |
| Named Pipe ACL/SID | DesignOnly | .NET 原型通过；WinUI 集成、跨用户未测 |
| SQLite 单写入者/fencing | DesignOnly | 临时库 9/9 通过；生产协调者未实现 |
| target/catalog/member 唯一约束 | Blocked | 作用域、来源、关系账本仍需冻结/迁移 |
| 迁移 runner 版本化与回滚 | Failed | registry/checksum、高版本门禁、迁移专用 lease 未实现 |
| feature flag/双读 | DesignOnly | 设计已冻结；不能启用 worker 或双写 |
| 生产数据保护 | Passed | 本轮未打开生产数据库、未启动生产 Worker |

## 2. 不得执行的动作

在本审核未通过前，禁止：

- 创建或启用生产 `ws_ai_outbox`/attempt/evidence 并行写入。
- 执行生产 schema 迁移或回填。
- 启动正式采集/群组/AI Worker。
- 修改真实 WS 登录态、客户、群组、消息或跟进任务。
- 让旧前端/`LocalQueue` 与新 Worker 同时写入同一业务事实。

## 3. 下一次申请阶段 1 的必要条件

1. 完成 P0-01 migration registry、checksum、备份/WAL、锁和高版本门禁，并在脱敏副本完成升级失败恢复。
2. 将 `ai_jobs` DDL 纳入唯一版本化迁移，完成历史 job/analysis/evidence 回填对账，证明完成任务不重排。
3. 建立 SQL customers 的并发唯一/冲突审核合同；隔离群状态、来源定义、群成员关系和客户主档写入。
4. 完成 WinUI host 与 Named Pipe Worker 的正式生命周期、跨 SID 和错误恢复实测。
5. 在 sidecar 落地持久化 writer lease/fencing，并完成两个进程、崩溃、锁竞争、checkpoint 原子性演练。
6. 冻结 catalog→target canonical/alias、稳定 `sourceDefinitionId/channelId`、member relation ledger 和历史回填规则。
7. 运行新的全量回归、P0 隔离测试、脱敏副本迁移、shadow 双读对账；结果和差异经审核后，才能申请测试工作区 canary。

## 4. 最终决定

阶段 1 当前 **不得开始生产实施**。本轮停在设计冻结和隔离验证；等待审核批准后再决定是否进入下一阶段。生产数据、生产 Worker、真实 WS 登录和生产 SQLite 均未触及。

审核依据的实际路径/命令：

- `resources/app/server.mjs:269-299,817-848,1200-1458,3129-3258`。
- `resources/app/migrations/005-ws-workbench.sql` 至 `018-ws-export-media.sql`。
- `desktop/src/Zhike.Desktop/Services/LocalQueue.cs`、`LocalServiceManager.cs`。
- `node scripts/run-tests.cjs all` → `205 passed, 0 failed`。
- `node scripts/stage1/migration-runner-verification.cjs`、`ai-schema-authority-verification.cjs`、`crm-group-authority-test.cjs`、`sqlite-fencing-verification.cjs`。
- `dotnet build/run scripts/stage1/NamedPipeSecurityRuntime` → 原型通过，WinUI 集成/跨用户未测。
