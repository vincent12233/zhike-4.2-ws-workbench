'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repo = path.resolve(__dirname, '..', '..');
const css = fs.readFileSync(path.join(repo, 'resources/app/modules/ws-workbench.css'), 'utf8');
const design = fs.readFileSync(path.join(repo, 'resources/app/modules/design-system.css'), 'utf8');
const hostCss = fs.readFileSync(path.join(repo, 'resources/app/modules/scroll-system.css'), 'utf8');
const layout = fs.readFileSync(path.join(repo, 'desktop/src/Zhike.Desktop/Services/WindowLayoutService.cs'), 'utf8');
const legacyXaml = fs.readFileSync(path.join(repo, 'desktop/src/Zhike.Desktop/Views/LegacyUiHostPage.xaml'), 'utf8');
const legacyCode = fs.readFileSync(path.join(repo, 'desktop/src/Zhike.Desktop/Views/LegacyUiHostPage.xaml.cs'), 'utf8');
const appCss = fs.readFileSync(path.join(repo, 'resources/app/styles.css'), 'utf8');
const shellCss = fs.readFileSync(path.join(repo, 'resources/app/modules/horizon-atelier.css'), 'utf8');
const index = fs.readFileSync(path.join(repo, 'resources/app/index.html'), 'utf8');

assert.match(css, /--ws-left-min|ws-layout-vars/, 'WS layout must expose shared responsive variables');
assert.match(css, /@media \(max-width:900px\)/, 'WS must provide the tablet tab layout');
assert.match(css, /@media \(max-width:650px\)/, 'WS must provide the compact single-column layout');
assert.match(layout, /CalculateLayout\(/, 'WindowLayoutService must calculate pane layout');
assert.match(layout, /DpiScale|scale/, 'layout calculation must account for DPI');
assert.match(legacyCode, /ws-workbench/, 'desktop host must keep the complete WS workbench route alive');
assert.match(hostCss, /html\[data-desktop-host\] \.main-area\{[^}]*overflow:hidden/, 'desktop host must keep one page scroll container in the consolidated scroll layer');
// Scroll ownership moved to the consolidated final layer. Verify the real
// owner AND its final load order rather than looking for obsolete DS copies.
const stylesheets = [...index.matchAll(/<link\s+rel="stylesheet"\s+href="\.\/([^"]+)"/g)].map(match => match[1]);
assert.equal(stylesheets.at(-1), 'modules/scroll-system.css', 'the consolidated scroll owner must be the last production stylesheet');
assert.match(hostCss, /\.view-container\s*\{[^}]*overflow-y:auto!important[^}]*scrollbar-gutter:stable/,
  'main content must retain a real scroll range and stable gutter in its authoritative layer');
assert.match(hostCss, /\.table-scroll,\s*\.table-wrap,\s*\.task-table-wrap,\s*\.registry-table-wrap,\s*\.home-task-scroll\s*\{[^}]*overflow-x:auto!important[^}]*overflow-y:auto!important[^}]*scrollbar-gutter:stable/,
  'wide tables retain their bounded scroll container and stable gutter in the final layer');
assert.match(shellCss, /--zhike-sidebar-expanded:248px;--zhike-sidebar-collapsed:72px/,
  'the S1 independent main workspace has an explicit expanded and collapsed navigation width');
assert.match(shellCss, /#sidebar\s*\{[^}]*width:var\(--zhike-sidebar-expanded\)!important[^}]*flex-basis:var\(--zhike-sidebar-expanded\)!important/,
  'the actual expanded sidebar must consume its width contract');
assert.match(shellCss, /#sidebar\.collapsed\s*\{[^}]*width:72px!important[^}]*flex-basis:72px!important/,
  'the main workspace collapsed rail must consume its own 72px contract');
assert.match(shellCss, /\.topbar\s*\{[^}]*min-height:72px!important[^}]*height:auto!important/,
  'the main workspace reserves a readable bounded command band while allowing narrow-window reflow');
assert.match(css, /body\.ws-workspace-active \.topbar\{[^}]*height:56px!important[^}]*min-height:56px!important/,
  'WS preserves its separate compact and stable 56px topbar');
assert.match(shellCss, /\.app-footer\s*\{[^}]*height:30px!important[^}]*min-height:30px/,
  'the S1 footer reserves its 30px flow height');
assert.match(design, /--ds-control-height:44px/,
  'the shared design-system retains accessible 44px controls');
assert.doesNotMatch(layout, /Math\.Max\(820|Math\.Max\(540/, 'responsive layout must not silently upscale small windows');
assert.match(layout, /XAML ActualWidth\/ActualHeight are already device-independent pixels/, 'layout must treat XAML measurements as DIPs');
assert.doesNotMatch(layout, /width\s*\/\s*scale/, 'layout must not apply DPI scaling twice');
assert.doesNotMatch(appCss, /body\{min-width:980px\}/, 'late CSS must not force narrow windows wider than the viewport');
assert.match(legacyCode, /GetOrCreateProfileAsync\("workbench-ui"\)/, 'desktop host must use the isolated workbench profile');
assert.match(legacyXaml, /WebViewHost[^>]*SizeChanged="OnWebViewHostSizeChanged"/, 'WS overlay host must react to native size changes');
assert.match(legacyXaml, /WsOverlayBorder[^>]*BorderThickness="0"/, 'WS overlay must be edge-to-edge without a second frame');
assert.match(legacyCode, /wsResizeTimer/, 'WS overlay resize must be coalesced');
assert.match(legacyCode, /TimeSpan\.FromMilliseconds\(150\)/, 'WS overlay resize debounce must be short and deterministic');
assert.match(legacyCode, /Math\.Clamp\(rawLeft,\s*0d,\s*hostWidth\)[\s\S]*Math\.Clamp\(rawTop,\s*0d,\s*hostHeight\)/, 'WS overlay position must be clipped to the host');
assert.match(legacyCode, /Math\.Clamp\(rawRight,\s*0d,\s*hostWidth\)[\s\S]*Math\.Clamp\(rawBottom,\s*0d,\s*hostHeight\)/, 'WS overlay size must be clipped to the host');
assert.match(legacyCode, /viewportWidth[\s\S]*viewportHeight[\s\S]*SnapToRaster/, 'WS overlay bounds must account for viewport scaling and rasterized DPI');
assert.match(legacyCode, /hostWidth\s*<\s*40\s*\|\|\s*hostHeight\s*<\s*40/, 'WS overlay must ignore transient zero-size measurements');

console.log('desktop responsive contract: DPI, breakpoints and WS adaptive layout are present');
