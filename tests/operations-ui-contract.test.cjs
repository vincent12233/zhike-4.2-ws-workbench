'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'resources', 'app', 'modules', 'operations-ui.js'), 'utf8');

assert.match(source, /\/api\/ws\/followup-action/, 'AI 任务应调用统一跟进动作端点');
assert.match(source, /host\.followupAction \|\| host\.wsFollowupAction/, '应允许宿主注入跟进动作 API');
assert.match(source, /getStateVersion[\s\S]*X-State-Version/, 'HTTP fallback 应携带当前状态版本，避免被并发保护拒绝');
assert.match(source, /Object\.keys\(task\)\.forEach[\s\S]*Object\.assign\(task, snapshot\)/, 'AI 动作失败应恢复完整任务快照');
assert.match(source, /data-ops-ai-action="complete"/, '应提供 AI 任务完成操作');
assert.match(source, /data-ops-ai-action="snooze"/, '应提供延期明日操作');
assert.match(source, /data-ops-ai-action="dismiss"/, '应提供忽略操作');
assert.match(source, /data-ops-ai-action="reopen"/, '已关闭的 AI 任务应支持重新打开');
assert.match(source, /请记录本次实际跟进结果/, '完成 AI 任务前必须登记实际结果');
assert.match(source, /data-ops-customer/, '应支持打开客户档案');
assert.match(source, /data-ops-ai-only/, '应提供 AI 任务筛选');
assert.match(source, /data-ops-owner/, '应提供负责人筛选');
assert.match(source, /data-ops-bucket="\$\{key\}"/, '应提供今日与逾期筛选');
assert.match(source, /statusButton\('dismissed', '已忽略'\)/, '已忽略任务应与真实完成任务分开筛选');
assert.match(source, /core\.taskCompleted\(task\)/, '真实完成统计应使用独立完成语义');
assert.match(source, /core\.taskDismissed\(task\)/, '已忽略统计应使用独立关闭语义');
assert.match(source, /已完成 \/ 已忽略/, '任务指标必须明确区分真实完成与已忽略');
assert.match(source, /customer\?\.rawPhone \|\| customer\?\.phone \|\| task\.phone/, '任务卡应读取现有客户号码以区分同名客户');
assert.match(source, /class="ops-task-contact">客户：/, '任务卡应在标题旁显示现有客户姓名与号码');
assert.match(source, /aria-pressed="\$\{[^}]+\}"/, '筛选按钮应暴露当前状态');
assert.match(source, /data-ops="load-more"/, '应通过加载更多代替静默截断');
assert.doesNotMatch(source, /slice\(0,\s*200\)/, '任务不应再静默截断为 200 条');
assert.match(source, /task\.aiGenerated[\s\S]*runAiAction/, 'AI 任务和人工任务应使用不同操作链路');

console.log('operations-ui contract: action lifecycle, filters, customer jump and incremental loading pass');
