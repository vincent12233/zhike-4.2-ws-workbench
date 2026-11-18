# V4.1 整体收尾批次：实现与未完成项

2026-11-18。基线 `34951cc`，分支 `upgrade/v41-completion-batch`。最终产品修改为 `1dbab88`；第三次全量在 `63404b4` 开始，期间只有证据文档提交至 `38dc125`，产品代码未变。**最新全量 297/298、WS 包含子集 164/164，Release 0 warnings / 0 errors；S3 仍为 Blocked，生产入口 FROZEN。不能认定整个项目已完成或发布安装包。** 本轮保留业务关系、客户权威、人工字段保护及队列门禁，没有迁移生产数据库或恢复 RD02 旧采集。

## 已落地修改

|范围|实际修改与依据|文件|
|---|---|---|
|WS 账号兼容|隔离原生实测只出现默认账号。SQLite 遗留 UTC 时间文本不能按现有 DTO 解析，已在 API 序列化边界规范化三个时间字段，存储值及业务状态不变；第二轮实际显示两个账号并切换十次。|`resources/app/server.mjs`、`tests/ws-account-wire-timestamps.test.cjs`|
|数据中心|验证诊断响应字段及数值，刷新/失败时清除过期结果，结果有效前不能导出；日志请求受页面及具体容器所有权保护，合并在途查询，迟到结果不写入其他页面。|`resources/app/modules/v4-data-center.js`、`tests/v4-data-center-status-routing.test.cjs`|
|报名与统计|导出按钮明确为全部报名；实际事件复现了先报不可用再下载，现只由原通用动作处理器导出一次，CSV 内容、有效客户与已报名范围不变。零值不绘制假进度，无可比基数不显示虚假增长。|`resources/app/app.js`、`tests/registration-analytics-presentation.test.cjs`|
|窄窗 KPI|原生 1422×815 窗口中金额 `¥1,250` 拆行。现按实际内容宽度调整为 6/3/2/1 列，保留 26px 指标字号及完整金额；只允许长金额横向滚动，修复原生可见的垂直滚动箭头。最终实际 Edge 8 种窗口×20 路由通过，1902px 原生宽窗金额与箭头复验通过；最终窄窗原生复验仍未完成。|`resources/app/modules/home-6.css`、`scripts/delivery/s1-main-visual.test.cjs`、`tests/horizon-atelier-contract.test.cjs`|
|加密设备包|独立 `.zkdevice` 引擎实现认证分帧、完整性、明确文件清单、路径/链接拒绝和失败清理。补齐创建后身份核验失败的 `cleanupPending` 提示，身份未知的资源不删除。**引擎明确为 partial，未替换现有备份入口，完整设备迁移未完成。**|`resources/app/device-migration-package.cjs`、`tests/device-migration-package.test.cjs`|
|测试诊断|增加有界 CDP 阶段与请求计时；修正受控探针就绪同步。档案汇总测试复用现有侧车启动观察器，在原预算内记录脱敏错误及退出；没有延长超时、删除失败测试或修改迁移。|`tests/helpers/isolated-edge-runner.cjs`、相关生命周期/传输测试、`tests/data-archive-summary.test.cjs`|

主要产品提交：`0597ad3`、`0e05c82`、`701d551`、`b410619`、`6624519`、`62a9e59`、`5316b6c`、`55bfdd6`、`229e2c1`、`1dbab88`。测试与诊断另有 `f0daaf1`、`7a197b7`、`12d8035`、`c29db87`。这些提交均可单独审查和反向回退，不删除业务数据。

## 本轮真实原生结果

第二轮使用 Release 隔离 WinUI，Windows 11 `10.0.26300`，WebView2 `157.0.4341.46`，125% DPI。宿主为 `6.0.3+abe9edd`，前端为当时集成代码，**不包含之后的窄窗 KPI 与报名导出修复**。全部屏显资料是测试夹具，未登录真实 WS。

- 实际进入十二个 WS 页面；账号 A/B 交替十次，通讯录数据按账号区分，同一成员在两个群中各自保留关系。
- 两账号各创建一个前台 Core，各成功导航一次隔离 `about:blank`。切页/切号保留同代次，无重复 WS 导航。CRM 面板收展后聊天宽度随之变化，返回知客恢复窗口状态。
- 实际取消一条 AI 任务、重试一条失败任务。CRM 批准、拒绝及人工字段冲突均通过界面触发；只读 SQLite 回验对应结果和审计，另一账号待审项不变。
- 客户表格实际滚轮 `0 → 67 → 0`，表头与外层保持稳定；通讯录列表亦实际往返滚动。
- 完成人工任务后图表为 `1/2 = 50%`，实际展开数值明细。原生拖动客户后阶段数量及持久历史同步改变，新增一条流转记录；浅/深主题均看到非空流转图。流转图明细未展开，任务图深色未单独复验。
- 第二轮动效下拉框打开后的捕获连续报 `window crop is outside captured monitor`，重新定位仍失败，故停止输入并请求用户正常关闭。用户关闭后，06:47:27 UTC 身份检查确认第二轮 **21/21** 已观察进程退出，0 剩余、0 无法核验，检查未主动终止进程。不能把捕获错误直接定性为产品缺陷。

第三轮继续使用相同隔离夹具和宿主，PID 15168（06:48:12 UTC），前端载入最终 `1dbab88` KPI CSS；为了加载此修复，测试中明确执行过一次主壳 `Ctrl+R`，不计为普通页面生命周期行为。原生 1902px 宽窗金额完整、不再显示垂直滚动箭头。通过实际设置下拉框和键盘选择“关闭动效”，随后可进入统计页；**未验证进程重启后的动效持久化，也未可靠完成最终窄窗尺寸复验**。最后点击窗口关闭按钮，07:19:10 UTC 确认 **9/9** 已观察进程退出，0 剩余、0 无法核验。此轮没有进入 WS 或创建 WS 聊天 Core，不将它代替第二轮 WS 生命周期证据。

[只读数据与生命周期](v41-completion-native-r2-audit.md) · [16 张实际截图](v41-completion-native-r2-screenshots.md) · [第三轮最终 CSS、动效及退出](v41-completion-native-r3.md) · [前一运行及其已确认退出](v41-completion-native.md)

## 资源观察

91 次样本覆盖 15.72 分钟，包括两个 WS Core 初次创建及前七次切换。进程树工作集 742.4 → 1539.2 MiB，私有内存 388.4 → 799.7 MiB；进程 9 → 21、WebView 子进程 6 → 18。其余操作发生在采样期之后。没有正式阈值，状态仅为 **Observed**，不以工作集增长直接判断泄漏，也不宣称性能达标。

06:18:27 UTC 的补采仍观察到原宿主 PID 35236、21 个进程，工作集约 1556.8 MiB。该单点与第二次全量回归时间重叠，仅用于补充退出身份，不是独立性能测试。第二、第三轮均已正常退出；保留测试根及失败诊断资源，不自动清理。

## 实际测试结果与失败保留

命令均从仓库根执行，`node` 为随附 `resources/app/node.exe`，`dotnet` 为 `.tools/dotnet10/dotnet.exe`。

|执行|结果|范围|
|---|---|---|
|`node scripts/run-tests.cjs all`，产品基线 `b174bea`|**295/298**；WS 包含子集 **164/164**|失败三项为 Edge 主页面、WS 矩阵、客户表退出相关等待。|
|同命令，产品基线 `5316b6c`|**292/298**；WS 包含子集 **161/164**|保留六项失败，见下表。不能用专项通过覆盖完整运行。|
|同命令，最终产品代码 `63404b4`（含 `1dbab88`）|**297/298**；WS 包含子集 **164/164**|原生测试进程全部退出后串行运行，没有其他重测试/构建并行。唯一失败为 S1 主渲染的 Edge 退出超时。|
|普通 WinUI Release x64，第二轮后编译|**0 warnings / 0 errors，29.24 秒**|覆盖设备包/导出/侧车诊断修复，早于最终 `1dbab88` CSS；不能冒称最终 HEAD 构建。此前 45.43 秒构建独立保留。|
|普通 WinUI Release x64，第三次全量之后 `38dc125`|**0 warnings / 0 errors，19.90 秒，exit 0**|最终产品代码已包含；命令见下文。不生成安装包，不启动正式应用。|
|第二轮隔离 WinUI Release|**0 warnings / 0 errors，31.37 秒**|实际原生截图使用此宿主。|
|`node --test tests/device-migration-package.test.cjs`，`55bfdd6`|**12/12**|包含两项创建后身份获取失败回归。|
|`node tests/registration-analytics-presentation.test.cjs`，`229e2c1`|**3/3**|实际动作委派、CSV 内容及零值统计。|
|`node tests/horizon-atelier-contract.test.cjs`，最终 `1dbab88` CSS|Passed|合同检查；不能替代原生验收。|
|`node scripts/delivery/s1-main-visual.test.cjs`，最终 `1dbab88` CSS|**8 种窗口 × 20 路由 Passed**|实际 Edge、完整生产 CSS 顺序，包含窄窗金额及无垂直滚动断言；不能替代 WinUI 窄窗实测。|
|`node tests/data-archive-summary.test.cjs`，增加有界诊断后单独复跑|Passed，exit 0|只证明该次隔离 API 流程；没有原始失败 stderr，首次启动的具体根因仍未定位。精确耗时未成功采集。|

第三次全量已覆盖第二次之后的设备包、导出、诊断和 KPI 最小修复；**最终全量仍有一项失败，不将专项成功或前两轮结果混作全量通过**。298 为 runner 检查项；相对原 293 新增四项测试入口和设备包语法检查，未删除既有入口。内部设备包用例现从 10 增到 12，不增加 runner 总数。

最终编译命令：`.tools/dotnet10/dotnet.exe build desktop/src/Zhike.Desktop/Zhike.Desktop.csproj -c Release --no-restore -p:Platform=x64 -r win-x64 --nologo -v:minimal`。

|第二次全量未通过项|已知证据 / 尚未确认|
|---|---|
|WS data archive summary bridge|启动未就绪；只读确认新夹具最高迁移 018，019 `app_state` 未建立，尚未走到监听。具体迁移等待/异常或测试清理时序未确定。|
|hot-chat profile API|启动请求重试耗尽；原测试未保留足够子进程诊断，具体原因未确定。|
|Stage 5.5C-1A real isolated send/media/AI risk API|隔离侧车启动超时，退出未确认，原测试保留临时根。|
|Stage 5.1 real workspace collapsed layout|Edge `process-exit` 超时，退出清理未获及时证据。|
|Delivery S1 actual main renderers and shared design system|`Runtime.evaluate` 超时；本次后续根退出与流释放得到确认，布局断言仍未完成。|
|Delivery S1 WS computed layout and retained host|`Runtime.evaluate` 超时，退出也未及时确认。|

全量内 Worker 真实生命周期、取消/崩溃/轮换/停止、fencing、024 兼容、CRM 审核及多群隔离专项已通过各自断言。历史跨 SID 验收没有在本轮重新执行。没有证据允许把这些成功推广成 S3 Passed。

第三次完整运行中，上表另外五项通过；S1 主渲染再次失败。这次页面结果已经完成并写入 `operations-atelier-dawn.png`：约 3.244 秒收到 `Browser.close` ACK，3.245 秒传输关闭，30 秒总预算结束时仍未确认根进程、输出流和身份探针退出，`cleanupSafe=false`。07:36:50 UTC 事后只读检查确认已记录的 14 个浏览器 PID 和一个探针 PID 均不存在，未额外终止进程；原 Failed 不变，隔离目录保留。精确内部阻塞根因仍未定位，也不能由本次差异推断之前的侧车失败已经得到根治。

[第一次完整结果](evidence/v41-completion-validation/full-regression.json) · [第二次完整结果](evidence/v41-completion-validation/final-run/full-regression.json) · [最终完整结果及编译](evidence/v41-completion-validation/settled-run/runs.json) · [最终 KPI 专项](evidence/v41-completion-validation/kpi-final/runs.json) · [Edge 原始失败与控制实验](v41-modern-edge-investigation.md) · [侧车启动调查](v41-completion-sidecar-startup.md)

## 仍未完成的项目范围

1. **S3 阻断**：最新全量唯一失败为 Edge 退出等待，根因尚未解决；最终窄窗原生复验、动效重启持久化以及 100%/150% 的完整原生缩放矩阵仍未补齐。已完成动效关闭及三轮应用退出，不再列作未完成。历史侧车启动等待与 WMI/桥接延迟仍作为残余风险保留。
2. **完整设备迁移**：独立引擎已实现，019–025 权威数据一致性快照、附件引用、目标库事务应用/回滚、旧 JSON 兼容与干净电脑实测仍缺。不得向用户把 partial 包描述为完整迁移。[引擎范围](v41-device-package-engine.md)
3. **真实 WS 能力**：安全整改后旧后台采集继续禁用。真实登录、收发、群回执及提及未在本轮授权/验证，不能以空白隔离 Core 证明可用。
4. **客户级群消息统计**：完整阅读账本、排除规则版本、历史重算、导出和首页群聚合仍是既有任务池中的未完成能力。
5. **F01–F14 后续能力**：手动当前账号发送与基础素材/配置等只能按已有实现范围描述；多账号发送编排、群批量操作、批量导入等没有完整可验收链路。不能因「整体完成」跳过平台验证、权限或必要迁移审批。

## 退出、数据保护及回滚

三次原生运行分别有 15/15、21/21、9/9 已观察身份确认退出，按各次 PID/启动时间独立检查。本轮根为 `C:\Users\酷酷\AppData\Local\Temp\zhike-stage51-native-8badd3d84fb94a53a0b8f78cd1c5b08d`，仅测试夹具与隔离 profile，不自动递归删除。失败测试的保留资源按各自失败日志追踪；不以事后退出覆盖原测试失败，也不强删来源或身份不明的文件。

源码变化没有修改历史迁移及 checksum，没有更改 CRM 规则、Worker/IPC/fencing 安全边界，没有生产数据库操作、真实 WS 或付费 AI调用，没有双写、正式 Worker 上线和安装包发布。回滚采用审查后的单提交逆序 `git revert`，保留用户修改和业务数据；未发生数据库升级，不需要降级数据库。

**下一步仍是解除已记录阻断并补齐验收，不能直接进入发布或宣称全部功能完成。** 已关闭本轮测试窗口，不重建客户夹具或重复已通过的原生操作。
