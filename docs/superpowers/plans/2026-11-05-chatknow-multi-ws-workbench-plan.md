# ChatKnow 风格多 WS 工作台 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在现有知客 WS 工作台中增加同一窗口多 WS 账号标签页，并将界面整理为 ChatKnow 类三栏客户服务工作台。

**Architecture:** 保留 Electron 主窗口和安全 `BrowserView`，把单一全局 WS 视图改为按账号创建、切换和销毁的视图记录；每个账号使用独立持久化 partition。SQLite 以默认账号迁移旧数据，所有 WS 会话、消息、分析、翻译设置和采集任务按账号隔离，知客客户库仍作为跨账号的统一客户主数据。

**Tech Stack:** Electron 45、Chromium BrowserView、Electron `session.fromPartition`、Node.js、SQLite、现有知客 renderer 模块和迁移脚本。

**Spec:** `docs/superpowers/specs/2026-11-05-chatknow-multi-ws-workbench-design.md`

## Global Constraints

- 不保存 WhatsApp 密码、Cookie、二维码或秘密 Token。
- 仅读取用户已打开并授权查看的 WhatsApp Web 页面可见内容。
- 每个账号使用独立持久化浏览器分区。
- 新增数据通过 SQLite 迁移文件实现，并迁移旧数据到默认账号。
- 旧版单账号数据和知客客户库格式保持兼容。
- 任一账号失败不得阻塞其他账号和知客原有页面。

## Review Focus

- 从旧版升级到多账号后，旧 WS 会话、消息、分析和采集任务都归入默认账号且不重复。
- 切换账号时，旧账号的 BrowserView、自动采集、AI 分析和翻译设置不会串到新账号。
- 清除一个账号的 session 不会清除其他账号 session 或知客客户库。
- 账号列表为空、账号连接失败、页面进程崩溃和网络断开时，工作台仍可使用。
- 左右栏收起、窗口缩放、最大化和 820×540 小窗口下，WS 页面固定在工作台中下部且不跟随外层滚动。

### Task 1: 数据库账号迁移和 API 上下文

**Files:**
- Create: `resources/app/migrations/008-ws-accounts.sql`
- Modify: `resources/app/server.mjs`
- Test: `tests/ws-multi-account.test.cjs`

**Interfaces:**
- `GET /api/ws/accounts`
- `POST /api/ws/accounts`
- `PATCH /api/ws/accounts/:id`
- `DELETE /api/ws/accounts/:id`
- Existing WS routes accept `accountId` and default to `default`.

- [ ] **Step 1: Write failing migration/API tests**
  - Assert migration creates `ws_accounts` and `ws_account_settings`.
  - Assert legacy rows migrate to account `default`.
  - Assert two accounts can own conversations with the same external ID without collision.
  - Assert deleting an account removes only its WS rows and preserves CRM customers.
- [ ] **Step 2: Run the focused test and verify it fails**
  - Run: `node tests/ws-multi-account.test.cjs`
  - Expected: FAIL because migration and account routes do not exist.
- [ ] **Step 3: Implement migration and account-scoped server helpers**
  - Add schema version 8 and idempotent legacy migration.
  - Add account payload validation, default account creation, account CRUD routes and account-scoped query helpers.
  - Preserve old requests by defaulting missing `accountId` to `default`.
- [ ] **Step 4: Run focused and existing WS API tests**
  - Run: `node tests/ws-multi-account.test.cjs` and `node scripts/run-tests.cjs all`
  - Expected: all pass.
- [ ] **Step 5: Commit**
  - `git commit -m "feat: add multi-account WS database isolation"`

### Task 2: Multi-account BrowserView lifecycle

**Files:**
- Modify: `resources/app/main.cjs`
- Modify: `resources/app/preload.cjs`
- Test: `tests/ws-multi-account-main.test.cjs`

**Interfaces:**
- IPC `zhike-ws-account` actions: `list`, `open`, `switch`, `close`, `clear-session`, `status`.
- Each account returns `{ id, name, partition, status, lastConnectedAt }` without secrets.

- [ ] **Step 1: Write failing lifecycle tests**
  - Assert opening account A and B creates distinct partitions.
  - Assert switching hides A and shows B without destroying A session.
  - Assert clearing A does not clear B.
  - Assert bounds remain within content area and below toolbar.
- [ ] **Step 2: Run focused test and verify it fails**
  - Run: `node tests/ws-multi-account-main.test.cjs`
  - Expected: FAIL because the main process has only one global view and one partition.
- [ ] **Step 3: Implement account view registry**
  - Replace `wsView` singleton with an account view map and active account ID.
  - Apply the existing sandbox, secure preload, Chrome UA, permission denial, no-throttling, navigation allowlist and probe behavior per view.
  - Keep old `zhike-ws` actions as aliases to the default account.
- [ ] **Step 4: Run focused and security tests**
  - Run: `node tests/ws-multi-account-main.test.cjs` and `node scripts/run-tests.cjs all`
  - Expected: all pass.
- [ ] **Step 5: Commit**
  - `git commit -m "feat: isolate multiple WS BrowserViews"`

### Task 3: ChatKnow-style account and three-column UI

**Files:**
- Modify: `resources/app/modules/ws-workbench.js`
- Modify: `resources/app/modules/ws-workbench.css`
- Test: `tests/ws-workbench-ui.test.cjs`

**Interfaces:**
- Renderer state adds `accounts`, `activeAccountId`, `accountBusy`, and account-scoped loading state.
- Account actions call the IPC interfaces from Task 2 and pass `accountId` to all WS API calls.

- [ ] **Step 1: Write failing UI behavior tests**
  - Assert account list renders status, name and active marker.
  - Assert left account panel can collapse and current account remains visible in compact mode.
  - Assert switching account refreshes conversations and keeps right-side customer card context.
  - Assert the WS BrowserView remains fixed inside the center panel after side panel changes.
- [ ] **Step 2: Run focused test and verify it fails**
  - Run: `node tests/ws-workbench-ui.test.cjs`
  - Expected: FAIL because the renderer has one implicit account and no account panel.
- [ ] **Step 3: Implement the UI**
  - Add account header/list above conversation list.
  - Keep the middle WS view and capture controls in a fixed center viewport.
  - Keep right translation, AI, customer and follow-up cards with compact spacing.
  - Keep manual import and current existing operations.
- [ ] **Step 4: Run focused UI and full tests**
  - Run: `node tests/ws-workbench-ui.test.cjs` and `node scripts/run-tests.cjs all`
  - Expected: all pass.
- [ ] **Step 5: Commit**
  - `git commit -m "feat: add ChatKnow-style multi-account WS layout"`

### Task 4: Account-scoped collection, AI and CRM synchronization

**Files:**
- Modify: `resources/app/modules/ws-workbench.js`
- Modify: `resources/app/server.mjs`
- Test: `tests/ws-multi-account-sync.test.cjs`

**Interfaces:**
- Automatic list discovery, visible-message capture, analyses, replies and collection items all carry `accountId`.
- CRM customer IDs remain global and can be linked from more than one WS account.

- [ ] **Step 1: Write failing sync tests**
  - Assert list previews from A and B remain separate.
  - Assert the same phone from A and B links to one CRM customer.
  - Assert AI analysis and follow-up alert for A cannot appear in B.
  - Assert manual import uses the active account context.
- [ ] **Step 2: Run focused test and verify it fails**
  - Run: `node tests/ws-multi-account-sync.test.cjs`
  - Expected: FAIL because collection and analysis routes are currently global.
- [ ] **Step 3: Implement account-scoped sync**
  - Pass account context through automatic timers, list discovery, message capture, AI analysis, replies and follow-up alerts.
  - Keep CRM matching global by normalized phone, WS ID and account-scoped conversation key.
  - Reset timers and in-flight operations safely on account switch.
- [ ] **Step 4: Run focused and full tests**
  - Run: `node tests/ws-multi-account-sync.test.cjs` and `node scripts/run-tests.cjs all`
  - Expected: all pass.
- [ ] **Step 5: Commit**
  - `git commit -m "feat: scope WS collection and AI sync per account"`

### Task 5: Documentation, installer and acceptance

**Files:**
- Modify: `README.md`
- Modify: `resources/app/README.md`
- Modify: `CHANGELOG.md`
- Create: `docs/ws-multi-account-usage.md`
- Create: `tests/ws-multi-account-installer-qa.cjs`

- [ ] **Step 1: Add usage and recovery documentation**
  - Cover adding accounts, switching, clearing one session, CRM matching, manual import and account backup/restore.
- [ ] **Step 2: Run all automated tests**
  - Run: `node scripts/run-tests.cjs all`
  - Expected: all checks pass.
- [ ] **Step 3: Build installer**
  - Run: `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/build-installer.ps1`
- [ ] **Step 4: Run installer QA**
  - Run: `$env:ZHIKE_INSTALLER=(Resolve-Path 'work\\output\\知客-4.2.1-WS工作台完善版.exe').Path; node tests/ws-installer-qa.cjs`
  - Expected: isolated install, overlay install, WS assets, uninstall and legacy data retention pass.
- [ ] **Step 5: Publish the installer artifact**
  - Copy the verified installer to `releases/` and commit the checksum.
