'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repo = path.resolve(__dirname, '..', '..');
const read = (relative) => fs.readFileSync(path.join(repo, relative), 'utf8');
const provider = read('server/src/Zhike.Worker/Providers/HttpAiAnalysisProvider.cs');
const dispatcher = read('server/src/Zhike.Worker/JobDispatcher.cs');
const jobs = read('server/src/Zhike.Infrastructure/Repositories/AiJobRepository.cs');

assert.match(provider, /AiAnalysisUnavailableException/,
  'missing AI configuration must be an explicit deferred condition');
assert.match(dispatcher, /AiAnalysisUnavailableException/,
  'dispatcher must handle unavailable AI without writing an empty customer');
assert.match(dispatcher, /DeferAsync\(/,
  'unavailable AI jobs must remain resumable instead of being marked succeeded');
assert.match(jobs, /DeferAsync\(/,
  'job repository must support resumable deferred jobs');
assert.match(jobs, /state = 'pending'/,
  'deferred jobs must return to pending state');
assert.ok(provider.indexOf('if (string.IsNullOrWhiteSpace(body))') < provider.indexOf('throw new AiAnalysisUnavailableException'),
  'empty messages must be skipped before provider configuration is checked');

console.log('ai-unconfigured: no-key jobs defer without empty customer sync and remain resumable');
