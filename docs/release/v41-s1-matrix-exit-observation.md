# V4.1 默认主渲染矩阵的 Windows 退出观察

整合全量 `420b9d4` 完成 **306/310**。四个隔离 Edge 视觉检查失败，原 30 秒期限均保留。此前 `22382a2` 的主渲染同样使用默认八视口矩阵，已取得结果，在第 22.154 秒收到关闭应答，期限内缺少根进程退出证明。这次独立观察使用 `420b9d4` 和只改诊断脚本的 `df3129e`。串行全量结束后，只执行一次 S1 默认八视口 × 20 路由矩阵及原有矩阵断言。后续主题、截图和其他浏览器调用留在正式测试中。

## 单次观察结果

矩阵和原断言通过，诊断退出码 0。Windows 观察器按 PID 和创建时间打开 18 个只读同步句柄，包含 PID 11668 的浏览器根。观察器没有启动业务服务，也没有请求终止本次浏览器。下表时间自浏览器 runner 启动计。[runner 元数据](evidence/v41-modern-edge/integrated-matrix-observer/lifecycle.json) · [Windows 观察](evidence/v41-modern-edge/integrated-matrix-observer/observer.jsonl) · [运行结果](evidence/v41-modern-edge/integrated-matrix-observer/result.json)

| 事件 | 耗时 |
| --- | ---: |
| 核验 8 视口结果 | 8.011 秒 |
| 结果就绪并开始关闭 | 8.152 秒 |
| `Browser.close` 应答 | 8.192 秒 |
| CDP 传输关闭，状态码 1000 | 9.092 秒 |
| Windows 同步句柄确认根退出，退出码 0 | 9.956 秒 |
| Node 收到根退出事件 | 10.010 秒 |
| 流全部关闭 | 10.017 秒 |
| 无剩余已观察身份 | 10.064 秒 |
| 身份探针关闭 | 10.093 秒 |

根进程在关闭应答后实际存活 1.764 秒。Windows 记下的退出时间比 Node 事件早 54 毫秒。该次 `forceTerminated=false`、`cleanupSafe=true`，独立观察器以 0 正常退出。该观察没有复现原 30 秒退出超时，四个全量失败仍缺少同一次独立内核退出记录。

## 对应的正式全量失败

| 检查 | 实测阶段 |
| --- | --- |
| S1 主渲染 | 导航已应答，`navigation-load` 在结果截止时仍待完成。未取得矩阵结果，关闭请求未确认，根退出未确认。 |
| S1 WS | 核验 7 个场景，21.204 秒关闭应答，21.208 秒 CDP 关闭，根退出未确认。 |
| S2 指标 | 核验 4 个场景，13.210 秒关闭应答，13.214 秒 CDP 关闭，根退出未确认。 |
| S3 客户表 | `navigation-load` 超时，未取得矩阵结果。28.518 秒关闭应答，28.521 秒 CDP 关闭，根退出未确认。 |

四项均保留 Failed 和 `cleanupSafe=false`。对拥有句柄发出终止请求，探针退出证明均为 `unknown`。这些记录未证明超时前的根进程内核退出状态。当前没有证据定位为 Node 监听注册、输出流等待或 Edge 的某个内部阶段。S3 继续 **Blocked**。[正式全量失败摘录及原始哈希](evidence/v41-modern-edge/integrated-matrix-observer/full-failure-summary.json)

归档仅含生命周期元数据、观察器记录、运行与构建摘要及退出码。原始矩阵正文和计算样式保留在隔离工作树，清单记录其原始文件大小和 SHA-256。[验证清单](evidence/v41-modern-edge/integrated-matrix-observer/manifest.json)
