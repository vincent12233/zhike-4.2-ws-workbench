'use strict';

// runMigrations is synchronous. A separate connection pins one committed read
// snapshot while SQLite's online backup API copies its pages, including WAL.
const { DatabaseSync, backup } = require('node:sqlite');
const { readIntegrity } = require('../migration-runner.cjs');

async function snapshot(sourcePath, targetPath) {
  const source = new DatabaseSync(sourcePath, { readOnly: true });
  try {
    source.exec('PRAGMA busy_timeout=5000; BEGIN');
    source.prepare('SELECT count(*) FROM sqlite_schema').get();
    await backup(source, targetPath);
  } finally { source.close(); }
  const target = new DatabaseSync(targetPath, { readOnly: true });
  try { process.stdout.write(JSON.stringify(readIntegrity(target))); }
  finally { target.close(); }
}

snapshot(process.argv[2], process.argv[3]).catch(error => {
  process.stderr.write(error.message + '\n');
  process.exitCode = 1;
});
