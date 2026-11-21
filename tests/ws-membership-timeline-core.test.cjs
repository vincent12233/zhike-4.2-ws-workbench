'use strict';
// V5.0 §28 join/leave timeline: confirmed, observed and unconfirmed evidence.
const assert = require('node:assert/strict');
const core = require('../resources/app/modules/ws-membership-timeline-core.js');

const results = [];
function check(name, fn) {
  try { fn(); results.push(true); console.log('PASS ' + name); }
  catch (error) { results.push(false); console.log('FAIL ' + name + ' :: ' + error.message); }
}
const rowsFor = (events, options) => core.buildMembershipTimeline(events, options);

check('a stored membership write is the only 已确认 evidence', () => {
  assert.deepEqual(core.classify({ status: 'applied' }).kind, 'confirmed');
  assert.deepEqual(core.classify({ status: 'applied', data: { autoRegistered: true } }).note.includes('自动登记'), true);
  assert.equal(core.classify({ status: 'pending' }).kindLabel, '已观察');
  assert.equal(core.classify({ status: 'review' }).kindLabel, '无法确认');
  assert.equal(core.classify({}).kind, 'observed');
});
check('pending and review events ask for a human instead of writing data', () => {
  assert.equal(core.classify({ status: 'pending' }).needsAction, true);
  assert.equal(core.classify({ status: 'review' }).needsAction, true);
  assert.equal(core.classify({ status: 'applied' }).needsAction, false);
  assert.match(core.classify({ status: 'review' }).note, /未建档/);
});
check('every row carries group, member, event label and time', () => {
  const [row] = rowsFor([{ id: 'e1', status: 'applied', eventType: 'joined', groupJid: 'a@g.us', data: { groupName: 'A-501群' }, memberPhone: '9800000001', eventAt: '2026-11-20T03:00:00Z', confidence: 0.92 }]);
  assert.equal(row.eventLabel, '进群');
  assert.equal(row.groupName, 'A-501群');
  assert.equal(row.member, '9800000001');
  assert.equal(row.confidencePct, 92);
  assert.match(row.at, /2026/);
  assert.equal(row.kind, 'confirmed');
});
check('unknown event types and missing members stay honest', () => {
  const [row] = rowsFor([{ id: 'e2', status: 'review', eventType: 'mystery' }]);
  assert.equal(row.eventLabel, '未知事件');
  assert.equal(row.groupName, '未命名群组');
  assert.equal(row.member, '未知成员');
  assert.equal(row.confidencePct, null);
  assert.equal(row.at, '');
});
check('a linked customer names the profile, an unlinked one does not invent a name', () => {
  const [linked, unlinked] = rowsFor([
    { id: 'a', status: 'applied', customerId: 'C1' },
    { id: 'b', status: 'pending', customerId: 'C2' },
  ], { customers: [{ id: 'C1', name: 'Ravi' }] });
  assert.equal(linked.customerName, 'Ravi');
  assert.equal(unlinked.customerName, '');
});
check('rows are ordered newest first', () => {
  const rows = rowsFor([
    { id: 'old', status: 'applied', eventAt: '2026-11-01T00:00:00Z' },
    { id: 'new', status: 'applied', eventAt: '2026-11-20T00:00:00Z' },
  ]);
  assert.deepEqual(rows.map(row => row.id), ['new', 'old']);
});
check('the summary counts each evidence level', () => {
  const rows = rowsFor([
    { id: '1', status: 'applied' }, { id: '2', status: 'applied', data: { autoRegistered: true } },
    { id: '3', status: 'pending' }, { id: '4', status: 'review' }, { id: '5', status: 'ignored' },
  ]);
  assert.deepEqual(core.summarizeMembershipTimeline(rows), { confirmed: 2, observed: 1, unknown: 1, ignored: 1, total: 5 });
});
check('the renderer marks every row with its evidence level and escapes content', () => {
  const html = core.renderMembershipTimeline(rowsFor([
    { id: '1', status: 'applied', eventType: 'joined', data: { groupName: '<b>群</b>' }, memberPhone: '<script>x</script>' },
    { id: '2', status: 'review', eventType: 'left' },
  ]));
  assert.match(html, /data-ws-membership-timeline/);
  assert.match(html, /data-kind="confirmed"/);
  assert.match(html, /data-kind="unknown"/);
  assert.match(html, /已确认/);
  assert.match(html, /无法确认/);
  assert.doesNotMatch(html, /<b>群<\/b>|<script>/);
  assert.match(html, /&lt;b&gt;/);
});
check('an empty timeline says so', () => {
  assert.match(core.renderMembershipTimeline([]), /尚未保存符合条件的进退群事件/);
  assert.match(core.renderMembershipTimeline(undefined), /ws-muted/);
});
check('malformed events never throw and never reach 已确认', () => {
  for (const input of [undefined, null, 'x', 5, [null, undefined, 'a', { status: 42 }]]) {
    const rows = rowsFor(input);
    assert.ok(Array.isArray(rows));
    assert.ok(rows.every(row => row.kind !== 'confirmed'));
  }
});

check('the group monitor card wires the evidence level into every event row', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const source = fs.readFileSync(path.join(__dirname, '..', 'resources/app/modules/ws-workbench.js'), 'utf8');
  assert.match(source, /data-evidence="\$\{esc\(evidence\?\.kind \|\| ''\)\}"/);
  assert.match(source, /ws-membership-kind" data-kind="\$\{esc\(evidence\.kind\)\}"/);
  assert.match(source, /已确认 \$\{timelineCounts\.confirmed\} · 已观察 \$\{timelineCounts\.observed\} · 无法确认 \$\{timelineCounts\.unknown\}/);
  const html = fs.readFileSync(path.join(__dirname, '..', 'resources/app/index.html'), 'utf8');
  assert.ok(html.includes('modules/ws-membership-timeline-core.js'), 'module is loaded by the renderer');
});

const failed = results.filter(ok => !ok).length;
console.log(`WS membership timeline: ${results.length - failed}/${results.length}`);
if (failed) process.exit(1);
