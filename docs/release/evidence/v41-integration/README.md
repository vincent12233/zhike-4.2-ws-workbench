# V4.1 集成回归证据

## 全量回归

命令为 `resources/app/node.exe scripts/run-tests.cjs all`。三轮退出码均为 1。各轮单独核对，不合并局部成功结果。 [运行索引](runs.json)

|轮次|代码提交|通过|失败|日志|
|---|---|---:|---:|---|
|r1|`dbc3709`|289|3|[全量日志](r1/full-regression.log) · [退出码](r1/full-regression.exit)|
|r2|`906bb61`|289|3|[全量日志](r2/full-regression-final.log) · [退出码](r2/full-regression-final.exit)|
|r3|`88cf98b`|292|1|[全量日志](r3/full-regression-r3.log) · [退出码](r3/full-regression-r3.exit)|

r2 的 Stage51 在该次 30 秒期限内未核实 Edge 退出。r3 唯一失败为 `Delivery S1 WS computed layout and retained host`。Edge `--dump-dom` 子进程在已有的 45 秒期限内返回 `ETIMEDOUT`，日志含合成页面的部分输出。页面布局及对比度断言未运行。当前证据无法确定浏览器、输出流或退出阶段的具体原因。 [WS 超时记录](r3/ws-browser-timeout.json)

r3 共 293 个顶层运行标签。按提供的 WS 标签逐项精确匹配，162 个标签均在同一份全量日志中出现一次 `[RUN]`，并各自以同名 `[PASS]` 结束。**这是 r3 的 162/162 子集，未单独运行。** 唯一失败的 S1 WS 视觉检查在这 162 个标签之外，仍计入整轮失败。 [WS 标签原文](r3/ws-suite-labels.json) · [逐项核对](r3/ws-suite-verification.json)

## 局部诊断与构建

- CRM 和 WS 视觉局部运行在 `139bd42`，仅记录各自的隔离 Edge 范围。 [CRM 局部日志](diagnostics/main-visual-fixed.log) · [WS 局部日志](diagnostics/ws-visual-fixed.log)
- GPT 首次局部诊断保留原 45 秒 `ETIMEDOUT` 失败。后续在 `0228a36` 单独运行 GPT 视觉诊断，实际生成 8 个场景结果，退出码 0。 [首次失败](diagnostics/gpt-visual-fixed.log) · [8 场景结果](diagnostics/gpt-visual-diagnostic.log) · [退出码](diagnostics/gpt-visual-diagnostic.exit)
- 隔离 WinUI Release 在 `c586250` 编译完成，0 警告、0 错误、30.65 秒。正常 Release 在 `906bb61` 编译完成，0 警告、0 错误、27.57 秒。最终正常 Release 在 `0228a36` 编译完成，0 警告、0 错误、20.11 秒，退出码 0。 [隔离构建](build/native-build.log) · [初次正常构建](build/release-build.log) · [最终正常构建](build/release-build-final.log) · [最终退出码](build/release-build-final.exit)

S3 仍为 **BLOCKED**，生产仍为 **FROZEN**。本目录记录合成夹具的测试和构建，真实 Windows 交互、实际授权平台能力及生产门槛见专项报告。 [原生验收](../../v41-native-acceptance.md) · [WS 能力审计](../../v41-ws-capability-audit.md)

## 归档处理

清单对本轮每份源证据分别记录原始与归档的 SHA-256 和字节长度。本机路径用 `<repo>`、`<test-temp>` 或 `<edge>` 替换，完整 Windows 用户 SID 用占位符替换。r3 中合成页面的 6,006 个日志字节以一条标记替代，保留超时、断言状态和轮次结论。三轮汇总失败行原有的尾随空格已清除。归档仅收录日志、已判定的用例标签、退出码和派生元数据。敏感模式扫描覆盖凭据、完整电话号码、邮箱、WhatsApp ID、调试地址和页面 HTML。 [SHA-256 清单](manifest-sha256.json) · [敏感扫描](sensitive-scan.json)
