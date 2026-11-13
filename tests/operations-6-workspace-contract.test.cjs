'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repo = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(repo, relative), 'utf8');
const index = read('resources/app/index.html');
const source = read('resources/app/modules/operations-ui.js');
const css = read('resources/app/modules/operations-6.css');

assert.match(index, /modules\/operations-6\.css/);
assert.match(source, /ACTION ORCHESTRATION/);
assert.match(source, /CUSTOMER JOURNEY BOARD/);
assert.match(source, /完成结果实时回写客户档案、首页和统计/);
assert.match(source, /data-ops-focus=/, 'task workspace must expose an executable primary action');
assert.match(source, /data-ops-task-id=/, 'primary action must locate the real task record');
assert.match(source, /data-ops-customer=/, 'tasks and board cards must open the shared customer record');
assert.match(source, /core\.stageColumns\(host\.state\.customers/, 'stage board must retain the canonical customer-stage rules');
assert.match(source, /host\.state\.settings\?\.optionLists\?\.phases/, 'system phase settings must drive the board columns');
assert.match(source, /客户资料修改后立即重排，不生成副本/);
assert.match(source, /已完成 \/ 已忽略/, 'completed and dismissed task metrics must remain separate');
assert.match(source, /当前筛选没有任务/);
assert.match(source, /此阶段暂无客户/);
assert.match(css, /\.ops6-command-deck/);
assert.match(css, /\.ops6-stage-command/);
assert.match(css, /@media\(max-width:850px\)/);
assert.match(css, /scroll-snap-type:x proximity/);
assert.match(css, /@media\(prefers-reduced-motion:reduce\)\{\.ops-task\{transition:none!important\}/, 'task workspace must disable motion when requested');
assert.doesNotMatch(source + css, /陈先生|李女士|王先生|268,000/, 'operations workspaces must never contain preview records');

console.log('Operations 6.0 workspace contract: live tasks, settings-driven stages, shared customer actions and responsive UI');
