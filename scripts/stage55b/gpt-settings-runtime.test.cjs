'use strict';
// Execute the real module/listeners. Synthetic bridge only: no saved real key or AI call.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.resolve(__dirname, '../../resources/app/modules/gpt-assistant.js'), 'utf8');
const listeners = new Map(), calls = [];
const classes = new Set(['hidden']);
const backdrop = { classList: { contains: key => classes.has(key), add: key => classes.add(key), remove: key => classes.delete(key) } };
const controls = {
  '#gptProvider': { value: 'openai' }, '#gptApiKey': { value: 'synthetic-test-key' },
  '#gptModel': { value: 'synthetic-model' }, '#gptDefaultPhone': { checked: false },
  '#gptSettingsStatus': { textContent: '' }, '#gptModelList': { innerHTML: '' },
};
const modal = { innerHTML: '', querySelector: selector => modal.innerHTML.includes('gptSettingsStatus') ? controls[selector] || null : null };
let viewWrites = 0, focusRestored = 0;
const view = { set innerHTML(value) { viewWrites++; }, get innerHTML() { return ''; } };
const document = {
  body: {}, activeElement: { isConnected: true, focus() { focusRestored++; } }, documentElement: { dataset: { view: 'ws-workbench' } },
  querySelector(selector) {
    if (selector === '#gptAssistantNav') return { addEventListener() {} };
    if (selector === '#viewContainer') return view;
    if (selector === '#modal') return modal;
    if (selector === '#modalBackdrop') return backdrop;
    return modal.innerHTML.includes('gptSettingsStatus') ? controls[selector] || null : null;
  },
  querySelectorAll: () => [],
  addEventListener(type, listener) { if (!listeners.has(type)) listeners.set(type, []); listeners.get(type).push(listener); },
};
const sandbox = { document, console, setTimeout, clearTimeout, Promise, Date, Set, confirm: () => false,
  localStorage: { getItem: () => null, setItem() {} },
  MutationObserver: class { observe() {} disconnect() {} },
  fetch: async () => { throw new Error('No network or customer request allowed'); },
  window: { __zhikeRegistryHost: { state: { view: 'ws-workbench' }, toast: value => calls.push(['notice', value]) },
    zhikeAI: {
      status: async () => ({ configured: true, provider: 'openai', keyTail: 'TEST', model: 'synthetic-model' }),
      saveKey: async value => calls.push(['save', value]),
      testConnection: async () => { calls.push(['test']); return { providerName: 'synthetic', model: 'synthetic-model' }; },
      listModels: async () => { calls.push(['models']); return { models: ['synthetic-model'] }; },
      removeKey: async () => calls.push(['remove']),
    },
  },
};
vm.runInNewContext(source, sandbox);
async function click(action, inside = true) {
  const node = { dataset: { gptAction: action }, closest: selector => selector === '#modal' ? (inside ? modal : null) : selector === '[data-gpt-action]' ? node : null };
  for (const listener of listeners.get('click') || []) await listener({ target: node });
  await new Promise(resolve => setImmediate(resolve));
}
(async () => {
  await click('save-key', false); assert.equal(calls.length, 0, 'off-route controls outside owned modal are ignored');
  await click('settings', false); assert.equal(classes.has('hidden'), false); assert.match(modal.innerHTML, /type="password"/);
  await click('send'); assert.equal(viewWrites, 0, 'settings ownership never grants chat/send access off-route');
  await click('models', false); assert.equal(calls.length, 0);
  await click('models'); await click('test'); assert.deepEqual(calls.map(row => row[0]), ['models', 'test']);
  await click('save-key'); assert.equal(calls.at(-1)[0], 'save'); assert.equal(classes.has('hidden'), true);
  assert.equal(controls['#gptApiKey'].value, '', 'close clears temporary key input');
  assert.equal(viewWrites, 0, 'saving settings must not render GPT over the WS page');
  assert.equal(document.documentElement.dataset.view, 'ws-workbench');
  assert.equal(focusRestored, 1);
  await click('settings', false); await click('close'); assert.equal(classes.has('hidden'), true);
  await click('settings', false); controls['#gptApiKey'].value = 'synthetic-escape-input';
  for (const listener of listeners.get('keydown') || []) await listener({ key: 'Escape', target: { id: 'gptApiKey' } });
  assert.equal(classes.has('hidden'), true); assert.equal(controls['#gptApiKey'].value, '');
  await click('settings', false); modal.innerHTML = '<div>Another module owns this modal</div>';
  const prior = calls.length; await click('save-key'); assert.equal(calls.length, prior, 'replaced modal cannot retain GPT settings ownership');
  console.log('stage5.5B GPT settings: real off-route modal actions, owner boundary, password clearing, no WS navigation takeover or paid network PASS');
})().catch(error => { console.error(error); process.exitCode = 1; });
