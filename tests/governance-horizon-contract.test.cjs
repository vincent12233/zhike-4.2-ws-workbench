'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repo = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(repo, relative), 'utf8');
const app = read('resources/app/app.js');
const registry = read('resources/app/modules/phone-registry.js');
const css = read('resources/app/modules/global-6.css');

assert.match(app, /function governanceHeading\(title,subtitle,eyebrow,actions='',signals=\[\]\)/, 'governance routes need one shared 6.0 shell');
for (const title of ['助理分配建议','本地自动化','数据治理','数据中心','操作记录','回收站','系统设置']) {
  assert.match(app, new RegExp(`governanceHeading\\('${title}'`), `${title} must render through the shared 6.0 shell`);
}
assert.match(registry, /const pageHero=\(actions,signals\)=>'<section class="page-heading governance-page-hero">/, 'phone registry needs the same 6.0 shell without coupling to app internals');
assert.match(registry, /\['登记行',all\.length/, 'registry hero values must remain bound to live state');
assert.match(app, /\['最近记录',logs\.length/, 'activity hero must use live audit data');
assert.match(app, /\['已删除客户',list\.length/, 'recycle hero must use live deleted rows');
assert.match(app, /\['业务选项',opts\.length/, 'settings hero must derive its option count');

for (const selector of ['.governance-page-hero','.governance-hero-signals','.governance-signal-grid','.governance-action-grid','.automation-rules','.governance-table-empty']) {
  assert.ok(css.includes(selector), `missing governance design-system selector: ${selector}`);
}
function governancePresentation(source) {
  assert.match(source, /html\[data-palette\]:not\(\[data-view="ws-workbench"\]\):not\(\[data-view="gpt"\]\)/, 'governance presentation shares the business scope and cannot restyle WS/GPT');
  assert.match(source, /\.modal\s*\{[^}]*background:var\(--ds-surface\)!important/, 'governance modals consume the same palette-aware business surface');
  assert.match(source, /\.governance-page-hero\s*\{display:grid!important;grid-template-columns:minmax\(0,1fr\) auto/, 'governance hero retains a real copy/actions layout');
  assert.match(source, /\.governance-hero-signals\s*\{[^}]*display:grid;[^}]*minmax\(180px,1fr\)/, 'live hero signals retain their own responsive grid');
  assert.match(source, /@media\(max-width:1000px\)[\s\S]*?\.governance-page-hero\s*\{grid-template-columns:1fr\}/, 'compact governance copy/actions reflow without reducing readable type');
  assert.match(source, /@media\(max-width:560px\)[\s\S]*?:is\(\.governance-hero-signals,\.governance-signal-grid,\.governance-action-grid,\.governance-data-state\)\s*\{grid-template-columns:1fr\}/, 'high-zoom signals, actions and status remain in reachable single-column flow');
}
governancePresentation(css);
assert.throws(() => governancePresentation(css.replace('display:grid!important;grid-template-columns:minmax(0,1fr) auto', 'display:block')), /governance hero retains/, 'removing governance layout is a real regression even if the selector remains');

assert.doesNotMatch(app, /font-size:9px;color:#8490a0;line-height:1\.7/, 'data center copy must not keep legacy 9px inline styling');
assert.doesNotMatch(app, /style="width:150px"><strong>\$\{name\}/, 'settings keys must not use legacy inline sizing');
assert.doesNotMatch(app, /style="padding:0 17px">\$\{ruleRows\}/, 'automation rules must use their 6.0 component class');
assert.doesNotMatch(app, /回收站为空<\/td>[\s\S]{0,20}style=/, 'recycle empty state must use the shared empty-state contract');

console.log('governance Horizon contract: dynamic page shells, responsive structure and shared table/modal/empty-state presentation');
