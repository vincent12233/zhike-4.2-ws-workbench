# 当前可用性稳定化交付

日期：2026-11-19（Asia/Calcutta）。目标：在现有项目上修复影响正常使用的已证实问题，保留业务规则与已批准的安全边界。**生产入口 FROZEN，未发布安装包。**

## 基线与交付范围

- 从干净的 `17aaecf` 建立 `integration/61-usable-stabilization`，保留 `integration/61-visual-system`。
- 本轮代码/测试最终提交 `e44518d`。原生构建版本 `6.0.3+4d7ff7a`；两者差异仅为 `e44518d` 的测试校正，原生构建已含全部本轮产品修复。
- 原项目 `integration/61-s3-gate` 下已有未提交文档未覆盖。未修改历史迁移、SQLite schema、CRM 权威规则、Worker/fencing/IPC 安全边界或认证 profile。
- 本轮属于本地使用候选的稳定化；不等于所有功能上线或整体验收通过。RD02 禁用的旧后台采集没有恢复。

## 已证实问题与最小修复

| 问题 | 实际修复及证据 | 提交 |
|---|---|---|
| 客户编辑在 VIP 冲突拒绝前已改变部分对象字段 | 先校验，再记录快照/写入；等待期间重查冲突；防重复提交；失败恢复原字段且删除本次引入字段。隔离真实 handler 回归覆盖拒绝、同一编辑表单重复提交和回滚，不冒充跨窗口并发验收 | `38d8872` |
| 保存历史跟进日期被阶段推进覆盖为今天 | 保留实际跟进日期，并避免倒退更晚的已有跟进时间；真实 handler 回归 | `38d8872` |
| WS 返回已隐藏/不可访问的旧主页面 | 按当前可访问主导航选择回退入口，保留原导航结构；隐藏/禁用回退由运行时回归覆盖，原生验证普通返回、导航及窗口还原 | `95078dd` |
| 原生添加 WS 账号可能在 sidecar 失败后仍报告成功 | 先确认 sidecar 的规范账号 ID，再原子更新 native 索引；409 必须精确 ID 回读；索引失败明确报错并允许后续列表修复；真实 C# 服务/宿主方法隔离回归、原生新增账号 | `5a713ac` |
| 添加重试生成新 ID、HTTP fallback 可能掩盖 native 索引失败 | 表单重试保留稳定 ID；fallback 完成后必须确认 native 索引；明确失败时不假报成功 | `7222c52` |
| WS 启动错误被刷新清除、旧异步响应覆盖新连接结果 | 非聊天页面也显示可操作的启动错误；同账号刷新不使合法结果失效；切号与显式重连分代，旧结果不覆盖当前状态 | `7222c52`、`b6f655c` |
| 缺少打包 Node runtime 可能到运行时才失败 | bundle/installer 在破坏 staging 或进入构建前检查随包 node.exe；不依赖开发机 PATH；实际缺件回归。此次未生成安装包 | `2fc6518` |
| 部署说明把未开放能力描述为可用 | 修正前台聊天、被禁用采集、AI 授权与本机依赖说明 | `2fc6518`、`ed9e574` |

账号忘记操作保持仅移除目标账号的语义，不删除已有 profile。索引改用原子更新后，旧静态测试仍要求 `SaveAsync`，首轮全量因此失败。`e44518d` 将断言改为验证 `UpdateAsync`、并发新增保留、目标删除及默认账号保护，并增加实际生产方法运行时覆盖；没有删除失败测试或降低安全断言。

主要文件：`resources/app/app.js`、`modules/workspace-shell.js`、`modules/ws-workbench.js`；原生 `ApiClient.cs`、`WsAccountStore.cs`、`LegacyUiHostPage.xaml.cs`；两个 WinUI 打包脚本；6 个测试文件、1 个 fixture helper 和测试 runner。相对基线新增 1 项 runner check（原生账号一致性），总数由 318 增至 319；其他案例扩充在既有检查内。

## 实际 Windows 原生验证

仅本轮临时工作区，Windows 11 Pro 10.0.26300 x64，125% / 120 DPI，Release，WebView2 157.0.4341.60。数据由现有 `scripts/stage55b/seed-native.cjs` 产生：2 个账号、2 个客户、4 个群组、4 个成员、每账号 49 联系人及 46 个 AI Job；均为明确的合成资料。

已实际点击/观察：

- 进入 WS 自动最大化，独立导航显示；返回知客恢复原窗口大小和主导航。
- 十二页正常进入；十次 A/B 切换；原生新增第三个账号，其通讯录为空，既有账号资料仍在。
- 同成员在两个群的两条关系分别展示；采集和 AI 消费者保持关闭，界面没有伪报正在执行。
- 一个失败的合成 AI Job 经明确重试进入 Queued；CRM 候选分别验证空字段补全、拒绝、人工字段冲突保护，日志中有对应审核记录。
- CRM 内层滚动、聊天右侧面板展开/收起、十二页返回聊天、主界面深色主题预览/保存。
- 1 个 shell Core + 3 个账号 Core；13 次账号选择中 10 次复用，未因业务页切换重新创建聊天 Core，未发生隔离导航重试循环。
- 正常关闭后，28/28 已观察 PID + 启动时间身份均已退出；同二进制/临时根引用为 0，日志记录宿主和 sidecar 停止。

详细操作台账：[native-verification.json](evidence/usable-stabilization/final/native-verification.json)。截图是实际隔离 WinUI 捕获，不是设计预览。`about:blank` 隔离聊天容器 **不能证明真实 WhatsApp 登录、输入、收发或翻译可用**。本轮新 CRM 表单边界修复由实际 handler 自动化验证；原生操作的是 AI 审核，不混淆两者。

## 性能与资源观察

91 个样本，947.217 秒（15.79 分钟），请求间隔 10 秒；包括账号 Core 的首次创建和多页操作。

| 区间 | 工作集 | Private Bytes | 进程/说明 |
|---|---|---|---|
| 完整采样 | 833.707 → 2018.395 MiB，峰 2079.980 MiB | 469.672 → 1057.617 MiB，峰 1116.219 MiB | WebView 子进程 6 → 24，包含 3 个账号 Core 新增 |
| 3 账号已建立后 391.052 秒 | +9.465 MiB | +2.832 MiB | 27 个身份固定，其中 24 个 WebView |
| 最后 179.617 秒 | −7.215 MiB | −5.285 MiB | 区间仍有波动 |

线程 218 → 623（峰 651），句柄 5780 → 15322（峰 15366），累计观察 CPU 86.766 秒。关闭验证来自独立退出后点检，不把采样结束时仍存活误记为已退出。证据：[resource-analysis.json](evidence/usable-stabilization/final/resource-analysis.json)、[native-exit-analysis.json](evidence/usable-stabilization/final/native-exit-analysis.json)。

当前进程树约 2 GiB 的工作集值得继续评估。已有架构保留每账号 Core，本轮没有未经证据更改生命周期。无同负载改前对照、无正式性能阈值，因此仅记 **Observed**，不声称性能提升、无泄漏或已经达到全部性能门槛。

## 测试命令与实际结果

均在本开发工作区执行，未复制历史测试数字：

```powershell
& '.\resources\app\node.exe' '.\scripts\run-tests.cjs' all
& '.\.tools\dotnet10\dotnet.exe' build desktop/src/Zhike.Desktop/Zhike.Desktop.csproj -c Release --no-restore -p:Platform=x64 -r win-x64 --nologo -v:minimal
& '.\.tools\dotnet10\dotnet.exe' build desktop/src/Zhike.Desktop/Zhike.Desktop.csproj -c Release --no-restore -p:Platform=x64 -r win-x64 -p:Stage51IsolatedUi=true -p:OutputPath=../../../.tools/stage51-native-v2/ --nologo -v:minimal
```

| 检查 | 本轮结果 |
|---|---|
| 首轮全量 | 318/319；旧 SaveAsync 静态断言失败，原始输出保留；运行起点为 7222c52、期间合入 b6f655c，故仅作为诊断，不作为最终冻结版本验收 |
| 最终 e44518d 全量 | **318/319，1 Failed**：`Delivery S1 actual main renderers and shared design system` 的 Edge `process-exit` 超时；不是旧 SaveAsync 断言，后者已通过 |
| WinUI Release x64/win-x64 | 0 warnings / 0 errors，21.38 秒 |
| 隔离 WinUI Release | 0 warnings / 0 errors，31.60 秒 |
| 迁移、024 checksum、WS、AI/CRM、Worker/IPC/fencing | 最终全量内对应检查全部通过；完整逐项输出保留。没有把历史跨 SID 实测当作本轮重新执行 |
| 新原生账号运行时与修正后的 desktop contract | 专项通过，最终全量再次通过 |

`all` 包含完整 WS 测试集及各关键回归，不额外重复同一套检查来制造通过次数。数量是 runner checks，不能当作单个断言数量。历史跨 SID 实机证明没有在本轮重做。

## Edge 与其他残余风险

- 独立 Stage 5.1 Edge 实验 6/6 通过，观察到 OS 正常退出。zero-page 对照在仍有 1 个 page 时被保护断言拒绝，不能声称控制变量成立。前期证据已单独提交 `4d7ff7a`。最终全量**再次复现**主界面 Edge 退出超时：结果在 3.336 秒取得、Browser.close ACK 在 3.342 秒、CDP transport 在 3.343 秒关闭，但直到 30.009 秒仍未收到进程退出事件；runner 保留失败并请求终止它自己创建的进程。不是渲染结果可用就判通过。该次未启用独立内核 observer，不能冒用其他轮内核证据；**退出超时的根因仍未证实**，不修改超时或关闭检查来放行。
- 全量结束后，用同一 S1 测试入口加现有独立 Win32 observer 只复验一次：整个命令仍失败，前五个 invocation 有通过断言，第六个在结果/截图取得后再次退出超时。该次精确 PID + 创建时间绑定的 OS 句柄在原 deadline 返回 `WAIT_TIMEOUT(258)`，不是仅 Node/stdio 未通知。线程采样为 `ArgumentException`，没有可归因的线程栈；因此定位到 Edge 进程退出层，尚不能确定具体组件或安全地修改产品生命周期。独立复验不替代最终全量，也不把前五次成功拼成通过。
  - 复验命令：设置仅诊断用的 `ZHIKE_EDGE_OBSERVER_DOTNET` 为本工作区 `.tools/dotnet10/dotnet.exe`，执行 `resources/app/node.exe scripts/delivery/s1-main-visual.test.cjs`，退出码 1。全过程没有增加超时、跳过断言或新增消费者。失败与复验原始校验、脱敏时间线见 [Edge 最终失败证据](evidence/usable-stabilization/edge-failure-final/README.md)。
- 本轮同一宿主两次 sidecar-created 相隔 21.042 秒，唯一 ready 对应第二次创建后 2.212 秒。资源采样只见第二个 Node 身份；首个实例没有退出码、失败原因或健康检查细节。启动/种子脚本没有人为启动两个 sidecar 的步骤；代码虽有重试路径，但日志不足以确定触发原因。保留首轮启动延迟风险，不隐去第一次尝试，也不把应用最终 sidecar-stopped 当作首个进程的退出证据。
- 已有“仅 native 索引存在、sidecar 缺失”的旧不一致账号不会自动被列表请求写回创建；需要明确同 ID 重试/受控修复，不能假称所有历史数据已自动修好。
- 本轮未完成 100%/150%、多屏、高对比、物理滚轮/触控板、重复投递等完整 S3 输入矩阵；工具输入与原生实际窗口不替代物理设备验证。
- 真实 WhatsApp 登录/收发/群组同步、付费 AI 质量、干净 Windows 10/11 安装及跨设备验收仍未执行；真实头像获取源仍为 Blocked，CRM 阅读仍保留 Unknown，不能当作未读。RD02 旧隐藏采集及其依赖能力继续不可用。

## 数据保护、归档与回滚

- 本次原生准备记录明确 `productionOpened=false`、`wsNetwork=blocked`、`paidAiNetwork=blocked`。只启动已编译的隔离入口与临时 sidecar，没有访问正式登录态或启动正式消费者。
- 归档仅明确选择的合成截图、脱敏运行日志、资源分析与校验清单。不归档 profile、Cookie、SQLite、connection.private.json、密钥或真实聊天。清单记录原始与归档 SHA-256 并读回校验；路径脱敏文件不伪称原始 bytes 相同。
- 本轮临时目录 `zhike-stage51-native-06215dd5e6b14cb09adcb817af22ff5e` 已停止使用，保留为本地诊断证据；没有执行删除或覆盖用户资料。旧临时目录不在本次清理范围。
- Edge 失败保留的 `zhike-s1-main-style-UZJ3c3`、`zhike-s1-main-style-stiPxF` 也未删除；失败不能以清除目录或终止后重新标记 Passed 来掩盖。退出后只读检查与保留路径见上述 Edge 证据。
- 本轮主要验收归档共 18 个文件，源/归档双 SHA-256 清单已读回核验，见 [manifest.json](evidence/usable-stabilization/final/manifest.json)。Edge 专项有独立清单，不把前期通过与最终失败混为一轮。
- 回滚保留 `17aaecf` 和上述各独立提交，可在隔离分支按逆序 revert 对应改动；无数据库迁移要回滚。不得借回滚恢复已禁用的认证 profile 复制。
- 报告/证据将独立提交；最终 Git 状态与提交在交付记录核对。构建号仍为实际源码版本，不以改版本号冒充升级发布。

## 当前结论

本轮具体缺陷已修复并取得限定范围的原生操作证据，但最终全量仍有 1 项真实失败；本轮稳定化验收亦为 **Blocked**，不是全部功能已可生产使用。

**整体 S3 Gate 仍为 Blocked，S4 Pending，后续 Gate 不自动放行；生产 FROZEN。** 本轮本地稳定化不能替代尚未完成的完整桌面、真实外部服务和跨设备发布验收。没有安装包发布，也没有把正式用户环境切换到开发构建。
