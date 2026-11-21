'use strict';
// V9.2 stage 4: intake stores a stable local group id and the group's channel
// when the typed alias matches a managed group exactly. The alias never
// becomes a WhatsApp identity and an explicit source is not overwritten.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const app = fs.readFileSync(path.join(__dirname, '..', 'resources/app/app.js'), 'utf8');
const results = [];
function check(name, fn) {
  try { fn(); results.push(true); console.log('PASS ' + name); }
  catch (error) { results.push(false); console.log('FAIL ' + name + ' :: ' + error.message); }
}

check('the renderer loads the managed group index from the API', () => {
  assert.match(app, /async function loadManagedGroupIndex\(\)/);
  assert.match(app, /\/api\/ws\/managed-groups\?includeDisabled=1/);
  assert.match(app, /void loadManagedGroupIndex\(\);/);
});
check('an exact alias stores the stable group id, alias and channel', () => {
  assert.match(app, /managedGroupIndex\.get\(aliasKey\)/);
  assert.match(app, /item\.groupId=managed\.id/);
  assert.match(app, /item\.groupAlias=managed\.groupAlias/);
  assert.match(app, /item\.groupChannel=managed\.channel/);
});
check('an explicit source is never overwritten by the group channel', () => {
  assert.match(app, /if\(!row\.sourceExplicit&&managed\.channel\)item\.channel=managed\.channel/);
});
check('an unmatched alias keeps the typed text and never invents a group', () => {
  assert.match(app, /else if\(item\.group&&item\.group!=='—'\)\{item\.groupAlias=item\.group;\}/);
  assert.doesNotMatch(app, /item\.groupId\s*=\s*[^m]/);
});
check('no intake path writes a JID or a join-confirmed state from the alias', () => {
  const segment = app.slice(app.indexOf('item.groupId=managed.id'), app.indexOf('item.groupId=managed.id') + 200);
  assert.doesNotMatch(segment, /jid|JOIN_CONFIRMED/i);
});

const failed = results.filter(ok => !ok).length;
console.log(`Intake group alias linkage: ${results.length - failed}/${results.length}`);
if (failed) process.exit(1);
