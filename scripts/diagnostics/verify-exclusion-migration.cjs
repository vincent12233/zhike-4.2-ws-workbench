'use strict';
// Diagnostic: assert migration 026 created the exclusion platform tables.
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync(process.argv[2]);
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'ws_contact_exclusion%'").all().map(r => r.name);
const indexes = db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_ws_contact_exclusion%'").all().map(r => r.name);
const maxVersion = db.prepare('SELECT MAX(version) AS v FROM schema_migrations').get()?.v;
console.log('TABLES: ' + (tables.join(', ') || 'NONE'));
console.log('INDEXES: ' + indexes.length + ' :: ' + indexes.join(', '));
console.log('MAX MIGRATION: ' + maxVersion);
const cols = db.prepare('PRAGMA table_info(ws_contact_exclusions)').all().map(r => r.name);
console.log('EXCLUSION COLUMNS: ' + cols.join(', '));
db.close();
