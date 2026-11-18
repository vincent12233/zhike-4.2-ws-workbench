# V4.1 第三轮原生复验记录

**本轮只覆盖宽窗首页、动效选项及关闭。S3 仍为 Blocked，生产入口保持 FROZEN。** 隔离 PID `15168` 于 2026-11-18 06:48:12.8881614 UTC 启动，复用第二轮隔离数据根与合成样本。启动时前端为 `9f175d8`。本轮只替换隔离资源中的 `home-6.css`，随后用 Ctrl+R 载入 `1dbab88` 的样式。隔离文件实测 SHA-256 为 `ed7278c318f49b3b794d4b5ca6c76e4656efaae5e94454f9bf975c7f6b69a662`。 [运行上下文](evidence/v41-completion-native-r3/run-context.json)

|原生操作|实际观察|
|---|---|
|宽窗首页|1902×1134 的深色画面中，六张 KPI 数值右侧均无纵向滚动箭头，本周入金 `¥1,250` 完整显示在一行。 [宽窗首页](evidence/v41-completion-native-r3/captures/r3-04-kpi-no-vertical-scroll.jpg)|
|系统设置关闭动效|在真实系统设置的动效下拉框使用 End、Return，选项显示「关闭动效」。同一会话随后能进入统计分析。持久化、重启后状态及全组件动画均未测量。 [选项](evidence/v41-completion-native-r3/captures/r3-06-motion-off-selected.jpg) · [统计分析](evidence/v41-completion-native-r3/captures/r3-07-motion-off-statistics.jpg)|
|窄窗|尝试调整窗口后，源 `r3-02`、`r3-03`、`r3-05` 的截图仍均为 1902 像素宽。这三张未列为窄窗证据。窄窗金额和超长金额交互仍待原生复验。 [尺寸核对](evidence/v41-completion-native-r3/run-context.json)|

## 正常关闭

07:17:11.1489471 UTC 采集一份关闭前的进程树身份样本，共 9 个 PID 和启动时间。通过窗口关闭按钮正常退出后，`15168` 在 07:18:27.3691642 至 07:18:27.6510076 UTC 依次记录应用停止、Sidecar 停止与宿主卸载。07:19:10.3984214 UTC 的只读复核确认这 9 个已观察身份均已退出，仍存活及无法核验均为 0，检查没有终止进程。结论仅限第三轮的采样身份。一次关闭前采样不提供持续资源或性能结论。 [身份样本](evidence/v41-completion-native-r3/completion-r3-close-identities.jsonl) · [退出事件](evidence/v41-completion-native-r3/native-exit-events.jsonl) · [只读关闭核验](evidence/v41-completion-native-r3/native-r3-closed-check.json)

三张截图经逐张目视检查，显示的是隔离合成场景。源 `.png` 实际为 JPEG/JFIF，归档为 `.jpg` 且原始字节不变。结构化证据仅包含已检查的运行与关闭字段。归档不含连接文件、数据库、WebView 配置、凭据、业务明细或辅助文本转储。 [敏感检查](evidence/v41-completion-native-r3/sensitive-scan.json) · [源与归档 SHA-256](evidence/v41-completion-native-r3/manifest-sha256.json)
