'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repo = path.resolve(__dirname, '..', '..');
const importRepo = fs.readFileSync(path.join(repo, 'server/src/Zhike.Infrastructure/Repositories/ImportRepository.cs'), 'utf8');
const classifier = fs.readFileSync(path.join(repo, 'server/src/Zhike.Domain/Import/SmartFieldClassifier.cs'), 'utf8');

for (const source of [importRepo, classifier]) {
  assert.match(source, /TryCreateDate/);
  assert.match(source, /yearFirst/);
  assert.match(source, /serial - 25569/);
  assert.match(source, /NormalizeDirection/);
  assert.match(source, /NormalizeStatus/);
}
assert.match(importRepo, /LooksLikePhone/);
assert.match(importRepo, /LooksLikeSource/);
assert.match(importRepo, /result\["channel"\]/);
assert.match(importRepo, /result\["recordType"\] = "deposit"/);
assert.ok(importRepo.indexOf('lower.Contains("单导")') < importRepo.indexOf('lower.Contains("群")'), 'single-lead labels must win over generic group markers');
assert.ok(classifier.indexOf('lower.Contains("单导")') < classifier.indexOf('lower.Contains("群")'), 'domain classifier must keep single-lead group labels as 单导');
console.log('import date/value inference: reordered dates, Excel serials, channel/status and mixed business detection contracts pass');
