'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repo = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(repo, relative), 'utf8');
const index = read('resources/app/index.html');
const js = read('resources/app/modules/gpt-assistant.js');
const css = read('resources/app/modules/gpt-modern.css');

assert.match(index, /gpt-modern\.css[\s\S]*scroll-system\.css/, 'GPT presentation must load before the final scroll owner contract');
assert.match(js, /<div class="gpt-page">/, 'GPT route needs one bounded 6.0 page root');
assert.match(js, /gpt-status-strip/, 'service, mode, conversation, attachment and pending-write status must stay visible');
assert.match(js, /function historyPanel\(\)/, 'recent prompts must be derived from the current session instead of demo rows');
assert.match(js, /gpt-error-state[\s\S]*data-gpt-action="retry-render"/, 'bridge failures need a visible recoverable state');
assert.match(js, /const generation=\+\+renderGeneration[\s\S]*generation!==renderGeneration/, 'late AI status responses must not overwrite another route');
assert.match(js, /管理操作始终需要预览和人工确认/, 'the existing controlled-write safety rule must remain visible');
assert.match(js, /fetch\('\/api\/snapshot'/, 'managed writes must still create a snapshot first');
assert.match(js, /'X-State-Version':version/, 'managed writes must still use optimistic concurrency');
assert.match(js, /window\.__zhikeRegistryHost\?\.refreshState\?\.\(\)/, 'successful writes must refresh the shared customer workspace');

assert.match(css, /\.view-container:has\(>\.gpt-page\)\{[^}]*overflow:hidden!important/, 'GPT must disable the outer page scroller');
assert.match(css, /\.gpt-page \.gpt-messages\{[^}]*overflow:auto[^}]*overscroll-behavior:contain/, 'the transcript must own its contained vertical scroll');
assert.match(css, /\.gpt-page \.gpt-modern \.gpt-context\{[\s\S]*?overflow-y:auto[\s\S]*?overscroll-behavior:contain/, 'the context/history rail must scroll independently');
assert.match(css, /@container \(max-width:760px\)/, 'narrow desktop windows need a reflowed workspace');
assert.match(css, /@media \(max-height:620px\)[\s\S]*@container \(max-width:760px\)[\s\S]*max-height:66px/, '820x540 needs a compact but usable context bar');
assert.match(css, /#modal:has\(#gptProvider\)/, 'GPT service settings must use the same 6.0 surface family');
assert.match(css, /@media \(prefers-reduced-motion:reduce\)/, 'reduced-motion users need a stable workspace');

for (const forbidden of ['GPT <em>4.1</em>', '陈先生', '王先生', '李女士', '268,000']) {
  assert.doesNotMatch(js + css, new RegExp(forbidden), `legacy or preview-only value leaked into GPT workspace: ${forbidden}`);
}

console.log('GPT Horizon workspace: real status/history, safe writes, isolated scrolling, error recovery and 820x540 reflow pass');
