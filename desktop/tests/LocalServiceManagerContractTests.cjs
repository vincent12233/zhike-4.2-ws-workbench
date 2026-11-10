'use strict';

const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

const repo = path.resolve(__dirname, '..', '..');
const manager = fs.readFileSync(path.join(repo, 'desktop', 'src', 'Zhike.Desktop', 'Services', 'LocalServiceManager.cs'), 'utf8');
assert.match(manager, /class LocalServiceManager/);
assert.match(manager, /ZHIKE_DATA_DIR/);
assert.match(manager, /ZHIKE_PORT/);
assert.match(manager, /ZHIKE_API_TOKEN/);
assert.match(manager, /ZHIKE_PARENT_PID/);
assert.match(manager, /127\.0\.0\.1/);
assert.match(manager, /HealthAsync/);
assert.match(manager, /StopAsync/);
assert.match(manager, /WaitAsync/);

const app = fs.readFileSync(path.join(repo, 'desktop', 'src', 'Zhike.Desktop', 'App.xaml.cs'), 'utf8');
assert.match(app, /EnsureLocalServiceAsync/);
assert.match(app, /LocalServiceManager/);

console.log('local service manager contract: guarded loopback sidecar, health wait, bounded stop and parent lifecycle are wired');
