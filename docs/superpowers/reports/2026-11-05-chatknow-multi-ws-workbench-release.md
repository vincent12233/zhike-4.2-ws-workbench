# 知客 4.2.2 多账号 WS 工作台发布验收记录

日期：2026-11-06

## 交付范围

本次在现有知客 4.1 项目上增量交付多账号个人 WS 工作台。原有客户中心、快速录入、跟票、入金、统计、数据中心、设置和 GPT 助手保留，业务数据格式和统计口径不变。

- 同一工作台支持多个 WS 账号卡片/标签切换。
- 每个账号独立 BrowserView 持久化分区和 WS 数据分区。
- 固定 WS 页面、三栏布局、左右侧栏折叠、窄窗口移动面板。
- 可见会话列表发现、当前可见聊天自动采集、手动导入、翻译、AI、客户同步和跟进提醒。
- 账号/会话上下文护栏，重复写入幂等，客户和跟进失败回滚。

## 代码和审查

- Task 1 数据库账号迁移：`3a268b8`，审查通过。
- Task 2 BrowserView 生命周期：`bdc16a1`、`7cab242`、`bff17e1`、`63e30f3`、`1ce9243`、`0278681`、`e154510`，审查通过。
- Task 3 ChatKnow 风格 UI 与异步上下文：`0269af6`、`31f8f59`、`3d66111`、`c14589e`、`a20154`，最终审查 Spec/Quality ✅。
- Task 4 采集/AI/CRM 同步：`6a969b7`、`6639c6b`，最终审查 Spec/Quality ✅；可见列表现在会传 WS 外部标识和账号标识，回归测试覆盖去重、过期响应、跨账号拒绝和回滚。

## 验证命令和结果

| 命令 | 结果 |
| --- | --- |
| `node scripts/run-tests.cjs all` | 35 checks，35 passed，0 failed |
| `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/build-installer.ps1 -StageOnly` | 通过；142 个文件进入干净 staging，未包含真实数据 |
| `ZHIKE_EXPECTED_VERSION=4.2.2 node tests/ws-installer-qa.cjs` | 通过；隔离安装、覆盖安装、WS 资产、卸载与用户文件保留 |
| `ZHIKE_EXPECTED_VERSION=4.2.2 node scripts/run-tests.cjs installer` | 2 checks，2 passed；缺少旧 4.1.3 安装包的升级项明确 SKIP |

## 安装包

- `releases/知客-4.2.2-WS工作台完善版.exe`
- SHA-256：`3B4267FC76857390EE9C71F2B5BF497337539762030334FC3A412BD438A2A0AF`
- 大小：173,915,466 字节
- 运行时：Electron 45.2.1、Node.js 24.22.1、Inno Setup 6.7.3
- 用户输出副本：`C:\Users\酷酷\Documents\Codex\2026-11-04\c-users-documents-codex-2026-11\outputs\知客-4.2.2-WS工作台完善版.exe`

## 数据安全和回滚

构建 staging 不包含真实 CRM 数据、WS 登录分区、Cookie、密码、二维码、秘密 Token、API Key 或日志。升级前应在数据中心创建 JSON 备份；自动备份只清理自身命名的旧文件。清除登录会话只删除当前账号站点存储，客户、消息、翻译、分析和跟进记录保留。恢复失败时使用恢复前快照或 JSON 备份回滚。

## 仍未验证

- 真实 WS 扫码登录、多真实账号同时在线、消息同步和平台 DOM 变化。
- 820×540、最大化和不同 Windows 缩放比例下的用户现场截图级验收。
- WhatsApp 个人账号官方后台授权接口，以及页面关闭/电脑关机/完全不可见历史的后台采集。

这些项目需要用户在自己的 Windows 账号和屏幕环境中完成现场确认；不以“编译成功”代替验收。
