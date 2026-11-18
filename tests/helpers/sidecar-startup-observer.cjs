'use strict';

// Test-only observation. The caller owns spawn, credentials, HTTP routes and
// cleanup. No process, service, profile or database is created by this helper.
const { performance } = require('node:perf_hooks');
const READINESS_ATTEMPTS = 300;
const RETRY_DELAY_MS = 50;
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const safeCode = value => /^[A-Z0-9_]{1,64}$/.test(String(value || '')) ? String(value) : 'UNCLASSIFIED';

function redactStderr(value, secrets) {
  let text = String(value).replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '');
  for (const secret of secrets) {
    for (const form of new Set([secret, encodeURIComponent(secret), JSON.stringify(secret).slice(1, -1)])) text = text.replaceAll(form, '[REDACTED]');
  }
  return text
    .replace(/\bBearer\s+[^\s"'<>]+/gi, 'Bearer [REDACTED]')
    .replace(/(\b(?:api[_-]?key|api[_-]?token|auth[_-]?token|access[_-]?token|refresh[_-]?token|token|authorization|secret|password|passwd|pass)\b["']?\s*[:=]\s*)(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^\s,;&}]+)/gi, '$1[REDACTED]')
    .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, '[REDACTED]')
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '[REDACTED]');
}

function observeSidecarStartup(child, options = {}) {
  const started = performance.now();
  const limit = options.maxStderrBytes === undefined ? 8192 : Number(options.maxStderrBytes);
  if (!Number.isInteger(limit) || limit < 1 || limit > 65536) throw new RangeError('Test stderr limit must be 1–65536 bytes');
  const secrets = [...new Set((options.secrets || []).filter(value => typeof value === 'string' && value.length))].sort((a, b) => b.length - a.length);
  let stderr = Buffer.alloc(0), stderrBytes = 0, spawnErrorCode = null, exited = false, exitCode = null, signal = null, exitElapsedMs = null;
  child.stderr?.on('data', chunk => {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
    stderrBytes += bytes.length;
    const remaining = limit - stderr.length;
    if (remaining > 0) stderr = Buffer.concat([stderr, bytes.subarray(0, remaining)]);
  });
  child.on('error', error => { spawnErrorCode = safeCode(error.code); });
  child.on('exit', (code, exitSignal) => {
    exited = true; exitCode = code; signal = exitSignal; exitElapsedMs = Math.round(performance.now() - started);
  });
  function snapshot() {
    const truncated = stderrBytes > limit;
    return {
      elapsedMs: Math.round(performance.now() - started), spawnErrorCode,
      exited: exited || child.exitCode !== null || child.signalCode !== null,
      exitCode: exited ? exitCode : child.exitCode, signal: exited ? signal : child.signalCode, exitElapsedMs,
      stderrBytes, stderrRetainedBytes: stderr.length, stderrTruncated: truncated,
      // A truncated boundary could split a credential. Omit all such text
      // instead of attempting to sanitize an incomplete value.
      stderr: truncated ? '[stderr exceeded limit; text omitted for safety]' : redactStderr(stderr.toString('utf8'), secrets),
    };
  }
  function failure(code, details = {}) {
    const diagnostics = { ...snapshot(), ...details };
    const error = new Error(`Isolated sidecar request failed (${code}): ${JSON.stringify(diagnostics)}`);
    error.code = code; error.diagnostics = diagnostics; return error;
  }
  function throwIfExited() {
    if (spawnErrorCode) throw failure('SIDECAR_SPAWN_FAILED');
    if (exited || child.exitCode !== null || child.signalCode !== null) throw failure('SIDECAR_EARLY_EXIT');
  }
  return { snapshot, failure, throwIfExited };
}

async function requestWithStartupDiagnostics(operation, observation, options = {}) {
  const attempts = options.attempts ?? READINESS_ATTEMPTS;
  const retryDelayMs = options.retryDelayMs ?? RETRY_DELAY_MS;
  if (!Number.isInteger(attempts) || attempts < 1 || !Number.isFinite(retryDelayMs) || retryDelayMs < 0) throw new RangeError('Invalid test readiness budget');
  let lastRequestErrorCode = null;
  for (let index = 0; index < attempts; index++) {
    observation.throwIfExited();
    try { return await operation(); }
    catch (error) {
      observation.throwIfExited();
      lastRequestErrorCode = safeCode(error?.cause?.code || error?.code);
      await wait(retryDelayMs);
    }
  }
  observation.throwIfExited();
  throw observation.failure('SIDECAR_READINESS_TIMEOUT', { attempts, retryDelayMs, lastRequestErrorCode });
}

module.exports = { observeSidecarStartup, requestWithStartupDiagnostics, READINESS_ATTEMPTS, RETRY_DELAY_MS };
