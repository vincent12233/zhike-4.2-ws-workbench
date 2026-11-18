'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repo = path.resolve(__dirname, '..', '..');
const source = fs.readFileSync(path.join(repo, 'desktop', 'src', 'Zhike.Desktop', 'Services', 'ApiClient.cs'), 'utf8');

assert.match(source, /GetAiPipelineJobsAsync[\s\S]*api\/ws\/ai-pipeline\/jobs/);
assert.match(source, /GetAiPipelineJobAsync[\s\S]*api\/ws\/ai-pipeline\/jobs\//);
assert.match(source, /GetAiCrmSuggestionsAsync[\s\S]*api\/ws\/ai-pipeline\/suggestions/);
assert.match(source, /AcquireAiPipelineLeaseAsync[\s\S]*api\/ws\/fencing/);
assert.match(source, /AiPipelineLeaseDto[\s\S]*FencingToken/);
assert.match(source, /RetryAiPipelineJobsAsync[\s\S]*SendAiPipelineJobActionAsync/);
assert.match(source, /ApproveAiCrmSuggestionAsync[\s\S]*X-State-Version/);

const legacyGet = source.match(/public async Task<AiJobDto\[\]\?> GetAiJobsAsync[\s\S]*?\n    }/);
assert.ok(legacyGet, 'legacy AI getter must remain a real sidecar read');
assert.doesNotMatch(legacyGet[0], /Task\.CompletedTask/);
const legacyRetry = source.match(/public async Task<int> RetryAiJobsAsync[\s\S]*?\n    }/);
assert.ok(legacyRetry, 'legacy retry entry must not silently report success');
assert.doesNotMatch(legacyRetry[0], /Task\.CompletedTask/);

console.log('desktop ApiClient Stage 4 queue and CRM contract passed');
