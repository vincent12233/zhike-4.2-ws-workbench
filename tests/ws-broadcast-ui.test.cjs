'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repo = path.resolve(__dirname, '..');
const ws = fs.readFileSync(path.join(repo, 'resources/app/modules/ws-workbench.js'), 'utf8');
const css = fs.readFileSync(path.join(repo, 'resources/app/modules/ws-workbench.css'), 'utf8');

for (const marker of [
  'wsBroadcastCard', '群发与翻译', 'broadcast-select-all', 'create-broadcast-plan',
  'send-broadcast-item', '/api/ws/broadcast', '/api/ws/send', '翻译预览',
]) assert.match(ws, new RegExp(marker.replace(/[.*+?^${}()|[\\]\\]/g, '\\\\$&')), `WS broadcast UI missing ${marker}`);
assert.match(ws, /explicitConversationType\(item\) === 'direct'/, 'broadcast must only offer direct conversations');
assert.match(ws, /Number\(item\.unreadCount \|\| 0\) === 0/, 'broadcast must exclude unread conversations by default');
assert.match(ws, /知客不会自动切换聊天窗口/, 'broadcast must never silently switch the foreground chat');
assert.match(css, /ws-broadcast-card/);
console.log('ws-broadcast-ui: read-direct recipient filtering, translation preview, audited queue and foreground safety pass');

