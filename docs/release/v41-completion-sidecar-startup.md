# V4.1 档案摘要侧车启动记录

完成批次最终全量的 `WS data archive summary bridge` 在第一个 `POST /api/state` 等待 HTTP 响应时失败。失败位置为当时的 `tests/data-archive-summary.test.cjs:26,42`，原日志为 `.tools/v41-completion/final-full-regression.log` 第 909–913 行。档案摘要的账号隔离与计数断言尚未执行。

## 失败夹具的只读核验

对本次新建的合成临时夹具，使用 Node.js 随附 SQLite，以 `readOnly: true` 和 `PRAGMA query_only=ON` 查询原有数据库及 WAL 可见的元数据。仅查询 `PRAGMA user_version`、`schema_migrations` 的条数、最高版本及末次提交时间，以及 `sqlite_master` 的指定表存在性。下列时间为 2026-11-18 UTC。

|证据|结果|
|---|---|
|临时夹具创建|06:20:29.748|
|SQLite 文件建立|06:20:31.568|
|只读 schema| `user_version=18`，迁移账本 15 条，最高 018。末次迁移提交 06:20:44.045。|
|关键表| `ws_accounts` 存在，019 应创建的 `app_state` 尚不存在。|
|WAL 末次写入|06:20:44.048|

侧车串行完成启动迁移后才监听 HTTP。这份夹具停在迁移阶段，证据不支持把该次失败归为固定端口 4599 的绑定冲突。旧测试忽略子进程 stdout 和 stderr，也未记录退出时间。现有证据无法区分迁移异常退出和重试用尽时迁移尚未结束。较早一轮通过以及本轮其他侧车启动时序只用于对照。 [侧车启动顺序](../../resources/app/server.mjs#L108) · [原有迁移](../../resources/app/migrations/019-crm-base-schema.sql)

## 测试诊断

仅档案摘要测试复用现有启动观察器。仍以 300 次、40 ms 的重试配置发送原请求，原业务断言和关闭流程保留。观察器收集有界、脱敏 stderr、进程启动与实际退出状态及最后一项传输错误。生产侧车和迁移代码未改。 [档案摘要测试](../../tests/data-archive-summary.test.cjs) · [启动观察器](../../tests/helpers/sidecar-startup-observer.cjs)

Windows 随附 Node.js `v24.22.1` 实际运行 `node --check tests/data-archive-summary.test.cjs` 及 `node --test tests/sidecar-startup-observer.test.cjs`，语法检查通过，观察器 6 个受控子进程用例全部通过，记录残留 0。此次定向核验没有启动真实 sidecar。原全量失败保留。

## 单项复跑

全量结束后，按同一 `300 × 40 ms` 配置运行了一次 `node tests/data-archive-summary.test.cjs`。复跑使用提交 `8a9e4c8`，诊断测试、观察器、侧车及迁移源码与集成提交 `c29db87` 的对应文件一致。实际退出码为 **0**，档案、CRM 关联、WS 计数及账号隔离断言通过。随后另做的只读检查未见 4599 监听或本次留下的夹具目录。 [原始输出](evidence/v41-archive-summary-replay/data-archive-summary.log) · [复跑元数据](evidence/v41-archive-summary-replay/run.json) · [SHA-256 清单](evidence/v41-archive-summary-replay/manifest-sha256.json)

复跑后的记录脚本未保存精确进程耗时。元数据保留原输出文件的创建与最后写入时间。原全量仍为 **292/298**，包含本项的启动失败。
