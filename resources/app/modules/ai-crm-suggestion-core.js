(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ZhikeAiCrmSuggestions = Object.freeze(api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const text = value => String(value == null ? '' : value).trim();
  const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));
  const REVIEW_STATES = Object.freeze(['pending', 'approved', 'rejected', 'conflict', 'applied']);
  const FIELD_NAMES = Object.freeze(['name','phone','country','language','origin','age','occupation','productInterest','budget','intent','intentScore','emotion','customerStage','preferred_name','gender','work_context','is_investor','investment_years','holdings','investment_habits','investment_preferences','family_context','life_interests','future_plans']);
  const DEFAULT_METADATA_FIELDS = new Set(['source','channel','assistant']);
  const normalizeValue = (field, value) => {
    if (Array.isArray(value)) return value.map(text).filter(Boolean);
    if (field === 'phone') return text(value).replace(/\D/g, '').replace(/^00/, '').replace(/^91(?=\d{10}$)/, '');
    return typeof value === 'string' ? text(value) : value;
  };
  const isBlank = value => value == null || text(value) === '' || /^(未命名客户|未命名|未知客户|未知|—|-)$/.test(text(value));
  const isLocked = (customer, field) => new Set([...(customer?.manualLockedFields || []), ...(customer?.aiLockedFields || [])].map(text)).has(field);
  function validateCandidate(input = {}) {
    const fieldName = text(input.fieldName || input.field_name);
    if (!FIELD_NAMES.includes(fieldName) || DEFAULT_METADATA_FIELDS.has(fieldName)) throw new Error('AI 候选字段不在允许的 CRM 字段范围内');
    const customerId = text(input.customerId || input.customer_id);
    if (!customerId) throw new Error('AI 候选必须关联已存在的客户');
    const evidence = text(input.sourceEvidence || input.source_evidence || input.evidence);
    if (!evidence) throw new Error('AI 候选必须包含来源证据');
    const value = normalizeValue(fieldName, input.candidateValue ?? input.candidate_value);
    if (value == null || isBlank(value)) throw new Error('AI 候选值不能为空');
    const confidence = Math.max(0, Math.min(1, Number(input.confidence) || 0));
    return { customerId, fieldName, candidateValue: clone(value), existingValue: clone(input.existingValue ?? input.existing_value ?? null), sourceEvidence: evidence.slice(0, 2000), sourceMessageId: text(input.sourceMessageId || input.source_message_id), sourceAt: text(input.sourceAt || input.source_at), confidence, verificationStatus: 'pending' };
  }
  function preview(customer, candidate) {
    const item = validateCandidate(candidate);
    const existing = item.existingValue ?? customer?.[item.fieldName] ?? null;
    item.existingValue = clone(existing);
    if (!customer || text(customer.id) !== item.customerId) return { ...item, decision: 'conflict', conflictReason: '客户不存在或身份不匹配' };
    if (isLocked(customer, item.fieldName)) return { ...item, decision: 'conflict', conflictReason: '字段由人工资料锁定' };
    if (!isBlank(existing)) {
      const same = JSON.stringify(normalizeValue(item.fieldName, existing)) === JSON.stringify(normalizeValue(item.fieldName, item.candidateValue));
      return { ...item, decision: same ? 'approved' : 'conflict', conflictReason: same ? '' : '现有资料已有值，禁止 AI 覆盖' };
    }
    return { ...item, decision: 'approved', conflictReason: '' };
  }
  function approve(customer, candidate) {
    const result = preview(customer, candidate);
    if (result.decision !== 'approved') return { applied: false, status: 'conflict', suggestion: { ...result, verificationStatus: 'conflict' } };
    const next = clone(customer);
    next[result.fieldName] = clone(result.candidateValue);
    return { applied: true, status: 'applied', suggestion: { ...result, appliedValue: clone(result.candidateValue), verificationStatus: 'applied' }, customer: next };
  }
  function reject(candidate, reason = '人工拒绝') {
    const item = validateCandidate(candidate);
    return { ...item, verificationStatus: 'rejected', conflictReason: text(reason).slice(0, 500) };
  }
  function buildCandidates(result = {}, options = {}) {
    const customerId = text(options.customerId);
    if (!customerId) return [];
    const facts = result.profileFacts && typeof result.profileFacts === 'object' ? result.profileFacts : {};
    const evidence = Array.isArray(result.evidence) ? result.evidence : [];
    const rows = [];
    for (const [fieldName, fact] of Object.entries(facts)) {
      if (!FIELD_NAMES.includes(fieldName) || !fact || typeof fact !== 'object' || fact.value == null || isBlank(fact.value)) continue;
      const sourceEvidence = text(fact.evidence || fact.sourceText || evidence.find(item => text(item.field) === fieldName)?.text);
      if (!sourceEvidence) continue;
      rows.push(validateCandidate({ customerId, fieldName, candidateValue: fact.value, sourceEvidence, sourceMessageId: fact.messageId || options.sourceMessageId, sourceAt: fact.sourceAt || options.sourceAt, confidence: fact.confidence ?? result.confidence }));
    }
    for (const item of evidence) {
      const fieldName = text(item?.field);
      if (!FIELD_NAMES.includes(fieldName) || rows.some(row => row.fieldName === fieldName) || item?.value == null) continue;
      rows.push(validateCandidate({ customerId, fieldName, candidateValue: item.value, sourceEvidence: item.text || item.sourceText, sourceMessageId: item.messageId || options.sourceMessageId, sourceAt: item.sourceAt || options.sourceAt, confidence: item.confidence ?? result.confidence }));
    }
    return rows;
  }
  return Object.freeze({ REVIEW_STATES, FIELD_NAMES, normalizeValue, isBlank, isLocked, validateCandidate, preview, approve, reject, buildCandidates });
});
