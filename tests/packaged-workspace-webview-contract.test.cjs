'use strict';
// Synthetic manifest contract only; this is not a real bundle/native pass.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { test } = require('node:test');
const { loadBundle, buildFixtures, fixtureDocument, scenes } = require('./packaged-workspace-webview-smoke.test.cjs');
const repo = path.resolve(__dirname, '..');
function fixture(run) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zhike-packaged-contract-'));
  const app = path.join(root, 'resources/app');
  fs.mkdirSync(app, { recursive: true });
  for (const file of ['index.html', 'styles.css']) fs.copyFileSync(path.join(repo, 'resources/app', file), path.join(app, file));
  for (const directory of ['modules', 'assets']) fs.cpSync(path.join(repo, 'resources/app', directory), path.join(app, directory), { recursive: true });
  const renderer = path.join(app, 'modules/ws-workbench.js');
  fs.writeFileSync(renderer, fs.readFileSync(renderer, 'utf8').replace("? '专用 WS' : '普通 WS'", "? '包内专用 WS' : '包内普通 WS'"));
  const files = [];
  const collect = directory => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) collect(file);
      else { const bytes = fs.readFileSync(file); files.push({ path: path.relative(root, file).split(path.sep).join('/'), bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') }); }
    }
  };
  collect(app);
  const manifest = { sourceCommit: '0'.repeat(40), releaseGate: 'passed', selfContained: true, runtime: 'win-x64', files };
  fs.writeFileSync(path.join(root, 'bundle-manifest.json'), JSON.stringify(manifest));
  try { run(root, app, manifest); }
  finally { fs.rmSync(root, { recursive: true, force: true }); }
}
test('isolated document uses manifest-verified packaged markup, styles, images and both workspace renderers', () => fixture(root => {
  const bundle = loadBundle(root);
  const fixtures = buildFixtures(bundle, { width: 1366, height: 768 });
  assert.equal(fixtures.length, 10);
  assert.deepEqual(fixtures.map(row => ({ mode: row.mode, view: row.view })), scenes);
  assert.match(fixtures[0].html, /包内普通 WS/);
  assert.match(fixtures[2].html, /包内专用 WS/);
  assert.match(fixtures[5].html, /BLOCKED/);
  assert.match(fixtures[5].html, /data-ws-group-draft-input=/);
  assert.match(fixtures[6].html, /真实回执|平台回执/);
  assert.match(fixtures[7].html, /UNKNOWN/);
  assert.match(fixtures[8].html, /B_MODE_BLOCKED_UNSUPPORTED/);
  // V9.2 managed groups render from the packaged module with exactly the three business fields.
  assert.equal(fixtures[9].view, 'managed-groups');
  assert.doesNotMatch(fixtures[9].html, /模块未加载/);
  for (const field of ['channel', 'groupName', 'groupAlias']) assert.match(fixtures[9].html, new RegExp('name="' + field + '"'));
  assert.doesNotMatch(fixtures[9].html, /name="(?:jid|assistant)"/);
  const html = fixtureDocument(bundle, fixtures);
  assert.doesNotMatch(html, /<script[^>]+src=/i, 'Product boot/API scripts never run in the fixture');
  assert.match(html, /data-packaged-stylesheet="modules\/ws-workbench.css"/);
  assert.match(html, /data:image\/png;base64,/);
  assert.ok([...bundle.consumed.keys()].includes('resources/app/modules/ws-workbench.js'));
  assert.ok(bundle.stylesheetCount >= 10);
}));
test('missing and tampered packaged CSS cannot fall back to checkout styles', () => fixture((root, app, manifest) => {
  const file = path.join(app, 'modules/ws-workbench.css');
  const original = fs.readFileSync(file);
  fs.appendFileSync(file, '\n/* altered */');
  assert.throws(() => loadBundle(root), /Packaged byte count|Packaged SHA256/);
  fs.writeFileSync(file, original);
  manifest.files = manifest.files.filter(row => row.path !== 'resources/app/modules/ws-workbench.css');
  fs.writeFileSync(path.join(root, 'bundle-manifest.json'), JSON.stringify(manifest));
  assert.throws(() => loadBundle(root), /missing from bundle manifest/);
}));
test('a bundle without the packaged managed-group module is rejected', () => fixture((root, app, manifest) => {
  manifest.files = manifest.files.filter(row => row.path !== 'resources/app/modules/ws-managed-groups-ui.js');
  fs.writeFileSync(path.join(root, 'bundle-manifest.json'), JSON.stringify(manifest));
  assert.throws(() => loadBundle(root), /missing from bundle manifest: resources\/app\/modules\/ws-managed-groups-ui\.js/);
}));
test('ambiguous manifests and paths outside the stage are rejected before reading resources', () => fixture((root, app, manifest) => {
  manifest.files.push({ ...manifest.files[0] });
  fs.writeFileSync(path.join(root, 'bundle-manifest.json'), JSON.stringify(manifest));
  assert.throws(() => loadBundle(root), /Duplicate manifest path/);
  manifest.files.pop(); manifest.files[0].path = '../outside.css';
  fs.writeFileSync(path.join(root, 'bundle-manifest.json'), JSON.stringify(manifest));
  assert.throws(() => loadBundle(root), /Manifest paths must stay relative/);
}));
