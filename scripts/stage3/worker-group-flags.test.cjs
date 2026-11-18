'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '..', '..', 'desktop', 'src', 'Zhike.Desktop', 'Services', 'WorkerFeatureFlags.cs'), 'utf8');
for (const name of ['IndependentWsGroupManagerEnabled', 'GroupMemberSyncEnabled', 'GroupCrmAutoCreateEnabled', 'GroupMessageCollectionEnabled', 'GroupReadEvidenceEnabled']) assert.match(source, new RegExp(name));
assert.match(source, /GroupManagerPathsEnabled/);
assert.match(source, /Disabled\([^\n]+\)/);
console.log('stage3 worker group feature flags contract: pass');
