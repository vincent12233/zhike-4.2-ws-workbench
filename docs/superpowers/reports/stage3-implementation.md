# 知客 6.1 A+B 阶段 3 实施报告

## 状态

- 阶段：阶段 3 受控集成开发
- 生产入口：`FROZEN`
- 实施范围：WS 工作台独立导航、隔离群组管理域、迁移 023、Mock Transport、测试与回归
- 未启用：正式 Worker、真实 WhatsApp 连接、生产队列切换、生产数据回填

## 已实现

1. WS 工作台增加独立二级导航，包含概览、账号、群组、成员、消息采集、AI、CRM、任务、日志、设置 10 个页面边界。
2. 导航折叠状态和当前页面按本地工作区保存；页面切换只替换辅助页面，不重建 `#wsBrowserHost`，不会触发前台聊天重连。
3. WS 独立导航默认收起，桌面宽屏使用垂直侧栏，小屏自动改为横向导航。
4. 群组管理核心域提供群组、成员事件、消息、已读证据、同步运行、错误和审计的确定性规则。
5. 群组管理 API 只在隔离 Mock 环境可达，生产默认返回 404；账号 ID 与群组 JID 始终作为数据隔离边界。
6. 确认加入事件允许补齐现有 CRM 主档；待审核加入、身份冲突和无法确认身份不会自动建档；客户来源使用“未分类，待绑定”。
7. 群消息采用账号、群组、消息 ID 幂等；已读证据要求状态单调推进，`read` 必须带平台证据。
8. 增加群组聚合状态读取接口，统一返回群组、成员、消息、已读证据、同步任务、错误和审计。
9. 所有五个阶段 3 群组能力开关均为显式配置，并依赖既有三个 Worker Gate；缺失、错误或未知配置默认关闭。

## 实际修改文件

- `desktop/src/Zhike.Desktop/Services/WorkerFeatureFlags.cs`
- `resources/app/migrations/manifest.json`
- `resources/app/migrations/023-ws-group-manager.sql`
- `resources/app/modules/ws-group-manager-core.js`
- `resources/app/modules/ws-group-mock-transport.js`
- `resources/app/modules/ws-workbench.js`
- `resources/app/modules/ws-workbench.css`
- `resources/app/server.mjs`
- `scripts/run-tests.cjs`
- `scripts/stage3/*`
- 阶段 1.5 兼容性测试的动态 schema 版本读取修正

## 安全边界

Mock Transport 不读取 Cookie、Token、WebView 登录态，不访问网络，也不连接真实 WhatsApp。生产 API 不会因为页面加载或普通环境变量而打开群组管理写入口。

