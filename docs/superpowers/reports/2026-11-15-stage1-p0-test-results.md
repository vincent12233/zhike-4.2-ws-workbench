# 阶段 1 P0 测试结果汇总

验证日期：2026-11-15
范围：全量回归 + 阶段 0 回归 + 六项 P0 隔离验证。

## 1. 测试结果

| 测试 | 命令 | 结果 |
|---|---|---|
| 全量回归 | `node scripts/run-tests.cjs all` | **Passed**；`Completed 205 checks: 205 passed, 0 failed.`，退出码 0 |
| 阶段 0 queue mapping | `node scripts/stage0/audit-queue-mapping.test.cjs` | Passed |
| 阶段 0 read-only audit | `node scripts/stage0/audit-queue-mapping.cjs --read-only` | Passed |
| 阶段 0 worker probe | `node scripts/stage0/worker-probe.cjs` | Passed；隔离临时目录，dynamic port/heartbeat/cancel/crash recovery/resource telemetry |
| P0-01 migration | `node scripts/stage1/migration-runner-verification.cjs` | Passed（隔离合同）；生产 P0 Failed |
| P0-02 AI schema | `node scripts/stage1/ai-schema-authority-verification.cjs` | Passed（隔离回填合同）；生产 P0 Failed |
| P0-03 CRM/group authority | `node scripts/stage1/crm-group-authority-test.cjs` | 预期退出码 2，9 Passed / 1 DesignOnly / 3 Blocked；fail-closed |
| P0-04 Named Pipe | `dotnet build ...NamedPipeSecurityRuntime.csproj -c Release --nologo` + `dotnet run ... --no-build` | Build Passed；原型 Passed；WinUI/different user NotTested |
| P0-05 SQLite fencing | `node --check scripts/stage1/sqlite-fencing-verification.cjs` + `node scripts/stage1/sqlite-fencing-verification.cjs` | Passed；9/9，tempClean=true |
| P0-06 identity constraints | 同 P0-03 隔离脚本 | 基础约束 Passed；target/catalog/source/关系账本仍 Blocked/DesignOnly |

## 2. 异常与数据保护覆盖

隔离脚本覆盖：迁移中断回滚、高版本夹具、并发迁移收敛、AI 重复回填、完成任务不重排、孤儿分析、evidence 唯一性、重复客户登记、重复群事件、旧 fencing 拒绝、checkpoint 顺序、Named Pipe 错 token/schema/取消/超时/断线/轮换。

所有 P0 脚本输出均明确 `productionDatabaseOpened:false` 或等价的生产未打开声明。临时目录检查结果为清理；Named Pipe 生成的 `bin/obj` 是构建产物，提交前必须删除，不作为测试数据。

## 3. 结果解释

隔离合同的通过只证明目标行为可以在受控临时环境成立；生产实现仍有 P0 阻断。本轮全量回归已重新执行并得到 `205/205`，但这不改变六项 P0 的生产准入结论。阶段 1 生产准入保持 **Blocked**。
