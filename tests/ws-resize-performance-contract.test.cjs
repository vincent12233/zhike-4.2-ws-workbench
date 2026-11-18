'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repo = path.resolve(__dirname, '..');
const native = fs.readFileSync(path.join(repo, 'desktop/src/Zhike.Desktop/Views/LegacyUiHostPage.xaml.cs'), 'utf8');
const web = fs.readFileSync(path.join(repo, 'resources/app/modules/ws-workbench.js'), 'utf8');
const accessibility = fs.readFileSync(path.join(repo, 'resources/app/modules/accessibility-enhancements.js'), 'utf8');
const businessEnhancements = fs.readFileSync(path.join(repo, 'resources/app/modules/business-enhancements.js'), 'utf8');
const runtimeCustomizer = fs.readFileSync(path.join(repo, 'resources/app/modules/runtime-customizer.js'), 'utf8');
const dataCenter = fs.readFileSync(path.join(repo, 'resources/app/modules/v4-data-center.js'), 'utf8');
const gptAssistant = fs.readFileSync(path.join(repo, 'resources/app/modules/gpt-assistant.js'), 'utf8');
const productivity = fs.readFileSync(path.join(repo, 'resources/app/modules/productivity.js'), 'utf8');
const directViewObservers = [
  'accessibility-enhancements.js',
  'business-enhancements.js',
  'customer-governance-ui.js',
  'operations-upgrade.js',
  'performance-enhancements.js',
  'productivity.js',
].map(name => [name, fs.readFileSync(path.join(repo, 'resources/app/modules', name), 'utf8')]);

// Resizing the embedded WS view is a high-frequency UI path. It must only
// move the native overlay; probing the entire WhatsApp DOM on every resize
// blocks the WebView2/UI thread and makes scrolling feel sticky.
const resizeCase = native.match(/case "resize":([\s\S]*?)case "hide":/);
assert.ok(resizeCase, 'native WS resize bridge case must exist');
assert.doesNotMatch(resizeCase[1], /WsStatusResponseAsync/, 'resize must not run a WS login probe');
assert.match(resizeCase[1], /BridgeResponse\.Success/, 'resize must acknowledge without a status probe');

// ResizeObserver callbacks can arrive in bursts while the layout settles.
// The web side must coalesce them and avoid concurrent bridge calls.
assert.match(web, /resizeInFlight/, 'WS resize path must track an in-flight bridge call');
assert.match(web, /resizePending/, 'WS resize path must coalesce pending bounds');
assert.match(native, /_wsOverlayGeometryApplied/, 'native WS overlay must retain a stable geometry sample');
assert.match(native, /Math\.Abs\(width - _lastWsOverlayWidth\) < 2d/, 'native WS overlay must ignore sub-2px layout jitter');
const hiddenBoundsGuard = native.match(/if \(GetBool\(bounds, "hidden"\)\)([\s\S]*?)var viewportWidth/);
assert.ok(hiddenBoundsGuard, 'native WS bounds must explicitly handle transient hidden geometry');
assert.match(hiddenBoundsGuard[1], /_wsOverlayGeometryApplied[\s\S]*?IsWsChatPresentationActive[\s\S]*?return;/, 'a stable live chat rectangle survives transient hidden geometry');
assert.match(native, /pendingTimer = setTimeout/, 'parent bounds observer must wait for a stable geometry sample');

// Accessibility repair must not rescan the entire document for every WS
// overlay mutation. The view root is the only page surface that needs a full
// scan; navigation and modal state have their own targeted observers below.
assert.doesNotMatch(accessibility, /observe\(document\.body\s*,\s*\{\s*childList:\s*true/,
  'accessibility observer must not watch document.body child-list mutations');
assert.match(accessibility, /querySelector\('\#viewContainer'\)/,
  'accessibility observer must target the view container');
assert.match(businessEnhancements, /requestAnimationFrame\(run\)/,
  'business enhancement observer must coalesce DOM mutations to a frame');
assert.match(businessEnhancements, /currentView.*tickets.*deposits.*quality/s,
  'business enhancement observer must skip unrelated routes');
assert.doesNotMatch(runtimeCustomizer, /observe\(document\.body\s*,\s*\{[^}]*subtree:\s*true/,
  'runtime customization must not rescan the full WS subtree');
assert.match(runtimeCustomizer, /observe\(viewRoot,\{childList:true\}\)/,
  'runtime customization watches only direct route replacements');
assert.doesNotMatch(dataCenter, /observe\(document\.body\s*,\s*\{[^}]*subtree:\s*true/,
  'data-center enhancements must not run for every WS message mutation');
assert.match(dataCenter, /observe\(view,\{childList:true\}\)/,
  'data-center enhancements watch only the surfaces they own');
for (const [name, source] of directViewObservers)
  assert.doesNotMatch(source, /observe\([^)]*,\s*\{[^}]*subtree:\s*true/,
    `${name} must not rescan nested WS/table mutations`);
assert.doesNotMatch(gptAssistant, /observe\(document\.body,\{[^}]*subtree:\s*true/,
  'GPT customer shortcut must never observe the full document subtree');
assert.match(gptAssistant, /customerDrawerObserver\.observe\(drawer,\{childList:true\}\)/,
  'GPT customer shortcut must bind to its owned drawer after lazy creation');
assert.match(gptAssistant, /drawerBootstrapObserver\.disconnect\(\)/,
  'the direct-body drawer bootstrap observer must detach after first use');
assert.match(productivity, /if\(desktop\|\|document\.hidden\)return/,
  'browser reminder fallback must stop polling while hidden');

console.log('ws resize performance contract: native resize is probe-free and web resize calls are coalesced');
