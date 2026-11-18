# 阶段 5.1 原生桌面验收记录

日期：2026-11-16（Asia/Calcutta）。输入基线：代码 `7667837`、报告 `e11b318`，开始时 HEAD=`e11b318` 且工作区干净。仅测试编译属性 `Stage51IsolatedUi=true` 的真实 WinUI 桌面程序；正式入口保持 FROZEN。

## 环境与真实性边界

- Windows 11 Pro 10.0.26300 x64，真实 Windows 桌面、WinUI 3、WebView2 和本机 sidecar，原生鼠标/键盘交互由 Computer Use 执行。
- 程序名 `Zhike.Stage51.Acceptance.exe`，窗口标题明确标记 ISOLATED。工作区为带标记的 `%TEMP%\zhike-stage51-native-<GUID>`，当前用户 ACL；原生数据根、账号配置、profile、队列与日志均隔离。
- 使用真实本地 Service/API 与 SQLite；数据是 `scripts/stage51/seed-native.cjs` 明确标记的合成验收样本：2 个账号、每账号 2 个同 JID 群组、同成员标识、2 个现有 CRM 客户、8 个 AI Job、6 个候选。
- 没有登录或连接 WhatsApp。外部导航在隔离构建中被阻止，WS 显示连接失败是预期结果，不能据此宣布真实 WhatsApp 聊天或采集通过。
- AI 是已授权的隔离 Mock 数据；无付费 AI 调用、无正式消费者或正式 Worker 上线。任务通过真实状态机/API 建立，不把静态截图当作功能。
- 截图证据为本次原生工具返回的窗口画面；可复现日志为已脱敏的 `native-events.jsonl` 事件摘要、资源附件及下述操作记录。私密连接文件不进入 Git 或报告。

## 首轮实机发现与修复

1. sidecar 关闭只携带 shutdown token，缺少 API token，返回 401 后等待退出无上限。补足授权并限制等待；真实无 UI 消息泵探针覆盖正常关闭、取消和失败路径。
2. sidecar 启动健康检查依赖 UI SynchronizationContext，冷启动暂停 UI 消息泵时卡住。健康检查和重试链最小增加 `ConfigureAwait(false)`；真实隔离探针重复通过。
3. 原生群成员页只展示旧事件集合，未读阶段 3 成员账本，造成服务中有成员而 UI 为 0。改为按账号读取实际成员，保留历史事件单独展示。
4. AI 审核 POST 只在 URL 带候选 ID，而实际服务读取 body，导致真实批准失败。修正 UI/API 契约；不放宽 CRM 验证、空字段或人工字段保护规则。
5. 新二级导航及工作页未被全局滚轮路由识别，滚轮误落外层；二级导航重绘丢失滚动位置。按已有容器模型修复，保留知客主侧栏。

首轮窗口正常 Alt+F4 关闭，桌面窗口清单确认消失；完整进程清理证据见资源附件。发现问题后的最终复验、每项状态和限制在以下最终记录中填写，不把首轮失败掩盖为通过。

## 最终复验记录

最终修复包使用同一独立测试输出，最终 PID 32904（启动 UTC 12:58:50），侧车 ready 约 1.34 秒、shell navigation completed 约 4.39 秒；这是单次本机热启动观察，不是承诺阈值。开始时桌面工具不能激活窗口；用户明确回复“已置前”后才继续输入。没有对工具误截到的其他应用执行操作。

| 页面 | 原生实际操作与结果 | 状态 |
| --- | --- | --- |
| 工作台概览 | 进入并返回；真实 WS WebView 为隔离 about:blank，网络阻断状态明确 | Passed（隔离 UI） |
| 账号管理 | 显示两个真实测试账号与当前 native-b，连接状态可读 | Passed |
| 群组管理 | 当前账号显示 2 个实际目录记录，固定监测席位未配置状态明确 | Passed |
| 群成员管理 | 当前账号显示 2 条实际成员账本；同成员分属于两个群，均关联 C-native | Passed |
| 消息采集 | 加载实际本地历史计数 1、队列及未登录状态；未点击启动真实采集 | Passed（状态展示） |
| AI 智能分析 | 实际重试 failed→queued、取消 pending→cancelled，查看任务详情及来源审计 | Passed |
| CRM 客户关联 | 进入页面；显示未选当前会话的空匹配状态，不创建客户；审核通过真实 UI 执行 | Passed（已操作范围） |
| 任务队列 | 最终补验进入、返回；空列表、0 条记录和禁用分页可读 | Passed |
| 运行日志 | 最终补验进入、返回；WS/采集/群监测/AI 四类状态与隔离未登录、正式消费者关闭一致 | Passed |
| 设置 | 最终补验显示生产 Gate FROZEN，Worker/AI/群组自动建档默认关闭；未开启任何开关 | Passed |

### 真实审核后的独立回读

执行 `node scripts/stage51/verify-native.cjs <已验证的隔离根>`。只通过当前临时 Service 的 GET 回读，不直接更改 SQLite，不打印临时 token。实际 Passed：

- 客户总数仍为 2，没有新建未知客户。
- C-native.occupation=工程师；其 language 仍为空。
- C-manual.occupation=人工维护职业，律师候选为 conflict；工程师候选 applied，语言候选 rejected。
- `suggestion.approve`、`suggestion.reject`、`suggestion.conflict` 审计各且仅一条，均 accountId=native-b。
- 重试任务 queued，已取消任务 cancelled；default 账号的 3 条候选仍全部 pending。
- 同一个已有客户在两群的成员账本均保留，无主键冲突。

### 尚未通过的真实输入验收

修复后的内容区 wheel 操作返回截图时滚动条仍在顶部；先点击区域聚焦再 wheel 仍未观察到移动。拖动实际滚动条可进入审核列表并完成操作。不能据此虚报滚轮 Passed，也不能尚无输入投递证据就断言应用 wheel handler 必然失效。

只读审计确认测试输出与源码 JS/CSS 相符，shell 没有第二个抢先 wheel listener。已准备仅作用于 ignored 测试 fixture 的 `native-input-probe.cjs`，记录 trusted 输入计数和滚动几何，不包含业务文本、按键值或凭据；尚未用其完成最终输入诊断。

之后另一应用覆盖测试窗口，原生输入曾暂停，避免误点。用户随后明确同意提供约 5 分钟不被遮挡的环境；最终补验 PID 31928 使用同一代码与测试数据根，仅增加诊断 HUD，没有产品源码改动。以下晚到结果取代“未操作”状态，但不掩盖前面的失败观察。

## 晚到原生补验（PID 31928）

- 补齐任务、日志、设置三页，十页均已实际进入。二级导航滚动位置在切页后保持，主侧栏未被替换。
- HUD 真实记录 trusted wheel：导航 owner=`nav.ws-workspace-nav-list`，deltaY=+416.666，scrollTop 0→158；外层不动。AI 内容 owner=`section.ws-workspace-page-content`，deltaY=+416.666，0→417；再以 -416.666 回到 0，外层不动。高位滚动到候选区也成功。没有 dispatchEvent 或程序写入 scrollTop。
- 初次无移动不能当作应用不响应的最终证明：HUD 曾显示命中不可滚动 flow-strip，另一次负方向输入位于顶部。实际对正确 owner 的正反输入已验证移动。**已测导航/内容滚轮：Passed**；嵌套审计 pre 内层与不同设备/DPI 组合未测，不能扩张结论。
- 侧栏收起后内容边界左移，回收原空轨道；主侧栏不变。精确 158 CSS px 的布局证明见实际 Edge 布局测试。收起后账号控件列较窄，仍可切换；完整视觉质量不在本轮被宣布无缺陷。
- 在设置页执行 10 次真实快速账号交替切换，HUD click 计数相应增加；又执行 2 次切换核对 AI。default 的 3 条候选仍 pending；native-b 保留 applied/conflict/rejected，切换后内容滚动位置按账号隔离恢复。
- 原生日志仅有 3 个 Core 创建：shell、native-b、default；十次切换没有新增 Core。但现有隔离导航循环仍在，因此不能将“不重建 Core”解释为“不重新导航/不闪屏”。
- 真实 Alt+F4 关闭，窗口清单确认消失；21 个 PID+创建时间身份均退出、端口 56876 无监听、锁消失。最终关闭证据见 `stage51-native-late-close-resource-evidence.json`。

**原生功能交互已补齐；整体原生稳定性仍为 Blocked。** 确认测试隔离 about:blank/失败恢复反馈导致高频导航；V3 11208 次、V2 6810 次导航完成事件。参见 `stage51-native-navigation-loop.md`，不能用 Core 数稳定或这组受干扰资源曲线宣布正常 WS 性能通过。

## 受控人工复验清单（未做不能打勾）

1. 使用文档中的 opt-in 构建与标记临时根；确认标题 ISOLATED、客户数 2，未打开正式工作区。
2. 安装输入 HUD 后通过真实 Ctrl+R 主动重载一次；这是有意导航，单独记录，不能算页面切换意外重建 WebView。
3. 在 AI 内容区先点击再转物理鼠标滚轮，记录 HUD trusted wheel 数、owner、尺寸及 before/after/nextframe；在二级导航和审计内层分别重复，确认外层不抢滚动。
4. 十个页面依次进入/返回/刷新；任务、日志、设置最终包截图逐项留证。空记录和错误提示不得当真实业务结果。
5. 二级导航收起/展开/返回并恢复位置；确认主侧栏不变且内容增加 158 px。小窗口拖动边界和恢复后无裁切。
6. 两个测试账号至少交替切换 10 次，在每个账号分别核对群组、两群成员、Job 与候选状态；同客户主档全局复用，账号候选不能互串。
7. 快速连续切换并回到 AI；再次刷新/点击已审核按钮不产生第二条审计或覆盖人工资料。
8. 比对会话内 native-events：正常十页导航及返回不得额外创建 shell/WS Core；两个账号各首次打开只允许其自身 Core 创建。进程数与 Core 实例数分开统计。
9. 正常 Alt+F4 关闭；对采样中的 PID+创建时间、sidecar listener、锁文件逐项确认释放，不用强杀伪装正常关闭通过。

本清单用于下一轮未完成/需重新验证的范围，已完成项目以以上记录为准。尚需修复隔离导航循环后重新验收稳定性、审计内层滚轮与代表性双账号压力；全量自动化不能代替这些原生项目。
