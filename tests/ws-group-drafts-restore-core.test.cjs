'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const { DatabaseSync } = require('node:sqlite');
const drafts = require('../resources/app/modules/ws-group-drafts.cjs');
const now = '2026-11-20T00:00:00.000Z';
const makeDraft = (id, status = 'DRAFT') => ({ id, accountId: 'desk', message: '  Original\n正文  ', status, createdAt: now, cancelledAt: status === 'CANCELLED' ? now : null, targets: [{ groupJid: 'group@g.us', name: '<same>', status }] });
function database() {
  const db = new DatabaseSync(':memory:');
  db.exec("PRAGMA foreign_keys=ON; CREATE TABLE ws_accounts(id TEXT PRIMARY KEY); INSERT INTO ws_accounts VALUES('desk'),('other'); CREATE TABLE marker(value TEXT); INSERT INTO marker VALUES('original');");
  db.exec(fs.readFileSync(path.join(__dirname, '../resources/app/migrations/029-ws-group-drafts.sql'), 'utf8'));
  return db;
}
function merge(db, rows, accountId = 'desk') {
  const valid = drafts.validateBackup(rows, accountId, 'dedicated');
  db.exec('BEGIN IMMEDIATE');
  try { const result = drafts.restoreBackup(db, accountId, valid); db.exec('COMMIT'); return result; }
  catch (error) { db.exec('ROLLBACK'); throw error; }
}
function read(db, accountId = 'desk') { return db.prepare('SELECT * FROM ws_group_drafts WHERE account_id=? ORDER BY id').all(accountId).map(drafts.readDraft); }

test('workspace draft API never inherits the foreground account or requires an active account', async () => {
  const source = fs.readFileSync(path.join(__dirname, '../resources/app/modules/ws-workbench.js'), 'utf8');
  const apiStart = source.indexOf('  async function api('), apiEnd = source.indexOf('  async function loadAllConversationPages(', apiStart);
  const start = source.indexOf('  async function importWsGroupDrafts('), end = source.indexOf('  window.__zhikeWsBackup', start);
  assert.ok(apiStart >= 0 && apiEnd > apiStart && start >= 0 && end > start);
  const payload = { operationId: 'content-fingerprint', accounts: [{ accountId: 'desk', groupDrafts: [makeDraft('one')] }] };
  const state = { activeAccountId: 'ordinary-foreground' }, calls = [];
  const context = { window: { location: { origin: 'http://127.0.0.1' } }, state, URL, AbortController, setTimeout, clearTimeout,
    fetch: async (url, init) => { calls.push({ url, body: JSON.parse(init.body) }); return { ok: true, json: async () => ({ ok: true, operationId: payload.operationId, sendAvailable: false }) }; } };
  const send = vm.runInNewContext(source.slice(apiStart, apiEnd) + source.slice(start, end) + '\n;importWsGroupDrafts', context);
  await send(payload); state.activeAccountId = ''; await send(payload);
  assert.equal(calls.length, 2);
  for (const call of calls) { assert.equal(call.url, '/api/ws/group-drafts/restore'); assert.deepEqual(call.body.accounts, payload.accounts); assert.equal(call.body.operationId, payload.operationId); }
});

test('real SQLite transaction rolls back preexisting account writes and earlier draft inserts on conflict', () => {
  const db = database();
  try {
    merge(db, [makeDraft('one')]);
    assert.throws(() => drafts.restoreBackup(db, 'desk', []), /requires.*transaction/);
    db.exec('BEGIN IMMEDIATE');
    db.prepare('UPDATE marker SET value=?').run('replaced');
    assert.throws(() => drafts.restoreBackup(db, 'desk', drafts.validateBackup([makeDraft('new'), { ...makeDraft('one'), message: 'conflict' }], 'desk', 'dedicated')), error => error.code === 'DRAFT_BACKUP_CONFLICT');
    db.exec('ROLLBACK');
    assert.equal(db.prepare('SELECT value FROM marker').get().value, 'original');
    assert.deepEqual(read(db), [makeDraft('one')]);
    merge(db, [makeDraft('one', 'CANCELLED')]);
    merge(db, [makeDraft('one')]); merge(db, []);
    assert.deepEqual(read(db), [makeDraft('one', 'CANCELLED')]);
    assert.deepEqual(read(db, 'other'), []);
  } finally { db.close(); }
});

for (const scenario of ['commit', 'commit concurrent', 'commit response lost', 'unknown', 'rejected', 'CRM-only rejected']) {
  test('workspace restore UI ' + scenario, async () => {
    const backup = { customers: [{ id: 'replacement' }] };
    const requests = [], notices = [], nativeActions = [], refreshes = [];
    const entered = Promise.withResolvers(), ready = Promise.withResolvers();
    if (!scenario.includes('CRM-only')) backup.wsAccounts = {
      desk: { accounts: [{ id: 'desk', workspaceMode: 'dedicated' }], groupDrafts: [makeDraft('new')] },
      other: { accounts: [{ id: 'other', workspaceMode: 'dedicated' }] }
    };
    const state = { customers: [{ id: 'original' }], tickets: [], deposits: [], followups: [], activities: [], settings: {}, selected: new Set() };
    const ctx = {
      window: { __LOCAL_DB__: true, zhikeDesktop:{ wsAccounts:async payload=>{nativeActions.push(payload.action);return {accounts:[{id:'desk'},{id:'other'}]};} } }, state, optionCatalog: {}, crmFollowCache: {}, stateVersion: '1', crypto: require('node:crypto').webcrypto,
      destructiveWriteBusy:false,localDataRevision:0,groupLedgerDirty:false,document:{body:{inert:false}},applySharedData:crm=>Object.assign(state,crm),
      decodeWorkspaceBackupFile: JSON.parse, validateBackupData() {}, validateStatusHistoryData() {}, confirm: () => true,
      flushStateWrites: async () => {}, cloneStateData: x => JSON.parse(JSON.stringify(x)), refreshSharedState: async () => {refreshes.push(ctx.destructiveWriteBusy);},
      statePayload: () => ({ customers: state.customers }), normalizeCustomerRows: x => x, normalizeObjectRows: x => x || [], normalizeSavedViews: x => x || [],
      applyOptionLists() {}, exposeImportSourceCatalog() {}, render() {}, toast: (message, kind) => notices.push({message, kind}),
      fetch: async (url, init) => {
        if (url === '/api/snapshot') return { ok: true, json: async () => ({snapshotCreated: true}) };
        assert.equal(url, '/api/workspace/restore');
        assert.equal(state.customers[0].id,'original','pending data must not be visible before the transaction commits');
        if(scenario==='commit concurrent'){entered.resolve();await ready.promise;}
        requests.push(init.body);
        assert.equal(init.headers['X-State-Version'], '1');
        const sent=JSON.parse(init.body);
        assert.equal(sent.crm.customers[0].id,'replacement');
        if (scenario.includes('CRM-only')) assert.deepEqual(sent.accounts, []);
        else { assert.deepEqual(sent.accounts.map(x=>x.accountId), ['desk','other']); assert.deepEqual(sent.accounts[0].groupDrafts,[makeDraft('new')]); }
        if (scenario==='unknown'||(scenario==='commit response lost'&&requests.length===1)) throw new Error('lost response');
        if (scenario.includes('rejected')) return { ok:false,json:async()=>({code:'WORKSPACE_RESTORE_REJECTED',error:'transaction rolled back'}) };
        return { ok:true,json:async()=>({ok:true,version:'2',operationId:sent.operationId}) };
      }
    };
    const source=fs.readFileSync(path.join(__dirname,'../resources/app/app.js'),'utf8');
    const start=source.indexOf('  function prepareBackupWsAccounts('),end=source.indexOf('  function saveIntake()',start);
    const restore=vm.runInNewContext(source.slice(start,end)+'\n;restoreBackupFile',ctx);
    const file={size:100,text:async()=>JSON.stringify(backup)};
    const operation=restore(file);
    if(scenario==='commit concurrent'){
      await entered.promise;
      assert.equal(ctx.document.body.inert,true);assert.equal(ctx.destructiveWriteBusy,true);
      await restore(file);
      assert.match(notices.shift().message,/已有工作区更改/);
      ready.resolve();
    }
    await operation;
    assert.equal(notices.length,1);
    assert.equal(ctx.document.body.inert,false);assert.equal(ctx.destructiveWriteBusy,false);
    assert.deepEqual(refreshes,scenario.startsWith('commit')?[]:[false]);
    assert.deepEqual(nativeActions,scenario.startsWith('commit')?['list']:[]);
    assert.equal(requests.length,scenario==='commit response lost'||scenario==='unknown'?2:1);
    if(requests.length===2)assert.equal(requests[1],requests[0]);
    assert.equal(state.customers[0].id,scenario.startsWith('commit')?'replacement':'original');
    assert.match(notices[0].message,scenario==='unknown'?/结果未确认/:scenario.startsWith('commit')?/备份恢复完成/:/rolled back/);
  });
}
