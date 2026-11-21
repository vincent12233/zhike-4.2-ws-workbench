# 知客 6.1 A+B 本机桌面版

知客使用 WinUI 3、WebView2 和随包 Node SQLite 本机服务。安装和本地服务正常后，客户、跟票、入金、报名、统计、导入和备份等本机业务不依赖外网。WhatsApp 聊天、独立采集会话和用户主动调用的外部 AI 服务需要联网。

**`v6.1.0-rc.3` 已作为预发行发布**，包含独立后台采集：采集端使用单独扫码的会话，与前台聊天同时运行；生产群组管理读取本机已保存的群目录及成员关系。认证 profile 复制保持禁用。操作步骤和验证边界见[独立采集会话说明](docs/release/independent-collector-followup.md)。

## 下载与首次使用

- 最新**已发布**的预发行为 **`v6.1.0-rc.3`**，应用与安装器版本保持 **6.1.0**。[打开 rc.3 下载页](https://github.com/vincent12233/zhike-4.2-ws-workbench/releases/tag/v6.1.0-rc.3)，同时取得 `zhike-6.1.0-win-x64-setup.exe` 和 `release-output-manifest.json`。Release ID 为 `451230083`；安装包源码为 `bddb8ae33604110cdd191d7b7589fc8fe9d692bf`。完整记录见[当前版本索引](docs/current-release-index.md)。
- rc.3 安装器为 `114177547` bytes，SHA-256 为 `F8D7CA52106BA9A7CE824DF4AE79A217C36D5860F499B9B6775138919498988B`，当前未签名（unsigned）。同次清单为 `442` bytes，SHA-256 为 `b3932186cde2c8b42a1e924c382b40c51a5bcad80a431d6a4a3082a6f1343b83`。下载后核对两项资产，不能沿用 rc.2 数值。
- [已发布的历史 rc.2](https://github.com/vincent12233/zhike-4.2-ws-workbench/releases/tag/v6.1.0-rc.2)仍可供追溯，但不包含本轮独立采集和群组查询改动。其源码与校验值单列在当前版本索引中。下载需要登录已有该私有仓库访问权限的 GitHub 账号。
- 安装器要求 Windows x64、系统内部版本 22621 或以上，并要求先安装 WebView2 Evergreen Runtime。缺少此依赖时安装器会中止。随包提供 .NET、Windows App SDK 和 Node，无须另装这些运行时。
- 已在 Windows 2025 runner 完成首次安装、同包覆盖安装与卸载检查，核验 624 个文件及安装目录外的合成数据保留；[构建验证记录](https://github.com/vincent12233/zhike-4.2-ws-workbench/actions/runs/44510928815)。真实目标 Windows 操作、用户数据跨候选升级及真实 WS 仍未验收。历史边界见[rc.2 安装就绪状态](docs/release/installation-readiness.md)。
- 安装新候选时，对照同次清单校验安装器 SHA-256 和实际签名状态，保留 Windows 安全保护。安装后从桌面或开始菜单打开“知客工作台”。首次使用会在 `%LOCALAPPDATA%\Zhike6` 创建空 SQLite 库。安装和备份步骤见[本机部署说明](docs/local-desktop-deployment.md)。
- 有已有资料时，升级前在“数据中心”导出备份。新旧版本的外置数据目录保持分离。程序不自动迁移旧 `%LOCALAPPDATA%\Zhike`。
- rc.2 与 rc.3 的应用版本号和安装器文件名相同；请用 Release 标签、清单的源码提交及 SHA-256 区分，避免误装旧候选。

## V9.2 未发布候选（CI 构建）

集成分支 `feature/zhike61-ws-completion` 已有更新的候选构建，**尚未发布为 GitHub Release**，只作为 Windows CI 的构建产物提供，供验收使用。

- 下载：[Actions 构建产物 `zhike-6.1.0-win-x64-ci-44942020941-1`](https://github.com/vincent12233/zhike-4.2-ws-workbench/actions/runs/44942020941/artifacts/14721829292)（保留至 2026-12-05 19:45 UTC，需登录有权限的 GitHub 账号）。压缩包内为 `zhike-6.1.0-win-x64-setup.exe` 与同次 `release-output-manifest.json`。
- 安装器 `114509854` bytes，SHA-256 `9C8D7BD9B40E3F3B9BE359C7960EC532E2EB08749ED5FDC98E9407C0D6AA36B1`，unsigned；源码 `727c222bf2152411060cf0c241b0089ed821e6b5`。文件名与 rc.3 相同，请以 SHA-256 和清单的 `sourceCommit` 区分。
- 相对 rc.3 新增专用 WS 群组渠道配置与群组管理（渠道、群名、群别名）、客户字段锁定、身份冲突提示、资料完整度、渠道与群组统计等，数据库从 schema 25 升到 **35**。变更摘要见 [6.1.0 候选发布说明](docs/release/release-notes-6.1.0.md#v92-未发布候选)，验证记录见 [V9.2 集成报告](docs/audit/2026-11-21-v92-integration-report.md)。
- **不能回退**：数据被该候选升级到 schema 35 后，rc.3（schema 25）以及更早的 rc4–rc8 构建会以 `SCHEMA_VERSION_UNSUPPORTED` 拒绝打开同一数据目录，表现为启动后白屏。试装前请先在“数据中心”导出备份；需要回到旧版本时，只能用对应版本及升级前的备份恢复。
- Windows CI 机已完成构建、干净安装、rc.3 覆盖升级、卸载和打包页面冒烟（合成数据）。真实目标 Windows 安装、用户数据升级、真实 WhatsApp 和付费 AI **尚未验收**。
- 该构建已**冻结**为实机验收候选：除实机验收发现的明确缺陷外不再改动程序。验收步骤（含先备份、在副本上升级）见 [V9.2 RC Windows 实机验收清单](docs/release/v92-rc-windows-acceptance-checklist.md)。

## rc.3 的使用范围

| 能力 | 当前可用范围 |
|---|---|
| 客户与业务 | 同一客户的跟票、入金、报名和跟进保持独立。渠道、VIP、群组和任务可使用系统设置中的筛选选项。 |
| WS 前台聊天 | 在 WS 工作台选择账号，首次由用户在官方页面扫码或登录。每个账号使用独立的 WebView2 会话。真实账号体验以目标环境为准。 |
| WS 手动导入 | 用户可导入获准处理的当前可见或选中内容。群组、联系人和审计页面展示已保存的本机资料。 |
| WS 独立后台采集 | 使用当前所选账号的手机再次扫码，采集端就绪后可发现会话、采集已读历史及监测选定群组，并可暂停或恢复。前台聊天与采集状态分别显示；真实双会话体验仍待 Windows 验收。 |
| 本机群组管理 | 生产页面读取已保存的群目录、成员关系、同步记录和审计；已观察关系不代表实时完整花名册。 |
| AI 与跟进 | 可查看本机摘要、待确认建议和跟进提醒。显式联网请求需要用户配置服务并确认提交。生产 Worker 和自动 AI 消费者保持关闭。 |

VIP 群按可信发言人身份关联消息，只有唯一匹配到现有客户的记录才进入个人档案和跟进评分。AI 审核保护人工已填字段。支付、验证码及身份冲突需人工处理。[热聊与 AI 使用说明](docs/hot-chat-profile-usage.md)

rc.3 的[构建验证](https://github.com/vincent12233/zhike-4.2-ws-workbench/actions/runs/44510928815)和[发布流程](https://github.com/vincent12233/zhike-4.2-ws-workbench/actions/runs/44512599386)已完成。Windows 2025 runner 的首次安装、同包覆盖与卸载检查使用合成数据，不能替代用户环境验收。本轮源码的隔离回归范围见[独立采集会话说明](docs/release/independent-collector-followup.md)。真实目标 Windows 操作、用户数据跨候选升级、独立扫码与双会话实际采集、真实 WS 和付费 AI 仍未验证；S3 保持 **Blocked**。生产 Worker 和自动 AI 消费者保持关闭。rc.2 的检查数量及失败记录仅证明历史修订，不能作为 rc.3 通过结论：[历史证据清单](docs/release/evidence/installation-readiness-2026-11-19/manifest.json)。

## 开发与构建

`desktop/` 为 WinUI 壳和本机桥接，`resources/app/` 为 WebView2 页面、SQLite sidecar 和业务模块，`scripts/` 与 `tests/` 提供构建和回归入口。

构建需要 .NET 10 SDK、Windows App SDK 依赖和 Inno Setup。把官方 Node.js 24 Windows x64 发行包中的 `node.exe` 放在 `resources/app/` 下。开发命令可使用 PATH 上的 Node，安装器只能使用该随包路径。构建、校验和候选发布命令见[候选发布计划](docs/release/runtime-release-plan.md)。

- [故障排查](docs/local-desktop-troubleshooting.md)
- [rc.2 安装就绪状态与限制](docs/release/installation-readiness.md)
- [6.1.0 候选发布说明](docs/release/release-notes-6.1.0.md)
- [V9.2 集成与候选构建报告](docs/audit/2026-11-21-v92-integration-report.md)
- [V9.2 RC Windows 实机验收清单](docs/release/v92-rc-windows-acceptance-checklist.md)
- [发布与升级风险登记](docs/release/risk-register.md)
- [本轮源码验证与未完成项](docs/release/independent-collector-followup.md)
- [历史运行验收记录](docs/release/runtime-release-acceptance.md)
- [开发、测试与交付约定](CONTRIBUTING.md)
