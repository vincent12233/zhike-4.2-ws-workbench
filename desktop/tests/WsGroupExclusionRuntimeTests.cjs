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
const container = {
  scrollTop:0, scrollHeight:500, clientHeight:500,
  querySelectorAll(selector) { return /listitem|role="row"|cell-frame-container/.test(selector) ? rows : []; },
  dispatchEvent() {},
};
const header = {
  getAttribute(name) { return name === 'data-id' ? activeId : ''; },
  querySelector() { return null; }, querySelectorAll() { return []; }, matches() { return false; },
  get innerText() { return activeTitle; }, get textContent() { return activeTitle; },
};
const document = {
  body:{}, documentElement:{ clientWidth:1200, clientHeight:800 }, readyState:'complete',
  querySelector(selector) {
    if (selector.includes('conversation-header') || selector.includes('#main header')) return activeId ? header : null;
    if (selector.includes('#pane-side') || selector.includes('chat-list') || selector === '[role="grid"]') return container;
    return null;
  },
  querySelectorAll(selector) {
    if (selector.includes('#pane-side') || selector.includes('chat-list') || selector === '[role="grid"]') return [container];
    if (/listitem|role="row"|cell-frame-container/.test(selector)) return rows;
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
assert.equal(configured.configured, 1, 'an explicit per-account VIP-group allowlist is required');
sandbox.window.__zhikeStopCapture();
timers.length = 0; frames.length = 0; posted.length = 0;

const discovery = sandbox.window.__zhikeWsDiscover();
assert.deepEqual(
  Array.from(discovery.conversations, item => item.title).sort(),
  ['+91 98765 43210', 'Direct JID', 'Saved Contact', '+91 99999 99999'].sort(),
  'confirmed direct chats and the explicitly whitelisted VIP group are eligible',
);
assert.equal(discovery.excludedGroupCount, 3, 'ordinary groups remain excluded even when another group is explicitly whitelisted');
assert.equal(discovery.conversationTypeUnresolvedCount, 1, 'an alias without stable type evidence remains fail-closed');
const phoneNamedGroup = discovery.excludedConversations.find(item => item.title === '+91 99999 99999');
const vipGroup = discovery.conversations.find(item => item.title === '+91 99999 99999');
assert.equal(vipGroup?.conversationType, 'vip_group', 'a matching stable @g.us identity is promoted only by the explicit whitelist');
assert.equal(vipGroup?.vipGroup, true);
assert.equal(discovery.excludedConversations.find(item => item.title === '+91 96666 66666')?.conversationType, 'group', 'default-group icon evidence wins over a phone-looking title');

// Group previews are observed from the virtualized list only. Starting the
// fixed monitor must not click, focus, scroll, or open that VIP conversation.
activeId = ''; activeTitle = ''; clicks.length = 0; posted.length = 0;
const monitorConfig = sandbox.window.__zhikeWsConfigureGroupMonitor({
  profileId:'monitor-profile', enabled:true, intervalSec:45,
  targets:[{ targetId:'monitor-target', groupJid:'group-456@g.us', groupName:'+91 99999 99999', enabled:true }],
});
assert.equal(monitorConfig.configured, 1);
const monitorStart = sandbox.window.__zhikeWsGroupMonitorStart();
assert.equal(monitorStart.status, 'running');
const previewEvents = posted.flatMap(packet => packet.groupEvents || []);
assert.ok(previewEvents.some(event => event.type === 'joined' && event.memberPhone === '919999999999'), 'VIP group list preview emits a normalized member event');
assert.equal(clicks.length, 0, 'group preview monitoring never opens a chat');
sandbox.window.__zhikeWsGroupMonitorStop();

const candidates = sandbox.window.__zhikeWsReadHistoryCandidates([...discovery.conversations, ...discovery.excludedConversations]);
assert.equal(candidates.read.length, 4, 'confirmed direct chats and the VIP group enter automatic history collection');
assert.equal(candidates.skipped.filter(item => item.status === 'skipped-group').length, 3);
assert.equal(candidates.skipped.filter(item => item.status === 'conversation-type-unresolved').length, 1);

activeId = 'group-456@g.us'; activeTitle = '+91 99999 99999';
const manualGroupCapture = sandbox.window.__zhikeWsCapture();
assert.equal(manualGroupCapture.conversationType, 'vip_group', 'manual opening rechecks the VIP whitelist and current header');
assert.notEqual(manualGroupCapture.blocked, true);
assert.deepEqual(Array.from(manualGroupCapture.messages), [], 'the fixture has no message DOM, but VIP capture is not policy-blocked');

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
assert.ok(clicks.every(title => ['+91 98765 43210', 'Direct JID', 'Saved Contact', '+91 99999 99999'].includes(title)), 'ordinary group and unknown rows are never clicked automatically');

console.log('WS VIP-group runtime: explicit whitelist allows one VIP group, ordinary groups stay excluded, and unread policy remains fail-closed');
