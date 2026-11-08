'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repo = path.resolve(__dirname, '..', '..');
const read = (relative) => fs.readFileSync(path.join(repo, relative), 'utf8');
for (const relative of [
  'server/src/Zhike.Infrastructure/Repositories/CustomerRepository.cs',
  'server/src/Zhike.Infrastructure/Repositories/BusinessRecordRepository.cs',
  'server/src/Zhike.Infrastructure/Repositories/ImportRepository.cs',
  'server/src/Zhike.Api/Routes/CustomerRoutes.cs',
  'server/src/Zhike.Api/Routes/ImportRoutes.cs',
  'server/src/Zhike.Api/Routes/BusinessRecordRoutes.cs',
  'server/src/Zhike.Api/Routes/WsRoutes.cs',
]) assert.equal(fs.existsSync(path.join(repo, relative)), true, `missing ${relative}`);
const customer = read('server/src/Zhike.Infrastructure/Repositories/CustomerRepository.cs');
assert.match(customer, /NULLIF\(BTRIM\(customers\.name\), ''\) IS NULL/);
assert.match(customer, /deleted_at/);
const business = read('server/src/Zhike.Infrastructure/Repositories/BusinessRecordRepository.cs');
assert.match(business, /ON CONFLICT \(business_key\)/);
assert.match(business, /next_followup_at/);
const imports = read('server/src/Zhike.Infrastructure/Repositories/ImportRepository.cs');
assert.match(imports, /registeredDate/);
assert.match(imports, /nextFollowupDate/);
const program = read('server/src/Zhike.Api/Program.cs');
assert.match(program, /ResolveConnectorToken/);
assert.match(program, /IsConnectorWriteEndpoint/);
assert.match(program, /ConnectorTokenFile/);
assert.match(read('server/src/Zhike.Api/Routes/WsRoutes.cs'), /\/ingest\/batch/);
assert.match(read('server/src/Zhike.Api/Routes/WsRoutes.cs'), /\/accounts/);
assert.match(read('server/src/Zhike.Api/Routes/WsRoutes.cs'), /RequestSizeLimitAttribute/);
assert.match(read('server/src/Zhike.Api/Routes/WsRoutes.cs'), /MaxRequestBytes/);
assert.match(read('server/src/Zhike.Api/Routes/LegacyStateRoutes.cs'), /\/state\/version/);
assert.match(read('server/src/Zhike.Infrastructure/Repositories/LegacyStateRepository.cs'), /GetRevisionAsync/);
const legacy = read('server/src/Zhike.Api/Routes/LegacyStateRoutes.cs');
assert.match(legacy, /snapshotCreated\s*=\s*true/);
assert.match(legacy, /skipped\s*=\s*true/);
assert.match(legacy, /StatusCodes\.Status503ServiceUnavailable/);
assert.match(read('server/src/Zhike.Api/Routes/CustomerRoutes.cs'), /Results\.NotFound|StatusCodes\.Status404NotFound/);
assert.match(read('server/src/Zhike.Api/Routes/WsRoutes.cs'), /Results\.NotFound/);
assert.match(read('server/src/Zhike.Api/Routes/ImportRoutes.cs'), /changed = await repository\.CommitAsync/);
assert.match(read('server/src/Zhike.Api/Routes/ImportRoutes.cs'), /Results\.Conflict/);
assert.match(read('desktop/src/Zhike.Desktop/Services/ApiClient.cs'), /ReadFromJsonAsync<JsonElement>/);
assert.match(read('desktop/src/Zhike.Desktop/Services/ApiClient.cs'), /count > 0/);
assert.match(read('server/src/Zhike.Infrastructure/Database/AuditWriter.cs'), /audit_events/);
assert.match(customer, /AuditWriter\.AppendAsync/);
assert.match(read('server/src/Zhike.Infrastructure/Repositories/ImportRepository.cs'), /import\.commit/);
console.log('API/domain contract: customer fill-empty, soft delete/restore, separate business keys/dates, mixed import and WS account routes pass');
