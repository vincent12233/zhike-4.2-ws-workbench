'use strict';

const assert = require('node:assert/strict');
const rules = require('../resources/app/modules/business-rule-core.js');

assert.equal(rules.BUSINESS_RULES.customerMaster.aiMayCreate, false);
assert.equal(rules.BUSINESS_RULES.import.phoneRegistryUsesAi, false);
assert.equal(rules.BUSINESS_RULES.whatsapp.directOnly, true);
assert.equal(rules.BUSINESS_RULES.whatsapp.vipGroupMemberException, undefined, 'there is no VIP group exception; VIP is a customer tag only');
assert.equal(rules.BUSINESS_RULES.whatsapp.directOnly, true, 'ordinary WS handles private chats only');
assert.equal(rules.BUSINESS_RULES.whatsapp.skipUnread, true);
assert.equal(rules.BUSINESS_RULES.whatsapp.collectBothDirections, true);
assert.equal(rules.BUSINESS_RULES.reminders.investmentYearsWeight, 0);

let definitions = rules.reconcileSourceDefinitions([], ['单导', 'Facebook群粉'], ['Facebook群粉'], { FB群: 'Facebook群粉' });
const original = rules.resolveSourceDefinition('Facebook群粉', definitions);
assert.ok(original?.id);
assert.equal(rules.resolveSourceDefinition('FB群', definitions, { FB群: 'Facebook群粉' })?.id, original.id);
definitions = rules.renameSourceDefinition(definitions, 'Facebook群粉', 'Meta群粉', ['Meta群粉']);
assert.equal(rules.resolveSourceDefinition('Meta群粉', definitions)?.id, original.id, '渠道重命名必须保留稳定 ID');
assert.equal(rules.resolveSourceDefinition('Facebook群粉', definitions)?.id, original.id, '旧名称必须保留为别名');

const workspace = {
  customers: [{ id: 'c1', source: 'Facebook群粉', channel: 'Facebook群粉', group: 'A-1', statusHistory: [{ id: 's1', type: 'joined', to: '在群', date: '2026-11-01', at: '2026-11-01T00:00:00.000Z', source: 'Facebook群粉' }] }],
  tickets: [{ id: 't1', channel: 'Facebook群粉' }], deposits: [], registrations: [],
};
rules.stampSourceReferences(workspace, definitions);
assert.equal(workspace.customers[0].sourceId, original.id);
assert.equal(workspace.tickets[0].channelId, original.id);
const ledger = rules.buildGroupMembershipLedger(workspace.customers, [], definitions);
assert.equal(ledger.length, 1);
assert.equal(ledger[0].sourceId, original.id);
assert.equal(ledger[0].subgroup, 'A-1');
assert.equal(ledger[0].type, 'joined');
assert.equal(rules.buildGroupMembershipLedger(workspace.customers, ledger, definitions).length, 1, '事件账本迁移必须幂等');
assert.deepEqual(rules.buildGroupMembershipLedger([{ ...workspace.customers[0], statusHistory: [] }], ledger, definitions), [], '状态历史撤销后不得保留旧事件投影');

const tasks = [
  { id: 'old', customerId: 'c1', aiGenerated: true, status: 'open', updatedAt: '2026-11-01' },
  { id: 'new', customerId: 'c1', aiGenerated: true, status: 'open', updatedAt: '2026-11-02' },
  { id: 'manual', customerId: 'c1', aiGenerated: false, status: 'open', updatedAt: '2026-11-03' },
];
const deduped = rules.dedupeActiveFollowupTasks(tasks);
assert.deepEqual(deduped.kept.map(item => item.id), ['new']);
assert.equal(tasks.find(item => item.id === 'old').status, 'dismissed');
assert.equal(tasks.find(item => item.id === 'manual').status, 'open', '人工任务不受 AI 去重影响');

console.log('business rule core: baseline, source IDs, authoritative ledger and reminder dedupe pass');
