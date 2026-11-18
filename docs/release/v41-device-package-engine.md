# V4.1 加密设备迁移包引擎

本轮交付为可独立调用的 `.zkdevice` v1 读写、校验和解包引擎。输入是调用方显式提供的 schema 025 业务快照投影和媒体清单。清单固定标记 **`partial`**，记录实际带入的 CRM、WS 和媒体范围。旧快照即使没有媒体索引，也保持 `partial`。生产入口保留 **FROZEN**，现有 JSON 备份和恢复入口照常沿用原契约。 [引擎](../../resources/app/device-migration-package.cjs) · [现有业务与备份契约](business-contract-baseline.md)

## 已验证范围

引擎使用异步 scrypt 派生密钥，随机盐和 nonce 前缀，逐帧 AES-256-GCM 确认内容、长度和顺序。上限为快照 32 MiB、单件媒体 24 MiB、总包 2 GiB。密码仅参与内存计算。解包验完快照及所有媒体后返回新建暂存目录。包内路径字段不能作为文件地址。输入只访问明确指定的文件，嵌套规则检查已知凭据和登录状态字段名。业务自由文本及其他未识别字段仍取决于上游白名单投影。 [引擎测试](../../tests/device-migration-package.test.cjs)

Windows 临时文件专项验证了多帧往返、错密码和认证错误、帧重排、截断及多余数据、覆盖和去重校验、账号与大小限制、路径穿越与链接拒绝、失败清理、并发防覆盖、当前用户专用暂存 ACL、嵌套凭据别名及旧数据缺媒体索引。在两个定点替换模拟中，目标或暂存文件换成其他文件后拒绝成功且保留替代文件。调用方要控制所用目录。路径复核无法在同权限外部进程并发改写时提供原子身份条件删除。

## 实际测试记录

在独立 worktree 根使用主仓随附 Node.js **v24.22.1**。两次均执行以下命令，`$node` 指向主仓的 `resources/app/node.exe`，`$log` 指向相应原日志。

```powershell
& $node --test 'tests/device-migration-package.test.cjs' *> $log
```

|代码提交|原日志相对路径|结果|原日志 SHA-256|
|---|---|---|---|
|`cccf656`| `.tools/v41-device-package/engine-node.test.log` | 6/6 通过，23.180 秒 | `303900cac10e4de59e912059a4516c7b6731e45e6702d8d8d2851bde1891bc4c` |
|`7b30a20`| `.tools/v41-device-package/engine-review.test.log` | **10/10 通过**，28.231 秒 | `7df9c8e7ff94291084a86592d2e12ec015f69a7458caa17499942746af63d7ca` |

两份原日志留在开发 worktree，仅记录用例、耗时与汇总。测试只使用合成资料和隔离临时文件。

## 完整迁移仍缺的环节

- **权威数据覆盖仍缺。** 需明确 019/021 客户及身份冲突、015 监测目标与事件、022 `customer_group_memberships`、023 群成员、消息、阅读证据与审计，以及 020/024 AI 任务、建议、证据、审核与审计的取数和恢复所有者。011 热聊档案人工字段、历史及同步 outbox 也需逐表核对。旧会话九段可作为输入，不能代表完整任务、人工锁、历史或权威关系已恢复。 [CRM 身份迁移](../../resources/app/migrations/021-crm-authority.sql) · [成员关系](../../resources/app/migrations/022-ws-group-identity.sql) · [群管理](../../resources/app/migrations/023-ws-group-manager.sql) · [AI 审核](../../resources/app/migrations/024-ai-pipeline-crm-review.sql)
- **附件关系仍缺。** 媒体字节按清单校验后可暂存。实际目标库里的 `ws_media_assets` 行、`ws_send_attachments` 引用、发送审计关联、文件布局、不可用状态及清理所有权仍需统一恢复和核对。 [媒体与附件结构](../../resources/app/migrations/018-ws-export-media.sql)
- **一致性、应用和兼容仍待评审。** 需由既有权威服务产出同一时点的业务快照，目标先在临时库执行预检，明确旧 JSON 和 schema 兼容、账号及 ID 冲突、覆盖或合并规则、附件引用、任务状态和失败回滚，再单独审批业务库替换事务。现有 JSON 恢复的逐账号补偿与 CRM 快照不足以证明全资料原子应用。本轮没有跨机器迁移试验或生产入口，也未修改数据库迁移。完整恢复仍按 RD03/RD04 评审。 [旧备份风险与兼容约束](risk-register.md)
