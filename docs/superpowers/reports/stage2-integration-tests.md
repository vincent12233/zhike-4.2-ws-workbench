# 知客 6.1 阶段 2 集成测试报告

## 新增测试

本阶段新增 5 个阶段 2 检查：

1. `worker-fencing-gate.test.cjs`
2. `worker-queue-adapter.test.cjs`
3. `worker-controlled-integration.test.cjs`
4. `worker-feature-flags.test.cjs`
5. `worker-runtime-disabled.test.cjs`

覆盖旗标关闭、真实隔离 Worker 启停、心跳、取消、崩溃恢复、token 轮换、队列幂等/双消费者、fencing fail-closed 和事务委托。
Worker 生命周期检查还覆盖并发 token 轮换、连续重启以及旧进程退出回调的 generation 防护。

隔离 Worker 测试先构建 apphost，再直接运行 `WorkerRuntimeIntegration.exe`，避免嵌套
`dotnet run` 的宿主标准输入继承造成测试进程悬挂；运行结束无残留 Worker 进程。

## 全量回归

实际命令：

```text
node scripts/run-tests.cjs all
```

实际结果：

```text
Completed 218 checks: 218 passed, 0 failed.
```

## 编译与静态检查

```text
.tools\dotnet10\dotnet.exe build desktop/src/Zhike.Desktop/Zhike.Desktop.csproj -c Release --no-restore -p:Platform=x64 -r win-x64 --nologo -v:minimal
0 warnings
0 errors

git diff --check
exit 0
```

全量测试没有连接真实 WS、没有读取登录态、没有启动正式 Worker、没有打开生产 SQLite，也没有执行新旧队列双写。
