# 当前版本索引

更新时间：2026-11-14

## 唯一日常入口

- 产品版本：知客 6.0.0 Horizon Atelier WinUI 桌面版
- 安装包：`outputs/知客-6.0.0-WinUI桌面版/知客-6.0.0-WinUI桌面版.exe`
- 交付清单：`outputs/知客-6.0.0-WinUI桌面版/bundle-manifest.json`
- 校验值：`outputs/知客-6.0.0-WinUI桌面版/SHA256SUMS.txt`
- 安装包、运行文件与完整源码的校验值以同目录 `SHA256SUMS.txt` 为准，发布时重新计算。
- 本机部署说明：`docs/local-desktop-deployment.md`
- 故障排查：`docs/local-desktop-troubleshooting.md`

WinUI 3 桌面应用承载知客页面、WS 登录/聊天窗口和本机服务；随包 Node sidecar 使用 SQLite 保存客户、业务、WS 消息、AI 分析和跟进提醒。旧桥接和旧客户端不作为启动入口，当前没有第二套 Docker/PostgreSQL/Electron 生产入口。

## 数据规则

客户主档案按号码、WS 标识和人工确认关联；跟票、入金、报名、跟进保持独立业务记录。导入支持客户、跟票、入金和混合表格按行识别，手机号登记仍使用专用页面，不会误写客户中心。

WS 工作台会扫描当前已登录页面的聊天列表；“自动采集已读会话”会按顺序加载已读会话，保存客户和我方双方的历史消息、角色与顺序，未读会话永不自动打开并以 `skipped_unread` 留痕。原生历史必须完成方向核实及最终落库后才可交给 AI；列表预览不代表完整聊天，方向未知不默认算客户。列表变化与正文权威哈希分开，手动导入继续保留。一对一会话与系统设置中明确绑定的 VIP 群可进入完整历史采集，普通群排除；VIP 群按可信 JID/手机号拆分成员，只有唯一匹配到现有客户的成员才进入其档案和个人跟进评分。AI 仅按客户本人陈述或确认的证据补齐已匹配客户的空字段，生成摘要和任务中心/今日工作台提醒；不从我方自我介绍或其他群成员发言推断客户资料，冲突保留原值，未匹配客户不会新建档案。

## 构建入口

```powershell
node scripts/run-tests.cjs all
dotnet build desktop/src/Zhike.Desktop/Zhike.Desktop.csproj -c Release -r win-x64 --no-restore
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/build-winui-bundle.ps1 -Version 6.0.0 -Configuration Release -RuntimeIdentifier win-x64 -SelfContained
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/build-winui-installer.ps1 -AppVersion 6.0.0 -AllowUnsigned -SkipWebView2Check
```

## 反回滚边界

仓库与正式输出目录不保留 4.x/5.x 安装器、旧发布说明、旧 Electron/Docker/PostgreSQL 入口或历史数据迁移链。6.0 只从当前 WinUI 构建入口启动，首次运行使用全新的 `%LOCALAPPDATA%\Zhike6` 空数据空间，不读取或迁移旧 `%LOCALAPPDATA%\Zhike`，也不预置演示数据。正式输出目录只允许当前 6.0 安装器、构建清单和 SHA-256 校验清单。

## 验收边界

6.0.0 运行规则：扫码登录并启用采集后，会话列表、联系人索引和实时消息由隔离采集器持续同步；切换知客页面、最小化仅隐藏画面，不停止采集/AI。完整历史由后台逐会话补采，用户无需手工打开；未读会话不自动激活，普通群与类型不明会话不进入分析和提醒，只有系统设置中明确绑定的 VIP 群按成员身份进入与一对一会话相同的分析链。显式关闭 WS、清会话、退出应用、关机或休眠会停止。

自动化回归覆盖本机 sidecar、导入/保存/恢复、WS 列表采集、消息幂等、AI/CRM 联动、跟进提醒、性能和 WinUI 打包。真实 WhatsApp 登录、手机端实时消息和外部 AI 额度必须在目标机完成手工验收；不以编译成功代替验收。

6.0.0 安装验收：安装后本机服务应返回 `appVersion=6.0.0`、`databaseStatus=healthy`、`workerStatus=running`、`storage=sqlite`；首次安装必须创建空数据空间，同一 6.0 数据空间的覆盖升级才允许保留业务数据。AI 仅对唯一匹配的现有客户补齐有证据的空字段。WS 会话列表同步、实时消息监听和完整历史补采必须分开计数；完整历史成功落库后才允许 AI 补档。提醒优先级严格按资金实力 55% 与聊天粘度 45% 复算，投资经验不计分。
