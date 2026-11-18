# 知客 6.1.0 A+B 预发行交付

**`v6.1.0-rc.1` 已发布**，资产对应源码提交 `a451c403cc0c4960f720b0dc73771fdbb706edd1`。仓库为私有，下载需要登录已获访问权限的 GitHub 账号。该条目为预发行。[GitHub 发布页](https://github.com/vincent12233/zhike-4.2-ws-workbench/releases/tag/v6.1.0-rc.1) · [发布回执](evidence/runtime-delivery-2026-11-19/github-published.json)

| 项目 | 实际交付 |
| --- | --- |
| 安装器 | `zhike-6.1.0-win-x64-setup.exe` |
| 安装器大小 | 114,276,747 字节 |
| SHA-256 | `26832F99664D0C90586034CE5C20B07CB1C228DD059665EEDA0B6BA515C19D14` |
| 签名 | 未签名，Windows Authenticode 检查返回 `NotSigned` |
| 同次资产清单 | `release-output-manifest.json` |
| 构建工作区中的安装器 | `work/release-6.1.0-f906f159f8e54d5894c56fdcb430cb91/installer/知客-6.1.0-WinUI桌面版.exe`，路径相对于仓库根目录 |

运行安装器前，请核对 SHA-256。目标机需要 Windows x64、系统内部版本 22621 或以上，并安装 WebView2 Evergreen Runtime。干净机器的安装、空库首启写入、升级及卸载仍待实机验证。[本机部署说明](../local-desktop-deployment.md) · [同次资产清单](evidence/runtime-delivery-2026-11-19/release-output-manifest.json)

成品阶段包通过 621 个文件和 22 条迁移校验；随包 Node 使用全新临时 SQLite 的 Sidecar 探针通过。含缺失迁移执行器的首个安装包已隔离且未发布。当前全量证据仍为冻结点 `18b0d25` 的 **320/322**。S3 保持 **Blocked**，生产 Worker、自动 AI 和 RD02 后台能力保持 **FROZEN**，真实 WhatsApp、付费 AI 和产品 WinUI 正常关闭仍待验收。[运行验收报告](runtime-release-acceptance.md) · [原始与归档 SHA-256](evidence/runtime-delivery-2026-11-19/manifest.json)
