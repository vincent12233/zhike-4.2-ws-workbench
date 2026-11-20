'use strict';

// Ordinary lookup indexes with reviewed, versioned definitions are
// reproducible. Tables, constraints, unique indexes and custom indexes have
// no automatic recovery path.
const ownedIndexes = new Map([
  ['008-ws-accounts.sql', ['idx_ws_conversations_last_message', 'idx_ws_messages_conversation_order']],
  ['017-ws-group-catalog.sql', ['idx_ws_group_catalog_account_status', 'idx_ws_group_catalog_channel', 'idx_ws_group_targets_account_group']],
  ['023-ws-group-manager.sql', ['idx_ws_group_members_account_group_status', 'idx_ws_group_members_phone']],
]);

const canonical = sql => String(sql || '').replace(/\bIF NOT EXISTS\s+/i, '').replace(/;$/, '').replace(/\s+/g, ' ').trim();

function planWsIndexRecovery(db, manifest, current, integrity) {
  const entries = manifest.migrations.filter(entry => entry.version <= current && ownedIndexes.has(entry.file));
  if (!entries.length) return [];
  let damaged = '';
  if (!integrity.ok) {
    if (integrity.foreignKeys.length) return [];
    const quickOk = integrity.quickCheck.length === 1 && integrity.quickCheck[0] === 'ok';
    for (const error of quickOk ? integrity.integrity : [...integrity.integrity, ...integrity.quickCheck]) {
      const match = /^(?:row \d+ missing from index|wrong # of entries in index) (idx_ws_[a-z0-9_]+)$/.exec(error);
      if (!match || (damaged && match[1] !== damaged)) return [];
      damaged = match[1];
    }
    if (!damaged) return [];
  }

  // Older workspaces without a fully verified registry follow the normal
  // migration path. Repair never supplies missing migration provenance.
  if (!db.prepare("SELECT 1 FROM pragma_table_info('schema_migrations') WHERE name='checksum'").get()) return [];
  const recorded = db.prepare('SELECT checksum FROM schema_migrations WHERE version=?');
  const schema = db.prepare('SELECT type,tbl_name,sql FROM sqlite_schema WHERE name=?');
  const repairs = [];
  for (const entry of entries) {
    if (recorded.get(entry.version)?.checksum !== entry.checksum) continue;
    for (const name of ownedIndexes.get(entry.file)) {
      if (damaged && damaged !== name) continue;
      const definition = new RegExp('^CREATE INDEX IF NOT EXISTS ' + name + '\\s+ON (ws_[a-z_]+)\\s*\\([^;]+;', 'mi').exec(entry.sql);
      if (!definition || schema.get(definition[1])?.type !== 'table') continue;
      const existing = schema.get(name);
      if (!existing && !damaged) repairs.push({ name, sql: definition[0] });
      if (damaged && existing?.type === 'index' && existing.tbl_name === definition[1] && canonical(existing.sql) === canonical(definition[0])) {
        repairs.push({ name, sql: 'REINDEX ' + name });
      }
    }
  }
  return repairs;
}

module.exports = { planWsIndexRecovery };
