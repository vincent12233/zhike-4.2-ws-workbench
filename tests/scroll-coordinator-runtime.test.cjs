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
    if (selector === '[data-scroll-mode]') return this.modalBody?.dataset?.scrollMode ? [this.modalBody] : [];
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
assert.equal(prevented, true, 'contained inner panes do not leak a boundary wheel to the page');

prevented = false;
view.scrollTop = 0;
nav.scrollTop = 0;
wheel({ target: sidebarChrome, deltaX: 0, deltaY: 1600, deltaMode: 0, shiftKey: false, preventDefault() { prevented = true; }, stopPropagation() {} });
assert.equal(prevented, true, 'wheel input anywhere inside the visible sidebar is captured by navigation');
assert.equal(nav.scrollTop, 500, 'a large sidebar wheel is clamped to the real #mainNav scroll range');
assert.equal(view.scrollTop, 0, 'sidebar wheel input never moves the business page');
prevented = false;
wheel({ target: sidebarChrome, deltaX: 0, deltaY: 1600, deltaMode: 0, shiftKey: false, preventDefault() { prevented = true; }, stopPropagation() {} });
assert.equal(prevented, true, 'a sidebar wheel remains contained after navigation reaches its boundary');
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
