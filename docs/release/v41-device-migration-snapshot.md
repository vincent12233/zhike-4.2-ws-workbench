# V4.1 设备迁移 SQLite 快照与恢复评审

本次交付是独立的 schema 025 **只读快照导出器、校验器和 v1 包兼容投影**。默认仍为 `partial`。正式入口和恢复保持 FROZEN。代码和测试使用临时 SQLite、合成业务及附件。 [导出与校验](../../resources/app/device-migration-snapshot.cjs) · [逐表字段及外键白名单](../../resources/app/device-migration-snapshot-schema.json) · [临时库测试](../../tests/device-migration-snapshot.test.cjs)

## 权威表和范围

仓库的现有迁移清单从 004 起。004 与 012 是标记迁移，仓库没有独立的 001–003 文件。019 把兼容的 CRM 基础表写入迁移权威，020 单列 AI 队列，021–025 是后续身份、群、AI 审核与链路审计。真实 runner 在空库应用 22 个迁移版本，得到 42 张业务表和 `schema_migrations`。后者以及 SQLite 内部结构由目标迁移 runner 管理。 [迁移清单](../../resources/app/migrations/manifest.json) · [迁移版本与校验实现](../../resources/app/migration-runner.cjs)

| 权威来源 | 表及字段范围 | 关系、留存与恢复注意事项 |
| --- | --- | --- |
| 004 / 012 / 019 · CRM 当前态、历史及索引（3 张） | `app_state`、`state_snapshots`、`customers`。JSON 保留客户、标签、保存视图、报名、票据、入金、跟进、号码登记、批次、运营任务、渠道别名和质量决定等现有形状 | `app_state.json` 是 CRM 权威，`customers` 为同事务派生索引。校对当前记录 ID 与派生业务正文，保留软删和业务独立记录，恢复需由现有规则重建并对账索引。历史保留原 ID、时间、原因与净化后的 JSON |
| 010 / 021 · 治理、删除及身份（4 张） | `ai_customer_field_evidence`、`customer_governance_actions`、`customer_delete_requests`、`crm_identity_conflicts` | 保留人工证据、动作前后值、删除模式与历史状态、冲突客户 ID 列表。不携带删除确认口令哈希；目标重新授权旧待确认请求。当前客户的活动手机号唯一性由 schema 021 索引验证 |
| 005–009 / 014 · WS 对话与历史（9 张） | `ws_settings`、`ws_conversations`、`ws_messages`、`ws_ai_analyses`、`ws_replies`、`ws_ingest_batches`、`ws_collection_runs`、`ws_collection_items`、`ws_followup_alerts` | 会话是本地联系人的来源。保留 account、conversation、external ID、批次、翻译状态、消息顺序、幂等键、提醒状态、采集覆盖和 checkpoint/cursor；无来源证据不补造。可历史保留已删除来源的引用 |
| 008 / 013 · WS 账号（2 张） | `ws_accounts`、`ws_account_settings` | 抽取同一事务中的所有账号及业务设置，校验全局账号 ID 与大小写冲突。剔除原 origin 和 partition key；源运行状态仅用于历史参考，恢复需目标重连并重新验证 |
| 011 · 热聊档案、字段与 outbox（4 张） | `hot_chat_profiles`、`hot_chat_profile_fields`、`hot_chat_events`、`hot_chat_sync_outbox` | 保留人工颜色、锁、字段证据、修改历史与同步任务状态、重试计数、幂等键。校对 profile/event/account。档案是业务资料，原生登录资料另有所有者 |
| 015 / 017 / 022 / 025 · 监控席位、入退群、关系和目录（6 张） | `ws_group_monitor_profiles`、`ws_group_monitor_targets`、`ws_group_membership_events`、`ws_group_monitor_checkpoints`、`ws_group_catalog`、`customer_group_memberships` | 保留席位及目标、群和渠道、观测/来源时间、来源事件、幂等、成员身份、人工锁、是否审核/应用与相关 ID。当前关系由 022 保留，既有事件不应重新播放以重算关系。检查事件 profile/target/group 一致 |
| 023 · 群管理历史（6 张） | `ws_group_members`、`ws_group_sync_runs`、`ws_group_messages`、`ws_group_read_evidence`、`ws_group_sync_errors`、`ws_group_audit` | 保留 member/message/group/account 键、处理状态、同步失败/重试、未知阅读状态、原始证据和审计。未知阅读不能解释为未读或已读；清单未声明 SQLite 外阅读规则或本地 UI 历史的迁移覆盖 |
| 016 / 018 · 发送、素材、附件、导出历史（4 张） | `ws_send_audit`、`ws_media_assets`、`ws_send_attachments`、`ws_export_jobs` | 一条发送审计可有多附件，每条附件引用一致账号的审计及素材。审计 `attachment_ids_json` 为素材 ID，兼容较旧的只有素材 ID 清单且没有附件子行的历史。保留尝试 ID、阶段、状态、`observedUnknown`、`safeToRetry`、计划指纹、幂等键及附件状态。保留 unavailable/deleted 素材行和原因；不恢复源文件路径与导出产物 |
| 020 / 024 / 025 · AI 流水线（4 张） | `ai_jobs`、`ai_crm_suggestions`、`ai_job_evidence`、`ai_task_audit` | 保留 job、来源会话/群/消息/事件、审核值及决定、审计、业务 checkpoint/result ref、幂等、重试、原队列状态与 correlation ID。排除三类运行租约字段 `lease_token`、`worker_owner_id`、`fencing_token`。AI 分析正文仍由 `ws_ai_analyses` 所有 |

独立 SQLite 连接设置 `readOnly` 与 `query_only`，在一个读事务中做首个快照读取、schema 025 和全部指定表/FK 检查、显式选列、同账号及关键业务关系校验。版本、表、字段或外键偏离审核版 025 时明确失败。行校验拒绝未知字段、无效类型、重复主键、虚报覆盖、断裂外键、可解析但跨账号的历史来源、错误关联和危险的未知发送重试状态。当前校验器不复刻所有 SQLite CHECK 与二级唯一索引；恢复候选的最后预检仍由目标同版 SQLite 完成。WAL 用例在导出读到 CRM 后使用另一连接更新 CRM 与账号两处，再证明两次导出分别获得完整旧代和新代。

`storage_path` 仅在源事务内比较服务规范的 `ws-media/<账号目录>/<媒体ID>`。业务快照中只保留素材 ID、大小、SHA-256、状态、归属与关联。v1 调用现有引擎，以从账号和媒体 ID 派生的相对路径打开素材，以快照中大小/SHA 校验字节。数据库读取本身可一致，文件系统独立于 SQLite。在读后遇到丢失、替换或不同字节的 ready 素材，现有引擎拒绝产包。此轮没有冻结外部文件写入，也没有把业务素材作为提交附件。

列白名单排除机器分区和路径以及凭据、来源删除口令和活跃租约字段。已知嵌套凭据、浏览器配置、持久化登录、二维码和头像字段不进入投影，记录删除字段数量。已知明文凭据及绝对路径语法令导出失败。自由文本和用户上传素材可以包含无法识别的信息，当前规则只能证明结构化应用凭据、已识别字段和模式的排除。源设备的 WebView profile、Cookies、DPAPI 等密钥、API Key、`connection.private`、原生账号索引、`queue/pending.json` 和 `queue/dead-letter.json`、浏览器本地态与设备配置均没有读入。 [包引擎](v41-device-package-engine.md) · [原生持久队列源码](../../desktop/src/Zhike.Desktop/Services/LocalQueue.cs) · [原生账号索引源码](../../desktop/src/Zhike.Desktop/Services/WsAccountStore.cs)

## 接口、可移植性与验证

| 接口 | 契约 |
| --- | --- |
| `exportDeviceMigrationSnapshot(databasePath)` | 调用方显式传入绝对 SQLite 路径。返回 `schemaVersion:25`、覆盖、全部白名单表和净化后的业务数据。64 MiB 行投影上限 |
| `validateDeviceMigrationSnapshot(snapshot)` | 供可信调用方独立预检同格式对象，失败抛有分类的错误；不会改数据或打开目标库 |
| `projectDeviceMigrationPackageV1(snapshot)` | 输出 v1 引擎接受的 CRM/账号分片和 ready 素材索引。当前 CRM `channelAliases` 与 `qualityDecisions` 均为对象，v1 定义要求这两个入口为数组，兼容投影保留它们在原 ledger 中并从 v1 顶层省略。原生账号设置、较新账本、附件明细、事件语义扩展及 CRM 历史等超出 v1 已支持结构。本接口生成迁移包侧部分投影，旧 JSON 的导入处理仍按旧契约 |
| `writeDeviceMigrationPackageV1({databasePath,destination,password})` | 复用现有 `.zkdevice` v1 引擎封装，仍受 32 MiB 快照、24 MiB 单件、2 GiB 总包上限。实际产包覆盖始终 `partial` |

使用主仓随附 Node.js v24.22.1 在独立 worktree 运行 `node --test tests/device-migration-snapshot.test.cjs`。七个用例均通过。除源文件只读核对、42 表运行时对账和加密包/媒体往返，具体验证了并发快照、篡改 coverage、跨账号引用、未知发送重试、保留旧素材引用及附件被修改时拒绝产包。临时 SQLite 探针把投影写入同版隔离目标，晚发现发送二级幂等键冲突时整笔回滚，空白目标的默认账号恢复，CRM 和审计无部分写入。随后正常候选的完整性、FK、投影业务行往返通过，迁移历史仍由该测试目标自己的 22 条记录管理。探针不发布媒体、不启动队列、不连接 WS 或 AI。 [可复现实验](../../tests/device-migration-snapshot.test.cjs)

## 待审批的应用与回滚方案

1. **先批准独立目标导入。** 使用全新或确认空白的工作区作为第一个受支持目标。旧 JSON 和 `.zkdevice` v1 严格保有各自格式与现有入口，展示旧包/旧备份实际覆盖。完整 ledger 需要单独审批新版包内版本和经过认证的固定 schema、表级计数、摘要、媒体关系清单、排除规则。读取老 schema 只允许隔离副本由现有 runner 升级，再做 025 导出与校验。高于已知版本、校验和历史冲突或缺迁移路径均明确拒绝。
2. **停任务并预检。不改现用库。** 暂停入口写入、队列、WS 采集与 Worker，等待唤醒任务退出；持有已有工作区锁。导入由用户选定包、目标、模式，显示元数据摘要、冲突档和需要重新授权的事项。先验认证、大小和路径，再解包至仅当前用户的目标同卷暂存。通过目标 runner 建新库，在一个事务中迁入数据，由权威 CRM 重建派生索引，并用真实 SQLite 验证唯一、外键、检查条件、计数和摘要。共享外部 ID 都按完整账号上下文确认。
3. **将任务恢复和执行授权分开。** 原状态及时间作为迁移历史。未知/已尝试发送的 idempotency key、计划指纹、attempt/attachment 结果永久挡住盲重发。需要对真实接收结果人工复核时必须单列。当前旧状态预计能被 Worker 重新扫描，因此必须先决定如何保留其历史同时挡住自动认领。丢弃旧领取授权，保留业务 checkpoint 和历史，管理人员重新启用或取消排队任务。AI 审核保留已处理决定且不再应用。待删除 CRM 请求由目标重新确认，导出历史的源输出缺失不自动变成已下载，账号需要重连，验证前禁止发送和自动任务。
4. **将素材与数据库作为同一代发布。** 用目标账号布局重建路径。所有 ready 素材必须从认证暂存区按 ID、大小、摘要核对并落盘，保留不可用和删除墓碑；不要用覆盖旧文件修复缺索引。批准后在同卷用版本目录和独立持久化切换记录发布数据库与素材同一个工作区代次。启动前做 integrity/FK、字段/行版本和资产文件摘要复核。SQLite COMMIT 或逐文件 rename 自身只覆盖其各自边界。必须先在隔离目录演练异常、磁盘满和断电点，验证恢复依据、旧代仍可回退。
5. **回滚前提与合并限制。** 保留旧工作区代次（库和对应 WAL/SHM 的一致副本、素材及运行前状态）。启动失败、指标或校验不一致时，停新工作区并按持久记录回切旧代，再核验完整性和任务状态。已对外发出的动作无法靠数据库回滚撤销，因此确认切换成功前保持任务冻结。现有目标合并单独审批，先只产 dry-run 差异，采用账号/外部标识映射与明确的手机号、ID、幂等及墓碑规则，拒绝自动去重、覆盖锁或复活旧删除。原生唯一队列、浏览器业务规则或旧设备的待写状态需由其所有者提供可审计移植契约，之后再扩覆盖。
6. **审批验收。** 多账号隔离机器间往返核对，包括 CRM 客户轨迹、群 015/022/023、AI 审核 024、025 关联 ID、附件完整性、待核实发送重启后仍挡重试、失败回滚和旧 JSON 可用性。审批前保持 `partial`，生产入口保持 FROZEN。 [RD03/RD04](risk-register.md) · [现有备份契约](business-contract-baseline.md)
