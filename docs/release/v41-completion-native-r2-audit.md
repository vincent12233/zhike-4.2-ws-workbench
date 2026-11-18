# V4.1 原生 run2 只读核验

核验范围为隔离 WinUI PID **35236**。资源上下文记录 Windows 11 `10.0.26300`、WebView2 `157.0.4341.46`，宿主版本 `6.0.3+abe9eddb952fad1e9f5ea5031aac18c74d740507`。以下时间均为 2026-11-18 UTC。**本报告为局部观察和核验。S3 仍为 Blocked，生产为 FROZEN。** [资源上下文](evidence/v41-completion-native-r2/completion-r2-resources.context.json)

## 生命周期

06:06:44 读取原生日志的完整行前缀，目标进程记录覆盖 04:57:38.313 至 05:39:45.893。

- **十次交替切号。** 日志记录初始选择默认账号，随后 `native-b` 与 `default` 交替十次。Shell、默认账号 generation 1 和账号 B generation 2 各创建一个 Core。两个 WS Core 各有一次成功的 `about:blank` 导航，后续选择保留同一代次及 `reload=false`。截至记录末未见额外 WS 导航或重建。
- **十二页进入。** 共记录 15 次进入，覆盖 `overview`、`accounts`、`chat`、`groups`、`members`、`collection`、`contacts`、`ai`、`crm`、`tasks`、`logs`、`settings`。页进入证明路由已到达。控件与原生交互按各自的操作证据验收。
- 初次生命周期截取结束于 05:39:45。退出事件在下方单独归档。真实 WhatsApp 登录与收发、凭据、生产数据均未进入本次核验。 [生命周期事件](evidence/v41-completion-native-r2/native-events.jsonl) · [观察摘要](evidence/v41-completion-native-r2/observation.json)

## 持久数据

06:07:58 使用明确匹配的隔离 SQLite 路径，在同一只读事务内核对以下结果。归档只保留计数、合成字段比较和阶段元数据。 [只读数据摘要](evidence/v41-completion-native-r2/current-state-readonly.json)

|核对项|结果|
|---|---|
|CRM 与任务|52 位有效合成客户，其中 2 位为原始夹具、50 位为追加夹具。3 条报名记录。人工任务完成 1/2，指定人工档案复核任务已完成。|
|阶段流转| `ISOLATED_S3_001` 当前为「潜在客户」。05:43:39 持久记录「新客户 → 潜在客户」一次，并有一条对应的拖动阶段操作日志。当前有效客户阶段历史共 1 条。|
|CRM 审核与隔离|原始两位客户均保留。批准补齐的职业字段已生效，拒绝写入的语言字段保持空白，人工维护职业保持原值。默认账号批准、拒绝、冲突三个结果及对应审计各 1 条，账号 B 的 3 条建议均仍待审。|

## 早段资源观察

91 个样本覆盖 05:00:32.541 至 05:16:15.530，执行时长 **943380.8 ms（15.72 分钟）**。宿主在所有样本中均存活。窗口包含两个 WS Core 初次创建和十次交替中的前七次，后三次、其余 WS 页巡检和后续任务及阶段操作发生在采样截止后。CPU 计数的观察增量为 53.75 秒。

|指标|首样本|末样本|峰值|
|---|---:|---:|---:|
|工作集，字节|778,432,512|1,613,950,976|1,641,451,520|
|私有内存，字节|407,261,184|838,557,696|868,810,752|
|线程|218|474|506|
|句柄|5,712|12,192|12,334|
|进程|9|21|21|
|WebView 进程|6|18|18|

资源状态为 **Observed**，阈值为 **NotDefined**。该早段窗口没有退出阶段或长时间负载数据。资源 JSONL 与上下文保留原始字节。生命周期前缀仅保留本 PID 的相关记录并移除本机路径、动态端口和范围外标记。SHA-256 清单分别记录前缀来源和归档副本。 [资源原文](evidence/v41-completion-native-r2/completion-r2-resources.jsonl) · [敏感扫描](evidence/v41-completion-native-r2/sensitive-scan.json) · [SHA-256 清单](evidence/v41-completion-native-r2/manifest-sha256.json)

## 后续单点资源与退出核验

- **06:18:27.095 单点资源。** 采样执行 493.8 ms。PID 35236 仍存活，进程及 WebView 进程数为 21 和 18，工作集 1,632,464,896 字节，私有内存 834,625,536 字节，线程 473，句柄 12,650。此前 91 个样本与本单点的 21 个 PID 和启动时间组合完全相同。早段峰值只适用于早段窗口。资源结论仍为 **Observed**，阈值为 **NotDefined**。 [单点资源](evidence/v41-completion-native-r2/closure/completion-r2-final-sample.jsonl) · [单点资源上下文](evidence/v41-completion-native-r2/closure/completion-r2-final-sample.context.json)
- **06:45:00 关闭前检查。** 按早段样本与单点样本分别检查，相同的 21 个进程身份仍全部存在。06:45:45.969 至 06:45:46.494，PID 35236 先后记录应用停止、侧车停止及宿主卸载。 [早段身份关闭前检查](evidence/v41-completion-native-r2/closure/before-close-early-check.json) · [单点身份关闭前检查](evidence/v41-completion-native-r2/closure/before-close-final-check.json) · [原生退出事件](evidence/v41-completion-native-r2/closure/native-close-events.jsonl)
- **06:47:27.746 用户关闭后。** 只读复查按 PID 和启动时间核对，run2 观察到的 **21/21** 个进程身份均已退出，剩余和无法核验各为 0。检查过程未终止进程。此项局部核验为 **Passed**，范围限于 run2 记录中的进程身份。隔离目录保留，复用该目录的 run3 未纳入本归档。 [关闭后检查](evidence/v41-completion-native-r2/closure/closed-after-user.json)

关闭检查与单点资源文件经归档敏感扫描后保留原字节。退出事件仅从共享日志的有界完整行前缀中提取三条 run2 原始行。清单追加来源与归档 SHA-256，先前归档条目保持原值。 [本次范围与扫描结果](evidence/v41-completion-native-r2/closure/closure-sensitive-scan.json) · [SHA-256 清单](evidence/v41-completion-native-r2/manifest-sha256.json)
