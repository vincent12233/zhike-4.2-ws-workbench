const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const app = path.join(__dirname, '..', 'resources', 'app');
const main = fs.readFileSync(path.join(app, 'main.cjs'), 'utf8');
const preload = fs.readFileSync(path.join(app, 'preload.cjs'), 'utf8');
const wsPreload = fs.readFileSync(path.join(app, 'ws-preload.cjs'), 'utf8');
const server = fs.readFileSync(path.join(app, 'server.mjs'), 'utf8');
assert.match(main, /BrowserView/);
assert.match(main, /web\.whatsapp\.com/);
assert.match(main, /partition/);
assert.match(main, /wsAllowedUrl/);
assert.match(main, /\/api\/ws\/export/);
assert.match(main, /\bws\b/);
assert.match(main, /clearStorageData/);
assert.match(main, /clearCache/);
assert.match(main, /serviceWorkers\?\.stopAllRunning/);
assert.match(main, /setPermissionRequestHandler/);
assert.match(main, /setPermissionCheckHandler/);
assert.match(main, /capture-selection/);
assert.match(main, /action === 'hide'/);
assert.match(main, /input\.hidden === true/);
assert.match(main, /width: 0, height: 0/);
assert.match(main, /probeWsStatus/);
assert.match(main, /slice\(0,12000\)/);
assert.match(main, /truncated:source\.length>text\.length/);
assert.match(main, /\[已隐藏密钥\]/);
assert.match(preload, /ws/);
assert.match(server, /ws_messages/);
assert.doesNotMatch(preload, /session\.cookies/);
assert.doesNotMatch(main, /session\.cookies/);
assert.doesNotMatch(wsPreload, /session\.cookies|document\.body|innerHTML/);
assert.match(wsPreload, /captureVisibleMessages/);
assert.match(wsPreload, /innerText|textContent/, 'WS collection reads message text only from selected visible message nodes');

const exposed = {};
const markers = new Set(['#pane-side']);
vm.runInNewContext(wsPreload, {
  require: id => {
    assert.equal(id, 'electron');
    return { contextBridge: { exposeInMainWorld: (name, value) => { exposed[name] = value; } } };
  },
  document: { readyState: 'complete', querySelector: selector => markers.has(selector) ? {} : null },
  navigator: { onLine: true },
  window: { getSelection: () => ({ toString: () => '用户明确选择的文本' }) },
});
assert.equal(exposed.zhikeWsPage.probeStatus().hasChatShell, true);
assert.deepEqual(JSON.parse(JSON.stringify(exposed.zhikeWsPage.captureSelection())), { text: '用户明确选择的文本', length: 9, truncated: false });

const safeErrorSource = main.match(/function safeErrorMessage\([\s\S]*?\n\}/)?.[0];
assert(safeErrorSource, 'safeErrorMessage must remain directly testable');
const errorContext = {};
vm.runInNewContext(`${safeErrorSource}; this.safeErrorMessage = safeErrorMessage;`, errorContext);
const sanitized = errorContext.safeErrorMessage(`Bearer top-secret sk-example_123456 password=plain ${'x'.repeat(500)}`);
assert(!sanitized.includes('top-secret'));
assert(!sanitized.includes('sk-example_123456'));
assert(!sanitized.includes('password=plain'));
assert(sanitized.length <= 320);
console.log('ws-workbench-security: pass');
