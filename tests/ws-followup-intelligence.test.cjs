'use strict';

const assert = require('node:assert/strict');
const core = require('../resources/app/modules/ws-workbench-core.js');
const crm = require('../resources/app/modules/ws-crm-sync-core.js');
const fs = require('node:fs');
const path = require('node:path');

const parsed = core.parseAiResult(JSON.stringify({
  summary: '客户关注短线机会，但最近两天没有回复。',
  intent: '有兴趣',
  intentScore: 82,
  urgency: '高',
  confidence: 0.86,
  profileFacts: {
    occupation: { value: '企业经营者', state: 'known', confidence: 0.9, evidence: '客户说：我经营一家贸易公司' },
    investment_years: { value: 8, state: 'known', confidence: 0.9, evidence: '客户说：我投资股票八年了' }
  },
  followupStrategy: {
    shouldFollowUp: true,
    qualificationScore: 88,
    qualificationReason: '客户明确提到稳定工作和较大持仓',
    engagementScore: 94,
    engagementReason: '客户连续回复并主动询问买入时点',
    priorityScore: 91,
    scoreConfidence: 0.86,
    scoreReason: '资金实力较强且聊天互动积极',
    reason: '客户主动询问买入时点',
    objective: '确认风险偏好并提供市场信息',
    bestTime: '2026-11-14 10:30',
    opener: '今天市场波动比较明显，您之前关注的方向有新变化。',
    talkingPoints: ['先回应之前的问题', '再了解持仓节奏'],
    avoidTopics: ['不要催促买入', '不要承诺收益'],
    channel: 'WhatsApp',
    reanalyzeWhen: ['客户回复', '24小时后仍未回复']
  },
  noReply: { noReply: true, reason: '最近两天未回复', cooldownDays: 2, suggestedAt: '2026-11-14' }
}));

assert.equal(parsed.followupStrategy.priorityScore, 91);
assert.equal(parsed.followupStrategy.qualificationScore, 88);
assert.equal(parsed.followupStrategy.engagementScore, 94);
assert.equal(parsed.followupStrategy.priorityScore, Math.round(88 * 0.55 + 94 * 0.45));
assert.equal(parsed.followupStrategy.priorityBand, 'critical');
assert.equal(parsed.followupStrategy.scoringVersion, 'money-engagement-v1');
assert.equal(parsed.followupStrategy.talkingPoints.length, 2);
assert.equal(parsed.followupStrategy.avoidTopics.length, 2);
assert.equal(parsed.followupStrategy.opener.includes('市场'), true);

const plan = crm.deriveFollowupPlan(parsed, { id: 'analysis-1' }, { id: 'conversation-1' }, 'account-1');
assert.equal(plan.shouldCreate, true);
assert.equal(plan.priority, 'high');
assert.equal(plan.priorityScore, 91);
assert.equal(plan.qualificationScore, 88);
assert.equal(plan.engagementScore, 94);
assert.equal(plan.objective.includes('风险偏好'), true);
assert.equal(plan.opener.includes('市场'), true);
assert.equal(plan.talkingPoints.length, 2);
assert.equal(plan.nextDate, '2026-11-14');

const customer = { id: 'customer-1', name: '已有客户', aiSummary: '', tags: [] };
const profile = crm.deriveCustomerProfile(parsed, { id: 'conversation-1', externalId: '919999999999', title: '已有客户' }, 'account-1');
const merged = crm.mergeCustomerProfileSafely(customer, profile);
assert.equal(merged.customer.aiFollowupPriorityScore, 91);
assert.equal(merged.customer.aiQualificationScore, 88);
assert.equal(merged.customer.aiEngagementScore, 94);
assert.equal(merged.customer.aiFollowupObjective.includes('风险偏好'), true);
assert.equal(merged.customer.aiSuggestedOpener.includes('市场'), true);
assert.equal(merged.customer.aiFollowupTalkingPoints.length, 2);
assert.equal(merged.customer.aiProfileCompleteness > 0, true);
assert.equal(merged.customer.aiProfileKnownFields.includes('occupation'), true);
assert.equal(merged.customer.aiProfileMissingFields.includes('family_context'), true);
assert.equal(merged.customer.aiProfileEvidence.occupation.evidence.includes('贸易公司'), true);

const fallbackPlan = crm.deriveFollowupPlan(core.parseAiResult(JSON.stringify({
  summary: '客户需要继续维护',
  confidence: 0.8,
  followupStrategy: { shouldFollowUp: true, priorityScore: 65, reason: '客户有兴趣但未明确时间' }
})), { id: 'analysis-2' }, { id: 'conversation-2' }, 'account-1');
assert.equal(fallbackPlan.shouldCreate, true);
assert.match(fallbackPlan.nextDate, /^\d{4}-\d{2}-\d{2}$/);
assert.equal(fallbackPlan.reminderCadence, 'within-3-days');

const noFollowupPlan = crm.deriveFollowupPlan(core.parseAiResult(JSON.stringify({
  summary: '客户明确表示无需继续联系',
  confidence: 0.9,
  followupStrategy: { shouldFollowUp: false, priorityScore: 0 }
})), { id: 'analysis-3' }, { id: 'conversation-3' }, 'account-1');
assert.equal(noFollowupPlan.shouldCreate, false);

const ungrounded = core.parseAiResult(JSON.stringify({
  confidence: 0.9,
  followupStrategy: {
    shouldFollowUp: true,
    qualificationScore: 100,
    engagementScore: 100,
    priorityScore: 100,
    scoreConfidence: 0.9
  }
}));
assert.equal(ungrounded.followupStrategy.qualificationScore, 35, '无资金证据说明时必须限制资金分');
assert.equal(ungrounded.followupStrategy.engagementScore, 35, '无互动证据说明时必须限制粘度分');
assert.equal(ungrounded.followupStrategy.priorityScore, 35, '综合分必须由程序复算，不能信任 AI 自报高分');

const lowEvidence = core.parseAiResult(JSON.stringify({
  confidence: 0.3,
  followupStrategy: {
    shouldFollowUp: true,
    qualificationScore: 95,
    qualificationReason: '客户提到经营公司',
    engagementScore: 90,
    engagementReason: '近期连续主动回复',
    scoreConfidence: 0.3
  }
}));
assert.equal(lowEvidence.followupStrategy.priorityScore <= 55, true, '低证据置信度不得进入最高优先级');

const root = path.resolve(__dirname, '..');
const workbenchUi = fs.readFileSync(path.join(root, 'resources/app/modules/ws-workbench.js'), 'utf8');
const appUi = fs.readFileSync(path.join(root, 'resources/app/app.js'), 'utf8');
const operationsUi = fs.readFileSync(path.join(root, 'resources/app/modules/operations-ui.js'), 'utf8');
const serverSource = fs.readFileSync(path.join(root, 'resources/app/server.mjs'), 'utf8');
assert.doesNotMatch(workbenchUi.match(/function renderCollectionCard\(\)[\s\S]*?async function loadConversationData/)?.[0] || '', /renderFollowupAlerts\(\)/, 'WS 采集面板不应重复展示正式提醒');
assert.match(appUi, /data-action="go-operations"[\s\S]*进入任务中心/, '今日工作台提醒应进入任务中心');
assert.match(operationsUi, /suggestedOpener[\s\S]*talkingPoints[\s\S]*avoidTopics/, '任务中心应展示 AI 跟进策略');
assert.match(serverSource, /priorityRank[\s\S]*priorityScore[\s\S]*alerts\.slice\(0, limit\)/, '今日提醒应按到期状态和综合分排序');
const prompt = core.buildNaturalChatAnalysisPrompt('客户：我有稳定工作，目前持仓较多。');
assert.match(prompt, /资金实力[\s\S]*聊天粘度/);
assert.match(prompt, /不得根据国家、年龄、头像、姓名或刻板印象猜测财富/);

console.log('WS follow-up intelligence: structured strategy, priority and CRM persistence pass');
