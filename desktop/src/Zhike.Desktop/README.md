# Zhike Desktop 6.0.0

WinUI 3 原生桌面壳。主业务页面保持既有业务职责和业务语义；WebView2 仅用于 WS 登录、聊天和账号 Profile。
当前只有本机 SQLite sidecar 一条运行链，不连接 Docker/PostgreSQL，也不再提供 Electron 入口。

## 本机编译与打包

```powershell
dotnet restore desktop/src/Zhike.Desktop/Zhike.Desktop.csproj -r win-x64
dotnet build desktop/src/Zhike.Desktop/Zhike.Desktop.csproj -c Release --no-restore
powershell -ExecutionPolicy Bypass -File scripts/build-winui-bundle.ps1 -Version 6.0.0
powershell -ExecutionPolicy Bypass -File scripts/build-winui-installer.ps1 -AppVersion 6.0.0
```

当前交付是 WinUI 3 unpackaged 安装包（Inno Setup 外壳），默认自包含 Windows App SDK 运行时资源，不依赖目标机恰好安装同一修订版的 Windows App Runtime；目标机器仍需要 WebView2 Runtime。MSIX 需要另外的 Windows SDK/签名证书门禁，本仓库不把未签名 MSIX 当作已验收产物。

6.0 用户数据只写入 `%LOCALAPPDATA%\\Zhike6`，首次启动建立空库，不读取或迁移 `%LOCALAPPDATA%\\Zhike`。安装和卸载脚本不会删除新旧任一数据目录。

原生“快速录入与智能导入”默认自动识别客户、跟票、入金或混合目标，也可在预览前显式选择目标。客户中心的跟票/入金/报名/VIP 等派生列只补充客户资料，不会创建业务记录；手机号登记、报名和跟进仍从各自页面导入。
