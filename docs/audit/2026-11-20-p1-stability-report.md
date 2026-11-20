# P1 稳定性实测报告（2026-11-20）

本报告只区分两类结论：**本轮在本机真实执行过**与**仅静态确认/未验证**。
所有测试在本机 Windows 11（PowerShell 5.1 + Node 26.13.1 + .NET SDK 10.0.404）针对 `feature/zhike61-ws-completion` @ `7097de4` 执行。

## 1. 本轮真实执行的验证

| 项 | 结果 | 执行方式 |
|---|---|---|
| WS 全量回归 | **183/183 通过** | `node scripts/run-tests.cjs ws`（本机真实运行，含 rd02 13/13、stage55c 18/18、排除 17+18+UI 合同、草稿持久化合同） |
| 会话池 LRU/释放 | 通过（C# 层 18 项） | stage55c 真实编译 `WsSendOperationGuard` 与提取的生产方法；rd02 链接真实生产 C# 服务 13 项 |
| 独立采集与前台隔离 | 通过（rd02 13/13） | "running independent collector is driven while the same account chats in foreground"、"collector failure is isolated from foreground connection" |
| 伪造身份/旧视图拒绝 | 通过 | "host-owned collector identity rejects forged roles, accounts, stale views and paused packets" |
| 暂停/恢复守卫 | 通过 | "failed or unconfirmed native pause never marks the persisted task paused/stopped"、"task resume restarts a paused authenticated collector" |
| 断点保留 | 通过 | "business task details preserve checkpoint without presenting ready support as completed work"；`resumeCollectionFromCheckpoint` 静态链路完整（resumeCount 递增、cursor 持久化） |
| 后台事件不抢前台 | 通过 | ws-live-refresh（心跳合并、只刷 WS 管线）；ws-background-isolation（按账号心跳、非 UI 线程解析） |
| 桥接恢复 | 通过 | ws-bridge-recovery（过期 sidecar 客户端重绑、可操作错误保留） |
| 滚动稳定性 | 通过 | ws-scroll-stability（单属主、有界表格、刷新背压） |
| 草稿保留（新增） | 通过（合同级） | 本轮新增实现：回复草稿持久化到 localStorage（账号+会话作用域、60 条/4000 字符上限、beforeunload 冲刷、发送后清除）；合同测试通过 |

**真实进程检查**：本机当前无知客/知客 sidecar 残留进程；系统里 12 个 WebView2 进程属于 Windows 搜索与小组件（SearchHost/Widgets），与知客无关。

## 2. 本轮新增修复

- **回复草稿丢失**（真实缺陷，已修复）：`ws-workbench.js` 草稿仅在内存，关窗即丢。现持久化到 localStorage，账号+会话隔离，发送后清除，关窗冲刷。commit `7097de4`。

## 3. 仅静态确认、未经真机验证（诚实清单）

以下能力有自动化测试证据，但**没有真实 WinUI 桌面进程 + 真实 WhatsApp** 的验证，不应当作已验收：

1. **WebView2 退出回收**：`ReleaseAllAsync`/`ReleaseRegistration` 的 `Close()` 路径有单测，但没有真实多账号桌面运行时观察子进程树退出（S3 曾观察过 1 个 WebView 子进程延迟退出）。需要 Windows 真机长跑。
2. **重复事件监听**：池化会话的 release 回调有守卫测试，但多账号反复切换 50+ 次的监听器计数未实测。
3. **50 账号规模**：会话池容量默认 3（前景+后台+1），50 账号"可管理不等于同时在线"的设计成立，但 50 账号登记/切换/内存曲线未压测。
4. **采集断线恢复的真实 WhatsApp 场景**：恢复逻辑与守卫测试齐备，但真实断网→重连→续采未跑过（需要真实账号）。
5. **多 DPI/最大化适配**：S3 报告有 1422×815 单分辨率证据，多 DPI 矩阵未测。

## 4. 下一步（P2 起继续）

- P2：AI 自动分析消费生产聊天（需要用户授权付费 AI，当前生产 Worker 保持关闭）
- P3 收尾：群发中心多群、@、已读、开关群（P4 依赖真机平台验证）
- P5：安装器（Inno Setup 未装）与多账号压测
