# 知客 6.1 A+B 阶段 1 P0 整改与隔离验证总报告

验证日期：2026-11-15
基线 commit：`6e4d195`（阶段 1 前置设计冻结）
对照基线：阶段 0 `68749e4`
范围：只读生产代码/schema 审计 + 隔离临时 SQLite/.NET 验证。

## 1. 执行边界

本轮严格遵守阶段 1 P0 执行指令：

- 没有打开或修改生产 SQLite、客户资料、群组、消息或 AI 结果。
- 没有启动正式 Worker、AI Worker、群组 Worker 或真实 WS 登录。
- 没有执行数据库生产迁移。
- 没有让旧队列和新队列并行生产写入。
- 所有新增脚本只写 `%TEMP%` 隔离目录；脚本结束后清理。

## 2. 六项 P0 状态

| P0 | 生产现状 | 隔离验证 | 当前状态 | 阶段 1 准入 |
|---|---|---|---|---|
| P0-01 迁移 Runner 版本化 | runner 硬编码至 018，缺 registry/checksum/高版本拒绝/迁移专用协调 | 顺序、重跑幂等、失败回滚、并发收敛、高版本夹具通过 | **Failed** | Blocked |
| P0-02 `ai_jobs` schema 权威 | `server.mjs` 内联建表，未纳入版本化迁移 | 历史回填、完成任务不重排、孤儿分析识别、evidence 唯一通过 | **Failed** | Blocked |
| P0-03 CRM 唯一写入权威 | phone 并发唯一约束、群状态隔离、缺失渠道来源仍未满足 | 规则边界和临时唯一约束通过 | **Blocked** | Blocked |
| P0-04 Named Pipe ACL/SID | 正式 WinUI/Worker 集成、跨 SID 尚未实测 | 真实 .NET Named Pipe 原型通过 | **DesignOnly** | Blocked |
| P0-05 SQLite 单写入者/fencing | 生产尚无统一 writer lease/fencing 协调者 | 9 项临时 WAL SQLite fencing 测试通过 | **DesignOnly** | Blocked |
| P0-06 target/catalog 唯一键 | target/catalog 作用域、来源 ID、客户关系账本仍未统一 | 基础 catalog/target/event 约束通过 | **Blocked** | Blocked |

状态标签严格区分：隔离合同通过不等于生产实现通过；`DesignOnly` 和 `Failed/Blocked` 均不能进入生产实施。

## 3. 主要阻断项

1. 迁移 runner 尚未统一 registry、checksum、WAL/备份屏障、高版本只读门禁和持久化协调。
2. `ai_jobs` DDL 仍在 `resources/app/server.mjs:269-299`，与版本化 SQL 形成双 schema 权威。
3. `resources/app/server.mjs:94` 的 `customers.phone_normalized` 只有普通索引，不能作为并发建档的最终唯一屏障。
4. `resources/app/server.mjs:1433-1440` 的群关系投影仍可能覆盖客户 JSON 全局 `status`。
5. `resources/app/server.mjs:1209-1237` 缺少稳定来源时仍回退为泛化“群粉”。
6. 生产没有跨采集/群组/AI/CRM/checkpoint 的持久化 fencing；现有 `ai_jobs.lease_token` 仅为任务级保护。
7. 群组 target 是 profile 作用域、catalog 是 account 作用域，来源 `channel_id` 可空且无稳定外键，关系账本仍为 JSON/事件混合模型。

## 4. 实际验证入口

- `scripts/stage1/migration-runner-verification.cjs`
- `scripts/stage1/ai-schema-authority-verification.cjs`
- `scripts/stage1/crm-group-authority-test.cjs`
- `scripts/stage1/NamedPipeSecurityRuntime/Program.cs`
- `scripts/stage1/sqlite-fencing-verification.cjs`

对应六份专项报告：

- [迁移 Runner 验证](2026-11-15-stage1-migration-runner-verification.md)
- [AI schema 权威验证](2026-11-15-stage1-ai-schema-authority-verification.md)
- [CRM 写入权威验证](2026-11-15-stage1-crm-write-authority-verification.md)
- [Named Pipe 安全测试](2026-11-15-stage1-named-pipe-security-test.md)
- [SQLite fencing 测试](2026-11-15-stage1-sqlite-fencing-test.md)
- [群组 identity 约束](2026-11-15-stage1-group-identity-constraints.md)

本轮实际命令包括：

```text
node scripts/run-tests.cjs all
node scripts/stage0/audit-queue-mapping.test.cjs
node scripts/stage0/audit-queue-mapping.cjs --read-only
node scripts/stage0/worker-probe.cjs
node scripts/stage1/migration-runner-verification.cjs
node scripts/stage1/ai-schema-authority-verification.cjs
node scripts/stage1/crm-group-authority-test.cjs
node scripts/stage1/sqlite-fencing-verification.cjs
dotnet build scripts/stage1/NamedPipeSecurityRuntime/NamedPipeSecurityRuntime.csproj -c Release --nologo
dotnet run --project scripts/stage1/NamedPipeSecurityRuntime/NamedPipeSecurityRuntime.csproj -c Release --no-build
```

专项报告记录了每条命令的退出码、JSON 摘要、真实 schema 文件和未通过项目。

## 5. 结论

六项 P0 尚未全部通过，阶段 1 生产实施准入为 **Blocked**。当前必须继续保持设计冻结；不得开始正式迁移、生产 Worker、AI Worker 或新旧队列并行写入。本报告只提交审核材料和隔离验证，不授权下一阶段实施。

本轮全量回归重新执行结果：`node scripts/run-tests.cjs all` → `Completed 205 checks: 205 passed, 0 failed.`；该结果证明现有基线回归未被本轮隔离脚本破坏，不代表 P0 生产架构已完成。
