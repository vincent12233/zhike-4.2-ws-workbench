'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repo = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(repo, relative), 'utf8');
const exists = relative => fs.existsSync(path.join(repo, relative));
const app = read('resources/app/app.js');
const server = read('resources/app/server.mjs');
const index = read('resources/app/index.html');
const pkg = JSON.parse(read('resources/app/package.json'));
const setup = read('zhike-desktop-setup.iss');
const wsUi = read('resources/app/modules/ws-workbench.js');
const smartImport = read('resources/app/modules/smart-import.js');
const phoneRegistry = read('resources/app/modules/phone-registry.js');

assert.match(app, /normalizeCustomerRows\(stored\?\.customers\)/, 'customer hydration must discard malformed rows before rendering');
assert.match(app, /clearAllDataModal|clear-data-password/);
assert.match(app, /confirm-clear-all-data/);
assert.doesNotMatch(app, /function clearAllDataWithSnapshot\(\)[\s\S]{0,900}prompt\(/);
assert.match(app, /pendingStateData/);
assert.match(app, /flushStateWrites/);
assert.match(app, /businessProductFilter/);
assert.match(app, /registrationFilterTimer/);
assert.match(app, /inferRecordType/);
assert.match(smartImport, /登记时间/);
assert.match(smartImport, /下次跟进/);
assert.match(server, /ws_followup_alerts/);
assert.match(server, /collectionRuns|collectionItems/);
assert.match(wsUi, /syncConversationListPreviews/);
assert.match(wsUi, /analyzeStoredConversation/);
assert.match(wsUi, /syncAnalysisToCrm/);
assert.match(wsUi, /done-followup-alert/);
assert.match(phoneRegistry, /flushStateWrites/);
assert.match(index, /data-view="vip"/);
assert.match(index, /data-view="groups"[\s\S]{0,300}data-view="vip"/);
assert.match(app, /vipNumber/);
assert.equal(pkg.version, server.match(/const APP_VERSION = '([^']+)'/)?.[1]);
assert.equal(pkg.zhikeRuntime.storage, 'SQLite');
assert.match(setup, /OutputBaseFilename=知客-\{#AppVersion\}-WinUI桌面版/);
assert.equal(exists('resources/app/modules/phone-registry-seed.json'), false);
assert.equal(exists('resources/app/main.cjs'), false, 'Electron entrypoint must not be part of the active project');

console.log('project audit regression: local data guards, import routing, WS/AI sync, VIP and single-shell entry pass');
