# 阶段 1.5 Worker 崩溃、取消与恢复验收

## 状态

**Passed**（隔离 child Worker/同 SID IPC 路径）。

## 覆盖场景

- Worker 正常启动与 hello 握手。
- 错误 token 拒绝。
- 请求超时后发送 cancel。
- 调用方主动取消后发送 cancel。
- 非法 JSON/非法响应拒绝且不崩溃宿主。
- Worker 主动退出，Supervisor 将状态置为退出/断开。
- Supervisor 重启 Worker 并重新握手。
- token 轮换关闭旧会话，再建立新 pipe/session。
- 进程关闭时停止隔离 Worker。

## 实测命令

```text
.tools\dotnet10\dotnet.exe run --project scripts/stage1/WorkerSupervisorRuntime/WorkerSupervisorRuntime.csproj -c Release --no-restore --nologo
integrationStatus=Passed
timeoutCancelled=true
crashRecovered=true
reconnect=true
tempRootClean=true
```

## 失败记录

第一次全量回归曾因并发编辑暂时删除 runtime 链接的 `WorkerSupervisor.cs`，得到 `210 passed / 1 failed`。已恢复源文件并重新执行；最终全量为 `211 passed / 0 failed`。该中间失败没有接触生产数据。

## 边界与回滚

测试没有启动正式 Worker 或连接真实 WS。回滚代码为 `bce0efb` 之前版本；隔离临时进程和目录均已清理。
