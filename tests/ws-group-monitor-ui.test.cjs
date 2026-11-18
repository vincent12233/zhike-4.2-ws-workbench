'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const ws = fs.readFileSync(path.join(root, 'resources/app/modules/ws-workbench.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'resources/app/modules/ws-workbench.css'), 'utf8');
const app = fs.readFileSync(path.join(root, 'resources/app/app.js'), 'utf8');
for (const marker of [
  'groupMonitor:', 'loadGroupMonitor', 'fixed-group-seat',
  '/api/ws/group-monitors/profiles', 'targets/scan',
  'group-monitor-toggle', 'group-monitor-scan',
  'group-monitor-resolve', 'group-monitor-add-target',
  'group-monitor-add-selected', 'groupMonitorDiscoveredGroups', 'discoveredGroupConversations',
  'wsGroupMonitorPicker', 'wsGroupMonitorJid', 'wsGroupMonitorName', 'wsGroupMonitorCard',
]) assert.match(ws, new RegExp(marker.replace(/[.*+?^${}()|[\\]\\]/g, '\\\\$&')), `WS group-monitor UI missing ${marker}`);
assert.match(ws, /events\?status=/);
assert.match(ws, /data-ws-action="group-monitor-toggle"/);
assert.match(ws, /data-ws-action="group-monitor-scan"/);
assert.match(ws, /data-ws-action="group-monitor-resolve"/);
assert.match(ws, /async function addGroupMonitorTarget/);
assert.match(ws, /当前账号尚未同步可扫描的 WS 群组/);
assert.match(ws, /从当前 WS 群组/);
assert.match(ws, /只监测明确添加的 WS 群组/);
assert.match(ws, /自动登记/);
assert.match(ws, /审核中、待批准和无法确认的事件不会建档/);
assert.match(ws, /collectionRefreshTimer\s*=\s*setInterval\([\s\S]*?loadGroupMonitor\(\{\s*background:\s*true/,
  'group monitor must poll from the shared background runtime');
assert.match(ws, /async function loadGroupMonitor[\s\S]*?const background = options\.background === true[\s\S]*?finally \{[\s\S]*?monitor\.loading = false;[\s\S]*?updateGroupMonitorDom\(\);[\s\S]*?if \(!background && !options\.silent\) render\(\)/,
  'background monitor refresh must update a stable local DOM anchor without rendering the WS shell');
assert.match(ws, /if \(background\) await getHost\(\)\?\.refreshState\?\.\(\)/,
  'background group events must refresh the shared customer state');
assert.match(app, /groupMemberships/);
assert.match(app, /群组关系/);
assert.match(css, /ws-group-monitor/);
console.log('ws-group-monitor-ui: pass');
