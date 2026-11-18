# 阶段 1.5 IPC 真实集成验收

## 状态

**NotTested**（同 SID 真实宿主集成 `Passed`；第二 Windows 用户跨 SID 验证 `NotTested`，因此整体不能标记 Passed。）

## 实际修改

- `desktop/src/Zhike.Desktop/Services/WorkerIpcProtocol.cs`：版本化 JSON 行协议、1 MiB 帧上限、请求/会话/追踪 ID、HMAC-SHA256 proof、协议错误分类。
- `desktop/src/Zhike.Desktop/Services/WorkerSupervisor.cs`：WinUI 宿主侧 Worker 生命周期、当前 SID ACL Named Pipe、SID 对等端校验、随机 token、轮换、超时、取消、崩溃、重启和重连；`910b550` 增加取消响应的有界排空，避免旧响应串到下一请求。
- `desktop/src/Zhike.Desktop/App.xaml.cs`：将 Supervisor 接入实际 WinUI 宿主边界，生产默认 `Enabled: false`，关闭窗口时停止 Worker。
- `scripts/stage1/WorkerSupervisorRuntime/`：使用同一 `WorkerSupervisor`/协议源码的隔离 child Worker 验证程序。

## 真实测试命令与结果

```text
.tools\dotnet10\dotnet.exe build desktop/src/Zhike.Desktop/Zhike.Desktop.csproj -c Release --no-restore -p:Platform=x64 -r win-x64
0 warnings, 0 errors

.tools\dotnet10\dotnet.exe run --project scripts/stage1/WorkerSupervisorRuntime/WorkerSupervisorRuntime.csproj -c Release --no-restore --nologo
integrationStatus=Passed
currentSid=peerSid
acl=current SID only
wrongTokenRejected=true
tokenRotationRejected=true
timeoutCancelled=true
invalidFrameRejected=true
crashRecovered=true
reconnect=true
callerCancelled=true
tempRootClean=true
```

IPC runtime 使用真实 Named Pipe、真实 Supervisor 类和真实子进程；没有打开生产 sidecar，也没有连接真实 WS。token 轮换会关闭旧管道并建立新会话，旧 pipe/token 无法重连。

## 未测试与风险

- `differentWindowsUser=NotTested`：当前环境没有可安全使用的第二个真实 Windows 用户上下文。不能把当前用户的 ACL 结果推断为跨 SID 通过。
- 因此 `ws.ipc.named-pipe.v1` 及正式 Worker 入口继续保持 `FROZEN`。
- 本轮未启动正式采集 Worker、AI Worker 或真实账号。

## 回滚与数据保护

- 代码回滚到 `0a8aeb1` 可移除本轮 IPC 集成；本轮不需要数据库回滚。
- 隔离 Worker 使用临时目录，测试结束后 `tempRootClean=true`；生产 SQLite、客户、群组、消息和 AI 数据未打开或修改。

## 提交

实现提交：`bce0efb`、`910b550`、`81287a0`。配套 fencing 提交：`9e482b4`、`03d83d9`、`96206e8`。本报告已由阶段 1.6 复核报告 supersede；阶段 1.6 交付后工作区保持 clean。
