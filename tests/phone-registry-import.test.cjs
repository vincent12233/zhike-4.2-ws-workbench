const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../resources/app/modules/phone-registry.js'), 'utf8');
assert.ok(source.includes('window.zhikePhoneRegistry={render};'), 'find registry module export');
const testSource = source.replace('window.zhikePhoneRegistry={render};', 'window.zhikePhoneRegistry={render,parse,prep,commitImport,setPending:value=>pending=value};');
const state = { customers: [{ id: 'C-existing', phone: '9876543210' }], phoneRegistry: [], activities: [] };
let failSave = false;
const messages = [];
const context = {
  window: { __zhikeRegistryHost: {
    state, icons: () => '', esc: value => String(value), csvCell: value => String(value),
    snapshotBeforeWrite: async () => true, activity: text => state.activities.push({ text }),
    flushStateWrites: async () => { if (failSave) throw new Error('injected failure'); },
    persist: () => {}, closeModal: () => {}, toast: message => messages.push(message),
  } },
  document: { addEventListener() {}, querySelector: () => ({ innerHTML: '' }) },
  setTimeout,
};
vm.runInNewContext(testSource, context, { filename: 'phone-registry.js' });
const { parse, prep } = context.window.zhikePhoneRegistry;
const tables = [{ rows: [
  ['手机位置', '编号', '手机号', '所属角色', '接码渠道'],
  ['', '', '', '', ''],
  ['多开手机1', 'A-1', '9876543210', '客服', '接码1'],
  ['', '', '', '', ''],
] }];
const items = parse(tables);
assert.equal(items.length, 1, 'blank spreadsheet rows must not become registry records');
assert.equal(items[0].row, 3, 'original spreadsheet row number is retained');
const preview = prep(items);
assert.equal(preview.total, 1);
assert.equal(preview.adds, 1);
assert.equal(preview.valid.length, 1);
assert.equal(state.customers.length, 1, 'registry preview does not modify customer data');
assert.equal(state.phoneRegistry.length, 0, 'registry preview remains read only');
const sectioned = parse([{ rows: [
  ['多开手机1', '', '', '', '多开手机2'],
  ['编号', '号码', '所属角色', '接码渠道', '编号', '号码', '所属角色', '接码渠道'],
  ['A-1', '9876543211', '客服', '接码1', 'B-1', '9876543212', '客服', '接码2'],
] }]);
assert.equal(sectioned.length, 2, 'sectioned device layout still imports both devices');
assert.deepEqual(Array.from(sectioned, row => row.phone), ['9876543211', '9876543212']);
async function checkCommit() {
  context.window.zhikePhoneRegistry.setPending(preview);
  await context.window.zhikePhoneRegistry.commitImport();
  assert.equal(state.phoneRegistry.length, 1, 'accepted row is saved to registry');
  assert.equal(state.customers.length, 1, 'registry import leaves customer center untouched');
  assert.equal(prep(items).adds, 0, 'repeat import matches existing registry row');
  const next = prep([{ device: '多开手机2', code: 'B-1', phone: '9876543213', role: '客服', channel: '接码2' }]);
  context.window.zhikePhoneRegistry.setPending(next);
  failSave = true;
  await context.window.zhikePhoneRegistry.commitImport();
  assert.equal(state.phoneRegistry.length, 1, 'save failure rolls registry back');
  assert.ok(messages.some(message => message.includes('保存失败')), 'save failure is visible');
  failSave = false;
  await context.window.zhikePhoneRegistry.commitImport();
  assert.equal(state.phoneRegistry.length, 2, 'failed draft can be retried once storage recovers');
}
checkCommit().then(
  () => console.log('phone registry import: flat/sectioned layouts, blank rows, separate domain, save rollback pass'),
  error => { console.error(error); process.exitCode = 1; },
);
