const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const ui = fs.readFileSync(path.join(root, 'resources', 'app', 'modules', 'ws-workbench.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'resources', 'app', 'modules', 'ws-workbench.css'), 'utf8');
const app = fs.readFileSync(path.join(root, 'resources', 'app', 'app.js'), 'utf8');

assert.match(ui, /renderHotProfile/, 'WS UI should render the hot-chat profile panel');
assert.match(ui, /hotProfile/, 'WS state should retain a hot-chat profile snapshot');
for (const field of ['preferred_name', 'age', 'gender', 'occupation', 'work_context', 'is_investor', 'investment_years', 'holdings', 'investment_habits', 'investment_preferences', 'family_context', 'life_interests', 'future_plans']) {
  assert.match(ui, new RegExp(field), `hot-chat profile field ${field} should be visible in the UI contract`);
}
for (const action of ['refresh-hot-profile', 'confirm-hot-profile', 'lock-hot-profile', 'save-hot-profile-color']) {
  assert.match(ui, new RegExp(action), `hot-chat profile action ${action} should be wired`);
}
for (const selector of ['ws-hot-profile-card', 'ws-hot-profile-field', 'ws-hot-profile-missing', 'ws-hot-profile-status']) {
  assert.match(css, new RegExp(`\\.${selector}`), `CSS should define ${selector}`);
}
assert.match(ui, /profile\/diagnostics/, 'UI should load profile diagnostics from the local API');
assert.match(ui, /renderDataArchiveSummary/, 'WS profile tab should render the unified data archive card');
assert.match(ui, /data-archive\/customer/, 'WS profile tab should load the account-scoped archive projection');
assert.match(ui, /统一数据档案/, 'WS profile tab should label the unified archive view');
assert.match(css, /\.ws-data-archive-card/, 'CSS should define the unified archive card');
// Full-history analysis is chunked to keep the renderer responsive. Each
// chunk and the final synthesis must still use the natural-chat profile
// prompt; older builds passed a single `transcript.text` value here.
assert.match(ui, /buildNaturalChatAnalysisPrompt\((?:transcript|chunk|synthesis)\.text/, 'WS analysis must use the natural-chat profile prompt for local AI');
for (const field of ['conversationProgress', 'customerTemperature', 'profileSummary', 'nextTopics', 'noReply', 'tags']) {
  assert.match(ui, new RegExp(field), `hot-chat progress metadata ${field} should be rendered and restored`);
}
assert.match(ui, /pending|declined|missing/, 'UI should distinguish pending, declined and missing profile facts');
assert.match(ui, /aria-readonly="true" readonly/, 'locked profile facts must be read-only in the UI');
assert.doesNotMatch(ui, /data-hot-profile-color[^>]*onchange|matches\('\[data-hot-profile-color\]'\).*saveHotProfileColor/, 'changing the color selector alone must not write twice');
assert.match(app, /renderCustomerHotProfileSummary/, 'customer 360 drawer should expose the hot-chat profile summary');
assert.match(app, /customer\.investor===true\?'是':customer\.investor===false\?'否':''/, 'missing investor status must remain unknown instead of defaulting to no');
assert.match(app, /__zhikeRegistryHost\.showCustomer=showCustomer/, 'host must expose the wrapped customer drawer renderer');
console.log('ws-hot-chat-profile-ui: source wiring contract passed; live UI behavior requires separate native acceptance');
