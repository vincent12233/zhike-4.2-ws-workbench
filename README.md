# 知客 4.4.2 WS 工作台

这是现有知客 4.1 客户运营桌面项目的增量源码仓库。项目保留原有客户中心、快速录入、跟票、入金、统计、数据中心、设置和 GPT 助手业务逻辑，并增加个人 WS 工作台。

## 目录

- `resources/app/`：Electron 渲染层、主进程、本机 API、SQLite 迁移和前端模块。
- `resources/app/migrations/005-ws-workbench.sql`–`009-ws-resume-alerts.sql`：WS 工作台独立数据迁移，009 为断点采集和跟进提醒状态。
- `tests/`：WS、备份、HTTP、安装和项目回归测试。
- `docs/`：项目检查、使用、故障排查、回滚和测试说明。
- `scripts/`：统一测试入口与可复现的 Windows 安装包构建脚本。
- `releases/知客-4.2-WS工作台版.exe`：Windows 安装包，通过 Git LFS 保存。
- `releases/知客-4.2.1-WS工作台完善版.exe`：历史 WS 完善版安装包，通过 Git LFS 保存。
- `releases/知客-4.2.2-WS工作台完善版.exe`：历史多账号 WS 工作台安装包，通过 Git LFS 保存。
- `releases/知客-4.4.1-WS工作台智能录入版.exe`：当前 AI 跟进、列表级 WS 自动采集、手机/工作台同步轮询、日期迁移和混合导入优化安装包，通过 Git LFS 保存。
- `releases/知客-4.4.2-WS工作台智能录入版.exe`：修复 GPT 运营助手导航状态竞争，确保实际安装版 AI 配置、分析和跟进入口可达，通过 Git LFS 保存。
- `zhike-setup.iss`：Windows Inno Setup 安装脚本。

## 安装包

历史 4.2.0 WS 工作台安装包 SHA-256：`2633E0B1DAE754E7B84135C88BC27E7BAA6A77E67CEE76504D4872741D6658FD`。

历史 4.2.1 WS 完善版安装包 SHA-256：`146C5A320BDA660BBC5D3F40F9A0B181EC389C4B173E1B27F878DF6AF7E1AD5B`，大小 173,901,747 字节。

当前 4.2.2 多账号 WS 工作台安装包 SHA-256：`11408056AE239637020F91ECBC89A505F77CCE74C09CDC088590DFCE9AE4A62C`，大小 173,915,466 字节。

当前 4.4.1 安装包 SHA-256：`E6B00666256BB8B92BB9A1B80570C0F34C35D82C2E2EDFA8DB3AC4BFA43C3B60`，大小 `173,938,768` 字节。

4.4.1 在 4.4.0 基础上补充无需打开会话的列表级 WS 自动采集、预览消息幂等同步、手机与工作台的 12 秒增量轮询、列表预览 AI 分析排队和跟进提醒刷新；原有知客业务数据和统计口径保持不变。

克隆仓库前请安装 Git LFS；执行 `git lfs pull` 可下载完整安装包。安装包已经包含 Electron 和本机 Node 运行时，因此这些打包二进制不重复放入源码目录。

## 安全边界

WS 页面使用每个账号独立的持久化 BrowserView 分区，用户自行扫码或登录。账号切换只切换当前分区，不关闭其他账号；“清除登录会话”只清理选中账号的站点存储。源码不读取或保存 WS 密码、Cookie、二维码和秘密 Token。

工作台会自动发现当前 WS 页面可见的会话列表，并支持当前可见聊天的自动采集、手动粘贴导入、翻译和 AI 分析。WhatsApp Web 没有适合个人账号的后台同步接口时，页面结构和可见范围决定采集能力；工作台不会绕过平台验证，也不承诺关闭电脑后继续接收消息或自动发送。

用户数据库、API Key、本机凭据、日志、备份和打包运行时文件均不提交到 Git。复制 `.env` 或凭据前请先确认目标环境和权限。

## 开发与测试

开发和测试使用 Node.js 24 或更高版本。当前桌面运行时固定为 Electron 45.2.1、Node.js 24.22.1。

```powershell
npm --prefix resources/app run test:ws
npm --prefix resources/app run test:all
```

安装测试默认使用 `releases/` 中最新已知安装包；4.1.3 旧安装包不存在时，升级测试会明确显示 `SKIP`，不会误报通过。也可以显式指定经过校验的构件：

```powershell
$env:ZHIKE_INSTALLER='C:\path\知客-4.4.1-WS工作台智能录入版.exe'
$env:ZHIKE_OLD_INSTALLER='C:\path\知客-4.1-全面增强版.exe'
$env:ZHIKE_EXPECTED_VERSION='4.4.1'
npm --prefix resources/app run test:installer
```

## 可复现构建

构建脚本只把白名单中的 Electron 运行时和 `resources/app` 源码复制到 `work/staging/zhike-win-x64`，并拒绝打包真实 `data`、数据库、日志、凭据、`.git`、`releases`、`tests` 和 `docs`。它优先使用本地已校验为 Electron 45.2.1 / Node.js 24.22.1 的运行时；缺少时从 Electron 和 Node.js 官方发布地址下载到 `work/cache`，并用官方 `SHASUMS256.txt` 校验。

```powershell
# 只生成并验证干净 staging
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/build-installer.ps1 -StageOnly

# 生成 work/output/知客-4.4.1-WS工作台智能录入版.exe
npm --prefix resources/app run build:installer
```

完整编译需要 Inno Setup 6。可安装到默认位置，或用 `INNO_SETUP_COMPILER` 指向 `ISCC.exe`。`zhike-setup.iss` 只允许从构建脚本生成的 staging 目录打包，不应改回递归仓库根目录。

多账号使用、客户库关联和采集边界见 `docs/ws-workbench-multi-account.md`；完整安装和回归结果见 `docs/ws-workbench-测试报告.md`。
