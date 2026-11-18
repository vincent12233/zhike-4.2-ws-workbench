'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repo = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(repo, relative), 'utf8');
const app = read('resources/app/app.js');
const index = read('resources/app/index.html');
const gpt = read('resources/app/modules/gpt-assistant.js');
const ws = read('resources/app/modules/ws-workbench.js');
const wsCss = read('resources/app/modules/ws-workbench.css');
const homeCss = read('resources/app/modules/home-6.css');
const scrollCss = read('resources/app/modules/scroll-system.css');
const appCss = read('resources/app/styles.css');

// Navigation must have one owner. The main registry route is the only place
// that changes view state; GPT exposes its renderer for that route instead of
// racing a second click listener after the home page has already rendered.
assert.match(index, /<button[^>]*data-view="gpt"[^>]*id="gptAssistantNav"/,
  'GPT navigation must declare the canonical gpt route');
assert.match(app, /case['"]gpt['"]\s*:\s*window\.ZhikeGPT\?\.render\?\.\(\)\s*;\s*break/,
  'the main renderer must own the GPT route');
assert.match(gpt, /window\.ZhikeGPT\s*=\s*Object\.freeze/,
  'GPT must expose its renderer through an explicit route adapter');
assert.match(gpt, /cancel:cancelActiveRequest/,
  'leaving GPT must expose an explicit request cancellation boundary');
assert.match(app, /state\.view==='gpt'&&view!=='gpt'\)void window\.ZhikeGPT\?\.cancel\?\.\(\)/,
  'the main router must cancel an active GPT request before leaving the route');
assert.doesNotMatch(gpt, /nav\.addEventListener\(['"]click['"]/
  , 'GPT must not install a second navigation owner');

// Home AI followups must not remove and recreate the panel on every refresh.
// The request is cancellable, single-flight, and event driven refreshes are
// debounced so WS background ticks cannot cause layout churn.
assert.match(app, /homeWsAlertController\s*=\s*null/,
  'home followup loader needs an abort controller');
assert.match(app, /homeWsAlertFlight\s*=\s*null/,
  'home followup loader needs a single-flight guard');
assert.match(app, /homeWsAlertTimer\s*=\s*null/,
  'home followup refreshes need a debounce timer');
assert.match(app, /function scheduleHomeWsFollowups\(/,
  'home followup events must go through one debounced scheduler');
assert.doesNotMatch(app, /homeWsAlertRequest;[\s\S]{0,500}#homeWsFollowups'\)\?\.remove\(\)/,
  'refreshing home followups must retain the mounted panel');
assert.match(app, /homeWsAlertController\??\.abort\??\.\(\)/,
  'a superseded home followup request must be cancelled');

// Group membership projection is part of the shared state contract, but it
// must not be rebuilt twice for every persist/clone operation. A dirty bit
// invalidates it only at mutation or shared-state boundaries.
assert.match(app, /let groupLedgerDirty\s*=\s*true/,
  'group membership projection needs an explicit invalidation flag');
assert.match(app, /!force&&!groupLedgerDirty&&Array\.isArray\(state\.settings\.groupMembershipEvents\)/,
  'group membership projection must skip redundant rebuilds');
assert.match(app, /groupLedgerDirty=true;const data=cloneStateData\(statePayload\(\)\)/,
  'persist must invalidate the projection before serializing state');

// Only the data-sync coordinator owns focus/visibility recovery. Two separate
// visibility listeners caused duplicate version checks when the window became
// visible again.
assert.equal((app.match(/document\.addEventListener\(['"]visibilitychange['"]/g) || []).length, 1,
  'data sync must have one visibility listener');
assert.equal((app.match(/window\.addEventListener\(['"]focus['"]/g) || []).length, 1,
  'data sync must have one focus listener');

// GPT preview and drag/drop work should be bounded to the GPT route and
// de-duplicated between message renders.
assert.match(gpt, /privacyPreviewTimer\s*=\s*null/,
  'GPT privacy preview needs a debounce timer');
assert.match(gpt, /privacyPreviewCache\s*=\s*null/,
  'GPT privacy preview needs a short-lived cache');
assert.match(gpt, /function isGptActive\(/,
  'GPT document handlers must have a route guard');
assert.match(gpt, /generation!==requestGeneration\|\|requestId!==currentRequestId\|\|!isGptActive\(\)/,
  'a cancelled or stale GPT response must not write into a new route/session');
assert.match(gpt, /catch\(e\)\{if\(generation===requestGeneration&&isGptActive\(\)\)/,
  'a cancelled GPT request must not append a false failure message after route change');
assert.match(gpt, /gptDropzone[\s\S]{0,220}Enter[\s\S]{0,220}click\(\)/,
  'the file dropzone must be keyboard operable');
assert.match(gpt, /id="gptMessages"[^>]*aria-live="polite"/,
  'GPT messages must expose a live status region');
assert.match(gpt, /id="gptPrivacyPreview"[^>]*role="status"/,
  'GPT privacy preview must expose status semantics');

// The right drawer width must drive the actual grid track, and pointer
// listeners must exist only while a drawer drag is active.
assert.match(ws, /function assistDrawerColumnWidth\(/,
  'assistant drawer needs a layout-aware effective width');
assert.match(ws, /--ws-assist-column-width:/,
  'effective drawer width must be passed to the layout grid');
assert.match(ws, /function bindAssistPointerListeners\(/,
  'drawer pointer listeners must be bound only during a drag');
assert.match(ws, /function unbindAssistPointerListeners\(/,
  'drawer pointer listeners must be cleaned up after a drag');
assert.match(ws, /let bootRetryTimer\s*=\s*null/,
  'WS host bootstrap needs a cancellable retry timer');
assert.match(ws, /if \(bootRetryTimer == null\) bootRetryTimer = setTimeout\(/,
  'WS host bootstrap must not create an unbounded retry timer chain');
assert.match(ws, /if \(bootRetryTimer != null\) \{ clearTimeout\(bootRetryTimer\)/,
  'WS host bootstrap retry timer must be released on unload');
assert.doesNotMatch(ws, /function boot\([\s\S]*?document\.addEventListener\(['"]pointermove['"]\s*,/,
  'WS must not keep a global pointermove listener for the whole app lifetime');
assert.match(wsCss, /--ws-assist-column-width/,
  'WS CSS must consume the effective drawer column width');
assert.match(ws, /后台 AI 队列回写失败/,
  'AI queue state-write failures must be visible and recoverable');
assert.match(ws, /后台 AI 队列完成状态未保存/,
  'AI queue completion failures must be visible and recoverable');

// S1 removed the fixed-footer compensation patch. The final scroll layer
// places footer chrome in the main column's flex flow, so the page's shrinkable
// scroll owner ends above it instead of relying on a historical padding value.
assert.match(homeCss, /html\[data-palette\]\[data-view="home"\]\s*\{\s*#viewContainer\s*\{[^}]*display:flex[^}]*flex-direction:column/,
  'home retains its palette-aware, shrinkable business content layout');
assert.match(appCss, /\.main-area\{[^}]*display:flex[^}]*flex-direction:column/,
  'the page and footer must share the main flex column');
assert.match(scrollCss, /\.topbar,\.app-footer\{[^}]*flex:0 0 auto[^}]*position:relative!important/,
  'the final scroll layer must keep footer chrome in flow instead of covering dashboard rows');
assert.match(scrollCss, /\.view-container\s*\{[^}]*flex:1 1 auto[^}]*min-height:0!important[^}]*overflow-y:auto!important/,
  'home rows remain reachable in the remaining page scroll region above the in-flow footer');
assert.equal([...index.matchAll(/<link\s+rel="stylesheet"\s+href="\.\/([^"]+)"/g)].at(-1)?.[1], 'modules/scroll-system.css',
  'footer flow and scroll ownership cannot be overridden by a later stylesheet');

console.log('project-stability-contract: routing, request lifecycles, WS layout and accessibility contracts are present');
