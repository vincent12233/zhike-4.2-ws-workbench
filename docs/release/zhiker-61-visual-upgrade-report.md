# 知客 6.1 全局视觉升级实测报告

日期：2026-11-18（日志统一 UTC）。代码提交：`8da6fb2f8ce09c4c1560328a48b5f04bfd477244`。分支：`integration/61-visual-system`。

**本轮完成了共享视觉、头像回退和客户 360° 的代码集成；验收 Gate 为 Blocked。S3 仍为 Blocked，Production 仍为 FROZEN。未发布安装包。**

最终全量回归 **317/318**，唯一失败为既有隔离 Edge 测试的进程退出超时。真实 WS 头像没有获授权的受支持来源，按本轮指令保留 **Blocked**。100% / 150% 原生 DPI、完整持续账号/页面压力验收尚未完成，不能宣布全项目或 S3 放行。

## 1. 基线与工作区

用户文档记录的历史基线为 `8cb12f4`，开始时真实代码为 `fbeeaf8`，本轮从真实代码创建集成和三个功能 worktree，没有退回历史版本。
原 `integration/61-s3-gate` 的两份未提交 S3 文档保持原样，原中断测试 worktree 未覆盖。设计、CRM、WS 三个 Agent 分别修改各自工作树，主控审阅并逐项 cherry-pick；未并发修改同一产品文件。

主要提交：

|提交|内容|
|---|---|
|bd4b006|共享主题、SVG、头像与设计规范|
|3b98504、4fc6743|客户 360°、列表和旧群关系展示兼容|
|a293630|WS 头像能力审计和隔离展示|
|dbcdd57、d05b941|旧 CSS 覆盖修正、首页头像、重复包装移除|
|3127189|真实桌面发现的旧 90px 客户列压缩修复|
|f17857f、c451335|Windows 文本 fixture 换行和旧导航图标断言兼容|
|e545292|头像文字最低 14px、共享面板不透明底色|
|8da6fb2|静态资源白名单、真实组件 fixture 和回归集成|

本报告及证据另作独立提交。最终报告提交号由 Git 日志与交付回复记录，避免自引用。所有产品源文件均已提交；最终工作树清洁度在提交后另行核验。忽略的 SDK、构建输出和测试诊断不属于发布产物。

## 2. 实际升级范围

延续现有 `atelier-dawn` 与 `horizon-night`，没有建立第三套主题。共享图标继承 `currentColor`，既有导航、业务动作与模块 ID 不变。面板统一 1px 描边、现有圆角令牌、低强度渐变和阴影，不使用持续发光或大面积滤镜。

|区域|实际完成|
|---|---|
|主工作区与导航|现有工作/客户/业务/系统分组、顶部搜索、工具按钮、快捷入口使用统一线性 SVG 和现有主题状态|
|共享卡片|主工作台、CRM、业务、统计、系统、GPT 和 WS 外壳通过共享令牌统一边框与材质；并非重建每页|
|客户列表/分类/热聊/VIP/跟进/搜索|共用姓名头像；保留号码、渠道、助理、状态、勾选、关注、冻结列和业务操作|
|首页|跟进流域及当前重点客户使用共享头像，保留已有卡片几何与真实数据|
|客户 360°|76px 头像、姓名、号码、阶段/VIP；基础、热聊、业务、群组、跟进、阅读、AI 七组；完整档案、编辑、关注、业务动作保持接线|
|WS|联系人、成员、CRM 列表与详情、已确认的一对一会话使用共享头像；群聊与未知会话保留各自图标|
|WS 聊天|保留真实原生 WebView2；本轮仅使用隔离 about:blank，未登录真实 WS|

旧客户列偏好 90px 在加入头像后会把姓名挤成零宽，这是本轮原生复现的实际缺陷。修复仅对客户/分类列表的客户列设 152px 下限，已有拖动与恢复路径读取该下限，恢复时不重写用户现有偏好；用户实际拖动仍沿用原保存机制。Edge 验证恢复后的列宽 152px、姓名区 56px，用户仍可拖宽。

客户表格预览选中行增加一致高亮。原有奇偶行、冻结列和横滚遮挡断言保留，另增加第三条选中记录断言，不以删除旧断言消除失败。

## 3. 头像与数据真实性

详见 [WS 能力审计](zhiker-61-ws-avatar-capability.md) 和 [设计规范](../design/zhiker-61-global-visual-system.md)。

- 没有发现可信的客户头像字段、获授权的 WS 头像读取接口或按账号绑定的头像缓存。`settings.profileAvatar` 是管理员头像，不能当作客户头像。
- 当前产品调用只传姓名、尺寸、选择状态和已有 VIP 标记，**不传图片**，不发起取图请求，不创建头像缓存、不增加迁移。
- 字素提取支持中文、英文、印地语、泰米尔语和数字；无法识别时使用默认人物图标。群头像不会被当作客户个人头像。
- 组件具备静态 PNG/JPEG/WebP 内嵌数据的受限输入和失败回退接口；Node 测试覆盖格式/长度/动画拒绝和事件回退。**真实图片解码、可信授权、缓存失效与请求取消未作真实接口验收**。未来接入还需有界图像解码与像素尺寸约束，不能仅依赖字符串长度上限。
- 只有具当前账号和已确认个人身份的会话才用人物头像，不根据同名或昵称匹配客户。迟到与跨账号响应仍受原服务和展示作用域校验。
- CRM 阅读组因缺少账号/群/消息级可信回执投影，显示 Unknown；没有虚构已读率。
- 旧无账号群关系仍显示原名称/状态/时间并标待核实，既不丢弃历史，也不作为当前在群证据。
- 没有入金事实时与核实为零分别展示；AI 组只读已保存摘要，打开档案不调用 AI。

## 4. 本轮实际测试

均为本轮执行；历史 312/312 或 313/313 未冒充本轮结果。runner 总数是检查入口数，不是内部断言总数。保留原 313 个入口，新增头像模块语法检查及 4 个专项入口，共 318。

|命令/范围|实际结果|
|---|---|
|`resources/app/node.exe scripts/run-tests.cjs all` 首轮|311/318；原始日志保留|
|完成最小修复和 SDK 项目还原后，同命令第二轮|**317/318，Failed**|
|`resources/app/node.exe scripts/run-tests.cjs delivery-s1` 最终专项|**10/10 Passed**|
|客户表格真实 Edge 视觉入口|10/10 Passed（9 个生产口径配置＋1 个诊断配置）；最终全量中也通过|
|新增客户列宽、Unicode 头像、360°、WS 头像作用域|全部通过；WS 头像入口内含 5 个 node:test 用例|
|runWs()、CRM 治理、AI、Worker/IPC/fencing、迁移与兼容|包含在第二轮全量中，这些入口通过；另行执行的 Stage 5.1 浏览器生命周期失败见下。没有另报一次未执行的独立 WS 总数|
|Stage 5.2 真实 Worker IO|5 个内部情形通过，见全量原始日志|
|普通 WinUI Release x64|**0 warnings / 0 errors**，18.45 秒|
|隔离 WinUI Release|0 warnings / 0 errors，36.52 秒|
|`git diff --check`|Passed|

编译命令：

```powershell
.tools/dotnet10/dotnet.exe build desktop/src/Zhike.Desktop/Zhike.Desktop.csproj -c Release -p:Platform=x64 -r win-x64 -p:Stage51IsolatedUi=false --nologo -v:minimal
.tools/dotnet10/dotnet.exe build desktop/src/Zhike.Desktop/Zhike.Desktop.csproj -c Release -p:Platform=x64 -r win-x64 -p:Stage51IsolatedUi=true -p:OutputPath=../../../.tools/stage51-native-v2/ --nologo -v:minimal
```

首轮失败与处理：

1. 三个 .NET fixture 在新 worktree 使用 `--no-restore`，缺少 assets 文件。对原项目执行 `dotnet restore`，不改产品代码。
2. WS 导航测试仍匹配旧图标。更新为共享 SVG 的实际图标、viewBox 和无障碍契约，业务断言保留。
3. 头像字号 12.8px 未达现有 14px 下限。修正共享 CSS。
4. WS 新面板只有渐变层、计算背景为透明。添加既有主题不透明底色。
5. S3 操作测试按 LF 字串切片，Windows CRLF fixture 不匹配。只规范测试读入换行，不改业务或放宽断言。

测试原始输出在 [tests](evidence/zhiker-61-global-visual/tests/)。`result-index.json` 中 PASS 标记包含子测试输出，不用标记条数替代 runner 最终 317/318。

## 5. 唯一全量失败：Edge 退出

入口：`scripts/stage51/workspace-layout.test.cjs`，阶段 5.1 真实工作区折叠布局。
第二轮 invocation：`1795020493025-13a4a511-5469-4e8f-b99f-c5c8d50cf3c7`。
错误：`EDGE_RUNNER_TIMEOUT`，phase `process-exit`，30 秒既有生命周期预算。

证据顺序：

- 2.027 秒 CDP ready；
- 15.418 秒目标导航完成；
- 15.429 秒校验 6 档布局结果，15.522 秒 result-ready；
- 15.552 秒 Browser.close 协议应答，15.556 秒 CDP 正常关闭；
- 30.006 秒仍未取得根进程 exit/close 与流释放证据，超时；
- runner 按原逻辑请求终止自己持有的子进程，身份探针释放未确认，`cleanupSafe=false`，保留测试目录。

首轮该入口正常退出并通过；两次布局结果文件 SHA-256 均为
`750D4217B1AF83E303959799BEDD3BC3390CD711763B0A73989A511C50EB2DE0`。
此证据没有发现布局输出回归，但**不能证明退出超时根因，更不能认定问题修复**。失败调用的完整布局断言位于 runner await 之后，本次未执行，所以保留 Failed。

未修改超时、未跳过入口、未降低断言、未重跑到通过再覆盖失败。原始进程与结果记录在 [edge-exit](evidence/zhiker-61-global-visual/edge-exit/)。后续 S3 攻坚需要独立退出观测证据，不能据视觉结果相同就把进程释放门禁放行。

## 6. Windows 原生验收

环境：Windows 11 Pro 10.0.26300，WebView2 157.0.4341.60，系统 125%（HWND DPI 120）。使用带 ISOLATED 标题的测试二进制、临时 SQLite、合成客户与 Mock Transport，真实 WS 网络和付费 AI 均禁止。

首次运行宿主构建标识 d05b941；修复列宽后只刷新本轮隔离资源。最终第二次运行复制到 e545292 的相同已提交产品资源再复验；宿主 C# 未变。最终代码提交 8da6fb2 中的集成白名单/fixture 修改在执行测试前已经存在，提交未改变受测内容。

合成规模：52 个 CRM 客户；服务层 2 个测试账号，4 个群组、4 条成员记录，8 个 AI Job，6 个审核候选；归档确认 default 联系人目录 49 条。原生账号目录本次只使用 default，**不把服务层两账号 fixture 算成十次原生切号**。

|操作|结果与限制|
|---|---|
|双主题客户列表与 360°|Passed，实际点击主题预览/完成；姓名、头像、号码及选中记录同步|
|中文/英文/印地语/默认头像|原生列表可见；更多 Unicode 分支由 Node 验证|
|客户列表垂直滚轮|局部 Passed，真实输入后列表偏移变化；不等同完整 S3 长时滚轮门禁|
|360° 内部滚动|最终资源复验 Passed，档案内部滚动、底部动作可见，主表位置保持|
|最大化与还原|两次原生运行可用；最小窗口边界未穷尽|
|WS 首页→联系人→聊天→成员→聊天→返回|Passed，已有 Core 保留，CRM 面板收起后扩展|
|WS 联系人、成员详情|真实服务合成资料与头像不可用说明可见；同号码不同群关系分别显示|
|真实 WhatsApp 聊天/头像/同步|Blocked，未连接，about:blank 不是 WhatsApp 功能验收|
|100% / 150% 原生 DPI|NotTested：本轮尝试打开 SystemSettings.exe 后没有可操作窗口，刷新窗口清单仍无目标；未修改系统缩放|
|125% 原生 DPI|Passed 于已观察客户/WS 子集；不能覆盖全部页|
|所有业务页逐一原生/十次切号/长时循环|NotTested；自动化覆盖不能替代|
|Windows 高对比、系统减少动画|NotTested；存在 CSS 契约。应用内关闭动画有 WS/GPT 浏览器计算样式证据|
|正常关闭|两个隔离运行均正常关闭，见后续资源证据|

首次日志：shell Core 1、WS Core 1、collector 0；WS about:blank 导航 1 次成功、retry 0。shell 的第二次导航来自本轮明确 Ctrl+R 加载列宽修复，不是页面切换反馈循环。最终运行仅客户页：shell Core 1、导航 1，主题切换没有创建第二个 Core。

### 实际截图

以下来自 Windows 运行中的隔离应用，均为合成数据。不是 ImageGen 效果图。工具 JPEG 为窗口捕获；PNG 为现有 F8 诊断的原生 WebView2 CapturePreview，字体显示更清晰。不同截图来自不同明示的资源修订，不伪称同一时刻。

- [最终深色列表与 360°](evidence/zhiker-61-global-visual/native/13-final-assets-customer-dark.png)
- [最终浅色完整档案](evidence/zhiker-61-global-visual/native/14-final-assets-customer-light.png)
- [最终档案内滚动](evidence/zhiker-61-global-visual/native/15-final-drawer-scroll.jpg)
- [最终还原窗口](evidence/zhiker-61-global-visual/native/16-final-restored-window.jpg)
- [WS 联系人头像能力说明](evidence/zhiker-61-global-visual/native/07-ws-avatar-unavailable.jpg)
- [WS 群成员](evidence/zhiker-61-global-visual/native/08-ws-members.jpg)
- [隔离聊天 Core 返回](evidence/zhiker-61-global-visual/native/09-isolated-chat-core-return.jpg)
- [聊天 CRM 面板收起](evidence/zhiker-61-global-visual/native/10-chat-crm-collapsed.jpg)

01–12 为前次运行，13–16 为最终 e545292 资源复验。完整文件清单与 SHA-256 在证据目录中。

## 7. 性能与退出实测

**记录观察，不新造性能放行阈值。** d05b941 原生运行在客户页进行 36 次、10 秒间隔采样；观察器启动至末样本 363.437 秒（6.06 分钟），首末样本间隔 362.964 秒。31 分钟生命周期日志不是 31 分钟资源采样；采样结束早于 WS Core 创建，不能作为 WS 长时压力验收。

|指标|实测|
|---|---|
|进程树工作集|875.75 → 890.20 MiB，范围 832.41–919.68|
|Private Bytes|503.37 → 499.16 MiB，峰值 530.30|
|线程|227 → 207，峰值 230|
|句柄|6011 → 6124，峰值 6130|
|进程/WebView2 子进程|9 / 6，采样期间稳定|

不能据这一段工作集变化宣称有或没有泄漏，也没有本轮改造前同负载对照，因此不宣称性能提升百分比。

首轮关闭后，9 个已采样进程身份全部退出；后建 WS 浏览器 PID 19212 另行确认不在，唯一测试目录关联进程为 0。最终运行 PID 35508 正常关闭后也确认不在、目录关联进程为 0。两次为明确时点核验，精确退出耗时及后建完整进程树的持续观测未执行。

## 8. 文件、证据与数据边界

产品文件：
- `resources/app/app.js`、`index.html`、`server.mjs`（仅新增静态脚本允许列表）。
- `modules/customer-avatar.js`、`design-system.css`、`business-6.css`、`global-6.css`、`home-6.css`、`gpt-modern.css`、`horizon-atelier.css`。
- `modules/productivity.js`（既有列宽恢复/拖动最小宽度）。
- `modules/ws-business-pages.js`、`ws-workbench.js`、`ws-workbench.css`。

测试文件：四个新增 avatar/360/column/WS-avatar 文件，既有 design-system、S3 core/operations、stage5 WS 页面断言及 renderer fixture、HTTP smoke、S1/S3 Edge fixture、总 runner。未删除既有测试。

基线至代码提交的 `desktop/`、SQLite 迁移、Worker、IPC、CRM 写入服务均无差异；生产开关未改，RD02 依赖 profile 复制的后台采集仍关闭。不操作生产数据库、真实 WS、正式 Worker/AI，不双写。

归档只含明确选择的测试日志、合成数据截图和白名单诊断字段。未提交 connection.private.json、profile、SQLite、媒体或登录态。完整测试日志中的 Windows 用户 SID 已在归档副本脱敏，原始输出留于本机忽略目录；原始与归档 SHA 及替换数量见 redaction.json。脱敏后敏感格式扫描无命中；扫描不是绝对无敏感信息证明，来源选择与人工范围复核同时实施。

本轮原生目录：
`C:\Users\酷酷\AppData\Local\Temp\zhike-stage51-native-dc52bb8893c043b4a7d4813039e5a21c`。
已关闭并核验进程，保留于本机供故障取证，未提交其数据库/profile/private连接文件。失败 Edge 根
`C:\Users\酷酷\AppData\Local\Temp\zhike-stage51-layout-ae3Mzu`
因资源释放未核实按 runner 规则保留，**未擅自删除或强制清理**。首轮其他失败 fixture 也保留，不删除历史失败证据。之后只应在精确归属与释放核实后按既有清理流程处理。

## 9. 未完成与门禁

1. Edge 进程退出超时根因未定，本轮完整回归未全绿。
2. 原生 100%/150%、系统高对比/减少动画、完整多账号/页面长时循环尚未验收。
3. 真实 WS 客户头像与可信 CRM 阅读投影缺少可用源，保持 Blocked/Unknown；没有头像缓存或自动同步能力。
4. 原生资源测量是局部观察，没有最终资源版本的长期稳定性通过结论。
5. 既有 S3、跨设备正式安装和生产准入阻断不会因视觉升级自动解除；本轮没有安装包/真实账号验收。

**本轮验收 Gate：Blocked。S3：Blocked。Production：FROZEN。阶段 6 不启动。**

回滚：在独立分支按逆序 revert 本轮产品提交，先处理 8da6fb2，再按本报告提交表逆序处理；保留失败证据和报告。没有数据库 schema 或业务数据变更，不需要回退客户数据库。不要对原有未提交工作执行 reset/clean，也不要为回滚复制认证 profile。
