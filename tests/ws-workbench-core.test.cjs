const assert = require('node:assert/strict');
const corePath = require('node:path').join(__dirname, 'project-review', '知客 4.1 运营增强版', 'resources', 'app', 'modules', 'ws-workbench-core.js');
const core = require(corePath);

assert.deepEqual(core.normalizeTranslationSettings({ enabled: false, receive: true, send: true }), {
  enabled: false,
  receive: false,
  send: false,
  targetLanguage: '中文',
  showOriginal: true,
});
assert.equal(core.shouldTranslate({ enabled: true, receive: true, send: false }, 'receive'), true);
assert.equal(core.shouldTranslate({ enabled: true, receive: true, send: false }, 'send'), false);
assert.equal(core.shouldTranslate({ enabled: true, receive: false, send: true }, 'send'), true);

assert.equal(core.isSensitiveReply('请把验证码和银行卡密码发给我'), true);
assert.equal(core.isSensitiveReply('感谢您的咨询，我会整理产品资料'), false);

const parsed = core.parseAiResult('```json\n{"summary":"客户想了解产品","confidence":0.42,"intent":"咨询"}\n```');
assert.equal(parsed.summary, '客户想了解产品');
assert.equal(parsed.lowConfidence, true);

const customer = { id: 'C1', name: '张三', wsExternalId: 'wa-001', phone: '13800138000' };
assert.equal(core.matchCustomer([customer], { wsExternalId: 'wa-001' }).kind, 'ws-id');
assert.equal(core.matchCustomer([customer], { phone: '13800138000' }).kind, 'phone');
assert.equal(core.matchCustomer([customer], { conversationId: 'conv-1' }).kind, 'new');

const deduped = core.dedupeMessages([
  { id: 'm2', externalId: 'x2', order: 2 },
  { id: 'm1', externalId: 'x1', order: 1 },
  { id: 'm2b', externalId: 'x2', order: 2, translatedText: '已翻译' },
]);
assert.deepEqual(deduped.map(item => item.id), ['m1', 'm2b']);

console.log('ws-workbench-core: pass');
