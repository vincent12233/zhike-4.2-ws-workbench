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
const reducedMotion = css.match(/@media\s*\(\s*prefers-reduced-motion\s*:\s*reduce\s*\)\s*\{([\s\S]*?)\r?\n\}/)?.[1];
assert.ok(reducedMotion, 'task workspace retains the reduced-motion media query');
const palette = String.raw`html\[data-palette\]`;
const exclusions = String.raw`:not\(\[data-view="ws-workbench"\]\):not\(\[data-view="gpt"\]\)`;
const appOff = String.raw`\[data-motion="off"\]`;
const motionRule = scope => new RegExp(scope + String.raw` \.ops6-command-rule summary::after\s*,\s*` + scope + String.raw` \.ops-task\s*\{\s*transition:none\s*\}`);
assert.ok(motionRule(palette + exclusions).test(reducedMotion), 'system reduced motion directly targets the operations arrow and tasks');
assert.ok(motionRule(palette + appOff + exclusions).test(css), 'app motion off directly targets the operations arrow and gates both selectors');
assert.doesNotMatch(source + css, /陈先生|李女士|王先生|268,000/, 'operations workspaces must never contain preview records');

// The renderer's hue is on a child dot. A card cannot inherit a custom
// property from its descendant: use the shared stage pair for both surfaces.
assert.doesNotMatch(css, /var\(--ops6-stage-hue/, 'Stage-card backgrounds cannot depend on a custom property only defined on their child');
assert.match(css, /\.ops6-task-stage-list button\s*\{[^}]*background:var\(--stage-panel\)/, 'Stage previews have a resolved shared-palette surface');
assert.match(css, /\.ops6-stage-dot\s*\{[^}]*background:var\(--stage-accent\)/, 'Stage dots inherit the same accent as their card');
assert.match(css, /\.ops-priority\.normal\s*\{[^}]*color:var\(--ds-active-text\);background:var\(--ds-nav-active\)/, 'Normal priority is visually distinct from a warning');
assert.match(css, /\.ops-priority\.low\s*\{[^}]*color:var\(--ds-muted\)/, 'Low priority retains a neutral treatment');
assert.match(css, /\.ops-task\.done \.ops-check\s*\{[^}]*color:var\(--ds-success\)/, 'The actual completed-task control uses the shared success pair');
assert.doesNotMatch(css, /\.ops-card(?:\.[\w-]+|:hover)?\s*\{[^}]*transform:(?!none)/, 'Draggable customer cards retain stable hit-test geometry');

console.log('Operations 6.0 workspace contract: live tasks, settings-driven stages, shared customer actions and responsive UI');
