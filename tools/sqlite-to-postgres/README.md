# SQLite → PostgreSQL 迁移工具

`migrate.cjs` 默认只读旧版 SQLite 并生成迁移报告，不会修改源数据库。

```powershell
node tools/sqlite-to-postgres/migrate.cjs `
  --source C:\path\workspace.sqlite `
  --manifest C:\path\migration-manifest.json `
  --mode dry-run
```

`apply`/`resume` 模式需要额外安装 `pg` 依赖并提供 PostgreSQL 连接字符串；提交过程在单个事务内完成，重复业务键不会重复写入。`rollback` 当前只生成回滚计划，正式数据切换前必须先完成备份恢复演练。

业务记录的登记日期、业务日期和下次跟进日期分开保存；买入/卖出日期映射到业务日期，缺失登记日期保持为空，不会被当前日期替换。旧字段和未识别字段会作为 `legacy_records`/manifest 原样保留。

旧状态中的 `businessRecords`/`records` 混合数组会按每行内容识别跟票和入金，列或行顺序不会影响分类。没有旧记录 ID 的行使用稳定哈希生成迁移 ID，重复 dry-run/resume 可以复用同一对账哈希。
