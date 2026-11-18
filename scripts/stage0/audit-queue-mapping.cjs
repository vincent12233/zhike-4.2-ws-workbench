'use strict';

// Read-only Stage 0 audit. It scans source text and migration files only; it never
// opens workspace.sqlite and never performs DDL, writes, or starts a service.
const fs = require('node:fs');
const path = require('node:path');

if (process.argv[2] !== '--read-only') {
  console.error('usage: node scripts/stage0/audit-queue-mapping.cjs --read-only');
  process.exit(2);
}
const repo = path.resolve(__dirname, '..', '..');
const read = rel => fs.readFileSync(path.join(repo, rel), 'utf8');
const serverPath = path.join(repo, 'resources', 'app', 'server.mjs');
const server = read('resources/app/server.mjs');
const migrationsDir = path.join(repo, 'resources', 'app', 'migrations');
const migrationFiles = fs.readdirSync(migrationsDir).filter(name => /^\d{3}-.+\.sql$/i.test(name)).sort();
const migrationVersions = migrationFiles.map(name => Number(name.slice(0, 3))).filter(Number.isFinite);
const migrationManifest = JSON.parse(fs.readFileSync(path.join(migrationsDir, 'manifest.json'), 'utf8'));
const manifestMax = Number(migrationManifest.supportedSchemaVersion || 0);
const tableNames = new Set();
for (const source of [server, ...migrationFiles.map(name => fs.readFileSync(path.join(migrationsDir, name), 'utf8'))]) {
  for (const match of source.matchAll(/(?:CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?|FROM\s+|INTO\s+|UPDATE\s+|JOIN\s+)([A-Za-z_][A-Za-z0-9_]*)/gi)) tableNames.add(match[1]);
}
const relevant = ['ws_collection_runs', 'ws_collection_items', 'ai_jobs', 'ws_ai_analyses', 'ai_customer_field_evidence', 'ws_group_monitor_checkpoints', 'ws_followup_alerts'];
const writers = [];
const writerSources = [
  ['resources/app/modules/ws-workbench.js', /collection-runs|collection-items|ai-jobs|analyses/gi],
  ['resources/app/server.mjs', /collection-runs|collection-items|ai-jobs|ws_ai_analyses|ws_group_monitor_checkpoints/gi],
  ['desktop/src/Zhike.Desktop/Services/LocalQueue.cs', /pending\.json|enqueue|dequeue/gi],
];
for (const [rel, pattern] of writerSources) {
  const source = read(rel);
  if (pattern.test(source)) writers.push(rel);
}
const inlineAiJobs = /CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+ai_jobs/i.test(server);
const runnerVersions = [...server.matchAll(/user_version[\s\S]{0,120}?\)\s*<\s*(\d+)/g)].map(match => Number(match[1]));
const maxInlineVersion = runnerVersions.length ? Math.max(...runnerVersions) : 0;
const blockers = [];
if (maxInlineVersion > 0) blockers.push(`server still contains inline schema version checks (max ${maxInlineVersion}); versioned migration runner is not the sole DDL owner`);
if (!manifestMax || !migrationVersions.includes(manifestMax)) blockers.push('migration manifest maximum is missing from the SQL inventory');
if (inlineAiJobs) blockers.push('ai_jobs is created inline in server.mjs rather than a versioned migration');
if (writers.includes('resources/app/modules/ws-workbench.js')) blockers.push('foreground ws-workbench.js remains a collection/AI queue writer');
if (writers.includes('desktop/src/Zhike.Desktop/Services/LocalQueue.cs')) blockers.push('pending.json LocalQueue is a separate durable queue path');
blockers.push('queue/AI mapping is provisional until field, state, unique-key and rollback contracts are approved');
const output = {
  readOnly: true,
  repository: repo,
  scannedFiles: { server: serverPath, migrations: migrationFiles, writerSources: writers },
  migrationRunner: { maxInlineVersion, migrationVersions, manifestMax },
  tables: relevant.filter(name => tableNames.has(name)),
  writers,
  aiJobsCreatedInline: inlineAiJobs,
  blockers,
};
process.stdout.write(JSON.stringify(output));
