'use strict';
// Pure rules of the dedicated WS group channel configuration centre.
const assert = require('node:assert/strict');
const core = require('../resources/app/modules/ws-group-channel-config-core.cjs');

const results = [];
function check(name, fn) {
  try { fn(); results.push(true); console.log('PASS ' + name); }
  catch (error) { results.push(false); console.log('FAIL ' + name + ' :: ' + error.message); }
}

check('detects A/F codes of any number without a fixed range', () => {
  for (const [name, code] of [['A-501 单导群', 'A-501'], ['FB 粉丝 F-550', 'F-550'], ['a－560 测试', ''], ['A–560 新群', 'A-560'], ['Z-12 自定义', 'Z-12'], ['B-99999 大群', 'B-99999']]) {
    assert.equal(core.detectGroupCode(name).code, code, name);
  }
});
check('does not mistake phones, years or VIP tokens for codes', () => {
  for (const name of ['VIP2024 客户', '+91 98765-43210', '2026-11-21 活动', '群 A501', 'ABCD-501']) {
    assert.equal(core.detectGroupCode(name).status, 'none', name);
  }
});
check('two different codes in one name are ambiguous, not guessed', () => {
  const result = core.detectGroupCode('A-501 合并 F-502');
  assert.equal(result.status, 'ambiguous');
  assert.equal(result.code, '');
  assert.deepEqual(result.candidates, ['A-501', 'F-502']);
  assert.equal(core.detectGroupCode('A-501 / A-501 备份').status, 'detected', 'a repeated identical code is not ambiguous');
});
check('normalizes manual codes and rejects malformed ones', () => {
  assert.equal(core.normalizeGroupCode('a501'), 'A-501');
  assert.equal(core.normalizeGroupCode(' f_550 '), 'F-550');
  assert.equal(core.normalizeGroupCode('501'), '');
  const { errors } = core.validateConfigPatch({ groupCode: '五零一' });
  assert.equal(errors.length, 1);
});
check('a code prefix never implies a channel', () => {
  const resolved = core.resolveChannel({ groupCode: 'A-501', channel: '' }, new Map(), '');
  assert.equal(resolved.channel, '');
  assert.equal(resolved.pending, true);
});
check('explicit channel beats a confirmed rule, which beats nothing; hint is never used', () => {
  const rules = new Map([['A-501', { channel: '单导K', enabled: true }]]);
  assert.deepEqual(core.resolveChannel({ groupCode: 'A-501', channel: 'FB群粉', channelOrigin: 'manual' }, rules, 'collector-x'), { channel: 'FB群粉', origin: 'manual', pending: false, hint: 'collector-x' });
  assert.equal(core.resolveChannel({ groupCode: 'A-501', channel: '' }, rules).channel, '单导K');
  assert.equal(core.resolveChannel({ groupCode: 'A-501', channel: '' }, rules).origin, 'rule');
  const disabled = new Map([['A-501', { channel: '单导K', enabled: false }]]);
  assert.equal(core.resolveChannel({ groupCode: 'A-501', channel: '' }, disabled).pending, true);
  assert.equal(core.resolveChannel(null, rules, 'collector-x').channel, '', 'collector hint is not an effective channel');
});
check('partial patches never clear fields that were not supplied', () => {
  const { patch } = core.validateConfigPatch({ assistant: '小李' });
  assert.deepEqual(Object.keys(patch), ['assistant']);
  const diff = core.diffConfig({ groupCode: 'A-501', channel: '单导K', pageCategory: 'P1', assistant: '小王', defaultTags: [], autoCreateCustomers: true, monitorMembership: true }, patch);
  assert.deepEqual(diff, { assistant: { from: '小王', to: '小李' } });
});
check('switches accept Chinese yes/no and reject nonsense', () => {
  assert.equal(core.validateConfigPatch({ autoCreateCustomers: '是' }).patch.autoCreateCustomers, true);
  assert.equal(core.validateConfigPatch({ monitorMembership: '关闭' }).patch.monitorMembership, false);
  assert.equal(core.validateConfigPatch({ monitorMembership: '也许' }).errors.length, 1);
});
check('tags are split, trimmed and de-duplicated', () => {
  assert.deepEqual(core.normalizeTags('高意向，新粉、高意向; 待跟进'), ['高意向', '新粉', '待跟进']);
});

const catalogKey = (a, g) => `${a}\u0000${g}`;
const catalog = new Map([[catalogKey('acc', '1@g.us'), {}], [catalogKey('acc', '2@g.us'), {}], [catalogKey('acc', '3@g.us'), {}]]);
check('batch preview rejects unknown groups and duplicates, flags code and rule conflicts', () => {
  const configs = new Map([[catalogKey('acc', '1@g.us'), { accountId: 'acc', groupJid: '1@g.us', groupCode: 'A-501', channel: '单导K', defaultTags: [] }]]);
  const rules = new Map([['F-550', { channel: 'FB群粉', enabled: true }]]);
  const { rows, summary } = core.previewBatch([
    { accountId: 'acc', groupJid: '9@g.us', input: { channel: 'X' } },
    { accountId: 'acc', groupJid: '2@g.us', input: { groupCode: 'A-501' } },
    { accountId: 'acc', groupJid: '3@g.us', input: { groupCode: 'F-550', channel: '短信群粉' } },
    { accountId: 'acc', groupJid: '3@g.us', input: { assistant: '小李' } },
    { accountId: 'acc', groupJid: '1@g.us', input: { channel: '单导K' } },
  ], { catalog, configs, rules });
  assert.equal(rows[0].status, 'rejected');
  assert.equal(rows[1].status, 'conflict');
  assert.match(rows[1].conflicts[0], /A-501/);
  assert.equal(rows[2].status, 'conflict');
  assert.match(rows[2].conflicts[0], /FB群粉/);
  assert.equal(rows[3].status, 'rejected');
  assert.match(rows[3].errors[0], /重复/);
  assert.equal(rows[4].status, 'unchanged');
  assert.deepEqual(summary, { ok: 0, unchanged: 1, conflict: 2, rejected: 2 });
});

check('CSV import requires a group ID column and maps Chinese headers', () => {
  assert.match(core.importRows('群名,渠道\n测试,单导K').errors[0], /群组ID/);
  const { entries } = core.importRows('﻿群组ID,群组名称,群组编号,渠道,跟进助理,自动建档\r\n1@g.us,A-501群,A-501,单导K,小王,是\r\n2@g.us,,,"FB群粉",,\r\n', { accountId: 'acc' });
  assert.equal(entries.length, 2);
  assert.deepEqual(entries[0], { line: 2, accountId: 'acc', groupJid: '1@g.us', input: { groupCode: 'A-501', channel: '单导K', assistant: '小王', autoCreateCustomers: '是' } });
  assert.deepEqual(entries[1].input, { channel: 'FB群粉' }, 'blank cells are omitted, not cleared');
});
check('tab-separated paste from Excel is accepted', () => {
  const { entries } = core.importRows('群组ID\t渠道\n1@g.us\t单导B');
  assert.deepEqual(entries[0].input, { channel: '单导B' });
});
check('export neutralises formula injection and round-trips through import', () => {
  const csv = core.exportCsv([{ accountId: 'acc', groupJid: '1@g.us', groupName: '=HYPERLINK("x")', groupCode: 'A-501', channel: '单导K', pageCategory: '', assistant: '+小王', defaultTags: ['新粉', '高意向'], autoCreateCustomers: true, monitorMembership: false }]);
  assert.ok(csv.startsWith('﻿所属账号,群组ID'));
  assert.match(csv, /"'=HYPERLINK\(""x""\)"/);
  const { entries } = core.importRows(csv);
  assert.equal(entries[0].input.assistant, '+小王', 'guard quote is removed on import');
  assert.equal(entries[0].input.defaultTags, '新粉、高意向');
  assert.equal(entries[0].input.autoCreateCustomers, '是');
  assert.equal(entries[0].input.monitorMembership, '否');
});

const failed = results.filter(ok => !ok).length;
console.log(`WS group channel config core: ${results.length - failed}/${results.length}`);
if (failed) process.exit(1);
