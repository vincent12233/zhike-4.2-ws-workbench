'use strict';
// V5.0 §27 ordinary-WS AI status strip.
const assert = require('node:assert/strict');
const core = require('../resources/app/modules/ws-ai-status-core.js');

const results = [];
function check(name, fn) {
  try { fn(); results.push(true); console.log('PASS ' + name); }
  catch (error) { results.push(false); console.log('FAIL ' + name + ' :: ' + error.message); }
}
const row = (status, key) => status.rows.find(item => item.key === key);

check('a healthy account reports every row from real state', () => {
  const status = core.buildAiStatus({
    accountId: 'acc-1', wsStatus: '已连接', collectorLabel: '独立采集会话已就绪',
    collectionRun: { updatedAt: '2026-11-21T07:00:00Z' },
    aiQueueStats: { queued: 2, running: 1, retryable: 0, failed: 0 },
  });
  assert.equal(row(status, 'account').value, 'acc-1');
  assert.equal(row(status, 'auth').tone, 'ok');
  assert.equal(row(status, 'collection').tone, 'ok');
  assert.match(row(status, 'lastAt').value, /2026/);
  assert.equal(row(status, 'queue').value, '3 个任务');
  assert.equal(row(status, 'failed').value, '0 个');
  assert.equal(status.tone, 'warn', 'pending work is a caution, not a failure');
});
check('an empty state says 未知/暂无 instead of inventing values', () => {
  const status = core.buildAiStatus({});
  assert.equal(row(status, 'account').value, '未选择账号');
  assert.equal(row(status, 'auth').value, '未知');
  assert.equal(row(status, 'auth').tone, 'unknown');
  assert.equal(row(status, 'collection').value, '未知');
  assert.equal(row(status, 'lastAt').value, '暂无记录');
  assert.equal(status.ready, false);
});
check('a broken connection and collector are errors, not warnings', () => {
  const status = core.buildAiStatus({ accountId: 'a', wsStatus: '连接失败', collectorLabel: '采集会话异常' });
  assert.equal(row(status, 'auth').tone, 'error');
  assert.equal(row(status, 'collection').tone, 'error');
  assert.equal(status.tone, 'error');
});
check('a waiting collector is a warning', () => {
  assert.equal(row(core.buildAiStatus({ accountId: 'a', wsStatus: '已连接', collectorLabel: '采集会话等待扫码' }), 'collection').tone, 'warn');
});
check('failed and dead-letter jobs are counted and drive the error tone', () => {
  const status = core.buildAiStatus({ accountId: 'a', wsStatus: '已连接', aiQueueStats: { failed: 2, deadLetter: 1 } });
  assert.equal(row(status, 'failed').value, '3 个');
  assert.equal(status.tone, 'error');
});
check('a background AI error is surfaced', () => {
  const status = core.buildAiStatus({ accountId: 'a', wsStatus: '已连接', aiBackgroundError: 'OpenAI Key 无效' });
  assert.equal(status.error, 'OpenAI Key 无效');
  assert.equal(status.tone, 'error');
});
check('the last collection time falls back to the run record and never fabricates one', () => {
  assert.match(row(core.buildAiStatus({ collectionRun: { created_at: '2026-11-20T01:00:00Z', createdAt: '2026-11-20T01:00:00Z' } }), 'lastAt').value, /2026/);
  assert.equal(row(core.buildAiStatus({ collectionRun: { updatedAt: 'garbage' } }), 'lastAt').value, '暂无记录');
});
check('malformed input never throws and always returns six rows', () => {
  for (const input of [undefined, null, 'x', 5, { aiQueueStats: 'oops' }, { aiQueueStats: { queued: -3 } }]) {
    const status = core.buildAiStatus(input);
    assert.equal(status.rows.length, 6);
    assert.ok(status.rows.every(item => typeof item.value === 'string' && item.label));
  }
});
check('negative or fractional counters are normalised', () => {
  const status = core.buildAiStatus({ aiQueueStats: { queued: -5, failed: 1.9 } });
  assert.equal(row(status, 'queue').value, '0 个任务');
  assert.equal(row(status, 'failed').value, '1 个');
});
check('the strip renders six labelled cells with their tones', () => {
  const html = core.renderAiStatusStrip({ accountId: 'acc-1', wsStatus: '已连接', collectorLabel: '独立采集会话已就绪', aiQueueStats: { queued: 1 } });
  for (const key of ['account', 'auth', 'collection', 'lastAt', 'queue', 'failed']) assert.ok(html.includes(`data-ai-status="${key}"`), key);
  for (const label of ['当前账号', '授权状态', '采集状态', '最近采集', '待分析', '失败']) assert.ok(html.includes(label), label);
  assert.match(html, /data-tone="warn"/);
  assert.match(html, /role="status"/);
});
check('the strip exposes a background error and escapes every value', () => {
  const html = core.renderAiStatusStrip({ accountId: '<img src=x>', wsStatus: '"onerror="', aiBackgroundError: '<script>alert(1)</script>' });
  assert.doesNotMatch(html, /<img|<script/);
  assert.match(html, /&lt;img src=x&gt;/);
  assert.match(html, /class="ws-ai-status-error"/);
});
check('the strip never claims a reading that is missing', () => {
  const html = core.renderAiStatusStrip({});
  assert.match(html, /暂无记录/);
  assert.match(html, /未知/);
  assert.doesNotMatch(html, /data-tone="error"/);
});

const failed = results.filter(ok => !ok).length;
console.log(`WS AI status strip: ${results.length - failed}/${results.length}`);
if (failed) process.exit(1);
