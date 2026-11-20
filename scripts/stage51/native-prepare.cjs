'use strict';
// Prepares an opt-in development-only WinUI build. No production data or
// installed application files are copied. The executable is built separately.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { copyIsolatedAppFixture } = require('../../tests/helpers/isolated-app-fixture.cjs');
const repo = path.resolve(__dirname, '../..');

function assertRequiredNativeXbf(output) {
  const issues = [];
  for (const relative of ['App.xbf', 'MainWindow.xbf', 'Views/LegacyUiHostPage.xbf']) {
    const parts = relative.split('/');
    let current = output;
    try {
      const outputStat = fs.lstatSync(output);
      assert.ok(outputStat.isDirectory() && !outputStat.isSymbolicLink());
      for (const [index, part] of parts.entries()) {
        current = path.join(current, part);
        const stat = fs.lstatSync(current);
        assert.equal(stat.isSymbolicLink(), false);
        assert.ok(index === parts.length - 1 ? stat.isFile() && stat.size > 0 : stat.isDirectory());
      }
    } catch (error) {
      issues.push(relative + (error.code === 'ENOENT' ? ' (missing)' : ' (not a nonempty regular asset inside the output)'));
    }
  }
  assert.equal(issues.length, 0,
    'Missing or invalid required native XBF: ' + issues.join(', ') + '. '
    + 'Build from the repository root with an explicit trailing slash: '
    + '.tools/dotnet10/dotnet.exe build desktop/src/Zhike.Desktop/Zhike.Desktop.csproj -c Release --no-restore '
    + '-p:Platform=x64 -r win-x64 -p:Stage51IsolatedUi=true -p:OutputPath=../../../.tools/stage51-native-v2/ --nologo -v:minimal. '
    + 'No fixture files or temporary acceptance root have been changed.');
}

function prepareNativeFixture() {
  const output = path.resolve(process.argv[2] || path.join(repo, '.tools/stage51-native-v2'));
  assert.ok(output === path.join(repo, '.tools/stage51-native-v2') || output === path.join(repo, 'stage51-native-output'), 'Only named test build directories are allowed');
  const binary = path.join(output, 'Zhike.Stage51.Acceptance.exe');
  assert.ok(fs.existsSync(binary), 'Build Stage51IsolatedUi=true to stage51-native-output first');
  assertRequiredNativeXbf(output);
  const reused = process.argv[3] ? path.resolve(process.argv[3]) : null;
  if (reused) {
    assert.equal(path.dirname(reused).toLowerCase(), path.resolve(os.tmpdir()).toLowerCase());
    assert.match(path.basename(reused), /^zhike-stage51-native-[a-f0-9]{32}$/);
    assert.equal(fs.lstatSync(reused).isSymbolicLink(), false);
    assert.equal(fs.readFileSync(path.join(reused, '.stage51-isolated'), 'utf8'), 'zhike-stage51-isolated-ui-v1');
    const prior = path.join(reused, 'connection.private.json');
    if (fs.existsSync(prior)) { const pid = Number(JSON.parse(fs.readFileSync(prior, 'utf8')).pid); let alive = false; try { process.kill(pid, 0); alive = true; } catch {} assert.equal(alive, false, 'Close the exact prior isolated app before reusing its fixture'); }
  }
  const resources = path.join(output, 'resources/app');
  copyIsolatedAppFixture(path.join(repo, 'resources/app'), resources);
  const bundledNode = path.join(repo, 'resources/app/node.exe');
  const runtime = process.env.ZHIKE_TEST_NODE || (fs.existsSync(bundledNode) ? bundledNode : process.execPath);
  fs.copyFileSync(runtime, path.join(resources, 'node.exe'));
  const root = reused || path.join(os.tmpdir(), 'zhike-stage51-native-' + randomUUID().replace(/-/g, ''));
  if (!reused) { fs.mkdirSync(root); fs.writeFileSync(path.join(root, '.stage51-isolated'), 'zhike-stage51-isolated-ui-v1'); }
  assert.equal(fs.existsSync(path.join(resources, 'data')), false);
  console.log(JSON.stringify({ root, reused: Boolean(reused), binary, buildProperty: 'Stage51IsolatedUi=true', productionOpened: false, wsNetwork: 'blocked', paidAiNetwork: 'blocked' }));
}

module.exports = { assertRequiredNativeXbf };
if (require.main === module) prepareNativeFixture();
