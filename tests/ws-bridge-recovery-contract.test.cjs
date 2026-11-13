'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repo = path.resolve(__dirname, '..');
const native = fs.readFileSync(path.join(repo, 'desktop/src/Zhike.Desktop/Views/LegacyUiHostPage.xaml.cs'), 'utf8');
const web = fs.readFileSync(path.join(repo, 'resources/app/modules/ws-workbench.js'), 'utf8');

assert.match(native, /private ApiClient\? _bridgeApi;/,
  'legacy host must track which local service client the cached bridge uses');
assert.match(native, /!ReferenceEquals\(_bridgeApi, _api\)/,
  'bridge must be rebound after a local sidecar restart');
assert.match(native, /SERVICE_UNAVAILABLE[\s\S]*RecoverLocalServiceAsync/,
  'legacy API requests must attempt one guarded sidecar recovery');
assert.match(native, /ContainsKey\("x-idempotency-key"\)/,
  'sidecar recovery retries must be limited to reads or idempotent writes');
assert.match(native, /var retrySafe = requestMethod\.Equals\("GET"/,
  'sidecar recovery retries must explicitly classify safe methods');
assert.match(web, /body\.error \|\| body\.message \|\| body\.errorCode/,
  'WS API errors must preserve the native bridge diagnostic');

console.log('ws bridge recovery contract: stale sidecar clients rebind and actionable errors survive');
