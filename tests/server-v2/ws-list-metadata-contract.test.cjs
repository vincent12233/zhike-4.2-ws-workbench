'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repo = path.resolve(__dirname, '..', '..');
const read = (relative) => fs.readFileSync(path.join(repo, relative), 'utf8');
const migrationPath = 'server/migrations/012-ws-list-capture-metadata.sql';
assert.equal(fs.existsSync(path.join(repo, migrationPath)), true, 'list-capture metadata migration is required');
const migration = read(migrationPath);
for (const column of ['unread_count', 'last_message_preview', 'visible_only', 'list_captured_at']) {
  assert.match(migration, new RegExp(`ADD COLUMN IF NOT EXISTS\\s+${column}`), `migration adds ${column}`);
}
assert.match(migration, /VALUES\s*\(12\s*,/i, 'migration records version 12');
assert.doesNotMatch(migration, /DROP TABLE|TRUNCATE|DROP DATABASE/i, 'list metadata migration is non-destructive');

const repository = read('server/src/Zhike.Infrastructure/Repositories/WsRepository.cs');
assert.match(repository, /unread_count/i, 'repository persists unread count');
assert.match(repository, /last_message_preview/i, 'repository persists list preview');
assert.match(repository, /visible_only/i, 'repository persists visibility scope');
assert.match(repository, /list_captured_at/i, 'repository persists list capture time');
assert.match(repository, /preview_only/i, 'list preview enters the message/AI pipeline');
assert.match(repository, /LastMessagePreview/i, 'list preview is handled as a stable input');

const routes = read('server/src/Zhike.Api/Routes/WsRoutes.cs');
assert.match(routes, /!conversation\.VisibleOnly|VisibleOnly\s*==\s*false/, 'API rejects non-visible capture scope');

console.log('WS list metadata contract: migration, metadata persistence, preview AI path and visibility guard pass');
