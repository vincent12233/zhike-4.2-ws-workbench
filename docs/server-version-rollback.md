# 回滚方案

1. 停止桌面端自动切换到服务器版本，保留当前安装目录和用户数据目录。
2. 停止 Docker 服务：`docker compose -f infra/compose.yaml -f infra/compose.prod.yaml stop`。
3. 如果迁移只完成 dry-run，直接使用旧版 4.4.24；旧 SQLite 未被迁移器修改。
4. 如果已 apply，先把 PostgreSQL dump 恢复到隔离数据库做对账，再决定是否恢复正式库；恢复脚本默认 dry-run，不能删除无关文件。
5. 安装 4.4.24 回滚包。卸载新版时保留用户数据、备份、WebView2 Profile 和日志目录。
6. 记录迁移 manifest、schema 版本和差异报告，修复后再从断点继续，不重复导入。

回滚不意味着删除新库；新库和旧库都应保留到业务核对完成。
