# 阶段 1.5 旧队列兼容性复核

## 状态

**Passed**（临时 SQLite 只读兼容/保留验证；没有生产回填或双写。）

## 实测范围

临时数据库运行真实 migration runner 至 manifest v22，写入并重开数据库后复核：

- `ws_collection_runs` 旧运行记录保留；
- `ws_collection_items` 旧采集项保留；
- `ws_ai_analyses` 历史分析保留；
- `ai_jobs` 旧 AI 队列保留；
- 没有创建第二套 `ws_ai_outbox`；
- 没有触发双读写或生产 Worker 执行；
- checkpoint/唯一键在重开与重复 migration 后不丢失。

## 实测命令与结果

```text
node scripts/stage1/stage1-5-queue-compatibility.test.cjs
manifestMax=22
legacyRunRetained=true
legacyItemRetained=true
aiAnalysisRetained=true
aiJobRetained=true
noSecondAiOutbox=true
noDualWrite=true
doubleReadWrite=false
productionWorkerStarted=false
productionDatabaseOpened=false
```

旧队列继续是当前生产权威；新 Worker/AI outbox 仅完成隔离结构验证，feature flag 默认关闭，未执行正式回填或切换。

## 回滚与提交

测试只使用临时 SQLite，目录结束后清理。回滚不需要生产数据恢复；代码回滚到 `0a8aeb1` 可移除本轮兼容性测试，新增测试/IPC 实现提交为 `bce0efb`。
