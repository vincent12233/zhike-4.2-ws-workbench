# 阶段 5.1 最小生产边界复核

基线：`e11b318`。日期：2026-11-16（Asia/Calcutta）。此复核只读审视当前修改、隔离日志和进程状态，没有打开生产 SQLite。

## 当前可确认的边界

- 正常项目只有显式 MSBuild 属性 `Stage51IsolatedUi=true` 才定义 `STAGE51_ISOLATED_UI`。独立程序集名为 `Zhike.Stage51.Acceptance`；未指定该属性的正式构建不含隔离路径分支。
- 所有本轮识别的原生数据根消费者——App/sidecar、账号、WebView profile、队列、AI 凭据、桌面工具、窗口布局和采集诊断——在测试构建中先通过 `Stage51Isolation.MapDataPath`。该函数拒绝未标记、非临时根和重解析点；隔离根 ACL 仅当前用户 SID。
- 测试 sidecar 的隔离 group/AI/fencing 环境变量仅在上述编译分支设置，未持久化到生产 flags。App 的正式 `WorkerSupervisor` 仍 `Enabled:false`，没有新增正式 `WorkerRuntime.StartAsync` 调用。
- `WorkerFeatureFlags` 既有缺失/无效配置默认关闭逻辑未变。本轮实际检查 `%LOCALAPPDATA%/Zhike6/worker-feature-flags.json` 不存在；该检查只读取存在性，没有打开生产客户库。
- 隔离 WebView 对非 `zhike.local`/`127.0.0.1` 的 HTTP(S) 资源返回 451；WS 导航被约束至 `about:blank`。测试构建的 WS 后台 Tick 不运行采集器；AI bridge 拒绝真实请求、模型查询、保存凭据等动作，仅允许状态/取消/工作区选择。
- `connection.private.json` 仅位于当前用户 ACL 的隔离根，包含短期测试 sidecar token；本轮报告只提取其本机端口做关闭检查，没有输出 token，也没有将该文件加入报告/Git。

## V2 关闭后的实际证据

父任务通过真实原生 Alt+F4 正常关闭。对资源日志中 17 个进程身份与关闭前快照中的 21 个进程身份分别做 PID+创建时间校验，剩余均为 0；本机端口 54239 无监听，隔离 `.workbench.lock` 不存在。隔离 WorkerRuntime/WorkerAi/WorkerSupervisor 测试进程为 0。检查器没有终止任何进程。详见 `stage51-native-close-resource-evidence.json`。

## 不能扩大解释的证明范围

上述结论基于受控启动参数、编译边界、实际数据根日志、原生操作和资源检查。未启用整机 ETW/ProcMon 文件访问审计，不能证明用户机器上任何其他进程从未读取生产数据库；也没有把 HTTP(S) 请求过滤器描述成系统级防火墙或全协议抓包证明。

可以明确报告：本轮受控测试没有把生产路径传给 sidecar/账号/profile 服务，没有执行生产库迁移或启动正式 Worker/AI，生产入口保持 FROZEN。不能报告“已对整台电脑所有文件访问做完整审计”。真实 WhatsApp 网络和真实 AI 质量不属于本轮执行，未用空白隔离 WebView 冒充 WhatsApp 登录/聊天验收。

## 后续隐藏测试 session 的归属检查

PID 30308 的隐藏测试启动由父任务受控结束，不能计作正常退出通过。本轮在 UTC 13:15:11 只读检查其已记录 browser PID 24936、两个确切 PID 和直接父子关系，均无存活记录；ParentPID=30308 的 Node 进程也无结果。检查未终止任何进程，也未把未知孤儿进程归属强行推断出来，详见 `stage51-hidden-session-cleanup-evidence.json`。最终可见 PID 32904 的操作/退出结果另行验收，不混入这一旧 session。

可见 PID 32904 后由父任务受控结束，UTC 13:20:00 两套各 15 个身份检查均清零、无不可核实进程，端口 58574 无监听。测试锁 ownerPid 7408 已退出但锁文件仍存在，属于待处理测试残留；没有将该过程计为正常应用关闭通过。参见 `stage51-native-final-close-resource-evidence.json`。

父任务后续申请清理本轮三个 native 测试根，自动审批拒绝命令创建，未执行删除或复制；三个根与 stale lock 均保留。临时文件清理状态为 Blocked / NotCleaned（policy）。本检查未通过其他方式重试删除，不将运行进程清零等同于临时文件已清理。此前阶段 5 三处历史诊断资源的清理结果由主报告单独记录。

之后用户恢复窗口前台，父任务用同一隔离构建进行 V4（PID 31928）补验并实际 CUA Alt+F4 正常关闭。UTC 13:34:18 对 21 个观察身份核验全部退出，13:34:22 端口 56876 无监听，`.workbench.lock` 当前为 0；application-stopping/sidecar-stopped 均有本 PID 事件。V3 stale lock 的保留是前一历史时点结果，V4 正常生命周期已经将锁清除，观察器未删除文件或终止进程。三个测试根仍保留（policy），不因正常关闭而宣称目录清理完成，见 `stage51-native-late-close-resource-evidence.json`。
