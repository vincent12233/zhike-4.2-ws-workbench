'use strict';
const { createHash } = require('node:crypto');
const MODEL_SOURCE = 'https://developers.openai.com/api/docs/models/gpt-5.4-mini.md';
const RESPONSE_SOURCE = 'https://developers.openai.com/api/reference/resources/responses/methods/create.md';
// Actual adapter approval: one fixed snapshot/endpoint, plain text, standard
// tier, no tools/fallback/retries. Public rate verification is a separate,
// explicit, unpaid documentation fetch; no release-date kill switch exists.
const QUOTE = Object.freeze({ provider: 'openai', model: 'gpt-5.4-mini-2026-03-17', endpoint: 'https://api.openai.com/v1/responses',
  currency: 'USD', maxInputTokens: 272000, maxOutputTokens: 4096, upliftNumerator: 110, upliftDenominator: 100,
  source: MODEL_SOURCE, outputCapSource: RESPONSE_SOURCE });
function upperBoundMicros(quote) {
  const integer = value => Number.isSafeInteger(value) && value > 0;
  for (const key of ['maxInputTokens','maxOutputTokens','inputMicrosPerMillion','outputMicrosPerMillion','upliftNumerator','upliftDenominator']) {
    if (!integer(quote?.[key])) throw new Error('AI_COST_BOUND_UNAVAILABLE');
  }
  const numerator = (BigInt(quote.maxInputTokens) * BigInt(quote.inputMicrosPerMillion)
    + BigInt(quote.maxOutputTokens) * BigInt(quote.outputMicrosPerMillion)) * BigInt(quote.upliftNumerator);
  const divisor = 1000000n * BigInt(quote.upliftDenominator);
  const result = Number((numerator + divisor - 1n) / divisor);
  if (!Number.isSafeInteger(result) || result <= 0) throw new Error('AI_COST_BOUND_UNAVAILABLE');
  return result;
}
function parseOfficialVerification(modelText, responsesText, now = new Date()) {
  if (!modelText.includes('`' + QUOTE.model + '`') || /Status:\s*Deprecated/i.test(modelText)
    || !/Maximum input tokens:\s*272,000\b/.test(modelText) || !/\|\s*Responses\s*\|\s*`v1\/responses`\s*\|\s*Supported/.test(modelText)
    || /Cache writes|long.context.*(?:price|rate)|Fast mode|surcharge/i.test(modelText)
    || !responsesText.includes('including visible output tokens and') || !responsesText.includes('[reasoning tokens]')) throw new Error('AI_PRICE_EVIDENCE_UNSUPPORTED');
  const section = modelText.split('### Text tokens')[1]?.split('## Endpoints')[0] || '';
  const price = label => {
    const raw = section.match(new RegExp('^\\|\\s*' + label + '\\s*\\|\\s*\\$(\\d+(?:\\.\\d{1,6})?)\\s*\\|\\s*1M tokens\\s*\\|', 'm'))?.[1];
    if (!raw) throw new Error('AI_PRICE_EVIDENCE_UNSUPPORTED');
    const [whole, fraction = ''] = raw.split('.');
    const micros = Number(BigInt(whole) * 1000000n + BigInt(fraction.padEnd(6, '0')));
    if (!Number.isSafeInteger(micros) || micros <= 0) throw new Error('AI_COST_BOUND_UNAVAILABLE');
    return micros;
  };
  const verifiedAt = new Date(now).toISOString();
  const terms = { ...QUOTE, inputMicrosPerMillion: price('Input'), outputMicrosPerMillion: price('Output') };
  upperBoundMicros(terms);
  return { ...terms, id: 'openai-gpt54mini-' + createHash('sha256').update(JSON.stringify(terms)).digest('hex').slice(0, 24),
    verifiedAt, expiresAt: new Date(Date.parse(verifiedAt) + 30 * 86400000).toISOString(),
    evidenceHash: createHash('sha256').update(modelText + '\n' + responsesText).digest('hex') };
}
async function verifyOfficialPricing(fetcher = fetch, now = new Date()) {
  async function read(url) {
    const response = await fetcher(url, { redirect: 'error', signal: AbortSignal.timeout(10000), headers: { accept: 'text/markdown,text/plain' } });
    if (!response.ok) throw new Error('AI_PRICE_VERIFICATION_UNAVAILABLE');
    const reader = response.body.getReader(), chunks = []; let size = 0;
    try {
      while (true) { const { done, value } = await reader.read(); if (done) break; size += value.byteLength;
        if (size > 2 * 1024 * 1024) throw new Error('AI_PRICE_EVIDENCE_TOO_LARGE'); chunks.push(Buffer.from(value)); }
    } finally { await reader.cancel().catch(() => {}); }
    return Buffer.concat(chunks).toString('utf8');
  }
  const [modelText, responsesText] = await Promise.all([read(MODEL_SOURCE), read(RESPONSE_SOURCE)]);
  return parseOfficialVerification(modelText, responsesText, now);
}
function availability(quote, now = new Date()) {
  const instant = Number(new Date(now));
  try {
    const verified = Date.parse(quote?.verifiedAt), expires = Date.parse(quote?.expiresAt);
    if (!quote || quote.provider !== QUOTE.provider || quote.model !== QUOTE.model || quote.endpoint !== QUOTE.endpoint
      || quote.source !== MODEL_SOURCE || quote.outputCapSource !== RESPONSE_SOURCE || quote.currency !== 'USD'
      || quote.maxInputTokens !== QUOTE.maxInputTokens || quote.maxOutputTokens !== QUOTE.maxOutputTokens
      || quote.upliftNumerator !== 110 || quote.upliftDenominator !== 100 || !/^openai-gpt54mini-[a-f0-9]{24}$/.test(quote.id || '')
      || !/^[a-f0-9]{64}$/.test(quote.evidenceHash || '') || ![instant, verified, expires].every(Number.isFinite)
      || expires <= verified || expires - verified > 30 * 86400000 || instant < verified || instant >= expires) throw new Error('expired');
    return { available: true, code: 'AI_ADAPTER_APPROVED', quote, perAttemptMicros: upperBoundMicros(quote) };
  } catch { return { available: false, code: 'AI_PRICING_UNVERIFIED', reason: '缺少当前有效的官方计费依据，请点击核验；核验仅读取公开文档，不调用模型。', quote: quote || QUOTE }; }
}
module.exports = Object.freeze({ QUOTE, upperBoundMicros, availability, parseOfficialVerification, verifyOfficialPricing });
