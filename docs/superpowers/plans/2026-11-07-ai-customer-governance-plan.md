# AI 客户档案自动治理实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在现有知客 WS AI 同步链路中增加客户档案自动建档、字段补全、冲突证据、回收站治理和可审计删除接口，并保持客户库、跟进任务和提醒实时一致。

**Architecture:** 继续复用 Node.js `server.mjs`、SQLite、`ws-crm-sync-core.js` 和现有前端状态同步。新增治理核心模块负责 AI 字段规范化、字段级合并、自动软删除判定和审计载荷；服务层在同一事务中写客户状态、治理证据、跟进任务和提醒。

**Tech Stack:** Node.js 22、SQLite `DatabaseSync`、Electron、现有 CommonJS 测试脚本和 Inno Setup 打包流程。

**Spec:** `docs/superpowers/specs/2026-11-07-ai-customer-governance-design.md`

## Global Constraints

- 不改变现有客户、跟进、任务和 WS 消息的业务格式；新增治理字段保持向后兼容。
- AI 自动删除只允许软删除；物理删除必须通过一次性确认令牌二次确认。
- 已有非空人工字段不被 AI 覆盖；空字段才允许按置信度补齐。
- 不使用 WS 登录账号作为客户唯一身份。
- 所有治理写操作创建快照并写入审计；事务失败必须回滚。
- 不保存密码、Cookie、二维码或秘密 Token。

## Review Focus

- 同一 WS 登录账号下的不同联系人不能合并：由 Task 2 和 Task 3 的匹配回归测试覆盖。
- 已有人工字段不能被 AI 覆盖：由 Task 2 的字段合并测试覆盖。
- AI 识别来源、年龄、职业和姓名时要写入证据且不重复：由 Task 2 的证据测试覆盖。
- 软删除、恢复、永久删除令牌重复使用必须安全失败：由 Task 4 的 API 测试覆盖。
- AI 同步失败时客户、跟进、任务和审计不能部分写入：由 Task 3 的事务回滚测试覆盖。

### Task 1: 迁移与治理核心接口

**Files:**
- Create: `resources/app/migrations/010-ai-customer-governance.sql`
- Create: `resources/app/modules/customer-governance-core.js`
- Test: `tests/customer-governance-core.test.cjs`

**Interfaces:**
- Consumes: `ws-crm-sync-core.js` 的客户匹配和文本规范化能力。
- Produces: `normalizeAiProfile`, `mergeAiProfileSafely`, `shouldAutoSoftDelete`, `buildGovernanceAction`, `fieldEvidenceRows`。

- [ ] **Step 1: 写失败测试**：覆盖 AI 结果规范化、非空字段保护、空字段补全、冲突记录、证据去重和自动软删除阈值。
- [ ] **Step 2: 运行 `node tests/customer-governance-core.test.cjs` 确认因模块和接口不存在而失败。**
- [ ] **Step 3: 实现治理核心模块**：定义允许的档案字段、字段来源、置信度和冲突状态，返回纯数据结构，不直接访问数据库。
- [ ] **Step 4: 添加迁移文件**：创建字段证据、治理审计和删除确认表及索引。
- [ ] **Step 5: 运行核心测试确认通过。**
- [ ] **Step 6: 提交 `feat: add customer governance core and migration`。**

### Task 2: 接入 AI 客户档案自动同步

**Files:**
- Modify: `resources/app/modules/ws-crm-sync-core.js`
- Modify: `resources/app/server.mjs`（迁移版本和 `/api/ws/crm-sync`）
- Test: `tests/ws-crm-sync-core.test.cjs`
- Test: `tests/ws-workbench-api.test.cjs`

**Interfaces:**
- Consumes: Task 1 的治理核心函数。
- Produces: `/api/ws/crm-sync` 返回 `updatedFields`、`conflicts`、`softDeleted`、`followup`、`task` 和 `revision`。

- [ ] **Step 1: 写失败测试**：AI 返回 `contact/profile` 时应自动补齐来源、年龄、职业、姓名；重复分析不得新增客户；已有字段保持原值。
- [ ] **Step 2: 运行相关测试确认失败。**
- [ ] **Step 3: 扩展 `deriveCustomerProfile` 和 `mergeCustomerProfileSafely`**：支持 `origin`、`age`、`occupation`、`aiProfile` 和证据字段。
- [ ] **Step 4: 改造 `/api/ws/crm-sync`**：在单事务中创建/更新客户、证据、审计、跟进、任务和 WS 会话关联；调用 `shouldAutoSoftDelete` 时只设置软删除。
- [ ] **Step 5: 运行 WS 同步测试和全量测试确认通过。**
- [ ] **Step 6: 提交 `feat: sync AI profiles into customer governance`。**

### Task 3: 数据治理删除、恢复与审计 API

**Files:**
- Modify: `resources/app/server.mjs`
- Create: `tests/customer-governance-api.test.cjs`
- Modify: `resources/app/index.html` 或现有数据中心页面入口
- Modify: `resources/app/app.js` 或现有数据治理 UI 模块

**Interfaces:**
- Consumes: Task 1 的治理表和审计载荷。
- Produces: `POST /api/data-governance/customers/:id/soft-delete`, `POST /restore`, `POST /purge-request`, `POST /purge-confirm`, `POST /batch-soft-delete`, `GET /audit`, `GET /customers/:id/profile`。

- [ ] **Step 1: 写失败 API 测试**：软删除、恢复、批量限制、审计读取、删除令牌一次性使用和版本冲突。
- [ ] **Step 2: 运行 API 测试确认失败。**
- [ ] **Step 3: 实现接口**：默认快照、事务写入、关联记录保护、令牌哈希存储和重复令牌拒绝。
- [ ] **Step 4: 增加数据治理页面入口**：展示自动治理记录、冲突字段、回收站恢复和永久删除确认，不改变原有客户页面。
- [ ] **Step 5: 运行 API 和 UI 静态回归测试。**
- [ ] **Step 6: 提交 `feat: add customer governance APIs and audit view`。**

### Task 4: 配置、文档和回归测试

**Files:**
- Modify: `resources/app/README.md`
- Create: `docs/customer-governance-usage.md`
- Modify: `tests/project-audit-regression.test.cjs`
- Modify: `resources/app/package.json`, `zhike-setup.iss`

- [ ] **Step 1: 写失败版本和路由审计断言。**
- [ ] **Step 2: 增加使用说明、字段规则、删除恢复和回滚说明。**
- [ ] **Step 3: 版本号递增，记录更新日志。**
- [ ] **Step 4: 运行 `node scripts/run-tests.cjs all`，确认全量通过。**
- [ ] **Step 5: 构建安装包，执行安装器完整性、覆盖升级和用户数据保留检查。**
- [ ] **Step 6: 提交 `docs: document AI customer governance and release`。**

## Verification Commands

- `node tests/customer-governance-core.test.cjs`
- `node tests/customer-governance-api.test.cjs`
- `node tests/ws-crm-sync-core.test.cjs`
- `node tests/ws-workbench-api.test.cjs`
- `node scripts/run-tests.cjs all`
- `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/build-installer.ps1`
