# V4.1 第二轮原生截图

以下 16 张截图来自 Windows 隔离验收窗口。所见账号、联系人、号码、群组和客户资料均为合成夹具。截图记录各画面的实际可见内容。完整页面轨迹、只读数据回验及进程退出另行记录。

|画面|截图所见|
|---|---|
|[账号修复后列表](evidence/v41-completion-native-r2/captures/r2-02-accounts-fixed.jpg) · [第十次切换画面](evidence/v41-completion-native-r2/captures/r2-switch-10-a.jpg)|账号管理显示默认账号及隔离账号 B，两行均标为未连接。第十次切换画面显示当前为默认账号。|
|[B 通讯录](evidence/v41-completion-native-r2/captures/r2-03-contacts-b.jpg) · [A 通讯录](evidence/v41-completion-native-r2/captures/r2-06-contacts-a.jpg)|账号范围与可见的「隔离通讯录 B」及「隔离通讯录 A」样本相符。合成 `@lid` 项显示号码未提供。|
|[群组目录](evidence/v41-completion-native-r2/captures/r2-07-groups-a.jpg) · [群成员列表](evidence/v41-completion-native-r2/captures/r2-08-members-a.jpg)|默认账号显示两个合成群。同一合成成员在两个群中分别成行。|
|[CRM 冲突](evidence/v41-completion-native-r2/captures/r2-14-crm-conflict.jpg) · [CRM 拒绝](evidence/v41-completion-native-r2/captures/r2-15-crm-reject.jpg) · [CRM 批准](evidence/v41-completion-native-r2/captures/r2-16-crm-approve.jpg)|职业冲突保留人工值并显示实际写入 `null`。语言候选显示已拒绝。另一候选的职业显示已补全为工程师。|
|[前台聊天与 CRM](evidence/v41-completion-native-r2/captures/r2-22-chat-crm-expanded.jpg)|前台容器为空白预览，状态为未连接。右侧 CRM 已展开，显示当前会话未匹配主档。|
|[任务完成率明细](evidence/v41-completion-native-r2/captures/r2-28-task-chart-details.jpg)|任务完成率为 1/2 和 50%。展开的明细显示当前数值 1、总量 2。|
|[浅色非空流转图](evidence/v41-completion-native-r2/captures/r2-32-stage-flow-nonempty.jpg) · [深色非空流转图](evidence/v41-completion-native-r2/captures/r2-34-stage-chart-dark.jpg)|两张均显示「近7天已记录流转 · 1 条」和 11 月 18 日的非零条。两张的数据明细均处于折叠状态。|
|[客户表向下滚轮](evidence/v41-completion-native-r2/captures/r2-36-customer-wheel-down.jpg) · [客户表向上滚轮](evidence/v41-completion-native-r2/captures/r2-37-customer-wheel-up.jpg)|输入探针记录客户表格滚动位置从 0 到 67 px，再从 67 回到 0，页面显示的首行随之变化。|
|[返回窄窗与金额拆行](evidence/v41-completion-native-r2/captures/r2-24-return-zhike.jpg)|恢复至 1422×815 窗口时，旧版首页六卡中的 `¥1,250` 被拆成两行。该截图保留修复前缺陷。|

每张图逐张目视检查并经 JPEG 结构检查。源扩展名为 PNG，文件实际为 JPEG/JFIF，归档改用 JPG 扩展名并保留全部原始字节。`r2-31` 的拍摄区域未出现流转图，未纳入图表证据。 [源与归档 SHA-256](evidence/v41-completion-native-r2/captures-manifest-sha256.json) · [敏感内容扫描](evidence/v41-completion-native-r2/captures-sensitive-scan.json)
