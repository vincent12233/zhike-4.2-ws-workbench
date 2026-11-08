'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repo = path.resolve(__dirname, '..', '..');
const provider = fs.readFileSync(path.join(repo, 'server/src/Zhike.Worker/Providers/HttpAiAnalysisProvider.cs'), 'utf8');

assert.match(provider, /var contact = GetObject\(result, "contact"\)\.Clone\(\)/,
  'AI contact JSON must be cloned before the parsed document is disposed');
assert.match(provider, /var profile = GetObject\(result, "profile"\)\.Clone\(\)/,
  'AI profile JSON must be cloned before the parsed document is disposed');
assert.match(provider, /result\.Clone\(\)/,
  'AI raw JSON must retain an independent document lifetime');

console.log('ai-provider-lifetime: successful AI JSON values outlive the parser document');
