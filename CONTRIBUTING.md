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

在非 Windows 环境（如 Linux 容器）只能运行纯 Node 与 Sidecar 部分：`resources/app/node.exe` 可临时链接到本机 Node（该路径已被忽略，不要提交），视觉套件需设 `ZHIKE_VISUAL_BACKEND=edge`。依赖 .NET 10 SDK、WebView2/Edge、PowerShell 或 Node 24 专有 API（如 `RegExp.escape`、`DatabaseSync.enableDefensive`）的检查会失败，应记为环境阻塞，以 Windows CI（`.github/workflows/windows-validation.yml`）的结果为准，不能计为通过。
有 Playwright 与 Chromium 时，可运行 `node scripts/diagnostics/browser-page-sweep.cjs`：在临时数据目录启动隔离 Sidecar，写入合成数据，逐页打开主导航、客户 360° 与普通/专用 WS 全部子页，报告页面错误、控制台错误、失败请求、空白页、数据往返与转义问题。它是诊断工具，不在正式套件内，也不替代 WebView2 验收。

默认视觉测试使用真实 WebView2 的隔离宿主。CSS 视口测试不等于原生物理滚轮、多 DPI 或真实 WhatsApp 验收。`ZHIKE_VISUAL_BACKEND=edge` 是显式的独立 Edge 复查入口；失败不会自动换后端重试。正式套件拒绝仅截图、单例视口等缩减范围的诊断开关。

## 修改边界

- 使用新的临时工作区和合成数据。不要打开真实客户库或复制 WhatsApp 登录 profile。
- 保留 CRM 唯一客户权威、人工字段保护、账号隔离、IPC 鉴权和 SQLite fencing。
- 不修改已登记迁移的内容或 checksum。新迁移和数据契约先完成兼容与恢复设计。
- 生产 Worker、自动 AI 消费者和旧认证 profile 复制路径保持关闭。独立采集会话由用户另行扫码，通过专用 WebView 运行；不能回退到前台聊天视图采集，也不能将 Mock 传输用于生产。实现与验证边界见[独立采集会话说明](docs/release/independent-collector-followup.md)。
- 修复需保存复现及必要回归。测试失败和无法执行的原生验收分别记录，不降低断言或延长超时冒充修复。

## 发布与恢复

按[候选发布计划](docs/release/runtime-release-plan.md)从干净源码构建。运行包清单、安装器清单、Git 标签和 Release 必须绑定同一源码提交，并核验字节数、SHA-256 和实际签名状态。新的安装器只放 GitHub Release，不再提交到 Git 或 Git LFS。

当前候选源码以原远端 `main` 为基础整理；本地完整开发历史保留在 `integration/61-runtime-release`。旧安装器没有从本机删除，也未作为当前下载文件发布。

发布候选不代表 S3 或真实服务验收通过。升级前备份业务数据；不要直接用旧程序打开新版本已经写入的库。恢复应使用对应版本及升级前已验证的备份，具体步骤见[本机部署说明](docs/local-desktop-deployment.md)。
