'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const repo = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(repo, 'resources', 'app', 'index.html'), 'utf8');
const server = fs.readFileSync(path.join(repo, 'resources', 'app', 'server.mjs'), 'utf8');
const homeCss = fs.readFileSync(path.join(repo, 'resources', 'app', 'modules', 'home-6.css'), 'utf8');
const localAssets = [...html.matchAll(/(?:src|href)="\.\/?([^"]+)"/g)].map(match => `/${match[1].replace(/^\//, '')}`);
const serverRoutes = new Set(['/index.html', '/styles.css', '/app.js']);
for (const match of server.matchAll(/["'](\/(?:assets|modules|vendor)\/[^"']+)["']/g)) serverRoutes.add(match[1]);
for (const asset of localAssets) {
  assert(serverRoutes.has(asset), `index.html asset is not served by server allowlist: ${asset}`);
  assert(fs.existsSync(path.join(repo, 'resources', 'app', asset.slice(1))), `index.html asset is missing on disk: ${asset}`);
}
// CSS images are not listed in index.html, but the installed WebView must be
// able to fetch them from the same static allowlist.
for (const file of ['horizon-ridge-6.png', 'horizon-flow-6.png', 'horizon-topline-6.png', 'horizon-rock-6.png', 'horizon-sidebar-shell-6.svg']) {
  const relative = '../assets/' + file;
  const route = '/assets/' + file;
  assert(homeCss.includes(relative), 'home-6.css does not reference required artwork: ' + relative);
  assert(serverRoutes.has(route), 'home artwork is not served by server allowlist: ' + route);
  const resolved = path.resolve(repo, 'resources', 'app', 'modules', relative);
  assert.equal(resolved, path.resolve(repo, 'resources', 'app', 'assets', file), 'home artwork path escapes its expected directory: ' + relative);
  assert(fs.statSync(resolved).size > 0, 'home artwork is empty: ' + relative);
}
assert.equal(fs.existsSync(path.join(repo, 'resources', 'app', 'modules', 'backup-integrity.js')), false,
  'Node-only backup test helpers must not ship in the desktop runtime module directory');
assert.equal(fs.existsSync(path.join(repo, 'tests', 'helpers', 'backup-integrity.cjs')), true,
  'backup integrity helper belongs with the isolated tests');
console.log(`static assets contract: ${localAssets.length} HTML assets and 5 CSS artworks are served and present`);
