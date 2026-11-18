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
  const PROFILE_FIELD_NAMES = Object.freeze([
    'preferred_name', 'age', 'gender', 'occupation', 'work_context',
    'is_investor', 'investment_years', 'holdings', 'investment_habits',
    'investment_preferences', 'family_context', 'life_interests', 'future_plans',
  ]);
  const AUTO_SYNC_CONFIDENCE_THRESHOLD = 0.6;
  const redactSensitive = value => text(value)
    .replace(/(?:password|passcode|token|cookie|secret|api[\s_-]?key)\s*[:：=]?\s*[^\s，。；;]+/ig, '[已脱敏]')
    .replace(/(?:验证码|校验码|密码|银行卡(?:号)?|收款码|二维码|身份证(?:号)?|护照(?:号)?)\s*[:：=]?\s*[^\s，。；;]+/ig, '[已脱敏]');
  const redactEvidenceValue = value => {
    if (Array.isArray(value)) return value.map(redactEvidenceValue);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, redactEvidenceValue(item)]));
    return typeof value === 'string' ? redactSensitive(value) : value;
  };

  function shouldAutoSync(analysis) {
    const confidence = Number(analysis?.confidence);
    if (analysis?.error || (!Number.isFinite(confidence) && !analysis)) return false;
    const contact = analysis?.contact && typeof analysis.contact === 'object' ? analysis.contact : {};
    const profile = analysis?.profile && typeof analysis.profile === 'object' ? analysis.profile : {};
    const facts = analysis?.profileFacts && typeof analysis.profileFacts === 'object' ? analysis.profileFacts : {};
    const factSignal = Object.values(facts).some(item => {
      if (!item || typeof item !== 'object') return Boolean(text(item));
      const state = text(item.state).toLowerCase();
      return state !== 'declined' && text(item.evidence || item.sourceText) && item.value != null && text(item.value) !== '';
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
      return state === 'declined' || !text(item.evidence || item.sourceText) ? '' : item.value ?? '';
    };
    const trusted = shouldAutoSync(result);
    const productInterest = listValue(result.productInterest);
    const tags = listValue(result.tags);
    const strategy = result.followupStrategy && typeof result.followupStrategy === 'object' ? result.followupStrategy : {};
    const profileEvidence = {};
    const knownProfileFields = [];
    for (const field of PROFILE_FIELD_NAMES) {
      const item = facts[field] && typeof facts[field] === 'object' ? facts[field] : null;
      const evidence = text(item?.evidence || item?.sourceText);
      const value = item?.value;
      if (item && text(item.state).toLowerCase() !== 'declined' && evidence && value != null && text(value) !== '') {
        knownProfileFields.push(field);
        profileEvidence[field] = { value: redactEvidenceValue(value), evidence: redactSensitive(evidence).slice(0, 500), confidence: Math.max(0, Math.min(1, Number(item.confidence) || Number(result.confidence) || 0)) };
      }
    }
    const missingProfileFields = PROFILE_FIELD_NAMES.filter(field => !knownProfileFields.includes(field));
    const phone = trusted ? text(contact.phone || result.phone) : '';
    const conversationTitle = text(conversation.title);
    const titleDigits = conversationTitle.replace(/\D/g, '');
    const titleIsIdentity = (titleDigits.length >= 7 && titleDigits.length >= conversationTitle.replace(/\s/g, '').length * 0.6)
      || (conversationTitle && conversationTitle === text(conversation.externalId));
    // A WhatsApp list title is display metadata, not evidence of the person's
    // name. Only an explicit AI contact/name fact may populate the profile;
    // otherwise keep the neutral placeholder and let governance preserve the
    // existing customer name without creating a false conflict.
    const name = text(contact.name || result.customerName || fact('preferred_name')) || '未命名客户';
    return {
      customerId: text(result.customerId || result.customer_id || contact.customerId),
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
      aiProfileCompleteness: Math.round((knownProfileFields.length / PROFILE_FIELD_NAMES.length) * 100),
      aiProfileKnownFields: knownProfileFields,
      aiProfileMissingFields: missingProfileFields,
      aiProfileEvidence: profileEvidence,
      aiProfileAnalyzedAt: new Date().toISOString(),
      aiFollowupPriorityScore: Math.max(0, Math.min(100, Number(strategy.priorityScore) || Number(result.intentScore) || 0)),
      aiQualificationScore: Math.max(0, Math.min(100, Number(strategy.qualificationScore) || 0)),
      aiQualificationReason: text(strategy.qualificationReason),
      aiEngagementScore: Math.max(0, Math.min(100, Number(strategy.engagementScore) || 0)),
      aiEngagementReason: text(strategy.engagementReason),
      aiPriorityScoreReason: text(strategy.scoreReason),
      aiPriorityScoreConfidence: Math.max(0, Math.min(1, Number(strategy.scoreConfidence) || Number(result.confidence) || 0)),
      aiPriorityBand: text(strategy.priorityBand),
      aiScoringVersion: text(strategy.scoringVersion || 'money-engagement-v1'),
      aiFollowupReason: text(strategy.reason || result.nextStep),
      aiFollowupObjective: text(strategy.objective),
      aiSuggestedFollowupAt: text(strategy.bestTime || result.followupTime),
      aiSuggestedOpener: text(strategy.opener || result.replySuggestion),
      aiFollowupTalkingPoints: listValue(strategy.talkingPoints).slice(0, 5),
      aiFollowupAvoidTopics: listValue(strategy.avoidTopics).slice(0, 5),
      aiReanalyzeWhen: listValue(strategy.reanalyzeWhen).slice(0, 5),
      source: 'WhatsApp',
      channel: 'WhatsApp',
      assistant: '未分配',
      confidence: Math.max(0, Math.min(1, Number(result.confidence) || 0)),
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
    const resolve = (kind, candidates) => {
      if (candidates.length === 1 && candidates[0]?.deleted) return { kind: 'awaiting-restore', customer: candidates[0], candidates };
      if (candidates.length === 1) return { kind, customer: candidates[0], candidates };
      if (candidates.length > 1) return { kind: 'ambiguous', customer: null, candidates };
      return null;
    };
    const explicitCustomerId = text(profile.customerId || profile.customer_id);
    if (explicitCustomerId) {
      const candidates = rows.filter(item => text(item.id) === explicitCustomerId);
      const resolved = resolve('explicit-id', candidates); if (resolved) return resolved;
    }
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
      const resolved = resolve('ws-id', candidates); if (resolved) return resolved;
    }
    const identityConfidence = Number(profile.phoneConfidence ?? profile.identityConfidence ?? profile.confidence);
    const phoneTrusted = profile.phoneVerified === true
      || text(profile.phoneSource).toLowerCase() === 'conversation'
      || (Number.isFinite(identityConfidence) && identityConfidence >= 0.6);
    const phone = phoneTrusted ? normalizePhone(profile.phone) : '';
    if (phone) {
      const candidates = rows.filter(item => normalizePhone(item.phone || item.rawPhone) === phone);
      const resolved = resolve('phone', candidates); if (resolved) return resolved;
    }
    const contactAccount = text(profile.contactAccount || profile.account);
    if (contactAccount) {
      const candidates = rows.filter(item => text(item.wsContactAccount) === contactAccount || (Array.isArray(item.wsContactAccounts) && item.wsContactAccounts.map(text).includes(contactAccount)));
      const resolved = resolve('contact-account', candidates); if (resolved) return resolved;
    }
    const conversationId = text(profile.conversationId);
    if (conversationId) {
      const candidates = rows.filter(item => text(item.wsConversationId) === conversationId || (Array.isArray(item.wsConversationIds) && item.wsConversationIds.map(text).includes(conversationId)));
      const resolved = resolve('conversation', candidates); if (resolved) return resolved;
    }
    return { kind: 'new', customer: null, candidates: [] };
  }

  function deriveFollowupPlan(analysis = {}, analysisMeta = {}, conversation = {}, accountId = 'default') {
    const result = analysis && typeof analysis === 'object' ? analysis : {};
    const noReply = result.noReply && typeof result.noReply === 'object' ? result.noReply : (result.noReplyAssessment && typeof result.noReplyAssessment === 'object' ? result.noReplyAssessment : null);
    const strategy = result.followupStrategy && typeof result.followupStrategy === 'object' ? result.followupStrategy : {};
    let nextDate = normalizeDate(strategy.bestTime || result.followupTime || noReply?.suggestedAt || noReply?.nextAt);
    const urgency = text(result.urgency);
    const intentScore = Number(result.intentScore || 0);
    const evidenceItems = [strategy.qualificationReason, strategy.engagementReason, strategy.reason, strategy.objective, result.nextStep, noReply?.reason].map(text).filter(Boolean);
    const scoreConfidence = Math.max(0, Math.min(1, Number(strategy.scoreConfidence) || Number(result.confidence) || 0));
    const explicitDecision = strategy.shouldFollowUp === true;
    const noReplyEvidence = Boolean(noReply?.noReply || noReply?.isNoReply) && Boolean(text(noReply?.reason) || text(noReply?.suggestedAt || noReply?.nextAt));
    const hasEvidence = evidenceItems.length > 0 && (explicitDecision || noReplyEvidence || intentScore > 0 || /高|紧急|urgent|hot/i.test(urgency));
    const priorityScore = Math.max(0, Math.min(100, Number(strategy.priorityScore) || (hasEvidence ? intentScore || (/高|紧急|urgent|hot/i.test(urgency) ? 85 : 0) : 0)));
    const urgent = /高|紧急|urgent|hot/i.test(urgency) || priorityScore >= 80;
    // When AI identifies a follow-up need but omits an exact date, schedule a
    // conservative default instead of silently losing the reminder.
    if (!nextDate && strategy.shouldFollowUp !== false && hasEvidence) {
      const delay = Boolean(noReply?.noReply || noReply?.isNoReply)
        ? Math.max(1, Math.min(30, Number(noReply?.cooldownDays) || 3))
        : priorityScore >= 85 ? 0 : priorityScore >= 70 ? 1 : priorityScore >= 50 ? 3 : 7;
      const fallbackDate = new Date();
      fallbackDate.setDate(fallbackDate.getDate() + delay);
      nextDate = dateKey(fallbackDate);
    }
    const note = [text(strategy.reason), text(strategy.objective), text(result.nextStep), text(result.summary), text(noReply?.reason)].filter(Boolean).join('；').slice(0, 1000);
    // A no-reply analysis may still produce a reminder, but only at the
    // provider's suggested/cooldown date; it must never turn every poll into
    // an immediate follow-up task.
    const noReplyReminder = Boolean(noReply?.noReply || noReply?.isNoReply) && Boolean(nextDate);
    const shouldCreate = strategy.shouldFollowUp !== false && hasEvidence && Boolean((!noReply?.noReply && (note || nextDate || urgent)) || noReplyReminder);
    const analysisId = text(analysisMeta.id);
    const conversationId = text(conversation.id);
    const dedupeKey = `${text(accountId) || 'default'}:${conversationId}:${analysisId || stableHash(JSON.stringify([result.summary, result.nextStep, result.followupTime, result.intentScore]))}`;
    return {
      shouldCreate,
      nextDate,
      note: note || '根据 AI 分析安排下一次跟进',
      priority: urgent ? 'high' : 'normal',
      priorityScore,
      qualificationScore: Math.max(0, Math.min(100, Number(strategy.qualificationScore) || 0)),
      qualificationReason: text(strategy.qualificationReason),
      engagementScore: Math.max(0, Math.min(100, Number(strategy.engagementScore) || 0)),
      engagementReason: text(strategy.engagementReason),
      scoreReason: text(strategy.scoreReason),
      scoreConfidence,
      priorityBand: text(strategy.priorityBand || (priorityScore >= 85 ? 'critical' : priorityScore >= 70 ? 'high' : priorityScore >= 50 ? 'medium' : 'low')),
      scoringVersion: text(strategy.scoringVersion || 'money-engagement-v1'),
      reminderCadence: priorityScore >= 85 ? 'today' : priorityScore >= 70 ? 'next-day' : priorityScore >= 50 ? 'within-3-days' : 'light-7-days',
      reason: text(strategy.reason || result.nextStep || noReply?.reason),
      objective: text(strategy.objective),
      opener: text(strategy.opener || result.replySuggestion),
      talkingPoints: listValue(strategy.talkingPoints).slice(0, 5),
      avoidTopics: listValue(strategy.avoidTopics).slice(0, 5),
      channel: text(strategy.channel || 'WhatsApp'),
      reanalyzeWhen: listValue(strategy.reanalyzeWhen).slice(0, 5),
      evidenceGate: { passed: hasEvidence, explicitDecision, evidenceCount: evidenceItems.length, reasons: evidenceItems.slice(0, 6) },
      scoringWeights: { qualification: 0.55, engagement: 0.45, investmentYears: 0 },
      dedupeKey,
      analysisId,
      conversationId,
      accountId: text(accountId) || 'default',
    };
  }

  function mergeCustomerProfileSafely(customer, profile = {}) {
    if (!customer || typeof customer !== 'object') return { customer, changedFields: [] };
    const changedFields = [];
    const lockedFields = new Set([
      ...(Array.isArray(customer.manualLockedFields) ? customer.manualLockedFields : []),
      ...(Array.isArray(customer.aiLockedFields) ? customer.aiLockedFields : []),
    ].map(text));
    const isLocked = field => lockedFields.has(field);
    const missing = (field, value) => {
      const current = text(value);
      return !current || (field === 'name' && /^(未命名客户|未命名|未知客户|未知|—|-)$/.test(current));
    };
    const fill = (key, value) => {
      if (isLocked(key)) return;
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
    if (!isLocked('rawPhone') && !text(customer.rawPhone) && text(profile.phone)) { customer.rawPhone = text(profile.phone); changedFields.push('rawPhone'); }
    if (!isLocked('phone') && !normalizePhone(customer.phone) && normalizePhone(profile.phone)) { customer.phone = normalizePhone(profile.phone); changedFields.push('phone'); }
    for (const key of ['country', 'language', 'origin', 'age', 'occupation', 'productInterest', 'budget', 'source', 'channel', 'assistant']) fill(key, profile[key]);
    if (!text(customer.phase) || customer.phase === '新客户') fill('phase', profile.customerStage);
    const aiFields = { intent: profile.intent, intentScore: profile.intentScore, emotion: profile.emotion, aiSummary: profile.aiSummary };
    for (const [key, value] of Object.entries(aiFields)) {
      if (isLocked(key) || value === '' || value == null || JSON.stringify(customer[key]) === JSON.stringify(value)) continue;
      const priorAiValue = customer.aiProfile && typeof customer.aiProfile === 'object' ? customer.aiProfile[key] : undefined;
      const aiManaged = Boolean(customer.aiFieldSources?.[key])
        || (priorAiValue !== undefined && JSON.stringify(priorAiValue) === JSON.stringify(customer[key]));
      if (missing(key, customer[key]) || aiManaged) { customer[key] = value; changedFields.push(key); }
    }
    const currentKnown = Array.isArray(customer.aiProfileKnownFields) ? customer.aiProfileKnownFields.map(text).filter(field => PROFILE_FIELD_NAMES.includes(field)) : [];
    const incomingKnown = Array.isArray(profile.aiProfileKnownFields) ? profile.aiProfileKnownFields.map(text).filter(field => PROFILE_FIELD_NAMES.includes(field)) : [];
    const mergedKnown = [...new Set([...currentKnown, ...incomingKnown])];
    const mergedMissing = PROFILE_FIELD_NAMES.filter(field => !mergedKnown.includes(field));
    const currentEvidence = customer.aiProfileEvidence && typeof customer.aiProfileEvidence === 'object' && !Array.isArray(customer.aiProfileEvidence) ? customer.aiProfileEvidence : {};
    const incomingEvidence = profile.aiProfileEvidence && typeof profile.aiProfileEvidence === 'object' && !Array.isArray(profile.aiProfileEvidence) ? redactEvidenceValue(profile.aiProfileEvidence) : {};
    const mergedEvidence = { ...currentEvidence, ...incomingEvidence };
    const computedCompleteness = Math.round((mergedKnown.length / PROFILE_FIELD_NAMES.length) * 100);
    const mergedCompleteness = Math.min(100, Math.max(0,
      Number(customer.aiProfileCompleteness) || 0,
      Number(profile.aiProfileCompleteness) || 0,
      computedCompleteness,
    ));
    const cumulativeFields = {
      aiProfileCompleteness: mergedCompleteness,
      aiProfileKnownFields: mergedKnown,
      aiProfileMissingFields: mergedMissing,
      aiProfileEvidence: mergedEvidence,
    };
    for (const [key, value] of Object.entries(cumulativeFields)) {
      if (isLocked(key)) continue;
      if (JSON.stringify(customer[key]) !== JSON.stringify(value)) { customer[key] = value; changedFields.push(key); }
    }
    const decisionFields = {
      aiProfileAnalyzedAt: profile.aiProfileAnalyzedAt,
      aiFollowupPriorityScore: profile.aiFollowupPriorityScore,
      aiQualificationScore: profile.aiQualificationScore,
      aiQualificationReason: profile.aiQualificationReason,
      aiEngagementScore: profile.aiEngagementScore,
      aiEngagementReason: profile.aiEngagementReason,
      aiPriorityScoreReason: profile.aiPriorityScoreReason,
      aiPriorityScoreConfidence: profile.aiPriorityScoreConfidence,
      aiPriorityBand: profile.aiPriorityBand,
      aiScoringVersion: profile.aiScoringVersion,
      aiFollowupReason: profile.aiFollowupReason,
      aiFollowupObjective: profile.aiFollowupObjective,
      aiSuggestedFollowupAt: profile.aiSuggestedFollowupAt,
      aiSuggestedOpener: profile.aiSuggestedOpener,
      aiFollowupTalkingPoints: profile.aiFollowupTalkingPoints,
      aiFollowupAvoidTopics: profile.aiFollowupAvoidTopics,
      aiReanalyzeWhen: profile.aiReanalyzeWhen,
    };
    for (const [key, value] of Object.entries(decisionFields)) {
      if (isLocked(key) || value == null || value === '' || (Array.isArray(value) && !value.length)) continue;
      if (JSON.stringify(customer[key]) !== JSON.stringify(value)) { customer[key] = value; changedFields.push(key); }
    }
    if (!isLocked('note') && !text(customer.note) && text(profile.note)) { customer.note = text(profile.note); changedFields.push('note'); }
    if (!isLocked('wsContactAccount') && !text(customer.wsContactAccount) && text(profile.contactAccount)) { customer.wsContactAccount = text(profile.contactAccount); changedFields.push('wsContactAccount'); }
    const ids = [
      ['wsExternalIds', profile.wsExternalId],
      ['wsAccountIds', profile.wsAccountId],
      ['wsConversationIds', profile.conversationId],
    ];
    for (const [key, value] of ids) {
      const next = text(value);
      if (!next || isLocked(key)) continue;
      const list = Array.isArray(customer[key]) ? customer[key].map(text).filter(Boolean) : [];
      if (!list.includes(next)) { customer[key] = [...list, next].slice(-100); changedFields.push(key); }
    }
    if (!isLocked('tags') && Array.isArray(profile.tags) && profile.tags.length) {
      const tags = [...new Set([...(Array.isArray(customer.tags) ? customer.tags : []), ...profile.tags.map(text).filter(Boolean)])];
      if (JSON.stringify(tags) !== JSON.stringify(customer.tags || [])) { customer.tags = tags; changedFields.push('tags'); }
    }
    customer.touched = true;
    return { customer, changedFields };
  }

  return { shouldAutoSync, deriveCustomerProfile, deriveFollowupPlan, matchCustomerForAutoSync, mergeCustomerProfileSafely, normalizeDate, normalizePhone, AUTO_SYNC_CONFIDENCE_THRESHOLD };
});
