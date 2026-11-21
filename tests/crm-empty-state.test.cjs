'use strict';
// V5.0 §26 CRM list empty and scoped states.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repo = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(repo, 'resources/app/app.js'), 'utf8');
const css = fs.readFileSync(path.join(repo, 'resources/app/modules/ui-refresh.css'), 'utf8');
const rowSource = app.slice(app.indexOf('function customerRows'), app.indexOf('function customerRows') + 2600);

const results = [];
function check(name, fn) {
  try { fn(); results.push(true); console.log('PASS ' + name); }
  catch (error) { results.push(false); console.log('FAIL ' + name + ' :: ' + error.message); }
}

check('an empty customer list explains the scope instead of showing only grey text', () => {
  assert.match(rowSource, /customer-empty-state/);
  assert.match(rowSource, /当前条件下没有匹配的客户/);
  assert.match(rowSource, /还没有客户资料/);
});
check('the empty state offers real recovery actions', () => {
  assert.match(rowSource, /data-action="clear-search"/);
  assert.match(rowSource, /data-action="clear-extra"/);
  assert.match(rowSource, /data-action="new-customer"/);
  assert.match(rowSource, /data-action="go-data"/);
  assert.match(app, /action==='clear-search'\)\{state\.customerSearch='';state\.homeCustomerScope='';render\(\);/);
});
check('the empty state spans the visible column count', () => {
  assert.match(rowSource, /colspan="\$\{columns\.size\}"/);
});
check('the empty state is announced and styled as a block', () => {
  assert.match(rowSource, /role="status"/);
  assert.match(css, /\.customer-empty-state\{[^}]*min-height:220px/);
  assert.match(css, /\.customer-empty-state \.empty-state-actions\{[^}]*justify-content:center/);
});
check('filtering never mutates stored records', () => {
  assert.doesNotMatch(rowSource, /state\.customers\s*=\s*/);
});

const failed = results.filter(ok => !ok).length;
console.log(`CRM empty state: ${results.length - failed}/${results.length}`);
if (failed) process.exit(1);
