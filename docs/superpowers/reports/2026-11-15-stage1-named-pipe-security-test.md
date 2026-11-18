# 阶段 1 P0-04：Named Pipe ACL/SID 隔离实测

验证日期：2026-11-15
基线：`6e4d195` 〔阶段 1 前置设计冻结〕
范围：真实 .NET 进程隔离探针；不启动生产 Worker、不读取生产数据库、不接入真实 WS。

## 1. 实际验证对象

- `scripts/stage1/NamedPipeSecurityRuntime/NamedPipeSecurityRuntime.csproj`：`net10.0-windows` 隔离探针工程。
- `scripts/stage1/NamedPipeSecurityRuntime/Program.cs`：真实 `NamedPipeServerStreamAcl` 服务端、`NamedPipeClientStream` 客户端、SID ACL、HMAC token、schema、重放、取消、超时、断线和轮换测试。
- 正式设计依据：`docs/superpowers/reports/2026-11-15-stage1-ipc-fencing-migration-design.md:40-81`。

## 2. 实测命令与结果

```text
dotnet build scripts/stage1/NamedPipeSecurityRuntime/NamedPipeSecurityRuntime.csproj -c Release --nologo
dotnet run --project scripts/stage1/NamedPipeSecurityRuntime/NamedPipeSecurityRuntime.csproj -c Release --no-build
```

构建：退出码 0，0 个警告，0 个错误。完整探针：退出码 0，实际 JSON 摘要：

```json
{
  "ok": true,
  "status": "Passed",
  "transport": "Windows Named Pipe",
  "aclHasCurrentSid": true,
  "aclHasWorldAllow": false,
  "sameUserHandshake": true,
  "wrongTokenRejected": true,
  "tokenRotation": true,
  "replayRejected": true,
  "schemaRejected": true,
  "cancel": true,
  "timeout": true,
  "disconnect": true,
  "winUiIntegration": "NotTested",
  "differentWindowsUser": "NotTested",
  "productionWorker": "NotStarted",
  "productionDatabase": "NotOpened"
}
```

验证内容：

1. 当前 Windows 用户 SID 被识别，并写入显式 Pipe ACL。
2. ACL 没有 World Allow；同用户携带有效 token 可握手。
3. 错误 token 被 `AUTH_REVOKED` 拒绝。
4. schema 版本不兼容被 `UNSUPPORTED_SCHEMA` 拒绝。
5. 相同请求 ID 的重放被幂等拒绝。
6. 请求取消、过期 deadline 和连接断开均有明确响应/释放路径。
7. token 轮换后新 token 可重新握手，旧 token 被拒绝。

## 3. 尚未通过的范围

本探针证明的是 **真实 .NET Named Pipe 原型**，不是正式集成完成。以下项目必须在进入生产 Worker 前补测：

- `WinUI/.NET Host ↔ Worker` 正式宿主生命周期集成：`NotTested`。
- 不同 Windows 用户 SID 的拒绝测试：`NotTested`（当前测试环境没有第二个可控 Windows 用户会话）。
- 正式 Worker capability、fencing token 与 sidecar 写入 API 的联调：`NotTested`。
- 错误日志脱敏、心跳恢复和进程异常退出的正式宿主验收：`DesignOnly`。

## 4. P0 状态和风险

**P0-04：DesignOnly（隔离 .NET 原型 Passed；正式 WinUI 集成和跨用户验收未完成）。阶段 1 生产准入：Blocked。**

风险：若把原型通过误认为宿主集成通过，可能在实际重启、权限切换或旧 token 恢复时开放错误的写入权限。正式 Worker 仍必须保持禁用，直到补完 WinUI 宿主、跨 SID 和 sidecar fencing 联调。

本轮没有修改生产代码、生产数据库、真实 WS 登录态或启动生产 Worker。
