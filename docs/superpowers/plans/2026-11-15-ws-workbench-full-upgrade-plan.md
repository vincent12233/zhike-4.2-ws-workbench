# WS 工作台全量完善实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不改变知客既有客户、群组、VIP、采集、AI 和跟进业务规则的前提下，完成 WS 工作台 A+ 结构重构、全量导出、联系人/群组导出、图片与文件群发、后台队列和稳定性验收。

**Architecture:** 保持 WinUI 3 + WebView2 + Node SQLite 单一生产链路。WS 前台 WebView、后台 Collector、导出队列和群发队列分别运行，所有任务按账号隔离并落库。前端只更新局部状态，不重建 WS WebView；媒体使用本机受控暂存目录和账号级索引。

**Tech Stack:** Node 24、SQLite、WinUI 3/WebView2、C# native bridge、现有无依赖前端模块、Node 内置流和加密 API。

**Spec:** `docs/superpowers/specs/2026-11-15-ws-workbench-dual-layer-design.md`

## Global Constraints

- 生产运行链路只能是 WinUI 3 + WebView2 + Node SQLite；不恢复 Docker、PostgreSQL、Electron 或旧客户端。
- 前台 WS 不滚动、不点击、不自动打开会话、不抢焦点；未读会话继续跳过。
- 普通群和 VIP 群的采集规则保持不变；导出可包含两者，群发目标必须按明确白名单和账号规则校验。
- AI 只补齐已有客户档案的空字段；低置信度和冲突不自动覆盖。
- 所有导出、上传、发送和删除动作必须账号隔离、可审计、幂等、可取消或可恢复。
- 生产代码必须先有失败测试；每项任务完成后运行局部测试和全量测试。

## Review Focus

- 大数据量导出不把完整历史一次性载入内存：由导出流式压测覆盖。
- 导出包含多个账号、联系人、普通群、VIP 群和媒体不可用记录：由导出完整性契约覆盖。
- 图片/文件群发只在前台当前账号、目标会话和附件校验通过后执行：由媒体发送桥接契约覆盖。
- 群发重试不能重复发送已成功目标：由幂等和审计状态测试覆盖。
- 后台导出/群发不能改变 WebView bounds、scrollTop 或当前会话：由 UI/bridge 隔离契约覆盖。

### Task 1: 导出与媒体数据模型

**Files:**
- Create: `resources/app/migrations/018-ws-export-media.sql`
- Modify: `resources/app/server.mjs`
- Test: `tests/ws-export-media-schema.test.cjs`

**Interfaces:**
- Produces `ws_media_assets`、`ws_export_jobs`、`ws_send_attachments` 表和索引。
- `ws_send_audit` 增加 `payload_kind`、`caption`、`attachment_ids_json` 字段并保持旧文本记录可读取。

- [x] **Step 1: Write the failing schema test**：断言新表、字段、账号外键、状态约束和幂等索引不存在时失败。
- [x] **Step 2: Run the schema test and confirm RED**：`node tests/ws-export-media-schema.test.cjs`。
- [x] **Step 3: Add migration 018**：为媒体、导出任务、发送附件建立账号级字段、哈希、状态、大小、路径和清理索引。
- [x] **Step 4: Extend server migration runner and payload mappers**：保留 6.0.3 旧数据兼容，默认空附件列表。
- [x] **Step 5: Run schema test and commit**。

### Task 2: 全量导出 API

**Files:**
- Modify: `resources/app/server.mjs`
- Modify: `resources/app/modules/ws-workbench.js`
- Test: `tests/ws-export-complete.test.cjs`

**Interfaces:**
- `GET /api/ws/export?accountId=<id>`：导出单账号。
- `GET /api/ws/export?allAccounts=1`：导出所有 WS 账号和 CRM 主档案。
- 返回流式 JSON，包含 `contacts`、`groups`、`groupMembershipEvents`、`conversations`、`messages`、`analyses`、`replies`、`followupAlerts`、`sendAudit`、`mediaAssets`、`crmState` 和 `manifest`。
- `GET /api/ws/export-jobs`、`POST /api/ws/export-jobs`：创建、查询和取消后台大导出任务；任务结果使用本机受控文件路径，不暴露任意路径。

- [x] **Step 1: Write failing export completeness tests**：覆盖单账号、全账号、联系人、群组、成员事件、CRM、发送审计、媒体不可用状态和断开客户端。
- [x] **Step 2: Run and verify RED**：`node tests/ws-export-complete.test.cjs`。
- [x] **Step 3: Implement account-scoped query builders and streaming writers**：复用现有分页流，不创建完整数组；manifest 记录数量、版本和 SHA-256。
- [x] **Step 4: Add export job lifecycle**：queued/running/completed/failed/cancelled，任务进度、错误、保留期限和断点游标落库。
- [x] **Step 5: Add UI export entry**：在 WS 独立侧栏和顶部控制带提供当前账号/全部账号选择、进度、取消和下载状态，不挤压 WebView。
- [x] **Step 6: Run export tests and commit**。

### Task 3: 媒体暂存与附件 API

**Files:**
- Create: `resources/app/modules/ws-media-core.js`
- Modify: `resources/app/server.mjs`
- Modify: `resources/app/modules/ws-workbench.js`
- Test: `tests/ws-media-api.test.cjs`

**Interfaces:**
- `POST /api/ws/media`：接收已校验的 base64 分片或本机桥接上传，返回 `mediaId`、大小、MIME、SHA-256 和状态。
- `GET /api/ws/media/:id`：账号隔离的流式读取。
- `DELETE /api/ws/media/:id`：仅删除未进入已发送审计的暂存附件。
- `POST /api/ws/broadcast` 接受 `payloadKind`、`caption` 和 `attachments[]`。

- [x] **Step 1: Write failing media tests**：覆盖图片、视频、文档、音频、大小上限、MIME 白名单、哈希重复、账号越权和断点上传。
- [x] **Step 2: Run and verify RED**。
- [x] **Step 3: Implement bounded media storage**：文件写入 `data/ws-media/<account>/<sha256>`，使用临时文件 + 原子改名；不把二进制写入 SQLite。
- [x] **Step 4: Extend broadcast validation and audit payloads**：附件顺序稳定，失败只更新当前目标/附件。
- [x] **Step 5: Run media tests and commit**。

### Task 4: Native WS 图片与文件发送

**Files:**
- Modify: `desktop/src/Zhike.Desktop/Views/LegacyUiHostPage.xaml.cs`
- Modify: `desktop/src/Zhike.Desktop/Services/LegacyApiAdapter.cs`
- Modify: `resources/app/modules/ws-workbench.js`
- Test: `desktop/tests/WsMediaBridgeContractTests.cjs`
- Test: `tests/ws-media-send-runtime.test.cjs`

**Interfaces:**
- Native bridge action `send-media`：输入账号、会话标识、mediaId、MIME、文件名、caption、确认标记；只允许当前前台账号。
- 返回 `{ok, method, payloadKind, mediaId, conversationKey}`，未明确确认不写入 sent。
- 失败状态必须保留在 `ws_send_audit`，不自动降级为文本发送。

- [x] **Step 1: Write failing bridge/runtime tests**：覆盖当前会话校验、文件/图片 caption、账号隔离、媒体不可用、取消和重复发送。
- [x] **Step 2: Run and verify RED**。
- [x] **Step 3: Implement native media handoff**：从本机媒体暂存读取受控文件，向 WS 页面设置媒体输入并提交 caption；不使用前台滚动或自动切换会话。
- [x] **Step 4: Add renderer attachment picker/preview**：支持附件选择、预览队列、删除和文字说明。
- [x] **Step 5: Implement durable attachment dispatch**：发送成功后逐条确认；失败目标可单独重试，已成功目标不重复。
- [x] **Step 6: Run bridge/runtime tests and commit**。

### Task 5: A+ WS UI 重构与性能隔离

**Files:**
- Modify: `resources/app/modules/ws-workbench.js`
- Modify: `resources/app/modules/ws-workbench.css`
- Modify: `resources/app/modules/scroll-system.css`
- Modify: `resources/app/modules/scroll-coordinator.js`
- Test: `tests/ws-workbench-a-plus-layout.test.cjs`
- Test: `tests/ws-scroll-stability.test.cjs`

**Interfaces:**
- 顶部命令带 42–52px。
- 左侧 WS 独立会话/账号轨道：248px 展开、48px 收起。
- 中间 WebView 为唯一最大区域，不因辅助状态刷新而重建。
- 右侧 Context Drawer 300–360px，可收起；标签包括 AI、档案、回复、群发、导出、诊断。
- 本地工作区默认 0–36px；底部流程轨 54px，可收起到抓手。

- [x] **Step 1: Write failing layout/scroll tests**：断言新 DOM 顺序、抽屉状态、群发/导出入口、单一滚动 owner 和 WebView 不重建。
- [x] **Step 2: Run and verify RED**。
- [x] **Step 3: Recompose layout containers only**：保留业务状态和 API，取消多层顶部工具条、长卡片和外层滚动。
- [x] **Step 4: Add responsive breakpoints**：1440、1100、960、900 宽度分别验证；窄屏改为 tabs，不嵌套滚动。
- [x] **Step 5: Add local partial updates**：状态灯、队列进度和导出进度使用 textContent/局部节点更新，不调用整页 render 重建 WebView。
- [x] **Step 6: Run UI/scroll tests and commit**。

### Task 6: 全量回归与发布

**Files:**
- Modify: `scripts/run-tests.cjs`
- Modify: `docs/release-notes-6.0.3.md`
- Modify: `docs/test-report-6.0.3.md`

- [x] **Step 1: Register all new tests in WS/all suites**。
- [x] **Step 2: Run targeted tests**：export、media、bridge、layout、scroll。
- [x] **Step 3: Run `node scripts/run-tests.cjs all`**：188 项通过，0 failures。
- [x] **Step 4: Run `dotnet build desktop/src/Zhike.Desktop/Zhike.Desktop.csproj --no-restore -c Release -r win-x64 -warnaserror`**：0 warnings/0 errors。
- [x] **Step 5: Build release bundle and installer**：已用 ReleaseGate 重建 6.0.3 bundle/installer，更新 manifest、SHA-256，releases 仅保留当前 6.0.3。
- [x] **Step 6: Run full review for duplicate timers, event leaks, unbounded memory, stale media files and old runtime entry points; commit release evidence**：188 项全量回归、10 项安装器合同、WinUI 0 警告/0 错误，专项证据已合并至 `docs/test-report-6.0.3.md`。
