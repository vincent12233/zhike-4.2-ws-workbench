(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ZhikeWsCrmSync = Object.freeze(api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const text = value => String(value == null ? '' : value).trim();
  const normalizePhone = value => text(value).replace(/\D/g, '').replace(/^00/, '').replace(/^91(?=\d{10}$)/, '');
  const stableHash = value => {
    let hash = 2166136261;
    for (const char of String(value || '')) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
    return (hash >>> 0).toString(36);
  };

  function shouldAutoSync(analysis) {
    const confidence = Number(analysis?.confidence);
    if (analysis?.error || !Number.isFinite(confidence) || confidence < 0.6) return false;
    const contact = analysis?.contact && typeof analysis.contact === 'object' ? analysis.contact : {};
    const profile = analysis?.profile && typeof analysis.profile === 'object' ? analysis.profile : {};
    const facts = analysis?.profileFacts && typeof analysis.profileFacts === 'object' ? analysis.profileFacts : {};
    const factSignal = Object.values(facts).some(item => {
      if (!item || typeof item !== 'object') return Boolean(text(item));
      const state = text(item.state).toLowerCase();
      return state !== 'declined' && Number(item.confidence ?? confidence) >= 0.6 && text(item.evidence || item.sourceText) && item.value != null && text(item.value) !== '';
    });
    return Boolean(factSignal || text(contact.phone || contact.account || contact.name || analysis.customerName || analysis.phone || profile.origin || profile.age || profile.occupation || profile.job || profile.productInterest || analysis.productInterest || analysis.country || analysis.language || analysis.budget || analysis.intent || analysis.nextStep || analysis.followupTime));
  }

  function listValue(value) {
    return Array.isArray(value) ? value.map(text).filter(Boolean).slice(0, 30) : text(value) ? [text(value)] : [];
  }

  function deriveCustomerProfile(analysis = {}, conversation = {}, accountId = 'default') {
    const result = analysis && typeof analysis === 'object' ? analysis : {};
    const contact = result.contact && typeof result.contact === 'object' ? result.contact : {};
    const profile = result.profile && typeof result.profile === 'object' ? result.profile : {};
    const facts = result.profileFacts && typeof result.profileFacts === 'object' ? result.profileFacts : {};
    const fact = (name) => {
      const item = facts[name];
      if (!item || typeof item !== 'object') return item ?? '';
      const state = text(item.state).toLowerCase();
      return state === 'declined' || Number(item.confidence ?? result.confidence) < 0.6 || !text(item.evidence || item.sourceText) ? '' : item.value ?? '';
    };
    const trusted = shouldAutoSync(result);
    const productInterest = listValue(result.productInterest);
    const tags = listValue(result.tags);
    const phone = trusted ? text(contact.phone || result.phone) : '';
    const name = text(contact.name || result.customerName || fact('preferred_name') || conversation.title || conversation.externalId || '未命名客户');
    return {
      wsExternalId: text(conversation.externalId),
      wsAccountId: text(accountId) || 'default',
      conversationId: text(conversation.id),
      contactAccount: trusted ? text(contact.account || result.account) : '',
      phone,
      name,
      country: trusted ? text(contact.country || result.country) : '',
      language: text(result.language),
      origin: trusted ? text(profile.origin || result.origin || result.leadSource) : '',
      age: trusted && Number.isFinite(Number(profile.age || result.age || fact('age'))) ? Number(profile.age || result.age || fact('age')) : '',
      occupation: trusted ? text(profile.occupation || profile.job || result.occupation || result.job || fact('occupation')) : '',
      productInterest: productInterest.join('、'),
      budget: trusted ? text(result.budget) : '',
      customerStage: text(result.customerStage || result.stage),
      intent: text(result.intent),
      intentScore: Number.isFinite(Number(result.intentScore)) ? Number(result.intentScore) : '',
      emotion: text(result.emotion),
      tags,
      note: text(result.summary),
      aiSummary: text(result.summary),
      source: 'WhatsApp',
      channel: 'WhatsApp',
      assistant: '未分配',
    };
  }

  function dateKey(date) {
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  }
  function calendarKey(year, month, day) {
    const y = Number(year), m = Number(month), d = Number(day);
    if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d) || y < 2000 || y > 2200 || m < 1 || m > 12 || d < 1 || d > 31) return '';
    const date = new Date(y, m - 1, d);
    return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d ? dateKey(date) : '';
  }
  function normalizeDate(value) {
    const source = text(value).normalize('NFKC').replace(/[，。]/g, '').trim();
    if (!source) return '';
    const relative = source.toLocaleLowerCase();
    if (/^(今天|today)$/.test(relative)) return dateKey(new Date());
    if (/^(明天|tomorrow)$/.test(relative)) { const date = new Date(); date.setDate(date.getDate() + 1); return dateKey(date); }
    if (/^(后天|day after tomorrow)$/.test(relative)) { const date = new Date(); date.setDate(date.getDate() + 2); return dateKey(date); }
    let match = source.match(/\b(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})\b/) || source.match(/\b(20\d{2})年(\d{1,2})月(\d{1,2})日?\b/);
    if (match) return calendarKey(match[1], match[2], match[3]);
    match = source.match(/\b(\d{1,2})[-/.](\d{1,2})[-/.](20\d{2})\b/);
    if (match) {
      const first = Number(match[1]), second = Number(match[2]);
      return first > 12 ? calendarKey(match[3], second, first) : second > 12 ? calendarKey(match[3], first, second) : calendarKey(match[3], second, first);
    }
    match = source.match(/\b(\d{1,2})月(\d{1,2})日?\b/);
    if (match) return calendarKey(new Date().getFullYear(), match[1], match[2]);
    if (/^\d{8}$/.test(source)) return calendarKey(source.slice(0, 4), source.slice(4, 6), source.slice(6, 8));
    const parsed = Date.parse(source);
    return Number.isFinite(parsed) ? dateKey(new Date(parsed)) : '';
  }

  function matchCustomerForAutoSync(customers, profile = {}) {
    const rows = (Array.isArray(customers) ? customers : []).filter(item => item && typeof item === 'object');
    const externalId = text(profile.wsExternalId);
    const accountId = text(profile.wsAccountId);
    const belongsToAccount = item => {
      if (!accountId) return true;
      const accounts = Array.isArray(item.wsAccountIds) ? item.wsAccountIds.map(text).filter(Boolean) : [];
      const legacy = text(item.wsAccountId);
      if (!accounts.length && !legacy) return true;
      return accounts.includes(accountId) || legacy === accountId;
    };
    if (externalId) {
      const candidates = rows.filter(item => belongsToAccount(item) && (text(item.wsExternalId) === externalId || (Array.isArray(item.wsExternalIds) && item.wsExternalIds.map(text).includes(externalId))));
      if (candidates.length === 1) return { kind: 'ws-id', customer: candidates[0], candidates };
      if (candidates.length > 1) return { kind: 'ambiguous', customer: null, candidates };
    }
    const phone = normalizePhone(profile.phone);
    if (phone) {
      const candidates = rows.filter(item => normalizePhone(item.phone || item.rawPhone) === phone);
      if (candidates.length === 1) return { kind: 'phone', customer: candidates[0], candidates };
      if (candidates.length > 1) return { kind: 'ambiguous', customer: null, candidates };
    }
    const contactAccount = text(profile.contactAccount || profile.account);
    if (contactAccount) {
      const candidates = rows.filter(item => text(item.wsContactAccount) === contactAccount || (Array.isArray(item.wsContactAccounts) && item.wsContactAccounts.map(text).includes(contactAccount)));
      if (candidates.length === 1) return { kind: 'contact-account', customer: candidates[0], candidates };
      if (candidates.length > 1) return { kind: 'ambiguous', customer: null, candidates };
    }
    const conversationId = text(profile.conversationId);
    if (conversationId) {
      const candidates = rows.filter(item => text(item.wsConversationId) === conversationId || (Array.isArray(item.wsConversationIds) && item.wsConversationIds.map(text).includes(conversationId)));
      if (candidates.length === 1) return { kind: 'conversation', customer: candidates[0], candidates };
      if (candidates.length > 1) return { kind: 'ambiguous', customer: null, candidates };
    }
    return { kind: 'new', customer: null, candidates: [] };
  }

  function deriveFollowupPlan(analysis = {}, analysisMeta = {}, conversation = {}, accountId = 'default') {
    const result = analysis && typeof analysis === 'object' ? analysis : {};
    const noReply = result.noReply && typeof result.noReply === 'object' ? result.noReply : (result.noReplyAssessment && typeof result.noReplyAssessment === 'object' ? result.noReplyAssessment : null);
    const nextDate = normalizeDate(result.followupTime || noReply?.suggestedAt || noReply?.nextAt);
    const urgency = text(result.urgency);
    const intentScore = Number(result.intentScore || 0);
    const urgent = /高|紧急|urgent|hot/i.test(urgency) || intentScore >= 80;
    const note = [text(result.nextStep), text(result.summary), text(noReply?.reason)].filter(Boolean).join('；').slice(0, 1000);
    // A no-reply analysis may still produce a reminder, but only at the
    // provider's suggested/cooldown date; it must never turn every poll into
    // an immediate follow-up task.
    const noReplyReminder = Boolean(noReply?.noReply || noReply?.isNoReply) && Boolean(nextDate);
    const shouldCreate = Boolean((!noReply?.noReply && (note || nextDate || urgent)) || noReplyReminder);
    const analysisId = text(analysisMeta.id);
    const conversationId = text(conversation.id);
    const dedupeKey = `${text(accountId) || 'default'}:${conversationId}:${analysisId || stableHash(JSON.stringify([result.summary, result.nextStep, result.followupTime, result.intentScore]))}`;
    return {
      shouldCreate,
      nextDate,
      note: note || '根据 AI 分析安排下一次跟进',
      priority: urgent ? 'high' : 'normal',
      dedupeKey,
      analysisId,
      conversationId,
      accountId: text(accountId) || 'default',
    };
  }

  function mergeCustomerProfileSafely(customer, profile = {}) {
    if (!customer || typeof customer !== 'object') return { customer, changedFields: [] };
    const changedFields = [];
    const missing = (field, value) => {
      const current = text(value);
      return !current || (field === 'name' && /^(未命名客户|未命名|未知客户|未知|—|-)$/.test(current));
    };
    const fill = (key, value) => {
      if (key === 'age' && value !== '' && value != null && missing(key, customer[key])) {
        const age = Number(value);
        if (Number.isFinite(age) && age >= 0 && age <= 120) { customer[key] = age; changedFields.push(key); }
        return;
      }
      const next = text(value);
      if (!next || !missing(key, customer[key])) return;
      customer[key] = next;
      changedFields.push(key);
    };
    fill('name', profile.name);
    if (!text(customer.rawPhone) && text(profile.phone)) { customer.rawPhone = text(profile.phone); changedFields.push('rawPhone'); }
    if (!normalizePhone(customer.phone) && normalizePhone(profile.phone)) { customer.phone = normalizePhone(profile.phone); changedFields.push('phone'); }
    for (const key of ['country', 'language', 'origin', 'age', 'occupation', 'productInterest', 'budget', 'source', 'channel', 'assistant']) fill(key, profile[key]);
    if (!text(customer.phase) || customer.phase === '新客户') fill('phase', profile.customerStage);
    const aiFields = { intent: profile.intent, intentScore: profile.intentScore, emotion: profile.emotion, aiSummary: profile.aiSummary };
    for (const [key, value] of Object.entries(aiFields)) if (value !== '' && value != null && JSON.stringify(customer[key]) !== JSON.stringify(value)) { customer[key] = value; changedFields.push(key); }
    if (!text(customer.note) && text(profile.note)) { customer.note = text(profile.note); changedFields.push('note'); }
    if (!text(customer.wsContactAccount) && text(profile.contactAccount)) { customer.wsContactAccount = text(profile.contactAccount); changedFields.push('wsContactAccount'); }
    const ids = [
      ['wsExternalIds', profile.wsExternalId],
      ['wsAccountIds', profile.wsAccountId],
      ['wsConversationIds', profile.conversationId],
    ];
    for (const [key, value] of ids) {
      const next = text(value);
      if (!next) continue;
      const list = Array.isArray(customer[key]) ? customer[key].map(text).filter(Boolean) : [];
      if (!list.includes(next)) { customer[key] = [...list, next].slice(-100); changedFields.push(key); }
    }
    if (Array.isArray(profile.tags) && profile.tags.length) {
      const tags = [...new Set([...(Array.isArray(customer.tags) ? customer.tags : []), ...profile.tags.map(text).filter(Boolean)])];
      if (JSON.stringify(tags) !== JSON.stringify(customer.tags || [])) { customer.tags = tags; changedFields.push('tags'); }
    }
    customer.touched = true;
    return { customer, changedFields };
  }

  return { shouldAutoSync, deriveCustomerProfile, deriveFollowupPlan, matchCustomerForAutoSync, mergeCustomerProfileSafely, normalizeDate, normalizePhone };
});
