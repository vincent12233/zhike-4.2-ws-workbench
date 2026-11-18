'use strict';

const { DatabaseSync } = require('node:sqlite');
const { dirname, isAbsolute, join } = require('node:path');
const { pathToFileURL } = require('node:url');
const schema = require('./device-migration-snapshot-schema.json');
const { writeDevicePackage } = require('./device-migration-package.cjs');

const VERSION = 25;
const MAX_BYTES = 64 * 1024 * 1024;
const MAX_ACCOUNTS = 256;
const MAX_ROW_BYTES = 16 * 1024 * 1024;
const names = Object.keys(schema);
const words = value => value ? value.split(' ') : [];
const columnsOf = definition => [...words(definition.text), ...words(definition.integer), ...words(definition.real)];
const quote = name => '"' + name.replaceAll('"', '""') + '"';
const omitted = Object.freeze([
  'device-and-webview-profiles', 'native-account-store-and-local-write-queue',
  'browser-local-state-and-uncommitted-input', 'export-artifact-files', 'non-ready-media-bytes',
  'migration-registry-and-runtime-leases', 'group-reading-rules-and-history-outside-sqlite',
]);

const unsafeKey = /^(?:__proto__|constructor|prototype)$/;
const privateKey = /(?:password|passphrase|secret|token|credential|cookie|apikey|authorization|authheader|privatekey|webviewprofile|browserprofile|loginprofile|sessionprofile|profilepath|profiledirectory|profileavatar|loginstate|authstate|authsession|qrcode|qrpayload|oauth|dpapi|connectionprivate|indexeddb|localstorage|sessionstorage|serviceworker|partitionkey)/;
const safeCounters = new Set(['maxtokens', 'inputtokens', 'outputtokens', 'prompttokens', 'completiontokens', 'totaltokens', 'cachedtokens', 'reasoningtokens']);
const privateText = /(?:\bBearer[ \t]+[\w+/=.-]{8,}|\b(?:api[_ -]?key|access[_ -]?token|refresh[_ -]?token|password|cookie|authorization)\s*[:=]\s*\S+|\b(?:sk-(?:proj-)?[A-Za-z0-9_-]{16,}|AIza[\w-]{30,}|eyJ[\w-]+\.eyJ[\w-]+\.[\w-]+)\b|-----BEGIN [A-Z ]*PRIVATE KEY-----)/i;
const machinePath = /(?:[a-z]:[\\/]|\\\\[^\\/\s]+[\\/]|\bfile:\/\/|(?:^|[\s"'`=(])\/(?!\/)(?:[^/\s:?#]+\/)+[^/\s:?#]+|^\/(?:bin|boot|dev|etc|home|lib|mnt|opt|proc|root|run|srv|tmp|usr|var|Volumes|Users)(?:$|\/)|(?:^|[\s"'`=(])~[\\/])/iu;

const mediaId = /^wsm-[a-z0-9]+-[a-f0-9]{10}$/;
const sha = /^[a-f0-9]{64}$/;
const docValue = row => row.json;
const jsonColumn = key => key === 'json' || key.endsWith('_json');
const isRecord = value => value !== null && typeof value === 'object' &&
  [null, Object.prototype].includes(Object.getPrototypeOf(value));
const validKey = value => typeof value === 'string' && value.length > 0 && value.trim() === value &&
  !/[\u0000-\u001f\u007f]/.test(value) && !unsafeKey.test(value);

function check(condition, code, message) {
  if (!condition) throw Object.assign(new Error(message), { code });
}

function exactKeys(value, keys) {
  return isRecord(value) && Reflect.ownKeys(value).length === keys.length && keys.every(key => {
    const property = Object.getOwnPropertyDescriptor(value, key);
    return property && property.enumerable && Object.hasOwn(property, 'value');
  });
}

function list(value) {
  return Array.isArray(value) && Object.getPrototypeOf(value) === Array.prototype && Object.keys(value).length === value.length &&
    Reflect.ownKeys(value).length === value.length + 1 && Object.keys(value).every((key, index) => {
      const property = Object.getOwnPropertyDescriptor(value, key);
      return key === String(index) && Object.hasOwn(property, 'value');
    });
}

function jsonPolicy(value, projection, budget, depth = 0) {
  check(depth <= 64, 'SNAPSHOT_LIMIT', 'Business data is nested too deeply.');
  if (typeof value === 'string') {
    check(!value.includes('\0') && !machinePath.test(value) && !privateText.test(value), 'SNAPSHOT_PRIVATE', 'A business value has credential or machine-path syntax.');
    // Some existing JSON carriers contain serialized JSON strings.
    if (/^\s*[\[{]/.test(value)) {
      let embedded;
      try { embedded = JSON.parse(value); } catch {}
      if (embedded !== undefined) {
        const safe = jsonPolicy(embedded, projection, budget, depth + 1);
        return projection ? JSON.stringify(safe) : value;
      }
    }
    return value;
  }
  if (value === null || typeof value === 'boolean' || typeof value === 'number') {
    check(typeof value !== 'number' || Number.isFinite(value) &&
      (!Number.isInteger(value) || Number.isSafeInteger(value)), 'SNAPSHOT_FORMAT', 'Invalid business JSON number.');
    return value;
  }
  if (list(value)) return value.map(item => jsonPolicy(item, projection, budget, depth + 1));
  check(isRecord(value), 'SNAPSHOT_FORMAT', 'Invalid business JSON value.');
  const output = Object.create(null);
  const keys = Object.keys(value);
  check(exactKeys(value, keys), 'SNAPSHOT_FORMAT', 'Invalid business JSON properties.');
  for (const key of keys) {
    check(!unsafeKey.test(key), 'SNAPSHOT_FORMAT', 'Invalid business JSON key.');
    const normalized = key.normalize('NFKC').replace(/[^a-z0-9]/gi, '').toLowerCase();
    const safeCounter = safeCounters.has(normalized) && Number.isSafeInteger(value[key]) && value[key] >= 0;
    if (privateKey.test(normalized) && !safeCounter) {
      check(projection, 'SNAPSHOT_PRIVATE', 'Snapshot contains a forbidden device or credential field.');
      budget.redacted++;
      continue;
    }
    check(!machinePath.test(key) && !privateText.test(key), 'SNAPSHOT_PRIVATE', 'Snapshot contains a credential or machine-path key.');
    output[key] = jsonPolicy(value[key], projection, budget, depth + 1);
  }
  return output;
}

function normalizeRow(source, definition, project, budget) {
  const output = {};
  for (const key of columnsOf(definition)) {
    const value = source[key];
    if (words(definition.text).includes(key)) {
      const length = typeof value === 'string' ? Buffer.byteLength(value) : 0;
      budget.bytes += length;
      check(length <= MAX_ROW_BYTES && budget.bytes <= MAX_BYTES, 'SNAPSHOT_LIMIT', 'Business snapshot exceeds the SQLite projection limit.');
      check(typeof value === 'string', 'SNAPSHOT_FORMAT', 'Expected portable text in business row.');
      if (jsonColumn(key)) {
        let parsed;
        try { parsed = JSON.parse(value); } catch {}
        check(parsed !== undefined, 'SNAPSHOT_FORMAT', 'Invalid business JSON column.');
        output[key] = jsonPolicy(parsed, project, budget);
      } else {
        output[key] = jsonPolicy(value, false, budget);
      }
    } else {
      check(words(definition.integer).includes(key) ? Number.isSafeInteger(value) : Number.isFinite(value),
        'SNAPSHOT_FORMAT', 'Invalid numeric business column.');
      output[key] = value;
    }
  }
  return output;
}

function portableMedia(tables) {
  return tables.ws_media_assets.filter(row => row.status === 'ready').map(row => {
    const directory = row.account_id.replace(/[^A-Za-z0-9._:-]/g, '_');
    check(/^[A-Za-z0-9._-]+$/.test(directory) && !/^(?:\.{1,2}|.*\.)$/.test(directory) &&
      !/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(directory),
    'SNAPSHOT_MEDIA', 'An account has no portable media directory name.');
    check(mediaId.test(row.id) && Number.isSafeInteger(row.size_bytes) && row.size_bytes >= 0 && sha.test(row.sha256),
      'SNAPSHOT_MEDIA', 'Invalid ready media size, digest or identifier.');
    return { accountId: row.account_id, id: row.id, sizeBytes: row.size_bytes, sha256: row.sha256, relativePath: directory + '/' + row.id };
  });
}

function verifyTables(db) {
  const actual = db.prepare("SELECT name,type FROM sqlite_schema WHERE name NOT GLOB 'sqlite_*' AND type IN ('table','view') ORDER BY name").all();
  check(actual.every(row => row.type === 'table' && (names.includes(row.name) || row.name === 'schema_migrations')) &&
    names.every(name => actual.some(row => row.name === name)), 'SNAPSHOT_SCHEMA', 'Expected only the reviewed 025 workspace tables.');
  for (const [name, definition] of Object.entries(schema)) {
    const columns = db.prepare('PRAGMA table_xinfo(' + quote(name) + ')').all();
    const expected = [
      ...words(definition.text).map(key => [key, 'TEXT']),
      ...words(definition.integer).map(key => [key, 'INTEGER']),
      ...words(definition.real).map(key => [key, 'REAL']),
    ];
    const withheld = words(definition.withheld);
    check(columns.length === expected.length + withheld.length &&
      expected.every(([key, type]) => columns.some(column => column.name === key && column.type === type &&
        column.hidden === 0 && column.pk === Number(key === definition.key))) &&
      withheld.every(key => columns.some(column => column.name === key && column.hidden === 0 && column.pk === 0)),
    'SNAPSHOT_SCHEMA', 'Workspace columns differ from the reviewed 025 policy for ' + name + '.');
    const references = db.prepare('PRAGMA foreign_key_list(' + quote(name) + ')').all();
    const expectedReferences = words(definition.references);
    check(references.length === expectedReferences.length && references.every(ref =>
      expectedReferences.includes(ref.from + ':' + ref.table) && schema[ref.table]?.key === ref.to),
    'SNAPSHOT_SCHEMA', 'Workspace foreign keys differ from the reviewed 025 policy for ' + name + '.');
  }
}

function verifyRelations(tables, indexes) {
  const accounts = indexes.ws_accounts;
  check(accounts.size <= MAX_ACCOUNTS && new Set([...accounts.keys()].map(id => id.toLowerCase())).size === accounts.size &&
    [...accounts.keys()].every(id => id.length <= 120), 'SNAPSHOT_SCOPE', 'Invalid or duplicate account identity.');
  const state = tables.app_state[0];
  const customers = state?.json.customers || [];
  check(tables.app_state.length <= 1 && (!state || state.id === 1 && state.revision >= 0 && Array.isArray(state.json.customers)) &&
    customers.length === indexes.customers.size, 'SNAPSHOT_RELATION', 'CRM state and the derived customer index disagree.');
  const customerIds = new Set();
  for (const customer of customers) {
    const indexed = indexes.customers.get(String(customer?.id));
    check(isRecord(customer) && indexed && !customerIds.has(indexed.id) &&
      JSON.stringify(customer) === JSON.stringify(indexed.data_json), 'SNAPSHOT_RELATION', 'CRM customer payload differs from its index.');
    customerIds.add(indexed.id);
  }
  for (const [name, definition] of Object.entries(schema)) {
    const refs = words(definition.references);
    for (const row of tables[name]) {
      const account = row.account_id;
      check(account === undefined || accounts.has(account) ||
        (name === 'ws_export_jobs' && row.scope === 'all' && account === ''),
      'SNAPSHOT_SCOPE', 'A business row refers to an unknown account in ' + name + '.');
      for (const ref of refs) {
        const [column, table] = ref.split(':');
        const parent = indexes[table].get(row[column]);
        check(parent && (account === undefined || parent.account_id === undefined || parent.account_id === account),
          'SNAPSHOT_RELATION', 'A workspace relation is missing or crosses account boundaries in ' + name + '.');
      }
      // Historical sources may have been deleted, but a still-resolvable ID
      // must never silently link to a different WS account.
      for (const [column, target] of Object.entries({
        conversation_id: 'ws_conversations', analysis_id: 'ws_ai_analyses', job_id: 'ai_jobs',
      })) {
        const parent = indexes[target].get(row[column]);
        check(account === undefined || !parent || parent.account_id === account,
          'SNAPSHOT_RELATION', 'A historical source resolves into a different account in ' + name + '.');
      }
    }
  }
  for (const row of tables.ws_group_monitor_checkpoints) {
    const target = indexes.ws_group_monitor_targets.get(row.target_id);
    check(target.profile_id === row.profile_id, 'SNAPSHOT_RELATION', 'Monitor checkpoint crosses profile boundaries.');
  }
  for (const row of tables.ws_group_membership_events) {
    const target = indexes.ws_group_monitor_targets.get(row.target_id);
    check(target.profile_id === row.profile_id && target.group_jid === row.group_jid,
      'SNAPSHOT_RELATION', 'A group event crosses its monitor target boundary.');
  }
}

function verifySends(tables, indexes) {
  const byAudit = new Map();
  for (const attachment of tables.ws_send_attachments) {
    const attachments = byAudit.get(attachment.send_audit_id) || [];
    attachments.push(attachment);
    byAudit.set(attachment.send_audit_id, attachments);
    const attempt = attachment.data_json?.sendAttempt;
    const parent = indexes.ws_send_audit.get(attachment.send_audit_id);
    if (attempt !== undefined) {
      check(isRecord(attempt) && validKey(attempt.id) && attempt.id === parent.native_result_json?.sendAttempt?.id &&
        ['unknown', 'local_attempted', 'failed'].includes(attempt.deliveryState),
      'SNAPSHOT_SEND', 'Attachment attempt is inconsistent with the send audit.');
    }
  }
  for (const audit of tables.ws_send_audit) {
    const planned = audit.attachment_ids_json;
    const attachments = byAudit.get(audit.id) || [];
    const related = attachments.map(row => row.media_id).sort();
    const metadata = audit.native_result_json;
    // Older audits may use the media ID array without attachment rows. Keep
    // those references and require same-account assets, as the delete guard does.
    check(list(planned) && planned.every(id => indexes.ws_media_assets.get(id)?.account_id === audit.account_id) &&
      (!related.length && !metadata?.planFingerprint || equalJson([...planned].sort(), related)),
    'SNAPSHOT_SEND', 'Send plan and attachment identifiers disagree.');
    const attempt = metadata?.sendAttempt;
    if (attempt !== undefined) {
      check(isRecord(attempt) && validKey(attempt.id) &&
        ['prepared', 'progress', 'completed', 'failed'].includes(attempt.phase) &&
        ['unknown', 'local_attempted', 'failed'].includes(attempt.deliveryState) &&
        typeof attempt.safeToRetry === 'boolean' &&
        (!attempt.safeToRetry || attempt.deliveryState === 'failed' && attempt.observedUnknown !== true),
      'SNAPSHOT_SEND', 'Send attempt has an invalid or unsafe retry state.');
    }
  }
}

function coverageFor(tables, nestedFieldsWithheld) {
  return {
    status: 'partial',
    omittedDomains: [...omitted],
    tableRows: Object.fromEntries(names.map(name => [name, tables[name].length])),
    withheldColumns: Object.fromEntries(names.filter(name => schema[name].withheld).map(name => [name, words(schema[name].withheld)])),
    nestedFieldsWithheld,
    mediaBytes: 'not-in-snapshot',
  };
}

function equalJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function validateDeviceMigrationSnapshot(snapshot) {
  check(exactKeys(snapshot, ['schemaVersion', 'coverage', 'tables']) && snapshot.schemaVersion === VERSION &&
    exactKeys(snapshot.tables, names), 'SNAPSHOT_FORMAT', 'Expected a reviewed 025 ledger with every table section.');
  const { tables, coverage } = snapshot;
  const budget = { bytes: 0, redacted: 0 };
  const indexes = Object.create(null);
  for (const [name, definition] of Object.entries(schema)) {
    const rows = tables[name];
    check(list(rows), 'SNAPSHOT_FORMAT', 'Invalid business table rows.');
    const index = new Map();
    indexes[name] = index;
    for (const row of rows) {
      const columns = columnsOf(definition);
      check(exactKeys(row, columns), 'SNAPSHOT_FORMAT', 'Unexpected business table fields for ' + name + '.');
      for (const key of columns) {
        const value = row[key];
        if (jsonColumn(key)) jsonPolicy(value, false, budget);
        else if (typeof value === 'string') {
          check(words(definition.text).includes(key), 'SNAPSHOT_FORMAT', 'Invalid business table value.');
          jsonPolicy(value, false, budget);
        } else check(words(definition.integer).includes(key) ? Number.isSafeInteger(value) :
          words(definition.real).includes(key) && Number.isFinite(value), 'SNAPSHOT_FORMAT', 'Invalid business table value.');
      }
      const key = row[definition.key];
      check((validKey(key) || Number.isSafeInteger(key) && key >= 1) && !index.has(key),
        'SNAPSHOT_FORMAT', 'Invalid or duplicate primary key in ' + name + '.');
      index.set(key, row);
      budget.bytes += Buffer.byteLength(JSON.stringify(row));
      check(budget.bytes <= MAX_BYTES, 'SNAPSHOT_LIMIT', 'Business snapshot exceeds the SQLite projection limit.');
    }
  }
  check(exactKeys(coverage, Object.keys(coverageFor(tables, 0))) && Number.isSafeInteger(coverage.nestedFieldsWithheld) &&
    coverage.nestedFieldsWithheld >= 0 && equalJson(coverage, coverageFor(tables, coverage.nestedFieldsWithheld)),
  'SNAPSHOT_COVERAGE', 'Snapshot coverage does not match the recorded projection.');
  for (const state of [...tables.app_state, ...tables.state_snapshots].map(docValue)) {
    check(isRecord(state) && Array.isArray(state.customers) && (state.schemaVersion === undefined || state.schemaVersion === 4),
      'SNAPSHOT_FORMAT', 'Invalid CRM state or history.');
  }
  verifyRelations(tables, indexes);
  verifySends(tables, indexes);
  portableMedia(tables);
  return snapshot;
}

function exportDeviceMigrationSnapshot(databasePath, { privateCheckpointCopy = false } = {}) {
  check(typeof databasePath === 'string' && isAbsolute(databasePath), 'SNAPSHOT_PATH', 'An explicit absolute workspace SQLite path is required.');
  // Immutable mode is reserved for an isolated, already-checkpointed private
  // copy. Live/default callers still coordinate through SQLite read locking.
  const filename = privateCheckpointCopy ? pathToFileURL(databasePath) : databasePath;
  if (privateCheckpointCopy) filename.searchParams.set('immutable', '1');
  const db = new DatabaseSync(filename, { readOnly: true, enableForeignKeyConstraints: true });
  try {
    db.exec('PRAGMA query_only=ON; BEGIN');
    try {
      // The first schema read pins the same snapshot through every table and
      // relationship check, including when the existing writer is using WAL.
      check(db.prepare('PRAGMA user_version').get().user_version === VERSION,
        'SNAPSHOT_SCHEMA', 'Workspace SQLite version is not 025.');
      verifyTables(db);
      check(!db.prepare('PRAGMA foreign_key_check').get(), 'SNAPSHOT_RELATION', 'Workspace has broken SQLite foreign keys.');
      const tables = {};
      const budget = { bytes: 0, redacted: 0 };
      for (const [name, definition] of Object.entries(schema)) {
        const rows = [];
        tables[name] = rows;
        // Storage paths are read solely for a canonical-binding check while
        // the read transaction is pinned. They never enter the ledger.
        const columns = [...columnsOf(definition), ...(name === 'ws_media_assets' ? ['storage_path'] : [])];
        const statement = db.prepare('SELECT ' + columns.map(quote).join(',') + ' FROM ' + quote(name) + ' ORDER BY ' + quote(definition.key));
        for (const row of statement.iterate()) {
          if (name === 'ws_media_assets' && row.status === 'ready') {
            const expected = portableMedia({ ws_media_assets: [row] })[0].relativePath;
            check(row.storage_path.replaceAll('\\', '/') === 'ws-media/' + expected,
              'SNAPSHOT_MEDIA', 'Ready media does not use its canonical account storage entry.');
          }
          rows.push(normalizeRow(row, definition, true, budget));
        }
      }
      const result = validateDeviceMigrationSnapshot({
        schemaVersion: VERSION, coverage: coverageFor(tables, budget.redacted), tables,
      });
      db.exec('COMMIT');
      return result;
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  } finally {
    db.close();
  }
}

// Selected wire contracts only. v1 cannot carry the ledger; the package
// engine still owns format, encryption, coverage, media I/O and staging.
const crmV1Arrays = ['customers', 'savedViews', 'activities', 'tickets', 'deposits', 'followups',
  'registrations', 'phoneRegistry', 'batchOperations', 'importIssues'];
const wsV1Tables = {
  settings: 'ws_settings', conversations: 'ws_conversations', messages: 'ws_messages',
  analyses: 'ws_ai_analyses', replies: 'ws_replies', batches: 'ws_ingest_batches',
  collectionRuns: 'ws_collection_runs', collectionItems: 'ws_collection_items',
  followupAlerts: 'ws_followup_alerts', sendAudit: 'ws_send_audit', mediaAssets: 'ws_media_assets',
  groups: 'ws_group_catalog', groupMembershipEvents: 'ws_group_membership_events',
};
function wireRow(row) {
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [
    key.replace(/_json$/, '').replace(/_([a-z])/g, (_, letter) => letter.toUpperCase()), value,
  ]));
}

function projectDeviceMigrationPackageV1(snapshot) {
  const { tables } = validateDeviceMigrationSnapshot(snapshot);
  const state = tables.app_state[0]?.json;
  const crm = { schemaVersion: 4, customers: state?.customers || [] };
  for (const key of crmV1Arrays) if (Array.isArray(state?.[key])) crm[key] = state[key];
  if (isRecord(state?.settings)) crm.settings = state.settings;
  const wsAccounts = Object.create(null);
  const wsAccountMetadata = tables.ws_accounts.map(row => {
    wsAccounts[row.id] = { schemaVersion: 6, ...Object.fromEntries(Object.keys(wsV1Tables).map(key => [key, []])) };
    return { id: row.id, displayName: row.display_name };
  });
  for (const [section, table] of Object.entries(wsV1Tables)) {
    for (const row of tables[table]) wsAccounts[row.account_id][section].push(wireRow(row));
  }
  return {
    snapshot: { schemaVersion: VERSION, crm, wsAccounts, wsAccountMetadata },
    media: portableMedia(tables),
  };
}

async function writeDeviceMigrationPackageV1({ databasePath, destination, password }) {
  const { snapshot, media } = projectDeviceMigrationPackageV1(exportDeviceMigrationSnapshot(databasePath));
  return writeDevicePackage({ destination, password, snapshot, media,
    mediaRoot: media.length ? join(dirname(databasePath), 'ws-media') : undefined });
}

module.exports = Object.freeze({
  exportDeviceMigrationSnapshot, validateDeviceMigrationSnapshot, projectDeviceMigrationPackageV1,
  writeDeviceMigrationPackageV1, portableMedia,
});
