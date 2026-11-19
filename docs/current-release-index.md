# 当前版本索引

源码后续改进与下方已发布安装包分开记录：[独立扫码后台采集与本机群组管理](release/independent-collector-followup.md)。该改动尚未重新打包，不改变 rc.2 的下载文件、哈希或既有验收结论。

## 知客 6.1 A+B 候选

| 项目 | 当前入口 |
|---|---|
| 源码与安装版本 | **6.1.0**，WinUI 3 + WebView2 + 随包 Node SQLite |
| 预发行标签 | **`v6.1.0-rc.2`** |
| 候选源码 | `5a7dabe7321f7682b2cb518aeb9d4a1c2c89ace1` |
| 发布状态 | GitHub 预发行已发布：release `451004886`，`draft=false`、`prerelease=true`；[打开 v6.1.0-rc.2](https://github.com/vincent12233/zhike-4.2-ws-workbench/releases/tag/v6.1.0-rc.2) |
| 安装资产 | `zhike-6.1.0-win-x64-setup.exe`，`114280989` bytes，SHA-256 `51DEF93516FA321D621CD5988469F7F8FEBB283EDF4851DD6296091B065539C3`，unsigned |
| 同次清单 | `release-output-manifest.json`，`442` bytes，SHA-256 `81d5120559d7f72548282d870bce29ee8d810a04af7d85632cdb442bc57a3367` |
| 下载 | 从上述预发行条目同时取得安装资产与同次清单；下载需要已有该私有仓库访问权限的 GitHub 账号 |
| 使用和验收 | [安装就绪状态](release/installation-readiness.md)、[本机部署说明](local-desktop-deployment.md)、[故障排查](local-desktop-troubleshooting.md)、[候选发布说明](release/release-notes-6.1.0.md) |

安装器要求 Windows x64、内部版本 22621 或以上，以及 WebView2 Evergreen Runtime。首次安装必须创建空数据空间 `%LOCALAPPDATA%\Zhike6`，已存在的同代数据目录继续使用。请在覆盖安装前导出备份。干净目标机安装、覆盖升级、卸载和数据保留在本轮仍为 `NotTested`，构建成功不能替代这些实测。

WS 前台聊天由用户本人在官方页面扫码或登录。手动导入保留原文，明确绑定的 VIP 群按可信成员身份关联既有客户。后台自动发现、自动完整历史、自动采集和后台群监测关闭。生产 Worker、自动 AI 消费者和认证 profile 复制保持关闭（**FROZEN**）。已保存的本机资料和显式调用外部 AI 的入口保留；真实 WS 和付费 AI 仍待验收。S3 保持 **Blocked**。

本轮定向检查为 **10/10 Passed**；发布工具与说明专项 `github-prerelease-resume-guards`、`current-docs-consistency`、`release-output-only-6.0` 为 **3/3 Passed**。另一次跨修订全量为 **293/324 Passed、31 Failed**，属于 mixed-revision / not-freeze-full，不能写成最终冻结版本全量通过。原生隔离构建为 0 warnings、0 errors；bundle Release gate 通过且 622 个文件哈希复核一致。包内 sidecar 探针通过；42.620 秒是 `NativeReadinessProbe` 对 `LocalServiceManager.StartAsync` 的端到端就绪度量，可能包含重试和清理，未记录重试次数，不是一次 Node 进程的纯启动时间。原生 UI 工具三次超时后没有运行新窗口。[证据清单](release/evidence/installation-readiness-2026-11-19/manifest.json)

## 反回滚边界

当前产品只通过 WinUI、本机 SQLite 和关联的构建脚本运行。各安装资产以对应候选标签的版本、字节数、签名状态和 SHA-256 为准。`45ba133` 的打包控制台提示和 `ce484a4` 的草稿恢复工具都没有改变归属于 `5a7dabe` 的安装 payload。恢复发布只清理精确匹配 release `451004886` 的不完整 starter 附件，没有覆盖历史 Release 或历史资产。历史文件保留供追溯。

历史 **6.0.3** 的[发布说明](release-notes-6.0.3.md)、[测试报告](test-report-6.0.3.md)和[安装清单](../releases/release-output-manifest.json)只描述当时的产物。候选的 S3、跨设备、真实 WhatsApp 和付费 AI 状态见[本轮说明](release/release-notes-6.1.0.md)。
