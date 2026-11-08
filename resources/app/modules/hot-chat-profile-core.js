(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ZhikeHotChatProfile = Object.freeze(api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const PROFILE_FIELDS = Object.freeze(['preferred_name','age','gender','occupation','work_context','is_investor','investment_years','holdings','investment_habits','investment_preferences','family_context','life_interests','future_plans']);
  const STATES = new Set(['known','missing','pending','declined']);
  const COLORS = new Set(['green','blue','amber','red','gray']);
  const text = value => String(value == null ? '' : value).trim();
  const list = value => Array.isArray(value) ? value.map(text).filter(Boolean).slice(0, 30) : (text(value) ? [text(value)] : []);
  const sensitive = /(password|passcode|token|cookie|secret|验证码|校验码|密码|银行卡|收款码|二维码|身份号码|身份证号|护照号)/i;
  const isListField = field => ['holdings','investment_habits','investment_preferences','life_interests'].includes(field);
  const isEmpty = value => value == null || value === '' || (Array.isArray(value) && !value.length);
  function normalizeValue(field, value) {
    if (isListField(field)) return list(value);
    if (field === 'age' || field === 'investment_years') { const match = String(value ?? '').match(/\d+(?:\.\d+)?/); if (!match) return null; const n = Number(match[0]); return Number.isFinite(n) ? n : null; }
    if (field === 'is_investor') { if (value === true || /^(是|有|true|yes|y)$/i.test(text(value))) return true; if (value === false || /^(否|无|false|no|n)$/i.test(text(value))) return false; return null; }
    return text(value);
  }
  function normalizeProfileFact(field, input = {}, options = {}) {
    const source = input && typeof input === 'object' && !Array.isArray(input) ? input : { value: input };
    const value = normalizeValue(field, source.value);
    const confidence = Math.max(0, Math.min(1, Number(source.confidence) || 0));
    const evidence = text(source.evidence || source.sourceText || source.quote).slice(0, 2000);
    const threshold = Number(options.threshold ?? 0.6);
    let state = text(source.state);
    if (!STATES.has(state)) state = isEmpty(value) ? 'missing' : (evidence && confidence >= threshold ? 'known' : (evidence ? 'pending' : 'missing'));
    if (state === 'known' && (!evidence || confidence < threshold || isEmpty(value))) state = evidence && !isEmpty(value) ? 'pending' : 'missing';
    return { field, value, state, confidence, evidence };
  }
  function mergeEvidence(profile = {}, observations = [], options = {}) {
    const result = {};
    for (const field of PROFILE_FIELDS) result[field] = normalizeProfileFact(field, profile[field] || { value: null, state: 'missing' }, options);
    for (const item of Array.isArray(observations) ? observations : []) {
      const field = text(item?.field); if (!PROFILE_FIELDS.includes(field)) continue;
      const fact = normalizeProfileFact(field, item, options);
      if (!fact.evidence || isEmpty(fact.value)) continue;
      const current = result[field];
      current.observations = Array.isArray(current.observations) ? current.observations : [];
      const row = { value: fact.value, confidence: fact.confidence, evidence: fact.evidence, sourceMessageId: text(item.sourceMessageId || item.messageId), analysisId: text(item.analysisId) };
      if (!current.observations.some(existing => JSON.stringify(existing) === JSON.stringify(row))) current.observations.push(row);
      if (!isEmpty(current.value) && JSON.stringify(current.value) !== JSON.stringify(fact.value)) { current.state = 'pending'; continue; }
      if (fact.state === 'known' && current.state !== 'known') Object.assign(current, fact);
      else if (current.state === 'missing' && fact.state === 'pending') Object.assign(current, fact);
    }
    return result;
  }
  function computeCompleteness(profile = {}) { return Math.round(PROFILE_FIELDS.filter(field => (profile[field]?.state || profile[field]) === 'known').length / PROFILE_FIELDS.length * 100); }
  function deriveStatusColor(input = {}) {
    const manual = input.manualOverride || (input.manualColor ? { color: input.manualColor, locked: true } : null);
    if (manual?.locked && COLORS.has(manual.color)) return manual.color;
    if (input.silent || input.customerTemperature === 'silent') return 'gray';
    if (input.urgent || input.highUrgency || input.explicitFollowup) return 'red';
    if (input.interactionDecline || input.intent === 'high' || input.hasInvestmentNeed) return 'amber';
    if (Number(input.completeness ?? input.completenessScore) >= 80 && (input.recentReplyAt || input.recentReply)) return 'green';
    if (input.willingToTalk || input.customerTemperature === 'hot' || input.customerTemperature === 'warm') return 'blue';
    return COLORS.has(input.aiColor) ? input.aiColor : 'gray';
  }
  function deriveNextTopics(input = {}) { return list(input.missingFields || PROFILE_FIELDS.filter(field => input.profile?.[field]?.state !== 'known')).filter((field, index, arr) => PROFILE_FIELDS.includes(field) && arr.indexOf(field) === index).slice(0, 3); }
  function assessNoReply(input = {}) {
    const now = Number(input.now) || Date.now(); const inbound = new Date(input.lastInboundAt || 0).getTime(); const outbound = new Date(input.lastOutboundAt || 0).getTime();
    const days = outbound && now > outbound ? (now - outbound) / 86400000 : 0; const cooldownDays = Number(input.cooldownDays) || 3; const cooldown = Boolean(input.followupCount >= 2 || (days >= cooldownDays && (!inbound || inbound <= outbound)));
    return { cooldown, daysSinceOutbound: Number(days.toFixed(2)), reason: cooldown ? '客户暂未回应，等待合适时机，避免重复催促。' : '可在自然话题中适度跟进。' };
  }
  function applyManualOverride(status = {}, override = {}) { const next = { ...status }; if (override.unlock) { delete next.manualOverride; return next; } if (override.color && COLORS.has(override.color)) { next.color = override.color; next.manualOverride = { color: override.color, locked: override.locked !== false }; } return next; }
  function buildEvent(type, payload = {}, meta = {}) { const clean = value => { if (Array.isArray(value)) return value.map(clean); if (!value || typeof value !== 'object') return sensitive.test(text(value)) ? '[已脱敏]' : value; return Object.fromEntries(Object.entries(value).filter(([key]) => !sensitive.test(key)).map(([key, val]) => [key, clean(val)])); }; return { type: text(type), payload: clean(payload), source: text(meta.source || 'AI'), analysisId: text(meta.analysisId), createdAt: meta.createdAt || new Date().toISOString() }; }
  return { PROFILE_FIELDS, normalizeProfileFact, mergeEvidence, computeCompleteness, deriveStatusColor, deriveNextTopics, assessNoReply, applyManualOverride, buildEvent };
});



