(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ZhikeCustomerGovernance = Object.freeze(api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const text = value => String(value == null ? '' : value).trim();
  const normalizePhone = value => text(value).replace(/\D/g, '').replace(/^00/, '').replace(/^91(?=\d{10}$)/, '');
  const list = value => Array.isArray(value) ? value.map(text).filter(Boolean).slice(0, 30) : text(value) ? [text(value)] : [];
  const finite = value => Number.isFinite(Number(value)) ? Number(value) : '';
  const safeJson = value => JSON.parse(JSON.stringify(value ?? null));

  const FIELD_MAP = Object.freeze({
    name: ['name', 'customerName'],
    phone: ['phone'],
    country: ['country', 'region'],
    language: ['language'],
    origin: ['origin', 'sourceOrigin', 'leadSource'],
    age: ['age'],
    occupation: ['occupation', 'job', 'work'],
    productInterest: ['productInterest', 'products'],
    budget: ['budget'],
    intent: ['intent'],
    intentScore: ['intentScore'],
    emotion: ['emotion'],
    customerStage: ['customerStage', 'stage'],
    aiSummary: ['summary'],
  });

  function readNested(result, key) {
    const contact = result?.contact && typeof result.contact === 'object' ? result.contact : {};
    const profile = result?.profile && typeof result.profile === 'object' ? result.profile : {};
    const aliases = FIELD_MAP[key] || [key];
    for (const alias of aliases) {
      const value = contact[alias] ?? profile[alias] ?? result?.[alias];
      if (value !== undefined && value !== null && text(value) !== '') return value;
    }
    return '';
  }

  function normalizeAge(value) {
    const number = Number(String(value ?? '').match(/\d{1,3}/)?.[0] || '');
    return Number.isFinite(number) && number >= 0 && number <= 120 ? number : '';
  }

  function evidenceFor(result, fields, analysisId, conversationId) {
    const supplied = Array.isArray(result?.evidence) ? result.evidence : [];
    const rows = [];
    const seen = new Set();
    for (const item of supplied) {
      if (!item || typeof item !== 'object') continue;
      const field = text(item.field);
      if (!field || !fields[field] || text(item.value) === '') continue;
      const value = fields[field];
      const sourceText = text(item.text || item.sourceText || result.summary).slice(0, 2000);
      const key = `${analysisId}:${field}`;
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push({ key, field, value, sourceText, confidence: Number(result.confidence) || 0, analysisId, conversationId });
    }
    for (const field of Object.keys(fields)) {
      if (!fields[field]) continue;
      const key = `${analysisId}:${field}`;
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push({ key, field, value: fields[field], sourceText: text(result.summary).slice(0, 2000), confidence: Number(result.confidence) || 0, analysisId, conversationId });
    }
    return rows;
  }

  function normalizeAiProfile(analysis = {}, conversation = {}, accountId = 'default') {
    const result = analysis && typeof analysis === 'object' ? analysis : {};
    const analysisId = text(result.analysisId || conversation.analysisId);
    const conversationId = text(conversation.id || conversation.conversationId);
    const rawPhone = readNested(result, 'phone');
    const productInterest = list(readNested(result, 'productInterest'));
    const fields = {
      name: text(readNested(result, 'name') || conversation.title || conversation.externalId || '未命名客户'),
      phone: normalizePhone(rawPhone),
      rawPhone: text(rawPhone),
      country: text(readNested(result, 'country')),
      language: text(readNested(result, 'language')),
      origin: text(readNested(result, 'origin')),
      age: normalizeAge(readNested(result, 'age')),
      occupation: text(readNested(result, 'occupation')),
      productInterest: productInterest.join('、'),
      budget: text(readNested(result, 'budget')),
      intent: text(readNested(result, 'intent')),
      intentScore: finite(readNested(result, 'intentScore')),
      emotion: text(readNested(result, 'emotion')),
      customerStage: text(readNested(result, 'customerStage')),
      aiSummary: text(readNested(result, 'aiSummary')),
    };
    const profile = {
      ...fields,
      wsExternalId: text(conversation.externalId),
      wsAccountId: text(accountId) || 'default',
      conversationId,
      contactAccount: text(result.contact?.account || result.account),
      source: text(result.source || result.channel) || 'WhatsApp',
      channel: 'WhatsApp',
      assistant: '未分配',
      tags: list(result.tags),
      summary: text(result.summary),
      nextStep: text(result.nextStep),
      followupTime: text(result.followupTime),
      urgency: text(result.urgency),
      deletionSignal: text(result.deletionSignal || result.dataStatus || result.contactStatus),
      confidence: Number(result.confidence) || 0,
      analysisId,
      evidence: evidenceFor(result, fields, analysisId, conversationId),
    };
    return profile;
  }

  function sameValue(field, left, right) {
    if (field === 'age') return normalizeAge(left) === normalizeAge(right);
    if (field === 'phone') return normalizePhone(left) === normalizePhone(right);
    if (field === 'productInterest') return list(left).join('、') === list(right).join('、');
    return text(left).toLocaleLowerCase() === text(right).toLocaleLowerCase();
  }

  function mergeAiProfileSafely(customer, profile = {}) {
    if (!customer || typeof customer !== 'object') return { customer, changedFields: [], conflicts: [], evidenceRows: [] };
    const changedFields = [], conflicts = [], evidenceRows = [];
    const evidenceKeys = new Set(Array.isArray(customer.aiFieldEvidenceKeys) ? customer.aiFieldEvidenceKeys.map(text) : []);
    const protectedFields = ['name', 'phone', 'rawPhone', 'country', 'language', 'origin', 'age', 'occupation', 'productInterest', 'budget', 'source', 'channel', 'assistant'];
    for (const field of protectedFields) {
      let value = profile[field];
      if (field === 'age') value = normalizeAge(value);
      if (field === 'phone') value = normalizePhone(value);
      if (field === 'rawPhone' && !value) value = profile.phone;
      if (field === 'productInterest' && Array.isArray(value)) value = list(value).join('、');
      if (value === '' || value == null) continue;
      if (!text(customer[field]) && !(field === 'age' && customer[field] !== '' && customer[field] != null)) {
        customer[field] = value;
        changedFields.push(field);
      } else if (!sameValue(field, customer[field], value)) {
        conflicts.push({ field, existing: customer[field], incoming: value, analysisId: profile.analysisId || '' });
      }
    }
    const dynamic = { intent: profile.intent, intentScore: profile.intentScore, emotion: profile.emotion, aiSummary: profile.aiSummary };
    for (const [field, value] of Object.entries(dynamic)) {
      if (value === '' || value == null) continue;
      if (JSON.stringify(customer[field]) !== JSON.stringify(value)) { customer[field] = value; changedFields.push(field); }
    }
    if (profile.customerStage && (!text(customer.phase) || customer.phase === '新客户')) { customer.phase = profile.customerStage; changedFields.push('phase'); }
    if (profile.summary && !text(customer.note)) { customer.note = profile.summary; changedFields.push('note'); }
    if (Array.isArray(profile.tags) && profile.tags.length) {
      const tags = [...new Set([...(Array.isArray(customer.tags) ? customer.tags : []), ...profile.tags.map(text).filter(Boolean)])];
      if (JSON.stringify(tags) !== JSON.stringify(customer.tags || [])) { customer.tags = tags; changedFields.push('tags'); }
    }
    const ids = [['wsExternalIds', profile.wsExternalId], ['wsAccountIds', profile.wsAccountId], ['wsConversationIds', profile.conversationId]];
    for (const [field, value] of ids) {
      const next = text(value); if (!next) continue;
      const values = Array.isArray(customer[field]) ? customer[field].map(text).filter(Boolean) : [];
      if (!values.includes(next)) { customer[field] = [...values, next].slice(-100); changedFields.push(field); }
    }
    if (!text(customer.wsContactAccount) && text(profile.contactAccount)) { customer.wsContactAccount = text(profile.contactAccount); changedFields.push('wsContactAccount'); }
    customer.aiProfile = { ...(customer.aiProfile && typeof customer.aiProfile === 'object' ? customer.aiProfile : {}), lastAnalysisId: profile.analysisId || '', updatedAt: new Date().toISOString() };
    for (const row of Array.isArray(profile.evidence) ? profile.evidence : []) {
      if (!row.key || evidenceKeys.has(row.key)) continue;
      evidenceKeys.add(row.key); evidenceRows.push(row);
    }
    customer.aiFieldEvidenceKeys = [...evidenceKeys].slice(-500);
    const fieldSources = customer.aiFieldSources && typeof customer.aiFieldSources === 'object' ? customer.aiFieldSources : {};
    for (const row of evidenceRows) {
      fieldSources[row.field] = { value: row.value, sourceText: row.sourceText, confidence: row.confidence, analysisId: row.analysisId, conversationId: row.conversationId, updatedAt: new Date().toISOString() };
    }
    customer.aiFieldSources = fieldSources;
    customer.aiProfile = {
      ...(customer.aiProfile && typeof customer.aiProfile === 'object' ? customer.aiProfile : {}),
      ...Object.fromEntries(Object.entries(profile).filter(([key, value]) => ['name', 'phone', 'country', 'language', 'origin', 'age', 'occupation', 'productInterest', 'budget', 'intent', 'intentScore', 'emotion', 'customerStage', 'aiSummary'].includes(key) && value !== '' && value != null)),
      confidence: Number(profile.confidence) || 0,
      lastAnalysisId: profile.analysisId || '',
      updatedAt: new Date().toISOString(),
    };
    customer.touched = true;
    return { customer, changedFields: [...new Set(changedFields)], conflicts, evidenceRows };
  }

  function shouldAutoSoftDelete(input = {}) {
    const confidence = Number(input.confidence || 0);
    const signal = text(input.deletionSignal || input.reason || input.status);
    return confidence >= 0.85 && /(明确拒绝|拒绝联系|不要再联系|号码无效|无效号码|重复客户|duplicate|invalid number|stop contact|do not contact)/i.test(signal);
  }

  function buildGovernanceAction(customerId, action, before, after, options = {}) {
    return {
      customerId: text(customerId),
      action: text(action),
      reason: text(options.reason),
      source: text(options.source || 'AI'),
      confidence: Number(options.confidence) || 0,
      analysisId: text(options.analysisId),
      before: safeJson(before),
      after: safeJson(after),
      createdAt: options.createdAt || new Date().toISOString(),
    };
  }

  return { normalizeAiProfile, mergeAiProfileSafely, shouldAutoSoftDelete, buildGovernanceAction, normalizePhone, normalizeAge };
});
