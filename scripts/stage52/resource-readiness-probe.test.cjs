'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { probe } = require('./resource-readiness-probe.cjs');

test('isolated readiness measures settled trusted transitions and bounds the exported rows', () => {
  let clock = 0;
  const callbacks = [];
  const documentEvents = {};
  const states = new Map();
  const controls = {};
  const dataset = {};
  const windowEvents = [];
  const window = { addEventListener: (type, callback) => {
    if (type === 'DOMContentLoaded') windowEvents.push(callback);
  } };
  window.addEventListener('DOMContentLoaded', () => { dataset.stage51Isolated = 'true'; });

  class Element {
    constructor(tag) {
      this.dataset = {};
      this.style = {};
      this.children = [];
      this.listeners = {};
      if (tag) controls[tag] = this;
    }
    addEventListener(type, listener) { this.listeners[type] = listener; }
    append(...nodes) { this.children.push(...nodes); }
    getClientRects() { return [{}]; }
    focus() { this.focused = true; }
    select() { this.selected = true; }
  }
  const document = {
    documentElement: { dataset },
    body: new Element(),
    querySelector: selector => states.get(selector) || null,
    createElement: tag => new Element(tag),
    addEventListener: (type, listener) => { documentEvents[type] = listener; },
  };
  const timeOrigin = Date.parse('2026-11-18T12:00:00Z');
  vm.runInNewContext('(' + probe.toString() + ')()', {
    window, document, Element, getComputedStyle: () => ({ visibility: 'visible' }),
    performance: { timeOrigin, now: () => clock },
    requestAnimationFrame: callback => { callbacks.push(callback); }
  });
  // DOMContentLoaded is dispatched on Document and bubbles to Window.
  // The host sets the marker in its earlier Window listener.
  assert.equal(controls.details, undefined);
  documentEvents.DOMContentLoaded?.();
  windowEvents.forEach(callback => callback());
  assert.ok(controls.details);
  const frame = at => {
    clock = at;
    callbacks.splice(0).forEach(callback => callback());
  };

  // A native select updates before dispatch of the DOM change event. The
  // app-owned page account ID must come from the previous presentation.
  const account = new Element();
  account.id = 'wsTopAccount';
  account.value = 'native-b';
  dataset.view = 'ws-workbench';
  const page = new Element();
  page.dataset.wsAccountId = 'default';
  states.set('.ws-workbench-page', page);
  const event = { type: 'change', target: account, timeStamp: 5 };
  clock = 8;
  documentEvents.change({ ...event, isTrusted: false });
  assert.equal(callbacks.length, 0);
  documentEvents.change({ ...event, isTrusted: true });
  page.dataset.wsAccountId = 'native-b';
  const busyAccount = new Element();
  busyAccount.dataset.wsAction = 'switch-account';
  busyAccount.dataset.accountId = 'native-b';
  busyAccount.closest = selector => selector.includes('[data-ws-action]') ? busyAccount : null;
  const clickAt = (target, at) => {
    clock = at;
    documentEvents.click({ type: 'click', target, timeStamp: at, isTrusted: true });
  };
  frame(16);
  clickAt(busyAccount, 24);
  frame(32);
  states.set('.ws-cockpit-accounts [data-ws-action="create-account"]:not(:disabled)', new Element());
  frame(47);
  frame(64);
  clickAt(busyAccount, 68);

  controls.details.open = true;
  controls.details.listeners.toggle();
  assert.equal(controls.textarea.selected, true);
  assert.deepEqual(JSON.parse(controls.textarea.value), [{
    operation: 'account-native-b', outcome: 'ready', inputType: 'change',
    inputUtc: '2026-11-18T12:00:00.005Z', dispatchMs: 3, readyMs: 42, nextFrameMs: 59
  }]);

  dataset.view = 'home';
  states.set('.home-dashboard-primary', new Element());
  const home = new Element();
  home.dataset.view = 'home';
  home.closest = selector => selector.startsWith('#mainNav') ? home : null;
  for (let index = 0; index < 190; index++) clickAt(home, 100 + index);

  // 191 finished rows plus one pending task. Interrupting the pending
  // operation uses the last available row before the next click can record.
  const dialog = new Element();
  dialog.closest = selector => selector.startsWith('#appearanceButton') ? dialog : null;
  clickAt(dialog, 300);
  clickAt(home, 301);
  frame(320);
  controls.details.listeners.toggle();
  const rows = JSON.parse(controls.textarea.value);
  assert.equal(rows.length, 192);
  assert.equal(rows.at(-1).operation, 'dialog-open');
  assert.equal(rows.at(-1).outcome, 'interrupted');
});
