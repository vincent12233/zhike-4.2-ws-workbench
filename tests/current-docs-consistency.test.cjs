'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repo = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(repo, relative), 'utf8');
const index = read('docs/current-release-index.md');
const readme = read('README.md');
const deployment = read('docs/local-desktop-deployment.md');
const troubleshooting = read('docs/local-desktop-troubleshooting.md');

assert.match(index, /6\.0\.0/);
assert.match(readme, /docs\/current-release-index\.md/);
assert.match(index, /local-desktop-deployment\.md/);
assert.match(index, /local-desktop-troubleshooting\.md/);
assert.match(deployment, /WinUI 3[\s\S]*SQLite/);
assert.match(troubleshooting, /保存异常|WS 页面|AI 服务/);
assert.doesNotMatch(index, /Docker 服务端说明|docker compose|PostgreSQL.*可选/);
assert.doesNotMatch(index, /zhike-setup\.iss|build-installer\.ps1/);

const currentDocs = [
  'current-release-index.md',
  'customer-governance-usage.md',
  'hot-chat-profile-usage.md',
  'local-desktop-deployment.md',
  'local-desktop-troubleshooting.md',
  'release-notes-6.0.0.md',
  'test-report-6.0.0.md',
].sort();
const actualDocs = fs.readdirSync(path.join(repo, 'docs'), { withFileTypes: true })
  .filter(file => file.isFile() && file.name.endsWith('.md'))
  .map(file => file.name)
  .sort();
assert.deepEqual(actualDocs, currentDocs, 'docs/ must contain only the current 6.0 documentation set');

for (const retiredDir of ['archive', 'superpowers', 'migrations']) {
  assert.equal(fs.existsSync(path.join(repo, 'docs', retiredDir)), false, `retired docs/${retiredDir} directory must not remain`);
}

const staleNamePattern = /^(?:release-notes-[45]|test-report-[45]|native-desktop-[45]|v5-|fix-list-5|business-rule-baseline-5|ui-scroll-upgrade-5|ws-workbench-4)/i;
for (const file of actualDocs) {
  assert.doesNotMatch(file, staleNamePattern, `${file} is a retired release document`);
  const content = read(path.join('docs', file));
  assert.doesNotMatch(content, /当前(?:生产|正式)?版本(?:为|是)\s*[45]\./, `${file} contains a stale current-version claim`);
}

const releasesDir = path.join(repo, 'releases');
if (fs.existsSync(releasesDir)) {
  const installers = fs.readdirSync(releasesDir).filter(name => /\.exe$/i.test(name));
  assert.ok(installers.every(name => /6\.0\.0/.test(name)), `releases/ contains retired installers: ${installers.join(', ')}`);
}

assert.match(index, /反回滚边界/);
assert.match(index, /VIP 群/);
assert.match(index, /首次安装必须创建空数据空间/);
assert.doesNotMatch(index, /旧版安装包保存在/);
assert.doesNotMatch(readme, /docs\/archive/);

console.log('current docs consistency: only current 6.0 WinUI/SQLite documentation and release boundaries remain');
