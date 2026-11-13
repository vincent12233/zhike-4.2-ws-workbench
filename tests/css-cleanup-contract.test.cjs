'use strict';

const fs = require('node:fs');
const path = require('node:path');

const repo = path.resolve(__dirname, '..');
const styles = fs.readFileSync(path.join(repo, 'resources', 'app', 'styles.css'), 'utf8');
const v41Styles = fs.readFileSync(path.join(repo, 'resources', 'app', 'modules', 'v41-ui.css'), 'utf8');
const gptStyles = fs.readFileSync(path.join(repo, 'resources', 'app', 'modules', 'gpt-assistant.css'), 'utf8');
const index = fs.readFileSync(path.join(repo, 'resources', 'app', 'index.html'), 'utf8');
const gptModern = fs.readFileSync(path.join(repo, 'resources', 'app', 'modules', 'gpt-modern.css'), 'utf8');

for (const selector of ['.getting-started', '.getting-started-copy', '.getting-started-actions', '.getting-started-steps']) {
  if (styles.includes(selector)) throw new Error(`removed dead selector returned: ${selector}`);
  if (v41Styles.includes(selector)) throw new Error(`removed dead selector returned in v41-ui.css: ${selector}`);
}

for (const selector of ['.sidebar', '.sidebar.collapsed', '.collapse-button', '.nav-item']) {
  if (!styles.includes(selector)) throw new Error(`active layout selector missing: ${selector}`);
}

if (!gptStyles.includes('.gpt-layout') || !gptStyles.includes('.gpt-chat')) {
  throw new Error('GPT layout contract unexpectedly changed');
}
for (const retired of ['shell-layout.css', 'gpt-upgrade.css', 'future-ui.css', 'desktop-host.css']) {
  if (index.includes(retired)) throw new Error(`retired CSS is still loaded: ${retired}`);
  if (fs.existsSync(path.join(repo, 'resources', 'app', 'modules', retired))) throw new Error(`retired CSS still exists: ${retired}`);
}
if (!gptModern.includes('.gpt-workspace-btn') || !gptModern.includes('.gpt-local-import')) {
  throw new Error('retired GPT upgrade controls were not preserved in gpt-modern.css');
}
if (styles.includes('OFFLINE CRM') || styles.includes('background-attachment:fixed') || styles.includes('command-scan')) {
  throw new Error('legacy decoration or high-cost scrolling effect returned');
}

if ((styles.match(/body\{min-width:320px\}/g) || []).length !== 1) {
  throw new Error('compact viewport min-width rule must have one owner');
}

// Keep the responsive owners unambiguous. These declarations are already
// supplied by the later consolidated responsive block; a second copy made
// the result dependent on stylesheet order and was a common source of drift.
if ((styles.match(/\.customer-drawer\{width:calc\(100vw - 54px\)\}/g) || []).length !== 1) {
  throw new Error('customer drawer compact width must have one owner');
}
if ((styles.match(/\.crm-command-strip\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\)\}/g) || []).length !== 1) {
  throw new Error('CRM command strip 1050px layout must have one owner');
}

console.log('css cleanup contract: dead onboarding selectors removed; active shell and GPT layout remain');
