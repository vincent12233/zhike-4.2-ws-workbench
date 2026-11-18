# Dynamic Workspace V4 最终范围复核（只读）

审查提交：`63bea509baffa1b1b3f4abca02b8607cf5240764`。
方法：`git show 63bea50 --stat/--name-only`、逐类实际 diff、隔离截图脚本及既有 fixture/helper 的源码追踪。此文件是本地审查附件，不是独立验收通过报告。

## 产品修改边界

- 24 个变更文件，484 行新增、164 行删除；产品部分为 10 个 CSS、3 个 XAML 资源/引用及 `resources/app/app.js` 的首页展示字符串。
- `app.js` 仅将原首页 heading 放入 `digital-horizon` 横幅，附加现有 `today` 和 `allDue.length` 展示及无交互 SVG；`today` 继续经过 `esc`，待跟进数量继续经过已有 `display`。未改数据计算、事件处理、读写接口或客户规则。
- 3 个 XAML 改动仅增加 Light/Dark/HighContrast 主题画刷、将 StaticResource 颜色引用改为 ThemeResource；未改命名元素、事件处理器、WebView 宿主/overlay 结构或生命周期。
- 其余产品改动为主题 token、CSS owner 内的导航/面板/卡片/表格/标签/表单/动效偏好。未出现 CRM Service、数据库/schema/migration、Worker、IPC、provider/API Key 实现、WebView2 生命周期 C# 或 WS 执行器文件变更。
- 没有发现本提交越过视觉范围的业务实现变更。此结论来自提交 diff，不替代运行时验收。

## 三条 row paint 复核

位置：`resources/app/modules/global-6.css`，新增的普通 `tr`、偶数行、`.selected` 三条背景色规则。

- 仅在已有 `html[data-palette]:not([data-view="ws-workbench"]):not([data-view="gpt"])` 范围生效。
- 普通行规则优先级低于同组 `nth-child(even)`；`.selected` 与偶数行同等优先级且书写更晚，因此选择背景不会被新斑马纹规则覆盖。
- 原有 `tbody tr:hover`、`:focus-within` 仍为后续 `background:...!important`，优先于这三条非 important 新规则；原有鼠标和键盘焦点高亮未被覆盖。
- 客户预览类 `.customer6-preview-selected` 的既有 important 背景规则也不会被新三条普通规则覆盖。
- 新规则不设置 `position`、`z-index`、尺寸、滚动或选择事件；作用是为 sticky 单元格继承提供不透明主题背景。
- 保留的行为边界：selected 同时处于 hover/focus 时显示既有 hover/focus 背景；这不是本次新加的优先级变化。当前 computed 专项新增了斑马纹两种 parity 的 frozen-cell 遮挡检查，但未在本次只读审查中运行或追加“selected × hover × focus × 横滚”的全部组合实测，不能将源码推导写成该组合的原生通过证据。

## 截图工具隔离性

实际文件为 `scripts/delivery/dynamic-v4-capture.cjs`（不是仓库根目录的同名文件）。

- 工具仅在显式调用时执行，非 `*.test.cjs`；未新增到全量回归的自动截图链路。
- 主页面复用 S1 builder：从仓库读取代码和 CSS，移除 `initializeBackend/startDataSync`，注入明确标识的合成业务记录；fetch 替换为隔离 503，`__LOCAL_DB__=false`，没有启动 sidecar 或读取业务 SQLite。
- WS 复用 `ws-workbench-render-fixture.cjs`：抑制 boot、网络/计时/原生回调，仅渲染实际生产 DOM；实例为 `backgroundActive:false`、`wsStatus:'隔离未连接'`，浏览器页面只使用增量挂载 helper。没有 WA URL、profile 复制、登录或发送调用。
- GPT 复用既有 gptBrowserCase：使用合成 status/provider、内存空状态，fetch 仅允许隔离 `/api/state` 返回；没有 AI request/provider 密钥或付费请求路径。
- `runIsolatedEdge` 对目标要求 `file:` 且位于本次临时 root；profile 是该 root 下新 UUID 目录，动态本机 CDP 端口不接入真实 WS。源码未读取正式 profile 或凭据。
- 写入范围为临时夹具、专用浏览器 profile、显式指定的验收输出目录、截图和 manifest。清理只针对已检查前缀/父目录的本轮临时 root，异常退出不能证明清理安全时保留。
- 截图脚本会打开真实的表单/详情入口以观察外观，但没有点击保存/删除等业务提交动作。可见数据是合成样本，不是生产记录。

## 限制与当前状态

- 此审查没有运行 Edge、dotnet、原生窗口或测试；不得把它计作新的运行通过数。
- 代码无生产访问路径不等于网络抓包或全机审计证明；捕获脚本本身也明确标注 BrowserOnly，不能替代 WinUI、WebView Core 生命周期、真实 WS/AI 质量验收。
- 三条 row paint 未发现会覆盖既有 selected/hover 的新增缺陷；仍以当前正在运行的全量回归和已记录的真实布局证据为最终依据。
- 读取工作区状态时只有未跟踪的 `docs/release/dynamic-workspace-v4-coverage.md` 和对应 evidence 目录，未覆盖或修改它们。
- 本次审查仅新增本文件。生产入口保持 FROZEN，S3 Gate 由父任务依据完整证据决定，未在此升级门禁。
