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
  const redactSensitive = value => text(value)
    .replace(/(?:password|passcode|token|cookie|secret|api[\s_-]?key)\s*[:：]?\s*[^\s，。；;]+/ig, '[已脱敏]')
    .replace(/(?:验证码|校验码|密码|银行卡(?:号)?|收款码|二维码)\s*[:：]?\s*[A-Za-z0-9_\-\s]+/ig, '[已脱敏]');
  const AUTO_SYNC_CONFIDENCE_THRESHOLD = 0.6;

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
    preferred_name: ['preferred_name', 'preferredName'],
    gender: ['gender'],
    work_context: ['work_context', 'workContext'],
    is_investor: ['is_investor', 'isInvestor'],
    investment_years: ['investment_years', 'investmentYears'],
    holdings: ['holdings'],
    investment_habits: ['investment_habits', 'investmentHabits'],
    investment_preferences: ['investment_preferences', 'investmentPreferences'],
    family_context: ['family_context', 'familyContext'],
    life_interests: ['life_interests', 'lifeInterests'],
    future_plans: ['future_plans', 'futurePlans'],
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
    const match = String(value ?? '').match(/\d{1,3}/);
    if (!match) return '';
    const number = Number(match[0]);
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
      const sourceText = redactSensitive(item.text || item.sourceText || result.summary).slice(0, 2000);
      const key = `${analysisId}:${field}`;
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push({ key, field, value: redactSensitive(value), sourceText, confidence: Number(result.confidence) || 0, analysisId, conversationId });
    }
    for (const field of Object.keys(fields)) {
      if (!fields[field]) continue;
      const key = `${analysisId}:${field}`;
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push({ key, field, value: redactSensitive(fields[field]), sourceText: redactSensitive(result.summary).slice(0, 2000), confidence: Number(result.confidence) || 0, analysisId, conversationId });
    }
    const profileFacts = result?.profileFacts && typeof result.profileFacts === 'object' ? result.profileFacts : {};
    for (const [field, fact] of Object.entries(profileFacts)) {
      if (!fact || fact.value == null || fact.value === '' || !text(fact.evidence)) continue;
      const key = `${analysisId}:profile:${field}`;
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push({ key, field, value: redactSensitive(fact.value), sourceText: redactSensitive(fact.evidence).slice(0, 2000), confidence: Number(fact.confidence ?? result.confidence) || 0, analysisId, conversationId });
    }
    return rows;
  }

  function normalizeAiProfile(analysis = {}, conversation = {}, accountId = 'default') {
    const result = analysis && typeof analysis === 'object' ? analysis : {};
    const analysisId = text(result.analysisId || conversation.analysisId);
    const conversationId = text(conversation.id || conversation.conversationId);
    const rawPhone = readNested(result, 'phone');
    const productInterest = list(readNested(result, 'productInterest'));
    const profileFacts = result.profileFacts && typeof result.profileFacts === 'object' ? result.profileFacts : {};
    const factList = key => { const value = factValue(key); const values = list(value); return values.length ? values : ''; };
    const factValue = key => { const fact = profileFacts[key]; if (fact && (fact.state === 'declined' || Number(fact.confidence || 0) < 0.6 || !text(fact.evidence || fact.sourceText))) return ''; return fact?.value ?? readNested(result, key); };
    const fields = {
      name: text(readNested(result, 'name') || factValue('preferred_name')),
      phone: normalizePhone(rawPhone),
      rawPhone: text(rawPhone),
      country: text(readNested(result, 'country')),
      language: text(readNested(result, 'language')),
      origin: text(readNested(result, 'origin')),
      age: normalizeAge(readNested(result, 'age') || factValue('age')),
      occupation: text(readNested(result, 'occupation') || factValue('occupation')),
      preferred_name: text(factValue('preferred_name')),
      gender: text(factValue('gender')),
      work_context: text(factValue('work_context')),
      is_investor: factValue('is_investor') ?? '',
      investment_years: normalizeAge(factValue('investment_years')),
      holdings: factList('holdings'),
      investment_habits: factList('investment_habits'),
      investment_preferences: factList('investment_preferences'),
      family_context: text(factValue('family_context')),
      life_interests: factList('life_interests'),
      future_plans: text(factValue('future_plans')),
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
    if (field === 'rawPhone') return normalizePhone(left) === normalizePhone(right);
    if (field === 'productInterest') return list(left).join('、') === list(right).join('、');
    return text(left).toLocaleLowerCase() === text(right).toLocaleLowerCase();
  }

  // V5.0 §16: compare the send time of the newest analysed message with the
  // time recorded for the current AI value. Only when both are known and the
  // incoming messages are older is the update refused, so a missing timestamp
  // never blocks a legitimate update.
  function olderThanStoredSource(customer, field, profile) {
    const incoming = Date.parse(profile?.sourceMessageAt || '');
    const stored = Date.parse(customer?.aiFieldSources?.[field]?.messageAt || customer?.aiProfile?.sourceMessageAt || '');
    return Number.isFinite(incoming) && Number.isFinite(stored) && incoming < stored;
  }
  function mergeAiProfileSafely(customer, profile = {}) {
    if (!customer || typeof customer !== 'object') return { customer, changedFields: [], conflicts: [], evidenceRows: [], staleFields: [] };
    const changedFields = [], conflicts = [], evidenceRows = [], staleFields = [];
    const lockedFields = new Set([
      ...(Array.isArray(customer.manualLockedFields) ? customer.manualLockedFields : []),
      ...(Array.isArray(customer.aiLockedFields) ? customer.aiLockedFields : []),
    ].map(text));
    const isLocked = field => lockedFields.has(field);
    const missing = (field, value) => {
      const current = text(value);
      return !current || (field === 'name' && /^(未命名客户|未命名|未知客户|未知|—|-)$/.test(current));
    };
    const evidenceKeys = new Set(Array.isArray(customer.aiFieldEvidenceKeys) ? customer.aiFieldEvidenceKeys.map(text) : []);
    // source/channel/assistant are deliberately absent: they are set by group
    // configuration and assignment, and an AI value must neither fill nor
    // contest them. Otherwise every configured customer would be blocked as a
    // conflict, and unconfigured ones would get the label "WhatsApp".
    const protectedFields = ['name', 'phone', 'rawPhone', 'country', 'language', 'origin', 'age', 'occupation', 'productInterest', 'budget', 'preferred_name', 'gender', 'work_context', 'is_investor', 'investment_years', 'holdings', 'investment_habits', 'investment_preferences', 'family_context', 'life_interests', 'future_plans'];
    for (const field of protectedFields) {
      let value = profile[field];
      if (field === 'age') value = normalizeAge(value);
      if (field === 'phone') value = normalizePhone(value);
      if (field === 'rawPhone' && !value) value = profile.phone;
      if (Array.isArray(value)) value = list(value).join('、');
      if (value === '' || value == null) continue;
      if (field === 'name' && /^(未命名客户|未命名|未知客户|未知|—|-)$/.test(text(value))) continue;
      if (isLocked(field)) {
        if (!sameValue(field, customer[field], value)) conflicts.push({ field, existing: customer[field], incoming: value, analysisId: profile.analysisId || '', locked: true });
        continue;
      }
      if (missing(field, customer[field]) && !(field === 'age' && customer[field] !== '' && customer[field] != null && !missing(field, customer[field]))) {
        customer[field] = value;
        changedFields.push(field);
      } else if (!sameValue(field, customer[field], value)) {
        conflicts.push({ field, existing: customer[field], incoming: value, analysisId: profile.analysisId || '' });
      }
    }
    const dynamic = { intent: profile.intent, intentScore: profile.intentScore, emotion: profile.emotion, aiSummary: profile.aiSummary };
    for (const [field, value] of Object.entries(dynamic)) {
      if (value === '' || value == null) continue;
      if (isLocked(field)) {
        if (JSON.stringify(customer[field]) !== JSON.stringify(value)) conflicts.push({ field, existing: customer[field], incoming: value, analysisId: profile.analysisId || '', locked: true });
        continue;
      }
      if (JSON.stringify(customer[field]) === JSON.stringify(value)) continue;
      const priorAiValue = customer.aiProfile && typeof customer.aiProfile === 'object' ? customer.aiProfile[field] : undefined;
      const aiManaged = Boolean(customer.aiFieldSources?.[field])
        || (priorAiValue !== undefined && JSON.stringify(priorAiValue) === JSON.stringify(customer[field]));
      if (aiManaged && olderThanStoredSource(customer, field, profile)) { staleFields.push(field); continue; }
      if (missing(field, customer[field]) || aiManaged) { customer[field] = value; changedFields.push(field); }
      else conflicts.push({ field, existing: customer[field], incoming: value, analysisId: profile.analysisId || '', manual: true });
    }
    if (!isLocked('phase') && profile.customerStage && (!text(customer.phase) || customer.phase === '新客户')) { customer.phase = profile.customerStage; changedFields.push('phase'); }
    if (!isLocked('note') && profile.summary && !text(customer.note)) { customer.note = profile.summary; changedFields.push('note'); }
    if (!isLocked('tags') && Array.isArray(profile.tags) && profile.tags.length) {
      const tags = [...new Set([...(Array.isArray(customer.tags) ? customer.tags : []), ...profile.tags.map(text).filter(Boolean)])];
      if (JSON.stringify(tags) !== JSON.stringify(customer.tags || [])) { customer.tags = tags; changedFields.push('tags'); }
    }
    const ids = [['wsExternalIds', profile.wsExternalId], ['wsAccountIds', profile.wsAccountId], ['wsConversationIds', profile.conversationId]];
    for (const [field, value] of ids) {
      if (isLocked(field)) continue;
      const next = text(value); if (!next) continue;
      const values = Array.isArray(customer[field]) ? customer[field].map(text).filter(Boolean) : [];
      if (!values.includes(next)) { customer[field] = [...values, next].slice(-100); changedFields.push(field); }
    }
    if (!isLocked('wsContactAccount') && !text(customer.wsContactAccount) && text(profile.contactAccount)) { customer.wsContactAccount = text(profile.contactAccount); changedFields.push('wsContactAccount'); }
    customer.aiProfile = { ...(customer.aiProfile && typeof customer.aiProfile === 'object' ? customer.aiProfile : {}), lastAnalysisId: profile.analysisId || '', updatedAt: new Date().toISOString() };
    for (const row of Array.isArray(profile.evidence) ? profile.evidence : []) {
      if (!row.key || evidenceKeys.has(row.key)) continue;
      evidenceKeys.add(row.key); evidenceRows.push(row);
    }
    customer.aiFieldEvidenceKeys = [...evidenceKeys].slice(-500);
    const fieldSources = customer.aiFieldSources && typeof customer.aiFieldSources === 'object' ? customer.aiFieldSources : {};
    const conflictFields = new Set(conflicts.map(item => text(item.field)));
    const staleSet = new Set(staleFields);
    const sourceAccepted = row => {
      const field = text(row.field);
      if (!field || conflictFields.has(field) || staleSet.has(field) || isLocked(field)) return false;
      if (![...protectedFields, ...Object.keys(dynamic)].includes(field)) return false;
      let incoming = profile[field];
      if (field === 'age') incoming = normalizeAge(incoming);
      if (field === 'phone') incoming = normalizePhone(incoming);
      if (field === 'rawPhone' && !incoming) incoming = profile.phone;
      if (Array.isArray(incoming)) incoming = list(incoming).join('、');
      return incoming !== '' && incoming != null && sameValue(field, customer[field], incoming);
    };
    for (const row of evidenceRows) {
      if (!sourceAccepted(row)) continue;
      // messageAt = send time of the newest analysed message; updatedAt = when
      // the analysis was applied. Both are kept so ordering uses message time.
      fieldSources[row.field] = { value: row.value, sourceText: row.sourceText, confidence: row.confidence, analysisId: row.analysisId, conversationId: row.conversationId, messageAt: text(profile.sourceMessageAt), model: text(profile.model), accountId: text(profile.wsAccountId), updatedAt: new Date().toISOString() };
    }
    customer.aiFieldSources = fieldSources;
    const acceptedProfileFields = Object.fromEntries(Object.entries(profile).filter(([key, value]) =>
      ['name', 'phone', 'country', 'language', 'origin', 'age', 'occupation', 'productInterest', 'budget', 'intent', 'intentScore', 'emotion', 'customerStage', 'aiSummary'].includes(key)
      && value !== '' && value != null && !conflictFields.has(key) && !staleSet.has(key) && !isLocked(key)));
    customer.aiProfile = {
      ...(customer.aiProfile && typeof customer.aiProfile === 'object' ? customer.aiProfile : {}),
      ...acceptedProfileFields,
      confidence: Number(profile.confidence) || 0,
      lastAnalysisId: profile.analysisId || '',
      // Keep the newest message time seen, never move it backwards.
      sourceMessageAt: [customer.aiProfile?.sourceMessageAt, profile.sourceMessageAt].map(text).filter(value => Number.isFinite(Date.parse(value))).sort().at(-1) || '',
      updatedAt: new Date().toISOString(),
    };
    customer.touched = true;
    return { customer, changedFields: [...new Set(changedFields)], conflicts, evidenceRows, staleFields };
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

  return { normalizeAiProfile, mergeAiProfileSafely, shouldAutoSoftDelete, buildGovernanceAction, normalizePhone, normalizeAge, AUTO_SYNC_CONFIDENCE_THRESHOLD };
});



