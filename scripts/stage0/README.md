# 阶段 0 隔离探针

这些脚本只用于知客 6.1 阶段 0 的技术可行性验证，不是生产 Worker，也不会接入真实 WS 账号。

## Worker/sidecar 探针

```powershell
node scripts/stage0/worker-probe.cjs
```

探针会在 `%TEMP%` 创建临时 `ZHIKE_DATA_DIR`，启动现有 sidecar 和一次性 Node 子进程，验证动态端口、token 握手、心跳、取消、崩溃恢复、资源指标和清理。不会读取 `%LOCALAPPDATA%\Zhike6`，不会修改仓库数据库。

## 队列映射只读审计

```powershell
node scripts/stage0/audit-queue-mapping.test.cjs
node scripts/stage0/audit-queue-mapping.cjs --read-only
```

审计只扫描源码、迁移文件和写入路径；不会打开运行时 SQLite，不执行 DDL，不创建迁移表。
