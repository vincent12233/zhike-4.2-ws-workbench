'use strict';

const assert = require('node:assert/strict');
const core = require('../../resources/app/modules/ws-group-manager-core.js');

assert.equal(typeof core.createGroupManager, 'function');
const manager = core.createGroupManager({
  flags: { IndependentWsGroupManagerEnabled: true, GroupMemberSyncEnabled: true, GroupCrmAutoCreateEnabled: true, GroupMessageCollectionEnabled: true, GroupReadEvidenceEnabled: true },
});

assert.equal(manager.upsertGroup({ accountId: 'a', groupJid: '100@g.us', name: '同名群' }).status, 'created');
assert.equal(manager.upsertGroup({ accountId: 'b', groupJid: '100@g.us', name: '同名群' }).status, 'created');
assert.equal(manager.listGroups('a').length, 1);
assert.equal(manager.listGroups('b').length, 1);
assert.equal(manager.upsertGroup({ accountId: 'a', groupJid: '100@g.us', name: '改名群' }).status, 'updated');
assert.equal(manager.listGroups('a')[0].name, '改名群');

const joined = manager.applyMemberEvent({ accountId: 'a', groupJid: '100@g.us', memberJid: '919999999999@s.whatsapp.net', eventType: 'joined', eventAt: '2026-11-16T01:00:00.000Z', sourceEventId: 'e1' });
assert.equal(joined.status, 'pending-crm');
const repeated = manager.applyMemberEvent({ accountId: 'a', groupJid: '100@g.us', memberJid: '919999999999@s.whatsapp.net', eventType: 'joined', eventAt: '2026-11-16T01:00:00.000Z', sourceEventId: 'e1' });
assert.equal(repeated.status, 'duplicate');
const pending = manager.applyMemberEvent({ accountId: 'a', groupJid: '100@g.us', memberJid: '919888888888@s.whatsapp.net', eventType: 'joined', eventAt: '2026-11-16T01:01:00.000Z', sourceEventId: 'e2', approvalStatus: 'pending' });
assert.equal(pending.status, 'ignored');

const message = manager.upsertMessage({ accountId: 'a', groupJid: '100@g.us', messageId: 'm1', senderJid: '919999999999@s.whatsapp.net', sentAt: '2026-11-16T01:02:00.000Z', type: 'text' });
assert.equal(message.status, 'created');
assert.equal(manager.upsertMessage({ accountId: 'a', groupJid: '100@g.us', messageId: 'm1', senderJid: '919999999999@s.whatsapp.net', sentAt: '2026-11-16T01:02:00.000Z', type: 'text' }).status, 'duplicate');
assert.equal(manager.recordReadEvidence({ accountId: 'a', groupJid: '100@g.us', messageId: 'm1', memberJid: '919999999999@s.whatsapp.net', status: 'unknown' }).status, 'created');
assert.throws(() => manager.recordReadEvidence({ accountId: 'a', groupJid: '100@g.us', messageId: 'm1', memberJid: '919999999999@s.whatsapp.net', status: 'read' }), /evidence/i);
assert.equal(manager.recordReadEvidence({ accountId: 'a', groupJid: '100@g.us', messageId: 'm1', memberJid: '919999999999@s.whatsapp.net', status: 'read', evidence: 'platform-receipt-1' }).status, 'updated');
assert.equal(manager.recordReadEvidence({ accountId: 'a', groupJid: '100@g.us', messageId: 'm1', memberJid: '919999999999@s.whatsapp.net', status: 'read', evidence: 'platform-receipt-1' }).status, 'duplicate');
assert.throws(() => manager.upsertMessage({ accountId: 'a', groupJid: '100@g.us', messageId: 'm-invalid', processingStatus: 'bogus' }), /processing status/i);
const sync = manager.startSyncRun({ accountId: 'a', groupJid: '100@g.us', runId: 'r1', kind: 'members' });
assert.equal(sync.status, 'created');
assert.equal(manager.updateSyncRun({ accountId: 'a', runId: 'r1', status: 'running', checkpoint: 'page-1', itemCount: 2 }).run.checkpoint, 'page-1');
assert.equal(manager.updateSyncRun({ accountId: 'a', runId: 'r1', status: 'completed', checkpoint: 'page-2', itemCount: 4 }).run.itemCount, 4);
assert.equal(manager.listGroupState('a', '100@g.us').syncRuns.length, 1);
assert.equal(manager.listMessages('b').length, 0);
console.log('stage3 group manager core contract: pass');
