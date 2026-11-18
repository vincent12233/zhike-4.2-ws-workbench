'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.resolve(__dirname, '../../resources/app/modules/ai-review-center-ui.js'), 'utf8');
async function run() {
  const calls = []; const handlers = {}; const panel = { innerHTML: '', id: '', className: '' };
  let accountId = 'account-b', currentPanel = null;
  const target = { dataset: {}, appendChild(value) { currentPanel = value; }, addEventListener(name, handler) { handlers[name] = handler; }, removeEventListener() {} };
  Object.defineProperty(target.dataset, 'wsAccountId', { get() { return accountId; } });
  const root = { document: { body: {}, querySelector(selector) { return selector === '#stage4AiReviewCenter' ? currentPanel : target; }, createElement() { return panel; } }, AbortController, setTimeout, clearTimeout, addEventListener() {}, __stage4AiLease: { scopeKey: 'isolated', ownerId: 'test' }, __zhikeRegistryHost: { getStateVersion: () => '1' }, fetch: async (url, init = {}) => { calls.push({ url, init }); return { ok: true, json: async () => url.includes('suggestions') ? { suggestions: [{ id: 's-1', fieldName: 'occupation', candidateValue: '工程师', customerId: 'C-1', sourceEvidence: 'explicit', verificationStatus: 'pending' }] } : { jobs: [], productionFrozen: true } }; } };
  const context = { ...root, MutationObserver: class { constructor(callback) { this.callback = callback; } observe() {} }, URLSearchParams };
  vm.runInNewContext(source, context); await new Promise(resolve => setTimeout(resolve, 0));
  assert.ok(calls.every(item => item.url.includes('accountId=account-b')), 'every read must carry the selected account');
  const before = calls.length; context.ZhikeAiReviewCenter.mount(); await new Promise(resolve => setTimeout(resolve, 0)); assert.equal(calls.length, before, 'same-host mount cannot start another refresh');
  handlers.change({ target: { dataset: { stage4Filter: 'query' }, value: 'no-such-record' } }); assert.doesNotMatch(panel.innerHTML, /data-suggestion-id="s-1"/);
  handlers.change({ target: { dataset: { stage4Filter: 'query' }, value: '工程师' } }); assert.match(panel.innerHTML, /data-suggestion-id="s-1"/);
  handlers.change({ target: { dataset: { stage4Filter: 'status' }, value: 'applied' } }); assert.doesNotMatch(panel.innerHTML, /data-suggestion-id="s-1"/);
  handlers.change({ target: { dataset: { stage4Filter: 'status' }, value: '' } });
  assert.match(panel.innerHTML, /data-stage4-action="approve"[^>]*>/); assert.doesNotMatch(panel.innerHTML, /data-stage4-action="approve"[^>]*disabled/, 'isolated lease enables pending review only');
  await handlers.click({ target: { closest() { return { dataset: { stage4Action: 'approve', suggestionId: 's-1' }, disabled: false }; } } });
  const mutation = calls.find(item => item.init.method === 'POST'); assert.equal(JSON.parse(mutation.init.body).accountId, 'account-b');
  await handlers.click({ target: { closest() { return { dataset: { stage4Action: 'cancel-job', jobId: 'job-1' }, disabled: false }; } } });
  const cancel = calls.find(item => item.init.method === 'POST' && JSON.parse(item.init.body).action === 'cancel'); assert.equal(JSON.parse(cancel.init.body).jobId, 'job-1'); assert.equal(JSON.parse(cancel.init.body).accountId, 'account-b');
  accountId = 'account-c'; await context.ZhikeAiReviewCenter.refresh(); assert.ok(calls.at(-1).url.includes('accountId=account-c'));
  console.log('stage5 review runtime: account scope, stable mount, isolated review actions and account switch PASS');
}
run().catch(error => { console.error(error); process.exitCode = 1; });
