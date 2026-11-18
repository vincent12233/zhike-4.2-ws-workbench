# 阶段 1.6 跨 SID Named Pipe ACL 验收

## 状态

**NotTested**

本轮没有第二个 Windows 用户的可用授权凭据，因此没有启动跨 SID 客户端，也没有把同 SID 结果冒充为跨 SID 通过。生产入口继续保持 `FROZEN`。

## 测试环境

- 主机：当前 Windows 工作站，普通用户上下文。
- 当前用户 SID：已脱敏记录为 `...-1001`。
- 系统中发现的候选账户：`CodexSandboxOffline`（SID 脱敏为 `...-1003`）和 `CodexSandboxOnline`（SID 脱敏为 `...-1004`）。两个账户均要求密码；当前会话没有其授权凭据。
- 没有创建账户、重置密码、修改本地安全策略、关闭防护或提升权限。
- 没有打开生产 SQLite、启动正式 Worker 或连接真实 WS。

## 实际命令

```text
whoami /user
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/stage1/cross-sid-acl-acceptance.ps1
.tools\dotnet10\dotnet.exe run --project scripts/stage1/WorkerSupervisorRuntime/WorkerSupervisorRuntime.csproj -c Release --no-restore --nologo
```

验收脚本输出（SID 已脱敏）：

```json
{
  "status": "NotTested",
  "currentSid": "...-1001",
  "candidateAccounts": ["...-1003", "...-1004"],
  "reason": "No authorized second-user credential was supplied; cross-SID pipe and application rejection remain NotTested.",
  "productionWorkerStarted": false,
  "productionDatabaseOpened": false,
  "securityPolicyChanged": false,
  "accountCreatedOrReset": false
}
```

同 SID 隔离宿主的真实结果：`integrationStatus=Passed`、`acl=current SID only`、`anonymous=false`、`differentWindowsUser=NotTested`、`tempRootClean=true`。这只能证明当前 SID 的集成路径，不能证明跨 SID 的操作系统拒绝结果。

## ACL 与应用层边界

实际实现位于 `desktop/src/Zhike.Desktop/Services/WorkerSupervisor.cs`：

- `PipeSecurity.SetAccessRuleProtection(true, false)` 禁止继承规则。
- 只授予当前 SID 的 `FullControl`，没有添加 `Everyone`、`Anonymous` 或宽泛写入权限。
- 首帧后通过 Named Pipe 模拟身份读取对端 SID，并与当前 SID 比较。
- 应用层使用随机启动 token、HMAC proof、session、schema 和 request ID 校验。

由于没有 B 用户进程，本轮没有获得操作系统级 ACL 拒绝日志，也没有获得 B 在应用握手阶段被拒绝的日志；两项均保持 `NotTested`。

## 可执行的后续验收

脚本不会创建或重置用户。获得现有测试账户授权后，在隔离环境执行：

```text
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/stage1/cross-sid-acl-acceptance.ps1 -ClientUser <existing-local-user> -VerifyCredentialIdentity
```

脚本只使用一次性 `Get-Credential` 做 `whoami /user` 身份证明，不保存凭据；身份证明成功后仍需用真实 host/client 隔离 harness 记录 ACL 拒绝、应用拒绝、无写入和清理结果，才能把状态改为 `Passed`。

## 安全失败记录

没有 ACL 降级、凭据输出、token 输出、生产写入或高权限残留。唯一阻断是缺少第二真实 Windows 用户的授权凭据，因此按要求保持 `NotTested`。

## 回滚与提交

- 代码基线：`81287a0`（包含 `910b550` 的响应排空修复和本轮调用方取消门禁）。
- 本轮脚本只读系统账户信息，不产生数据库迁移；删除脚本即可回滚。
- 正式 Worker、生产 SQLite、真实 WS 和新旧队列双写均未启动。

## 提交与工作区

- 测试代码基线：`81287a0`；本报告新增的验收脚本和报告文件随本阶段交付提交。
- `git diff --check`：`exit 0`。
- 交付完成后工作区状态：clean。
