# 知客 6.0 Horizon Atelier

当前资源目录只服务一套正式产品：WinUI 3 桌面壳、WebView2 工作台、本机 Node sidecar 与 SQLite 数据库。项目不包含 Electron、Docker、PostgreSQL、旧客户端入口或旧数据库迁移链。

## 数据空间

- 6.0 只使用 `%LOCALAPPDATA%\Zhike6`。
- 首次启动创建空白 `workspace.sqlite`，不预置客户、业务记录、账号、聊天或演示数据。
- 不读取、不迁移、也不删除旧 `%LOCALAPPDATA%\Zhike`。
- 数据中心只支持 CSV/Excel 智能导入、6.0 JSON 备份、快照与恢复；旧版备份会被拒绝，6.0 备份恢复前校验 SHA-256 完整性。
- AI Key 使用 Windows 本机加密存储，不写入 SQLite、备份、快照或日志。

## 页面与业务

侧边栏保留完整业务体系：今日工作台、快速录入、任务中心、阶段看板、客户中心、分类视图、热聊管理、群组管理、VIP 管理、跟票管理、报名统计、入金管理、统计分析、WS 工作台、GPT 运营助手、本地自动化、数据治理、数据中心、操作记录、回收站、系统设置和手机号登记。

客户号码关联唯一客户主档；跟票、报名、入金、VIP、群组和跟进保持独立业务记录。同一客户的不同股票以及不同买卖时间不会合并。登记日期与下次跟进日期是两个独立字段。系统设置中的渠道、群粉类型、状态和阶段会同步到导入、筛选和统计。

## 智能导入

- 支持 CSV、TSV、XLS、XLSX 与 XLSM。
- 表头和列顺序不固定，登记日期可以位于任意列。
- 混合文件按行识别客户、跟票和入金，客户资料列不会凭空创建业务记录。
- 每行独立识别渠道、群粉类型、状态、日期和业务目标，不把整表强制归到同一渠道。
- 手机号登记保持独立，不经过客户 AI 导入。
- 预览确认、异常行复核、批次审计和写入前快照均在本机完成。

## WS 工作台

- WhatsApp Web 内嵌在知客中，用户可正常扫码、阅读和发送消息。
- 每个账号使用隔离 WebView2 profile；前台聊天与后台采集互不抢占。
- 后台会在知客切换页面或最小化后继续运行，显式退出或关闭 WS 才停止。
- 一对一会话与系统设置中明确绑定的 VIP 群可进入完整历史采集；普通群排除。
- 未读会话不会被后台自动打开。
- 客户与我方消息都保存原文、方向、时间、发言人和断点；列表预览不冒充完整历史。
- VIP 群按可信 JID/手机号拆分成员，只有唯一匹配到现有客户的成员才可进入其档案和个人跟进评分；不会自动新建客户，也不会把其他成员的话归给该客户。

## AI 与提醒

AI 只补现有客户的空字段，人工值优先且不会被覆盖。低置信度事实必须携带客户本人原文证据；冲突保留原值。资金资质占跟进优先级 55%，聊天粘度占 45%，投资年限只进入档案、不计入提醒分数。提醒统一进入今日工作台、任务中心和阶段看板，回复建议默认由用户确认。

## 开发与验收

```powershell
node scripts/run-tests.cjs all
dotnet build desktop/src/Zhike.Desktop/Zhike.Desktop.csproj -c Release -r win-x64 --no-restore
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/build-winui-bundle.ps1 -Version 6.0.0 -Configuration Release -RuntimeIdentifier win-x64 -SelfContained
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/build-winui-installer.ps1 -AppVersion 6.0.0 -AllowUnsigned -SkipWebView2Check
```

正式验收还必须覆盖真实 WS 登录、手机端消息同步、后台完整历史采集、VIP 群成员归属、AI 补档、任务提醒、备份恢复、覆盖安装和 1 万/5 万客户性能；不能以编译成功代替验收。

当前发布入口与交付清单以 [`docs/current-release-index.md`](../../docs/current-release-index.md) 为准。
