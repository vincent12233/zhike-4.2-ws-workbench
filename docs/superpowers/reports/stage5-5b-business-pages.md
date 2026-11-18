# 阶段 5.5B：WS 十二页业务完善与隔离验收

日期：2026-11-16–17（Asia/Calcutta）。本报告记录本轮实际业务代码、隔离 API 回读、自动化及原生操作。最终测试与原生剩余项见验收表，不以页面存在或历史结果代替通过证据。

## 基线与范围

- 进入本阶段时 HEAD 为 `1be5907`（5.5A 报告提交），代码基线 `17f37bf` 存在，工作区干净。
- 继续使用 `ui/zhike-61-stage55a-workspace`；没有重建导航或覆盖其他未提交工作。
- 沿用 5.5A 的深蓝/蓝紫设计系统、十二页、250/76 有效像素独立侧栏、自动最大化/还原和真实前台 WebView2。
- 本阶段以通讯录和统一日志只读查询、已有业务页面可操作性、错误/未知状态与账号隔离为范围，不增加新消费者或未确认的批量写入功能。
- **生产入口 FROZEN。生产 Worker、AI 消费者、真实 WhatsApp、生产迁移、新旧队列双写均不获授权。**
- **最终 5.5B Gate：Passed（隔离业务页面与本报告列明的原生范围）**。2026-11-17 用户将测试窗口移回主屏后，补齐十次切号、双账号 Core、返回还原和正常退出证据；此前 Blocked 记录保留在历史提交 `6dd3fd1`。阶段 5.5C 具备准入条件，等待单独任务授权；阶段 6 继续暂停。

## 十二页实现状态

下表描述代码实现范围，不将代码存在等同于最终原生验收通过。最终逐页操作证据需在后文补齐。

| 页面 | 本轮实现及复用 | 明确范围或待验证项 |
| --- | --- | --- |
| 工作台首页 | 保留既有首页布局，补充采集、跟进、队列及审核入口；读取现有业务状态并注明当前已加载范围 | 未读/未加载显示未知，不将默认零值或调度启动当作同步成功；正常切号、回滚和原生账号恢复共享 UI 投影清理 |
| 账号管理 | 复用账号列表、搜索/筛选、添加和切换入口，细化连接/历史状态及失败反馈 | 复验 5.5A 的 sequence 所有权，不开启真实账号授权 |
| 前台聊天 | 保留真实账号池和 WebView2，继续使用紧凑操作行及可折叠 CRM 列 | 本轮实际原生 Core 仅加载隔离构建允许的 about:blank，不伪装成 WhatsApp 聊天；真实登录、发消息和付费 AI 均未测试 |
| 群组管理 | 复用当前账号群组目录、搜索/筛选、40 条分页、状态、右侧详情和已有监测设置 | 权限/成员数/同步缺失标明未提供；不新增批量入群、踢人或群发执行 |
| 群成员管理 | 复用成员账本及进退事件，增加成员/群组搜索、状态与角色、群归属及可折叠详情 | 关系键保持账号+群组+成员，不按显示名合并；仅展示服务已返回的历史范围，未提供角色不猜测 |
| 数据采集 | 复用采集任务/采集项服务，展示实际状态、进度、失败原因、checkpoint、任务历史及详情 | 当前采集项最多读取 1000 条的范围明确说明；页面关闭不停止既有隔离任务，不启动正式消费者 |
| 通讯录管理 | 新增独立只读列表、当前账号选择、搜索、规范号码、账号内重复提示、详情、40 条分页及完整状态反馈 | 仅本机已同步一对一会话联系人投影；不是完整 WhatsApp 通讯录，不导入或自动写 CRM |
| AI 助手 | 复用阶段 4 任务流水线/审核组件与原分析展示，显示状态、结果、证据、错误及审核入口 | 正式消费者保持关闭，隔离结果不能当真实 AI 质量验收 |
| CRM 客户 | 复用客户主档，只显示当前账号已显式关联的客户，增加搜索、详情及候选/审核/冲突/审计入口 | 无 accountId 的会话不能纳入账号客户映射；普通聊天不建档、不按姓名关联、不覆盖人工字段 |
| 任务中心 | 复用现有跟进任务和服务状态，增加筛选、进度/失败说明、详情及知客任务中心入口 | 未读取显示未知；无后端支持的任务操作不生成可用按钮 |
| 操作日志 | 新增统一查询界面，支持时间、账号、来源、操作类型、结果、任务、对象、搜索、分页及详情 | 正式审计、运行快照、未接入诊断明确分类，不建立第二套审计记录 |
| 工具与设置 | 整理原翻译、导入/导出、WS 诊断及 GPT/API Key 设置入口 | 复用既有加密密钥服务，不展示原密钥；GPT 弹窗动作增加归属白名单、Escape 关闭与焦点恢复，不启用真实付费调用 |

业务 UI 提取为 `ws-business-pages.js`，主工作台继续负责既有导航、账号上下文、业务加载与事件分派。新增模块不是第二个应用或客户资料库；原布局及原生窗口服务没有重做。

## 通讯录查询

新增只读端点：

`GET /api/ws/workspace/contacts?accountId=...&q=...&duplicate=all|duplicate|single&page=1&pageSize=40&id=...`

- `accountId` 必填且必须存在；缺失 400、不存在 404、非 GET 405，鉴权继续走原本机 API 边界。
- 唯一联系人来源为当前账号 `ws_conversations` 中通过既有 `wsCore.conversationType` 判定的一对一会话。群组/普通广播/身份未知会话不冒充个人联系人。
- 姓名只作原会话显示字段，未提供明确标记；不以姓名推测客户身份。
- 原号码来自已存 phone metadata，或可验证的数字 `@c.us` / `@s.whatsapp.net` JID；`@lid` 为不透明身份，不能猜号码。
- `normalizedPhone` 复用现有 `wsCrmSync.normalizePhone`，包括项目已有的 00/印度 91 前缀规则。这是项目内部规范号码，不新增 E.164、运营商或 WhatsApp 实时有效性验证。
- 重复计数通过当前账号完整候选目录的 SQL 窗口计数产生，不只统计当前页，也不与其他账号合并。
- CRM 关联只读取持久化 `conversation.customer_id` 与现有客户主档：有效唯一记录为 linked，未绑定为 unlinked，不存在、已删除或号码矛盾为 conflict。不执行匹配、修复、建档或写入。
- SQL 实现账号约束、参数绑定、COUNT、稳定排序和 LIMIT/OFFSET。注册的 SQLite 函数都是纯投影，不执行 DDL 或写入；不读取消息正文，不在 JS 全量构造目录数组。
- API 返回来源和覆盖说明。UI 拒绝响应账号/行账号不一致，并用请求序列拒绝迟到结果；加载、空状态、错误及可收起详情分别展示。

本阶段未开发：独立 WhatsApp 原始通讯录同步、批量导入、未验证联系人写 CRM、修改人工字段、按名称/号码自动建链。

## 统一操作日志

新增只读端点：

`GET /api/ws/workspace/audit?accountId=...&category=audit|snapshot|diagnostic&q=...&from=...&to=...&type=...&sourceType=...&outcome=...&jobId=...&objectId=...&page=1&pageSize=40&id=...`

### 已复用的来源

| 类别 | 原有来源 | 投影边界 |
| --- | --- | --- |
| 正式审计 | `ws_group_audit` | 原群组操作、结果、操作者和安全原因；只取允许的元数据字段 |
| 正式审计 | `ai_task_audit` | AI 生命周期和既有 CRM 审核动作，保留 Job/correlation 关联 |
| 正式审计 | `ws_send_audit` | 既有发送操作/结果/错误及安全附件统计；不返回发送正文、译文或 native_result 原 JSON |
| 运行状态快照 | `ws_collection_runs` | 任务状态、计数、失败原因及是否存在 checkpoint；不冒充逐次操作历史 |
| 运行状态快照 | `ws_group_sync_runs` | 群同步任务当前状态、重试和项目计数 |
| 运行状态快照 | `ai_jobs` | 任务当前状态、尝试次数及安全重试信息；不返回 payload/lease token |

每条 UNION 分支都绑定当前账号，公开 ID 使用来源+原记录 ID 的 SHA-256，避免不同原表同 ID 冲突。详情返回脱敏的原来源及记录标识，查询 ID 仍保留账号边界。时间过滤解析 ISO/日期，排序使用 `julianday(at)`，兼容旧 SQLite 时间字符串和 ISO 时间混合的真实历史。

无新增审计存储或迁移。正式审计记录不被复制到新表，不改变原记录，不将快照写成审计。

### 未接入及原因

- `customer_governance_actions`、`crm_identity_conflicts` 等原始全局记录没有可靠账号字段，不能按当前客户名称或全局主档猜账号。既有账号作用域 AI 审核记录仍可查询。
- `hot_chat_events` 是热聊领域事件，不等同完整操作审计，本阶段不混入正式历史。
- Worker 及磁盘诊断没有本查询可安全归属的账号源；诊断类别返回 available=false 和明确说明，不能用空列表冒充完整诊断。
- 未枚举用户的诊断目录或读取 Cookie、WebView2 profile、Token、API Key、真实聊天内容。

### 脱敏与查询安全

输出仅允许已定义字段；原始 `data_json`、候选值、消息正文、提示词、租约和 native_result 不透传。动作、操作者、原因、关联标识及允许的详情字符串仍经过脱敏，覆盖常见 Authorization/Bearer/Basic、key/token/password、编码 URL 参数及用户信息、邮箱、手机号和本地路径。

搜索基于脱敏投影，不能通过搜索原密钥再观察条数来推断被隐藏值。公开类型/结果选项也来自当前账号的脱敏字段。原始对象标识被脱敏时只作展示与过滤，不声称可完整回链至隐藏标识。UI 另做 HTML 转义与深度/长度限制，避免日志数据被解释为 HTML 或动作授权。

## 其他复用接口与权威边界

- 账号继续使用 `/api/ws/accounts` 与既有 native open/status 边界；5.5A 的 `switchAccount` 序列所有权保留。
- 群目录复用 `/api/ws/accounts/:accountId/groups`；成员/监测/事件复用既有账号作用域群管理和监测接口。
- 采集复用既有 collection run/item 及 follow-up-alert 读接口，不切换任务消费者。
- AI 和审核继续使用阶段 4 的 `/api/ws/ai-pipeline/*` 与原审核中心，不绕开 CRM Service。
- 客户列表复用唯一主档 `host.state.customers`，取当前账号明确关联会话的 customerId 集合；没有 `/workspace/customers` 第二套目录权威。
- GPT 设置复用 `window.zhikeAI` 的既有配置/加密凭据能力。WS 页面只能打开原设置弹窗，其他 GPT 动作不能借设置入口跨页面执行。

两个新 GET 端点的鉴权、账号边界、只读性及错误行为由真实 SQLite/HTTP 专项验证，原生操作另列。

## 本轮定点缺陷

1. CRM 客户映射先前允许缺失 accountId 的会话参与关联；已按明确账号归属修复，避免历史未知归属记录污染当前账号。
2. 切换账号后旧 collection/AI/follow-up summary 可能残留；正常切号、回滚及原生 restoreAccountId 现在复用 resetAccountPresentation，仅清 UI 投影，不改后台实体。summaryLoaded 逐来源记录读取成功；失败保持空白/未知。实际生产函数的 A→B→A 延迟响应、旧 finally、恢复后账号列表读取失败均新增回归。
3. 原 GPT 设置弹窗在 WS 页打开后，原处理器拒绝其关闭/保存等动作，保存还会接管路由。现在仅允许当前所属弹窗的设置动作，复用原密钥服务；Escape 清空临时密码输入并回焦，保存不切换 WS。VM 运行真实注册事件验证，原生打开/Escape/焦点亦已实测。
4. 多输入日志表单缺少 submit 控件可能导致 Enter 不查询。查询按钮现为 type=submit，无重复 data-ws-action，点击和 Enter 共用一次 submit；真实渲染和委托处理器回归、通讯录原生 Enter 搜索通过。
5. 原审计时间若是异常历史字符串可能透传未脱敏内容；现在仅输出可解析的标准 ISO，否则显示“时间未识别”。保留原 SQL 时间过滤及排序，补敏感时间字符串不泄漏、不可搜索及时间范围排除回归。
6. 完整回归发现新浏览器模块尚未加入 sidecar 静态资源白名单。WinUI 本地映射可加载，HTTP 入口会 404。现仅新增该公开 JS 的精确路径，未开放服务端 CJS 或通配目录；现有资产合同及真实临时 HTTP smoke 均重新通过。

历史桥接超时、WS sidecar 启动延迟和 WMI 延迟继续作为残余风险。除非本轮获得可复现的根因证据，不得因本轮重跑通过而称其已经定位或修复。

## 修改文件范围

本轮基于已有代码进行局部业务完善，最终准确清单以代码提交的 `git show --stat` 为准。

- `resources/app/modules/ws-business-pages.js`：业务表格、过滤、详情、加载/空/错误状态及安全渲染。
- `resources/app/modules/ws-workbench.js`、`ws-workbench.css`：接入新业务页、复用服务、账号状态及现有视觉规范。
- `resources/app/modules/ws-workspace-query.cjs`：只读联系人和审计投影；`resources/app/server.mjs` 仅增加 require 和两个 GET 路由。
- `resources/app/index.html`：加载业务展示模块。
- `resources/app/modules/gpt-assistant.js`：原设置入口跨页弹窗动作归属、关闭与焦点保护。
- `scripts/stage55b/`：真实查询/页面/设置专项及隔离原生夹具。
- `scripts/run-tests.cjs`、既有 stage 5 页面/UI 合同、stage51 成员绑定/完整布局、init 合同、HTTP 资源 smoke、渲染夹具与 native prepare：注册及复验新模块，适配真实 submit 与已加载历史范围。

未改 schema 25 或历史迁移，不新增客户权威/审计权威，不改已验收 Worker/IPC/fencing 机制，不启用生产开关。

## SQL 查询专项与性能观察

后端专项实际执行真实版本化 schema 25、只读 SQLite 连接和临时 sidecar，验证：号码规范化、账号内跨页重复、@lid 未提供、未知/删除/冲突 CRM、过滤和分页、同 ID 不同审计源、时间排序、脱敏及秘密搜索不泄漏、GET 鉴权/方法限制、AI 开关保持关闭、正常停止。

只读连接禁止写入；实际 HTTP 查询前后另对全部现有表计算摘要，证明查询未改变客户、业务、队列、审计或 schema。临时账号和数据均为合成，动态本机端口，不连接真实 WS 或付费 AI。

一次已保存的本机专项观察（`.tools/stage55b-special-final.log`，本轮实际执行；最终完整回归另有独立重跑）：

| 数据规模及操作 | 三轮实测耗时 | 限制 |
| --- | --- | --- |
| 当前账号 3006 条审计；每轮 10 次过滤+COUNT+40 条分页 | 603.03 / 714.06 / 669.96 ms | 来源 .tools/stage55b-special-final.log；本机临时 SQLite，非正式吞吐承诺 |
| 当前账号 3055 位联系人；每轮 10 次搜索+重复计数+40 条分页 | 1093.44 / 1109.39 / 1061.56 ms | 同上；不代表 WhatsApp 网络采集或全部设备性能 |

没有正式阈值时不另造通过阈值；不因节省时间跳过安全用例。审计排序避免对全结果计算公开哈希后排序，但仍保留安全公开 ID；全部来源使用账号约束和 SQL 分页，没有把所有消息拉到 UI。

## 原生 Windows 操作与隔离业务回读

本轮实际运行 `.tools/stage55b-native/Zhike.Stage51.Acceptance.exe`，Release、`Stage51IsolatedUi=true`；显式临时根为：

`C:\Users\酷酷\AppData\Local\Temp\zhike-stage51-native-3d0e5c7fe2c449dcb863c10d65d11994`

PID 11628 是空数据准备会话，已通过原生关闭按钮退出；最终 UI 资产更新后重启 PID 5380，在全新数据库中经真实隔离 API 初始化 2 个客户、2 个账号、4 条群组关系、4 条成员关系、每账号 49 位本机目录联系人和 46 个 AI Job。没有复制生产数据、登录态或密钥，没有运行真实 AI。初始和新业务页 JS/查询模块均有源文件 SHA；最后一次服务器改动仅为 HTTP 公开 JS 白名单，另由实际隔离 HTTP 测试验证，不冒充该运行进程重新加载了服务端代码。

原生截图位于 `stage55b-screenshots/`，均来自真实隔离窗口，不是设计图：

| 操作 | 本轮实际结果与证据 |
| --- | --- |
| 进入 WS、独立导航和十二页 | 自动最大化，主侧栏不在 AX 树中，250 有效像素 WS 独立导航显示；实际逐页进入 overview/accounts/chat/groups/members/collection/contacts/ai/crm/tasks/logs/settings，见 native-events 的 page enter 与截图 02、03、08、12、13、15–18、22、23、26、27 |
| 通讯录 | 自动读取；@lid 号码未提供、规范号码、跨页重复 2 条、唯一显式 CRM 关联正确。搜索“重复号码”按 Enter 返回 1 条，详情展开/收起释放右列；重置恢复 49 条，下一页返回 9 条，2/2 页末有真实分页，650 像素普通滚轮及 Ctrl+End 可达末尾，截图 03–07 |
| 操作日志 | 原审计列表、关联任务/来源详情、切换运行快照、诊断 unavailable 明确说明均实际操作，截图 08–11；时间/结果/对象等完整过滤及脱敏由真实 SQLite/HTTP 专项覆盖，不把所有筛选控件都声称原生逐一输入过 |
| 群组/成员 | 当前账号 2 群、同成员在不同群分别 2 条关系；角色、来源、缺失权限明确展示，成员详情自动滚到可见区。截图 12–14；进退历史只承诺原服务已返回的范围 |
| AI / CRM | 真实服务返回 46 个 Job、3 个候选；截图 17 显示列表/分页及原审核操作。CRM 实际批准空职业、拒绝语言、批准人工职业冲突分别得到 applied/rejected/conflict，截图 19–21 |
| CRM 回读与审计 | `node scripts/stage55b/verify-native.cjs <本轮根>` 在上述真实 UI 操作后只读校验：客户仍 2 个；C-native 职业=工程师、语言空；C-manual 职业仍为人工维护职业；B 候选全部 pending；原 ai_task_audit 中存在 suggestion.approve/applied、suggestion.reject/rejected、suggestion.conflict/conflict。证据为 stage55b-business-evidence.json |
| 设置 | 原 GPT 设置弹窗未配置密钥，未触发连接/模型或真实付费调用；Escape 关闭后 WS 路由保留、焦点回到打开按钮，截图 23–25 |
| 原生聊天 | 保留真实 Core，隔离编译仅 about:blank；十二页过程中默认账号 Core 仅创建一次、没有导航循环，聊天/非聊天的原生 hit-test/bounds 分别显示/隐藏，右 CRM 列可展开（截图 27–29）。不声称空白测试 Core 已验证真实 WhatsApp 输入、消息收发或登录 |
| 首次阻断与补验 | 首次账号下拉验收连续报 `window crop is outside captured monitor`，当时保持 Blocked。2026-11-17 用户回复“已放主屏”后恢复捕获，补齐十次切号、两个 Core、返回还原及正常退出，结果见下方补验段落，未用自动化替代原生 |

上表最后一项是首次交付的原生阻断，已通过用户恢复窗口后实际操作解除。程序切号/原生 restoreAccountId 的账号清理与失败竞态仍保留实际函数自动化证据；新增原生操作为独立证据。工具捕获失效的原因没有被冒称为已定位的产品缺陷。

## 性能与资源观察

使用既有 `scripts/stage52/resource-observe.ps1`，PID 5380、31 次、间隔 10 秒、实测 312672.9 ms（5.21 分钟）。系统为 Windows 11 专业版 10.0.26300 x64，20 逻辑 CPU；WebView2 文件版本 157.0.4341.46。采样覆盖进入后及通讯录/日志操作，不冒充所有十二页及十次切号的长期压测。

- 进程树工作集：1216.93 → 1191.52 MiB，峰值 1266.61 MiB。
- Private Bytes：667.75 → 613.03 MiB；线程 364 → 367，峰值 379；句柄 9001 → 9211。
- 观察到 15 个进程，WebView2 子进程首尾均 12；采样 CPU 累积增量 32.6562 秒，不冒充整机 CPU 百分比。
- 无既有正式阈值，因此只记录基线和观察，不能据此宣称长期无泄漏或全设备性能放行。补验新增 B Core 后的关闭前快照及退出结果另列，不将两个 Core 的正常资源增量当作泄漏。

原生图片含 1920×1140 最大化画面和 1422×815 普通窗口画面，不能等同所有物理显示器/DPI 验收。六种物理尺寸/缩放对应的有效视口布局来自本轮真实 Edge 的完整生产 render+CSS 模型，属于 CSS 布局证据，不代替原生 Windows DPI 测试。

## 最终验证与证据

| 验证范围 | 本轮最终命令/结果 |
| --- | --- |
| 阶段 5.5B 专项 | `node scripts/run-tests.cjs stage55b` 3/3；最终全量再次执行同三专项均 Passed，实际函数 native restore、A→B→A、单次 submit、只读、脱敏均覆盖 |
| UI 回归及十二页数据绑定 | `node scripts/run-tests.cjs stage55a` 最终 7/7，日志 stage55b-ui-regression-complete.log；六种真实 Edge 有效视口、原生 Win32 placement helper、账号竞态、按钮原生确认均重跑 |
| 十次账号切换与旧资料/summary 清理 | 实际生产函数竞态 Passed；用户恢复窗口后本轮 **原生十次切号 Passed**，截图 30、34–42，真实账号选择序列 B/A×5；B 本机目录为 B 行、1/2 页，返回 A 为 A 行、2/2 页（31–33、43） |
| 前台 Core 保留及窗口恢复 | PID 5380：default 与 native-b 各创建一个 Core、各一次 about:blank 导航，后续选择 created=false/reload=false；同 HWND 返回，exit.after 完整等于 entry.before；正常退出 Passed |
| CRM 审核及群成员隔离 | 实际 SQLite/Service/UI 委托回归 Passed；本轮真实 WinUI 审核及只读 API 回读 Passed，原成员来源/两账号两群隔离 Passed |
| WS 回归 | 独立 `node scripts/run-tests.cjs ws` 151/151；以该命令 151 个 RUN 标签与最终完整重跑 PASS 集逐项比对，151/151 均在最终代码上再次通过 |
| Worker / IPC / fencing | 最终全量实际运行 supervisor/生命周期/真实管道 IO/实际 sidecar fencing 等 Passed；生产 Worker 未启用。跨真实 Windows 用户 SID 未在本轮重建账户复测，保留阶段 1.7 历史已验收证据，不冒充本轮新结果 |
| 全量自动化 | `node scripts/run-tests.cjs all` 最终 **267/267**，stage55b-full-final.log；比 5.5A 262 多 2 个新模块语法检查及 3 个业务专项，没有删除或跳过测试 |
| 024 checksum | 最终全量中的 Stage 5 migration drill 及 Stage 5.1 historical 024 compatibility and real startup Passed；旧 checksum、重复升级、数据保留、回滚/恢复均在临时库验证，未改历史迁移 |
| WinUI Release x64/win-x64 | `.tools/dotnet10/dotnet.exe build desktop/src/Zhike.Desktop/Zhike.Desktop.csproj -c Release --no-restore -p:Platform=x64 -r win-x64 --nologo -v:minimal` 最终 0 warnings / 0 errors，22.25 秒，stage55b-release-final.log。隔离 UI 构建同命令加 `-p:Stage51IsolatedUi=true -p:OutputPath=../../../.tools/stage55b-native/`：0/0，37.84 秒；不将两种构建混称 |
| 原生 Windows 操作及截图 | 最终 44 张真实隔离截图、128 条白名单事件；原生补验 Passed，仍不声称真实 WhatsApp/付费 AI/其他原生 DPI 已测 |
| 数据安全与退出清理 | 无 .cs/.sql/生产 flags 变更；显式临时根和编译网络/路径隔离。正常关闭后，原采样 15 个和关闭前新快照 21 个 PID+精确创建时间身份均 Passed，remaining=0、unverified=0，检查器未终止进程；目录保留作诊断，未声称删除 |
| Git diff/工作区 | 产品代码仍为 73e9c32，补验只更新报告及非敏感证据；diff --check 通过，独立报告提交后再核验工作区 |

首轮完整执行为 264/267（stage55b-full-initial.log）：两个旧断言依赖旧标题/点击 action，修正为真实 submit 及已返回历史范围；另一个是实际 HTTP 静态白名单缺口，已修复并增加新模块 HTTP 读取。首轮 UI 为 6/7，旧完整布局模型要求任务页保留已删除的重复流程栏；现允许真实缺省或零占位隐藏，并保留其余布局/字体/尺寸检查。所有初始失败与最终重跑摘要一起归档，不擦除失败记录，也未通过延长超时或放宽安全检查使测试通过。

证据归档命令：`node scripts/stage55b/archive-evidence.cjs <本轮根>`。首次归档为 83 条事件/29 图/38 项清单；最终归档为 **128 条事件、14 份日志摘要、44 张截图**，增加 native-final-verification 后清单 **54 项**，逐项回读校验 Matched。原始日志仅留 .tools 并记录原 SHA；连接文件、SQLite、WebView2 profile、密钥、原始聊天不提交。截图逐张检查为隔离应用/合成业务，没有归档捕获到的遮挡窗口。归档脚本不自动判 Gate，退出结论另由真实进程身份检查支持。

复核精确源码与截图/证据清单：`stage55b-evidence/source-hashes.json`、`stage55b-evidence/sha256-manifest.json`。最终 native-summary 包含两个账号各一次 Core 创建及各一次可见导航；native-final-verification 包含最后十次 B/A 序列、窗口完整还原和两组真实退出检查。局部 .gitattributes 保持 JSON/JSONL LF；最终 54 项另从 Git 暂存区 blob 计算 SHA，交付前检查 Matched，凭据字段与长 API Key 模式扫描通过。

### 2026-11-17 原生补验闭环

- 时间（Asia/Calcutta）：首次 B Core 创建 00:33:36；返回知客 00:37:37；正常关闭 00:38:41。期间没有连接真实 WS 或正式 Worker。
- 十次按原生账号下拉操作，顺序 `native-b/default` 重复 5 次；首次 B created=true，其后 9 次 created=false 且全部 reload=false。截图 30、34–42 与带时间的 ws-account-selected 原事件一一对应。B 通讯录显示“隔离通讯录 B”及 1/2，返回 A 显示“隔离通讯录 A”及原 2/2，没有把 A 列表沿用至 B。
- Core 创建总数为 2（default generation=1、native-b generation=2），可见导航总数 2，均成功 about:blank；页面返回不重建、不增加导航。首轮未登录/连接失败显示保留为隔离未授权状态，不包装成真实 WhatsApp 已可用。
- 返回按钮恢复知客主侧栏与今日工作台（44 图）；同 HWND 35849590，退出后 placement 与进入前完整相同：ShowCommand=1、Flags=0、X=156、Y=156、Width=1152、Height=659、IsMaximized=false、IsMinimized=false。
- 关闭前使用现有 `scripts/stage52/resource-mark.ps1 -RootPid 5380 -TestRoot <本轮根> -Phase before-close -Boundary snapshot`，实际唯一文件为 `stage52-before-close-snapshot-91e1075f6bb44eb4896495ef889883da.jsonl`；观察 21 个进程、18 个 WebView2 子进程。工作集 1733009408 bytes、Private Bytes 914989056 bytes，是含第二账号的单次快照，无新增吞吐或泄漏结论。
- 使用原生关闭按钮，窗口 inventory 确认测试窗口为 0；原事件记录 application-stopping、sidecar-stopped running=false、host-unloaded。
- 分别运行 `scripts/stage51/resource-check-cleanup.ps1 -TestRoot <本轮根> -SourceName <上述唯一文件>` 及同命令 `-SourceName stage55b-resource-samples.jsonl`。实际输出为 Passed（21 和 15 个观察身份）、remainingCount=0、unverifiedCount=0、processTerminatedByCheck=false。结果原文留 .tools/stage55b-close-current.json 和 stage55b-close-original.json，非敏感投影及原 SHA 纳入 native-final-verification。
- 关闭前额外身份守卫第一次因 PowerShell JSON 日期自动转换后再字符串 Parse 丢失精度而拒绝执行；未绕过检查。改用 `ConvertFrom-Json -DateKind String` 和 ParseExact RoundtripKind，实际/期望均为 2026-11-16T18:25:09.1382254Z，精确 ticks 与可执行路径一致后才采样。正式资源检查器本身不需修改。
- 本次补验没有修改产品、数据库迁移或功能开关。专项 3/3、UI 7/7、WS 151/151、全量 267/267 与 Release 0/0 复用本阶段冻结代码的实际最终执行记录，**没有冒充补验时再次重跑**。新增原生事件断言和退出检查为本次实际执行。
- 追加证据初次暂存校验发现 Python 写出的 JSON 为 CRLF，与仓库 LF 规则不同；校验按设计拒绝。只将新增证据和清单规范为 UTF-8/LF并重新计算，随后工作文件和 Git 暂存区两处 54 项 SHA 均 Matched，未改变原生事件或退出检查结果。

不得用 Mock 截图或代码生成替代原生验收，不得将已同步本机目录描述为全 WhatsApp 通讯录。测试目录及证据必须核实归属，敏感原始文件不能直接进 Git。

## 回滚与停止边界

代码与报告分别提交。稳定 5.5A 基线仍保留；需要撤回时对本阶段已审查的代码提交执行 `git revert 73e9c32`，不 hard reset、不删除用户资料、不改写历史迁移。没有正式安装包、生产迁移或数据回填需要回滚。

代码提交：`73e9c32a74e9fcfd3dddcbe8090e484994121bcf`（22 文件）。报告提交：最终包含本文件及 stage55b-evidence/screenshots 的独立 Git commit，可由 `git log -1 -- docs/superpowers/reports/stage5-5b-business-pages.md` 复核；最终回复提供准确 hash。工作区以交付前实际 git status 为准。

最终 **5.5B Gate：Passed（本报告限定的隔离业务界面范围）**。原先阻断已由十次真实切号、两个 Core 复用、原窗口完整还原及 21/15 个观察身份全部释放的实际证据解除；没有降低验收标准。临时目录不含正式业务数据，进程已停止，目录继续保留作诊断，不声称文件已删除。

已实现十二页的业务展示/查询及原有操作入口。能力范围仍明确：通讯录为已同步本地目录；日志仅上述三项原审计和三项快照，无可靠账号来源的全局/Worker/磁盘诊断不接入；真正 WhatsApp 登录、真实翻译/付费 AI 与各设备/DPI 质量验收未做。历史桥接超时、WS 启动延迟、WMI 延迟及首轮 WS 启动失败原因继续保留为未定位风险，本轮没有凭重跑成功宣称消除。

**阶段 5.5C 具备准入条件，等待单独任务授权；阶段 6 继续暂停。** 生产入口始终 FROZEN，生产开关 OFF；没有正式 Worker/AI 消费者、真实 WS、生产 SQLite 迁移、新旧队列双写或正式安装发布。Gate Passed 不授权生产启用或自动推进下一阶段。
