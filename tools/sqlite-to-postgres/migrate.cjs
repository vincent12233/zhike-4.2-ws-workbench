'use strict';

const { DatabaseSync } = require('node:sqlite');
const { createHash, randomUUID } = require('node:crypto');
const { existsSync, readFileSync, writeFileSync, mkdirSync } = require('node:fs');
const path = require('node:path');
const ticketCore = require('../../resources/app/modules/ticket-record-core.js');

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) continue;
    result[token.slice(2)] = argv[index + 1]?.startsWith('--') ? true : argv[++index];
  }
  return result;
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])]));
  return value;
}

function hash(value) {
  return createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
}

function tableExists(db, name) {
  return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name));
}

function readJson(value, fallback) {
  try { return JSON.parse(String(value || '')); } catch { return fallback; }
}

function readLegacy(sourcePath) {
  if (!existsSync(sourcePath)) throw new Error(`源 SQLite 不存在：${sourcePath}`);
  const db = new DatabaseSync(sourcePath, { readOnly: true });
  try {
    const integrity = db.prepare('PRAGMA integrity_check').all().map(row => Object.values(row)[0]);
    if (integrity.length !== 1 || integrity[0] !== 'ok') throw new Error('源 SQLite 完整性检查失败');
    const stateRow = tableExists(db, 'app_state') ? db.prepare('SELECT json, revision FROM app_state WHERE id=1').get() : null;
    const state = readJson(stateRow?.json, {});
    const customers = Array.isArray(state.customers) ? state.customers : (tableExists(db, 'customers')
      ? db.prepare('SELECT id, phone_normalized AS phone, name, data_json FROM customers ORDER BY id').all().map(row => ({ ...readJson(row.data_json, {}), id: row.id, phone: row.phone || row.phone_normalized || '', name: row.name || '' }))
      : []);
    const tickets = Array.isArray(state.tickets) ? state.tickets : [];
    const deposits = Array.isArray(state.deposits) ? state.deposits : [];
    const records = [
      ...tickets.flatMap(record => ticketCore.expandTicketRecord({ ...record, recordType: 'ticket' })).map(record => ({
        id: String(record.id || randomUUID()),
        recordType: 'ticket',
        customerId: String(record.customerId || record.customer || record.phone || ''),
        productCode: ticketCore.normalizeProduct(record.product || record.stockCode || record.code || ''),
        direction: ticketCore.normalizeDirection(record.direction),
        registeredAt: ticketCore.effectiveTicketDate(record) || '',
        nextFollowupAt: String(record.nextFollowupDate || record.nextFollowupAt || '').trim(),
        channel: String(record.channel || '').trim(),
        status: String(record.status || '').trim(),
        note: String(record.note || '').trim(),
        businessKey: ticketCore.ticketRecordKey(record),
      })),
      ...deposits.map(record => ({
        id: String(record.id || randomUUID()),
        recordType: 'deposit',
        customerId: String(record.customerId || record.customer || record.phone || ''),
        productCode: '',
        direction: String(record.direction || '').trim(),
        registeredAt: ticketCore.normalizeDate(record.date || record.registeredDate || record.createdAt || ''),
        nextFollowupAt: ticketCore.normalizeDate(record.nextFollowupDate || record.nextFollowupAt || ''),
        channel: String(record.channel || '').trim(),
        status: String(record.status || '').trim(),
        note: String(record.note || '').trim(),
        businessKey: `deposit|${String(record.customerId || record.phone || '').trim().toLocaleLowerCase()}|${String(record.date || record.registeredDate || '').trim()}|${String(record.amount || '').trim()}`,
      })),
    ];
    const wsAccounts = tableExists(db, 'ws_accounts') ? db.prepare('SELECT id, display_name, status FROM ws_accounts ORDER BY id').all().map(row => ({ id: row.id, displayName: row.display_name, status: row.status })) : [];
    const snapshot = { stateRevision: Number(stateRow?.revision || 0), customers, records, wsAccounts };
    return { snapshot, sourceHash: hash(snapshot), integrity };
  } finally {
    db.close();
  }
}

async function applyToPostgres(snapshot, connectionString, repoRoot) {
  if (!connectionString) throw new Error('apply 模式需要 --connection PostgreSQL连接字符串');
  let pg;
  try { pg = await import('pg'); } catch { throw new Error('apply 模式需要安装 pg 依赖；dry-run 不需要网络依赖'); }
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    await client.query('BEGIN');
    for (const file of ['001-foundation.sql', '002-customers-and-identities.sql', '003-business-records.sql', '004-messages-and-ws.sql', '005-ai-followups-outbox.sql']) {
      await client.query(readFileSync(path.join(repoRoot, 'server', 'migrations', file), 'utf8'));
    }
    for (const customer of snapshot.customers) {
      await client.query(`INSERT INTO customers(id,name,phone,created_at,updated_at) VALUES($1,$2,$3,now(),now()) ON CONFLICT(id) DO UPDATE SET name=EXCLUDED.name, phone=EXCLUDED.phone, updated_at=now()`, [String(customer.id), String(customer.name || ''), String(customer.phone || '')]);
    }
    for (const record of snapshot.records) {
      await client.query(`INSERT INTO business_records(id,customer_id,record_type,product_code,direction,registered_at,next_followup_at,channel,status,note,business_key,created_at,updated_at) VALUES($1,$2,$3,$4,$5,NULLIF($6,''),NULLIF($7,''),$8,$9,$10,$11,now(),now()) ON CONFLICT(business_key) DO NOTHING`, [record.id, record.customerId, record.recordType, record.productCode, record.direction, record.registeredAt, record.nextFollowupAt, record.channel, record.status, record.note, record.businessKey]);
    }
    for (const account of snapshot.wsAccounts) {
      await client.query(`INSERT INTO ws_accounts(id,display_name,status,created_at,updated_at) VALUES($1,$2,$3,now(),now()) ON CONFLICT(id) DO UPDATE SET display_name=EXCLUDED.display_name,status=EXCLUDED.status,updated_at=now()`, [account.id, account.displayName, account.status]);
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    await client.end();
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const mode = String(args.mode || 'dry-run');
  const source = path.resolve(String(args.source || ''));
  const manifestPath = path.resolve(String(args.manifest || `${source}.migration.json`));
  if (!source) throw new Error('需要 --source <workspace.sqlite>');
  const { snapshot, sourceHash, integrity } = readLegacy(source);
  const report = {
    migrationId: randomUUID(),
    mode,
    source,
    createdAt: new Date().toISOString(),
    sourceHash,
    integrity,
    counts: { customers: snapshot.customers.length, businessRecords: snapshot.records.length, wsAccounts: snapshot.wsAccounts.length },
    rollbackAvailable: true,
    rollback: { strategy: '恢复升级前SQLite备份或回滚同一事务', sourceReadOnly: true },
  };
  if (mode === 'apply') {
    await applyToPostgres(snapshot, String(args.connection || ''), path.resolve(__dirname, '..', '..'));
    report.applied = true;
  } else if (mode === 'rollback') {
    report.rollbackPlanOnly = true;
  } else if (mode !== 'dry-run') {
    throw new Error(`不支持的迁移模式：${mode}`);
  }
  mkdirSync(path.dirname(manifestPath), { recursive: true });
  writeFileSync(manifestPath, JSON.stringify(report, null, 2), { encoding: 'utf8', flag: 'wx' });
  process.stdout.write(JSON.stringify(report) + '\n');
}

main().catch(error => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
