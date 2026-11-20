'use strict';

// Offline fixture for the existing Stage 5.1 native WS04 acceptance workspace.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { randomUUID } = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

const groupJid = '12035101@g.us';
const fixtureMarker = 'ISOLATED_WS04_NATIVE_READING_FIXTURE';
const fixtureMember = '9000000051';
const accounts = [['default', 'A'], ['native-b', 'B']];

function requireCheck(condition, message) {
  if (!condition) throw new Error(message);
}

const samePath = (left, right) => process.platform === 'win32' ? left.toLowerCase() === right.toLowerCase() : left === right;

function validatePath(filename, type) {
  const item = fs.lstatSync(filename);
  requireCheck(!item.isSymbolicLink() && samePath(fs.realpathSync(filename), filename) &&
    (type === 'directory' ? item.isDirectory() : item.isFile() && item.nlink === 1), 'Unexpected fixture path or linked file.');
  return item;
}

function readFixtureFile(filename, limit) {
  requireCheck(validatePath(filename, 'file').size <= limit, 'Fixture metadata exceeds the expected size.');
  return fs.readFileSync(filename, 'utf8');
}

function proveClosed(root, pid) {
  const log = readFixtureFile(path.join(root, 'native-events.jsonl'), 2 * 1024 * 1024);
  let lastStartupPid = null;
  for (const line of log.split(/\r?\n/).filter(Boolean)) {
    const row = JSON.parse(line);
    if (row.kind === 'application-start') lastStartupPid = row.pid;
  }
  requireCheck(lastStartupPid === pid, 'Expected closed PID must match the most recent isolated application-start.');
  try { process.kill(pid, 0); }
  catch (error) {
    if (error.code === 'ESRCH') return;
    throw new Error('Unable to verify the isolated application has closed.');
  }
  throw new Error('The isolated application is still running or its PID was reused.');
}

function validateScope(root, pid) {
  const temp = fs.realpathSync(os.tmpdir());
  requireCheck(samePath(fs.realpathSync(path.dirname(root)), temp) &&
    /^zhike-stage51-native-[a-f0-9]{32}$/.test(path.basename(root)), 'An existing Stage 5.1 native temporary root is required.');
  validatePath(root, 'directory');
  requireCheck(readFixtureFile(path.join(root, '.stage51-isolated'), 256) === 'zhike-stage51-isolated-ui-v1',
    'Required isolated root marker is missing or invalid.');
  const fixture = JSON.parse(readFixtureFile(path.join(root, 'seed-evidence.json'), 1024 * 1024));
  requireCheck(fixture.synthetic === true && fixture.realWs === false && fixture.paidAi === false && Array.isArray(fixture.groups) &&
    accounts.every(([accountId]) => fixture.groups.some(group => group.accountId === accountId && group.groupJid === groupJid)),
  'Original Stage 5.1 synthetic group seed evidence is required.');
  proveClosed(root, pid);
}

function withWorkspaceLock(data, callback) {
  const lock = path.join(data, '.workbench.lock');
  requireCheck(!fs.existsSync(lock + '.recovery'), 'A sidecar startup or recovery is in progress.');
  let descriptor;
  try { descriptor = fs.openSync(lock, 'wx'); }
  catch (error) {
    if (error.code === 'EEXIST') throw new Error('Workspace lock exists. Close the isolated app and have its owner verify cleanup.');
    throw error;
  }
  const identity = fs.fstatSync(descriptor, { bigint: true });
  try {
    fs.writeFileSync(descriptor, JSON.stringify({
      pid: process.pid, host: os.hostname(), bootTime: Math.floor(Date.now() / 1000 - os.uptime()), kind: fixtureMarker, nonce: randomUUID(),
    }));
    return callback();
  } finally {
    fs.closeSync(descriptor);
    const current = fs.lstatSync(lock, { bigint: true });
    requireCheck(current.isFile() && current.dev === identity.dev && current.ino === identity.ino, 'Workspace lock changed while seeding.');
    fs.unlinkSync(lock);
  }
}

function seed(db, root, closedPid) {
  // Seed scripts always target the current manifest schema; the historical 025
  // label only described the schema level of the round that introduced them.
  const manifest = require(path.join(__dirname, '..', '..', 'resources', 'app', 'migrations', 'manifest.json'));
  requireCheck(db.prepare('PRAGMA user_version').get().user_version === Number(manifest.supportedSchemaVersion),
    `Expected migrated schema ${manifest.supportedSchemaVersion}.`);
  const accountRows = db.prepare('SELECT id FROM ws_accounts').all();
  requireCheck(accountRows.length === accounts.length && accounts.every(([id]) => accountRows.some(row => row.id === id)),
    'Workspace account set does not match the two known fixture accounts.');
  const group = db.prepare(`SELECT 1 FROM ws_group_catalog
    WHERE account_id=? AND group_jid=? AND channel_id='synthetic' AND discovery_source='stage3-mock'`);
  const member = db.prepare(`SELECT 1 FROM ws_group_members
    WHERE account_id=? AND group_jid=? AND member_jid=? AND source='stage3-mock'`);
  for (const [accountId] of accounts) {
    requireCheck(group.get(accountId, groupJid) && member.get(accountId, groupJid, fixtureMember),
      'The pre-existing synthetic group and member are required for both accounts.');
  }

  const insertMessage = db.prepare(`INSERT INTO ws_group_messages
    (id,account_id,group_jid,message_id,sent_at,message_type,source_evidence,data_json,created_at,updated_at)
    VALUES (?,?,?,?,?,'text',?,?,?,?) ON CONFLICT(account_id,group_jid,message_id) DO NOTHING`);
  const getMessage = db.prepare(`SELECT id,source_evidence,data_json FROM ws_group_messages
    WHERE account_id=? AND group_jid=? AND message_id=?`);
  const insertEvidence = db.prepare(`INSERT INTO ws_group_read_evidence
    (id,account_id,group_jid,message_id,member_jid,status,evidence_source,evidence_ref,observed_at,created_at,updated_at)
    VALUES (?,?,?,?,?,'unknown',?,'',?,?,?) ON CONFLICT(account_id,group_jid,message_id,member_jid) DO NOTHING`);
  const getEvidence = db.prepare(`SELECT id,member_jid,status,evidence_source,evidence_ref
    FROM ws_group_read_evidence WHERE account_id=? AND group_jid=? AND message_id=?`);
  const now = new Date().toISOString();
  const data = JSON.stringify({ synthetic: true, fixture: fixtureMarker });
  const output = [];
  db.exec('BEGIN IMMEDIATE');
  try {
    for (const [accountId, partition] of accounts) {
      const messageId = 'ISOLATED_WS04_NATIVE_READING_' + partition;
      const id = 'isolated-ws04-message-' + partition;
      insertMessage.run(id, accountId, groupJid, messageId, now, fixtureMarker, data, now, now);
      const existing = getMessage.get(accountId, groupJid, messageId);
      requireCheck(existing.id === id && existing.source_evidence === fixtureMarker && existing.data_json === data,
        'Reading fixture message collides with an existing nonmatching row.');
      const memberIds = [fixtureMember, ...Array.from({ length: 25 }, (_, index) =>
        'isolated-ws04-' + partition.toLowerCase() + '-' + String(index + 1).padStart(3, '0') + '@lid')];
      const expected = new Map(memberIds.map((memberId, index) => [memberId, 'isolated-ws04-evidence-' + partition + '-' + index]));
      for (const [memberId, evidenceId] of expected) {
        insertEvidence.run(evidenceId, accountId, groupJid, messageId, memberId, fixtureMarker, now, now, now);
      }
      const evidence = getEvidence.all(accountId, groupJid, messageId);
      requireCheck(evidence.length === expected.size && evidence.every(row => row.id === expected.get(row.member_jid) &&
        row.status === 'unknown' && row.evidence_source === fixtureMarker && row.evidence_ref === ''),
      'Reading fixture evidence collides with existing rows.');
      output.push({ accountId, groupJid, messageId, unknown: evidence.length });
    }
    proveClosed(root, closedPid);
    db.exec('COMMIT');
    return output;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

function main() {
  const [rootInput, closedPidInput, ...rest] = process.argv.slice(2);
  const closedPid = Number(closedPidInput);
  requireCheck(rest.length === 0 && rootInput && path.isAbsolute(rootInput) &&
    /^\d+$/.test(closedPidInput) && Number.isSafeInteger(closedPid) && closedPid > 0 && closedPid <= 0x7fffffff,
  'Usage: node scripts/stage51/seed-native-reading-observation.cjs <absolute-stage51-temp-root> <closed-app-pid>');
  const root = path.resolve(rootInput);
  validateScope(root, closedPid);
  const data = path.join(root, 'data');
  validatePath(data, 'directory');
  const rows = withWorkspaceLock(data, () => {
    const database = path.join(data, 'workspace.sqlite');
    validatePath(database, 'file');
    for (const suffix of ['-wal', '-shm', '-journal']) {
      try { validatePath(database + suffix, 'file'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    proveClosed(root, closedPid);
    const db = new DatabaseSync(database);
    try { return seed(db, root, closedPid); }
    finally { db.close(); }
  });
  console.log(JSON.stringify({ synthetic: true, observation: 'unknown', messages: rows }));
}

try { main(); }
catch (error) {
  // SQLite errors can include external details. Keep CLI output limited to a
  // safe classification when the failure is outside our own guard messages.
  console.error(error.code ? 'Fixture seed refused (' + error.code + ').' : error.message);
  process.exitCode = 1;
}
