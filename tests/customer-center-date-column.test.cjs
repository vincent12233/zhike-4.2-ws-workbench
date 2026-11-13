'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const app = fs.readFileSync(path.join(__dirname, '..', 'resources', 'app', 'app.js'), 'utf8');

assert.match(
  app,
  /customerColumnDefs=\[\[.*?registered','登记日期'/s,
  '客户中心列定义应使用登记日期，而不是下次跟进',
);
assert.match(app, /registered:esc\(c\.registered(?:\|\|'—')?\)/, '客户中心行应展示客户登记日期');
const columnDefinition = app.match(/const customerColumnDefs=[^\n]+/)?.[0] || '';
assert.doesNotMatch(
  columnDefinition,
  /\['due','下次跟进'\]/,
  '客户中心主表不应再把下次跟进作为登记日期列',
);
assert.match(
  app,
  /cols=\['name'.*?'registered'.*?'due'/s,
  '客户导出仍需保留下次跟进字段，不能改变数据口径',
);
assert.match(
  app,
  /if\(!registered\)incoming\.registered=''/,
  '文件导入缺少登记日期时必须保持为空，不能静默写入当天日期',
);
assert.match(
  app,
  /data-parsed-field="registered"[^>]+type="date" value="\$\{esc\(row\.registered\|\|''\)\}"/,
  '快速录入预览不能把缺失的导入登记日期伪装成当天',
);

console.log('customer center date column: registration date is displayed while follow-up data remains separate');
