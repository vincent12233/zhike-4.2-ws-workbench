# 原生桌面版启动与视觉修复记录

## 启动修复

- WinUI 3 unpackaged 壳注册 `XamlControlsResources`，避免 Microsoft.UI.Xaml 在初始化阶段因资源字典缺失以 `0xc000027b` 退出。
- WinUI 发布默认使用 self-contained Windows App SDK 运行时，并随包携带 `Microsoft.UI.pri`、`Microsoft.UI.Xaml.Controls.pri` 等资源；目标机不再依赖恰好匹配的 Windows App Runtime 修订版。
- 修复 Inno Setup 构建脚本对带空格路径的宏参数截断问题，StageDir/OutputDir 现在显式加引号。
- 安装/卸载只操作程序文件，继续保留 `%LOCALAPPDATA%\\Zhike` 用户数据目录。

## 视觉调整

- 保留现有导航、页面职责、API 和数据口径；仅调整原生壳的视觉层。
- 增加与旧版知客一致的浅蓝工作区背景、深海军蓝品牌色、青绿/蓝色强调色、白色卡片和紧凑控件。
- 顶部增加知客品牌栏、本机优先状态胶囊和业务能力提示；左侧导航支持紧凑/展开两种宽度。
- WS 工作台原有会话、辅助栏折叠按钮和 WebView2 边界保持不变。
- 原生窗口标题改为“知客工作台”。

## 验证

- WinUI build：0 警告、0 错误。
- 安装后进程保持运行，窗口句柄非 0，标题为“知客工作台”；启动后 5 分钟内未出现 Zhike.Desktop.exe Application Error 1000。
- `scripts/run-tests.cjs all`：48/48 通过。
- `tests/server-v2/run-all.cjs`：19/19 通过。
