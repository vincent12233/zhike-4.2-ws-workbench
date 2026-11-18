# Dynamic Workspace V4 浏览器证据状态

本任务只使用产品真实 renderer、隔离合成数据、独立 Edge profile。未接触生产 SQLite、真实 WS、AI Key、原生聊天 Core。生产 FROZEN；S3 Blocked。

## 已准备

- `scripts/delivery/dynamic-v4-capture.cjs` 是单独显式执行命令，不进入 `*.test.cjs` 全量发现。
- 35 路由 × 双主题 70 场景，15 个实际弹窗 × 双主题 30 场景，4 个空态 × 双主题 8 场景，5 个 compact 小窗口 × 双主题 10 场景，GPT 未配置 2 场景、WS 小窗口 2 场景，共 122。
- 已通过 `node --check`、`--prepare-only`（122）；准备专用临时目录已删除。
- 使用当前 S1 实际渲染夹具及原 `runIsolatedEdge`。没有改它的 30 秒时限、进程校验、退出策略或断言。
- 共享样式按 index 的真实顺序读入；后续版本冻结本次 CSS 字节并记录输入 SHA-256，避免运行中并发编辑导致同批图不一致。
- `.tools/dynamic-v4/coverage-draft.json/md` 定位 23 主页面、12 WS 页面、15 组件组、25 弹窗/抽屉函数及实际常量标题调用。

## 实际执行

1. `smoke-browser`：首页通过；GPT 首次因新 harness 在 `#result` 先发布对象、后转数组而失败。已改新 harness 为一次性发布数组，原 helper 不变，原失败证据保留。
2. `smoke-browser-v2`：首页、GPT、WS 前台聊天 **3/3 Browser capture Passed**；三张 PNG 已实际查看。GPT 图片资源基址缺失在新 harness 中修正，不是产品修改。
3. `actual-browser/pages`：首页、快速录入 **2/2 已完成场景 Passed**；第 3 个场景 `main-operations-atelier-dawn` 已产生完整 renderer JSON 与 364254 字节 PNG，但 Edge **process-exit 超时 Failed**，不能把截图存在当整项 Passed。
4. 全部 122 尚未执行完；上述仅为已执行证据，不宣称 35 页整体通过，也不宣称 Native 已验收。

## 第三场景退出失败原证据

- Invocation：`1794933464472-d7e0af4e-af1e-48cb-ba31-43e476f1f5c0`。
- 结果记录、截图、生命周期记录均在 `actual-browser/pages/`。
- 9.49 秒进程身份确认；23.57 秒真实 renderer 结果确认；24.58 秒 Browser.close 已确认；30 秒等待进程退出失败。
- 原 helper 记录其既有失败处理 requested owned-handle termination；本轮没有修改该行为，也没有另行强杀任何进程。
- 只读复查 17 个已观察 PID：16 个已不存在；PID 6896 当前名 `SoftLandingTask`，StartTime 不可读取，故严格记录 `IdentityUnavailable`，不能断言为已释放或关联身份仍活着。
- `post-failure-identities.json` 是复查证据；不读取无关浏览器的命令行或登录态。
- 遵照根代理要求，发现 `cleanupSafe=false` 后停止额外 Edge 捕获，不反复重试同一场景，不延长超时。

## 保留资源

`C:\Users\酷酷\AppData\Local\Temp\zhike-s1-main-style-JCgVB2`

这是本轮 fixture 和浏览器 profile，来源已知，但进程身份未完全核实，未自动删除。不能把临时目录尚在使用或不明状态降为已清理。

## 当前交付边界与建议

- 普通浏览器截图不证明 WinUI 原生窗口、真实 WebView2 Core 生命周期或平台能力。
- 原有 `s1-main-visual.test.cjs` 仅三处旧冰蓝/卡片颜色期望按新 V4 规范更新为工作区 `rgb(245, 247, 250)`、卡片 `rgb(255,255,255)`；没有删除对比度、尺寸、overflow 或安全断言。
- 原生启动 InfoBar、HostBorder 和原生状态字体仍来自 XAML 固定浅色资源；只作为待原生视觉复查的边界，不新增原生主题重构。
- 原 main fixture 没有装载所有 index 后追加的增强脚本。基础实际 renderer 证据和额外增强组件源码审计要分开，不能把前者冒充所有低频交互已验收。
- 下一步先由根代理统一完成串行回归及必要原生验收；仍可用本 harness 按 `ZHIKE_V4_CASE_FILTER` 继续未执行场景，输出不同 `ZHIKE_V4_EVIDENCE` 目录，保留原失败。
- 本任务未提交 Git，代码由根代理统一审查与提交。
