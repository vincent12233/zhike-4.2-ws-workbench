'use strict';
// V9.1 group registry rules: channel + name + alias, alias-based resolution,
// and no guessed WhatsApp identity.
const assert = require('node:assert/strict');
const core = require('../resources/app/modules/ws-managed-groups-core.cjs');

const results = [];
function check(name, fn) {
  try { fn(); results.push(true); console.log('PASS ' + name); }
  catch (error) { results.push(false); console.log('FAIL ' + name + ' :: ' + error.message); }
}
const channels = ['FB群粉', 'API群粉', '短信群粉', '单导K', '单导B'];
const valid = { channel: 'FB群粉', groupName: 'A-501 交流群', groupAlias: 'A-501' };

check('exactly the three fields are required and accepted', () => {
  const r = core.validateGroup(valid, { channels });
  assert.equal(r.ok, true);
  assert.deepEqual(Object.keys(r.value).sort(), ['aliasKey', 'channel', 'groupAlias', 'groupName']);
  assert.equal(r.value.channel, 'FB群粉');
});
check('a missing field is rejected with a specific code', () => {
  for (const [field, code] of [['channel', 'CHANNEL_REQUIRED'], ['groupName', 'NAME_REQUIRED'], ['groupAlias', 'ALIAS_REQUIRED']]) {
    const r = core.validateGroup({ ...valid, [field]: ' ' }, { channels });
    assert.equal(r.ok, false);
    assert.ok(r.errors.some(item => item.field === field && item.code === code), field);
  }
});
check('the assistant field is not part of the registry contract', () => {
  const r = core.validateGroup({ ...valid, assistant: '小王' }, { channels });
  assert.equal(r.ok, true);
  assert.equal('assistant' in r.value, false);
});
check('the channel never comes from the alias prefix', () => {
  const r = core.validateGroup({ ...valid, groupAlias: 'A-501' }, { channels });
  assert.equal(r.value.channel, 'FB群粉', 'explicit channel wins');
  const missing = core.validateGroup({ ...valid, channel: '' }, { channels });
  assert.equal(missing.ok, false, 'A-501 prefix is not a channel');
});
check('an unknown channel is rejected unless custom channels are allowed', () => {
  assert.equal(core.validateGroup({ ...valid, channel: '自定义' }, { channels }).ok, false);
  assert.equal(core.validateGroup({ ...valid, channel: '自定义' }, { channels, allowCustomChannel: true }).ok, true);
});
check('aliases are unique inside the workspace', () => {
  const existing = [{ id: 'G1', groupAlias: 'A-501', channel: 'FB群粉', groupName: 'x' }];
  assert.equal(core.findAliasConflict(existing, 'a-501').id, 'G1');
  assert.equal(core.findAliasConflict(existing, 'a-501', 'G1'), null);
});
check('duplicate group names are allowed', () => {
  const existing = [{ id: 'G1', groupAlias: 'A-1', groupName: '同名群', channel: 'FB群粉' }];
  assert.equal(core.detectDuplicateNames(existing, '同名群'), 1);
  const r = core.validateGroup({ channel: 'FB群粉', groupName: '同名群', groupAlias: 'A-2' }, { channels });
  assert.equal(r.ok, true);
});
check('import is idempotent and reports conflicts', () => {
  const existing = [{ id: 'G1', groupAlias: 'A-501', channel: 'FB群粉', groupName: 'A-501 交流群' }];
  const first = core.importRows([{ channel: 'FB群粉', groupName: 'A-501 交流群', groupAlias: 'A-501' }], existing, { channels });
  assert.equal(first.accepted.length, 0);
  assert.equal(first.rejected[0].skipped, true, 'identical row is skipped, not duplicated');
  const conflict = core.importRows([{ channel: '单导K', groupName: '别的群', groupAlias: 'A-501' }], existing, { channels });
  assert.equal(conflict.rejected[0].errors[0].code, 'CONFLICT');
  const twice = core.importRows([{ channel: 'FB群粉', groupName: 'B群', groupAlias: 'B-1' }, { channel: 'FB群粉', groupName: 'B群2', groupAlias: 'b-1' }], [], { channels });
  assert.equal(twice.accepted.length, 1);
  assert.equal(twice.rejected[0].errors[0].code, 'DUPLICATE_IN_FILE');
});
check('alias resolution is exact and refuses ambiguity', () => {
  const groups = [{ id: 'G1', groupAlias: 'A-501', channel: 'FB群粉' }, { id: 'G2', groupAlias: 'A-502', channel: '单导K', enabled: false }];
  assert.equal(core.resolveAlias(groups, 'a-501').group.id, 'G1');
  assert.equal(core.resolveAlias(groups, 'A-50').status, 'missing', 'no fuzzy prefix match');
  assert.equal(core.resolveAlias(groups, 'A-502').status, 'missing', 'disabled groups do not resolve');
  assert.equal(core.resolveAlias([{ id: 'G1', groupAlias: 'X' }, { id: 'G2', groupAlias: 'x' }], 'X').status, 'ambiguous');
});
check('suggestions never bind an identity by name', () => {
  const groups = [{ id: 'G1', groupName: '同名群', groupAlias: 'A-1' }, { id: 'G2', groupName: '唯一群', groupAlias: 'A-2' }];
  const candidates = [{ groupName: '同名群', jid: '111@g.us' }, { groupName: '同名群', jid: '222@g.us' }, { groupName: '唯一群', jid: '333@g.us' }];
  const result = core.suggestMatches(groups, candidates);
  assert.equal(result[0].status, 'ambiguous');
  assert.equal(result[0].jid, null);
  assert.equal(result[1].status, 'suggested');
  assert.equal(result[1].jid, null, 'a suggestion is not a binding');
});
check('binding requires an explicit canonical JID', () => {
  assert.equal(core.canConfirmMatch({ jid: '123@g.us' }), true);
  assert.equal(core.canConfirmMatch({ jid: 'A-501' }), false, 'alias is not an identity');
  assert.equal(core.canConfirmMatch({}), false);
});
check('malformed input never throws', () => {
  for (const input of [undefined, null, 'x', 5, [], { channel: {} }]) {
    const r = core.validateGroup(input, { channels });
    assert.equal(typeof r.ok, 'boolean');
    assert.ok(Array.isArray(r.errors));
  }
});

const failed = results.filter(ok => !ok).length;
console.log(`Managed groups core: ${results.length - failed}/${results.length}`);
if (failed) process.exit(1);
