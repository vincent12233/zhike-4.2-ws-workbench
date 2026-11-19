# 当前版本索引

## 知客 6.1 A+B 候选

| 项目 | 当前入口 |
|---|---|
| 源码与安装版本 | **6.1.0**，WinUI 3 + WebView2 + 随包 Node SQLite |
| 预发行标签 | **`v6.1.0-rc.2`** |
| 下载 | 在 [GitHub Releases](https://github.com/vincent12233/zhike-4.2-ws-workbench/releases) 对应候选条目中查找 `zhike-6.1.0-win-x64-setup.exe` 与同次 `release-output-manifest.json` |
| 使用和验收 | [本机部署说明](local-desktop-deployment.md)、[故障排查](local-desktop-troubleshooting.md)、[候选发布说明](release/release-notes-6.1.0.md) |

安装器要求 Windows x64、内部版本 22621 或以上，以及 WebView2 Evergreen Runtime。首次安装必须创建空数据空间 `%LOCALAPPDATA%\Zhike6`，已存在的同代数据目录继续使用。请在覆盖安装前导出备份。小版本更新沿用现有备份格式与 SQLite 迁移链。

WS 前台聊天由用户本人在官方页面扫码或登录。手动导入保留原文，明确绑定的 VIP 群按可信成员身份关联既有客户。后台自动发现、自动完整历史、自动采集和后台群监测关闭。生产 Worker、自动 AI 消费者和认证 profile 复制关闭。已保存的本机资料和显式调用外部 AI 的入口保留。

## 反回滚边界

当前产品只通过 WinUI、本机 SQLite 和关联的构建脚本运行。各安装资产以对应候选标签的版本、字节数、签名状态和 SHA-256 为准。历史文件保留供追溯。

历史 **6.0.3** 的[发布说明](release-notes-6.0.3.md)、[测试报告](test-report-6.0.3.md)和[安装清单](../releases/release-output-manifest.json)只描述当时的产物。候选的 S3、跨设备、真实 WhatsApp 和付费 AI 状态见[本轮说明](release/release-notes-6.1.0.md)。
