'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../resources/app/app.js'), 'utf8');
const start = source.indexOf("  const sidebar=$('#sidebar'), collapseButton=$('#collapseNav');");
const end = source.indexOf("  $('#backupButton')", start);
assert.ok(start > 0 && end > start, 'sidebar route policy remains in the app shell');
const sidebarSource = source.slice(start, end);

function harness(narrow) {
  const classes = new Set();
  const bodyClasses = new Set();
  const attributes = new Map();
  const stored = new Map([['zhike-sidebar-collapsed', 'false']]);
  const listeners = new Map();
  let routeObserver;
  const media = { matches: narrow, addEventListener(name, callback) { listeners.set(`media:${name}`, callback); } };
  const sidebar = { setAttribute() {}, classList: { toggle(name, enabled) { enabled ? classes.add(name) : classes.delete(name); } } };
  const collapseButton = {
    setAttribute(name, value) { attributes.set(name, value); },
    querySelector() { return { setAttribute() {} }; },
    addEventListener(name, callback) { listeners.set(name, callback); },
  };
  const workspaceSwitch = { addEventListener() {} };
  const context = {
    state: { collapsed: false, view: 'home' },
    window: { matchMedia() { return media; } },
    document: { documentElement: { dataset: { view: 'home' } }, body: { classList: { toggle(name, enabled) { enabled ? bodyClasses.add(name) : bodyClasses.delete(name); } } } },
    localStorage: { setItem(key, value) { stored.set(key, value); }, getItem(key) { return stored.get(key) ?? null; } },
    MutationObserver: class { constructor(callback) { routeObserver = callback; } observe() {} },
    updateWorkspaceIdentity() {}, workspaceProfileModal() {}, profileAvatarModal() {},
    $: selector => selector === '#sidebar' ? sidebar : selector === '#collapseNav' ? collapseButton : workspaceSwitch,
    $$: () => [],
  };
  vm.createContext(context);
  vm.runInContext(sidebarSource, context, { filename: 'app-sidebar-policy.js' });
  const snapshot = () => ({ collapsed: classes.has('collapsed'), ariaExpanded: attributes.get('aria-expanded'), stored: stored.get('zhike-sidebar-collapsed') });
  const route = name => { context.state.view = name; context.document.documentElement.dataset.view = name; routeObserver([{ attributeName: 'data-view' }]); };
  const click = () => listeners.get('click')();
  const visibility = () => ({ hidden: sidebar.hidden, inert: sidebar.inert, wsClass: bodyClasses.has('ws-workspace-active') });
  const resize = narrow => { media.matches=narrow; listeners.get('media:change')(); };
  return { snapshot, visibility, route, click, media, resize };
}

const wide = harness(false);
assert.deepEqual(wide.snapshot(), { collapsed: false, ariaExpanded: 'true', stored: 'false' });
wide.route('ws-workbench');
assert.deepEqual(wide.visibility(), { hidden: true, inert: true, wsClass: true }, 'WS exclusively owns its separate navigation');
assert.deepEqual(wide.snapshot(), { collapsed: false, ariaExpanded: 'true', stored: 'false' }, 'entering WS does not mutate the original sidebar preference');
wide.click();
assert.equal(wide.snapshot().collapsed, false, 'hidden main-sidebar control cannot alter WS or the saved preference');
wide.route('customers');
assert.deepEqual(wide.visibility(), { hidden: false, inert: false, wsClass: false }, 'leaving WS restores the original sidebar');
assert.deepEqual(wide.snapshot(), { collapsed: false, ariaExpanded: 'true', stored: 'false' }, 'leaving WS restores the previous expanded preference');
wide.click();
assert.equal(wide.snapshot().stored, 'true', 'manual collapse on a normal page remains persistent');
wide.route('ws-workbench');
wide.click();
wide.route('home');
assert.deepEqual(wide.snapshot(), { collapsed: true, ariaExpanded: 'false', stored: 'true' }, 'WS does not overwrite a prior collapsed preference');

const small = harness(true);
assert.equal(small.snapshot().collapsed, true, 'narrow windows still auto-collapse');
small.click();
assert.equal(small.snapshot().collapsed, false, 'the user can manually expand the narrow rail');
small.route('ws-workbench');
assert.equal(small.snapshot().collapsed, false, 'WS keeps a narrow-window manual preference intact');
small.resize(false);
assert.equal(small.visibility().hidden, true, 'native maximization cannot reveal the main sidebar');
small.route('customers');
assert.equal(small.snapshot().collapsed, false, 'returning from WS preserves a narrow-window manual expansion');
small.resize(true);
assert.equal(small.snapshot().collapsed, false, 'restored viewport honors the prior narrow override');

const autoNarrow = harness(true);
autoNarrow.route('ws-workbench');
autoNarrow.resize(false);
autoNarrow.route('home');
assert.equal(autoNarrow.snapshot().collapsed, true, 'exit restores the entered sidebar before the native window bounds settle');
autoNarrow.resize(true);
assert.equal(autoNarrow.snapshot().collapsed, true);

console.log('sidebar WS route policy: independent navigation, hidden/inert main sidebar, preference and viewport restoration pass');
