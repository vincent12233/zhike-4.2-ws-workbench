'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repo = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(repo, relative), 'utf8');
const index = read('resources/app/index.html');
const app = read('resources/app/app.js');
const css = read('resources/app/modules/horizon-atelier.css');

const requiredNav = [
  '今日工作台','快速录入','任务中心','阶段看板','客户中心','分类视图','热聊管理','群组管理','VIP 管理',
  '跟票管理','报名统计','入金管理','统计分析','WS 工作台','GPT 运营助手','本地自动化','数据治理',
  '数据中心','操作记录','回收站','系统设置','手机号登记',
];
let previous = -1;
for (const label of requiredNav) {
  const current = index.indexOf(`<span>${label}</span>`);
  assert.ok(current > previous, `navigation item missing or out of order: ${label}`);
  previous = current;
}

assert.ok(index.indexOf('horizon-atelier.css') < index.indexOf('scroll-system.css'), '6.0 visual layer must load immediately before the final scroll contract');
assert.match(app, /function renderHorizonHero\(items,kpis\)/);
assert.match(app, /document\.documentElement\.dataset\.view=view/, 'each business route must expose a stable 6.0 visual styling hook');
assert.match(app, /horizonLocalPriorityItems\(list,business\)/);
assert.match(app, /horizonAlertItems\(alerts,customerIndex,taskIndex\)/);
assert.match(app, /当前没有客户数据或可执行提醒，不会预置演示客户/);
assert.match(app, /资金实力 <b>55%<\/b>/);
assert.match(app, /聊天粘度 <b>45%<\/b>/);
assert.match(app, /投资经验仅补充档案，不计入提醒权重/);
assert.match(css, /--hz-sidebar-expanded:246px/);
assert.match(css, /\.sidebar\.collapsed/);
assert.match(index, /<img src="\.\/assets\/zhike-horizon-logo\.png" alt="" draggable="false" \/>/, '6.0 shell must use the Horizon logo instead of the legacy text tile');
assert.match(css, /\.brand-mark img\{[^}]*object-fit:contain/, 'Horizon brand asset must stay proportionally contained');
assert.match(css, /border-radius:46px 78px 94px 36px \/ 52px 82px 126px 42px/, 'expanded sidebar must keep the approved sculptural silhouette');
assert.match(css, /border:1px solid rgba\(231,199,136,\.27\)!important/, 'sidebar needs the restrained gold material edge from the approved preview');
assert.match(css, /\.nav-item\.active\{[\s\S]*?border-color:rgba\(240,210,151,\.5\)!important/, 'active navigation must use the approved gold-and-teal focus treatment');
assert.match(css, /\.horizon-workbench-hero/);
assert.match(css, /@media \(max-width:820px\)/);
assert.match(css, /@media \(max-width:560px\)/, '200% scaling needs a compact effective-width layout');
assert.match(css, /@media \(max-height:620px\)/, '820x540 needs an explicit compact-height layout');
assert.match(css, /\.horizon-flow-node,\.horizon-flow-node:nth-child\(n\)\{position:relative;inset:auto;width:100%/, 'priority cards must reflow instead of overlap at high zoom');
assert.match(css, /\.sidebar\.collapsed \.brand-mark[^}]*display:none!important/, 'collapsed rail keeps its control inside the clipped shell');
assert.match(css, /\.sidebar\.collapsed \.collapse-button\{position:static/, 'collapse button must remain reachable inside the rail');
assert.match(css, /--zk-surface:var\(--hz-surface\)/, 'legacy components must consume the 6.0 surface token');
assert.match(css, /--surface-ink:var\(--hz-text\)/, 'all component layers must share the 6.0 text token');
assert.doesNotMatch(css, /\.panel[^\n{]*,[^\n{]*\.data-table tbody tr[^\n{]*\{contain:layout paint\}/, 'large panels and table rows must not clip sticky content');

const headEnd = index.indexOf('</head>');
for (const sheet of ['v4.css','gpt-assistant.css','phone-registry.css','business-enhancements.css','v41-ui.css','ws-workbench.css','design-system.css','horizon-atelier.css','scroll-system.css']) {
  assert.ok(index.indexOf(`modules/${sheet}`) > 0 && index.indexOf(`modules/${sheet}`) < headEnd, `${sheet} must preload before the first application render`);
  assert.equal((index.match(new RegExp(sheet.replace('.', '\\.'), 'g')) || []).length, 1, `${sheet} must have one stylesheet owner`);
}

for (const forbidden of ['陈先生','王先生','李女士','赵先生','268,000','286,000']) {
  assert.doesNotMatch(index + app + css, new RegExp(forbidden), `preview sample leaked into production: ${forbidden}`);
}

console.log('Horizon Atelier contract: dynamic data, exact navigation, collapsible/responsive shell and no preview samples');
