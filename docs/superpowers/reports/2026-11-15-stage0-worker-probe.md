# 知客 6.1 阶段 0 Worker 可行性验证报告

验证日期：2026-11-15  
验证脚本：[scripts/stage0/worker-probe.cjs](../../scripts/stage0/worker-probe.cjs)

## 范围

本验证只覆盖隔离技术链路，不连接真实 WhatsApp/WS 账号，不写入用户业务数据库，不执行 6.1 迁移。脚本为临时验证工具，不是生产 Worker 实现。

## 实际命令与结果

```text
node scripts/stage0/worker-probe.cjs

{"ok":true,
 "sidecar":{"port":"动态分配","storage":"sqlite","workspace":"%TEMP%\\zhike-stage0-*"},
 "worker":{"dynamicPort":true,"heartbeat":true,"cancellation":true,
             "crashRecovery":true,"resourceTelemetry":true,"restarts":1},
 "scope":"isolated-temp-only"}
```

结果：进程退出码 0。

## 已验证

- sidecar 使用临时 `ZHIKE_DATA_DIR` 并初始化 SQLite。
- Worker 使用动态 loopback 端口，不依赖固定端口。
- Worker 心跳在连续读取中前进，并返回 RSS/CPU 指标。
- `/health` 和 `/cancel` 缺少或使用旧 token 时返回 401。
- Worker 重启后旧 token 失效，新 token 才能访问。
- Worker 被强制终止后，第二次启动能从临时状态文件恢复 `restarts=1`。
- 取消请求返回 202，Worker 正常退出。
- Worker 崩溃/重启期间 sidecar 健康检查仍为成功。
- `finally` 路径删除临时目录；验证结束后 `%TEMP%` 中没有遗留 `zhike-stage0-*` 目录，未留下生产数据。

## 尚未验证

- .NET 独立 Worker 与 WinUI 宿主的真实 IPC 实现。
- 命名管道 ACL、Windows 用户 SID 权限和 capability 传递。
- SQLite 单写入者租约、fencing token 与真实采集事件提交。
- WebView2 独立授权会话和前台聊天隔离。
- 真实 WS、群组、AI、24 小时长跑和干净设备安装。

## 结论

阶段 0 的“独立进程 + 动态本机通道 + token 握手 + 心跳 + 取消 + 崩溃恢复 + 资源指标”技术链路在隔离环境可行，可以进入下一项只读审计：现有采集队列/AI 队列字段映射与单写入者切换设计。该结果不代表 6.1 Worker 已实现，也不授权生产数据库迁移或真实账号接入。

