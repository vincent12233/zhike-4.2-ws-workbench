# 阶段 1.5 全量回归

## 状态

**Passed**

## 命令

```text
node scripts/run-tests.cjs all
```

## 最终结果

```text
Completed 211 checks: 211 passed, 0 failed.
```

本轮全量包含原有桌面、业务、WS、AI、群组、导入导出、滚动与性能合同，以及新增的 queue compatibility、IPC runtime、sidecar fencing integration、fencing failure/BUSY recovery 检查。主 WinUI 项目另行使用 x64/win-x64 参数构建，0 warning/0 error。

## 中间失败与修复

第一次重跑在 IPC runtime 源文件被并发编辑暂时移除时为 `210 passed / 1 failed`，失败为编译找不到 `WorkerSupervisor.cs`。已恢复源文件、停止并发编辑、重新编译并重新执行全量；最终结果以上述 211/211 为准。

## 数据安全

回归测试均使用隔离 fixture/临时 SQLite；没有打开生产 SQLite、真实 WS、生产 Worker 或 AI Worker，没有旧/新队列双写。测试临时目录已清理，工作区在报告生成前为 clean。

## 回滚

实现回滚点为 `bce0efb` 及其父提交；fencing 相关回滚点为 `9e482b4`。无生产 schema 或业务数据需要回滚。
