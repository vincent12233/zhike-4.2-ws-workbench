# 阶段 5.1 回归、修复与最终 Gate

日期：2026-11-16。输入基线 `e11b318`，实现基线 `7667837`；代码提交 `3591212`，分支 `fix/zhike-61-p0-infrastructure`。本报告另作独立 Git 提交；最终回复记录报告 SHA 和工作区状态，避免自引用提交哈希。

## 真实执行

| 命令 | 本轮结果 | 说明 |
| --- | --- | --- |
| `node scripts/run-tests.cjs stage5` | 9/9 Passed | 实际隔离业务链、迁移/恢复、UI/controller、安全和索引查询性能 |
| `node scripts/run-tests.cjs stage51` | 独立执行时 8/8 Passed | 随后加入实际布局例；最终 all 中完整 9/9 Passed。未将 8 写成独立 9 |
| `node scripts/stage51/workspace-layout.test.cjs` | Passed | 真实 Edge computed layout：214→56，内容增 158，主侧栏 240 不变，小窗口仍 flex |
| `node scripts/run-tests.cjs ws`（首次） | 148/149 | CRM identity 例 isolated server readiness 超时；无 stdout 可唯一归因，当时有并行测试/构建，但不能把负载当作已证明原因 |
| `node tests/ws-crm-link-trust.test.cjs` | Passed | 原例直接重跑，未改业务或放宽断言 |
| `node scripts/run-tests.cjs ws`（完整重跑） | 149/149 Passed | `.tools/stage51-ws-final.log` |
| `node scripts/run-tests.cjs all` | **256/257，1 Failed** | controlled Worker 生命周期外层 spawnSync ETIMEDOUT；其他检查通过，完整失败保留 |
| `node scripts/stage51/verify-native.cjs <隔离根>` | Passed | 原生 UI 审核后实际 Service GET 回读，2 客户、已应用/冲突/拒绝及审计各一次、另一账号候选未变 |
| 缺省 WinUI Release 命令（下列） | Passed | 0 warnings / 0 errors，19.16 秒，不带测试 symbol |
| `git diff --check` | Passed | LF/CRLF 提示不属于空白错误；没有修改历史迁移 SQL |

```powershell
.tools\dotnet10\dotnet.exe build desktop/src/Zhike.Desktop/Zhike.Desktop.csproj -c Release --no-restore -p:Platform=x64 -r win-x64 --nologo -v:minimal
```

全量中的 9 个 Stage 5.1 顶层检查包括：实际折叠布局、旧 024 真实启动兼容、原生入口路径/ACL 隔离、独立 Worker 生命周期资源包装、成员 API/UI 绑定、真实 Service 审核 UI、扩展既有滚轮运行测试、资源检查器身份安全、无 UI 消息泵 sidecar readiness/有界关闭。它们不是 9 项新业务功能；滚轮例复用了既有测试。全量中后续独立 Worker 包装成功不能覆盖前面同一生命周期族出现的超时。

## 日志指纹

完整命令日志保留在本机 ignored `.tools`；不包含真实业务凭据。SHA-256：

- `stage51-stage5-tests.log`：`416d8683fa2a65dc0cfa4b8a1d1f5bec5ab8e69b83950aebedda2a874c13922e`
- `stage51-ws-tests.log`（首次失败）：`5f45a92d3c2e6d9b74199600bba4889cc4dcad7ef28f4870933d86314230a2a0`
- `stage51-ws-final.log`：`65fd87548f0e524390cb2fa2bb78c2c4cf3114416a38e7b34f6532eed00aef7b`
- `stage51-full-tests.log`：`4aba6e95d8d77d8eb104a8a247f0921af631ec992d2b549d00a9d51b329067ce`

全量第 246/258 行记录生命周期 RUN/FAIL；外层总 120 秒包含内层构建，内层 exe 又有 120 秒预算，外层先结束造成诊断输出缺失。这只是诊断预算缺口，不能解释或消除实际卡顿。没有步骤轨迹证明卡在哪一阶段，未修改 Runtime/Supervisor、未盲目重跑失败例或放宽预算。详见生命周期超时附件。

## 性能观测

本轮阶段 5 查询性能例：122004 条合成记录、700 次实际索引查询；group p95=0.481ms、member=0.070ms、AI queue=0.817ms、CRM review=0.703ms；该次 RSS 增 30535680 字节。仅合成 SQLite 查询，不等同桌面帧率/Worker 吞吐。

原生 V3：61 次/622.3 秒，工作集 889303040→1335459840 字节，私有内存 496951296→732925952，线程 228→382。后期原生补验 Core 恰为 shell+两账号共 3，快速切换没有额外 Core，正常关闭后 21 个观察身份全部退出。然而 about:blank/失败恢复导航循环已确认干扰观察，不能据此判定正常 WS 性能达标。项目没有已定义阈值，本轮没有发明阈值。原始资源样本已归档；生命周期事件文件为有限首尾采样，完整计数和原始日志 SHA 单独保留，原始日志留在被拒清理的临时根。

## 安全及回滚

- 仅白名单源码/资源复制到测试构建，没有复制现有 data、真实 profile、Cookie、Token 或 AI Key。
- 测试编译开关才将路径映射到带标记的临时根并阻止外部 WS/AI；正式 flags 默认 OFF、Supervisor Enabled=false；设置页实测显示 FROZEN。
- 现有 CRM 唯一权威与人工字段保护未改变，普通聊天 AI 未创建未知客户；没有正式消费者、正式 Worker、生产迁移或双写。
- 原三处阶段 5 残留已清理。本轮 native 三目录递归清理遭自动审批拒绝，未绕过；目录保留，最终进程/监听/锁已释放。未把 Git 干净与整机无临时文件混淆。
- 未做整机 ETW 文件审计，不能声称整机其他应用从未访问生产数据。本轮受控应用和测试均显式使用隔离根，未对生产 SQLite 操作。
- 回滚代码可审查后 revert `3591212`；本轮无生产数据库或安装包变更需要回退。保留两个基线提交，禁止覆盖用户数据或强制 reset。

## 最终判定

**Gate：Blocked。生产入口：FROZEN。阶段 6：不允许启动。**

必须先关闭：Worker 并发生命周期超时；隔离导航/恢复反馈及受干扰性能复验；原生内层/代表性多账号稳定性剩余范围；本轮新增目录按既有标准完成受控处理。独立通过不能抵消失败，模拟/空白隔离 WebView 不能冒充真实 WhatsApp 验收。没有发布安装包、启用生产迁移或提升功能开关。
