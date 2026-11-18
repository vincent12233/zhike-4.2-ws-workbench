# 阶段 5.2 原生桌面复验

日期：2026-11-16。源基线 `37449b2`，本轮修改后的隔离 Release 构建；文件 ProductVersion 保留 `6.0.3+37449b2`，不是正式 6.1 发布。生产入口 FROZEN。

## 环境和证据边界

真实 Windows 11 Pro 10.0.26300、WebView2 157.0.4341.46、1422×815 普通窗口。通过 computer-use 插件的 `cua_repl` 操作实际 WinUI 窗口 461708（PID 19572）。工具多次返回 accessibility unavailable，因而使用当前窗口截图坐标操作；截图证据在工具记录中，没有虚构本地截图文件。

构建命令：`.tools/dotnet10/dotnet.exe build desktop/src/Zhike.Desktop/Zhike.Desktop.csproj -c Release --no-restore -p:Platform=x64 -r win-x64 -p:Stage51IsolatedUi=true -p:OutputPath=../../../.tools/stage52-native/ --nologo -v:minimal`，0 warnings / 0 errors，30.90 秒。`.tools/stage52-navigation-native-final-build.log` 保留原始输出。

仅使用新建带 marker 的根 `C:\Users\酷酷\AppData\Local\Temp\zhike-stage51-native-9ea0b959844a45e082f7955053e5126e`。界面标题继续为“知客 Stage 5.1 · ISOLATED 验收”，但执行的是本轮编译的源码。测试入口不启动正式 Worker，外部 WS 导航被拒绝；真实 Core 的文档为 `about:blank`，不能据此宣称 WhatsApp 登录或聊天质量通过。

`seed-native.cjs` 创建明确标记的合成隔离资料：2 个客户、2 个账号、4 个群、4 条成员关系、8 个 Job、6 个候选。`sync-native-fixture-accounts.cjs` 仅把同一合成 fixture 的两个账号元数据写入隔离 native 索引，避免 API fixture 与 native 索引设置不一致；没有复制任何 profile 或登录材料。

## 实际操作

| 操作 | 实际观察 | 结果 |
| --- | --- | --- |
| 首次进入 WS | 默认账号在 Core 创建前注入一次工厂异常；主窗口继续工作 | Passed |
| 手动打开重试 | 默认账号 generation 2 创建真实 Core，NavId 2 完成 blank 文档，retries 0 | Passed |
| 十页进入、返回 | 概览、账号、群组、成员、采集、AI、CRM、任务、日志、设置均实际进入；空任务、安全状态正常显示 | Passed |
| 十次账号交替选择 | native-b/default 交替十次，设置页当前账号随选择改变；后续额外切换单独计数 | Passed |
| 成员跨群关系 | B 账号显示同客户 C-native 在两个不同 groupJid 的两条 active 关系；A 亦为两条 | Passed |
| 二级侧栏收起/展开 | 实际点击箭头后页面回收空间、再次展开恢复独立导航 | Passed（本窗口范围） |
| AI/CRM 刷新 | 默认账号页面刷新并展示实际隔离任务/候选；未启动正式消费者 | Passed |
| B 账号审核批准 | 工程师候选填入现有 C-native 的空 occupation，UI 显示已补全和实际写入值 | Passed |
| B 账号审核拒绝 | English 候选显示已拒绝，language 保持空 | Passed |
| 人工字段保护 | 律师候选批准后显示资料冲突，人工维护职业保留 | Passed |
| 跨账号候选 | 切回默认账号，其三个候选仍全部待处理 | Passed |
| 取消/重试 | B 的 pending Job 变 cancelled；failed Job 点击重试变 queued，消费者保持关闭 | Passed |
| 页面返回/重复进入 | 回概览及重复选择，账号 Core 沿用，未再发生旧循环 | Passed |
| 正常退出 | Alt+F4 后再次枚举窗口已无隔离应用；进程/监听/锁复核见资源附件 | Passed（窗口退出） |

服务回读实际执行：`node scripts/stage51/verify-native.cjs <上述隔离根>`，`.tools/stage52-native-readback.log` 为 Passed。断言客户数仍为 2、职业补全、拒绝字段为空、人工职业保留、B 三种审核状态、每项审计恰一次、A 候选不变、同客户跨两个群、pending 取消和 failed 排队。不是仅凭按钮外观判定成功。

## 导航和性能限度

初次及第二账号文档各一次 Starting/Completed，均 retries 0；页面选择与账号选择的最终完整计数以正常关闭刷新的 counter 和资源附件为准。不得使用已受抑制的有限 raw 行数代表总量。

正式资源观察为 91 样本、15.59 分钟。其间执行了十页流程的前段及成员/AI/CRM 操作；后半页面、十次账号切换及审核发生在采样窗之后，使用独立前后快照和事件时间线，未冒充均包含在 15 分钟曲线中。没有正式性能阈值，没有据此声明帧率、真实 WS 吞吐或所有 DPI/设备均通过。

发现并修复的额外问题：概览“刷新页面”发送 `reload`，native action switch 未处理该动作，首次实际返回 unsupported，未产生导航事件。随后仅新增 `case "reload"` 复用原 reconnect 的 `reload:true` 路径，保留原有身份、取消和会话权限；没有增加采集动作或放开网络。

## 最终短复验（刷新契约和关闭计数）

原 PID 19572 退出后，复用同一合成隔离根，重新编译并启动 PID 3884 / 窗口 1900722。没有复制旧 profile、生产数据或重新 seed。此版另外让测试专用 `application-stopping` / `host-unloaded` 刷盘计数；原生工厂、导航状态机与 15.59 分钟观察版相同。

构建 `.tools/stage52-native-final-counter-build.log`：0 warnings / 0 errors，20.24 秒。原生日志 UTC 15:38:31 左右启动，15:41:12 正常关闭。实际操作为 B 概览 → 刷新两次 → 重连一次 → 账号页面 → A 概览 → 群组/成员/概览 → B。主窗口没有冻结或退出，最终 Alt+F4 后枚举确认窗口消失。

最终 `native-event-counts-3884.json` 在 host-unloaded 刷盘，20 类事件、所有 suppressed=0。实际 Starting / Completed 各 5：B 首次 NavId 2，显式刷新/重连 NavId 3、4、5，A 首次 NavId 2；每次 completed 都为 isolated-document、retries 0。`webview-created` 总计 3（shell 1、每个账号 visible 各 1），没有因刷新或页面切换重建 Core。显式动作 `created:false,reload:true`、source `explicit-refresh-or-reconnect` 与递增 cycle 可关联，合法同 URL 刷新没有被误拦截。

结论：原生刷新契约 `Passed`，当前隔离导航循环不再复现 `Passed`。这不是额外 15 分钟性能曲线；完整资源数值、第二次关闭清理与原始日志归档见资源附件。

未连接真实 WS，未打开生产 SQLite，未触发正式 AI、生产 Worker 或双写。普通 AI 创建客户及人工字段规则未改变。
