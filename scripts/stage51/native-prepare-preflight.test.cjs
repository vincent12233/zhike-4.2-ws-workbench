'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, 'native-prepare.cjs'), 'utf8');
// Fail before importing the old executable-only module: importing a test
// helper must never copy the real output or allocate an acceptance root.
assert.match(source, /if\s*\(require\.main\s*===\s*module\)\s*prepareNativeFixture\(\)/,
  'The real prepare module must be import-safe before its preflight is tested.');
const { assertRequiredNativeXbf } = require('./native-prepare.cjs');
assert.equal(typeof assertRequiredNativeXbf, 'function');

const temporary = path.resolve(os.tmpdir());
const root = fs.mkdtempSync(path.join(temporary, 'zhike-native-preflight-'));
assert.equal(path.dirname(root), temporary);
assert.equal(fs.realpathSync(root), root);
let passed = 0;
const output = name => { const directory = path.join(root, name); fs.mkdirSync(directory); return directory; };
const write = (directory, relative, value = 'ISOLATED_SYNTHETIC_XBF') => {
  const destination = path.join(directory, relative);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(destination, value, { flag: 'wx' });
};
const required = ['App.xbf', 'MainWindow.xbf', 'Views/LegacyUiHostPage.xbf'];
const snapshot = directory => fs.readdirSync(directory, { recursive: true }).sort().map(relative => {
  const item = path.join(directory, relative), stat = fs.lstatSync(item);
  return [relative, stat.isDirectory() ? 'directory' : fs.readFileSync(item).toString('hex')];
});

try {
  const missing = output('missing');
  const before = snapshot(missing);
  assert.throws(() => assertRequiredNativeXbf(missing), error =>
    error.message.includes('App.xbf') && error.message.includes('MainWindow.xbf')
    && error.message.includes('Views/LegacyUiHostPage.xbf')
    && error.message.includes('-p:OutputPath=../../../.tools/stage51-native-v2/'));
  assert.deepEqual(snapshot(missing), before, 'A failed preflight is read-only.');
  passed++;

  const malformed = output('malformed-output');
  write(malformed, 'stage51-native-v2App.xbf');
  write(malformed, 'stage51-native-v2MainWindow.xbf');
  write(malformed, 'stage51-native-v2Views/LegacyUiHostPage.xbf');
  const malformedBefore = snapshot(malformed);
  assert.throws(() => assertRequiredNativeXbf(malformed), /required native XBF/i,
    'Concatenated output-path filenames must not satisfy exact resource locations.');
  assert.deepEqual(snapshot(malformed), malformedBefore);
  passed++;

  const partial = output('partial');
  write(partial, 'App.xbf');
  write(partial, 'Views/LegacyUiHostPage.xbf');
  assert.throws(() => assertRequiredNativeXbf(partial), /MainWindow\.xbf/);
  passed++;

  const empty = output('empty');
  for (const relative of required) write(empty, relative, relative === 'MainWindow.xbf' ? '' : 'ISOLATED_SYNTHETIC_XBF');
  assert.throws(() => assertRequiredNativeXbf(empty), /MainWindow\.xbf/);
  passed++;

  const directoryAsset = output('directory-asset');
  write(directoryAsset, 'App.xbf');
  write(directoryAsset, 'MainWindow.xbf');
  fs.mkdirSync(path.join(directoryAsset, 'Views/LegacyUiHostPage.xbf'), { recursive: true });
  assert.throws(() => assertRequiredNativeXbf(directoryAsset), /LegacyUiHostPage\.xbf/);
  passed++;

  const complete = output('complete');
  for (const relative of required) write(complete, relative);
  const completeBefore = snapshot(complete);
  assert.doesNotThrow(() => assertRequiredNativeXbf(complete));
  assert.deepEqual(snapshot(complete), completeBefore, 'Successful preflight must also remain read-only.');
  passed++;

  const invocation = source.indexOf('assertRequiredNativeXbf(output);');
  assert.ok(invocation > source.indexOf('Only named test build directories are allowed'));
  assert.ok(invocation < source.indexOf('copyIsolatedAppFixture(path.join(repo'));
  assert.ok(invocation < source.indexOf('fs.mkdirSync(root)'));
  passed++;
  console.log(`native prepare XBF preflight: ${passed}/${passed} Passed; exact assets, malformed names, nonempty regular files, read-only failure and pre-mutation wiring; no shared output or acceptance root touched.`);
} finally {
  assert.equal(path.dirname(path.resolve(root)), temporary);
  assert.match(path.basename(root), /^zhike-native-preflight-[a-zA-Z0-9]+$/);
  assert.equal(fs.lstatSync(root).isSymbolicLink(), false);
  assert.equal(fs.realpathSync(root), root);
  fs.rmSync(root, { recursive: true });
}
