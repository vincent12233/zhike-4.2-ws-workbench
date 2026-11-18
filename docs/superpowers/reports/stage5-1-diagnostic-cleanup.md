# 阶段 5.1 诊断资源处理

日期：2026-11-16。输入：阶段 5 验收及回滚报告列出的三处资源。仅使用本轮明确授权处理诊断残留，未触及生产目录。

| 精确路径 | 归属核验 | 处理结果 |
| --- | --- | --- |
| `C:\Users\酷酷\AppData\Local\Temp\zkdbg-Itodox` | 阶段 5 诊断工作区，非 reparse point；已知锁 PID 26560 不存在；临时库业务记录均为 0 | 按实际清单逐文件删除，再删除空目录；最终 Test-Path=False |
| `C:\Users\酷酷\AppData\Local\Temp\zkdbg-zEtkEF` | 同上；客户、会话、消息、AI Job、成员均为 0，只有默认账号；无运行进程或代码引用 | 按实际清单逐文件删除，再删除空目录；最终 Test-Path=False |
| `C:\Users\酷酷\AppData\Local\Temp\mig024.sql` | SHA-256 与仓库当前 024 SQL 完全相同（9dc642…）；仅诊断副本 | 精确文件删除；最终 Test-Path=False |

删除前检查了解析绝对路径、资源归属、无符号链接和锁/进程情况。仓库引用仅存在于阶段 5 报告。临时库只在明确诊断目录内只读检查，未读取生产 SQLite。

本轮使用 PowerShell `Remove-Item -LiteralPath` 删除明确清单内的文件及空目录，未使用 `-Recurse` 或 `-Force`，没有自动审批拒绝，也未使用其他 shell 绕过。阶段 5 曾被拒绝的历史记录仍属实；本轮新授权下已安全完成处理。

结论：三处既有诊断残留均已清理，`Passed`。原生验收新创建的测试根、进程及证据处理另在原生和资源报告中记录，不能用本表推断其自动清零。

## 本轮新增临时资源（与以上三处区分）

以下三处均核实为本轮创建的隔离测试根：

- `C:\Users\酷酷\AppData\Local\Temp\zhike-stage51-native-248a3820ba4f4b6abbfa8c09fd957da5`：第一版启动诊断根。
- `C:\Users\酷酷\AppData\Local\Temp\zhike-stage51-native-92eccfc80f164b15b7fcd1618058cb21`：V2–V4 原生 UI、合成 SQLite、空白 WebView2 profile、资源日志与私密临时连接文件。
- `C:\Users\酷酷\AppData\Local\Temp\zhike-stage51-native-95d5941432654bf9906247471c41ddce`：未启动的 prepare 根，仅隔离标记文件。

在执行递归清理前准备了精确绝对路径、直接 TEMP 父目录、marker、非 reparse 根与子目录、已知测试进程不存在的校验；未使用 `-Force`。但整条清理命令在 CreateProcess 前被自动审批拒绝，原因仅为 `blocked by policy`。该命令中的复制与删除均未执行。**没有改用逐文件删除、其他 shell 或其他工具绕过此拒绝，三目录保留，状态 Blocked / NotCleaned。**

之后仅单独归档了非敏感资源样本及白名单生命周期事件，没有复制 `connection.private.json`、业务库、profile 或凭据。原始日志仍保留于上述临时根。

最后 PID 31928 真实正常关闭后，已观察的 21 个进程身份、sidecar 监听均为 0，锁文件已清除；保留目录不能与存活后台进程混为一谈。临时 API token 所属服务已退出，私密文件仍受该隔离目录的当前用户 ACL 保护，没有进入 Git。

建议人工处理：在确认没有新的测试会话后，逐一核对上述三个精确目录的隔离标记和归属，再通过资源管理器移入回收站；不要删除其他相似前缀目录或 `%LOCALAPPDATA%\Zhike6`。本轮不继续尝试删除。
