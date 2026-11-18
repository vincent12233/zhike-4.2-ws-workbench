# 知客 6.1 阶段 0 总体验收报告

验证日期：2026-11-15  
范围：独立 Worker/IPC 隔离可行性 + 旧采集/AI 队列只读映射审计  
生产数据边界：未打开生产数据库，未连接真实 WS/WhatsApp，未调用真实 AI，未创建 019–030 迁移表，未执行双写。

## 1. 执行结果

### 1.1 独立 Worker 隔离探针

命令：

```text
node scripts/stage0/worker-probe.cjs
```

结果：退出码 `0`。

```json
{
  "ok": true,
  "sidecar": {
    "port": 53475,
    "storage": "sqlite",
    "workspace": "%TEMP%\\zhike-stage0-zmcXqj"
  },
  "worker": {
    "dynamicPort": true,
    "heartbeat": true,
    "cancellation": true,
    "crashRecovery": true,
    "resourceTelemetry": true,
    "restarts": 1
  },
  "scope": "isolated-temp-only"
}
```

已验证：

- sidecar 使用临时 `ZHIKE_DATA_DIR` 并初始化临时 SQLite。
- Worker 使用动态 loopback 端口，不依赖固定端口。
- 心跳、RSS/CPU 指标、取消和正常退出可工作。
- 缺 token、旧 token 返回 401；重启后旧 token 失效，新 token 生效。
- 强制终止后状态可恢复 `restarts=1`。
- Worker 崩溃期间 sidecar 仍可健康检查。
- 成功运行后 `%TEMP%` 没有遗留 `zhike-stage0-*` 目录。

### 1.2 旧队列/AI 只读映射审计

命令：

```text
node scripts/stage0/audit-queue-mapping.test.cjs
node scripts/stage0/audit-queue-mapping.cjs --read-only
```

结果：合同测试通过；审计输出确认：

- 当前迁移 runner 最大内联版本为 `018`。
- 实际迁移文件为 `005–018`，不存在可直接运行的 `019–030` 生产迁移链。
- `ai_jobs` 在 `server.mjs` 内联创建，不在版本化迁移文件中。
- 当前写入者包括 `resources/app/modules/ws-workbench.js`、`resources/app/server.mjs` 和 `desktop/src/Zhike.Desktop/Services/LocalQueue.cs`。
- `ws_collection_runs/items`、`ai_jobs`、`ws_ai_analyses`、`ai_customer_field_evidence` 和群监控 checkpoint 之间仍存在状态和写入者冲突。

完整审计：[阶段 0 队列映射报告](2026-11-15-stage0-queue-mapping-audit.md)。

### 1.3 阶段 0 针对性合同测试

命令：

```text
node desktop/tests/LocalServiceManagerContractTests.cjs
node desktop/tests/ResourceLifecycleContractTests.cjs
node desktop/tests/WsRuntimeCoordinatorContractTests.cjs
node desktop/tests/WsProcessSessionPoolContractTests.cjs
node desktop/tests/WsCollectorP0ContractTests.cjs
node desktop/tests/WsBackgroundLifecycleContractTests.cjs
node scripts/stage0/audit-queue-mapping.test.cjs
```

结果：**7/7 通过**。

### 1.4 全量回归

命令：

```text
node scripts/run-tests.cjs all
```

结果：**205/205 通过，0 失败**。

## 2. 阶段 0 能力矩阵

| 能力 | 结果 | 证据/限制 |
|---|---|---|
| 独立 Node Worker 进程 | 可验证并实现 | 临时子进程探针通过 |
| 动态本机端口 | 可验证并实现 | sidecar/Worker 均使用动态端口 |
| token 握手与轮换 | 可验证并实现（探针级） | 仅为阶段 0 token，不代表正式 IPC ACL |
| 心跳和资源指标 | 可验证并实现 | RSS/CPU 采样通过 |
| 取消与有界停止 | 可验证并实现 | 202 + clean exit |
| Worker 崩溃恢复 | 可验证并实现（探针级） | 临时状态恢复 `restarts=1` |
| .NET Worker ↔ WinUI 真实 IPC | 未验证 | 当前只验证 Node 子进程，不连接生产宿主 |
| 命名管道 ACL/SID/capability | 未验证 | 阶段 1 前必须设计和实测 |
| SQLite 单写入者/fencing | 部分可实现 | 探针只验证协议状态，尚未接生产事实表 |
| WebView2 独立授权会话 | 未验证 | 未复制或读取登录态 |
| 真实 WS/群组/AI | 未验证 | 按安全边界未接入 |
| 24 小时资源长跑 | 未验证 | 阶段 6 验收项 |
| 干净 Windows 安装/迁移 | 未验证 | 阶段 3/6 验收项 |

## 3. 阶段 0 结论

**阶段 0 的隔离技术可行性通过，但生产架构迁移门禁未通过。** 可以进入下一阶段的设计收敛和隔离实现；不能把本报告解读为“6.1 Worker 已上线”或“真实 WS 后台采集已完成”。

进入阶段 1 前必须冻结：

1. 旧表复用/兼容视图与逐字段映射合同。
2. CRM 唯一事实源和 `app_state` 投影切换方案。
3. 单写入者、租约、fencing、checkpoint 和人工审核重放语义。
4. 正式 IPC 传输、ACL、capability、token 生命周期和账号范围。
5. `.zkdevice` 加密格式、旧备份转换和一致性快照屏障。
6. 6.1 版本锁、迁移 runner、安装包资源白名单和高版本库拒绝策略。

本阶段新增工具和报告均为审计/测试资产，不会进入生产运行路径。
