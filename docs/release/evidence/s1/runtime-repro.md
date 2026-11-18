# Delivery S1 非 UI 隔离运行失败复核

日期：2026-11-17。检查起点 HEAD `377632e`，同一工作区有 root/其他负责人进行中的 S1 修改，本任务没有覆盖这些产品修改。生产入口 **FROZEN**。

本轮仅独立运行已有 credential / workspace-queries 隔离 fixture，补充两处测试诊断并重复验证；没有运行浏览器、WinUI、真实 WS、正式 Worker 或付费 AI，没有读取用户实际凭据、profile、生产 SQLite，也没有修改业务架构、锁等待期限或关闭等待期限。

## 1. 原始证据

来源：`.tools/delivery-s1-full.log`，这是本轮全量执行的真实失败记录，不是之前阶段的历史通过数据。

### 1.1 AI credential

约 490–503 行：`AI credential DPAPI persistence` 为 **10/11**。

```
FAIL Concurrent service instances preserve both providers: unexpected storage failure
AI credential isolated runtime: 10/11; network calls=0
```

对应实际 fixture：`desktop/tests/AiBridgeCredentialRuntime/Program.cs`，实际链接 `desktop/src/Zhike.Desktop/Services/AiBridgeService.cs`，使用真实 DPAPI、临时 `zhike-ai-credential-<GUID>` 根和明确合成 Key，HTTP handler 禁止所有网络。

原测试 catch 将所有 InvalidOperationException 转为同一个 `unexpected storage failure`，因此原始日志**不足以区分** AI_CREDENTIAL_BUSY、AI_CREDENTIAL_IO、损坏或解密错误，也没有 round/phase。无法据这条日志认定是锁超时、文件替换、线程调度或防护软件影响。

### 1.2 Workspace queries

约 1711–1727 行：所有查询与约 3006 条审计性能观察先完成，随后测试在 `scripts/stage55b/workspace-queries.test.cjs` 的 `sidecar normal shutdown` 断言失败：

```
null !== 0
```

原测试只等待 `child.exitCode`，没有同时记录 exit/close/signal、ACK 正文使用状态及实际等待耗时。该失败只能证明截止断言时没有得到 exitCode=0；不能区分进程仍存活、被外部信号终止，或事件尚未观察到。

## 2. 首次原样独立复现

实际执行（串行，无并发高负载）：

```powershell
& '.tools/dotnet10/dotnet.exe' run --project 'desktop/tests/AiBridgeCredentialRuntime/AiBridgeCredentialRuntime.csproj' -c Release --no-restore
node 'scripts/stage55b/workspace-queries.test.cjs'
```

- credential：**11/11，exit 0**。日志 `.tools/delivery-s1-ai-credential-repro-01.log`。
- workspace：**exit 0，全部原有断言通过**。日志 `.tools/delivery-s1-workspace-queries-repro-01.log`。
- 第一轮尚未加诊断，两个原始失败都未复现；不能以这次通过宣称根因修复。

## 3. 最小测试诊断变更

只修改：

1. `desktop/tests/AiBridgeCredentialRuntime/Program.cs`
   - 双服务并发用例记录合成的 round 与 save-both / verify-both / remove-and-save / verify-update 阶段。
   - 失败输出只允许稳定 AI_CREDENTIAL_CORRUPT / UNREADABLE / BUSY / IO 分类，不输出原异常路径、密文、合成 Key 或原始配置。
   - 保留 11 个用例、12 轮双实例并发、独立进程用例、取消和失败替换的所有原断言；没有增加重试吞错、跳过测试或放宽 5 秒锁预算。
2. `scripts/stage55b/workspace-queries.test.cjs`
   - 在 spawn 后监听现有 child 的 exit/close，记录退出信号。
   - 关闭断言前输出耗时、exitCode、signalCode、exit/close 是否已观察和 shutdown body 是否使用。
   - 保留认证、只读散列、账号隔离、schema、脱敏、数据规模与原有 `120 × 25ms` 关闭等待和 `exitCode === 0` 断言。

**无产品代码修改；以上是增加可观测证据，不是已证明的产品修复。**

## 4. 独立重复验证

### 4.1 Credential 20 次

实际先编译这一隔离测试项目：

```powershell
& '.tools/dotnet10/dotnet.exe' build 'desktop/tests/AiBridgeCredentialRuntime/AiBridgeCredentialRuntime.csproj' -c Release --no-restore
```

结果：0 warnings / 0 errors，约 1.79 秒；日志 `.tools/delivery-s1-ai-credential-diagnostic-build.log`。这是测试项目编译，**不是 WinUI Release 编译**。

随后按 1→20 串行运行刚构建的：

```
desktop/tests/AiBridgeCredentialRuntime/bin/Release/net10.0-windows/AiBridgeCredentialRuntime.exe
```

结果：**20/20 进程 exit 0；每次 11/11**。合计 240 轮双实例读改写场景，同时每次仍执行真实跨进程更新、取消和失败原子替换校验。没有任何网络请求。

证据：

- `.tools/delivery-s1-ai-credential-repeat-01.log` 至 `-20.log`
- `.tools/delivery-s1-ai-credential-repeat-summary.json`

### 4.2 Workspace 10 次

先核对两种 Node：桌面工具默认 Node 与项目 bundled `resources/app/node.exe` 均为 **v24.22.1**。后续为与全量 runner 一致，显式将子服务 `ZHIKE_TEST_NODE` 指向项目 bundled Node（仅本命令进程环境），使用同一 fixture 串行运行 10 次。

```powershell
$env:ZHIKE_TEST_NODE=Join-Path (Get-Location).Path 'resources/app/node.exe'
node 'scripts/stage55b/workspace-queries.test.cjs'
```

结果：**10/10 exit 0，全部已有断言通过**。

| run | shutdown ms | exitCode | signalCode | exit / close observed |
| --- | ---: | ---: | --- | --- |
| 1 | 126.14 | 0 | null | true / true |
| 2 | 37.68 | 0 | null | true / true |
| 3 | 105.85 | 0 | null | true / true |
| 4 | 60.77 | 0 | null | true / true |
| 5 | 36.14 | 0 | null | true / true |
| 6 | 61.23 | 0 | null | true / true |
| 7 | 37.21 | 0 | null | true / true |
| 8 | 69.74 | 0 | null | true / true |
| 9 | 42.08 | 0 | null | true / true |
| 10 | 36.14 | 0 | null | true / true |

shutdownBodyConsumed 全部 false；说明原 fixture 确实只验证 HTTP status 未读取 ACK 正文，但**此次没有证据证明它造成先前失败**，故未修改产品关闭流程，也未将正文读取当作已定位修复。

证据：

- `.tools/delivery-s1-workspace-queries-repeat-01.log` 至 `-10.log`
- `.tools/delivery-s1-workspace-queries-repeat-summary.json`

## 5. 已核对的产品路径与不能下的结论

- `AiBridgeService.WithCredentialDocumentAsync` 跨服务/进程 FileShare.None 文件锁覆盖读取、验证、修改、replace；实例内 SemaphoreSlim 在 finally 释放。`AcquireCredentialLockAsync` 原有 5 秒 BUSY 和 20ms 等待保持不变。
- `ReadUnlockedAsync` 将 JSON/访问/IO 错误分类，`WriteUnlockedAsync` 在实际文件替换失败时保留原文件并清理 staging；已有失败替换用例本轮一直通过。
- 以上检查没有发现可以凭现有日志直接确认的锁遗漏或并发丢写。**不据猜测增加文件重试、吞 IO、放宽锁权限或延长 timeout。**
- `server.mjs` `/api/shutdown` 先返回 ACK，再 setImmediate 调用 `server.close`，close 时关闭 SQLite、释放 workspace lock。实际重复都观察到正常退出；不能据一次历史 null 认定关闭回调必然死锁。
- 本轮没有进行“全量同样资源压力下”的重跑。后续全量若失败，新增输出可分辨具体存储分类/阶段、进程 signal 和关闭观察状态；仍须据实际失败定位，不提前归因为环境资源竞争或 Windows 防护。

## 6. 安全、清理与状态

- 本轮使用测试创建的临时根、临时 SQLite、合成凭据；真实业务根/AI Key/profile 均未访问。
- 20 个 credential 主进程正常退出，并完成原 fixture 的临时目录清理；其跨进程子用例也正常结束。10 个 sidecar 均观察到 exit 与 close，随后原 fixture 完成其所有权校验和临时资源清理；没有对来源不明目录执行额外删除。
- `git diff --check -- desktop/tests/AiBridgeCredentialRuntime/Program.cs scripts/stage55b/workspace-queries.test.cjs`：通过，仅显示仓库既有 LF/CRLF 提醒。
- 本任务不提交、不改生产 gate、不执行全量或 WinUI 构建。两测试文件完成后冻结，交 root 统一回归与提交。

结论：**本轮独立重复均通过，原始两个失败尚未复现，根因未证实；只能确认可观测性已补足，不能宣称这两个未知失败已经修复。** S1 Gate 由 root 在完整回归和既有验收标准下判定；生产入口保持 **FROZEN**。
