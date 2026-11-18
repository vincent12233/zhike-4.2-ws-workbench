'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../resources/app/modules/workspace-shell.js'), 'utf8');
function fixture(saved, view = 'home') {
  const listeners = new Map(), writes = [], clicks = [], notices = [], modals = [];
  const root = { dataset: { view }, };
  let onMutation, onModalMutation, closed = 0, modalBody = '', modalHidden = true;
  const backdrop = { classList: { contains: name => name === 'hidden' && modalHidden } }, modal = {};
  const tabs = ['main', 'ws'].map(value => ({ dataset: { workspaceTarget: value }, active: false,
    classList: { toggle(name, enabled) { tabs.find(x => x.dataset.workspaceTarget === value).active = enabled; } },
    setAttribute(key, val) { this[key] = val; },
    click() { event('click', { closest: selector => selector === '[data-workspace-target]' ? this : null }); } }));
  const nav = new Map(['home', 'customers', 'groups', 'ws-workbench'].map(route => [route, {
    dataset: { view: route }, hidden: false, disabled: false, getAttribute: () => null,
    click() { clicks.push(route); root.dataset.view = route; onMutation?.(); },
  }]));
  const host = { toast: message => notices.push(message),
    openModal(title, subtitle, body, footer) { assert.equal(title, '外观偏好'); assert.ok(subtitle); modalHidden = false; modalBody = body; modals.push({ title, subtitle, body, footer }); },
    closeModal() { closed++; modalHidden = true; onModalMutation?.(); }, persist() { throw Error('No business write allowed'); } };
  const document = { documentElement: root,
    querySelectorAll(selector) {
      if (selector === '[data-workspace-target]') return tabs;
      if (selector === '#mainNav .nav-item[data-view]') return [...nav.values()];
      return [];
    },
    querySelector(selector) {
      if (selector === '#modal [data-shell-appearance]') return modalBody.includes('data-shell-appearance') ? {} : null;
      if (selector === '#modalBackdrop') return backdrop;
      if (selector === '#modal') return modal;
      const workspace = selector.match(/^\[data-workspace-target="(main|ws)"\]$/);
      if (workspace) return tabs.find(tab => tab.dataset.workspaceTarget === workspace[1]) || null;
      const match = selector.match(/^(?:#mainNav |\.nav-item)\[data-view="([^"]+)"\]$/);
      return match ? nav.get(match[1]) || null : null;
    },
    addEventListener(type, fn) { if (!listeners.has(type)) listeners.set(type, []); listeners.get(type).push(fn); } };
  const sandbox = { document, Set, JSON, Object,
    localStorage: { getItem: () => saved || null, setItem: (key, value) => writes.push({ key, value: JSON.parse(value) }) },
    window: { __zhikeRegistryHost: host, addEventListener() {} },
    MutationObserver: class { constructor(callback) { this.callback = callback; } observe(node, options) {
      if (node === root) { onMutation = this.callback; assert.deepEqual(Array.from(options.attributeFilter), ['data-view']); }
      else { assert.ok(node === backdrop || node === modal); onModalMutation = this.callback; }
    } disconnect() { if (onModalMutation === this.callback) onModalMutation = null; } },
  };
  vm.runInNewContext(source, sandbox);
  const event = (type, target) => { for (const listener of listeners.get(type) || []) listener({ target }); };
  const click = target => event('click', target);
  const workspace = value => click({ closest: selector => selector === '[data-workspace-target]' ? tabs.find(x => x.dataset.workspaceTarget === value) : null });
  const modalTarget = (action, inside = true) => {
    const node = { dataset: { shellAction: action }, closest: selector => selector === '#modal' && inside ? {} : null };
    return { closest: selector => selector === '[data-shell-action]' ? node : null };
  };
  return { root, tabs, nav, writes, clicks, notices, modals, host, sandbox,
    setView(value) { root.dataset.view = value; onMutation?.(); },
    shell: sandbox.window.ZhikeWorkspaceShell, workspace, click,
    open: () => click({ closest: selector => selector === '#appearanceButton' ? {} : null }),
    action: (name, inside = true) => click(modalTarget(name, inside)),
    change(value, inside = true) { event('change', { name: 'shellPalette', value, closest: selector => inside && selector === '#modal [data-shell-appearance]' ? {} : null }); },
    dismiss() { host.closeModal(); },
    replaceModal() { modalBody = 'another dialog'; onModalMutation?.(); },
    get closed() { return closed; } };
}
{
  const f = fixture('{corrupt');
  assert.equal(f.shell.getPalette(), 'atelier-dawn'); assert.equal(f.root.dataset.palette, 'atelier-dawn');
  assert.equal(f.shell.setPalette('untrusted-theme'), false); assert.equal(f.writes.length, 0);
  f.shell.setPalette('horizon-night'); assert.equal(f.shell.currentTheme(), 'dark');
  assert.equal(f.writes.at(-1).key, 'zhike.workspace-shell.v1');
  assert.equal(f.writes.at(-1).value.palette, 'horizon-night');
  assert.equal(fixture(JSON.stringify(f.writes.at(-1).value)).shell.getPalette(), 'horizon-night');
}
{
  const f = fixture(null, 'customers'); f.workspace('ws');
  assert.deepEqual(f.clicks, ['ws-workbench']); assert.equal(f.tabs[1]['aria-pressed'], 'true');
  f.workspace('ws'); assert.equal(f.clicks.length, 1, 'active workspace does not renavigate/recreate Core');
  f.workspace('main'); assert.deepEqual(f.clicks, ['ws-workbench', 'customers']);
  assert.equal(f.tabs[0]['aria-pressed'], 'true');
}
{
  const f = fixture(); f.nav.get('ws-workbench').hidden = true; f.workspace('ws');
  assert.equal(f.clicks.length, 0); assert.equal(f.notices.length, 1);
  f.nav.get('ws-workbench').hidden = false; f.nav.get('ws-workbench').disabled = true; f.workspace('ws');
  assert.equal(f.clicks.length, 0, 'workspace switch never bypasses a disabled/hidden navigation entry');
}
for (const denied of ['hidden', 'disabled', 'aria-disabled', 'aria-hidden', 'hidden-class']) {
  const f = fixture(JSON.stringify({ lastMainView: 'customers' }), 'ws-workbench');
  const entry = f.nav.get('customers');
  if (denied.startsWith('aria-')) entry.getAttribute = name => name === denied ? 'true' : null;
  else if (denied === 'hidden-class') entry.classList = { contains: name => name === 'hidden' };
  else entry[denied] = true;
  f.workspace('main');
  assert.deepEqual(f.clicks, ['home'], 'Unavailable saved routes fall back to the allowed home route');
  assert.equal(f.writes.at(-1).value.lastMainView, 'home');
  assert.equal(f.notices.length, 0);
}
{
  const f = fixture(JSON.stringify({ lastMainView: 'customers' }), 'ws-workbench');
  f.nav.get('home').hidden = true;
  f.nav.get('customers').disabled = true;
  f.workspace('main');
  assert.deepEqual(f.clicks, ['groups'], 'When home is unavailable, return through the first allowed main route');
  assert.equal(f.nav.get('home').hidden, true);
  assert.equal(f.nav.get('customers').disabled, true);
  f.setView('ws-workbench');
  f.nav.get('groups').hidden = true;
  f.workspace('main');
  assert.deepEqual(f.clicks, ['groups'], 'The WS entry is never a main-workspace fallback');
  assert.equal(f.root.dataset.view, 'ws-workbench');
  assert.equal(f.notices.length, 1);
}
{
  const f = fixture(); f.open(); assert.equal(f.modals.length, 1);
  assert.match(f.modals[0].body, /data-shell-appearance/); assert.match(f.modals[0].footer, /完成/);
  f.change('horizon-night', false); assert.equal(f.shell.getPalette(), 'atelier-dawn');
  f.change('horizon-night'); assert.equal(f.shell.getPalette(), 'atelier-dawn');
  assert.equal(f.root.dataset.palette, 'horizon-night'); assert.equal(f.writes.length, 0, 'Preview must not persist or write business settings');
  f.action('close', false); assert.equal(f.closed, 0);
  f.action('reset'); assert.equal(f.shell.getPalette(), 'atelier-dawn');
  f.action('close'); assert.equal(f.closed, 1);
  f.action('reset'); assert.equal(f.modals.length, 1, 'closed/non-owned modal actions are ignored');
}
for (const dismissal of ['cancel', 'dismiss', 'replaceModal']) {
  const f = fixture(); f.open(); f.change('horizon-night');
  if (dismissal === 'cancel') f.action('cancel'); else f[dismissal]();
  assert.equal(f.root.dataset.palette, 'atelier-dawn', dismissal + ' restores the committed palette');
  assert.equal(f.shell.getPalette(), 'atelier-dawn'); assert.equal(f.writes.length, 0);
}
{
  const f = fixture(); f.open(); f.change('horizon-night'); f.action('close');
  assert.equal(f.shell.getPalette(), 'horizon-night'); assert.equal(f.writes.length, 1);
  assert.equal(fixture(JSON.stringify(f.writes[0].value)).shell.getPalette(), 'horizon-night');
  f.open(); f.action('reset'); assert.equal(f.root.dataset.palette, 'atelier-dawn');
  assert.equal(f.shell.getPalette(), 'horizon-night', 'Default appearance also previews until saved');
  f.dismiss(); assert.equal(f.root.dataset.palette, 'horizon-night'); assert.equal(f.writes.length, 1);
  f.open(); f.change('atelier-dawn'); f.shell.setPalette('horizon-night');
  f.dismiss(); assert.equal(f.root.dataset.palette, 'horizon-night', 'External save ends preview without stale restoration');
}
// Exercise the actual WS return action too. The top workspace tab and the
// independent WS rail return button must share the same guarded route owner.
{
  const ws = fs.readFileSync(path.join(__dirname, '../resources/app/modules/ws-workbench.js'), 'utf8');
  const start = ws.indexOf("    if (action === 'return-zhike')");
  const end = ws.indexOf("\n    if (action.startsWith('business-'))", start);
  assert.ok(start >= 0 && end > start, 'The shipped WS action branch is used, not a test reimplementation.');
  const execute = f => vm.runInNewContext('(function(action){' + ws.slice(start, end) + "})('return-zhike');", { document: f.sandbox.document });
  const f = fixture(null, 'followups');
  const app = fs.readFileSync(path.join(__dirname, '../resources/app/app.js'), 'utf8');
  const viewStart = app.indexOf('  function setView('), viewEnd = app.indexOf('  const heading =', viewStart);
  const declaration = app.split(/\r?\n/).find(line => line.trimStart().startsWith('window.__zhikeRegistryHost='));
  const restore = declaration?.match(/restoreFollowupView:(\(\)=>setView\('followups'\))/)?.[1];
  assert.ok(viewStart >= 0 && viewEnd > viewStart && restore, 'Use the shipped setView and narrow restore hook.');
  const state = { view: 'followups', followTab: 'done', page: 4, selected: new Set(['synthetic']), customers: [{ id: 'ISOLATED_ROUTE' }], followups: [{ id: 'ISOLATED_FOLLOWUP' }] };
  const before = JSON.stringify({ customers: state.customers, followups: state.followups });
  const crumb = { textContent: '' }, sandbox = { state, document: { documentElement: f.root }, window: f.sandbox.window, navNames: { followups: '客户跟进' }, $: () => crumb, $$: () => [], render() {} };
  vm.runInNewContext(app.slice(viewStart, viewEnd) + '\nthis.restore=' + restore + ';', sandbox);
  f.host.restoreFollowupView = sandbox.restore;
  f.workspace('ws'); state.view = 'ws-workbench'; execute(f);
  assert.equal(f.root.dataset.view, 'followups', 'WS rail return must restore the hidden followup route instead of hardcoding home.');
  assert.equal(state.view, 'followups'); assert.equal(state.followTab, 'done'); assert.equal(state.page, 1); assert.equal(crumb.textContent, '客户跟进');
  assert.equal(JSON.stringify({ customers: state.customers, followups: state.followups }), before);
  assert.deepEqual(f.clicks, ['ws-workbench'], 'Return uses the narrow hook without a second main navigation click.');
  for (const denied of ['hidden', 'disabled', 'aria-disabled']) {
    const deniedFixture = fixture(JSON.stringify({ lastMainView: 'followups' }), 'ws-workbench'); let restored = 0;
    deniedFixture.host.restoreFollowupView = () => restored++;
    if (denied === 'aria-disabled') deniedFixture.nav.get('customers').getAttribute = () => 'true';
    else deniedFixture.nav.get('customers')[denied] = true;
    execute(deniedFixture); assert.equal(restored, 0); assert.equal(deniedFixture.root.dataset.view, 'ws-workbench');
    assert.equal(deniedFixture.notices.length, 1, 'The WS rail must retain the same customer-route permission boundary.');
  }
  const oldHost = fixture(JSON.stringify({ lastMainView: 'customers' }), 'ws-workbench');
  const select = oldHost.sandbox.document.querySelector;
  oldHost.sandbox.document.querySelector = selector => selector === '[data-workspace-target="main"]' ? null : select(selector);
  execute(oldHost); assert.deepEqual(oldHost.clicks, ['home'], 'An older shell without the top workspace tab retains the existing home fallback.');
}
// The existing follow-up route has no main-sidebar button. Its narrow restore
// hook must retain the original navigation permission and cannot open any route.
{
  const f=fixture(null,'followups');let restored=0;const business={followTab:'done',records:['unchanged']};
  f.host.restoreFollowupView=()=>{restored++;f.setView('followups');};
  f.workspace('ws');f.workspace('main');
  assert.equal(f.root.dataset.view,'followups');assert.equal(restored,1);
  assert.deepEqual(f.clicks,['ws-workbench']);assert.equal(business.followTab,'done');
  f.workspace('main');assert.equal(restored,1,'An active workspace does not reopen its page');
}
for(const denied of ['hidden','disabled','aria-disabled']){
  const f=fixture(JSON.stringify({lastMainView:'followups'}),'ws-workbench');let restored=0;
  f.host.restoreFollowupView=()=>{restored++;f.setView('followups');};
  if(denied==='aria-disabled')f.nav.get('customers').getAttribute=name=>name==='aria-disabled'?'true':null;
  else f.nav.get('customers')[denied]=true;
  f.workspace('main');assert.equal(restored,0);assert.equal(f.root.dataset.view,'ws-workbench');
  assert.equal(f.notices.length,1,'The compatibility route cannot bypass the customer entry boundary');
}
{
  const missing=fixture(JSON.stringify({lastMainView:'followups'}),'ws-workbench');
  missing.workspace('main');assert.deepEqual(missing.clicks,['home'],'An older host keeps the original safe fallback');
  const unknown=fixture(JSON.stringify({lastMainView:'arbitrary-route'}),'ws-workbench');let restored=0;
  unknown.host.restoreFollowupView=()=>restored++;
  unknown.workspace('main');assert.equal(restored,0);assert.deepEqual(unknown.clicks,['home']);
}
// Execute the real legacy save-preferences transaction: failed writes restore
// both original business settings and the independent presentation preference.
(async () => {
  const app = fs.readFileSync(path.join(__dirname, '../resources/app/app.js'), 'utf8');
  const begin = app.indexOf("else if(action==='save-preferences')"), end = app.indexOf("else if(action==='remove-import-file')", begin);
  const functions = app.slice(app.indexOf('  function effectiveTheme()'), app.indexOf('  function applyStorageModeLabels()'));
  assert.ok(begin > 0 && end > begin);
  for (const fail of [false, true]) {
    const f = fixture();
    const state = { perPage: 10, settings: { theme: 'dark', density: 'comfortable' }, activities: [] };
    const controls = { '#defaultPerPage': { value: '25' }, '#appearanceTheme': { value: 'dark' }, '#appearanceDensity': { value: 'comfortable' } };
    const sandbox = { window: f.sandbox.window, document: { documentElement: f.root }, state, structuredClone,
      $: key => controls[key], activity() {}, persist() {}, render() {}, toast() {},
      flushStateWrites: async () => { if (fail) throw Error('isolated write rejected'); } };
    vm.runInNewContext(functions + '\nasync function run(action){' + app.slice(begin, end).replace(/^else /, '') + '}\nglobalThis.run=run;', sandbox);
    await sandbox.run('save-preferences');
    assert.equal(f.shell.getPalette(), fail ? 'atelier-dawn' : 'horizon-night');
    assert.equal(state.perPage, fail ? 10 : 25);
    assert.equal(state.settings.theme, 'dark');
  }
  console.log('S1 workspace shell: scoped navigation, no duplicate route, local appearance, owned modal and real legacy preference rollback PASS');
})().catch(error => { console.error(error); process.exitCode = 1; });
