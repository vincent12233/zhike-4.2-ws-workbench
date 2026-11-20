'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { promisify } = require('node:util');
const { createCipheriv, createHash, randomBytes, scrypt } = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const { test } = require('node:test');
const { runMigrations } = require('../resources/app/migration-runner.cjs');
const {
  createDeviceMigrationIsolationRoot, assertDeviceMigrationIsolationRoot,
} = require('../resources/app/device-migration-isolation.cjs');
const { unpackDevicePackage } = require('../resources/app/device-migration-package.cjs');
const { writeDeviceMigrationPackageV1 } = require('../resources/app/device-migration-snapshot.cjs');
const {
  writeDevicePackageV2, unpackDevicePackageV2, unpackIsolatedDeviceMigrationPackage, discardStagedDeviceMigrationV2,
} = require('../resources/app/device-migration-package-v2.cjs');

const migrationDir = path.resolve(__dirname, '../resources/app/migrations');
const password = 'isolated synthetic v2 test password';
const time = '2026-11-18T06:00:00.000Z';
const mediaId = 'wsm-fixture-123456789a';
const mediaBytes = Buffer.concat([Buffer.alloc(1024 * 1024, 23), Buffer.from('a second frame')]);
const digest = input => createHash('sha256').update(input).digest('hex');

async function fixture(t) {
  const isolationRoot = await createDeviceMigrationIsolationRoot();
  const input = path.join(isolationRoot, 'source');
  const stagingParent = path.join(isolationRoot, 'staging');
  await fs.mkdir(input);
  await fs.mkdir(stagingParent);
  t.after(() => fs.rm(isolationRoot, { recursive: true, force: true, maxRetries: 5 }));
  const databasePath = path.join(input, 'workspace.sqlite');
  const db = new DatabaseSync(databasePath);
  try {
    runMigrations({
      db, dbPath: databasePath, initializeAtVersion: 25, migrationDir, manifestPath: path.join(migrationDir, 'manifest.json'),
      backupDir: path.join(input, 'migration-backups'), lockPath: path.join(input, '.migration.lock'),
    });
    db.prepare(`INSERT INTO ws_accounts(id,display_name,origin,partition_key,created_at,updated_at)
      VALUES('native-b','Synthetic second account','https://redacted.example','private-device-partition',?,?)`).run(time, time);
    const crm = { schemaVersion: 4, customers: [], channelAliases: { a: 'b' }, qualityDecisions: { fixture: 'approved' },
      settings: { apiKey: 'never-export-this-fixture-secret' } };
    db.prepare('INSERT INTO app_state(id,json,updated_at,revision) VALUES(1,?,?,4)').run(JSON.stringify(crm), time);
    db.prepare(`INSERT INTO ws_media_assets(id,account_id,file_name,size_bytes,sha256,storage_path,status,created_at,updated_at)
      VALUES(?,'native-b',?,?,?,?,'ready',?,?)`).run(mediaId, 'attachment.pdf', mediaBytes.length, digest(mediaBytes),
      'ws-media/native-b/' + mediaId, time, time);
    db.prepare(`INSERT INTO ws_media_assets(id,account_id,status,created_at,updated_at)
      VALUES('not-ready','default','unavailable',?,?)`).run(time, time);
  } finally {
    db.close();
  }
  const assetPath = path.join(input, 'ws-media', 'native-b', mediaId);
  await fs.mkdir(path.dirname(assetPath), { recursive: true });
  await fs.writeFile(assetPath, mediaBytes);
  const file = name => path.join(isolationRoot, name + '.zkdevice');
  return {
    isolationRoot, input, databasePath, stagingParent, assetPath, file,
    write: destination => writeDevicePackageV2({ isolationRoot, databasePath, destination, password }),
    unpack: (source, pass = password) => unpackDevicePackageV2({ isolationRoot, source, stagingParent, password: pass }),
  };
}

async function sealV2(destination, manifest, ledger, media, transform = value => value) {
  const header = Buffer.concat([Buffer.from('ZKDEVICE'), Buffer.from([2]), randomBytes(24)]);
  const passwordBytes = Buffer.from(password, 'utf8');
  const key = await promisify(scrypt)(passwordBytes, header.subarray(9, 25), 32,
    { N: 65536, r: 8, p: 1, maxmem: 96 * 1024 * 1024 });
  const frames = [];
  function frame(data) {
    const number = Buffer.alloc(4);
    number.writeUInt32BE(frames.length);
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const cipher = createCipheriv('aes-256-gcm', key, Buffer.concat([header.subarray(25), number]));
    cipher.setAAD(Buffer.concat([header, number, length]));
    frames.push(Buffer.concat([length, cipher.update(data), cipher.final(), cipher.getAuthTag()]));
  }
  try {
    frame(Buffer.from(JSON.stringify(manifest)));
    for (const entry of [ledger, ...media]) {
      for (let offset = 0; offset < entry.length; offset += 1024 * 1024) {
        frame(entry.subarray(offset, offset + 1024 * 1024));
      }
    }
    await fs.writeFile(destination, Buffer.concat([header, ...transform(frames)]));
  } finally {
    key.fill(0);
    passwordBytes.fill(0);
  }
}

test('v2 authenticates a real 025 ledger and multi-frame bytes with honest and portable coverage', async t => {
  const f = await fixture(t);
  const sourceBefore = await fs.readFile(f.databasePath);
  const source = f.file('roundtrip');
  const written = await f.write(source);
  const wire = await fs.readFile(source);
  assert.equal(wire.subarray(0, 8).toString('ascii'), 'ZKDEVICE');
  assert.equal(wire[8], 2);
  assert.ok(wire.readUInt32BE(33) > 0);
  assert.equal(written.sizeBytes, wire.length);
  const opened = await f.unpack(source);
  assert.deepEqual(opened.manifest, written.manifest);
  assert.deepEqual(Object.keys(opened.manifest), ['formatVersion', 'schemaVersion', 'packageId', 'createdAtUtc',
    'ledger', 'accounts', 'media', 'coverage']);
  assert.deepEqual(opened.manifest.accounts.map(row => row.id), ['default', 'native-b']);
  assert.equal(opened.manifest.coverage.status, 'partial');
  assert.equal(opened.manifest.coverage.scope, 'sqlite-business-025');
  assert.equal(Object.keys(opened.manifest.coverage.tableRows).length, 42);
  assert.equal(opened.manifest.coverage.nestedFieldsWithheld, 1);
  assert.deepEqual(opened.manifest.coverage.media, {
    readyIndexed: 1, included: 1, available: 0, pending: 0, unavailable: 1, deleted: 0,
  });
  assert.equal(Object.hasOwn(opened.manifest.media[0], 'path'), false);
  const raw = await fs.readFile(opened.snapshotPath);
  assert.equal(digest(raw), opened.manifest.ledger.sha256);
  assert.doesNotMatch(raw.toString('utf8'), /never-export-this-fixture-secret|private-device-partition|redacted\.example|ws-media\/native-b/);
  const ledger = JSON.parse(raw);
  assert.deepEqual(ledger.tables.app_state[0].json.channelAliases, { a: 'b' });
  assert.deepEqual(ledger.tables.app_state[0].json.qualityDecisions, { fixture: 'approved' });
  assert.deepEqual(await fs.readFile(opened.media[0].path), mediaBytes);
  assert.deepEqual(await fs.readFile(f.databasePath), sourceBefore);
  await assert.rejects(discardStagedDeviceMigrationV2({ ...opened }), { code: 'CLEANUP_PENDING' });
  assert.deepEqual(await fs.readFile(opened.media[0].path), mediaBytes);
  await discardStagedDeviceMigrationV2(opened);
  await discardStagedDeviceMigrationV2(opened);
  assert.deepEqual(await fs.readdir(f.stagingParent), []);
});

test('strict header routing preserves v1 and fails closed for unknown version or v2 authentication failure', async t => {
  const f = await fixture(t);
  const v1 = f.file('v1');
  const v2 = f.file('v2');
  await writeDeviceMigrationPackageV1({ databasePath: f.databasePath, destination: v1, password });
  await f.write(v2);
  const options = { isolationRoot: f.isolationRoot, stagingParent: f.stagingParent, password };
  await assert.rejects(f.unpack(v1), { code: 'FORMAT' });
  await assert.rejects(unpackDevicePackage({ source: v2, ...options }), { code: 'FORMAT' });
  const old = await unpackIsolatedDeviceMigrationPackage({ ...options, source: v1 });
  assert.equal(old.manifest.formatVersion, 1);
  assert.equal(old.manifest.coverage.status, 'partial');
  assert.equal(JSON.parse(await fs.readFile(old.snapshotPath, 'utf8')).crm.channelAliases, undefined);
  await discardStagedDeviceMigrationV2(old);
  const fresh = await unpackIsolatedDeviceMigrationPackage({ ...options, source: v2 });
  assert.equal(fresh.manifest.formatVersion, 2);
  await discardStagedDeviceMigrationV2(fresh);
  await assert.rejects(unpackIsolatedDeviceMigrationPackage({ ...options, source: v2, password: 'wrong' }), { code: 'AUTHENTICATION' });
  const unknown = f.file('unknown');
  const raw = await fs.readFile(v2);
  raw[8] = 3;
  await fs.writeFile(unknown, raw);
  await assert.rejects(unpackIsolatedDeviceMigrationPackage({ ...options, source: unknown }), { code: 'FORMAT' });
  assert.deepEqual(await fs.readdir(f.stagingParent), []);
});

test('authenticated forged claims, omitted or altered ready bytes and reordered frames leave no stage', async t => {
  const f = await fixture(t);
  const location = f.file('source');
  await f.write(location);
  const opened = await f.unpack(location);
  const ledger = await fs.readFile(opened.snapshotPath);
  const manifest = opened.manifest;
  await discardStagedDeviceMigrationV2(opened);
  const cases = [
    ['scope', 'FORMAT', m => { m.accounts.pop(); }, [mediaBytes]],
    ['coverage', 'FORMAT', m => { m.coverage.tableRows.ws_group_members++; }, [mediaBytes]],
    ['complete', 'FORMAT', m => { m.coverage.status = 'complete'; }, [mediaBytes]],
    ['missing', 'MEDIA', m => { m.media = []; m.coverage.media.included = 0; }, []],
    ['reorder', 'FORMAT', () => {}, [mediaBytes], frames => [frames[0], frames[2], frames[1], frames[3]]],
    ['digest', 'DIGEST', () => {}, [Buffer.from(mediaBytes).fill(15)]],
  ];
  for (const [name, code, change, media, transform] of cases) {
    const forged = f.file(name);
    const altered = structuredClone(manifest);
    change(altered);
    await sealV2(forged, altered, ledger, media, transform);
    await assert.rejects(f.unpack(forged), { code }, name);
    assert.deepEqual(await fs.readdir(f.stagingParent), [], name);
  }
});

test('temporary root checks block adjacent paths, active sources and links', async t => {
  const f = await fixture(t);
  const ordinary = await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()), 'rd09-ordinary-'));
  t.after(() => fs.rm(ordinary, { recursive: true, force: true }));
  await assert.rejects(assertDeviceMigrationIsolationRoot(ordinary), { code: 'ISOLATION' });
  await assert.rejects(assertDeviceMigrationIsolationRoot(f.isolationRoot, ordinary), { code: 'ISOLATION' });
  await assert.rejects(f.write(path.join(ordinary, 'outside.zkdevice')), { code: 'ISOLATION' });
  const linked = path.join(f.isolationRoot, 'linked');
  await fs.symlink(ordinary, linked, process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(assertDeviceMigrationIsolationRoot(f.isolationRoot, linked), { code: 'PATH' });
  await fs.unlink(linked);

  const workbench = path.join(f.input, '.workbench.lock');
  await fs.writeFile(workbench, 'contents deliberately unused');
  await assert.rejects(f.write(f.file('busy')), { code: 'SOURCE_BUSY' });
  await fs.unlink(workbench);
  await fs.writeFile(f.databasePath + '-wal', 'nonempty synthetic WAL');
  await assert.rejects(f.write(f.file('wal')), { code: 'SOURCE_BUSY' });
  await fs.unlink(f.databasePath + '-wal');
});

test('recognized credential attachment names are rejected before a v2 package is written', async t => {
  const f = await fixture(t);
  const names = ['Cookies', 'connection.private.json', 'Cookies-wal', 'Login Data-shm'];
  for (const [index, name] of names.entries()) {
    await t.test(name, async () => {
      const db = new DatabaseSync(f.databasePath);
      try {
        db.prepare("UPDATE ws_media_assets SET file_name=? WHERE status='ready'").run(name);
      } finally {
        db.close();
      }
      const destination = f.file('private-' + index);
      await assert.rejects(f.write(destination), { code: 'PRIVATE_DATA' });
      await assert.rejects(fs.stat(destination), { code: 'ENOENT' });
    });
  }
});

test('a displaced plaintext stage is reported and no replacement is reclaimed', async t => {
  const f = await fixture(t);
  const source = f.file('displaced');
  await f.write(source);
  const opened = await f.unpack(source);
  const displaced = path.join(f.stagingParent, 'displaced-by-test');
  await fs.rename(opened.directory, displaced);
  await fs.mkdir(opened.directory);
  const replacement = path.join(opened.directory, 'external.txt');
  await fs.writeFile(replacement, 'preserve replacement');
  await assert.rejects(discardStagedDeviceMigrationV2(opened), { code: 'CLEANUP_PENDING', cleanupPending: true });
  assert.equal(await fs.readFile(replacement, 'utf8'), 'preserve replacement');
  assert.ok((await fs.stat(path.join(displaced, 'snapshot.json'))).isFile());
});

test('isolated callers require the private root marker and reject a relaxed directory ACL', async t => {
  const root = await createDeviceMigrationIsolationRoot();
  t.after(() => fs.rm(root, { recursive: true, force: true, maxRetries: 5 }));
  const marker = path.join(root, '.rd09-isolation.json');
  const original = await fs.readFile(marker);
  await fs.writeFile(marker, '{"version":1,"isolationId":"bad","directory":"bad"}');
  await assert.rejects(assertDeviceMigrationIsolationRoot(root), { code: 'ISOLATION' });
  await fs.writeFile(marker, original);
  await assertDeviceMigrationIsolationRoot(root);
  if (process.platform === 'win32') {
    const { execFile } = require('node:child_process');
    const command = [
      '$ErrorActionPreference = "Stop"',
      '$root = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($env:ZHIKE_RD09_TEST_ROOT_B64))',
      '$acl = [IO.Directory]::GetAccessControl($root)',
      '$acl.SetAccessRuleProtection($false, $true)',
      '[IO.Directory]::SetAccessControl($root, $acl)',
    ].join('\n');
    const powershell = path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe');
    await promisify(execFile)(powershell, ['-NoProfile', '-NonInteractive', '-Command', command], {
      env: { ...process.env, ZHIKE_RD09_TEST_ROOT_B64: Buffer.from(root).toString('base64') },
      windowsHide: true, timeout: 15000,
    });
  } else {
    await fs.chmod(root, 0o755);
  }
  await assert.rejects(assertDeviceMigrationIsolationRoot(root), { code: 'PATH' });
});


function concurrentSourceProcess(...args) {
  const { execFile } = require('node:child_process');
  const script = [
    "const fs = require('node:fs');",
    "const [operation, db, replacement, displaced] = process.argv.slice(1);",
    "if (operation === 'swap') { fs.renameSync(db, displaced); fs.renameSync(replacement, db); }",
    "else {",
    "  try {",
    "    const fd = fs.openSync(db, 'wx'); fs.closeSync(fd); fs.unlinkSync(db); console.log('acquired');",
    "  } catch (error) { if (error.code !== 'EEXIST') throw error; console.log('busy'); }",
    "}",
  ].join('\n');
  return promisify(execFile)(process.execPath, ['-e', script, ...args], { windowsHide: true, timeout: 15000 });
}

test('rejects a verified isolated DB path replaced by a competing process', async t => {
  for (const [phase, checkpoint] of [['before SQLite projection', 1], ['before package completion', 3]]) {
    await t.test(phase, async t => {
      const f = await fixture(t);
      const replacement = path.join(f.input, 'replacement.sqlite');
      const displaced = path.join(f.input, 'displaced.sqlite');
      const originalBytes = await fs.readFile(f.databasePath);
      await fs.copyFile(f.databasePath, replacement);
      const alternative = new DatabaseSync(replacement);
      try {
        alternative.prepare('UPDATE app_state SET revision=999').run();
      } finally {
        alternative.close();
      }
      const replacementBytes = await fs.readFile(replacement);
      const readdir = fs.readdir;
      let checks = 0;
      t.mock.method(fs, 'readdir', async (directory, ...options) => {
        const result = await readdir(directory, ...options);
        if (directory === f.input && ++checks === checkpoint) {
          await concurrentSourceProcess('swap', f.databasePath, replacement, displaced);
        }
        return result;
      });
      const destination = f.file('swapped-db');
      await assert.rejects(f.write(destination), { code: 'PATH' });
      assert.equal(checks, checkpoint);
      assert.deepEqual(await fs.readFile(displaced), originalBytes);
      assert.deepEqual(await fs.readFile(f.databasePath), replacementBytes);
      assert.equal((await fs.readdir(f.isolationRoot)).some(name => name.startsWith('rd09-source-')), false);
      await assert.rejects(fs.stat(destination), { code: 'ENOENT' });
      await assert.rejects(fs.stat(path.join(f.input, '.workbench.lock')), { code: 'ENOENT' });
    });
  }
});
test('a competing process cannot obtain the sidecar lock during isolated v2 projection', async t => {
  const f = await fixture(t);
  const lock = path.join(f.input, '.workbench.lock');
  const readdir = fs.readdir;
  let outcome;
  t.mock.method(fs, 'readdir', async (directory, ...options) => {
    const result = await readdir(directory, ...options);
    if (directory === f.input && !outcome) {
      const child = await concurrentSourceProcess('claim', lock);
      outcome = child.stdout.trim();
    }
    return result;
  });
  await f.write(f.file('source-exclusive'));
  assert.equal(outcome, 'busy');
  await assert.rejects(fs.stat(lock), { code: 'ENOENT' });
});
