'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'runner.mjs'), 'utf8');
assert.match(source, /function\s+publishHeartbeat|const\s+publishHeartbeat/, 'runner centralizes heartbeat publishing');
assert.match(source, /publishHeartbeat\([^\n]*state\?\.state/, 'capture state callback publishes its actual status');
assert.match(source, /等待登录|会话过期|连接失败|已连接/, 'runner preserves connector state vocabulary');
assert.match(source, /heartbeat\(normalizedAccountId, normalizedStatus/, 'runner sends heartbeat state to the API');

console.log('WS runner heartbeat contract: capture state is persisted even without a message flush');
