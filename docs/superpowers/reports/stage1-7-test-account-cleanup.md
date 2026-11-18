# 阶段 1.7 测试账户与资源清理

## 状态

**Passed**

## 应清理范围

只允许删除本轮创建且 SID 已核实的：

- `ZhikeTestA`，SID 脱敏 `...-1006`
- `ZhikeTestB`，SID 脱敏 `...-1007`
- `C:\Users\Public\Documents\ZhikeStage1-7` 下的 runtime、cross-sid、same-sid、manifest 和启动脚本。

## 已完成检查

- 没有发现 `WorkerSupervisorRuntime.exe`、目标账户 PowerShell 或 cmd 进程残留。
- 清理脚本会核对完整 SID、检查目标账户进程，并在任何不匹配时停止。
- 清理脚本在非管理员上下文中已验证为拒绝执行且不改账户。

## 实际清理结果

系统复核返回：

```text
ZhikeTestA=ABSENT
ZhikeTestB=ABSENT
```

没有目标账户进程残留，公共测试目录 `C:\Users\Public\Documents\ZhikeStage1-7` 已删除，端点、运行时、manifest 和启动脚本均已清理。

## 清理命令

管理员 PowerShell 执行：

```text
powershell -NoProfile -ExecutionPolicy Bypass -File "C:\Users\酷酷\Documents\Codex\2026-11-04\new-chat\work\project-review\知客 4.1 运营增强版\scripts\stage1\cleanup-cross-sid-test-accounts.ps1" -ManifestPath "C:\Users\Public\Documents\ZhikeStage1-7\accounts-manifest.json"
```

成功输出为：`Removed exactly the two manifest-matched Stage 1.7 accounts.` 清理后再次确认 `Get-LocalUser` 找不到两个账户，并确认公共测试目录不存在。

## 提交

清理脚本随阶段 1.7 报告提交；当前工作区和生产数据未受清理影响。
