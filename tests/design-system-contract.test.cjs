'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repo = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(repo, file), 'utf8');
const designPath = path.join(repo, 'resources', 'app', 'modules', 'design-system.css');
assert.equal(fs.existsSync(designPath), true, 'unified design-system.css must exist');
const css = fs.readFileSync(designPath, 'utf8');
const html = read('resources/app/index.html');
const server = read('resources/app/server.mjs');

for (const token of [
  '--zk-bg:#f4f7fb',
  '--zk-surface:#ffffff',
  '--zk-border:#dce6ef',
  '--zk-ink:#203449',
  '--zk-muted:#6b7f92',
  '--zk-accent:#0ea991',
  '--zk-accent-strong:#087f70',
  '--zk-blue:#2b79d3',
  '--zk-success:#167a52',
  '--zk-warning:#9a6410',
  '--zk-danger:#a23a32',
  '--zk-ai:#7357c7',
]) {
  assert.match(css, new RegExp(token.replace('#', '\\#')), `missing visual token ${token}`);
}

assert.match(css, /body\s*\{[^}]*font-size:\s*13px/, 'body text must stay readable');
assert.match(css, /\.data-table\s+td[^}]*font-size:\s*13px/, 'table body text must not fall below 13px');
assert.match(css, /\.data-table\s+th[^}]*font-size:\s*12px/, 'table headers must not fall below 12px');
assert.match(css, /@media\s*\(max-width:\s*1200px\)/, 'medium layout breakpoint must be explicit');
assert.match(css, /@media\s*\(max-width:\s*900px\)/, 'small layout breakpoint must be explicit');
assert.match(css, /@media\s*\(max-width:\s*640px\)/, 'phone layout breakpoint must be explicit');
assert.match(css, /\.sidebar:not\(\.collapsed\)\{[^}]*width:224px[^}]*flex-basis:224px/, 'manual sidebar expansion must override the medium rail');
assert.match(css, /\.sidebar:not\(\.collapsed\) \.nav-item\{[^}]*justify-content:flex-start/, 'expanded sidebar must restore text alignment');
assert.match(css, /prefers-reduced-motion/, 'motion preferences must be respected');
assert.match(css, /animation:\s*none\s*!important/, 'continuous visual animation must be disabled by default');
assert.match(html, /modules\/design-system\.css/, 'index must load the unified compatibility primitives');
assert.ok(html.indexOf('modules/design-system.css') < html.indexOf('modules/horizon-atelier.css'), 'compatibility primitives must load before the 6.0 product skin');
assert.ok(html.indexOf('modules/horizon-atelier.css') < html.indexOf('modules/scroll-system.css'), 'the interaction contract must remain the final stylesheet');
assert.match(server, /['"]\/modules\/design-system\.css['"]/, 'server must allow the unified design system asset');

console.log('design-system contract: tokens, typography, breakpoints, motion and asset wiring are present');
