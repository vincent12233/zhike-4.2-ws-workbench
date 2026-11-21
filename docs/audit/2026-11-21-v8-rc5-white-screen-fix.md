# 2026-11-21 · RC4 白屏根因与 RC5 修复报告

## 1. 根因（实测，不是推测）

用户报告的“RC4 白屏”，实际运行的不是 RC4：

| 证据 | 实测值 |
| --- | --- |
| 运行进程 | `Zhike.Desktop.exe`，PID 21936 |
| 实际 EXE 路径 | `C:\Users\Administrator\Desktop\ZhikeNative\Zhike.Desktop.exe` |
| EXE 产品版本 | `6.1.0+bddb8ae33604110cdd191d7b7589fc8fe9d692bf` = **rc.3**，文件日期 2026-11-19 |
| 默认安装目录 | `%LOCALAPPDATA%\Programs\ZhikeNative` 为 `6.1.0+9c44322…`，也不是 rc4 |
| rc4 特征版本 | `6.1.0+43ca0aa…`，在两个安装目录中均未出现 |
| 运行中的 sidecar | **没有** node 进程 |

直接以该安装的 sidecar 启动参数复现，得到真实错误：

```
MigrationError: 数据库 schema 版本 34 高于当前支持版本 25，已拒绝写入。
  at runMigrations (.../migration-runner.cjs:454)
  at file:///.../server.mjs:134
  code: 'SCHEMA_VERSION_UNSUPPORTED'
```

共享数据库 `%LOCALAPPDATA%\Zhike6\workspace.sqlite` 已被新构建迁移到 schema 34；桌面上这份 rc.3（schema 25）拒绝写入并立即退出。主程序一直等不到健康检查，WebView2 初始化根本没走到，诊断因此只显示“未初始化”。

结论：不是 WebView2 Runtime 缺失，也不是资源路径错误（资源根目录就是它自己的安装目录），而是**旧版本程序打开新版本数据库**，且启动失败原因被通用文案吞掉。

## 2. 修复内容（`e6a23bb`）

1. `LocalServiceManager` 保留 sidecar stdout/stderr 的有界尾部（约 3 KB）与 `LastFailure`；启动失败时把最后一行真实输出附在异常里（例如上面那条 schema 文案），不再只有“启动超时”。
2. 宿主两条加载路径都保留原始异常：`知客页面加载失败：<真实原因>`、`知客页面资源暂时不可用：<真实原因>`，并记录失败阶段。
3. “查看诊断”现在输出：应用版本、EXE 路径、资源根目录、WebView2 运行时版本与状态、sidecar 是否运行与地址、健康检查结果、数据目录、最近失败阶段、最近失败原因、sidecar 最后输出。不包含任何 token。
4. 新增 `tests/host-diagnostics-contract.test.cjs`（5 项断言），并纳入全量套件。

没有放宽 schema 保护：旧程序仍然拒绝写新库，这是数据安全边界，不能为了“能打开”而回退或改写用户数据库。

## 3. 测试与构建

| 项 | 结果 |
| --- | --- |
| ws 套件 | 252/252 |
| 全量套件 | **406 项，406 通过，0 失败** |
| x64 Release | 0 警告 0 错误 |
| ReleaseGate | passed（`e6a23bb`） |

## 4. RC5 安装包

| 项 | 值 |
| --- | --- |
| 路径 | `work\releases\zhike-6.1.0-rc5-win-x64-setup.exe` |
| 大小 | 114,417,233 字节（109.12 MiB） |
| SHA-256 | `74F6F459192B27F33EA91D14DE0B435C06FD74C4C96ED6049F913E360A1E0A12` |
| 构建时间 | 2026-11-21T11:52:28Z |
| 对应 commit | `e6a23bb` |
| Bundle SHA-256 | `EA360B1BEA39EE81F8B5D3B820A0819EE882510FE3D5E5CE113536818AE59127` |

RC4 与 rc.3 安装包均未覆盖，仍分别保留在 `work\releases\`。

## 5. 用户操作（唯一能真正验证白屏修复的路径）

1. 先退出正在运行的旧版（桌面 `ZhikeNative` 那份）。
2. 运行 RC5：

```powershell
& "C:\Users\Administrator\Desktop\zhike61-repo\zhike-4.2-ws-workbench\work\releases\zhike-6.1.0-rc5-win-x64-setup.exe"
```

3. 安装到默认目录或自选目录后启动。RC5 支持 schema 34，会正常打开现有数据库，不会删除客户数据。
4. 若仍失败，点“查看诊断”，现在会直接显示真实原因（含 sidecar 最后一行输出），把那段文字发我即可继续定位。

沙箱仍然拒绝我执行安装器，因此 RC5 的真实安装与启动验收尚未完成，不宣称为已修复上线。
