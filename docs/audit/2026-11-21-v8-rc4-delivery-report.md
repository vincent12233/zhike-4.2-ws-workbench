# 2026-11-21 · V8.0 发布候选交付报告（6.1.0 rc4）

## 1. 当前版本

| 项 | 值 |
| --- | --- |
| 分支 | `feature/zhike61-ws-completion` |
| 最新提交 | `43ca0aa`（`Verify the rc.3 to current schema upgrade on a real workspace`） |
| 远程 | 与 origin 同步，0/0 |
| 工作区 | 构建前干净；bundle 的 ReleaseGate 通过 |
| 应用版本 | `6.1.0`（可执行文件产品版本 `6.1.0+43ca0aa9382175e165db9a406411d2ea5328d95a`） |
| 数据库 schema | 34（31 个迁移脚本） |
| 相对 rc.3 | 118 个提交、265 个文件改动 |

版本策略：项目版本号固定为 `6.1.0`，构建以 `+<commit>` 标记具体提交（ReleaseGate 校验版本一致）。没有把 `6.1.0-rc.4` 写进 `package.json` / `.csproj` / `.iss`，因为 Inno 的数值版本字段不接受 RC 后缀；RC 标识只用于产物文件名与报告，避免破坏版本门禁和升级比较。

## 2. 最新安装包（rc4）

| 项 | 值 |
| --- | --- |
| 路径 | `work\releases\zhike-6.1.0-rc4-win-x64-setup.exe` |
| 大小 | 114,416,278 字节（109.12 MiB） |
| SHA-256 | `7BAD355CD01BED71B1373506850DC103FE967139D0231309667F39425C9F32F1` |
| 构建时间 | 2026-11-21T11:02:28Z |
| 对应 commit | `43ca0aa` |
| Bundle | `work\winui-bundle\zhike-winui-6.1.0-win-x64.zip`，SHA-256 `287052DFCA12FB1B3DF830AC6DAD2EFF7B33EA7B8CCD44AF52F35A8BF1C2D751` |
| 构建命令 | `build-winui-bundle.ps1 -SelfContained -ReleaseGate` + `ISCC.exe zhike-desktop-setup.iss` |

旧版基线保留未动：

| 项 | 值 |
| --- | --- |
| 路径 | `work\releases\zhike-6.1.0-win-x64-setup.exe` |
| 大小 | 114,177,547 字节 |
| SHA-256 | `F8D7CA52106BA9A7CE824DF4AE79A217C36D5860F499B9B6775138919498988B` |
| 对应 | tag `v6.1.0-rc.3`，commit `bddb8ae` |

## 3. 构建产物的内容核对

- `index.html` 引用的 66 个本地资源全部存在，无缺失。
- 31 个迁移脚本齐全，manifest 声明 schema 34。
- `resources\app\node.exe` = v24.22.1，`server.mjs`、`migration-runner.cjs` 齐全。
- 79 个前端模块进入包内。
- 未发现 `.sqlite`、`.db`、`.jsonl`、token、证书等客户数据或凭据。

## 4. 测试结果（当前 HEAD `43ca0aa`）

| 套件 | 结果 |
| --- | --- |
| `node scripts/run-tests.cjs ws` | 252/252 |
| `node scripts/run-tests.cjs all` | **405 项，405 通过，0 失败** |
| 升级迁移检查 `scripts/diagnostics/upgrade-migration-check.cjs` | rc.3 schema 25 → 34；应用 26–34；客户、账号、`data_json` 保留；`ws_group_channel_configs` 创建 |
| 重复升级幂等 | 第二次迁移 `applied = []`，版本保持 34 |
| x64 Release | 0 警告 0 错误 |
| 真实渲染截图 | 4 种视口 × 4 场景，顶栏对比度与渲染完成断言通过 |

## 5. Windows 安装验收

| 项 | 状态 |
| --- | --- |
| rc4 安装包生成 | 已通过（文件存在、SHA-256 已记录） |
| rc4 首次安装 | **未执行**：沙箱分类器拒绝运行安装包（即使 `DIR` 指向临时目录） |
| rc4 首次启动 | 未执行，同上 |
| 前一轮安装实测（`7d38540` 构建） | 已由用户在本机完成：安装成功、应用启动、sidecar `/api/health` 返回 schema 34、静态资源 200、快捷方式与卸载项正常 |
| 卸载与数据保留（`7d38540` 构建） | 已由用户实测：程序目录与快捷方式、注册表项移除；`%LOCALAPPDATA%\Zhike6` 保留，2,080,768 字节数据库、5 个账号、schema 34 原样 |
| rc.3 → rc4 安装器覆盖 | **未执行**：安装包执行被拒绝。升级已在迁移层用 rc.3 代码完整验证 |
| 关闭进程 | 应用窗口关闭后进程归零，sidecar 端口释放 |

人工安装步骤（不绕过沙箱，只能由用户执行）：

```powershell
$V="$env:TEMP\zhike-rc4-install"; Remove-Item $V -Recurse -Force -ErrorAction SilentlyContinue; New-Item -ItemType Directory -Path $V | Out-Null
& "C:\Users\Administrator\Desktop\zhike61-repo\zhike-4.2-ws-workbench\work\releases\zhike-6.1.0-rc4-win-x64-setup.exe" /VERYSILENT /SUPPRESSMSGBOXES /NORESTART /NOICONS "/DIR=$V\app" "/LOG=$V\install.log"
& "$V\app\Zhike.Desktop.exe"
```

## 6. 功能验收

| 范围 | 状态 | 依据 |
| --- | --- | --- |
| 普通 WS 采集、去重、AI 队列、CRM 补齐、字段锁、跟进提醒 | 集成测试通过 | ws 套件与 sidecar 集成用例 |
| 专用 WS 群组发现、渠道配置、成员采集、进退群证据、排除名单 | 集成测试通过 | ws 套件、群组监测与证据测试 |
| 统一 CRM、身份冲突、资料完整度、360° | 集成测试通过 | CRM 与治理测试 |
| 真实 WhatsApp 只读/群发/@/已读/开关群 | **未验证** | 缺真实账号与扫码授权 |
| Windows 安装态下的页面巡检 | 未执行（安装器被拒） | 真实渲染截图来自隔离宿主，不是安装态 |

## 7. UI 验收

- 截图来自隔离 WebView2 宿主渲染的真实 `index.html` 与全部 CSS，对应当前 HEAD。
- 覆盖 1920×1080、1366×768、125% 等效 1536×864、150% 等效 1280×720；浅色与夜间配色。
- 已提交证据：`docs/audit/evidence-2026-11-21/`（首页、客户中心、首页夜间）。
- 检查结论：导航、工具栏、六张统计卡、AI 跟进流域、客户洞察在各视口无重叠、无横向裁切。

## 8. 未完成事项

| 项 | 阻断原因 | 需要用户做什么 |
| --- | --- | --- |
| rc4 首次安装与启动 | 沙箱拒绝执行安装包 | 运行上面的命令，或双击安装包 |
| rc.3 安装态覆盖到 rc4 | 同上 | 先装 `work\releases\zhike-6.1.0-win-x64-setup.exe`，再装 rc4 |
| 真实 WhatsApp 验收 | 无账号授权 | 扫码登录测试账号并指定测试群组 |

以上三项均未标记为通过；其余可执行验证已完成并记录。main 未动，PR #2 未碰；没有创建正式 Release，也没有新建标签。
