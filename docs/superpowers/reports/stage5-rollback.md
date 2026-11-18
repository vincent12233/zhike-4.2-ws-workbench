# 阶段 5 回滚与残留

日期：2026-11-16（Asia/Calcutta）。基线：ad7749f；实现提交：7667837；分支：fix/zhike-61-p0-infrastructure。

环境：Windows 11 专业版 10.0.26300 x64，Node 24.22.1，仓库 .tools/dotnet10。报告随独立文档提交保存，文档最终提交号由 git log -1 给出。生产入口：FROZEN。

## 代码

回滚基线是 ad7749f，阶段 5 实现为 7667837。优先在单独审查分支执行 git revert 7667837 后重跑回归；不要 reset --hard 或删除用户工作区。该说明没有实际执行回滚。

## 数据

本轮无生产数据迁移，不需要恢复生产库。隔离升级 025 仅验证临时副本。将来若经授权在真实库执行，必须先关闭全部写入者，创建带校验的 SQLite 备份并保存匹配版本；失败时关闭程序，恢复该备份至独立验证路径，检查完整性、版本、关键记录，再按授权替换。025 不提供直接降级 SQL，不能让旧二进制盲目打开新库。

含原 024 错误 checksum 元数据的库仍拒绝升级，不能通过手工覆盖清单/记录绕过。生产恢复/迁移工具未在本阶段启用。

## 清理与残留

Stage5 harness 在 finally 中关闭临时 SQLite、测试 Worker 与 pipe，删除其临时根。WorkerAiIntegration 输出 stopped=true、tempRootClean=true。最终进程检查没有遗留本轮 WorkerAiIntegration、WorkerRuntimeIntegration、WorkerSupervisorRuntime；没有操作已有用户应用。

以下本轮诊断资源已核实，但删除命令被自动审批拒绝，未绕过，仍待清理：

- C:\\Users\\酷酷\\AppData\\Local\\Temp\\zkdbg-Itodox（隔离空业务库）
- C:\\Users\\酷酷\\AppData\\Local\\Temp\\zkdbg-zEtkEF（隔离空业务库）
- C:\\Users\\酷酷\\AppData\\Local\\Temp\\mig024.sql（仓库 SQL 校验副本）

命令：Remove-Item -LiteralPath 上述确切目录 -Recurse -Force / 对 SQL 文件 -Force。执行结果：blocked by policy。没有删除其他用户数据。构建 bin/obj 是被 Git 忽略的本机构建输出，未打入正式安装包。

## 当前边界

生产入口 FROZEN；未连接真实 WhatsApp，未启用正式 Worker/AI，未双写；不发布安装包。先处理 UI 隔离验收、旧 checksum 兼容审核与上述残留，再申请下一阶段。
