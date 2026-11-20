'use strict';

const assert = require('node:assert/strict');
const scope = require('../resources/app/modules/ws-scope.js');
const grant = { accountId: 'account-a', groupJid: '120-456@g.us', groupName: 'Operations' };
const allowed = settings => scope.isWsGroupAuthorized(settings, 'account-a', grant.groupJid);

assert.equal(allowed({ wsGroupAllowlist: [grant] }), true);
assert.equal(scope.isWsGroupAuthorized({ wsGroupAllowlist: [grant] }, 'account-b', grant.groupJid), false);
assert.equal(scope.isWsGroupAuthorized({ wsGroupAllowlist: [grant] }, 'account-a', 'other@g.us'), false);
assert.equal(scope.isWsGroupAuthorized({ wsGroupAllowlist: [grant] }, 'account-a', 'Operations'), false);

for (const legacyKey of ['wsVipGroupAllowlist', 'wsVipGroups', 'vipGroupBindings']) {
  assert.equal(allowed({ [legacyKey]: [grant] }), true, 'explicit legacy identities remain compatible');
  for (const revoked of [[], null, undefined, {}, '', false]) {
    const settings = { [legacyKey]: [grant], wsGroupAllowlist: revoked };
    assert.equal(allowed(settings), false, `${legacyKey} must not override canonical revocation`);
    assert.deepEqual(scope.normalizeWsGroupBindings(settings, 'account-a'), []);
  }
  assert.equal(allowed({ [legacyKey]: [grant], wsGroupAllowlist: [{ ...grant, accountId: 'account-b' }] }), false);
}

for (const entry of [grant.groupJid, { groupJid: grant.groupJid }, { accountId: 'account-a', groupName: 'Operations' }]) {
  const settings = { wsVipGroupAllowlist: [entry] };
  const [display] = scope.normalizeWsGroupBindings(settings, 'account-a');
  assert.ok(display, 'legacy rows stay visible for explicit repair');
  assert.equal(display.authorized, false);
  assert.match(display.authorizationReason, /REQUIRED/);
  assert.equal(allowed(settings), false, 'unscoped or name-only entries cannot grant execution');
}

for (const groupJid of ['Operations', '120-456@c.us', '120-456@G.US', '120-456@g.us ', '１２０-４５６@g.us', '120-456@g.us\u200e']) {
  const settings = { wsGroupAllowlist: [{ ...grant, groupJid }] };
  assert.equal(allowed(settings), false, 'display normalization cannot manufacture a group identity');
  assert.equal(scope.isWsGroupAuthorized(settings, 'account-a', groupJid), false);
}
for (const accountId of ['', null, undefined, 'account-a ', 'ａｃｃｏｕｎｔ-ａ', 'account-a\u200e']) {
  const settings = { wsGroupAllowlist: [{ ...grant, accountId }] };
  assert.equal(allowed(settings), false);
}
assert.equal(scope.isWsGroupAuthorized({ wsGroupAllowlist: [grant] }, undefined, grant.groupJid), false);
assert.equal(scope.isWsGroupAuthorized({ wsGroupAllowlist: [grant] }, 'account-a ', grant.groupJid), false);
assert.equal(allowed({ wsGroupAllowlist: [{ ...grant, enabled: false }] }), false);
for (const enabled of ['false', 'true', 0, 1, null]) {
  assert.equal(allowed({ wsGroupAllowlist: [{ ...grant, enabled }] }), false, 'invalid enable flags cannot authorize execution');
}

for (const entry of [
  { ...grant, wsAccountId: 'account-b' },
  { ...grant, jid: 'other@g.us' },
  { ...grant, accountId: '', wsAccountId: 'account-a' },
  { ...grant, groupJid: '', jid: grant.groupJid },
]) assert.equal(allowed({ wsGroupAllowlist: [entry] }), false, 'conflicting aliases fail closed');
assert.equal(allowed({ wsVipGroups: [{ wsAccountId: 'account-a', jid: grant.groupJid }] }), true);
assert.equal(allowed({ wsVipGroups: [grant.groupJid, grant] }), true, 'display-only rows do not shadow explicit grants');

assert.equal(allowed({ customers: [{ vipNumber: 'VIP-1', ...grant }], vipCustomers: [grant] }), false);
assert.equal(scope.countVipCustomers([{ vipNumber: 'VIP-1' }, { groupJid: grant.groupJid }, { vipNumber: 'VIP-2', deleted: true }]), 1);
console.log('WS group scope authorization: canonical revocation, exact identities, compatibility display and CRM VIP separation PASS');
