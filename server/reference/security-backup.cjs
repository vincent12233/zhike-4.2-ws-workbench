'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const hash = (value) => crypto.createHash('sha256').update(String(value)).digest('hex');
const random = (size = 24) => crypto.randomBytes(size).toString('base64url');

class PairingStore {
  constructor({ ttlMs = 120_000 } = {}) {
    this.ttlMs = ttlMs;
    this.pending = new Map();
  }

  start(deviceId, now = Date.now()) {
    const code = random(12);
    const expiresAt = Number(now) + this.ttlMs;
    this.pending.set(hash(code), { deviceId: String(deviceId || ''), expiresAt });
    return { code, expiresAt };
  }

  complete(code, now = Date.now(), deviceSecret = '') {
    const key = hash(code);
    const record = this.pending.get(key);
    if (!record) return { ok: false, reason: 'not-found' };
    this.pending.delete(key);
    if (Number(now) > record.expiresAt) return { ok: false, reason: 'expired' };
    if (!deviceSecret) return { ok: false, reason: 'missing-device-proof' };
    return { ok: true, deviceId: record.deviceId, sessionSeed: random(24) };
  }
}

class SessionStore {
  constructor({ ttlMs = 86_400_000 } = {}) {
    this.ttlMs = ttlMs;
    this.sessions = new Map();
  }

  issue(ownerId, now = Date.now()) {
    const token = random(32);
    this.sessions.set(hash(token), { ownerId: String(ownerId || ''), expiresAt: Number(now) + this.ttlMs });
    return token;
  }

  verify(token, now = Date.now()) {
    const key = hash(token);
    const record = this.sessions.get(key);
    if (!record || Number(now) >= record.expiresAt) {
      this.sessions.delete(key);
      return { valid: false };
    }
    return { valid: true, ownerId: record.ownerId, expiresAt: record.expiresAt };
  }

  rotate(token, now = Date.now()) {
    const current = this.verify(token, now);
    if (!current.valid) return { ok: false, reason: 'invalid-session' };
    this.revoke(token);
    return { ok: true, token: this.issue(current.ownerId, now) };
  }

  revoke(token) { this.sessions.delete(hash(token)); }
}

function redactSecrets(value) {
  return String(value ?? '')
    .replace(/((?:password|passwd|token|cookie|api[-_]?key|secret|qr(?:code)?|authorization)\s*[=:]\s*)([^\s,;]+)/gi, '$1[REDACTED]')
    .replace(/\b(sk-[A-Za-z0-9_-]+)\b/g, '[REDACTED]')
    .replace(/\b[A-Za-z0-9+/]{32,}\b/g, '[REDACTED]');
}

function buildBackupPlan({ backupRoot, now = Date.now(), retention = 14, prefix = 'zhike-' } = {}) {
  const root = path.resolve(String(backupRoot || '.'));
  const files = fs.existsSync(root)
    ? fs.readdirSync(root, { withFileTypes: true }).filter((entry) => entry.isFile() && entry.name.startsWith(prefix)).map((entry) => path.join(root, entry.name))
    : [];
  const ordered = files.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  return {
    root,
    retentionPrefix: prefix,
    keep: ordered.slice(0, Math.max(1, Number(retention) || 1)),
    deleteCandidates: ordered.slice(Math.max(1, Number(retention) || 1)),
    output: path.join(root, `${prefix}${Number(now)}.dump`),
    preserveUnrelated: true,
  };
}

function buildRestorePlan(backupFile, isolatedTarget) {
  const source = path.resolve(String(backupFile || ''));
  const target = path.resolve(String(isolatedTarget || ''));
  if (!source || !target || source === target) throw new Error('backup source and isolated target are required');
  return { source, target, dryRun: true, deleteUnrelated: false, requiresConfirmation: true };
}

module.exports = { PairingStore, SessionStore, redactSecrets, buildBackupPlan, buildRestorePlan };
