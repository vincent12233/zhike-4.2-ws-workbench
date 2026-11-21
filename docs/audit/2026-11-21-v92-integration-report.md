# 2026-11-21 · V9.2 集成修复与发布前验收报告（6.1.0 V9.2 RC）

## 1. 集成范围

| 项 | 值 |
| --- | --- |
| 唯一集成分支 | `feature/zhike61-ws-completion` |
| 集成前远程 HEAD | `041b9bc`（执行前重新读取，未变化） |
| RC 安装包源码 | `2b8817e02402839d34cb7a047ac1a2f2df7dd045`（上一构建 `685b726` 已被取代） |
| 推送方式 | 普通快进推送；未强推、未重置；未改 `main`，未操作 PR #2 |

| 提交 | 内容 |
| --- | --- |
| `e495f0c` | cherry-pick `7a4b47a`：客户合并撤销备份不再嵌套 |
| `fc5ad6b` | cherry-pick `492faf2`：撤销只恢复本次合并涉及的客户与记录归属，冲突时拒绝 |
| `41dc574` | V9.2 兼容：合并不改写保留客户已锁定的标签/备注；合并后新设的锁视为后续修改 |
| `3065a69` | 群组管理页：静态白名单、`api()` 已解析响应约定、事件绑定；打包门禁与测试 |
| `685b726` | 群组管理页事件改为文档级委托，消除重绘后的未绑定窗口 |

目标分支此前没有等效的合并修复，未重复应用。`d543267`（旧分支的测试锚点修正）不是两项修复的依赖，未移植。

## 2. 群组管理 P0

从 HTML 到页面渲染的完整路径中发现 3 个缺陷，任一都会让安装版页面不可用：

1. Sidecar 精确静态白名单缺 `/modules/ws-managed-groups-ui.js`：页面 404，显示“群组管理模块未加载”。只增加这一条精确路径，路径包含校验与其余规则不变；`.cjs` 服务端模块、`035` 迁移、`..`/`%2e%2e` 路径仍返回 404。
2. 页面把 workbench `api()` 的结果当作 fetch `Response` 读取（`response.ok`/`response.json()`），而 `api()` 返回已解析 JSON 并在非 2xx 时抛出，每次读取都失败。改用与 `group-channels` 相同的约定。
3. `bind()` 从未被调用：新增、编辑、停用/启用、搜索、导入、候选、解除绑定均无效，表单回退为原生提交并重载页面。改为每个页面实例一次性的文档级委托监听，限定在 `[data-managed-groups]` 内，事件发生时读取页面状态。

C# 两处视图白名单原本已包含 `managed-groups`。Windows CI 自 `8b40f77` 起持续失败，原因是打包 WebView2 冒烟未预期新导航项，且冒烟从未加载该模块。

## 3. 测试结果

状态：PASS 为已实际运行通过；BLOCKED 为缺环境未能运行；NOT_TESTED 为本轮未执行。

### 3.1 客户合并撤销（`tests/customer-merge-undo-scope.test.cjs`，运行真实模块）

| 要求 | 结果 |
| --- | --- |
| 连续合并不产生嵌套备份 | PASS |
| 撤销只恢复本次合并涉及的客户 | PASS |
| 恢复被转移业务记录归属（含无编号记录） | PASS |
| 合并后修改的无关设置、客户与新记录保留 | PASS |
| 客户/记录被修改、改归属、删除、编号冲突、未知版本时拒绝且不改数据 | PASS |
| 合并或撤销保存失败时只回滚本次对象 | PASS |
| 撤销点保留 | PASS |
| 旧格式完整备份撤销点按同一范围处理 | PASS |
| 单次撤销规则不变 | PASS |
| V9.2 字段锁定：合并不改写锁定字段，合并后新锁阻止撤销 | PASS |

11 个场景在集成分支通过；修复前 `041b9bc` 的模块有 8 个场景失败。

### 3.2 群组管理页加载与交互

| 检查 | 源码 | 打包目录（Windows CI） |
| --- | --- | --- |
| HTML 引用模块且文件存在 | PASS | PASS |
| Sidecar 允许访问，字节一致 | PASS | PASS |
| `text/javascript; charset=utf-8` | PASS | PASS |
| 白名单保持精确（服务端模块/迁移/路径穿越 404） | PASS | PASS |
| 模块注册，三字段渲染真实 API 数据 | PASS | PASS |
| API 失败就地显示错误，表单保留 | PASS | PASS |
| workbench 与 C# 视图白名单 | PASS | PASS（读取打包 `Zhike.Desktop.dll`） |
| `index.html` 其余资源 200 且类型正确 | PASS | PASS |
| 点击导航进入页面、列表、新增、编辑、停用/启用、导入预览后提交、AI 候选、解除绑定 | PASS（本机 Chromium 预检） | PASS（真实 WebView2，1366×768 与 1920×1080） |
| 其他 WS 页面（17 个导航页）不受影响 | PASS（Chromium 预检） | PASS（WebView2） |

修复前验证：原白名单下页面加载测试 3/7；只修白名单时真实 API 读取仍失败；打包冒烟在列表、提交两步分别失败。

### 3.3 V9.2 业务回归

| 项目 | 结果 | 依据 |
| --- | --- | --- |
| Schema 35 | PASS | 全新库 `user_version=35`，`ws_managed_groups` 与审计表存在、无负责助理列、`jid` 可空；新库原子初始化、迁移演练；CI rc.3→候选升级 |
| 手动添加 / 编辑 / 停用与启用 | PASS | `ws-managed-groups-api`（真实 Sidecar）＋打包 WebView2 页面交互 |
| 批量导入预览 | PASS | API 预览/提交/幂等；页面先预览、列出拒绝行、预览不写入 |
| 群别名精确解析 | PASS | core＋API |
| 快速录入客户 | PASS | `intake-group-alias` |
| CRM 360° 群组登记 | PASS | Customer 360 governance view / channel attribution（静态契约） |
| 群组渠道统计 | PASS | 页面契约；渠道取自群组记录 |
| AI 同名候选 | PASS | core 不按名称绑定；页面候选仅建议 |
| 人工确认与解除绑定 | PASS | API 要求真实 `@g.us`、拒绝别名；页面解除绑定 |
| 无 JID 时管理本地群组 | PASS | 新增/编辑/停用均不需要 JID |
| 普通 WS 与专用 WS 账号隔离 | PASS | workspace isolation / authorization scope 测试＋WebView2 冒烟隔离断言 |
| 只保留渠道、群名、群别名；不含负责助理与 JID 输入；不按前缀推断渠道 | PASS | core、页面契约、页面加载与冒烟断言 |

### 3.4 全量回归（Linux 容器，`run-tests.cjs all`）

413 项检查：378 通过，35 未通过。35 项均为环境缺失，记为 BLOCKED：

- .NET 10 SDK 缺失（下载被网络策略阻止）：原生运行时、DPAPI、Worker、回溯原生测试等。
- Windows / WebView2 / Edge / PowerShell：视觉套件、资源观察、发布草稿守卫。
- Node 24 专有 API（本机 Node 22；`RegExp.escape`、`DatabaseSync.enableDefensive`）。

与集成前相比没有新增非环境失败。

### 3.5 Windows x64 构建与安装（GitHub Actions `windows-2025`）

[运行 44935667657](https://github.com/vincent12233/zhike-4.2-ws-workbench/actions/runs/44935667657)：全部 17 步 PASS。

| 环境/步骤 | 结果 |
| --- | --- |
| .NET SDK 10.0.100、Node 24.22.1、PowerShell 7、WebView2 Runtime、Windows App SDK、Inno Setup 7.1.1 | PASS（CI 机） |
| WinUI 生产构建 | PASS |
| 隔离采集、群组查询、数据库启动等 81 项源码测试（含本轮新增 7 项） | PASS |
| 自包含 bundle（ReleaseGate）与安装器编译 | PASS |
| 打包 Sidecar 空库就绪探针 | PASS |
| 打包目录群组管理页加载 | PASS（7/7） |
| 干净安装、rc.3 升级、卸载（CI 机，合成数据） | PASS |
| 打包 WebView2 普通/专用工作台冒烟 | PASS（10 场景、17 页） |
| 安装包来源与 SHA-256 / 签名状态核对 | PASS |

## 4. V9.2 RC 安装包

当前 RC 为 `2b8817e` 的构建（[运行 44937522721](https://github.com/vincent12233/zhike-4.2-ws-workbench/actions/runs/44937522721)，17 步全部 PASS），包含本报告第 6 节的 `ai-job-pipeline-core.js` 修复。

| 项 | 值 |
| --- | --- |
| 下载 | [Artifact `zhike-6.1.0-win-x64-ci-44937522721-1`](https://github.com/vincent12233/zhike-4.2-ws-workbench/actions/runs/44937522721/artifacts/14720063185)（保留至 2026-12-05） |
| 构建内文件 | `work\candidate-installer\知客-6.1.0-WinUI桌面版.exe`，按清单 `releaseAsset` 复制入 artifact |
| 大小 | 114,508,464 字节 |
| SHA-256 | `E8BED3499A96ABCFC3AEE802AD7FE31E3CBA7066D6A26C9EB738D08FD92B7707` |
| 签名 | unsigned |
| Git commit | `2b8817e02402839d34cb7a047ac1a2f2df7dd045`（CI 核对清单 `sourceCommit` 与 HEAD 一致） |
| Artifact zip SHA-256 | `7a43b87dabedc70f6c93a74326e9b201862545cba37042af659271cee66b9cb1` |

已被取代的上一构建（不含 `ai-job-pipeline-core.js` 修复，仅供追溯）：

| 项 | 值 |
| --- | --- |
| 运行 / Artifact | [44935667657](https://github.com/vincent12233/zhike-4.2-ws-workbench/actions/runs/44935667657) / [`zhike-6.1.0-win-x64-ci-44935667657-1`](https://github.com/vincent12233/zhike-4.2-ws-workbench/actions/runs/44935667657/artifacts/14719103302) |
| 大小 / SHA-256 | 114,508,389 字节 / `2A840DBCF0D22F00018C20656375EA60D6FDBF88302D993C211AAFE4ECF34D54` |
| Git commit | `685b72608f28f1a3411114f22a90c26e2f00c9a4` |

两个构建应用版本号与安装器文件名相同，须以 commit 与 SHA-256 区分。不覆盖旧 RC：artifact 按运行号命名，`work\releases` 下 rc4–rc8 与 rc.3 基线未触碰，未创建或修改 GitHub Release。打包门禁要求 `035-ws-managed-groups.sql`、`ws-managed-groups-ui.js`、`ws-managed-groups-core.cjs` 以及白名单条目，安装包因此包含 Schema 35、群组管理 UI 与 Sidecar API。

## 5. 未完成的实机验收

- 真实目标 Windows 机器上的安装、覆盖升级与卸载：NOT_TESTED（CI 机合成数据检查不能替代）。
- 用户真实数据从 rc.3–rc8 升级到 Schema 35：NOT_TESTED。
- 安装后人工操作群组管理页（真实鼠标/键盘、DPI）：NOT_TESTED。
- 真实 WhatsApp 登录、独立扫码双会话、真实群 JID 确认绑定：NOT_TESTED。
- 付费 AI 实际调用：NOT_TESTED。
- 本机 .NET、Node 24、WebView2 原生套件：BLOCKED（容器缺环境；CI 只覆盖其中子集）。
- 安装包未签名。

## 6. 其他

- 另一个会话的分支 `claude/fervent-goldberg-cps40b` 含相同的白名单修复（同一行，文本一致）与 `upgrade-http-smoke` 扩展，不含响应约定与事件绑定修复。仓库所有者在 `685b726` 推送后经 PR #3 合入集成分支（`d9902e9`）；相对 `685b726` 只新增 `upgrade-http-smoke` 中对全部 `index.html` 资源的逐字节检查，本轮代码未被改动。本报告提交以普通合并（`64f499a`）纳入该变更，未强推；合并后 `upgrade-http-smoke`、群组管理页加载、客户合并撤销与静态资源测试均通过。当前 RC 以 `2b8817e` 构建为准（见第 4 节）。
- `ai-job-pipeline-core.js` 在浏览器中以裸 `module.exports` 结尾，页面报 `module is not defined`，且顶层声明泄漏到页面全局作用域（`main` 上即存在）。后续已改为与 `customer-field-locks-core.js` 相同的 UMD 包装：Node `require` 得到相同的 24 个导出，浏览器得到 `window.ZhikeAiJobPipeline`，不再抛错或泄漏全局；由 `tests/ai-job-pipeline-browser-load.test.cjs` 覆盖。
