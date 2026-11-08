# 知客 5.2.0 发布说明

## 发布定位

5.2.0 是当前唯一的生产桌面版本：WinUI 3 + WebView2 承载原版知客页面和 WS 工作台，
PostgreSQL/API/AI Worker/可选 WS Connector 由 Docker 提供后台能力。4.4.24 Electron
仍保留为业务兼容与回滚基线，不与 5.2.0 并列作为日常入口。

| 组件 | 版本/目标 | 说明 |
| --- | --- | --- |
| WinUI 桌面端 | 5.2.0 | 自包含 Windows App SDK，WebView2 用于 WS |
| API / Worker | 5.2.0 | 默认配置由 `ZHike_APP_VERSION` 注入 |
| WS Connector | 5.2.0 | 可选，仅处理用户授权的可见内容 |
| PostgreSQL schema | 011 | 热聊客户档案、证据、事件和 outbox |
| Electron 回滚包 | 4.4.24 | 历史兼容入口，不作为当前入口 |

## 本次交付

- 热聊客户档案：AI 从自然聊天提取姓名、年龄、职业、投资经验、兴趣、预算等字段，
  保存证据和置信度；只补空字段，冲突待人工确认。
- AI 跟进闭环：摘要、意向、情绪、下一话题、回复建议和跟进提醒与客户库、任务中心
  幂等同步，失败可重试，不误报成功。
- 稳定性：关闭窗口前有界刷盘，WS 状态和共享状态轮询可见性退避，大数据量显示容量提示，
  Docker 增加内存/磁盘/迁移锁诊断，安装脚本增加 WebView2、签名和回滚门禁。
- 数据兼容：保留 4.4.24 客户、跟票、入金、VIP、统计口径；迁移目标为 PostgreSQL 011，
  不把登记日期改写为当前日期。

## 升级前备份

1. 退出知客和 Docker 服务，复制 `%LOCALAPPDATA%\Zhike` 到带日期的离线目录。
2. 在数据中心导出完整 JSON/CSV，并随机抽查客户、跟票、入金、VIP 和跟进数量。
3. PostgreSQL 执行 `pg_dump`，保存迁移 manifest、当前 schema 版本和安装包 SHA-256。
4. 不要把备份、AI Key、WS Profile、密码、Cookie、二维码或 Token 放入源码仓库。

## 覆盖安装与迁移

```powershell
Copy-Item infra/.env.example infra/.env
# 编辑 POSTGRES_PASSWORD、ZHIKE_PAIRING_APPROVAL_CODE 和 AI/WS 连接参数
docker compose -f infra/compose.yaml -f infra/compose.prod.yaml up -d --build --wait
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/build-winui-bundle.ps1 -Version 5.2.0
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/build-winui-installer.ps1 -AppVersion 5.2.0
```

安装器只替换程序目录，默认保留 `%LOCALAPPDATA%\Zhike`。首次连接前确认
`/api/v2/health` 返回 `schemaVersion=11`、`databaseStatus=healthy` 和可接受的 Worker 状态；
若返回 `schema-mismatch`，先完成迁移，不要强行写入业务数据。

## 回滚

1. 停止 5.2.0 桌面端和 Docker 服务，但保留 PostgreSQL 卷、dump、日志和用户目录。
2. 使用上一版安装包（5.1.0；必要时使用 4.4.24 Electron）恢复程序文件。
3. 不自动降级 PostgreSQL schema；若旧版无法读取 011，使用升级前 dump 在隔离数据库恢复并对账，
   再决定是否切回旧数据库。确认客户、跟票/入金、VIP、任务和提醒后才恢复写入。
4. 发生版本冲突时使用页面提供的恢复副本/快照，不直接删除表或 Docker 卷。

回滚包只能回滚程序，不代表已经回滚数据库。保留 5.2.0 的新库和迁移报告直到业务核对完成。

## 验证结果与未验证门禁

本次隔离回归已通过：

- `node scripts/run-tests.cjs all`：60/60 Node 合约与恢复检查通过；
- `node tests/task6-stability.test.cjs`：关闭刷盘、轮询退避、容量、WS 错误分类、Docker/安装门禁通过；
- `docker compose -f infra/compose.yaml -f infra/compose.prod.yaml config --quiet`：Compose 配置通过；
- 两个安装脚本 PowerShell 语法解析通过。

以下项目没有在本次隔离环境伪造为“已通过”：

- 本次文档提交前尚未重新执行 5.2.0 WinUI Release 编译；仓库内已有的 5.1.0 bundle 不能
  作为 5.2.0 构建证据，需使用仓库 `.tools/dotnet10` SDK 或目标机 SDK 单独完成门禁；
- 真实 Docker/PostgreSQL 迁移、备份恢复和磁盘不足告警需在目标机执行；
- WebView2 已安装/缺失两条路径、代码签名和覆盖安装/卸载保留数据需人工验收；
- 用户本人登录 WS 后的手机新消息实时同步、AI 额度和页面结构长期稳定性需现场验证。

## 已知限制

- WhatsApp Web 个人账号没有项目可依赖的官方后台全量历史接口；电脑关闭、会话断开或页面
  结构变化时不能保证后台继续采集。
- WS Connector 只处理用户已授权且实际渲染/导入的内容，不绕过验证码、安全验证或读取密码、
  Cookie、二维码、秘密 Token。
- AI 回复默认只生成建议，不自动发送高风险内容；额度不足、超时或格式错误会保留原文并重试。
- WebView2、Windows DPI、签名证书和真实手机同步依赖目标机环境，需按验收清单单独记录。

详细热聊档案操作见 `docs/hot-chat-profile-usage.md`；部署、故障排查和数据库回滚见
`docs/server-version-deployment.md`、`docs/server-version-troubleshooting.md` 和
`docs/server-version-rollback.md`。
