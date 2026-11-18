# V4.1 动态任务池与文件所有权

> 最新收尾位于 `upgrade/v41-completion-batch`，代码基线 `34951cc`。最终产品修复 `1dbab88`；最新全量 **297/298**、WS 包含子集 **164/164**、Release **0 warnings / 0 errors（19.90秒）**，唯一失败为主渲染 Edge 退出超时。前两轮295/298和292/298原样保留。设备包/导出专项12/12、3/3，最终KPI实际Edge8×20通过。十二页、十次切号、CRM三种审核、拖动、图表联动及关闭动效均有原生证据；三次运行分别15/15、21/21、9/9观察身份确认退出。最终窄窗原生及完整缩放矩阵仍未完成。**S3 Blocked，生产 FROZEN。** [本轮实现、失败与剩余范围](v41-completion-batch.md)。下文保留历史调度，不将旧结果当作本轮结果。

基线 eb94848；分支 upgrade/zhike-61-ab-delivery；当前 S3 BLOCKED，生产 FROZEN。用户两份 2026-11-17 总控指令是本轮范围；参考图不构成品牌资源、虚假业务数据或平台能力证明。

实际可用并发：主控 + 3 个 Agent（环境上限 4），按 READY 任务复用专业角色。机器观察为 20 逻辑处理器、约32GiB进程可见内存上限、C盘218GiB可用；不是性能验收结果。独立 worktree 基线相同，构建输出不共用。Edge/.NET/原生资源测试由主控分配一个重测试槽；纯 Node 业务/合同可独立运行。

## 本轮文件所有权

|代理|Worktree/分支|独占文件范围|资源|
|---|---|---|---|
|主控|现有知客仓库 / upgrade/zhike-61-ab-delivery|集成、scripts/run-tests.cjs、验收/任务池、未分配文件需先登记|全量/构建/原生集中调度|
|v41_design（01/02/03）|../v41-worktrees/design / upgrade/v41-design|既有 UI CSS owner 及分配的视觉 contract；禁止业务 JS/XAML/C#|纯 Node；Edge 另排|
|v41_stability（10/12）|../v41-worktrees/stability / upgrade/v41-stability|tests/helpers/isolated-edge-runner.cjs、isolated-edge测试及有证据的测试诊断；产品宿主改动须先说明最小范围|归档和纯 Node；最终 Edge 槽归主控|
|v41_capability（05/06/07/09）|../v41-worktrees/capability / upgrade/v41-capability|能力审计、tests/v41-ws-capability-audit.test.cjs；已批准group-monitor-core身份与server人工resolve最小修复|纯Node/独立临时DB动态端口；无Edge/.NET|

任何共享接口或迁移由主控审查后串行集成。不允许触碰生产 SQLite、真实登录态、付费AI或重新启用 RD02 旧采集。真实平台测试需先证明授权与能力，不发送未批准消息。

## 初始任务池（历史；最终状态以后的集成检查点为准）

|ID|优先级/模块|依赖|状态|负责人|验收条件|提交/结果|
|---|---|---|---|---|---|---|
|AUD01|P0 基线与现状|无|RUNNING|主控/能力|Git干净、实际schema/调用链、可信功能清单|基线eb94848；最高迁移025|
|VIS01|P0 V4.1共享材质与排版|AUD01局部|REVIEW|design|双主题AA、四级材质、原导航/host保留、共享CSS合同|25be8ee；14/14局部|
|VIS02|P0 动效选择器回归修正|VIS01审查|REVIEW|design|off选择器不影响on；无nested html，系统减少动效保留|3c7e299；红/绿、14/14|
|STAB01|P0 身份查询冷启动耗时|基线失败元数据|REVIEW|stability|同30s期限、全部PID/StartTime、探针释放、无权限削弱|95094e2；13参数/10子进程/4传输；真实矩阵局部通过|
|STAB02|P0 Edge收到close但未退出|STAB01|RUNNING|stability|真实退出+流/身份全部核验，重现与最小修复证据|内部阻塞未定位，不改产品WebView|
|DATA01|P0 WS身份与数据来源审计|AUD01|REVIEW|capability|真实schema/路由、官方来源、权威/投影分界、无假回执|b5978bb审计|
|DATA02|P0 BSUID误转号码|DATA01反例|RUNNING|capability|opaque不折数字、scope人工映射、旧phone/JID兼容|纯核心红例已复现|
|DATA03|P0 人工关联遗漏权威台账|DATA01反例|RUNNING|capability|CRM/事件/022账本原事务一致，锁与回滚回归|临时sidecar红例已复现；不改迁移|
|UI01|P0 客户抽屉截图模式底部可达|重测试槽|READY|待分配|默认与截图模式对照，同断言/尺寸、原生复验|已有失败待定位|
|UI02|P0 所有页面及状态矩阵|VIS/STAB集成|BACKLOG|design/主控|M01–M23、WS01–12、GPT/弹窗/空错态/compact真实renderer检查|复用122场景，历史未完不冒充通过|
|NATIVE01|P0 WinUI原生验证|VIS/STAB集成|BACKLOG|主控|双主题/缩放/滚轮/账号切换/动效off/长表格/退出|复用隔离入口与computer-use|
|PERF01|P0 长时间资源基线|NATIVE01|BACKLOG|主控|记录操作次数/时长/工作集/private/线程/Core/退出，不自造阈值|上轮3秒样本不足|
|REG01|P0 本轮全量与Release|已集成代码冻结|BACKLOG|主控|重新执行全量/WS/关键安全/Release，保留所有失败|不得复用289/291当本轮结果|
|KPI01|P1 首页六项KPI|DATA02/03/口径审查|BACKLOG|待分配|客户、在群、退群、会话、线索、跟进来源准确；缺覆盖明示|不以账号/群数冒充人数|
|WS01|P1 多账号头像/分组与状态|S3、账号接口审计|BACKLOG|待分配|原账号隔离/恢复、真实未读，无host重建|不复刻ChatKnow内部|
|READ01|P1 指定消息/证据/快照复用|DATA01、S3|BACKLOG|待分配|账号+群+消息唯一、own message证据、Unknown默认、历史保留|先复用023，缺失才评审迁移|
|READ02|P1 每日/消息/客户查询|READ01|BACKLOG|待分配|scope、日期、来源、分页/索引、跨群隔离|不做新主档|
|EXCL01|P1 通讯录/名单/模板排除|READ01/接口冻结|BACKLOG|待分配|规则版本、并集去重、只改统计范围、重算留历史|不删除原始成员/客户|
|EXPORT01|P1 CSV/Excel及CRM历史|READ02/EXCL01|BACKLOG|待分配|筛选全集一致、授权/审计、来源核实时间、公式注入保护|复用vendor xlsx与现有导出|
|PLATFORM01|P0/P2真实成员级回执|官方能力+授权测试环境|BLOCKED|capability|真实消息/群/成员/时间及适用范围证据|Cloud Groups API条件不等于WebView群已支持|
|MENTION01|P2隐藏式提及可行性|PLATFORM01|BLOCKED|capability|真提及提醒+接收端身份显示实测|不得用文本@或协议注入冒充|
|RELEASE01|P3发布准入|全部必要Gate|BLOCKED|主控|真实正式安装/迁移/安全/性能等既有标准|生产FROZEN；本轮不发布|

状态含义：BACKLOG/READY/RUNNING/REVIEW/TESTING/MERGED/BLOCKED/DONE。提交或纯合同通过不自动变DONE；需要实际所列集成与验收。后续能力可独立研究和安全验证，但S3未通过前不得宣称后续阶段功能已验收。

## 2026-11-18 集成检查点（覆盖上表初始调度状态）

最终完整回归的代码基线为 `88cf98b`，包含 `139bd42` 的多层颜色合成修正，实际结果 **292/293**。后续仅追加 GPT 失败诊断及证据文档，GPT 复跑 8/8，正常 Release 编译 0 warnings / 0 errors。重测试已结束。原生应用由用户正常关闭；9 个采样到的 PID/启动时间身份均已退出，按唯一隔离根过滤的其余相关进程为 0。没有启动生产 Worker 或解除 RD02。

|任务|当前状态|实际结果 / 限制|
|---|---|---|
|AUD01 / DATA01|DONE（代码审计范围）|基线、025 迁移上限、权威来源和官方能力边界已归档；不代表真实 WS 已验收。|
|VIS01 / VIS02|MERGED|共享材质、21/17/28 标题层级、WS 动效作用域及三处箭头减少动效规则已修正。保留正文、表格和操作目标既有断言。|
|STAB01|MERGED|复用只读进程身份探针，保留原 30 秒期限及退出/流/身份清理断言；新增探针退出确认。|
|STAB02|BLOCKED|真实 Edge close ACK 后偶发不退出仍有复现证据。首轮完整回归未复现不等于根因修复。|
|DATA02 / DATA03|MERGED|BSUID 不转电话号码；人工关联在原事务写入 CRM、022 台账、事件，含故障回滚实测。|
|UI01|DONE（Edge 合成场景）|异步报名历史完成后再测滚动；4 红 / 4 绿与原始截图已归档，不代替 WinUI。|
|UI02|部分通过 / 部分 BLOCKED|35 路由共享源码映射；独立 CRM 实际 Edge 浅色 8×20 加深色检查、WS 7×12、GPT 8 场景各有 Passed。GPT 首轮与最终全量的 WS 仍发生超时，原生全路由未完成；不可合称全页面验收通过。|
|NATIVE01|部分 BLOCKED|双主题、最大化、返回、动效关闭已操作；125% 输入坐标偏差与随后窗口捕获失败阻止可靠滚轮和十次切号验收。WS 空文档 Core 成功创建并复用，连接失败提示原因尚不明。|
|PERF01|Observed|91 次 / 15.56 分钟，进程树工作集 757.7→866.6 MiB，6 个 WebView 子进程；本窗口覆盖 CRM 空闲/操作，后续 WS 不在采样期，无新发明阈值。|
|REG01|BLOCKED|三轮分别 289/292、289/292、**292/293**；最后仅 WS S1 Edge 45 秒超时。最终 Release 0 warnings / 0 errors（20.11 秒）。不以独立 WS 或 GPT 通过覆盖完整回归失败。|
|KPI01|REVIEW（独立技术验证）|`upgrade/v41-home-metrics` 的 `d38a815`/`f05031b`：3 个 WS 投影纯函数、5 项隔离测试；未合并或接入主线首页。既有 CRM 指标不复制。周期退群时间缺可信来源，不能显示伪精确值。|
|WS01 / READ01 / READ02 / EXCL01 / EXPORT01|BACKLOG|审计已列可复用结构与缺口；等待 S3、真实授权能力及必要迁移评审，不创建假按钮或假数据。|
|PLATFORM01 / MENTION01 / RELEASE01|BLOCKED|没有授权真实成员回执/隐藏提及实测；Cloud Groups API 条件不等于当前内嵌群支持。生产 FROZEN。|

详细证据见 `v41-integration-acceptance.md`、`v41-native-acceptance.md`、`v41-edge-stability.md`、`v41-customer-scroll-acceptance.md` 和 `v41-ws-capability-audit.md`。任务池保留初始行便于追踪，以上检查点为当前状态；不得按最初 RUNNING/REVIEW 行误报完成。

## 已冻结的本轮接口决定

1. 视觉仍在原design-system token与原CSS owner；标题21、模块17、KPI28 CSS有效像素，正文/CRUD16、辅助14、44px命中目标。用户12–13px为参考建议，先通过缩标题/留白达到紧凑，保持现有可读性门禁；等待真实DPI复验，不静默降低断言。
2. 材质0为不透明正文/表格；1为短顶部高光；2为少量语义卡反射；3为首页原横幅。无新依赖、全屏blur、常驻GPU动画。
3. 022客户群关系是当前成员权威，015确认事件是周期离群来源；023隔离Mock表不能当正式人数。缺历史覆盖不报完整0或百分比。
4. BSUID是opaque身份，不能剥出数字猜电话；没有可信namespace不全局昵称/数字猜客户。只接受可追溯可靠映射。
5. 人工resolve修复限定原事务/现有表，不回填、不改历史迁移。
6. 授权Cloud群回执与当前内嵌WebView能力分开记录。真实回执、hidden mention仍需单独验收，不创建假按钮或假在线数。
