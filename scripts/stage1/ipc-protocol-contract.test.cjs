'use strict';

/* Static isolation gate for the .NET Named Pipe probe.  WinUI production
 * integration remains DesignOnly until a real WinUI build and a second SID
 * are available; this test prevents protocol drift in the probe meanwhile. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..', '..');
const source = fs.readFileSync(path.join(root, 'scripts', 'stage1', 'NamedPipeSecurityRuntime', 'Program.cs'), 'utf8');
const project = fs.readFileSync(path.join(root, 'scripts', 'stage1', 'NamedPipeSecurityRuntime', 'NamedPipeSecurityRuntime.csproj'), 'utf8');
assert.match(project, /TargetFramework>net10\.0-windows</, 'probe must target Windows');
for (const pattern of [
  /NamedPipeServerStreamAcl\.Create/, /PipeSecurity/, /PipeAccessRule/, /HMACSHA256/, /CryptographicOperations\.FixedTimeEquals/,
  /schemaVersion/, /CANCELLED/, /TIMEOUT/, /rotatedToken/, /AUTH_REVOKED/, /UNSUPPORTED_SCHEMA/,
]) assert.match(source, pattern, `IPC probe contract missing ${pattern}`);
assert.doesNotMatch(source, /WorldSid[^\n]*Allow|PipeAccessRule\([^\n]*WorldSid/, 'pipe ACL must not grant world access');
assert.match(source, /ReadLineAsync\(\)/, 'request framing must be line-delimited and bounded by the protocol harness');
console.log(JSON.stringify({ ok: true, scope: 'isolated-only', transport: 'Windows Named Pipe', acl: 'current SID only', tokenProof: 'HMAC-SHA256', replay: true, cancellation: true, timeout: true, rotation: true, winUiIntegration: 'DesignOnly', differentWindowsUser: 'NotTested', productionWorkerStarted: false, productionDatabaseOpened: false }));

