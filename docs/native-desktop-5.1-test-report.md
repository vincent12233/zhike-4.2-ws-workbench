# 知客 5.1 桌面版测试报告

## 自动化结果

以下命令在干净的隔离测试数据/静态契约环境执行，未读取真实业务数据库：

- `node desktop/tests/DesktopVisualContractTests.cjs`：通过
- `node desktop/tests/DesktopResponsiveContractTests.cjs`：通过
- `node desktop/tests/LegacyBridgeContractTests.cjs`：通过
- `node desktop/tests/DesktopSmokeTests.cjs`：通过
- `node tests/compatibility/legacy-ui-host.test.cjs`：通过
- `node tests/server-v2/legacy-state-compatibility.test.cjs`：通过（含 delta-v1 保留未触及集合契约）
- `node tests/desktop-performance-contract.test.cjs`：通过
- `node tests/desktop-packaging-contract.test.cjs`：通过
- `node tests/performance-scale.test.cjs`：通过；10,000 条索引约 130ms、搜索约 11ms；50,000 条索引约 730ms、搜索约 28ms（机器负载会影响绝对值）
- WinUI 自包含构建：`win-x64`，0 warnings / 0 errors

## 覆盖内容

- 原版 21 个 `data-view` 路由和 GPT 入口存在性、视觉 token、WS 栅格和空状态契约。
- 820×540/中等窗口断点、左右栏折叠、DPI scale 参数传递、键盘可达性静态检查。
- bridge request/response、超时、错误码、幂等键、header allowlist 和敏感字段不落日志。
- Postgres legacy state full/delta 写入、revision 冲突、快照接口契约。
- WS 多账号结构、profile 隔离、可见内容采集、断点队列和重复消息去重静态检查。
- 发布包 allowlist、`app.js`/`xlsx.js` 必备资源、敏感文件排除、源码归档和 SHA-256 manifest。

## 尚未自动验证的项目

1. 真实 Windows 桌面启动、WebView2 Evergreen 已安装/未安装两种路径。
2. 实际手机端 WhatsApp 新消息到工作台的端到端同步（需用户现场登录并发送唯一测试文本）。
3. 真实 TeamoRouter/OpenAI Key 的网络额度、超时和模型返回格式。
4. 125%/150% DPI 下的截图像素差异和所有显示器组合。
5. 覆盖安装、卸载后 `%LOCALAPPDATA%\Zhike` 保留以及回滚后的人工确认。

这些项目不能用“编译成功”替代验收，需按人工矩阵逐项记录结果。
