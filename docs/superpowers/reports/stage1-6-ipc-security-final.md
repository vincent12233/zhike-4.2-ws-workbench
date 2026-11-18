# 阶段 1.6 IPC 安全最终复核

## 状态

**NotTested**（同 SID 真实宿主集成 `Passed`；跨 SID ACL 实测 `NotTested`，所以 IPC 总体不能标记 `Passed`。）

## 本轮复核的实际实现

- `desktop/src/Zhike.Desktop/Services/WorkerIpcProtocol.cs`：版本化 JSON 行协议、1 MiB 帧上限、schema/session/request/trace ID、HMAC-SHA256 proof 和错误分类。
- `desktop/src/Zhike.Desktop/Services/WorkerSupervisor.cs`：真实 WinUI 宿主侧 Worker 生命周期、当前 SID ACL、对端 SID 校验、随机 token、token 轮换、超时、取消、崩溃、重启和重连。
- `910b550`：请求超时或调用方取消后，对取消响应做有界排空，避免旧响应串到下一个 request ID。
- `81287a0`：把 `callerCancelled` 纳入隔离集成聚合门禁。
- `scripts/stage1/WorkerSupervisorRuntime/`：复用上述真实 Supervisor/协议源码的隔离 child Worker。

## 实测命令与结果

```text
.tools\dotnet10\dotnet.exe run --project scripts/stage1/WorkerSupervisorRuntime/WorkerSupervisorRuntime.csproj -c Release --no-restore --nologo
```

```json
{
  "ok": true,
  "status": "NotTested",
  "integrationStatus": "Passed",
  "acl": "current SID only",
  "anonymous": false,
  "wrongTokenRejected": true,
  "tokenRotationRejected": true,
  "timeoutCancelled": true,
  "callerCancelled": true,
  "invalidFrameRejected": true,
  "crashRecovered": true,
  "reconnect": true,
  "differentWindowsUser": "NotTested",
  "productionWorkerStarted": false,
  "productionDatabaseOpened": false,
  "tempRootClean": true
}
```

同 SID 实测覆盖：授权握手、错误 token、token 轮换后旧 pipe 失效、超时取消、主动取消、非法帧、Worker 崩溃、Supervisor 重启和重连。`status=NotTested` 是有意保留的跨 SID 门禁，不是同 SID 测试失败。

## 未完成的安全证据

没有第二用户凭据，故未执行：

1. B 进程访问 A 管道的操作系统 ACL 拒绝。
2. B 在应用握手阶段的 SID/token 拒绝。
3. 跨登录会话下的低权限边界测试。

不得把同 SID 子进程、修改用户名字符串或 mock ACL 视为上述证据。正式 IPC/Worker 生产入口保持 `FROZEN`。

## 异常恢复

同 SID 隔离测试证明 Worker 主动退出后 WinUI Supervisor 可停止旧连接、重新启动并建立新 session/token；旧连接不能继续使用。测试未连接真实 WS，也未触及生产数据库。

## 回滚与数据保护

回滚点为 `81287a0` 之前的 IPC 集成提交；本轮没有生产 schema、客户、群组、消息或 AI 数据变更。所有测试使用临时进程和临时目录，结束后 `tempRootClean=true`。

## 提交与工作区

- 测试代码基线：`81287a0`；`910b550` 与 `81287a0` 的 IPC 修复均已纳入。
- `git diff --check`：`exit 0`；交付提交后工作区为 clean。
