'use strict';
// Execute the real coordinator listeners against bounded DOM test elements.
// This tests event ownership; it is not a native WebView/DPI/zoom acceptance.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { performance } = require('node:perf_hooks');
const source = fs.readFileSync(path.resolve(__dirname, '../resources/app/modules/scroll-coordinator.js'), 'utf8');
function harness() {
  const nodes = [], timers = new Set(), listeners = new Map(), events = [];
  class Element {
    constructor({ id = '', classes = [], tag = 'div', parent = null, height = 100, contentHeight = 600, width = 100, contentWidth = 100 } = {}) {
      Object.assign(this, { id, tag, parentElement: parent, dataset: {}, isConnected: true, clientHeight: height, scrollHeight: contentHeight, clientWidth: width, scrollWidth: contentWidth, scrollTop: 0, scrollLeft: 0 });
      const set = new Set(classes); this.classList = { contains: value => set.has(value), add: value => set.add(value), remove: value => set.delete(value), toggle(value, force) { const next = force == null ? !set.has(value) : !!force; next ? set.add(value) : set.delete(value); return next; } };
      this.attributes = new Map(); nodes.push(this);
    }
    matches(selector) {
      if (selector.includes(',')) return selector.split(',').some(part => this.matches(part.trim()));
      if (selector === '[data-scroll-mode]') return !!this.dataset.scrollMode;
      if (selector === '[contenteditable="true"]') return this.attributes.get('contenteditable') === 'true';
      if (selector.startsWith('#')) return this.id === selector.slice(1);
      if (selector.startsWith('.')) return this.classList.contains(selector.slice(1));
      return selector === this.tag;
    }
    closest(selector) { for (let node = this; node; node = node.parentElement) if (node.matches(selector)) return node; return null; }
    contains(node) { for (let current = node; current; current = current.parentElement) if (current === this) return true; return false; }
    querySelectorAll(selector) { return nodes.filter(node => node !== this && this.contains(node) && node.matches(selector)); }
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
    hasAttribute(name) { return this.attributes.has(name); }
    getAttribute(name) { return this.attributes.get(name) || null; }
    setAttribute(name, value) { this.attributes.set(name, String(value)); }
  }
  const html = new Element({ contentHeight: 100 }), body = new Element({ parent: html, contentHeight: 100 });
  const page = new Element({ id: 'viewContainer', parent: body, height: 500, contentHeight: 1800 });
  const sidebar = new Element({ id: 'sidebar', parent: body });
  const nav = new Element({ id: 'mainNav', parent: sidebar, height: 300, contentHeight: 800 });
  const backdrop = new Element({ id: 'modalBackdrop', parent: body, classes: ['hidden'] });
  const modal = new Element({ id: 'modal', parent: backdrop });
  const modalBody = new Element({ classes: ['modal-body'], parent: modal, height: 300, contentHeight: 900 });
  const document = { documentElement: html, body, activeElement: body, querySelector: selector => nodes.find(node => node.matches(selector)) || null, querySelectorAll: selector => nodes.filter(node => node.matches(selector)), addEventListener(type, callback) { listeners.set(type, callback); }, dispatchEvent(event) { events.push(event.type); return true; } };
  const context = { console, document, Element, performance, sessionStorage: { getItem: () => null, setItem() {} }, MutationObserver: class { observe() {} }, CustomEvent: class { constructor(type) { this.type = type; } }, requestAnimationFrame(callback) { callback(); return 0; }, cancelAnimationFrame() {}, setTimeout(callback, ms) { const id = setTimeout(() => { timers.delete(id); callback(); }, ms); timers.add(id); return id; }, clearTimeout(id) { clearTimeout(id); timers.delete(id); } };
  context.window = { __zhikeRegistryHost: { state: { view: 'customers' } }, addEventListener() {} };
  vm.runInNewContext(source, context, { filename: 'scroll-coordinator.js' });
  const input = (type, target, properties = {}) => {
    const event = { target, cancelable: true, defaultPrevented: false, deltaX: 0, deltaY: 40, deltaMode: 0, shiftKey: false, ctrlKey: false, metaKey: false, altKey: false, preventCalls: 0, stopCalls: 0, preventDefault() { this.preventCalls++; this.defaultPrevented = true; }, stopPropagation() { this.stopCalls++; }, ...properties };
    listeners.get(type)(event); return event;
  };
  return { Element, document, page, nav, sidebar, modal, modalBody, backdrop, html, events, input, coordinator: context.window.ZhikeScrollCoordinator, dispose: () => { for (const timer of timers) clearTimeout(timer); timers.clear(); } };
}
const cases = [];
const test = (name, action) => cases.push({ name, action });
for (const modifier of ['ctrlKey', 'metaKey']) test(modifier + ' wheel remains an unclaimed native zoom gesture', h => {
  const event = h.input('wheel', h.nav, { [modifier]: true, deltaY: 90 });
  assert.equal(event.preventCalls, 0); assert.equal(event.stopCalls, 0); assert.equal(h.nav.scrollTop, 0);
  assert.equal(h.coordinator.isScrolling(), false, 'zoom is not application scroll activity');
  let immediate = false; h.coordinator.runWhenIdle(() => { immediate = true; }); assert.equal(immediate, true, 'zoom must not defer unrelated UI work');
});
test('a native zoom gesture is preserved even over the modal backdrop', h => {
  h.backdrop.classList.remove('hidden');
  const event = h.input('wheel', h.page, { ctrlKey: true }); assert.equal(event.preventCalls, 0); assert.equal(h.page.scrollTop, 0); assert.equal(h.modalBody.scrollTop, 0);
});
test('an already claimed or noncancelable wheel is not routed again', h => {
  for (const properties of [{ defaultPrevented: true }, { cancelable: false }]) { const event = h.input('wheel', h.nav, properties); assert.equal(event.preventCalls, 0); assert.equal(event.stopCalls, 0); assert.equal(h.nav.scrollTop, 0); }
  assert.equal(h.coordinator.isScrolling(), false);
});
test('sidebar chrome and inner contained owner keep the existing vertical policy', h => {
  const chrome = new h.Element({ parent: h.sidebar });
  const event = h.input('wheel', chrome, { deltaY: 70 }); assert.equal(event.preventCalls, 1); assert.equal(h.nav.scrollTop, 70); assert.equal(h.page.scrollTop, 0);
  h.nav.scrollTop = 500; const edge = h.input('wheel', chrome); assert.equal(edge.preventCalls, 0); assert.equal(h.nav.scrollTop, 500); assert.equal(h.page.scrollTop, 0);
});
test('nested contained panes hand off within their rail but not manually to the page', h => {
  const parent = new h.Element({ classes: ['ws-session-list'], parent: h.page });
  const child = new h.Element({ classes: ['ws-account-list'], parent, height: 80, contentHeight: 80 });
  h.coordinator.registerRegions(h.page);
  assert.equal(h.input('wheel', child, { deltaY: 55 }).preventCalls, 1); assert.equal(parent.scrollTop, 55); assert.equal(h.page.scrollTop, 0);
  parent.scrollTop = 500; assert.equal(h.input('wheel', child).preventCalls, 0); assert.equal(h.page.scrollTop, 0);
});
test('table trackpad, shift-wheel and vertical axes remain independent', h => {
  const table = new h.Element({ classes: ['table-scroll'], parent: h.page, contentWidth: 600 }); h.coordinator.registerRegions(h.page);
  assert.equal(h.input('wheel', table, { deltaX: 30, deltaY: 5 }).preventCalls, 1); assert.equal(table.scrollLeft, 30); assert.equal(table.scrollTop, 0);
  h.input('wheel', table, { deltaY: 45, shiftKey: true }); assert.equal(table.scrollLeft, 75); assert.equal(table.scrollTop, 0);
  h.input('wheel', table, { deltaY: 40 }); assert.equal(table.scrollTop, 40); assert.equal(table.scrollLeft, 75);
  table.scrollHeight = table.clientHeight; assert.equal(h.input('wheel', table).preventCalls, 0); assert.equal(h.page.scrollTop, 0);
});
test('registered WS regions, drawers and modal body consume only their own axis', h => {
  for (const name of ['ws-workspace-nav-list', 'ws-workspace-page-content', 'ws-message-list', 'ws-assist-drawer-body', 'global-search-results', 'customer-drawer']) {
    const pane = new h.Element({ classes: [name], parent: h.page }); const event = h.input('wheel', pane, { deltaY: 2, deltaMode: 1 }); assert.equal(event.preventCalls, 1, name); assert.equal(pane.scrollTop, 32, name); assert.equal(h.page.scrollTop, 0);
  }
  h.backdrop.classList.remove('hidden'); assert.equal(h.input('wheel', h.modalBody, { deltaY: 1, deltaMode: 2 }).preventCalls, 1); assert.equal(h.modalBody.scrollTop, 300);
  const outside = h.input('wheel', h.page); assert.equal(outside.preventCalls, 1); assert.equal(h.page.scrollTop, 0);
});
test('editable focus and modified keys retain native caret and shortcut behavior', h => {
  const editor = new h.Element({ tag: 'textarea', parent: h.modalBody }); h.document.activeElement = editor;
  assert.equal(h.input('keydown', editor, { key: 'ArrowDown' }).preventCalls, 0); assert.equal(h.modalBody.scrollTop, 0);
  for (const key of ['ctrlKey', 'metaKey', 'altKey']) assert.equal(h.input('keydown', h.nav, { key: 'End', [key]: true }).preventCalls, 0);
  h.document.activeElement = h.nav; assert.equal(h.input('keydown', h.nav, { key: 'ArrowDown' }).preventCalls, 1); assert.equal(h.nav.scrollTop, 44);
});
test('scrollable textarea and its boundary retain native ownership without manually scrolling the outer pane', h => {
  h.backdrop.classList.remove('hidden');
  const editor = new h.Element({ tag: 'textarea', parent: h.modalBody });
  for (const position of [0, editor.scrollHeight - editor.clientHeight]) {
    editor.scrollTop = position;
    const event = h.input('wheel', editor, { deltaY: 60 });
    assert.equal(event.preventCalls, 0); assert.equal(event.stopCalls, 0); assert.equal(h.modalBody.scrollTop, 0); assert.equal(editor.scrollTop, position, 'the coordinator does not simulate native editing-control movement');
  }
});
test('native editing gestures preserve text input, selection and shift-wheel axis behavior', h => {
  const pane = new h.Element({ classes: ['ws-workspace-page-content'], parent: h.page });
  for (const tag of ['input', 'select', 'textarea', 'div']) {
    const editor = new h.Element({ tag, parent: pane }); if (tag === 'div') editor.setAttribute('contenteditable', 'true');
    const child = tag === 'div' ? new h.Element({ parent: editor }) : editor;
    const event = h.input('wheel', child, { deltaX: 10, deltaY: 65, shiftKey: false });
    assert.equal(event.preventCalls, 0, tag); assert.equal(event.stopCalls, 0, tag); assert.equal(pane.scrollTop, 0, tag);
    const shifted = h.input('wheel', child, { deltaY: 50, shiftKey: true }); assert.equal(shifted.preventCalls, 0, tag); assert.equal(pane.scrollLeft, 0, tag);
  }
});
test('modal keyboard scrolling cannot choose a stale background focus or pointer owner', h => {
  h.input('pointerover', h.nav); h.document.activeElement = h.page; h.backdrop.classList.remove('hidden');
  const event = h.input('keydown', h.page, { key: 'PageDown' });
  assert.equal(event.preventCalls, 1); assert.equal(h.page.scrollTop, 0); assert.equal(h.nav.scrollTop, 0); assert.equal(h.modalBody.scrollTop, 258);
  h.document.activeElement = h.nav; h.input('keydown', h.nav, { key: 'ArrowDown' }); assert.equal(h.nav.scrollTop, 0); assert.equal(h.modalBody.scrollTop, 302);
  h.backdrop.classList.add('hidden'); h.document.activeElement = h.page; h.input('keydown', h.page, { key: 'ArrowDown' }); assert.equal(h.page.scrollTop, 44, 'closing the modal restores ordinary keyboard routing');
});
test('scroll activity defers and deduplicates idle callbacks until the real timer settles', async h => {
  h.input('wheel', h.nav); h.input('wheel', h.nav);
  let calls = 0; const callback = () => { calls++; };
  h.coordinator.runWhenIdle(callback); h.coordinator.runWhenIdle(callback);
  assert.equal(calls, 0); assert.equal(h.coordinator.isScrolling(), true);
  await new Promise(resolve => setTimeout(resolve, 230));
  assert.equal(calls, 1); assert.equal(h.coordinator.isScrolling(), false); assert.equal(h.html.classList.contains('zk-scroll-active'), false);
  h.coordinator.runWhenIdle(callback); assert.equal(calls, 2);
});
(async () => {
  let failed = 0;
  for (const item of cases) { const h = harness(); try { await item.action(h); console.log('[PASS] ' + item.name); } catch (error) { failed++; console.log('[FAIL] ' + item.name + ': ' + error.message); } finally { h.dispose(); } }
  console.log(JSON.stringify({ suite: 'delivery-S1-scroll-gestures', checks: cases.length, passed: cases.length - failed, failed, nativeZoomValidated: false, realWebViewTested: false }));
  if (failed) process.exitCode = 1;
})().catch(error => { console.error(error.stack); process.exitCode = 1; });
