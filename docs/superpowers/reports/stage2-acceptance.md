# 知客 6.1 阶段 2 受控集成验收报告

## 最终判断

**Stage 2 Gate：Passed（受控集成范围）**

完成比例：**100%（本阶段授权范围）**。

| 项目 | 状态 | 证据 |
|---|---|---|
| Worker 生命周期边界 | Passed | `worker-controlled-integration.test.cjs` |
| 心跳/资源观测 | Passed | 隔离运行时输出 heartbeat 与 working set |
| 超时/取消 | Passed | 隔离 `slow` 请求和已有 IPC drain 逻辑 |
| 崩溃恢复 | Passed | 隔离 Worker 退出后自动重启 |
| token 轮换 | Passed | 新 session 可用、旧 session 不复用 |
| 旧队列只读适配 | Passed | `worker-queue-adapter.test.cjs`、stage1.5 兼容回归 |
| SQLite fencing gate | Passed | stage2 gate + stage1.5 sidecar fencing |
| 默认关闭与回退 | Passed | 旗标/禁用路径测试 |
| 全量回归 | Passed | 218/218 |
| WinUI x64/win-x64 | Passed | 0 warnings/0 errors |
| 双写风险 | Passed（无） | 未添加生产消费者/写回路径 |

## 尚未完成

- 正式 Worker 尚未获得生产任务消费权限。
- 旧队列到新队列的正式切换、双读对账和生产回填未执行。
- 真实 WhatsApp/AI 账号验收未执行。
- 干净 Windows 设备安装验收不属于本阶段授权范围。

## 生产门禁

即使本阶段 Gate Passed，生产入口仍保持 **FROZEN**。不得自动启动正式 Worker、连接真实 WS、执行生产 SQLite 迁移、开启 AI 自动任务、切换队列或发布安装包。下一阶段必须单独批准。

## 提交与工作区

- `c92bd64`：fencing controlled gate。
- `04144f4`：Worker runtime、flags、queue adapter、隔离集成测试。
- `4f956b7`：malformed consumer flags fail-closed 修正。
- `14103c7`：Worker 生命周期并发门、旧进程退出 fencing、并发回归与阶段报告。
- `e01e83c`：IPC 请求连接快照与断开错误归类。
- 报告提交后应保持工作区干净；最终审计以 `git status --short` 和 `git diff --check` 为准。
