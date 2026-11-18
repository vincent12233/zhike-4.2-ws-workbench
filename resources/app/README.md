# 知客 6.1 A+B

当前资源目录只服务一套正式产品：WinUI 3 桌面壳、WebView2 工作台、本机 Node sidecar 与 SQLite 数据库。项目不包含 Electron、Docker、PostgreSQL、旧客户端入口或旧数据库迁移链。

## 数据空间

- 6.1 沿用 `%LOCALAPPDATA%\Zhike6`。
- 首次启动创建空白 `workspace.sqlite`，并建立未连接的默认 WS 账号配置。客户、业务记录、聊天和演示数据为空。
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

|能力|当前可用范围|
|---|---|
|前台聊天|首次由用户在官方页面自行扫码或登录。实际账号消息操作以目标环境为准。每个账号使用隔离的 WebView2 profile，可手动切换。|
|手动导入|处理用户获准查看的当前可见或选中内容，保存适用的原文、方向、时间和发言人字段。列表预览只表示已保存的本机内容。|
|本机目录|展示已保存的联系人、群组和审计记录。独立群成员管理仅在隔离 Mock 环境启用，普通运行可查看已有进退群历史。|
|后台能力|自动会话发现、后台采集、自动完整历史与后台群监测当前不可用。生产 Worker 和自动 AI 消费者保持关闭。|

VIP 群的手动导入按可信 JID 或手机号拆分发言人。只有唯一匹配到现有客户的记录才可用于个人档案和跟进评分。详见 [WS 能力验收](../../docs/release/rd02-authenticated-profile-acceptance.md)。

## AI 与提醒

AI 只补现有客户的空字段，人工值优先且不会被覆盖。低置信度事实必须携带客户本人原文证据；冲突保留原值。资金资质占跟进优先级 55%，聊天粘度占 45%，投资年限只进入档案、不计入提醒分数。提醒统一进入今日工作台、任务中心和阶段看板，回复建议默认由用户确认。

## 开发与验收

打包前，从 Node.js 24 官方 Windows x64 发布包解出 `node.exe`，放在仓库的 `resources/app/` 下，与 `server.mjs` 同目录。开发命令可使用 PATH 中的 Node.js，随包运行时由前述明确路径提供。

```powershell
node scripts/run-tests.cjs all
dotnet build desktop/src/Zhike.Desktop/Zhike.Desktop.csproj -c Release -r win-x64 --no-restore
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/build-winui-bundle.ps1 -Version 6.1.0 -Configuration Release -RuntimeIdentifier win-x64 -SelfContained
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/build-winui-installer.ps1 -AppVersion 6.1.0
```

正式验收需逐项记录目标机的真实 WS 登录、前台消息同步、手动导入与 VIP 群成员归属、手动 AI 补档、任务提醒、备份恢复、覆盖安装和大客户库性能。后台完整历史按当前不可用记录。

当前发布入口与交付清单以 [`docs/current-release-index.md`](../../docs/current-release-index.md) 为准。
