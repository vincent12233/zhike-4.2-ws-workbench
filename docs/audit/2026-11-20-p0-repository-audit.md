# 知客 6.1 A+B｜P0 仓库审计（2026-11-20）

审计对象：`feature/zhike61-ws-completion`，基线提交 `3e8b74f`（origin/main 合并点）。
本文件只记录在当前真实源码中核实过的结论，每条都给出文件与行号。历史上游文档中的通过数字没有被当作本轮证据。

## 1. 环境事实

| 项 | 状态 | 说明 |
|---|---|---|
| Git | 本机原本未安装 | 已由 winget 安装 Git for Windows 2.56.0.4 至 `C:\Program Files\Git\cmd`，不在 PATH |
| 权威仓库 | `zhike61-repo/zhike-4.2-ws-workbench` | 原桌面目录是 ZIP 解压副本（918 文件），经规范化行尾 MD5 对比为 origin/main 的完全子集，无独有修改 |
| Node.js | v26.13.1（系统） | 仓库要求的随附 `resources/app/node.exe` 被 gitignore，源码树中不存在 |
| .NET SDK | 本机原本无 SDK（仅运行时 8/9/10） | 已按 CONTRIBUTING 约定准备 `.tools/dotnet10`（10.0.404，gitignore） |
| Inno Setup | `iscc` 不在 PATH | 安装器构建待核实 |
| GitHub 凭据 | 无 | 未配置 user.name/user.email，无 credential helper，无 `GITHUB_TOKEN`，未安装 `gh` |

## 2. 测试基线修复

`scripts/run-tests.cjs` 原先把 `ZHIKE_TEST_NODE` 硬编码为 `resources/app/node.exe`。该文件被 gitignore、只存在于打包产物，因此从源码树运行套件时 48 个测试文件的子进程 sidecar 必然启动失败。

修复：优先使用随附 `node.exe`，不存在时回退到执行本 harness 的 Node 可执行文件。

效果（`node scripts/run-tests.cjs ws`）：**178 项检查从 143 通过 / 35 失败提升到 172 通过 / 6 失败**。

## 3. 剩余 6 项失败的定性

| 测试 | 性质 | 证据 |
|---|---|---|
| WS native account registration | 缺 .NET SDK | spawnSync `.tools/dotnet10/dotnet.exe` ENOENT |
| WS process runtime coordinator scheduling | 缺 .NET SDK | 同上 |
| WS durable queue Web JSON and API roundtrip | 缺 .NET SDK | 同上 |
| RD02 actual Native authenticated-profile boundary | 缺 .NET SDK | `No .NET SDKs were found` |
| WS live refresh event contract | 过期断言，非代码回归 | 见下 |
| Stage 5.5C-1A production native send qualification | 过期锚点 + 缺 SDK | 见下 |

**WS live refresh event contract**：断言固定匹配字面量 `if (state.backgroundActive && payload.status === '已连接')`。源码在 `1b702e0`（恢复独立扫码采集）把该守卫改为 `if (state.backgroundActive && collectionReady())`，而断言关心的 `refreshCollectionSummary(...)` 调用仍然存在（`modules/ws-workbench.js:5853`、`:5861`）。契约语义未变，只是周围条件文本变了。已按真实守卫更新断言，单项复跑通过。

**Stage 5.5C-1A production native send qualification**：该测试用方法签名字符串切片 `LegacyUiHostPage.xaml.cs` 来编译真实生产处理器。两个结束锚点在源码演进后失配：`ConfigureVipGroupsAsync` 增加了 `async`（`:1888`），`OnWsWebMessageReceived` 变为 `async void`（`:2521`）。真实方法都在，只是签名文本变了。已更新锚点。

结论：这 6 项没有一项是功能回归。4 项是工具链缺失，2 项是测试债。

## 4. 生产与 Mock 边界（重点核实）

隔离开关在 `server.mjs` 顶部集中定义，需要两个环境变量同时命中才启用 Mock 写入：

- `groupManagerIsolationMode` = `ZHIKE_GROUP_MANAGER_MODE === 'isolated'`（`:55`）
- `stage3MockMode` = 上式 **且** `ZHIKE_STAGE3_MOCK === '1'`（`:60`）
- `stage4MockMode` / `stage4AiEnabled` 同理需要 `ZHIKE_AI_PIPELINE_MODE` + `ZHIKE_STAGE4_MOCK`（+ fencing）（`:62-64`）

生产侧行为（`stage3GroupManagerGuard`，`:911-925`）：

- 非 GET 一律 405 `GROUP_MANAGER_WRITE_DISABLED`
- GET 只放行 `groupManagerReadRoutes` 白名单（`:910`），其余 404 `GROUP_MANAGER_ROUTE_UNAVAILABLE`
- 非 Mock 模式下请求的群组必须已在本机 `ws_group_catalog` 中存在，否则 404（`:2933`）
- 成员查询 `allowMock: stage3MockMode`（`:3004`、`:3171`）

`/api/ws/group-manager/members` 的 POST（含 `applyMemberEvent`，`:3007-3019`）确实只在 `stage3MockMode` 下可达 —— 但它**不是**生产建档的唯一链路，见下节。

## 5. 生产自动建档链路：已实现，未真机验收

`server.mjs:1556-1582` 是真实生产消费者，不在 Mock 门后：

```
确认进群事件（isConfirmedJoinEvent）
  且 identity 置信度 >= 0.6
  且 resolveMembershipIdentity 判为 unmatched
        ↓
wsGroupMonitorAutoCustomer(...)
        ↓
检查回收站复用 / 身份冲突（wsGroupMonitorDeletedIdentityConflict）
        ↓
saveSnapshot('WS 群组新成员自动登记')
        ↓
写入 state.customers，autoRegistered = true
        ↓
applyMembershipProjection + wsPersistCustomerGroupMembershipLedger
        ↓
事件行写入 ws_group_membership_events（含 evidence_hash、idempotency_key）
```

保护措施已具备：幂等键去重（`:1531-1537`）、同身份重放判重（`:1551-1555`）、待审核事件不进主档（`:1557-1559` 注释 + `isConfirmedJoinEvent`）、删除身份冲突隔离（`:1564`）、快照先行（`:1571-1574`）。

因此“群成员自动建档只在 Mock 中存在”这一历史结论**不成立**。真实缺口是：该链路尚未在真实 WhatsApp 上验收（S3 仍 Blocked），且缺少下一节的排除前置。

## 6. 身份规范化：生产级

`modules/ws-group-monitor-core.js:11-43`：

- `normalizePhone` 剥离 `+`、`00` 前缀，并对印度号段做 `^91\d{10}$` → 去 `91` 处理（`:16`）
- `s.whatsapp.net` / `c.us` 域取 `:` 前主号段，校验 8–15 位（`:32-35`）
- `@lid` 等 business-scoped id 归为 `opaque`，**不**当作电话（`:27`）—— 与验收矩阵 W07“@lid 号码未提供不标确认唯一”一致
- 群组 `@g.us` 单独成类（`:37`）

`eventIdempotencyKey`（`:51-59`）以 账号|群|成员|类型|源事件|事件时间 组合稳定哈希，跨采集端重放可判重。

## 7. 通讯录排除系统：未实现（P3 核心缺口）

需求把 WS 通讯录定义为“排除指定联系人，避免群成员采集时被误建档”，并要求排除**先于**自动建档。核实结果：

- 全仓 `resources/app` 搜索 `exclusion|排除名单|blocklist|denylist|ws_contacts|address_book` 无命中
- 迁移目录 004–025 无通讯录/排除相关表（`migrations/manifest.json` 22 项）
- `modules/ws-business-pages.js` 的 `contacts` 视图（`:42-121`）是本机已同步联系人的**只读展示**，`/api/ws/workspace/contacts`，没有排除状态字段
- `server.mjs` 的 `phoneRegistry`（`:655`、`:708-711`）是手机号登记模块，语义为登记而非排除，且有 100,000 条上限
- 生产建档路径 `:1560` **没有**任何排除前置检查

已有的相邻但不同的能力：`ws-workbench.js` 的 `isExcludedGroupConversation` / `ordinaryGroupExclusionMessage`（`:964`、`:2084`）与 `smart-import.js:182-229` 的 `skipReason:'group-excluded'` 排除的是**群组会话采集**，不是**按联系人身份排除建档**。二者不能混用。

## 8. 功能状态矩阵（P0 结论）

| 能力 | 状态 | 证据 |
|---|---|---|
| 普通 WS 前台聊天（扫码/列表/收发/草稿/切号） | IMPLEMENTED_UNVERIFIED | `modules/ws-workbench.js` 5600+ 行真实实现；无真机验收 |
| 独立后台采集会话（独立扫码、不复制 profile） | IMPLEMENTED_UNVERIFIED | `docs/release/independent-collector-followup.md`；`tests/ws-independent-collector-runtime.test.cjs` 21KB 通过 |
| 采集隔离（不干扰前台） | IMPLEMENTED_UNVERIFIED | `tests/ws-background-isolation.test.cjs`；RD02 19/19 通过 |
| AI 自动分析消费生产聊天 | PARTIALLY_IMPLEMENTED | AI pipeline 生产 Worker 保持关闭（`stage4AiEnabled` 需三重隔离开关）；手动 AI 入口可用 |
| CRM 自动补齐 | PARTIALLY_IMPLEMENTED | 有 `ai-crm-suggestion-core.js` + `ws-crm-sync-core.js` 与人工审核/信任边界；自动写入受治理约束 |
| 自动跟进提醒 | IMPLEMENTED_UNVERIFIED | `migrations/009-ws-resume-alerts.sql`、`ws_followup_alerts`；`tests/ws-followup-chain.test.cjs` |
| 专用 WS 群成员采集 | IMPLEMENTED_UNVERIFIED | `ws_group_catalog` / `ws_group_members` / `customer_group_memberships` 真实落库 |
| 群成员自动建档（生产） | IMPLEMENTED_UNVERIFIED | `server.mjs:1556-1582`，非 Mock 门后 |
| **WS 通讯录排除名单** | **NOT_IMPLEMENTED** | 见第 7 节 |
| 自动进退群监测 | IMPLEMENTED_UNVERIFIED | `migrations/015-ws-group-monitor.sql` 四表；ingest 链路真实 |
| 群发中心 | PARTIALLY_IMPLEMENTED | `BroadcastWsTextAsync`（`LegacyUiHostPage.xaml.cs:1752`）、`ws_send_audit`；多群真实群发未验收 |
| 群组原生 @ | BLOCKED | 未见原生 mention 实现；需真机验证平台能力 |
| 指定消息逐成员已读 | IMPLEMENTED_UNVERIFIED | `ws-customer-reading-query.cjs`、`ws_group_read_evidence`；生产只暴露本地观测 GET（`:2938-2972`） |
| 一键开群/关群 | NOT_IMPLEMENTED | 未见 `announce`/`restricted` 权限设置调用 |
| Windows 安装器 | IMPLEMENTED_UNVERIFIED | `zhike-desktop-setup.iss`、GitHub Actions；本机 `iscc` 缺失 |

测试证据等级：以上 Node 层结论均为 UNIT_TESTED / INTEGRATION_TESTED（合成账号 + 临时 SQLite + 平台替身）。**无一项达到 WINDOWS_TESTED 或 WHATSAPP_VERIFIED**，与 S3 Blocked 一致。

## 9. 真实阻断清单

1. **GitHub 推送凭据缺失** —— 无 credential helper / token / gh CLI。本地提交可做，推送需用户授权。
2. **Inno Setup 未安装** —— 安装器构建与 Windows 打包验收受阻。
3. **真实 WhatsApp 验收不可自动化** —— 需用户手机扫码与真机群组；S3 维持 Blocked，不得用夹具冒充。
4. **付费 AI 自动处理未授权** —— 生产 Worker 保持关闭，不得未经确认为开启自动消费者。
5. **原生 @ 与开群/关群的平台能力** —— 必须真机验证后才能定状态，不得伪造。

## 10. 下一步优先级

- **P1**：普通 WS 前台聊天与后台采集稳定性（含 WebView2 退出/残留进程）
- **P3 可并行**：通讯录排除规则引擎 —— 纯本地、可完整单元/集成测试、不触碰生产 Guard，且是当前最大功能缺口
- 排除引擎必须作为生产建档路径（`server.mjs:1560`）的统一前置，而不是只挂在 Mock 接口
