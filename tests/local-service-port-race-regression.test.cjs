'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repo = path.resolve(__dirname, '..');
const server = fs.readFileSync(path.join(repo, 'resources', 'app', 'server.mjs'), 'utf8');
const manager = fs.readFileSync(path.join(repo, 'desktop', 'src', 'Zhike.Desktop', 'Services', 'LocalServiceManager.cs'), 'utf8');

// A sidecar must never auto-increment its port: the desktop bridge is bound to
// the port it assigned and would otherwise report a misleading timeout.
assert.doesNotMatch(server, /EADDRINUSE[\s\S]{0,160}startListening\(port\s*\+\s*1\)/,
  'server must not silently switch ports after EADDRINUSE');
assert.match(server, /Do not silently move to another port/);

// The owner retries the whole process/health handshake with a fresh port.
assert.match(manager, /const int maxAttempts = 3/);
assert.match(manager, /FindFreePort\(\)/g);
assert.match(manager, /WaitForHealthAsync\(_info, cancellationToken\)/);
assert.match(manager, /Task\.Delay\(TimeSpan\.FromMilliseconds\(150 \* attempt\)/);

console.log('local service port race regression: fixed-port sidecar and bounded owner retry are wired');
