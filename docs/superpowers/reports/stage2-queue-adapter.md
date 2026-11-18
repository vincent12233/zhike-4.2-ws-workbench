# 知客 6.1 阶段 2 旧队列适配报告

## 状态

**Passed（只读兼容层）**

`resources/app/worker-queue-adapter.cjs` 只做纯函数映射：

- `ws_collection_items` → `ws.collect.history`
- `ai_jobs` → `ws.ai.analysis`

映射保留旧记录 ID、账号、会话、状态、尝试次数、checkpoint、覆盖状态、分析关联和原始幂等键；没有 SQLite import、写入或状态回写。没有新 outbox 表，也没有第二个生产消费者。

`assertSingleConsumer` 在旧消费者和 Worker 同时为 active 时抛出 `DUAL_CONSUMER`；异常字符串等 malformed 值按 false 处理，避免误启用。

## 实测命令

```text
node scripts/stage2/worker-queue-adapter.test.cjs
node scripts/stage1/stage1-5-queue-compatibility.test.cjs
```

结果：Passed。旧行不变、映射稳定、重复映射得到同一 job/idempotency key，双消费者被拒绝；旧队列/AI 历史回归保持不变。

## 当前限制

适配器尚未获得生产消费权限；旧队列仍是唯一生产权威。后续切换必须经过独立准入，不属于本阶段。
