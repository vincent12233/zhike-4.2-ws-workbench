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
const natural = core.parseAiResult(JSON.stringify({ confidence: 0.88, conversationProgress: '已聊到职业', noReply: { noReply: true, reason: '客户正在忙', cooldownDays: 4 }, replySuggestion: { text: '可以先分享一条相关市场资讯', sensitive: false } }));
assert.equal(natural.conversationProgress, '已聊到职业');
assert.equal(natural.noReply.noReply, true);
assert.equal(natural.noReply.cooldownDays, 4);
assert.equal(natural.replySuggestionMeta.requiresConfirmation, true);
assert.equal(natural.replySuggestionMeta.sensitive, false);
const sensitiveSuggestion = core.parseAiResult(JSON.stringify({ confidence: 0.9, replySuggestion: '请把验证码发给我' }));
assert.equal(sensitiveSuggestion.replySuggestionMeta.sensitive, true);

const customer = { id: 'C1', name: '张三', wsExternalId: 'wa-001', phone: '13800138000' };
assert.equal(core.matchCustomer([customer], { wsExternalId: 'wa-001' }).kind, 'ws-id');
assert.equal(core.matchCustomer([customer], { phone: '13800138000' }).kind, 'phone');
assert.equal(core.extractPhone('请联系 +91 80013 80000 或备用 13800138000'), '8001380000');
assert.equal(core.matchCustomer([customer], { conversationId: 'conv-1' }).kind, 'new');

const deduped = core.dedupeMessages([
  { id: 'm2', externalId: 'x2', order: 2 },
  { id: 'm1', externalId: 'x1', order: 1 },
  { id: 'm2b', externalId: 'x2', order: 2, translatedText: '已翻译' },
]);
assert.deepEqual(deduped.map(item => item.id), ['m1', 'm2b']);

const observedNow = '2026-11-13T10:00:00.000Z';
const unknownTimeMessage = {
  id: 'unknown-time', externalId: 'unknown-time', direction: 'receive', originalText: '刚保存但发送时间未知', order: 3,
  createdAt: observedNow, sentAt: '', sentAtKnown: false,
  data: { source: 'ws-webview2', observedAt: observedNow, sentAt: '', sentAtKnown: false, timestampText: 'unparsed preamble', timestampSource: 'unparsed' },
};
const knownTimeMessage = {
  id: 'known-time', externalId: 'known-time', direction: 'receive', originalText: '有权威历史时间', order: 4,
  createdAt: '2026-11-12T10:00:00.000Z', sentAt: '2026-11-12T10:00:00.000Z', sentAtKnown: true,
  data: { source: 'ws-webview2', observedAt: observedNow, sentAt: '2026-11-12T10:00:00.000Z', sentAtKnown: true, timestampText: '12/11/2026, 15:30', timestampSource: 'whatsapp-preamble' },
};
assert.equal(core.messageSentAt(unknownTimeMessage), '', 'observedAt/createdAt fallback must not become a business sent time');
assert.equal(core.messageRecencyWeight(unknownTimeMessage, { now: Date.parse(observedNow), recentDays: 7 }), 0, 'unknown message time must add no recent-activity weight');
assert.equal(core.messageSentAt(knownTimeMessage), '2026-11-12T10:00:00.000Z');
assert.ok(core.messageRecencyWeight(knownTimeMessage, { now: Date.parse(observedNow), recentDays: 7 }) > 0, 'authoritative WhatsApp time may contribute recency evidence');
const timedTranscript = core.buildFullHistoryTranscript([unknownTimeMessage, knownTimeMessage], { maxChars: 4000 });
assert.match(timedTranscript.text, /\[时间未知\] 客户：刚保存但发送时间未知/);
assert.match(timedTranscript.text, /\[2026-11-12T10:00:00\.000Z\] 客户：有权威历史时间/);

const visible = core.parseVisibleChat('[2026/11/05 10:20] 客户：Hello\n我：你好\n客户：预算 1000', 'receive');
assert.equal(visible.length, 3);
assert.deepEqual(visible.map(item => item.direction), ['receive', 'send', 'receive']);
assert.equal(core.visibleChatFingerprint(visible), core.visibleChatFingerprint(visible));
const transcript = core.buildTranscript(visible.map((item, index) => ({ direction: item.direction, originalText: item.text.repeat(500), order: index })), { maxChars: 1000 });
assert(transcript.text.length <= 1000);
const naturalPrompt = core.buildNaturalChatAnalysisPrompt(transcript.text, { conversationId: 'conv-natural' });
for (const field of ['preferred_name', 'age', 'gender', 'occupation', 'work_context', 'is_investor', 'investment_years', 'holdings', 'investment_habits', 'investment_preferences', 'family_context', 'life_interests', 'future_plans']) {
  assert.match(naturalPrompt, new RegExp(field), `natural chat prompt must request ${field}`);
}
assert.match(naturalPrompt, /不要生成调查问卷|不要连续追问/, 'natural chat prompt must avoid survey-style questioning');
assert.match(naturalPrompt, /evidence|证据/, 'natural chat prompt must require evidence');
assert.match(naturalPrompt, /“客户”是客户本人.*“我”.*经营者\/助理/, 'prompt must define customer and operator ownership');
assert.match(naturalPrompt, /sourceRole.*customer.*operator.*third_party/, 'profile facts must carry an explicit evidence role');
assert.match(naturalPrompt, /我方连续发送.*不得算作客户粘度/, 'operator-only messages must not inflate customer engagement');
assert.match(naturalPrompt, /引用、转发.*第三方.*不得写成客户资料/, 'forwarded third-party facts must not become customer profile data');
assert.match(naturalPrompt, /低置信度.*不阻塞|低置信度.*自动补齐/, 'natural chat prompt must allow non-blocking low-confidence CRM fill');
assert.match(naturalPrompt, /requiresConfirmation|人工确认/, 'natural chat prompt must keep replies human-confirmed');
assert.match(naturalPrompt, /\[时间未知\].*不得.*提高聊天粘度/, 'prompt must prohibit treating observed fallback time as recent engagement evidence');
const roleSafeFacts = core.parseAiResult(JSON.stringify({
  confidence: 0.91,
  profileFacts: {
    preferred_name: { value: 'Asha', state: 'known', confidence: 0.95, evidence: '客户：我叫 Asha', sourceRole: 'customer' },
    age: { value: 38, state: 'known', confidence: 0.95, evidence: '我：我今年 38 岁', sourceRole: 'operator' },
    occupation: { value: 'Doctor', state: 'known', confidence: 0.9, evidence: '转发：我的朋友是医生', sourceRole: 'third_party' },
    holdings: { value: '长期持有银行股', state: 'known', confidence: 0.82, evidence: '客户：我长期持有银行股' },
    work_context: { value: '经营服装店', state: 'known', confidence: 0.9, evidence: '客户：对，我经营一家服装店', source_role: 'client' },
  },
}));
assert.equal(roleSafeFacts.profileFacts.preferred_name.value, 'Asha', 'customer-stated fact remains eligible');
assert.equal(roleSafeFacts.profileFacts.preferred_name.sourceRole, 'customer');
assert.equal(roleSafeFacts.profileFacts.work_context.sourceRole, 'customer', 'customer confirmation aliases normalize to customer');
assert.equal(roleSafeFacts.profileFacts.age, undefined, 'operator self-description must be discarded');
assert.equal(roleSafeFacts.profileFacts.occupation, undefined, 'third-party/forwarded facts must be discarded');
assert.equal(roleSafeFacts.profileFacts.holdings.value, '长期持有银行股', 'legacy facts without sourceRole remain compatible');
assert.equal(roleSafeFacts.profileFactsAutoFill.age, undefined);
assert.equal(roleSafeFacts.profileFactsAutoFill.occupation, undefined);
const orderedRoles = core.buildFullHistoryTranscript([
  { id: 'role-2', externalId: 'role-2', order: 2, direction: 'send', originalText: '我来自孟买，你住在哪里？' },
  { id: 'role-1', externalId: 'role-1', order: 1, direction: 'receive', originalText: '我叫 Asha。' },
  { id: 'role-3', externalId: 'role-3', order: 3, direction: 'receive', originalText: '我住在德里。' },
], { maxChars: 4000 }).text;
assert.ok(orderedRoles.indexOf('客户：我叫 Asha。') < orderedRoles.indexOf('我：我来自孟买，你住在哪里？'), 'transcript preserves customer/operator chronology');
assert.ok(orderedRoles.indexOf('我：我来自孟买，你住在哪里？') < orderedRoles.indexOf('客户：我住在德里。'), 'customer confirmation remains after the operator question');
assert.match(core.redactSensitiveText('密码: secret123 api_key=abc123 API Key: def456'), /已脱敏/);
const tomorrow = new Date();
tomorrow.setDate(tomorrow.getDate() + 1);
assert.equal(core.suggestedDate('请明天跟进'), new Date(tomorrow.getTime() - tomorrow.getTimezoneOffset() * 60000).toISOString().slice(0, 10));
assert.equal(core.parseTranslationBatch('{"translations":[{"id":"m1","translation":"你好"}]}')[0].translation, '你好');

const sharedLoginCustomer = { id: 'shared-existing', phone: '9876543210', wsAccountIds: ['personal-login'] };
assert.equal(core.matchCustomer([sharedLoginCustomer], { wsAccountId: 'personal-login', phone: '9123456789' }).kind, 'new', 'one previously linked customer must not absorb every peer of the same login');
assert.equal(core.matchCustomer([sharedLoginCustomer], { wsAccountId: 'personal-login' }).customer, null, 'login identity alone is never customer identity');
assert.equal(core.matchCustomer([sharedLoginCustomer], { wsAccountId: 'personal-login', phone: '+91 98765 43210' }).customer.id, 'shared-existing', 'known peer phone remains independently matchable');
assert.equal(core.matchCustomer([{ ...sharedLoginCustomer, wsConversationIds: ['stable-contact'] }], { wsAccountId: 'personal-login', conversationId: 'stable-contact' }).kind, 'conversation', 'shared login fallback must not mask a verified contact identity');

(async () => {
  const fs = require('node:fs');
  const vm = require('node:vm');
  const source = fs.readFileSync(require('node:path').join(__dirname, '..', 'resources', 'app', 'modules', 'ws-workbench.js'), 'utf8');
  const start = source.indexOf('async function enqueueDiscoveredConversations(');
  const end = source.indexOf('\n  function splitListPreview(', start);
  assert.ok(start >= 0 && end > start);
  async function discover(coreUnderTest, item) {
    const requests = [];
    const localState = { collectionRun: { id: 'isolated-run' }, conversations: [] };
    const enqueue = vm.runInNewContext(`(${source.slice(start, end)})`, {
      core: coreUnderTest, state: localState, text: value => String(value ?? '').trim(),
      normalizeListItem: value => value, listPreviewText: value => value.preview || '',
      isAutomaticDirectConversation: value => coreUnderTest.conversationType(value) === 'direct',
      isAutomaticCollectibleConversation: value => ['direct', 'vip_group'].includes(coreUnderTest.conversationType(value)),
      personalConversationRows: rows => rows.filter(value => !coreUnderTest.isGroupConversation(value) || coreUnderTest.isVipGroupConversation(value)),
      reconcilePersonalConversationSelection() {},
      getHost: () => ({ state: { customers: [sharedLoginCustomer] } }),
      captureContext: () => ({ accountId: 'personal-login' }), assertContext() {}, toast() {},
      api: async (url, options = {}) => {
        const body = options.body ? JSON.parse(options.body) : null;
        if (url === '/api/ws/conversations' && options.method === 'POST') { requests.push(body); return { id: 'isolated-conversation' }; }
        if (url.startsWith('/api/ws/conversations?')) return { conversations: [] };
        return {};
      },
    });
    assert.equal(await enqueue([item], false), 1);
    assert.equal(requests.length, 1);
    return requests[0];
  }
  const unknown = await discover(core, { index: 0, externalId: 'unknown-peer', title: '+91 91234 56789', conversationType: 'direct' });
  assert.equal(unknown.customerId, '');
  assert.equal(unknown.data.customerMatch, 'pending');
  const known = await discover(core, { index: 1, externalId: 'known-peer', title: '+91 98765 43210', conversationType: 'direct' });
  assert.equal(known.customerId, 'shared-existing');
  const previewOnlyPhone = await discover(core, { index: 2, externalId: 'alias-peer', title: 'Unknown peer', preview: 'My friend has number +91 98765 43210', conversationType: 'direct' });
  assert.equal(previewOnlyPhone.customerId, '', 'a third-party phone in a preview must not associate a customer');
  const legacyAccountMatch = await discover({ ...core, matchCustomer: () => ({ kind: 'account', customer: sharedLoginCustomer }) }, { index: 3, externalId: 'another-peer', title: 'Another peer', conversationType: 'direct' });
  assert.equal(legacyAccountMatch.customerId, '', 'discovery must independently reject a legacy account-only match result');
  console.log('ws-workbench-core: pass; shared-login isolation and live discovery payloads verified');
})().catch(error => { console.error(error); process.exitCode = 1; });
