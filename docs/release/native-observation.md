# 产品 WinUI 隔离实操与资源观测

2026-11-19，版本 6.1，源码 `054da7e`，构建参数 `Stage51IsolatedUi=true`。本机 Windows 的窗口 DPI 为 120（125%）。验收使用本机隔离账户和合成客户。隔离侧车的诊断显示 Worker、真实 WhatsApp 访问和付费 AI 均未启用。截图中的两条客户资料和隔离账号来自仓库夹具。[活动日志摘要](evidence/renderer-controller-2026-11-19/native/activity.json) · [夹具种子](../../scripts/stage51/seed-native.cjs)

## 实操观察

| 项目 | 实际观察 |
| --- | --- |
| 主题与主侧栏 | 在客户中心从晨光蓝紫切到 Horizon 夜色，返回知客工作台后确认深色客户中心及主侧栏恢复，再切回晨光蓝紫。日志记录了三段主题，并确认退出工作区窗口布局成功。[夜色预览](evidence/renderer-controller-2026-11-19/native/01-theme-preview-dark.jpg) · [恢复后的主侧栏](evidence/renderer-controller-2026-11-19/native/07-customers-returned-dark.jpg) · [切回浅色](evidence/renderer-controller-2026-11-19/native/08-customers-light.jpg) |
| 跨账号切换 | 通过桌面工具逐步执行原生输入，完成 10 次跨账号切换，其中 1 次使用前台聊天下拉框的键盘操作，9 次使用账号管理列表。原生日志共 12 次选择，包含首次选择和 1 次同账号重复选择。两账号分别保留各自的 Core 和代次，共 2 次新建、10 次复用、0 次重载。[前台聊天选中合成账号 B](evidence/renderer-controller-2026-11-19/native/02-ws-account-b-dropdown.jpg) · [账号管理](evidence/renderer-controller-2026-11-19/native/03-ws-account-list.jpg) |
| 工作区与导航 | 工作台首页、前台聊天、账号管理共记录 8 条页面进入或离开事件。创建 1 个主界面 Core 和 2 个账号可见 Core。3 次记录到的导航均成功，分别是主界面本地页面和两次合成前台文档。两个账号的导航重试合计为 0。[活动日志摘要](evidence/renderer-controller-2026-11-19/native/activity.json) |
| CRM 展开和滚动 | 对 CRM 侧栏执行了一次物理滚轮输入。截图诊断显示侧栏的 `scrollTop` 从 8 在动画帧更新到 426 CSS px。收起 CRM 后，原生日志中的前台浏览容器宽度由约 861.2 增至 1189.2。[展开](evidence/renderer-controller-2026-11-19/native/04-crm-expanded.jpg) · [独立滚动](evidence/renderer-controller-2026-11-19/native/05-crm-inner-scroll.jpg) · [收起后扩宽](evidence/renderer-controller-2026-11-19/native/06-crm-collapsed.jpg) |

首次隔离启动记录了两条 `sidecar-created`，第一条至 `sidecar-ready` 相隔 42.432 秒。主界面随后于 03:54:32.879 UTC 完成本地导航。首次启动缓慢的原因尚未查明。124 条原生事件中未发现 `unhandled`、`error` 或 `failed` 类诊断事件。[活动日志摘要](evidence/renderer-controller-2026-11-19/native/activity.json)

## 资源与关闭

观察器从 03:55:40.331 至 04:11:17.969 UTC 记录了 91 条样本，跨度约 15 分 38 秒。采样开始于主界面已就绪后，覆盖第一个账号 Core 的建立，结束时应用仍在运行。第二个账号 Core 于 04:11:38 UTC 建立，晚于该采样窗口。[资源样本](evidence/renderer-controller-2026-11-19/native/resource-samples.jsonl) · [资源摘要](evidence/renderer-controller-2026-11-19/native/resource-summary.json)

| 采样点 | 总进程 / WebView 进程 | 工作集（MiB） | 私有内存（MiB） | 线程 | 句柄 |
| --- | ---: | ---: | ---: | ---: | ---: |
| 首样本 | 9 / 6 | 833.0 | 466.7 | 219 | 5702 |
| 第一个账号 Core 建立前的末样本 | 9 / 6 | 832.1 | 447.3 | 215 | 5915 |
| 第一个账号 Core 建立后的首样本 | 15 / 12 | 1230.2 | 672.2 | 364 | 9040 |
| 末样本 | 15 / 12 | 1174.5 | 617.1 | 342 | 9111 |
| 各指标采样峰值 | 15 / 12 | 1234.7 | 672.2 | 364 | 9201 |

这些值按隔离进程树汇总。91 条样本中的累计观测 CPU 增量为 168.25 进程秒，采样没有身份或计数不可读的记录。采样窗口与自动化全量回归重叠，无法排除资源竞争。本轮仅作观察，未设性能阈值或得出长期稳定性结论。两个账号都打开后，在 04:13:35 UTC 另行取得一次只读进程树快照，当时有 21 个进程，其中 18 个为 WebView2 子进程。[资源摘要](evidence/renderer-controller-2026-11-19/native/resource-summary.json) · [关闭回查](evidence/renderer-controller-2026-11-19/native/shutdown.json)

通过窗口关闭按钮正常关闭后，04:27:14.085 UTC 记录应用停止，约 0.212 秒后侧车报告已停止，随后记录宿主卸载。首次回查于 04:27:36.836 UTC 完成。按 PID 和进程创建时间检查了采样与后续快照合计 21 个进程身份，全部已释放，无未验证身份，也无同一隔离可执行文件的进程残留。归档时再次回查得出相同结果，未使用进程终止命令。没有记录此次产品进程的 OS 退出码。[关闭回查](evidence/renderer-controller-2026-11-19/native/shutdown.json)

## 验收范围

125% 场景的部分截图文字存在缺边。截图支持界面状态、布局开合与主题切换的复核，文字排版和多 DPI 仍待验收。本轮尚未验收关闭动效、两张新增图表和大列表滚动。生产入口继续处于 FROZEN，整套自动回归及 S3 的状态以主报告为准。[Controller 验收报告](renderer-controller-acceptance.md)

附件保留 8 张受控合成截图、经过字段白名单投影的日志摘要、资源样本和关闭回查。清单记录源文件与归档文件的 SHA-256。归档中不含原始捕获元数据、私密连接文件、登录 profile 或数据库。[证据清单](evidence/renderer-controller-2026-11-19/native/manifest.json)
