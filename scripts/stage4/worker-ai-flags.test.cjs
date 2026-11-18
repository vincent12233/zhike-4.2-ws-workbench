'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..', '..');
const source = fs.readFileSync(path.join(root, 'desktop', 'src', 'Zhike.Desktop', 'Services', 'WorkerFeatureFlags.cs'), 'utf8');
const flags = [
  'AiJobPipelineEnabled',
  'AiWorkerConsumerEnabled',
  'AiCrmSuggestionEnabled',
  'AiCrmAutoFillEnabled',
  'AiReviewCenterEnabled',
];
for (const name of flags) {
  assert.match(source, new RegExp(`public bool ${name} \\{ get; init; \\}`), `${name} must be an optional fail-closed property`);
  assert.match(source, new RegExp(`${name} = ReadBoolean\\(root, "${name}"\\)`), `${name} must be loaded as a strict boolean`);
}
assert.match(source, /public bool AiPipelinePathsEnabled\s*=>[\s\S]*?AllControlledPathsEnabled/, 'AI paths must depend on all controlled Worker gates');
for (const name of flags) {
  assert.match(source, new RegExp(/AiPipelinePathsEnabled[\s\S]*?/.source + name), `${name} must be part of the AI derived gate`);
}
assert.match(source, /Disabled\([^\n]+\)[\s\S]*?=>\s*new\(false,\s*false,\s*false/, 'missing flags configuration must fail closed');
assert.doesNotMatch(source, /Ai(?:JobPipeline|WorkerConsumer|CrmSuggestion|CrmAutoFill|ReviewCenter)Enabled\s*=\s*true/, 'AI flags must not default to true');
console.log('stage4 worker AI feature flags contract: pass');
