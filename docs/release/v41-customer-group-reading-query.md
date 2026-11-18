# V4.1 客户级群消息阅读查询

基线为 `c01c126`，本轮交付 025 兼容的本地只读查询、CSV 核心及 WS04 隔离观测界面。生产仍为 **FROZEN**，真实 WhatsApp 成员级回执和可重现的历史报表仍为 **BLOCKED**。正式入口、写入契约和迁移文件保持原样。 [查询模块](../../resources/app/modules/ws-customer-reading-query.cjs) · [隔离测试](../../tests/ws-customer-reading-query.test.cjs)

## 使用现有数据

- 输入须列明 1 至 25 个唯一的 `accountId`、`groupJid`、`messageId` 组合。查询受信任服务传入的 `authorize(scope, action)` 逐条核验，`query` 与 `export` 可授予不同权限。任一组合未获授权即拒绝整个请求。查询要求 023 中有该组合的消息记录，捕获记录本身没有权威自发标记或用户指定任务版本。接线时从服务器核验的任务范围生成组合，并由授权层限制访问群和 CRM 明细。 [023 迁移](../../resources/app/migrations/023-ws-group-manager.sql)
- 明细从 023 当前活跃或未知成员、022 当前在群关系与选中消息的成员证据形成观测集合，按消息与成员分别保留。群成员曾退出时，该消息的已有成员证据仍可纳入观测。号码形式只接受已有规范化规则支持的号码和电话 JID，LID 及 BSUID 保持身份类型分离。按账号、群及稳定成员身份读取 022，并关联 019 的在册 CRM ID。含未匹配、冲突、低可信、待审或 mock 来源的关系保持无关联。CRM 客户视图跨群以同一在册 ID 去重，每位客户的消息次数以完整消息组合计。同一消息下的两个成员身份可提供两个成员观测，但只产生一个客户消息计数。 [022 迁移](../../resources/app/migrations/022-ws-group-identity.sql) · [CRM 基表](../../resources/app/migrations/019-crm-base-schema.sql)
- 每条消息返回观察到的成员数、观测中的排除人数、有效人数、已关联人数、确认已读、未知及核实时点。明细区分当前成员记录与仅存在于消息证据中的记录，两类观测均无完整历史覆盖。消息参数可预览明确指定的成员排除，重叠成员只计算一次。该预览没有持久规则或版本。当前成员与零条证据可形成空观测，真实分母依然未知。读率字段提供经核实的分子，完整有效成员分母和读率均为空。 [查询模块](../../resources/app/modules/ws-customer-reading-query.cjs)
- 023 的送达、未知、缺失、身份未匹配或未独立核实的读标记均显示为 `unknown`。可选服务端 `verifyReadEvidence` 必须能核验具体账号、群、本人发送的消息、成员、当前 CRM 绑定和证据记录，且返回核实来源与核实时间。只有那时才能输出 `read`。源的事件时间与可确认的阅读时间需分别确认。缺失时间留空。确认未读数始终不可用。当前没有已接入的生产验证器，请求正文中的验证字段不能当作该能力。 [023 迁移](../../resources/app/migrations/023-ws-group-manager.sql) · [原能力审计](v41-ws-capability-audit.md)
- 支持按 CRM ID、姓名、规范号码及阅读状态筛选，客户汇总可分页。每次调用用 SQLite 保存点保持读取一致性。分页基于当前数据并按范围及稳定 ID 排序。跨请求多页和导出要重现同一数据版本，需后续持久快照。明细 CSV 采用相同筛选，包含读状态、来源与核实时间，保留号码文本并中和公式起始字符。原始证据引用和消息正文不进入返回值。当前上限为单次 10,000 条源记录、10,000 条有效明细、200 条分页及 16 MiB CSV，超限显式报错。 [查询模块](../../resources/app/modules/ws-customer-reading-query.cjs)

## 向前迁移与评审

| 增量 | 能力和约束 | 评审重点 |
| --- | --- | --- |
| 指定消息任务 | 用账号、群、可信平台消息 ID 唯一注册。绑定自发来源、业务时区、用户动作、状态、受控摘要。可关联已有 023 消息，旧记录默认未经核实。 | 身份、发送归属、历史入口及保留周期。 |
| 回执历史与平台身份 | 新增可追加回执证据与供应商身份映射。写入验证来源、原事件去重键、供应商命名空间、证据状态、可验证的事件时间和采集、核实时间。来源核验和投影更新保持原子。现有 023 保留当前态兼容。 | 合法来源与签名、重放、乱序、身份版本与号码缺失。仅在有明确覆盖证明时引入确认未读。 |
| 历史成员与排除版本 | 可信成员快照持久保存稳定成员集合、时间、来源与完备度。排除规则与模板独立版本化，作用域明确到账号和群或消息。消息统计派生自明确成员、身份映射及排除版本。 | 旧群没有可信基线时保留部分或不可用。排除只影响统计，原 CRM 关系、成员和回执保存。 |
| 报表快照、访问与导出 | 追加不可变快照，存算法版本、业务日、各分子分母、覆盖度与证据水位。成员级结果与任务可重放，查询和导出使用同一快照。沿用现有授权框架并记最小审计数据。 | 角色与账号级权限，手机号披露、删除与级联边界、导出留痕、数据规模及索引。 |

评审后采用现有迁移器追加编号并更新清单。验证顺序包括空库、025 升级、重复迁移、旧包恢复和降级兼容。旧库先提供实时部分覆盖，历史状态由授权新证据建立。现有 022 当前关系、023 证据及 CRM JSON 均不足以补齐历史成员范围或真实回执。生产接线、迁移执行和授权真实平台验收仍待审批。 [迁移清单](../../resources/app/migrations/manifest.json) · [迁移器](../../resources/app/migration-runner.cjs)

## 平台与本地验证

Meta Groups Webhooks 文档列出群回执按消息 ID、群 ID、成员 BSUID 分别标识与聚合，成员手机号可缺失，样例时间字段为 webhook 触发时点。可把官方授权 webhook 作为评审对象，先由独立服务验证事件来源和账户、群、消息归属。本文没有取得测试账号或证明现有桌面账号能访问该接口。文档没有提供从既存普通群补齐完整历史回执的依据。 [Groups Webhooks](https://developers.facebook.com/documentation/business-messaging/whatsapp/groups/webhooks/#group-message-status-webhooks) · [群消息文档](https://developers.facebook.com/documentation/business-messaging/whatsapp/groups/groups-messaging#group-message-status-webhooks)

WhatsApp 帮助中心说明发送者可在前台 `Message info` 人工核对已发消息的详情，包括留存的离群成员记录。是否可用于客户级证据输入须结合授权、字段校验及出处审计评审。未核实结果保持未知。RD02 的自动采集边界保持有效。 [WhatsApp Message info](https://faq.whatsapp.com/665923838265756/?cms_platform=web&locale=en_US) · [原能力审计](v41-ws-capability-audit.md)

使用项目捆绑的 Node v24.22.1 执行 `node --test tests/ws-customer-reading-query.test.cjs`。**7/7 通过**，使用迁移至 025 的合成临时库，测试查询以只读模式打开。覆盖逐作用域授权、旧回执失效、证据核实、客户去重、排除、分页、CSV 与异常事务。测试验证器只用于合成数据。 [隔离测试](../../tests/ws-customer-reading-query.test.cjs)

## WS04 隔离阅读观测

WS04「群组目录」原有账号筛选、单群详情和监测历史。前台本地聊天的消息仍延续手动翻译，使用已有本地消息 ID。新增选择器位于 WS04 单群详情所在页面，明确使用 023 捕获 ID。 [群目录](../../resources/app/modules/ws-workbench.js#L3094) · [界面模块](../../resources/app/modules/ws-group-reading-ui.js)

1. 侧车在 `/api/ws/group-manager/` 分支内增加 GET 能力、明细和 CSV。请求经过本机 Host、允许 Origin 与每次启动会话 token 校验，随后经现有双重隔离门禁。WinUI 隔离构建限定使用 `Stage51Isolation.DataRoot`。端点验证显式账号、账号群组归属和精确捕获消息 ID。复用的是隔离本机会话权限，生产仍缺角色、查询和导出审计接线。 [会话授权](../../resources/app/server.mjs#L2526) · [群管理与阅读观测](../../resources/app/server.mjs#L2877) · [WinUI 启动环境](../../desktop/src/Zhike.Desktop/Services/LocalServiceManager.cs#L219)
2. 单群详情校验成功的隔离能力响应后显示「本地阅读观测」，并复用已有 023 消息 GET，最多读取当前账号与群内 200 条捕获记录。选择器只展示捕获 ID、本机已有时间和类型。查询与下载均需要用户显式选中消息。这些捕获记录缺少可信自发归属。选中状态保留在当次界面请求范围内，离开页面、账号变更、关闭群详情时丢弃过期响应，也阻止其触发下载。 [工作台接线](../../resources/app/modules/ws-workbench.js#L3094) · [界面模块](../../resources/app/modules/ws-group-reading-ui.js)
3. 明细端点 `GET /api/ws/group-manager/customer-reading` 绑定同一消息三元组。页面每页 25 条，展现观测依据、当前 CRM 关联和待核实状态。「确认未读」「历史有效人数」「已读率」显示不可用。端点没有回执验证器，所有成员阅读状态均为未知。没有捕获或没有明细时分别显示空状态。 [查询模块](../../resources/app/modules/ws-customer-reading-query.cjs)
4. `GET /api/ws/group-manager/customer-reading/export` 重新验证同一作用域，返回最多 2 MiB 的 JSON 响应，包含作用域、行数和 CSV。前端核对响应作用域后通过 Blob 下载。现有 `legacy.api` 请求和会话 token 流程沿用，未扩展 IPC。 [桌面桥](../../desktop/src/Zhike.Desktop/Services/LegacyBridgeScript.cs#L135) · [本机会话 token](../../desktop/src/Zhike.Desktop/Services/ApiClient.cs#L123)

使用捆绑 Node v24.22.1 执行 `node --test tests/ws-group-reading-isolated.test.cjs tests/ws-customer-reading-query.test.cjs`，**9/9 通过**。HTTP 测试启动真实本机侧车、临时 SQLite 和动态端口，验证关闭门禁、两种单标志组合、令牌与来源拒绝、账号和群隔离、显式消息、未知状态、分页与导出。界面测试使用生产渲染及交互函数和 Node DOM 替身，验证能力门禁、显式选择、分页、下载、账号切换时迟到导出丢弃、错误和空态。WinUI、Edge 和真实 WhatsApp 未在本轮验证。 [隔离 HTTP 与界面测试](../../tests/ws-group-reading-isolated.test.cjs)
