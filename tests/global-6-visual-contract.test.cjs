'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repo = path.resolve(__dirname, '..');
const index = fs.readFileSync(path.join(repo, 'resources/app/index.html'), 'utf8');
const css = fs.readFileSync(path.join(repo, 'resources/app/modules/global-6.css'), 'utf8');
const primitives = fs.readFileSync(path.join(repo, 'resources/app/modules/design-system.css'), 'utf8');
const shell = fs.readFileSync(path.join(repo, 'resources/app/modules/horizon-atelier.css'), 'utf8');
const mainScope = /html\[data-palette\]:not\(\[data-view="ws-workbench"\]\):not\(\[data-view="gpt"\]\)/;
// A presentation preference may qualify the same guarded root. Both workspace
// exclusions remain mandatory; an extra attribute cannot authorize a WS rule.
const mainScopeStart = new RegExp('^html\\[data-palette\\](?:\\[data-motion="off"\\])?:not\\(\\[data-view="ws-workbench"\\]\\):not\\(\\[data-view="gpt"\\]\\)(?:$|\\s)');
function guardedSelectorList(header) {
  const selectors = [];
  let depth = 0, quote = '', escaped = false, start = 0;
  for (let i = 0; i < header.length; i++) {
    const char = header[i];
    if (escaped) { escaped = false; continue; }
    if (char === '\\') { escaped = true; continue; }
    if (quote) { if (char === quote) quote = ''; continue; }
    if (char === '"' || char === "'") { quote = char; continue; }
    if (char === '(' || char === '[') depth++;
    if (char === ')' || char === ']') depth--;
    if (char === ',' && depth === 0) { selectors.push(header.slice(start, i).trim()); start = i + 1; }
  }
  selectors.push(header.slice(start).trim());
  return selectors.every(selector => mainScopeStart.test(selector));
}

// A scope marker somewhere in the file cannot prove that a later rule does
// not leak. Validate every qualified rule, including nested media rules.
function assertBusinessScope(source) {
  const text = source.replace(/\/\*[\s\S]*?\*\//g, '');
  const stack = [];
  let start = 0, quote = '', escaped = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (escaped) { escaped = false; continue; }
    if (char === '\\') { escaped = true; continue; }
    if (quote) { if (char === quote) quote = ''; continue; }
    if (char === '"' || char === "'") { quote = char; continue; }
    if (char === '{') {
      const header = text.slice(start, i).trim();
      if (!header.startsWith('@')) assert.ok(guardedSelectorList(header) || stack.some(guardedSelectorList), `Unscoped business rule: ${header}`);
      stack.push(header); start = i + 1;
    } else if (char === '}') {
      assert.ok(stack.length, 'Business CSS has an unmatched closing brace');
      stack.pop(); start = i + 1;
    }
  }
  assert.equal(stack.length, 0, 'Business CSS has an unmatched opening brace');
}

assert.ok(index.indexOf('modules/global-6.css') > index.indexOf('modules/operations-6.css'));
assert.ok(index.indexOf('modules/global-6.css') < index.indexOf('modules/scroll-system.css'), 'scroll ownership must remain the final stylesheet');
for (const selector of ['.page-heading','.panel','.data-table','.modal','.details-drawer','.empty-state']) assert.ok(css.includes(selector), `Business surfaces retain ${selector}`);
for (const selector of ['.topbar','.global-search','.workspace-switcher']) assert.ok(shell.includes(selector), `Shell owns ${selector}`);
assert.match(primitives, /:is\(\.btn,\.btn\.small,\.page-btn,\.table-action,\.link-button\)/, 'shared primitives own button presentation');
assert.match(primitives, /:focus-visible/);
assert.match(css, /:focus-within/);
assert.match(css, /@media\(max-width:820px\)/);
assert.match(css, /@media\(max-width:560px\)/);
assert.match(shell, /@media\(max-width:820px\)[\s\S]*?\.global-search\s*\{width:44px!important;min-width:44px/, '820px chrome retains an accessible 44px search target');
assert.match(shell, /@container main-workspace \(max-width:1000px\)[\s\S]*?\.global-search\s*\{width:44px!important;min-width:44px/, 'search responds to available workspace width, including the expanded main rail');
assert.match(shell, /@container main-workspace \(max-width:660px\)[\s\S]*?\.topbar\s*\{flex-wrap:wrap/, 'small workspace chrome wraps rather than clipping actions');
assert.match(shell, /@media\(max-height:620px\)[\s\S]*?\.topbar\s*\{min-height:64px!important;padding-block:4px!important\}/, 'compact-height chrome accommodates the shared 56px workspace switcher');
assert.match(shell, /@media\(max-height:620px\)[\s\S]*?\.view-container\s*\{padding-top:16px!important\}/, 'compact-height pages retain a deliberate readable inset');
assert.doesNotMatch(shell, /#(?:shortcutButton|backupButton|notificationButton|appearanceButton)[^{]*\{[^}]*display\s*:\s*none/, 'responsive chrome cannot hide primary help, backup, reminder or appearance actions');
assert.match(css, /@media\(prefers-reduced-motion:reduce\)/);
assertBusinessScope(css);
assert.throws(() => assertBusinessScope('html[data-palette][data-motion="off"]:not([data-view="ws-workbench"]) .metric-card{transition:none}'), /Unscoped business rule/, 'motion preferences cannot bypass the GPT workspace exclusion');
assert.throws(() => assertBusinessScope('html[data-palette][data-motion="off"]:not([data-view="gpt"]) .metric-card{transition:none}'), /Unscoped business rule/, 'motion preferences cannot bypass the WS workspace exclusion');
assert.throws(() => assertBusinessScope(css.replace(mainScope, 'html[data-palette]')), /Unscoped business rule/, 'removing one workspace guard must fail the contract');
assert.throws(() => assertBusinessScope(css + '\n.ws-workspace-page-content{color:red}'), /Unscoped business rule/, 'an unguarded trailing override must fail even if earlier rules are scoped');
assert.throws(() => assertBusinessScope(css.replace(mainScope, match => match + ',.ws-workspace-page-content')), /Unscoped business rule/, 'an unguarded selector-list arm cannot borrow another selector\'s guard');
assert.match(css, /\.page-heading:not\(\.governance-page-hero\)/, 'generic headings must not flatten the governance 6.0 hero');
assert.doesNotMatch(css, /backdrop-filter|filter:blur/, 'global finish must avoid expensive blur during scrolling');
assert.doesNotMatch(css, /animation:/, 'global finish must not add persistent animation work');
assert.doesNotMatch(css, /overflow\s*:\s*(auto|scroll|clip)/, 'global finish must leave scroll ownership to scroll-system.css');

console.log('Shared visual contract: explicit chrome/control/business ownership, guarded palettes, accessible targets and unchanged scroll ownership');
