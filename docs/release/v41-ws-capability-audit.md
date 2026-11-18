# 知客 6.1 A+B · WS 能力与数据审计

审计基线为 `eb94848`，审计始于 2026-11-17，隔离修复复测于 2026-11-18。覆盖 Agent 05–09 的群组与成员、身份关联、指定消息、阅读报表及排除规则，以及 M01 首页数据口径。S3 原生验收和生产发布继续按主线门禁处理。本文的“已验证”指列明的本地实现和测试范围。真实成员同步、客户级阅读和发送在本文各自列明状态。

## 实际实现与缺口

| 功能 | 状态 | 已有入口与限制 |
| --- | --- | --- |
| WS04 群组目录和归属 | 已验证（隔离现有 API；生产有本地读取代码） | 017 的 `ws_group_catalog` 按账号和群 JID 唯一，含 `channel_id`、`participant_count`、`discovery_source`、状态及最近发现时间。现有只读 `GET /api/ws/accounts/:accountId/groups` 可供 `ws-workbench.js` 的 `loadGroupMonitor` / `renderGroupDirectory` 复用。目录人数是单群元数据，可能缺失，也没有逐人可去重的证据。详见 [017](../../resources/app/migrations/017-ws-group-catalog.sql)、[目录端点](../../resources/app/server.mjs#L2668)、[WS 工作台](../../resources/app/modules/ws-workbench.js#L1567)。 |
| WS05 成员台账、入退事件与历史审核 | 部分 | 022 的 `customer_group_memberships` 是持久关系投影。015 的 `ws_group_membership_events` 是已存事件。现有历史查询 `GET /api/ws/group-membership-events`、`GET /api/ws/group-monitors/:profileId/events` 和人工审核 `POST /api/ws/group-monitors/:profileId/events/:eventId/resolve` 可复用。WS05 成员区从隔离的 `GET /api/ws/group-manager/members` 读取，普通桌面遇到 `GROUP_MANAGER_DISABLED` 时展示旧历史。缺生产只读分页台账、可信完整成员基线、区分最近加入/离开/核实时间的可靠投影。详见 [015](../../resources/app/migrations/015-ws-group-monitor.sql)、[022](../../resources/app/migrations/022-ws-group-identity.sql)、[WS05 加载与渲染](../../resources/app/modules/ws-workbench.js#L3199)。 |
| WS 后台成员同步 | **BLOCKED** | RD02 禁止依赖复制认证状态的后台采集、群组监测及前台采集回退。前台聊天和用户手动可见导入有各自的现有边界。监测配置、历史、解析与 ingest 代码的存在不能证明当前获授权采集。详见 [RD02 决定](decisions/RD02-authenticated-profile-boundary.md)、[C# 能力状态](../../desktop/src/Zhike.Desktop/Services/WsCollectionCapability.cs)、[JS 能力状态](../../resources/app/modules/ws-workbench.js#L112)。 |
| M01 在群人数、退群人数 | 未实现 | M01 的 `prepareHomeMetrics`、`getMetricsProjection`、`renderHome` 生成现有全局 CRM 指标。“已进群客户”“今日进群”“今日退群”来自 CRM 当前字段或客户状态历史。WS01 的账号、会话及群数来自当前加载记录。需要独立的 WS 成员范围聚合投影。详见 [M01](../../resources/app/app.js#L519)、[WS01](../../resources/app/modules/ws-workbench.js#L3330)。 |
| CRM 身份、关联和客户档案 | 部分 | 019 `customers`、021 `crm_identity_conflicts` 与在册规范号唯一索引、022 关系 ledger 可复用。现有 `resolveMembershipIdentity` 支持已有 participant/external ID、规范号码、账号和群组范围的人工映射，处理冲突、删除及未匹配，状态投影区分 `left` 与 `removed`。存在历史兼容字段 `settings.wsGroupMemberMappings` / `settings.groupMembershipMappings`。M05 的 `groupMembershipRows` 在客户档案展示兼容关系，WS09 已有 CRM 列表和主档入口。缺通用供应商稳定 ID 绑定、映射版本审计和逐消息阅读区。详见 [身份逻辑](../../resources/app/modules/ws-group-monitor-core.js#L83)、[导入处理](../../resources/app/server.mjs#L1438)、[M05](../../resources/app/app.js#L687)、[WS09](../../resources/app/modules/ws-workbench.js#L3310)。 |
| WS03 指定自己发送的群消息 | 未实现 | 023 `ws_group_messages` 和隔离 `GET/POST /api/ws/group-manager/messages` 已按账号、群、消息 ID 去重，存发送者、发送时间、类型、来源、内容 hash 及处理状态。缺用户明确指定、可信自发证据、受控摘要、独立统计创建及状态。当前 WS03 前台 WebView 使用默认菜单；工作台本地消息显示无“加入阅读统计”动作。现有一键可见导入会在页面无消息 ID 时生成备用 hash，方向和日期也有未核实值。这些值应保留当前用途，并显式排除于真实指定消息登记。详见 [隔离消息端点](../../resources/app/server.mjs#L2999)、[前台菜单](../../desktop/src/Zhike.Desktop/Views/LegacyUiHostPage.xaml.cs#L457)、[可见消息 ID 与时间](../../desktop/src/Zhike.Desktop/Views/LegacyUiHostPage.xaml.cs#L2378)。 |
| 回执模型和真实客户级阅读 | 部分（隔离）；真实来源 **BLOCKED** | 023 `ws_group_read_evidence` 和 `GET/POST /api/ws/group-manager/read-evidence` 按账号、群、消息、成员持久化当前最强状态，支持 `unknown/delivered/read`、同证据去重和状态不回退。当前 mock 只检查 read 有任意非空证据字段，允许空成员、孤立消息 ID 和覆盖同等级旧证据；来源、引用和时间语义不够严格。缺生产可信适配器、非空成员验证、对真实指定消息的归属、原始证据去重历史和可审计核实时间。详见 [023](../../resources/app/migrations/023-ws-group-manager.sql)、[核心状态规则](../../resources/app/modules/ws-group-manager-core.js#L193)、[隔离回执端点](../../resources/app/server.mjs#L3024)。 |
| 每日消息表、按消息逐客户、按客户逐消息、历史快照 | 未实现 | WS01–WS12 中没有该视图或查询服务。可复用工作台页面作用域、`ws-business-pages.js` 的筛选/表格层和 WS09 的客户跳转。019 `state_snapshots` 及 `/api/snapshots` 是 CRM 恢复介质；023 同步运行、错误和审计记录无法复现特定消息的历史成员集合、排除集及读状态。详见 [WS 页面入口](../../resources/app/modules/ws-workbench.js#L3322)、[业务表格](../../resources/app/modules/ws-business-pages.js)、[恢复快照](../../resources/app/server.mjs#L5338)。 |
| WS07 通讯录与阅读排除规则 | 通讯录部分；排除规则未实现 | `GET /api/ws/workspace/contacts` 由 `ws-workspace-query.cjs` 从直接会话和 CRM 联系投影提供账号级搜索、号码和重复状态。没有通讯录分类、成员集、排除模板或规则版本。既有普通群采集排除及 VIP 群绑定决定采集范围，统计排除应独立应用于特定消息的成员分母。详见 [通讯录查询](../../resources/app/modules/ws-workspace-query.cjs#L74)、[账号端点](../../resources/app/server.mjs#L2601)。 |
| 阅读报表、Excel/CSV、敏感数据审计 | 未实现 | CRM `exportCsvRows`、群组汇总和状态历史 CSV 可复用格式。WS `/api/ws/export` / `/api/ws/export-jobs` 已实现 JSON 档案流并包含群组及进退事件，清单不含阅读任务、回执及统计快照。现有本地 API token、账号校验和审计可作为基础，阅读权限及导出审计需随功能建立。详见 [CRM 导出](../../resources/app/app.js#L1221)、[WS 导出清单](../../resources/app/server.mjs#L465)、[导出端点](../../resources/app/server.mjs#L4907)。 |
| 普通前台发送、原生 @all、隐藏提及 | 普通发送代码为部分；增强能力 **BLOCKED** | 现有 C# `SendWsTextAsync` / `SendWsMediaAsync` 检查显式确认、有效前台账号和目标会话，只报告本地发送尝试。现有送出路径没有提及元数据接口或验证接收端显示的证据。原生 @all 的官方文档与产品边界见下文。详见 [发送保护](../../desktop/src/Zhike.Desktop/Views/LegacyUiHostPage.xaml.cs#L1213)。 |

`/api/ws/group-manager/*` 含 `groups`、`members`、`sync`、`errors`、`messages`、`read-evidence`、`state`、`audit`。只有双隔离标记同时命中才开放，普通运行返回 404。桌面仅隔离构建在校验数据根后设置两标记。023 成员默认来源为 mock，隔离成员写入会将 `stage3-isolated-mock` 来源写入 022 的 JSON，不能将其计入业务 KPI。详见 [服务端门禁](../../resources/app/server.mjs#L41)、[隔离构建数据根校验](../../desktop/src/Zhike.Desktop/Services/LocalServiceManager.cs#L231)。

## 首页成员人数口径与数据质量

- **当前在群**从 022 的账号和群组范围的关系表读取最后已确认状态“在群”。每个已核实身份在作用域内计一人，每个账号×群组×成员关系单列计数。一个人在数个群可留下数个关系。可信成员台账应容纳已确认在群但 CRM 尚未匹配的成员。
- **周期退群**以 015 的事件发生时间 `event_at` 在业务时区 `[from,to)` 内筛选确认离开的稳定成员并去重。建议“退群人数”先按 `left` 定义，“被移除”单列，合并时用明确的“离群”口径。重复离开在周期内可形成多条事件，同一成员计一人。后来重新加入可同时符合当前在群和周期曾退群。来源未验明、无可靠发生时间、审核中或仅是申请的事件应显示覆盖缺口。事件 `applied` 代表现有 CRM 投影流程状态，生产统计需要将来源真实性、成员识别与 CRM 关联独立判断。
- **稳定标识**使用 `(provider, identityNamespace, opaqueMemberId)`。历史 WebView 只合并同账号允许范围内的已核实等价 ID。Cloud BSUID 保留完整原串和业务组合命名空间。同一已授权业务组合下的多个号码可按相同 BSUID 去重，跨组合仅有可信的父 BSUID 或可追溯桥接才合并。标准号码可作为经核实的辅助映射，保留原号与区号和冲突治理。昵称、显示名、未经核实的号码或单独 CRM ID 不能作为唯一来源。基线的 legacy `normalizeMemberIdentity` 会从带字母的 BSUID 提取数字并可能归一成电话，也会执行印度号码兼容转换，因此供未来 Cloud 使用的 ID 需要独立类型化与命名空间。未解冲突以单独计数标注，不能输出未经证实的全局精确人数。详见 [归一化代码](../../resources/app/modules/ws-group-monitor-core.js#L9)、[Meta BSUID 范围](https://developers.facebook.com/documentation/business-messaging/whatsapp/business-scoped-user-ids/#business-scoped-user-id)。
- **数据覆盖**以每个账号/群组最近可信完整成员基线和后续事件连续性计算。目标/心跳、app 取数时间、最近任何事件及目录人数各有独立含义。部分覆盖显示“已核实范围”及最后核实时间，尚无可信证据显示“— / 数据不可用”。只有覆盖可信且集合为空时显示 0。服务端内完成范围聚合，避免从历史事件端点的 20,000 行上限、CRM 客户 JSON 或 WS01 目录推总数。详见 [历史查询实现](../../resources/app/server.mjs#L1187)。
- **基线一致性缺口**。正常 ingest 在同一事务写关系台账和事件。基线的人工关联端点仅更新 CRM JSON 与事件，漏写 022 持久关系。修正与验证见下文。未匹配成员会落“未关联客户”，当前模型无法独立保留该关系的真实在群/退群状态。旧投影从 CRM JSON 取既有关系，人工锁和待审核结果也要评估是否可覆盖最后确认状态。第 015 批处理在缺少或无效的 `event_at` 时以处理时间补齐，不能将所有旧时间视为真实发生时点。此外 CRM 永久删除可删除按 customer_id 匹配的关联事件，账号/监控目标外键也会级联删除历史。进入生产统计前需按保留策略核对这些覆盖缺口。详见 [投影状态](../../resources/app/modules/ws-group-monitor-core.js#L167)、[普通写入](../../resources/app/server.mjs#L1438)、[人工关联](../../resources/app/server.mjs#L2815)、[永久删除](../../resources/app/server.mjs#L5309)。

## 最小服务接口与迁移评审

以下是接口评审草案。业务实现由主控在稳定性门禁后安排。

| 接口职责 | 优先复用与新增边界 |
| --- | --- |
| `getMembershipSummary(scope, period)` / `queryMemberships(scope, cursor)` | 汇聚 022 关系与 015 事件，范围含明确授权的账号、群和业务时区。返回取数状态、人数、关系数、事件数、未解析数、覆盖范围和 `lastVerifiedAt`，配相同口径明细。分层的最新关系状态和事件时间可补索引。查清旧事件和人工锁后，以事务重放可核实历史并报告跳过计数。 |
| `resolveMemberIdentity(typedIdentity, scope)` | 复用 021 CRM 冲突处理及已确认映射规则。返回匹配状态、依据、CRM ID、映射版本。身份绑定边明确账号与群组，规则需追溯到来源；同名不自动匹配。真实群成员状态独立于是否绑定 CRM；评审以扩展 022 权威投影的最少字段或来源链接实现，保留旧中文状态兼容。 |
| `trackOwnGroupMessage(scope, providerMessageId)` | 复用 023 已有真实消息唯一索引和消息元数据位置。优先评审添加显式跟踪元数据（来源、自发、摘要、时间、任务状态）及历史版本关联，或只建以既有消息实例为外键的任务边。历史群消息不会自动进入统计任务。要求已验证消息归属和账号/群/消息唯一，重复请求返回原任务。现有 core 只接受 `@g.us` 群号，Cloud Groups API group ID 是另一命名空间的 opaque ID；先设计供应商映射及保存边界。 |
| `applyVerifiedReceiptBatch(adapterContext, attrs)` | 复用 023 作为当前最强回执的快速读投影。权威接收边界确认发送账号、群、消息、非空参与者、来源和事件时点，重复和乱序安全。按需补追加式原证据（或现有审计实体的结构化新用途）与 `receiptAt`、`observedAt`、`verifiedAt`。确认未读仅接受有明确时间与覆盖证明的授权证据；Cloud 的送达和缺读不改变业务未知状态。只有汇总能力则显示“仅汇总可用”，缺成员或排除基线时读率为“不可计算”。 |
| `queryReadingReport(filters, cursor)` / `getMessageReaders` / `getCustomerReadingHistory` | 消息×成员保留独立证据；既有 CRM ID 负责授权的按客户聚合。以同一数据服务供应按消息列表、逐人和跨群客户视图、带业务时区的分页历史及导出。增加不可变统计快照与成员/排除版本关联，保留核实来源、时间、完整度、口径与成员级可复现性。后续刷新追加版本。有效人数为 0 或分母覆盖/去重不可靠时比率为空。 |
| `resolveExclusions(scope, ruleVersion, rosterVersion)` / `exportReadingReport(filters, format)` | 复用现有只读通讯录查询与导出传输。补可重放的规则版本和成员/号码/通讯录匹配关联，合并重叠命中后每位稳定成员只排除一次。全局默认和消息专属采用明确版本。输入和导出号码保留为文本，格式层防 CSV 公式解释，输出对齐同一筛选及授权的数据源、核实时间和快照。查询与导出审计记录访问范围、快照版本及结果，不写完整号码。 |

实际迁移上限为 025，登记于 [manifest](../../resources/app/migrations/manifest.json)。025 只新增群组事件及相关 AI 的 `correlation_id`、索引和旧记录空值兼容。本轮逐一核对 015、017、019、021、022、023、025，没有现成的阅读任务元数据、回执原历史、消息成员范围快照或排除规则实体。新增迁移通过现有 [runner](../../resources/app/migration-runner.cjs) 追加下一版本并更新 manifest，主控串行决定迁移编号。评审需要同时检查空库建库、025 已有数据升级和备份恢复，确保未核实旧记录不被降维回填成业务事实。现有 [发送审计](../../resources/app/migrations/016-ws-send-audit.sql) 与 [媒体导出](../../resources/app/migrations/018-ws-export-media.sql) 可供连接现有功能；两者提供本地发送/导出日志。

## WhatsApp 与 Meta 官方证据

- **Cloud API 群**。Meta 文档现称 Groups API 面向具备 OBA 的业务，号码已接 Cloud API，应用获 `whatsapp_business_messaging` 且完成 Webhook 订阅。文档流程创建 API 群并经邀请加入，当前上限 8 名参与者、每群 1 个 Cloud API 业务。文档提供群详情参与者字段和加入、退群、被移除的事件。当前知客 WebView 储存的普通群 JID 与 API 群 ID 之间没有已验证的授权映射。详见 [Groups API](https://developers.facebook.com/documentation/business-messaging/whatsapp/groups/)、[资格和订阅](https://developers.facebook.com/documentation/business-messaging/whatsapp/groups/get-started)、[群详情](https://developers.facebook.com/documentation/business-messaging/whatsapp/groups/reference#get-group-info)。
- **逐成员回执**。官方 Groups Webhooks 以 `statuses[].id` 标识消息，`recipient_id` 标识群，`recipient_participant_user_id` 标识 BSUID，另含状态与时间字段。号码可不提供。同一消息多个成员、同一成员多消息可分别聚合，独立 webhook 也可能出现，接收器需逐状态对象处理。示例字段称 `timestamp` 为触发时间，正式“阅读时间”列应在实测和接口口径确认后绑定；在此之前保留平台事件时间和本机核实时间。文档已证明授权路径存在，知客没有使用授权 WABA 或测试群完成实际回执验证。Cloud 文档亦未确认补取任意既存群消息的完整回执历史。详见 [Groups Webhook 回执参考](https://developers.facebook.com/documentation/business-messaging/whatsapp/groups/webhooks/#group-message-status-webhooks)、[Group messaging](https://developers.facebook.com/documentation/business-messaging/whatsapp/groups/groups-messaging#group-message-status-webhooks)。
- **前台原生 Message info**。WhatsApp 帮助中心描述 Web 客户端在自己发出的消息菜单中可打开详情查看送达、已读或播放，原群消息详情仍可含已离群成员。它是一条授权账号的人工核对路径。尚无证据证明应用层可以获得可依赖的结构化逐人读取能力，也无从已知普通群安全自动同步该信息。缺回执不提供确认未读证明。详见 [How to check read receipts](https://faq.whatsapp.com/665923838265756/?cms_platform=web&locale=en_US)。
- **原生 @all 与隐藏提及**。WhatsApp 帮助中心确认原生客户端可选择真正的 `@all`，处于逐步推出阶段。群人数 ≤32 时群成员可用，超过 32 时限管理员。原生指定成员的名字显示受联系人保存方式影响。已查看的 Cloud 群发送文档没有给出独立隐藏提及字段或接收端渲染承诺。ChatKnow 发送和接收效果、知客发送、成员通知、收件端不暴露姓名号码四点均未实测。保持相关增强入口禁用，需授权测试账号和群，发送端及接收端均核验。详见 [How to mention in a group](https://faq.whatsapp.com/521835819370205/?cms_platform=web&locale=en_US)、[Cloud 群发送协议](https://developers.facebook.com/documentation/business-messaging/whatsapp/groups/groups-messaging#send-group-message)。

## 已执行的隔离验证

使用主仓库只读的 bundled Node v24.22.1。新探针初次通过的 3 项直接加载现有 JS 核心与迁移器，涵盖相同消息 ID 在不同账号和群组的隔离、同群不同消息状态隔离、重复与回退防护、无证据 read 被拒绝、同名未匹配和映射冲突，以及实际迁移后关系、消息与回执唯一键。SQLite 使用内存库，运行目录只保存临时迁移锁。探针可直接以 `node --test tests/v41-ws-capability-audit.test.cjs` 复跑。详见 [隔离探针](../../tests/v41-ws-capability-audit.test.cjs)。

既有以下 5 项在同次运行全部通过：

- `scripts/stage3/ws-group-manager.test.cjs`
- `scripts/stage3/ws-group-manager-migration.test.cjs`
- `tests/customer-group-membership.test.cjs`
- `tests/ws-group-monitor-core.test.cjs`
- `desktop/tests/WsGroupMonitorNativeContractTests.cjs`，此项是源码契约核验

带临时数据根和动态端口的 `scripts/stage3/ws-group-manager-api.test.cjs` 通过，验证普通运行 404 与隔离 API 的账号范围、去重和 CRM 边界。初次同组并行执行的 4 项旧固定端口测试在 sidecar readiness 阶段超时，初次组合结果 1/5。随后串行执行同 4 项，WS 完整导出通过，群目录、历史 ingest 和状态投影 3 项仍在 sidecar readiness 阶段超时，原测试忽略子进程 stderr，失败原因未归类。

两条隔离反例分别实跑。合成 ID US.1234567890123 被旧逻辑归为号码并命中同数字的 CRM 客户。临时 sidecar 的人工关联接口返回 applied，CRM JSON 返回“已退群”，同一 022 行仍为 customer_id 空、“未关联客户”、manual_locked=0。此反例由测试自行启动动态端口，仅操作其临时数据库。
最小安全修复提交 e7d62f6 保留 BSUID 与父 BSUID 的完整标识及字母大小写，禁止通过旧式数字归一化、无命名空间外部 ID 或号码回退自动关联该类成员。对该类成员，人工映射须精确匹配 ID、账号和群组。原历史号码、电话 JID、LID 及普通人工映射契约继续使用原规则。人工审核复用 022 写入函数，在原事务内用同一核实时点维护 CRM 投影、持久成员台账及事件状态。隔离测试在事件更新处注入一次 SQL 故障，验证三处全部回滚；移除故障后重试，验证“已退群”及人工锁两处一致。修复只影响后续处理，既存关系及历史事件未回填。

修复后在同一 bundled Node 中串行复跑，最终 12/12 通过。6 项新测试覆盖核心及内存迁移、号码和映射隔离，以及临时 SQLite 和动态端口人工审核。另 6 项为上述既有测试和隔离 group-manager API。服务端语法检查通过。前述固定端口失败保留为独立证据。
本轮未连接真实 WhatsApp、发送消息、加载任何真实账号 profile 或密钥，也未打开生产数据库。隔离证据支持本地结构和状态规则，S3 原生门禁及产品真实回执/提及继续保持 **BLOCKED**。
