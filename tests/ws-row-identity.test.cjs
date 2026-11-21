'use strict';
// WhatsApp chat rows do not always carry the conversation id on the row cell.
// The observer must inspect nearby wrapper containers before calling a row
// unresolved, and must keep counting what it could not identify.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'desktop/src/Zhike.Desktop/Views/LegacyUiHostPage.xaml.cs'), 'utf8');
const start = source.indexOf('const conversationIdentityFromRow');
const identity = source.slice(start, start + 4000);

const results = [];
function check(name, fn) {
  try { fn(); results.push(true); console.log('PASS ' + name); }
  catch (error) { results.push(false); console.log('FAIL ' + name + ' :: ' + error.message); }
}

check('identity reads WhatsApp conversation attributes', () => {
  for (const attribute of ['data-group-id', 'data-jid', 'data-chat-id', 'data-contact-id', 'data-id']) {
    assert.ok(identity.includes(`'${attribute}'`), attribute);
  }
});
check('the row itself wins before wrapper containers', () => {
  const firstAdd = identity.indexOf('add(row, true)');
  const ancestor = identity.indexOf('row.parentElement');
  assert.ok(firstAdd >= 0 && ancestor > firstAdd, 'row lookup precedes ancestor lookup');
});
check('wrapper containers are searched before rejecting a row', () => {
  assert.match(identity, /let ancestor = row\.parentElement/);
  assert.match(identity, /depth < 3/);
  assert.match(identity, /add\(ancestor, true\)/);
});
check('an unresolved row stays unresolved instead of inventing an id', () => {
  assert.match(identity, /if \(!selected\) return ''/);
  assert.match(source, /unresolvedWindowRows\+\+/);
});
check('only canonical WhatsApp identifiers are accepted', () => {
  assert.ok(identity.includes('@(g\\.us|s\\.whatsapp\\.net|c\\.us|lid)'));
});

const failed = results.filter(ok => !ok).length;
console.log(`WS row identity: ${results.length - failed}/${results.length}`);
if (failed) process.exit(1);
