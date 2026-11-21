(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ZhikeAnalysisIncremental = Object.freeze(api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  // V5.0 §15 incremental analysis helpers.
  //
  // - shouldSkipAnalysis stops a repeated analysis of identical chat content,
  //   so a poll cannot charge AI again or churn CRM fields and reminders.
  // - selectMessagesForAnalysis narrows an explicit re-analysis to a date
  //   range. A message whose send time is unknown cannot be proven to fall in
  //   the range, so it is excluded and counted rather than silently included.
  const text = value => String(value == null ? '' : value).trim();
  const messageTime = message => {
    const raw = text(message?.sentAt || message?.data?.sentAt || message?.timestamp || message?.time || message?.date || '');
    const parsed = Date.parse(raw);
    return Number.isFinite(parsed) ? parsed : null;
  };

  function shouldSkipAnalysis(input = {}) {
    const current = text(input.currentFingerprint);
    const last = text(input.lastFingerprint);
    if (input.force === true) return { skip: false, reason: 'forced' };
    if (!current) return { skip: true, reason: 'missing-fingerprint' };
    if (last && last === current) return { skip: true, reason: 'unchanged' };
    return { skip: false, reason: '' };
  }

  function selectMessagesForAnalysis(messages, options = {}) {
    const all = (Array.isArray(messages) ? messages : []).filter(message => message && typeof message === 'object');
    const startText = text(options.rangeStart);
    const endText = text(options.rangeEnd);
    const start = Date.parse(startText);
    const end = Date.parse(endText);
    const hasStart = Number.isFinite(start);
    const hasEnd = Number.isFinite(end);
    if (!hasStart && !hasEnd) return { messages: all, ranged: false, dropped: 0, unknownTime: 0, total: all.length };
    const kept = [];
    let dropped = 0, unknownTime = 0;
    for (const message of all) {
      const time = messageTime(message);
      if (time === null) { unknownTime += 1; continue; }
      if (hasStart && time < start) { dropped += 1; continue; }
      if (hasEnd && time > end) { dropped += 1; continue; }
      kept.push(message);
    }
    return { messages: kept, ranged: true, dropped, unknownTime, total: all.length, rangeStart: startText, rangeEnd: endText };
  }

  return { shouldSkipAnalysis, selectMessagesForAnalysis, messageTime };
});
