# 知客 6.1 阶段 2 Feature Flags 报告

## 状态

**Passed（默认关闭、隔离可启用）**

旗标名称严格为：

- `WorkerRuntimeEnabled`
- `WorkerQueueAdapterEnabled`
- `WorkerFencingEnabled`

缺少 `worker-feature-flags.json`、schema 不是 1、JSON 损坏或字段不是 JSON `true` 时，三个旗标均为 `false`。读取结果包含 `Source`、`ConfigPath` 和 `Revision`，可用于审计和回退。

## 实测命令

```text
node scripts/stage2/worker-feature-flags.test.cjs
node scripts/stage2/worker-runtime-disabled.test.cjs
```

结果：Passed。缺失配置和错误 schema 均安全关闭；有效隔离配置读取 `revision=7`；禁用路径未启动 Worker 进程。

## 生产保护

`App.OnLaunched` 只加载旗标并创建禁用的 `WorkerSupervisor`/`WorkerRuntimeController`，没有自动 `StartAsync`。生产 Worker 没有配置可执行路径，因此即使存在陈旧旗标文件也不会隐式启动。
