'use strict';
// V9.2 stage 3: the managed group page must be reachable, use only the three
// business fields, and never ask for an assistant or a manual JID.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repo = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(repo, relative), 'utf8');
const ui = read('resources/app/modules/ws-managed-groups-ui.js');
const workbench = read('resources/app/modules/ws-workbench.js');
const index = read('resources/app/index.html');
const host = read('desktop/src/Zhike.Desktop/Views/LegacyUiHostPage.xaml.cs');
const css = read('resources/app/modules/ws-workbench.css');

const results = [];
function check(name, fn) {
  try { fn(); results.push(true); console.log('PASS ' + name); }
  catch (error) { results.push(false); console.log('FAIL ' + name + ' :: ' + error.message); }
}

check('the page module is shipped and exposes create()', () => {
  assert.ok(index.includes('modules/ws-managed-groups-ui.js'));
  assert.match(ui, /window\.ZhikeWsManagedGroups\s*=\s*\{ create \}/);
});
check('the view is registered, routed and rendered', () => {
  assert.ok(workbench.includes("'managed-groups'"), 'view id');
  assert.match(workbench, /id: 'managed-groups', label: '群组管理'/);
  assert.match(workbench, /view === 'managed-groups'\) \{\s*\n\s*if \(!await managedGroups\?\.load\(\)\)/);
  assert.match(workbench, /activeView === 'managed-groups'\) body = managedGroups\?\.render\(\)/);
  assert.ok(host.includes('"managed-groups"'), 'native allowlists');
});
check('the form asks for exactly the three business fields', () => {
  const form = ui.slice(ui.indexOf('data-mg-form'), ui.indexOf('</form>'));
  for (const field of ['name="channel"', 'name="groupName"', 'name="groupAlias"']) assert.ok(form.includes(field), field);
  assert.doesNotMatch(form, /assistant|助理/i);
  assert.doesNotMatch(form, /name="jid"|placeholder="JID|@g\.us/);
});
check('all writes go through the existing sidecar API', () => {
  for (const endpoint of ['/api/ws/managed-groups', '/import', '/match/confirm', '/match/unbind', '/match/candidates']) assert.ok(ui.includes(endpoint), endpoint);
  assert.match(ui, /dryRun: true/);
  assert.match(ui, /dryRun: false/);
});
check('import shows a preview before commit and lists rejects', () => {
  assert.match(ui, /请先预览导入结果/);
  assert.match(ui, /mg-rejected/);
});
check('no reliable JID means the page still works and binding stays unverified', () => {
  assert.match(ui, /待核验/);
  assert.match(ui, /只作建议|仅建议/);
  assert.match(ui, /unbind/);
  assert.doesNotMatch(ui, /matchStatus: 'confirmed'|match_status:'confirmed'/);
});
check('errors are Chinese and never silent', () => {
  for (const message of ['本机服务不可用', '读取群组失败', '操作失败']) assert.ok(ui.includes(message), message);
  assert.match(ui, /role="alert"/);
});
check('the page keeps the existing visual language', () => {
  assert.ok(css.includes('#managedGroupsPage'));
  assert.ok(ui.includes('ws-workspace-card'));
  assert.ok(ui.includes('data-table'));
});

check('statistics use the configured group channel and separate registrations from unique customers', () => {
  assert.match(ui, /channelStats\.get\(row\.channel\)/, 'channel comes from the row');
  assert.doesNotMatch(ui, /groupAlias\.startsWith/, 'no prefix inference');
  assert.match(ui, /stat\.registrations \+= ids\.size/);
  assert.match(ui, /stat\.customers\.size/);
  assert.match(ui, /不是 WhatsApp 实际在群人数/);
});
check('the page receives customers read-only for statistics', () => {
  assert.ok(workbench.includes('getCustomers: () =>'), 'page receives customers read-only');
});
const failed = results.filter(ok => !ok).length;
console.log(`Managed groups UI contract: ${results.length - failed}/${results.length}`);
if (failed) process.exit(1);
