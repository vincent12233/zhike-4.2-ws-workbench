# 知客 6.1 阶段 5 UI、业务联调与迁移验收实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 在生产入口保持 FROZEN 的前提下，完成 WS 十页工作台的真实状态交互、隔离多账号业务链路、迁移失败恢复演练和安全性能验收。

**Architecture:** 复用阶段 4 的 WS API、AI Pipeline、CRM 权威服务、Worker fencing 和现有 WebView，不重建聊天 WebView。新增的业务关联使用显式 correlation ID，数据库通过后续 025 迁移追加字段；所有联调均使用临时数据目录、Mock Transport、Mock AI 和隔离 Worker。

**Tech Stack:** Node.js test runner/scripts、SQLite migration runner、现有 WinUI 3/C# ApiClient、现有 WS 工作台模块与 CSS。

**Spec:** `C:\Users\酷酷\.codex\attachments\99a74f3c-3ea6-4fc2-88bd-d4feb027f538\已粘贴的文本.txt`

## Global Constraints

- 生产入口继续保持 `FROZEN`。
- 不连接真实 WhatsApp，不读取 Cookie/Token，不调用真实付费 AI。
- 不启动正式 Worker，不修改生产 SQLite，不进行新旧队列双写。
- 不覆盖阶段 0–4 已发布迁移；新增迁移必须接续版本 024。
- 普通聊天 AI 不自动创建未知客户；CRM 更新必须经过权威服务和版本校验。
- UI 不得展示固定样例冒充业务数据；未启用能力必须明确显示。

## Review Focus

- 多账号同名群组和相同成员：数据必须按 `account_id + group_jid` 隔离，同时允许 CRM 全局去重。
- 审核中/未确认成员：不得自动建档，必须保留事件和审计记录。
- 业务链路关联：群组事件、AI Job、证据、CRM 候选和审计必须携带同一个 correlation ID。
- 迁移中断与重复执行：必须可恢复、幂等，历史客户、群组和 AI 任务不能丢失。
- UI 禁用与异常状态：生产冻结、空数据、加载失败和取消必须使用真实状态呈现。

### Task 1: 阶段 5 基线与测试入口

**Files:**
- Create: `docs/superpowers/plans/2026-11-16-stage5-ui-business-acceptance.md`
- Modify: `scripts/run-tests.cjs`
- Test: `scripts/stage5/stage5-baseline.test.cjs`

- [ ] 写基线测试，验证 HEAD 为 `ad7749f` 或其后续阶段 5 提交、工作区初始无未提交修改、manifest 最高版本为 24。
- [ ] 运行基线测试，确认失败项只来自尚未建立的阶段 5 测试入口。
- [ ] 增加 `stage5` 模式和三批测试分组，不改变 `ws`、`all`、`installer` 既有入口。
- [ ] 运行基线与阶段 4 回归，确认阶段 4 仍为绿灯。

### Task 2: WS 十页 UI 状态与交互

**Files:**
- Modify: `resources/app/modules/ws-workbench.js`
- Modify: `resources/app/modules/ws-workbench.css`
- Test: `scripts/stage5/ws-workspace-pages.test.cjs`

- [ ] 写测试，断言十个页面均有独立导航项、页面标题、真实状态容器、空数据/错误状态和刷新入口，并确认导航不会重建 WebView。
- [ ] 为页面头部增加统一刷新、加载和错误区域，使用当前账号和现有 Service 状态。
- [ ] 为群组、成员、采集、AI、CRM、任务页补齐真实筛选/搜索或明确禁用状态；不要生成固定数据。
- [ ] 保留独立 WS 二级侧边栏、折叠状态、页面状态和聊天窗口 DOM。
- [ ] 运行 UI 批次专项测试并执行已有 WS UI 回归。

### Task 3: 隔离业务链路与多账号关联

**Files:**
- Create: `resources/app/migrations/025-stage5-correlation-id.sql`
- Modify: `resources/app/migrations/manifest.json`
- Modify: `resources/app/server.mjs`
- Test: `scripts/stage5/business-integration.test.cjs`

- [ ] 先写隔离 API 测试：两个账号写入同名群组、同名成员和消息，验证群组/成员/任务不串账号，CRM 仍按规范去重。
- [ ] 在测试中串联群组成员事件、AI Job、证据、CRM 候选、审核和审计，并断言全链路共用 correlation ID。
- [ ] 新增 025 迁移，为群组事件、AI Job、证据、CRM 候选和任务审计追加可空 correlation_id 与索引，保证旧数据可回读。
- [ ] 在真实隔离 API 写入和返回中传递 correlation ID；未知客户、审核中成员、人工锁定字段继续拒绝自动更新。
- [ ] 运行业务联调和 Stage 3/4 回归。

### Task 4: 数据库迁移、备份恢复与失败演练

**Files:**
- Create: `scripts/stage5/migration-drill.test.cjs`
- Create: `scripts/stage5/backup-restore-drill.test.cjs`
- Modify: `scripts/run-tests.cjs`

- [ ] 写迁移演练测试，构造空库、023 库、024 库、历史客户/群组/AI 任务库和中断状态库。
- [ ] 验证连续迁移、重复执行、事务失败回滚、断点恢复、schema 版本和历史记录保留。
- [ ] 验证备份完整性、恢复后数据计数/唯一键/人工字段一致，且不可逆迁移只声明备份恢复而非直接回滚。
- [ ] 运行数据库批次专项测试，确保全部数据目录位于临时目录。

### Task 5: Worker/IPC/fencing、性能与 UI 自动化验收

**Files:**
- Create: `scripts/stage5/worker-security-performance.test.cjs`
- Create: `scripts/stage5/ui-automation-contract.test.cjs`
- Modify: `resources/app/modules/ai-review-center-ui.js`

- [ ] 写测试验证所有阶段 2–4 flags 默认关闭、隔离启用不写生产配置、过期 Worker 不能提交、token/凭据不进日志。
- [ ] 使用合成账号、群组、消息、AI Job 和候选资料测量页面/查询/队列基线，报告实际耗时、吞吐和资源限制，不凭空宣称达标。
- [ ] 为十页导航、折叠、状态保持、刷新、缩放、主题和禁用按钮建立可执行契约；受 Windows 桌面限制的项目标记 Blocked。
- [ ] 运行安全与性能批次测试。

### Task 6: 全量验收、报告与提交

**Files:**
- Create: `docs/superpowers/reports/stage5-acceptance.md`
- Create: `docs/superpowers/reports/stage5-ui-review.md`
- Create: `docs/superpowers/reports/stage5-business-integration.md`
- Create: `docs/superpowers/reports/stage5-migration-drill.md`
- Create: `docs/superpowers/reports/stage5-performance.md`
- Create: `docs/superpowers/reports/stage5-tests.md`
- Create: `docs/superpowers/reports/stage5-rollback.md`

- [ ] 按 UI、业务、迁移/安全三个批次记录真实命令、计数、失败和修复。
- [ ] 运行 WS 回归、全量回归、WinUI Release x64/win-x64 编译和 `git diff --check`。
- [ ] 只在所有结果有证据时给出 Stage 5 Gate；真实 WS、真实 AI、正式 Worker、跨设备安装仍单独标记 NotTested。
- [ ] 提交阶段 5 代码和报告，确认工作区干净、生产入口 FROZEN。

## 2026-11-16 实际执行记录

- Task 1：已完成；基线 ad7749f，本轮新增 025 后基线回归检查最高 schema 为 25。实现提交 7667837。
- Task 2：代码与十页控制器测试已完成；原生 WinUI 十页视觉、DPI、主题、缩放仍 Blocked，不把 VM 测试替代桌面验收。
- Task 3：隔离链路已完成，实际 .NET Runtime/Supervisor/Named Pipe 与 Mock Provider 往返，CRM 审核更新、跨账号隔离及人工字段保护通过。
- Task 4：空库及 19/22/23/24 升级、中断、事务失败与备份恢复通过；旧 024 错误 checksum 元数据兼容保留 Blocked。
- Task 5：Worker/IPC/fencing、flags、122004 行合成查询测试通过；原生帧率与 Worker 业务吞吐 NotTested。
- Task 6：专项 9/9、WS 149/149、最终全量 248/248；WinUI Release x64/win-x64 编译 0 warnings / 0 errors；七份报告明确记录阻断项和删除被审批拒绝的三个诊断残留。

整体 Stage 5 Gate：Blocked。生产入口继续 FROZEN；未自动进入阶段 6。
