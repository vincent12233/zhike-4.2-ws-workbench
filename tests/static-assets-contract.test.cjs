'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const repo = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(repo, 'resources', 'app', 'index.html'), 'utf8');
const server = fs.readFileSync(path.join(repo, 'resources', 'app', 'server.mjs'), 'utf8');
const localAssets = [...html.matchAll(/(?:src|href)="\.\/?([^"]+)"/g)].map(match => `/${match[1].replace(/^\//, '')}`);
const serverRoutes = new Set(['/index.html', '/styles.css', '/app.js']);
for (const match of server.matchAll(/["'](\/(?:modules|vendor)\/[^"']+)["']/g)) serverRoutes.add(match[1]);
for (const asset of localAssets) {
  assert(serverRoutes.has(asset), `index.html asset is not served by server allowlist: ${asset}`);
  assert(fs.existsSync(path.join(repo, 'resources', 'app', asset.slice(1))), `index.html asset is missing on disk: ${asset}`);
}
console.log(`static assets contract: ${localAssets.length} local assets are served and present`);
