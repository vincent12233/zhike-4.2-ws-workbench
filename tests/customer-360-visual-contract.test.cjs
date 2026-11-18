'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const app = fs.readFileSync(path.join(__dirname, '../resources/app/app.js'), 'utf8');
function sourceBetween(start, end) {
  const first = app.indexOf(start);
  const last = app.indexOf(end, first);
  assert.ok(first >= 0 && last > first, start);
  return app.slice(first, last);
}

const customer = {
  id: 'fixture',
  name: 'நிலா <CRM>',
  rawPhone: '+91 9000000000',
  phone: '9000000000',
  hot: true,
  status: '在群',
  phase: '高意向',
  vipNumber: 'VIP-01',
  group: '本机 CRM 群',
  due: '2026-11-17',
  tags: ['回访 <测试>'],
  avatarUrl: 'https://example.invalid/unapproved-avatar',
};
const state = { customers: [customer], tickets: [], deposits: [], registrations: [], followups: [] };
const avatarCalls = [];
const fixture = vm.createContext({
  state,
  window: { ZhikeAvatar: {
    render(options) {
      avatarCalls.push(options);
      return `<span data-avatar-size="${options.size}"></span>`;
    },
  } },
  fetch() { throw new Error('Customer 360 rendering must not request remote data'); },
  esc: value => String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[char]),
  icons: icon => `<svg data-icon="${icon}"></svg>`,
  today: '2026-11-18',
  normalizeObjectRows: value => value.filter(row => row && typeof row === 'object' && !Array.isArray(row)),
});
const helpers =
  sourceBetween('  const selectionKey =', '  class SelectionSet') +
  sourceBetween('  const money =', '  let today =') +
  sourceBetween('  const linkedPhone=', '  function customersByPriority(') +
  sourceBetween("  function customerAvatarHtml(", '  function customerRows(') +
  sourceBetween('  function statusTag(', '  function paginationButtons(') +
  sourceBetween('  function horizonNodeHtml(', '  function updateHorizonFlow(') +
  sourceBetween('  function customerIdentityHtml(', '  function updateCustomerPreviewHighlight(');
vm.runInContext(helpers, fixture);

const panels = fixture.customerCenterFocusHtml(customer, true);
for (const title of ['基础资料', '热聊资料', '业务概览', '群组关系', '跟进时间线', '阅读统计', 'AI 摘要']) {
  assert.match(panels, new RegExp(title));
}
assert.match(panels, /data-avatar-size="hero"/);
assert.equal(avatarCalls[0].name, customer.name);
assert.equal(avatarCalls[0].vip, true);
assert.equal(avatarCalls[0].image, undefined);
assert.doesNotMatch(panels, /example\.invalid|<CRM>/);
assert.match(panels, /நிலா &lt;CRM&gt;/);
assert.match(panels, /VIP VIP-01/);
assert.match(panels, /回访 &lt;测试&gt;/);
assert.match(panels, /跟进状态[\s\S]*逾期/);
assert.match(panels, /暂无 WS 群组关系记录，整体同步状态未知/);
assert.match(panels, /阅读统计[\s\S]*Unknown/);
assert.match(panels, /尚无已保存的聊天分析摘要/);

const displayAmount = () => fixture.customerBusinessFields(customer).find(([label]) => label === '累计入金')[1];
assert.equal(displayAmount(), 'Unknown');
state.deposits.push({ id: 'deposit', customerId: customer.id, amount: null });
assert.equal(displayAmount(), 'Unknown', 'missing amount in a linked record does not become zero');
state.deposits[0].amount = 0;
state.dataRevision = 1;
assert.equal(displayAmount(), '¥0', 'a confirmed explicit zero stays zero');
state.deposits[0].status = '待确认';
state.dataRevision++;
assert.equal(displayAmount(), 'Unknown');
state.deposits[0].status = '已确认';
state.deposits[0].amount = 400;
state.dataRevision++;
assert.equal(displayAmount(), '¥400');

customer.aiSummary = '<script>stored only</script>';
customer.groupMemberships = [
  { groupJid: 'fixture@g.us', groupName: '已记录 WS 群', accountId: 'ACCOUNT-ONLY', status: '在群' },
  { groupJid: 'other@g.us', groupName: '缺少账号的关系', status: '在群' },
];
const populated = fixture.customerCenterFocusHtml(customer);
assert.match(populated, /已记录 WS 群/);
assert.match(populated, /ACCOUNT-ONLY/);
assert.match(populated, /缺少账号的关系/);
assert.match(populated, /账号未记录/);
assert.match(populated, /关联待核实 · 历史状态：在群/);
assert.equal((populated.match(/<span class="status-tag tag-green">在群<\/span>/g)||[]).length,2,
  'only the CRM hero and the account-scoped relation show a current-status badge');
assert.match(populated, /&lt;script&gt;stored only&lt;\/script&gt;/);
assert.doesNotMatch(populated, /<script>/);
assert.match(populated, /data-action="open-search-customer" data-id="fixture"/);
const alert = { name: customer.name, customerId: customer.id, taskId: 'task', priority: 82, followupTime: '待安排' };
const flowNode = fixture.horizonNodeHtml(alert, 0);
assert.match(flowNode, /data-action="go-operations" data-task-id="task" data-flow-index="0"><span data-avatar-size="list">/);
const spotlight = fixture.horizonSpotlightHtml(alert);
assert.match(spotlight, /class="horizon-spotlight-head"><span data-avatar-size="detail">/);
assert.match(spotlight, /data-customer="fixture">查看档案/);
assert.equal(avatarCalls.at(-2).name, customer.name);
assert.equal(avatarCalls.at(-1).name, customer.name);
console.log('Customer 360 uses CRM identity and saved summaries, separates amount evidence from zero, and keeps unobserved reading unknown.');
