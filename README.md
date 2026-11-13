# 知客 6.0 Horizon Atelier 本机桌面版

知客是现有 4.1 业务体系的升级版。正式产品只有一套桌面运行链：WinUI 3 + WebView2 + 随包 Node SQLite 本机服务。客户中心、快速录入、跟票、入金、报名、统计、数据中心、设置、GPT 助手和 WS 工作台都使用同一份本机数据，不需要 Docker、PostgreSQL、远程 API 或 Electron。

## 当前入口

- 安装包：`outputs/知客-6.0.0-WinUI桌面版/知客-6.0.0-WinUI桌面版.exe`
- 构建清单：`outputs/知客-6.0.0-WinUI桌面版/bundle-manifest.json`
- 校验值：`outputs/知客-6.0.0-WinUI桌面版/SHA256SUMS.txt`
- 当前索引：`docs/current-release-index.md`

安装器会创建桌面快捷方式。6.0 业务数据独立保存在 `%LOCALAPPDATA%\Zhike6`，首次启动创建空 SQLite 库且不预置演示数据。6.0 不读取、不迁移旧 `%LOCALAPPDATA%\Zhike` 数据；安装和卸载也不会主动删除旧目录。

## 业务与 WS/AI

本版保留原有统计口径和独立业务记录：同一客户不同股票、买入/卖出和不同入金记录不会合并；号码只用于关联客户主档案。VIP、渠道、群组、热聊和任务筛选共享设置中的选项。

WS 工作台支持多账号标签、登录状态、全量聊天列表扫描、已读会话自动逐个采集、未读跳过、可见消息采集、手动导入、原文/译文、AI 摘要、客户意向/情绪/职业/年龄/来源等字段提取、客户主档案补齐和跟进提醒。一对一会话与系统设置中明确绑定的 VIP 群可进入完整历史采集；普通群排除。VIP 群消息按可信发言人身份拆分，只有唯一匹配到现有客户的成员才进入该客户档案和个人跟进评分，不自动新增客户，也不把其他群成员的话归给该客户。AI 只补充空字段或生成待确认建议，不覆盖已有人工内容；低置信度、身份冲突、付款/退款/验证码/金融/法律/医疗/价格或交付承诺只提示人工确认，不自动发送。

WhatsApp Web 没有适合个人账号的后台接口。知客可以扫描当前已登录页面的聊天列表（无需逐个打开会话），并采集当前页面实际渲染且用户授权可见的消息；不会读取密码、Cookie、二维码或秘密 Token，也不承诺电脑关闭后继续接收端到端加密内容。

## 数据、备份与恢复

在“数据中心”进行本机备份、导出和恢复。导入、批量删除、渠道设置和 AI 同步在写入前创建快照；写入失败会保留原始数据并允许重试。恢复或换机前先导出备份，勿直接删除 `workspace.sqlite`。

## 目录

- `desktop/`：WinUI 3 桌面壳、WebView2、WS 隔离和本机桥接。
- `resources/app/`：原版知客页面、本机 SQLite sidecar、迁移和业务模块。
- `tests/`、`desktop/tests/`：本机服务、WS 采集、AI/CRM、导入、性能和安装回归。
- `docs/`：仅保留 6.0 当前部署、故障排查、业务说明、发布说明与测试报告。
- `zhike-desktop-setup.iss`、`scripts/build-winui-*.ps1`：唯一正式构建入口。

旧 Docker/PostgreSQL/Electron 运行时已从正式项目移出，不属于当前产品，也不存在可启动的旧回退入口。6.0 不从历史运行时或旧业务库导入数据。

## 开发、测试与打包

需要 Node.js 24+、.NET 10 SDK、Windows App SDK 和 WebView2 Runtime。

```powershell
node scripts/run-tests.cjs all
dotnet build desktop/src/Zhike.Desktop/Zhike.Desktop.csproj -c Release -r win-x64 --no-restore
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/build-winui-bundle.ps1 -Version 6.0.0 -Configuration Release -RuntimeIdentifier win-x64 -SelfContained
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/build-winui-installer.ps1 -AppVersion 6.0.0 -AllowUnsigned -SkipWebView2Check
```

构建产物只写入 `work/`，交付文件放到 `outputs/知客-6.0.0-WinUI桌面版/`。不以“编译成功”代替验收；真实 WS 登录、手机新消息和外部 AI 服务需要在目标机由用户本人完成环境验证。

## 安全边界

WS 登录、扫码、验证码和发送操作由用户本人完成。所有 AI 建议默认需要人工复制或确认；关闭翻译或 AI 后不调用对应服务，采集和原文保存仍可继续。日志会脱敏，不记录密码、Cookie、二维码和密钥。
