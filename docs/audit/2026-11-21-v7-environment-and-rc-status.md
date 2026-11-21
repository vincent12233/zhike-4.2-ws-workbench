# 2026-11-21 · V7.0 环境核实与发布候选状态

## 1. 仓库核实

| 项 | 实际值 |
| --- | --- |
| 分支 | `feature/zhike61-ws-completion` |
| 最新提交 | `fd7ec72`（本轮截图与工具核实后另有提交） |
| 工作区 | 干净 |
| 与远程 | 0/0，无分叉 |
| 数据库 schema | 34（manifest `supportedSchemaVersion: 34`，31 个迁移脚本） |
| PR #2 | `open`、未合并、head 为 `codex/fix-ws-login-surface`（与本分支无关，按要求保持打开） |
| ws 测试 | 252/252 |
| 全量测试 | 405 项，401 通过，4 项环境缺失 |
| x64 Release | 0 警告 0 错误（本轮已在 `fd7ec72` 上重新构建） |

## 2. 工具审计（本机实测）

| 工具 | 状态 | 版本/路径 |
| --- | --- | --- |
| .NET SDK | 可用 | 10.0.404（仓库内 `.tools/dotnet10/dotnet.exe`） |
| WebView2 运行时 | 可用 | 157.0.4341.60 |
| Windows PowerShell | 可用 | 5.1（`powershell.exe`） |
| PowerShell 7（`pwsh.exe`） | **缺失** | PATH 中不存在 |
| GitHub CLI（`gh`） | **缺失** | PATH 中不存在；PR 状态改用 GitHub 公共 API 读取 |
| Inno Setup（`iscc.exe`） | **缺失** | 未安装 |
| 官方 Node.js 24 `node.exe` | **缺失** | 只有系统 Node v26.13.1，不能替代打包运行时 |
| winget | 可用 | `%LOCALAPPDATA%\Microsoft\WindowsApps\winget.exe` |
| Git | 可用 | 分支与推送正常 |

## 3. 本轮被权限拦截的操作

按 V7.0 §十与 §五的授权边界，以下操作没有绕过：

1. **下载官方工具压缩包**（PowerShell 7.7.0、GitHub CLI 2.105.0、Node 24 x64）——被沙箱分类器拒绝。没有改用其他下载渠道。
2. **用 Windows PowerShell 5.1 代替 `pwsh` 运行资源套件**——需要 `-ExecutionPolicy Bypass`，该操作被拒绝；没有修改机器执行策略。对应两项测试继续按环境缺失记录。

因此 `pwsh.exe`、`gh`、`iscc.exe`、`resources/app/node.exe` 需要用户授权后由用户或授权命令补齐。

## 4. 本轮已完成

- 在 `fd7ec72` 上重新执行 x64 Release 构建：0 警告 0 错误。
- 真实渲染截图扩展到 V7.0 §28 要求的视口矩阵：4 种尺寸（1920×1080、1366×768、125% 等效 1536×864、150% 等效 1280×720）× 4 个场景（首页浅色、客户中心浅色、任务中心浅色、首页夜间）。截图来自隔离 WebView2 宿主渲染的真实 `index.html` 与全部 CSS，保存在 `docs/audit/evidence-2026-11-21/`。
- 截图检查结论：导航、工具栏、六张统计卡、AI 跟进流域、客户洞察在 1366×768 与 150% 等效视口下均无重叠、无横向裁切；夜间配色的文字与卡片对比正常。
- 截图脚本 `captureMainScreenshots` 升级为视口矩阵，并保留每张截图的渲染完成断言与顶栏对比度断言。

## 5. 仍未完成与对应授权

| 未完成项 | 原因 | 需要用户做什么 |
| --- | --- | --- |
| 两项 PowerShell 资源套件 | 缺 `pwsh.exe`，且执行策略拒绝 5.1 运行 | 允许下载 PowerShell 7 官方 zip 到 `.tools`，或由用户安装 pwsh 7 |
| GitHub 预发布守卫 | 缺 `gh`，且未登录 | 允许下载 `gh` 官方 zip，并由用户执行 `gh auth login`（不要在对话中提供 Token） |
| 安装包构建 | 缺 Inno Setup 与 `resources/app/node.exe` | 允许安装 Inno Setup；提供官方 Node 24 x64 `node.exe`（放入 `resources/app/`） |
| 首次安装 / 升级 / 卸载测试 | 依赖安装包 | 安装包生成后执行，使用隔离测试数据目录 |
| 真实 WhatsApp 验收 | 无测试账号与授权 | 用户本人扫码登录，并明确授权测试账号与测试群组 |

## 6. 验证等级

| 项目 | 等级 |
| --- | --- |
| 单元与集成测试（ws、CRM、AI、渠道、成员、进退群） | INTEGRATION_TESTED |
| 真实渲染与计算样式（主窗口 + WS 工作台） | VISUAL_VERIFIED（真实 WebView2 宿主，截图见 `docs/audit/evidence-2026-11-21/`） |
| Windows x64 编译 | WINDOWS_BUILD_VERIFIED |
| 安装、升级、卸载 | BLOCKED（缺安装包工具链） |
| 打包后应用启动 | BLOCKED（缺 `node.exe` 与安装包） |
| 真实 WhatsApp 业务 | BLOCKED（缺账号授权） |
