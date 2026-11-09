'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repo = path.resolve(__dirname, '..', '..');
const composePath = path.join(repo, 'infra', 'compose.yaml');
const prodPath = path.join(repo, 'infra', 'compose.prod.yaml');
const compose = fs.readFileSync(composePath, 'utf8');
const prod = fs.readFileSync(prodPath, 'utf8');

function servicesSection(source) {
  const match = source.match(/^services:\r?\n([\s\S]*?)(?=^volumes:\r?$|^networks:\r?$)/m);
  assert.ok(match, 'Compose services section is required');
  return match[1];
}

function serviceBlock(source, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = `${source}\n  __compose_end__:\n`.match(new RegExp(`^  ${escaped}:\\r?\\n([\\s\\S]*?)(?=^  \\S)`, 'm'));
  assert.ok(match, `Compose service ${name} is required`);
  return match[1];
}

function networkBlock(source, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = `${source}\n  __compose_end__:\n`.match(new RegExp(`^  ${escaped}:\\r?\\n([\\s\\S]*?)(?=^  \\S)`, 'm'));
  assert.ok(match, `Compose network ${name} is required`);
  return match[1];
}

const services = servicesSection(compose);
const postgres = serviceBlock(services, 'postgres');
const api = serviceBlock(services, 'api');
const worker = serviceBlock(services, 'ai-worker');
const connector = serviceBlock(services, 'ws-connector');
const backup = serviceBlock(services, 'backup');
const networks = compose.slice(compose.indexOf('\nnetworks:'));

assert.match(networkBlock(networks, 'zhike_internal'), /internal:\s*true/,
  'database/control-plane network must stay isolated');
assert.match(networkBlock(networks, 'zhike_egress'), /driver:\s*bridge/,
  'outbound network must be an ordinary bridge, not internal-only');
assert.match(networkBlock(networks, 'zhike_egress'), /internal:\s*false/,
  'outbound network must explicitly allow egress');
assert.match(networkBlock(networks, 'zhike_ingress'), /driver:\s*bridge/,
  'API published-port network must be an ordinary bridge');
assert.match(networkBlock(networks, 'zhike_ingress'), /com\.docker\.network\.bridge\.enable_ip_masquerade:\s*["']?false["']?/,
  'API ingress network must disable default outbound NAT');
assert.match(networkBlock(networks, 'zhike_ingress'), /ipam:[\s\S]*subnet:\s*\$\{ZHike_DOCKER_LOOPBACK_PAIRING_SOURCE_CIDR:-172\.31\.240\.0\/24\}/,
  'API ingress subnet must be explicit so Docker loopback pairing can trust only that bridge');

assert.match(api, /networks:\s*\[zhike_internal,\s*zhike_ingress\]/,
  'API needs internal database DNS plus a non-internal published-port network');
assert.doesNotMatch(api, /zhike_egress/, 'API must not join the AI/WS egress network');
assert.match(worker, /networks:\s*\[zhike_internal,\s*zhike_egress\]/,
  'AI worker needs internal DB/API DNS plus outbound AI HTTPS');
assert.match(connector, /networks:\s*\[zhike_internal,\s*zhike_egress\]/,
  'WS connector needs internal API DNS plus outbound WhatsApp Web access');
assert.match(api, /ports:[\s\S]*\$\{ZHike_API_BIND:-127\.0\.0\.1\}:\$\{ZHike_API_PORT:-48080\}:8080/,
  'API stays loopback-bound by default for a desktop deployment');
assert.match(api, /ZHike__AppVersion:\s*\$\{ZHike_APP_VERSION:-5\.3\.0\}/,
  'Docker API default version must match the current desktop release');
for (const [name, block] of [['ai-worker', worker], ['ws-connector', connector], ['postgres', postgres], ['backup', backup]]) {
  assert.doesNotMatch(block, /ports:/, `${name} must not publish a host port`);
}
for (const [name, block] of [['ai-worker', worker], ['ws-connector', connector], ['postgres', postgres], ['backup', backup]]) {
  assert.doesNotMatch(block, /zhike_ingress/, `${name} must not join the API ingress network`);
}
for (const [name, block] of [['postgres', postgres], ['backup', backup]]) {
  assert.match(block, /networks:\s*\[zhike_internal\]/, `${name} stays on internal network only`);
  assert.doesNotMatch(block, /zhike_egress/, `${name} must not gain outbound egress`);
}
assert.doesNotMatch(api, /zhike_egress/, 'api must not gain AI/WS egress');
assert.match(prod, /^  zhike_egress:\r?\n\s+driver:\s*bridge/m,
  'production override must preserve the explicit egress network definition');
assert.match(prod, /^  zhike_ingress:\r?\n\s+driver:\s*bridge/m,
  'production override must preserve the explicit API ingress network definition');
assert.doesNotMatch(prod, /published:\s*['"]?5432:/,
  'production override must not publish PostgreSQL');

console.log('compose-network: API ingress and AI/WS egress are isolated from internal DB/control-plane networking');
