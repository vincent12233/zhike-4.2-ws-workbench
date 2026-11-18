'use strict';

/**
 * Explicit feature gate around the already verified SQLite fenced writer.
 *
 * This module is deliberately a thin boundary: it does not create tables,
 * acquire leases, or open a database. The caller supplies the authoritative
 * SqliteFencedWriter instance and an explicit boolean flag. Production code
 * remains disabled until a separately approved Worker cutover passes the
 * feature flag as `true`; an absent, malformed, or truthy non-boolean value
 * is treated as disabled.
 */

class WorkerFencingGateError extends Error {
  constructor(message = 'Worker fencing is disabled.') {
    super(message);
    this.name = 'WorkerFencingGateError';
    this.code = 'WORKER_FENCING_DISABLED';
  }
}

function createWorkerFencingGate(options = {}) {
  const writer = options.writer;
  if (!writer || typeof writer.runProtectedWrite !== 'function') {
    throw new TypeError('A SqliteFencedWriter-compatible writer is required.');
  }
  const enabled = options.enabled === true;
  return Object.freeze({
    enabled,
    mode: enabled ? 'controlled-isolated' : 'disabled',
    runProtectedWrite(lease, input, callback) {
      if (!enabled) throw new WorkerFencingGateError();
      return writer.runProtectedWrite(lease, input, callback);
    },
  });
}

module.exports = { WorkerFencingGateError, createWorkerFencingGate };
