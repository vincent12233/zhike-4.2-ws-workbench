# Zhike Desktop 6.1.0

WinUI 3 承载主窗口和原生集成。主业务页面及 WS 工作台使用 WebView2，WS 登录按账号隔离。SQLite sidecar 随包运行，数据存放在 `%LOCALAPPDATA%\Zhike6`。

安装包为 Inno Setup 外壳的 WinUI 3 自包含 x64 构建。目标系统需达到 Windows 内部版本 22621 并安装 WebView2 Evergreen Runtime。生成和验证候选安装包请参照仓库的《候选发布计划》。

首次使用本机数据目录时创建空库。“快速录入与智能导入”支持客户、跟票、入金及混合文件。手机号登记、报名和跟进由各自页面导入。升级前请在“数据中心”导出备份。旧 `%LOCALAPPDATA%\Zhike` 数据不会自动迁移。

前台 WS 的扫码和登录由用户本人完成。自动采集和生产 Worker 保持关闭。详见随包《本机部署说明》。
