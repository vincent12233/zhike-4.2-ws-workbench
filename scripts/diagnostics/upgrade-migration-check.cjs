'use strict';
// Upgrade path check: build a workspace with the v6.1.0-rc.3 migration set,
// seed synthetic customer/account rows, then migrate the same file with the
// current tree and prove the data survived.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { DatabaseSync } = require('node:sqlite');

const oldApp = process.argv[2];
const newApp = process.argv[3];
const dbPath = process.argv[4];
if (!oldApp || !newApp || !dbPath) { console.error('usage: node upgrade-migration-test.cjs <oldApp> <newApp> <dbPath>'); process.exit(2); }

function migrate(appDir) {
  const runner = require(path.join(path.resolve(appDir), 'migration-runner.cjs'));
  const db = new DatabaseSync(dbPath);
  try {
    const result = runner.runMigrations({ db, dbPath, backup: false, migrationDir: path.join(appDir, 'migrations') });
    return { version: result.version, applied: result.applied.map(item => item.version), tables: db.prepare("select count(*) c from sqlite_master where type='table'").get().c };
  } finally { db.close(); }
}

fs.mkdirSync(path.dirname(dbPath), { recursive: true });
fs.rmSync(dbPath, { force: true });
fs.rmSync(dbPath + '-wal', { force: true });
fs.rmSync(dbPath + '-shm', { force: true });

const before = migrate(oldApp);
const seed = new DatabaseSync(dbPath);
seed.exec(`INSERT INTO customers (id,phone_normalized,name,source,assistant,status,stage,deleted,data_json)
  VALUES ('UPGRADE-C1','9800000123','升级验证客户','单导K','小王','在群','意向客户',0,'{"note":"upgrade-fixture"}');`);
let seededAccounts = 0;
try {
  seed.prepare("INSERT INTO ws_accounts (id,display_name,provider,origin,partition_key,status,enabled,created_at,updated_at) VALUES ('upgrade-acc','升级验证账号','whatsapp','native','upgrade-acc','已连接',1,'2026-11-20T00:00:00Z','2026-11-20T00:00:00Z')").run();
  seededAccounts = 1;
} catch (error) { console.log('account-seed-note', String(error.message).slice(0, 80)); }
seed.close();

const after = migrate(newApp);
const check = new DatabaseSync(dbPath, { readOnly: true });
const customer = check.prepare("select * from customers where id='UPGRADE-C1'").get();
const accounts = check.prepare("select count(*) c from ws_accounts where id='upgrade-acc'").get().c;
const channelTable = check.prepare("select count(*) c from sqlite_master where type='table' and name='ws_group_channel_configs'").get().c;
check.close();

const report = {
  db: dbPath,
  beforeVersion: before.version,
  beforeTables: before.tables,
  seededAccounts,
  afterVersion: after.version,
  appliedByUpgrade: after.applied,
  afterTables: after.tables,
  customerPreserved: customer && customer.name === '升级验证客户' && customer.phone_normalized === '9800000123',
  customer,
  accountPreserved: accounts === 1,
  channelConfigTable: channelTable === 1,
};
console.log(JSON.stringify(report, null, 2));
if (!(report.afterVersion === 34 && report.customerPreserved && report.appliedByUpgrade.length > 0 && report.channelConfigTable)) process.exit(1);
