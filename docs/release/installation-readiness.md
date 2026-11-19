# 知客 6.1.0-rc.2 安装就绪状态

记录日期为 2026-11-19。当前状态是 **候选预发行已发布，不是最终安装验收通过**。

## 候选与发布状态

| 项目 | 当前事实 |
|---|---|
| 候选标签 | `v6.1.0-rc.2` |
| 安装包源码 | `5a7dabe7321f7682b2cb518aeb9d4a1c2c89ace1` |
| Release | `451004886`，`draft=false`、`prerelease=true`，目标提交与候选源码一致；[打开 v6.1.0-rc.2](https://github.com/vincent12233/zhike-4.2-ws-workbench/releases/tag/v6.1.0-rc.2) |
| 上传状态 | 已发布，两项资产均由独立 API 复核为 `uploaded` |
| 安装资产名 | `zhike-6.1.0-win-x64-setup.exe` |
| 安装包大小 | `114280989` bytes |
| 安装包 SHA-256 | `51DEF93516FA321D621CD5988469F7F8FEBB283EDF4851DD6296091B065539C3` |
| 签名状态 | `unsigned` |
| 同次清单 | `release-output-manifest.json`，`442` bytes，SHA-256 `81d5120559d7f72548282d870bce29ee8d810a04af7d85632cdb442bc57a3367` |

rc.2 现可从上述私有仓库预发行条目下载。必须同时取得安装资产和 `release-output-manifest.json`，并核对两者的文件大小与 SHA-256，以及清单中的源码提交和实际签名状态。下载需要已获该私有仓库访问权限的 GitHub 账号。

恢复上传前，原不完整 starter 附件只在精确匹配 release `451004886` 后被清理；独立复核未发现历史 Release 或历史资产被覆盖。该操作只说明本次发布恢复边界，不替代安装验收。

构建后的安装 payload 归属于 `5a7dabe`。后续 `45ba133` 只调整打包控制台提示，`ce484a4` 只增加已有 GitHub 草稿的安全恢复工具；两者没有改变已构建安装 payload，也没有移动候选 tag。

## 实际修改与验证入口

本轮从 `ebc0936` 开始，保留原有数据和业务规则：

| 修改范围 | 文件 | 作用 |
|---|---|---|
| 安装安全 | `zhike-desktop-setup.iss` | 校验安装目录归属、拒绝危险路径；新版部署完成后再退役旧客户端，防止相交路径误删。 |
| 首次启动 | `LegacyUiHostPage.xaml`、`LegacyUiHostPage.xaml.cs`、`resources/app/index.html` | 本地页面完成可信导航之前显示加载或错误状态。 |
| 首用反馈 | `resources/app/app.js` | 首次读取完成前不显示“已保存”，补充备份与网络依赖说明。 |
| 诊断 | `test-diagnostics.cjs`、`server.mjs`、`device-migration-package.cjs` | 仅显式测试开关启用时记录白名单阶段；默认关闭，不记录密钥、业务内容或绝对目录。 |
| 交付工具 | bundle / installer / prerelease 脚本及对应合同测试 | 检查新增依赖随包完整，严格恢复本次草稿，不覆盖已发布版本。 |

未改动历史 SQL 迁移、CRM 核心、Worker/IPC 或 WebView2 生命周期。`device-migration-package.cjs` 只加入测试诊断，没有更改包格式、加密参数或恢复规则。

实际执行入口如下；产物目录均为 `work/` 下本轮唯一目录，探针仅使用临时 SQLite：

```powershell
resources/app/node.exe scripts/run-tests.cjs all
scripts/build-winui-bundle.ps1 -Version 6.1.0 -Configuration Release -RuntimeIdentifier win-x64 -SelfContained -ReleaseGate -OutputDir <本轮bundle目录>
scripts/build-winui-installer.ps1 -AppVersion 6.1.0 -ReleaseGate -StageDir <本轮bundle目录>/zhike-winui-6.1.0-win-x64 -OutputDir <本轮installer目录>
.tools/dotnet10/dotnet.exe run --project scripts/stage51/NativeReadinessProbe/NativeReadinessProbe.csproj -c Release --no-build -- <本轮bundle目录>/zhike-winui-6.1.0-win-x64/resources/app
```

全量执行时显式开启了 `ZHIKE_WS_VISUAL_SCREENSHOTS=1`。单项安装/启动检查清单及实际退出结果保存在证据目录；上列全量命令的实际结果是失败，不能把“执行过”解释为“通过”。

## 已取得的证据

- 最终定向检查为 **10/10 Passed**，覆盖首次加载状态、视觉合同、打包合同、备份与提醒工具、旧版退役、测试诊断安全、sidecar 打包依赖、隔离 fixture、当前文档一致性和静态资源。它不是全量回归。
- 本轮原生隔离构建成功：exit 0、0 warnings、0 errors，用时 100.03 秒。该结果只证明构建完成，不证明原生 UI 已运行。
- WinUI bundle 的 Release gate 通过，来源工作树干净；bundle manifest 记录 622 个文件，复核时 0 个哈希不一致。
- 包内 sidecar 实际探针通过：exit 0；验证未授权关闭拒绝、授权正常退出、取消传播、取消后重启退役和无 UI pump 就绪。`NativeReadinessProbe` 对 `LocalServiceManager.StartAsync` 测得的端到端就绪时间为 **42.620 秒**，`productionOpened=false`。该时间可能包含重试和清理；证据没有记录重试次数，因此不能解释为一次 Node 进程的纯启动时间。
- 安装器已经构建，字节数、SHA-256、源码归属和 unsigned 状态写入同次清单。
- 发布工具与说明专项为 **3/3 Passed**：`github-prerelease-resume-guards`、`current-docs-consistency`、`release-output-only-6.0`。它只验证安全恢复约束、当前说明一致性和单版本输出，不是全量产品回归。

完整证据、原始与脱敏副本哈希及证据边界见[安装就绪证据清单](evidence/installation-readiness-2026-11-19/manifest.json)。

归档保留原始 SHA-256，并单独记录脱敏副本 SHA-256；副本统一为 UTF-8/LF、去除行尾空白，避免 Git 在不同设备上改变证据字节。19 份归档均已核对暂存区字节与清单一致，不包含生产数据库或登录态。

## 不能作为通过项的结果

首轮全量为 **293/324 Passed、31 Failed、runner exit 1**。运行期间工作树从 `fa557e4` 跨越到后续修复提交，属于 mixed-revision / not-freeze-full，不能代替最终冻结提交上的全量回归，也不得写成“最新全量通过”。

31 项失败的直接证据分为：

- 5 项外层 `spawnSync ETIMEDOUT`；
- 19 项本地 sidecar/loopback 未就绪或子进程未退出；
- 7 项 WebView/Edge 生命周期问题，其中 6 项 `EDGE_RUNNER_TIMEOUT`、1 项 `PROCESS_IDENTITY_UNVERIFIED`。

本轮同时观察到本机 durable 写入和 flush 偏慢。只读代码复核还发现，新库的 22 个迁移分别进入各自事务，这种结构可能放大当前环境中的 fsync 延迟；但本轮没有完成“原子化新库初始化”设计与行为验证，也没有证明它是 31 项失败的共同根因。现有升级逻辑、迁移校验和安全边界没有在本轮改变。不能通过放宽 durability、ACL、fencing、进程身份校验或笼统增加 timeout 来把失败改写成通过。

原生 UI 工具连续三次超时后停止，没有打开新的原生窗口。因此本轮没有取得新窗口的实际渲染、交互、退出和资源回收验收。包内 sidecar 通过也不等于真实 WinUI UI 通过。

## 安装前置条件

- Windows x64，系统内部版本 22621 或以上；
- WebView2 Evergreen Runtime；缺失时安装器应中止；
- 当前安装器未签名，不应关闭 Windows 安全保护；
- 安装或覆盖前先从现有版本的数据中心导出备份，并保留一份独立副本。

随包提供 .NET、Windows App SDK 和 Node 运行内容，无须另行安装这些组件。默认用户数据位于 `%LOCALAPPDATA%\Zhike6`。程序不自动迁移旧 `%LOCALAPPDATA%\Zhike` 数据目录。

## 当前使用范围

| 能力 | 当前范围 |
|---|---|
| 本机业务 | 安装和本地服务正常后，客户、跟票、入金、报名、任务、统计、导入和备份等本机 SQLite 业务不依赖外网。 |
| WS 前台 | 需要联网，由用户本人在官方页面扫码或登录；真实账号的登录、收发和手机同步仍需目标环境验收。 |
| WS 导入与本机档案 | 手动导入、已保存原文、本机客户关联和审核入口保留；只处理用户有权查看和导入的内容。 |
| AI | 用户主动调用外部 AI 时需要联网并自行配置服务；人工确认边界继续保留。 |
| 自动化 | 自动会话发现、后台采集、自动完整历史、后台群监测、认证 profile 复制、生产 Worker 和自动 AI 消费者保持 **FROZEN**。 |
| S3 | 保持 **Blocked**，不得描述为已完成生产验收。 |

## 尚未验证

以下项目在本轮均为 `NotTested`，预发行完成也不会自动把它们变成通过：

1. 干净 Windows 目标机安装和首次启动；
2. 从支持旧版执行覆盖升级；
3. 卸载后的应用清理与用户数据保留；
4. 换机或备份恢复后的真实业务检查；
5. 新原生窗口的完整页面、缩放、输入、退出和重启恢复；
6. 真实个人 WhatsApp 登录、手机同步和收发；
7. 真实付费 AI 请求；
8. 最终冻结提交上的完整全量回归。

在上述项目取得独立证据前，只能称 rc.2 为安装候选，不能宣称整个项目已经全部稳定或完成最终验收。
