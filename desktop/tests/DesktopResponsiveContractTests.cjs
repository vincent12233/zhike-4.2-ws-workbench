'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repo = path.resolve(__dirname, '..', '..');
const css = fs.readFileSync(path.join(repo, 'resources/app/modules/ws-workbench.css'), 'utf8');
const layout = fs.readFileSync(path.join(repo, 'desktop/src/Zhike.Desktop/Services/WindowLayoutService.cs'), 'utf8');
const wsCode = fs.readFileSync(path.join(repo, 'desktop/src/Zhike.Desktop/Views/WsWorkbenchPage.xaml.cs'), 'utf8');

assert.match(css, /--ws-left-min|ws-layout-vars/, 'WS layout must expose shared responsive variables');
assert.match(css, /@media \(max-width:900px\)/, 'WS must provide the tablet tab layout');
assert.match(css, /@media \(max-width:650px\)/, 'WS must provide the compact single-column layout');
assert.match(layout, /CalculateLayout\(/, 'WindowLayoutService must calculate pane layout');
assert.match(layout, /DpiScale|scale/, 'layout calculation must account for DPI');
assert.match(wsCode, /ApplyResponsiveLayout|CalculateLayout/, 'WS page must consume the shared layout calculation');
assert.doesNotMatch(wsCode, /GridLength\(_leftCollapsed \? 0 : 220\)/, 'WS page must not hard-code the old left width');
assert.doesNotMatch(wsCode, /GridLength\(_rightCollapsed \? 0 : 300\)/, 'WS page must not hard-code the old right width');

console.log('desktop responsive contract: DPI, breakpoints and WS adaptive layout are present');
