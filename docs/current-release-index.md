# 当前版本索引

当前更新候选为 `v6.1.0-rc.3`，安装包来源和校验值以同次交付清单为准，发布状态以 GitHub 实际记录为准。独立扫码后台采集与生产本机群组查询已经实现，详情见[独立采集会话说明](release/independent-collector-followup.md)。已发布 rc.2 的资产和证据在下方单列，不代表 rc.3 产物。

## 知客 6.1 A+B 当前候选

| 项目 | 当前入口 |
|---|---|
| 源码与安装版本 | **6.1.0**，WinUI 3 + WebView2 + 随包 Node SQLite |
| 预发行标签 | **`v6.1.0-rc.3`** |
| 候选源码 | 以同次 `release-output-manifest.json` 的完整 `sourceCommit` 记录为准 |
| 发布状态 | 候选 [v6.1.0-rc.3](https://github.com/vincent12233/zhike-4.2-ws-workbench/releases/tag/v6.1.0-rc.3)，是否已发布以该条目的实际状态为准 |
| 安装资产 | `zhike-6.1.0-win-x64-setup.exe`；大小、SHA-256 和实际签名状态以同次清单及签名核验为准 |
| 同次清单 | `release-output-manifest.json`；不使用历史清单替代 |
| 使用和验收 | [本机部署说明](local-desktop-deployment.md)、[故障排查](local-desktop-troubleshooting.md)、[候选发布说明](release/release-notes-6.1.0.md)、[本轮源码验证边界](release/independent-collector-followup.md) |

安装器要求 Windows x64、内部版本 22621 或以上，以及 WebView2 Evergreen Runtime。首次安装必须创建空数据空间 `%LOCALAPPDATA%\Zhike6`，已存在的同代数据目录继续使用。请在覆盖安装前导出备份。真实目标 Windows 安装、用户数据覆盖升级、卸载和数据保留仍为 `NotTested`，构建成功不能替代这些实测。

WS 前台聊天由用户本人在官方页面扫码或登录。后台采集使用独立会话，须用当前所选账号的手机再次扫码；采集端就绪后可进行会话发现、已读历史采集和所选群组监测，支持暂停与恢复。前台已连接不代表采集端已登录。生产群组管理可读取本机已保存的目录、成员关系、同步记录与审计；这些关系不是完整实时花名册。VIP 群按可信成员身份关联既有客户，手动导入继续保留原文。

生产 Worker 和自动 AI 消费者保持关闭，认证 profile 复制保持禁用。采集不会自动触发付费 AI；显式调用外部 AI 的入口保留。真实 WS、独立扫码、双会话实际采集和付费 AI 仍待验收，S3 保持 **Blocked**。Windows 2025 runner 安装器检查使用合成数据；本轮隔离回归与 Windows 工作流的边界见独立采集会话说明，历史通过数量不能作为新候选结论。

## 已发布 rc.2 历史记录

| 项目 | 历史记录 |
|---|---|
| 标签与发布 | [`v6.1.0-rc.2`](https://github.com/vincent12233/zhike-4.2-ws-workbench/releases/tag/v6.1.0-rc.2)，release `451004886`，`draft=false`、`prerelease=true` |
| 安装包源码 | `5a7dabe7321f7682b2cb518aeb9d4a1c2c89ace1` |
| 安装资产 | `zhike-6.1.0-win-x64-setup.exe`，`114280989` bytes，SHA-256 `51DEF93516FA321D621CD5988469F7F8FEBB283EDF4851DD6296091B065539C3`，unsigned |
| 同次清单 | `release-output-manifest.json`，`442` bytes，SHA-256 `81d5120559d7f72548282d870bce29ee8d810a04af7d85632cdb442bc57a3367` |
| 下载与范围 | 访问该私有仓库需要授权 GitHub 账号；此历史安装器不包含 rc.3 的独立采集与生产群组查询修改 |
| 历史验收 | [rc.2 安装就绪状态](release/installation-readiness.md)、[证据清单](release/evidence/installation-readiness-2026-11-19/manifest.json) |

rc.2 的最终定向检查为 **10/10 Passed**，发布工具与说明专项为 **3/3 Passed**。另一次跨修订全量为 **293/324 Passed、31 Failed**，属于 mixed-revision / not-freeze-full，不能写成最终冻结版本全量通过。历史 bundle Release gate、622 个文件哈希复核和 sidecar 探针通过，原生 UI 工具三次超时后没有运行新窗口；这些记录没有完成真实安装验收。

## 反回滚边界

当前产品只通过 WinUI、本机 SQLite 和关联的构建脚本运行。rc.2 与 rc.3 使用相同的应用版本 **6.1.0** 和安装器文件名；必须结合 Release 标签、完整源码提交、字节数、签名状态和 SHA-256 区分。旧候选可能覆盖同版本程序，安装前应核对清单并备份业务数据，不能仅凭界面版本号判断是否已更新。

`45ba133` 的打包控制台提示和 `ce484a4` 的草稿恢复工具没有改变归属于 `5a7dabe` 的 rc.2 安装 payload。恢复发布只清理精确匹配 release `451004886` 的不完整 starter 附件，没有覆盖历史 Release 或历史资产。新候选不得复用 rc.2 的校验值或验收结论。

历史 **6.0.3** 的[发布说明](release-notes-6.0.3.md)、[测试报告](test-report-6.0.3.md)和[安装清单](../releases/release-output-manifest.json)只描述当时的产物。候选的 S3、跨设备、真实 WhatsApp 和付费 AI 状态见[本轮说明](release/release-notes-6.1.0.md)。
