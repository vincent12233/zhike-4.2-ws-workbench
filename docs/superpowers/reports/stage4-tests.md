# 阶段 4 测试与回归报告

## 实际执行命令

```text
node scripts/run-tests.cjs stage4
node scripts/run-tests.cjs ws
node scripts/run-tests.cjs all
.tools\\dotnet10\\dotnet.exe build desktop/src/Zhike.Desktop/Zhike.Desktop.csproj -c Release --no-restore -p:Platform=x64 -r win-x64 --nologo -v:minimal
git diff --check
```

## 结果

- 阶段 4 专项：`47/47 Passed`。
- 独立 WS 回归：`149/149 Passed`。
- 全量回归：`238/238 Passed`。
- WinUI Release `x64/win-x64`：`0 warnings / 0 errors`。
- `git diff --check`：通过；Git 仅报告现有换行转换提示，没有 whitespace 错误。

专项覆盖源码语法、状态机、原子领取、取消、重试、checkpoint、崩溃恢复边界、迁移、feature flags、Mock Provider、桌面 ApiClient、审核中心 UI、隔离 API/fencing/幂等/CRM 审核。WS 与全量回归覆盖既有客户、群组、VIP、跟票、报名、入金、统计、GPT、导入导出、桌面运行时和安装约束。

## 数据安全与限制

所有阶段 4 API 测试使用临时数据根和临时 SQLite；未连接真实 WS，未调用真实付费 AI，未启动正式 Worker，未修改生产 SQLite，未执行新旧队列双写。真实环境验收和生产切换仍为后续独立准入项。
