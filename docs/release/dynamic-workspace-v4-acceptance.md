# Horizon Atelier Pro · Dynamic Workspace V4 实施与验收

日期：2026-11-17。范围：现有 S3 视觉增强，不新增项目阶段。分支：`upgrade/zhike-61-ab-delivery`。

**代码已提交；完整视觉验收未完成，S3 Gate 继续 Blocked，生产 FROZEN。** 最终全量为 **289/291**；两个失败均为实际隔离 Edge 生命周期超时。不能把取得截图、局部断言满足或 WS 子集通过描述成全项目验收完成。

## 1. Git 与实施边界

- 开始基线：`db4abfb394096e050038587f24ede47b84c781e6`，开始时工作区干净。
- 代码提交：`63bea509baffa1b1b3f4abca02b8607cf5240764`。
- 本文、覆盖清单与归档证据使用独立报告提交；其提交号用 `git log -- docs/release/dynamic-workspace-v4-acceptance.md` 查询，避免报告自引用。
- 未改 CRM 权威服务、数据库/schema/迁移、Worker、IPC、Provider、密钥存储或 WebView2 生命周期。没有新依赖、新业务模块、第二套设计系统或第二消费者。
- 保留 M01–M23 与 WS01–WS12 路由、导航宽度及折叠逻辑、前台真实聊天 host、现有图表数据口径、人工资料保护和 RD02 安全停用状态。
- 本轮使用隔离合成业务样本；没有连接真实 WhatsApp、付费 AI、生产 SQLite，未启用正式 Worker/AI，也没有发布安装包。
- [只读提交范围复核](evidence/dynamic-workspace-v4-2026-11-17/final-scope-audit.md)记录实际 diff 及截图夹具调用路径。代码审查不是全机网络抓包或业务实机证明。

## 2. 实际修改

|区域|修改|保留的边界|
|---|---|---|
|共享主题|浅色工作区 `#F5F7FA`、白色面板、局部浅色层次；深海蓝夜色保留。共用 rail、模块强调色、AI 紫粉渐变 token|原主题、密度、减少动画机制；不覆盖 WhatsApp 内部主题|
|CRM 与 WS 侧栏|海蓝渐变、静态原创曲线、分层品牌、胶囊选中项、模块图标色、底部信息区域|入口、宽度、折叠、工作台切换及 WebView host 不变|
|首页|原创 Digital Horizon SVG 横幅；真实日期与原待跟进计数；小窗口弱化装饰|没有虚构 KPI、改变提醒来源或统计公式；SVG 无交互命中|
|业务页面|任务紫色、阶段青色、热聊橙色、VIP 金色、跟票靛蓝、报名绿色、入金青绿等局部强调；统一详情、表格与治理类面板|原记录、币种、确认、阶段、筛选、分页、保存与导出语义|
|号码登记|清理该 CSS owner 内重复旧样式和深色、小字号覆盖；统一表单、分页|原号码规范化、去重与 CRM 边界|
|WS / GPT|十二页外层卡片、工具栏、标签、辅助面板；GPT 紫粉主题及配置弹窗|不增加群发或采集权限；不改 Provider、Key 或调用逻辑|
|原生启动层|18 个原生画刷加入 Light/Dark/HighContrast 字典，现有引用使用 ThemeResource|只改资源；不改 C#、事件、命名控件、宿主结构或初始化|
|客户冻结列|为普通、交替、选中行提供不透明主题背景，避免横滚时底层文字透过固定列|不改 sticky 坐标、z-index、滚动所有权、选择与业务事件|

本轮没有新增业务图表。保留已有客户/业务图表及任务完成率、阶段已记录历史两图：不混币种、不把阶段快照当转化漏斗、不从空历史推断活动。它们使用原只读投影与组件；本轮没有重新验收每个图表明细入口。

没有新增动画框架、持续动画或逐行入场。保留原 finite 入场、hover、拖动和减少动画规则；侧栏与横幅新曲线是静态装饰，动态业务数字来自原数据。没有为了装饰增加数据库读取、轮询或 WebView 重建。

### 2.1 本轮复现并最小修复的视觉问题

1. **原生客户表横滚文字重叠**：`01-customer-light-overlap.png` 是失败证据。浏览器实测确认普通/奇数行背景透明，固定单元格继承该背景后透出后方列；偶数行已有不透明背景。仅补三条原 owner 背景规则，默认 10 场景专项通过。保留已有 selected、hover、focus 高亮。最终原生横滚尚未复验。
2. **横幅品牌文字 12px 不满足既有标准**：首轮全量实际断言失败；改产品字体为 14px。最终浏览器返回的 8 视口 × 20 页共 160 条观察满足原字号断言，但生命周期超时导致整项仍 Failed。
3. **原生视觉合同残留旧固定颜色**：产品已经使用新 ThemeResource；测试仍要求旧单一浅色值。更新为明确的 Light/Dark/HighContrast 资源值和原布局合同，没有放宽字体、对比度、溢出或行为断言。

## 3. 页面与组件覆盖

完整索引见 [35 页与 15 组组件覆盖清单](dynamic-workspace-v4-coverage.md)。

已定位全部 23 个主页面、12 个 WS 页面、实际 GPT、25 个弹窗/生命周期符号、31 处弹窗标题调用。使用共享组件做必要美化；符合要求的原组件保留。**源码覆盖不等于全部页面、弹窗和状态已经实机验收。**

新 opt-in 截图命令准备了 122 个实际 renderer 场景（35 页双主题、弹窗、空态、compact 等）。它只读取仓库与合成数据，不属于产品执行路径。正式截图批次在第 3 个页面发生 Edge 退出超时后停止，不能将 122 个准备项当成 122 个完成项。

- 成功 browser capture 的独立页面为：首页、快速录入、GPT、WS 前台聊天，共 4 页；首页有重复批次，不重复算页数。
- 任务页有真实 renderer JSON 和 PNG，但资源退出失败，整项 Failed。
- 最终自动化主 renderer 产生 8 视口 × 20 页观察数据，与独立截图数量、原生页面数量是不同口径，不能混算。
- [覆盖清单](dynamic-workspace-v4-coverage.md)逐页标明实际截图、源码责任、未验状态及限制。

## 4. 真实 Windows 原生检查

环境：Windows 11 Pro `10.0.26300`，x64；WebView2 Runtime `157.0.4341.46`；隔离 Release 构建 `Stage51IsolatedUi=true`。窗口标题含“ISOLATED 验收”。程序集版本沿用 `6.0.3+db4abfb`，这是从当时工作树构建的隔离验收入口，不是发布 6.1 安装包。

数据：52 个合成客户、2 个测试账号、4 个群组、4 个成员、8 个 AI 任务、6 个候选及少量合成业务记录。页面上“本机业务数据”指该隔离工作区，不是用户正式资料。

本轮保存 15 张真实 WinUI 截图。实际完成的有限动作：

- CRM 侧栏展开/收起，浅色首页及原外观弹窗查看。
- 深色预览、保存及返回首页；任务中心、阶段看板访问。
- 进入 WS、独立导航、前台聊天外壳、CRM 辅助面板展开、群组及账号页查看。
- 返回知客恢复先前阶段看板和主侧栏。
- 正常关闭隔离窗口，随后只读核对 **15 个已观察进程身份均退出**，没有通过检查命令强杀进程。

重要限制：

- 聊天外壳显示连接失败/未登录，未连接真实 WS，不能证明聊天收发、翻译或平台采集。
- 阶段页一次滚轮操作没有观察到滚动，点滚动条轨道后可移动；根因未确定，不能签署原生滚轮通过。
- 本轮没有完成十次账号切换、35 页原生完整导航、所有弹窗、动效 OFF、compact、小窗口及全部 DPI 矩阵。
- 最终 14px 品牌文字和固定列背景修复发生在这些原生截图之后，未再次启动原生窗口复验这两项。
- 原生 XAML 主题按 Windows/WinUI 的原机制，网页主题按应用偏好；没有新增两者同步控制。系统主题和高对比模式运行验收仍未做。

### 4.1 可直接审核的截图

以下均是实现运行截图，数据是隔离样本；不是设计效果图。

|内容|本轮证据|
|---|---|
|首页 / 数字地平线浅色|[02-home-light.png](evidence/dynamic-workspace-v4-2026-11-17/native/02-home-light.png)|
|CRM 展开侧栏浅色|[03-crm-rail-expanded-light.png](evidence/dynamic-workspace-v4-2026-11-17/native/03-crm-rail-expanded-light.png)|
|外观弹窗浅/深|[04](evidence/dynamic-workspace-v4-2026-11-17/native/04-appearance-light.png)、[05](evidence/dynamic-workspace-v4-2026-11-17/native/05-appearance-dark.png)|
|首页深色|[06-home-dark.png](evidence/dynamic-workspace-v4-2026-11-17/native/06-home-dark.png)|
|任务 / 阶段|[07](evidence/dynamic-workspace-v4-2026-11-17/native/07-tasks-dark.png)、[08](evidence/dynamic-workspace-v4-2026-11-17/native/08-stage-board-dark.png)、[09](evidence/dynamic-workspace-v4-2026-11-17/native/09-stage-columns-dark.png)|
|WS 侧栏、任务及停用状态|[10-ws-rail-tasks-dark.png](evidence/dynamic-workspace-v4-2026-11-17/native/10-ws-rail-tasks-dark.png)|
|WS 容器及 CRM 辅助面板|[11](evidence/dynamic-workspace-v4-2026-11-17/native/11-ws-chat-dark.png)、[12](evidence/dynamic-workspace-v4-2026-11-17/native/12-ws-crm-panel-dark.png)|
|WS 群组 / 账号 / 返回|[13](evidence/dynamic-workspace-v4-2026-11-17/native/13-ws-groups-dark.png)、[14](evidence/dynamic-workspace-v4-2026-11-17/native/14-ws-accounts-dark.png)、[15](evidence/dynamic-workspace-v4-2026-11-17/native/15-return-crm-dark.png)|
|冻结列修复前/后（浏览器，不是原生）|[before](evidence/dynamic-workspace-v4-2026-11-17/customer-table/v4-horizontal-before.png)、[after](evidence/dynamic-workspace-v4-2026-11-17/customer-table/v4-horizontal-after.png)|

升级前对照复用 [此前原生浅色客户/CRM 侧栏](evidence/horizon-pro-acceptance-2026-11-17/native-light-customers.png)、[此前原生 WS 辅助面板](evidence/horizon-pro-acceptance-2026-11-17/native-ws-crm-expanded.png)及 [历史首页](evidence/visual-usability-2026-11-17/before/home-atelier-dawn.png)。它们属于此前报告与版本，不是本轮基线逐页同数据、同尺寸重拍，不用于像素级量化改善。

本地群组、VIP、跟票、报名、入金、统计、完整设置及多数低频弹窗的本轮截图仍缺失；没有用 WS 群页代替本地群页，也没有用外观弹窗冒充整个设置页。

## 5. 实际测试结果

使用仓库 bundled `resources/app/node.exe` 与 `.tools/dotnet10/dotnet.exe`。结果来自本轮执行，历史基线没有充当新结果。

|命令 / 范围|本轮结果|证据与含义|
|---|---|---|
|`node scripts/run-tests.cjs all` 首轮|288/291，3 Failed|[首轮日志](evidence/dynamic-workspace-v4-2026-11-17/full-regression.sid-redacted.log)。旧颜色合同、实际字号、Edge 退出失败；失败保留|
|同命令最终轮|**289/291，2 Failed**|[最终日志](evidence/dynamic-workspace-v4-2026-11-17/full-regression-final.sid-redacted.log)；两个 Edge 生命周期问题见下节|
|`node scripts/run-tests.cjs ws` 首轮|159/160|与同时进行的编译争用 XAML obj/input.json；日志明确文件占用。未修改产品以迁就测试|
|WS 串行轮|159/160|群发/翻译审计进程 120 秒超时；内部输出不足，原因 Unverified|
|最终全量中的 WS 标签子集|**160/160 Passed**|[严格标签匹配记录](evidence/dynamic-workspace-v4-2026-11-17/final-test-subsets.json)。不是另一次独立 ws 命令；早前失败不删除|
|群发/翻译审计单独重复|6/6 Passed，约 0.82–0.90 秒/次|只表明单跑未复现，不能确认或宣称已修复此前超时根因|
|Delivery S1 WS computed|Passed|12 route × 6 浅色有效视口及深色、字号/按钮/对比度、20 次 DOM anchor 更新；不是原生 WebView Core/真实账号证明|
|客户表默认专项|10/10 Passed|奇偶行横滚固定列背景、原断言和动效关闭样式纳入。最终 full 中该检查 Passed|
|客户表额外截图模式|Failed|1280×900、1280×800 的既有抽屉底部可达断言未满足；截图可证明重叠修正，不代表整个 opt-in case 通过|
|原核心页面、身份及操作回归|Passed；身份 14/14、操作运行时 51/51|最终 full 对应项通过；含原两图只读边界，不把 VM 断言称原生交互|
|Worker / IPC / fencing / 024|最终 full 对应项 Passed|原实际隔离进程、临时 SQLite 写入与兼容流程；本轮不重复宣称跨真实 SID 已新测|
|原生画刷合同、业务/号码/GPT/主题合同|最终 full 对应项 Passed|主题资源明确、AA 校验、旧功能边界保留|
|Release x64 编译|**Passed，0 warnings / 0 errors，20.86s**|[最终编译日志](evidence/dynamic-workspace-v4-2026-11-17/release-build-final.log)|
|`git diff --check`|Passed|提交前执行；最终工作区由提交后状态确认|

最终编译命令：

```powershell
.tools/dotnet10/dotnet.exe build desktop/src/Zhike.Desktop/Zhike.Desktop.csproj -c Release -p:Platform=x64 -r win-x64 --no-restore
```

完整 runner 检查总数仍为 291；扩展了已有断言，没有删除失败测试、减少断言或延长超时。新截图工具是显式 opt-in，不增加 runner 检查数。两处已批准新色值的断言更新不是放弃对比度/字体/布局检查。

### 5.1 最终两项失败

**Stage 5.1 real workspace collapsed layout**

- Invocation：`1794936944713-5e93f3ef-8e30-4a57-94d1-7958951ecfb3`。
- 14.04 秒取得 6 场景结果，14.96 秒 Browser.close 与 CDP 关闭已确认；30 秒未能证明进程退出。
- 既有 helper 记录其失败处理中的 owned-handle termination；本轮未更改这一行为，未另行强杀其它进程。
- 原 `cleanupSafe=false`、Failed 保留。随后只读检查该次 12 个已观察 PID 均已退出，不倒改失败。
- 结果与元数据归档于 `final-regression/stage51/`。

**Delivery S1 actual main renderers and shared design system**

- Invocation：`1794937090207-b9cbe0f2-2291-40c2-8c13-d4fedbc08485`。
- 27.89 秒得到 8 视口结果，28.55 秒 Browser.close 已确认，29.30 秒进程及流关闭；生命周期最后身份核验触及截止时间，报 `phase=identity`。
- 记录为 Failed；最终 `cleanupSafe=true`、无剩余身份，测试目录按原 helper 清理。
- 已返回 JSON 按原字号规则只读检查为 160 条页面观察、0 个字号违例。这只支持本次字体修正，没有跳过整个测试失败。
- 结果与元数据归档于 `final-regression/main/`。

上述是触发位置与时间证据，**尚未证明 Edge 内部退出延迟或身份查询超时的根因**。不能仅凭此修改业务、WebView2 生命周期、扩大权限或延长时限。既有历史桥接超时、WS 启动延迟及 WMI 延迟风险也没有被本轮关闭。

## 6. 性能与退出

[本轮原生采样](evidence/dynamic-workspace-v4-2026-11-17/native-resources.log)：3 次、3.427 秒，仅用于关闭前资源基线：

- 进程树 Working Set：1,230,684,160 → 1,230,643,200 bytes（约 1173.7 MiB）。
- Private Bytes：630,984,704 → 630,923,264。
- 线程：340 → 339；WebView 子进程：12 → 12；观察进程：15。
- 该短段 CPU 累计差 0 秒，不等于软件长期无 CPU 占用。
- [正常关闭后复查](evidence/dynamic-workspace-v4-2026-11-17/native-process-cleanup-final.log)：15/15 退出，无剩余/不明身份。

没有长期帧耗时和完整高密度操作性能实测，因此**不宣称“不卡顿已全面验收”或无内存泄漏**。原自动化查询/列表性能检查的通过范围仍是各自隔离夹具，不能替代用户全工作负载。

## 7. 临时资源与安全

本轮没有删除来源不明的目录、提权、绕过 blocked by policy 或修改系统设置。保留诊断资源不含正式客户资料，但浏览器 profile 仍按敏感本地资源对待，不进入 Git。

|资源|当前情况|
|---|---|
|`C:\Users\酷酷\AppData\Local\Temp\zhike-stage51-native-30ffcf8c8cdb4ee5b4abcf515ddf7f7e`|本轮原生隔离库/profile，正常退出且15个已观察进程均释放；保留本地诊断|
|`C:\Users\酷酷\AppData\Local\Temp\zhike-s1-main-style-JCgVB2`|页面捕获失败保留；当时17个身份中16个已消失、1个PID的StartTime不可读，未强行推断或删除|
|`C:\Users\酷酷\AppData\Local\Temp\zhike-stage51-layout-Ga1QyY`|首轮全量 collapsed 失败保留；最新只读检查12个已观察PID均已退出|
|`C:\Users\酷酷\AppData\Local\Temp\zhike-stage51-layout-eYTIjH`|最终全量 collapsed 失败保留；最新只读检查12个已观察PID均已退出|
|`C:\Users\酷酷\AppData\Local\Temp\zhike-ws-broadcast-2GH5Zz`|串行WS超时诊断目录；记录PID35000已退出、测试端口4497无监听，不等同全面句柄扫描|
|`C:\Users\酷酷\AppData\Local\Temp\zhike-s1-main-style-tZqAdl`|最终main失败但资源释放安全，原helper清理后路径不存在|

最新只读结果见 [final-edge-identities.json](evidence/dynamic-workspace-v4-2026-11-17/final-edge-identities.json)。未把 PID 复用等同原进程仍在，也未删除原有用户资料。

证据目录：[归档](evidence/dynamic-workspace-v4-2026-11-17/)、[SHA-256 清单](evidence/dynamic-workspace-v4-2026-11-17/manifest-sha256.json)、[凭据模式扫描](evidence/dynamic-workspace-v4-2026-11-17/sensitive-scan.json)。

归档为 99 个唯一证据路径（26 PNG、73 文本，93 个不同内容 hash），11,367,599 字节；另有 manifest、scan 和 `.gitattributes` 3 个控制文件。97 份源/目标原字节相等，2 份 SID 脱敏；99 份校验无异常，无未登记附件。

- 仅归档 PNG、诊断 JSON/JSONL、测试/编译日志及范围清单；没有 SQLite、Cookie/profile、`connection.private.json`、真实聊天或真实 Key。
- 两份全量日志中的完整 Windows SID 使用明确标记的脱敏副本；原日志留 `.tools`。清单保留源 hash、归档 hash 和 transformation；不对脱敏副本声称原字节相等。
- 其余文件按原字节保存，校验源与归档一致。实际凭据模式扫描不把普通“token/key”字段名误判为秘密；截图人工可见内容为隔离样本，不声称完成 OCR 或绝对无敏感信息的证明。
- 原生失败截图、测试失败日志与首轮测试夹具错误都保留，不只展示有利结果。

## 8. 修改文件完整清单

产品：

- `resources/app/app.js`
- `resources/app/modules/design-system.css`
- `resources/app/modules/horizon-atelier.css`
- `resources/app/modules/home-6.css`
- `resources/app/modules/global-6.css`
- `resources/app/modules/business-6.css`
- `resources/app/modules/operations-6.css`
- `resources/app/modules/phone-registry.css`
- `resources/app/modules/ws-workbench.css`
- `resources/app/modules/gpt-modern.css`
- `resources/app/modules/gpt-management.css`
- `desktop/src/Zhike.Desktop/App.xaml`
- `desktop/src/Zhike.Desktop/MainWindow.xaml`
- `desktop/src/Zhike.Desktop/Views/LegacyUiHostPage.xaml`

测试与显式捕获工具：

- `desktop/tests/DesktopVisualContractTests.cjs`
- `tests/design-system-contract.test.cjs`
- `tests/horizon-atelier-contract.test.cjs`
- `tests/business-6-shell-contract.test.cjs`
- `tests/operations-6-workspace-contract.test.cjs`
- `tests/single-runtime-route-contract.test.cjs`
- `scripts/delivery/dynamic-v4-capture.cjs`
- `scripts/delivery/s1-main-visual.test.cjs`
- `scripts/delivery/s1-ws-visual.test.cjs`
- `scripts/delivery/s3-customer-table-visual.test.cjs`

共24个代码/测试文件，484行新增、164行删除。没有修改历史迁移及 checksum，没有重复开发已验收功能。

## 9. 剩余阻断与后续处理

|事项|状态|下一步|
|---|---|---|
|共享视觉、双侧栏、横幅、业务/GPT/原生资源代码|已完成提交|保留当前改动，不扩大设计范围|
|两项最终 Edge 生命周期检查|Failed / 根因未证实|利用已归档的进程、CDP、时间线精确定位；需要时只修有证据的测试边界，不降低安全/超时断言|
|35页双主题、低频弹窗、状态及显示矩阵|未验证完整|在退出边界可靠后继续已准备但未执行的场景，不重写页面|
|最终客户冻结列与字号原生复验|未完成|使用隔离 WinUI 检查修复后滚轮/横滚/选择与字体|
|本轮原生滚轮、十次账号切换、动效关闭|未验证|补准确操作与证据；历史通过不冒充新结果|
|额外可见iframe客户抽屉底部可达断言|Failed / 原因未证实|对比默认10场景与该模式viewport/滚动数据，保留失败断言|
|长时间性能稳定性|未验证|定义实际操作记录并沿已有性能设施采样，不发明阈值|
|诊断资源清理|部分保留|先完成身份/引用复查，再按既有批准边界处理；不强删|
|S3整体|**Blocked**|补足上述必要证据后再评审|
|生产、发布及下一阶段|**FROZEN，不放行**|本轮不启动阶段6、不发布安装包|

回滚：使用独立代码提交 `63bea50` 的反向提交恢复本轮视觉/测试改动；不需要业务库迁移、数据恢复或删除 profile。回滚应在干净分支执行并重新运行受影响回归，本轮未实际执行回滚。

报告提交后需以实际 `git status --porcelain` 空输出确认工作区干净。不会通过本报告将 S3 历史阻断改写为 Passed。
