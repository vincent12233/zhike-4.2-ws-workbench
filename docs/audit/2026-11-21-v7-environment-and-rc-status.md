# 2026-11-21 · V7.0 环境补齐与发布候选状态

## 1. 仓库状态

| 项 | 实际值 |
| --- | --- |
| 分支 | `feature/zhike61-ws-completion` |
| 工具链修复提交 | `7d38540` |
| 工作区 | 本轮截图与 `.iss` 变更将随报告一起提交 |
| 数据库 schema | 34（31 个迁移脚本） |
| PR #2 | 仍为 `open`，未合并、未修改；其 head 是 `codex/fix-ws-login-surface` |

## 2. 工具核验（本机实测）

| 工具 | 状态 | 版本 / 路径 |
| --- | --- | --- |
| PowerShell 7 | 可用 | 7.7.0（`pwsh` 在 PATH 中） |
| GitHub CLI | 可用 | 2.105.0，已登录 `vincent12233`，scope 含 `repo`、`workflow`；可执行文件位于 WinGet 包目录，使用时加入 PATH |
| Inno Setup | 可用 | 6.7.3，`ISCC.exe` 位于 `%LOCALAPPDATA%\Programs\Inno Setup 6` |
| Node.js 24（打包运行时） | 可用 | `.tools/node24/node.exe` = v24.22.1，已复制到 `resources/app/node.exe` |
| .NET SDK | 可用 | 10.0.404（`.tools/dotnet10/dotnet.exe`） |
| WebView2 | 可用 | 157.0.4341.60 |

## 3. 本轮修复的真实兼容性缺陷

`scripts/stage52/resource-continuous.test.ps1` 在 PowerShell 7 下解析 Node 输出失败。根因：Node 以 UTF-8 输出，PowerShell 用本机 ANSI 代码页解码，中文系统名称 `Microsoft Windows 11 专业版` 被破坏并吞掉了 JSON 字符串的收尾引号。

修复（`7d38540`）：

- 脚本入口固定 `[Console]::OutputEncoding` 与 `$OutputEncoding` 为 UTF-8。
- 原生 stdout 先按行合并再 `ConvertFrom-Json`（PowerShell 会把原生输出拆成多行字符串，逐行解析必然失败）。
- 观测上下文改为取“最新的、能解析且带 `status` 的候选”，不再依赖作业流的输出顺序。

没有删除断言，没有降低门槛，没有修改系统执行策略。

## 4. 测试结果

- `node scripts/run-tests.cjs ws`：252/252 通过。
- `node scripts/run-tests.cjs all`：**405 项，405 通过，0 失败**。上一轮四项环境缺失（两项 pwsh、一项 gh、一项 Inno Setup）全部恢复并通过。
- x64 Release：0 警告 0 错误。
- 打包脚本 `build-winui-bundle.ps1 -SelfContained -ReleaseGate`：release gate 通过。

## 5. 发布产物

| 项 | 值 |
| --- | --- |
| 安装包 | `work\winui-installer-output\知客-6.1.0-WinUI桌面版.exe` |
| 大小 | 114,416,329 字节（109.12 MiB） |
| SHA-256 | `BA7CD6616707AAEE846B3DE7E85F28ECE9EDC375CD0B14E148E16F203F5CA66E` |
| 构建时间 | 2026-11-21T10:14:51Z |
| 源提交 | `7d38540`（构建时工作树含本报告的 `.iss` 语言文件改动） |
| Bundle 压缩包 | `work\winui-bundle\zhike-winui-6.1.0-win-x64.zip`，SHA-256 `3B8DA1979C59B4155EEA06F9563CD0FEDF967602A9767CFD254EDB5FEC3F5655` |
| 构建环境 | Inno Setup 6.7.3 + .NET SDK 10.0.404 + Node 24.22.1，Windows 11 x64 |

安装脚本改动：`[Languages]` 原来引用 `compiler:Languages\ChineseSimplified.isl`，本机 Inno Setup 6.7.3 不自带该翻译文件，编译直接失败。现在把官方简体中文翻译内置到 `installer/ChineseSimplified.isl` 并由脚本相对引用，安装包可以重复构建。

## 6. 安装产物完整性检查（未执行安装器）

对 bundle 暂存目录做静态核对：

- `index.html` 引用的 66 个本地资源全部存在，无缺失。
- 31 个迁移脚本齐全，manifest 声明 schema 34。
- `node.exe` 与 `server.mjs` 均在包内。
- 未发现 `.sqlite`、`.db`、`.jsonl`、token、证书等客户数据或凭据文件。

## 6.1 首次安装实测（用户在隔离目录执行）

用户在 `%TEMP%\zhike-install-first` 运行静默安装并启动应用后，实测结果：

| 检查项 | 结果 |
| --- | --- |
| 安装日志 | `Installation process succeeded.`，无需重启，写入开始菜单与桌面快捷方式 |
| 安装目录 | `Zhike.Desktop.exe`、`unins000.exe`、`resources\app` 完整；79 个前端模块、31 个迁移脚本 |
| 包内运行时 | `resources\app\node.exe` = v24.22.1 |
| 进程 | `Zhike.Desktop.exe` 运行中，sidecar 监听 `127.0.0.1:51633` |
| 健康检查 | `/api/health` 返回 `ok:true`、`appVersion 6.1.0`、`schemaVersion 34`、`databaseStatus: queryable` |
| 静态资源 | `/index.html` 200，`/modules/ws-workbench.js` 200 |
| 数据库 | `%LOCALAPPDATA%\Zhike6\workspace.sqlite`：55 张表，`schema_migrations` 最高 34，5 个 WS 账号 |
| 版本标记 | 安装的 `Zhike.Desktop.exe` 产品版本 `6.1.0+7d38540c50748cbec930c3421d10aa7ddd3b6af6` |
| 卸载入口 | `HKCU\...\Uninstall\..._is1`：显示名「知客工作台 版本 6.1.0」，`UninstallString` 指向安装目录的 `unins000.exe` |

说明：安装复用同一 Windows 用户的既有工作区（`%LOCALAPPDATA%\Zhike6`），客户表为空、有 5 个历史 WS 账号，因此这次验证证明的是“安装后应用可启动、sidecar 可用、schema 为 34、旧工作区被正确打开”，不是全新用户的首启空库体验。空库初始化已由 Node 24 冒烟（临时目录）单独验证。

## 7. 阻塞项

| 项 | 原因 | 需要什么 |
| --- | --- | --- |
| 旧版本 rc.3 升级验证 | `gh release download` 拉取 rc.3 安装包被拒绝 | 用户把 `zhike-6.1.0-win-x64-setup.exe`（rc.3）放到 `work/releases/` |
| 真实 WhatsApp 验收 | 无测试账号 | 用户本人扫码并授权测试账号与群组 |

## 7.1 关闭、卸载与数据保留（已实测）

关闭：通过 `CloseMainWindow()` 关闭安装后的应用，进程归零，sidecar 端口 51633 不再监听。

卸载：用户在资源管理器中运行 `unins000.exe` 并确认后，Inno 在 `%TEMP%\is-*-uninstall.tmp` 中解出 `_unins.tmp` 并完成删除，结果：

| 检查项 | 结果 |
| --- | --- |
| 安装目录 `%TEMP%\zhike-install-first\app` | 已删除 |
| 桌面快捷方式 | 已移除 |
| 开始菜单「知客工作台」 | 已移除 |
| 注册表卸载项「知客工作台 版本 6.1.0」 | 已移除（仅剩与本产品无关的旧 4.1.0 条目） |
| `%LOCALAPPDATA%\Zhike6` | 保留，10 个条目 |
| `workspace.sqlite` | 2,080,768 字节不变；5 个 WS 账号；`schema_migrations` 最高 34 |
| `ai-credentials-winui.json` 等工作区文件 | 保留 |

说明：前两次核对时卸载器仍在删除文件（目录仍有 443 个文件、无进程可见），第三次核对才完成。卸载过程未删除任何客户数据，符合脚本设计。

## 7.2 数据安全静态核对

- 数据根固定为 `%LOCALAPPDATA%\Zhike6`，位于 `{app}` 之外。
- `[UninstallDelete]` 只有应用内文件条目，没有指向该数据根的删除规则。
- 安装脚本保护函数明确排除 `{win}`、`{localappdata}\Zhike`、`{localappdata}\Zhike6`、`{localappdata}` 与 `USERPROFILE`。

首次安装、启动与卸载均已实测通过；升级尚未验证，不宣称通过。
