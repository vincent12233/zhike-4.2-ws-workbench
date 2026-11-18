'use strict';

const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { packageTransport } = require('./device-migration-package.cjs');

const PREFIX = 'zhike-rd09-isolated-';
const MARKER = '.rd09-isolation.json';
const VERSION = 1;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;

function check(condition, message) {
  if (!condition) throw Object.assign(new Error(message), { code: 'ISOLATION' });
}

async function canonicalTemp() {
  return packageTransport.checkedAbsolute(await fs.realpath(os.tmpdir()));
}

async function createDeviceMigrationIsolationRoot() {
  const temp = await canonicalTemp();
  const verified = await packageTransport.verifyExisting([temp]);
  const parent = verified.get(temp);
  const directory = await fs.mkdtemp(path.join(temp, PREFIX));
  const owned = [{ pathname: directory, parent, stat: null }];
  try {
    const stat = await fs.lstat(directory, { bigint: true });
    owned[0].stat = stat;
    await packageTransport.verifyPrivateDirectory(directory, stat, true);
    const markerPath = path.join(directory, MARKER);
    const marker = await fs.open(markerPath, 'wx', 0o600);
    const item = { pathname: markerPath, parent: stat, stat: null };
    owned.push(item);
    try {
      item.stat = await marker.stat({ bigint: true });
      const data = { version: VERSION, isolationId: randomUUID(), directory: path.basename(directory) };
      await marker.writeFile(JSON.stringify(data), 'utf8');
      await marker.sync();
    } finally {
      await marker.close();
    }
    await assertDeviceMigrationIsolationRoot(directory);
    return directory;
  } catch (error) {
    if (!await packageTransport.removeOwned(owned)) error.cleanupPending = true;
    throw error;
  }
}

// Only existing paths can be admitted. Callers verify a newly created file
// against its opened identity, or admit its existing parent before creation.
async function assertDeviceMigrationIsolationRoot(isolationRoot, ...paths) {
  const temp = await canonicalTemp();
  const root = packageTransport.checkedAbsolute(isolationRoot);
  const name = path.basename(root);
  check(path.dirname(root) === temp && new RegExp('^' + PREFIX + '[A-Za-z0-9]{6}$').test(name),
    'Device migration requires a dedicated RD09 temporary workspace.');
  const members = paths.map(candidate => {
    const absolute = packageTransport.checkedAbsolute(candidate);
    const relative = path.relative(root, absolute);
    check(!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith('..' + path.sep),
      'A device migration path is outside its isolated workspace.');
    return absolute;
  });
  const markerPath = path.join(root, MARKER);
  let verified;
  try {
    verified = await packageTransport.verifyExisting([root, markerPath, ...members]);
  } catch (error) {
    if (error.code === 'ENOENT') check(false, 'An isolated workspace path or marker is missing.');
    throw error;
  }
  await packageTransport.verifyPrivateDirectory(root, verified.get(root));
  const identity = verified.get(markerPath);
  check(identity.isFile() && identity.size > 0n && identity.size <= 512n, 'Invalid isolated workspace marker.');
  for (const member of members) {
    const stat = verified.get(member);
    check(stat.isDirectory() || stat.nlink === 1n, 'Isolated migration input must be a single-link file.');
  }
  const marker = await packageTransport.openSource(markerPath, identity);
  try {
    let data;
    try { data = JSON.parse(await marker.readFile('utf8')); } catch {}
    check(data && Object.keys(data).length === 3 && data.version === VERSION &&
      data.directory === name && UUID.test(data.isolationId), 'Invalid isolated workspace marker.');
  } finally {
    await marker.close();
  }
  return verified;
}

module.exports = Object.freeze({ createDeviceMigrationIsolationRoot, assertDeviceMigrationIsolationRoot });
