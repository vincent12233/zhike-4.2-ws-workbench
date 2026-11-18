'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const vm = require('node:vm');
const { script } = require('./native-input-probe.cjs');

test('isolated HUD correlates each trusted wheel, observes settled offsets, and reports controlled frames', () => {
  const secret = 'do-not-record-customer-or-key';
  class Element {
    constructor(selector, parentElement = null) {
      Object.assign(this, {
        selector, parentElement, localName: 'div', id: secret, textContent: secret,
        dataset: { scrollMode: 'contain', customer: secret }, isConnected: true,
        scrollTop: 0, scrollLeft: 0, clientHeight: 100, scrollHeight: 400, clientWidth: 200, scrollWidth: 200,
      });
    }
    matches(selector) { return selector.split(',').includes(this.selector) || selector.includes('[data-scroll-mode]'); }
    closest(selector) {
      for (let node = this; node; node = node.parentElement) if (node.matches(selector)) return node;
      return null;
    }
    getBoundingClientRect() { return { left: 2, top: 3, right: 202, bottom: 103 }; }
    querySelector() { return null; }
    setAttribute() {}
    appendChild() {}
  }
  const body = new Element('body');
  const page = new Element('#viewContainer', body);
  const nav = new Element('#mainNav', body);
  const content = new Element('.ws-workspace-page-content', page);
  const pre = new Element('pre', content);
  const root = new Element('html');
  root.dataset.theme = 'dark';
  root.dataset.palette = 'atelier-dawn';
  root.dataset.view = 'customers';
  const nodes = new Map([page, nav, content].map(node => [node.selector, node]));
  const events = new Map();
  const frames = [];
  const microtasks = [];
  const messages = [];
  const timeout = new Map();
  let clock = 0, timerSequence = 0;
  const document = {
    body, scrollingElement: root, documentElement: root, activeElement: nav,
    readyState: 'complete', querySelector: selector => nodes.get(selector), querySelectorAll: () => [],
    hasFocus: () => true, elementFromPoint: () => pre,
    createElement: () => Object.assign(new Element('pre'), { style: {} }),
  };
  const window = {
    devicePixelRatio: 1.25,
    visualViewport: { width: 800, height: 600, scale: 1, offsetLeft: 0, offsetTop: 0, addEventListener() {} },
    chrome: { webview: { postMessage: message => messages.push(message) } },
  };
  vm.runInNewContext(script, {
    window, document, Element, innerWidth: 800, innerHeight: 600,
    performance: { timeOrigin: 1_700_000_000_000, now: () => clock }, getComputedStyle: () => ({ overflowY: 'auto', overflowX: 'hidden' }),
    addEventListener: (name, callback, options) => events.set(name, { callback, options }),
    setTimeout: (callback, delay) => (timeout.set(++timerSequence, { callback, delay }), timerSequence),
    clearTimeout: id => timeout.delete(id),
    queueMicrotask: callback => microtasks.push(callback),
    requestAnimationFrame: callback => frames.push(callback),
  });

  const advance = delay => {
    const tasks = [...timeout.entries()].filter(([, task]) => task.delay === delay);
    assert.equal(tasks.length, 1);
    const [id, task] = tasks[0];
    timeout.delete(id);
    clock += delay;
    task.callback();
  };
  advance(260);
  const layout = JSON.parse(messages.shift());
  assert.equal(layout.type, 'stage51.input.layout');
  assert.equal(layout.geometry.dpr, 1.25);
  assert.equal(layout.geometry.theme, 'dark');
  assert.equal(layout.geometry.palette, 'atelier-dawn');
  assert.equal(layout.geometry.view, 'customers');
  assert.equal(layout.state.focus, 'sidebar');
  assert.equal(events.get('wheel').options.passive, true);

  const wheel = { target: pre, clientX: 111, clientY: 96, screenX: 222, screenY: 192, timeStamp: 100,
    deltaX: 0, deltaY: 42, deltaMode: 0, cancelable: true, defaultPrevented: false, ctrlKey: true };
  events.get('wheel').callback({ ...wheel, isTrusted: false });
  assert.equal(window.__stage51NativeInputProbe.counts.wheel, 0);
  assert.equal(frames.length, 0);

  clock = 300;
  events.get('wheel').callback({ ...wheel, isTrusted: true });
  events.get('wheel').callback({ ...wheel, isTrusted: true });
  const arrivals = messages.splice(0).map(JSON.parse);
  assert.deepEqual(arrivals.map(row => [row.type, row.wheelCount, row.timeOriginMs, row.sampleMs]), [
    ['stage51.input.wheel-arrival', 1, 1_700_000_000_000, 300],
    ['stage51.input.wheel-arrival', 2, 1_700_000_000_000, 300],
  ]);
  assert.ok(arrivals.every(row => row.state.trusted && row.state.ctrl));
  pre.scrollTop = 42;
  microtasks.shift()();
  frames.shift()();
  pre.scrollTop = 44;
  frames.shift()();
  assert.equal(messages.length, 1);
  assert.doesNotMatch(messages[0], new RegExp(secret));
  const sample = JSON.parse(messages[0]);
  assert.equal(sample.type, 'stage51.input.wheel');
  assert.equal(sample.state.target, 'pre');
  assert.equal(sample.state.hit, 'pre');
  assert.equal(sample.state.ctrl, true);
  assert.equal(sample.state.overlap, true);
  assert.equal(sample.wheelCount, 1);
  assert.deepEqual(sample.state.wheelPoint, [111, 96, 222, 192]);
  const offsets = Object.fromEntries(sample.state.candidates.map(row => [row.region,
    [row.before[0], row.afterDispatch[0], row.afterFrames[0]]]));
  assert.deepEqual(offsets.pre, [0, 42, 44]);
  assert.deepEqual(offsets['ws-content'], [0, 0, 0]);
  assert.deepEqual(offsets.page, [0, 0, 0]);
  assert.deepEqual(offsets.sidebar, [0, 0, 0]);

  pre.scrollTop = 180;
  advance(500);
  pre.scrollTop = 200;
  advance(120);
  assert.equal(messages.length, 1);
  advance(120);
  const settled = JSON.parse(messages[1]);
  assert.equal(settled.type, 'stage51.input.wheel-settled');
  assert.equal(settled.wheelCount, 2);
  assert.equal(settled.state.firstWheelCount, 1);
  assert.equal(settled.state.quietMs, 740);
  assert.equal(settled.state.offsetsStable, true);
  assert.equal(settled.state.candidates.find(row => row.region === 'pre').afterQuiet[0], 200);

  const keydown = events.get('keydown').callback;
  keydown({ key: 'F8', timeStamp: clock, isTrusted: false });
  keydown({ key: 'F8', timeStamp: clock, isTrusted: true, repeat: true });
  assert.equal(frames.length, 0);
  keydown({ key: 'F8', timeStamp: clock, isTrusted: true });
  frames.shift()();
  frames.shift()();
  const frame = JSON.parse(messages[2]);
  assert.equal(frame.type, 'stage51.input.frame');
  assert.equal(frame.frameCount, 1);
  assert.equal(frame.geometry.view, 'customers');
  assert.doesNotMatch(messages.join('\n'), new RegExp(secret));
});
