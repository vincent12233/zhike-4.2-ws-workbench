'use strict';
// WS contact exclusion page contract.
//
// Verifies the workspace navigation exposes a dedicated exclusion page, that
// the page renders from the real business-pages module (search / add / batch
// import / bulk enable-disable-delete / hit ledger), and that it stays a
// directory of exclusion rules — never a second CRM.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const repo = path.resolve(__dirname, '..');
const app = path.join(repo, 'resources', 'app');
const read = relative => fs.readFileSync(path.join(app, relative), 'utf8');
const workbench = read('modules/ws-workbench.js');
const pages = read('modules/ws-business-pages.js');
const css = read('modules/ws-workbench.css');

// --- navigation and routing --------------------------------------------------

assert.match(workbench, /id:\s*'exclusions',\s*label:\s*'通讯录排除'/,
  'the workspace navigation must register a dedicated exclusion page');
assert.match(workbench, /activeView === 'exclusions'\) body = businessPages \? businessPages\.renderExclusions\(/,
  'the exclusions route must render the business-pages exclusion renderer');
assert.match(workbench, /view === 'exclusions'/,
  'the page data loader must handle the exclusions view');
assert.doesNotMatch(workbench, /['"]exclusions['"][^]{0,200}?deleteCustomer|exclusion[\s\S]{0,120}DELETE FROM customers/i,
  'exclusion flows must never touch a customer master directly');
// Icon must exist in the shared sprite.
assert.match(read('index.html'), /<symbol id="i-shield"/, 'the nav icon must exist in the sprite');

// --- renderer over the real module -------------------------------------------

// The module is UMD: in Node it exports via module.exports, so require it
// directly rather than re-evaluating it in a sandbox.
const { renderExclusions, exclusionState } = require(path.join(app, 'modules/ws-business-pages.js'));
const fixturePage = {
  exclusion: {
    loaded: true, loading: false, query: '', error: '',
    rules: [
      { id: 'wsx-1', kind: 'phone', value: '9876543210', phone: '9876543210', displayName: '同事 A', note: '内部员工', source: 'manual', enabled: true, updatedAt: '2026-11-20T00:00:00Z' },
      { id: 'wsx-2', kind: 'jid', value: '123@lid', phone: '', displayName: '群管理员', note: '', source: 'import', enabled: false, updatedAt: '2026-11-20T01:00:00Z' },
    ],
    hits: [{ id: 'h1', ruleName: '同事 A', accountId: 'default', groupJid: 'g@g.us', memberPhone: '9876543210', action: 'auto-create-blocked', createdAt: '2026-11-20T02:00:00Z' }],
    summary: { total: 2, enabled: 1, hits: 1 },
  },
};
// renderExclusions takes the workspace page object (it derives state via
// exclusionState), so pass the page, not the state.
const html = renderExclusions(fixturePage);

assert.ok(html.includes('此通讯录用于排除专用 WS 群成员自动建档'), 'the page must state its exclusion purpose');
assert.ok(html.includes('不是 CRM 客户通讯录'), 'the page must disclaim the second-CRM reading');
assert.match(html, /排除中 1 \/ 共 2/, 'the header must show enabled/total counts');
assert.match(html, /<strong>1<\/strong>/, 'summary tiles must include enabled count');
assert.ok(html.includes('同事 A') && html.includes('9876543210'), 'rules must render with names and numbers');
assert.ok(html.includes('已停用'), 'disabled rules must be distinguishable');
assert.ok(html.includes('data-ws-action="exclusion-toggle"'), 'rows must offer enable/disable');
assert.ok(html.includes('data-ws-action="exclusion-delete"'), 'rows must offer removal');
assert.ok(html.includes('data-ws-action="exclusion-bulk-enable"') && html.includes('data-ws-action="exclusion-bulk-disable"'), 'bulk enable/disable must exist');
assert.ok(html.includes('data-ws-exclusion-form="import"'), 'batch import form must exist');
assert.ok(html.includes('data-ws-exclusion-form="add"'), 'single-add form must exist');
assert.ok(html.includes('data-ws-exclusion-select-all'), 'select-all must exist');
assert.ok(html.includes('auto-create-blocked'), 'the hit ledger must render blocked evidence');
assert.ok(html.includes('g@g.us'), 'hit rows must show the group');
assert.match(css, /ws-business-bulk/, 'bulk toolbar styles must exist');
assert.match(css, /ws-exclusion-add/, 'add/import panel styles must exist');

// Empty and loading states must not fake data.
const emptyPage = { exclusion: { loaded: true, loading: false, query: '', error: '', rules: [], hits: [], summary: { total: 0, enabled: 0, hits: 0 } } };const emptyHtml = renderExclusions(emptyPage);
assert.ok(emptyHtml.includes('当前没有排除规则'), 'empty list must be explicit');
assert.ok(emptyHtml.includes('尚无命中记录'), 'empty hit ledger must be explicit');

console.log('contact exclusion page contract: navigation, renderer, states and CSS wiring pass');
