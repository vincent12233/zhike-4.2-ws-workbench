# 知客 4.2.0 WS 工作台

这是现有知客 4.1 客户运营桌面项目的增量源码仓库。项目保留原有客户中心、快速录入、跟票、入金、统计、数据中心、设置和 GPT 助手业务逻辑，并增加个人 WS 工作台。

## 目录

- `resources/app/`：Electron 渲染层、主进程、本机 API、SQLite 迁移和前端模块。
- `resources/app/migrations/005-ws-workbench.sql`：WS 工作台独立数据迁移。
- `tests/`：WS、备份、HTTP、安装和项目回归测试。
- `docs/`：项目检查、使用、故障排查、回滚和测试说明。
- `releases/知客-4.2-WS工作台版.exe`：Windows 安装包，通过 Git LFS 保存。
- `zhike-setup.iss`：Windows Inno Setup 安装脚本。

## 安装包

安装包版本为 4.2.0，SHA-256：`2633E0B1DAE754E7B84135C88BC27E7BAA6A77E67CEE76504D4872741D6658FD`。

克隆仓库前请安装 Git LFS；执行 `git lfs pull` 可下载完整安装包。安装包已经包含 Electron 和本机 Node 运行时，因此这些打包二进制不重复放入源码目录。

## 安全边界

WS 页面使用隔离的非持久 BrowserView，用户自行扫码或登录。源码不读取或保存 WS 密码、Cookie、二维码和秘密 Token；第一版只处理用户显式复制的当前可见聊天，不提供后台永久同步或自动发送。

用户数据库、API Key、本机凭据、日志、备份和打包运行时文件均不提交到 Git。复制 `.env` 或凭据前请先确认目标环境和权限。

## 本地检查

```powershell
node --check resources/app/main.cjs
node --check resources/app/server.mjs
node tests/ws-workbench-core.test.cjs
node tests/ws-workbench-api.test.cjs
```

完整安装和回归结果见 `docs/ws-workbench-测试报告.md`。
