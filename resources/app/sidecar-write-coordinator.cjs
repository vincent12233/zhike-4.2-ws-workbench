'use strict';

/*
 * Durable single-writer coordinator for the stage-1 isolation gate.
 *
 * The production sidecar imports this module only for the Stage 1.5 isolated
 * fencing gate. Normal production startup does not create these tables or
 * expose worker-write routes until a later approved cutover. Ownership is
 * persisted in SQLite, generations are monotonic, facts and checkpoints
 * commit in one transaction, and stale owners cannot write after takeover.
 */

const crypto = require('node:crypto');

class FencingError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'FencingError';
    this.code = code;
    Object.assign(this, details);
  }
}

function text(value) { return String(value == null ? '' : value).trim(); }
function timestamp(clock) {
  const value = typeof clock === 'function' ? Number(clock()) : Number.NaN;
  return Number.isFinite(value) ? value : Date.now();
}

class SqliteFencedWriter {
  constructor(db, options = {}) {
    if (!db || typeof db.exec !== 'function' || typeof db.prepare !== 'function') throw new TypeError('DatabaseSync connection is required');
    this.db = db;
    this.clock = typeof options.clock === 'function' ? options.clock : () => Date.now();
    this.tables = Object.freeze({
      leases: options.leasesTable || 'zhike_writer_leases',
      facts: options.factsTable || 'zhike_writer_facts',
      checkpoints: options.checkpointsTable || 'zhike_writer_checkpoints',
    });
  }

  ensureSchema() {
    const { leases, facts, checkpoints } = this.tables;
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS ${leases} (
        scope_key TEXT PRIMARY KEY,
        lease_id TEXT NOT NULL,
        owner_id TEXT NOT NULL,
        fencing_token INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS ${facts} (
        id TEXT PRIMARY KEY,
        scope_key TEXT NOT NULL,
        idempotency_key TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        fencing_token INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        UNIQUE(scope_key,idempotency_key)
      );
      CREATE INDEX IF NOT EXISTS idx_${facts}_scope ON ${facts}(scope_key,created_at,id);
      CREATE TABLE IF NOT EXISTS ${checkpoints} (
        scope_key TEXT PRIMARY KEY,
        cursor TEXT NOT NULL,
        fencing_token INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `);
  }

  acquire(scopeKey, ownerId, leaseMs = 30_000) {
    const scope = text(scopeKey), owner = text(ownerId), duration = Math.max(1000, Math.floor(Number(leaseMs) || 30_000));
    if (!scope || !owner) throw new FencingError('INVALID_OWNER', 'scopeKey and ownerId are required');
    const now = timestamp(this.clock), expires = now + duration, leaseId = crypto.randomUUID();
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const row = this.db.prepare(`SELECT * FROM ${this.tables.leases} WHERE scope_key=?`).get(scope);
      if (row && Number(row.active) === 1 && Number(row.expires_at) > now && String(row.owner_id) !== owner) {
        throw new FencingError('LEASE_HELD', 'another writer still owns the lease', { scopeKey: scope, ownerId: row.owner_id, fencingToken: Number(row.fencing_token) });
      }
      const token = Number(row?.fencing_token || 0) + 1;
      this.db.prepare(`INSERT INTO ${this.tables.leases}(scope_key,lease_id,owner_id,fencing_token,expires_at,active,updated_at)
        VALUES(?,?,?,?,?,1,?) ON CONFLICT(scope_key) DO UPDATE SET lease_id=excluded.lease_id,owner_id=excluded.owner_id,
        fencing_token=excluded.fencing_token,expires_at=excluded.expires_at,active=1,updated_at=excluded.updated_at`)
        .run(scope, leaseId, owner, token, expires, now);
      this.db.exec('COMMIT');
      return { scopeKey: scope, leaseId, ownerId: owner, fencingToken: token, expiresAt: expires };
    } catch (error) { try { this.db.exec('ROLLBACK'); } catch {} throw error; }
  }

  renew(lease, leaseMs = 30_000) {
    const now = timestamp(this.clock), expires = now + Math.max(1000, Math.floor(Number(leaseMs) || 30_000));
    const updated = this.db.prepare(`UPDATE ${this.tables.leases} SET expires_at=?,updated_at=? WHERE scope_key=? AND lease_id=? AND owner_id=? AND fencing_token=? AND active=1`)
      .run(expires, now, text(lease?.scopeKey), text(lease?.leaseId), text(lease?.ownerId), Number(lease?.fencingToken));
    if (Number(updated?.changes || 0) !== 1) throw new FencingError('STALE_FENCE', 'lease is no longer current', { scopeKey: text(lease?.scopeKey) });
    return { ...lease, expiresAt: expires };
  }

  release(lease) {
    const updated = this.db.prepare(`UPDATE ${this.tables.leases} SET active=0,expires_at=0,updated_at=? WHERE scope_key=? AND lease_id=? AND owner_id=? AND fencing_token=? AND active=1`)
      .run(timestamp(this.clock), text(lease?.scopeKey), text(lease?.leaseId), text(lease?.ownerId), Number(lease?.fencingToken));
    return Number(updated?.changes || 0) === 1;
  }

  /**
   * Validate ownership while the caller already holds BEGIN IMMEDIATE. This
   * is also used by the real sidecar route so the fencing predicate is in the
   * same SQLite transaction as its business write.
   */
  assertActiveInTransaction(lease) {
    const scope = text(lease?.scopeKey);
    const valid = this.db.prepare(`SELECT 1 FROM ${this.tables.leases}
      WHERE scope_key=? AND lease_id=? AND owner_id=? AND fencing_token=?
        AND active=1 AND expires_at>?`)
      .get(scope, text(lease?.leaseId), text(lease?.ownerId), Number(lease?.fencingToken), timestamp(this.clock));
    if (!valid) throw new FencingError('STALE_FENCE', 'stale or expired writer lease rejected', { scopeKey: scope, fencingToken: Number(lease?.fencingToken) });
    return true;
  }

  recordCheckpointInTransaction(lease, input = {}) {
    this.assertActiveInTransaction(lease);
    const scope = text(lease?.scopeKey), cursor = text(input.cursor);
    if (!scope || !cursor) throw new FencingError('INVALID_CHECKPOINT', 'scopeKey and cursor are required');
    const now = timestamp(this.clock);
    this.db.prepare(`INSERT INTO ${this.tables.checkpoints}(scope_key,cursor,fencing_token,updated_at)
      VALUES(?,?,?,?) ON CONFLICT(scope_key) DO UPDATE SET
        cursor=excluded.cursor,fencing_token=excluded.fencing_token,updated_at=excluded.updated_at
      WHERE excluded.fencing_token>=${this.tables.checkpoints}.fencing_token`)
      .run(scope, cursor, Number(lease.fencingToken), now);
    return { scopeKey: scope, cursor, fencingToken: Number(lease.fencingToken) };
  }

  recordFactInTransaction(lease, input = {}) {
    this.assertActiveInTransaction(lease);
    const scope = text(lease?.scopeKey), idempotencyKey = text(input.idempotencyKey);
    if (!scope || !idempotencyKey) throw new FencingError('INVALID_EVENT', 'scopeKey and idempotencyKey are required');
    const now = timestamp(this.clock), payload = typeof input.payload === 'string' ? input.payload : JSON.stringify(input.payload ?? {});
    const factId = text(input.id) || `fact-${crypto.randomUUID()}`;
    const inserted = this.db.prepare(`INSERT INTO ${this.tables.facts}(id,scope_key,idempotency_key,payload_json,fencing_token,created_at)
      VALUES(?,?,?,?,?,?) ON CONFLICT(scope_key,idempotency_key) DO NOTHING`)
      .run(factId, scope, idempotencyKey, payload, Number(lease.fencingToken), now);
    return { accepted: Number(inserted?.changes || 0) === 1, deduplicated: Number(inserted?.changes || 0) === 0, factId, fencingToken: Number(lease.fencingToken) };
  }

  /**
   * Execute an actual sidecar business write under the durable fence. The
   * callback receives the same DatabaseSync connection and runs before the
   * final fence check, so a lease that expires during the callback rolls back
   * both the business mutation and checkpoint.
   */
  runProtectedWrite(lease, input = {}, callback) {
    if (typeof callback !== 'function') throw new TypeError('callback is required');
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.assertActiveInTransaction(lease);
      const result = callback(this.db, timestamp(this.clock));
      this.assertActiveInTransaction(lease);
      const fact = this.recordFactInTransaction(lease, input);
      const checkpoint = this.recordCheckpointInTransaction(lease, input);
      this.assertActiveInTransaction(lease);
      this.db.exec('COMMIT');
      return { ...result, fact, checkpoint, fencingToken: Number(lease.fencingToken) };
    } catch (error) {
      try { this.db.exec('ROLLBACK'); } catch {}
      throw error;
    }
  }

  writeFactAndCheckpoint(lease, input = {}) {
    const scope = text(lease?.scopeKey), idempotencyKey = text(input.idempotencyKey), cursor = text(input.cursor);
    if (!scope || !idempotencyKey || !cursor) throw new FencingError('INVALID_WRITE', 'scopeKey, idempotencyKey and cursor are required');
    const now = timestamp(this.clock), payload = typeof input.payload === 'string' ? input.payload : JSON.stringify(input.payload ?? {});
    const factId = text(input.id) || `fact-${crypto.randomUUID()}`;
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const valid = this.db.prepare(`SELECT 1 FROM ${this.tables.leases} WHERE scope_key=? AND lease_id=? AND owner_id=? AND fencing_token=? AND active=1 AND expires_at>?`)
        .get(scope, text(lease?.leaseId), text(lease?.ownerId), Number(lease?.fencingToken), now);
      if (!valid) throw new FencingError('STALE_FENCE', 'stale or expired writer lease rejected', { scopeKey: scope, fencingToken: Number(lease?.fencingToken) });
      const inserted = this.db.prepare(`INSERT INTO ${this.tables.facts}(id,scope_key,idempotency_key,payload_json,fencing_token,created_at)
        VALUES(?,?,?,?,?,?) ON CONFLICT(scope_key,idempotency_key) DO NOTHING`)
        .run(factId, scope, idempotencyKey, payload, Number(lease.fencingToken), now);
      this.db.prepare(`INSERT INTO ${this.tables.checkpoints}(scope_key,cursor,fencing_token,updated_at) VALUES(?,?,?,?)
        ON CONFLICT(scope_key) DO UPDATE SET cursor=excluded.cursor,fencing_token=excluded.fencing_token,updated_at=excluded.updated_at
        WHERE excluded.fencing_token>=${this.tables.checkpoints}.fencing_token`)
        .run(scope, cursor, Number(lease.fencingToken), now);
      this.db.exec('COMMIT');
      return { accepted: Number(inserted?.changes || 0) === 1, deduplicated: Number(inserted?.changes || 0) === 0, factId, cursor, fencingToken: Number(lease.fencingToken) };
    } catch (error) { try { this.db.exec('ROLLBACK'); } catch {} throw error; }
  }

  inspect(scopeKey) {
    const scope = text(scopeKey);
    return {
      lease: this.db.prepare(`SELECT * FROM ${this.tables.leases} WHERE scope_key=?`).get(scope) || null,
      checkpoint: this.db.prepare(`SELECT * FROM ${this.tables.checkpoints} WHERE scope_key=?`).get(scope) || null,
      facts: this.db.prepare(`SELECT * FROM ${this.tables.facts} WHERE scope_key=? ORDER BY created_at,id`).all(scope),
    };
  }
}

module.exports = { FencingError, SqliteFencedWriter };

