'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { hostname, uptime } = require('node:os');
const { assertDeviceMigrationIsolationRoot } = require('./device-migration-isolation.cjs');
const { packageTransport } = require('./device-migration-package.cjs');
const {
  exportDeviceMigrationSnapshot, validateDeviceMigrationSnapshot, portableMedia,
} = require('./device-migration-snapshot.cjs');
const schema = require('./device-migration-snapshot-schema.json');

const VERSION = 2;
const SCHEMA = 25;
const PAYLOAD_VERSION = 1;
const MAX_LEDGER = 64 * 1024 * 1024;
const MAX_VALUE = 16 * 1024 * 1024;
const MAX_ROWS = 1_000_000;
const MAX_ACCOUNTS = 256;
const MEDIA_STATES = ['ready', 'available', 'pending', 'unavailable', 'deleted'];
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const PRIVATE_FILENAME = /^(?:(?:cookies|login data|web data|local state)(?:-(?:journal|wal|shm))?|indexeddb|session storage|local storage|dpapi|connection\.private(?:\.json)?|(?:api[-_ ]?keys?|credentials|private[-_ ]?key)\.[a-z0-9]+)$/i;
const OMITTED = Object.freeze([
  ['native-auth-and-device-profile', 'authorization-not-portable'],
  ['native-account-index', 'rebuild-target-metadata'],
  ['native-pending-and-dead-letter', 'external-queue-contract-unverified'],
  ['uncommitted-and-local-browser-state', 'outside-committed-source'],
  ['local-exports-and-logs', 'machine-local-artifact'],
  ['non-ready-media-content', 'metadata-only'],
  ['migration-history-and-active-leases', 'target-owned-runtime'],
]);

const bytes = value => Buffer.byteLength(JSON.stringify(value), 'utf8');
const compare = (left, right) => Buffer.compare(Buffer.from(left), Buffer.from(right));
const byMedia = (left, right) => compare(left.accountId, right.accountId) || compare(left.id, right.id);
const mediaKey = (accountId, id) => JSON.stringify([accountId, id]);
const hasOrderedKeys = (value, keys) => value && !Array.isArray(value) && typeof value === 'object' &&
  JSON.stringify(Object.keys(value)) === JSON.stringify(keys);
const equal = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const ownedStages = new WeakMap();
const discardedStages = new WeakSet();

function check(condition, code, message) {
  if (!condition) throw Object.assign(new Error(message), { code });
}

function inspectPayload(snapshot) {
  validateDeviceMigrationSnapshot(snapshot);
  check(hasOrderedKeys(snapshot, ['schemaVersion', 'coverage', 'tables']) &&
    hasOrderedKeys(snapshot.tables, Object.keys(schema)),
  'SNAPSHOT', 'Ledger tables must follow the reviewed schema order.');
  let rowCount = 0;
  for (const [table, definition] of Object.entries(schema)) {
    const rows = snapshot.tables[table];
    rowCount += rows.length;
    check(rowCount <= MAX_ROWS, 'LIMIT', 'Ledger contains too many rows.');
    let previous;
    for (const row of rows) {
      const key = row[definition.key];
      check(previous === undefined || (typeof key === 'string' ? compare(previous, key) < 0 : previous < key),
        'SNAPSHOT', 'Ledger primary keys must follow the source SQLite order.');
      previous = key;
      for (const [column, value] of Object.entries(row)) {
        const encoded = column === 'json' || column.endsWith('_json') ? bytes(value) :
          typeof value === 'string' ? Buffer.byteLength(value, 'utf8') : 0;
        check(encoded <= MAX_VALUE, 'LIMIT', 'A ledger field exceeds its size limit.');
      }
    }
  }
  const indexed = new Map();
  for (const row of snapshot.tables.ws_media_assets) {
    check(MEDIA_STATES.includes(row.status), 'MEDIA', 'Unknown media asset status.');
    check(!PRIVATE_FILENAME.test(row.file_name.trim().normalize('NFKC')),
      'PRIVATE_DATA', 'A media index identifies credential or device-profile content.');
    indexed.set(mediaKey(row.account_id, row.id), {
      status: row.status, sizeBytes: row.size_bytes, sha256: row.sha256,
    });
  }
  return indexed;
}

function accountEntries(snapshot) {
  return snapshot.tables.ws_accounts.map(row => ({ id: row.id })).sort((left, right) => compare(left.id, right.id));
}

function coverageFor(snapshot, media) {
  const counts = Object.fromEntries(MEDIA_STATES.map(state => [state, 0]));
  for (const row of snapshot.tables.ws_media_assets) counts[row.status]++;
  check(counts.ready === media.length, 'MEDIA', 'Every ready asset must be present in the package.');
  return {
    status: 'partial',
    scope: 'sqlite-business-025',
    tableRows: snapshot.coverage.tableRows,
    withheldColumns: snapshot.coverage.withheldColumns,
    nestedFieldsWithheld: snapshot.coverage.nestedFieldsWithheld,
    media: {
      readyIndexed: counts.ready, included: media.length, available: counts.available,
      pending: counts.pending, unavailable: counts.unavailable, deleted: counts.deleted,
    },
    omittedDomains: OMITTED.map(([id, reason]) => ({ id, reason })),
  };
}

function validateManifest(manifest) {
  check(hasOrderedKeys(manifest, ['formatVersion', 'schemaVersion', 'packageId', 'createdAtUtc', 'ledger', 'accounts', 'media', 'coverage']) &&
    manifest.formatVersion === VERSION && manifest.schemaVersion === SCHEMA &&
    typeof manifest.packageId === 'string' && UUID.test(manifest.packageId) &&
    typeof manifest.createdAtUtc === 'string' && UTC.test(manifest.createdAtUtc) &&
    Number.isFinite(Date.parse(manifest.createdAtUtc)) && new Date(manifest.createdAtUtc).toISOString() === manifest.createdAtUtc,
  'FORMAT', 'Unsupported or invalid v2 package manifest.');
  const { ledger, accounts, media, coverage } = manifest;
  check(hasOrderedKeys(ledger, ['payloadVersion', 'sizeBytes', 'sha256']) && ledger.payloadVersion === PAYLOAD_VERSION &&
    Number.isSafeInteger(ledger.sizeBytes) && ledger.sizeBytes > 0 && ledger.sizeBytes <= MAX_LEDGER &&
    typeof ledger.sha256 === 'string' && SHA256.test(ledger.sha256),
  'LIMIT', 'Unsupported or oversized v2 ledger.');
  check(Array.isArray(accounts) && accounts.length <= MAX_ACCOUNTS &&
    accounts.every((row, index) => hasOrderedKeys(row, ['id']) && typeof row.id === 'string' &&
      (index === 0 || compare(accounts[index - 1].id, row.id) < 0)),
  'FORMAT', 'Invalid account scope in v2 manifest.');
  check(Array.isArray(media) && media.length <= 4096 &&
    media.every((row, index) => hasOrderedKeys(row, ['accountId', 'id', 'sizeBytes', 'sha256']) &&
      typeof row.accountId === 'string' && typeof row.id === 'string' && (index === 0 || byMedia(media[index - 1], row) < 0)),
  'FORMAT', 'Invalid media order in v2 manifest.');
  check(coverage?.status === 'partial' && coverage.scope === 'sqlite-business-025',
    'FORMAT', 'Unsupported v2 coverage claim.');
}

function retainStage(result, owned) {
  ownedStages.set(result, owned);
}

const v2Envelope = Object.freeze({
  version: VERSION,
  inspectPayload,
  validateManifest,
  payloadEntry: manifest => manifest.ledger,
  describe(snapshot, _assets, entry, media) {
    const manifest = {
      formatVersion: VERSION,
      schemaVersion: SCHEMA,
      packageId: randomUUID(),
      createdAtUtc: new Date().toISOString(),
      ledger: { payloadVersion: PAYLOAD_VERSION, ...entry },
      accounts: accountEntries(snapshot),
      media,
      coverage: coverageFor(snapshot, media),
    };
    validateManifest(manifest);
    return manifest;
  },
  verifyClaims(snapshot, _assets, manifest) {
    check(equal(manifest.accounts, accountEntries(snapshot)) &&
      equal(manifest.coverage, coverageFor(snapshot, manifest.media)),
    'FORMAT', 'Package account or coverage claims differ from the ledger.');
  },
  retainStage,
});

async function checkedSourceState(isolationRoot, db) {
  const sourceRoot = path.dirname(db);
  const sourceNames = (await fs.readdir(sourceRoot)).map(name => name.toLowerCase());
  const activeNames = ['.workbench.lock.recovery', '.migration.lock', 'workspace.sqlite-journal'];
  check(!activeNames.some(name => sourceNames.includes(name)),
    'SOURCE_BUSY', 'Close the isolated source and checkpoint SQLite before packaging.');
  const siblings = ['-wal', '-shm'].filter(suffix => sourceNames.includes('workspace.sqlite' + suffix))
    .map(suffix => db + suffix);
  if (!siblings.length) return;
  const verified = await assertDeviceMigrationIsolationRoot(isolationRoot, ...siblings);
  // A prior read-only WAL connection can leave an empty WAL and regular SHM.
  // A nonempty WAL may contain committed changes absent from the main file.
  for (const sibling of siblings) {
    const stat = verified.get(sibling);
    check(stat.isFile() && (!sibling.endsWith('-wal') || stat.size === 0n), 'SOURCE_BUSY',
      'Checkpoint the isolated SQLite WAL before packaging.');
  }
}

async function createSourceFile(pathname, parent, owned) {
  const file = await fs.open(pathname, 'wx', 0o600);
  const item = { pathname, parent, stat: null };
  owned.push(item);
  try {
    item.stat = await file.stat({ bigint: true });
    return file;
  } catch (error) {
    await file.close();
    throw error;
  }
}

async function acquireSourceLease(lockPath, parent, owned) {
  let lock;
  try {
    lock = await createSourceFile(lockPath, parent, owned);
  } catch (error) {
    check(error.code !== 'EEXIST', 'SOURCE_BUSY', 'The isolated source is already in use.');
    throw error;
  }
  try {
    // Match the existing sidecar's owner fields so its stale-lock recovery
    // recognizes a live exporter. No existing lock contents are read.
    await lock.writeFile(JSON.stringify({
      pid: process.pid, host: hostname(), bootTime: Math.floor(Date.now() / 1000 - uptime()), token: randomUUID(),
    }));
    await lock.sync();
  } finally {
    await lock.close();
  }
}

async function copySource(source, destination, size) {
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  let remaining = size;
  while (remaining > 0n) {
    const length = remaining > BigInt(buffer.length) ? buffer.length : Number(remaining);
    const { bytesRead } = await source.read(buffer, 0, length, null);
    check(bytesRead > 0, 'PATH', 'The isolated SQLite source became shorter during copy.');
    for (let offset = 0; offset < bytesRead;) {
      const { bytesWritten } = await destination.write(buffer, offset, bytesRead - offset, null);
      check(bytesWritten > 0, 'WRITE', 'The private SQLite copy did not progress.');
      offset += bytesWritten;
    }
    remaining -= BigInt(bytesRead);
  }
}

async function readPinnedSnapshot(isolationRoot, rootStat, db, sourceStat) {
  const source = await packageTransport.openSource(db, sourceStat);
  const owned = [];
  let primaryError;
  try {
    const directory = await fs.mkdtemp(path.join(isolationRoot, 'rd09-source-'));
    const item = { pathname: directory, parent: rootStat, stat: null };
    owned.push(item);
    item.stat = await fs.lstat(directory, { bigint: true });
    await packageTransport.verifyPrivateDirectory(directory, item.stat, true);
    const filename = path.join(directory, 'workspace.sqlite');
    const copy = await createSourceFile(filename, item.stat, owned);
    try {
      await copySource(source, copy, sourceStat.size);
      check(packageTransport.sameFileRevision(sourceStat, await source.stat({ bigint: true })),
        'PATH', 'The isolated SQLite source changed during the pinned copy.');
      const copyStat = await copy.stat({ bigint: true });
      const verifyCopy = async () => check(copyStat.size === sourceStat.size &&
        packageTransport.sameFileRevision(copyStat, await fs.lstat(filename, { bigint: true })) &&
        packageTransport.sameIdentity(item.stat, await fs.lstat(directory, { bigint: true })),
      'PATH', 'The private SQLite copy changed.');
      await verifyCopy();
      const snapshot = exportDeviceMigrationSnapshot(filename, { privateCheckpointCopy: true });
      await verifyCopy();
      return snapshot;
    } finally {
      await copy.close();
    }
  } catch (error) {
    primaryError = error;
    throw error;
  } finally {
    try {
      await source.close();
    } finally {
      if (!await packageTransport.removeOwned(owned, { requirePresent: true })) {
        if (!primaryError) primaryError = Object.assign(new Error('Could not safely clean up the private SQLite copy.'),
          { code: 'CLEANUP_PENDING' });
        primaryError.cleanupPending = true;
        throw primaryError;
      }
    }
  }
}

async function writeDevicePackageV2({ isolationRoot, databasePath, destination, password }) {
  const isolated = packageTransport.checkedAbsolute(isolationRoot);
  const db = packageTransport.checkedAbsolute(databasePath);
  const output = packageTransport.checkedAbsolute(destination, '.zkdevice');
  const sourceRoot = path.dirname(db);
  const paths = await assertDeviceMigrationIsolationRoot(isolated, db, path.dirname(output));
  check(path.basename(db) === 'workspace.sqlite', 'ISOLATION', 'Expected an isolated workspace.sqlite data file.');
  const sourceStat = paths.get(db);
  const lockPath = path.join(sourceRoot, '.workbench.lock');
  const lease = [];
  const release = async () => {
    if (!lease.length) return;
    const owned = lease.splice(0);
    if (!await packageTransport.removeOwned(owned, { requirePresent: true })) {
      throw Object.assign(new Error('Could not safely release the isolated source lease.'),
        { code: 'CLEANUP_PENDING', cleanupPending: true });
    }
  };
  try {
    await acquireSourceLease(lockPath, paths.get(sourceRoot), lease);
    const verifySource = async () => {
      await checkedSourceState(isolated, db);
      check(packageTransport.sameFileRevision(sourceStat, await fs.lstat(db, { bigint: true })) &&
        packageTransport.sameIdentity(lease[0].stat, await fs.lstat(lockPath, { bigint: true })) &&
        packageTransport.sameIdentity(paths.get(sourceRoot), await fs.lstat(sourceRoot, { bigint: true })),
      'PATH', 'The isolated SQLite source or source lease changed.');
    };
    await verifySource();
    const snapshot = await readPinnedSnapshot(isolated, paths.get(isolated), db, sourceStat);
    await verifySource();
    const media = portableMedia(snapshot.tables).sort(byMedia);
    const mediaRoot = media.length ? path.join(sourceRoot, 'ws-media') : undefined;
    const envelope = { ...v2Envelope, async beforeWriteComplete() {
      await verifySource();
      await release();
    } };
    return await packageTransport.writePackageEnvelope({ destination: output, password, snapshot, mediaRoot, media }, envelope);
  } catch (error) {
    try { await release(); } catch { error.cleanupPending = true; }
    throw error;
  }
}

async function unpackDevicePackageV2({ isolationRoot, source, password, stagingParent }) {
  await assertDeviceMigrationIsolationRoot(isolationRoot, source, stagingParent);
  return packageTransport.unpackPackageEnvelope({ source, password, stagingParent }, v2Envelope);
}

const isolatedV1Envelope = Object.freeze({ ...packageTransport.v1Envelope, retainStage });

// Version selection occurs once on the open verified input. An authentication
// or structure error never invokes a different parser.
async function unpackIsolatedDeviceMigrationPackage({ isolationRoot, source, password, stagingParent }) {
  await assertDeviceMigrationIsolationRoot(isolationRoot, source, stagingParent);
  return packageTransport.unpackPackageEnvelope({ source, password, stagingParent }, isolatedV1Envelope, v2Envelope);
}

async function discardStagedDeviceMigrationV2(result) {
  if (discardedStages.has(result)) return;
  const owned = ownedStages.get(result);
  // Take ownership once. Never try to reclaim files by the returned paths.
  ownedStages.delete(result);
  if (!owned || !await packageTransport.removeOwned(owned, { requirePresent: true })) {
    throw Object.assign(new Error('Some isolated stage files could not be safely removed.'),
      { code: 'CLEANUP_PENDING', cleanupPending: true });
  }
  discardedStages.add(result);
}

module.exports = Object.freeze({
  writeDevicePackageV2, unpackDevicePackageV2, unpackIsolatedDeviceMigrationPackage, discardStagedDeviceMigrationV2,
});
