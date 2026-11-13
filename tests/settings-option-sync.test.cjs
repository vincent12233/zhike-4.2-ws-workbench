'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'resources', 'app', 'app.js'), 'utf8');

assert.match(source, /function replaceOptionReferences\(/, 'settings need one shared reference synchronization path');
for (const collection of ['state.customers', 'state.tickets', 'state.deposits', 'state.registrations', 'state.savedViews']) {
  assert.match(source, new RegExp(collection.replace('.', '\\.')), `${collection} must participate in settings synchronization`);
}
assert.match(source, /state\.settings\.intakeDefaults/, 'quick-intake defaults must follow renamed or removed settings');
assert.match(source, /customer\.statusHistory/, 'customer status history must follow channel changes');
assert.match(source, /key==='groupFanSources'/, 'the last group-fan option must be removable');
assert.match(source, /item\.values\.length>1\|\|key==='groupFanSources'/, 'group-fan delete button must remain enabled for its final item');
assert.match(source, /applySharedData\(before\)/, 'failed settings writes must restore the complete previous state');
assert.match(source, /zhike:option-lists-changed/, 'settings changes must notify dependent modules immediately');
const applyOptionLists = source.match(/function applyOptionLists\(\)\{[\s\S]*?\}\n  function notifyOptionListsChanged/)?.[0] || '';
assert.doesNotMatch(applyOptionLists, /if\(source&&!sources\.includes\(source\)\)sources\.push\(source\)/, 'deleted channels must not be silently recreated from historical customers');

console.log('settings option synchronization: delete, rename, dependent records, refresh and rollback contracts pass');
