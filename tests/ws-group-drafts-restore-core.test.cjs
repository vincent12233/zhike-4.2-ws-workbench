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

for (const scenario of ['later account fails', 'CRM fails', 'draft transaction rejects', 'lost reply recovered', 'lost replies remain unknown', 'lost reply then conflict']) {
  test('workspace draft final phase: ' + scenario, async () => {
    const db = database();
    try {
      merge(db, [makeDraft('existing')]);
      const row = id => ({ schemaVersion: 6, accounts: [{ id, workspaceMode: 'dedicated' }], groupDrafts: read(db, id) });
      const backup = { customers: [{ id: 'replacement' }], wsAccounts: {
        desk: { ...row('desk'), groupDrafts: [makeDraft('existing', 'CANCELLED'), makeDraft('new')] },
        other: { ...row('other'), injectedFailure: scenario === 'later account fails' },
      } };
      const accountList = { accounts: [{ id: 'desk' }, { id: 'other' }] };
      const imported = [], draftCalls = [], notices = [], crmWrites = [];
      let diskCustomers = [{ id: 'original' }];
      const service = {
        listAccounts: async () => accountList, exportData: async id => row(id), ensureAccount: async () => ({ created: false, workspaceMode: 'dedicated' }),
        importData: async (value, id) => { imported.push({ id, hasDrafts: Object.hasOwn(value, 'groupDrafts') }); if (value.injectedFailure) throw new Error('injected later account failure'); return merge(db, value.groupDrafts || [], id); },
        importGroupDrafts: async payload => {
          draftCalls.push(JSON.parse(JSON.stringify(payload)));
          assert.equal(diskCustomers[0].id, 'replacement', 'draft merge must follow successful CRM commit');
          if (scenario === 'draft transaction rejects' || (scenario === 'lost reply then conflict' && draftCalls.length > 1)) throw Object.assign(new Error('draft conflict'), { status: 409 });
          db.exec('BEGIN IMMEDIATE');
          try { for (const account of payload.accounts) drafts.restoreBackup(db, account.accountId, drafts.validateBackup(account.groupDrafts, account.accountId, 'dedicated')); db.exec('COMMIT'); }
          catch (error) { db.exec('ROLLBACK'); throw error; }
          if (scenario.includes('lost') && (draftCalls.length === 1 || scenario === 'lost replies remain unknown')) throw new Error('reply lost after commit');
          return { ok: true, operationId: payload.operationId, sendAvailable: false };
        },
      };
      const state = { customers: [{ id: 'original' }], tickets: [], deposits: [], followups: [], activities: [], settings: {}, selected: new Set() };
      const context = {
        window: { __LOCAL_DB__: true, __zhikeWsBackup: service }, state, optionCatalog: {}, crmFollowCache: {}, WeakMap, Set, stateVersion: '1',
        decodeWorkspaceBackupFile: async text => JSON.parse(text), validateBackupData: () => {}, validateStatusHistoryData: () => {}, confirm: () => true,
        flushStateWrites: async () => {}, cloneStateData: value => JSON.parse(JSON.stringify(value)), statePayload: () => ({ customers: state.customers }),
        sha256Text: async text => require('node:crypto').createHash('sha256').update(text).digest('hex'),
        fetch: async (url, init) => {
          if (url === '/api/snapshot') return { ok: true, json: async () => ({ snapshotCreated: true }) };
          assert.equal(url, '/api/state');
          crmWrites.push(JSON.parse(init.body));
          if (scenario === 'CRM fails' && crmWrites.length === 1) return { ok: false, json: async () => ({ error: 'injected CRM failure' }) };
          diskCustomers = JSON.parse(init.body).customers;
          return { ok: true, json: async () => ({ version: String(crmWrites.length + 1) }) };
        },
        normalizeCustomerRows: value => value, normalizeObjectRows: value => value || [], normalizeSavedViews: value => value || [],
        applyOptionLists: () => {}, exposeImportSourceCatalog: () => {}, render: () => {}, toast: (message, kind) => notices.push({ message, kind }),
      };
      const source = fs.readFileSync(path.join(__dirname, '../resources/app/app.js'), 'utf8');
      const start = source.indexOf('  async function importBackupWsAccounts('), end = source.indexOf('  function saveIntake()', start);
      assert.ok(start >= 0 && end > start);
      const restore = vm.runInNewContext(source.slice(start, end) + '\n;restoreBackupFile', context);
      await restore({ size: 100, text: async () => JSON.stringify(backup) });
      assert.deepEqual(imported.slice(0, 2), [{ id: 'desk', hasDrafts: false }, { id: 'other', hasDrafts: false }], 'initial per-account imports never write staged drafts');
      assert.equal(notices.length, 1);
      if (!scenario.includes('lost')) {
        assert.deepEqual(read(db), [makeDraft('existing')]);
        assert.equal(imported.length, 4, 'known failure preserves existing WS compensation');
        assert.equal(state.customers[0].id, 'original'); assert.equal(diskCustomers[0].id, 'original');
        assert.equal(draftCalls.length, scenario === 'draft transaction rejects' ? 1 : 0);
        assert.equal(crmWrites.length, scenario === 'later account fails' ? 0 : scenario === 'CRM fails' ? 1 : 2);
        assert.equal(notices[0].kind, 'x'); assert.doesNotMatch(notices[0].message, /备份恢复完成|结果未确认/);
      } else {
        assert.equal(read(db).length, 2); assert.equal(read(db).find(row => row.id === 'existing').status, 'CANCELLED');
        assert.equal(imported.length, 2, 'committed or uncertain drafts never cause destructive compensation');
        assert.equal(diskCustomers[0].id, 'replacement'); assert.equal(crmWrites.length, 1);
        assert.equal(draftCalls.length, 2); assert.deepEqual(draftCalls[0], draftCalls[1], 'lost-response retry uses exactly the same operation and content');
        if (scenario === 'lost reply recovered') assert.match(notices[0].message, /备份恢复完成/);
        else { assert.equal(notices[0].kind, 'x'); assert.match(notices[0].message, /结果未确认，未执行回滚/); assert.doesNotMatch(notices[0].message, /备份恢复完成/); }
      }
    } finally { db.close(); }
  });
}
