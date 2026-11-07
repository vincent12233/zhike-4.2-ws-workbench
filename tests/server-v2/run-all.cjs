'use strict';

const { spawnSync } = require('node:child_process');
const path = require('node:path');
const tests = [
  'bootstrap.test.cjs',
  'postgres-migrations.test.cjs',
  'sqlite-postgres-migration.test.cjs',
  'domain-record-identity.test.cjs',
  'import-classification.test.cjs',
  'import-date-robustness.test.cjs',
  'api-contract.test.cjs',
  'data-integrity-regression.test.cjs',
  'outbox-idempotency.test.cjs',
  'security-backup.test.cjs',
  'e2e-migration.test.cjs',
  'performance-postgres.test.cjs',
  'ws-authorized-smoke.test.cjs',
  'ws-routes-checkpoint-atomicity.test.cjs',
  'installer-cutover.test.cjs',
];
const root = __dirname;
for (const file of tests) {
  const result = spawnSync(process.execPath, [path.join(root, file)], { stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status || 1);
}
console.log(`server-v2 suite: ${tests.length}/${tests.length} reference/static checks passed`);
