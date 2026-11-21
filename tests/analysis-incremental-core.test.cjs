'use strict';
// V5.0 §15 incremental analysis: skip unchanged chats, honour an explicit range.
const assert = require('node:assert/strict');
const core = require('../resources/app/modules/analysis-incremental-core.js');

const results = [];
function check(name, fn) {
  try { fn(); results.push(true); console.log('PASS ' + name); }
  catch (error) { results.push(false); console.log('FAIL ' + name + ' :: ' + error.message); }
}
const msg = (sentAt, body = 'x') => ({ originalText: body, data: { sentAt } });

check('an unchanged conversation is skipped', () => {
  const result = core.shouldSkipAnalysis({ currentFingerprint: 'fp-1', lastFingerprint: 'fp-1' });
  assert.equal(result.skip, true);
  assert.equal(result.reason, 'unchanged');
});
check('new content is analysed', () => {
  assert.equal(core.shouldSkipAnalysis({ currentFingerprint: 'fp-2', lastFingerprint: 'fp-1' }).skip, false);
  assert.equal(core.shouldSkipAnalysis({ currentFingerprint: 'fp-2', lastFingerprint: '' }).skip, false, 'never analysed before');
});
check('a forced analysis is never skipped', () => {
  assert.equal(core.shouldSkipAnalysis({ currentFingerprint: 'fp-1', lastFingerprint: 'fp-1', force: true }).skip, false);
});
check('a missing fingerprint is not treated as "nothing new"', () => {
  const result = core.shouldSkipAnalysis({ currentFingerprint: '', lastFingerprint: 'fp-1' });
  assert.equal(result.skip, true);
  assert.equal(result.reason, 'missing-fingerprint');
});
check('no range keeps every message', () => {
  const messages = [msg('2026-11-01T10:00:00Z'), msg('')];
  const result = core.selectMessagesForAnalysis(messages);
  assert.equal(result.ranged, false);
  assert.equal(result.messages.length, 2);
  assert.equal(result.dropped, 0);
});
check('a range keeps only messages inside it, inclusively', () => {
  const messages = [msg('2026-11-01T09:59:59Z'), msg('2026-11-01T10:00:00Z'), msg('2026-11-07T10:00:00Z'), msg('2026-11-07T10:00:01Z')];
  const result = core.selectMessagesForAnalysis(messages, { rangeStart: '2026-11-01T10:00:00Z', rangeEnd: '2026-11-07T10:00:00Z' });
  assert.equal(result.ranged, true);
  assert.equal(result.messages.length, 2);
  assert.equal(result.dropped, 2);
});
check('messages with no known send time are excluded and counted, never guessed', () => {
  const result = core.selectMessagesForAnalysis([msg(''), msg('not a date'), msg('2026-11-05T10:00:00Z')], { rangeStart: '2026-11-01T00:00:00Z' });
  assert.equal(result.messages.length, 1);
  assert.equal(result.unknownTime, 2);
});
check('a start-only or end-only range works', () => {
  const messages = [msg('2026-10-01T00:00:00Z'), msg('2026-11-05T00:00:00Z'), msg('2026-12-01T00:00:00Z')];
  assert.equal(core.selectMessagesForAnalysis(messages, { rangeStart: '2026-11-01T00:00:00Z' }).messages.length, 2);
  assert.equal(core.selectMessagesForAnalysis(messages, { rangeEnd: '2026-11-30T00:00:00Z' }).messages.length, 2);
});
check('a range with no messages yields an empty set rather than everything', () => {
  const result = core.selectMessagesForAnalysis([msg('2026-01-01T00:00:00Z')], { rangeStart: '2026-11-01T00:00:00Z' });
  assert.equal(result.messages.length, 0);
  assert.equal(result.ranged, true);
});
check('garbage input never throws', () => {
  for (const messages of [null, undefined, 'text', 42, [null, 5, {}]]) {
    const result = core.selectMessagesForAnalysis(messages, { rangeStart: '2026-11-01T00:00:00Z' });
    assert.ok(Array.isArray(result.messages));
  }
});

const failed = results.filter(ok => !ok).length;
console.log(`Incremental analysis: ${results.length - failed}/${results.length}`);
if (failed) process.exit(1);
