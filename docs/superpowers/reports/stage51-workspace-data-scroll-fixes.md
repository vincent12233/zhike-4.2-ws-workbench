# Stage 5.1 — 群成员数据绑定与二级工作区滚动修复

范围：真实隔离 WinUI 交互发现的两个缺陷；没有生产数据、真实 WS 或 AI 消费者访问。生产入口保持 `FROZEN`。提交由阶段 5.1 汇总提交记录，本附件不单独提交。

## 1. 群成员页数据绑定

原生验收发现：隔离 sidecar 已通过正式群管理 API 写入测试成员账本，但成员页为 0 行。页面原先仅读取历史进退事件，没有读取 `ws_group_members`。

实际修复：

- `resources/app/server.mjs`：群成员 GET 支持省略 `groupJid`，在当前账号内最多读取 1000 条；指定群组仍保持原有 5000 条上限。关联群名称时同时约束账号与群 JID。未知账号继续 404，不产生写入。
- `resources/app/modules/ws-workbench.js`：成员页读取真实群管理 Service 成员账本，按当前账号隔离，单独展示历史进退事件。切换账号后重新读取，过期响应不能更新新账号。只有明确的 `404/GROUP_MANAGER_DISABLED` 使用旧历史展示，不隐藏未知账号等其他失败。
- 没有修改成员入群判定、CRM 建档、VIP、队列、迁移或功能开关。

自动化证据：`node scripts/stage51/members-binding.test.cjs`。首次运行重现省略群 JID 返回 400，修复后通过；真实临时 sidecar 测试覆盖两账号、各两群、同一成员标识、群过滤、上限、未知账号、空群、客户总数不变。实际 UI controller 覆盖账号作用域、过期响应、禁用回退与错误保留。测试数据明确为隔离测试数据。

## 2. 工作区滚动与导航保持

原生验收发现：二级导航 10 项仅前 7 项可见，鼠标滚轮不能到达任务、日志、设置；Tab 能将这些项滚动到视野，但点击后 shell 重渲染又把导航滚动位置重置为 0。内容页滚轮同样无响应，拖动滚动条可以移动。

实际修复：

- `resources/app/modules/scroll-coordinator.js`：将新增的 `.ws-workspace-nav-list` 与 `.ws-workspace-page-content` 纳入现有独立 `contain` 滚动路由，确保滚轮实际操作对应区域；工作页滚动缓存按账号和页面隔离。没有将聊天 WebView 容器登记为滚动区域。
- `resources/app/modules/ws-workbench.js`：每次 shell render 前保存二级导航的横纵滚动位置，mount 后恢复并按当前窗口尺寸限制范围。离开/返回 WS 时保留同一模块导航状态，不修改知客主导航。
- `resources/app/modules/ws-workbench.css`：取消二级导航隐藏滚动条，保留 6 px 可拖动滚动条。
- `tests/scroll-coordinator-runtime.test.cjs`：执行真实滚轮处理和导航捕获/恢复函数，覆盖内外滚动区域隔离、账号/页面独立位置、重渲染、缩放后限制和离开/返回。修复前断言失败：secondary navigation owner 为 `undefined`；修复后通过。

专项实际执行：

| 命令 | 结果 |
|---|---|
| `node tests/scroll-coordinator-runtime.test.cjs` | Passed |
| `node scripts/stage5/ws-workspace-pages.test.cjs` | Passed |
| `node tests/ws-scroll-stability.test.cjs` | Passed |
| `node tests/ws-scroll-routing-contract.test.cjs` | Passed |

这四个自动化结果不代替最终重建后的原生鼠标交互复验。原生复验结果、截图与 Gate 结论见阶段 5.1 总报告。

随后原生复验发现收起导航后仍空出 158 px：导航本身为 56 px，但父 grid 仍保留 214 px 列。最小修复仅在 `min-width:901px` 下，以直接子导航的 `.is-collapsed` 状态将父列设为 56 px；保留原 `<=900px` 的 flex 响应规则，不修改主侧边栏。

实际渲染验证：`node scripts/stage51/workspace-layout.test.cjs`，使用全新临时 profile 的真实 Edge headless 加载项目原 CSS 并读取 computed layout。修复前断言内容左移为 0 而非 158，修复后 `Passed`：

| 实际 viewport | 展开 | 收起 | 验证 |
|---|---|---|---|
| 1174 px | 列 214/712 px，内容 left=462 | 列 56/870 px，内容 left=304 | 释放完整 158 px；主导航均为 240 px |
| 774 px | flex，内容 left=240/width=534 | flex，内容 left=240/width=534 | 既有小窗口布局保持不变 |

浏览器仅访问本轮临时本地 HTML，没有生产 WebView profile、WS 登录态或外网内容。测试退出后验证绝对临时根属于系统 Temp 且带本轮前缀，再清理该根。此项实际浏览器 CSS 布局验证也不代替整套 WinUI 原生交互验收。

## 3. 专项登记与执行环境

`scripts/run-tests.cjs` 的 `runStage51` 已登记成员真实 API/UI 测试、CRM 审查真实 Service/UI 测试、扩展的既有滚动运行时测试及资源观察器身份验证测试。滚动项是扩展既有回归，不应统计为全新独立测试文件。

`powershell.exe -NoProfile -File scripts/stage51/resource-observer-safety.test.ps1` 首次实测被 Windows PowerShell 执行策略拒绝。未修改策略或使用 bypass。随后使用 PATH 上已存在、策略为 RemoteSigned 的 PowerShell 7：

`pwsh.exe -NoProfile -File scripts/stage51/resource-observer-safety.test.ps1`

结果 `Passed`（真实 PID 识别、创建时间不匹配拒绝、隔离目录标记拒绝）。该测试入口需要开发/验收环境可用的 `pwsh.exe`，属于验收工具前置条件，不是正式应用运行依赖。

## 4. 回滚与边界

回滚上述展示/滚动文件和对应测试即可；没有数据库迁移或数据回填。生产功能开关未启用，未启动正式 Worker，未连接真实 WS，未发生新旧队列双写。所有 sidecar API 测试使用临时隔离根目录，测试负责关闭进程并清理其临时目录。
