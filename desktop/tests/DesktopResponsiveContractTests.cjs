'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repo = path.resolve(__dirname, '..', '..');
const css = fs.readFileSync(path.join(repo, 'resources/app/modules/ws-workbench.css'), 'utf8');
const design = fs.readFileSync(path.join(repo, 'resources/app/modules/design-system.css'), 'utf8');
const hostCss = fs.readFileSync(path.join(repo, 'resources/app/modules/scroll-system.css'), 'utf8');
const layout = fs.readFileSync(path.join(repo, 'desktop/src/Zhike.Desktop/Services/WindowLayoutService.cs'), 'utf8');
const wsCode = fs.readFileSync(path.join(repo, 'desktop/src/Zhike.Desktop/Views/WsWorkbenchPage.xaml.cs'), 'utf8');
const legacyXaml = fs.readFileSync(path.join(repo, 'desktop/src/Zhike.Desktop/Views/LegacyUiHostPage.xaml'), 'utf8');
const legacyCode = fs.readFileSync(path.join(repo, 'desktop/src/Zhike.Desktop/Views/LegacyUiHostPage.xaml.cs'), 'utf8');
const appCss = fs.readFileSync(path.join(repo, 'resources/app/styles.css'), 'utf8');

assert.match(css, /--ws-left-min|ws-layout-vars/, 'WS layout must expose shared responsive variables');
assert.match(css, /@media \(max-width:900px\)/, 'WS must provide the tablet tab layout');
assert.match(css, /@media \(max-width:650px\)/, 'WS must provide the compact single-column layout');
assert.match(layout, /CalculateLayout\(/, 'WindowLayoutService must calculate pane layout');
assert.match(layout, /DpiScale|scale/, 'layout calculation must account for DPI');
assert.match(wsCode, /ApplyResponsiveLayout|CalculateLayout/, 'WS page must consume the shared layout calculation');
assert.doesNotMatch(wsCode, /GridLength\(_leftCollapsed \? 0 : 220\)/, 'WS page must not hard-code the old left width');
assert.doesNotMatch(wsCode, /GridLength\(_rightCollapsed \? 0 : 300\)/, 'WS page must not hard-code the old right width');
assert.match(hostCss, /html\[data-desktop-host\] \.main-area\{[^}]*overflow:hidden/, 'desktop host must keep one page scroll container in the consolidated scroll layer');
assert.match(design, /\.view-container\{[^}]*scrollbar-gutter:stable/, 'main content scroll area must reserve a stable scrollbar gutter');
assert.match(design, /\.table-scroll,\.table-wrap,\.task-table-wrap,\.registry-table-wrap\{[^}]*overflow:auto/, 'wide tables must scroll inside their own container');
assert.match(design, /\.sidebar\{[^}]*width:224px[^}]*flex-basis:224px/, 'expanded navigation width must be stable');
assert.match(design, /\.topbar\{[^}]*height:52px[^}]*min-height:52px/, 'topbar height must be stable');
assert.match(design, /\.app-footer\{[^}]*height:28px/, 'footer height must be stable');
assert.doesNotMatch(layout, /Math\.Max\(820|Math\.Max\(540/, 'responsive layout must not silently upscale small windows');
assert.match(layout, /XAML ActualWidth\/ActualHeight are already device-independent pixels/, 'layout must treat XAML measurements as DIPs');
assert.doesNotMatch(layout, /width\s*\/\s*scale/, 'layout must not apply DPI scaling twice');
assert.doesNotMatch(appCss, /body\{min-width:980px\}/, 'late CSS must not force narrow windows wider than the viewport');
assert.match(wsCode, /state\.UseMobileTabs/, 'WS page must expose all three panes through compact tabs');
assert.match(wsCode, /new\("ws-workbench"\)/, 'WS pane state must not overwrite main window geometry');
assert.match(legacyXaml, /WebViewHost[^>]*SizeChanged="OnWebViewHostSizeChanged"/, 'WS overlay host must react to native size changes');
assert.match(legacyXaml, /WsOverlayBorder[^>]*BorderThickness="0"/, 'WS overlay must be edge-to-edge without a second frame');
assert.match(legacyCode, /wsResizeTimer/, 'WS overlay resize must be coalesced');
assert.match(legacyCode, /TimeSpan\.FromMilliseconds\(150\)/, 'WS overlay resize debounce must be short and deterministic');
assert.match(legacyCode, /Math\.Clamp\(rawLeft,\s*0d,\s*hostWidth\)[\s\S]*Math\.Clamp\(rawTop,\s*0d,\s*hostHeight\)/, 'WS overlay position must be clipped to the host');
assert.match(legacyCode, /Math\.Clamp\(rawRight,\s*0d,\s*hostWidth\)[\s\S]*Math\.Clamp\(rawBottom,\s*0d,\s*hostHeight\)/, 'WS overlay size must be clipped to the host');
assert.match(legacyCode, /viewportWidth[\s\S]*viewportHeight[\s\S]*SnapToRaster/, 'WS overlay bounds must account for viewport scaling and rasterized DPI');
assert.match(wsCode, /ActualWidth\s*<=\s*0|NewSize\.Width\s*<=\s*0/, 'WS layout must ignore transient zero-size measurements');

console.log('desktop responsive contract: DPI, breakpoints and WS adaptive layout are present');
