# Zhike Desktop

WinUI 3 原生桌面壳。主业务页面必须保持 4.4.24 的页面职责和业务语义；WebView2 仅用于 WS 登录、聊天和账号 Profile。

## 本机编译与打包

```powershell
dotnet restore desktop/src/Zhike.Desktop/Zhike.Desktop.csproj -r win-x64
dotnet build desktop/src/Zhike.Desktop/Zhike.Desktop.csproj -c Release --no-restore
powershell -ExecutionPolicy Bypass -File scripts/build-winui-bundle.ps1 -Version 5.1.0
powershell -ExecutionPolicy Bypass -File scripts/build-winui-installer.ps1 -AppVersion 5.1.0
```

当前交付是 WinUI 3 unpackaged 安装包（Inno Setup 外壳），默认自包含 Windows App SDK 运行时资源，不依赖目标机恰好安装同一修订版的 Windows App Runtime；目标机器仍需要 WebView2 Runtime。MSIX 需要另外的 Windows SDK/签名证书门禁，本仓库不把未签名 MSIX 当作已验收产物。

用户数据写入 `%LOCALAPPDATA%\\Zhike`，安装和卸载脚本不会删除该目录。
