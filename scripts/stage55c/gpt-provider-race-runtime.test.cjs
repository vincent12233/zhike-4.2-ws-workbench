'use strict';
// Execute the shipped GPT module and its actual event listeners with a synthetic
// in-memory bridge. Never read saved credentials or perform network requests.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.resolve(__dirname, '../../resources/app/modules/gpt-assistant.js'), 'utf8');
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const tick = () => new Promise(resolve => setImmediate(resolve));
function fixture() {
  const listeners = new Map(), calls = [], notices = [], classes = new Set(['hidden']);
  const controls = {
    '#gptProvider': { id: 'gptProvider', value: 'openai', disabled: false },
    '#gptApiKey': { id: 'gptApiKey', value: '', disabled: false },
    '#gptModel': { id: 'gptModel', value: 'gpt-a', disabled: false },
    '#gptDefaultPhone': { checked: false, disabled: false },
    '#gptSettingsStatus': { textContent: '' }, '#gptKeyState': { textContent: '' }, '#gptModelList': { innerHTML: '' },
  };
  const backdrop = { classList: { contains: value => classes.has(value), add: value => classes.add(value), remove: value => classes.delete(value) } };
  const modal = { innerHTML: '', querySelector: selector => modal.innerHTML.includes('gptSettingsStatus') ? controls[selector] || null : null,
    querySelectorAll: () => Object.values(controls).filter(value => 'disabled' in value) };
  for (const control of Object.values(controls)) { control.closest = selector => selector === '#modal' ? modal : null; control.matches = () => false; }
  const document = { body: {}, activeElement: { isConnected: true, focus() {} }, documentElement: { dataset: { view: 'ws-workbench' } },
    querySelector(selector) {
      if (selector === '#gptAssistantNav') return { addEventListener() {} };
      if (selector === '#viewContainer') return { innerHTML: '' };
      if (selector === '#modal') return modal;
      if (selector === '#modalBackdrop') return backdrop;
      return modal.querySelector(selector);
    }, querySelectorAll: () => [], addEventListener(type, listener) { const list = listeners.get(type) || []; list.push(listener); listeners.set(type, list); } };
  const status = provider => ({ configured: true, provider: provider || 'openai', keyTail: 'SAFE', model: provider === 'teamorouter' ? 'gpt-b' : 'gpt-a' });
  const bridge = { status: async input => status(input?.provider), saveKey: async input => { calls.push(['save', input.provider]); }, removeKey: async input => { calls.push(['remove', input.provider]); },
    listModels: async () => ({ models: [] }), testConnection: async () => ({ providerName: 'synthetic', model: 'gpt-test' }) };
  const sandbox = { document, setTimeout, clearTimeout, Promise, Date, Set, Map, console: { warn() {} }, confirm: () => true,
    localStorage: { getItem: () => null, setItem() {} }, MutationObserver: class { observe() {} disconnect() {} },
    fetch: async () => { throw new Error('Network forbidden'); }, window: { zhikeAI: bridge, __zhikeRegistryHost: { state: { view: 'ws-workbench' }, toast: value => notices.push(value) } } };
  vm.runInNewContext(source, sandbox);
  const start = (type, target) => Promise.all((listeners.get(type) || []).map(listener => listener({ target, key: 'Escape' })));
  function click(action) { const node = { dataset: { gptAction: action }, closest: selector => selector === '#modal' ? modal : selector === '[data-gpt-action]' ? node : null }; return start('click', node); }
  async function open() { await click('settings'); await tick(); }
  function change(provider) { controls['#gptProvider'].value = provider; return start('change', controls['#gptProvider']); }
  return { controls, modal, classes, bridge, status, calls, notices, open, click, change };
}
const tests = [
  ['APINebula selection tests, lists and saves the chosen custom model', async () => {
    const f = fixture(); await f.open();
    assert.match(f.modal.innerHTML, /<option\b[^>]*value="apinebula"[^>]*>[^<]*APINebula/i);
    f.controls['#gptApiKey'].value = 'previous-provider-transient-input';
    f.bridge.status = async ({ provider }) => ({ ...f.status(provider), model: 'gpt-6-astra' });
    await f.change('apinebula');
    assert.equal(f.controls['#gptApiKey'].value, '');
    assert.equal(f.controls['#gptModel'].value, 'gpt-6-astra');
    const calls = [];
    f.bridge.listModels = async ({ provider, model }) => { calls.push(['models', provider, model]); return { models: ['gpt-6-astra', 'nebula-custom-alias'] }; };
    f.bridge.testConnection = async ({ provider, model }) => { calls.push(['test', provider, model]); return { providerName: 'APINebula', model }; };
    f.bridge.saveKey = async ({ provider, model, apiKey }) => { calls.push(['save', provider, model]); assert.equal(apiKey, 'nebula-fixture-key'); };
    await f.click('models');
    assert.match(f.controls['#gptModelList'].innerHTML, /nebula-custom-alias/);
    f.controls['#gptApiKey'].value = 'nebula-fixture-key';
    f.controls['#gptModel'].value = 'nebula-custom-alias';
    await f.click('test');
    await f.click('save-key');
    assert.deepEqual(calls, [['models', 'apinebula', 'gpt-6-astra'], ['test', 'apinebula', 'nebula-custom-alias'], ['save', 'apinebula', 'nebula-custom-alias']]);
    assert.equal(f.controls['#gptApiKey'].value, '');
    assert.equal(f.classes.has('hidden'), true, 'a successful save closes the modal');
  }],
  ['provider change immediately clears temporary secret', async () => {
    const f = fixture(); await f.open(); f.controls['#gptApiKey'].value = 'synthetic-transient-input';
    const gate = deferred(); f.bridge.status = () => gate.promise; const pending = f.change('teamorouter');
    assert.equal(f.controls['#gptApiKey'].value, '', 'temporary input must be cleared before an asynchronous status request');
    gate.resolve(f.status('teamorouter')); await pending;
  }],
  ['late provider status cannot replace current provider model', async () => {
    const f = fixture(); await f.open(); const old = deferred(), latest = deferred();
    f.bridge.status = input => input.provider === 'teamorouter' ? old.promise : latest.promise;
    const first = f.change('teamorouter'), second = f.change('openai');
    latest.resolve(f.status('openai')); await second; old.resolve(f.status('teamorouter')); await first;
    assert.equal(f.controls['#gptModel'].value, 'gpt-a', 'late response cannot alter current selection');
  }],
  ['late status error cannot notify or overwrite reopened settings', async () => {
    const f = fixture(); await f.open(); const gate = deferred(); f.bridge.status = () => gate.promise;
    const pending = f.change('teamorouter'); await f.click('close'); f.bridge.status = async () => f.status('openai'); await f.open();
    const before = f.controls['#gptSettingsStatus'].textContent, notices = f.notices.length;
    gate.reject(new Error('synthetic old provider failure')); await pending;
    assert.equal(f.controls['#gptSettingsStatus'].textContent, before);
    assert.equal(f.notices.length, notices, 'old modal failure cannot surface after closing');
  }],
  ['save is single flight and closing does not allow stale completion to close a new modal', async () => {
    const f = fixture(); await f.open(); const gate = deferred(); f.bridge.saveKey = async input => { f.calls.push(['save', input.provider]); return gate.promise; };
    const first = f.click('save-key'), duplicate = f.click('save-key'); await tick();
    assert.equal(f.calls.length, 1, 'duplicate save cannot dispatch another mutation');
    await f.click('close'); await f.open(); assert.equal(f.classes.has('hidden'), true, 'in-flight mutation must prevent reopening an intermediate config');
    gate.resolve({}); await first; await duplicate; await f.open(); assert.equal(f.classes.has('hidden'), false);
  }],
  ['late initial open cannot replace a newer settings session', async () => {
    const f = fixture(), old = deferred(), latest = deferred(); let n = 0; f.bridge.status = () => ++n === 1 ? old.promise : latest.promise;
    const first = f.click('settings'), second = f.click('settings');
    latest.resolve(f.status('openai')); await second; await tick(); old.resolve(f.status('teamorouter')); await first; await tick();
    assert.ok(f.modal.innerHTML.includes('value="openai" selected'), 'latest open owns the rendered settings modal');
  }],
  ['provider loading blocks save and rejects a mismatched response', async () => {
    const f = fixture(); await f.open(); const gate = deferred(); f.bridge.status = () => gate.promise;
    const loading = f.change('teamorouter'); await f.click('save-key'); assert.equal(f.calls.length, 0);
    gate.resolve(f.status('openai')); await loading; await f.click('save-key');
    assert.equal(f.calls.length, 0, 'a different provider response cannot authorize saving');
    assert.ok(f.controls['#gptSettingsStatus'].textContent.includes('不符'));
  }],
  ['late model results cannot populate another provider catalog', async () => {
    const f = fixture(); await f.open(); const old = deferred(); f.bridge.listModels = () => old.promise;
    const models = f.click('models'); await f.change('teamorouter');
    old.resolve({ models: ['gpt-old-provider'] }); await models;
    assert.equal(f.controls['#gptModelList'].innerHTML, '');
    assert.equal(f.controls['#gptModel'].value, 'gpt-b');
  }],
  ['delete is single flight and its late error cannot affect a closed session', async () => {
    const f = fixture(); await f.open(); const gate = deferred(); f.bridge.removeKey = async input => { f.calls.push(['remove', input.provider]); return gate.promise; };
    const pending = f.click('remove-key'); await f.click('save-key'); await f.click('remove-key');
    await f.change('teamorouter'); assert.equal(f.controls['#gptProvider'].value, 'openai', 'a dispatched mutation retains its exact provider');
    assert.equal(f.calls.length, 1); await f.click('close'); const notices = f.notices.length;
    gate.reject(new Error('synthetic mutation failure')); await pending;
    assert.equal(f.notices.length, notices); await f.open(); assert.equal(f.classes.has('hidden'), false);
  }],
  ['storage read failure remains explicit and cannot authorize overwrite', async () => {
    const f = fixture(); f.bridge.status = async () => { throw new Error('API Key 配置损坏 [AI_CREDENTIAL_CORRUPT]'); };
    await f.open(); await f.click('save-key'); await f.click('remove-key');
    assert.equal(f.calls.length, 0);
    assert.ok(f.controls['#gptSettingsStatus'].textContent.includes('AI_CREDENTIAL_CORRUPT'));
    assert.equal(f.controls['#gptApiKey'].disabled, true);
  }],
  ['initial settings response cannot replace another module modal', async () => {
    const f = fixture(), gate = deferred(); f.bridge.status = () => gate.promise;
    const opening = f.click('settings'); f.modal.innerHTML = '<section>Different modal owner</section>';
    gate.resolve(f.status('openai')); await opening;
    assert.equal(f.modal.innerHTML, '<section>Different modal owner</section>');
    assert.equal(f.classes.has('hidden'), true);
  }],
  ['current save failure keeps modal open and clears temporary input', async () => {
    const f = fixture(); await f.open(); f.controls['#gptApiKey'].value = 'synthetic-transient-input';
    f.bridge.saveKey = async () => { throw new Error('API Key 存储失败 [AI_CREDENTIAL_IO]'); };
    await f.click('save-key'); assert.equal(f.classes.has('hidden'), false);
    assert.equal(f.controls['#gptApiKey'].value, '');
    assert.ok(f.controls['#gptSettingsStatus'].textContent.includes('AI_CREDENTIAL_IO'));
    assert.equal(f.controls['#gptApiKey'].disabled, false);
  }],
];
(async () => {
  let failed = 0;
  for (const [name, run] of tests) { try { await run(); console.log('PASS ' + name); } catch { failed++; console.log('FAIL ' + name); } }
  console.log('GPT provider isolated race runtime: ' + (tests.length - failed) + '/' + tests.length + '; network calls=0');
  if (failed) process.exitCode = 1;
})();
