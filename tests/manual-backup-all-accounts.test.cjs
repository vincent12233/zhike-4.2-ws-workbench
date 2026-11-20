'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'resources', 'app', 'app.js'), 'utf8');
const start = source.indexOf("    else if(action==='backup'){");
const end = source.indexOf("    else if(action==='soft-delete'", start);
assert.ok(start >= 0 && end > start, 'locate the production manual backup action');
const block = source.slice(start, end).replace("    else if(action==='backup'){", "    if(action==='backup'){");

function createHarness({ failExport = '', failMetadataWrite = false, accountList = [{ id: 'second', displayName: '测试二号' }], corruptExport = false } = {}) {
  const state = {
    settings: {}, customers: [{ id: 'C-test' }], tickets: [], deposits: [],
    followups: [], registrations: [], phoneRegistry: [], batchOperations: [], activities: [],
  };
  const downloads = [], notices = [], exports = [];
  let writeCount = 0;
  const emptyWs = id => ({
    schemaVersion: 6, settings: [], conversations: [{ id: `${id}-conversation` }],
    messages: [{ id: `${id}-message` }], analyses: [], replies: [], batches: [],
    collectionRuns: [], collectionItems: [], followupAlerts: [],
    groupDrafts: id === 'second' ? [{ id: 'manual-draft', accountId: id, message: '  Exact draft\n正文  ', status: 'CANCELLED', createdAt: '2026-11-20T00:00:00.000Z', cancelledAt: '2026-11-20T00:01:00.000Z', targets: [{ groupJid: 'synthetic@g.us', name: 'Same <title>', status: 'CANCELLED' }] }] : [],
  });
  const context = {
    state, today: '2026-11-14', TextEncoder,
    window: { __zhikeWsBackup: {
      listAccounts: async () => ({ accounts: accountList }),
      exportData: async id => {
        exports.push(id);
        if (id === failExport) throw new Error('injected WS export failure');
        const value=emptyWs(id);
        if(corruptExport&&id==='second')delete value.followupAlerts;
        return value;
      },
    } },
    flushStateWrites: async () => {
      writeCount += 1;
      if (failMetadataWrite && writeCount === 2) throw new Error('injected metadata write failure');
    },
    statePayload: () => ({ customers: state.customers, tickets: [], deposits: [], followups: [], registrations: [], phoneRegistry: [], batchOperations: [], settings: state.settings }),
    sha256Text: async value => crypto.createHash('sha256').update(String(value), 'utf8').digest('hex'),
    download: (name, value) => downloads.push({ name, value }),
    activity: value => state.activities.push({ text: value }),
    persist: () => {}, render: () => {},
    toast: value => notices.push(value),
  };
  vm.runInNewContext(`async function runBackup(action){ ${block} } this.runBackup=runBackup;`, context, { filename: 'manual-backup-action.js' });
  return { context, state, downloads, notices, exports, get writeCount() { return writeCount; } };
}

(async () => {
  const success = createHarness();
  await success.context.runBackup('backup');
  assert.deepEqual(success.exports, ['default', 'second'], 'default and every listed WS account must be exported');
  assert.equal(success.downloads.length, 1);
  const backup = JSON.parse(success.downloads[0].value);
  assert.deepEqual(Object.keys(backup.wsAccounts), ['default', 'second']);
  assert.equal(backup.wsAccounts.second.messages[0].id, 'second-message');
  assert.equal(backup.wsAccounts.second.groupDrafts[0].message, '  Exact draft\n正文  ');
  assert.equal(backup.wsAccounts.second.groupDrafts[0].targets[0].status, 'CANCELLED');
  assert.deepEqual(backup.wsAccounts.default.groupDrafts, []);
  assert.equal(backup.ws.messages[0].id, 'default-message', 'legacy active-account field remains compatible');
  assert.equal(backup.wsAccountMetadata.length, 2);
  const unsigned = { ...backup }; delete unsigned.integrity;
  assert.equal(backup.integrity.payloadSha256, crypto.createHash('sha256').update(JSON.stringify(unsigned)).digest('hex'));
  assert.ok(success.state.settings.lastBackupAt);

  const incomplete = createHarness({ failExport: 'second' });
  await incomplete.context.runBackup('backup');
  assert.equal(incomplete.downloads.length, 0, 'a failed account export must not download a backup labeled complete');
  assert.equal(incomplete.state.settings.lastBackupAt, undefined);
  assert.ok(incomplete.notices.some(message => message.includes('未生成')));

  const missingAccounts = createHarness({ accountList: [] });
  await missingAccounts.context.runBackup('backup');
  assert.equal(missingAccounts.downloads.length, 0, 'an empty account list must not produce a partial backup');

  const missingSection = createHarness({ corruptExport: true });
  await missingSection.context.runBackup('backup');
  assert.equal(missingSection.downloads.length, 0, 'a partial WS account export must not be labeled a complete backup');

  const metadataFailure = createHarness({ failMetadataWrite: true });
  await metadataFailure.context.runBackup('backup');
  assert.equal(metadataFailure.downloads.length, 1, 'a post-download metadata failure does not retract the backup file');
  assert.equal(metadataFailure.state.settings.lastBackupAt, undefined);
  assert.equal(metadataFailure.state.activities.length, 0);
  assert.ok(metadataFailure.notices.some(message => message.includes('备份下载已触发')));
  assert.ok(metadataFailure.notices.every(message => !message.includes('完整备份未生成')));
  console.log('manual backup: all WS accounts, integrity, fail-closed export and post-download status pass');
})().catch(error => { console.error(error); process.exitCode = 1; });
