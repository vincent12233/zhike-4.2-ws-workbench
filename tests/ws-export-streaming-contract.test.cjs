'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'resources', 'app', 'server.mjs'), 'utf8');
const exportStart = source.indexOf("url.pathname === '/api/ws/export'");
const importStart = source.indexOf("url.pathname === '/api/ws/import'");
assert.ok(exportStart >= 0 && importStart > exportStart, 'WS export route must remain before import route');
const exportRoute = source.slice(exportStart, importStart);

assert.match(source, /async function streamJsonObject\(res, status, writeBody\)/,
  'server must expose a bounded JSON stream writer');
assert.match(source, /async function writeJsonArray\(write, statement, accountId, mapper\)/,
  'WS export arrays must be iterated with a bounded chunk writer');
assert.match(source, /for \(const row of statement\.iterate\(accountId, pageSize, offset\)\)/,
  'WS export must iterate paged SQLite rows instead of materialising every array');
assert.match(source, /const pageSize = 256/,
  'WS export page size must remain bounded');
assert.match(source, /waitForDrain/,
  'WS export must respect response backpressure');
assert.match(source, /res\.once\('close'/,
  'WS export must stop when the client disconnects');
assert.match(exportRoute, /return streamWsExport\(res, accountId\)/,
  'WS export route must use the streaming implementation');
assert.doesNotMatch(exportRoute, /\.all\(accountId\)\.map\(/,
  'WS export route must not materialise all account rows before writing');

console.log('WS export streaming contract: bounded SQLite iteration, disconnect handling and backpressure are present');
