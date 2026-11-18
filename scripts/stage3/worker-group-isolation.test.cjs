'use strict';

// Stage 3 keeps the production Worker and group-manager paths inert.  This
// contract test deliberately stays source-level: a real Worker is only
// started by the isolated Stage 2 harness, never by the desktop shell or by
// the Stage 3 test runner.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..', '..');
const appSource = fs.readFileSync(path.join(root, 'desktop', 'src', 'Zhike.Desktop', 'App.xaml.cs'), 'utf8');
const flagsSource = fs.readFileSync(path.join(root, 'desktop', 'src', 'Zhike.Desktop', 'Services', 'WorkerFeatureFlags.cs'), 'utf8');
const serverSource = fs.readFileSync(path.join(root, 'resources', 'app', 'server.mjs'), 'utf8');

// Desktop launch must construct the supervisor in a disabled state and may
// not auto-start the controlled runtime.
assert.match(appSource, /new WorkerSupervisor\(new WorkerSupervisorOptions\(dataRoot, Enabled:\s*false\)\)/,
  'production desktop host must keep WorkerSupervisor disabled');
assert.doesNotMatch(appSource, /WorkerRuntime\.StartAsync\(/,
  'desktop launch must not auto-start the controlled Worker');

// Every Stage 3 group path is opt-in and remains subordinate to the three
// already-approved Worker gates.  This prevents a partial flag file from
// accidentally enabling group writes or a second queue consumer.
assert.match(flagsSource, /public bool GroupManagerPathsEnabled\s*=>[\s\S]*?AllControlledPathsEnabled/,
  'group manager paths must depend on the controlled Worker gates');
for (const name of [
  'IndependentWsGroupManagerEnabled',
  'GroupMemberSyncEnabled',
  'GroupCrmAutoCreateEnabled',
  'GroupMessageCollectionEnabled',
  'GroupReadEvidenceEnabled',
]) {
  const gate = new RegExp(`GroupManagerPathsEnabled[\\s\\S]*?${name}`);
  assert.match(flagsSource, gate, `${name} must be part of the group-manager gate`);
}
assert.match(flagsSource, /Disabled\([^\n]+\)[\s\S]*?=>\s*new\(false,\s*false,\s*false/,
  'missing feature flag configuration must fail closed');

// The sidecar API has a separate isolated-mode gate.  It is intentionally
// environment-scoped for tests and defaults to false when no opt-in is set.
assert.match(serverSource, /ZHIKE_GROUP_MANAGER_MODE/);
assert.match(serverSource, /ZHIKE_STAGE3_MOCK/);
assert.match(serverSource, /groupManagerIsolationMode\s*=\s*String\(process\.env\.ZHIKE_GROUP_MANAGER_MODE/);
assert.match(serverSource, /ws\/group-manager/);
assert.match(serverSource, /function stage3GroupManagerGuard[\s\S]*?error\.status\s*=\s*404/,
  'group-manager boundary must fail closed while isolated mode is disabled');
assert.match(serverSource, /url\.pathname\.startsWith\('\/api\/ws\/group-manager\/'\)[\s\S]*?(?:stage3MockMode|stage3GroupManagerGuard)[\s\S]*?json\(res,\s*404/,
  'group-manager HTTP routes must reject requests while isolated mode is disabled');

console.log('stage3 Worker and group-manager isolation gate: pass');
