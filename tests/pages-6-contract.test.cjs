'use strict';
// V5.0 §29 secondary pages keep a heading, a summary surface and honest copy.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repo = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(repo, 'resources/app/app.js'), 'utf8');
const index = fs.readFileSync(path.join(repo, 'resources/app/index.html'), 'utf8');

const results = [];
function check(name, fn) {
  try { fn(); results.push(true); console.log('PASS ' + name); }
  catch (error) { results.push(false); console.log('FAIL ' + name + ' :: ' + error.message); }
}

const pages = [
  ['intake', '快速录入'],
  ['operations', '任务中心'],
  ['stage-board', '阶段看板'],
  ['segments', '分类视图'],
  ['hot', '热聊管理'],
  ['groups', '群组管理'],
  ['vip', 'VIP 管理'],
  ['analytics', '统计分析'],
  ['settings', '系统设置'],
];

check('every §29 navigation destination is named', () => {
  for (const [view, label] of pages) {
    assert.ok(index.includes(`data-view="${view}"`), view);
    assert.ok(app.includes(`'${view}':'${label}'`) || app.includes(`${view}:'${label}'`), label);
  }
});
check('the follow-up page is routable and named even without a rail entry', () => {
  assert.ok(app.includes("followups:'客户跟进'"), 'navNames');
  assert.ok(app.includes("heading('客户跟进'"), 'heading');
});
check('each §29 page renders a page heading', () => {
  for (const label of ['快速录入', '分类视图', '热聊管理', '群组管理', 'VIP 管理', '统计分析', '客户跟进']) {
    assert.ok(app.includes(`heading('${label}'`), label);
  }
  for (const label of ['系统设置']) assert.ok(app.includes(`governanceHeading('${label}'`), label);
});
check('VIP stays a customer label rather than a separate group or profile set', () => {
  assert.match(app, /VIP 是客户标签与编号，不单独成群/);
  assert.match(app, /同一份客户主档/);
  assert.doesNotMatch(app, /VIP 群/);
});
check('list pages use the shared table with its own empty handling', () => {
  assert.match(app, /function simpleCustomerTable/);
  assert.match(app, /simpleCustomerTable\(list,'vip'\)/);
  assert.match(app, /simpleCustomerTable\(list,'hot'\)/);
  assert.match(app, /simpleCustomerTable\(list,'follow'\)/);
});
check('statistics and settings keep real local data surfaces', () => {
  assert.match(app, /本地实时统计/);
  assert.match(app, /所有客户、业务、WS、AI 和跟进数据均写入本机 SQLite/);
  assert.match(app, /renderCrmStatisticsHtml\(list\)/);
});
check('no page reintroduces demo or mock acceptance copy', () => {
  assert.doesNotMatch(app, /模拟数据|演示数据/);
});

const failed = results.filter(ok => !ok).length;
console.log(`Secondary pages: ${results.length - failed}/${results.length}`);
if (failed) process.exit(1);
