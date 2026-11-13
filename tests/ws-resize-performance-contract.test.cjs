'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repo = path.resolve(__dirname, '..');
const native = fs.readFileSync(path.join(repo, 'desktop/src/Zhike.Desktop/Views/LegacyUiHostPage.xaml.cs'), 'utf8');
const web = fs.readFileSync(path.join(repo, 'resources/app/modules/ws-workbench.js'), 'utf8');
const accessibility = fs.readFileSync(path.join(repo, 'resources/app/modules/accessibility-enhancements.js'), 'utf8');
const businessEnhancements = fs.readFileSync(path.join(repo, 'resources/app/modules/business-enhancements.js'), 'utf8');

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

console.log('ws resize performance contract: native resize is probe-free and web resize calls are coalesced');
