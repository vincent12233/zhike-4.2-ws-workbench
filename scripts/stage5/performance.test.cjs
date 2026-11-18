'use strict';

// Synthetic SQLite measurements, not a WinUI frame-rate or real-WS benchmark.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { performance } = require('node:perf_hooks');
const { DatabaseSync } = require('node:sqlite');
const { runMigrations, readIntegrity } = require('../../resources/app/migration-runner.cjs');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zhike-stage5-perf-'));
const dbPath = path.join(root, 'workspace.sqlite');
const db = new DatabaseSync(dbPath);
const migrationDir = path.resolve(__dirname, '../../resources/app/migrations');
const now = '2026-11-16T00:00:00.000Z';
const memoryBefore = process.memoryUsage().rss;
const cpuBefore = process.cpuUsage();
try {
  const migrationStart = performance.now();
  runMigrations({ db, dbPath, migrationDir, manifestPath: path.join(migrationDir, 'manifest.json'), lockPath: path.join(root, 'migration.lock'), backupDir: path.join(root, 'backups') });
  const migrationMs = performance.now() - migrationStart;
  const inserts = {
    accounts: db.prepare('INSERT INTO ws_accounts(id,created_at,updated_at) VALUES(?,?,?)'),
    groups: db.prepare('INSERT INTO ws_group_catalog(id,account_id,group_jid,first_seen_at,last_seen_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?)'),
    members: db.prepare("INSERT INTO ws_group_members(id,account_id,group_jid,member_jid,status,created_at,updated_at) VALUES(?,?,?,?,'active',?,?)"),
    messages: db.prepare('INSERT INTO ws_group_messages(id,account_id,group_jid,message_id,sent_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?)'),
    jobs: db.prepare("INSERT INTO ai_jobs(id,account_id,conversation_id,idempotency_key,status,next_attempt_at,created_at,updated_at,customer_id,correlation_id) VALUES(?,?,?,?,'pending',?,?,?,?,?)"),
    evidence: db.prepare('INSERT INTO ai_job_evidence(id,account_id,job_id,source_id,quote,created_at,correlation_id) VALUES(?,?,?,?,?,?,?)'),
    suggestions: db.prepare("INSERT INTO ai_crm_suggestions(id,account_id,customer_id,job_id,field_name,idempotency_key,created_at,updated_at,correlation_id) VALUES(?,?,?,?,'occupation',?,?,?,?)"),
    audit: db.prepare("INSERT INTO ai_task_audit(id,account_id,job_id,action,created_at,correlation_id) VALUES(?,?,?,'enqueue',?,?)"),
  };
  const counts = { accounts: 4, groups: 2000, members: 20000, messages: 50000, jobs: 10000, evidence: 10000, suggestions: 10000, audit: 20000 };
  const seedStart = performance.now(); db.exec('BEGIN IMMEDIATE');
  for (let i = 0; i < counts.accounts; i++) inserts.accounts.run(`perf-a${i}`, now, now);
  for (let i = 0; i < counts.groups; i++) inserts.groups.run(`perf-g${i}`, `perf-a${i % 4}`, `1203-perf-${i}@g.us`, now, now, now, now);
  for (let i = 0; i < counts.members; i++) { const group = i % counts.groups; inserts.members.run(`perf-member-${i}`, `perf-a${group % 4}`, `1203-perf-${group}@g.us`, `91${9000000000 + i}@s.whatsapp.net`, now, now); }
  for (let i = 0; i < counts.messages; i++) { const group = i % counts.groups; inserts.messages.run(`perf-message-${i}`, `perf-a${group % 4}`, `1203-perf-${group}@g.us`, `msg-${i}`, now, now, now); }
  for (let i = 0; i < counts.jobs; i++) { const account = `perf-a${i % 4}`, job = `perf-job-${i}`, customer = `perf-customer-${i}`, correlation = `perf-flow-${i}`; inserts.jobs.run(job, account, `perf-conv-${i}`, job, now, now, now, customer, correlation); inserts.evidence.run(`perf-evidence-${i}`, account, job, `source-${i}`, 'Synthetic evidence', now, correlation); inserts.suggestions.run(`perf-suggestion-${i}`, account, customer, job, `suggestion-key-${i}`, now, now, correlation); }
  for (let i = 0; i < counts.audit; i++) inserts.audit.run(`perf-audit-${i}`, `perf-a${i % 4}`, `perf-job-${i % counts.jobs}`, now, `perf-flow-${i % counts.jobs}`);
  db.exec('COMMIT'); const seedMs = performance.now() - seedStart;
  const queries = [
    ['group-page', 'SELECT * FROM ws_group_catalog WHERE account_id=? AND status=? ORDER BY last_seen_at DESC LIMIT 100', ['perf-a0', 'active'], 100],
    ['member-page', 'SELECT * FROM ws_group_members WHERE account_id=? AND group_jid=? AND status=? ORDER BY updated_at LIMIT 100', ['perf-a0', '1203-perf-0@g.us', 'active'], 10],
    ['message-page', 'SELECT * FROM ws_group_messages WHERE account_id=? AND group_jid=? ORDER BY sent_at,id LIMIT 100', ['perf-a0', '1203-perf-0@g.us'], 25],
    ['ai-queue-page', 'SELECT * FROM ai_jobs WHERE account_id=? AND status=? ORDER BY priority,next_attempt_at,updated_at LIMIT 100', ['perf-a0', 'pending'], 100],
    ['crm-review-page', 'SELECT * FROM ai_crm_suggestions WHERE account_id=? AND verification_status=? ORDER BY updated_at LIMIT 100', ['perf-a0', 'pending'], 100],
    ['evidence-detail', 'SELECT * FROM ai_job_evidence WHERE account_id=? AND job_id=? ORDER BY created_at LIMIT 100', ['perf-a0', 'perf-job-0'], 1],
    ['audit-detail', 'SELECT * FROM ai_task_audit WHERE account_id=? AND job_id=? ORDER BY created_at LIMIT 100', ['perf-a0', 'perf-job-0'], 2],
  ];
  const measurements = queries.map(([name, sql, params, expected]) => {
    const statement = db.prepare(sql), timings = []; let rows;
    for (let i = 0; i < 100; i++) { const start = performance.now(); rows = statement.all(...params); timings.push(performance.now() - start); assert.equal(rows.length, expected, name); }
    assert.ok(rows.every(row => row.account_id === params[0]), `${name}: account isolation`);
    timings.sort((a, b) => a - b);
    const plan = db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...params).map(row => row.detail);
    assert.ok(plan.some(detail => /USING INDEX|USING COVERING INDEX/.test(detail)), `${name}: expected existing index`);
    return { name, rows: expected, repetitions: timings.length, p50Ms: +timings[49].toFixed(3), p95Ms: +timings[94].toFixed(3), maxMs: +timings.at(-1).toFixed(3), plan };
  });
  assert.equal(readIntegrity(db).ok, true);
  const cpu = process.cpuUsage(cpuBefore); const memoryAfter = process.memoryUsage().rss;
  console.log(JSON.stringify({ stage: 5, status: 'Passed', scope: 'synthetic SQLite queries only', counts, migrationMs: +migrationMs.toFixed(1), seedMs: +seedMs.toFixed(1), seedRowsPerSecond: +((Object.values(counts).reduce((a,b)=>a+b,0) / seedMs) * 1000).toFixed(1), rssBeforeBytes: memoryBefore, rssAfterBytes: memoryAfter, rssDeltaBytes: memoryAfter - memoryBefore, cpuUserMs: cpu.user / 1000, cpuSystemMs: cpu.system / 1000, measurements, winUiFrameTime: 'NotTested', workerThroughput: 'NotTested', productionDatabaseOpened: false }));
} finally { db.close(); fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); }
