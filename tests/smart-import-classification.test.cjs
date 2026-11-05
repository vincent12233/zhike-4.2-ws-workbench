'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'resources', 'app', 'modules', 'smart-import.js'), 'utf8');
const sandbox = { window: {}, console };
vm.runInNewContext(source, sandbox, { filename: 'smart-import.js' });
const api = sandbox.window.ZhikeSmartImport;

assert.equal(api.normalizeSource('单导群组'), '单导');
assert.equal(api.normalizeSource('单导群组数据'), '单导');
assert.equal(api.normalizeSource('私聊群组'), '单导');
assert.equal(api.normalizeSource('群粉群组'), '群粉');
assert.equal(api.normalizeSource('', '单导群组'), '单导');
assert.equal(api.normalizeSource('', '微信群'), '群粉');
assert.equal(api.normalizeSource('', '群组'), '');

const singleGroup = api.parseNaturalLine('张三 9876543210 单导群组 登记日期:2026-11-01');
assert.equal(singleGroup.source, '单导');
assert.equal(singleGroup.registered, '2026-11-01');
const groupFan = api.parseNaturalLine('李四 9876543211 微信群 登记日期:2026-11-01');
assert.equal(groupFan.source, '群粉');

console.log('smart import classification: explicit single-group and group-fan sources normalize correctly');
