# RD09 · 设备迁移包 v2 与空白工作区恢复

状态：**批准仅限隔离开发与验证 / 生产冻结**。关联 RD03、RD04 与总控 P0 §6。生产入口 **FROZEN**。用户明确批准「仅隔离开发与验证」，授权覆盖本决定内的 v2 格式和空白工作区恢复。跨设备和真实 Windows 断电持久化仍需独立证据。 [已有包引擎](../v41-device-package-engine.md) · [已有 025 投影验证](../v41-device-migration-snapshot.md) · [风险登记](../risk-register.md)

## 1. 批准的业务边界

第一批拟支持**当前侧车 schema 025 中可移植的已提交业务数据**，含 42 张表的审核列和可验证的 ready 素材。其包清单仍为 `partial`，界面可写「SQLite 业务资料与已验证附件」，同时显示排除域与未恢复的执行授权。暂不对外使用「完整设备迁移」「恢复了全部资料」或相同含义。无权威来源的业务域继续列在排除清单内，日后扩大范围须重新审核覆盖及契约。

**空白目标**由用户显式选择，且必须是专用于本次恢复的新本地工作区。若复用一个已初始化但未使用的目标，只接受目标自己的 schema 025、无业务行与原生待写任务、仅迁移 008 自带的默认账号及默认设置、无素材及活动进程。逐表和目标目录验空。账号同名、存在非初始业务记录、目录身份变化或存在未明责任的文件时拒绝。禁止对源库、正在运行工作区或既有数据做替换、合并、按手机号覆盖或自动重挂 ID。同包重跑只能继续同一期暂存或清理后重做，不重复发布。

## 2. 包格式

技术更正：按现有引擎的实际字节布局，ASCII 魔数 ZKDEVICE 占 8 字节，含版本、盐与前缀的头部共 33 字节。更正长度不改变 v1 或本提案的认证结构。

| 项目 | v2 拟定契约 |
| --- | --- |
| 文件与版本 | 扩展名 `.zkdevice`。头部 33 字节依次为 ASCII `ZKDEVICE`（8）、版本字节 `0x02`（1）、随机盐（16）、随机 nonce 前缀（8）。封套版本 2；独立的 ledger `payloadVersion=1`；源与目标首版只接受 SQLite `schemaVersion=25`。头版本未知时立即拒绝 |
| 密钥与认证 | 复用 v1 的 scrypt 参数 `N=65536,r=8,p=1,maxmem=96 MiB` 与 32 字节派生密钥。用 AES-256-GCM，每帧的 12 字节 nonce 为 8 字节前缀拼接从 0 起的 4 字节大端帧编号；附加认证数据为完整头部、帧编号和 4 字节大端长度。每个新包用独立盐和前缀 |
| 帧与载荷 | 每帧为长度（uint32BE）、同长度密文和 16 字节 tag。帧 0 是 manifest；随后为 ledger，再按 manifest `media` 数组顺序逐件写文件。每段按 1 MiB 分帧，最后一帧精确余量，零字节文件不产生数据帧但仍须验证空内容摘要。长度、帧数和文件结尾必须精确匹配，拒绝拼接、截断、重排和多余帧 |
| JSON 与摘要 | manifest 和 ledger 用严格 UTF-8、无 BOM、紧凑 JSON 数据。固定字段顺序，禁止重复键、额外字段、原型键、隐藏属性和非有限值。嵌套业务 JSON 按该载荷的序列化顺序保留。表按审核清单次序，行按实际主键 SQLite BINARY 次序；账户及媒体清单采用一致的 UTF-8 字节排序。对确切明文段字节计算 SHA-256 小写十六进制并与认证 manifest 匹配。校验 schema、媒体索引和读取字节，以各自适用的校验为准 |
| 作用域与路径 | 帧内只有逻辑 ID 与摘要，无源或目标路径。包 ID 为随机 UUID，不包含主机 ID。素材按 `accountId + id` 和索引匹配；落盘名由可信目的端生成，暂存文件名可取这对键的 SHA-256，正式目录按服务原布局派生。拒绝路径字段、链接、junction/reparse、文件身份替换、大小写或目录派生冲突 |
| 明文、提示及错误 | 派生密码不进入包、日志或持久化记录。暂存限当前操作用户，认证、摘要或结构失败时停止，删除已确认由本次作业创建的对象。清理失败保留明确状态。密码错误与文件认证错误给同一提示，专用审计只记阶段和错误码 |

**Manifest 允许字段**

```text
formatVersion: 2
schemaVersion: 25
packageId: UUIDv4
createdAtUtc: UTC ISO 8601 YYYY-MM-DDTHH:mm:ss.sssZ
ledger: { payloadVersion: 1, sizeBytes, sha256 }
accounts: [{ id }]                                      # 与 ledger.ws_accounts 完全一致
media: [{ id, accountId, sizeBytes, sha256 }]              # 与 ready 素材索引完全一致
coverage: {
  status: "partial",
  scope: "sqlite-business-025",
  tableRows: { 每个审核表名: 实际行数 },
  withheldColumns: { 每个有排除列的表名: [列名] },
  nestedFieldsWithheld: 非负安全整数,
  media: { readyIndexed, included, available, pending, unavailable, deleted },
  omittedDomains: [ { id, reason } ]                       # 首版固定的域与原因枚举
}
```

`ledger` 载荷为 schema 025 投影对象，具体为 `{schemaVersion:25,coverage,tables}`，其自身 coverage 继续描述「SQLite 业务行快照，素材字节在包的独立段」。manifest 的表、账号、列与素材计数由导出器重算，导入端再次对照。首版要求 `readyIndexed = included`，缺少或被更改的任一 ready 素材拒绝产包。其它状态保留 metadata 和现有原因，均无字节帧。已提交数据之后的变更不添加进同包。临时库 migration registry、后台授权及控制记录各由目标环境另行创建。 [v1 帧与验证代码](../../../resources/app/device-migration-package.cjs) · [已有 025 行格式](../../../resources/app/device-migration-snapshot.cjs)

**拟定限值**

| 项目 | 上限和行为 |
| --- | --- |
| manifest / ledger / 总包 | 1 MiB / 64 MiB / 2 GiB，1 MiB 为 1,048,576 字节，1 GiB 为 1,073,741,824 字节。总包包含头、帧长度及标签。单段 ledger 值不超过 16 MiB，最多 64 层、100 万行。任一上限超出拒绝，保留可说明的失败原因 |
| 账号 / 文件 | 256 个账号、4096 件 ready 素材、每件不超过 24 MiB。每个长度和计数是非负安全整数，要求媒体 ID、哈希和归属与同一快照相符 |
| 密码 / 并发 | 和当前 v1 一致，密码为非空且最多 1024 UTF-8 字节，最多两个派生操作，单个目标仅一个恢复作业 |
| 磁盘预算 | 暂存前估算还需保留已验证明文、候选 SQLite/媒体、备份代次和日志。建议额外空闲下限为 `2 × (ledger + media 明文字节) + 256 MiB`，加上尚未存在的备份代次空间。已有备份代次不能为腾空间被自动清理。此估算不替代实际空间检查；短写、磁盘满及无法确认持久化一律失败 |

**兼容与版别路由**

- 现有 JSON 备份与恢复契约保持原入口、确认流程、数据分段和补偿。JSON 备份绝不转标为 v2，旧 JSON 的发送、群和新 AI 数据完整性仍以其原声明为准。
- v1 读写维持现有 32 MiB 快照和自己的检查器，能够解包到隔离暂存并显示旧 `partial` 覆盖。旧客户端收到 v2 会报告版本不支持；v2 客户端根据原始版本字节选定单一解析器。认证失败不回退解析，不用 v1 的记录自动填充 v2 缺失的账本。
- v1 CRM 的 `channelAliases` 和 `qualityDecisions` 入口约束为数组，当前业务权威值为对象。v2 按 `app_state` 业务形状携带对象，并保留 021–025、媒体附件及历史关系。旧版 v1 继续使用已有兼容投影。
- 不迁移 `schema_migrations` 行或修改已有 checksum。旧源库先由现有 runner 升级一个隔离副本并完成版本核验，再重新导出 025；新版数据库或未知兼容分支拒绝。当前仓库具有 004–025 迁移注册，004/012 仅为标记，019/020 是 CRM 和 AI 基础表权威。 [迁移清单](../../../resources/app/migrations/manifest.json) · [原生备份服务](../../../desktop/src/Zhike.Desktop/Services/DesktopToolsService.cs)

## 3. 真实来源及排除项

| 域 | 42 张表的首版范围 |
| --- | --- |
| CRM · 7 | `app_state`、`state_snapshots`、`customers`、`crm_identity_conflicts`、`ai_customer_field_evidence`、`customer_governance_actions`、`customer_delete_requests`。保留 CRM 当前态、业务历史与删除/冲突状态；以当前业务正文重建并对账派生 `customers` |
| WS 账号、对话及任务 · 11 | `ws_accounts`、`ws_account_settings`、`ws_settings`、`ws_conversations`、`ws_messages`、`ws_ingest_batches`、`ws_replies`、`ws_ai_analyses`、`ws_collection_runs`、`ws_collection_items`、`ws_followup_alerts`。保留账号内 ID、消息排序/幂等、采集检查点及提醒状态 |
| 热聊 · 4 | `hot_chat_profiles`、`hot_chat_profile_fields`、`hot_chat_events`、`hot_chat_sync_outbox`。人工锁、字段证据和发件箱记录按原关系保留 |
| 监测和群管理 · 12 | `ws_group_monitor_profiles`、`ws_group_monitor_targets`、`ws_group_monitor_checkpoints`、`ws_group_membership_events`、`ws_group_catalog`、`customer_group_memberships`、`ws_group_members`、`ws_group_messages`、`ws_group_read_evidence`、`ws_group_sync_runs`、`ws_group_sync_errors`、`ws_group_audit`。保留 015 事件、022 权威关系、023 成员/消息/阅读证据及人工锁。Unknown 保留原义，历史不触发补造 |
| 发送和素材 · 4 | `ws_send_audit`、`ws_send_attachments`、`ws_media_assets`、`ws_export_jobs`。审计仍关联各附件 `media_id`，兼容旧审计只有素材 ID 数组；发送尝试、阶段、未知结果和幂等墓碑保留 |
| AI · 4 | `ai_jobs`、`ai_job_evidence`、`ai_crm_suggestions`、`ai_task_audit`。保留 020/024 任务/证据/审核/动作，保留 025 的链路关联 ID 和已确认人工决定 |

五张表的八个明确排除列为 `ws_accounts.origin/partition_key`、`ws_media_assets.storage_path`、`ws_export_jobs.output_path`、`customer_delete_requests.confirmation_token_hash`、`ai_jobs.lease_token/worker_owner_id/fencing_token`。列白名单是首版权威输入。当前快照也移除已知嵌套凭据、设备态和头像字段，并对识别到的明文凭据及绝对机器路径模式失败关闭。需要报告嵌套排除数，禁止转移源环境的会话与运行令牌。待确认删除由目标重新授权。 [逐表字段白名单](../../../resources/app/device-migration-snapshot-schema.json)

首版 `omittedDomains` 固定使用以下条目。行记录已覆盖而附带机器状态未覆盖时，仍应显示排除事实。

| id | reason | 处理 |
| --- | --- | --- |
| `native-auth-and-device-profile` | `authorization-not-portable` | 拒绝原生/浏览器 Cookies、WebView profile、登录状态、DPAPI、API Key/会话 token、`connection.private`、分区与设备绑定。目标本人重新登录 |
| `native-account-index` | `rebuild-target-metadata` | 本地 `ws-accounts/accounts.json` 由 `WsAccountStore` 持有，包含设备本地账号索引；仅从已审核 SQLite 业务身份在空目标重建目标索引 |
| `native-pending-and-dead-letter` | `external-queue-contract-unverified` | `LocalQueue` 的 `pending.json` 和 `dead-letter.json` 各自保存 route 和原调用载荷，其中可能有凭据、机器路径或不宜重放的动作。第一批不复制；源端待处理计数只经本地队列所有者确认，恢复器不读原 payload。仍有未处理操作或计数无法核实时停止导出，请操作者先在源工作区明确处置 |
| `uncommitted-and-local-browser-state` | `outside-committed-source` | 浏览器持久本地态、未提交写入及 SQLite 外阅读规则与历史无已审核来源；保留提示 |
| `local-exports-and-logs` | `machine-local-artifact` | 旧导出产物、备份、日志、机器绝对路径、窗口设置和诊断缓存不迁移；导出历史仍可核对，但旧产物下载按钮不可用 |
| `non-ready-media-content` | `metadata-only` | available、pending、unavailable、deleted 素材保留索引和原状态；源未提供可核验字节证据，目标不合成文件 |
| `migration-history-and-active-leases` | `target-owned-runtime` | 目标 runner 生成自己的迁移历史；不继承或续用源端 Worker/AI claim、fence 或原生会话。保留可移植的业务级 checkpoint 与原状态审计 |

凭据判定以结构化应用来源和已知模式为边界。业务聊天和上传文件可以含未知自由文本，不承诺识别任意伪装的密钥或二进制机密。隔离实现必须拒绝被识别为设备/认证资料的素材及结构化字段，提供包前显示范围与失败位置，且不能将原值写日志。首次范围只允许侧车已按素材规则记录的文件，禁止打包任意路径或整个用户目录。 [本地队列](../../../desktop/src/Zhike.Desktop/Services/LocalQueue.cs) · [原生账号索引](../../../desktop/src/Zhike.Desktop/Services/WsAccountStore.cs) · [配置边界 RD02](RD02-authenticated-profile-boundary.md)

## 4. 空白目标恢复与任务冻结

1. **源头界定。** 确认源路径及角色，要求私有工作区锁、提交已经进入权威侧车的写入、暂停本轮新写与消费者，等待发送确认、采集及其他在途任务离开运行边界。授权未确认或原生 pending 非空时停止。单一 read-only SQLite 事务读取字段和验证关系；核对每件 ready 素材原文件身份、长度和 SHA-256。先从可移植清单工作，源库不重写、不改 schema，也不丢备份。
2. **单事务组装候选。** 导入鉴别版本并按认证格式暂存；在目标同卷独立私有候选目录由现有 runner 创建干净 025 库。显式选列、按允许依赖迁入，使用 deferred FK 或等价事务安全方式，不改 schema 或迁移历史。用已有 CRM 规则重建派生索引，校对主/唯一键、FK、账号归属、群事件链、原有历史软引用、附件 ID、媒体状态、SHA-256 和业务计数。候选内目标媒体路径按本地规范派生并落盘；无可做精确归属验证的数据留在暂存或拒绝，禁止默合并。目标具备 42 表复核、`integrity_check` 和 `foreign_key_check` 成功后方可运行方案下一步。
3. **历史与执行分离。** 恢复候选记录原 AI/outbox/采集/跟进/导出/发送状态及原尝试，目标有持久化导入冻结。检查所有入口均冻结，包括 Native queue drain、旧 renderer 自动读取、Sidecar AI 领取及恢复、Stage 4 Worker、热聊同步、群轮询、待发送队列和导出恢复。重启、登录、切号及接受数据均不自动解冻。禁止用清空租约后直接运行现有旧任务恢复来处理遗留 `running`。待恢复权威状态的批准、检查点续跑与适当风险范围另行审核。
4. **未知发送不可盲重试。** 保留原幂等键、计划指纹、attempt ID/phase、`deliveryState`、`observedUnknown`、`safeToRetry` 和每个 attachment 状态。据现有 retry 条件，既有 `sending`、已尝试、unknown 或表现未知的旧审计应继续拒绝；失去关键证据时按未知处理。导入时持久冻结还覆盖原 `queued` 和确证失败可重试状态。恢复以后不生成新计划绕过同一尝试，人工核实或明确任务恢复合同生效后才考虑执行。媒体缺失时无发送权限。 [当前服务与发送规则](../../../resources/app/server.mjs)

## 5. 整代发布与持久恢复记录

现有侧车按 `ZHIKE_DATA_DIR` 开启 `workspace.sqlite`，素材位于同一根的 `ws-media`。当前启动管理器尚无代次路由。未来 v2 仅对显式选定的独立目标控制根作业，在其本地同卷私有目录持有跨进程锁。业务库、媒体和重建后的本地账号索引归同一个 generation ID；老代和候选代不覆盖彼此。SQLite/媒体各自的原子操作不能代替整代发布。候选库关闭前归并 WAL、回读校验，不拿正在运行的虚拟文件或不成套 WAL/SHM 当备份。 [当前侧车启动管理器](../../../desktop/src/Zhike.Desktop/Services/LocalServiceManager.cs) · [当前 DB 与素材路径](../../../resources/app/server.mjs)

**控制根内的私有记录，包内无此记录**

- `active.json` 包含 `recordVersion=1`、`sequence`、`generationId`、`operationId`、`gate="frozen"`、`checksum`。它只引用控制根内的 ID，固定位置、稳定同卷，通过经 Windows 故障注入验证的原子替换和持久化写入。无有效记录或指定代次不可解析时拒绝打开业务库。禁止由单个媒体文件名或目录列表猜测当前代次。
- 用双槽保留两个最新有效的切换记录，字段为 `recordVersion=1`、`sequence`、`operationId`、`packageId`、`manifestSha256`、`sourceSchemaVersion`、`previousGenerationId`、`candidateGenerationId`、`candidateInventorySha256`、`phase`、`updatedAtUtc`、`errorCode`、`checksum`。摘要覆盖其余规范序列化字段，用于检测中断/截断，无法替代私有目录权限。候选清单摘要覆盖 SQLite 关闭后文件的尺寸及 SHA-256、业务逻辑行摘要、目标账号索引摘要和按逻辑 ID 排序的媒体摘要。其文件级核验先于首次启动，启动后用业务逻辑与媒体清单做归属对账。切换记录中的路径由已验证顶层及 ID 派生；PID、密码、原机器路径、原聊天、ID 明细和凭据不进入记录。
- 顺序约束为保存基线与候选清单 → 持久写 `PREPARED` → 持久写 `ACTIVATING` → 原子替换并复读 active pointer → 持久写 `ACTIVATED` → 在冻结下检查启动可读性、SQLite、账号范围和资产摘要 → 记录 `ACCEPTED`。`ACCEPTED` 表示隔离数据恢复验收完成，导入任务仍冻结。切回前写 `ROLLING_BACK`，回读旧代后写 `ROLLED_BACK`。原子替换、写入和持久化具体 Windows 实现需要另行开发验证。
- 切换前的可回退副本保留在同卷私有旧代，独立核验库与对应媒体目录整代有效。候选目录和暂存失败只移除确认为本次创建且未成当前根的文件。已验收后如果发生业务写入，后续回退须先做本代新备份与变更归属审阅，禁止无提示丢掉新写。

| 重启读到的状态 | 行为 |
| --- | --- |
| 无切换记录，或 `PREPARED` 且 pointer=旧 | 继续旧代且保持本轮冻结，候选可复检后明确继续。恢复前失败可撤消候选，基线无写入 |
| `ACTIVATING` 且 pointer=旧 | 切换未完成。保持旧代可检查，持久记录恢复停止点；仅在复验后重新激活 |
| `ACTIVATING` 或 `ACTIVATED` 且 pointer=候选 | 保持冻结，复验候选全套数据与媒体；用户确认前不开放后台或业务写入。冻结判定必须早于旧侧车启动 housekeeping 与 Native replay；记录无法核实时禁止启动。校验失败走已验证的旧代回切 |
| `ROLLING_BACK` | 复核前置旧代，pointer 在候选时重试回切，已指向旧代则完成复检后记录 `ROLLED_BACK` |
| `ACCEPTED` 或 `ROLLED_BACK` | 根据 valid pointer 观察已选代；保留冻结及审计，是否解除冻结听从后续审批 |
| 记录损坏、两个槽均无有效版本、pointer/phase 矛盾或路径/资源身份无法确认 | 两代均保持原样，拒绝启动 sidecar、任务和清理；保全只读证据，由操作者复核选定代次。自动恢复不得从文件时间猜测 |

`sequence` 在控制根锁下递增且不可倒退。读者取最新有效记录及可关联的前一有效记录，检查 pointer 与作业 ID 是否匹配。旧代保留期限及清理授权需单独决定；在验收或回滚未结案前始终保留。

## 6. 验收矩阵与审批

| 故障注入及场景 | 放行标准 |
| --- | --- |
| 格式、认证与资源上限 | v1/v2/旧 JSON 进入正确路径；未知版本、错密、帧交换、重复帧、截断、多余帧、超量和 manifest/ledger 编造覆盖一律拒绝，原文件和当前代不变 |
| 来源与真实约束 | 按真实 025 重建夹具。双账号同外部 ID、CRM 当前态与历史、022/023 关系、024 审核、025 correlation ID 核对。出现 schema 漂移、晚期二级唯一冲突、坏 FK 或账号串链时事务回滚，初始空白目标复验无部分写 |
| 媒体、敏感信息及权限 | ready 字节和引用验证通过；注入素材丢失、同大小换字节、软/硬链接、junction、路径穿越、并发重命名和 ACL 错配均硬失败。扫描写入日志、包与暂存，合成凭据、Cookies、API Key、设备路径和已知目录拷贝触发排除/失败 |
| 持久化和崩溃窗口 | 在写候选 DB/WAL、落盘媒体、写 `PREPARED/ACTIVATING`、替换 active 前/后、写 `ACTIVATED`、UI 首次启动、写 `ACCEPTED` 以及回切前/后强制中断。覆盖短写、磁盘满、权限拒绝、文件锁、损坏 pointer 或记录槽与多进程竞争。每次都验证启动要么得到同一代完整库和媒体，要么冻结拒绝；旧代可核验且无部分发布 |
| 跨设备和运行门禁 | 至少两个隔离 Windows 数据根最终包含干净设备/VM的实际恢复；按相同验收查表、附件哈希和文件访问，无登录 profile。重启后实测旧发送 unknown 仍挡重试，Native queue、旧 renderer、Worker/AI 和各 WS 自动入口未启动。真实 WS、AI 服务或生产变更仍须另外授权 |

**已获批准的唯一近一步**为上述 v2 独立格式、首版 `partial` 声明、限值和空白目标流程，在合成数据与隔离目标上实现及故障注入。具体边界如下。

1. 接受可移植 SQLite 数据与核验附件先交付，原生外部队列、登录态及不可核验域保持排除，并在产品给出覆盖提示。
2. 接受首版仅限空白目标、严禁自动合并、保留旧代且回退时先核验，接受恢复后的任务持续冻结，未知发送继续禁止重试。
3. 批准相关格式与隔离适配实现。生产入口开放、已有目标替换或合并、运行任务恢复、真实账号与外部数据均留待下一次单独审批。

如需迁移原生外部队列或已有目标，先补该来源的字段与关系、待执行重放边界、冲突规则和回滚演练，再另送审批。已实现包层隔离入口及真实临时库往返。当前包层改动未接服务、未修改迁移历史/业务入口，也未访问生产数据。

### 已实现的包层隔离边界

- 写包与解包需要通过由程序创建并验证的当前用户专用临时根，明确指定该根内的源、目标与暂存父目录。Windows 实际创建受保护 ACL 并回读验证；本轮测试改变该临时目录的 ACL 且确认拒绝。目录或文件身份、链接、外部路径、缺失标记和错误标记均拒绝。
- 源由隔离调用方先关闭并盘点。写包时独占同一侧车工作区锁，存在活跃或未处置的锁、回滚日志或非空 WAL 时拒绝；已验证的空闲 WAL/SHM 保留。仅从已核验的单链接源文件句柄流式复制到本轮私有隔离目录，使用只读 SQLite 检查点副本生成账本，产包前安全清理副本，完成写包前再次核对源和锁身份。真正的进程强制中止仍可能留下隔离明文副本及锁，需保全现有对象，不能从路径重新认领清理。本轮验证已知并发替换及锁竞争，无源库写入、原生队列权限、服务关闭或生产执行入口。
- 已复用原 v1 加密帧及受控清理机制。v1 默认入口只认 v1；隔离版通用读入口在受控文件句柄上选择一次版本，认证错误不切解析器。解包对象绑定本轮记录的暂存身份，目录被移动、替换或身份丢失将返回 `CLEANUP_PENDING`，不从新路径重新领用文件。
- 已验证 v2 实际写包与解包、两账号 42 表、CRM 对象字段、素材多帧、覆盖篡改、缺素材、媒体摘要、帧交换及旧 v1 兼容。共享当前引擎的路径身份复核不能阻止同权限外部进程在检查与操作之间竞争；隔离根只批准本轮控制使用。 [v2 包层测试](../../../tests/device-migration-package-v2.test.cjs)