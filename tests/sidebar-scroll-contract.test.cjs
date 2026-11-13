'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const repo = path.resolve(__dirname, '..');
const index = fs.readFileSync(path.join(repo, 'resources/app/index.html'), 'utf8');
const finalCss = fs.readFileSync(path.join(repo, 'resources/app/modules/scroll-system.css'), 'utf8');
const coordinator = fs.readFileSync(path.join(repo, 'resources/app/modules/scroll-coordinator.js'), 'utf8');

assert.doesNotMatch(index, /modules\/shell-layout\.css/, 'retired shell layer must not be loaded');
assert.equal(fs.existsSync(path.join(repo, 'resources/app/modules/shell-layout.css')), false, 'retired shell layer must be removed');
assert.match(finalCss, /body[^}]*min-width:\s*0/);
assert.match(finalCss, /\.app-shell[^}]*height:\s*100dvh/);
assert.match(finalCss, /\.app-shell[^}]*overflow:\s*hidden/);
assert.match(finalCss, /#sidebar[^}]*min-height:\s*0/);
assert.match(finalCss, /#sidebar>#mainNav[^}]*min-height:\s*0/);
assert.match(finalCss, /#sidebar>#mainNav[^}]*overflow-y:\s*auto/);
assert.match(finalCss, /overscroll-behavior:\s*contain/);
assert.match(finalCss, /\.main-area[^}]*min-height:\s*0/);
assert.match(finalCss, /\.view-container[^}]*overflow-y:\s*auto/);
assert.match(finalCss, /#sidebar\.collapsed[^}]*--zhike-sidebar-collapsed/);
assert.match(index, /<aside class="sidebar" id="sidebar">[\s\S]*?<nav class="nav-groups" id="mainNav">[\s\S]*?<div class="sidebar-bottom">/, 'the real sidebar DOM keeps #mainNav between fixed chrome regions');
assert.match(finalCss, /#sidebar>#mainNav\s*\{[\s\S]*?flex:1 1 auto!important;[\s\S]*?min-height:0!important;[\s\S]*?overflow-y:auto!important;/, 'the final CSS makes #mainNav the real shrinkable WebView scroll owner');
assert.match(coordinator, /target\.closest\('#sidebar'\)\) return document\.querySelector\('#mainNav'\)/, 'all wheel targets inside visible sidebar chrome resolve to #mainNav');
assert.match(coordinator, /if \(mode === 'contain'\) \{[\s\S]*?event\.preventDefault\(\);[\s\S]*?applyDelta\(region, 'y', delta\)/, 'contained regions are programmatically scrolled and never hand a boundary wheel to the page');

console.log('sidebar layout contract: consolidated viewport shell, independent nav scroll and collapse rules present');
