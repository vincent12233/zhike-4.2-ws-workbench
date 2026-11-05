const assert = require('node:assert/strict');
const corePath = require('node:path').join(__dirname, '..', 'resources', 'app', 'modules', 'ws-workbench-core.js');
const core = require(corePath);

assert.deepEqual(core.normalizeTranslationSettings({ enabled: false, receive: true, send: true }), {
  enabled: false,
  receive: true,
  send: true,
  targetLanguage: '中文',
  sendLanguage: '自动识别',
  showOriginal: true,
});
assert.equal(core.shouldTranslate({ enabled: false, receive: true, send: true }, 'receive'), false);
assert.equal(core.translationMode({ enabled: false, receive: true, send: true }), '全部关闭');
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
assert.equal(core.extractPhone('请联系 +91 13800 138000 或备用 13800138000'), '13800138000');
assert.equal(core.matchCustomer([customer], { conversationId: 'conv-1' }).kind, 'new');

const deduped = core.dedupeMessages([
  { id: 'm2', externalId: 'x2', order: 2 },
  { id: 'm1', externalId: 'x1', order: 1 },
  { id: 'm2b', externalId: 'x2', order: 2, translatedText: '已翻译' },
]);
assert.deepEqual(deduped.map(item => item.id), ['m1', 'm2b']);

const visible = core.parseVisibleChat('[2026/11/05 10:20] 客户：Hello\n我：你好\n客户：预算 1000', 'receive');
assert.equal(visible.length, 3);
assert.deepEqual(visible.map(item => item.direction), ['receive', 'send', 'receive']);
assert.equal(core.visibleChatFingerprint(visible), core.visibleChatFingerprint(visible));
const transcript = core.buildTranscript(visible.map((item, index) => ({ direction: item.direction, originalText: item.text.repeat(500), order: index })), { maxChars: 1000 });
assert(transcript.text.length <= 1000);
const tomorrow = new Date();
tomorrow.setDate(tomorrow.getDate() + 1);
assert.equal(core.suggestedDate('请明天跟进'), new Date(tomorrow.getTime() - tomorrow.getTimezoneOffset() * 60000).toISOString().slice(0, 10));
assert.equal(core.parseTranslationBatch('{"translations":[{"id":"m1","translation":"你好"}]}')[0].translation, '你好');

console.log('ws-workbench-core: pass');
