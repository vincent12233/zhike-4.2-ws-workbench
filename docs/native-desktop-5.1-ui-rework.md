# 知客 5.1 原版页面复用桌面版（历史）

> 本文记录 5.1 的界面复用方案；当前生产版本为 5.2.0，构建和验收以
> `docs/release-notes-5.2.0.md` 为准。

## 交付范围

5.1 采用 WinUI 3 原生窗口 + WebView2 页面宿主。桌面窗口、导航、DPI、窗口记忆、WS 隔离 WebView 和故障回退由原生壳负责；业务页面继续使用仓库中的 `resources/app` 原版页面、CSS、路由和数据口径。PostgreSQL/Docker API 是配对工作区的权威数据源，不新增第二套 SQLite 权威库。

## 单一界面壳原则

生产默认路径只显示 `resources/app` 的原版顶栏、侧栏和业务页面。WinUI 的原生顶栏与 `NavigationView` 只在兼容回退模式（`ZHIKE_DESKTOP_LEGACY_UI_HOST=0`）显示；默认模式会同时收起原生顶栏、顶部占位和侧栏，避免两套导航叠加。原生页面代码保留为故障诊断回退，不作为第二套日常业务界面。

本次收口内容：

- 保留原版全部导航标签和页面体系，WinUI 只作为稳定宿主，不重写业务页面。
- 旧 `/api/*` 调用经版本化 desktop bridge 适配到 v2 API；未实现的接口返回明确 `UNSUPPORTED`，不会伪造保存成功。
- `delta-v1` 状态写入在服务端合并 `upsert/remove/fields`，不会因为一次增量编辑覆盖其他客户集合。
- WS 账号列表默认有结构性“默认账号”行；每个账号使用独立 WebView2 profile，账号切换不会共享会话。
- WS 登录视图固定在工作台边界内，左右辅助栏状态和窗口布局可记忆；可见、已授权的页面内容才会进入采集队列。
- AI 请求使用 Windows DPAPI 的 WinUI 专用凭据文件；旧 Electron 凭据文件不被覆盖，读取时尝试兼容迁移。AI 支持附件上下文、管理建议 actions、超时和取消。
- 页面失败时显示重试、诊断和兼容页面动作；桥接失败不会让原生兼容页面或服务端数据崩溃。
- 发布资源采用 allowlist，只包含原版 HTML/JS/CSS、模块和 XLSX 解析器；不带 Electron runtime、数据库、日志或凭据。

## 启动与配置

1. 先启动 Docker PostgreSQL/API/Worker，并在“今日工作台 → 服务设置”完成一次配对。
2. 安装 `知客-5.1.0-WinUI桌面版.exe`。
3. 首次启动若提示 WebView2，请安装 Microsoft Edge WebView2 Evergreen Runtime 后重试。
4. API 地址、会话令牌和配对证明保存在当前 Windows 用户的 `%LOCALAPPDATA%\Zhike\desktop-connection.json`（DPAPI 保护）；不会写入页面文本或日志。
5. AI Key 在 GPT 运营助手中配置。WinUI 使用 `%LOCALAPPDATA%\Zhike\ai-credentials-winui.json`，旧版 Electron 的 `ai-credentials.json` 保留不覆盖。

可选环境变量：

- `ZHIKE_API_BASE_URL`、`ZHIKE_API_TOKEN`：覆盖已保存的配对会话。
- `ZHIKE_DESKTOP_LEGACY_UI_HOST=0`：临时关闭原版页面宿主，回到原生兼容页面。
- `ZHIKE_ALLOW_DEV_RESOURCES=1`：仅开发调试时允许从仓库加载 `resources/app`；正式安装包不应设置。

## 已知限制

- WhatsApp Web 页面结构由平台控制，采集器只处理当前登录账号在可见、已授权页面中的会话列表/消息；不能承诺读取被平台隐藏或尚未加载的历史内容，也不读取密码、Cookie、二维码或秘密 Token。
- Postgres v2 尚未提供的历史 Electron 路由（旧 WS 会话/分析/回复导出、旧 SQLite 导入、数据治理诊断等）会明确显示不支持，需要使用数据中心/服务器入口。
- 系统通知和自动备份按钮在 WinUI bridge 中保留安全的显式“不支持”提示，实际备份使用数据中心的服务器策略。
- 未在本机真实手机 WhatsApp 和所有 Windows DPI 组合上做自动化视觉验收；需按测试报告中的人工矩阵复核。
