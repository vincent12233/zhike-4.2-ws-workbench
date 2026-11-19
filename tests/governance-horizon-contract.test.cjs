'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const repo = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(repo, relative), 'utf8');
const app = read('resources/app/app.js');
const registry = read('resources/app/modules/phone-registry.js');
const css = read('resources/app/modules/global-6.css');
const deployment = read('docs/local-desktop-deployment.md');

assert.match(app, /function governanceHeading\(title,subtitle,eyebrow,actions='',signals=\[\]\)/, 'governance routes need one shared 6.0 shell');
for (const title of ['助理分配建议','本地自动化','数据治理','数据中心','操作记录','回收站','系统设置']) {
  assert.match(app, new RegExp(`governanceHeading\\('${title}'`), `${title} must render through the shared 6.0 shell`);
}
assert.match(registry, /const pageHero=\(actions,signals\)=>'<section class="page-heading governance-page-hero">/, 'phone registry needs the same 6.0 shell without coupling to app internals');
assert.match(registry, /\['登记行',all\.length/, 'registry hero values must remain bound to live state');
assert.match(app, /\['最近记录',logs\.length/, 'activity hero must use live audit data');
assert.match(app, /\['已删除客户',list\.length/, 'recycle hero must use live deleted rows');
assert.match(app, /\['业务选项',opts\.length/, 'settings hero must derive its option count');

for (const selector of ['.governance-page-hero','.governance-hero-signals','.governance-signal-grid','.governance-action-grid','.automation-rules','.governance-table-empty']) {
  assert.ok(css.includes(selector), `missing governance design-system selector: ${selector}`);
}
function governancePresentation(source) {
  assert.match(source, /html\[data-palette\]:not\(\[data-view="ws-workbench"\]\):not\(\[data-view="gpt"\]\)/, 'governance presentation shares the business scope and cannot restyle WS/GPT');
  assert.match(source, /\.modal\s*\{[^}]*background:var\(--ds-surface\)!important/, 'governance modals consume the same palette-aware business surface');
  assert.match(source, /\.governance-page-hero\s*\{display:grid!important;grid-template-columns:minmax\(0,1fr\) auto/, 'governance hero retains a real copy/actions layout');
  assert.match(source, /\.governance-hero-signals\s*\{[^}]*display:grid;[^}]*minmax\(180px,1fr\)/, 'live hero signals retain their own responsive grid');
  assert.match(source, /@media\(max-width:1000px\)[\s\S]*?\.governance-page-hero\s*\{grid-template-columns:1fr\}/, 'compact governance copy/actions reflow without reducing readable type');
  assert.match(source, /@media\(max-width:560px\)[\s\S]*?:is\(\.governance-hero-signals,\.governance-signal-grid,\.governance-action-grid,\.governance-data-state\)\s*\{grid-template-columns:1fr\}/, 'high-zoom signals, actions and status remain in reachable single-column flow');
}
governancePresentation(css);
assert.throws(() => governancePresentation(css.replace('display:grid!important;grid-template-columns:minmax(0,1fr) auto', 'display:block')), /governance hero retains/, 'removing governance layout is a real regression even if the selector remains');

assert.doesNotMatch(app, /font-size:9px;color:#8490a0;line-height:1\.7/, 'data center copy must not keep legacy 9px inline styling');
assert.doesNotMatch(app, /style="width:150px"><strong>\$\{name\}/, 'settings keys must not use legacy inline sizing');
assert.doesNotMatch(app, /style="padding:0 17px">\$\{ruleRows\}/, 'automation rules must use their 6.0 component class');
assert.doesNotMatch(app, /回收站为空<\/td>[\s\S]{0,20}style=/, 'recycle empty state must use the shared empty-state contract');

assert.doesNotMatch(app, /所有功能仍完全离线/, 'help must not describe networked WS and AI capabilities as offline');
assert.doesNotMatch(app, /本机存储状态<\/span><strong[^>]*>SQLite 正常/, 'data center must not claim a live SQLite health check that it did not perform');
for (const copy of [
  '客户与业务资料可离线使用；WS 前台和主动 AI 请求需要联网',
  '已有资料先创建完整备份；新工作区先录入一位客户，再立即备份',
  '在 WS 工作台打开官方页面，由本人扫码或登录',
  '在 GPT 运营助手中自行配置服务和 API Key',
  '自动会话发现、后台采集和自动 AI 处理当前保持关闭',
  '失败时先按页面提示重试；仍未恢复则退出全部知客窗口后重新打开',
  '未执行即时检测',
  '写入状态以顶部提示为准',
]) assert.ok(app.includes(copy), `missing truthful first-use/status copy: ${copy}`);
for (const copy of [
  '## 最短首次使用',
  '确认下载的文件实际存在',
  '数据库内的自动快照不能代替外置备份',
  '定时备份只在知客运行期间执行',
  '恢复会替换当前工作区',
]) assert.ok(deployment.includes(copy), `deployment guide is missing first-use/backup boundary: ${copy}`);

// Execute the real render functions with the smallest DOM/service seam. These
// checks catch regressions where truthful copy remains somewhere in app.js but
// the Data Center or Help modal no longer renders it.
const functionLine = name => {
  const line = app.split(/\r?\n/).find(candidate => candidate.includes(`function ${name}(`));
  assert.ok(line, `missing ${name} render function`);
  return line;
};
const dataView = { innerHTML: '' };
let snapshotLoads = 0;
let dataHeadingArgs = null;
let helpModalArgs = null;
const renderSandbox = {
  counts: () => ({ total: 3 }),
  $: selector => selector === '#viewContainer' ? dataView : null,
  governanceHeading: (...args) => {
    dataHeadingArgs = args;
    return `<section>${args[0]}|${JSON.stringify(args[4])}</section>`;
  },
  btn: label => `<button>${label}</button>`,
  icons: name => `<i>${name}</i>`,
  loadSnapshotPanel: () => { snapshotLoads += 1; },
  openModal: (...args) => { helpModalArgs = args; },
};
vm.createContext(renderSandbox);
vm.runInContext(`${functionLine('renderData')}\n${functionLine('shortcutHelpModal')}\nthis.renderData = renderData; this.shortcutHelpModal = shortcutHelpModal;`, renderSandbox);
renderSandbox.renderData();
assert.equal(snapshotLoads, 1, 'Data Center must continue loading the real snapshot panel after rendering');
assert.equal(dataHeadingArgs[0], '数据中心', 'Data Center runtime must use the expected page shell');
assert.deepEqual(JSON.parse(JSON.stringify(dataHeadingArgs[4])), [
  ['客户记录', 3, '当前工作区', 'accent'],
  ['存储引擎', '本机 SQLite', '未执行即时检测'],
  ['离线范围', '客户与业务', 'WS 与主动 AI 需联网'],
  ['恢复保护', '自动快照', '写入前创建'],
], 'Data Center runtime signals must report scope and diagnostic state truthfully');
assert.match(dataView.innerHTML, /本机存储状态[\s\S]*未执行即时检测/, 'Data Center runtime must not imply a health check');
assert.match(dataView.innerHTML, /本机业务可离线[\s\S]*WS 前台和主动 AI 请求需要联网/, 'Data Center runtime must distinguish offline and online capabilities');

renderSandbox.shortcutHelpModal();
assert.equal(helpModalArgs[0], '快捷键与使用帮助', 'Help runtime must open the existing help modal');
assert.equal(helpModalArgs[1], '客户与业务资料可离线使用；WS 前台和主动 AI 请求需要联网', 'Help runtime subtitle must state the real network boundary');
assert.match(helpModalArgs[2], /已有资料先创建完整备份/, 'Help runtime must put backup before first use');
assert.match(helpModalArgs[2], /在 WS 工作台打开官方页面，由本人扫码或登录/, 'Help runtime must explain official WS sign-in');
assert.match(helpModalArgs[2], /自动会话发现、后台采集和自动 AI 处理当前保持关闭/, 'Help runtime must disclose frozen automation');
assert.doesNotMatch(helpModalArgs.join(' '), /打开文档|查看文档/, 'Help runtime must not expose a non-functional documentation button');

console.log('governance Horizon contract: dynamic page shells, responsive structure and shared table/modal/empty-state presentation');
