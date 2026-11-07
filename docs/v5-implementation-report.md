# 知客桌面版 + Docker 服务端实施报告

## 交付边界

本轮在 4.4.24 业务基线上增量实施。桌面端仍是 Windows 原生应用：现有 Electron 版作为可直接回滚/覆盖升级的兼容安装包，`desktop/` 提供 WinUI 3 + WebView2 新壳源码；Docker 只运行 PostgreSQL、API、AI Worker、可选 WS Connector 和备份任务，不提供网页管理端。

## 已完成

- PostgreSQL 迁移 001–008、SQLite→PostgreSQL 只读对账/迁移和回滚元数据。
- 客户身份锁、回收站软删除、AI 只补空字段、冲突证据和审计事件。
- 登记日期、业务日期、下次跟进日期分离；字段顺序无关的混合导入，支持 ISO/日月年/紧凑日期/Excel 序列日期，并按值识别号码、渠道、状态、方向和业务类型。
- 导入提交改为批次级单事务；客户、业务记录、导入行状态和审计事件要么一起提交，要么整体回滚，重试仍由批次锁和业务键保证幂等。
- “单导群组/私聊群组”按单导优先归类；软删除客户的唯一身份在新数据重新出现时只允许从回收站记录安全重绑，不会抢占活动客户身份。
- 同一客户不同股票、买入/卖出、不同日期使用独立业务键；跟票和入金不共享错误去重规则。
- WS 列表级采集协议、消息指纹去重、批次单事务写入、断点单调推进、AI 任务入队、跟进提醒 outbox、账号 Profile 隔离。
- WS 断点接口先校验完整请求，再用一条事务保存多账号断点，失败不会留下前半批数据。
- Docker 连接器 Bearer 凭据、账号级串行 flush、心跳、可选 Playwright 可见 DOM 采集、登录/过期状态防误报；静态连接器 token 仅允许批次/断点/心跳写入。
- WinUI 页面骨架、账号切换竞态保护、WebView2 账号隔离、左右栏折叠、离线队列上限/损坏隔离、API 会话定时轮换。
- 备份临时文件原子改名、清单原子写入、Retention 只匹配 `zhike-*.dump`、pg_dump 密码不进入命令行、失败重试。

## 实际验证

- API、Worker、SQLite→PostgreSQL：`.NET 10` 构建均 0 警告、0 错误。
- `node tests/server-v2/run-all.cjs`：14/14 通过。
- `node scripts/run-tests.cjs all`：48/48 通过。
- WS Connector 5 组直接 Node 测试：全部通过。
- WinUI/桌面静态 smoke：通过；覆盖账号列表、页面职责、折叠布局、API 状态和离线队列。
- WinUI 3 Release (`win-x64`)：本机 `.NET 10` 构建 0 警告、0 错误；发布目录可启动并保持运行超过 3 秒。
- WinUI Inno 安装包：隔离安装、安装后启动、卸载文件清理通过；卸载不删除 `%LOCALAPPDATA%\\Zhike` 用户数据目录（脚本无删除规则）。
- Electron 4.4.24 安装 QA：隔离安装、覆盖安装、WS 资源、卸载后用户数据保留均通过。
- 10,000/50,000 条合成索引搜索参考测试通过；本机参考耗时约 10k 建索引 0.14 秒、搜索 0.01 秒，50k 建索引 0.69 秒、搜索 0.03 秒。

## 尚未能在当前机器完成的门禁

- MSIX 打包/签名：当前环境没有 Windows SDK 和签名证书；已改为可复现的 WinUI 3 unpackaged 发布和 Inno Setup 安装包，并完成隔离安装、启动、卸载冒烟。未把未签名 MSIX 写成已通过。
- WinUI Inno Setup 安装包当前未配置代码签名证书，交付时需按哈希校验并接受 Windows 未验证发布者提示。
- Docker Compose、真实 PostgreSQL、pg_dump/pg_restore：本机没有 Docker Desktop/容器运行时。
- 用户实际 WhatsApp 登录、手机端消息、页面结构长期稳定性和真实 AI 服务额度：需要用户授权的隔离运行环境；当前只完成协议/采集器/去重/队列和模拟回归。
- 未承诺读取平台未渲染且官方接口未提供的后台全量历史；连接器只处理已授权且实际可见内容。

安装包 SHA-256：`AC20E654912500675A03596E3AEEBEB438D8860822A04027501754E9C8184ECE`。
服务器 bundle 的 SHA-256 以随包生成的 `bundle-manifest.json` 和交付目录校验值为准（避免把自引用哈希写进包内报告）。
WinUI bundle SHA-256：`4CE86D0162473612D082C3A0AFF00ED911BFC74A10B04068B4FA9613929EE387`（28,835,180 字节）。
WinUI 安装包 SHA-256：`76DDF247904ABA89C93D6F53ABA709ACFCEBA9B00411AF2E0E6A2A2480B937D5`（24,820,467 字节）。

## 回滚与数据安全

保留 4.4.24 安装包、原 SQLite 和 PostgreSQL dump；升级失败可切回兼容 Electron 安装包。迁移工具默认 dry-run，安装包不覆盖 `resources/app/data`；服务端恢复默认关闭，必须在隔离环境显式开启。
