'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repo = path.resolve(__dirname, '..', '..');
const migrations = fs.readdirSync(path.join(repo, 'server', 'migrations'));
assert.ok(migrations.includes('010-legacy-workspace-state.sql'), 'legacy state migration must exist');
const routes = fs.readFileSync(path.join(repo, 'server', 'src', 'Zhike.Api', 'Routes', 'LegacyStateRoutes.cs'), 'utf8');
const repository = fs.readFileSync(path.join(repo, 'server', 'src', 'Zhike.Infrastructure', 'Repositories', 'LegacyStateRepository.cs'), 'utf8');
assert.match(routes, /MapGroup\("\/api\/v2\/legacy"\)/);
assert.match(routes, /MapGet\("\/state"/);
assert.match(routes, /MapPost\("\/snapshot"/);
assert.match(repository, /X-State-Version|revision/);
assert.match(repository, /JSONB|Jsonb/i);

console.log('legacy state compatibility contract: Postgres-backed state and snapshots are present');
