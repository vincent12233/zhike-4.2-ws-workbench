(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ZhikeAiMockProvider = Object.freeze(api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const text = value => String(value == null ? '' : value).trim();
  const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));
  function createMockProvider(options = {}) {
    const fixtures = options.fixtures && typeof options.fixtures === 'object' ? options.fixtures : {};
    return Object.freeze({
      name: 'isolated-mock',
      model: 'fixture-v1',
      async analyze(input = {}, signal) {
        if (signal?.aborted) throw new Error('AI 任务已取消');
        const fixture = fixtures[text(input.jobId) || text(input.conversationId)] || input.fixture || {};
        const result = {
          summary: text(fixture.summary || input.summary || ''),
          nextStep: text(fixture.nextStep || ''),
          confidence: Math.max(0, Math.min(1, Number(fixture.confidence ?? input.confidence) || 0)),
          profileFacts: clone(fixture.profileFacts || input.profileFacts || {}),
          evidence: Array.isArray(fixture.evidence || input.evidence) ? clone(fixture.evidence || input.evidence) : [],
          followup: clone(fixture.followup || null),
          provider: 'isolated-mock',
        };
        for (const fact of Object.values(result.profileFacts)) {
          if (!fact || typeof fact !== 'object' || fact.value == null || !text(fact.evidence || fact.sourceText)) delete result.profileFacts[Object.keys(result.profileFacts).find(key => result.profileFacts[key] === fact)];
        }
        return result;
      },
    });
  }
  return Object.freeze({ createMockProvider });
});
