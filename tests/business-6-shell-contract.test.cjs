'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repo = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(repo, relative), 'utf8');
const index = read('resources/app/index.html');
const app = read('resources/app/app.js');
const css = read('resources/app/modules/business-6.css');
const registryCss = read('resources/app/modules/phone-registry.css');

assert.match(index, /modules\/business-6\.css/);
assert.match(app, /function business6ModuleContext\(\)/);
assert.match(app, /function enhanceBusiness6ModuleShell\(\)/);
for (const view of ['customers','groups','vip','tickets','registrations','deposits','analytics']) {
  assert.match(app, new RegExp(view === 'analytics' ? `LIVE BUSINESS INTELLIGENCE` : `view==='${view}'`), `${view} must have a 6.0 dynamic workspace context`);
}
assert.match(app, /if\(!supported\.includes\(view\)\)return null/, 'non-business views must avoid business aggregation work');
assert.match(app, /客户资料是唯一主档/);
assert.match(app, /同一客户、不同股票、买入与卖出按独立业务记录保存/);
assert.match(app, /不再把所有群粉合并/);
assert.match(app, /渠道设置、导入识别与进退群事件共用同一套分类/);
assert.match(app, /统计沿用原有口径，不制造演示值/);
assert.match(app, /enhanceBusiness6ModuleShell\(\);/);
assert.match(css, /\.business6-command-deck/);
assert.match(css, /#viewContainer\[data-business6\] \.table-panel/);
assert.doesNotMatch(app + css, /陈先生|李女士|王先生|268,000/, '6.0 shell must not contain preview customer samples');

// Module emphasis must not become a second hard-coded light/dark palette.
for (const route of ['intake','stage-board','segments','groups','deposits','quality','phone-registry','operations','tickets','automation','followups','hot','vip','registrations','activity','recycle','settings']) {
  assert.ok(css.includes(`[data-view="${route}"]`), `${route} retains its workspace presentation boundary`);
}
for (const declaration of css.matchAll(/--module-(?:accent|tint)\s*:\s*([^;}]+)/g)) {
  assert.match(declaration[1], /^var\(--ds-[\w-]+\)$/, 'Module emphasis reuses a shared, theme-aware semantic color');
}
const reducedMotion = /@media\(prefers-reduced-motion:reduce\)\s*\{\s*\.business6-rule summary::?after\s*,\s*#viewContainer\[data-business6\] \.data-table tbody tr\s*\{\s*transition:none\s*\}\s*\}/;
const motionOff = /html\[data-motion="off"\] \.business6-rule summary::after\s*,\s*html\[data-motion="off"\] #viewContainer\[data-business6\] \.data-table tbody tr\s*\{\s*transition:none\s*\}/;
assert.ok(reducedMotion.test(css), 'system reduced motion directly targets the business disclosure arrow and table rows');
assert.ok(motionOff.test(css), 'app motion off directly targets the business disclosure arrow and gates both selectors');
assert.doesNotMatch(registryCss, /#[0-9a-f]{3,8}\b|rgba?\(|font-size:\s*1[0123]px|!important/i, 'The number ledger cannot reintroduce hard-coded dark colors, tiny text or competing override layers');
assert.match(registryCss, /input:not\(\[type="checkbox"\]\)/, 'Full-width editable fields exclude row-selection checkboxes');
assert.match(registryCss, /\.registry-pagination\{[^}]*flex-wrap:wrap/, 'Ledger pagination wraps in small workspaces');
assert.match(registryCss, /\.registry-table\{min-width:960px\}/, 'The existing inner table scroll remains responsible for dense ledger columns');

console.log('Business 6.0 shell contract: linked records, settings-driven channels and redesigned dynamic workspaces');
