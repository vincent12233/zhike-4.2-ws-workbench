# 知客 6.1 A+B 本机桌面版

知客使用 WinUI 3、WebView2 和随包 Node SQLite 本机服务。安装和本地服务正常后，客户、跟票、入金、报名、统计、导入和备份等本机业务不依赖外网。WhatsApp 前台聊天和用户主动调用的外部 AI 服务需要联网。

## 下载与首次使用

- 当前候选为 **6.1.0**，预发行标签为 **`v6.1.0-rc.2`**，已作为预发行发布。[打开候选下载页](https://github.com/vincent12233/zhike-4.2-ws-workbench/releases/tag/v6.1.0-rc.2)，同时取得 `zhike-6.1.0-win-x64-setup.exe` 和 `release-output-manifest.json`。下载需要登录已有该私有仓库访问权限的 GitHub 账号。候选状态见[当前版本索引](docs/current-release-index.md)。
- 安装包归属源码 `5a7dabe`，大小为 `114280989` bytes，SHA-256 为 `51DEF93516FA321D621CD5988469F7F8FEBB283EDF4851DD6296091B065539C3`，当前未签名。安装器要求 Windows x64、系统内部版本 22621 或以上，并要求先安装 WebView2 Evergreen Runtime。缺少此依赖时安装器会中止。随包提供 .NET、Windows App SDK 和 Node，无须另装这些运行时。
- 同次 `release-output-manifest.json` 为 `442` bytes，SHA-256 为 `81d5120559d7f72548282d870bce29ee8d810a04af7d85632cdb442bc57a3367`。下载后先核对两项资产，再安装。
- 干净目标机安装、覆盖升级、卸载和数据保留仍为 `NotTested`。构建成功、bundle Release gate 通过或包内 sidecar 探针通过，都不等于真实安装和完整产品验收通过。详细边界见[rc.2 安装就绪状态](docs/release/installation-readiness.md)。
- 对照候选清单校验安装器 SHA-256。安装后从桌面或开始菜单打开“知客工作台”。首次使用会在 `%LOCALAPPDATA%\Zhike6` 创建空 SQLite 库。安装和备份步骤见[本机部署说明](docs/local-desktop-deployment.md)。
- 有已有资料时，升级前在“数据中心”导出备份。新旧版本的外置数据目录保持分离。程序不自动迁移旧 `%LOCALAPPDATA%\Zhike`。
- rc.2 加强安装目录保护，修正旧版提前卸载，并显示首次启动的实际加载状态。候选未签名；安装及首次使用步骤请按部署说明操作，不要关闭 Windows 安全保护。

## 使用范围

| 能力 | 当前可用范围 |
|---|---|
| 客户与业务 | 同一客户的跟票、入金、报名和跟进保持独立。渠道、VIP、群组和任务可使用系统设置中的筛选选项。 |
| WS 前台聊天 | 在 WS 工作台选择账号，首次由用户在官方页面扫码或登录。每个账号使用独立的 WebView2 会话。真实账号体验以目标环境为准。 |
| WS 手动导入 | 用户可导入获准处理的当前可见或选中内容。群组、联系人和审计页面展示已保存的本机资料。 |
| WS 后台能力 | 自动会话发现、后台采集、自动完整历史和后台群监测保持关闭。认证 profile 复制和隐藏采集保持禁用。 |
| AI 与跟进 | 可查看本机摘要、待确认建议和跟进提醒。显式联网请求需要用户配置服务并确认提交。生产 Worker 和自动 AI 消费者保持关闭。 |

VIP 群按可信发言人身份拆分手动导入的消息，只有唯一匹配到现有客户的记录才进入个人档案和跟进评分。AI 审核保护人工已填字段。支付、验证码及身份冲突需人工处理。[热聊与 AI 使用说明](docs/hot-chat-profile-usage.md)

本轮最终定向检查为 **10/10 Passed**；发布工具与说明专项 `github-prerelease-resume-guards`、`current-docs-consistency`、`release-output-only-6.0` 为 **3/3 Passed**。跨修订全量结果仍为 **293/324 Passed、31 Failed**，不能作为冻结版本全量通过。原生 UI 工具三次超时后没有运行新窗口；真实安装、干净机升级/卸载、真实 WS 和付费 AI 仍未验证。S3 保持 **Blocked**，生产自动化入口保持 **FROZEN**。[证据清单](docs/release/evidence/installation-readiness-2026-11-19/manifest.json)

## 开发与构建

`desktop/` 为 WinUI 壳和本机桥接，`resources/app/` 为 WebView2 页面、SQLite sidecar 和业务模块，`scripts/` 与 `tests/` 提供构建和回归入口。

构建需要 .NET 10 SDK、Windows App SDK 依赖和 Inno Setup。把官方 Node.js 24 Windows x64 发行包中的 `node.exe` 放在 `resources/app/` 下。开发命令可使用 PATH 上的 Node，安装器只能使用该随包路径。构建、校验和候选发布命令见[候选发布计划](docs/release/runtime-release-plan.md)。

- [故障排查](docs/local-desktop-troubleshooting.md)
- [rc.2 安装就绪状态与限制](docs/release/installation-readiness.md)
- [6.1.0 候选发布说明](docs/release/release-notes-6.1.0.md)
- [本轮实际验收与未完成项](docs/release/runtime-release-acceptance.md)
- [后续渲染退出修复与隔离桌面复测](docs/release/renderer-controller-acceptance.md)
- [开发、测试与交付约定](CONTRIBUTING.md)
