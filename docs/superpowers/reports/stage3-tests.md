# 阶段 3 测试与回归报告

## 实际命令

```text
node scripts/run-tests.cjs stage3
node scripts/run-tests.cjs ws
node scripts/run-tests.cjs all
.tools\\dotnet10\\dotnet.exe build desktop/src/Zhike.Desktop/Zhike.Desktop.csproj -c Release --no-restore -p:Platform=x64 -r win-x64 --nologo -v:minimal
git diff --check
```

## 结果

| 范围 | 结果 |
|---|---:|
| 阶段 3 专项 | 41/41 Passed |
| WS 回归 | 137/137 Passed |
| 全量回归 | 226/226 Passed |
| WinUI x64/win-x64 Release | 0 warnings, 0 errors |
| `git diff --check` | Passed |

阶段 3 专项包含 JS/CSS 语法、五项群组开关、Worker 隔离、迁移、核心规则、隔离 API/Mock Transport 和导航契约。全量回归还重新执行了阶段 1.5、阶段 2、桌面、业务、CRM、AI、WS、性能、备份和发布边界测试。

阶段 1.5 IPC 测试输出中的 `differentWindowsUser` 仍按测试环境状态为 `NotTested`；本轮没有把全量测试退出码当作新的跨 SID 实测证据。

## 测试限制

没有连接真实 WhatsApp 账号，没有启动正式 Worker，没有执行新旧队列并行消费，没有修改生产 SQLite。跨设备安装、真实 WS 群组平台行为和真实 AI 提供商结果不属于本轮已通过项目。

