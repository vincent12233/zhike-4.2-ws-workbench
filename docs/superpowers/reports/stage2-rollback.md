# 知客 6.1 阶段 2 回滚说明

## 回滚点

- 阶段 2 受控集成提交：`04144f4`
- fencing gate 提交：`c92bd64`
- fail-closed 修正：`4f956b7`
- 阶段 1.7 基线：`118cffb`

## 回滚方式

1. 停止桌面应用和任何隔离测试进程。
2. 将代码 checkout 到 `118cffb`（或先回退 `4f956b7`、`04144f4`、`c92bd64`）。
3. 不删除 `%LOCALAPPDATA%\Zhike6` 客户数据；本阶段没有迁移或回填。
4. 删除测试项目生成的临时目录（测试本身已清理），不触碰生产数据目录。
5. 重新执行 `node scripts/run-tests.cjs all` 和 WinUI 编译，确认旧路径恢复。

本阶段没有修改 schema、迁移 manifest、客户主档、WS 消息、AI 历史或群组业务数据，因此不需要数据回滚脚本。
