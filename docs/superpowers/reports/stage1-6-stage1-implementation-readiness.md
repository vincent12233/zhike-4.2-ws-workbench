# 阶段 1 正式实施准入准备度

## 状态

**NotTested**

## 结论

阶段 1 的基础设施代码、隔离 Worker、SQLite fencing 和旧队列兼容性已具备受控实施所需的同 SID/隔离证据；但跨 SID Named Pipe ACL 是本轮唯一未完成的 P0 实测，故当前不能申请解冻生产入口，不能进行正式回填、生产 Worker 启动或队列切换。

## 已完成并有证据的内容

- 旧队列与 AI 历史字段兼容性：`Passed`，临时 SQLite 保留/幂等/无双写。
- CRM 权威源与客户去重：`Passed`，单一 `customers.id` 主档，普通 WS 不自动创建，群组确认入群才允许确定性建档。
- IPC 同 SID 真实 WinUI Supervisor/Worker：`Passed`，包括 token 轮换、超时、调用方取消、非法帧、崩溃恢复和重连。
- SQLite 单写入者/fencing：`Passed`，实际 sidecar 受保护业务写入、过期 Worker 拒绝、checkpoint 顺序和幂等。
- 全量回归：`Passed`，211/211；WinUI x64/win-x64：0 warnings/0 errors。
- 主生产保护：feature flag 默认关闭，生产 SQLite/真实 WS/正式 Worker 未触及。

## 阻断项

`differentWindowsUser=NotTested`。当前主机虽存在 SID 不同的候选本地账户，但没有可合法使用的授权凭据；本轮没有创建账户、重置密码或修改安全策略。可执行脚本为 `scripts/stage1/cross-sid-acl-acceptance.ps1`，它会在缺少凭据时安全返回 `NotTested`，不会伪造通过。

## 获准后的最小实施序列

1. 在受控测试机提供第二真实 Windows 用户凭据，完成跨 SID ACL/应用拒绝/无写入测试。
2. 重新执行阶段 1.6 全部测试并记录脱敏 SID、命令、日志和清理结果。
3. 若 IPC P0 变为 `Passed`，另行提交生产实施申请；仍需单独批准 feature flag、回填、双读对账和切换窗口。
4. 任何失败都先回滚到本阶段前 Git 提交，不触碰生产业务数据。

## 回滚与停止条件

当前生产入口保持 `FROZEN`。没有生产迁移、正式 Worker、真实 WS、AI outbox 切换或安装包发布。代码基线为 `81287a0`；报告和脚本提交后仍可通过 Git 回滚，临时测试数据不需要业务恢复。

## 提交与工作区

- 阶段 1.6 复核基线：`81287a0`。
- `git diff --check`：`exit 0`；交付提交后工作区为 clean。
