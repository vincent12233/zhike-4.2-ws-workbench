#!/usr/bin/env node
'use strict';

/* Isolation-only AI schema authority and history contract. */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const repoRoot = path.resolve(__dirname, '..', '..');
const serverPath = path.join(repoRoot, 'resources', 'app', 'server.mjs');
const migrationsDir = path.join(repoRoot, 'resources', 'app', 'migrations');
const aiMigrationPath = path.join(migrationsDir, '020-ai-schema-authority.sql');
const server = fs.readFileSync(serverPath, 'utf8');
const aiMigration = fs.readFileSync(aiMigrationPath, 'utf8');
const expectedFields = ['id','account_id','conversation_id','idempotency_key','payload_json','status','attempts','max_attempts','next_attempt_at','locked_at','lease_token','last_error','analysis_id','created_at','updated_at'];
const expectedStatuses = ['queued','running','retryable','completed','failed','cancelled'];
function assert(condition, message) { if (!condition) throw new Error(message); }

function staticAuthorityAudit() {
  const migrations = fs.readdirSync(migrationsDir).filter(name => /^\d{3}-.+\.sql$/i.test(name)).sort();
  const aiCreates = migrations.filter(name => /CREATE TABLE(?: IF NOT EXISTS)?\s+ai_jobs\b/i.test(fs.readFileSync(path.join(migrationsDir, name), 'utf8')));
  const inlineCreate = (server.match(/CREATE TABLE(?: IF NOT EXISTS)?\s+ai_jobs\b/gi) || []).length;
  const inlineLeaseAlter = (server.match(/ALTER TABLE\s+ai_jobs\s+ADD COLUMN\s+lease_token/gi) || []).length;
  assert(inlineCreate === 0, `server must not own ai_jobs DDL, found ${inlineCreate}`);
  assert(aiCreates.length === 1 && aiCreates[0] === '020-ai-schema-authority.sql', `expected one authoritative 020 migration, got ${aiCreates.join(',')}`);
  assert(inlineLeaseAlter === 0, `server must not alter ai_jobs lease column, found ${inlineLeaseAlter}`);
  for (const field of expectedFields) assert(new RegExp(`\\b${field}\\b`).test(aiMigration), `020 migration is missing ${field}`);
  for (const status of expectedStatuses) assert(new RegExp(`['"]${status}['"]`).test(server) || new RegExp(`['"]${status}['"]`).test(aiMigration), `AI status ${status} is not enumerated`);
  assert(!/UPDATE ai_jobs SET status='queued'[^\n]*WHERE status='running'/i.test(server), 'startup must not blindly requeue running jobs');
  assert(/UNIQUE\s*\(account_id\s*,\s*idempotency_key\)/i.test(aiMigration), 'AI idempotency key must be account scoped');
  return { status: 'Passed', inlineCreate, inlineLeaseAlter, authoritativeMigration: aiCreates[0], fieldCount: expectedFields.length, statuses: expectedStatuses };
}

function isolatedHistory() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'zhike-stage1-ai-authority-'));
  const db = new DatabaseSync(path.join(tempRoot, 'ai.sqlite'));
  try {
    db.exec(`${aiMigration}\nCREATE TABLE ws_ai_analyses (id TEXT PRIMARY KEY, account_id TEXT NOT NULL, conversation_id TEXT NOT NULL, result_json TEXT NOT NULL, confidence REAL NOT NULL, provider_name TEXT NOT NULL DEFAULT '', model TEXT NOT NULL DEFAULT '', error_message TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL);`);
    const now = new Date().toISOString();
    const insert = db.prepare('INSERT INTO ai_jobs(id,account_id,conversation_id,idempotency_key,payload_json,status,attempts,max_attempts,next_attempt_at,locked_at,lease_token,last_error,analysis_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
    insert.run('done', 'acct', 'conv-1', 'history:conv-1', '{}', 'completed', 1, 5, '', '', '', '', 'analysis-1', now, now);
    insert.run('retry', 'acct', 'conv-2', 'history:conv-2', '{}', 'retryable', 2, 5, now, '', '', 'timeout', '', now, now);
    insert.run('cancelled', 'acct', 'conv-3', 'history:conv-3', '{}', 'cancelled', 1, 5, '', '', '', 'excluded', '', now, now);
    db.prepare('INSERT INTO ws_ai_analyses(id,account_id,conversation_id,result_json,confidence,created_at,updated_at) VALUES(?,?,?,?,?,?,?)').run('analysis-1', 'acct', 'conv-1', '{}', 0.9, now, now);
    const linked = Number(db.prepare("SELECT COUNT(*) AS n FROM ai_jobs WHERE status='completed' AND analysis_id='analysis-1'").get().n);
    const terminal = Number(db.prepare("SELECT COUNT(*) AS n FROM ai_jobs WHERE status IN ('completed','failed','cancelled')").get().n);
    let duplicateRejected = false;
    try { insert.run('duplicate', 'acct', 'conv-x', 'history:conv-1', '{}', 'queued', 0, 5, now, '', '', '', '', now, now); } catch { duplicateRejected = true; }
    assert(linked === 1 && terminal === 2 && duplicateRejected, 'AI history/idempotency fixture failed');
    return { status: 'Passed', linkedCompleted: linked, terminalRows: terminal, duplicateIdempotencyRejected: duplicateRejected };
  } finally { try { db.close(); } catch {} fs.rmSync(tempRoot, { recursive: true, force: true }); }
}

const staticAudit = staticAuthorityAudit();
const isolated = isolatedHistory();
isolated.tempClean = true;
process.stdout.write(`${JSON.stringify({ ok: true, scope: 'isolated-only', productionDatabaseOpened: false, productionWorkerStarted: false, staticAudit, isolated }, null, 2)}\n`);
