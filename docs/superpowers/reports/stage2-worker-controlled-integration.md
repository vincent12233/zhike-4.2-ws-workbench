# 知客 6.1 阶段 2 Worker 受控集成报告

## 状态

**Passed（受控隔离集成）**

生产入口仍为 **FROZEN**。本阶段没有生产迁移、真实 WS 登录、正式 Worker 启动或新旧队列切换。

## 基线检查

- 开始 HEAD：`118cffb`，工作区干净。
- 阶段 1.7 七份报告全部存在，P0 Gate 为 Passed，生产入口 FROZEN。
- 现有 WinUI 宿主只创建 `WorkerSupervisor(Enabled: false)`；旧 `ws_collection_*` 和 `ai_jobs` 仍由 `resources/app/server.mjs` 负责。
- fencing 原实现继续只在显式隔离模式使用。

## 实际修改

- `desktop/src/Zhike.Desktop/Services/WorkerFeatureFlags.cs`：三个独立旗标、严格解析、缺失/损坏安全关闭和来源/版本审计信息。
- `desktop/src/Zhike.Desktop/Services/WorkerRuntimeController.cs`：单一 Supervisor 生命周期、心跳、超时、崩溃恢复、取消、token 轮换和进程工作集观测。
- `desktop/src/Zhike.Desktop/App.xaml.cs`：加载旗标并建立控制器，但启动时不调用 Worker。
- `resources/app/worker-queue-adapter.cjs`：旧采集/AI 记录到稳定 Worker Job 的只读映射；无数据库写入。
- `resources/app/worker-fencing-gate.cjs`：对已验收 `SqliteFencedWriter` 的显式布尔 gate，关闭时 fail-closed。
- `scripts/stage2/WorkerRuntimeIntegration/`：隔离 .NET 宿主/Worker 测试进程。
- `scripts/stage2/*.test.cjs`：阶段 2 旗标、禁用路径、Worker 生命周期、队列适配和 fencing 测试。
- `scripts/run-tests.cjs`：登记五个阶段 2 检查。

## 生命周期验证

实际命令：

```text
node scripts/stage2/worker-controlled-integration.test.cjs
```

结果：Passed。隔离 Worker 通过正式 `WorkerSupervisor` 建立 Named Pipe；心跳和工作集被记录；短任务超时发送取消；Worker 崩溃后自动恢复；token 轮换后新会话可请求；停止后临时目录清理。输出明确为 `isolatedWorkerStarted=true`、`productionWorkerStarted=false`、`productionDatabaseOpened=false`。

为避免测试宿主在嵌套 `dotnet run` 下继承标准输入导致生命周期悬挂，验证入口使用
`scripts/stage2/worker-runtime-test-helper.cjs`：先构建隔离 apphost，再直接启动
`WorkerRuntimeIntegration.exe`。该路径已在普通 Node 进程和全量测试包装器中验证，测试结束后无残留 Worker 进程。

本阶段还补充了生命周期并发保护：Start/Stop/Restart/Rotate 共享操作门；旧 Worker 的
`Exited` 回调同时校验进程对象和 generation，不能清空新会话。隔离回归覆盖并发令牌轮换
和连续重启风暴，均通过。

IPC 请求在取得请求门后固定当前 reader/writer、session 和 token 快照；轮换或关闭造成的
断开统一归类为连接错误，避免旧连接清理过程中出现空引用。

## 提交

- fencing gate：`c92bd64`
- 阶段 2 受控集成：`04144f4`
- fail-closed 修正：`4f956b7`
- 生命周期并发加固：`14103c7`
- IPC 请求快照加固：`e01e83c`
