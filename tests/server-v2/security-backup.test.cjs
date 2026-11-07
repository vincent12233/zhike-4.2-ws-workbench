'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  PairingStore,
  SessionStore,
  redactSecrets,
  buildBackupPlan,
  buildRestorePlan,
} = require('../../server/reference/security-backup.cjs');

const pairing = new PairingStore({ ttlMs: 1000 });
const started = pairing.start('desktop-1', 1_000);
assert.equal(pairing.complete(started.code, started.expiresAt - 1, 'device-secret').ok, true);
assert.equal(pairing.complete(started.code, started.expiresAt - 1, 'replay').ok, false, 'pairing code must be one-time');
const expired = pairing.start('desktop-2', 2_000);
assert.equal(pairing.complete(expired.code, expired.expiresAt + 1, 'late').reason, 'expired');

const sessions = new SessionStore();
const token = sessions.issue('desktop-1', 3_000);
assert.equal(sessions.verify(token, 3_001).valid, true);
const rotated = sessions.rotate(token, 3_002);
assert.equal(rotated.ok, true);
assert.equal(sessions.verify(token, 3_003).valid, false);
assert.equal(sessions.verify(rotated.token, 3_003).valid, true);
sessions.revoke(rotated.token);
assert.equal(sessions.verify(rotated.token, 3_004).valid, false);

const log = redactSecrets('password=abc token=xyz cookie=secret apiKey=sk-live-123 qr=payload');
assert.doesNotMatch(log, /abc|xyz|secret|sk-live|payload/);
assert.match(log, /REDACTED/);

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zhike-backup-'));
const backupRoot = path.join(root, 'backups');
const unrelated = path.join(backupRoot, 'keep-me.txt');
fs.mkdirSync(backupRoot, { recursive: true });
fs.writeFileSync(unrelated, 'keep');
const plan = buildBackupPlan({ backupRoot, now: 10_000, retention: 2, prefix: 'zhike-' });
assert.equal(plan.retentionPrefix, 'zhike-');
assert.deepEqual(plan.deleteCandidates, []);
const restore = buildRestorePlan(path.join(backupRoot, 'zhike-10000.dump'), path.join(root, 'isolated-db'));
assert.equal(restore.dryRun, true);
assert.equal(restore.deleteUnrelated, false);
assert.equal(fs.readFileSync(unrelated, 'utf8'), 'keep');
fs.rmSync(root, { recursive: true, force: true });

const repo = path.resolve(__dirname, '..', '..');
for (const relative of [
  'server/src/Zhike.Api/Auth/PairingService.cs',
  'server/src/Zhike.Api/Auth/PairingAccessGuard.cs',
  'server/src/Zhike.Api/Auth/SessionService.cs',
  'server/src/Zhike.Infrastructure/Secrets/SecretRedactor.cs',
  'server/src/Zhike.Worker/BackupWorker.cs',
  'infra/backup/backup.ps1',
  'infra/compose.prod.yaml',
]) assert.equal(fs.existsSync(path.join(repo, relative)), true, `missing ${relative}`);

const pairingGuard = fs.readFileSync(path.join(repo, 'server/src/Zhike.Api/Auth/PairingAccessGuard.cs'), 'utf8');
assert.match(pairingGuard, /IPAddress\.IsLoopback/);
assert.match(pairingGuard, /AllowRemotePairing/);
assert.match(pairingGuard, /X-Zhike-Pairing-Approval/);
assert.match(fs.readFileSync(path.join(repo, 'server/src/Zhike.Api/Routes/AuthRoutes.cs'), 'utf8'), /PairingAccessGuard/);

console.log('security/backup: pairing expiry, token rotation, redaction, retention and isolated restore plans pass');
