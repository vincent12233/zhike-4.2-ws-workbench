# 阶段 1.7 跨 SID ACL 实际结果

## 状态

**Passed**

## A 合法连接

A 用户会话的结果文件记录：

```json
{
  "status": "A_CONNECTED",
  "hostSid": "...-1006",
  "peerSid": "...-1006",
  "productionWorkerStarted": false,
  "productionDatabaseOpened": false
}
```

这证明 A 以当前测试用户 SID 建立了真实 Named Pipe、完成授权握手并获得 Worker 响应。

## B 跨 SID 拒绝

B 在 A 的管道监听期间执行客户端，结果为：

```json
{
  "clientSid": "...-1007",
  "hostPipeConnected": false,
  "aclDenied": true,
  "businessOperationExecuted": false,
  "errorType": "UnauthorizedAccessException",
  "errorCode": "-2147024891",
  "productionWorkerStarted": false,
  "productionDatabaseOpened": false
}
```

`-2147024891` 对应 Windows `ERROR_ACCESS_DENIED (0x80070005)`。B 在操作系统 ACL 层无法连接，未进入应用业务处理，也没有数据库写入。

## 真实实现边界

Named Pipe 由 `WorkerSupervisor` 实际创建，使用受保护 `PipeSecurity`、仅当前 SID 的 `FullControl`、对端 SID 模拟校验和 HMAC/session/request ID 协议。B 的拒绝不是 mock ACL 或用户名字符串模拟。

## 异常记录

延长等待版的一个宿主进程因测试延迟超过当时发布包的启动超时而结束；这不改变 B 已获得真实 OS `Access Denied` 的结果。A 合法连接已由单独 A 会话记录为 `A_CONNECTED`。未发生宿主崩溃、生产写入或真实 WS 连接。

## 提交与工作区

- 测试基线：`8ca8bc5`。
- 测试端点文件不包含 token，只包含 pipe 名称和脱敏结果。
- `git diff --check`：通过。
