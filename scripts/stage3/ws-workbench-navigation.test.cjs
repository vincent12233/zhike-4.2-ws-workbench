'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..', '..');
const source = fs.readFileSync(path.join(root, 'resources', 'app', 'modules', 'ws-workbench.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'resources', 'app', 'modules', 'ws-workbench.css'), 'utf8');
const views = ['overview', 'accounts', 'groups', 'members', 'collection', 'ai', 'crm', 'tasks', 'logs', 'settings'];

for (const view of views) assert.match(source, new RegExp(`['\"]${view}['\"]`), `missing WS workspace view: ${view}`);
assert.match(source, /wsWorkspaceView/, 'WS workspace view state must be explicit');
assert.match(source, /renderWsWorkspaceNav/, 'WS workspace navigation must be rendered by a dedicated function');
assert.match(source, /data-ws-workspace-view/, 'navigation items must use a stable data attribute');
assert.match(source, /renderWsWorkspacePage/, 'each workspace page must have a dedicated render boundary');
assert.match(source, /ws-workspace-nav/, 'WS workspace navigation needs its own layout class');
assert.match(source, /ws-workspace-nav\.is-collapsed|ws-workspace-shell/, 'WS workspace navigation must support collapse without rebuilding the WebView');
assert.match(source, /wsBrowserHost/, 'navigation must preserve the existing browser host');
assert.match(source, /activeView === 'ai'[^\n]*renderAiAuthorization\(\)/, 'The AI page must expose the scoped authorization controls');
assert.match(css, /ws-workspace-nav/, 'workspace navigation styles are missing');
assert.match(css, /ws-workspace-nav.*collapsed|is-collapsed/, 'workspace navigation collapse styles are missing');
console.log('stage3 WS workspace navigation contract: pass');
