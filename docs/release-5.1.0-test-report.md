# 知客 5.1.0 桌面版回归与交付报告

## 已验证

- WinUI 3 / WebView2 桌面端 Release（`win-x64`）：0 警告、0 错误。
- PostgreSQL API Release：0 警告、0 错误。
- 原版页面与桌面桥接契约、WS 多账号/隔离/折叠布局、备份与回滚契约通过。
- 业务回归套件：`node scripts/run-tests.cjs all`，54/54 通过（含启动、单壳视觉、原生 smoke 和响应式契约）。
- PostgreSQL/API 回归套件：`node tests/server-v2/run-all.cjs`，19/19 通过。
- 10,000/50,000 条隔离合成数据性能契约通过；本机参考耗时由测试输出记录，未使用真实业务数据。
- 安装包脚本已验证覆盖 Windows PowerShell 5.1 中文路径，且会校验实际生成的 Unicode 文件名。

## 本次高风险修复

- 业务层 `ok:false`、快照未创建、无变更、导入提交失败不再误报成功。
- `/api/state/version` 改为轻量 revision 查询，不再每 5 秒传输完整客户库。
- WS ingest/checkpoint 请求体硬上限 8 MiB，并限制账号、连接器和显示名长度。
- WebView 导航来源、bridge 版本、请求大小和 profile 清理加强；关闭/卸载/切换账号时主动停止隐藏采集。
- AI 上游响应限制 4 MiB、输出限制 100,000 字符、请求默认 `max_output_tokens=4096`；重复 requestId 不会误取消新请求。
- 迁移健康检查按数据库实际已应用版本返回，版本不一致时返回 `schema-mismatch`。

## 尚未自动验证

1. 当前机器实际安装版启动后的人工像素验收、WebView2 Runtime 缺失路径和 125%/150% DPI 截图。
2. 用户实际手机 WhatsApp 新消息到工作台的端到端实时同步（需现场登录并发送唯一测试文本）。
3. 真实 TeamoRouter/OpenAI 网络额度、限流和模型返回差异。
4. 真实 Docker/PostgreSQL 环境的迁移、备份恢复和换机恢复演练（契约与隔离测试已通过）。

以上项目不以“编译成功”替代验收；安装包交付目录同时提供回滚、部署和故障排查说明。
