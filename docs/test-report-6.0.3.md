# 知客 6.0.3 测试报告

更新时间：2026-11-15。状态：ReleaseGate 已生成。自动化回归和安装包构建已完成；真实 WhatsApp 和外部 AI 仍需目标机验收。

## 已执行

| 项目 | 结果 | 证据 |
| --- | --- | --- |
| 导入定向回归 | 客户摘要与跟票/入金分流、登记日期、Excel 日期时间、手机号登记独立导入通过 | customer-import-routing、smart-import-classification、phone-registry-import |
| 备份恢复隔离演练 | 两个 WS 账号消息与一位 CRM 客户经 .NET 自动备份封装、JS 校验、SQLite 恢复；篡改拒绝、失败回滚通过 | native-backup-restore、manual-backup-all-accounts、BackupRetentionRuntime |
| WS/AI 模拟链 | 双向消息落库与重放去重、AI 分析关联现有客户和任务幂等通过 | ws-followup-chain；不等同实际账号联调 |
| WS 多账号添加恢复 | 原生桥接优先、桥接超时/API 兜底、重复提交回读和账号隔离入口通过 | ws-workbench-ui；ws-multi-account |
| WS 群组监测、翻译与群发安全链 | 固定群组监测席位、VIP 客户/群组隔离、翻译原文保留、群发幂等/限速/审计和前台目标校验通过 | ws-group-monitor、vip-scope-separation、ws-broadcast-translation、ws-broadcast-ui |
| 数据档案库统一联查 | 数据中心可读取本机 SQLite 档案摘要；WS 客户档案按账号/会话联查客户主档、跟票、报名、入金、跟进任务、完整消息、AI 分析、提醒和群组事件；未关联、跨账号和嵌套敏感字段均有保护 | data-archive-summary、ws-data-archive-api、data-archive-ui、customer-phone-index |
| WS 辅助浮动抽屉与滚动隔离 | 标签切换、焦点回退、Esc/页面区关闭、宽度与垂直位置边界、重绘保留焦点/拖拽句柄、原生 resize 抑制、drawer body 唯一滚动通过 | ws-assist-drawer-runtime、ws-workbench-ui、ws-scroll-routing-contract |
| 项目稳定性合同 | GPT 路由单一渲染、首页请求单飞与可取消、WS 抽屉有效列宽、后台 AI 回写错误可见、启动重试计时器可回收、客户群组账本缓存通过 | project-stability-contract |
| 长历史导出与 GPT 生命周期 | WS 导出按 256 行分页、64KB 分块并遵守背压；客户端断开立即停止；离开 GPT 页面会取消活动请求并丢弃过期响应 | ws-export-streaming-contract、project-stability-contract |
| 原生资源生命周期 | 本机 API 客户端释放、WS 会话事件解绑、初始化串行化、遗忘账号关闭采集会话与清理运行时索引、静态资源流异常处理通过 | ResourceLifecycleContractTests |
| 发布门禁 | 版本混装、脏工作树和缺失资源拒绝合同通过 | release-gate-contract |
| 全套自动化回归 | 205 项通过，0 项失败 | `node scripts/run-tests.cjs all` |
| 安装器合同 | 10 项通过，0 项失败；WinUI 自包含安装器已生成 | `node scripts/run-tests.cjs installer`；`releases/release-output-manifest.json` |
| 1 万/5 万客户合成性能 | 见下表 | performance-scale、customer-list-performance、analytics-performance |

### 隔离性能

| 规模与操作 | 本轮耗时 |
| --- | ---: |
| 10,000 客户索引 / 搜索 | 139.2 ms / 11.0 ms |
| 50,000 客户索引 / 搜索 | 736.9 ms / 27.2 ms |
| 50,000 客户列表初次构建 / 筛选 | 120.5 ms / 8.0 ms |
| 50,000 客户 × 3 统计维度聚合 | 19.9 ms |
| 10,000 客户状态完整保存 / 读取 / 增量保存 | 899.6 ms / 55.6 ms / 98.6 ms |
| 50,000 客户状态完整保存 / 读取 / 增量保存 | 1256.7 ms / 251.5 ms / 475.4 ms |

上述结果均为隔离合成数据脚本计时，不代表真实页面的滚动帧率或全部文件导入耗时。

## 当前视觉检查

隔离空库的 1440×900 首页和 WS 截图分别位于 work/qa-home-1440x900.png、work/qa-ws-workbench-1440x900.png。WS 进入时导航已自动收窄，外层不再裁切管理员区；820×540 与 1440×900 未出现横向溢出。首页、客户中心和任务中心仍在按参考图调整，不能把现有截图报告为像素级验收通过。ReleaseGate 安装器已重新生成，目标机实际安装后的视觉与操作验收仍待完成。

WS 辅助抽屉的结构检查覆盖 1440×900 桌面和 900px 以下底部 sheet 规则：抽屉开关保持中间原生 WS 宿主尺寸不变，抽屉正文独立滚动，后台心跳不会重建标题、标签或拖拽句柄。真实窗口的多屏、系统缩放和滚轮手感仍需在目标机人工验收。

## 尚未验收

- 6.0.3 ReleaseGate 安装包、覆盖安装、卸载后数据保持、桌面图标与换机恢复。
- 实际登录的 WhatsApp 会话：列表、双方实时消息、已读完整历史、未读跳过、多账号切换、VIP 群以及退出或重连。
- 有效外部 AI 服务的真实分析、客户空字段补齐、今日工作台和任务中心提醒刷新。
- 每页在 820×540、最大化以及 Windows 100%、125%、150%、200% 缩放下的操作与滚轮手感。

编译成功不代表验收通过。上述目标机手工验收项在完成前保持未通过状态。

## WS 全量升级专项

### 本轮多账号与档案联查补强

- 后台轮换现在会探测所有已保存账号，包括本地索引仍显示“等待登录”的账号；每次探测结果会写回账号状态并带 `background-account-status` 事件，账号栏只更新对应状态节点，不重绘正在使用的 WS 聊天窗口。
- 多账号状态同步继续遵守前台隔离：后台探测不注入前台脚本、不滚动、不打开会话、不抢焦点；前台账号仍由用户手工操作，未读会话仍跳过。
- 数据档案库新增轻量客户钻取面板，使用同一 SQLite 的客户主档摘要、搜索和客户中心跳转，不加载完整聊天正文；业务记录与 WS 会话返回值递归脱敏嵌套敏感字段。

## 数据档案库连接专项

- 客户主档仍由 `/api/state` 统一保存；WS 账号、会话、双方消息、AI 分析、任务和群组事件保存于同一 SQLite 数据库的账号隔离表。
- 新增只读 `/api/data-archive/summary`，用于数据中心展示客户主档、WS 联系人、完整历史、消息、AI 队列、提醒、群组事件和未关联会话数量；不会把完整聊天正文一次性加载到数据中心。
- 新增只读 `/api/data-archive/customer`，WS 客户档案页按 `accountId + conversationId` 安全联查业务记录和 WS 证据。消息支持 `messagesOffset/messagesLimit` 分页，`messageTotal/messagesHasMore` 明确完整度；读取不会提升 CRM revision、创建客户或改变绑定。
- 客户手机号索引统一使用规范化号码；升级启动会修复历史派生索引，诊断接口报告 `phoneIndexMismatch` 与 `wsOrphanedCustomerLinks`。
- 档案返回值使用递归敏感字段脱敏；低置信度、冲突和未匹配仍保持现有人工确认规则，不会自动新建客户。

- A+ 双层工作台：紧凑命令带、独立账号/会话轨道、最大化 WS 中央窗口、右侧 AI/档案/回复/群发/导出/诊断抽屉、可彻底收起的本地工作区和底部采集流程轨。
- 后台采集与前台聊天隔离：采集不注入前台持久脚本，不自动打开会话、不切换目标、不滚动、不抢焦点；未读会话继续跳过。
- 全量导出：当前账号或全部账号可导出联系人、普通群、VIP 群、群成员事件、会话、双方完整消息、AI 分析、回复、跟进提醒、发送审计、媒体索引和 CRM 主档；导出采用分页流式写出。
- 导出任务：支持排队、运行、完成、失败、取消、进度、SHA-256 和受控下载路径，任务文件只写入本机数据目录。
- 媒体群发：图片、视频、音频和常见文件先账号隔离暂存，群发计划只保存媒体编号；原生桥在当前前台会话内读取媒体并逐附件发送，发送成功/失败逐条审计，失败不降级为文本。
- 性能收口：前端不再把附件 Base64 长期放在状态树；原生桥按媒体编号从本机服务读取，避免重绘和多目标群发时复制大对象。
- 滚动稳定性：WS 命令带、本地工作区、附件列表和流程轨均有明确滚动归属；WebView 宿主不参与外层滚动，抽屉正文独立滚动。

专项自动化证据：`ws-export-media-schema`、`ws-export-complete`、`ws-export-streaming-contract`、`ws-media-api`、`ws-media-send-runtime`、`WsMediaBridgeContractTests`、`ws-workbench-a-plus-layout` 以及 scroll routing/coordinator/system 合同均通过；WinUI Release 构建为 0 警告、0 错误。
