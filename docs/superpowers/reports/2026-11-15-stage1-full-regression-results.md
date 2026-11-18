# 阶段 1 P0 全量回归结果

## 命令

~~~
node scripts/run-tests.cjs all
~~~

## 结果

~~~
Completed 206 checks: 206 passed, 0 failed.
~~~

本轮还通过了：

~~~
node --check resources/app/server.mjs
node --check resources/app/migration-runner.cjs
node scripts/stage1/migration-runner-implementation.test.cjs
node scripts/stage1/migration-runner-conflict-diagnostics.test.cjs
node scripts/stage1/p0-02-ai-schema-implementation.test.cjs
node scripts/stage1/p0-03-p0-06-crm-group-implementation.test.cjs
node scripts/stage1/ai-schema-authority-verification.cjs
node scripts/stage1/crm-group-authority-test.cjs
node scripts/stage1/sqlite-fencing-verification.cjs
node scripts/stage1/sqlite-fenced-writer.test.cjs
node scripts/stage1/ipc-protocol-contract.test.cjs
node scripts/stage0/audit-queue-mapping.test.cjs
git diff --check
~~~

WS 既有回归套件在本轮前置复核中为 126/126；全量 all 套件最终为 206/206。

## 真实范围说明

测试使用临时 SQLite/临时数据目录、隔离 server 和静态/运行时 fixtures。没有打开用户生产 SQLite，没有真实 WhatsApp 登录，没有启动正式 Worker 或 AI provider。测试通过只能证明代码和隔离协议门禁，不替代干净 Windows 设备和真实 WS 验收。

## 失败/遗留

全量回归没有失败项。遗留准入项见生产入口报告：真实 WinUI/.NET Named Pipe、跨 SID ACL、生产 fencing 接入、干净设备安装与真实账号验证仍未完成。
