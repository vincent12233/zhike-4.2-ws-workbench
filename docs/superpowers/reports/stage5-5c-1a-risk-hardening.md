# 知客 6.1 A+B — 阶段 5.5C-1A 基础风险验证与最小修复

日期：2026-11-17（Asia/Calcutta）。

**Gate：Passed（本报告限定的隔离基础风险修复范围）。生产入口：FROZEN。阶段 6 暂停；没有启动 F01–F14 新功能开发或生产启用。**

## 1. 基线、环境与范围

- 分支：`ui/zhike-61-stage55a-workspace`。
- 开始 HEAD：`fa4ced4`；历史业务代码提交 `73e9c32` 已核实存在，开始工作区干净。
- 已读取完整 `stage5-5c-feature-inventory.md`，按第 6 节验证 R01–R09。
- 本轮代码提交：**`39ac33c9113449c0492685b8de728c130733cf8e`**，21 个文件；报告与证据单独提交。
- Windows 10.0.26300 x64；Node 与随应用 Node 均为 24.22.1；.NET SDK 10.0.100；WinUI Release x64/win-x64。
- 迁移最高仍为 **025**。全部历史 SQL、manifest/checksum、WorkerFeatureFlags、WorkerRuntimeController、队列适配器及 fencing gate 均未修改。
- 仅使用临时 SQLite、合成消息/媒体、临时 DPAPI 凭据及明确隔离的 transport/session/Core 适配。没有打开生产 SQLite、真实密钥配置或登录 profile；没有真实 WhatsApp、付费 AI、正式 Worker 或新旧消费者双写。
- 本轮不是原生 WhatsApp 交互或新功能平台验收。下文 C# handler、DOM/Bridge 测试均准确说明执行方式，不冒充真实前台聊天。

## 2. 先复现，再修复

风险来源是静态盘点；本轮没有把它们描述成已发生的生产故障。

| 隔离复现组 | 修复前实际结果 | 证据与限制 |
| --- | --- | --- |
| Sidecar API/SQLite/文件 | 首批 0/8；后加证明一致性检查时 14/16 | `stage55c1a-evidence/api-before.txt`、`api-proof-before.txt`；真实临时 sidecar 与 SQLite/文件 |
| 发送 UI 函数 | 首批 1/6 | `ui-before.txt`；执行生产函数，延迟 transport 明确为测试替身 |
| Native handler | 首批 2/13 | `native-before.txt`；提取实际 handler 编译，session/API/Core 为隔离适配 |
| DOM/Bridge | 首批 2/15 | `dom-before.txt`；执行产品内嵌脚本/Bridge，DOM 为隔离适配 |
| DPAPI 配置 | 首批 1/7 | 本轮原始终端执行记录；当时未保存日志文件，不重造 baseline 日志 |
| Provider 切换 | 首批 0/5 | 本轮原始终端执行记录；同样未保存 baseline 文件；最终日志已归档 |

初始 UI 的跨账号请求测试本来通过：实际 `api(context)` 会用捕获账号覆盖请求体账号。最初测试替身未模拟此行为时产生的误报已纠正，再保存 1/6 结果。**未将这个替身错误当成生产串号故障**。R06 真正复现的是 Native 异步等待后的前台资格缺口；另外加强迟到 UI 回报及未知结果保护。

后续补充了新回归用例，不能把最终全部用例数当成初始失败数量。最终各组实际结果见第 5 节。

## 3. R01–R09 逐项结果

### R04（P0）媒体文件与数据库引用一致性 — 已复现，已修复

- **根因：** 删除仅检查非 failed/cancelled 引用；随后先删文件，再删受外键约束的行。临时数据库复现中，失败附件引用导致删除返回错误，文件已消失而行仍存在。
- **修改：** `resources/app/server.mjs`。
- **最小修复：** 在事务中检查所有状态附件及旧审计 JSON 引用；有引用一律拒绝。无引用时用已有 `status=deleted` 和 JSON 删除元数据保存墓碑，再清字节。GET/HEAD 对已停用媒体返回 410；上传去重不恢复墓碑。
- **失败恢复：** 数据库拒绝墓碑写入时原文件保留；文件清理失败返回 202 + `cleanupPending`，保留路径/行以追踪，不谎称物理删除完成。只允许明确重复 DELETE 重试，没有新后台清理消费者。
- **新增测试/结果：** API 专项覆盖 queued/sending/sent/failed/cancelled、旧 JSON 引用、数据库 trigger 拒绝、文件清理拒绝、清理后数据库更新失败和重复清理；最终全部通过。
- **未解决范围：** 当前是可恢复逻辑删除，不是垃圾回收/素材库功能；磁盘或文件系统本身损坏不在本轮保证范围。

### R06（P0）异步发送账号资格复核 — 已复现，已修复

- **根因：** 媒体 await 后直接执行已捕获 Core；未重新验证取消、账号切换/回切、会话或 Core 替换、前台窗口状态。
- **修改：** `LegacyUiHostPage.xaml.cs`、新增 `Services/WsSendOperationGuard.cs`、`LegacyBridgeScript.cs`，以及前端回报保护。
- **最小修复：** 发送票据绑定单调 revision、账号、generation、session/view/Core 身份；在读取媒体之后和 dispatch 之前复核。A→B→A 也不能恢复旧授权；路由/隐藏/关闭/导航/重连等使票据失效。没有创建、销毁或重复导航聊天 Core。
- **迟到回报：** 原账号审计仍使用捕获的 context；新账号 UI 只能由当前 context 与同一 broadcast 对象更新。取消不伪装成撤销已 dispatch 的动作。
- **新增测试/结果：** 实际产品 handler 隔离编译运行 18/18，覆盖取消、切号/回切、实例/generation 变化、关闭/隐藏、异常、迟到结果；真实 WinUI 编译最终通过。UI 14/14 中另有账号所有权与授权期间切换用例。
- **未解决范围：** 一旦 ExecuteScript 已调用，不能保证撤回浏览器中已经发生的动作，结果不确定时记录 unknown；真实 WhatsApp 下的交互行为为 **Unverified**，本轮禁止连接。

### R08（P0）API Key 配置损坏与并发修改 — 已复现，已修复

- **根因：** 损坏/解密失败被折算为空配置；读、修改、写分别持锁，多实例可能覆盖另一 Provider 更新。
- **修改：** `Services/AiBridgeService.cs`；扩展 `desktop/tests/AiBridgeCredentialRuntime/Program.cs`。
- **最小修复：** 继续唯一的 DPAPI 当前用户存储。每实例 async gate 加同路径 OS 文件独占锁，覆盖读取、全部既有密文校验、修改和原子替换；只有文件不存在才初始化。
- **错误与保护：** 区分 CORRUPT/UNREADABLE/BUSY/IO，错误文本不包含密钥或文件内容；损坏、取消、替换失败不覆盖原文件，清理本轮暂存密文。不写业务数据库或新建第二套密钥存储。
- **新增测试/结果：** 最终 11/11，包含损坏 JSON/null/结构、无效 DPAPI、多个 Service、两个真实 OS 进程并发、12 轮竞争、锁等待取消和替换失败后的原 hash/暂存保护；网络调用为 0。
- **未解决范围：** 第二个 Windows 用户产生的有效密文跨 SID 拒绝未在本轮重建环境，标 **Unverified**；已真实验证当前用户下无法解密的输入被拒绝且不覆盖原文件。没有承诺跨设备复制密文可用。

### R01（P1）发送计划指纹完整性 — 已复现，已修复

- **根因：** UI 指纹未包含附件/caption/语言；服务命中 key 后直接恢复旧计划。
- **修改：** `ws-workbench.js`、`server.mjs`。
- **最小修复：** UI 根据本次最终有效请求计算 v2 key，包含目标、原/译文、语言、类型、caption 与有序媒体。服务对规范化完整计划做 SHA-256 内容核对：同 key 同内容恢复，不同内容 409，不能悄悄使用旧附件。旧记录按已有内容校验，不执行回填或重写历史迁移。
- **新增测试/结果：** 改附件、caption、语言等冲突、目标逆序等价、旧记录及最大长度 key；UI 指纹与实际翻译后请求；API/UI 均通过。
- **未解决范围：** UI hash 不是安全权威；服务完整内容校验才是冲突拒绝边界。

### R03（P1）附件部分执行与未知结果 — 已复现，已修复

- **根因：** click 后 `ok:true` 被视为已发送；多附件最后整体确认，部分失败可能被整项重试；未知与明确失败混用。
- **修改：** `server.mjs`、`ws-workbench.js`、Native handler 与 Bridge。
- **最小修复：** 复用同一 `POST /api/ws/send`，加入 `action=begin-attempt`。事务先持久化 prepared 意图和 attemptId，再调用既有人工确认 Native 路径；没有第二消费者或自动群发执行器。
- **逐项处理：** 逐附件用真实附件行 ID 保存结果，再处理下一个；实际发送每行已冻结 caption。部分动作已发生而后续失败，整项为 unknown，不能重发前面的附件。旧/缺失/矛盾证明不能升级状态；确定 preflight 失败需一致的 failed、ok=false、dispatchAttempted=false 和未尝试证明。
- **未知与迟到：** 授权/确认回包丢失、执行异常或执行后取消均保守阻止重试；旧 attempt token、重复 begin、已完成后的迟到改写拒绝。旧布尔 `nativeConfirmed` 单独不能证明本地动作，兼容记录为 unknown，不生成伪确认回复。
- **新增测试/结果：** 5 并发 begin 仅一个成功、错 token、逐附件部分失败、重启 prepared 仍阻止重发、矛盾证据、无可信平台回执拒绝、重复点击、回包丢失和迟到账号回报；API 16/16、UI 14/14、DOM/Bridge 16/16、Native 18/18。
- **未解决范围：** 本轮没有平台回执适配，无法证明平台接受或送达；不提供 unknown 的自动对账/重发功能，须先核实平台记录。这不是缺省成功，更不是新群发功能完成。

### R07（P1）AI 查询副作用 — 已复现，已修复

- **根因：** 进入旧 `/api/ws/ai-jobs` 后、判断 GET 之前恢复过期 running；刷新也会写，且可能影响新 Worker 所有权。
- **修改：** `server.mjs`、旧消费者的 `resumeQueuedAiJobs` 调用及原队列兼容测试。
- **最小修复：** GET 纯读；恢复改为旧消费者明确 POST `action=recover-expired`。仅当前账号、无 Worker owner、fencing=0、无新关联标记的旧任务可恢复；保留新任务的所有权与 lease。界面导航/仪表不触发恢复。
- **新增测试/结果：** GET 前后数据不变、显式恢复、跨账号及 Worker/correlation 任务保护、旧 restart/backoff 队列行为；专项与全量通过。
- **未解决范围：** 没有启用新 AI consumer、执行新旧队列切换或付费 AI。

### R09（P1）Provider 快速切换竞态 — 已复现，已修复

- **根因：** 状态/模型响应缺少弹窗/Provider 代次所有权；临时输入和迟到操作可能影响后来页面。
- **修改：** `gpt-assistant.js`。
- **最小修复：** 弹窗/Provider/操作 generation；切 Provider 即清临时密钥，状态未确认禁止保存；所有异步成功/失败核对当前持有者。保存/删除单飞，关闭后不谎称已取消已提交修改；迟到完成不能关闭或覆盖其他弹窗。
- **新增测试/结果：** 实际前端事件及延迟 bridge 11/11；旧 5.5B 设置兼容专项与最终全量通过。覆盖状态/模型目录迟到、错误、关闭/重开、单飞与损坏存储。
- **未解决范围：** 测试 bridge 为明确的隔离替身，没有实际密钥输入、付费请求或原生窗口手动操作。

### R02（P2）计划数量与节流边界 — 已复现，已修复

- **根因：** UI 可选 50，服务按 20/60 秒对整个计划预扣；创建 30 目标即 429，且未与 Native 尝试对应。
- **修改：** `server.mjs`，由现有 UI 接授权动作。
- **最小修复：** 创建计划不消耗发送额度；begin-attempt 按文本或附件数量预留本次本地尝试预算，事务成功后记账。并发授权仍只有一个 token。
- **新增测试/结果：** 30 目标计划成功、不扣尝试额度；账号独立、20/60 边界、超限不调用 Native；专项通过。
- **未解决范围：** 这是进程内本地策略，包含授权后未最终发送的尝试；不承诺跨重启/跨设备统一额度，也不等于平台官方限制或风控验收，平台行为 **Unverified**。

### R05（P2）媒体大小与类型契约 — 已复现，已修复

- **根因：** UI/Native 约 24 MiB，上传接受 64 MiB；声明 MIME/扩展不是内容安全证明。
- **修改：** `ws-media-core.js`、`server.mjs`，复用现有 UI/Native 边界。
- **最小修复：** 本地单件统一 24 MiB，计划引用也检查既有大文件；增加可执行扩展/签名和脚本入口的基本筛查，避免明显伪装文件仅靠 MIME 通过。
- **新增测试/结果：** 大小边界、既有超大资产引用、伪装可执行/脚本、允许类型的既有媒体回归通过。
- **未解决范围：** 不是全面文件格式验证、杀毒或平台类型支持证明；真实 WhatsApp 格式可接受性为 **Unverified**，没有把它写成正式平台能力。

## 4. 发送状态契约

既有表 status/check 约束不变，细粒度语义放在已有 `native_result_json` / 附件 `data_json` 中；对外 DTO 提供 `deliveryState / attemptId / attemptPhase / retryAllowed`。queued 是尚未授权的计划状态，不混同以下五种结果。

| deliveryState | 证据含义 | 本轮处理 |
| --- | --- | --- |
| local_attempted | 有一致的本地动作确认 | UI明确“本地已尝试，平台结果待核实”；不盲重试 |
| platform_accepted | 可信平台已受理 | 本轮无可信来源；伪造升级返回422 |
| delivered | 可信平台送达回执 | 本轮无可信来源；不把点击/旧sent当送达 |
| unknown | prepared后失联、部分执行、异常等无法排除外部效果 | 保留审计/附件结果，阻止重试 |
| failed | 有明确未执行的 preflight 证明且没有既有外部效果/未知记录 | 可重新人工确认授权；不能把部分执行降成全失败 |

Native失败数据仅白名单透传状态、未尝试证明和阶段，不转发任意 payload。API/页面不因 `ok:true`、旧 `sent` 或 `nativeConfirmed` 单一字段宣称平台成功。旧状态列保留兼容，并不意味着旧状态字符串本身可用作送达证据。

## 5. 实际执行与回归

主要命令：

~~~powershell
node scripts/run-tests.cjs stage55c1a
node scripts/run-tests.cjs stage55a
node scripts/run-tests.cjs ws
node scripts/run-tests.cjs all
.\.tools\dotnet10\dotnet.exe build desktop/src/Zhike.Desktop/Zhike.Desktop.csproj -c Release --no-restore -p:Platform=x64 -r win-x64 --nologo -v:minimal
git diff --check
~~~

| 项目 | 本轮结果 | 证据 |
| --- | --- | --- |
| 风险专项入口 | 6/6；最终完整回归再次覆盖全部对应实现 | `special-initial.txt` 是首次专项，不假装在WinRT修正后重跑；最终以full中的5个新入口及既有DPAPI入口核对 |
| API / UI / Native / DOM / DPAPI / Provider | **16/16、14/14、18/18、16/16、11/11、11/11** | 最终 `ws-final.txt`、`full-final.txt`；合计86个组内用例，非86个全部新增测试 |
| 账号/UI | **7/7** | `account-ui.txt`；最终full也再执行相关项 |
| WS初轮 | **154/156**，两项失败 | 完整原始日志在本机 `.tools/stage55c1a/ws.log`；SHA及失败名归档results.json，不复制巨大源码错误输出 |
| WS最终 | **156/156** | `ws-final.txt` |
| 项目全量最终 | **272/272** | `full-final.txt` |
| WinUI Release x64/win-x64 | **0 warnings / 0 errors**，21.45秒 | `winui-release.txt` |
| Worker / IPC / fencing | **Passed** | full中Supervisor IPC、lease接管/过期写拒绝、checkpoint原子性、BUSY/失败恢复及生命周期/token回归均实际执行 |
| AI / CRM / 多账号群组 / 024 checksum | **Passed** | full中旧AI恢复、Stage4候选/证据、审核批准拒绝/冲突、账号/群范围及历史024启动兼容实际执行 |
| diff/保护范围 | **Passed** | 无迁移/受保护Worker逻辑差异；暂存与工作文件检查通过 |

相对历史 WS151、全量267，增加 **5个注册测试入口**，所以最终156、272；还扩展了既有 DPAPI 入口及原有兼容断言，未删除或跳过失败测试。命令 `stage55c1a` 包含6个入口，其中DPAPI在既有full列表已经执行，因此full不重复注册。组内case数与runner检查数不能混加。

### 5.1 首轮回归失败及处理

1. 实际 WinUI 引用返回 `IAsyncOperation<string>`，Native隔离适配器原先返回Task，漏检两处lambda转换。首轮真实编译出现CS0266/CS1662及后续XAML错误。最小改为 `async () => await core.ExecuteScriptAsync(script)`；测试适配器改为非Task的awaitable，保留该编译约束。之后真实WinUI Release和最终WS/full均通过。
2. 原 `frontend-high-priority-fixes` 按“remove-key分支紧跟try”的源码形状断言；R09合并为带所有权检查的共享保存/删除处理函数。更新断言核对共享try/catch和迟到上下文保护，实际Provider事件测试继续验证失败反馈，没有删掉错误处理测试或吞异常。

没有增加超时掩盖失败，没有将无法验证的项目改成Passed，也没有以历史267结果代替本轮执行。

## 6. 修改与复用

产品文件仅8个：

- `resources/app/server.mjs`：现有计划/发送/媒体/旧AI路径内修复，不建立第二消费者。
- `resources/app/modules/ws-media-core.js`：统一本地边界及基本筛查。
- `resources/app/modules/ws-workbench.js`：完整请求指纹、现有手动发送状态/账号所有权、显式旧队列恢复。
- `resources/app/modules/gpt-assistant.js`：现有密钥弹窗的所有权和单飞。
- `desktop/src/Zhike.Desktop/Services/AiBridgeService.cs`：原DPAPI存储的校验/跨实例锁/原子修改。
- `desktop/src/Zhike.Desktop/Services/LegacyBridgeScript.cs`：WS错误元数据白名单。
- `desktop/src/Zhike.Desktop/Services/WsSendOperationGuard.cs`：新增小型发送资格票据。
- `desktop/src/Zhike.Desktop/Views/LegacyUiHostPage.xaml.cs`：接入票据与真实本地动作/未知状态。

测试/执行器：

- 新API：`tests/stage55c-send-media-api.test.cjs`。
- 新UI：`scripts/stage55c1a/ws-send-runtime.test.cjs`。
- Native/DOM：`scripts/stage55c/native-send-safety.test.cjs`、`native-send-dom.test.cjs`及其 `NativeSendSafetyRuntime` 项目/Program。
- Provider：`scripts/stage55c/gpt-provider-race-runtime.test.cjs`。
- 扩展DPAPI：`desktop/tests/AiBridgeCredentialRuntime/Program.cs`。
- 调整现有队列、广播、媒体和前端保护测试；注册入口在 `scripts/run-tests.cjs`。

21项完整文件及源码SHA见 `stage55c1a-evidence/source-hashes.json`，与代码提交Git blob逐项匹配。新增依赖、数据库迁移、正式消费者、F01–F14完整功能：均为0。

## 7. 证据、数据保护及遗留风险

证据目录：`docs/superpowers/reports/stage55c1a-evidence/`。包含复现、首轮专项、最终账号/WS/full/编译原始输出、results、源码SHA及SHA-256清单。文本规范为UTF-8/LF，SID如出现则脱敏；清单同时记录原始日志hash和归档hash，不把规范化后的文件伪装为原字节。密钥模式及敏感JSON字段扫描通过。

R08/R09初始输出未落盘这一证据限制已在第2节声明。没有从后来的通过日志重建或冒充初始失败日志。

- P0三个本地风险均已在隔离环境复现并修复，相关最终回归通过。
- **Unverified：** 真实WhatsApp/真实WebView交互下的平台接受、送达、媒体支持和限流；另一真实Windows用户的有效DPAPI密文跨SID场景；本轮没有原生窗口手工验收或长时性能采样。
- 不虚构远端exactly-once；本地fencing及attempt不能撤销外部已发生动作。unknown保守锁定，无自动盲重试。
- 本地发送预算仍为进程内策略；媒体基础筛查不是杀毒；清理失败保留可追踪墓碑，只能明确重试。
- 历史桥接超时、WS启动/WMI延迟及首轮WS启动失败原因没有在本轮定位，继续作为既有残余风险，不宣称全项目零BUG。
- 新临时数据库/凭据由测试持有并在finally清理；Worker生命周期回归报告 matchingTestProcessesRemaining=0、temporaryRootClean=true，限定新增Native/凭据测试进程检查无残留。忽略目录`.tools`仅保留诊断日志/生成harness/编译输出，不声称已删除。没有清理或访问既有用户数据/登录态。

本轮范围不包括真实平台能力启用，上述Unverified不被写作Passed。当前Gate只评价已授权的基础本地风险修复，不解除任何生产或新增功能门禁。

## 8. 回滚、Git与停止点

没有schema回滚或数据回填需要执行。稳定基线fa4ced4保留；若需撤销代码，可在受控分支审查 `git revert 39ac33c`，保持FROZEN并停止测试任务。**不得让旧发送实现自动消费新unknown/sending意图，不得删除审计、墓碑或凭据以绕过保护。** 若将来正式启用后需回滚，应另行审核运行数据影响，本轮不授权。

本报告及证据独立提交；交付前核验源码/证据SHA、`git diff --check`和干净工作区，最终回复提供报告commit。没有正式安装包、真实WS连接、生产SQLite迁移、正式Worker/AI消费者或新旧队列双写。

**阶段5.5C-1A Gate：Passed（隔离基础风险）。生产入口继续FROZEN；阶段6暂停；完成后停止，等待下一轮明确授权。**
