'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const repo = path.resolve(__dirname, '../..');
const source = fs.readFileSync(path.join(repo, 'desktop/src/Zhike.Desktop/Views/LegacyUiHostPage.xaml.cs'), 'utf8');
function script(name) {
  const begin = source.indexOf('    private static string ' + name + '('), end = source.indexOf('\n    private ', begin + 10);
  assert.ok(begin > 0 && end > begin);
  const raw = source.slice(begin, end).match(/return \$\$"""([\s\S]*?)""";/)?.[1]; assert.ok(raw);
  const parameters = { expectedJson: 'synthetic-target', textJson: 'synthetic text', mediaIdJson: 'synthetic-media', fileNameJson: 'synthetic.png', mimeJson: 'image/png', captionJson: 'synthetic caption', bytesJson: 'AQID' };
  return raw.replace(/\{\{(\w+)\}\}/g, (_, key) => JSON.stringify(parameters[key]));
}
function execute(code, options = {}) {
  let clicks = 0;
  const header = { getAttribute: () => options.wrongConversation ? 'different-target' : 'synthetic-target', innerText: '', textContent: '' };
  const composer = { isConnected: true, closest: () => null, getAttribute: () => 'message', focus() {}, dispatchEvent() {} };
  const send = { getAttribute: () => 'send', click() { ++clicks; if (options.clickThrows) throw new Error('synthetic click exception'); } };
  const input = { isConnected: true, disabled: false, dispatchEvent() {} };
  const document = {
    querySelector: () => header,
    querySelectorAll: selector => selector.includes('input[type=') ? options.noInput ? [] : [input] : selector.includes('contenteditable') ? options.noComposer ? [] : [composer] : options.noSend ? [] : [send],
    execCommand: () => true,
  };
  const sandbox = { document, atob: value => Buffer.from(value, 'base64').toString('binary'), Uint8Array,
    DataTransfer: class { constructor() { this.files = []; this.items = { add: item => this.files.push(item) }; } },
    File: class { constructor(parts, name, config) { this.name = name; this.type = config.type; } }, Event: class {}, InputEvent: class {},
  };
  return { result: vm.runInNewContext(code, sandbox), clicks };
}
async function bridgeFailure(method, data) {
  const source = fs.readFileSync(path.join(repo, 'desktop/src/Zhike.Desktop/Services/LegacyBridgeScript.cs'), 'utf8');
  const template = source.match(/SourceTemplate\s*=\s*"""([\s\S]*?)""";/)?.[1]; assert.ok(template);
  let posted, receive;
  const window = { fetch: async () => { throw new Error('network forbidden'); }, chrome: { webview: { postMessage: value => { posted = JSON.parse(value); }, addEventListener: (name, callback) => { receive = callback; } } } };
  vm.runInNewContext(template.replace('__ZHikeLocalDbFlag__', 'true').replace('__ZhikeStorageMode__', "'local'"), { window, setTimeout, clearTimeout, AbortController });
  const pending = window.zhikeDesktop.invoke(method, {}).then(() => { throw new Error('must reject native failure'); }, error => error);
  receive({ data: { type: 'zhike.bridge.response', requestId: posted.requestId, ok: false, errorCode: 'SYNTHETIC_REFUSAL', message: 'synthetic refusal', data } });
  return pending;
}
(async () => {
  const cases = [];
  async function test(name, run) { try { await run(); cases.push({ name, passed: true }); } catch (error) { cases.push({ name, passed: false, reason: error.message }); process.exitCode = 1; } }
  for (const [kind, name] of [['text', 'BuildWsSendTextScript'], ['media', 'BuildWsSendMediaScript']]) {
    const actual = script(name);
    await test(kind + '-click-only-local-attempt', () => { const {result, clicks}=execute(actual); assert.equal(clicks,1); assert.equal(result.ok,true); assert.equal(result.deliveryState,'local_attempted'); assert.equal(result.dispatchAttempted,true); assert.equal(result.platformMessageId,null); assert.equal(result.delivered,undefined); assert.equal(result.accepted,undefined); });
    await test(kind + '-click-exception-unknown', () => { const {result, clicks}=execute(actual,{clickThrows:true}); assert.equal(clicks,1); assert.equal(result.deliveryState,'unknown'); assert.equal(result.dispatchAttempted,true); });
    for (const option of ['noSend', 'noComposer', 'wrongConversation']) await test(kind + '-' + option + '-before-click-failed', () => { const {result, clicks}=execute(actual,{[option]:true}); assert.equal(clicks,0); assert.equal(result.ok,false); assert.equal(result.deliveryState,'failed'); assert.equal(result.dispatchAttempted,false); });
    if (kind==='media') await test('media-no-file-input-before-click-failed', () => { const {result,clicks}=execute(actual,{noInput:true}); assert.equal(clicks,0); assert.equal(result.deliveryState,'failed'); assert.equal(result.dispatchAttempted,false); });
  }
  await test('ws-bridge-whitelist-preserves-non-attempt', async () => { const error=await bridgeFailure('ws',{deliveryState:'failed',dispatchAttempted:false,notAttempted:true,phase:'preflight',apiKey:'not-forwarded',payload:{secret:'not-forwarded'},platformMessageId:'not-trusted'}); assert.equal(error.code,'SYNTHETIC_REFUSAL'); assert.equal(error.deliveryState,'failed'); assert.equal(error.dispatchAttempted,false); assert.equal(error.notAttempted,true); assert.equal(error.phase,'preflight'); assert.equal(error.apiKey,undefined); assert.equal(error.payload,undefined); assert.equal(error.data,undefined); assert.equal(error.platformMessageId,undefined); });
  await test('ws-prefixed-bridge-preserves-unknown', async () => { const error=await bridgeFailure('ws.send-media',{deliveryState:'unknown',dispatchAttempted:true}); assert.equal(error.deliveryState,'unknown'); assert.equal(error.dispatchAttempted,true); });
  await test('non-ws-bridge-does-not-forward-send-metadata', async () => { const error=await bridgeFailure('ai',{deliveryState:'failed',dispatchAttempted:false}); assert.equal(error.deliveryState,undefined); assert.equal(error.dispatchAttempted,undefined); });
  await test('bridge-invalid-state-types-not-trusted', async () => { const error=await bridgeFailure('ws',{deliveryState:'delivered',dispatchAttempted:'false'}); assert.equal(error.deliveryState,undefined); assert.equal(error.dispatchAttempted,undefined); });
  await test('unknown-never-exposes-a-retryable-preflight', async () => { const error=await bridgeFailure('ws',{deliveryState:'unknown',dispatchAttempted:true,notAttempted:true,phase:'preflight'}); assert.equal(error.deliveryState,'unknown'); assert.equal(error.dispatchAttempted,true); assert.equal(error.notAttempted,undefined); assert.equal(error.phase,undefined); });
  const output = JSON.stringify({ stage:'5.5C-1A', actualProductionScripts:true, cases, realWs:false, network:false, productionOpened:false });
  const out=path.join(repo,'.tools/stage55c-native-send');fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,process.argv.includes('--baseline')?'dom-baseline.log':'dom-final.log'),output+'\n');
  console.log(output);
})().catch(error => { console.error(error); process.exitCode=1; });
