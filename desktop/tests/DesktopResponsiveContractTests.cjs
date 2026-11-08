'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repo = path.resolve(__dirname, '..', '..');
const css = fs.readFileSync(path.join(repo, 'resources/app/modules/ws-workbench.css'), 'utf8');
const design = fs.readFileSync(path.join(repo, 'resources/app/modules/design-system.css'), 'utf8');
const hostCss = fs.readFileSync(path.join(repo, 'resources/app/modules/desktop-host.css'), 'utf8');
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
assert.match(hostCss, /html\[data-desktop-host\] \.main-area\{[^}]*overflow:hidden/, 'desktop host must keep one page scroll container');
assert.match(design, /\.view-container\{[^}]*scrollbar-gutter:stable/, 'main content scroll area must reserve a stable scrollbar gutter');
assert.match(design, /\.table-scroll,\.table-wrap,\.task-table-wrap,\.registry-table-wrap\{[^}]*overflow:auto/, 'wide tables must scroll inside their own container');
assert.match(design, /\.sidebar\{[^}]*width:224px[^}]*flex-basis:224px/, 'expanded navigation width must be stable');
assert.match(design, /\.topbar\{[^}]*height:52px[^}]*min-height:52px/, 'topbar height must be stable');
assert.match(design, /\.app-footer\{[^}]*height:28px/, 'footer height must be stable');

console.log('desktop responsive contract: DPI, breakpoints and WS adaptive layout are present');
