'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const repo = path.resolve(__dirname, '..', '..');
const host = fs.readFileSync(path.join(repo, 'desktop', 'src', 'Zhike.Desktop', 'Views', 'LegacyUiHostPage.xaml.cs'), 'utf8');
const match = host.match(/return \$\$"""([\s\S]*?)""";/);
assert.ok(match);
const script = match[1].replace(/\{\{encodedAccount\}\}/g, JSON.stringify('default'));

const node = attrs => ({
  textContent: attrs.text || '', innerText: attrs.text || '',
  getAttribute(name) { return attrs[name] || ''; },
});
const makeRow = ({ id, title, preview, badge = null, action = null, role = 'row', testId = 'cell-frame-container', chatType = 'direct' }) => {
  const nameNode = node({ title, text:title });
  const previewNode = node({ title:preview, text:preview });
  const semanticNodes = [nameNode, previewNode, badge, action].filter(Boolean);
  return {
    getAttribute(name) {
      if (name === 'data-id') return id || '';
      if (name === 'role') return role;
      if (name === 'data-testid') return testId;
      if (name === 'data-chat-type') return chatType;
      return '';
    },
    querySelectorAll(selector) {
      if (selector.includes('[aria-label]') || selector.includes('[data-testid]') || selector.includes('[title]')) return semanticNodes;
      return [];
    },
    querySelector(selector) {
      if (selector === '[title]' || selector === '[title], span[dir="auto"]' || selector === 'span[dir="auto"]') return nameNode;
      if (selector.includes('last-msg') || selector.includes('preview') || selector.includes('aria-description') || selector.includes('span[title]')) return previewNode;
      if (selector.includes('unread')) return badge || action;
      return null;
    },
    closest() { return null; },
    innerText: `${title} ${preview}`, textContent: `${title} ${preview}`,
  };
};
const realBadge = node({ 'data-testid':'icon-unread-count', 'aria-label':'2 unread messages', text:'2' });
const markUnreadAction = node({ 'data-testid':'mi-mark-unread', 'aria-label':'Mark as unread', title:'Mark as unread', text:'' });
const rows = [
  makeRow({ id:'chat-real-unread', title:'真实未读', preview:'hello', badge:realBadge }),
  makeRow({ id:'chat-action', title:'已读动作', preview:'ordinary preview', action:markUnreadAction }),
  makeRow({ id:'chat-preview', title:'预览文本', preview:'Please unread the attached document tomorrow' }),
  makeRow({ id:'', title:'未知结构', preview:'ordinary preview', role:'generic', testId:'mystery-row', chatType:'' }),
];
const container = {
  scrollTop:0, scrollHeight:400, clientHeight:400,
  querySelectorAll(selector) { return /listitem|role="row"|cell-frame-container/.test(selector) ? rows : []; },
  dispatchEvent() {},
};
const document = {
  body:{},
  querySelector(selector) { return selector.includes('#pane-side') || selector.includes('chat-list') || selector === '[role="grid"]' ? container : null; },
  querySelectorAll(selector) {
    if (selector.includes('#pane-side') || selector.includes('chat-list') || selector === '[role="grid"]') return [container];
    if (/listitem|role="row"|cell-frame-container/.test(selector)) return rows;
    return [];
  },
};
const timers=[];
const sandbox={
  window:{ chrome:{ webview:{ postMessage(){} } }, addEventListener(){}, removeEventListener(){} }, document,
  localStorage:{ getItem(){return null;}, setItem(){} }, MutationObserver:class{observe(){} disconnect(){}},
  Event:class{constructor(type,options){this.type=type;Object.assign(this,options);}},
  requestAnimationFrame(callback){return timers.push(callback);}, setTimeout(callback){return timers.push(callback);}, clearTimeout(){},
  setInterval(){return 1;}, clearInterval(){}, Date, JSON, Math, Set, Map, String, Number, Object, Array,
};
vm.runInNewContext(script,sandbox);
sandbox.window.__zhikeStopCapture();
const discovery=sandbox.window.__zhikeWsDiscover();
const conversations=discovery.conversations;
const byKey=new Map(conversations.map(item=>[item.conversationKey,item]));

assert.equal(byKey.get('chat-real-unread').unread,true,'a strict unread-count badge is unread');
assert.equal(byKey.get('chat-real-unread').unreadCount,2,'the strict badge count is preserved');
assert.equal(byKey.get('chat-action').unread,false,'Mark as unread action describes a read chat and must not be inverted');
assert.equal(byKey.get('chat-action').unreadCount,0,'action text does not synthesize an unread count');
assert.equal(byKey.get('chat-action').uncertainUnread,false,'a recognized chat row with no badge is a confirmed read row');
assert.equal(byKey.get('chat-action').status,'queued','readRows through discover must queue a recognized badge-free chat');
assert.equal(byKey.get('chat-preview').unread,false,'message preview containing “unread” is not an unread signal');
assert.equal(byKey.get('chat-preview').status,'queued','preview text must not turn a recognized read row into skipped_unread');
const unknown=discovery.excludedConversations.find(item=>item.title==='未知结构');
assert.ok(unknown?.uncertainUnread,'unrecognized DOM remains fail-closed');
assert.equal(unknown?.conversationType,'unknown','unresolved rows must never be promoted to direct chats');

console.log('WS unread detection runtime: strict badges pass, action/preview false positives are rejected, unknown DOM is conservative');
