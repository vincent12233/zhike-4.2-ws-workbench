# v5.0.0-dev 服务器版实施记录

## 已实现

- 以 4.4.24 为业务兼容基线，保留客户、快速录入、跟票、入金、VIP、任务、看板、统计和 AI 运营职责。
- 新增 PostgreSQL 版本化迁移、SQLite 只读迁移 dry-run/apply/rollback 元数据和冲突报告。
- 新增 Worker 心跳迁移与健康状态：桌面端可区分 `running`、`stale`、`unknown` 和数据库不可用。
- 新增字段顺序无关的混合导入分类，登记日期与下次跟进日期分离；同一客户不同股票、买卖方向和日期保持独立业务记录。
- 新增消息指纹、事务 outbox、AI 任务重试/死信、断点和跟进提醒去重。
- 新增列表级 WS 采集协议、可见消息范围、断点续采、重连状态和账号 Profile 隔离约束。
- 新增 WinUI 3 原生桌面页面与 WebView2 WS 页面边界、左右栏折叠、820×540/DPI 布局和离线队列。
- 新增配对/会话轮换、日志脱敏、PostgreSQL 备份与隔离恢复计划。
- 连接器凭据收窄为批次/断点/心跳写入接口，支持只读 secret 文件回退；普通配对会话才可读取账号和跟进数据。
- Docker/远程配对增加一次性审批证明：桌面端可输入 `ZHIKE_PAIRING_APPROVAL_CODE`，未携带证明的桥接、转发或伪造 Host 请求直接拒绝；审批码不会写入普通 API 请求，也不会持久化到桌面用户数据。
- WS 批次写入与断点写入采用单事务路径，导入批次使用同批 advisory lock 保证崩溃后可重试、不重复写入。
- 连接器增加可选 Playwright 可见 DOM 采集、登录/过期状态识别、账号级串行队列和心跳；未登录页面不会写入聊天数据。
- 连接器 Docker 镜像使用锁定的 `package-lock.json` + `npm ci`，并在镜像内安装并验证 Chromium；镜像体积约 1.64 GB（由约 3.71 GB 降低）。
- 桌面端增加账号添加竞态保护、离线队列大小/寿命上限、损坏队列隔离和会话定时轮换。
- 修正 WinUI WebView2 依赖版本与命名空间，WinUI 3 Release 构建已在本机 0 警告、0 错误通过。
- 新增 WinUI 可复现发布脚本、bundle manifest 和 Inno Setup 安装包；安装/启动/卸载隔离冒烟已执行。

## 本轮产物

- 兼容版桌面安装包（Electron 4.4.24，保留原有业务逻辑）：`work/legacy-installer-final/知客-4.4.24-WS工作台智能录入版.exe`。
- 原生桌面 bundle（WinUI 3 + WebView2，win-x64）：`work/winui-bundle-final/zhike-winui-5.0.0-win-x64.zip`。
- 原生桌面安装包（WinUI 3 unpackaged + Inno Setup）：`work/winui-installer-final/知客-5.0.0-WinUI桌面版.exe`。
- Docker 服务端 bundle（PostgreSQL/API/AI Worker/WS Connector/迁移/备份）：`work/server-bundle-final/zhike-server-5.0.0-dev.zip`。
- 产物均不包含真实业务数据库、AI Key、WS 密码、Cookie、二维码或 Token。
- Docker 服务端 bundle SHA-256：`889121E3A515537E2E683EC0A0CECE785B684380200C0CCB3C72DF54BD7FB933`，大小 `107,446` 字节（包内报告仍以 `bundle-manifest.json` 为准，避免自引用）。
- 兼容 Electron 安装包 SHA-256：`08A02641DFD3BCA35306B3F27BBF56EEC10A7F9A236D5F2CCD5943830D76A039`，大小 `173,976,589` 字节。
- WinUI bundle SHA-256：`6B8570378C01E035DD04EBC7391E476D6B33430F690C6107BBE2C27961D94413`，大小 `28,166,395` 字节。
- WinUI 安装包 SHA-256：`153A896ABAB7EC9FDF84BC786EE032B59EEEC55D3D5E05CF2EF27D8187B0E1EA`，大小 `24,820,864` 字节。

## 当前机器验证结果

- Docker Desktop 4.98.0 / Engine 29.9.2 / Compose 5.6.1 已在隔离项目 `zhike-smoke-20261108` 实测：PostgreSQL 18.6、API、AI Worker、备份启动正常，API 端口 `127.0.0.1:48180` 可达，迁移 1–9 完整执行，健康接口返回 `workerStatus=running`。
- 实测无审批证明的桥接/转发配对请求为 403，携带本地证明后配对成功；WS 首次写入/重复去重为 `1/1`，坏批次原子拒绝，断点不回退；无 AI Key 时任务为 pending 且不创建空客户；18.6 的 pg_dump/pg_restore 完成隔离恢复。

## 仍未在当前机器验证

- 用户实际 WS 登录、手机消息实时同步和平台页面结构长期稳定性：需要在有工具链和用户授权会话的隔离环境中执行。
- 真实 AI 服务额度、真实 WhatsApp 登录和手机端消息同步仍需用户在自己的已授权会话中完成；本机已完成协议、去重、断点和无密钥延后验证。
- MSIX 打包/签名和没有预装 Windows App Runtime 的换机安装：当前机器没有 Windows SDK/签名证书；已交付的 WinUI 安装包是 unpackaged 版本。
- 当前 WinUI Inno Setup 安装包未配置代码签名证书，Windows 可能显示发布者未验证；安装包内容和哈希可通过本记录核对。

## 当前明确限制

- 当前连接器只处理用户已登录且页面实际渲染的可见列表/消息；WhatsApp 官方未提供的后台全量历史读取不能由本项目保证。
- 本轮不把真实手机消息、真实 WhatsApp 页面长期稳定性或 AI 服务额度写成已通过；Docker 基础设施和隔离协议门禁已通过。WinUI Release 构建和安装/启动/卸载隔离冒烟已经通过。

这些项目不能用“源码检查通过”替代正式验收，发布前必须完成对应门禁。
