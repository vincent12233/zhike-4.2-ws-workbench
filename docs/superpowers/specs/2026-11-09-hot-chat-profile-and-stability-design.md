# 热聊客户资料与 AI 跟进升级设计

## 目标

在现有知客客户库、WS 工作台和 AI 跟进链路上增加一套“热聊客户资料档案”。系统从日常聊天中自然提取资料，不把聊天变成连续问卷；AI 只使用真实消息证据逐步补齐客户资料，避免重复询问，并为下一次自然跟进提供话题和提醒。

本设计同时纳入前一轮确定的 12 项升级建议：真实 WS 链路、AI 跟进闭环、退出保存保护、桥接错误诊断、性能/大数据量、账号稳定性、Docker/PostgreSQL 运维、安装升级、错误中心、导入智能化、全页面回归和可观察性。

## 资料范围

热聊档案至少覆盖以下字段：

1. 客户姓名或称呼
2. 年龄
3. 性别
4. 职业及工作情况
5. 是否为股民
6. 股龄及投资经验年限
7. 当前持仓、投资习惯和偏好
8. 家庭状况、生活兴趣和未来规划

同时保留现有客户字段：电话、国家/地区、语言、来源、产品兴趣、预算、阶段、意向、情绪、标签、备注、跟进日期和 AI 摘要。

## 非目标与约束

- 不删除或改写原有客户业务逻辑、跟票/入金独立记录规则和统计口径。
- 不自动发送消息，不要求客户连续回答八项问题。
- 不把推测当成事实；没有证据的字段保持为空或标记为“待确认”。
- AI 只允许补空字段；已有人工资料冲突时进入待确认，不直接覆盖。
- 不保存密码、Cookie、二维码、秘密 Token；真实 WS 登录和手机同步仍需用户授权的现场验收。
- 个人/家庭信息属于敏感资料，默认只在本机显示，日志和导出必须脱敏。

## 现状与复用边界

- `customer-governance-core.js` 已有 AI 字段证据、只补空字段、冲突和软删除能力；扩展其字段映射和证据元数据。
- `ws-workbench-core.js` 已有 AI JSON 解析、客户匹配、消息上下文和跟进计划；扩展输出契约，不另建一套匹配规则。
- `ws-crm-sync-core.js` 已有客户合并、WS 账号隔离和提醒去重；热聊档案挂在同一客户/会话身份上。
- PostgreSQL `ai_analysis_results` 与 `ai_field_observations` 已能保存原始分析和字段证据；增加热聊档案/沟通进度的版本化迁移。
- 热聊管理页、WS 辅助栏、首页 AI 跟进雷达和 AI 跟进页复用同一档案服务。

## 构建方案比较

### A：只扩展提示词和 JSON

改动最小，但资料进度、证据、颜色分类和缺失字段无法稳定持久化；长期使用容易重复询问。放弃。

### B：把全部字段直接加到客户主表

查询简单，但会扩大核心客户表、增加迁移风险，也无法表达同一字段的多条证据和历史变化。放弃。

### C：混合方案（选定）

保留现有客户表兼容字段；新增独立热聊档案、字段证据、信息缺口、沟通进度和颜色分层结构。AI 分析先写分析与证据，再以事务方式把可信的空字段补入客户库。这样既不改变旧业务格式，又能支持“已知/缺失/待确认/下一步话题”的完整工作流。

## 数据模型

新增迁移（SQLite 与 PostgreSQL 各一份，编号由实施计划确定）：

- `hot_chat_profiles`：`customer_id`、`conversation_id`、`account_id`、`completeness_score`、`status_color`、`conversation_stage`、`last_progress_at`、`next_topic`、`no_reply_reason`、`next_followup_at`、`version`、创建/更新时间。
- `hot_chat_profile_fields`：每个资料字段一行，包含 `field_name`、`value_json`、`state`（known/missing/pending/declined）、`confidence`、`source_message_id`、`source_quote`、`analysis_id`、`last_asked_at`、更新时间。
- `hot_chat_events`：自然话题、客户回应/未回应、颜色变更、AI 建议和人工确认的审计事件；不保存秘密凭据。

字段键固定为：`preferred_name`、`age`、`gender`、`occupation`、`work_context`、`is_investor`、`investment_years`、`holdings`、`investment_habits`、`investment_preferences`、`family_context`、`life_interests`、`future_plans`。

## AI 输出契约

AI 必须返回结构化 JSON（解析失败则只保存原文）：

```json
{
  "profileFacts": {
    "preferred_name": {"value": "", "confidence": 0, "evidence": ""},
    "age": {"value": null, "confidence": 0, "evidence": ""},
    "gender": {"value": "", "confidence": 0, "evidence": ""},
    "occupation": {"value": "", "confidence": 0, "evidence": ""},
    "work_context": {"value": "", "confidence": 0, "evidence": ""},
    "is_investor": {"value": null, "confidence": 0, "evidence": ""},
    "investment_years": {"value": null, "confidence": 0, "evidence": ""},
    "holdings": {"value": [], "confidence": 0, "evidence": ""},
    "investment_habits": {"value": [], "confidence": 0, "evidence": ""},
    "investment_preferences": {"value": [], "confidence": 0, "evidence": ""},
    "family_context": {"value": "", "confidence": 0, "evidence": ""},
    "life_interests": {"value": [], "confidence": 0, "evidence": ""},
    "future_plans": {"value": "", "confidence": 0, "evidence": ""}
  },
  "knownFacts": [],
  "missingFields": [],
  "conversationProgress": "",
  "customerTemperature": "hot|warm|cool|silent",
  "statusColor": "green|blue|amber|red|gray",
  "naturalNextTopics": [],
  "noReplyAssessment": "",
  "followup": {"shouldCreate": false, "reasonKey": "", "dueAt": null, "priority": "normal", "detail": ""},
  "confidence": 0,
  "warnings": []
}
```

规则：

- 只有带有原文证据且置信度达到配置阈值的事实才可自动补入客户库。
- 已存在的人工值不覆盖；冲突写入待确认观察记录。
- `missingFields` 只用于选择自然话题，不直接生成“请回答以下问题”的问卷。
- 回复建议必须围绕客户已表达的兴趣、市场新闻或生活话题，并标记“仅预览/复制”。
- 付款、退款、验证码、身份、金融保证等敏感内容禁止自动发送。

## 颜色与跟进规则

颜色不是客户价值判断，而是沟通状态提示，可配置且可人工覆盖：

- 绿色：资料较完整、近期有回应，保持适度维护。
- 蓝色：资料不完整但愿意交流，按缺口选择一个自然话题。
- 琥珀色：有意向或投资需求，但近期互动下降，需要调整话题和频率。
- 红色：明确待跟进、重要需求或高紧急度。
- 灰色：暂时沉默/不确定，不重复催促，等待合适时机。

AI 自动改变颜色时必须写入事件；人工颜色优先级高于 AI，直到用户解除锁定。

## 页面行为

- 热聊管理增加“资料完成度、状态颜色、已知信息、缺口、下一话题、最后进展”列和筛选。
- 客户详情增加“热聊档案”卡片，展示证据原文、AI 置信度、待确认冲突和人工锁定状态。
- WS 右侧 AI 面板显示“本次新增事实 / 未完成资料 / 建议自然话题 / 下一次跟进”，不显示调查式问题列表。
- 首页 AI 跟进雷达复用热聊档案状态，点击后进入对应会话和客户资料。
- 颜色、完成度和资料状态均支持手动修改并保留审计记录。

## 同步、性能和运维升级范围

同时纳入前面确认的 12 项升级：

1. 真实 WS 登录、列表级采集、手机同步和页面结构漂移检测。
2. AI 真实服务超时/额度/格式错误、重试、死信和提醒去重。
3. 退出前 flush、写入日志、崩溃恢复和未保存提示。
4. 桥接错误分类、诊断和一键重连。
5. 10k/50k+ 数据虚拟滚动、增量同步、搜索退避和内存监控。
6. 多账号启动、切换、重启状态恢复和隔离队列。
7. Docker/PostgreSQL 启动检查、迁移锁、内存/磁盘告警和恢复演练。
8. 安装包签名、WebView2/Runtime 检查、升级和回滚保护。
9. 统一错误中心、脱敏诊断导出和关联 ID。
10. 混合导入置信度、用户纠正记忆、日期/渠道/状态/股票方向识别。
11. 全页面视觉、键盘、缩放和空状态回归。
12. 热聊档案、AI 跟进、备份恢复和数据治理的端到端测试门禁。

## 验收标准

- 现有客户库、跟票、入金、VIP、统计和导入功能回归不变。
- 同一客户的新聊天只补空字段；不重复创建客户、不重复写入资料或提醒。
- 每条自动补齐字段都能追溯到消息、分析 ID、置信度和时间。
- 热聊客户能看到当前进度、缺口、颜色和下一步自然话题。
- 客户不回复时不会连续催促；系统能给出原因判断和调整建议。
- 关闭翻译或 AI 后不调用对应服务；WS 断开不影响知客其他页面。
- 真实 WS、AI 服务、备份恢复、安装升级和 820×540/高 DPI 门禁均有实际运行记录。

## 已确认的实施决策

- 存储采用混合离线方案：SQLite 保证桌面离线可用，配对 Docker PostgreSQL 后通过幂等 outbox 增量同步；服务器暂时不可用不阻塞本机保存，版本冲突进入待确认。
- 档案按“客户 × WS 账号 × 会话”保存证据和沟通进度，同时维护客户级汇总档案；客户主资料仍执行只补空字段规则。
- AI 继续使用现有 Provider 抽象和已配置的 TeamoRouter；不在代码或日志中写入 Key。
- 真实 WS 登录、手机同步和页面长期兼容作为现场验收门禁；自动化阶段先使用隔离 fixture、协议测试和可复现的人工操作记录。
- 敏感家庭/生活资料默认只在本机和已配对数据库中保存，日志与诊断导出脱敏；不新增自动外发渠道。
- 颜色、人工锁定、冲突确认和提醒去重采用现有本地治理/审计模式，新增字段状态机保持可回滚。

## Builder review 处理

Builder review 提出的部署位置、连接器备用入口、正式数据迁移时机和真实账号验收问题不改变本轮代码接口：本轮在现有桌面副本中先完成可回归的离线/协议实现，保留 WinUI WebView2 本地 WS 连接器和 Docker Connector 两个入口，不迁移真实数据；真实账号验收单独记录，不把 fixture 结果写成真实通过。



