# 阶段 1.6 全量回归

## 状态

**Passed**

## 实测命令与结果

本轮在 `81287a0` HEAD 重新执行，未复制上一轮结果：

```text
node scripts/run-tests.cjs all
Completed 211 checks: 211 passed, 0 failed.
```

211 项覆盖桌面壳、业务规则、CRM、群组、VIP、跟票、报名、入金、统计、GPT、WS 前后台隔离、WS 多账号、群组监测、导入导出、AI 队列、滚动与性能、队列兼容性、IPC 隔离宿主、sidecar fencing 和失败恢复。

## 额外构建与静态检查

```text
.tools\dotnet10\dotnet.exe build desktop/src/Zhike.Desktop/Zhike.Desktop.csproj -c Release --no-restore -p:Platform=x64 -r win-x64 --nologo -v:minimal
0 warnings
0 errors

git diff --check
exit 0
```

## 数据与运行安全

- queue compatibility、IPC runtime、sidecar fencing 和 BUSY recovery 均使用隔离 fixture/临时 SQLite。
- `productionWorkerStarted=false`、`productionDatabaseOpened=false`；未连接真实 WS。
- 测试结束后没有 `WorkerSupervisorRuntime` 进程，`zhike-stage1-*` 临时目录数量为 0。
- 没有执行正式回填、生产迁移、新旧队列双写或发布安装包。

跨 SID 脚本没有纳入 211 项自动回归，因为当前环境缺少第二用户授权凭据；它只读账户信息并按 `NotTested` 退出，不改变测试结论。

## 回滚

代码基线为 `81287a0`；全量回归没有改动生产数据，失败时可按 Git 提交回滚，不需要业务数据恢复。

## 提交与工作区

- 本轮实际测试 HEAD：`81287a0`。
- `git diff --check`：`exit 0`；报告和脚本交付提交后工作区为 clean。
