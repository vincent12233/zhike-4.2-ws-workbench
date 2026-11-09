# 知客 5.3.0 服务器版运行说明

这是知客 5.3.0 桌面版的可选服务器运行层，不提供浏览器管理界面。默认 Compose 只把 API 绑定到本机 loopback（便于个人桌面使用）；跨机器或生产部署必须在 API 前放置 HTTPS 反向代理，并让桌面端使用 `https://` 地址。WS 页面仍由桌面端 WebView2 或授权的隔离连接器承载。

## 首次启动

1. 复制 `.env.example` 为 `.env`，设置随机的 `POSTGRES_PASSWORD` 和
   `ZHIKE_PAIRING_APPROVAL_CODE`。桌面端首次配对时，在“服务器连接”中填入同一个审批码；
   它只用于本机/私有网络配对，不要复用数据库、连接器或 AI 密钥。
2. 使用 `docker compose -f infra/compose.yaml -f infra/compose.prod.yaml up -d --wait` 启动。
3. 仅 API 端口映射到本机（默认 `127.0.0.1:48080`）；PostgreSQL 只在 `zhike_internal` 网络可见，不能直接暴露 5432。
   API 同时加入专用 `zhike_ingress` bridge，这是 Docker Desktop 4.98 在 internal-only 服务上保持
   published port 可达所需的兼容层；该网络关闭 bridge IP masquerade，API 不依赖它发起外部请求。
   Docker Desktop 仍可能保留容器默认路由；如需硬性禁止 API 外联，请另配主机或企业防火墙规则。
   AI Worker 和 WS 连接器另外加入不发布端口的 `zhike_egress` bridge：前者需要访问已配置的
   AI HTTPS 服务，后者需要访问用户授权的 WS 页面。PostgreSQL 和备份容器仍只加入
   `zhike_internal`；不要把 `ZHike_API_BIND` 改为 `0.0.0.0`，除非你已配置私有网络访问控制。
4. 打开桌面端，在“服务器连接”中填写 API 地址并完成一次性配对。

升级网络配置时，先执行不带 `-v` 的
`docker compose -f infra/compose.yaml -f infra/compose.prod.yaml down`，再重新执行
`docker compose -f infra/compose.yaml -f infra/compose.prod.yaml up -d --wait`，让 Docker
重建 `zhike_ingress`；不要使用 `down -v`，否则会删除 PostgreSQL 和备份卷。

配对接口默认只接受 loopback 请求。Docker Desktop 会把本机 loopback 请求经过桥接网络转发；Compose
默认开启 `ZHike_ALLOW_DOCKER_LOOPBACK_PAIRING=true`，但这条兼容路径同时要求请求来自专用
`ZHike_DOCKER_LOOPBACK_PAIRING_SOURCE_CIDR`（默认 `172.31.240.0/24`）、`Host` 为 `localhost`、
`127.0.0.1` 或 `[::1]`，并携带与 `ZHIKE_PAIRING_APPROVAL_CODE` 相同的
`X-Zhike-Pairing-Approval`。仅靠来源 CIDR 不能区分 Docker Desktop 的其他本地容器，缺少审批码时
所有桥接容器请求都会被拒绝。若把 API 绑定到本机以外的地址，应关闭该选项，并改用审批码；不要把
来源 CIDR 改成局域网网段。
如果 API 前面放置本机反向代理，代理必须保留/写入 `Forwarded`、`X-Forwarded-For` 或
`X-Real-IP`；检测到这些转发身份头时，配对请求不会走 loopback 免审批路径，必须使用审批码。
若确实需要从同一私有网络的另一台电脑配对，必须同时设置
`ZHike_ALLOW_REMOTE_PAIRING=true` 和一条独立的随机 `ZHIKE_PAIRING_APPROVAL_CODE`；桌面端
会把该值仅放在配对请求的 `X-Zhike-Pairing-Approval` 请求头中。不要复用数据库密码、连接器
Token 或 AI Key，也不要把 API 端口直接暴露到公网。未配置审批码时，远程配对会被拒绝。

如果启用 Docker WS 连接器，还要在 `.env` 设置一条随机的 `ZHIKE_API_TOKEN`。API
会把它作为仅限 `/api/v2/ws/*` 的连接器凭据；它不是桌面配对会话，不能访问客户和
业务接口。也可以把凭据写入容器内只读文件并设置 `ZHIKE_API_TOKEN_FILE`，避免把
密钥放在命令行参数中。连接器可通过 `ZHIKE_WS_URL` + `ZHIKE_ACCOUNT_IDS` 启用
Playwright 可见 DOM 采集；未设置时仅等待外部授权采集器通过 stdin 输入 JSONL。

连接器凭据进一步限制为批次写入、断点写入和心跳三个 POST 接口；读取账号列表、跟进
提醒或客户/业务数据必须使用桌面端配对会话。若使用文件凭据，API 容器与连接器容器
需要各自挂载同一份只读 secret，并将路径分别填入 `ZHIKE_API_TOKEN_FILE`。

工作进程会按 `ZHike_BACKUP_INTERVAL_MINUTES`（默认 60 分钟）在共享备份卷中生成
`zhike-*.dump`，并按 `ZHike_BACKUP_RETENTION`（默认保留 14 份）滚动清理；清理范围
只匹配该前缀，不会删除同目录中的其他文件。

## 备份与恢复

- `infra/backup/backup.ps1 -Action backup -DryRun` 只生成计划，不读取或删除业务文件。
- 正式备份使用 `-Action backup`；只清理 `zhike-*.dump` 和对应的 `.json` 清单，保留其他文件。
- 恢复先使用 `-Action restore -DryRun`，再恢复到隔离数据库。生产数据库覆盖恢复不由桌面端自动执行。
- 数据迁移前保留旧版 SQLite 原文件和一份 PostgreSQL dump；迁移失败时回滚桌面端连接配置即可继续使用 4.4.24。

## 安全边界

不保存 WhatsApp 密码、Cookie、二维码或秘密 Token；日志通过脱敏器处理。连接器的
持久化 Profile 只由浏览器引擎管理，不读取或导出 Cookie。WS 连接器只能处理用户已经
授权且实际采集到的可见内容，不能承诺平台未提供的后台全量历史；桌面端是正式交互
入口，普通浏览器管理页已停用。
