'use strict';

const { constants } = require('node:fs');
const fs = require('node:fs/promises');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { promisify } = require('node:util');
const { createCipheriv, createDecipheriv, createHash, randomBytes, scrypt } = require('node:crypto');
const { MAX_BYTES: MAX_MEDIA_BYTES } = require('./modules/ws-media-core.js');

/*
 * Portable package v1 wraps an explicit schema-025 snapshot DTO: CRM state,
 * account-keyed WS export sections and optional display-only account metadata.
 * The caller supplies a separate list of ready media assets with the expected
 * identity, local relative storage path, size and SHA-256.
 *
 * The envelope has a fixed magic/version/salt/nonce-prefix header, followed
 * by GCM frames in manifest, snapshot, then media order. No paths from the
 * envelope are evaluated during unpack. This module leaves a validated
 * staging directory for the caller without applying the snapshot.
 * The caller controls the output and staging parent directories. Filesystem
 * identity checks cannot serialize independent writers with equal OS access.
 */
const MAGIC = Buffer.from('ZKDEVICE', 'ascii');
const FORMAT_VERSION = 1;
const SCHEMA_VERSION = 25;
const SALT_BYTES = 16;
const NONCE_PREFIX_BYTES = 8;
const TAG_BYTES = 16;
const SALT_OFFSET = MAGIC.length + 1;
const NONCE_OFFSET = SALT_OFFSET + SALT_BYTES;
const HEADER_BYTES = NONCE_OFFSET + NONCE_PREFIX_BYTES;
const CHUNK_BYTES = 1024 * 1024;
const MAX_MANIFEST_BYTES = CHUNK_BYTES;
const MAX_SNAPSHOT_BYTES = 32 * CHUNK_BYTES;
const MAX_PACKAGE_BYTES = 2 * 1024 * CHUNK_BYTES;
const MAX_MEDIA_COUNT = 4096;
const MAX_ACCOUNT_COUNT = 256;
const FRAME_OVERHEAD = 4 + TAG_BYTES;
const KDF_OPTIONS = Object.freeze({ N: 65536, r: 8, p: 1, maxmem: 96 * CHUNK_BYTES });
const derive = promisify(scrypt);
const decode = new TextDecoder('utf-8', { fatal: true });
const lower = (value) => value.toLowerCase();

const CRM_ARRAYS = Object.freeze([
  'customers', 'savedViews', 'activities', 'tickets', 'deposits', 'followups', 'registrations', 'phoneRegistry',
  'batchOperations', 'channelAliases', 'importIssues', 'qualityDecisions',
]);
const WS_ARRAYS = Object.freeze([
  'settings', 'conversations', 'messages', 'analyses', 'replies', 'batches', 'collectionRuns', 'collectionItems',
  'followupAlerts', 'sendAudit', 'mediaAssets', 'groups', 'groupMembershipEvents', 'contacts',
]);
// The v1 input is a caller-supplied projection, not a synchronized database snapshot.
const OMITTED_DOMAINS = Object.freeze([
  'account-and-workspace-consistency-snapshot', '022-authoritative-customer-group-memberships',
  '023-group-manager-messages-receipts-and-audit', '024-ai-jobs-evidence-and-crm-review',
  'full-durable-task-queues-and-audit', 'group-reading-rules-and-history', 'credentials-and-login-profiles',
]);
const PRIVATE_FIELD = /password|passphrase|secret|token|credential|cookie|apikey|authorization|authheader|privatekey|webviewprofile|browserprofile|loginprofile|sessionprofile|profilepath|profiledirectory|loginstate|authstate|dpapi|connectionprivate|indexeddb|localstorage|sessionstorage|serviceworker/;
const SAFE_TOKEN_COUNTERS = new Set([
  'maxtokens', 'inputtokens', 'outputtokens', 'prompttokens', 'completiontokens', 'totaltokens', 'cachedtokens', 'reasoningtokens',
]);
const UNSAFE_KEY = /^(?:__proto__|prototype|constructor)$/;
const WIN_DEVICE_NAME = /^(?:con|prn|aux|nul|com[1-9\u00b9\u00b2\u00b3]|lpt[1-9\u00b9\u00b2\u00b3])(?:\.|$)/i;
const SHA256 = /^[a-f0-9]{64}$/;
const MEDIA_ID = /^wsm-[a-z0-9]+-[a-f0-9]{10}$/;
let activeDerivations = 0;

function check(condition, code, message) {
  if (!condition) throw Object.assign(new Error(message), { code });
}
function isRecord(value) {
  return value !== null && typeof value === 'object' &&
    [Object.prototype, null].includes(Object.getPrototypeOf(value));
}
function exactKeys(value, names, required = names) {
  return isRecord(value) && Object.keys(value).every((key) => names.includes(key)) &&
    required.every((key) => Object.hasOwn(value, key));
}
function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}
function jsonBytes(value) {
  return Buffer.from(JSON.stringify(value), 'utf8');
}
function jsonValue(bytes, code) {
  try {
    const result = JSON.parse(decode.decode(bytes));
    // The compact canonical encoding also rejects duplicate JSON object keys.
    check(jsonBytes(result).equals(bytes), code, 'Package JSON is not canonical.');
    return result;
  } catch {
    throw Object.assign(new Error('Invalid package JSON.'), { code });
  }
}

function validateSnapshotJson(value) {
  let bytes = 0;
  const ancestors = new Set();
  function add(text) {
    bytes += Buffer.byteLength(text);
    check(bytes <= MAX_SNAPSHOT_BYTES, 'LIMIT', 'Business snapshot exceeds the package limit.');
  }
  function visit(item, depth, accountIdKeys = false) {
    check(depth <= 64, 'LIMIT', 'Business snapshot is nested too deeply.');
    if (item === null || typeof item === 'boolean' || Number.isFinite(item) || typeof item === 'string') {
      if (typeof item === 'string') {
        check(Buffer.byteLength(item) <= MAX_SNAPSHOT_BYTES - bytes, 'LIMIT', 'Business snapshot exceeds the package limit.');
      }
      add(JSON.stringify(item));
      return;
    }
    check(Array.isArray(item) || isRecord(item), 'SNAPSHOT', 'Business snapshot must contain JSON data only.');
    check(!ancestors.has(item), 'SNAPSHOT', 'Business snapshot contains a cycle.');
    ancestors.add(item);
    const array = Array.isArray(item);
    add(array ? '[' : '{');
    const keys = Object.keys(item);
    check(Object.getOwnPropertyNames(item).length === keys.length + Number(array) &&
      Object.getOwnPropertySymbols(item).length === 0 && !Object.hasOwn(item, 'toJSON'),
      'SNAPSHOT', 'Business snapshot must not contain hidden properties or custom serialization.');
    check(!array || (item.length === keys.length && keys.every((key, index) => key === String(index))),
      'SNAPSHOT', 'Arrays must be dense and contain no extra properties.');
    for (const [index, key] of keys.entries()) {
      if (index) add(',');
      const property = Object.getOwnPropertyDescriptor(item, key);
      check(Object.hasOwn(property, 'value'), 'SNAPSHOT', 'Business snapshot must not contain accessors.');
      if (!array) {
        check(Buffer.byteLength(key) <= MAX_SNAPSHOT_BYTES - bytes, 'LIMIT', 'Business snapshot exceeds the package limit.');
        const normalizedKey = key.normalize('NFKC').replace(/[^a-z0-9]/gi, '').toLowerCase();
        const numericCounter = SAFE_TOKEN_COUNTERS.has(normalizedKey) &&
          Number.isSafeInteger(property.value) && property.value >= 0;
        check(!UNSAFE_KEY.test(key) && (accountIdKeys || !PRIVATE_FIELD.test(normalizedKey) || numericCounter),
          'PRIVATE_DATA', 'Business snapshot contains a forbidden credential or profile field.');
        add(JSON.stringify(key));
        add(':');
      }
      visit(property.value, depth + 1, depth === 0 && key === 'wsAccounts');
    }
    add(array ? ']' : '}');
    ancestors.delete(item);
  }
  visit(value, 0);
}

function validAccountId(id) {
  return typeof id === 'string' && id.length > 0 && id.length <= 120 &&
    id.trim() === id && !/[\u0000-\u001f\u007f]/.test(id) && !UNSAFE_KEY.test(id);
}

function inspectSnapshot(snapshot) {
  validateSnapshotJson(snapshot);
  check(exactKeys(snapshot, ['schemaVersion', 'crm', 'wsAccounts', 'wsAccountMetadata'], ['schemaVersion', 'crm', 'wsAccounts']) &&
    snapshot.schemaVersion === SCHEMA_VERSION, 'SNAPSHOT', 'Expected a schema 025 business snapshot.');
  check(exactKeys(snapshot.crm, ['schemaVersion', 'settings', ...CRM_ARRAYS], ['customers']) &&
    (snapshot.crm.schemaVersion === undefined || snapshot.crm.schemaVersion === 4) &&
    (snapshot.crm.settings === undefined || isRecord(snapshot.crm.settings)) &&
    CRM_ARRAYS.every((section) => !Object.hasOwn(snapshot.crm, section) || Array.isArray(snapshot.crm[section])),
    'SNAPSHOT', 'Invalid CRM snapshot sections.');
  check(isRecord(snapshot.wsAccounts), 'SNAPSHOT', 'Expected an account-keyed WS snapshot.');
  const accountIds = Object.keys(snapshot.wsAccounts);
  check(accountIds.length <= MAX_ACCOUNT_COUNT, 'LIMIT', 'Too many WS accounts in the snapshot.');
  check(accountIds.every(validAccountId) && new Set(accountIds.map(lower)).size === accountIds.length,
    'SNAPSHOT', 'Duplicate or invalid WS account identifier.');
  if (snapshot.wsAccountMetadata !== undefined) {
    check(Array.isArray(snapshot.wsAccountMetadata), 'SNAPSHOT', 'Invalid WS account metadata.');
    const listed = new Set();
    for (const row of snapshot.wsAccountMetadata) {
      check(exactKeys(row, ['id', 'displayName'], ['id']) && accountIds.includes(row.id) &&
        !listed.has(row.id) && (row.displayName === undefined || typeof row.displayName === 'string'),
        'SNAPSHOT', 'Invalid or duplicate WS account metadata.');
      listed.add(row.id);
    }
  }
  const assets = new Map();
  for (const accountId of accountIds) {
    const account = snapshot.wsAccounts[accountId];
    check(exactKeys(account, ['schemaVersion', ...WS_ARRAYS], []) &&
      (account.schemaVersion === undefined || account.schemaVersion === 6) &&
      WS_ARRAYS.every((section) => !Object.hasOwn(account, section) || Array.isArray(account[section])),
      'SNAPSHOT', 'Invalid WS snapshot sections.');
    for (const section of WS_ARRAYS) {
      for (const row of account[section] || []) {
        check(isRecord(row) && (!Object.hasOwn(row, 'accountId') || row.accountId === accountId),
          'SNAPSHOT', 'A WS snapshot row belongs to a different account.');
      }
    }
    for (const asset of account.mediaAssets || []) {
      const key = mediaKey(accountId, asset.id);
      check(typeof asset.id === 'string' && asset.id.length > 0 && asset.id.length <= 160 &&
        (asset.mediaId === undefined || asset.mediaId === asset.id) && !assets.has(key),
        'SNAPSHOT', 'Invalid or duplicate snapshot media identifier.');
      assets.set(key, asset);
    }
  }
  return assets;
}

function mediaKey(accountId, id) {
  return JSON.stringify([accountId, id]);
}
function stagedMediaName(accountId, id) {
  return sha256(Buffer.from(mediaKey(accountId, id), 'utf8')) + '.bin';
}
function inspectMedia(media, assets, withPaths) {
  check(Array.isArray(media) && media.length <= MAX_MEDIA_COUNT, 'LIMIT', 'Invalid media list or too many media files.');
  const seen = new Set();
  const allowed = withPaths ? ['accountId', 'id', 'relativePath', 'sizeBytes', 'sha256'] : ['accountId', 'id', 'sizeBytes', 'sha256'];
  for (const entry of media) {
    check(exactKeys(entry, allowed) && validAccountId(entry.accountId) && typeof entry.id === 'string' && MEDIA_ID.test(entry.id),
      'MEDIA', 'Invalid media manifest entry.');
    check(Number.isSafeInteger(entry.sizeBytes) && entry.sizeBytes >= 0 && entry.sizeBytes <= MAX_MEDIA_BYTES,
      'LIMIT', 'Media exceeds the local single-file size limit.');
    check(typeof entry.sha256 === 'string' && SHA256.test(entry.sha256), 'MEDIA', 'Invalid media SHA-256.');
    const key = mediaKey(entry.accountId, entry.id);
    check(!seen.has(key), 'DUPLICATE', 'Duplicate media in the package.');
    seen.add(key);
    if (withPaths) {
      const directory = entry.accountId.replace(/[^A-Za-z0-9._:-]/g, '_');
      check(safeSegment(directory) && typeof entry.relativePath === 'string' &&
        entry.relativePath.replaceAll('\\', '/') === directory + '/' + entry.id,
        'PATH', 'Media file must be its declared account storage entry.');
    }
    if (assets) {
      const row = assets.get(key);
      check(row?.status === 'ready' && row.sizeBytes === entry.sizeBytes && row.sha256 === entry.sha256, 'MEDIA',
        'Media bytes must match a ready asset in the scoped snapshot.');
    }
  }
}

function coverageFor(snapshot, assets, media) {
  const readyAssets = [...assets.values()].filter((row) => row.status === 'ready').length;
  return {
    status: 'partial',
    crmSections: ['settings', ...CRM_ARRAYS].filter((section) => Object.hasOwn(snapshot.crm, section)),
    wsSections: Object.entries(snapshot.wsAccounts).map(([accountId, account]) => ({
      accountId, sections: WS_ARRAYS.filter((section) => Object.hasOwn(account, section)),
    })),
    media: { included: media.length, missingReady: readyAssets - media.length, otherIndexed: assets.size - readyAssets },
    omittedDomains: OMITTED_DOMAINS,
  };
}

function safeSegment(part) {
  return part && part !== '.' && part !== '..' && !/[\u0000-\u001f<>:"|?*\\/]/.test(part) &&
    !/[. ]$/.test(part) && !WIN_DEVICE_NAME.test(part);
}
function checkedAbsolute(candidate, extension) {
  check(typeof candidate === 'string' && path.isAbsolute(candidate), 'PATH', 'An absolute local path is required.');
  const normalized = path.resolve(candidate);
  const root = path.parse(normalized).root;
  check(process.platform !== 'win32' || /^[A-Za-z]:\\$/.test(root), 'PATH', 'A local drive path is required.');
  const providedRoot = path.parse(candidate).root;
  check(candidate.slice(providedRoot.length).split(/[\\/]/).every((part) => part !== '.' && part !== '..') &&
    normalized.slice(root.length).split(path.sep).filter(Boolean).every(safeSegment),
    'PATH', 'Invalid absolute path component.');
  check(!extension || path.extname(normalized).toLowerCase() === extension, 'PATH', 'Expected a .zkdevice file.');
  return normalized;
}

function ancestorsOf(file) {
  const nodes = [];
  let current = file;
  while (path.dirname(current) !== current) {
    nodes.unshift(current);
    current = path.dirname(current);
  }
  return [current, ...nodes];
}

const WINDOW_ATTRIBUTES = [
  "$ErrorActionPreference = 'Stop'",
  '$bytes = [Convert]::FromBase64String([Console]::In.ReadToEnd())',
  '$request = [Text.Encoding]::UTF8.GetString($bytes) | ConvertFrom-Json',
  'foreach ($item in $request.paths) { if ([IO.File]::GetAttributes($item) -band [IO.FileAttributes]::ReparsePoint) { exit 2 } }',
  'if ($request.privateStage) {',
  '  $sid = [Security.Principal.WindowsIdentity]::GetCurrent().User',
  '  $acl = New-Object Security.AccessControl.DirectorySecurity',
  '  $acl.SetAccessRuleProtection($true, $false)',
  '  $rule = [Security.AccessControl.FileSystemAccessRule]::new($sid, "FullControl", "ContainerInherit,ObjectInherit", "None", "Allow")',
  '  $acl.AddAccessRule($rule)',
  '  [IO.Directory]::SetAccessControl($request.privateStage, $acl)',
  '}',
  'if ($request.verifyPrivate) {',
  '  $sid = [Security.Principal.WindowsIdentity]::GetCurrent().User',
  '  $acl = [IO.Directory]::GetAccessControl($request.verifyPrivate)',
  '  $rules = @($acl.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier]))',
  '  if (!$acl.AreAccessRulesProtected -or $rules.Count -ne 1 -or $rules[0].IdentityReference -ne $sid -or $rules[0].AccessControlType -ne "Allow" -or $rules[0].FileSystemRights -ne "FullControl" -or $rules[0].InheritanceFlags -ne "ContainerInherit, ObjectInherit") { exit 3 }',
  '}',
  'exit 0',
].join('\n');

async function verifyWindowsPaths(paths, privateStage = null, verifyPrivate = null) {
  if (process.platform !== 'win32') return;
  const powershell = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe');
  const child = spawn(powershell, ['-NoProfile', '-NonInteractive', '-Command', WINDOW_ATTRIBUTES], {
    windowsHide: true, timeout: 15000, stdio: ['pipe', 'ignore', 'ignore'],
  });
  const closed = once(child, 'close');
  child.stdin.on('error', () => {});
  child.stdin.end(jsonBytes({ paths, privateStage, verifyPrivate }).toString('base64'), 'ascii');
  const [code] = await closed.catch(() => [-1]);
  check(code === 0, 'PATH', 'Windows path attributes or temporary-directory permissions could not be verified.');
}

async function verifyPrivateDirectory(directory, expected, initialize = false) {
  await verifyParent(directory, expected);
  if (process.platform === 'win32') {
    await verifyWindowsPaths(ancestorsOf(directory), initialize ? directory : null, directory);
  } else {
    check(expected.uid === BigInt(process.getuid()) && (expected.mode & 0o077n) === 0n,
      'PATH', 'Temporary directory must be private to the current user.');
  }
  await verifyParent(directory, expected);
}

async function verifyExisting(list) {
  const paths = [...new Set(list.flatMap(ancestorsOf))];
  const result = new Map();
  for (const pathname of paths) {
    const stat = await fs.lstat(pathname, { bigint: true });
    check(stat.isDirectory() || stat.isFile(), 'PATH', 'Links and special files are not allowed.');
    const real = await fs.realpath(pathname);
    const same = process.platform === 'win32' ? lower(real) === lower(pathname) : real === pathname;
    check(same, 'PATH', 'Paths must resolve without following links.');
    result.set(pathname, stat);
  }
  await verifyWindowsPaths(paths);
  return result;
}

function sameIdentity(a, b) {
  return a.dev === b.dev && a.ino !== 0n && a.ino === b.ino && a.birthtimeNs === b.birthtimeNs;
}
function sameFileRevision(expected, current) {
  return current.isFile() && current.nlink === 1n && sameIdentity(expected, current) &&
    current.size === expected.size && current.mtimeNs === expected.mtimeNs && current.ctimeNs === expected.ctimeNs;
}
async function openSource(pathname, expected) {
  check(expected?.isFile() && expected.nlink === 1n, 'PATH', 'Only regular, single-link input files are allowed.');
  const file = await fs.open(pathname, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
  try {
    const current = await file.stat({ bigint: true });
    check(sameFileRevision(expected, current), 'PATH', 'Input file changed during preparation.');
    return file;
  } catch (error) {
    await file.close();
    throw error;
  }
}
async function verifyOwned({ pathname, stat, parent }) {
  await verifyParent(path.dirname(pathname), parent);
  const current = await fs.lstat(pathname, { bigint: true });
  const sameKind = stat.isDirectory() ? current.isDirectory() : current.isFile() && current.nlink === 1n;
  check(sameKind && sameIdentity(stat, current), 'PATH', 'A package output path changed.');
}

function rememberCreatedPath(owned, pathname, parent) {
  const item = { pathname, parent, stat: null };
  owned.push(item);
  return item;
}

async function removeOwned(items, { requirePresent = false } = {}) {
  let complete = true;
  for (const item of items.reverse()) {
    // A successful allocation without an identity still needs cleanup, but
    // a later path lookup cannot tell whether the path still belongs to us.
    if (!item.stat) {
      complete = false;
      continue;
    }
    try {
      await verifyOwned(item);
      if (item.stat.isDirectory()) await fs.rmdir(item.pathname);
      else await fs.unlink(item.pathname);
    } catch (error) {
      // Cleanup never walks outside the list of resources this operation owns.
      if (requirePresent || error.code !== 'ENOENT') complete = false;
    }
  }
  return complete;
}

async function deriveKey(password, header) {
  check(typeof password === 'string' && password.length > 0 && Buffer.byteLength(password) <= 1024,
    'PASSWORD', 'A non-empty package password of at most 1024 UTF-8 bytes is required.');
  check(activeDerivations < 2, 'BUSY', 'Too many package password derivations are active.');
  const secret = Buffer.from(password, 'utf8');
  activeDerivations++;
  try {
    return await derive(secret, header.subarray(SALT_OFFSET, NONCE_OFFSET), 32, KDF_OPTIONS);
  } finally {
    activeDerivations--;
    secret.fill(0);
  }
}

// A frame carries its byte length, ciphertext and a 16-byte GCM tag. Its AAD
// commits to the header, its position and its length. The manifest determines
// the exact succeeding frame lengths and end of the stream.
function frameContext(state, length) {
  const index = Buffer.alloc(4);
  index.writeUInt32BE(state.index++);
  const size = Buffer.alloc(4);
  size.writeUInt32BE(length);
  return {
    size,
    aad: Buffer.concat([state.header, index, size]),
    nonce: Buffer.concat([state.header.subarray(NONCE_OFFSET), index]),
  };
}

async function writeAll(file, bytes) {
  for (let offset = 0; offset < bytes.length;) {
    const result = await file.write(bytes, offset, bytes.length - offset);
    check(result.bytesWritten > 0, 'WRITE', 'Package file write did not progress.');
    offset += result.bytesWritten;
  }
}

async function readExact(state, length) {
  check(state.offset + length <= state.size, 'TRUNCATED', 'Package is truncated.');
  const bytes = Buffer.alloc(length);
  for (let offset = 0; offset < length;) {
    const result = await state.file.read(bytes, offset, length - offset, state.offset);
    check(result.bytesRead > 0, 'TRUNCATED', 'Package is truncated.');
    offset += result.bytesRead;
    state.offset += result.bytesRead;
  }
  return bytes;
}

async function writeFrame(state, bytes) {
  const { size, aad, nonce } = frameContext(state, bytes.length);
  const cipher = createCipheriv('aes-256-gcm', state.key, nonce, { authTagLength: TAG_BYTES });
  cipher.setAAD(aad);
  const ciphertext = Buffer.concat([cipher.update(bytes), cipher.final()]);
  await writeAll(state.file, Buffer.concat([size, ciphertext, cipher.getAuthTag()]));
}

async function readFrameLength(state, maximum, expected) {
  const length = (await readExact(state, 4)).readUInt32BE();
  check(length > 0 && length <= maximum, 'LIMIT', 'Invalid package frame size.');
  check(expected === undefined || length === expected, 'FORMAT', 'Package frame length differs from its manifest.');
  check(state.offset + length + TAG_BYTES <= state.size, 'TRUNCATED', 'Package frame is truncated.');
  return length;
}

async function readFrameBody(state, length) {
  const ciphertext = await readExact(state, length);
  const tag = await readExact(state, TAG_BYTES);
  const { aad, nonce } = frameContext(state, length);
  const decipher = createDecipheriv('aes-256-gcm', state.key, nonce, { authTagLength: TAG_BYTES });
  decipher.setAAD(aad);
  decipher.setAuthTag(tag);
  try {
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  } catch {
    throw Object.assign(new Error('Package authentication failed. Check the password and file integrity.'), { code: 'AUTHENTICATION' });
  }
}

function wireBytes(manifestLength, snapshot, media) {
  const dataBytes = [snapshot, ...media].reduce((total, entry) =>
    total + entry.sizeBytes + Math.ceil(entry.sizeBytes / CHUNK_BYTES) * FRAME_OVERHEAD, 0);
  const bytes = HEADER_BYTES + FRAME_OVERHEAD + manifestLength + dataBytes;
  check(manifestLength <= MAX_MANIFEST_BYTES && bytes <= MAX_PACKAGE_BYTES, 'LIMIT', 'Package exceeds its size limit.');
  return bytes;
}

function validateManifest(manifest) {
  check(exactKeys(manifest, ['formatVersion', 'schemaVersion', 'snapshot', 'media', 'coverage']) &&
    manifest.formatVersion === FORMAT_VERSION && manifest.schemaVersion === SCHEMA_VERSION,
    'FORMAT', 'Unsupported package format or snapshot schema.');
  const { snapshot, media, coverage } = manifest;
  check(exactKeys(snapshot, ['sizeBytes', 'sha256']) && Number.isSafeInteger(snapshot.sizeBytes) &&
    snapshot.sizeBytes > 0 && snapshot.sizeBytes <= MAX_SNAPSHOT_BYTES &&
    typeof snapshot.sha256 === 'string' && SHA256.test(snapshot.sha256),
    'FORMAT', 'Invalid or oversized snapshot manifest entry.');
  check(isRecord(coverage) && coverage.status === 'partial', 'FORMAT', 'Unsupported package coverage.');
  inspectMedia(media, null, false);
}

async function readPayload(state, entry, receive) {
  const hash = createHash('sha256');
  for (let start = 0; start < entry.sizeBytes; start += CHUNK_BYTES) {
    const length = await readFrameLength(state, CHUNK_BYTES, Math.min(CHUNK_BYTES, entry.sizeBytes - start));
    const bytes = await readFrameBody(state, length);
    hash.update(bytes);
    await receive(bytes, start);
  }
  check(hash.digest('hex') === entry.sha256, 'DIGEST', 'Package entry digest does not match its manifest.');
}

async function verifyParent(name, expected) {
  const actual = await fs.lstat(name, { bigint: true });
  check(actual.isDirectory() && sameIdentity(actual, expected), 'PATH', 'A package parent directory changed.');
}

async function writeMedia(state, source, entry) {
  const file = await openSource(source.pathname, source.stat);
  try {
    const hash = createHash('sha256');
    const reader = { file, offset: 0, size: entry.sizeBytes };
    for (let start = 0; start < entry.sizeBytes; start += CHUNK_BYTES) {
      const bytes = await readExact(reader, Math.min(CHUNK_BYTES, entry.sizeBytes - start));
      hash.update(bytes);
      await writeFrame(state, bytes);
    }
    check(hash.digest('hex') === entry.sha256 && sameFileRevision(source.stat, await file.stat({ bigint: true })),
      'DIGEST', 'Media file changed or does not match its declared digest.');
  } finally {
    await file.close();
  }
}

const v1Envelope = Object.freeze({
  version: FORMAT_VERSION,
  inspectPayload: inspectSnapshot,
  validateManifest,
  payloadEntry: manifest => manifest.snapshot,
  describe(snapshot, assets, entry, media) {
    return {
      formatVersion: FORMAT_VERSION,
      schemaVersion: SCHEMA_VERSION,
      snapshot: entry,
      media,
      coverage: coverageFor(snapshot, assets, media),
    };
  },
  verifyClaims(snapshot, assets, manifest) {
    check(jsonBytes(manifest.coverage).equals(jsonBytes(coverageFor(snapshot, assets, manifest.media))), 'FORMAT',
      'Package coverage differs from its supplied data.');
  },
});

async function writePackageEnvelope({ destination, password, snapshot, mediaRoot, media = [] }, envelope) {
  const pathname = checkedAbsolute(destination, '.zkdevice');
  const parent = path.dirname(pathname);
  const assets = envelope.inspectPayload(snapshot);
  inspectMedia(media, assets, true);
  const snapshotBytes = jsonBytes(snapshot);
  const snapshotEntry = { sizeBytes: snapshotBytes.length, sha256: sha256(snapshotBytes) };
  const entries = media.map(({ accountId, id, sizeBytes, sha256 }) => ({ accountId, id, sizeBytes, sha256 }));
  const manifest = envelope.describe(snapshot, assets, snapshotEntry, entries);
  const manifestBytes = jsonBytes(manifest);
  const sizeBytes = wireBytes(manifestBytes.length, snapshotEntry, entries);
  const mediaRootPath = media.length ? checkedAbsolute(mediaRoot) : null;
  const sourceNames = media.map((entry) => path.join(mediaRootPath, ...entry.relativePath.replaceAll('\\', '/').split('/')));
  const uniquePaths = process.platform === 'win32' ? sourceNames.map(lower) : sourceNames;
  check(new Set(uniquePaths).size === sourceNames.length, 'DUPLICATE', 'Duplicate media source path.');
  const verified = await verifyExisting([parent, ...sourceNames]);
  check(verified.get(parent).isDirectory(), 'PATH', 'Package destination parent must be a directory.');
  const sources = sourceNames.map((name, index) => {
    const stat = verified.get(name);
    check(stat.isFile() && stat.nlink === 1n, 'PATH', 'Media must be a regular, single-link file.');
    check(stat.size === BigInt(entries[index].sizeBytes), 'DIGEST', 'Media size does not match the declared snapshot.');
    return { pathname: name, stat };
  });

  const header = Buffer.concat([MAGIC, Buffer.from([envelope.version]), randomBytes(SALT_BYTES + NONCE_PREFIX_BYTES)]);
  const key = await deriveKey(password, header);
  const owned = [];
  let file;
  try {
    const parentStat = verified.get(parent);
    await verifyParent(parent, parentStat);
    file = await fs.open(pathname, 'wx', 0o600);
    const output = rememberCreatedPath(owned, pathname, parentStat);
    output.stat = await file.stat({ bigint: true });
    await verifyOwned(output);
    const writer = { file, header, key, index: 0 };
    await writeAll(file, header);
    await writeFrame(writer, manifestBytes);
    for (let start = 0; start < snapshotBytes.length; start += CHUNK_BYTES) {
      await writeFrame(writer, snapshotBytes.subarray(start, start + CHUNK_BYTES));
    }
    for (const [index, source] of sources.entries()) await writeMedia(writer, source, entries[index]);
    await file.sync();
    if (envelope.beforeWriteComplete) await envelope.beforeWriteComplete();
    await file.close();
    await verifyOwned(output);
    return { path: pathname, sizeBytes, manifest };
  } catch (error) {
    await file?.close().catch(() => {});
    if (!await removeOwned(owned)) error.cleanupPending = true;
    throw error;
  } finally {
    key.fill(0);
  }
}

async function writeStagedFile(pathname, parent, owned, write) {
  await verifyParent(path.dirname(pathname), parent);
  const file = await fs.open(pathname, 'wx', 0o600);
  const output = rememberCreatedPath(owned, pathname, parent);
  try {
    output.stat = await file.stat({ bigint: true });
    await verifyOwned(output);
    await write(file);
    await file.sync();
  } finally {
    await file.close();
  }
  await verifyOwned(output);
}

async function unpackPackageEnvelope({ source, password, stagingParent }, ...envelopes) {
  const pathname = checkedAbsolute(source, '.zkdevice');
  const parent = checkedAbsolute(stagingParent);
  const verified = await verifyExisting([pathname, parent]);
  const sourceStat = verified.get(pathname);
  const parentStat = verified.get(parent);
  check(sourceStat.isFile() && sourceStat.nlink === 1n && parentStat.isDirectory(), 'PATH', 'Invalid package or staging directory.');
  check(sourceStat.size <= BigInt(MAX_PACKAGE_BYTES), 'LIMIT', 'Package exceeds its size limit.');
  const file = await openSource(pathname, sourceStat);
  const reader = { file, offset: 0, size: Number(sourceStat.size), index: 0 };
  const owned = [];
  let key;
  try {
    const header = await readExact(reader, HEADER_BYTES);
    const envelope = envelopes.find(candidate => candidate.version === header[MAGIC.length]);
    check(header.subarray(0, MAGIC.length).equals(MAGIC) && envelope,
      'FORMAT', 'File is not a supported .zkdevice package.');
    reader.header = header;
    const length = await readFrameLength(reader, MAX_MANIFEST_BYTES);
    reader.key = key = await deriveKey(password, header);
    const manifest = jsonValue(await readFrameBody(reader, length), 'FORMAT');
    envelope.validateManifest(manifest);
    const entry = envelope.payloadEntry(manifest);
    check(reader.size === wireBytes(length, entry, manifest.media),
      'FORMAT', 'Package length differs from its manifest.');
    const snapshotBytes = Buffer.alloc(entry.sizeBytes);
    await readPayload(reader, entry, (bytes, offset) => bytes.copy(snapshotBytes, offset));
    const snapshot = jsonValue(snapshotBytes, 'SNAPSHOT');
    const assets = envelope.inspectPayload(snapshot);
    inspectMedia(manifest.media, assets, false);
    envelope.verifyClaims(snapshot, assets, manifest);

    await verifyParent(parent, parentStat);
    const directory = await fs.mkdtemp(path.join(parent, 'zkdevice-stage-'));
    const stage = rememberCreatedPath(owned, directory, parentStat);
    const directoryStat = await fs.lstat(directory, { bigint: true });
    check(directoryStat.isDirectory(), 'PATH', 'Temporary staging directory is invalid.');
    stage.stat = directoryStat;
    await verifyOwned(stage);
    await verifyWindowsPaths(ancestorsOf(directory), directory);
    await verifyOwned(stage);
    const snapshotPath = path.join(directory, 'snapshot.json');
    await writeStagedFile(snapshotPath, directoryStat, owned, (output) => writeAll(output, snapshotBytes));

    const stagedMedia = [];
    if (manifest.media.length) {
      await verifyParent(directory, directoryStat);
      const mediaDirectory = path.join(directory, 'media');
      await fs.mkdir(mediaDirectory, { mode: 0o700 });
      const mediaStage = rememberCreatedPath(owned, mediaDirectory, directoryStat);
      const mediaStat = await fs.lstat(mediaDirectory, { bigint: true });
      check(mediaStat.isDirectory(), 'PATH', 'Temporary media directory is invalid.');
      mediaStage.stat = mediaStat;
      for (const entry of manifest.media) {
        const outputPath = path.join(mediaDirectory, stagedMediaName(entry.accountId, entry.id));
        await writeStagedFile(outputPath, mediaStat, owned, (output) =>
          readPayload(reader, entry, (bytes) => writeAll(output, bytes)));
        stagedMedia.push({ ...entry, path: outputPath });
      }
    }
    check(reader.offset === reader.size && sameFileRevision(sourceStat, await file.stat({ bigint: true })),
      'FORMAT', 'Package contents or size changed during unpacking.');
    await file.close();
    for (const item of owned) await verifyOwned(item);
    const result = { directory, snapshotPath, media: stagedMedia, manifest };
    if (envelope.retainStage) envelope.retainStage(result, owned);
    return result;
  } catch (error) {
    await file.close().catch(() => {});
    if (!await removeOwned(owned)) error.cleanupPending = true;
    throw error;
  } finally {
    key?.fill(0);
  }
}

function writeDevicePackage(options) {
  return writePackageEnvelope(options, v1Envelope);
}

function unpackDevicePackage(options) {
  return unpackPackageEnvelope(options, v1Envelope);
}

// Shared internal transport and path checks for the isolated v2 adapter.
const packageTransport = Object.freeze({
  writePackageEnvelope, unpackPackageEnvelope, v1Envelope,
  checkedAbsolute, verifyExisting, verifyPrivateDirectory, openSource, sameIdentity, sameFileRevision, removeOwned,
});

module.exports = Object.freeze({ writeDevicePackage, unpackDevicePackage, packageTransport });
