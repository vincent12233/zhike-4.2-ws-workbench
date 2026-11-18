'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { performance } = require('node:perf_hooks');

const repo = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(repo, 'resources/app/modules/scroll-coordinator.js'), 'utf8');

class FakeClassList {
  constructor(values = []) { this.values = new Set(values); }
  add(value) { this.values.add(value); }
  remove(value) { this.values.delete(value); }
  contains(value) { return this.values.has(value); }
  toggle(value, force) { const next = force === undefined ? !this.contains(value) : Boolean(force); next ? this.add(value) : this.remove(value); return next; }
}

class FakeElement {
  constructor({ id = '', classes = [], parent = null, clientHeight = 100, scrollHeight = 100, clientWidth = 100, scrollWidth = 100 } = {}) {
    this.id = id;
    this.classList = new FakeClassList(classes);
    this.parentElement = parent;
    this.dataset = {};
    this.attributes = new Map();
    this.clientHeight = clientHeight;
    this.scrollHeight = scrollHeight;
    this.clientWidth = clientWidth;
    this.scrollWidth = scrollWidth;
    this.scrollTop = 0;
    this.scrollLeft = 0;
    this.isConnected = true;
    this.modalBody = null;
    this.semanticChildren = [];
  }
  matches(selector) {
    if (selector.includes(',')) return selector.split(',').some(part => this.matches(part.trim()));
    if (selector === '[data-scroll-mode]') return Boolean(this.dataset.scrollMode);
    if (selector.startsWith('#')) return this.id === selector.slice(1);
    if (selector.startsWith('.')) return this.classList.contains(selector.slice(1));
    return false;
  }
  closest(selector) {
    for (let node = this; node; node = node.parentElement) if (node.matches(selector)) return node;
    return null;
  }
  contains(node) { for (let current = node; current; current = current.parentElement) if (current === this) return true; return false; }
  querySelectorAll(selector) {
    if (selector === '.modal-body') return this.modalBody ? [this.modalBody] : [];
    if (selector === '[data-scroll-mode]') return [this.modalBody, this.wsCenter].filter(node => node?.dataset?.scrollMode);
    if (selector.includes('[data-action]')) return this.semanticChildren;
    return [];
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  hasAttribute(name) { return this.attributes.has(name); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  scrollBy({ top = 0, left = 0 } = {}) { this.scrollTop += top; this.scrollLeft += left; }
}

const html = new FakeElement();
const body = new FakeElement();
const view = new FakeElement({ id: 'viewContainer', clientHeight: 500, scrollHeight: 1500 });
const sidebar = new FakeElement({ id: 'sidebar' });
const nav = new FakeElement({ id: 'mainNav', parent: sidebar, clientHeight: 300, scrollHeight: 800 });
const sidebarChrome = new FakeElement({ classes: ['sidebar-bottom'], parent: sidebar });
const table = new FakeElement({ classes: ['table-scroll'], clientWidth: 300, scrollWidth: 900 });
const backdrop = new FakeElement({ id: 'modalBackdrop', classes: ['hidden'] });
const modal = new FakeElement({ id: 'modal' });
const selectorMap = new Map([
  ['#viewContainer', [view]],
  ['#mainNav', [nav]],
  ['.table-scroll', [table]],
]);
const listeners = new Map();
const document = {
  documentElement: html,
  body,
  activeElement: body,
  querySelector(selector) {
    if (selector === '#modalBackdrop') return backdrop;
    if (selector === '#modal') return modal;
    return selectorMap.get(selector)?.[0] || null;
  },
  querySelectorAll(selector) { return selectorMap.get(selector) || []; },
  addEventListener(type, listener) { if (!listeners.has(type)) listeners.set(type, []); listeners.get(type).push(listener); },
  dispatchEvent() { return true; },
};
const session = new Map();
let mutationCallback = null;
const context = {
  console,
  document,
  Element: FakeElement,
  MutationObserver: class { constructor(callback) { this.callback = callback; mutationCallback = callback; } observe() {} disconnect() {} },
  CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options?.detail; } },
  performance,
  sessionStorage: { getItem: key => session.get(key) || null, setItem: (key, value) => session.set(key, value) },
  requestAnimationFrame: callback => { callback(performance.now()); return 0; },
  cancelAnimationFrame() {},
  setTimeout,
  clearTimeout,
};
context.window = {
  __zhikeRegistryHost: { state: { view: 'customers' } },
  addEventListener() {},
};
vm.createContext(context);
vm.runInContext(source, context, { filename: 'scroll-coordinator.js' });

const coordinator = context.window.ZhikeScrollCoordinator;
assert.ok(coordinator, 'coordinator must expose its bounded runtime API');
assert.equal(view.dataset.scrollMode, 'page');
assert.equal(nav.dataset.scrollMode, 'contain');
assert.equal(table.dataset.scrollMode, 'horizontal');

assert.equal(coordinator.normalizedDelta({ deltaY: 2, deltaX: 0, deltaMode: 1 }, 'y', 500), 32, 'line-wheel units are normalized');
assert.equal(coordinator.normalizedDelta({ deltaY: 1, deltaX: 0, deltaMode: 2 }, 'y', 500), 500, 'page-wheel units use the viewport');
assert.equal(coordinator.canConsume(nav, 'y', 20), true);
nav.scrollTop = 500;
assert.equal(coordinator.canConsume(nav, 'y', 20), false, 'a contained pane reports its bottom boundary');
nav.scrollTop = 0;
assert.equal(coordinator.canConsume(nav, 'y', -20), false, 'a contained pane reports its top boundary');

coordinator.savePosition(nav);
assert.ok(coordinator.positionCount() >= 1, 'independent pane position is retained');
let idleRan = false;
coordinator.runWhenIdle(() => { idleRan = true; });
assert.equal(idleRan, true, 'non-scrolling work is not delayed');

const wheel = listeners.get('wheel')?.[0];
assert.equal(typeof wheel, 'function');
let prevented = false;
nav.scrollTop = 500;
wheel({ target: nav, deltaX: 0, deltaY: 30, deltaMode: 0, shiftKey: false, preventDefault() { prevented = true; }, stopPropagation() {} });
assert.equal(prevented, false, 'a contained pane hands a boundary wheel to the parent/page');

prevented = false;
view.scrollTop = 0;
nav.scrollTop = 0;
wheel({ target: sidebarChrome, deltaX: 0, deltaY: 1600, deltaMode: 0, shiftKey: false, preventDefault() { prevented = true; }, stopPropagation() {} });
assert.equal(prevented, true, 'wheel input anywhere inside the visible sidebar is captured by navigation');
assert.equal(nav.scrollTop, 500, 'a large sidebar wheel is clamped to the real #mainNav scroll range');
assert.equal(view.scrollTop, 0, 'sidebar wheel input never moves the business page');
prevented = false;
wheel({ target: sidebarChrome, deltaX: 0, deltaY: 1600, deltaMode: 0, shiftKey: false, preventDefault() { prevented = true; }, stopPropagation() {} });
assert.equal(prevented, false, 'a sidebar boundary wheel is not swallowed after navigation reaches its boundary');
assert.equal(view.scrollTop, 0, 'navigation boundary does not hand the gesture to the page');

view.scrollTop = 230;
coordinator.savePosition(view);
context.window.__zhikeRegistryHost.state.view = 'groups';
mutationCallback([{ target: view }]);
assert.equal(view.scrollTop, 0, 'opening a different page starts at its heading instead of inheriting the previous scroll offset');
view.scrollTop = 85;
coordinator.savePosition(view);
mutationCallback([{ target: view }]);
assert.equal(view.scrollTop, 85, 'a redraw of the same page preserves its own scroll position');

const nestedPane = new FakeElement({ classes: ['ws-account-list'], parent: nav, clientHeight: 80, scrollHeight: 80 });
nestedPane.dataset.scrollMode = 'contain';
nav.scrollTop = 0;
prevented = false;
wheel({ target: nestedPane, deltaX: 0, deltaY: 60, deltaMode: 0, shiftKey: false, preventDefault() { prevented = true; }, stopPropagation() {} });
assert.equal(prevented, true, 'a nested contained pane keeps the gesture inside its rail');
assert.equal(nav.scrollTop, 60, 'a non-scrollable contained child hands the gesture to its contained parent');

const dynamicSearch = new FakeElement({ classes: ['global-search-results'], parent: view, clientHeight: 100, scrollHeight: 500 });
const dynamicSearchRow = new FakeElement({ parent: dynamicSearch });
view.scrollTop = 0;
prevented = false;
wheel({ target: dynamicSearchRow, deltaX: 0, deltaY: 60, deltaMode: 0, shiftKey: false, preventDefault() { prevented = true; }, stopPropagation() {} });
assert.equal(dynamicSearch.dataset.scrollMode, 'contain', 'a result pane inserted after page mount is registered on first input');
assert.equal(prevented, true, 'the late result pane owns its wheel instead of the business page');
assert.equal(dynamicSearch.scrollTop, 60);
assert.equal(view.scrollTop, 0);

const wsPage = new FakeElement({ classes: ['ws-workbench-page'], parent: view });
const wsCenter = new FakeElement({ classes: ['ws-center-panel'], parent: wsPage, clientHeight: 141, scrollHeight: 578 });
const wsToolbar = new FakeElement({ parent: wsCenter });
view.wsCenter = wsCenter;
prevented = false;
wheel({ target: wsToolbar, deltaX: 0, deltaY: 120, deltaMode: 0, shiftKey: false, preventDefault() { prevented = true; }, stopPropagation() {} });
assert.equal(prevented, false, 'WS center shell does not compete with the embedded WebView for vertical wheel ownership');
assert.equal(wsCenter.scrollTop, 0, 'WS center shell remains fixed while the embedded WebView owns chat scrolling');
assert.equal(view.scrollTop, 0);
wsPage.classList.add('is-login-focus');
context.window.__zhikeRegistryHost.state.view = 'ws-workbench';
mutationCallback([{ target: view }]);
assert.equal(wsCenter.scrollTop, 0, 'returning to the expanded login view shows the login header instead of restoring an old center scroll offset');
wsPage.classList.remove('is-login-focus');

// The secondary WS rail and standalone workspace pages are inserted inside a
// fixed canvas. Their wheel input must never resolve to the outer page owner.
const workspaceNav = new FakeElement({ classes: ['ws-workspace-nav-list'], parent: wsPage, clientHeight: 300, scrollHeight: 650 });
const workspaceNavButton = new FakeElement({ parent: workspaceNav });
prevented = false;
wheel({ target: workspaceNavButton, deltaX: 0, deltaY: 140, deltaMode: 0, shiftKey: false, preventDefault() { prevented = true; }, stopPropagation() {} });
assert.equal(workspaceNav.dataset.scrollMode, 'contain', 'secondary navigation is registered at first wheel input');
assert.equal(prevented, true, 'secondary navigation consumes the wheel inside its own bounds');
assert.equal(workspaceNav.scrollTop, 140, 'the last three navigation items become reachable by mouse');
assert.equal(view.scrollTop, 0, 'secondary navigation does not scroll the main business page');
const workspaceContent = new FakeElement({ classes: ['ws-workspace-page-content'], parent: wsPage, clientHeight: 300, scrollHeight: 900 });
workspaceContent.dataset.wsWorkspacePage = 'members';
workspaceContent.dataset.wsAccountId = 'account-a';
const workspaceCard = new FakeElement({ parent: workspaceContent });
prevented = false;
wheel({ target: workspaceCard, deltaX: 0, deltaY: 180, deltaMode: 0, shiftKey: false, preventDefault() { prevented = true; }, stopPropagation() {} });
assert.equal(workspaceContent.dataset.scrollMode, 'contain');
assert.equal(prevented, true, 'workspace content owns vertical wheel scrolling');
assert.equal(workspaceContent.scrollTop, 180);
assert.equal(workspaceNav.scrollTop, 140, 'content scrolling does not move secondary navigation');
assert.equal(view.scrollTop, 0, 'content scrolling does not move the outer page');
coordinator.savePosition(workspaceContent);
workspaceContent.dataset.wsWorkspacePage = 'groups';
workspaceContent.scrollTop = 0;
coordinator.restorePositions(workspaceContent);
assert.equal(workspaceContent.scrollTop, 0, 'a different workspace page does not inherit member-page scroll position');
workspaceContent.dataset.wsWorkspacePage = 'members';
workspaceContent.dataset.wsAccountId = 'account-b';
coordinator.restorePositions(workspaceContent);
assert.equal(workspaceContent.scrollTop, 0, 'a different account does not inherit the first account scroll position');
workspaceContent.dataset.wsAccountId = 'account-a';
coordinator.restorePositions(workspaceContent);
assert.equal(workspaceContent.scrollTop, 180, 'returning to the same account and page restores its own position');

// Execute the real shell capture/restore helpers against a replaced nav node.
// A render used to replace the list at zero and hide the selected lower item.
const workbenchSource = fs.readFileSync(path.join(repo, 'resources/app/modules/ws-workbench.js'), 'utf8');
const captureStart = workbenchSource.indexOf('  function captureWorkspaceNavScroll(');
const captureEnd = workbenchSource.indexOf('  function renderWsWorkspaceNav(', captureStart);
assert.ok(captureStart > 0 && captureEnd > captureStart);
let currentWorkspaceNav = workspaceNav;
const navSandbox = { state: {}, $: selector => selector === '.ws-workspace-nav-list' ? currentWorkspaceNav : null };
vm.runInNewContext(workbenchSource.slice(captureStart, captureEnd) + '\nglobalThis.capture=captureWorkspaceNavScroll;globalThis.restore=restoreWorkspaceNavScroll;', navSandbox);
navSandbox.capture();
currentWorkspaceNav = new FakeElement({ classes: ['ws-workspace-nav-list'], parent: wsPage, clientHeight: 300, scrollHeight: 650 });
navSandbox.restore();
assert.equal(currentWorkspaceNav.scrollTop, 140, 'shell redraw preserves lower-navigation reachability');
currentWorkspaceNav.scrollTop = 350;
navSandbox.capture();
currentWorkspaceNav = new FakeElement({ classes: ['ws-workspace-nav-list'], parent: wsPage, clientHeight: 600, scrollHeight: 650 });
navSandbox.restore();
assert.equal(currentWorkspaceNav.scrollTop, 50, 'navigation restoration is clamped after a window resize');
currentWorkspaceNav = null;
navSandbox.capture();
currentWorkspaceNav = new FakeElement({ classes: ['ws-workspace-nav-list'], parent: wsPage, clientHeight: 300, scrollHeight: 650 });
navSandbox.restore();
assert.equal(currentWorkspaceNav.scrollTop, 350, 'leaving and returning to the WS surface keeps its independent navigation state');
assert.match(workbenchSource, /captureWorkspaceNavScroll\(\);[\s\S]*?mountWsWorkbenchShell\(target, markup\);\s*restoreWorkspaceNavScroll\(\);/, 'every shell render must use capture/restore, including direct navigation');

prevented = false;
table.scrollLeft = 0;
wheel({ target: table, deltaX: 0, deltaY: 40, deltaMode: 0, shiftKey: false, preventDefault() { prevented = true; }, stopPropagation() {} });
assert.equal(prevented, false, 'a normal vertical wheel over a table remains owned by the page');
table.scrollHeight = 500;
table.clientHeight = 100;
wheel({ target: table, deltaX: 0, deltaY: 40, deltaMode: 0, shiftKey: false, preventDefault() { prevented = true; }, stopPropagation() {} });
assert.equal(prevented, true, 'a deliberately bounded table owns its vertical wheel');
assert.equal(table.scrollTop, 40, 'bounded table vertical movement is applied without moving the page');
wheel({ target: table, deltaX: 40, deltaY: 0, deltaMode: 0, shiftKey: false, preventDefault() { prevented = true; }, stopPropagation() {} });
assert.equal(prevented, true, 'horizontal table gestures remain in the table');
assert.equal(table.scrollLeft, 40);

assert.equal(typeof mutationCallback, 'function');
const modalBodyA = new FakeElement({ classes: ['modal-body'], parent: modal, clientHeight: 100, scrollHeight: 700 });
const modalActionA = new FakeElement({ parent: modal });
modalActionA.setAttribute('data-action', 'create-customer');
modal.modalBody = modalBodyA;
modal.semanticChildren = [modalActionA];
backdrop.classList.remove('hidden');
mutationCallback([{ target: modal }, { target: backdrop }]);
modalBodyA.scrollTop = 180;
coordinator.savePosition(modalBodyA);

const modalBodyB = new FakeElement({ classes: ['modal-body'], parent: modal, clientHeight: 100, scrollHeight: 700 });
const modalActionB = new FakeElement({ parent: modal });
modalActionB.setAttribute('data-action', 'save-registration');
modal.modalBody = modalBodyB;
modal.semanticChildren = [modalActionB];
mutationCallback([{ target: modal }]);
assert.equal(modalBodyB.scrollTop, 0, 'a different modal opened on the same route never inherits the previous modal position');
modalBodyB.scrollTop = 75;
coordinator.savePosition(modalBodyB);

const modalBodyBRedraw = new FakeElement({ classes: ['modal-body'], parent: modal, clientHeight: 100, scrollHeight: 700 });
const modalActionBRedraw = new FakeElement({ parent: modal });
modalActionBRedraw.setAttribute('data-action', 'save-registration');
modal.modalBody = modalBodyBRedraw;
modal.semanticChildren = [modalActionBRedraw];
mutationCallback([{ target: modal }]);
assert.equal(modalBodyBRedraw.scrollTop, 75, 'the same modal keeps its position when its body is redrawn');

assert.equal(
  coordinator.safeModalFingerprint(modal),
  coordinator.safeModalFingerprint(modal),
  'modal identity is stable and based only on semantic developer attributes',
);

console.log('scroll coordinator runtime: scroll ownership, wheel units, boundaries and state retention pass');
