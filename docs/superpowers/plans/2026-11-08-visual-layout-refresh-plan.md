# 知客视觉与布局统一整改 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在保留现有业务页面和数据逻辑的前提下，统一知客的颜色、排版、间距、响应式布局，并修复桌面 WS 容器在缩放时的边界问题。

**Architecture:** 在现有 CSS 末尾增加一个可回滚的 `design-system.css` 语义覆盖层，先通过 alias token 统一旧组件，再以 3 个主断点调整壳层和 WS。WinUI 端同步语义色刷、客户区顶栏高度和 WS overlay 的防抖重测/clamp；不重写业务页面或引入新框架。

**Tech Stack:** 原生 CSS、HTML/JavaScript、WinUI 3 XAML/C#、WebView2、Node.js 静态契约测试、现有 PowerShell 打包脚本。

**Spec:** `docs/superpowers/specs/2026-11-08-visual-layout-refresh-design.md`

## Global Constraints

- 不修改客户、跟票、入金、报名、VIP、AI、WS 的业务规则、数据格式、统计口径或 API 契约。
- 不删除现有页面、模块或用户数据；新视觉层必须可以单独移除回滚。
- 宽表格在小窗口保留内部横向滚动，不换行、不隐式隐藏数据列。
- WS 逻辑断点固定为 `>1200` 三栏、`901–1200` 可折叠 rail、`<=900` mobile tabs；默认显示中间面板。
- WinUI 52px 只表示客户区内容顶栏，不包括系统标题栏；WebView2 按 100% CSS 逻辑坐标测量，DPI 只转换一次。
- 默认禁用持续 Aurora/流动动画，所有动效遵守 `prefers-reduced-motion`。

## Review Focus

- 页面在 820×540、125%/150% DPI 下是否仍能触达按钮、筛选器和底部状态栏 —— 由任务 2/3 的响应式契约和安装版截图验收覆盖。
- 宽表格是否只在内部容器滚动且不改变字段顺序 —— 由任务 2 的 table overflow 契约覆盖。
- WS overlay 在窗口缩放、折叠两侧栏和 DPI 变化后是否完整贴合且不越界 —— 由任务 3 的 clamp/resize 契约和手工缩放测试覆盖。
- 深色主题、错误/警告/成功和 AI 标签是否保持对比度 —— 由任务 1 的 token 契约和任务 4 的 XAML 资源检查覆盖。
- 旧页面和静态资源白名单是否仍完整 —— 由任务 1/5 的 HTTP smoke、完整回归和安装包检查覆盖。

---

### Task 1: 建立统一网页设计令牌和资源契约

**Files:**
- Create: `resources/app/modules/design-system.css`
- Modify: `resources/app/index.html`（在现有视觉模块之后加载）
- Modify: `resources/app/server.mjs`（静态资源白名单）
- Create: `tests/design-system-contract.test.cjs`
- Modify: `tests/upgrade-http-smoke.test.cjs`
- Modify: `tests/project-audit-regression.test.cjs`

**Interfaces:**
- Consumes: 现有 `styles.css`、`v41-ui.css`、`ui-refresh.css`、`ws-workbench.css` 的 class 和变量名。
- Produces: `--zk-*` 语义 token、统一组件覆盖、1200/900/640 断点和无持续动画默认值。

- [ ] **Step 1: Write the failing contract test**

  在 `tests/design-system-contract.test.cjs` 断言：新 CSS 存在；背景/表面/边框/文字/主色/状态色 token 使用设计文档值；正文/辅助/表头字号下限；只有 1200/900/640 主断点；默认没有 `animation` 持续规则；`index.html` 和 `server.mjs` 都登记资源。

- [ ] **Step 2: Run the contract to verify it fails**

  Run: `node tests/design-system-contract.test.cjs`

  Expected: FAIL because the new stylesheet and resource registration do not exist.

- [ ] **Step 3: Implement `design-system.css` and resource registration**

  新 CSS 只做语义映射和视觉覆盖：统一背景、表面、边框、文字、按钮、导航、卡片、表格、空状态、弹窗、WS card；把旧 `--navy/--teal/--line/--soft` 映射到 alias；覆盖过饱和 Aurora 动画为静态渐变；为 dark theme 提供同名 token。不要改 DOM 或业务事件。

- [ ] **Step 4: Run the contract to verify it passes**

  Run: `node tests/design-system-contract.test.cjs`

  Expected: PASS.

- [ ] **Step 5: Commit**

  `git add resources/app/modules/design-system.css resources/app/index.html resources/app/server.mjs tests/design-system-contract.test.cjs tests/upgrade-http-smoke.test.cjs tests/project-audit-regression.test.cjs && git commit -m "feat: add unified visual design system"`

### Task 2: 收紧主壳层、排版和响应式表格布局

**Files:**
- Modify: `resources/app/modules/design-system.css`
- Modify: `resources/app/modules/desktop-host.css`
- Modify: `resources/app/modules/v41-ui.css`（仅移除/覆盖冲突的持续动效规则）
- Modify: `desktop/tests/DesktopVisualContractTests.cjs`
- Modify: `desktop/tests/DesktopResponsiveContractTests.cjs`

**Interfaces:**
- Consumes: Task 1 的 `--zk-*` token 和现有 `.app-shell/.sidebar/.topbar/.view-container/.table-scroll` 结构。
- Produces: 展开 224px、折叠 64px、顶栏 52px、内容边距 20px、底栏 28px；小尺寸单一滚动容器和内部表格滚动。

- [ ] **Step 1: Extend failing layout assertions**

  在现有桌面视觉/响应式契约中加入：壳层尺寸 token、`body` 不强制 1100px、`view-container` 是唯一页面滚动容器、表格使用 `overflow:auto`、1200/900/640 断点、动画默认静态。

- [ ] **Step 2: Run targeted contracts to verify the new assertions fail**

  Run: `node desktop/tests/DesktopVisualContractTests.cjs; node desktop/tests/DesktopResponsiveContractTests.cjs`

  Expected: at least one new assertion FAIL before layout changes。

- [ ] **Step 3: Implement compact shell and responsive rules**

  在 `design-system.css` 统一导航、顶部栏、内容边距、卡片密度、表格表头/单元格字号和 focus-visible；在 `desktop-host.css` 明确桌面宿主只保留一个滚动容器；宽表格维持内部横向滚动。保持已有 collapsed/mobile class 和事件选择器不变。

- [ ] **Step 4: Run targeted contracts to verify they pass**

  Run: `node desktop/tests/DesktopVisualContractTests.cjs; node desktop/tests/DesktopResponsiveContractTests.cjs`

  Expected: PASS.

- [ ] **Step 5: Commit**

  `git add resources/app/modules/design-system.css resources/app/modules/desktop-host.css resources/app/modules/v41-ui.css desktop/tests/DesktopVisualContractTests.cjs desktop/tests/DesktopResponsiveContractTests.cjs && git commit -m "feat: compact shell and responsive layout"`

### Task 3: WS 三栏视觉和 WebView2 overlay 尺寸稳定性

**Files:**
- Modify: `resources/app/modules/design-system.css`
- Modify: `resources/app/modules/ws-workbench.css`
- Modify: `desktop/src/Zhike.Desktop/Views/LegacyUiHostPage.xaml`
- Modify: `desktop/src/Zhike.Desktop/Views/LegacyUiHostPage.xaml.cs`
- Modify: `desktop/src/Zhike.Desktop/Services/WindowLayoutService.cs`
- Modify: `desktop/src/Zhike.Desktop/Views/WsWorkbenchPage.xaml.cs`
- Modify: `desktop/tests/DesktopResponsiveContractTests.cjs`
- Modify: `desktop/tests/DesktopSmokeTests.cjs`

**Interfaces:**
- Consumes: Task 1/2 的 token、WS class、现有 `ApplyWsBounds(JsonElement)` 和 `CalculateLayout(...)`。
- Produces: 防抖的 host resize/re-measure、完整 bounds clamp、三栏/rail/mobile 的确定性布局。

- [ ] **Step 1: Write failing WS geometry contracts**

  断言 `LegacyUiHostPage` 有 host `SizeChanged` 或等价的 150ms 防抖重测；`ApplyWsBounds` 对 x/y/width/height 都执行 host 范围 clamp；`WindowLayoutService` 不把实际尺寸硬抬到 820×540；WS CSS 包含三段断点和默认中间面板。

- [ ] **Step 2: Run WS contracts to verify failure**

  Run: `node desktop/tests/DesktopResponsiveContractTests.cjs; node desktop/tests/DesktopSmokeTests.cjs`

  Expected: new geometry assertions FAIL before implementation.

- [ ] **Step 3: Implement geometry and visual changes**

  给 `LegacyUiHostPage` 增加 SizeChanged 防抖测量，完整 clamp 到 `WebViewHost.ActualWidth/ActualHeight`，处理 DPI/滚动偏移；把 overlay 外框改为 WS 路由下全出血容器。将 `WindowLayoutService` 的逻辑尺寸改为基于实际可视尺寸并在窄窗口触发 rail/mobile，而不是静默扩大尺寸。只调整布局，不改采集、登录、消息和账号状态逻辑。

- [ ] **Step 4: Run WS contracts to verify they pass**

  Run: `node desktop/tests/DesktopResponsiveContractTests.cjs; node desktop/tests/DesktopSmokeTests.cjs`

  Expected: PASS.

- [ ] **Step 5: Commit**

  `git add resources/app/modules/design-system.css resources/app/modules/ws-workbench.css desktop/src/Zhike.Desktop/Views/LegacyUiHostPage.xaml desktop/src/Zhike.Desktop/Views/LegacyUiHostPage.xaml.cs desktop/src/Zhike.Desktop/Services/WindowLayoutService.cs desktop/src/Zhike.Desktop/Views/WsWorkbenchPage.xaml.cs desktop/tests/DesktopResponsiveContractTests.cjs desktop/tests/DesktopSmokeTests.cjs && git commit -m "fix: stabilize WS responsive geometry"`

### Task 4: WinUI 语义色刷和原生壳尺寸统一

**Files:**
- Modify: `desktop/src/Zhike.Desktop/App.xaml`
- Modify: `desktop/src/Zhike.Desktop/MainWindow.xaml`
- Modify: `desktop/src/Zhike.Desktop/Views/LegacyUiHostPage.xaml`
- Modify: `desktop/tests/DesktopVisualContractTests.cjs`
- Modify: `tests/desktop-startup-contract.test.cjs`

**Interfaces:**
- Consumes: 设计文档的网页 token、Task 3 的 host 尺寸规则。
- Produces: 网页/WinUI 同色语义资源、52px 客户区顶栏、无多余 WS 外框。

- [ ] **Step 1: Extend failing WinUI visual assertions**

  断言 `App.xaml` 暴露 page/surface/muted/border/text/accent/status 语义刷；`MainWindow.xaml` 的客户区顶栏为 52px；不再在兼容 WS host 外层强制白底圆角。

- [ ] **Step 2: Run targeted tests to verify failure**

  Run: `node desktop/tests/DesktopVisualContractTests.cjs; node tests/desktop-startup-contract.test.cjs`

  Expected: new assertions FAIL before XAML changes。

- [ ] **Step 3: Implement WinUI token and shell adjustments**

  将硬编码健康色、白色 overlay、旧背景色替换为语义刷；统一 Button/TextBox/ComboBox/ListView 的圆角和高度；把 header row 收紧到 52px，保持原生标题栏和关闭流程不变。

- [ ] **Step 4: Run targeted tests and Release build**

  Run: `node desktop/tests/DesktopVisualContractTests.cjs; node tests/desktop-startup-contract.test.cjs; .tools/dotnet10/dotnet.exe build desktop/src/Zhike.Desktop/Zhike.Desktop.csproj --no-restore -c Release -r win-x64`

  Expected: contracts PASS; build 0 warnings/0 errors.

- [ ] **Step 5: Commit**

  `git add desktop/src/Zhike.Desktop/App.xaml desktop/src/Zhike.Desktop/MainWindow.xaml desktop/src/Zhike.Desktop/Views/LegacyUiHostPage.xaml desktop/tests/DesktopVisualContractTests.cjs tests/desktop-startup-contract.test.cjs && git commit -m "feat: align native shell visual tokens"`

### Task 5: 安装版截图验收、全量回归与重新打包

**Files:**
- Modify: `docs/save-error-fix-report.md`（追加视觉整改记录和验收结果）
- Create: `outputs/visual-layout-5.1.4/`（构建产物，不纳入源码逻辑）

**Interfaces:**
- Consumes: Tasks 1–4 的 CSS、XAML、测试和现有打包脚本。
- Produces: 5.1.4 WinUI 安装包、运行包、完整源代码包、视觉验收记录。

- [ ] **Step 1: Run complete regression before packaging**

  Run: `node scripts/run-tests.cjs all` and `node tests/server-v2/run-all.cjs`。

  Expected: 现有套件全通过，新增视觉/响应式契约也通过。

- [ ] **Step 2: Build and package 5.1.4**

  Run the existing `scripts/build-winui-bundle.ps1` and `scripts/build-winui-installer.ps1` with version `5.1.4` into isolated `work/` directories; verify bundle manifest commit and staged whitelist。

- [ ] **Step 3: Install and capture visual checkpoints**

  覆盖安装到当前程序目录但不删除用户数据；在 820×540、1280×720、1920×1080 和 125%/150% 缩放分别检查首页、客户中心、快速录入、任务、阶段看板、WS 工作台；记录侧栏收起、表格滚动、WS 两侧面板收起和空状态。

- [ ] **Step 4: Verify launch/close/data preservation**

  检查安装版窗口标题、图标、关闭按钮、健康接口和用户数据目录未被清空；运行 `CloseMainWindow`/实际右上角关闭回归。

- [ ] **Step 5: Publish artifacts and report**

  将安装器、WinUI zip、完整源代码 zip、视觉验收报告和 SHA-256 放入 `outputs/visual-layout-5.1.4/`；更新报告中的已知边界，不把“编译成功”当作验收通过。

