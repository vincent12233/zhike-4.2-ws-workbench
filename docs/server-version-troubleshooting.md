# 故障排查

## API 显示 degraded

检查 PostgreSQL 健康状态和迁移日志：

```powershell
docker compose -f infra/compose.yaml ps
docker compose -f infra/compose.yaml logs --tail=200 api postgres
```

不要直接删除卷。数据库端口只在内部网络开放；桌面端应连接 API 映射端口。

## WS 账号显示未连接

确认桌面端当前账号的 WebView2 Profile 仍存在、用户已在该 Profile 自行扫码，并点击“重新连接”。连接器只报告实际可见且授权的列表/消息；页面结构变化时会暂停采集并显示可重试错误，不伪造同步成功。

## AI 没有生成提醒

先看会话是否有去重后的消息，再看 `ai_jobs` 状态：`pending`、`retrying`、`dead`。AI 只自动补齐空客户字段；已有人工字段会形成待确认冲突，不会覆盖。服务超时不会阻塞聊天和本地录入。

## 迁移报告有冲突

保留原 SQLite，不要重复 apply。查看报告中的 `conflicts` 和 canonical key，确认同一客户的不同股票、买卖方向、登记日期和下次跟进日期是否被拆成独立记录。
