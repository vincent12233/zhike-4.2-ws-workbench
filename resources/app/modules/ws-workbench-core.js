(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ZhikeWsCore = Object.freeze(api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const text = value => String(value == null ? '' : value).trim();

  function normalizeTranslationSettings(value = {}) {
    const enabled = value.enabled !== false;
    const settings = {
      enabled,
      receive: enabled && value.receive !== false,
      send: enabled && value.send !== false,
      targetLanguage: text(value.targetLanguage) || '中文',
      showOriginal: value.showOriginal !== false,
    };
    return settings;
  }

  function shouldTranslate(settings, direction) {
    const normalized = normalizeTranslationSettings(settings);
    return normalized.enabled && (direction === 'receive' ? normalized.receive : direction === 'send' ? normalized.send : false);
  }

  function isSensitiveReply(value) {
    const source = text(value).toLocaleLowerCase();
    if (!source) return false;
    return /(付款|付费|退款|银行卡|银行账户|密码|验证码|校验码|身份验证|身份证|护照|金融承诺|法律承诺|医疗建议|价格保证|交付保证|guarantee|password|passcode|verification code|refund|payment|bank account|medical advice|legal advice)/i.test(source);
  }

  function parseAiResult(value) {
    const raw = text(value);
    const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
    let parsed;
    try { parsed = JSON.parse(cleaned); } catch {
      return { summary: '', raw, lowConfidence: true, error: 'AI 返回格式无法解析，请人工确认。' };
    }
    const confidence = Number(parsed.confidence ?? parsed.intentConfidence ?? 0);
    const result = {
      summary: text(parsed.summary || parsed.sessionSummary),
      intent: text(parsed.intent),
      intentScore: Number.isFinite(Number(parsed.intentScore)) ? Number(parsed.intentScore) : null,
      emotion: text(parsed.emotion),
      urgency: text(parsed.urgency),
      language: text(parsed.language),
      needs: Array.isArray(parsed.needs) ? parsed.needs.map(text).filter(Boolean).slice(0, 20) : [],
      productInterest: Array.isArray(parsed.productInterest) ? parsed.productInterest.map(text).filter(Boolean).slice(0, 20) : text(parsed.productInterest),
      budget: text(parsed.budget),
      contact: parsed.contact && typeof parsed.contact === 'object' ? parsed.contact : {},
      tags: Array.isArray(parsed.tags) ? parsed.tags.map(text).filter(Boolean).slice(0, 30) : [],
      customerStage: text(parsed.customerStage || parsed.stage),
      nextStep: text(parsed.nextStep),
      followupTime: text(parsed.followupTime),
      replySuggestion: text(parsed.replySuggestion || parsed.reply),
      confidence: Number.isFinite(confidence) ? confidence : 0,
      lowConfidence: !Number.isFinite(confidence) || confidence < 0.6,
      raw,
    };
    if (result.lowConfidence) result.warning = 'AI 判断置信度较低，请人工确认。';
    return result;
  }

  function normalizePhone(value) {
    return text(value).replace(/\D/g, '').replace(/^91(?=\d{10}$)/, '');
  }

  function matchCustomer(customers, profile = {}) {
    const rows = (Array.isArray(customers) ? customers : []).filter(item => item && !item.deleted);
    const wsExternalId = text(profile.wsExternalId);
    if (wsExternalId) {
      const candidates = rows.filter(item => text(item.wsExternalId) === wsExternalId);
      if (candidates.length === 1) return { kind: 'ws-id', customer: candidates[0], candidates };
      if (candidates.length > 1) return { kind: 'ambiguous', customer: null, candidates };
    }
    const phone = normalizePhone(profile.phone);
    if (phone) {
      const candidates = rows.filter(item => normalizePhone(item.phone || item.rawPhone) === phone);
      if (candidates.length === 1) return { kind: 'phone', customer: candidates[0], candidates };
      if (candidates.length > 1) return { kind: 'ambiguous', customer: null, candidates };
    }
    const conversationId = text(profile.conversationId);
    if (conversationId) {
      const candidates = rows.filter(item => text(item.wsConversationId) === conversationId);
      if (candidates.length === 1) return { kind: 'conversation', customer: candidates[0], candidates };
      if (candidates.length > 1) return { kind: 'ambiguous', customer: null, candidates };
    }
    return { kind: 'new', customer: null, candidates: [] };
  }

  function dedupeMessages(messages) {
    const map = new Map();
    for (const item of Array.isArray(messages) ? messages : []) {
      if (!item || typeof item !== 'object') continue;
      const key = text(item.externalId) || text(item.id);
      if (!key) continue;
      const previous = map.get(key);
      map.set(key, previous ? { ...previous, ...item } : { ...item });
    }
    return [...map.values()].sort((left, right) => {
      const order = Number(left.order ?? 0) - Number(right.order ?? 0);
      if (order) return order;
      return text(left.createdAt).localeCompare(text(right.createdAt)) || text(left.id).localeCompare(text(right.id));
    });
  }

  return { normalizeTranslationSettings, shouldTranslate, isSensitiveReply, parseAiResult, normalizePhone, matchCustomer, dedupeMessages };
});
