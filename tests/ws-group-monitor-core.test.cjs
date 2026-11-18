'use strict';

const assert = require('node:assert/strict');
const {
  normalizeMemberIdentity,
  eventIdempotencyKey,
  resolveMembershipIdentity,
  applyMembershipProjection,
  isConfirmedJoinEvent,
} = require('../resources/app/modules/ws-group-monitor-core.js');

function test(name, fn) {
  try {
    fn();
    console.log(`ok - ${name}`);
  } catch (error) {
    console.error(`not ok - ${name}`);
    throw error;
  }
}

test('normalizes WhatsApp phone JIDs and phone text deterministically', () => {
  assert.deepEqual(normalizeMemberIdentity('+91 98765 43210'), {
    kind: 'phone',
    value: '9876543210',
    phone: '9876543210',
    raw: '+91 98765 43210',
  });
  assert.deepEqual(normalizeMemberIdentity('919876543210@s.whatsapp.net'), {
    kind: 'phone',
    value: '9876543210',
    phone: '9876543210',
    raw: '919876543210@s.whatsapp.net',
  });
  assert.deepEqual(normalizeMemberIdentity('55112233@lid'), {
    kind: 'jid',
    value: '55112233@lid',
    phone: '',
    raw: '55112233@lid',
  });
});

test('creates a stable idempotency key for replayed events', () => {
  const event = {
    accountId: 'wa-1',
    groupJid: '1203-456@g.us',
    memberId: '919876543210@s.whatsapp.net',
    type: 'joined',
    sourceEventId: 'sys-42',
    eventAt: '2026-11-14T05:00:00.000Z',
  };
  assert.equal(eventIdempotencyKey(event), eventIdempotencyKey({ ...event }));
  assert.notEqual(eventIdempotencyKey(event), eventIdempotencyKey({ ...event, type: 'left' }));
});

test('resolves participant id before external ids, phone and manual mapping', () => {
  const customers = [
    { id: 'C-ID', wsExternalIds: ['participant-1'], phone: '9999999999', deleted: false },
    { id: 'C-PHONE', phone: '9876543210', deleted: false },
  ];
  const byParticipant = resolveMembershipIdentity({ memberId: 'participant-1', phone: '+91 11111 11111' }, customers, []);
  assert.equal(byParticipant.kind, 'participant-id');
  assert.equal(byParticipant.customer.id, 'C-ID');
  const byPhone = resolveMembershipIdentity({ memberId: 'unknown@lid', phone: '+91 98765 43210' }, customers, []);
  assert.equal(byPhone.kind, 'phone');
  assert.equal(byPhone.customer.id, 'C-PHONE');
  const byManual = resolveMembershipIdentity({ memberId: 'manual-member', phone: '' }, customers, [
    { accountId: 'wa-1', groupJid: 'group@g.us', memberId: 'manual-member', customerId: 'C-ID' },
  ], { accountId: 'wa-1', groupJid: 'group@g.us' });
  assert.equal(byManual.kind, 'manual-mapping');
  assert.equal(byManual.customer.id, 'C-ID');
});

test('returns pending for ambiguous and unmatched identities without creating a customer', () => {
  const customers = [
    { id: 'C-1', phone: '9876543210', deleted: false },
    { id: 'C-2', phone: '9876543210', deleted: false },
  ];
  const ambiguous = resolveMembershipIdentity({ memberId: 'unknown', phone: '+91 98765 43210' }, customers, []);
  assert.equal(ambiguous.status, 'ambiguous');
  assert.equal(ambiguous.customer, null);
  const unmatched = resolveMembershipIdentity({ memberId: 'unlinked@lid', phone: '' }, customers, []);
  assert.equal(unmatched.status, 'unmatched');
  assert.equal(unmatched.customer, null);
});

test('counts only confirmed joins and excludes approval requests', () => {
  assert.equal(isConfirmedJoinEvent({ type: 'joined', memberId: '919876543210@s.whatsapp.net' }), true);
  assert.equal(isConfirmedJoinEvent({ type: 'joined', pending: true, memberId: '919876543210@s.whatsapp.net' }), false);
  assert.equal(isConfirmedJoinEvent({ type: 'joined', approvalStatus: 'pending', memberId: '919876543210@s.whatsapp.net' }), false);
  assert.equal(isConfirmedJoinEvent({ type: 'joined', body: 'This join request is pending', memberId: '919876543210@s.whatsapp.net' }), false);
  assert.equal(isConfirmedJoinEvent({ type: 'joined', body: 'Requested to join; awaiting join approval', memberId: '919876543210@s.whatsapp.net' }), false);
  assert.equal(isConfirmedJoinEvent({ type: 'requested', memberId: '919876543210@s.whatsapp.net' }), false);
  const ignored = applyMembershipProjection({ id: 'profile-1', accountId: 'wa-1' }, { id: 'target-1', groupJid: 'group@g.us' }, {
    type: 'joined', pending: true, memberId: '919876543210@s.whatsapp.net', confidence: 0.99,
  }, { id: 'C-1' });
  assert.equal(ignored.status, 'ignored');
  assert.equal(ignored.reason, 'join-pending-or-unconfirmed');
});

test('projects a joined event per account, group and customer and protects manual locks', () => {
  const profile = { id: 'profile-1', accountId: 'wa-1' };
  const target = { id: 'target-1', groupJid: 'group@g.us', sourceId: 'source-group' };
  const customer = { id: 'C-1', deleted: false };
  const applied = applyMembershipProjection(profile, target, {
    id: 'event-1', accountId: 'wa-1', groupJid: 'group@g.us', memberId: '919876543210@s.whatsapp.net',
    type: 'joined', eventAt: '2026-11-14T05:00:00.000Z', confidence: 0.98,
  }, customer);
  assert.equal(applied.status, 'applied');
  assert.equal(applied.relation.accountId, 'wa-1');
  assert.equal(applied.relation.groupJid, 'group@g.us');
  assert.equal(applied.relation.customerId, 'C-1');
  assert.equal(applied.relation.status, '在群');
  assert.equal(applied.relation.locked, false);

  const locked = applyMembershipProjection(profile, target, {
    id: 'event-2', accountId: 'wa-1', groupJid: 'group@g.us', memberId: '919876543210@s.whatsapp.net',
    type: 'left', eventAt: '2026-11-15T05:00:00.000Z', confidence: 0.99,
  }, customer, { existingRelation: { ...applied.relation, locked: true, status: '在群' } });
  assert.equal(locked.status, 'review');
  assert.equal(locked.relation.status, '在群');
  assert.equal(locked.relation.reviewReason, 'manual-lock');
});

test('maps left and removed events to distinct customer relationship states', () => {
  const profile = { id: 'profile-1', accountId: 'wa-1' };
  const target = { id: 'target-1', groupJid: 'group@g.us', sourceId: 'source-group' };
  const customer = { id: 'C-1', deleted: false };
  for (const [type, expected] of [['left', '已退群'], ['removed', '被移除']]) {
    const result = applyMembershipProjection(profile, target, {
      id: `event-${type}`, accountId: 'wa-1', groupJid: 'group@g.us', memberId: 'member-1', type,
      eventAt: '2026-11-14T05:00:00.000Z', confidence: 0.9,
    }, customer);
    assert.equal(result.relation.status, expected);
  }
});

test('does not treat two distinct id-less events as duplicates', () => {
  const profile = { id: 'profile-1', accountId: 'wa-1' };
  const target = { id: 'target-1', groupJid: 'group@g.us', sourceId: 'source-group' };
  const customer = { id: 'C-1', deleted: false };
  const existing = applyMembershipProjection(profile, target, {
    accountId: 'wa-1', groupJid: 'group@g.us', memberId: 'member-1', type: 'joined',
    eventAt: '2026-11-14T05:00:00.000Z', confidence: 0.9,
  }, customer).relation;
  const next = applyMembershipProjection(profile, target, {
    accountId: 'wa-1', groupJid: 'group@g.us', memberId: 'member-1', type: 'left',
    eventAt: '2026-11-15T05:00:00.000Z', confidence: 0.9,
  }, customer, { existingRelation: existing });
  assert.equal(next.status, 'applied');
  assert.equal(next.relation.status, '已退群');
});

console.log('ws-group-monitor-core: pass');
