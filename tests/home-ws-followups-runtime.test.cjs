'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const operationsCore = require('../resources/app/modules/operations-core.cjs');

const repo = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(repo, 'resources', 'app', 'app.js'), 'utf8');
const refreshCss = fs.readFileSync(path.join(repo, 'resources', 'app', 'modules', 'ui-refresh.css'), 'utf8');
assert.match(refreshCss, /\.home-ai-followup-list\{[^}]*minmax\(min\(100%,320px\),1fr\)/, 'five-card radar must retain a usable card width without forcing narrow-screen overflow');
assert.match(refreshCss, /\.home-ai-followup\{[^}]*grid-template-areas:"identity action" "objective objective" "score score" "opener opener"/, 'radar cards must reserve stable rows for identity, objective, score evidence and opener');
assert.match(refreshCss, /\.home-ai-followup-score,.home-ai-followup-opener\{[^}]*white-space:normal/, 'score evidence and opener must wrap instead of disappearing as one-line ellipsis');
const start = source.indexOf('  let homeWsAlertRequest=0;');
const end = source.indexOf('\n  function renderHome()', start);
assert.ok(start >= 0 && end > start, 'home follow-up loader must remain extractable for the runtime regression');

const loaderSource = source.slice(start, end);
const deeplinkStart = source.indexOf("  document.addEventListener('click',event=>{if(event.target.closest('[data-action=\"retry-home-ai\"]'))scheduleHomeWsFollowups({immediate:true});");
const deeplinkEnd = source.indexOf('\n', deeplinkStart);
assert.ok(deeplinkStart >= 0 && deeplinkEnd > deeplinkStart, 'home follow-up deep-link handler must remain extractable for the runtime regression');
const deeplinkSource = source.slice(deeplinkStart, deeplinkEnd).trim();
let currentHeading;
let currentPanel;
let headingSequence = 0;
const fetchQueue = [];
const fetchCalls = [];

function createPanel(html) {
  const attributes = new Set(html.includes('aria-busy') ? ['aria-busy'] : []);
  return {
    innerHTML: html,
    remove() { if (currentPanel === this) currentPanel = null; },
    removeAttribute(name) { attributes.delete(name); },
    hasAttribute(name) { return attributes.has(name); },
  };
}

function replaceHeading() {
  const heading = {
    id: `heading-${++headingSequence}`,
    insertAdjacentHTML(position, html) {
      assert.equal(position, 'afterend');
      currentPanel = createPanel(html);
    },
  };
  currentHeading = heading;
  currentPanel = null;
  return heading;
}

function $(selector) {
  if (selector === '#viewContainer .page-heading') return currentHeading;
  if (selector === '#homeWsFollowups') return currentPanel;
  return null;
}

function response({ ok = true, status = 200, body = {} } = {}) {
  return { ok, status, json: async () => body };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

class TestAbortController {
  constructor() { this.signal = { aborted: false }; }
  abort() { this.signal.aborted = true; }
}

const state = { view: 'home', customers: [], settings: { operatingTasks: [] } };
const windowObject = {};
const sandbox = {
  $, state, window: windowObject,
  fetch: (...args) => {
    fetchCalls.push(args);
    const next = fetchQueue.shift();
    if (!next) throw new Error('unexpected fallback fetch');
    return next;
  },
  esc: value => String(value == null ? '' : value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character])),
  icons: name => `<i>${name}</i>`,
  Promise, Number, Array, Error, AbortController: TestAbortController,
};
vm.runInNewContext(`${loaderSource}\n  globalThis.__loadHomeWsFollowups=loadHomeWsFollowups;`, sandbox, { filename: 'app-home-followups-runtime.js' });
const loadHomeWsFollowups = sandbox.__loadHomeWsFollowups;

(async () => {
  replaceHeading();
  const first = deferred();
  const second = deferred();
  fetchQueue.push(first.promise, second.promise);

  const staleLoad = loadHomeWsFollowups();
  const stalePanel = currentPanel;
  assert.ok(stalePanel, 'a loading panel must be mounted synchronously even when the late WS bridge is absent');
  assert.match(stalePanel.innerHTML, /正在读取最新 AI 跟进提醒/);
  assert.equal(stalePanel.hasAttribute('aria-busy'), true);

  replaceHeading();
  const currentLoad = loadHomeWsFollowups();
  const livePanel = currentPanel;
  assert.notEqual(livePanel, stalePanel, 'a home rerender must own a new panel instance');

  first.resolve(response({ body: { alerts: [{ taskId: 'task-old', title: '旧提醒' }] } }));
  const staleResult = await staleLoad;
  assert.equal(staleResult.stale, true, 'an older request must be discarded after a home rerender');
  assert.doesNotMatch(livePanel.innerHTML, /旧提醒|task-old/);

  second.resolve(response({ body: { alerts: [{ taskId: 'task-new', title: '新提醒', priorityScore: 88, qualificationScore: 75, engagementScore: 92 }] } }));
  const currentResult = await currentLoad;
  assert.equal(currentResult.alerts, 1);
  assert.equal(livePanel.hasAttribute('aria-busy'), false);
  assert.match(livePanel.innerHTML, /新提醒/);
  assert.match(livePanel.innerHTML, /task-new/);
  assert.match(fetchCalls[0][0], /\/api\/ws\/followup-alerts\?allAccounts=1&limit=5/);

  replaceHeading();
  state.customers = [
    { id: 'customer-same-a', name: 'iii', rawPhone: '+91 11111 00001' },
    { id: 'customer-same-b', name: 'iii', phone: '+91 22222 00002' },
    { id: 'customer-3', name: '客户三', rawPhone: '+91 33333 00003' },
    { id: 'customer-4', name: '客户四', rawPhone: '+91 44444 00004' },
    { id: 'customer-5', name: '', rawPhone: '+91 55555 00005' },
  ];
  fetchQueue.push(Promise.resolve(response({ body: { alerts: state.customers.map((customer, index) => ({
    taskId: `task-five-${index + 1}`,
    customerId: customer.id,
    title: customer.name,
    priorityScore: 90 - index,
    qualificationScore: 80 - index,
    engagementScore: 70 - index,
    scoreReason: `评分证据 ${index + 1}`,
    objective: `跟进目标 ${index + 1}`,
    opener: `建议开场 ${index + 1}`,
  })) } })));
  const fiveCardResult = await loadHomeWsFollowups();
  assert.equal(fiveCardResult.alerts, 5, 'home radar must render all five requested reminders');
  assert.equal((currentPanel.innerHTML.match(/class="home-ai-followup"/g) || []).length, 5);
  assert.equal((currentPanel.innerHTML.match(/<b>iii<\/b>/g) || []).length, 2, 'stored duplicate customer names must remain unchanged');
  assert.match(currentPanel.innerHTML, /\+91 11111 00001/);
  assert.match(currentPanel.innerHTML, /\+91 22222 00002/);
  assert.match(currentPanel.innerHTML, /评分依据：评分证据 1/);
  assert.match(currentPanel.innerHTML, /跟进目标 5/);
  assert.match(currentPanel.innerHTML, /建议开场：建议开场 5/);
  assert.match(currentPanel.innerHTML, /<b>\+91 55555 00005<\/b>/, 'a missing customer name must fall back to the existing phone without changing the customer record');
  assert.equal((currentPanel.innerHTML.match(/class="home-ai-followup-identity"/g) || []).length, 5);

  const fetchCountBeforeBridge = fetchCalls.length;
  replaceHeading();
  let bridgeCalls = 0;
  windowObject.__zhikeWsFollowups = {
    load: async limit => {
      bridgeCalls += 1;
      assert.equal(limit, 5);
      return [{ taskId: 'task-bridge', title: '桥接提醒' }];
    },
  };
  const bridgeResult = await loadHomeWsFollowups();
  assert.equal(bridgeCalls, 1, 'the registered WS bridge must remain the preferred loader');
  assert.equal(fetchCalls.length, fetchCountBeforeBridge, 'bridge success must not issue a duplicate fallback request');
  assert.equal(bridgeResult.alerts, 1);
  assert.match(currentPanel.innerHTML, /桥接提醒/);

  delete windowObject.__zhikeWsFollowups;
  replaceHeading();
  fetchQueue.push(Promise.resolve(response({ ok: false, status: 503, body: { error: '本机提醒服务正在恢复' } })));
  const failed = await loadHomeWsFollowups();
  assert.equal(failed.error, true);
  assert.equal(currentPanel.hasAttribute('aria-busy'), false);
  assert.match(currentPanel.innerHTML, /本机提醒服务正在恢复/);
  assert.match(currentPanel.innerHTML, /data-action="retry-home-ai"/);

  replaceHeading();
  const orphaned = deferred();
  fetchQueue.push(orphaned.promise);
  const orphanedLoad = loadHomeWsFollowups();
  const orphanedPanel = currentPanel;
  replaceHeading();
  orphaned.resolve(response({ body: { alerts: [{ taskId: 'task-orphaned', title: '孤立响应' }] } }));
  const orphanedResult = await orphanedLoad;
  assert.equal(orphanedResult.stale, true, 'heading identity must reject a response after an unpaired DOM replacement');
  assert.notEqual(currentPanel, orphanedPanel);
  assert.doesNotMatch(currentPanel?.innerHTML || '', /孤立响应|task-orphaned/);

  let deeplinkClick;
  const targetTask = { id: 'task-new', title: '需要跟进的新提醒', owner: '负责人甲', aiGenerated: true, status: 'open', due: '2026-11-13' };
  let renderedTasks = [];
  state.opsTaskQuery = '';
  state.opsTaskFilter = 'open';
  state.opsTaskBucket = 'today';
  state.opsTaskOwner = '错误负责人';
  windowObject.ZhikeOperationsUI = {
    render(force) {
      assert.equal(force, true);
      renderedTasks = operationsCore.selectTasks([targetTask], {
        search: state.opsTaskQuery,
        status: state.opsTaskFilter === 'all' ? '' : state.opsTaskFilter,
        bucket: state.opsTaskBucket,
        owner: state.opsTaskOwner,
      }, '2026-11-13');
    },
  };
  vm.runInNewContext(deeplinkSource, {
    document: { addEventListener(type, handler, capture) { assert.equal(type, 'click'); assert.equal(capture, true); deeplinkClick = handler; } },
    state,
    window: windowObject,
    scheduleHomeWsFollowups() { throw new Error('task deep-link must not trigger retry loading'); },
  }, { filename: 'app-home-followups-deeplink-runtime.js' });
  assert.equal(typeof deeplinkClick, 'function');
  const deepLinkButton = { dataset: { taskId: 'task-new' } };
  deeplinkClick({ target: { closest(selector) { return selector.includes('go-operations') ? deepLinkButton : null; } } });
  assert.equal(state.opsTaskOwner, '', 'a radar deep-link must clear a stale owner filter');
  assert.equal(state.opsTaskFilter, 'all');
  assert.equal(state.opsTaskBucket, '');
  assert.deepEqual(renderedTasks.map(task => task.id), ['task-new'], 'a stale owner filter must not hide the task selected from the home radar');

  const fetchCountBeforeLeavingHome = fetchCalls.length;
  state.view = 'operations';
  const skipped = await loadHomeWsFollowups();
  assert.equal(skipped.skipped, true);
  assert.equal(fetchCalls.length, fetchCountBeforeLeavingHome, 'a non-home view must not start a reminder request');

  console.log('home WS follow-up runtime: fallback, placeholder, stale guard, five-card identity/score layout, bridge priority, visible retry and filter-safe task deep-link passed');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
