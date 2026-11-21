'use strict';
// V5.0 §19 customer 360 governance view: field sources, conflicts, history.
const assert = require('node:assert/strict');
const view = require('../resources/app/modules/customer-governance-view.js');

const results = [];
function check(name, fn) {
  try { fn(); results.push(true); console.log('PASS ' + name); }
  catch (error) { results.push(false); console.log('FAIL ' + name + ' :: ' + error.message); }
}
const evidence = [
  { fieldName: 'occupation', value: '工程师', sourceText: '我是工程师', confidence: 0.9, status: 'accepted', createdAt: '2026-11-19T10:00:00Z', updatedAt: '2026-11-19T10:00:00Z' },
  { fieldName: 'occupation', value: '医生', sourceText: '旧消息', confidence: 0.5, status: 'accepted', createdAt: '2026-11-18T10:00:00Z', updatedAt: '2026-11-18T10:00:00Z' },
  { fieldName: 'holdings', value: ['AAPL', 'TSLA'], sourceText: '持有苹果和特斯拉', confidence: 0.8, status: 'accepted', createdAt: '2026-11-20T10:00:00Z', updatedAt: '2026-11-20T10:00:00Z' },
  { fieldName: 'country', value: 'Mumbai', sourceText: '我在孟买', confidence: 0.4, status: 'conflict', createdAt: '2026-11-20T10:00:00Z', updatedAt: '2026-11-20T10:00:00Z' },
];
const actions = [{
  action: 'update', reason: 'AI 补齐', source: 'AI', confidence: 0.9, createdAt: '2026-11-20T11:00:00Z',
  before: { occupation: '', country: '' }, after: { occupation: '工程师', country: 'Mumbai' },
}];

check('loading and error states say so and never invent data', () => {
  const loading = view.renderGovernancePanel({ loading: true });
  assert.match(loading, /正在读取/);
  const error = view.renderGovernancePanel({ error: '本机接口不可用' });
  assert.match(error, /本机接口不可用/);
  assert.match(error, /role="alert"/);
});
check('conflicts are shown first with their existing value and source', () => {
  const html = view.renderGovernancePanel({ evidence, conflicts: evidence.filter(item => item.status === 'conflict') });
  assert.match(html, /待确认冲突 · 1/);
  assert.ok(html.indexOf('待确认冲突') < html.indexOf('governance-source-table'), 'conflicts come before the source table');
  assert.match(html, /地区/);
  assert.match(html, /我在孟买/);
});
check('the newest evidence per field is the one shown', () => {
  const html = view.renderGovernancePanel({ evidence, conflicts: [] });
  assert.match(html, /工程师/);
  assert.doesNotMatch(html, />医生</, 'older evidence for the same field is not listed as the current source');
});
check('list values are readable, not JSON noise', () => {
  const html = view.renderGovernancePanel({ evidence, conflicts: [] });
  assert.match(html, /AAPL、TSLA/);
});
check('a conflict evidence row is not presented as an accepted source', () => {
  const html = view.renderGovernancePanel({ evidence, conflicts: evidence.filter(item => item.status === 'conflict') });
  const sourceTable = html.slice(html.indexOf('governance-source-table'));
  assert.doesNotMatch(sourceTable, /我在孟买/, 'the disputed value is not listed as field source');
});
check('change history shows real before → after differences', () => {
  const html = view.renderGovernancePanel({ evidence: [], actions, conflicts: [] });
  assert.match(html, /更新资料/);
  assert.match(html, /职业：空 → 工程师/);
  assert.match(html, /地区：空 → Mumbai/);
  assert.match(html, /trusted|AI/);
});
check('an empty profile has honest empty states', () => {
  const html = view.renderGovernancePanel({ evidence: [], actions: [], conflicts: [] });
  assert.match(html, /尚无已采纳的字段来源记录/);
  assert.match(html, /尚无资料变更记录/);
  assert.doesNotMatch(html, /待确认冲突/);
});
check('every value is escaped', () => {
  const html = view.renderGovernancePanel({
    evidence: [{ fieldName: '<script>x</script>', value: '<img src=x onerror=alert(1)>', sourceText: '"><b>', confidence: 1, status: 'accepted' }],
    actions: [{ action: 'update', reason: '<b>', source: '<i>', before: {}, after: { note: '<svg>' } }],
    conflicts: [{ fieldName: 'country', value: '<iframe>', sourceText: '<script>', confidence: 1 }],
  });
  assert.doesNotMatch(html, /<script>|<iframe>|<img src=x|<svg>/);
  assert.match(html, /&lt;script&gt;/);
});
check('malformed payloads never throw', () => {
  for (const payload of [undefined, null, {}, { evidence: 'x', actions: 5, conflicts: null }, { evidence: [null, 3] }]) {
    const html = view.renderGovernancePanel(payload);
    assert.equal(typeof html, 'string');
    assert.ok(html.length > 20);
  }
});
check('confidence is shown as a bounded percentage', () => {
  const html = view.renderGovernancePanel({ evidence: [{ fieldName: 'name', value: 'A', confidence: 3, status: 'accepted' }] });
  assert.match(html, /100%/);
  const negative = view.renderGovernancePanel({ evidence: [{ fieldName: 'name', value: 'A', confidence: -1, status: 'accepted' }] });
  assert.match(negative, /0%/);
});

const failed = results.filter(ok => !ok).length;
console.log(`Customer governance view: ${results.length - failed}/${results.length}`);
if (failed) process.exit(1);
