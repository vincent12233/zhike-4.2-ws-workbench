# 知客桌面版 + Docker 服务端部署

## 范围

新版仍然是 Windows 桌面应用。客户中心、快速录入、跟票、入金、VIP、任务、看板、统计、数据中心和 AI 跟进页面使用 WinUI 3 原生控件；WebView2 只用于用户自己登录的 WS 页面。Docker 中不提供管理网页，只运行 PostgreSQL、API、AI Worker、WS Connector 和备份任务。

## 启动顺序

```powershell
Copy-Item infra/.env.example infra/.env
# 编辑 infra/.env，设置随机 POSTGRES_PASSWORD 和 ZHIKE_PAIRING_APPROVAL_CODE
docker compose -f infra/compose.yaml -f infra/compose.prod.yaml up -d --wait
```

API/Worker 启动时会按版本顺序执行迁移（当前到 010）。桌面端首次连接在“服务器连接”页填写同一个
`ZHIKE_PAIRING_APPROVAL_CODE` 后再执行一次性配对；数据库密码不会写入桌面端或日志。

`/api/v2/health` 的 `schemaVersion` 以数据库 `schema_migrations` 中实际已应用的最高版本为准，并与迁移目录目标版本及 `ZHike_SCHEMA_VERSION` 对比。如果三者不一致，健康接口返回 `503` 和 `databaseStatus=schema-mismatch`，避免桌面端连接到未完成迁移的服务。

## 迁移旧版数据

先对旧 SQLite 做只读 dry-run：

```powershell
node tools/sqlite-to-postgres/migrate.cjs --source "C:\path\workspace.sqlite" --manifest "C:\path\migration.json" --mode dry-run
```

确认客户数、跟票/入金/VIP 数量、买卖方向和登记/跟进日期分别正确后，再在隔离 PostgreSQL 上执行 `apply`。迁移器不会用当前日期替换缺失或历史登记日期；冲突写入报告，不静默覆盖。

## 升级和回滚

升级前保留旧版安装目录外的数据目录、SQLite 原文件和 PostgreSQL dump。新版无法连接服务端时，桌面端可切回 4.4.24 本地入口，旧数据格式不被删除。
