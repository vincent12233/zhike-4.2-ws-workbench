# 阶段 5 UI 验收

日期：2026-11-16（Asia/Calcutta）。基线：ad7749f；实现提交：7667837；分支：fix/zhike-61-p0-infrastructure。

环境：Windows 11 专业版 10.0.26300 x64，Node 24.22.1，仓库 .tools/dotnet10。报告随独立文档提交保存，文档最终提交号由 git log -1 给出。生产入口：FROZEN。

## 页面矩阵

| 页面 | 已接入能力 | 控制器/渲染 | 原生桌面 |
| --- | --- | --- | --- |
| 概览 | 现有聊天与连接状态、导航折叠 | Passed | NotTested |
| 账号 | 已有账号列表、刷新、搜索、状态、分页 | Passed | NotTested |
| 群组 | 已加载群目录、刷新、搜索、状态、分页 | Passed | NotTested |
| 成员 | 已加载成员事件、刷新、搜索、状态、分页 | Passed | NotTested |
| 采集 | 采集摘要与本地会话状态，仅读取 | Passed | NotTested |
| AI | 账号限定任务、详情/证据/审计、隔离取消/重试 | Passed | NotTested |
| CRM | 来源、字段差异、审核、结果，隔离批准/拒绝 | Passed | NotTested |
| 任务 | 已有跟进任务与状态、搜索、分页 | Passed | NotTested |
| 日志 | 已有诊断记录、搜索/状态/分页；AI 详情展示任务审计 | Passed | NotTested |
| 设置 | 现有设置与可见辅助抽屉，禁用状态 | Passed | NotTested |

搜索/分页只针对明确标记的“已加载范围”，不是服务端无限数据完整检索。生产 flags 关闭时 API 返回未启用，页面显示 FROZEN；无固定客户或假任务。新开关不会因页面导航开启。

## 命令和证据

- node scripts/stage5/ws-workspace-pages.test.cjs：十个真实渲染函数在 VM 中运行；验证账号范围、转义、分页、群组/账号/任务搜索、筛选与滚动恢复。
- node scripts/stage5/ui-automation-contract.test.cjs：真实刷新控制器运行，验证重复刷新、账号切换、旧响应、错误与 busy 恢复。
- node scripts/stage5/ai-review-runtime.test.cjs：运行实际审核模块，验证每次读写的 accountId、同宿主不重复刷新、候选过滤、批准和任务取消请求。
- 原 WS UI、初始化、导航、布局、滚动回归在全量中重跑。

上述 VM 使用明确的隔离桩数据，仅验证交互逻辑；没有把它列为 Windows UI Automation。实际 API/数据库更新由独立业务联调验证。

## 未执行与 Gate

原生窗口的鼠标/键盘、DPI、多屏、深浅主题、调整尺寸、可访问性树与 WebView 不闪动尚未实际运行。现有桌面启动路径和 WS profile 未提供完整安全隔离启动入口，不能在本阶段 FROZEN 约束下直接启动已登录工作区。**完整 UI 验收：Blocked。**
