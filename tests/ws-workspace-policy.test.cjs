'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { OPERATIONS, decideWsWorkspaceOperation: decide } = require('../resources/app/modules/ws-workspace-policy.cjs');

const ordinary = Object.freeze({ id: 'ordinary-account', workspace_mode: 'ordinary' });
const dedicated = Object.freeze({ id: 'dedicated-account', workspaceMode: 'dedicated' });
const directOperations = ['collect-direct-messages', 'analyze-direct', 'sync-direct-crm', 'send-direct'];
const groupOperations = ['collect-group-messages', 'monitor-group', 'auto-create-group-member'];

test('ordinary direct workflows cannot be reused for groups or dedicated accounts', () => {
  for (const operation of directOperations) {
    const allowed = decide({ account: ordinary, operation, conversationType: 'direct' });
    assert.equal(allowed.eligible, true, operation);
    assert.equal(allowed.requiresContactExclusion, false, 'ordinary CRM/chat stays outside the group exclusion list');
    for (const conversationType of ['group', 'vip_group']) {
      const result = decide({ account: ordinary, operation, conversationType });
      assert.equal(result.eligible, false, operation + '/' + conversationType);
      assert.equal(result.code, 'WS_WORKSPACE_CONVERSATION_TYPE_MISMATCH');
    }
    assert.equal(decide({ account: dedicated, operation, conversationType: 'direct' }).code, 'WS_WORKSPACE_MODE_MISMATCH');
  }
});

test('dedicated group workflows recognize historical group spelling without granting ordinary accounts rights', () => {
  for (const operation of groupOperations) {
    for (const conversationType of ['group', 'vip_group']) {
      const result = decide({ account: dedicated, operation, conversationType });
      assert.equal(result.eligible, true, operation + '/' + conversationType);
      assert.equal(result.conversationKind, 'group');
      assert.equal(result.requiresContactExclusion, operation === 'auto-create-group-member');
      assert.equal(decide({ account: ordinary, operation, conversationType }).code, 'WS_WORKSPACE_MODE_MISMATCH');
    }
    assert.equal(decide({ account: dedicated, operation, conversationType: 'direct' }).code, 'WS_WORKSPACE_CONVERSATION_TYPE_MISMATCH');
  }
});

test('monitor configuration requires a dedicated account but either account may stop a legacy monitor', () => {
  assert.equal(decide({ account: dedicated, operation: 'configure-group-monitor' }).eligible, true);
  assert.equal(decide({ account: ordinary, operation: 'configure-group-monitor' }).code, 'WS_WORKSPACE_MODE_MISMATCH');
  for (const account of [ordinary, dedicated]) {
    assert.equal(decide({ account, operation: 'disable-group-monitor' }).eligible, true);
  }
});

test('directory observation and archived history/export are not restricted to writable conversation kinds', () => {
  for (const account of [ordinary, dedicated]) for (const operation of ['discover-groups', 'read-history', 'export-history']) {
    for (const conversationType of [undefined, 'direct', 'group', 'vip_group', 'unknown', 'old-archived-format']) {
      const result = decide({ account, operation, conversationType });
      assert.equal(result.eligible, true, operation + '/' + conversationType);
      assert.equal(result.requiresContactExclusion, false);
    }
  }
});

test('a missing account lookup never becomes a default account, including reads and safe stopping', () => {
  for (const account of [undefined, null, {}, [], 'default', 0, false, { id: '' }, { id: '  ' }, { id: 12 }, Object.create({ id: 'inherited' })]) {
    for (const operation of OPERATIONS.filter(value => value !== 'contact-exclusion-config')) {
      assert.equal(decide({ account, operation, conversationType: 'direct' }).code, 'WS_WORKSPACE_ACCOUNT_UNKNOWN', operation);
    }
  }
});

test('old trusted account rows without mode fields retain ordinary compatibility', () => {
  const account = Object.freeze({ id: 'legacy-account' });
  assert.equal(decide({ account, operation: 'collect-direct-messages', conversationType: 'direct' }).eligible, true);
  assert.equal(decide({ account, operation: 'read-history', conversationType: 'vip_group' }).workspaceMode, 'ordinary');
  assert.equal(decide({ account, operation: 'monitor-group', conversationType: 'group' }).code, 'WS_WORKSPACE_MODE_MISMATCH');
  const sqliteRow = Object.assign(Object.create(null), dedicated);
  assert.equal(decide({ account: sqliteRow, operation: 'monitor-group', conversationType: 'group' }).eligible, true);
});

test('explicit unknown modes fail closed rather than triggering legacy fallback or coercion', () => {
  for (const field of ['workspace_mode', 'workspaceMode']) {
    for (const mode of [undefined, null, '', 'ordinary ', 'Dedicated', 'vip', 'group', 0, 1, true, false, {}, [], new String('ordinary')]) {
      const account = { id: 'account', [field]: mode };
      for (const operation of ['collect-direct-messages', 'read-history', 'disable-group-monitor']) {
        const result = decide({ account, operation, conversationType: 'direct' });
        assert.equal(result.eligible, false); assert.equal(result.code, 'WS_WORKSPACE_MODE_INVALID');
      }
    }
  }
});

test('database and DTO modes must agree when both are present', () => {
  for (const mode of ['ordinary', 'dedicated']) {
    const account = { id: 'account', workspace_mode: mode, workspaceMode: mode };
    assert.equal(decide({ account, operation: 'read-history' }).workspaceMode, mode);
  }
  for (const account of [
    { id: 'account', workspace_mode: 'ordinary', workspaceMode: 'dedicated' },
    { id: 'account', workspace_mode: 'dedicated', workspaceMode: 'ordinary' },
  ]) assert.equal(decide({ account, operation: 'read-history' }).code, 'WS_WORKSPACE_MODE_CONFLICT');
  assert.equal(decide({ account: { ...ordinary, workspaceMode: null }, operation: 'read-history' }).code, 'WS_WORKSPACE_MODE_INVALID');
});

test('unknown or coerced conversation types cannot authorize automated writes', () => {
  for (const conversationType of [undefined, null, '', 'unknown', 'DIRECT', 'group ', true, 1, {}, [], new String('direct')]) {
    for (const [account, operations] of [[ordinary, directOperations], [dedicated, groupOperations]]) {
      for (const operation of operations) {
        assert.equal(decide({ account, operation, conversationType }).code, 'WS_WORKSPACE_CONVERSATION_TYPE_UNCONFIRMED');
      }
    }
  }
});

test('CRM customer classification, group labels and capability claims cannot change purpose eligibility', () => {
  const account = { ...ordinary, vip: true, vipGroup: true, role: 'dedicated', supported: true };
  const result = decide({ account, operation: 'monitor-group', conversationType: 'vip_group',
    workspaceMode: 'dedicated', groupName: 'VIP', capability: { supported: true } });
  assert.equal(result.eligible, false);
  assert.equal(result.code, 'WS_WORKSPACE_MODE_MISMATCH');
});

test('global exclusion configuration is account-independent and does not check or exempt an identity', () => {
  for (const account of [undefined, null, ordinary, dedicated, { id: 'unknown', workspaceMode: 'invalid' }]) {
    const result = decide({ account, operation: 'contact-exclusion-config', conversationType: 'unknown' });
    assert.equal(result.eligible, true); assert.equal(result.scope, 'global');
    assert.equal(result.workspaceMode, null); assert.equal(result.requiresContactExclusion, false);
  }
});

test('unsupported operations, including group sending and undeclared member AI, are never eligible', () => {
  for (const operation of [undefined, null, '', 'send-group', 'group-send', 'analyze-group', 'sync-group-member-crm',
    'toString', 'constructor', '__proto__', ' send-direct', 'SEND-DIRECT', {}, new String('send-direct')]) {
    const result = decide({ account: dedicated, operation, conversationType: 'group', platformSupported: true });
    assert.equal(result.eligible, false); assert.equal(result.code, 'WS_WORKSPACE_OPERATION_UNSUPPORTED');
  }
  for (const input of [null, undefined, false, 1, [], 'send-direct']) {
    assert.equal(decide(input).code, 'WS_WORKSPACE_OPERATION_UNSUPPORTED');
  }
});

test('purpose eligibility does not assert connection, platform support or downstream authorization', () => {
  const account = Object.freeze({ ...dedicated, enabled: false, status: '未连接' });
  const input = Object.freeze({ account, operation: 'auto-create-group-member', conversationType: 'group' });
  const before = JSON.stringify(input);
  const result = decide(input);
  assert.equal(result.eligible, true); assert.equal(result.requiresContactExclusion, true);
  for (const key of ['supported', 'authorized', 'allowed', 'identityVerified', 'nativeReady', 'exclusionChecked']) {
    assert.equal(Object.hasOwn(result, key), false, key + ' is not an account-purpose claim');
  }
  assert.equal(JSON.stringify(input), before);
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(OPERATIONS), true);
});
