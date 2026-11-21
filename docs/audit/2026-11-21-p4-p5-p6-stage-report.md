# 2026-11-21 · P4–P6 阶段报告：界面收口、验证与交付

分支 `feature/zhike61-ws-completion`，HEAD 见本次提交。数据库 schema 34（manifest `supportedSchemaVersion: 34`，31 个迁移脚本）。PR #2 保持打开，未合并、未关闭。

## 本轮完成的功能

| 功能 | 提交 | 现在能用的部分 |
| --- | --- | --- |
| 普通 WS AI 状态条（§27） | `6799641` | AI 卡片顶部显示当前账号、授权状态、采集状态、最近采集时间、待分析任务和失败数量；未读取的值显示“未知 / 暂无记录”，连接失败、采集异常和后台 AI 错误会把整条状态升为错误色 |
| WS 导航栏与工具栏（§24–§25） | `e3c299c` | 每个入口固定 44px 行高、19px 图标列、标签省略号、等宽数字徽标和细滚动条；移除旧版无限极光动画；收起时只留图标；底部账号区有分隔线、44px 高度和省略号；工具栏压缩到 64px，搜索和图标按钮仍保持 44px，同步状态与面包屑不再截断 |
| 客户列表空状态（§26） | `f0f4dd7` | 区分“筛选后无匹配”和“还没有客户资料”，说明筛选不会改动已存记录，并给出清空搜索与范围、清除高级筛选或新增、导入客户的真实动作 |
| 进退群证据级别（§28） | `700e160` | 每条进退群事件标注“已确认 / 已观察 / 无法确认 / 已忽略”；只有真正写入档案的成员关系才是已确认，待关联成员显示已观察，审核、权限和未知状态显示无法确认且不建档；事件区标题汇总三类数量 |
| WS 运营态势条（§30） | `7249d0c` | 概览页和采集页顶部显示账号数量与已连接数量、WS 连接、采集会话、专用工作区的监测群组数、最近采集时间和待处理事件；未读取的值显示未知 |
| 次级页面审计与 VIP 文案（§29） | `116a6d1` | 逐页确认标题、概要区和共享客户表格；VIP 管理页明确“VIP 是客户标签与编号，不单独成群，号码仍在同一份客户主档中维护” |

更早的 P1–P3 提交（渠道配置中心、配置驱动建档、在群状态、AI 补齐规则、资料完整度、字段锁定、身份冲突、渠道归因、投资资料、治理视图、统计口径、增量分析、首页电子屏、在群客户表）见 `docs/audit/2026-11-21-p1-stage-report.md` 与本轮提交历史。

## 测试

- `node scripts/run-tests.cjs ws`：252/252 通过（含本轮新增的 5 个测试文件：AI 状态条 12 项、WS 导航与工具栏 11 项、客户空状态 5 项、进退群证据 11 项、运营态势 7 项、次级页面 7 项）。
- 全量回归：`node scripts/run-tests.cjs all`，405 项检查 401 通过、4 项因环境缺失失败，均与代码无关：两项 PowerShell 资源套件需要 `pwsh.exe`（本机只有 Windows PowerShell 5.1，且机器执行策略拒绝运行脚本；未绕过该策略），GitHub 预发布守卫需要 `gh` 登录，安装包升级校验需要 Inno Setup。
- `dotnet build desktop/src/Zhike.Desktop/Zhike.Desktop.csproj -c Release -p:Platform=x64 -p:RuntimeIdentifier=win-x64`：0 警告 0 错误（使用仓库内 `.tools/dotnet10/dotnet.exe`，10.0.404）。

## 验证等级（按 V6.0 §42）

| 等级 | 状态 | 依据 |
| --- | --- | --- |
| UNIT_TESTED | 已做 | 所有新增纯模块都有独立测试，覆盖正常、边界、空值、非法输入和转义 |
| INTEGRATION_TESTED | 已做 | sidecar + SQLite + 临时数据目录，合成数据 |
| WINDOWS_BUILD_VERIFIED | 已做 | x64 Release 编译通过，0 错误 0 警告；隔离渲染宿主 `tests/native/IsolatedWebViewHost` 也已发布 |
| WINDOWS_RUNTIME_VERIFIED | **未做** | 打包后的 WinUI 应用没有启动验证 |
| VISUAL_VERIFIED | 主窗口已做，WS 布局已做 | 真实 WebView2 隔离宿主渲染真实 `index.html` 与全部 CSS：主窗口 8 种视口 × 20 条路由截图（`.tools/visual-usability/main-visual/*.png`，例如 `home-atelier-dawn.png`）；WS 工作台 6 种日光视口 + 夜间配色 × 24 条路由的计算样式与 44px 控件断言通过。截图来自真实运行界面，没有使用任何生成式效果图。旧的 headless Edge 直连方式在本机仍然立即退出且零输出，已不再作为视觉验证路径 |
| WHATSAPP_VERIFIED | **未做** | 没有真实 WhatsApp 账号；群组发现、进退群、群发、@、已读和开关群只验证到合成采集端数据 |

## 已知问题与遗留

- **视觉验证阻塞**：需要用户授权清理残留的隔离 Edge 进程，或提供可用的浏览器渲染后端（`ZHIKE_VISUAL_BACKEND`），之后才能补真实截图。
- **打包阻塞**：`scripts/build-winui-bundle.ps1` 需要 `resources/app/node.exe`（官方 Node 24 Windows x64），源码检出中没有；`iscc`（Inno Setup）未安装，安装包无法构建。
- **真实 WhatsApp 阻塞**：§38 群发、原生 @、逐成员已读、开关群仍为 BLOCKED，需要真机账号与用户授权。
- 历史遗留：`adfa35a`、`b992cac` 因误写 NUL 字节导致 `server.mjs` 在 Git 中按二进制保存，`8574316` 已恢复文本；修正历史需要强制推送，按规则不做。

## 下一步

1. 用户授权清理隔离 Edge 进程或指定渲染后端后，补齐 §35 真实截图。
2. 提供 `node.exe` 并安装 Inno Setup 后，构建 bundle 与安装包，完成 WINDOWS_RUNTIME_VERIFIED。
3. 提供真实 WhatsApp 测试账号与明确授权后，验证 §38–§39。
