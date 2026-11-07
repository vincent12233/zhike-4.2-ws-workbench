# SQLite → PostgreSQL 迁移工具

`migrate.cjs` 默认只读旧版 SQLite 并生成迁移报告，不会修改源数据库。

```powershell
node tools/sqlite-to-postgres/migrate.cjs `
  --source C:\path\workspace.sqlite `
  --manifest C:\path\migration-manifest.json `
  --mode dry-run
```

`apply` 模式需要额外安装 `pg` 依赖并提供 PostgreSQL 连接字符串；提交过程在单个事务内完成。`rollback` 当前只生成回滚计划，正式数据切换前必须先完成备份恢复演练。
