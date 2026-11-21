(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ZhikeInvestmentProfile = Object.freeze(api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  // V5.0 §14/§19: the investment profile the AI extracts, shown in the 360.
  // Only stored values are displayed; nothing is inferred, and a missing value
  // is 未记录. Confirmed (non-AI) values are preferred over AI guesses when both
  // exist, because the customer's own record outranks an extraction.
  const text = value => String(value == null ? '' : value).trim();
  const list = value => Array.isArray(value)
    ? value.map(text).filter(Boolean)
    : text(value) ? text(value).split(/[、,，;；|\n]/).map(item => item.trim()).filter(Boolean) : [];
  const PLACEHOLDER = /^(?:unknown|anonymous|undefined|null|n\/a|none|未知|未记录|-|—)$/i;
  const usable = value => {
    const raw = text(value);
    return raw && !PLACEHOLDER.test(raw) ? raw : '';
  };
  const aiOf = customer => customer?.aiProfile && typeof customer.aiProfile === 'object' ? customer.aiProfile : {};
  const first = (...values) => values.map(usable).find(Boolean) || '';
  const joined = (...values) => {
    for (const value of values) {
      const items = list(value).map(usable).filter(Boolean);
      if (items.length) return [...new Set(items)].join('、');
    }
    return '';
  };

  function investmentFields(customer) {
    const c = customer && typeof customer === 'object' ? customer : {};
    const ai = aiOf(c);
    const sources = c.aiFieldSources && typeof c.aiFieldSources === 'object' ? c.aiFieldSources : {};
    const isInvestor = c.investor === true || c.isInvestor === true || ai.is_investor === true || ai.is_investor === '是'
      ? '是'
      : c.investor === false || c.isInvestor === false || ai.is_investor === false || ai.is_investor === '否' ? '否' : '';
    const row = (label, value) => [label, value || '未记录'];
    return [
      row('是否股民', isInvestor),
      row('投资经验', first(c.investmentYears, c.investment_years, ai.investment_years)),
      row('投资偏好', joined(c.investmentPreferences, c.investment_preferences, ai.investment_preferences)),
      row('关注股票', joined(c.watchlist, c.stocksOfInterest, c.stockInterest)),
      row('关注产品', joined(c.productInterest, ai.investment_preferences)),
      row('明确持仓', joined(c.holdings, c.positions, ai.holdings)),
      row('客户需求', first(c.needs, c.customerNeeds, c.demand, c.intent, ai.intent)),
      row('意向评分', Number.isFinite(Number(c.intentScore ?? ai.intentScore)) && (c.intentScore ?? ai.intentScore) !== '' && (c.intentScore ?? ai.intentScore) != null ? `${Math.max(0, Math.min(100, Number(c.intentScore ?? ai.intentScore)))}/100` : ''),
      row('情绪', first(c.emotion, ai.emotion)),
      row('WhatsApp 身份', joined(c.wsExternalId, c.wsExternalIds, c.wsParticipantId, c.wsParticipantIds, c.wsContactId)),
      row('AI 字段来源', Object.keys(sources).length ? `${Object.keys(sources).length} 个字段由 AI 提供，可在下方“字段来源”核对` : ''),
    ];
  }

  return { investmentFields };
});
