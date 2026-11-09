'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repo = path.resolve(__dirname, '..', '..');
const required = [
  'server/src/Zhike.Contracts/Zhike.Contracts.csproj',
  'server/src/Zhike.Domain/Zhike.Domain.csproj',
  'server/src/Zhike.Infrastructure/Zhike.Infrastructure.csproj',
  'server/src/Zhike.Api/Zhike.Api.csproj',
  'server/src/Zhike.Worker/Zhike.Worker.csproj',
  'desktop/Zhike.Desktop.sln',
  'desktop/src/Zhike.Desktop/Zhike.Desktop.csproj',
  'infra/.env.example',
  'infra/compose.yaml',
];

for (const relative of required) assert.equal(fs.existsSync(path.join(repo, relative)), true, `missing ${relative}`);

const compose = fs.readFileSync(path.join(repo, 'infra/compose.yaml'), 'utf8');
const envExample = fs.readFileSync(path.join(repo, 'infra/.env.example'), 'utf8');
for (const service of ['postgres', 'api', 'ai-worker', 'ws-connector', 'backup']) {
  assert.match(compose, new RegExp(`^\\s{2}${service}:`, 'm'), `Compose must define ${service}`);
}
assert.doesNotMatch(compose, /ports:\s*\n\s*-\s*["']?5432:/, 'PostgreSQL must not be published directly');
assert.match(envExample, /^ZHike_APP_VERSION=5\.3\.0$/m, 'Docker env example must match the current desktop release');

const healthPath = path.join(repo, 'server/src/Zhike.Contracts/HealthContracts.cs');
assert.equal(fs.existsSync(healthPath), true, 'health response contract is required');
const health = fs.readFileSync(healthPath, 'utf8');
for (const field of ['AppVersion', 'SchemaVersion', 'DatabaseStatus', 'WorkerStatus']) assert.match(health, new RegExp(field));
assert.match(fs.readFileSync(path.join(repo, 'server/src/Zhike.Domain/DomainAssemblyMarker.cs'), 'utf8'), /class DomainAssemblyMarker\s*\{\s*\}/);
assert.match(fs.readFileSync(path.join(repo, 'server/src/Zhike.Infrastructure/InfrastructureAssemblyMarker.cs'), 'utf8'), /class InfrastructureAssemblyMarker\s*\{\s*\}/);
assert.match(fs.readFileSync(path.join(repo, 'server/src/Zhike.Api/Program.cs'), 'utf8'), /partial class Program\s*\{\s*\}/);
assert.match(fs.readFileSync(path.join(repo, 'server/src/Zhike.Api/Program.cs'), 'utf8'), /GetStatusAsync\("ai-worker"/);
assert.match(fs.readFileSync(path.join(repo, 'server/src/Zhike.Worker/Program.cs'), 'utf8'), /WorkerHeartbeatService/);

console.log('server-v2 bootstrap contract: desktop-only UI and Docker service skeleton present');
