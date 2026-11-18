'use strict';
const assert = require('node:assert/strict');
const { createMockProvider } = require('../../resources/app/modules/ai-mock-provider.js');

(async () => {
  const provider = createMockProvider({ fixtures: { 'job-1': { summary: 'fixture result', confidence: 0.8, profileFacts: { occupation: { value: '工程师', evidence: '我是一名工程师' } }, evidence: [{ field: 'occupation', value: '工程师', text: '我是一名工程师' }] } } });
  const result = await provider.analyze({ jobId: 'job-1' });
  assert.equal(provider.name, 'isolated-mock');
  assert.equal(result.summary, 'fixture result');
  assert.equal(result.profileFacts.occupation.value, '工程师');
  assert.equal(result.evidence[0].text, '我是一名工程师');
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(() => provider.analyze({ jobId: 'job-1' }, controller.signal), /取消/);
  console.log('ai mock provider: PASS');
})().catch(error => { console.error(error); process.exitCode = 1; });
