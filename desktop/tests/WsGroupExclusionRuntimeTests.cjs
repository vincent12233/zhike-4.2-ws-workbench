'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const repo = path.resolve(__dirname, '..', '..');
const host = fs.readFileSync(path.join(repo, 'desktop', 'src', 'Zhike.Desktop', 'Views', 'LegacyUiHostPage.xaml.cs'), 'utf8');
const match = host.match(/internal static string BuildWsCollectorScript\(string accountId\)\s*\{[\s\S]*?return \$\$"""([\s\S]*?)""";/);
assert.ok(match, 'native WS collector script must remain embedded');
const script = match[1].replace(/\{\{encodedAccount\}\}/g, JSON.stringify('group-test'));

const clicks = [];
let activeId = '';
let activeTitle = '';
let activeIdentityAttribute = 'data-id';
let messageNodes = [];
const leaf = (attributes = {}, value = '') => ({
  innerText:value, textContent:value,
  getAttribute(name) { return attributes[name] || ''; },
  closest() { return null; },
});

function makeRow({ id = '', title, preview = 'preview', chatType = '', nested = [] }) {
  const nameNode = leaf({ title }, title);
  const previewNode = leaf({ title:preview, 'data-testid':'last-msg' }, preview);
  const attributes = { 'data-id':id, 'data-chat-type':chatType, role:'row', 'data-testid':'cell-frame-container' };
  const row = {
    getAttribute(name) { return attributes[name] || ''; },
    matches() { return false; },
    querySelectorAll(selector) {
      if (selector.includes('[data-id]') || selector.includes('[data-chat-id]') || selector.includes('[data-jid]') || selector.includes('[data-group-id]') || selector.includes('[data-chat-type]') || selector.includes('[data-icon')) return nested;
      if (/cell-frame-title|span\[dir="auto"\]\[title\]/.test(selector)) return [nameNode];
      if (selector.includes('[aria-label]') || selector.includes('[data-testid]') || selector.includes('[title]')) return [nameNode, previewNode, ...nested];
      return [];
    },
    querySelector(selector) {
      if (selector === '[title]' || selector === '[title], span[dir="auto"]' || selector === 'span[dir="auto"]') return nameNode;
      if (selector.includes('last-msg') || selector.includes('preview') || selector.includes('span[title]')) return previewNode;
      return null;
    },
    closest() { return null; }, dispatchEvent() { return true; },
    scrollIntoView() {}, focus() {},
    click() { clicks.push(title); activeId = id || title; activeTitle = title; },
    innerText:`${title} ${preview}`, textContent:`${title} ${preview}`,
  };
  nameNode.closest = selector => /gridcell|cell-frame-container|tabindex/.test(selector) ? row : null;
  return row;
}

const nestedGroupJid = leaf({ 'data-jid':'nested-789@g.us' });
const defaultGroupIcon = leaf({ 'data-icon':'default-group' });
const rows = [
  makeRow({ id:'direct-123@s.whatsapp.net', title:'Direct JID' }),
  makeRow({ id:'group-456@g.us', title:'+91 99999 99999', preview:'+91 99999 99999 joined the group' }),
  makeRow({ id:'opaque-group', title:'Project Team', chatType:'group' }),
  makeRow({ id:'nested-group', title:'Nested Group', nested:[nestedGroupJid] }),
  makeRow({ id:'icon-group', title:'+91 96666 66666', nested:[defaultGroupIcon] }),
  makeRow({ id:'opaque-direct', title:'Saved Contact', chatType:'direct' }),
  makeRow({ title:'+91 98765 43210' }),
  makeRow({ id:'unknown-contact', title:'Unresolved Alias' }),
];
let visibleRows = () => rows;
let participantPanels = [];
const container = {
  scrollTop:0, scrollHeight:500, clientHeight:500,
  querySelectorAll(selector) { return /listitem|role="row"|cell-frame-container/.test(selector) ? visibleRows() : []; },
  dispatchEvent() {},
};
const header = {
  getAttribute(name) { return name === activeIdentityAttribute ? activeId : ''; },
  querySelector() { return null; }, querySelectorAll() { return []; }, matches() { return false; },
  get innerText() { return activeTitle; }, get textContent() { return activeTitle; },
};
const document = {
  body:{}, documentElement:{ clientWidth:1200, clientHeight:800 }, readyState:'complete',
  querySelector(selector) {
    if (selector.includes('conversation-header') || selector.includes('#main header')) return activeId || activeTitle ? header : null;
    if (selector.includes('#pane-side') || selector.includes('chat-list') || selector === '[role="grid"]') return container;
    return null;
  },
  querySelectorAll(selector) {
    if (selector.includes('group-info-drawer')) return participantPanels;
    if (selector.includes('msg-container') || selector.includes('data-pre-plain-text')) return messageNodes;
    if (selector.includes('#pane-side') || selector.includes('chat-list') || selector === '[role="grid"]') return [container];
    if (/listitem|role="row"|cell-frame-container/.test(selector)) return visibleRows();
    return [];
  },
};
const timers = [];
const frames = [];
const posted = [];
const sandbox = {
  window:{ chrome:{ webview:{ postMessage(raw) { posted.push(JSON.parse(raw)); } } }, addEventListener(){}, removeEventListener(){} },
  document,
  localStorage:{ getItem(){ return null; }, setItem(){} },
  MutationObserver:class { observe(){} disconnect(){} },
  Event:class { constructor(type, options) { this.type=type; Object.assign(this, options); } },
  MouseEvent:class { constructor(type, options) { this.type=type; this.isTrusted=false; Object.assign(this, options); } },
  requestAnimationFrame(callback) { frames.push(callback); return frames.length; },
  setTimeout(callback) { timers.push(callback); return timers.length; }, clearTimeout(){},
  setInterval(){ return 1; }, clearInterval(){},
  Date, JSON, Math, Set, Map, String, Number, Object, Array,
};

vm.runInNewContext(script, sandbox);
const configured = sandbox.window.__zhikeWsConfigureVipGroups(['group-456@g.us']);
assert.equal(configured.configured, 0, 'legacy VIP allowlists never upgrade collection authority');
sandbox.window.__zhikeStopCapture();
timers.length = 0; frames.length = 0; posted.length = 0;

const discovery = sandbox.window.__zhikeWsDiscover();
assert.deepEqual(
  Array.from(discovery.conversations, item => item.title).sort(),
  ['Direct JID', 'Saved Contact'].sort(),
  'ordinary accounts collect confirmed direct chats only',
);
assert.equal(discovery.excludedGroupCount, 4, 'all groups remain excluded from ordinary history');
assert.equal(discovery.unresolvedRowCount, 2, 'a phone-looking title without an ID and an unclassified row cannot confirm direct chats');
assert.equal(discovery.conversationTypeUnresolvedCount, 1, 'an alias without stable type evidence remains fail-closed');
const phoneNamedGroup = discovery.excludedConversations.find(item => item.title === '+91 99999 99999');
const vipGroup = discovery.conversations.find(item => item.title === '+91 99999 99999');
assert.equal(vipGroup, undefined, 'VIP labels do not promote a group into personal history');
assert.equal(phoneNamedGroup?.conversationType, 'group');
assert.equal(discovery.excludedConversations.find(item => item.title === '+91 96666 66666')?.conversationType, 'group', 'default-group icon evidence wins over a phone-looking title');

// Group previews are observed from the virtualized list only. Starting the
// fixed monitor must not click, focus, scroll, or open that VIP conversation.
activeId = ''; activeTitle = ''; clicks.length = 0; posted.length = 0;
const blockedMonitor = sandbox.window.__zhikeWsConfigureGroupMonitor({ profileId:'monitor-profile',targets:[{groupJid:'group-456@g.us'}] });
assert.equal(blockedMonitor.supported, false, 'ordinary account cannot monitor groups');
assert.equal(sandbox.window.__zhikeWsGroupMonitorStart().supported, false);
vm.runInNewContext('(function(__zhikeWsTrustedPurpose){'+script+'})("dedicated");', sandbox);
assert.equal(sandbox.window.__zhikeWsCollectAllRead().supported, false, 'dedicated cannot collect direct history');
const monitorConfig = sandbox.window.__zhikeWsConfigureGroupMonitor({
  profileId:'monitor-profile', enabled:true, intervalSec:45,
  targets:[{ targetId:'monitor-target', groupJid:'group-456@g.us', groupName:'+91 99999 99999', enabled:true }],
});
assert.equal(monitorConfig.configured, 1);
const participant = (id, visible = true) => ({
  getClientRects: () => visible ? [{}] : [], closest: () => null,
  getAttribute: attr => attr === 'data-participant-jid' ? id : null, querySelector: () => null,
});
const panel = (jid, members) => ({ getClientRects: () => [{}], closest: () => null,
  getAttribute: attr => attr === 'data-jid' ? jid : null, querySelectorAll: () => members });
participantPanels = [panel('other@g.us', [participant('999@lid')]),
  panel('group-456@g.us', [participant('123@lid'), participant('same name'), participant('456@lid', false)])];
activeId = 'group-456@g.us';
const monitorStart = sandbox.window.__zhikeWsGroupMonitorStart();
assert.equal(monitorStart.status, 'running');
assert.deepEqual(posted.flatMap(p => p.conversations || []).flatMap(row => row.observedMembers || []).map(row => row.memberId),
  ['123@lid'], 'only the displayed monitored group and a visible structured member row can supply an identity');
participantPanels = [];
const previewEvents = posted.flatMap(packet => packet.groupEvents || []);
assert.ok(previewEvents.some(event => event.type === 'joined' && event.memberPhone === '919999999999'), 'dedicated exact group target emits a normalized member event without VIP promotion');
assert.equal(clicks.length, 0, 'group preview monitoring never opens a chat');
activeId = 'group-456@g.us'; activeTitle = '+91 99999 99999';
function message(senderId, author, outgoing = false) {
  const attrs = { 'data-id':`${outgoing ? 'true' : 'false'}_message-${senderId || author}`, 'data-testid':'msg-container', 'data-sender-id':senderId, 'data-pre-plain-text':`[10:30, 11/20/2026] ${author}: ` };
  return { ...leaf(attrs, 'Member observed body'), classList:{ contains(name) { return name === (outgoing ? 'message-out' : 'message-in'); } }, querySelector(){ return null; }, querySelectorAll(){ return []; }, matches(){ return false; } };
}
messageNodes = [message('123456789@lid', 'Alice'), message('', 'Nickname Only'), message('919999999999@c.us', 'Self', true)];
const memberCapture = sandbox.window.__zhikeWsCapture();
assert.equal(memberCapture.messages.length, 1, 'only observed incoming member identity qualifies as group evidence');
assert.equal(memberCapture.messages[0].conversationType, 'group');
assert.equal(memberCapture.messages[0].vipGroup, false, 'new member evidence has no VIP permission flag');
assert.equal(memberCapture.messages[0].senderId, '123456789@lid');
assert.equal(memberCapture.messages[0].senderPhone, '', 'opaque LID digits are not a phone number');
assert.equal(memberCapture.messages[0].senderIdentityTrusted, true);
activeIdentityAttribute = 'data-jid';
assert.equal(sandbox.window.__zhikeWsCapture().messages.length, 1, 'semantic group data-jid header also supports passive evidence');
activeIdentityAttribute = 'data-id';
assert.equal(clicks.length, 0, 'passive member capture does not navigate or scroll');
activeId = 'other@g.us'; activeTitle = '+91 99999 99999';
assert.equal(sandbox.window.__zhikeWsCapture().blocked, true, 'a same-name unconfigured group cannot supply evidence');
activeId = ''; activeTitle = 'group-456@g.us';
assert.equal(sandbox.window.__zhikeWsCapture().blocked, true, 'a JID-looking display title is never authoritative identity');
activeId = 'direct-123@s.whatsapp.net'; activeTitle = 'Direct JID';
assert.equal(sandbox.window.__zhikeWsCapture().blocked, true, 'dedicated account does not capture direct text');
activeId = 'group-456@g.us'; activeTitle = '+91 99999 99999';
sandbox.window.__zhikeWsGroupMonitorPause();
assert.equal(sandbox.window.__zhikeWsCapture().blocked, true, 'pause stops passive member evidence');
messageNodes = [];
sandbox.window.__zhikeWsGroupMonitorStop();
sandbox.window.__zhikeStopCapture();
timers.length = 0; frames.length = 0; posted.length = 0;
activeId = ''; activeTitle = ''; clicks.length = 0;
const otherGroup = makeRow({ id:'other@g.us', title:'Recurring name', preview:'unchanged' });
const quietGroup = makeRow({ id:'authorized@g.us', title:'Recurring name', preview:'unchanged' });
container.scrollHeight = 1000;
container.scrollTop = 12;
visibleRows = () => container.scrollTop >= 500 ? [quietGroup] : [otherGroup];
vm.runInNewContext('(function(__zhikeWsTrustedPurpose){'+script+'})("dedicated");', sandbox);
posted.length = 0;
sandbox.window.__zhikeWsConfigureGroupMonitor({ profileId:'seat', targets:[
  {targetId:'target', groupJid:'authorized@g.us', groupName:'Recurring name'},
  {targetId:'missing', groupJid:'absent@g.us', groupName:'Recurring name'},
] });
sandbox.window.__zhikeWsGroupMonitorStart();
assert.equal(posted.some(packet => packet.conversations?.some(row => row.coverage === 'group-monitor-visible')), false, 'unobserved targets get no synthetic heartbeat');
let renderSteps = 0;
while (frames.length && renderSteps++ < 200) frames.shift()();
assert.ok(renderSteps < 200, 'bounded directory sweep reached the bottom');
const observed = posted.flatMap(packet => packet.conversations || []);
assert.deepEqual(observed.map(row => [row.conversationKey,row.coverage]), [['authorized@g.us','group-monitor-visible']], 'a quiet target below the fold reports one observation; its same-name neighbour and an absent target report none');
assert.ok(posted.every(packet => packet.groupEvents?.length === 0 && packet.capturedAt), 'quiet observations have capture times and zero membership events');
assert.equal(container.scrollTop, 12, 'monitor-only sweep restores the original position');
assert.equal(clicks.length, 0, 'monitoring only scrolls the independent directory');
sandbox.window.__zhikeWsGroupMonitorPause();
visibleRows = () => [quietGroup];
sandbox.window.__zhikeWsBackgroundTick();
assert.equal(posted.flatMap(packet => packet.conversations || []).filter(row => row.coverage === 'group-monitor-visible').length, 1, 'paused seat produces no new observations');
sandbox.window.__zhikeStopCapture();
visibleRows = () => rows;
container.scrollTop = 0; container.scrollHeight = 500;
timers.length = 0; frames.length = 0; posted.length = 0;
vm.runInNewContext(script, sandbox);

const candidates = sandbox.window.__zhikeWsReadHistoryCandidates([...discovery.conversations, ...discovery.excludedConversations]);
assert.equal(candidates.read.length, 2, 'only confirmed direct chats with stable identities enter ordinary history collection');
assert.equal(candidates.skipped.filter(item => item.status === 'skipped-group').length, 4);
assert.equal(candidates.skipped.filter(item => item.status === 'conversation-type-unresolved').length, 1);

activeId = 'group-456@g.us'; activeTitle = '+91 99999 99999';
const manualGroupCapture = sandbox.window.__zhikeWsCapture();
assert.equal(manualGroupCapture.conversationType, 'group');
assert.equal(manualGroupCapture.blocked, true, 'legacy VIP group remains outside ordinary automatic capture');
assert.deepEqual(Array.from(manualGroupCapture.messages), []);

activeId = 'opaque-group'; activeTitle = 'Project Team';
const ordinaryGroupCapture = sandbox.window.__zhikeWsCapture();
assert.equal(ordinaryGroupCapture.conversationType, 'group');
assert.equal(ordinaryGroupCapture.blocked, true, 'ordinary groups remain blocked');

activeId = ''; activeTitle = ''; clicks.length = 0;
const collectionStart = sandbox.window.__zhikeWsCollectAllRead();
assert.equal(collectionStart.started, true, 'automatic collection starts for the direct subset');
let guard = 0;
while (clicks.length < 4 && (timers.length || frames.length) && guard++ < 400) {
  while (frames.length) frames.shift()();
  if (timers.length) timers.shift()();
}
sandbox.window.__zhikeStopCapture();
assert.ok(clicks.length > 0, 'the fixture exercises the automatic click path');
assert.ok(clicks.every(title => ['+91 98765 43210', 'Direct JID', 'Saved Contact'].includes(title)), 'groups and unknown rows are never clicked automatically');

console.log('WS purpose runtime: ordinary direct history, dedicated passive exact-JID group monitoring, VIP has no authority');
