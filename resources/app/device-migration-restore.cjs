'use strict';

const { createHash, randomUUID } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { assertDeviceMigrationIsolationRoot } = require('./device-migration-isolation.cjs');
const { unpackDevicePackageV2, discardStagedDeviceMigrationV2 } = require('./device-migration-package-v2.cjs');
const { exportDeviceMigrationSnapshot, validateDeviceMigrationSnapshot, portableMedia } = require('./device-migration-snapshot.cjs');
const { packageTransport: { sameIdentity, removeOwned } } = require('./device-migration-package.cjs');
const { readIntegrity, runMigrations } = require('./migration-runner.cjs');
const { normalizePhone } = require('./modules/ws-crm-sync-core.js');
const schema = require('./device-migration-snapshot-schema.json');

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const SHA = /^[a-f0-9]{64}$/;
const VERSION = 25;
const LOCK = '.restore-lock.sqlite';
const CONTROL = [LOCK, 'active.json', 'generations', 'staging', 'switch-0.json', 'switch-1.json'];
const SEQUENCE = {
  PREPARED: ['ACTIVATING', 'ROLLING_BACK'],
  ACTIVATING: ['ACTIVATED', 'ROLLING_BACK'],
  ACTIVATED: ['ACCEPTED', 'ROLLING_BACK'],
  ACCEPTED: [], ROLLING_BACK: ['ROLLED_BACK'], ROLLED_BACK: [],
};
const ACTIVE_FIELDS = ['recordVersion', 'sequence', 'generationId', 'operationId', 'gate'];
const SWITCH_FIELDS = ['recordVersion', 'sequence', 'operationId', 'packageId', 'manifestSha256',
  'sourceSchemaVersion', 'previousGenerationId', 'candidateGenerationId', 'candidateInventorySha256',
  'phase', 'updatedAtUtc', 'errorCode'];
const INVENTORY_FIELDS = ['recordVersion', 'generationId', 'database', 'logicalSha256', 'accounts', 'media'];
const words = value => (value || '').split(' ').filter(Boolean);
const encode = value => Buffer.from(JSON.stringify(value), 'utf8');
const digest = value => createHash('sha256').update(value).digest('hex');
const canonicalDigest = value => digest(encode(value));
const quote = name => '"' + name + '"';

function requireThat(condition, code, message) {
  if (!condition) throw Object.assign(new Error(message), { code });
}

function entryInfo(file, directory = false) {
  const stat = fs.lstatSync(file, { bigint: true });
  requireThat(stat.ino !== 0n && fs.realpathSync.native(file) === file &&
    (directory ? stat.isDirectory() : stat.isFile() && stat.nlink === 1n),
  'RESTORE_IDENTITY', 'An isolated restore object has an unexpected identity.');
  return stat;
}

function assertEntries(directory, expected, allowMissing = false) {
  entryInfo(directory, true);
  const actual = fs.readdirSync(directory).sort();
  requireThat(allowMissing ? actual.every(name => expected.includes(name)) :
    JSON.stringify(actual) === JSON.stringify([...expected].sort()),
  'RESTORE_LAYOUT', 'The isolated restore directory contains unexpected or missing objects.');
}

function sameRevision(first, second) {
  return sameIdentity(first, second) && first.size === second.size &&
    first.mtimeNs === second.mtimeNs && first.ctimeNs === second.ctimeNs;
}

function readVerified(file, consume) {
  const expected = entryInfo(file);
  const fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
  try {
    requireThat(sameRevision(expected, fs.fstatSync(fd, { bigint: true })), 'RESTORE_IDENTITY', 'Isolated input changed while opening.');
    const result = consume(fd, Number(expected.size));
    requireThat(sameRevision(expected, entryInfo(file)) && sameRevision(expected, fs.fstatSync(fd, { bigint: true })),
      'RESTORE_IDENTITY', 'Isolated input changed while reading.');
    return result;
  } finally {
    fs.closeSync(fd);
  }
}

function bytes(file, maxBytes) {
  return readVerified(file, (fd, size) => {
    requireThat(size <= maxBytes, 'RESTORE_LIMIT', 'Isolated restore input exceeds its size limit.');
    return fs.readFileSync(fd);
  });
}

function fileDigest(file) {
  return readVerified(file, (fd, sizeBytes) => {
    const hash = createHash('sha256');
    const buffer = Buffer.allocUnsafe(256 * 1024);
    let total = 0;
    for (let count; (count = fs.readSync(fd, buffer)) !== 0;) {
      total += count;
      hash.update(buffer.subarray(0, count));
    }
    requireThat(sizeBytes === total, 'RESTORE_IDENTITY', 'Isolated input size changed while hashing.');
    return { sizeBytes, sha256: hash.digest('hex') };
  });
}

function createFile(file, content, owned) {
  const parent = entryInfo(path.dirname(file), true);
  const fd = fs.openSync(file, 'wx', 0o600);
  const item = { pathname: file, parent, stat: null };
  owned?.push(item);
  try {
    item.stat = fs.fstatSync(fd, { bigint: true });
    fs.writeFileSync(fd, content);
    fs.fsyncSync(fd);
    item.stat = fs.fstatSync(fd, { bigint: true });
    requireThat(sameRevision(item.stat, entryInfo(file)), 'RESTORE_IDENTITY', 'An isolated output changed while writing.');
  } finally {
    fs.closeSync(fd);
  }
}

function createDirectory(directory, owned) {
  const parent = entryInfo(path.dirname(directory), true);
  fs.mkdirSync(directory, { mode: 0o700 });
  const item = { pathname: directory, parent, stat: null };
  owned.push(item);
  item.stat = entryInfo(directory, true);
  return item.stat;
}

function signed(body) {
  return { ...body, checksum: canonicalDigest(body) };
}

function readRecord(file, fields, limit = 2 * 1024 * 1024) {
  const raw = bytes(file, limit);
  let record;
  try {
    record = JSON.parse(raw.toString('utf8'));
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    requireThat(false, 'RESTORE_RECORD', 'An isolated restore record is damaged.');
  }
  requireThat(record && raw.equals(encode(record)) && Object.keys(record).join() === [...fields, 'checksum'].join() && record.recordVersion === 1,
    'RESTORE_RECORD', 'An isolated restore record has an unexpected layout.');
  const { checksum, ...body } = record;
  requireThat(SHA.test(checksum) && canonicalDigest(body) === checksum, 'RESTORE_RECORD', 'An isolated restore record checksum failed.');
  return record;
}

function currentRecordStat(file) {
  try { fs.lstatSync(file); } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
  return entryInfo(file);
}

function replaceRecord(context, name, body, fields) {
  context.verify();
  const destination = path.join(context.root, name);
  const before = currentRecordStat(destination);
  if (before) readRecord(destination, fields);
  const temporary = path.join(context.root, name + '.' + randomUUID() + '.tmp');
  const record = signed(body);
  const owned = [];
  try {
    createFile(temporary, encode(record), owned);
    context.fault?.('before-record-rename', { name, destination, temporary });
    context.verify();
    const after = currentRecordStat(destination);
    requireThat((before ? after && sameRevision(before, after) : after === null) &&
      sameRevision(owned[0].stat, entryInfo(temporary)), 'RESTORE_IDENTITY', 'An isolated restore record was replaced before publication.');
    fs.renameSync(temporary, destination);
  } catch (error) {
    if (owned.length) {
      try {
        context.verify();
        requireThat(owned[0].stat && sameIdentity(owned[0].stat, entryInfo(temporary)),
          'RESTORE_IDENTITY', 'The temporary restore record changed identity.');
        fs.unlinkSync(temporary);
      } catch { error.cleanupPending = true; }
    }
    throw error;
  }
  requireThat(readRecord(destination, fields).checksum === record.checksum,
    'RESTORE_RECORD', 'The isolated restore record was not read back after replacement.');
  return record;
}

async function withTarget(options, task, initialize = false) {
  const { isolationRoot, controlRoot, faultInjector } = options;
  requireThat(controlRoot !== isolationRoot && path.dirname(controlRoot || '') === isolationRoot,
    'RESTORE_TARGET', 'Select a separate empty control directory under the isolated workspace.');
  await assertDeviceMigrationIsolationRoot(isolationRoot, controlRoot);
  const isolationIdentity = entryInfo(isolationRoot, true);
  const rootIdentity = entryInfo(controlRoot, true);
  assertEntries(controlRoot, CONTROL, true);
  const lockPath = path.join(controlRoot, LOCK);
  if (!currentRecordStat(lockPath)) {
    requireThat(initialize && fs.readdirSync(controlRoot).every(name => name === LOCK),
      'RESTORE_LOCK', 'An initialized target has no valid restore lock.');
    try { createFile(lockPath, Buffer.alloc(0)); } catch (error) { if (error.code !== 'EEXIST') throw error; }
  }
  const lockIdentity = entryInfo(lockPath);
  requireThat(lockIdentity.size === 0n && lockIdentity.dev === rootIdentity.dev, 'RESTORE_LOCK', 'The isolated restore lock is invalid.');
  const verify = () => {
    requireThat(sameIdentity(isolationIdentity, entryInfo(isolationRoot, true)) && sameIdentity(rootIdentity, entryInfo(controlRoot, true)),
      'RESTORE_IDENTITY', 'The isolated restore target changed identity.');
    const actual = currentRecordStat(lockPath);
    requireThat(actual && sameRevision(lockIdentity, actual), 'RESTORE_LOCK', 'The isolated restore lock changed identity.');
  };
  const lock = new DatabaseSync(lockPath);
  try {
    try {
      lock.exec('PRAGMA busy_timeout=0; PRAGMA journal_mode=MEMORY; BEGIN EXCLUSIVE');
    } catch (error) {
      if (error.errcode !== 5) throw error;
      requireThat(false, 'RESTORE_BUSY', 'An isolated restore operation already holds the target lock.');
    }
    verify();
    assertEntries(controlRoot, CONTROL, true);
    return await task({ root: controlRoot, isolationRoot, verify, device: rootIdentity.dev,
      generations: path.join(controlRoot, 'generations'), staging: path.join(controlRoot, 'staging'), fault: faultInjector });
  } finally {
    lock.close();
  }
}

function generationLocation(context, id) {
  requireThat(UUID.test(id), 'RESTORE_RECORD', 'The isolated generation identifier is invalid.');
  const directory = path.join(context.generations, id);
  return { directory, dbPath: path.join(directory, 'workspace.sqlite'), mediaRoot: path.join(directory, 'ws-media'),
    accountRoot: path.join(directory, 'ws-accounts'), accountPath: path.join(directory, 'ws-accounts', 'accounts.json'),
    inventoryPath: path.join(directory, 'inventory.json'), freezePath: path.join(directory, 'freeze.json') };
}

function accountIndex(rows) {
  return rows.map(row => ({ id: row.id, displayName: row.display_name, status: '未连接', lastSeen: null,
    lastKnownStatus: row.last_status || row.status || '未连接' }));
}

function mediaInventory(tables) {
  return portableMedia(tables).sort((a, b) => a.relativePath < b.relativePath ? -1 : Number(a.relativePath > b.relativePath));
}

function copyMedia(context, generation, expected, actual, owned) {
  const byId = new Map(actual.map(entry => [entry.id, entry]));
  requireThat(byId.size === expected.length && actual.length === expected.length,
    'RESTORE_MEDIA', 'The package media list disagrees with the ledger.');
  const directories = new Set();
  entryInfo(generation.mediaRoot, true);
  for (const entry of expected) {
    const staged = byId.get(entry.id);
    requireThat(staged && staged.accountId === entry.accountId && staged.sizeBytes === entry.sizeBytes && staged.sha256 === entry.sha256,
      'RESTORE_MEDIA', 'The package media metadata disagrees with the ledger.');
    const data = bytes(staged.path, entry.sizeBytes);
    requireThat(data.length === entry.sizeBytes && digest(data) === entry.sha256, 'RESTORE_MEDIA', 'An authenticated media file changed after staging.');
    const destination = path.join(generation.mediaRoot, ...entry.relativePath.split('/'));
    const directory = path.dirname(destination);
    if (!directories.has(directory)) {
      createDirectory(directory, owned);
      directories.add(directory);
    }
    entryInfo(directory, true);
    createFile(destination, data, owned);
    context.fault?.('after-media-write', { mediaPath: destination });
    const output = fileDigest(destination);
    requireThat(output.sizeBytes === entry.sizeBytes && output.sha256 === entry.sha256,
      'RESTORE_MEDIA', 'A copied asset failed its on-disk verification.');
  }
}

function rebuildCustomers(tables) {
  const index = new Map((tables.app_state[0]?.json.customers || []).map(customer => [String(customer.id ?? '').trim(), customer]));
  return tables.customers.map(row => {
    const customer = index.get(row.id);
    requireThat(customer, 'RESTORE_CRM', 'A CRM index row has no authoritative customer.');
    const derived = { id: row.id, phone_normalized: normalizePhone(customer.phone || customer.rawPhone || ''),
      name: String(customer.name || ''), source: String(customer.source || ''), assistant: String(customer.assistant || ''),
      status: String(customer.status || ''), stage: String(customer.phase || ''), deleted: customer.deleted ? 1 : 0 };
    requireThat(Object.entries(derived).every(([key, value]) => row[key] === value),
      'RESTORE_CRM', 'A reviewed CRM index disagrees with its authoritative customer.');
    return { ...derived, data_json: customer };
  });
}

function loadTables(db, tables) {
  const crm = rebuildCustomers(tables);
  const media = new Map(mediaInventory(tables).map(entry => [entry.id, 'ws-media/' + entry.relativePath]));
  db.exec('DELETE FROM ws_account_settings; DELETE FROM ws_accounts');
  for (const [name, definition] of Object.entries(schema)) {
    const columns = [...words(definition.text), ...words(definition.integer), ...words(definition.real)];
    if (name === 'ws_media_assets') columns.push('storage_path');
    const insert = db.prepare('INSERT INTO ' + quote(name) + ' (' + columns.map(quote).join(',') + ') VALUES (' +
      columns.map(() => '?').join(',') + ')');
    for (const row of name === 'customers' ? crm : tables[name]) {
      insert.run(...columns.map(column => {
        if (column === 'storage_path') return media.get(row.id) || '';
        return column === 'json' || column.endsWith('_json') ? JSON.stringify(row[column]) : row[column];
      }));
    }
  }
}

function assertBlank(snapshot, db) {
  for (const [name, rows] of Object.entries(snapshot.tables)) {
    if (name !== 'ws_accounts' && name !== 'ws_account_settings') {
      requireThat(rows.length === 0, 'RESTORE_TARGET', 'The target baseline contains business data.');
    }
  }
  const accounts = snapshot.tables.ws_accounts;
  const settings = snapshot.tables.ws_account_settings;
  const local = db.prepare("SELECT origin,partition_key FROM ws_accounts WHERE id='default'").get();
  requireThat(accounts.length === 1 && settings.length === 1 && accounts[0].id === 'default' &&
    accounts[0].display_name === '默认账号' && accounts[0].status === '未连接' && accounts[0].enabled === 1 &&
    accounts[0].provider === '' && accounts[0].last_status === '' && accounts[0].last_seen_at === '' &&
    settings[0].account_id === 'default' && settings[0].translation_enabled === 1 && settings[0].ai_enabled === 1 &&
    settings[0].auto_collection_enabled === 0 && JSON.stringify(settings[0].settings_json) === '{}' &&
    local?.origin === '' && local.partition_key === 'persist:default',
  'RESTORE_TARGET', 'The target baseline has changes beyond the reviewed migration seed.');
}

function prepareDatabase(generation, context, snapshot) {
  const db = new DatabaseSync(generation.dbPath, { enableForeignKeyConstraints: true });
  try {
    runMigrations({ db, dbPath: generation.dbPath, migrationDir: path.join(__dirname, 'migrations'), backup: false });
    if (snapshot) {
      db.exec('BEGIN IMMEDIATE; PRAGMA defer_foreign_keys=ON');
      try {
        loadTables(db, snapshot.tables);
        context.fault?.('before-sqlite-commit', { db });
        requireThat(readIntegrity(db).ok, 'RESTORE_SQLITE', 'The candidate SQLite integrity or foreign key check failed.');
        db.exec('COMMIT');
      } catch (error) {
        db.exec('ROLLBACK');
        context.fault?.('after-sqlite-rollback', { db });
        throw error;
      }
    }
    requireThat(db.prepare('PRAGMA wal_checkpoint(TRUNCATE)').get().busy === 0 &&
      db.prepare('PRAGMA journal_mode=DELETE').get().journal_mode === 'delete',
    'RESTORE_SQLITE', 'The candidate SQLite journal could not be closed cleanly.');
  } finally {
    db.close();
  }
  const identity = entryInfo(generation.dbPath);
  const fd = fs.openSync(generation.dbPath, 'r+');
  try {
    requireThat(sameRevision(identity, fs.fstatSync(fd, { bigint: true })), 'RESTORE_IDENTITY', 'The candidate SQLite file changed before flush.');
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}

function computeInventory(generation, id, snapshot) {
  const media = mediaInventory(snapshot.tables);
  const groups = new Map();
  for (const { relativePath, sizeBytes, sha256 } of media) {
    const [group, file] = relativePath.split('/');
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group).push(file);
    const actual = fileDigest(path.join(generation.mediaRoot, group, file));
    requireThat(actual.sizeBytes === sizeBytes && actual.sha256 === sha256, 'RESTORE_MEDIA', 'A generation asset disagrees with its ledger.');
  }
  assertEntries(generation.mediaRoot, [...groups.keys()]);
  for (const [group, files] of groups) assertEntries(path.join(generation.mediaRoot, group), files);
  assertEntries(generation.accountRoot, ['accounts.json']);
  const accounts = fileDigest(generation.accountPath);
  requireThat(accounts.sha256 === canonicalDigest(accountIndex(snapshot.tables.ws_accounts)),
    'RESTORE_ACCOUNTS', 'The generation account index disagrees with the approved account scope.');
  return signed({ recordVersion: 1, generationId: id, database: fileDigest(generation.dbPath),
    logicalSha256: canonicalDigest(snapshot.tables), accounts, media });
}

async function createGeneration(context, id, incoming) {
  context.verify();
  requireThat(entryInfo(context.generations, true).dev === context.device,
    'RESTORE_TARGET', 'The generation parent is not on the control filesystem.');
  const generation = generationLocation(context, id);
  const owned = [];
  try {
    requireThat(createDirectory(generation.directory, owned).dev === context.device, 'RESTORE_TARGET', 'The candidate is not on the control filesystem.');
    createDirectory(generation.accountRoot, owned);
    createDirectory(generation.mediaRoot, owned);
    createFile(generation.dbPath, Buffer.alloc(0), owned);
    prepareDatabase(generation, context, incoming?.snapshot);
    const snapshot = exportDeviceMigrationSnapshot(generation.dbPath);
    if (incoming) {
      requireThat(canonicalDigest(snapshot.tables) === canonicalDigest(incoming.snapshot.tables),
        'RESTORE_SQLITE', 'The candidate does not round-trip all reviewed business rows.');
      copyMedia(context, generation, mediaInventory(snapshot.tables), incoming.media, owned);
    }
    createFile(generation.accountPath, encode(accountIndex(snapshot.tables.ws_accounts)), owned);
    createFile(generation.freezePath, encode({ recordVersion: 1, generationId: id, gate: 'frozen' }), owned);
    const inventory = computeInventory(generation, id, snapshot);
    createFile(generation.inventoryPath, encode(inventory), owned);
    return inventory;
  } catch (error) {
    if (!await removeOwned(owned, { requirePresent: true })) error.cleanupPending = true;
    throw error;
  }
}

function verifyGeneration(context, id, expectedChecksum, blank = false) {
  context.verify();
  const generation = generationLocation(context, id);
  requireThat(entryInfo(generation.directory, true).dev === context.device, 'RESTORE_TARGET', 'A generation is not on the control filesystem.');
  assertEntries(generation.directory, ['workspace.sqlite', 'ws-media', 'ws-accounts', 'freeze.json', 'inventory.json']);
  const freeze = encode({ recordVersion: 1, generationId: id, gate: 'frozen' });
  requireThat(bytes(generation.freezePath, 512).equals(freeze), 'RESTORE_FROZEN', 'A generation has no valid restore freeze.');
  const expected = readRecord(generation.inventoryPath, INVENTORY_FIELDS);
  requireThat(!expectedChecksum || expected.checksum === expectedChecksum, 'RESTORE_INVENTORY', 'The selected candidate inventory changed.');
  const disk = fileDigest(generation.dbPath);
  requireThat(expected.database?.sha256 === disk.sha256 && expected.database?.sizeBytes === disk.sizeBytes,
    'RESTORE_INVENTORY', 'A generation SQLite file differs from its recorded digest.');
  const snapshot = exportDeviceMigrationSnapshot(generation.dbPath);
  const db = new DatabaseSync(generation.dbPath, { readOnly: true, enableForeignKeyConstraints: true });
  try {
    requireThat(readIntegrity(db).ok, 'RESTORE_SQLITE', 'A generation failed read-only SQLite verification.');
    if (blank) assertBlank(snapshot, db);
  } finally {
    db.close();
  }
  const inventory = computeInventory(generation, id, snapshot);
  requireThat(inventory.checksum === expected.checksum, 'RESTORE_INVENTORY', 'A generation differs from its recorded inventory.');
  return { ...generation, tableCount: Object.keys(snapshot.tables).length, mediaCount: inventory.media.length };
}

function readState(context) {
  context.verify();
  assertEntries(context.root, CONTROL, true);
  const active = readRecord(path.join(context.root, 'active.json'), ACTIVE_FIELDS);
  requireThat(Number.isSafeInteger(active.sequence) && active.sequence >= 0 && UUID.test(active.generationId) &&
    active.gate === 'frozen' && (active.sequence === 0 ? active.operationId === null : UUID.test(active.operationId)),
  'RESTORE_RECORD', 'The active restore pointer is invalid.');
  const names = fs.readdirSync(context.root);
  const switches = [];
  for (const slot of [0, 1]) {
    const name = 'switch-' + slot + '.json';
    if (!names.includes(name)) continue;
    const record = readRecord(path.join(context.root, name), SWITCH_FIELDS);
    requireThat(Number.isSafeInteger(record.sequence) && record.sequence >= 1 && record.sequence % 2 === slot &&
      [record.operationId, record.packageId, record.previousGenerationId, record.candidateGenerationId].every(id => UUID.test(id)) &&
      record.previousGenerationId !== record.candidateGenerationId && SHA.test(record.manifestSha256) &&
      SHA.test(record.candidateInventorySha256) && record.sourceSchemaVersion === VERSION && Object.hasOwn(SEQUENCE, record.phase) &&
      typeof record.updatedAtUtc === 'string' && !Number.isNaN(Date.parse(record.updatedAtUtc)) &&
      (record.errorCode === null || /^[A-Z][A-Z0-9_]{0,63}$/.test(record.errorCode)),
    'RESTORE_RECORD', 'A switch record has invalid control fields.');
    switches.push(record);
  }
  switches.sort((a, b) => b.sequence - a.sequence);
  const [latest, previous] = switches;
  if (!latest) {
    requireThat(active.sequence === 0, 'RESTORE_RECORD', 'An active generation has no corresponding switch records.');
    return { active, latest: null };
  }
  const fixedFields = SWITCH_FIELDS.filter(name => !['sequence', 'phase', 'updatedAtUtc', 'errorCode'].includes(name));
  requireThat(previous ? previous.sequence === latest.sequence - 1 && SEQUENCE[previous.phase].includes(latest.phase) &&
    fixedFields.every(field => latest[field] === previous[field]) : latest.sequence === 1 && latest.phase === 'PREPARED',
  'RESTORE_RECORD', 'The two restore records do not describe one valid transition.');
  const old = active.generationId === latest.previousGenerationId;
  const candidate = active.generationId === latest.candidateGenerationId;
  const baseline = old && active.sequence === 0;
  const current = active.operationId === latest.operationId;
  let consistent;
  switch (latest.phase) {
    case 'PREPARED': consistent = baseline; break;
    case 'ACTIVATING': consistent = baseline || candidate && current && active.sequence === latest.sequence; break;
    case 'ACTIVATED': consistent = candidate && current && active.sequence === latest.sequence - 1; break;
    case 'ACCEPTED': consistent = candidate && current && active.sequence === latest.sequence - 2; break;
    case 'ROLLING_BACK':
      consistent = baseline || old && current && active.sequence === latest.sequence ||
        candidate && current && (previous.phase === 'ACTIVATING' && active.sequence === latest.sequence - 1 ||
          previous.phase === 'ACTIVATED' && active.sequence === latest.sequence - 2);
      break;
    case 'ROLLED_BACK': consistent = old && current && active.sequence === latest.sequence - 1; break;
  }
  requireThat(consistent, 'RESTORE_RECORD', 'The active generation disagrees with the restore transition.');
  return { active, latest };
}

function updateSwitch(context, latest, phase, errorCode = null) {
  const { checksum, ...fields } = latest;
  const sequence = fields.sequence + 1;
  const next = { ...fields, sequence, phase, updatedAtUtc: new Date().toISOString(), errorCode };
  return replaceRecord(context, 'switch-' + (sequence % 2) + '.json', next, SWITCH_FIELDS);
}

function selectGeneration(context, generationId, operationId, sequence) {
  return replaceRecord(context, 'active.json', { recordVersion: 1, sequence, generationId, operationId, gate: 'frozen' }, ACTIVE_FIELDS);
}

function activeView(context, { active, latest }) {
  const isCandidate = latest?.candidateGenerationId === active.generationId;
  const generation = verifyGeneration(context, active.generationId, isCandidate ? latest.candidateInventorySha256 : null, !isCandidate);
  return { generationId: active.generationId, operationId: latest?.operationId || null, phase: latest?.phase || 'BLANK',
    gate: 'frozen', coverage: 'partial', tableCount: generation.tableCount, mediaCount: generation.mediaCount };
}

function rollBack(context, state, errorCode) {
  let { latest, active } = state;
  if (latest.phase === 'ROLLED_BACK') return activeView(context, state);
  requireThat(latest.phase !== 'ACCEPTED', 'RESTORE_STATE', 'An accepted generation requires a separate rollback decision.');
  verifyGeneration(context, latest.previousGenerationId, null, true);
  if (latest.phase !== 'ROLLING_BACK') latest = updateSwitch(context, latest, 'ROLLING_BACK', errorCode);
  if (active.generationId !== latest.previousGenerationId || active.sequence !== latest.sequence) {
    active = selectGeneration(context, latest.previousGenerationId, latest.operationId, latest.sequence);
    context.fault?.('after-rollback-active');
  }
  verifyGeneration(context, latest.previousGenerationId, null, true);
  updateSwitch(context, latest, 'ROLLED_BACK', latest.errorCode);
  return activeView(context, readState(context));
}

function activate(context, state) {
  let { active, latest } = state;
  if (latest.phase === 'ACCEPTED') return activeView(context, state);
  requireThat(['PREPARED', 'ACTIVATING', 'ACTIVATED'].includes(latest.phase),
    'RESTORE_STATE', 'This isolated operation cannot be activated.');
  verifyGeneration(context, latest.previousGenerationId, null, true);
  try {
    verifyGeneration(context, latest.candidateGenerationId, latest.candidateInventorySha256);
    if (latest.phase === 'PREPARED') latest = updateSwitch(context, latest, 'ACTIVATING');
    if (latest.phase === 'ACTIVATING') {
      if (active.generationId === latest.previousGenerationId) {
        context.fault?.('before-active');
        active = selectGeneration(context, latest.candidateGenerationId, latest.operationId, latest.sequence);
        context.fault?.('after-active');
      }
      latest = updateSwitch(context, latest, 'ACTIVATED');
    }
    context.fault?.('before-accept');
    verifyGeneration(context, active.generationId, latest.candidateInventorySha256);
    updateSwitch(context, latest, 'ACCEPTED');
  } catch (error) {
    if (error.cleanupPending || ['RESTORE_IDENTITY', 'RESTORE_LOCK'].includes(error.code)) {
      error.recoveryPending = true;
    } else {
      try {
        const current = readState(context);
        if (current.latest?.phase !== 'ACCEPTED') {
          const errorCode = /^[A-Z][A-Z0-9_]{0,63}$/.test(error.code || '') ? error.code : 'RESTORE_FAILED';
          error.rollback = rollBack(context, current, errorCode).phase;
        }
      } catch {
        error.recoveryPending = true;
      }
    }
    error.operationId = latest.operationId;
    throw error;
  }
  return activeView(context, readState(context));
}

function checkDisk(context, bytes) {
  const stat = fs.statfsSync(context.root, { bigint: true });
  requireThat(stat.bavail * stat.bsize >= 2n * bytes + 256n * 1024n * 1024n,
    'RESTORE_SPACE', 'The isolated filesystem lacks the candidate and staging reserve.');
}

async function initializeDeviceMigrationRestoreTarget(options) {
  return withTarget(options, async context => {
    assertEntries(context.root, [LOCK]);
    fs.mkdirSync(context.generations, { mode: 0o700 });
    fs.mkdirSync(context.staging, { mode: 0o700 });
    const generationId = randomUUID();
    const inventory = await createGeneration(context, generationId);
    verifyGeneration(context, generationId, inventory.checksum, true);
    selectGeneration(context, generationId, null, 0);
    return activeView(context, readState(context));
  }, true);
}

async function restoreDeviceMigrationV2(options) {
  return withTarget(options, async context => {
    const state = readState(context);
    requireThat(!state.latest, 'RESTORE_STATE', 'An isolated restore operation already has a journal. Resume it explicitly.');
    assertEntries(context.generations, [state.active.generationId]);
    assertEntries(context.staging, []);
    verifyGeneration(context, state.active.generationId, null, true);
    const relative = path.relative(context.root, options.source || context.root);
    requireThat(relative === '..' || relative.startsWith('..' + path.sep), 'RESTORE_TARGET', 'The source package must be outside the restore control directory.');
    await assertDeviceMigrationIsolationRoot(context.isolationRoot, options.source, context.staging);
    checkDisk(context, entryInfo(options.source).size);
    const unpacked = await unpackDevicePackageV2({ isolationRoot: context.isolationRoot, source: options.source,
      password: options.password, stagingParent: context.staging });
    const candidateId = randomUUID();
    let inventory;
    try {
      context.verify();
      const ledger = unpacked.manifest.ledger;
      const clearBytes = BigInt(ledger.sizeBytes) + unpacked.manifest.media.reduce((total, entry) => total + BigInt(entry.sizeBytes), 0n);
      checkDisk(context, clearBytes);
      const raw = bytes(unpacked.snapshotPath, ledger.sizeBytes);
      requireThat(raw.length === ledger.sizeBytes && digest(raw) === ledger.sha256, 'RESTORE_LEDGER', 'The authenticated ledger changed after staging.');
      const snapshot = validateDeviceMigrationSnapshot(JSON.parse(raw.toString('utf8')));
      inventory = await createGeneration(context, candidateId, { snapshot, media: unpacked.media });
    } catch (error) {
      try { await discardStagedDeviceMigrationV2(unpacked); } catch { error.cleanupPending = true; }
      throw error;
    }
    await discardStagedDeviceMigrationV2(unpacked);
    const operationId = randomUUID();
    try {
      updateSwitch(context, { recordVersion: 1, sequence: 0, operationId, packageId: unpacked.manifest.packageId,
        manifestSha256: canonicalDigest(unpacked.manifest), sourceSchemaVersion: VERSION, previousGenerationId: state.active.generationId,
        candidateGenerationId: candidateId, candidateInventorySha256: inventory.checksum,
        phase: null, updatedAtUtc: null, errorCode: null }, 'PREPARED');
    } catch (error) {
      error.recoveryPending = true;
      error.operationId = operationId;
      throw error;
    }
    context.fault?.('after-prepared', { operationId });
    return activate(context, readState(context));
  });
}

async function resumeDeviceMigrationRestore(options) {
  return withTarget(options, context => {
    const state = readState(context);
    requireThat(state.latest && state.latest.operationId === options.operationId, 'RESTORE_STATE', 'The requested restore operation is not present.');
    requireThat(options.decision === 'activate' || options.decision === 'rollback', 'RESTORE_STATE', 'An explicit isolated resume decision is required.');
    return options.decision === 'rollback' ? rollBack(context, state, null) : activate(context, state);
  });
}

async function inspectDeviceMigrationRestore(options) {
  requireThat(options.operation === 'inspect', 'RESTORE_FROZEN', 'The isolated workspace freezes execution and business writes.');
  return withTarget(options, context => activeView(context, readState(context)));
}

module.exports = Object.freeze({ initializeDeviceMigrationRestoreTarget, restoreDeviceMigrationV2,
  resumeDeviceMigrationRestore, inspectDeviceMigrationRestore });
