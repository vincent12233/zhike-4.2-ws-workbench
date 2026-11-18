# 阶段 1.7 IPC 安全最终结果

## 状态

**Passed**（跨 SID ACL 与同 SID 协议/恢复测试均有实际证据。）

## 测试覆盖

```text
.tools\dotnet10\dotnet.exe run --project scripts/stage1/WorkerSupervisorRuntime/WorkerSupervisorRuntime.csproj -c Release --no-restore --nologo
```

同 SID 隔离结果：`integrationStatus=Passed`、`wrongTokenRejected=true`、`tokenRotationRejected=true`、`timeoutCancelled=true`、`callerCancelled=true`、`invalidFrameRejected=true`、`crashRecovered=true`、`reconnect=true`、`tempRootClean=true`。

跨 SID 真实结果：A SID `...-1006` 合法连接；B SID `...-1007` 获得 Windows `UnauthorizedAccessException / ERROR_ACCESS_DENIED`，未执行业务命令。

## 安全结论

- ACL 不包含不必要的 Everyone、Anonymous 或宽泛写入权限。
- 未授权 B 无法建立管道连接，无法执行 Worker 业务操作。
- 无效 token、旧 session/token、非法帧、取消、崩溃恢复和重连均通过同 SID 真实 Supervisor/Worker 路径验证。
- 未发生生产数据库写入、真实 WS 连接或正式 Worker 启动。

## 限制

跨 SID 运行使用公开临时目录只传递 pipe 名称和结果，不传递 token；测试结束前临时账户和测试文件仍待管理员清理。

## 提交

代码基线：`8ca8bc5`；本阶段报告和清理脚本随交付提交。
