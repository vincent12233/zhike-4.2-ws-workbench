'use strict';

// Test-only, opt-in phase output. Callers provide a narrow field allowlist;
// unknown fields are omitted and string values are restricted to diagnostic
// codes. This prevents a future caller from printing a path, token or payload.
const SAFE_EVENT = /^[a-z0-9][a-z0-9.-]{0,63}$/;
const SAFE_PREFIX = /^[A-Z0-9_]{1,64}$/;
const SAFE_CODE = /^[A-Z0-9_-]{1,40}$/;

function createTestDiagnostic(options = {}) {
  const enabled = typeof options.envName === 'string' && process.env[options.envName] === '1';
  const prefix = SAFE_PREFIX.test(String(options.prefix || '')) ? String(options.prefix) : 'ZHIKE_TEST_DIAGNOSTIC';
  const allowed = new Set(Array.isArray(options.allowedFields) ? options.allowedFields.map(String) : []);
  const write = typeof options.write === 'function' ? options.write : value => process.stderr.write(value);
  let sequence = 0;

  function emit(event, details = {}) {
    if (!enabled) return;
    const record = {
      sequence: ++sequence,
      event: SAFE_EVENT.test(String(event || '')) ? String(event) : 'invalid-event',
      processElapsedMs: Math.round(process.uptime() * 1000),
    };
    for (const [key, value] of Object.entries(details || {})) {
      if (!allowed.has(key)) continue;
      if (value === null || typeof value === 'boolean') record[key] = value;
      else if (typeof value === 'number' && Number.isFinite(value)) record[key] = value;
      else if (typeof value === 'string') record[key] = SAFE_CODE.test(value) ? value : 'REDACTED';
    }
    write('[' + prefix + '] ' + JSON.stringify(record) + '\n');
  }

  return Object.freeze({ enabled, emit });
}

module.exports = Object.freeze({ createTestDiagnostic });
