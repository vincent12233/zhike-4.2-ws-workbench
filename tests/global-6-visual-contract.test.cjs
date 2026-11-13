'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repo = path.resolve(__dirname, '..');
const index = fs.readFileSync(path.join(repo, 'resources/app/index.html'), 'utf8');
const css = fs.readFileSync(path.join(repo, 'resources/app/modules/global-6.css'), 'utf8');

assert.ok(index.indexOf('modules/global-6.css') > index.indexOf('modules/operations-6.css'));
assert.ok(index.indexOf('modules/global-6.css') < index.indexOf('modules/scroll-system.css'), 'scroll ownership must remain the final stylesheet');
for (const selector of ['.topbar','.global-search','.page-heading','.btn','.panel','.data-table th','.modal','.details-drawer','.empty-state']) assert.match(css, new RegExp(selector.replace('.', '\\.')));
assert.match(css, /:focus-visible/);
assert.match(css, /:focus-within/);
assert.match(css, /@media\(max-width:820px\)/);
assert.match(css, /@media\(max-width:560px\)/);
assert.match(css, /@media\(max-width:820px\).*?\.global-search\{width:42px!important;min-width:42px!important/s, '820px chrome must keep search as a compact icon instead of crowding actions');
assert.match(css, /@media\(max-height:620px\)\{\.topbar\{height:48px!important;min-height:48px!important\}/, 'compact-height chrome must survive the final global layer');
assert.match(css, /@media\(max-height:620px\).*?\.view-container\{padding-top:10px!important\}/s, 'compact-height pages must recover vertical workspace after the global padding layer');
assert.match(css, /@media\(prefers-reduced-motion:reduce\)/);
assert.match(css, /html:not\(\[data-view="ws-workbench"\]\):not\(\[data-view="gpt"\]\)/, 'business visual layer must not override the independent WS or GPT workbenches');
assert.match(css, /\.page-heading:not\(\.governance-page-hero\)/, 'generic headings must not flatten the governance 6.0 hero');
assert.doesNotMatch(css, /backdrop-filter|filter:blur/, 'global finish must avoid expensive blur during scrolling');
assert.doesNotMatch(css, /animation:/, 'global finish must not add persistent animation work');
assert.doesNotMatch(css, /overflow\s*:\s*(auto|scroll|clip)/, 'global finish must leave scroll ownership to scroll-system.css');

console.log('Global 6.0 visual contract: Horizon chrome, accessible focus, responsive surfaces and zero scroll blur');
