'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repo = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(repo, relative), 'utf8');
const index = read('resources/app/index.html');
const app = read('resources/app/app.js');
const css = read('resources/app/modules/horizon-atelier.css');
const homeCss = read('resources/app/modules/home-6.css');
const designCss = read('resources/app/modules/design-system.css');

const requiredNav = [
  '今日工作台','快速录入','任务中心','阶段看板','客户中心','分类视图','热聊管理','群组管理','VIP 管理',
  '跟票管理','报名统计','入金管理','统计分析','普通 WS','专用 WS','GPT 运营助手','本地自动化','数据治理',
  '数据中心','操作记录','回收站','系统设置','手机号登记',
];
let previous = -1;
for (const label of requiredNav) {
  const current = index.indexOf(`<span>${label}</span>`);
  assert.ok(current > previous, `navigation item missing or out of order: ${label}`);
  previous = current;
}

assert.ok(index.indexOf('horizon-atelier.css') < index.indexOf('scroll-system.css'), '6.0 visual layer must load immediately before the final scroll contract');
assert.ok(index.indexOf('global-6.css') < index.indexOf('home-6.css') && index.indexOf('home-6.css') < index.indexOf('scroll-system.css'), 'the compact home layer must load before the final scroll contract');
assert.match(app, /function renderHorizonHero\(items,kpis\)/);
assert.match(app, /document\.documentElement\.dataset\.view=view/, 'each business route must expose a stable 6.0 visual styling hook');
assert.doesNotMatch(app, /horizonLocalPriorityItems/, 'local CRM scores must never be presented as AI chat analysis');
assert.match(app, /renderHorizonHero\(\[\],horizonKpis\)/, 'the AI hero starts in a truthful loading state');
assert.match(app, /horizonAlertItems\(alerts,customerIndex,taskIndex\)/);
assert.match(app, /正在读取最新聊天分析；不会使用本地排序冒充 AI 结论/);
assert.match(app, /home-dashboard-grid/, 'the first screen keeps activity, trend and business status together');
assert.match(app, /home-detail-sections/, 'full business controls remain accessible below the compact dashboard');
assert.match(app, /资金实力 <b>55%<\/b>/);
assert.match(app, /聊天粘度 <b>45%<\/b>/);
assert.match(app, /投资经验仅补充档案，不计入提醒权重/);
assert.match(css, /--hz-sidebar-expanded:248px/);
assert.match(css, /--zhike-sidebar-expanded:var\(--hz-sidebar-expanded\)|--zhike-sidebar-expanded:248px/, 'expanded navigation has one stable width and does not compress its labels');
assert.match(css, /#mainNav\s*\{padding:0 12px 16px/, 'navigation keeps a bounded inset and its own scroll owner');
assert.match(css, /html\[data-palette\]:not\(\[data-view="ws-workbench"\]\)\s*\{/, 'main and GPT routes share one palette-aware outer shell while the independent WS workspace keeps its own geometry');
assert.doesNotMatch(css, /:not\(\[data-view="gpt"\]\)/, 'GPT retains the complete shared outer shell at every responsive breakpoint');
assert.match(designCss, /html\[data-palette\]:not\(\[data-view="ws-workbench"\]\):not\(\[data-view="gpt"\]\)\s*\{/, 'GPT content controls retain their separate design-system boundary');
assert.match(css, /#sidebar\s*\{[^}]*background:var\(--ds-rail-decoration\) center bottom\/100% auto no-repeat,var\(--ds-rail-paint\)!important[^}]*-webkit-mask-image:none;mask-image:none/, 'both palettes use the shared static curve and navy rail paint without an artwork mask clipping navigation');
assert.doesNotMatch(css, /html\[data-palette="horizon-night"\][^{]*#sidebar/, 'night mode cannot introduce a second rail geometry or paint owner');
assert.match(css, /#sidebar \.workspace-switch\s*\{[^}]*min-height:54px/, 'local workspace settings remain a reachable full-size control');
assert.match(css, /#mainNav \.nav-item\s*\{[^}]*min-height:44px[^}]*font-size:var\(--ds-font-nav\)/, 'navigation preserves readable labels and accessible targets');
assert.match(homeCss, /\.home-dashboard-grid\s*\{[^}]*grid-template-columns:minmax\(0,1\.7fr\) minmax\(300px,1fr\);grid-template-areas:"trend health" "activity activity"/,
  'the trend and health share a readable first row while activity has its own full row');
for (const area of ['trend', 'activity', 'health']) assert.match(homeCss, new RegExp(`\\.home-${area}-panel\\s*\\{grid-area:${area}\\}`),
  `the ${area} panel must bind to its real dashboard grid area`);
assert.match(homeCss, /@media\(max-width:1440px\)[\s\S]*?\.home-dashboard-grid\s*\{grid-template-columns:minmax\(0,1\.4fr\) minmax\(280px,1fr\);grid-template-areas:"trend health" "activity activity"/,
  'smaller desktop widths retain two readable columns and the complete activity row');
assert.match(homeCss, /@media\(max-width:820px\)[\s\S]*?\.home-dashboard-grid\s*\{grid-template-columns:1fr;grid-template-areas:"trend" "activity" "health"/,
  'narrow/high-DPI windows preserve all three panels in one readable column');
assert.match(css, /\.home-top-title\s*\{display:none\}/, 'the shared topbar must not duplicate the content page title');
assert.doesNotMatch(homeCss, /#viewContainer>\.page-heading[^}]*display:none/, 'the actual page heading remains visible in the content region');
assert.match(homeCss, /@media\(max-width:1150px\)[\s\S]*?\.horizon-workbench-hero\s*\{grid-template-columns:1fr/, 'AI flow and details reflow instead of clipping in smaller windows');
assert.match(css, /#sidebar\.collapsed/);
assert.match(index, /<img src="\.\/assets\/zhike-horizon-logo\.png" alt="" draggable="false" \/>/, '6.0 shell must use the Horizon logo instead of the legacy text tile');
assert.match(css, /\.brand-mark img\s*\{[^}]*object-fit:contain/, 'Horizon brand asset must stay proportionally contained');
assert.match(css, /#sidebar\s*\{[^}]*border:1px solid var\(--ds-rail-border\)!important;[^}]*border-radius:var\(--ds-radius-large\)!important/, 'the shared rail retains a visible navy-rail edge and restrained rounded shape');
assert.match(designCss, /--ds-radius-large:22px/, 'the rail uses the shared 22px panel silhouette in both palettes');
assert.match(css, /\.nav-item\.active\s*\{[^}]*color:var\(--ds-rail-active-text\)!important[^}]*box-shadow:inset 3px 0 var\(--ds-rail-accent\)/, 'active navigation uses the dedicated high-contrast rail foreground and cue without changing content-tab colors');
assert.match(css, /\.topbar\s*\{[^}]*background:var\(--ds-topbar-bg\)!important[^}]*color:var\(--ds-topbar-text\)/, 'the blue-purple topbar owns its readable foreground separately from the canvas');
assert.match(homeCss, /\.horizon-workbench-hero/);
const homeHeroMarkup = app.slice(app.indexOf('function renderHorizonHero('), app.indexOf('function ensureHomeWsFollowupPanel('));
assert.match(homeHeroMarkup, /class="horizon-kpis"[\s\S]*class="horizon-kpi-icon" aria-hidden="true"[\s\S]*class="horizon-flow-stage"/, 'KPI indicators precede the AI panels in source and visual reading order');
assert.match(homeCss, /\.horizon-kpis\s*\{grid-column:1\/-1;display:grid;grid-template-columns:repeat\(6,minmax\(0,1fr\)\)/, 'six KPI cards span the full workspace before the two-column AI section');
assert.match(homeCss, /\.horizon-kpi strong\s*\{[^}]*white-space:nowrap;[^}]*overflow-x:auto;overflow-y:hidden;[^}]*font-size:var\(--ds-font-kpi\);line-height:1\.2;/,
  'keep one-line KPI values at 26px, with enough line height and horizontal-only overflow');
for (const [limit, columns] of [[1240, 3], [600, 2], [370, 1]]) {
  const limitQuery = RegExp.escape('(max-width:' + limit + 'px)');
  const tracks = RegExp.escape('grid-template-columns:repeat(' + columns + ',minmax(0,1fr))');
  const selector = new RegExp('@container main-workspace ' + limitQuery + '\\s*\\{[^}]*\\.horizon-kpis\\s*\\{' + tracks);
  assert.match(homeCss, selector, 'KPI columns reflow according to the available workspace');
}
assert.match(app, /class="digital-horizon" aria-label="数字地平线 · 今日工作台"/, 'the original Digital Horizon banner is part of the real home renderer');
assert.match(app, /class="digital-horizon-context"[\s\S]*?esc\(today\)[\s\S]*?display\(allDue\.length\)/, 'banner date and reminder reuse actual existing values and data-read safeguards');
assert.match(app, /class="digital-horizon-art"[^>]*aria-hidden="true"[^>]*focusable="false"/, 'abstract illustration is decorative rather than a fabricated business chart');
assert.match(homeCss, /\.digital-horizon\s*\{[^}]*min-height:110px/, 'brand banner has a bounded first-screen height');
assert.match(homeCss, /\.digital-horizon-art\s*\{[^}]*pointer-events:none/, 'art cannot obstruct working controls');
assert.match(homeCss, /\.horizon-flow-stage\s*\{[^}]*padding-bottom:calc\(var\(--ds-section-inset\) \+ 12px\);[^}]*background:var\(--ds-material-3\),var\(--ds-material-0\)/, 'flow text keeps the existing surface blend with artwork confined to its footer');
assert.match(homeCss, /\.horizon-flow-stage::after\s*\{[^}]*content:"";position:absolute;inset:auto 0 0;height:22px;[^}]*background:var\(--ds-flow-art\)[^}]*pointer-events:none/, 'flow artwork stays inside the reserved bottom inset');
assert.match(css, /@media\s*\(max-width:820px\)/);
assert.match(css, /@media\s*\(max-width:560px\)/, '200% scaling needs a compact effective-width layout');
assert.match(css, /@media\s*\(max-height:620px\)/, '820x540 needs an explicit compact-height layout');
assert.match(homeCss, /\.horizon-flow-node\s*\{position:relative;inset:auto!important;transform:none!important;[^}]*flex:1 1 150px;min-width:0/, 'priority cards use normal flex flow instead of overlapping absolute coordinates');
assert.match(css, /#sidebar\.collapsed \.brand\s*\{min-height:96px/, 'collapsed rail reserves separate space for the restore control');
assert.match(css, /#collapseNav\s*\{position:absolute;right:5px;top:15px;width:var\(--ds-control-height\);height:var\(--ds-control-height\);min-width:var\(--ds-control-height\)/, 'the expanded rail toggle is 44px with the original center');
assert.match(css, /#sidebar\.collapsed #collapseNav\s*\{display:grid!important;top:51px;right:13px/, 'the 44px collapsed rail toggle keeps its original center inside the 72px rail');
assert.match(designCss, /--zk-surface:var\(--ds-surface\)/, 'legacy surfaces consume the single shared palette authority');
assert.match(designCss, /--surface-ink:var\(--ds-text\)/, 'all component layers share the palette text token');
assert.doesNotMatch(css, /\.panel[^\n{]*,[^\n{]*\.data-table tbody tr[^\n{]*\{contain:layout paint\}/, 'large panels and table rows must not clip sticky content');

const headEnd = index.indexOf('</head>');
for (const sheet of ['v4.css','gpt-assistant.css','phone-registry.css','business-enhancements.css','v41-ui.css','ws-workbench.css','design-system.css','horizon-atelier.css','scroll-system.css']) {
  assert.ok(index.indexOf(`modules/${sheet}`) > 0 && index.indexOf(`modules/${sheet}`) < headEnd, `${sheet} must preload before the first application render`);
  assert.equal((index.match(new RegExp(sheet.replace('.', '\\.'), 'g')) || []).length, 1, `${sheet} must have one stylesheet owner`);
}

for (const forbidden of ['陈先生','王先生','李女士','赵先生','268,000','286,000']) {
  assert.doesNotMatch(index + app + css + homeCss, new RegExp(forbidden), `preview sample leaked into production: ${forbidden}`);
}

console.log('Horizon Atelier contract: dynamic data, exact navigation, collapsible/responsive shell and no preview samples');
