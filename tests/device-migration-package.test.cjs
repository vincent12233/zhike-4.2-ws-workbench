'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createCipheriv, createHash, scryptSync } = require('node:crypto');
const { test } = require('node:test');
const { spawnSync } = require('node:child_process');
const { writeDevicePackage, unpackDevicePackage } = require('../resources/app/device-migration-package.cjs');
const { MAX_BYTES: MAX_MEDIA } = require('../resources/app/modules/ws-media-core.js');

const PASSWORD = '隔离夹具密码 · local test only';
const MiB = 1024 * 1024;
const hash = (data) => createHash('sha256').update(data).digest('hex');
const bytes = (value) => Buffer.from(JSON.stringify(value), 'utf8');
const seed = () => ({
  schemaVersion: 25,
  crm: {
    schemaVersion: 4,
    customers: [{ id: 'C-test', name: '合成客户资料', manualLockedFields: ['name'] }],
    settings: { stage: 'isolated', remindersEnabled: true },
  },
  wsAccounts: { default: { schemaVersion: 6, conversations: [{ id: 'ws-test', accountId: 'default' }], mediaAssets: [] } },
  wsAccountMetadata: [{ id: 'default', displayName: '合成账号' }],
});

function addAsset(snapshot, stem, data, status = 'ready') {
  const sizeBytes = typeof data === 'number' ? data : data.length;
  const digest = typeof data === 'number' ? 'b'.repeat(64) : hash(data);
  const id = 'wsm-' + stem + '-0011223344';
  const accountId = 'default';
  snapshot.wsAccounts[accountId].mediaAssets.push({ id, mediaId: id, accountId, status, sizeBytes, sha256: digest });
  return { accountId, id, sizeBytes, sha256: digest, relativePath: accountId + '/' + id };
}


async function assertPrivateStaging(directory, files) {
  if (process.platform !== 'win32') {
    for (const item of [directory, ...files]) assert.equal((await fs.stat(item)).mode & 0o077, 0);
    return;
  }
  const script = [
    "$ErrorActionPreference = 'Stop'",
    '$paths = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String([Console]::In.ReadToEnd())) | ConvertFrom-Json',
    '$sid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value',
    '$directoryAcl = [IO.Directory]::GetAccessControl($paths[0])',
    'if (!$directoryAcl.AreAccessRulesProtected) { exit 2 }',
    'foreach ($item in $paths) {',
    '  $acl = if ([IO.Directory]::Exists($item)) { [IO.Directory]::GetAccessControl($item) } else { [IO.File]::GetAccessControl($item) }',
    '  $rules = $acl.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier])',
    '  if ($rules.Count -lt 1) { exit 3 }',
    '  foreach ($rule in $rules) { if ($rule.IdentityReference.Value -ne $sid -or $rule.AccessControlType -ne "Allow") { exit 4 } }',
    '}',
    'exit 0',
  ].join('\n');
  const powershell = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe');
  const result = spawnSync(powershell, ['-NoProfile', '-NonInteractive', '-Command', script], {
    input: bytes([directory, ...files]).toString('base64'), windowsHide: true, timeout: 15000,
  });
  assert.equal(result.status, 0, 'staging tree must grant access only to the current user');
}

async function fixture(t) {
  const temp = await fs.realpath(os.tmpdir());
  const root = await fs.mkdtemp(path.join(temp, 'zhike-device-test-'));
  const sourceDir = path.join(root, 'explicit-media');
  const stage = path.join(root, 'temporary-staging');
  await fs.mkdir(stage);
  await fs.mkdir(path.join(sourceDir, 'default'), { recursive: true });
  await fs.writeFile(path.join(stage, 'unchanged.txt'), 'existing local data');
  t.after(async () => {
    assert.equal(path.dirname(root), temp);
    assert.match(path.basename(root), /^zhike-device-test-[a-z0-9]+$/i);
    await fs.rm(root, { recursive: true, force: true });
  });
  return {
    root,
    sourceDir,
    stage,
    out: (name) => path.join(root, name + '.zkdevice'),
    async assertUnchanged() {
      assert.deepEqual(await fs.readdir(stage), ['unchanged.txt']);
      assert.equal(await fs.readFile(path.join(stage, 'unchanged.txt'), 'utf8'), 'existing local data');
    },
  };
}

function options(f, snapshot = seed(), media = [], name = 'package') {
  return { destination: f.out(name), password: PASSWORD, snapshot, mediaRoot: f.sourceDir, media };
}

async function fixtureMedia(f, snapshot, data, stem = 'asset') {
  const entry = addAsset(snapshot, stem, data);
  await fs.writeFile(path.join(f.sourceDir, entry.relativePath), data);
  return entry;
}

test('encrypted package round-trips an explicit schema 025 snapshot and multi-frame media', async (t) => {
  const f = await fixture(t);
  const snapshot = seed();
  const mediaBytes = Buffer.alloc(MiB + 137, 0x76);
  Buffer.from('synthetic binary marker').copy(mediaBytes);
  const entry = await fixtureMedia(f, snapshot, mediaBytes);
  addAsset(snapshot, 'absent', Buffer.from('not explicitly supplied'));
  addAsset(snapshot, 'missing', Buffer.from('indexed unavailable'), 'unavailable');
  await fs.writeFile(path.join(f.sourceDir, 'default', 'ignored-file'), 'unlisted content remains separate');

  const { path: source, manifest, sizeBytes } = await writeDevicePackage(options(f, snapshot, [entry]));
  const encrypted = await fs.readFile(source);
  assert.equal(encrypted.length, sizeBytes);
  assert.equal(encrypted.subarray(0, 8).toString(), 'ZKDEVICE');
  for (const string of [snapshot.crm.customers[0].name, PASSWORD, 'synthetic binary marker', entry.relativePath]) {
    assert.equal(encrypted.includes(string), false);
  }
  assert.equal(manifest.coverage.status, 'partial');
  assert.deepEqual(manifest.coverage.media, { included: 1, missingReady: 1, otherIndexed: 1 });
  assert.ok(manifest.coverage.omittedDomains.includes('022-authoritative-customer-group-memberships'));
  assert.ok(manifest.coverage.omittedDomains.includes('023-group-manager-messages-receipts-and-audit'));
  assert.ok(manifest.coverage.omittedDomains.includes('024-ai-jobs-evidence-and-crm-review'));
  assert.deepEqual(manifest.coverage.wsSections, [{ accountId: 'default', sections: ['conversations', 'mediaAssets'] }]);

  const unpacked = await unpackDevicePackage({ source, password: PASSWORD, stagingParent: f.stage });
  assert.equal(path.dirname(unpacked.directory), f.stage);
  assert.deepEqual(unpacked.manifest, manifest);
  assert.deepEqual(JSON.parse(await fs.readFile(unpacked.snapshotPath, 'utf8')), snapshot);
  assert.equal(unpacked.media.length, 1);
  assert.equal(path.dirname(unpacked.media[0].path), path.join(unpacked.directory, 'media'));
  assert.match(path.basename(unpacked.media[0].path), /^[a-f0-9]{64}\.bin$/);
  assert.deepEqual(await fs.readFile(unpacked.media[0].path), mediaBytes);
  await assertPrivateStaging(unpacked.directory, [unpacked.snapshotPath, path.dirname(unpacked.media[0].path), unpacked.media[0].path]);
  assert.equal(await fs.readFile(path.join(f.stage, 'unchanged.txt'), 'utf8'), 'existing local data');

  const second = await writeDevicePackage(options(f, snapshot, [entry], 'other'));
  const again = await fs.readFile(second.path);
  assert.notDeepEqual(encrypted.subarray(9, 25), again.subarray(9, 25));
  assert.notDeepEqual(encrypted.subarray(25, 33), again.subarray(25, 33));
  assert.notDeepEqual(encrypted, again);
});

test('wrong password, corrupt header or tags, truncation and trailing bytes preserve staging', async (t) => {
  const f = await fixture(t);
  const snapshot = seed();
  const entry = await fixtureMedia(f, snapshot, Buffer.alloc(2 * MiB + 41, 3));
  const { path: source } = await writeDevicePackage(options(f, snapshot, [entry]));
  const original = await fs.readFile(source);
  await assert.rejects(unpackDevicePackage({ source, password: 'wrong password', stagingParent: f.stage }),
    { code: 'AUTHENTICATION' });
  await f.assertUnchanged();

  const wrongHeader = Buffer.from(original);
  wrongHeader[0] ^= 1;
  const wrongVersion = Buffer.from(original);
  wrongVersion[8] += 1;
  const firstTag = Buffer.from(original);
  const length = firstTag.readUInt32BE(33);
  firstTag[33 + 4 + length + 1] ^= 1;
  const lateMediaTag = Buffer.from(original);
  lateMediaTag[lateMediaTag.length - 1] ^= 1;
  const swappedMediaFrames = Buffer.from(original);
  const firstMediaFrame = 33 + length + 20 + bytes(snapshot).length + 20;
  const nextMediaFrame = firstMediaFrame + MiB + 20;
  original.copy(swappedMediaFrames, firstMediaFrame, nextMediaFrame, nextMediaFrame + MiB + 20);
  original.copy(swappedMediaFrames, nextMediaFrame, firstMediaFrame, nextMediaFrame);
  const overlong = Buffer.from(original);
  overlong.writeUInt32BE(MiB + 1, 33);
  for (const [name, payload, code] of [
    ['header', wrongHeader, 'FORMAT'], ['version', wrongVersion, 'FORMAT'],
    ['manifest-tag', firstTag, 'AUTHENTICATION'], ['last-media-tag', lateMediaTag, 'AUTHENTICATION'],
    ['swapped-media-frames', swappedMediaFrames, 'AUTHENTICATION'],
    ['truncated-header', original.subarray(0, 6), 'TRUNCATED'],
    ['truncated-tail', original.subarray(0, -1), 'FORMAT'],
    ['extended', Buffer.concat([original, Buffer.from('trailing')]), 'FORMAT'],
    ['overlong-frame', overlong, 'LIMIT'],
  ]) {
    const file = f.out(name);
    await fs.writeFile(file, payload);
    await assert.rejects(unpackDevicePackage({ source: file, password: PASSWORD, stagingParent: f.stage }), { code });
    await f.assertUnchanged();
    assert.deepEqual(await fs.readFile(file), payload);
  }
});

// Build a valid authenticated fixture independently to exercise semantic
// validation after successful GCM verification.
function sealedFixture(snapshot, manifest) {
  const salt = Buffer.alloc(16, 8);
  const noncePrefix = Buffer.alloc(8, 15);
  const header = Buffer.concat([Buffer.from('ZKDEVICE'), Buffer.from([1]), salt, noncePrefix]);
  const key = scryptSync(PASSWORD, salt, 32, { N: 65536, r: 8, p: 1, maxmem: 96 * MiB });
  try {
    const frames = [bytes(manifest), bytes(snapshot)].map((plain, index) => {
      const suffix = Buffer.alloc(4);
      suffix.writeUInt32BE(index);
      const size = Buffer.alloc(4);
      size.writeUInt32BE(plain.length);
      const cipher = createCipheriv('aes-256-gcm', key, Buffer.concat([noncePrefix, suffix]), { authTagLength: 16 });
      cipher.setAAD(Buffer.concat([header, suffix, size]));
      return Buffer.concat([size, cipher.update(plain), cipher.final(), cipher.getAuthTag()]);
    });
    return Buffer.concat([header, ...frames]);
  } finally {
    key.fill(0);
  }
}

test('valid GCM cannot override scope, coverage, duplicate checks or entry digests', async (t) => {
  const f = await fixture(t);
  const snapshot = seed();
  const original = await writeDevicePackage(options(f, snapshot));
  const asset = { accountId: 'default', id: 'wsm-fixture-0011223344', sizeBytes: 0, sha256: hash(Buffer.alloc(0)) };
  const forbidden = seed();
  forbidden.crm.customers[0].details = [{ clientSecret: 'synthetic test marker' }];
  const data = [
    ['false-complete', snapshot, { ...original.manifest, coverage: { status: 'complete' } }, 'FORMAT'],
    ['false-coverage', snapshot, { ...original.manifest, coverage: { ...original.manifest.coverage, omittedDomains: [] } }, 'FORMAT'],
    ['wrong-digest', snapshot, { ...original.manifest, snapshot: { ...original.manifest.snapshot, sha256: '0'.repeat(64) } }, 'DIGEST'],
    ['duplicate-entries', snapshot, { ...original.manifest, media: [asset, asset] }, 'DUPLICATE'],
    ['archive-path', snapshot, { ...original.manifest, media: [{ ...asset, path: '../../must-not-write' }] }, 'MEDIA'],
    ['unowned-asset', snapshot, { ...original.manifest, media: [asset] }, 'MEDIA'],
    ['private-snapshot', forbidden, { ...original.manifest, snapshot: { sizeBytes: bytes(forbidden).length, sha256: hash(bytes(forbidden)) } }, 'PRIVATE_DATA'],
  ];
  for (const [name, model, manifest, code] of data) {
    const source = f.out(name);
    await fs.writeFile(source, sealedFixture(model, manifest));
    await assert.rejects(unpackDevicePackage({ source, password: PASSWORD, stagingParent: f.stage }), { code });
    await f.assertUnchanged();
  }
});

test('source allowlist, account boundaries and size checks reject before creating a package', async (t) => {
  const f = await fixture(t);
  const clean = seed();
  const entry = await fixtureMedia(f, clean, Buffer.from('explicit media'));
  const outside = { ...entry, relativePath: '../outside' };
  const absolute = { ...entry, relativePath: f.out('other') };
  const alternateStream = { ...entry, relativePath: entry.relativePath + ':secret' };
  const oversized = seed();
  oversized.crm.settings.example = 'x'.repeat(32 * MiB + 1);
  const sameScope = seed();
  sameScope.wsAccounts.Default = {};
  const cross = seed();
  cross.wsAccounts.default.conversations[0].accountId = 'other';
  const hiddenSerializer = seed();
  Object.defineProperty(hiddenSerializer.crm.settings, 'toJSON', { value: () => ({ apiKey: 'synthetic test marker' }) });
  const privateFields = seed();
  privateFields.crm.settings.webViewProfilePath = 'synthetic forbidden profile';
  for (const [input, media, code] of [
    [clean, [outside], 'PATH'], [clean, [absolute], 'PATH'],
    [clean, [alternateStream], 'PATH'], [clean, [entry, entry], 'DUPLICATE'],
    [oversized, [], 'LIMIT'], [sameScope, [], 'SNAPSHOT'], [cross, [], 'SNAPSHOT'],
    [privateFields, [], 'PRIVATE_DATA'], [hiddenSerializer, [], 'SNAPSHOT'],
  ]) {
    await assert.rejects(writeDevicePackage(options(f, input, media)), { code });
    await assert.rejects(fs.stat(f.out('package')), { code: 'ENOENT' });
  }
  const bigMedia = seed();
  await assert.rejects(writeDevicePackage(options(f, bigMedia, [addAsset(bigMedia, 'big', MAX_MEDIA + 1)])), { code: 'LIMIT' });
  const bigArchive = seed();
  const tooManyBytes = Array.from({ length: 86 }, (_, index) => addAsset(bigArchive, 'bulk' + index, MAX_MEDIA));
  await assert.rejects(writeDevicePackage(options(f, bigArchive, tooManyBytes)), { code: 'LIMIT' });
  await assert.rejects(fs.stat(f.out('package')), { code: 'ENOENT' });
});

test('linked file or directory and changed media cannot redirect input or leave a partial package', async (t) => {
  const f = await fixture(t);
  const snapshot = seed();
  const entry = await fixtureMedia(f, snapshot, Buffer.from('original'));
  const mediaPath = path.join(f.sourceDir, entry.relativePath);
  const linked = path.join(f.root, 'linked');
  await fs.symlink(f.sourceDir, linked, process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(writeDevicePackage({ ...options(f, snapshot, [entry]), mediaRoot: linked }), { code: 'PATH' });
  const extraLink = path.join(f.root, 'hardlink');
  await fs.link(mediaPath, extraLink);
  await assert.rejects(writeDevicePackage(options(f, snapshot, [entry])), { code: 'PATH' });
  await fs.unlink(extraLink);
  await fs.writeFile(mediaPath, 'modified');
  await assert.rejects(writeDevicePackage(options(f, snapshot, [entry])), { code: 'DIGEST' });
  await assert.rejects(fs.stat(f.out('package')), { code: 'ENOENT' });
  assert.equal(await fs.readFile(mediaPath, 'utf8'), 'modified');
});

test('exclusive publication never replaces an existing package, and staging rejects junctions', async (t) => {
  const f = await fixture(t);
  const pathname = f.out('existing');
  await fs.writeFile(pathname, 'keep this existing file');
  await assert.rejects(writeDevicePackage(options(f, seed(), [], 'existing')), { code: 'EEXIST' });
  assert.equal(await fs.readFile(pathname, 'utf8'), 'keep this existing file');

  const linked = path.join(f.root, 'linked-stage');
  await fs.symlink(f.stage, linked, process.platform === 'win32' ? 'junction' : 'dir');
  const produced = await writeDevicePackage(options(f));
  await assert.rejects(unpackDevicePackage({ source: produced.path, password: PASSWORD, stagingParent: linked }), { code: 'PATH' });
  await f.assertUnchanged();

  const races = await Promise.allSettled([
    writeDevicePackage(options(f, seed(), [], 'raced')),
    writeDevicePackage(options(f, seed(), [], 'raced')),
  ]);
  assert.equal(races.filter((result) => result.status === 'fulfilled').length, 1);
  assert.equal(races.find((result) => result.status === 'rejected').reason.code, 'EEXIST');
  const restored = await unpackDevicePackage({ source: f.out('raced'), password: PASSWORD, stagingParent: f.stage });
  assert.deepEqual(JSON.parse(await fs.readFile(restored.snapshotPath, 'utf8')), seed());
});

test('media coverage stays partial with a legacy snapshot that has no indexed media section', async (t) => {
  const f = await fixture(t);
  const oldSnapshot = seed();
  delete oldSnapshot.wsAccounts.default.mediaAssets;
  oldSnapshot.wsAccounts['token-business'] = {
    analyses: [{ accountId: 'token-business', result: { usage: { input_tokens: 7, totalTokens: 12 } } }],
  };
  const { path: source, manifest } = await writeDevicePackage(options(f, oldSnapshot));
  assert.equal(manifest.coverage.status, 'partial');
  assert.deepEqual(manifest.coverage.media, { included: 0, missingReady: 0, otherIndexed: 0 });
  assert.deepEqual(manifest.coverage.wsSections[0], { accountId: 'default', sections: ['conversations'] });
  const unpacked = await unpackDevicePackage({ source, password: PASSWORD, stagingParent: f.stage });
  assert.equal(unpacked.manifest.coverage.status, 'partial');
  assert.deepEqual(await fs.readdir(unpacked.directory), ['snapshot.json']);
  assert.deepEqual(JSON.parse(await fs.readFile(unpacked.snapshotPath, 'utf8')), oldSnapshot);
});

test('nested credential aliases fail closed without treating numeric usage as a credential', async (t) => {
  const f = await fixture(t);
  for (const key of ['authToken', 'clientSecret', 'authorizationHeaders', 'x-zhike-token', 'ＳｅｓｓｉｏｎＴｏｋｅｎ', 'totalTokens']) {
    const snapshot = seed();
    snapshot.crm.customers[0].metadata = { nested: [{ [key]: 'synthetic blocked test value' }] };
    await assert.rejects(writeDevicePackage(options(f, snapshot)), { code: 'PRIVATE_DATA' });
    await assert.rejects(fs.stat(f.out('package')), { code: 'ENOENT' });
  }
});

test('a replaced publication path cannot succeed or delete the replacement', async (t) => {
  const f = await fixture(t);
  const open = fs.open;
  const destination = f.out('owned');
  const moved = f.out('moved-original');
  const replacement = 'separately created existing data';
  t.mock.method(fs, 'open', async (pathname, ...args) => {
    const file = await open(pathname, ...args);
    if (pathname === destination && args[0] === 'wx') {
      await fs.rename(destination, moved);
      await fs.writeFile(destination, replacement, { flag: 'wx' });
    }
    return file;
  });
  await assert.rejects(writeDevicePackage(options(f, seed(), [], 'owned')), { code: 'PATH', cleanupPending: true });
  assert.equal(await fs.readFile(destination, 'utf8'), replacement);
  assert.equal((await fs.stat(moved)).size, 0, 'no package bytes were written before the ownership check');
});

test('a late staging-path change preserves other data and prevents a successful import result', async (t) => {
  const f = await fixture(t);
  const exported = await writeDevicePackage(options(f));
  const open = fs.open;
  const replacement = 'unrelated replacement data';
  let replaced;
  t.mock.method(fs, 'open', async (pathname, ...args) => {
    const file = await open(pathname, ...args);
    if (path.basename(pathname) === 'snapshot.json' && args[0] === 'wx') {
      const sync = file.sync.bind(file);
      file.sync = async () => {
        await sync();
        await fs.rename(pathname, pathname + '.moved');
        await fs.writeFile(pathname, replacement, { flag: 'wx' });
        replaced = pathname;
      };
    }
    return file;
  });
  await assert.rejects(unpackDevicePackage({ source: exported.path, password: PASSWORD, stagingParent: f.stage }),
    { code: 'PATH', cleanupPending: true });
  assert.ok(replaced);
  assert.equal(await fs.readFile(replaced, 'utf8'), replacement);
  assert.equal(await fs.readFile(path.join(f.stage, 'unchanged.txt'), 'utf8'), 'existing local data');
});

async function loadDevicePackageWithFaults(fileOperations) {
  const filename = require.resolve('../resources/app/device-migration-package.cjs');
  const localRequire = require('node:module').createRequire(filename);
  const { EventEmitter } = require('node:events');
  // Only these fault-injection tests simulate the Windows path check so the
  // isolated fixture requires no external PowerShell process.
  const spawn = () => {
    const child = new EventEmitter();
    child.stdin = new EventEmitter();
    child.stdin.end = () => queueMicrotask(() => child.emit('close', 0, null));
    return child;
  };
  const evaluate = require('node:vm').compileFunction(await fs.readFile(filename, 'utf8'), ['require', 'module'], { filename });
  const loaded = { exports: {} };
  evaluate((name) => {
    if (name === 'node:fs/promises') return { ...fs, ...fileOperations };
    if (name === 'node:child_process') return { spawn };
    return localRequire(name);
  }, loaded);
  return loaded.exports;
}

test('a failure identifying a newly created destination reports pending cleanup and preserves it', async (t) => {
  const f = await fixture(t);
  const destination = f.out('unidentified');
  const createdError = Object.assign(new Error('controlled destination stat failure'), { code: 'EIO' });
  const created = await loadDevicePackageWithFaults({
    async open(pathname, ...args) {
      const file = await fs.open(pathname, ...args);
      if (pathname === destination && args[0] === 'wx') {
        file.stat = async () => { throw createdError; };
      }
      return file;
    },
  });
  const request = options(f, seed(), [], 'unidentified');
  await assert.rejects(created.writeDevicePackage(request), { code: 'EIO', cleanupPending: true });
  assert.equal((await fs.stat(destination)).size, 0);
  await assert.rejects(created.writeDevicePackage(request), { code: 'EEXIST' });
});

test('a failure identifying a newly created staging directory reports pending cleanup and preserves it', async (t) => {
  const f = await fixture(t);
  let allocated;
  const createdError = Object.assign(new Error('controlled staging lstat failure'), { code: 'EIO' });
  const created = await loadDevicePackageWithFaults({
    async mkdtemp(...args) {
      allocated = await fs.mkdtemp(...args);
      return allocated;
    },
    async lstat(pathname, ...args) {
      if (pathname === allocated) throw createdError;
      return fs.lstat(pathname, ...args);
    },
  });
  const { path: source } = await created.writeDevicePackage(options(f));
  await assert.rejects(created.unpackDevicePackage({ source, password: PASSWORD, stagingParent: f.stage }),
    { code: 'EIO', cleanupPending: true });
  assert.equal(path.dirname(allocated), f.stage);
  assert.deepEqual(await fs.readdir(allocated), []);
  assert.equal(await fs.readFile(path.join(f.stage, 'unchanged.txt'), 'utf8'), 'existing local data');
});
