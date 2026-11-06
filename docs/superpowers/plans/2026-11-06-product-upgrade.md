# 知客产品级升级 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 一次性提升导入准确性、日期字段一致性、性能、WS 同步、AI 跟进提醒和备份验证能力。

**Architecture:** 继续复用现有单体 Electron 渲染层和本地数据库，在现有字段上增加兼容归一化与显示规则；导入先解析、预览、校验，再原子写入；WS 与 AI 保持独立失败边界。

**Tech Stack:** Electron 45、原生 JavaScript、Node 24、本地 HTTP/SQLite、现有回归脚本。

**Spec:** 用户提出的“是否还有需要升级的项 / 一次性升级”。

## Global Constraints

- 不删除现有功能、业务数据和统计口径。
- 不预置演示数据，不操作真实业务数据。
- 导入失败必须保留原始内容并可恢复。
- 所有新增行为必须通过回归测试验证。

## Review Focus

- 导入文件含历史登记日期时，登记日期不能被当天覆盖。
- 登记日期与下次跟进日期必须能独立显示和保存。
- 10,000 和 50,000 客户搜索、筛选、切换不能出现明显退化。
- WS 断线、重复消息和页面结构变化不能破坏客户同步。
- AI 分析失败不能阻塞客户资料和跟进记录保存。

### Task 1: 日期和智能导入

**Files:** `resources/app/app.js`, `resources/app/modules/smart-import.js`, `tests/project-audit-regression.test.cjs`

- [x] 增加登记日期/下次跟进日期兼容归一化规则。
- [x] 导入预览中显示原始日期、标准日期和字段来源。
- [x] 为 Excel 序列日期、中文日期、带时间日期增加回归断言。

### Task 2: 性能与数据一致性

**Files:** `resources/app/app.js`, `resources/app/modules/performance-enhancements.js`, `tests/performance-scale.test.cjs`

- [x] 保持索引缓存、筛选防抖和分页边界稳定。
- [x] 增加导入批次原子写入、重复键和失败回滚断言。

### Task 3: WS 与 AI 跟进

**Files:** `resources/app/modules/ws-workbench.js`, `resources/app/modules/ws-workbench-core.js`, `resources/app/modules/gpt-assistant.js`

- [x] 增加同步游标、重复消息去重和断线恢复状态。
- [x] 增加 AI 跟进建议的优先级、原因、提醒时间和已处理状态。

### Task 4: 备份、版本和验收

**Files:** `tests`, `docs`, `resources/app/package.json`, `resources/app/index.html`

- [x] 完成全量测试和安装包隔离/覆盖安装验证。
- [x] 更新版本号、修复清单和测试报告，生成安装包。
