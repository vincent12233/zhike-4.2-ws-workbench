(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ZhikeWsCore = Object.freeze(api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const text = value => String(value == null ? '' : value).trim();

  function stableHash(value) {
    let hash = 2166136261;
    for (const char of String(value || '')) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
    return (hash >>> 0).toString(36);
  }

  async function retryTransient(operation, options = {}) {
    const attempts = Math.max(1, Math.min(8, Number(options.attempts) || 4));
    const delayOption = options.delayMs;
    let lastError;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      try { return await operation(attempt); }
      catch (error) {
        lastError = error;
        if (attempt + 1 >= attempts) throw error;
        const delay = Math.max(0, Number(typeof delayOption === 'function' ? delayOption(attempt) : delayOption) || 0);
        if (delay) await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
    throw lastError || new Error('操作失败，请重试。');
  }

  function normalizeTranslationSettings(value = {}) {
    return {
      enabled: value.enabled !== false,
      receive: value.receive !== false,
      send: value.send !== false,
      targetLanguage: text(value.targetLanguage) || '中文',
      sendLanguage: text(value.sendLanguage) || '自动识别',
      showOriginal: value.showOriginal !== false,
    };
  }

  function shouldTranslate(settings, direction) {
    const normalized = normalizeTranslationSettings(settings);
    return normalized.enabled && (direction === 'receive' ? normalized.receive : direction === 'send' ? normalized.send : false);
  }

  function translationMode(settings) {
    const normalized = normalizeTranslationSettings(settings);
    if (!normalized.enabled) return '全部关闭';
    if (normalized.receive && normalized.send) return '双向翻译';
    if (normalized.receive) return '只翻译接收';
    if (normalized.send) return '只翻译发送';
    return '仅手动翻译';
  }

  function isSensitiveReply(value) {
    const source = text(value).toLocaleLowerCase();
    if (!source) return false;
    return /(付款|付费|退款|银行卡|银行账户|收款码|密码|验证码|校验码|动态码|身份验证|身份证|护照|金融承诺|法律承诺|医疗建议|价格保证|保价|交付保证|保证到账|guarantee|password|passcode|one[- ]?time password|\botp\b|verification code|refund|payment|bank account|medical advice|legal advice)/i.test(source);
  }

  function parseJsonObject(value) {
    const raw = text(value);
    const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
    try { return { raw, parsed: JSON.parse(cleaned) }; }
    catch { return { raw, parsed: null }; }
  }

  function parseAiResult(value) {
    const { raw, parsed } = parseJsonObject(value);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { summary: '', raw, lowConfidence: true, confidence: 0, error: 'AI 返回格式无法解析，请人工确认。' };
    }
    const confidence = Number(parsed.confidence ?? parsed.intentConfidence ?? 0);
    const contact = parsed.contact && typeof parsed.contact === 'object' && !Array.isArray(parsed.contact) ? {
      name: text(parsed.contact.name),
      phone: text(parsed.contact.phone),
      country: text(parsed.contact.country || parsed.country),
      account: text(parsed.contact.account || parsed.contact.handle),
    } : { name: '', phone: '', country: text(parsed.country), account: '' };
    const result = {
      summary: text(parsed.summary || parsed.sessionSummary),
      intent: text(parsed.intent),
      intentScore: Number.isFinite(Number(parsed.intentScore)) ? Number(parsed.intentScore) : null,
      emotion: text(parsed.emotion),
      urgency: text(parsed.urgency),
      language: text(parsed.language),
      country: contact.country,
      needs: Array.isArray(parsed.needs) ? parsed.needs.map(text).filter(Boolean).slice(0, 20) : [],
      productInterest: Array.isArray(parsed.productInterest) ? parsed.productInterest.map(text).filter(Boolean).slice(0, 20) : text(parsed.productInterest),
      budget: text(parsed.budget),
      contact,
      tags: Array.isArray(parsed.tags) ? parsed.tags.map(text).filter(Boolean).slice(0, 30) : [],
      customerStage: text(parsed.customerStage || parsed.stage),
      nextStep: text(parsed.nextStep),
      followupTime: text(parsed.followupTime),
      replySuggestion: text(parsed.replySuggestion || parsed.reply),
      confidence: Number.isFinite(confidence) ? Math.min(1, Math.max(0, confidence)) : 0,
      lowConfidence: !Number.isFinite(confidence) || confidence < 0.6,
      raw,
    };
    if (result.lowConfidence) result.warning = 'AI 判断置信度较低，请人工确认。';
    return result;
  }

  function parseTranslationBatch(value) {
    const { parsed } = parseJsonObject(value);
    const source = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.translations) ? parsed.translations : [];
    return source.map(item => ({ id: text(item?.id), translation: text(item?.translation || item?.translatedText) }))
      .filter(item => item.id && item.translation).slice(0, 100);
  }

  function normalizePhone(value) {
    let digits = text(value).replace(/\D/g, '');
    if (digits.startsWith('00')) digits = digits.slice(2);
    if (/^91\d{10}$/.test(digits)) digits = digits.slice(2);
    return digits;
  }
  function extractPhone(text) {
    const matches = String(text || '').match(/(?:\+?\d[\d\s().-]{7,}\d)/g) || [];
    return matches.map(normalizePhone).find(value => value.length >= 8 && value.length <= 15) || '';
  }

  function matchCustomer(customers, profile = {}) {
    const rows = (Array.isArray(customers) ? customers : []).filter(item => item && !item.deleted);
    const wsExternalId = text(profile.wsExternalId);
    if (wsExternalId) {
      const candidates = rows.filter(item => {
        const ids = Array.isArray(item.wsExternalIds) ? item.wsExternalIds.map(text) : [];
        return text(item.wsExternalId) === wsExternalId || ids.includes(wsExternalId);
      });
      if (candidates.length === 1) return { kind: 'ws-id', customer: candidates[0], candidates };
      if (candidates.length > 1) return { kind: 'ambiguous', customer: null, candidates };
    }
    const phone = normalizePhone(profile.phone);
    if (phone) {
      const candidates = rows.filter(item => normalizePhone(item.phone || item.rawPhone) === phone);
      if (candidates.length === 1) return { kind: 'phone', customer: candidates[0], candidates };
      if (candidates.length > 1) return { kind: 'ambiguous', customer: null, candidates };
    }
    const account = text(profile.wsAccountId || profile.account);
    if (account) {
      const candidates = rows.filter(item => {
        const ids = Array.isArray(item.wsAccountIds) ? item.wsAccountIds.map(text) : [];
        return text(item.wsAccountId || item.account) === account || ids.includes(account);
      });
      if (candidates.length === 1) return { kind: 'account', customer: candidates[0], candidates };
      if (candidates.length > 1) return { kind: 'ambiguous', customer: null, candidates };
    }
    const conversationId = text(profile.conversationId);
    if (conversationId) {
      const candidates = rows.filter(item => {
        const ids = Array.isArray(item.wsConversationIds) ? item.wsConversationIds.map(text) : [];
        return text(item.wsConversationId) === conversationId || ids.includes(conversationId);
      });
      if (candidates.length === 1) return { kind: 'conversation', customer: candidates[0], candidates };
      if (candidates.length > 1) return { kind: 'ambiguous', customer: null, candidates };
    }
    return { kind: 'new', customer: null, candidates: [] };
  }

  function contextCurrent(context, current = {}) {
    if (!context || typeof context !== 'object') return false;
    const accountId = text(current.accountId || current.activeAccountId) || 'default';
    const sequence = Number(current.sequence ?? current.accountLoadSequence ?? 0);
    const conversationId = text(current.conversationId || current.currentConversationId);
    return text(context.accountId) === accountId
      && Number(context.sequence) === sequence
      && (!text(context.conversationId) || text(context.conversationId) === conversationId);
  }

  function mergeCustomerProfile(customer, profile = {}) {
    if (!customer || typeof customer !== 'object') return customer;
    const accountId = text(profile.wsAccountId || profile.account);
    const externalId = text(profile.wsExternalId);
    const conversationId = text(profile.conversationId);
    const accountIds = new Set(Array.isArray(customer.wsAccountIds) ? customer.wsAccountIds.map(text).filter(Boolean) : []);
    const externalIds = new Set(Array.isArray(customer.wsExternalIds) ? customer.wsExternalIds.map(text).filter(Boolean) : []);
    const conversationIds = new Set(Array.isArray(customer.wsConversationIds) ? customer.wsConversationIds.map(text).filter(Boolean) : []);
    if (accountId) accountIds.add(accountId);
    if (externalId) externalIds.add(externalId);
    if (conversationId) conversationIds.add(conversationId);
    const patch = {
      name: profile.name,
      rawPhone: profile.phone,
      phone: profile.phone ? normalizePhone(profile.phone) : '',
      wsExternalId: customer.wsExternalId || externalId,
      wsConversationId: customer.wsConversationId || conversationId,
      wsAccountId: customer.wsAccountId || accountId,
      country: profile.country,
      language: profile.language,
      productInterest: profile.productInterest,
      budget: profile.budget,
      phase: profile.customerStage,
      intent: profile.intent,
      intentScore: profile.intentScore,
      emotion: profile.emotion,
      aiSummary: profile.aiSummary,
      note: profile.note,
    };
    for (const [key, value] of Object.entries(patch)) if (value !== '' && value != null) customer[key] = value;
    if (accountIds.size) customer.wsAccountIds = [...accountIds].slice(0, 100);
    if (externalIds.size) customer.wsExternalIds = [...externalIds].slice(0, 100);
    if (conversationIds.size) customer.wsConversationIds = [...conversationIds].slice(0, 100);
    if (Array.isArray(profile.tags) && profile.tags.length) customer.tags = [...new Set([...(Array.isArray(customer.tags) ? customer.tags : []), ...profile.tags])];
    customer.touched = true;
    return customer;
  }

  function restoreFollowupSnapshot(hostState, customer, snapshot = {}) {
    if (hostState && Array.isArray(snapshot.followups)) hostState.followups = snapshot.followups;
    if (customer && snapshot.customer) {
      customer.lastFollow = snapshot.customer.lastFollow;
      customer.due = snapshot.customer.due;
    }
    return { hostState, customer };
  }

  function dedupeMessages(messages) {
    const map = new Map();
    let anonymous = 0;
    for (const item of Array.isArray(messages) ? messages : []) {
      if (!item || typeof item !== 'object') continue;
      const key = text(item.externalId) || text(item.id) || `anonymous-${anonymous++}`;
      const previous = map.get(key);
      map.set(key, previous ? { ...previous, ...item } : { ...item });
    }
    return [...map.values()].sort((left, right) => {
      const order = Number(left.order ?? 0) - Number(right.order ?? 0);
      if (order) return order;
      return text(left.createdAt).localeCompare(text(right.createdAt)) || text(left.id).localeCompare(text(right.id));
    });
  }

  function directionForSender(sender, fallback = 'receive') {
    const value = text(sender).replace(/[：:]$/, '');
    if (/^(我|我方|本人|自己|me|you|你)$/i.test(value)) return 'send';
    if (/^(客户|顾客|对方|联系人|customer|client)$/i.test(value)) return 'receive';
    return fallback === 'send' ? 'send' : 'receive';
  }

  function parseVisibleChat(value, defaultDirection = 'receive') {
    const lines = String(value || '').replace(/^\uFEFF/, '').split(/\r?\n/);
    const rows = [];
    let structured = false;
    const add = (sender, message, timestamp = '', raw = '') => {
      const content = text(message);
      if (!content || rows.length >= 200) return;
      rows.push({ direction: directionForSender(sender, defaultDirection), sender: text(sender), text: content.slice(0, 12000), timestamp: text(timestamp).slice(0, 80), raw: text(raw || message).slice(0, 14000) });
    };
    for (const sourceLine of lines) {
      const line = sourceLine.trim();
      if (!line) continue;
      let match = line.match(/^\[([^\]]{3,80})\]\s*([^:：]{1,80})[:：]\s*(.+)$/);
      if (match) { structured = true; add(match[2], match[3], match[1], line); continue; }
      match = line.match(/^((?:\d{1,4}[\/.-]){2}\d{1,4}[^-]{0,40})\s+-\s+([^:：]{1,80})[:：]\s*(.+)$/);
      if (match) { structured = true; add(match[2], match[3], match[1], line); continue; }
      match = line.match(/^\[?\s*(我|我方|本人|me|you|你|客户|顾客|对方|customer|client)\s*\]?[:：]\s*(.+)$/i);
      if (match) { add(match[1], match[2], '', line); continue; }
      if (structured && rows.length) {
        const prior = rows[rows.length - 1];
        prior.text = `${prior.text}\n${line}`.slice(0, 12000);
        prior.raw = `${prior.raw}\n${line}`.slice(0, 14000);
      } else add('', line, '', line);
    }
    return rows.map((row, index) => ({ ...row, index }));
  }

  function visibleChatFingerprint(rows) {
    return stableHash((Array.isArray(rows) ? rows : []).map(row => [row.timestamp, row.sender, row.direction, row.text].join('|')).join('\n'));
  }

  function buildTranscript(messages, options = {}) {
    const maxChars = Math.max(1000, Number(options.maxChars) || 8500);
    const maxMessages = Math.max(1, Number(options.maxMessages) || 40);
    const all = Array.isArray(messages) ? messages : [];
    const source = all.slice(-maxMessages);
    const selected = [];
    let used = 0;
    for (let index = source.length - 1; index >= 0; index--) {
      const item = source[index];
      const label = item.direction === 'send' ? '我' : '客户';
      const line = `${label}：${text(item.originalText).slice(0, 2200)}`;
      if (selected.length && used + line.length + 1 > maxChars) break;
      const allowed = Math.max(0, maxChars - used - (selected.length ? 1 : 0));
      selected.unshift(line.slice(0, allowed));
      used += Math.min(line.length, allowed) + (selected.length > 1 ? 1 : 0);
      if (used >= maxChars) break;
    }
    return { text: selected.join('\n'), included: selected.length, total: source.length, truncated: selected.length < source.length || all.length > source.length, characters: used };
  }

  function suggestedDate(value) {
    const source = text(value);
    const direct = source.match(/\b(20\d{2})[-\/.](\d{1,2})[-\/.](\d{1,2})\b/);
    if (direct) return `${direct[1]}-${direct[2].padStart(2, '0')}-${direct[3].padStart(2, '0')}`;
    const date = new Date();
    if (/明天|tomorrow/i.test(source)) date.setDate(date.getDate() + 1);
    else if (/后天|day after tomorrow/i.test(source)) date.setDate(date.getDate() + 2);
    else return '';
    return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  }

  return {
    normalizeTranslationSettings,
    shouldTranslate,
    translationMode,
    isSensitiveReply,
    parseAiResult,
    parseTranslationBatch,
    normalizePhone,
    extractPhone,
    matchCustomer,
    contextCurrent,
    mergeCustomerProfile,
    restoreFollowupSnapshot,
    dedupeMessages,
    parseVisibleChat,
    visibleChatFingerprint,
    buildTranscript,
    suggestedDate,
    stableHash,
    retryTransient,
  };
});
