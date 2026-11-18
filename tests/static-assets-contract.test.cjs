'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const repo = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(repo, 'resources', 'app', 'index.html'), 'utf8');
const server = fs.readFileSync(path.join(repo, 'resources', 'app', 'server.mjs'), 'utf8');
const appRoot = path.join(repo, 'resources', 'app');
const localAssets = [...html.matchAll(/(?:src|href)="\.\/?([^"]+)"/g)].map(match => `/${match[1].replace(/^\//, '')}`);
const serverRoutes = new Set(['/index.html', '/styles.css', '/app.js']);
for (const match of server.matchAll(/["'](\/(?:assets|modules|vendor)\/[^"']+)["']/g)) serverRoutes.add(match[1]);
for (const asset of localAssets) {
  assert(serverRoutes.has(asset), `index.html asset is not served by server allowlist: ${asset}`);
  assert(fs.existsSync(path.join(repo, 'resources', 'app', asset.slice(1))), `index.html asset is missing on disk: ${asset}`);
}
// Follow the real stylesheet graph rather than requiring obsolete decoration
// to stay in home-6.css. Every currently referenced local image must be served.
const cssAssets = [];
for (const match of html.matchAll(/<link\s+rel="stylesheet"\s+href="\.\/([^"]+)"/g)) {
  const sheet = path.join(appRoot, match[1]);
  const css = fs.readFileSync(sheet, 'utf8');
  for (const image of css.matchAll(/url\(\s*["']?([^\s"')]+)["']?\s*\)/g)) {
    const reference = image[1];
    if (reference.startsWith('data:') || reference.startsWith('#')) continue;
    assert.doesNotMatch(reference, /^(?:https?:)?\/\//, 'the installed visual shell cannot depend on a remote artwork host');
    const resolved = path.resolve(path.dirname(sheet), reference);
    const relative = path.relative(appRoot, resolved);
    assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative), 'CSS asset path escapes application resources: ' + reference);
    const route = '/' + relative.replaceAll(path.sep, '/');
    cssAssets.push({ route, resolved, sheet: match[1] });
  }
}
function validateCssAssets(routes) {
  for (const asset of cssAssets) {
    assert(routes.has(asset.route), `${asset.sheet} asset is not served by server allowlist: ${asset.route}`);
    assert(fs.existsSync(asset.resolved), `CSS artwork missing: ${asset.route}`);
    assert(fs.statSync(asset.resolved).isFile() && fs.statSync(asset.resolved).size > 0, `CSS artwork is not a nonempty file: ${asset.route}`);
  }
}
validateCssAssets(serverRoutes);
// The unified sidebar is CSS-rendered in both palettes. The previous shell SVG
// remains packaged below, but is no longer a required live decoration.
for (const route of ['/assets/atelier-dawn.svg', '/assets/horizon-flow-6.png']) assert.ok(cssAssets.some(asset => asset.route === route), `current palettes must retain their actual artwork: ${route}`);
const missingDawn = new Set(serverRoutes); missingDawn.delete('/assets/atelier-dawn.svg');
assert.throws(() => validateCssAssets(missingDawn), /not served by server allowlist/, 'a file:// fixture cannot conceal an HTTP asset routing regression');
// Retained previous artwork still has to be packaged and served for legacy
// routes, even though the new default no longer loads all five images.
for (const file of ['horizon-ridge-6.png','horizon-flow-6.png','horizon-topline-6.png','horizon-rock-6.png','horizon-sidebar-shell-6.svg']) {
  assert(serverRoutes.has('/assets/' + file), 'retained artwork is not served: ' + file);
  assert(fs.statSync(path.join(appRoot, 'assets', file)).size > 0, 'retained artwork is empty: ' + file);
}
assert.equal(fs.existsSync(path.join(repo, 'resources', 'app', 'modules', 'backup-integrity.js')), false,
  'Node-only backup test helpers must not ship in the desktop runtime module directory');
assert.equal(fs.existsSync(path.join(repo, 'tests', 'helpers', 'backup-integrity.cjs')), true,
  'backup integrity helper belongs with the isolated tests');
console.log(`static assets contract: ${localAssets.length} HTML assets and ${cssAssets.length} actual CSS artwork references are local, served and present; legacy artwork retained`);
