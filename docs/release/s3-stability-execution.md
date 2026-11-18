# ZHIKER 6.1 A+B · S3 稳定性攻坚执行记录

2026-11-18，Asia/Calcutta。本轮基线 `9762045`，原分支 `upgrade/v41-integrated-completion` 保留；主控在工作区干净时创建 `integration/61-s3-gate`。已核实 `c01c126`、`420b9d4`、`f7157b1`、`ca429e6` 均存在。用户本轮总指令要求实际并行开发与原生证据；生产保持 **FROZEN**，S3 在新证据完成前保持 **Blocked**。

## 基线与调度

历史报告：全量 306/310、WS 业务 172/172、v2 15/15、恢复 12/12、WinUI Release 0 warnings / 0 errors。已读取归档原始结果，这些均是上一轮结果，不冒充本轮重跑，不换算完成百分比。

环境最多 4 个活跃 Agent，因此使用主控 D + 三个专项 Agent。Edge 浏览器重测试、原生应用运行/性能观察、完整回归/编译由主控串行分配，避免测试资源竞争。独立源码分析和轻量单元测试并行。

|负责人|分支/工作树|文件所有权|当前任务|
|---|---|---|---|
|A · Edge，High|`fix/61-edge-timeout`；`../s3-worktrees/edge`|Edge runner、其生命周期/transport 测试、独立 Windows 观察器、必要的四测试可观测接线|取得同次导航/内核退出/Node/流证据，再决定最小修复|
|B · DPI/滚轮，Medium|`fix/61-dpi-wheel`；`../s3-worktrees/dpi`|必要 WinUI 隔离输入/尺寸诊断宿主；Stage51 native input probe 及专项|补齐可观测诊断，原生操作由主控执行|
|C · 性能，Medium|`test/61-performance`；`../s3-worktrees/performance`|Stage51/52 只读资源采样、汇总、操作标记及专项|复用采样并补充 GUI 资源与退出尾采样|
|D · 主控|`integration/61-s3-gate`；主仓|集成、完整回归、编译、原生操作、证据归档和 Gate 报告|审查并合并独立提交，统一运行环境|

B 独占宿主文件，其他 Agent 不修改 WebView2 宿主。无数据库迁移。本轮不重写 RD09、WS04，不启用真实 WS、生产 Worker/AI、旧采集或双消费者。不删除失败证据/未知临时对象，不改变 Edge 30 秒限制或原测试断言。

## 待验证矩阵

- Edge：四个原始失败测试各保留实际结果；导航、关闭、内核句柄及 Node/流使用关联 ID 和单调时钟。
- DPI：真实系统 100/125/150%，双主题、最小/最大/还原，记录实际 DPI、XamlRoot 和容器几何；不使用 ZoomFactor 代替 DPI。
- 滚轮：记录指针、焦点、输入到达及内外实际偏移；CUA 注入与物理触控板/高精度设备分别结论。
- 性能：同一次隔离实例持续序列，操作前后标记，工作集/Private/CPU/线程/句柄/GUI 资源/Core/子进程与退出复查。
- 业务：本轮完整回归及 Release；已通过功能只回归，不重新实现。

没有第二台干净 Windows/VM；跨设备验收不能由本机隔离替代。显示器与输入设备能力在原生检查时记录，无条件项明确 NotTested，不虚构通过。

## 结果

### 已集成的最小修复

1. **Edge 测试退出顺序。** 同次失败证据确认 S1 WS 在取回矩阵之后，同步诊断 JSON 落盘阻塞到第 34.982 秒，未在 30 秒内发出关闭请求。现在先完成原矩阵校验、关闭与进程/输出流核验，再异步保存诊断原文。保存失败仍失败，未改变 30 秒浏览器预算、视觉断言或强制终止规则。其他三项历史失败不能归为同一根因。集成 `e899fd4`，相关观察器及回归见 [Edge 报告](v61-s3-edge-invocation.md)。
2. **原生 DPI。** 通过实际 EXE 的嵌入 manifest 和 HWND 日志证实原构建为 DPI unaware。共享 manifest 添加 PerMonitorV2；同 PID 的 125→100→150→125% 切换中，HWND / XAML / DOM 对应收敛且未因 DPI 重建 Core。集成 `80c7f07`；未修改 WebView2 登录态、导航或生命周期策略。
3. **客户表格滚轮。** 100% 原生对照中，表内垂直输入没有位移，表外相同输入使页面下滚；横向表格的 Y 边界样式阻断了父级接续。`d768550` 只放行客户中心 horizontal 表格的 Y 链，保留 X containment、有范围时表格优先处理及独立面板 containment。125% 原生短测观察到内层先移动 66.4 CSS px，边界后外层页面移动约 333 px。精确的 100% 原条件复验尚未完成。

仅产品行为变动为 `app.manifest` 与 `resources/app/modules/business-6.css` 的上述局部修复；其他变更为隔离诊断、测试及报告。无业务规则、数据库结构、Worker/IPC/fencing 或 CRM 写入语义变更。

### 原生证据与边界

本轮原生测试为 Windows `10.0.26300`、Release x64、WebView2 `157.0.4341.46`、1920×1200 屏幕、本机合成数据（52 位 CRM 客户）。测试使用现有标记隔离根，不复制生产资料。系统缩放已恢复初始 125%，三个测试实例均正常关闭，分别复查 16、15、9 个已观察进程身份，均无存活/未核验项。

16 张未编辑应用截图归档于 [原生截图清单](evidence/v41-s3-native/manifest-sha256.json)，源与归档逐字节 SHA-256 一致。未归档含账户信息的 Windows 设置截图。文件 `01-125-light-max.png` 实际是还原状态，保留原名并明确纠正。150% 以及随后恢复 125% 的应用和 Windows 设置捕获都出现局部文字破碎，来源仍未确认；不能据此把视觉矩阵写成通过。

- [125% 浅色首页](evidence/v41-s3-native/03-125-light-maximized.png)
- [100% 深色客户中心](evidence/v41-s3-native/08-100-dark-customers.png)
- [150% 捕获异常原图](evidence/v41-s3-native/13-150-dark-maximized.png)
- [CSS 修复后表格内层滚动](evidence/v41-s3-native/15-fixed-css-inner-consumed.png)
- [到达边界后的页面位移](evidence/v41-s3-native/16-fixed-css-page-handoff.png)

额外两条 WinUI 滚轮记录复用了较早事件的底层指针时间戳与坐标，且发生时实际指针位置已变；来源未定位，没有以布尔锁或吞输入规避。125% 短测两次事件的底层时间戳不同，HUD 指针移动年龄不是滚轮事件年龄。事件到达、两帧偏移和随后视觉稳定位移分别记录，不混为同一采样。完整证据见 [DPI / 滚轮验收](v41-s3-dpi-wheel-acceptance.md)。

隔离 WS 的空白聊天区域是测试入口的 `about:blank` 预览，日志证实 Core 创建与导航成功；这不是实际 WhatsApp 登录/聊天验收，生产平台未连接。

### 连续资源结果

缺陷版 195 条、17 分 12 秒；DPI 修复版 361 条、32 分 11 秒；CSS 修复后短测 53 条、4 分 38 秒。固定版工作集首样 749.4 MiB、峰值 1235.8 MiB、末活样 1186.5 MiB；Private 首样 396.1 MiB、峰值 679.5 MiB、末活样 628.6 MiB。首次 WS Core 创建对应 WebView 子进程 6→12 与工作集阶跃，后段有回落，不能仅以增长判定泄漏。

固定版连续采样在关闭前达到上限，因此以离散身份复查证明全部释放，不伪称连续退出耗时。短测 end 标记在关闭后执行而被拒绝，操作耗时为空；125% 首页原始 `no-change` 标记与观察不符，保留并更正为实际上有滚动。标记窗口包括工具/人工等待，不能当作应用延迟。全部 12 个统计文件及 SHA 见 [资源清单](evidence/v41-s3-resources/manifest-sha256.json)，详细序列解释见 [性能报告](../superpowers/reports/s3-performance-2026-11-18.md)。

### 集成验证（本轮完成）

产品与测试集成基线 `4e2af3c`；其后提交仅归档与报告，不改变运行代码。统一全量只运行一轮，增加两项检查（隔离输入探针、连续资源/子进程退出尾），原 310 项均保留，本轮 **312/312，通过且退出码 0**。12:30:54–12:43:48 UTC 期间仅统一测试持有重任务时段，没有并行运行原生验收应用。全量内的 `runWs()` 区段共 197 项通过（含 50 项源语法检查），不是另起一次 WS 命令。RD09 v2 15/15、恢复 12/12、WS04、024 checksum、Worker/IPC/fencing 关键检查在该轮均通过。

原生隔离 Release 两次构建分别 34.26 秒与 28.83 秒，均 0 warnings / 0 errors。普通配置 Release x64 本轮为 **0 warnings / 0 errors，21.56 秒**。Windows SDK 从新普通 EXE 只读提取 RT_MANIFEST #1，确认唯一 PerMonitorV2，验证退出码 0，前后 EXE SHA 相同；未启动普通程序或发布安装包。普通构建日志的产品版本仍是现有 6.0.3 分支标识，不通过改版本号冒充交付。

实际命令：

```powershell
# 每个命令串行；环境变量仅用于这次测试进程。
.tools/dotnet10/dotnet.exe build scripts/diagnostics/edge-exit-observer/observer/Observer.csproj -c Release --nologo -v:minimal
$env:ZHIKE_EDGE_OBSERVER_DOTNET = Join-Path (Get-Location) '.tools/dotnet10/dotnet.exe'
resources/app/node.exe scripts/run-tests.cjs all
.tools/dotnet10/dotnet.exe build desktop/src/Zhike.Desktop/Zhike.Desktop.csproj -c Release --no-restore -p:Platform=x64 -r win-x64 -p:Stage51IsolatedUi=false --nologo -v:minimal
git diff --check
```

全量原始日志、构建日志、退出码及源/归档 SHA 见 [集成验证清单](evidence/v41-s3-integration/manifest-sha256.json)。四个正式 Edge 入口的 10 次浏览器调用，加上 Stage 5.1 布局的 1 次调用，全部保留同次内核/Node/流证据，每次使用原 30000ms 预算、无强杀。最慢正式调用生命周期约 12.095 秒。 [本轮完整回归 Edge 账本](evidence/v61-s3-edge/integration/summary.json)

|范围|本轮实际状态|
|---|---|
|四个原始 Edge 测试首轮取证|0/4，原失败 profile 与内核证据全部保留|
|修复后四入口单轮复验|4/4；10 次独立 Edge 调用均正常释放，每次原 30 秒预算|
|集成完整回归|312/312，退出码 0；四个原始 Edge 入口在本轮也全部通过|
|普通 WinUI Release x64|0 warnings / 0 errors；PE 的 PerMonitorV2 已只读复核|
|原生 DPI|三档感知切换已验证；双主题×窗口尺寸完整矩阵未闭合|
|原生滚轮|局部 CSS 修复已有原生证据；重复投递来源、物理输入与原条件复验未闭合|
|持续性能|多轮真实数据与退出证据已归档；操作循环、稳态响应与多账号矩阵未完成|

### Gate 与后续

**S3：Blocked；Production：FROZEN；不启动阶段 6、不发布安装包。**

- Gate A：本轮复验与集成全量通过；原始失败的 S1/S2 间歇性内核退出延迟、S3 历史加载阻塞根因尚未排除。保持未完成结论，不能把后续通过等同于上述全部根因已修复。
- Gate B：100% 浅色、150% 浅色与最小尺寸、完整最小/最大/还原组合尚未全验，捕获文字破碎待区分实际渲染与捕获问题。跨显示器未执行，不能冒充通过。
- Gate C：需在相同 100% 条件复核横向表格无垂直范围时接续；排查重复底层事件投递，物理滚轮/触控板、高精度与 Ctrl+滚轮未验证。
- Gate D：补齐受控页面/群组/成员/弹窗/账号循环与稳态观察；本轮未定义新的性能放行阈值。
- Gate E：本轮统一业务回归与 Release 通过；RD09 与 WS04 只回归，未重写。这是本机隔离范围，不代表真实平台业务或跨设备发布通过。
- Gate F：没有干净 Windows 测试设备，不具备跨设备发布验收条件。

回滚保留稳定分支与所有提交。若仅撤销产品改动，可分别 revert `80c7f07`（DPI 声明）与 `d768550`（客户表格 Y 链）；配套回归应随产品撤销而审查，不能单独删除失败测试。未迁移生产数据库，无需数据库回滚。不删除本轮已保存的失败证据或 profile。

### Agent 交付与提交

|Agent|本轮交付|集成提交|实测结果与未完成|
|---|---|---|---|
|A|同次 Edge 观察、异步证据写入、原入口复验和证据归档|`e899fd4`、`bd649fa`、`457ef94`|首轮0/4保留；修复后单轮4/4；全量原入口4/4。历史间歇性根因仍未闭合。|
|B|PerMonitorV2、隔离输入诊断、客户横向表格 Y 链|`80c7f07`、`d768550`、`04eefa0`|三档实际 DPI 切换、表内/外对照与125%修复后短测；完整矩阵及重复输入原因仍未完成。|
|C|连续采样、操作标记、退出身份复查|`74e9506`、`eacc425`|195/361/53条，三个实例已观察身份均释放；稳态与操作循环未闭合。|
|D|统一集成、原生操作、312项回归、Release与最终门禁|`4e2af3c`及本报告提交|完整回归312/312、Release0/0；S3仍Blocked，生产FROZEN。|

所有本轮改动提交到 `integration/61-s3-gate`，原稳定分支保留。没有生产 SQLite、生产登录态、密钥、付费 AI 或正式 Worker 的访问/启用操作；未开启新旧队列双写，未恢复 RD02 已禁用采集。隔离测试根和失败 profile 继续保留用于证据，未实施自动删除。报告提交后核验工作区干净，最终提交号由交付回复提供。
