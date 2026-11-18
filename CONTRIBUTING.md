# 开发、测试与交付

这是 Windows 桌面源码仓库。普通用户使用 GitHub Release 中的安装器，不需要源码、Node 开发环境或 Visual Studio。

## 目录

| 目录 | 用途 |
|---|---|
| `desktop/src/Zhike.Desktop` | WinUI 主窗口、WebView2 宿主、凭据和本机桥接 |
| `resources/app` | 页面、业务模块、SQLite 本机服务与迁移源文件 |
| `tests`、`scripts/stage*`、`scripts/delivery` | 隔离测试和验收工具 |
| `docs/release` | 当前设计决策、验收矩阵及保留的历史证据 |
| `scripts/build-winui-*.ps1` | 自包含运行包与安装器构建 |
| `work`、`.tools` | 忽略的本机构建、诊断与开发工具目录 |

历史报告只证明其对应提交和环境。当前结论先看 README、当前版本索引和本轮验收报告，不用历史通过数量代替本次结果。

## 开发环境

使用 Windows x64、.NET 10 SDK、WebView2 Evergreen Runtime 与 Inno Setup 7。应用目前目标系统内部版本为 22621 或以上。官方 Node 24 Windows x64 的 `node.exe` 放在 `resources/app/node.exe`，不要提交运行时二进制。

构建脚本优先查找 `.tools/dotnet10/dotnet.exe`，再查 PATH。现有 Windows 原生回归入口仍使用 `.tools/dotnet10/dotnet.exe`；运行这组回归前，需在该目录准备官方 SDK。不要把开发工具位置写入应用运行配置。

```powershell
& resources/app/node.exe scripts/run-tests.cjs all
& resources/app/node.exe scripts/run-tests.cjs ws
& resources/app/node.exe scripts/run-tests.cjs installer
```

默认视觉测试使用真实 WebView2 的隔离宿主。CSS 视口测试不等于原生物理滚轮、多 DPI 或真实 WhatsApp 验收。`ZHIKE_VISUAL_BACKEND=edge` 是显式的独立 Edge 复查入口；失败不会自动换后端重试。正式套件拒绝仅截图、单例视口等缩减范围的诊断开关。

## 修改边界

- 使用新的临时工作区和合成数据。不要打开真实客户库或复制 WhatsApp 登录 profile。
- 保留 CRM 唯一客户权威、人工字段保护、账号隔离、IPC 鉴权和 SQLite fencing。
- 不修改已登记迁移的内容或 checksum。新迁移和数据契约先完成兼容与恢复设计。
- 生产 Worker、自动 AI 消费者和已停用的后台采集保持关闭。安装包发布不会解除该边界。
- 修复需保存复现及必要回归。测试失败和无法执行的原生验收分别记录，不降低断言或延长超时冒充修复。

## 发布与恢复

按[候选发布计划](docs/release/runtime-release-plan.md)从干净源码构建。运行包清单、安装器清单、Git 标签和 Release 必须绑定同一源码提交，并核验字节数、SHA-256 和实际签名状态。新的安装器只放 GitHub Release，不再提交到 Git 或 Git LFS。

当前候选源码以原远端 `main` 为基础整理；本地完整开发历史保留在 `integration/61-runtime-release`。旧安装器没有从本机删除，也未作为当前下载文件发布。

发布候选不代表 S3 或真实服务验收通过。升级前备份业务数据；不要直接用旧程序打开新版本已经写入的库。恢复应使用对应版本及升级前已验证的备份，具体步骤见[本机部署说明](docs/local-desktop-deployment.md)。
