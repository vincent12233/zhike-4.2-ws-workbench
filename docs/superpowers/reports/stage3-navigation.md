# 阶段 3 WS 工作台导航报告

## 页面与状态

WS 工作台内新增 10 个稳定页面 ID：`overview`、`accounts`、`groups`、`members`、`collection`、`ai`、`crm`、`tasks`、`logs`、`settings`。

导航状态保存在 WS 工作区本地状态中，异常值回退到 `overview`。导航点击不会销毁或重建原生 WebView 宿主，辅助页面与前台聊天共用同一运行时边界。

## 布局

- 独立 WS 二级侧栏，不改知客主侧边栏。
- 默认收起 56px，展开 214px。
- 收起时 WS 标识和展开按钮仍可见，不裁切交互控件。
- 辅助页面拥有独立滚动容器并设置 `overscroll-behavior: contain`。
- 900px 以下窗口切换为横向可滚动导航，避免挤压聊天区域。

## 验证

测试：`node scripts/stage3/ws-workbench-navigation.test.cjs`

结果：`Passed`。同时通过 WS 回归中的 WS 布局、滚动稳定性、前台隔离和辅助抽屉测试。

## 未完成的真实验收

本阶段未在真实 WhatsApp 会话中进行交互视觉验收；该项属于后续获得生产 WS 联调授权后的验收，不影响当前生产 Gate 继续冻结。

