'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repo = path.resolve(__dirname, '..');
const js = fs.readFileSync(path.join(repo, 'resources', 'app', 'modules', 'ws-workbench.js'), 'utf8');
const css = fs.readFileSync(path.join(repo, 'resources', 'app', 'modules', 'ws-workbench.css'), 'utf8');
const scrollCss = fs.readFileSync(path.join(repo, 'resources', 'app', 'modules', 'scroll-system.css'), 'utf8');
const coordinator = fs.readFileSync(path.join(repo, 'resources', 'app', 'modules', 'scroll-coordinator.js'), 'utf8');

// A+ dual-layer layout: compact command rail, maximum foreground WebView,
// collapsible local workspace and a persistent process rail.
assert.match(js, /ws-command-rail/, 'WS must render a compact command rail');
assert.match(js, /ws-local-workspace/, 'capture/message area must be a collapsible local workspace');
assert.match(js, /ws-process-rail/, 'collection workflow must render a process rail');
assert.match(css, /\.ws-command-rail[^{]*\{/, 'command rail needs a dedicated compact layout rule');
assert.match(css, /\.ws-local-workspace[^{]*\{/, 'local workspace needs an explicit shell rule');
assert.match(css, /\.ws-process-rail[^{]*\{/, 'process rail needs an explicit shell rule');
assert.match(css, /\.ws-browser-host[^{]*\{[\s\S]*?(?:flex:|min-height)/, 'foreground WebView must remain the flexible center surface');
assert.match(scrollCss, /\.ws-local-workspace[\s\S]*?overscroll-behavior:contain/, 'local workspace must contain its wheel');
assert.match(scrollCss, /\.ws-process-rail[\s\S]*?overflow:hidden/, 'process rail must never become a competing scroll owner');
assert.doesNotMatch(coordinator, /selector:\s*['"]\.ws-center-panel['"][\s\S]{0,120}mode:\s*['"]contain['"]/, 'center shell must not be registered as a scroll owner');

console.log('ws-workbench-a-plus-layout: compact rail, max WebView, collapsible local workspace and stable process rail required');
