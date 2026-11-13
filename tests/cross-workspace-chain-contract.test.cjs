'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repo = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(repo, relative), 'utf8');
const app = read('resources/app/app.js');
const server = read('resources/app/server.mjs');
const operations = read('resources/app/modules/operations-ui.js');
const smartImport = read('resources/app/modules/smart-import.js');
const businessRules = require('../resources/app/modules/business-rule-core.js');

// One customer master owns every downstream business record.  The records
// remain separate and link back by customerId instead of copying customers.
assert.match(app, /customerTimeline\(customer\)[\s\S]*state\.followups\.filter\(related\)[\s\S]*state\.tickets\.filter\(related\)[\s\S]*state\.deposits\.filter\(related\)[\s\S]*state\.registrations\.filter\(related\)/);
assert.match(app, /state\.registrations\.unshift\(record\);c\.registration='已报名'/);
// The common record contains template-literal expressions before customerId,
// so do not stop the contract scan on the first interpolation brace.
assert.match(app, /common=\{[\s\S]{0,900}?customerId:c\.id/);
assert.match(app, /normalizeTicketRecord\(\{\.\.\.common/);
assert.match(app, /state\.deposits\.unshift\(record\)/);
assert.equal(businessRules.BUSINESS_RULES.customerMaster.aiMayCreate, false);
assert.equal(businessRules.BUSINESS_RULES.import.phoneRegistryUsesAi, false);

// Runtime projection: the settings taxonomy must stamp the same stable source
// identity through the customer master and every independent business ledger.
const definitions = businessRules.reconcileSourceDefinitions(
  [],
  ['单导', 'Facebook广告'],
  ['WhatsApp群粉'],
  {},
);
const linkedWorkspace = {
  customers: [{
    id: 'C-chain', source: 'WhatsApp群粉', channel: 'WhatsApp群粉',
    statusHistory: [
      { id: 'joined', type: 'joined', to: '已进群', source: 'WhatsApp群粉', date: '2026-11-12', at: '2026-11-12T08:00:00.000Z' },
      { id: 'left', type: 'left', to: '已退群', source: 'WhatsApp群粉', date: '2026-11-13', at: '2026-11-13T08:00:00.000Z' },
    ],
  }],
  tickets: [{ id: 'T-chain', customerId: 'C-chain', channel: 'WhatsApp群粉' }],
  deposits: [{ id: 'D-chain', customerId: 'C-chain', channel: 'WhatsApp群粉' }],
  registrations: [{ id: 'R-chain', customerId: 'C-chain', source: 'WhatsApp群粉' }],
};
assert.ok(businessRules.stampSourceReferences(linkedWorkspace, definitions, {}) > 0);
const linkedSourceId = linkedWorkspace.customers[0].sourceId;
assert.ok(linkedSourceId);
assert.equal(linkedWorkspace.customers[0].channelId, linkedSourceId);
assert.equal(linkedWorkspace.tickets[0].channelId, linkedSourceId);
assert.equal(linkedWorkspace.deposits[0].channelId, linkedSourceId);
assert.equal(linkedWorkspace.registrations[0].sourceId, linkedSourceId);
const membershipLedger = businessRules.buildGroupMembershipLedger(linkedWorkspace.customers, [], definitions, {});
assert.deepEqual(membershipLedger.map(event => event.type), ['joined', 'left']);
assert.ok(membershipLedger.every(event => event.customerId === 'C-chain' && event.sourceId === linkedSourceId));

const taskProjection = [
  { id: 'old', customerId: 'C-chain', aiGenerated: true, status: 'open', updatedAt: '2026-11-12T08:00:00.000Z' },
  { id: 'new', customerId: 'C-chain', aiGenerated: true, status: 'open', updatedAt: '2026-11-13T08:00:00.000Z' },
];
const dedupedTasks = businessRules.dedupeActiveFollowupTasks(taskProjection);
assert.equal(dedupedTasks.kept.length, 1);
assert.equal(dedupedTasks.kept[0].id, 'new');
assert.equal(taskProjection[0].status, 'dismissed');

// Settings are the authoritative taxonomy for import, group ledgers and all
// linked records.  A settings change must invalidate caches and notify every
// dependent importer rather than leaving page-local copies behind.
assert.match(app, /stampSourceReferences\(\{customers:state\.customers,tickets:state\.tickets,deposits:state\.deposits,registrations:state\.registrations\}/);
assert.match(app, /buildGroupMembershipLedger\(state\.customers/);
assert.match(app, /new CustomEvent\('zhike:option-lists-changed'/);
assert.match(app, /window\.addEventListener\('zhike:option-lists-changed',exposeImportSourceCatalog\)/);
assert.match(smartImport, /classifyImportRow/);

// WS intelligence may only enrich an independently matched existing customer.
// It then writes the shared task collection consumed by Home and Operations.
assert.match(server, /matchCustomerForAutoSync\(state\.customers, independentProfile\)/);
assert.match(server, /identityPending:\s*true/);
assert.match(server, /const tasks = state\.settings\.operatingTasks/);
assert.match(server, /writeState\(state, false\)/);
assert.match(app, /\/api\/ws\/followup-alerts\?allAccounts=1&limit=5/);
assert.match(operations, /\/api\/ws\/followup-action/);
assert.match(app, /new CustomEvent\('zhike:followups-changed'\)/);
assert.match(app, /state\.view==='home'\)loadHomeWsFollowups\(\);else if\(state\.view==='operations'\)/);

// Completing the task is the only point at which an actual follow-up record is
// written and the same customer master gets lastFollow / due for every view.
assert.match(server, /action === 'complete' && !result/);
assert.match(server, /state\.followups\.unshift\(followup\)/);
assert.match(server, /customer\.lastFollow = now\.slice\(0, 10\)/);
assert.match(server, /if \(followup\.nextDate\) customer\.due = followup\.nextDate/);

// Mutations must return through the single renderer so navigation counts,
// 6.0 workspace shells, lists and statistics refresh together.  Directly
// repainting only the registration table caused stale counts and removed the
// linked 6.0 control deck.
assert.match(app, /save-registration[\s\S]{0,1600}state\.view='registrations';render\(\)/);
assert.match(app, /deleteRegistrationRecord[\s\S]{0,1600}render\(\);toast\('报名记录已删除'\)/);
assert.match(app, /registration-page'\)\{state\.registrationPage[^}]*render\(\)/);
assert.equal((app.match(/renderRegistrations\(\)/g) || []).length, 2,
  'registration renderer may only be declared and called by the shared render switch');

console.log('cross-workspace chain contract: customer master, settings taxonomy, WS AI tasks and shared refresh are connected');
