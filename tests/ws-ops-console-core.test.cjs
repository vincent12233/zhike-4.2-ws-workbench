'use strict';
// V5.0 §30 WS operations console strip.
const assert = require('node:assert/strict');
const core = require('../resources/app/modules/ws-ops-console-core.js');

const results = [];
function check(name, fn) {
  try { fn(); results.push(true); console.log('PASS ' + name); }
  catch (error) { results.push(false); console.log('FAIL ' + name + ' :: ' + error.message); }
}
const row = (state, key) => state.rows.find(item => item.key === key);

check('the ordinary console reports account, connection, collector, last run and backlog', () => {
  const state = core.buildOpsConsole({
    mode: 'ordinary', accountCount: 3, connectedCount: 1, wsStatus: '已连接',
    collectorLabel: '独立采集会话已就绪', collectedAt: '2026-11-21T02:00:00Z', eventCounts: { pending: 4, review: 1 },
  });
  assert.equal(row(state, 'accounts').value, '3 个 · 已连接 1');
  assert.equal(row(state, 'connection').tone, 'ok');
  assert.equal(row(state, 'collector').tone, 'ok');
  assert.match(row(state, 'lastAt').value, /2026/);
  assert.equal(row(state, 'backlog').value, '5 条');
  assert.equal(row(state, 'targets'), undefined, 'ordinary mode has no group target row');
  assert.equal(state.tone, 'warn');
});
check('the dedicated console adds monitored groups', () => {
  const state = core.buildOpsConsole({ mode: 'dedicated', accountCount: 1, connectedCount: 1, wsStatus: '已连接', collectorLabel: '独立采集会话已就绪', targetCount: 6, eventCounts: {} });
  assert.equal(row(state, 'targets').value, '6 个');
  assert.equal(row(state, 'targets').tone, 'ok');
  assert.equal(state.tone, 'ok');
});
check('a broken connection or collector is an error', () => {
  const state = core.buildOpsConsole({ mode: 'dedicated', accountCount: 1, wsStatus: '连接失败', collectorLabel: '采集会话异常' });
  assert.equal(row(state, 'connection').tone, 'error');
  assert.equal(row(state, 'collector').tone, 'error');
  assert.equal(state.tone, 'error');
});
check('missing readings stay unknown instead of zero', () => {
  const state = core.buildOpsConsole({});
  assert.equal(row(state, 'accounts').value, '未知');
  assert.equal(row(state, 'accounts').tone, 'warn');
  assert.equal(row(state, 'connection').value, '未知');
  assert.equal(row(state, 'connection').tone, 'unknown');
  assert.equal(row(state, 'lastAt').value, '暂无记录');
  assert.equal(state.pendingEvents, 0);
});
check('the renderer titles the strip by workspace and exposes every cell', () => {
  const dedicated = core.renderOpsConsole({ mode: 'dedicated', accountCount: 2, wsStatus: '已连接', collectorLabel: '独立采集会话已就绪', targetCount: 4 });
  assert.match(dedicated, /专用 WS 运营态势/);
  for (const key of ['accounts', 'connection', 'collector', 'targets', 'lastAt', 'backlog']) assert.ok(dedicated.includes(`data-ops="${key}"`), key);
  assert.match(core.renderOpsConsole({ mode: 'ordinary' }), /WS 采集态势/);
});
check('rendered values are escaped and never inject markup', () => {
  const html = core.renderOpsConsole({ mode: 'ordinary', wsStatus: '<img src=x>', collectorLabel: '"onerror="' });
  assert.doesNotMatch(html, /<img/);
  assert.match(html, /&lt;img src=x&gt;/);
});
check('malformed input never throws', () => {
  for (const input of [undefined, null, 'x', 5, { eventCounts: 'oops', accountCount: -2, targetCount: 2.7 }]) {
    const state = core.buildOpsConsole(input);
    assert.ok(Array.isArray(state.rows) && state.rows.length >= 5);
    assert.equal(typeof core.renderOpsConsole(input), 'string');
  }
});

const failed = results.filter(ok => !ok).length;
console.log(`WS ops console: ${results.length - failed}/${results.length}`);
if (failed) process.exit(1);
