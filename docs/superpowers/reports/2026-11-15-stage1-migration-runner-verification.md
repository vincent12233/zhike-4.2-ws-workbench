# 阶段 1 P0-01：数据库迁移 Runner 隔离验证

验证日期：2026-11-15
基线：`6e4d195`  〔设计冻结基线〕
范围：只读生产代码审计 + 临时 SQLite 验证。未打开生产数据库，未修改生产 SQLite，未执行正式迁移。

## 1. 实际检查文件

- `resources/app/server.mjs:90-263`：基础表、`schema_migrations`、`PRAGMA user_version` 和 005–018 硬编码分支。
- `resources/app/migrations/005-ws-workbench.sql` 至 `018-ws-export-media.sql`：当前版本化迁移文件；目录实际缺少 012 文件名，runner 内有 012 “schema marker”。
- `scripts/stage1/migration-runner-verification.cjs`：本报告使用的隔离验证程序；只在 `%TEMP%\\zhike-stage1-migration-*` 创建 SQLite 和迁移夹具。

## 2. 真实生产实现结果

| 检查项 | 状态 | 证据/结论 |
|---|---|---|
| schema 版本保存位置 | Passed | `PRAGMA user_version` 与 `schema_migrations` 均存在 |
| 迁移顺序 | Passed | `server.mjs` 按 4、5…18 的条件分支顺序执行 |
| 已执行迁移记录 | Passed | 每个分支 `INSERT OR IGNORE schema_migrations` |
| 重复执行 | DesignOnly | `user_version` 可阻止常规重复，但没有统一 checksum/文件内容校验 |
| 迁移失败处理 | Passed | 005–018 分支使用 `BEGIN IMMEDIATE`/`ROLLBACK`；个别版本缺少文件存在检查需补齐 |
| WAL/备份屏障 | DesignOnly | 当前启动 runner 未在迁移前建立外部快照或 WAL checkpoint |
| 版本兼容/高版本拒绝 | Failed | 当前代码未发现统一的“高于支持版本只读拒绝”门禁 |
| 多进程迁移协调 | DesignOnly | 工作目录 lock 可阻止重复 sidecar，但没有迁移专用 lease、holder 和审计 |
| 迁移 registry/manifest | Failed | 迁移文件未由统一 registry/校验和驱动；新 019+ 不会自动执行 |

因此，生产 P0-01 当前不能标记 Passed；生产状态为 **Failed/DesignOnly**，必须先实现并隔离验证版本化 runner，再申请生产迁移。

## 3. 隔离验证命令与实际结果

命令：

```text
node scripts/stage1/migration-runner-verification.cjs
node --check scripts/stage1/migration-runner-verification.cjs
```

结果：脚本退出码 0，输出：

```json
{
  "inventory": {
    "inlineRunnerMax": 18,
    "aiJobsInline": true,
    "aiJobsVersionedMigration": false
  },
  "isolated": {
    "firstRun": 2,
    "rerun": 2,
    "failedMigrationRolledBack": true,
    "concurrentRuns": 2,
    "highVersionFixture": 99,
    "tempClean": true
  }
}
```

隔离 runner 验证了：

1. 按文件编号顺序执行并记录 checksum。
2. 重跑不会重复插入 `schema_migrations`。
3. 失败迁移回滚 DDL、`user_version` 不前进。
4. 两个独立进程通过临时 lock/SQLite 竞争后收敛到同一版本，不产生重复记录。
5. 高版本数据库夹具可被识别；生产拒绝逻辑仍需实现，故不把夹具通过当作生产通过。
6. 临时目录已删除，未触及生产数据目录。

## 4. P0 修复建议（未实施）

- 先在隔离环境把迁移清单、版本、checksum、描述和最小支持版本纳入统一 registry。
- 启动前检查 `user_version` 与 registry：高版本拒绝写入并进入只读恢复提示；缺失/篡改 checksum 立即停止。
- 迁移前由单写入协调者完成 drain、WAL checkpoint、SQLite backup、完整性检查；迁移只在临时副本执行并原子替换。
- 迁移 lock 需要持久 holder、PID、代际号和超时记录，不能只依赖应用内存互斥。
- 将 `ai_jobs` DDL 纳入版本化迁移后，再允许任何 019+ 业务迁移。

## 5. 验收结论

**P0-01：Failed（生产 runner 未整改）；隔离参考 runner：Passed；正式实施准入：Blocked。**

本报告不授权创建生产迁移表或升级生产数据库。
