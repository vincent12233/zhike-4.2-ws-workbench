# 知客 5.1 桌面视觉与交互重整设计

## 1. 目标与背景

本次工作针对当前 WinUI 3 桌面版“能启动但不像原知客、页面覆盖不完整、WS 窗口不稳定、空间利用率低”的问题，目标是让桌面应用恢复原 Electron 版知客的视觉语言、页面密度、导航层级和操作习惯，同时保留原有业务逻辑、数据格式、Docker/PostgreSQL 服务以及原生 WS 连接器。

用户最终得到的是一个桌面应用，不是单独发布的网页。WebView2 只作为桌面应用内部的页面渲染引擎；窗口、生命周期、WS 登录隔离、窗口记忆和本地服务仍由 WinUI 3 负责。

### 目标

1. 在 820×540、1366×768、1920×1080 和 125%/150% Windows 缩放下保持可用，关键操作不被遮挡或需要横向滚动。
2. 恢复原版知客的侧栏、顶栏、页面容器、卡片、表格、空状态、弹窗和状态标签体系。
3. 覆盖原项目全部主要路由，而不是只保留 6 个演示页。
4. WS 工作台使用稳定的三栏布局，支持左右侧栏收起、独立滚动、固定登录窗口和多账号切换。
5. 业务数据、接口语义、统计口径和原有操作结果保持兼容；Docker API 继续作为权威数据源。
6. 失败时可回退到原 Electron 客户端或旧版页面，不破坏用户数据。

### 非目标

- 不重写客户、跟票、入金、VIP、报名和 AI 业务规则。
- 不把本项目改造成需要公网部署的 Web SaaS。
- 不保存 WhatsApp 密码、Cookie、二维码或秘密 Token；不绕过平台安全验证。
- 不预置演示客户、演示任务或伪造统计数据。
- 不在本次工作中引入团队协作、权限组织或新的收费系统。

## 2. 事实基线

结论来自当前仓库中的真实源代码和运行配置，而非假设。

### 2.1 现有 Electron 页面

- `resources/app/index.html` 已经包含完整的应用壳层：深色侧栏、工作区切换、分组导航、顶栏搜索/备份/同步状态、视图容器和底部状态栏。
- 导航路由包含：`home`、`intake`、`operations`、`stage-board`、`customers`、`segments`、`hot`、`groups`、`vip`、`tickets`、`registrations`、`deposits`、`analytics`、`ws-workbench`、GPT 运营助手、`automation`、`quality`、`data`、`activity`、`recycle`、`settings`、`phone-registry`。
- `resources/app/styles.css`、`resources/app/modules/v41-ui.css` 和 `resources/app/modules/ws-workbench.css` 已形成稳定视觉基线：Microsoft YaHei UI、深蓝侧栏、青绿色主色、白色卡片、12px 圆角、轻阴影、紧凑表格和 WS 三栏栅格。
- `resources/app/app.js` 直接调用既有 `/api/state`、`/api/snapshot`、`/api/ws/*` 等接口，并依赖 preload 暴露的 Electron bridge。

### 2.2 现有 WinUI 版本

- `MainWindow.xaml` 目前是浅色 64px 顶栏 + `NavigationView`，只有首页、客户中心、快速录入、运营工作台、WS 工作台和 AI 跟进提醒 6 个入口。
- 页面是简化的 XAML 演示页面，缺少原版路由、共享页面组件和原版密度。
- `WsWorkbenchPage.xaml` 使用硬编码的 220px/300px 左右栏，尚未统一接入 `WindowLayoutService`，小窗口和高 DPI 下中心区容易被压缩。
- `WsWorkbenchPage.xaml.cs` 已经存在账号隔离、WebView2 profile、采集脚本和 API 队列；这些能力必须保留。
- Docker 栈包含 API、AI worker、WS connector、PostgreSQL 和 backup，API 健康检查为 `/api/v2/health`，现有数据不应复制到第二套权威数据库。

## 3. 方案比较与选择

### 方案 A：全部改写为纯 XAML

优点是原生控件统一，缺点是需要重新实现 20 多个页面、表格、筛选、弹窗、导入和 WS 辅助逻辑，极易改变业务边界，且无法像素级复用已验证的 CSS。放弃。

### 方案 B：WinUI 原生壳层 + WebView2 复用原版页面（选定）

WinUI 负责窗口、导航生命周期、窗口记忆、WS 原生连接器、Docker 服务探活和故障隔离；WebView2 在桌面窗口内部加载仓库中的原版 `resources/app` 页面和样式。通过版本化桌面桥和兼容 API 适配原有 Electron bridge，使原有页面逻辑继续使用同一套业务接口。

这是本项目的最佳折中：视觉和交互可直接沿用原版，业务逻辑不重写，WS 仍可使用原生 profile 隔离，最终仍是一个自包含桌面安装包。

### 方案 C：只改 WinUI 颜色和控件样式

可以快速改善观感，但无法补齐页面路由、原版操作密度和 WS 行为，不能满足“像素级”的验收。放弃。

## 4. 选定架构

```text
WinUI 3 MainWindow
├─ NativeShell (窗口、DPI、布局、导航、快捷键、生命周期)
├─ LegacyUiHost (WebView2，加载 resources/app)
│  ├─ original CSS/layout/page renderers
│  └─ compatibility bridge (window.zhikeDesktop)
├─ Native WS connector (WebView2 profile per account)
├─ Desktop API adapter (old /api/* -> Docker API v2)
└─ Health/backup/telemetry boundary (no sensitive content in logs)

Docker
├─ API -> PostgreSQL (authoritative business data)
├─ AI worker -> follow-up analysis/reminders
├─ WS connector -> user-authorized visible WhatsApp content
└─ backup -> configured retention policy
```

### 4.1 LegacyUiHost

新增一个明确的 WebView2 宿主控件/页面，不把 WebView2 散落到每个业务页。宿主负责：

- 设置固定的桌面虚拟主机名，允许原页面以相对路径加载 `index.html`、CSS、JS、图标和本地化资源。
- 在导航完成前显示原版加载骨架，失败时显示可读错误和“重试/回退到旧版”操作。
- 处理 Windows 缩放、窗口大小变化和 WebView2 resize，不产生第二层页面滚动。
- 将 `window.zhikeDesktop` 的调用转成版本化的 `DesktopBridgeRequest`，并将结果以 Promise 形式返回。
- 在关闭/崩溃时正确释放 profile、取消采集任务和未完成请求。

### 4.2 Desktop bridge 与兼容 API

桥接分为三层，避免原页面直接依赖 WinUI 类型：

1. **稳定页面契约**：`window.zhikeDesktop.version`、`window.zhikeDesktop.invoke(name, payload)`、`window.zhikeDesktop.on(event, handler)`。
2. **旧 Electron 兼容层**：继续提供原页面需要的 `window.zhikeTools`、`window.zhikeWs`、`window.zhikeAi` 最小兼容表面；旧调用由 adapter 转译，不改业务页面逻辑。
3. **服务适配层**：把旧 `/api/state`、`/api/snapshot`、`/api/ws/*` 请求映射到 Docker API v2，保留字段名、分页、错误码和幂等语义；无法映射的调用明确返回 `unsupported`，不静默伪造成功。

桥接请求必须带 `requestId`、`bridgeVersion`、`timeoutMs` 和 `accountId`（涉及 WS 时），响应带 `ok`、`errorCode`、`message` 和可选 `data`。超时、断线、服务未启动时统一转为可重试错误。

### 4.3 数据权威与一致性

- PostgreSQL/Docker API 是客户、跟票、入金、VIP、任务、AI 提醒和 WS 采集结果的权威来源。
- WebView2 只保留页面状态和短期缓存，不新增一套 SQLite 权威库。
- 既有唯一键、重复客户识别、跟票买卖分离、登记日期/下次跟进日期分离规则全部由服务端继续执行。
- 页面保存成功必须等 API 返回成功后再更新成功提示；失败时保留原输入并显示重试。
- WS 消息采集使用消息唯一标识和账号 profile 作为幂等键；手机新消息和工作台采集通过服务端去重、排序和增量游标同步。

## 5. 视觉系统与交互规范

### 5.1 原版 token 基线

统一从原 CSS token 映射到 WebView2 页面，不在 XAML 另造一套颜色：

| 用途 | 值 |
| --- | --- |
| 侧栏主色 | `#172033` |
| 侧栏次色 | `#202B40` |
| 主色 | `#13A892` |
| 主色深色 | `#0D8D7B` |
| 正文 | `#202939` |
| 次要文字 | `#7B8798` |
| 分割线 | `#E8EDF2` |
| 软背景 | `#F7F9FB` |
| 页面背景 | `#F5F7FA` |
| 成功 | `#159775` |
| 警告 | `#CB8B25` |
| 错误 | `#DD5D64` |
| 常规圆角 | 7px/12px |
| 常规阴影 | `0 8px 24px rgba(26,40,62,.06)` |

字号、按钮高度、表格行高、边距以现有 `styles.css` 和 `v41-ui.css` 为基准；新增页面只能复用 token，不得引入第二套视觉变量。

### 5.2 桌面壳层

- 侧栏默认 244px，收起为 68px；宽度不足时优先收起文字而不是压缩正文。
- 顶栏默认 57px，WS 工作台进入专注模式时压缩为 44–48px；页面标题、面包屑和全局操作仍可触达。
- 主内容区只允许一个滚动容器；固定底部状态栏不随内容上下跳动。
- 侧栏、顶栏、页脚和弹窗必须使用键盘焦点样式，按钮有 `aria-label`/tooltip。
- 导航组与原版一致：工作、客户、业务数据、系统管理；所有路由均有稳定 tag 和空状态。

### 5.3 WS 工作台

- 默认三栏：会话/账号 `minmax(198px,240px)`、聊天 `minmax(360px,1fr)`、辅助 `minmax(300px,360px)`，间距 6px。
- 左右侧栏均可收起为 48–52px rail；收起状态使用 `localStorage`/窗口布局服务记忆，重启后恢复。
- WebView2 登录区域固定在工作台内容边界内，不能随页面外层滚动；聊天内容自身滚动。
- 账号选择、连接状态、采集状态和翻译/AI 开关必须在可见区域，不依赖弹窗才能确认状态。
- 820×540 下允许自动进入“左栏/右栏按需折叠”模式；900px 以下使用移动式三标签，不出现不可达按钮。
- 采集、同步、AI 分析失败不阻塞聊天；状态条显示明确的“重试/暂停/查看详情”。

## 6. 路由与页面覆盖

主导航必须恢复以下路由，且每页至少包含标题区、筛选/操作区、数据区和空状态：

| 分组 | 路由 |
| --- | --- |
| 工作 | 今日工作台、快速录入、任务中心、阶段看板 |
| 客户 | 客户中心、分类视图、热聊管理、群组管理、VIP 管理 |
| 业务数据 | 跟票管理、报名统计、入金管理、统计分析 |
| 系统管理 | WS 工作台、GPT 运营助手、本地自动化、数据治理、数据中心、操作记录、回收站、系统设置、手机号登记 |

任务中心与阶段看板必须是两个独立路由：任务中心按时间、负责人、优先级和状态处理；阶段看板按阶段列和拖动排序处理。跟票管理必须按客户+股票代码+买卖方向+登记时间形成可区分记录，不把不同股票或不同买卖合并为一条。

## 7. 错误、回退与安全

- WebView2 初始化失败：显示重试、诊断信息和“打开旧版 Electron”按钮。
- Docker API 不可用：页面保留本地输入草稿，显示离线状态，不报“保存成功”。
- WS 会话过期/连接断开：只影响对应账号，不阻塞知客其他页面；支持重新连接和清除本地会话。
- 任何日志都只记录请求类型、耗时、错误码和关联 ID，不记录密码、Cookie、二维码、Token、完整聊天原文或敏感字段。
- 新壳层通过 feature flag `desktopLegacyUiHost` 控制；关闭时可以回退现有 WinUI 页面，升级失败不覆盖用户数据。
- 安装包覆盖升级先备份用户配置和数据库连接信息，卸载默认保留用户数据；回滚仅替换程序文件，不执行破坏性迁移。

## 8. 验收与测试

### 自动化

1. 既有 `node scripts/run-tests.cjs all` 全量通过。
2. 既有 `node tests/server-v2/run-all.cjs` 全量通过。
3. `node desktop/tests/DesktopSmokeTests.cjs` 增加壳层、路由、bridge、WS 布局和回退契约检查。
4. 新增 LegacyUiHost/bridge 静态契约测试：所有旧 bridge 调用都有适配或明确 unsupported 错误。
5. WinUI 编译 0 warning、0 error；安装器脚本可重复构建。

### 视觉与交互

- 820×540、1024×768、1366×768、1920×1080，Windows 100%/125%/150% 缩放。
- 侧栏展开/收起、顶栏压缩、窗口最小化/恢复/重启后布局记忆。
- 全部路由首次进入、空数据、加载、错误、保存成功和保存失败状态。
- WS 多账号切换、登录窗口固定、左右辅助收起、手机新消息同步、后台采集游标、AI 提醒刷新。
- 关键按钮键盘可达，弹窗可关闭，筛选和搜索不丢失输入。

### 数据回归

- 真实数据库只做只读或隔离测试；不使用真实业务数据做破坏性清理。
- 导入/快速录入保留历史登记日期，跟进日期独立；混合业务行按字段识别，不因列顺序改变而错位。
- 客户去重优先 WS 唯一标识、电话号码、账号/会话标识；已有字段不重复覆盖，AI 只补空值或进入待确认变更。

## 9. 实施顺序与可回滚性

1. 先建立视觉/路由/bridge 契约测试（红灯）。
2. 实现 LegacyUiHost、桌面桥和旧 API 适配，不改业务页面。
3. 接入原版壳层和完整导航，逐页验证。
4. 接入 WS 固定布局、窗口记忆和多账号桥接。
5. 优化页面虚拟化、懒加载、请求去重和高 DPI 布局。
6. 运行完整回归、构建自包含安装包、覆盖安装到隔离路径并验收。

每一步都保留独立提交和可回退开关。任何一页出现兼容性问题时，可只回退该路由到现有 WinUI 页面，而不影响其他页面或数据库。

## 10. 完成定义

只有在以下条件全部满足后才称为完成：

- 原有主要路由全部可进入且业务操作仍由同一套服务处理。
- 视觉基线与原版一致，桌面小窗口、高 DPI 和 WS 专注模式没有遮挡/溢出。
- WS 登录、采集、手机同步、AI 分析和跟进提醒在失败时可重试且不阻塞知客。
- 自动化测试、安装覆盖升级、启动/重启/卸载数据保留和隔离实机验收全部通过。
- 交付安装包、源码、桥接契约、迁移/回滚说明、测试报告和已知限制清单。

## 11. 开工前已锁定的工程决策

以下决策是对独立 builder check 中风险项的明确收口，避免把可决定事项留到编码中途：

1. **版本与基线**：当前 `main`/提交 `819cf0f` 是唯一实现基线，现有 Electron `resources/app` 是权威视觉与业务基线。本设计的“5.1”表示下一条桌面 UI 重整功能线；在完整验收前不改变现有 5.0.0 安装包的兼容版本标识，验收通过后再发布下一个小版本。
2. **像素验收**：在同一 Windows 机器、同一 WebView2 runtime 和指定 DPI 下生成 Electron 基线截图与桌面版截图。壳层、导航、卡片、表格和 WS 栅格按感知差异阈值 2% 验收；文本抗锯齿区域单独遮罩，不把字体渲染差异误判为布局差异。除截图外还必须通过控件尺寸、焦点顺序和路由契约测试。
3. **桥接/API 映射**：先冻结 `compatibility-contract-v5.1.md`，逐项列出旧 `/api/*`、Electron IPC 到 v2 endpoint、字段、分页、幂等键、错误码和超时。页面不直接拿秘密凭据访问服务；所有请求经桌面 adapter，认证只使用现有本机私有服务会话。未知调用返回明确 `unsupported`，禁止伪造成功。
4. **WS 归属**：原生 WS connector 是每个账号的唯一会话 owner；WebView2 只显示用户已授权的页面并消费 connector/服务事件。每账号使用独立 profile 目录和连接状态机，账号切换不共享 cookie；关闭账号、注销或回滚时只清理该账号 profile。connector 与页面状态冲突时以 connector 状态和服务端增量游标为准。
5. **响应式断点**：沿用原版断点并明确动作：`>1150px` 三栏；`901–1150px` 缩窄左右栏；`651–900px` 自动折叠右栏并提供三标签切换；`<=650px` 单栏堆叠。所有断点都保留键盘 Tab 顺序、可见焦点和收起后的可达展开按钮。
6. **布局持久化**：窗口大小、最大化状态和 WS 两侧栏状态由 `WindowLayoutService` 统一保存，使用版本化 JSON；WebView `localStorage` 仅保存页面筛选/翻译/AI 开关。旧版本布局无法解析时采用安全默认值，不删除业务数据。
7. **回滚与升级**：`desktopLegacyUiHost` 默认开启但可在诊断设置中关闭；安装器先备份用户配置和连接信息，回滚只替换程序文件。每个路由提供旧 WinUI fallback，未保存草稿保存在页面内存/本地草稿区，不因 fallback 丢失。
8. **测试环境与性能预算**：支持 Windows 10 22H2/Windows 11、WebView2 Evergreen；测试 API 使用隔离 PostgreSQL schema 和固定 fixture，不读写真实业务库。首屏壳层可交互目标 <=1.5s，普通路由切换 <=300ms（不含网络），WS WebView 首次挂载 <=3s；连续 1 万/5 万客户搜索、筛选和切页必须保持无明显卡顿并记录耗时。

这些是实现约束，不需要在每个页面重复解释；若某项在实机验证中无法满足，必须记录为已知限制并保留回滚路径，而不是降低业务正确性标准。
