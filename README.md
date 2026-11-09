# 知客 5.2.0 桌面版 + Docker 服务端（4.4.24 业务兼容基线）

> 当前唯一生产入口是 WinUI 3 + WebView2 桌面版；PostgreSQL/API/AI Worker/可选 WS Connector 仅作为 Docker 后台服务。旧 Electron/4.4.x 包只作为归档回滚，不再作为日常启动入口。

## 当前唯一入口

- 安装包：`outputs/知客-5.2.0-WinUI桌面版.exe`
- 交付目录：`outputs/知客-5.2.0-WinUI桌面版/`（安装包、bundle、完整源码、清单、校验值）
- 运行时页面：`resources/app/`；WinUI 只提供窗口宿主、WebView2、WS 隔离和故障回退，不再与原版页面并列显示第二套业务导航。
- 默认启动：显示 `resources/app` 原版顶栏、侧栏和页面；仅设置 `ZHIKE_DESKTOP_LEGACY_UI_HOST=0` 才进入原生兼容回退壳。

本版本在现有知客客户库和 WS 工作台基础上增加 VIP 编号管理、客户分类联动、AI 客户档案自动建档、字段补全、来源/年龄/职业识别、字段证据、跟进任务联动和数据治理删除接口。VIP 编号可从客户中心、快速录入和 CSV/Excel 导入维护，并在群组管理下方独立查看；AI 只补齐空字段，已有人工内容不覆盖；AI 自动删除只进入回收站，永久删除需要二次确认。

这是现有知客 4.1 客户运营桌面项目的增量源码仓库。项目保留原有客户中心、快速录入、跟票、入金、统计、数据中心、设置和 GPT 助手业务逻辑，并增加个人 WS 工作台。

## 目录

- `resources/app/`：Electron 渲染层、主进程、本机 API、SQLite 迁移和前端模块。
- `resources/app/migrations/005-ws-workbench.sql`–`010-ai-customer-governance.sql` 与 `server/migrations/012-ws-list-capture-metadata.sql`：WS 工作台、断点采集、跟进提醒、热聊客户档案和列表级采集元数据迁移。
- `tests/`：WS、备份、HTTP、安装和项目回归测试。
- `docs/`：项目检查、使用、故障排查、回滚和测试说明。
- `scripts/`：统一测试入口与可复现的 Windows 安装包构建脚本。
- `releases/`：历史 4.2–4.4.x/5.0.0 安装包归档，仅用于回滚，不是当前启动入口。
- `zhike-setup.iss`：Windows Inno Setup 安装脚本。
- `desktop/`：WinUI 3 原生桌面壳；WebView2 仅承载 WS 登录/聊天/账号 Profile。
- `server/`、`infra/`、`connectors/ws-worker/`：PostgreSQL/API/AI Worker/可选 WS 连接器和版本化迁移。
- `tools/sqlite-to-postgres/`：旧版 SQLite 只读对账和迁移工具。

## v5 Docker 启动

1. 安装并启动 Docker Desktop。
2. 复制 `infra/.env.example` 为 `infra/.env`，至少修改 `POSTGRES_PASSWORD` 和随机的 `ZHIKE_PAIRING_APPROVAL_CODE`。
3. 在 `infra` 目录执行 `docker compose up -d --build`；桌面端“服务器连接”页填写同一个 API 地址和审批码。
4. 先检查 `/api/v2/health` 返回数据库健康、`schemaVersion=12`、`workerStatus=running`，再登录桌面端。

详细迁移、备份、回滚和故障排查见 `infra/README.md` 与 `docs/server-version-*.md`。

## 安装包

历史 4.2.0 WS 工作台安装包 SHA-256：`2633E0B1DAE754E7B84135C88BC27E7BAA6A77E67CEE76504D4872741D6658FD`。

历史 4.2.1 WS 完善版安装包 SHA-256：`146C5A320BDA660BBC5D3F40F9A0B181EC389C4B173E1B27F878DF6AF7E1AD5B`，大小 173,901,747 字节。

历史 4.2.2 多账号 WS 工作台安装包 SHA-256：`11408056AE239637020F91ECBC89A505F77CCE74C09CDC088590DFCE9AE4A62C`，大小 173,915,466 字节。

历史 4.4.1 安装包 SHA-256：`E6B00666256BB8B92BB9A1B80570C0F34C35D82C2E2EDFA8DB3AC4BFA43C3B60`，大小 `173,938,768` 字节。

历史 4.4.24 兼容安装包 SHA-256：`08A02641DFD3BCA35306B3F27BBF56EEC10A7F9A236D5F2CCD5943830D76A039`，大小 `173,976,589` 字节（对应 `work/legacy-installer-final`）。

当前 WinUI 安装包、Docker 服务端 bundle、完整源码压缩包和校验值以 `outputs/知客-5.2.0-WinUI桌面版/` 中的 `bundle-manifest.json` 与 `SHA256SUMS.txt` 为准。

4.4.1 在 4.4.0 基础上补充无需打开会话的列表级 WS 自动采集、预览消息幂等同步、手机与工作台的 12 秒增量轮询、列表预览 AI 分析排队和跟进提醒刷新；原有知客业务数据和统计口径保持不变。

克隆仓库前请安装 Git LFS；`releases/*.exe` 是 LFS 管理的历史回滚二进制。当前 5.2.0 安装包以交付目录单独提供，源码压缩包包含全部可构建源码、迁移、测试和 Docker 配置，不把历史发布二进制指针误当作源码。

## 安全边界

WS 页面使用每个账号独立的持久化 BrowserView 分区，用户自行扫码或登录。账号切换只切换当前分区，不关闭其他账号；“清除登录会话”只清理选中账号的站点存储。源码不读取或保存 WS 密码、Cookie、二维码和秘密 Token。

工作台会自动发现当前 WS 页面可见的会话列表，并支持当前可见聊天的自动采集、手动粘贴导入、翻译和 AI 分析。WhatsApp Web 没有适合个人账号的后台同步接口时，页面结构和可见范围决定采集能力；工作台不会绕过平台验证，也不承诺关闭电脑后继续接收消息或自动发送。

用户数据库、API Key、本机凭据、日志、备份和打包运行时文件均不提交到 Git。复制 `.env` 或凭据前请先确认目标环境和权限。

## 开发与测试

开发和测试使用 Node.js 24 或更高版本；当前生产桌面入口为 WinUI 3 / .NET 10 / WebView2，自包含 Windows App SDK 运行时随安装包提供。

```powershell
npm --prefix resources/app run test:ws
npm --prefix resources/app run test:all
```

安装测试默认使用 `outputs/知客-5.2.0-WinUI桌面版.exe`；历史 `releases/` 包只用于显式回滚测试，不作为默认入口。

```powershell
$env:ZHIKE_INSTALLER='C:\path\知客-4.4.1-WS工作台智能录入版.exe'
$env:ZHIKE_OLD_INSTALLER='C:\path\知客-4.1-全面增强版.exe'
$env:ZHIKE_EXPECTED_VERSION='4.4.1'
npm --prefix resources/app run test:installer

# 新架构当前可执行的参考/静态门禁
node tests/server-v2/run-all.cjs
node desktop/tests/DesktopSmokeTests.cjs
node connectors/ws-worker/tests/collector-fixtures.test.cjs
```

服务器 bundle（需要 PowerShell 7 或 Windows PowerShell 5+；不包含真实数据和密钥）：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/build-server-bundle.ps1
```

WinUI 原生桌面 bundle/安装包：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/build-winui-bundle.ps1 -Version 5.2.0
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/build-winui-installer.ps1 -AppVersion 5.2.0
```

本机已完成 WinUI 3 Release 构建及安装/启动/卸载隔离冒烟；MSIX 签名、Docker Compose/PostgreSQL 实机和真实 WS 登录仍需相应环境门禁。

## 历史 Electron 兼容构建（仅回滚）

`scripts/build-winui-bundle.ps1` 与 `scripts/build-winui-installer.ps1` 是当前唯一生产构建入口，使用 WinUI 3 / .NET 10 自包含 bundle。根目录的 `scripts/build-installer.ps1` 仅用于历史 Electron 兼容回滚，不生成当前生产入口。

```powershell
# 只生成并验证干净 staging
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/build-installer.ps1 -StageOnly

# 历史 Electron 兼容包（仅回滚，不作为当前入口）
npm --prefix resources/app run build:installer
```

完整编译需要 Inno Setup 6。可安装到默认位置，或用 `INNO_SETUP_COMPILER` 指向 `ISCC.exe`。`zhike-setup.iss` 只允许从构建脚本生成的 staging 目录打包，不应改回递归仓库根目录。

多账号使用、热聊档案和采集边界见 `docs/ws-workbench-multi-account.md`、`docs/hot-chat-profile-usage.md`；本次 5.2.0 交付的安装、回归、回滚与未验证门禁见 `docs/release-notes-5.2.0.md`、`docs/release-notes-v5-server-desktop.md` 和 `docs/v5-implementation-report.md`。`docs/ws-workbench-测试报告.md` 是 4.4.1 历史报告，不代表本次版本结果。


