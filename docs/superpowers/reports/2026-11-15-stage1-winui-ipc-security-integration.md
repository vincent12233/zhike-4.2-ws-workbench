# P0-04 WinUI / Worker Named Pipe IPC 安全集成

## 协议冻结

隔离协议测试覆盖：

- Windows Named Pipe 传输选择；
- 当前 SID-only ACL 设计；
- nonce/HMAC-SHA256 token proof；
- schemaVersion/requestId/sessionId/traceId；
- request replay rejection；
- cancel acknowledgement；
- timeout；
- token rotation；
- 脱敏错误分类。

现有静态原型位于 scripts/stage1/NamedPipeSecurityRuntime，协议门禁位于 scripts/stage1/ipc-protocol-contract.test.cjs。生产 loopback sidecar 兼容路径没有被删除，也没有让 Worker 直接暴露 TCP。

## 验证结果

~~~
node scripts/stage1/ipc-protocol-contract.test.cjs
{"ok":true,"scope":"isolated-only","transport":"Windows Named Pipe",
 "acl":"current SID only","tokenProof":"HMAC-SHA256","replay":true,
 "cancellation":true,"timeout":true,"rotation":true,
 "winUiIntegration":"DesignOnly","differentWindowsUser":"NotTested",
 "productionWorkerStarted":false,"productionDatabaseOpened":false}
~~~

## 状态

**DesignOnly**。本轮没有声称真实 WinUI 宿主与 .NET Worker 已完成跨 SID ACL 验证，尚未在第二 Windows 用户/干净 Windows 设备上进行连接拒绝测试。不能因此开启 ws.ipc.named-pipe.v1 或正式 Worker。

## 风险与下一步

需要隔离环境中的真实 .NET Worker、WinUI host、SID ACL、重启/崩溃/重连和不同用户测试；IPC 日志必须继续禁止凭据、Cookie、Token 和聊天原文。若跨 SID 条件不可用，准入状态保持 NotTested。

## 提交

a637890 test: add isolated fencing writer and IPC protocol gates
