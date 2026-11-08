'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repo = path.resolve(__dirname, '..', '..');
const read = (relative) => fs.readFileSync(path.join(repo, relative), 'utf8');
const routes = read('server/src/Zhike.Api/Routes/WsRoutes.cs');
const repository = read('server/src/Zhike.Infrastructure/Repositories/WsRepository.cs');
assert.match(routes, /MaxRequestBytes\s*=\s*8L\s*\*\s*1024\s*\*\s*1024/);
assert.match(routes, /RequestSizeLimitAttribute\(MaxRequestBytes\)/);
assert.match(routes, /MaxAccountIdLength/);
assert.match(routes, /MaxConnectorIdLength/);
assert.match(routes, /MaxDisplayNameLength/);
assert.match(routes, /ContentLength is > MaxRequestBytes/);
const saveMethod = routes.match(/private static async Task<Results<Ok<object>, BadRequest<string>>> SaveCheckpointsAsync[\s\S]*?\n    }\n\n    private static async Task<Ok<IReadOnlyList<FollowupRow>>>/);
assert.ok(saveMethod, 'checkpoint route should be present');
const saveBody = saveMethod[0];
assert.match(saveBody, /var inputs = new List<WsCheckpointInput>\(normalized\.Count\)/, 'route should normalize all checkpoint inputs before persistence');
assert.match(saveBody, /SaveCheckpointsBatchAsync\(inputs, cancellationToken\)/, 'route should persist all accounts through one repository transaction');
assert.doesNotMatch(saveBody, /foreach \(var group in groups\)[\s\S]*?IngestBatchAsync\(group\.Key/, 'route must not commit each account group independently');
assert.match(repository, /public async Task SaveCheckpointsBatchAsync\([\s\S]*?BeginTransactionAsync\(cancellationToken\)/, 'repository should provide a transaction spanning every checkpoint account');
console.log('WS checkpoint route validates every group before one transactional write');
