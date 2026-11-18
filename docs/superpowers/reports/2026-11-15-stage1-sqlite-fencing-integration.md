# P0-05 SQLite 单写入者与 fencing 整改

## 已验证实现

隔离 writer 组件 scripts/stage1/sqlite-fenced-writer.cjs 在事务内执行：

1. durable lease 获取与过期；
2. 单调 fencing token；
3. token/租约校验；
4. 事实写入与 checkpoint 同事务提交；
5. 幂等键去重；
6. 旧 writer 失效后实际事实写入和 checkpoint 同时拒绝；
7. 崩溃后的新 writer 接管和有界重试。

sidecar 仍被定义为 SQLite 唯一写入者；正式 Worker 尚未接入生产路径。

## 验证

~~~
node scripts/stage1/sqlite-fencing-verification.cjs
{"ok":true,"scope":"isolated-only","productionDatabaseOpened":false,
 "productionWorkerStarted":false,"counts":{"Passed":9,"Failed":0},
 "results":[... "stale-writer-rejected":"Passed",
 "two-connection-fence":"Passed","checkpoint-order":"Passed"]}

node scripts/stage1/sqlite-fenced-writer.test.cjs
{"ok":true,"scope":"isolated-only","staleWriterRejected":true,
 "idempotentReplay":true,"checkpointOrder":true,
 "productionDatabaseOpened":false,"productionWorkerStarted":false}
~~~

## 当前状态和风险

状态为 **DesignOnly**：机制和隔离集成通过，但没有将新 Worker 接入真实 WS/AI/群事件生产写入。阶段 1 后续必须先完成 sidecar 命令接口、租约撤销、故障注入和生产前 dry-run；在此之前不得启动 Worker 或双写。

## 回滚

停止隔离 Worker、撤销租约、丢弃临时数据库即可；没有生产数据变更。本轮没有修改生产 SQLite。

## 提交

机制基础测试来自 a637890 test: add isolated fencing writer and IPC protocol gates；本轮业务边界来自 d156a7a。
