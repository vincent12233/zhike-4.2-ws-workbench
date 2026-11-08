'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

if (process.platform !== 'win32') {
  console.log('backup-script parser: skipped (Windows PowerShell integration test)');
  process.exit(0);
}

const repo = path.resolve(__dirname, '..', '..');
const script = path.join(repo, 'infra', 'backup', 'backup.ps1');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zhike-backup-script-'));
const bin = path.join(root, 'bin');
const output = path.join(root, 'out');
fs.mkdirSync(bin, { recursive: true });
fs.mkdirSync(output, { recursive: true });
const capture = path.join(root, 'capture.txt');
const uriCapture = path.join(root, 'uri-capture.txt');
const fakeDump = [
  '@echo off',
  'if not defined PGHOST exit /b 21',
  'if not defined ZHIKE_TEST_ENV_FILE exit /b 22',
  '>"%ZHIKE_TEST_ENV_FILE%" echo %PGHOST%^|%PGPORT%^|%PGDATABASE%^|%PGUSER%^|%PGPASSWORD%^|%PGSSLMODE%^|%PGSSLROOTCERT%^|%PGSSLCERT%^|%PGSSLKEY%^|%PGSSLNEGOTIATION%^|%PGSSLSNI%^|%PGSSLCOMPRESSION%^|%PGSSLMINPROTOCOLVERSION%^|%PGSSLMAXPROTOCOLVERSION%^|%PGSSLCRL%^|%PGSSLCRLDIR%',
  'if defined ZHIKE_TEST_URI_ENV_FILE echo %PGUSER%^|%PGPASSWORD%>>"%ZHIKE_TEST_URI_ENV_FILE%"',
  'set "OUT="',
  ':find',
  'if "%1"=="" goto done',
  'if "%1"=="--file" set "OUT=%2"',
  'shift',
  'goto find',
  ':done',
  'if defined OUT type nul > "%OUT%"',
  'exit /b 0',
].join('\r\n');
fs.writeFileSync(path.join(bin, 'pg_dump.cmd'), fakeDump);

const env = { ...process.env };
env.PATH = `${bin};${env.PATH || env.Path || ''}`;
env.Path = env.PATH;
env.ZHIKE_TEST_ENV_FILE = capture;
env.ConnectionStrings__Postgres = 'Host=host;Port=5432;Database=db;Username=user;Password="p;ass";Ssl Mode=Require;Root Certificate="C:\\certs\\root.pem";Ssl Certificate="C:\\certs\\client.crt";Ssl Key="C:\\certs\\client.key";Ssl Negotiation=direct;Ssl SNI=true;Ssl Compression=off;Ssl Min Protocol Version=TLSv1.2;Ssl Max Protocol Version=TLSv1.3;Ssl CRL="C:\\certs\\client.crl";Ssl CRL Dir="C:\\certs\\crl"';
const result = spawnSync('powershell.exe', [
  '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script,
  '-Action', 'backup', '-BackupRoot', output,
], { encoding: 'utf8', env, windowsHide: true });
assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
assert.equal(fs.readFileSync(capture, 'utf8').trim(), 'host|5432|db|user|p;ass|Require|C:\\certs\\root.pem|C:\\certs\\client.crt|C:\\certs\\client.key|direct|true|off|TLSv1.2|TLSv1.3|C:\\certs\\client.crl|C:\\certs\\crl');
assert.doesNotMatch(result.stdout, /p;ass/);

env.ConnectionStrings__Postgres = 'postgresql://us+er:p+ass@host:5432/db';
env.ZHIKE_TEST_URI_ENV_FILE = uriCapture;
const uriResult = spawnSync('powershell.exe', [
  '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script,
  '-Action', 'backup', '-BackupRoot', output,
], { encoding: 'utf8', env, windowsHide: true });
assert.equal(uriResult.status, 0, `${uriResult.stdout}\n${uriResult.stderr}`);
assert.equal(fs.readFileSync(uriCapture, 'utf8').trim(), 'us+er|p+ass');

const source = path.join(root, 'source.dump');
fs.writeFileSync(source, 'fixture');
const dryRun = spawnSync('powershell.exe', [
  '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script,
  '-Action', 'restore', '-Source', source,
  '-TargetDatabase', 'postgresql://u:secret%3Bvalue@db:5432/target?sslmode=require',
  '-DryRun',
], { encoding: 'utf8', env, windowsHide: true });
assert.equal(dryRun.status, 0, `${dryRun.stdout}\n${dryRun.stderr}`);
assert.doesNotMatch(dryRun.stdout, /secret|value/);
assert.match(dryRun.stdout, /database=target/);

fs.rmSync(root, { recursive: true, force: true });
console.log('backup-script parser: quoted values, URI redaction and PowerShell invocation pass');
