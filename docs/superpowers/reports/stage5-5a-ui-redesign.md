# 阶段 5.5A：WS 工作台高端 UI 重构与隔离验收

日期：2026-11-16（Asia/Calcutta）。本报告记录本轮实际代码、WinUI 原生操作、失败现场、最终复验和自动化结果。**5.5A UI Gate：Passed（本报告明确的隔离 UI 范围）；不代表整个 6.1、真实 WS 业务或全部设备已经验收。**

## 范围、基线与当前结论

- 开发基线：`3d7d7179c78ba9f7ebfffb5f9aee3d6aef66ec53`，阶段 5 最终验收 Passed。
- 独立分支：`ui/zhike-61-stage55a-workspace`。原稳定分支 `fix/zhike-61-p0-infrastructure` 保留；未使用 hard reset 覆盖基线。
- 本阶段范围：WS 界面、独立导航、同窗口展示和必要的 UI 状态隔离修复。没有扩大到阶段 5.5B、新业务开发、安装包或阶段 6。
- **生产入口保持 FROZEN。正式 Worker、AI 消费者及新生产执行路径不启用。**
- 最终 UI Gate：**Passed**。阶段 5.5B 未自动开始，阶段 6 继续暂停。
- 代码提交：`17f37bf`。报告与证据独立提交；报告提交号通过 `git log -1 --format=%h -- docs/superpowers/reports/stage5-5a-ui-redesign.md` 查询，最终回复另列。提交后执行工作区干净核验。

正式应用产品版本未因本轮界面工作改成一个未经验收的 6.1 发布版本。隔离编译继续复用已有 `Stage51IsolatedUi` 基础设施，进程名为 `Zhike.Stage51.Acceptance.exe`，标题包含 `ISOLATED 验收`；这是本轮源码构建的测试宿主，不是启动已安装的正式知客或使用旧截图代替复验。

## 实际 UI 结构

`ws-workbench.js` 保留既有业务组件和事件处理，通过 `WS_WORKSPACE_VIEW_META` 定义十二个独立页面。外层为 `ws-workbench-shell`，左侧 `ws-workspace-nav` 与右侧 `ws-workbench-page` 使用占据真实空间的网格布局；不将十二项功能塞入同一个辅助抽屉。

| 页面 | 当前界面与既有能力 | 明确边界 |
| --- | --- | --- |
| 工作台首页 | 当前账号、本机已加载账号/会话/群组和各工作区入口 | 统计来自当前已加载记录，不冒充 WhatsApp 全量同步或实时采集成功 |
| 账号管理 | 现有账号列表、连接状态、搜索/状态筛选、分页、真实添加账号入口 | 账号创建仍走原桥接；本轮不授权真实 WS 登录 |
| 前台聊天 | 原生 WebView2 宿主、账号/连接/后台状态、紧凑控制行、可收起 CRM 列 | 不绘制仿制 WhatsApp 会话、消息或输入框替代真实页面 |
| 群组管理 | 当前账号目录、搜索及筛选、真实属性表格、选择状态、复制标识、分页、可收起详情、监测设置 | 不把缺失权限或采集字段写成正常；未同步信息显示“未提供” |
| 群成员管理 | 当前账号成员账本及已有进退事件 | 相同成员跨群分别展示，身份与关系规则复用原服务 |
| 数据采集 | 既有采集状态、完整历史/队列/档案流程、断点及跳过说明 | 普通界面运行状态不能证明正式 Worker 已启用或真实 WS 已采集 |
| 通讯录管理 | 独立页面和明确的待开发说明，指向现有 CRM/原生 WS 联系人使用位置 | **通讯录独立服务尚未接入，不计为新增通讯录功能完成** |
| AI 助手 | 已有任务、结果、证据、状态和审核相关组件 | 隔离 Mock 结果明确标注；不调用真实付费 AI，不代表 AI 质量验收 |
| CRM 客户 | 原客户主档关联、资料补全和审核组件 | 唯一客户匹配、人工字段保护和建档边界不改变 |
| 任务中心 | 已有账号作用域任务、筛选/分页及真实任务概况 | 不改变任务消费者、幂等或写入权威 |
| 操作日志 | WS、采集、群组和 AI 的真实运行状态快照 | **页面明确说明完整操作审计尚未接入；不把快照冒充完整审计历史** |
| 工具与设置 | 翻译、本地导入/消息、导出、群发及现有安全状态入口 | 复用现有工具、确认和权限边界，不自动执行发送、删除等危险操作 |

### 主窗口与知客侧边栏

`MainWindow` 通过新增 `WorkspaceWindowPresentationService` 保存原 HWND 的 Windows `WINDOWPLACEMENT`，进入 WS 时最大化同一个窗口，退出时恢复原 showCmd、flags 和正常窗口矩形。服务没有账号、WebView 或 Worker 依赖，不创建替代主窗口。

界面进入 WS 后仅在该路由下隐藏原知客侧边栏，并设置 `hidden`、`inert`、`aria-hidden`；原侧栏折叠偏好在进入前保存，WS 内不改写该偏好，返回后恢复。普通知客页面继续使用原侧栏及原主题。WS 最大化属于临时展示，布局保存串行执行，并避免把强制最大化状态覆盖进入前的窗口布局。用户在 WS 内手动恢复、调整或最小化窗口，不由页内切换持续强制最大化。

### 聊天、CRM 与原生层级

前台聊天继续使用 `LegacyUiHostPage`、现有账号池和真实 `#wsBrowserHost`。只有聊天页展示原生前台视图；其他 WS 页面隐藏前台展示，但不因此销毁或重新导航已有 Core。路由/边界消息不能创建 Core、打开已关闭账号或切换账号。实际账号打开仍经过原 `open` 边界。

CRM 面板使用独立网格列，关闭后回收宽度给聊天宿主，不使用网页浮层覆盖原生 WebView2。小窗口优先收起面板；本地消息及手动导入默认不占聊天高度，通过现有工具入口按需展开。顶部只保留一行操作与真实后台状态，移除旧 cockpit/process 包装层造成的重复占高。

前台 WebView2 初始化前设置深蓝 `DefaultBackgroundColor`，仅改善真实视图初始/空白底色，没有注入 WhatsApp CSS、采集脚本、伪造消息或更改 Source。后台采集实例及隔离边界继续复用既有实现。

### 群组工作区

群组目录显示当前账号归属，缺失字段诚实显示“未提供”。批量栏有明确选择数量、仅看已选、复制所选标识及清空选择，按钮随选择状态启用。表格保留可横向滚动的列宽和 40 条分页，不缩小字体强塞列。

详情与表格为静态同级布局：宽有效视口使用右侧 340px 独立列，窄视口堆叠展示；关闭后表格回收全部宽度。群监测配置和事件仍由原服务负责，不自动执行危险操作。实际展开、关闭已验证，见截图 20/21；初次在表格下方的失败画面 09 仅作诊断记录。

## 统一视觉规范

共享参数定义在 `ws-workbench.css` 的 WS 路由作用域中，覆盖复用业务组件的旧紧凑样式，避免影响知客其他页面和 GPT 页面。

| 参数 | 实际实现 |
| --- | --- |
| 主背景/侧栏/面板 | `#081225` / `#0b152b` / `#0d1830` |
| 强调色 | `#3874ff` 至 `#7253ef` 的蓝紫渐变 |
| 文字/辅助文字 | `#edf3ff` / `#a2b0cc`，状态同时保留文本 |
| 展开/收起导航 | 250 / 76 有效像素，独立滚动 |
| 标题/导航/正文及表格 | 28 / 17 / 16 有效像素；辅助标签通常 14，不用缩小主文字适配窗口 |
| 主要按钮、输入框/表格行 | 44 / 52 有效像素最小尺寸 |
| 页面边距/面板圆角 | 24 / 14 有效像素 |
| 动效 | 180ms；遵守系统减少动画偏好 |
| 交互 | 统一 SVG 图标、键盘焦点、禁用状态、内层滚动边界、表格横向滚动及分页 |

布局回归已从早期简化 HTML 改为执行完整生产 `render()`，包含旧 cockpit/process 外层包装、CRM、工具和实际详情 DOM，避免只测手拼截图模型。目标视口覆盖 1920×1080、1536×864、1280×720、2560×1440、2048×1152、1707×960，对应两组分辨率在 100%/125%/150% 的有效空间模型。

**以上是实际 Edge 计算布局的 CSS viewport 模型，不是六组 Windows 系统 DPI/显示器的原生实测。** 本机 Windows 11 专业版 10.0.26300 x64，WebView2 Runtime 157.0.4341.46，Release；原生截图正常窗口 1422×815、最大化 1920×1140，XamlRoot 记录 RasterizationScale=1。截图像素不能直接当作 CSS 或系统 DPI。其他 Windows/显示器/DPI 组合原生实测为 NotTested，没有更改用户系统缩放设置。

| 有效视口 | 聊天宿主 CSS 尺寸（CRM 展开） | CRM 列 |
| --- | --- | --- |
| 1920×1080 | 1222×868 | 380 |
| 1536×864 | 838×652 | 380 |
| 1280×720 | 626×508 | 340 |
| 2560×1440 | 1862×1228 | 380 |
| 2048×1152 | 1350×940 | 380 |
| 1707×960 | 1009×748 | 380 |

六项均检查完整生产渲染、内层滚动、文字/控件尺寸、CRM 真实占列、群详情折叠及同一聊天宿主节点。测试第一次因真实旧包装漏测而调整夹具；后续两次 Edge 已输出计算结果但退出超时，未判通过或扩大 30 秒 deadline。最终测试在取得结果后释放完成的 iframe，实际浏览器正常退出，最终专项与全量均通过。

## 本轮发现及修复

1. 实机发现旧工具栏和流程栏的外层包装仍占聊天高度，早期简化布局测试未覆盖。已针对真实包装修复并改用完整生产渲染结果验证，不能将早期模型通过作为该缺陷不存在的证明。
2. 原生层级不能被网页 CRM 浮层可靠覆盖。改为独立列，为真实聊天保留可操作空间。
3. 群监测加载沿用同一对象会导致切换账号后锁残留、旧响应污染或配置错误上下文。新账号使用独立状态对象，请求始终释放其自身对象；配置/启动等异步边界核对账号上下文。
4. 切换到空账号时可能显示前账号的热聊资料、编辑草稿和主档。切换前同步清空这些展示数据及匹配状态，保留原有按账号存储的合法草稿机制；回归执行实际函数而非仅搜索源码字符串。
5. 原生复制接口返回 `{copied:true}`，旧回复复制校验与其不一致。最小修复真实确认 DTO，保留受校验的旧响应兼容；截断、不完整或失败确认不能记录为复制成功。
6. 群详情初次原生检查仍位于表格下方，随后调整为宽视口右侧列；任务页重复流程条和采集页旧 max-height 裁切分别按页面作用域处理，不改流程统计与消费者。

7. `switchAccount` 的旧异步失败 catch/finally 缺少序列所有权校验，可能回滚新账号、解开新请求的 busy 或重绘旧状态。已在每个 await、catch、finally 及恢复链校验 sequence；过期失败不再 reopen 旧账号，最新失败仍按原行为回滚。实际函数测试覆盖五个成功等待边界、旧 native/API 错误、四个恢复边界的迟到成功/失败、B→C→A 三序列。最终原生再次十次切换通过。

PID 24104 曾出现 `desktop bridge timeout (legacy.api)`（截图 23），之后恢复。**该超时根因未充分证实，不能归因于上述竞态，也不能标记为已修复。** 最终 PID 4860 复验未复现；保留为需关注的历史实机风险。源代码与实际重放证明竞态已修复，并不证明原超时原因。

## 修改文件范围

| 范围 | 文件 |
| --- | --- |
| 同窗口呈现与原生路由 | `desktop/src/Zhike.Desktop/MainWindow.xaml.cs`、`desktop/src/Zhike.Desktop/Views/LegacyUiHostPage.xaml.cs`、新增 `desktop/src/Zhike.Desktop/Services/WorkspaceWindowPresentationService.cs` |
| Web UI | `resources/app/app.js`、`resources/app/modules/ws-workbench.js`、`resources/app/modules/ws-workbench.css` |
| 原生与布局回归 | `desktop/tests/WsRouteVisibilityRuntimeTests.cjs`、新增 `desktop/tests/WorkspaceWindowPresentationRuntime/`、`scripts/stage51/workspace-layout.test.cjs` |
| 页面和交互回归 | `scripts/stage5/ws-workspace-pages.test.cjs`、`scripts/stage5/ui-automation-contract.test.cjs`、`tests/sidebar-ws-route-runtime.test.cjs`、`tests/ws-workbench-ui.test.cjs` |
| 账号竞争及复制 | 新增 `tests/ws-group-monitor-account-race.test.cjs`、`tests/ws-reply-copy-runtime.test.cjs`、`tests/helpers/ws-workbench-render-fixture.cjs`；其他新增项以最终 Git diff 为准 |
| 既有回归适配 | `tests/ws-gpt-horizon-visual.test.cjs`、`tests/ws-hot-chat-profile-ui.test.cjs`、`tests/ws-resize-performance-contract.test.cjs`、`tests/ws-workbench-init.test.cjs` |
| 执行和隔离夹具 | `scripts/run-tests.cjs`、新增 `scripts/stage55a/native-prepare.cjs`；最终辅助脚本以提交清单为准 |

未修改 SQL、迁移历史、CRM/AI/群组核心服务及 WorkerFeatureFlags 源码。测试断言调整有对应真实运行测试补充，没有删除失败测试、跳过安全校验或靠放宽超时伪造通过。

## 原生验收及证据

本轮只运行专用隔离构建，使用单独临时根和合成账号/客户/群组；外部 WhatsApp 与付费 AI 请求继续被已有隔离机制拦截。真实 WebView 空白/连接失败是该隔离条件的结果，**不能报告为扫码、实际消息输入或真实前后台采集并行已验收通过**。

原生截图目录为 [`stage55a-screenshots/`](stage55a-screenshots/)。01–03 是初始诊断，09 是详情列修复前，14b 是重复流程带修复前，23 是真实超时；20/21 为最终群表/右详情，22 为最终任务页，25–29 为竞态修复后聊天/账号/CRM。所有截图均为实际隔离窗口，未生成仿制消息。日志与校验见 [`stage55a-evidence/sha256-manifest.json`](stage55a-evidence/sha256-manifest.json)。

| 必测项 | 最终结果/证据 |
| --- | --- |
| 进入 WS 自动最大化、同 HWND、隐藏原侧栏 | Passed：最终 HWND 6687510，showCmd 1→3，原侧栏消失，WS 导航出现；最终 native-summary 有同 HWND 进出记录 |
| 返回知客恢复原窗口和原侧栏偏好 | Passed：同 HWND 3→1，原矩形 X208/Y208/W1152/H659 保持；最终原生画面恢复原侧栏和正常窗口，截图 18 为此前同逻辑复验 |
| 十二页进入、返回、连续切换 | Passed：PID 32180 逐页记录十二页；最终竞态修复版 PID 4860 重点复验账号/群组/成员/采集/聊天；待开发入口明确标记 |
| WS 侧栏展开、收起、状态恢复 | Passed：截图 16/17 与重新进入的收起状态；不改变知客主侧栏偏好 |
| CRM 展开/收起及聊天空间回收 | Passed：最终截图 27–29；原生 layer geometry/hit-test 均保持有效，未覆盖 CRM 列 |
| 群组表格、筛选、选择、分页及右侧详情 | 原生表格及右详情展开/关闭 Passed（20/21）；筛选/选择/40 条分页由实际渲染与实际处理函数自动化验证 Passed。原生批量勾选/翻页未完整复验，不另标原生 Passed |
| 十次账号切换及客户/群组/成员作用域 | Passed（合成账号）：最终 PID 4860 初次 default + 十次 A/B，后续复用 Core；群/成员页面对应当前账号，竞态实际函数及多账号服务回归通过 |
| WebView2 Core 数量、导航及生命周期 | Passed（已测范围）：PID 32180 十二页仅一个 visible Core；最终 PID 4860 两个账号各创建一次，共两次隔离 about:blank 导航，后九次切换 created=false/reload=false；没有页切换导航循环 |
| 原生字体和窗口适配 | Passed（当前窗口范围）：标题和主要操作清晰，窗口最大化及正常尺寸可使用。原生真实聊天输入/滚轮及六组系统 DPI 为 NotTested；六视口 Edge 布局另列 |
| 正常退出、进程释放 | Passed：最终 Alt+F4 正常关闭；PID+创建时间验证 21 个已观察身份全部退出，0 未验证、0 残留；检查程序未强杀进程 |

最终 `ws-bounds-decision`：page=chat、三个账号标识均 default，accepted/chatActive/hostRenderable/hasNativeCore/overlayGeometryApplied/overlayHitTestVisible 全为 true，ZIndex=20；矩形约 x274/y188/w1164.4/h663.2。诊断只在 `STAGE51_ISOLATED_UI` 编译，不增加生产日志或放宽安全判断。详见 [native-summary](stage55a-evidence/native-summary.json) 和 [原始白名单事件](stage55a-evidence/native-events.jsonl)。

## 测试记录与未通过结果

必须保留本阶段所有实际失败，最终通过也不删除历史原始记录。已有原始日志中：

- `.tools/stage55a-full.log` 为较早源码快照的 **261/261**，不作为最终修复后的结果。
- `.tools/stage55a-full-final.log` 实际为 **259/261，2 项失败**：`WS local ingest runtime` 报隔离 sidecar 未启动；`Stage 5.1 Worker lifecycle resource observation` 报 `spawnSync powershell.exe ETIMEDOUT`。这两项不能被早期 261/261 或专项重跑覆盖。
- 首轮独立 WS 存在服务启动失败及 UI/断言适配问题，原始日志保留；后续单项通过不等同于其初始环境根因已证实。
- 本轮新增真实 Win32 窗口呈现回归、账号请求竞争回归、回复复制实际函数回归；最终计数以全部源码和测试冻结后完整运行结果为准，不沿用历史 259 或 261。

| 最终执行范围 | 实际命令/日志 | 最终结果 |
| --- | --- | --- |
| UI 专项 | `node scripts/run-tests.cjs stage55a` | 最终 7/7 Passed，包含完整六视口、实际 Win32 呈现、账号竞争和复制确认 |
| WS 回归 | 最终全量实际执行 `runWs()` | 149/149 Passed；归档脚本逐项比对 WS 149 个执行名称与最终全量 PASS，不复制上阶段结果 |
| Worker / IPC / fencing | 全量实际关键测试；`node scripts/stage51/resource-worker-regression.test.cjs` 再复验 | Passed：生命周期、真实 IO、ACL/Token/取消、实际 fencing 等；本轮跨 SID 不重测，仍引用阶段 1.7 历史证据 |
| 项目全量 | `node scripts/run-tests.cjs all` | 最终 262/262 Passed；原 259 + 3 个新增顶层检查，无删除测试；账号竞态增加同一运行例中的排列覆盖 |
| WinUI Release x64 | `.tools/dotnet10/dotnet.exe build desktop/src/Zhike.Desktop/Zhike.Desktop.csproj -c Release --no-restore -p:Platform=x64 -r win-x64 --nologo -v:minimal` | 0 warnings / 0 errors，20.68 秒；仅编译正式 exe，不启动 |
| 隔离 WinUI 编译 | 上述加 `-p:Stage51IsolatedUi=true -p:OutputPath=../../../.tools/stage55a-native/` | 最终诊断版 0 warnings / 0 errors，22.84 秒；实际启动的是此隔离版 |
| Git 格式/边界 | `git diff --check`、最终文件清单/生产开关核验 | Passed；无 SQL/生产开关/业务核心改动 |

最终完整重跑和 UI 专项是在本轮进行的；超时失败保留，未延长超时、删例或静默忽略。`WS local ingest runtime` 另行复验通过；Worker 失败堆栈位于 15 秒 PowerShell/WMI 残留检查，不能说 Worker Runtime 本体死锁。其最终全量和额外单项（约 4.17 秒，0 残留）均通过，但原 WMI 延迟原因未证实。

没有正式性能阈值时不另造放行阈值。本轮资源观察为 31 样本、337.09 秒（5.62 分钟）：工作集约 762.6→1589.1 MiB，Private Bytes 429.1→810.9 MiB，线程 226→503，WebView 子进程 6→18；对应从只有 shell 到增加两个独立账号 Core/profile，不把增长直接认定为泄漏，也不证明长期内存稳定。最终 21 个观察身份全部释放。资源曲线包含修复前 PID 24104，作为诊断保留；最终修复版另有关闭前快照及 21/21 释放证明。阶段 5.2 的 15.59 分钟、91 样本属于历史证据，本轮没有冒充其为新 UI 长时性能测试。

原始执行日志留在 `.tools/`，归档保存逐项 RUN/PASS/FAIL、原日志 SHA-256 和字节数：[test-executions](stage55a-evidence/test-executions.json)、[计数核对](stage55a-evidence/test-counts.json)。部分测试早于最后一个定点修复执行；改变的账号函数由其后全量中的实际函数回归、最终 UI 专项及新的原生十次切换重新覆盖；未受影响的服务/迁移模块不重复设计。

## 数据、安全与临时资源

本轮隔离根：`C:\Users\酷酷\AppData\Local\Temp\zhike-stage51-native-2dec15a44459404d9fcb442ef35815c4`。创建器只复制允许的代码/资源及本机已有测试运行时，禁止复制生产 data、登录 profile 或凭据。合成 seed 与两账号元数据为测试专用，不能作为生产全量同步证据。

不提交 `connection.private.json`、数据库、WebView2 profile、Cookie、Token、聊天业务载荷或完整敏感原始日志。归档器只允许指定临时根和 marker，白名单复制诊断种类、进程计数及执行摘要；已生成 SHA-256 清单，逐文件一致性校验。截图只包含核实的隔离窗口，不保存其他应用遮挡或通知内容。隔离根保留为未运行的本轮复验夹具，没有用户要求暂留的旧目录混入；未执行递归删除或绕过审批。最终已观察应用、sidecar、WebView 进程全部退出；没有将此状态等同于已删除临时目录。此前用户清理的旧目录不重建。

生产默认开关继续失败关闭；新增 UI 路由和按钮不自动开启 Worker Gate。IPC 可信消息源要求 HTTPS `zhike.local` 默认端口且无 UserInfo，并验证文档、序列、页面及账号；没有放宽 IPC SID/ACL、Token 或 SQLite fencing。CRM 人工资料保护、唯一客户关联、普通 AI 不创建未知客户，以及群组受控建档规则不改变。

## 回滚与停止条件

稳定基线及独立分支保留。最终代码提交完成后，可在审查影响后对本阶段代码提交执行 `git revert <代码提交>`，报告独立提交可另行 revert；不使用 hard reset，不删除用户数据或旧队列。没有数据库迁移、生产回填或正式安装包需要回退。

最终 **5.5A UI Gate：Passed（隔离展示与既有界面重构范围）**。必要原生导航、聊天实例保留、账号竞态修复、关键回归、编译和正常退出已取得本轮证据。独立复核未发现生产边界放宽。通讯录待开发、完整审计尚未接入、真实 WhatsApp/付费 AI、其他原生 DPI/设备和长期资源曲线仍是明确未完成范围，不能包装成全功能商业发布完成。历史桥接超时及服务/WMI 启动延迟保留风险，需要在后续受控联调关注；未声称其未知根因已消除。

无论本阶段 Gate 结果如何，生产入口继续 **FROZEN**。阶段 6 暂停，不自动启动阶段 5.5B、生产迁移、正式 Worker/AI、新旧双写或安装发布；后续阶段等待用户授权。
