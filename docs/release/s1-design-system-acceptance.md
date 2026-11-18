# S1 设计系统与双工作台验收

日期：2026-11-17（Asia/Calcutta）。分支 `upgrade/zhike-61-ab-delivery`。
审计基线 `377632e`；代码提交 `1831d52611b1fe21c2ca27ceaec29b45301490ca`。
**S1 Gate：Passed，范围为设计系统、外壳导航与隔离聊天生命周期；生产入口 FROZEN。** 不是 S2–S9、真实 WS、AI 质量、干净机安装或全部 DPI 验收。

## 实际修改与维护边界

- 直接收敛原 design-system/horizon-atelier/global-6/home-6 四个样式所有者，不增加第五层覆盖文件。四文件合计122165→49804 bytes，`!important` 631→347；这是源码体积指标，不冒充运行性能提升。
- 晨光蓝紫为新默认外观，Horizon 夜色保留。语义颜色、字号、44px操作尺寸、焦点、禁用、状态和表格复用同一设计系统；独立 WS 样式使用这些 token，主业务/GPT/WS 的布局边界保留。
- `workspace-shell.js` 仅负责设备本地外观与上次知客工作区。双工作台按钮点击原导航入口，保留隐藏/禁用约束，不新增路由、窗口或业务写入器。设置页沿原保存服务，失败同时恢复外观、配置和活动记录。
- 外观弹窗复用原 `openModal/closeModal` 和焦点恢复；完整主题卡可点击，窄容器单列。原生复验发现说明挤在一行后补齐了此组件，未以静态图代替可操作界面。
- WS 原几何规则压缩，无按钮删减、Host移动或新增布局补丁。实测 host 上缘224→188、增加44px高度；1920×1080有效视口832→876，1280×720为472→516。CRM收起释放宽度。上述矩阵是 Edge CSS有效视口，**不是 Windows DPI 实测**。
- 滚轮逻辑保留嵌套所有权，补齐Ctrl/Meta、已处理/不可取消事件的早退；输入框原生滚轮和选区保留，弹窗键盘不会选中后台旧owner。
- 新模块和山峦SVG加入真实静态路由并用HTTP验证。治理区域漏迁布局已补回。未改数据库迁移、客户/渠道/VIP规则、Worker/IPC/fencing生产入口、密钥存储或WS采集脚本。

## 真实命令与结果

|命令|本轮结果|
|---|---|
|`node scripts/run-tests.cjs all`，最终日志 `evidence/s1/full-regression.log`|**278/278 Passed**，相比S0的272增加1个模块语法check和5个执行check；未删除历史check|
|`.tools/dotnet10/dotnet.exe build desktop/src/Zhike.Desktop/Zhike.Desktop.csproj -c Release --no-restore -p:Platform=x64 -r win-x64 --nologo -v:minimal`|**0 warnings / 0 errors，20.42秒**|
|同一工程加 `-p:Stage51IsolatedUi=true -p:OutputPath=../../../.tools/stage51-native-v2/`|0/0，23.00秒；后续仅Web资源更新，Native源码未变化|
|`node tests/upgrade-http-smoke.test.cjs resources/app`|新模块与SVG的真实隔离HTTP响应通过|
|新scroll运行时专项|13/13情景；VM执行真实监听器，未冒充原生缩放|
|主界面视觉专项|20个真实renderer×8视口+20夜色+20旧dark设置冲突投影，共200页投影，另真实主题弹窗几何/焦点/禁用/关闭验证通过|
|WS视觉专项|12页×6浅色视口+12夜色，共84投影；20次状态更新Host身份及bounds稳定|
|旧workspace-layout专项|原6视口全部断言保留，显式CDP完成与关闭通过|
|新进程生命周期helper专项|7/7真实受控Node子进程情景；真实Edge另行执行，不以Node情景代替浏览器|
|`git diff --cached --check`|提交前通过；新测试3个EOF空行已移除，无语义变更|

全量包含迁移/024 checksum、AI/CRM、群组/账号隔离、IPC、fencing及旧队列回归；不复用S0结果。

## 原生 WinUI 验收

Windows 11 Pro 10.0.26300 x64，Release隔离编译，WebView2 157.0.4341.46。隔离根：
`C:\Users\酷酷\AppData\Local\Temp\zhike-stage51-native-829339dcdb4246e6a00da5978d6ec8e4`。
仅合成2客户、2账号、4群、8任务、6候选；WS限about:blank，外部WS/付费AI网络被隔离构建阻断。未复制真实登录态、读取真实密钥或操作生产SQLite。

|操作|实际结果与证据|
|---|---|
|顶部按钮从客户页进入WS|原生窗口自动最大化；知客侧栏隐藏，WS独立侧栏显示|
|前台聊天打开、CRM展开/收起|真实ws-visible Core，about:blank；bounds随详情面板变化，未覆盖聊天|
|聊天→群组→聊天|同一ws-visible Core；没有新增导航，账号default未改变|
|顶部返回知客|恢复客户页、原知客导航及进入前窗口状态；不是打开第二主窗口|
|晨光→夜色、关闭、显式Ctrl+R重载、重新打开外观|本机外观保留；显式重载已单独记录，不能算页面切换重启|
|整卡选择晨光、Escape|主题正确更新，弹窗关闭后外观按钮有可见焦点环|
|主导航展开、滚动侧栏、滚动内容|侧栏和主内容分别移动，另一区域保持；有真实截图|
|正常关闭|首次观察仍有2个WebView子进程，稍后只读复核15/15观察身份均退出，未强杀。首轮验收进程亦15/15释放|

原生截图：

- `evidence/s1/native-appearance-dawn.png`
- `evidence/s1/native-chat-night.png`
- `evidence/s1/native-chat-crm-expanded.png`
- `evidence/s1/native-return-customers-night.png`
- `evidence/s1/native-independent-scroll.png`

脱敏生命周期：`evidence/s1/native-events-sanitized.jsonl`。原生按本轮关键交互验收；全部35个业务案例、12页完整业务操作及多DPI仍由S3–S7验收，未在此冒称完成。

## 性能观察与失败记录

- 本轮7次资源采样，33.085秒；已含shell及空白聊天Core的进程树工作集1187.49→1189.07MiB，Private605.86→607.45MiB，线程327→327，WebView子进程12→12，15个观察身份，CPU累计增量5.0625秒。该短观察不与S0仅首页6个WebView子进程直接比较，不据此判泄漏或宣称不卡顿；正式预算与压力测量在S7。
- 首轮全量266/277，包含旧视觉字面契约不适配及真实资源/治理布局缺漏、DPAPI与sidecar关闭失败、Edge退出超时；次轮275/277，剩Edge退出与主题卡测试误把CSSOM `repeat()`空格数当列数。两轮失败日志均归档，未隐藏。
- 正确卡片本来是两列：改用严格几何断言，并加错行/第三空轨负控，未降低两列要求。
- DPAPI独立连续20次均11/11；查询服务独立10次正常退出36.14–126.14ms，最终全量亦通过。原始异常尚未复现/根因未证实，仅增强安全错误分类和退出时序诊断，没有改存储超时/产品逻辑。
- 旧Edge `--dump-dom` 已输出完成结果但退出超时。测试层现用唯一异步CDP helper，动态loopback端口、合成独立profile、完整结果握手、`Browser.close`、exit0/流关闭和PID+StartTime释放，**总预算仍30秒，不自动重试**。有一次结果约4.1秒完成、关闭已确认，但约25.8秒才退出；退出延迟根因仍未证实，保留风险，不宣称Chromium问题已修复。

## 数据保护、归档与回滚

归档白名单及SHA-256：`evidence/s1/sha256.json`。文本归档规范化UTF-8/LF及行尾空白，清单同时记录规范化前后hash，原始日志仍留本地；PNG原字节保留。只保存合成截图、脱敏事件、计数及测试日志；排除connection.private.json、profile、数据库、Cookie、Token和任何真实业务数据。临时隔离根仅保留诊断，没有自动删除用户资料；已确认本轮全部应用进程退出。

全部历史迁移及checksum保持，生产flags未变，未启用正式Worker/AI/采集消费者或新旧双写。代码以独立提交保护；回滚在隔离分支按提交revert，外观仅本机偏好，可从界面恢复默认，不需要数据库回滚。

RD02认证profile复制路径仍是Open，整改方案单独待批准，未擅自改可用性。S0其余发布/备份/真实健康状态风险仍按risk-register推进。S8受S0–S7、受信任签名和干净机安装验收约束，**不允许现在打包或宣称生产完整可用**。

下一阶段：S2只读指标与可视化，复用既有统计函数，真实口径标注，不通过新图表查询触发AI提醒写入，不擅自统一未批准的业务计算口径。
