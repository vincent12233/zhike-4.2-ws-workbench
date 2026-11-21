(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ZhikeCustomerCompleteness = Object.freeze(api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  // Customer profile completeness (V5.0 §17).
  //
  // The score only counts evidence that actually exists. Placeholders
  // (未命名客户, "WhatsApp", 未分配, "—") and uncertain states (待确认,
  // 状态未知) earn nothing, so fabricating a value cannot raise the score.
  const text = value => String(value == null ? '' : value).normalize('NFKC').trim();
  const list = value => Array.isArray(value)
    ? value.map(text).filter(Boolean)
    : text(value) ? text(value).split(/[、,，;；|\n]/).map(item => item.trim()).filter(Boolean) : [];
  const PLACEHOLDERS = /^(?:未命名客户|未命名|未知客户|未知|无|—|-|--|n\/a|na|null|undefined)$/i;
  const GENERIC_LABELS = /^(?:whatsapp|ws|未分配|未分类|未配置|未标注|暂无|其他|unknown|none)$/i;
  const RELIABLE_GROUP_STATUS = new Set(['在群', '已进群', '已退群', '被移除']);
  const UNCERTAIN_GROUP_STATUS = new Set(['待确认', '状态未知', '未进群', '']);
  const TRUSTED_CONFIDENCE = 0.6;

  const present = (value, { allowGeneric = false } = {}) => {
    const raw = text(value);
    if (!raw || PLACEHOLDERS.test(raw)) return false;
    return allowGeneric || !GENERIC_LABELS.test(raw);
  };
  const normalizedPhone = value => {
    const digits = text(value).replace(/\D/g, '').replace(/^00/, '');
    // A real subscriber number, not a short code or a placeholder.
    if (digits.length < 8 || digits.length > 15) return '';
    return digits.replace(/^91(?=\d{10}$)/, '');
  };
  const firstPresent = values => values.find(value => present(value)) || '';

  // Each component is a real, checkable piece of the customer profile.
  const COMPONENTS = Object.freeze([
    { key: 'identity', label: '可靠身份', weight: 15 },
    { key: 'name', label: '姓名', weight: 8 },
    { key: 'region', label: '地区/城市', weight: 6 },
    { key: 'occupation', label: '职业', weight: 6 },
    { key: 'investmentExperience', label: '投资经验', weight: 8 },
    { key: 'investmentPreference', label: '投资偏好', weight: 8 },
    { key: 'holdings', label: '明确持仓', weight: 8 },
    { key: 'needs', label: '客户需求', weight: 10 },
    { key: 'channel', label: '来源渠道', weight: 8 },
    { key: 'groupStatus', label: '在群状态', weight: 5 },
  ]);
  const CONFIDENCE_WEIGHT = 18;
  const TOTAL = COMPONENTS.reduce((sum, item) => sum + item.weight, 0) + CONFIDENCE_WEIGHT;

  function fieldValues(customer) {
    const c = customer && typeof customer === 'object' ? customer : {};
    const ai = c.aiProfile && typeof c.aiProfile === 'object' ? c.aiProfile : {};
    const tags = list(c.tags);
    return {
      identity: [normalizedPhone(c.phone), normalizedPhone(c.rawPhone),
        ...[...(Array.isArray(c.wsExternalIds) ? c.wsExternalIds : []), c.wsExternalId, c.wsParticipantId].map(value => text(value)).filter(value => value && !PLACEHOLDERS.test(value))].find(Boolean) || '',
      name: [c.name, ai.preferred_name].map(text).find(value => present(value)) || '',
      region: [c.country, c.region, c.city, ai.country].map(text).find(value => present(value)) || '',
      occupation: [c.occupation, c.job, c.work_context, ai.occupation].map(text).find(value => present(value)) || '',
      investmentExperience: [firstPresent([...list(c.investment_years), c.investmentYears, c.investor, c.isInvestor]), c.is_investor === true ? '是' : ''].find(Boolean) || '',
      investmentPreference: [firstPresent([...list(c.investment_preferences), ...list(c.investmentPreferences), ...list(c.productInterest)]), firstPresent(tags.filter(tag => /股|投资|基金|黄金|外汇|加密|短線|长线|偏好/.test(tag)))].find(Boolean) || '',
      holdings: firstPresent([...list(c.holdings), ...list(c.positions)]),
      needs: firstPresent([c.needs, c.customerNeeds, c.demand, c.intent, c.requirement]),
      channel: [firstPresent([c.firstSourceChannel]), firstPresent([c.channel, c.source])].find(Boolean) || '',
      groupStatus: text(c.groupStatus || c.status),
    };
  }

  /**
   * Confidence component. It scales with how much of the profile exists, so a
   * nearly empty record cannot collect full marks, and it discounts present
   * fields that are AI-sourced with weak confidence. Manual values are trusted.
   */
  function confidenceShare(customer, fieldKeys) {
    const sources = customer?.aiFieldSources && typeof customer.aiFieldSources === 'object' ? customer.aiFieldSources : {};
    const presentKeys = fieldKeys.filter(key => key.present);
    const weak = [];
    for (const key of presentKeys) {
      const source = sources[key.name];
      if (!source || typeof source !== 'object') continue;
      const confidence = Number(source.confidence);
      if (Number.isFinite(confidence) && confidence < TRUSTED_CONFIDENCE) weak.push(key.name);
    }
    const trusted = presentKeys.length - weak.length;
    return { share: fieldKeys.length ? trusted / fieldKeys.length : 0, weak };
  }

  function computeProfileCompleteness(customer) {
    const values = fieldValues(customer);
    const components = COMPONENTS.map(component => {
      const has = Boolean(values[component.key]);
      return {
        key: component.key,
        label: component.label,
        weight: component.weight,
        earned: has ? component.weight : 0,
        missing: !has,
      };
    });
    const ambiguousGroup = UNCERTAIN_GROUP_STATUS.has(text(customer?.groupStatus || customer?.status)) && !RELIABLE_GROUP_STATUS.has(text(customer?.groupStatus || customer?.status));
    if (ambiguousGroup) {
      const group = components.find(item => item.key === 'groupStatus');
      group.earned = 0;
      group.missing = true;
    }
    const { share, weak } = confidenceShare(customer, components.map(item => ({ name: item.key, present: !item.missing })));
    const earned = components.reduce((sum, item) => sum + item.earned, 0) + Math.round(CONFIDENCE_WEIGHT * share);
    const score = Math.max(0, Math.min(100, Math.round((earned / TOTAL) * 100)));
    const missing = components.filter(item => item.missing).map(item => item.label);
    if (weak.length) missing.push('字段可信度待确认');
    const band = score >= 85 ? 'complete' : score >= 60 ? 'good' : score >= 35 ? 'partial' : 'sparse';
    const BAND_LABEL = { complete: '资料完整', good: '基本完整', partial: '需要补齐', sparse: '资料很少' };
    return {
      score,
      band,
      bandLabel: BAND_LABEL[band],
      components,
      missing,
      missingCount: missing.length,
      weakFields: weak,
      totalWeight: TOTAL,
      earnedWeight: earned,
    };
  }

  return { computeProfileCompleteness, COMPONENTS, CONFIDENCE_WEIGHT };
});
