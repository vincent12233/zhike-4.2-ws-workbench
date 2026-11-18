'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const app = path.join(__dirname, '../resources/app');
const main = fs.readFileSync(path.join(app, 'app.js'), 'utf8');
const enhancer = fs.readFileSync(path.join(app, 'modules/v4-data-center.js'), 'utf8');
function between(source, start, end) {
  const offset = source.indexOf(start);
  const through = source.indexOf(end, offset);
  assert.ok(offset >= 0 && through > offset, 'Extract the actual renderer and preserve its boundaries');
  return source.slice(offset, through);
}
const lineWith = (source, text) => source.split(/\r?\n/).find(line => line.includes(text));
const esc = value => String(value ?? '');

function viewFixture(extra) {
  const view = { innerHTML: '' };
  return { view, runtime: {
    $: selector => { assert.equal(selector, '#viewContainer'); return view; },
    heading: (_title, _subtitle, actions) => actions,
    btn: (label, _icon, action) => '<button data-action="' + action + '">' + label + '</button>',
    icons: () => '',
    esc,
    ...extra,
  } };
}

test('one delegated registration export click downloads all confirmed rows without an unavailable toast', async () => {
  const customers = [{ id: 'A', name: '甲' }, { id: 'B', name: '乙' }, { id: 'C', name: '软删除', deleted: true }];
  const registration = (customerId, source, note, status = '已报名') => ({ customerId, source, note, status, date: '2026-11-18' });
  const state = { view: 'registrations', customers, perPage: 1, registrationSource: '单导', registrations: [
    registration('A', '单导', 'MATCH_VISIBLE'),
    registration('B', '群粉', 'MATCH_OTHER_SOURCE'),
    registration('A', '单导', 'EXCLUDE_DRAFT', ''),
    registration('C', '群粉', 'EXCLUDE_DELETED'),
  ] };
  let viewClick;
  const captureClicks = [], bubbleClicks = [], effects = [];
  const f = viewFixture({ state, today: '2026-11-18', assistants: [],
    sameId: (a, b) => String(a) === String(b),
    activeCustomers: () => customers.filter(row => !row.deleted),
    document: { addEventListener(type, handler, capture) {
      assert.equal(type, 'click');
      (capture ? captureClicks : bubbleClicks).push(handler);
    } },
    download(name, csv, mime) { effects.push({ kind: 'download', name, csv, mime }); },
    toast(message) { effects.push({ kind: 'toast', message }); },
  });
  f.view.addEventListener = (type, handler) => { assert.equal(type, 'click'); viewClick = handler; };
  const documentDelegates = main.split(/\r?\n/).filter(line => line.startsWith("  document.addEventListener('click',"));
  vm.runInNewContext([
    between(main, '  function renderRegistrations(){', '  function registrationModal(){'),
    between(main, '  function csvCell(', '  function exportCurrentView('),
    between(main, '  async function handleAction(', "  $('#mainNav').addEventListener('click'"),
    between(main, "  $('#viewContainer').addEventListener('click'", "  $('#modalBackdrop').addEventListener('click'"),
    ...documentDelegates,
    'renderRegistrations();',
  ].join('\n'), f.runtime);
  assert.match(f.view.innerHTML, /当前筛选 1 条/);
  assert.match(f.view.innerHTML, /MATCH_VISIBLE/);
  assert.doesNotMatch(f.view.innerHTML, /MATCH_OTHER_SOURCE/);
  const action = f.view.innerHTML.match(/data-action="([^"]+)">导出全部报名<\/button>/)?.[1];
  assert.equal(action, 'export-registrations');
  const button = { dataset: { action } };
  const event = { target: { closest(selector) {
    return ['[data-action]', '[data-action="export-registrations"]'].includes(selector) ? button : null;
  } } };
  for (const listener of [...captureClicks, viewClick, ...bubbleClicks]) listener(event);
  await new Promise(setImmediate);
  assert.deepEqual(effects.map(effect => effect.kind), ['download'], JSON.stringify(effects));
  const [{ name, csv: exported, mime }] = effects;
  assert.equal(name, '报名记录_2026-11-18.csv');
  assert.equal(mime, 'text/csv;charset=utf-8');
  assert.match(exported, /^\uFEFF报名时间,客户,号码,来源,负责人,状态,备注\r\n/);
  assert.match(exported, /MATCH_VISIBLE/);
  assert.match(exported, /MATCH_OTHER_SOURCE/, 'CSV keeps all confirmed registrations across filter and page bounds');
  assert.doesNotMatch(exported, /EXCLUDE_DRAFT|EXCLUDE_DELETED/);
});

test('main analysis shows no filled bars for zero and preserves the active-customer denominator', () => {
  const f = viewFixture({
    counts: () => ({ total: 2, joined: 1, hot: 0, vip: 0, ticket: 0, deposit: 0, unassigned: 0, missingGroup: 0, overdue: 0 }),
    activeCustomers: () => [{ source: '实际渠道' }, { source: '其他渠道' }],
    statusSourceSummary: () => [{ source: '实际渠道' }, { source: '零渠道' }],
    effectiveCustomerSource: row => row.source,
    renderStatusSummary: () => '',
  });
  vm.runInNewContext(lineWith(main, 'function renderAnalytics(){') + '\nrenderAnalytics();', f.runtime);
  assert.match(f.view.innerHTML, /实际渠道<\/span><div class="bar-small"[^>]*><i style="width:50%"/);
  assert.match(f.view.innerHTML, /零渠道<\/span><div class="bar-small"[^>]*><i style="width:0%"/);
  assert.match(f.view.innerHTML, /style="width:50%">已进群<\/div><\/div><strong class="funnel-num">1<\/strong>/);
  assert.match(f.view.innerHTML, /class="funnel-bar" style="[^"]*background:none!important[^"]*">热聊客户<\/div><\/div><strong class="funnel-num">0<\/strong>/);
});

test('filtered analysis keeps independent counts and their ratios without painting zero bars', async () => {
  const customers = ['A', 'B', 'C'].map(id => ({ id, source: '单导', qualification: 'A级' }));
  const sections = new Map();
  const get = selector => { if (!sections.has(selector)) sections.set(selector, {}); return sections.get(selector); };
  const sourceFilter = { dataset: { v4Filter: 'source' }, value: '' };
  const box = { querySelector: get, querySelectorAll: () => [sourceFilter] };
  let mounted = false;
  let sectionMarkup;
  const view = {
    querySelectorAll: () => [{ textContent: '统计分析' }],
    querySelector: selector => selector === '#v4Conversion' && mounted ? box : null,
    insertAdjacentHTML: (_position, markup) => { mounted = true; sectionMarkup = markup; },
  };
  const registration = { customerId: 'A', status: '已报名' };
  const data = { customers, registrations: [registration, registration], tickets: [],
    deposits: [{ customerId: 'B' }, { customerId: 'C' }, { customerId: 'C' }] };
  await vm.runInNewContext(between(enhancer, '  async function analytics(){', '  let batchLogPending=') + '\nanalytics();',
    { view, state: async () => data, esc });
  assert.match(sectionMarkup, /各业务项独立按客户去重/);
  const cards = [...get('[data-v4-funnel]').innerHTML.matchAll(/<span>([^<]+)<\/span><strong>(\d+)<\/strong><small>([^<]+)<\/small><i style="width:([\d.]+)%"/g)]
    .map(([, name, count, detail, width]) => ({ name, count: Number(count), detail, width: Number(width) }));
  assert.deepEqual(cards.map(({ name, count }) => [name, count]), [['新增', 3], ['报名', 1], ['跟票', 0], ['入金', 2]]);
  assert.equal(cards[2].width, 0);
  assert.ok(Math.abs(cards[1].width - 100 / 3) < 1e-8);
  assert.ok(Math.abs(cards[3].width - 200 / 3) < 1e-8);
  assert.deepEqual(cards.map(({ detail }) => detail), ['筛选客户', '33% 相对上一项', '0% 相对上一项', '无可比基数']);

  sourceFilter.value = '无匹配渠道';
  box.onchange();
  const empty = get('[data-v4-funnel]').innerHTML;
  assert.equal((empty.match(/<strong>0<\/strong>/g) || []).length, 4);
  assert.equal((empty.match(/style="width:0%"/g) || []).length, 4);
  assert.equal((empty.match(/无可比基数/g) || []).length, 3);
  assert.doesNotMatch(empty, /NaN|Infinity|相对上一项/);
});
