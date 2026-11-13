'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repo = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(repo, relative), 'utf8');
const index = read('resources/app/index.html');
const app = read('resources/app/app.js');
const css = read('resources/app/modules/business-6.css');

assert.match(index, /modules\/business-6\.css/);
assert.match(app, /function business6ModuleContext\(\)/);
assert.match(app, /function enhanceBusiness6ModuleShell\(\)/);
for (const view of ['customers','groups','vip','tickets','registrations','deposits','analytics']) {
  assert.match(app, new RegExp(view === 'analytics' ? `LIVE BUSINESS INTELLIGENCE` : `view==='${view}'`), `${view} must have a 6.0 dynamic workspace context`);
}
assert.match(app, /if\(!supported\.includes\(view\)\)return null/, 'non-business views must avoid business aggregation work');
assert.match(app, /客户资料是唯一主档/);
assert.match(app, /同一客户、不同股票、买入与卖出按独立业务记录保存/);
assert.match(app, /不再把所有群粉合并/);
assert.match(app, /渠道设置、导入识别与进退群事件共用同一套分类/);
assert.match(app, /统计沿用原有口径，不制造演示值/);
assert.match(app, /enhanceBusiness6ModuleShell\(\);/);
assert.match(css, /\.business6-command-deck/);
assert.match(css, /#viewContainer\[data-business6\] \.table-panel/);
assert.doesNotMatch(app + css, /陈先生|李女士|王先生|268,000/, '6.0 shell must not contain preview customer samples');

console.log('Business 6.0 shell contract: linked records, settings-driven channels and redesigned dynamic workspaces');
