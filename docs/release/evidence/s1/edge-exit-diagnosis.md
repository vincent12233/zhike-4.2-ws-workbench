# S1 Edge 退出超时：只读诊断与最小 harness 方案

基线：当前 S1 工作区（HEAD 377632e）。初次诊断只读取源码、日志和既有设施。随后Root明确批准仅修改测试基础设施并串行运行真实Edge；本报告第6节记录实际结果。未启动正式应用/服务或访问业务数据库，未修改产品。生产入口FROZEN。

## 1. 可证实事实与不能宣称的结论

| 证据 | 可证实内容 |
|---|---|
| .tools/delivery-s1-full.log:1599–1639 | Stage5.1 layout 失败于 spawnSync Edge ETIMEDOUT；断言位置 workspace-layout.test.cjs:72:10；并非具体布局数值断言失败 |
| .tools/delivery-s1-full-final.log:983–1017 | 同一失败路径第二次出现；本轮全量汇总1297行为275/277，仍不能标全量通过 |
| 两段日志的 stdout tail | 均含非空 result 数组的闭合、最后3个视口片段及整页HTML结束；未见布局断言之后打印的六条验收JSON |
| workspace-layout.test.cjs:68–75 | 页面写入结果后，测试先等待整个 spawnSync 调用结束，再先检查退出码0；解析JSON与所有布局断言在该检查之后，因此两个失败运行没有执行后续布局断言 |
| matrix 页面源码（同文件:67） | 仅在6个 iframe结果到齐后，才写入父页 #result。日志尾部出现已填充数组，与“页面计算已完成、退出等待未满足”一致 |

重要限制：

1. 旧 harness 只把 stdout 最后12000字符放入 AssertionError。两个全量日志的这段尾部都缺少 result 的起始 pre 标签，不能从现有日志直接 JSON.parse 整个六项payload，也不能据此重放全部断言。
2. source中的结果门槛与已填充数组尾部提供了较强的“页面测量完成”证据；但必须区分“计算完成”“布局断言完成”“浏览器资源正常退出”。后两项并未由失败运行证明。
3. ETIMEDOUT 证明 Node 的同步调用未在30秒内完成。现有证据不足以区分：浏览器主进程还活着；浏览器正在关闭；或主进程已退出但某个继承 stdout/stderr 的后代仍使管道未关闭。
4. Chromium fallback_task_provider.cc:126 消息确实出现；它不是已证明的根因。没有进程树、exit/close时刻或CDP生命周期证据，不能把原因归为CPU争用、WMI、杀毒、导航循环或某个Edge版本缺陷。
5. 以上两次失败继续是 Failed，不能因 stdout包含结果而降为warning/Passed。

本轮只读提取可复现：读取每段[RUN]到[FAIL]，检查 timeout、stdout tail和数组结束标记。每段均有约12813字节 tail；只保留3个完整 viewport片段，含整页闭合；无验收成功输出。

## 2. 当前 runner 的具体问题

### 2.1 旧 layout harness

scripts/stage51/workspace-layout.test.cjs:71：

- spawnSync；
- --headless=new / --disable-gpu / --no-first-run / --disable-background-networking；
- 独立临时 --user-data-dir；
- --window-size=1280,720；
- --virtual-time-budget=3000；
- --dump-dom；
- timeout:30000，maxBuffer:4MiB。

脚本没有显式结果完成握手、CDP、Browser.close、独立的child exit/close观测，也没有记录启动时间/PID身份。真正的退出控制交给CLI内部；即使DOM已打印，Node仍必须等到同步调用完成后才知道结果。

finally 已有受控清理边界：临时根必须位于Temp且以zhike-stage51-layout-开头；fs.rmSync不使用force，最多20次100ms重试。保留这条安全边界；不能用删除profile或杀全局Edge来绕过退出失败。

### 2.2 上层 runner

scripts/run-tests.cjs:16–34 使用串行 spawnSync 调用测试脚本，默认外层120秒；Stage5.1调用89行也显式120秒。它仅记录脚本最终exit/error，没有浏览器生命周期信息。

因此当前30秒浏览器失败不是外层120秒触发；增加外层timeout不能解决缺失的退出控制。不要改变这两个时间上限来掩盖问题。

### 2.3 可复用设施的实际查找结果

搜索范围：scripts、tests、desktop/tests、docs/superpowers/reports，以及.tools中测试/诊断源码；排除vendor、node_modules、resources复制树、bin/obj、dotnet10运行库，避免把第三方压缩数据误认为项目实现。

- 未找到项目自己的CDP连接器、DevToolsActivePort读取器或Browser.close实现。
- scripts/delivery/s1-ws-visual.test.cjs:82 同样是spawnSync + dump-dom（45秒）；它不能作为已验证的显式退出方案复用。
- scripts/delivery/s1-main-visual.test.cjs:54起已有有用的诊断外壳：每次启动独立profile，记录 invocation/PID/elapsed/status/signal/error/args/stdoutBytes/stderrBytes/completeResultMarkup；失败保存完整stdout HTML、stderr和metadata。应复用这些证据字段，而不是重复设计另一套记录格式。
- 现有 .tools/delivery-s1-main-visual/browser-invocations.jsonl 可见一条status0/7415ms/completeResultMarkup=true；这是另一条测试的成功运行，不能证明本次旧layout已经退出。
- scripts/stage51/resource-check-cleanup.ps1:17起以 PID+startedUtc 验证进程身份，且不可验证时Blocked、只读而不杀进程。这一安全原则可复用。
- 上述资源脚本的路径/marker严格限定 zhike-stage51-native-32hex；不能直接把Edge的新prefix塞入该脚本或绕过marker。需在测试helper中独立保留同等所有权约束。
- resources/app/package.json明确node>=24（实际日志Node24.22.1）。可使用Node现有异步child_process/fetch/WebSocket能力，不应新增第三方浏览器框架或npm依赖。

## 3. 推荐的最小改造（原批准前方案；第6节为批准后的实测）

仅改测试harness，不改产品、不放宽布局断言、不开生产WebView调试。

新增一个小型 tests/helpers/isolated-edge.cjs（名称可由Root统一），先只让旧workspace-layout测试调用。主/WS新增视觉测试未来可以复用，但本轮不顺带重写全部视觉测试。

### 3.1 单一明确生命周期

1. 保留临时测试根、唯一profile、既有Edge候选路径和隔离参数。
2. 用异步 spawn 代替spawnSync；不再依赖 --dump-dom 自动关闭浏览器。
3. 仅对测试浏览器加动态 --remote-debugging-port=0、--remote-debugging-address=127.0.0.1；读取本profile创建的DevToolsActivePort，校验端口/地址/路径归属。
4. 通过本次浏览器的CDP browser endpoint建连接，创建/附着独立页面，导航原matrix文件。页面HTML、6个iframe、生产CSS顺序、生产render/mount、所有几何/字体/滚动/Core-anchor断言保持原样。
5. 等待明确的 #result 非空完成标志，通过Runtime.evaluate返回JSON；验证六项、唯一视口清单与cases完全一致。页内异常/目标销毁/协议错误立即失败，不做整个测试自动重试。
6. 原有全部布局断言照常执行，错误必须传出。
7. 无论断言成功或失败，都在finally向**本次拥有的browser CDP endpoint**请求 Browser.close；记录请求、可能的响应及连接关闭。浏览器可能先关闭连接再回命令，不能把WS断开直接当作退出成功。
8. 仍必须取得被启动子进程的exit code 0、stdio close，并确认已观察到且身份吻合的测试进程无残留，之后才能正常清理profile并标Passed。
9. 成功条件同时包括结果完整、全部断言通过、显式关闭、正常退出和安全清理；任何一项缺失仍Failed/Blocked。

CDP流程本身尚未在此项目实测，不能在设计报告里标Passed。Root批准后必须用原fixture真实运行验证。

### 3.2 不增加时间上限

- 浏览器生命周期仍使用原有总deadline 30000ms，自spawn开始计算，启动/连接/导航/结果/关闭共享剩余预算。
- 不给每个阶段各新增30秒，不延长退出等候，不自动启动第二个浏览器。
- 文件出现/导航完成/结果就绪等待是一次执行内的有界readiness等待，不是失败重跑。
- 到达deadline必须记录当前phase并失败；即使已有完整payload也不能“补记Passed”。
- 外层run-tests的120秒保持不变。

### 3.3 退出证据必须拆开

最小metadata：

- invocationId、profile规范绝对路径；
- spawned PID及创建时刻；
- launchedAt、CDPReadyAt、navigationStartedAt、resultReadyAt；
- expectedCases/receivedCases、payloadBytes/hash、assertionsCompleted；
- closeRequestedAt、closeResponse/peerDisconnectAt；
- childExitAt/code/signal；
- childCloseAt、stdoutClosed/stderrClosed；
- timeoutPhase；
- 退出后已验证的PID+创建时刻清单与remaining/unverified；
- 最终临时根清理结果。

这样下一次若再超时，才能实证：

- resultReady但childExit未出现：主进程未确认退出；
- childExit已出现而close未出现：流/后代句柄问题有直接证据；
- CDP close已请求但没有exit：显式关闭过程失败；
- resultReady未出现：计算/导航阶段问题，不能再称“只卡退出”。

## 4. 安全和失败处理

- 只绑定loopback动态端口，不使用固定端口，不设置宽泛 --remote-allow-origins=*。
- 只操作本次测试生成的profile和持有的CDP目标；不枚举或关闭用户日常Edge/Chrome、正式知客或真实WhatsApp。
- 不通过现有生产WebView2实例取调试权限，不访问Cookie、Token、Key或生产SQLite。
- 不能使用taskkill /IM msedge.exe、全局进程名匹配或不核创建时刻的PID强杀。
- 异常清理如必须终止本次子进程，只能在先记录失败后对已确认拥有的进程身份执行；仍不能将强制终止算正常退出。
- 进程残留或归属不明确时保留目录并报告；不能边占用边递归删除profile。
- 原始stdout/stderr及CDP诊断只含合成fixture；失败时完整保存到明确的.tools验收证据目录，并保留SHA-256清单。

## 5. 最小验收计划（也需Root批准）

1. 不启动浏览器的helper单元测试：超时阶段分类、协议错误、非法endpoint、缺少结果、close与exit分别失败、取消、归属检查；这些只验证harness，不能冒充真实布局验收。
2. 单次真实Edge跑原六视口，要求结果、原断言、Browser.close、exit0/close/无残留全部有证据。
3. 再由Root串行执行视觉与全量回归，禁止两个代理同时起浏览器。
4. 第一次成功不是根因确认；若保留CLI退出失败的历史记录，应明确“harness不再依赖CLI自动退出，新的显式生命周期已验证”，不写“Chromium bug已修复”。
5. 不降低任何布局面积/控件目标/滚动/Core-anchor断言，也不复用先前超时日志作为通过证据。

## 6. Root批准后的实施和实际验证

实际文件：

- tests/helpers/isolated-edge-runner.cjs：唯一异步进程/CDP测试helper，动态127.0.0.1端口/新合成profile；PID+Windows StartTime；显式完整结果、Browser.close、process-exit、stdout-close、stderr-close、child-close分别记录；原30000ms总deadline且不自动重试。
- scripts/stage51/workspace-layout.test.cjs：只改浏览器harness入口/有界安全清理，原六视口全部布局断言保留。
- tests/isolated-edge-runner-lifecycle.test.cjs：7个真实隔离Node子进程场景，不启动Edge，也不以这些用例代替浏览器验收。

实际运行：

1. node tests/isolated-edge-runner-lifecycle.test.cjs：最终7/7 Passed。覆盖正常close、无效结果必须失败、结果超时、关闭超时、非零close、提前退出和真实流/进程事件顺序。预期失败场景的metadata故意为Failed，表示helper没有将其误判通过。
2. 初写额外测试假设“继承stdout或stdout.end会产生至少200ms的可观测流关闭延迟”，Windows实验未支持该假设；相关失败metadata保留。经Root明确要求，改为检查结果→close请求→真实exit及所有流关闭状态顺序，不使用固定调度耗时阈值。三处本代理创建的失败实验目录经归属、为空、进程已退出核验后已安全删除（非递归、无force）；日志保留在.tools。
3. 真实Edge旧layout首次：Exit0/Passed，PID9124，生命周期5562ms；完整六payload SHA-256 f0c17d8ed801a1b08088b1dc8e6b529b63d395482ae3a85f2af655ee3dc1caf9；原断言全部通过。日志 .tools/delivery-s1-edge-layout-cdp.log。
4. 最终helper明确等待stdout-close、stderr-close及child-close三者后，再跑同一真实Edge旧layout：Exit0/Passed，PID21788，总26339ms；原六视口全部断言通过，同一payload hash；14个PID+StartTime已观察身份全部释放、remaining0、cleanupSafe=true、forceTerminated=false。测试根路径已不存在。日志 .tools/delivery-s1-edge-layout-cdp-final.log。
5. 现有新WS专项串行运行：node scripts/delivery/s1-ws-visual.test.cjs，Exit0/Passed，84页面/6浅色视口+夜色/20次可见状态更新检查通过；日志 .tools/delivery-s1-ws-visual-after-cdp.log。该新测试本轮没有擅自迁移到helper。
6. 三个文件语法及范围内git diff --check通过；没有启动额外浏览器或并行构建，已通知Root可执行全量回归。

最终原始meta：.tools/delivery-s1-edge-layout/1794875335681-a511204c-ca2d-40e4-b926-18bfcec1c2f2.json；完整payload在同名.result.json。生命周期用例完整meta及预期失败输出在.tools/isolated-edge-runner-lifecycle；最后命令记录在.tools/delivery-s1-edge-lifecycle-final.log。

### 仍需如实保留的退出延迟风险

最终真实Edge meta显示：result-ready=4117ms、Browser.close协议响应=4118ms，而process-exit=25824ms；stdout/stderr/child-close约25832ms。这个运行可实证关闭协议确认后，主进程直到约21.7秒后才退出；不是仅有一条“结果已打印”的猜测。首次运行关闭到exit约1.27秒。具体原因仍未定位，不能宣布Chromium退出延迟本身已经根治。

这两次明确CDP/OS退出验证均在原30秒内通过，但一次已接近上限。Root下一次全量必须重新运行；若再次超限仍必须Failed，不得增大deadline或自动重跑掩盖。旧CLI两次失败和历史全量275/277保留原事实；本代理的目标专项通过不等于全项目Gate自动通过。

当前状态：测试harness已实施，专项Passed；等待Root最终全量/原生验收。生产入口FROZEN。
