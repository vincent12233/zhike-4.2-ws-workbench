# 知客 6.1 A+B 本机桌面版

知客使用 WinUI 3、WebView2 和随包 Node SQLite 本机服务。安装和本地服务正常后，客户、跟票、入金、报名、统计、导入和备份等本机业务不依赖外网。WhatsApp 聊天、独立采集会话和用户主动调用的外部 AI 服务需要联网。

当前源码已实现独立后台采集：采集端使用单独扫码的会话，与前台聊天同时运行；生产群组管理读取本机已保存的群目录及成员关系。认证 profile 复制保持禁用。更新候选为 **`v6.1.0-rc.3`**，安装包来源、校验值和签名状态以同次交付清单为准。操作步骤和验证边界见[独立采集会话说明](docs/release/independent-collector-followup.md)。

## 下载与首次使用

- 当前候选的应用与安装器版本保持 **6.1.0**，目标标签为 **`v6.1.0-rc.3`**。[rc.3 候选入口](https://github.com/vincent12233/zhike-4.2-ws-workbench/releases/tag/v6.1.0-rc.3)的发布状态以 GitHub 实际记录为准；下载安装时应同时取得 `zhike-6.1.0-win-x64-setup.exe` 和 `release-output-manifest.json`。新包的源码提交、大小、SHA-256 和签名状态以同次清单及实际签名核验为准，不能沿用 rc.2 数值。候选状态见[当前版本索引](docs/current-release-index.md)。
- [已发布的历史 rc.2](https://github.com/vincent12233/zhike-4.2-ws-workbench/releases/tag/v6.1.0-rc.2)仍可供追溯，但不包含本轮独立采集和群组查询改动。其源码与校验值单列在当前版本索引中。下载需要登录已有该私有仓库访问权限的 GitHub 账号。
- 安装器要求 Windows x64、系统内部版本 22621 或以上，并要求先安装 WebView2 Evergreen Runtime。缺少此依赖时安装器会中止。随包提供 .NET、Windows App SDK 和 Node，无须另装这些运行时。
- 真实目标 Windows 安装、用户数据覆盖升级、卸载和数据保留仍为 `NotTested`。构建成功、bundle Release gate 通过或包内 sidecar 探针通过，都不等于真实安装和完整产品验收通过。历史边界见[rc.2 安装就绪状态](docs/release/installation-readiness.md)。
- 安装新候选时，对照同次清单校验安装器 SHA-256 和实际签名状态，保留 Windows 安全保护。安装后从桌面或开始菜单打开“知客工作台”。首次使用会在 `%LOCALAPPDATA%\Zhike6` 创建空 SQLite 库。安装和备份步骤见[本机部署说明](docs/local-desktop-deployment.md)。
- 有已有资料时，升级前在“数据中心”导出备份。新旧版本的外置数据目录保持分离。程序不自动迁移旧 `%LOCALAPPDATA%\Zhike`。
- rc.2 与 rc.3 的应用版本号和安装器文件名相同；请用 Release 标签、清单的源码提交及 SHA-256 区分，避免误装旧候选。

## rc.3 源码已实现的使用范围

| 能力 | 当前可用范围 |
|---|---|
| 客户与业务 | 同一客户的跟票、入金、报名和跟进保持独立。渠道、VIP、群组和任务可使用系统设置中的筛选选项。 |
| WS 前台聊天 | 在 WS 工作台选择账号，首次由用户在官方页面扫码或登录。每个账号使用独立的 WebView2 会话。真实账号体验以目标环境为准。 |
| WS 手动导入 | 用户可导入获准处理的当前可见或选中内容。群组、联系人和审计页面展示已保存的本机资料。 |
| WS 独立后台采集 | 使用当前所选账号的手机再次扫码，采集端就绪后可发现会话、采集已读历史及监测选定群组，并可暂停或恢复。前台聊天与采集状态分别显示；真实双会话体验仍待 Windows 验收。 |
| 本机群组管理 | 生产页面读取已保存的群目录、成员关系、同步记录和审计；已观察关系不代表实时完整花名册。 |
| AI 与跟进 | 可查看本机摘要、待确认建议和跟进提醒。显式联网请求需要用户配置服务并确认提交。生产 Worker 和自动 AI 消费者保持关闭。 |

VIP 群按可信发言人身份关联消息，只有唯一匹配到现有客户的记录才进入个人档案和跟进评分。AI 审核保护人工已填字段。支付、验证码及身份冲突需人工处理。[热聊与 AI 使用说明](docs/hot-chat-profile-usage.md)

Windows 2025 runner 的安装器安装、覆盖与卸载检查使用合成数据，结果以对应运行记录为准，不能替代用户环境验收。本轮源码的隔离回归范围见[独立采集会话说明](docs/release/independent-collector-followup.md)。真实安装、干净机升级/卸载、独立扫码与双会话实际采集、真实 WS 和付费 AI 仍未验证；S3 保持 **Blocked**。生产 Worker 和自动 AI 消费者保持关闭。rc.2 的检查数量及失败记录仅证明历史修订，不能作为 rc.3 通过结论：[历史证据清单](docs/release/evidence/installation-readiness-2026-11-19/manifest.json)。

## 开发与构建

`desktop/` 为 WinUI 壳和本机桥接，`resources/app/` 为 WebView2 页面、SQLite sidecar 和业务模块，`scripts/` 与 `tests/` 提供构建和回归入口。

构建需要 .NET 10 SDK、Windows App SDK 依赖和 Inno Setup。把官方 Node.js 24 Windows x64 发行包中的 `node.exe` 放在 `resources/app/` 下。开发命令可使用 PATH 上的 Node，安装器只能使用该随包路径。构建、校验和候选发布命令见[候选发布计划](docs/release/runtime-release-plan.md)。

- [故障排查](docs/local-desktop-troubleshooting.md)
- [rc.2 安装就绪状态与限制](docs/release/installation-readiness.md)
- [6.1.0 候选发布说明](docs/release/release-notes-6.1.0.md)
- [本轮源码验证与未完成项](docs/release/independent-collector-followup.md)
- [历史运行验收记录](docs/release/runtime-release-acceptance.md)
- [开发、测试与交付约定](CONTRIBUTING.md)
