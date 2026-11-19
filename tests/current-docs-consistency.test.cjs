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
const version = JSON.parse(read('resources/app/package.json')).version;
const candidate = `v${version}-rc.3`;
const historicalCandidate = `v${version}-rc.2`;
const versionedInstaller = `zhike-${version}-win-x64-setup.exe`;
const releaseNotes = `release/release-notes-${version}.md`;
const historicVersion = '6.0.3';

assert.match(version, /^\d+\.\d+\.\d+$/);
assert.ok(index.includes(`**${version}**`));
assert.match(readme, /docs\/current-release-index\.md/);
assert.match(index, /local-desktop-deployment\.md/);
assert.match(index, /local-desktop-troubleshooting\.md/);
assert.match(deployment, /WinUI 3[\s\S]*SQLite/);
assert.match(troubleshooting, /保存异常|WS 页面|AI 服务/);
assert.doesNotMatch(index, /Docker 服务端说明|docker compose|PostgreSQL.*可选/);
assert.doesNotMatch(index, /zhike-setup\.iss|build-installer\.ps1/);
for (const doc of [readme, index, deployment, troubleshooting]) {
  assert.ok(doc.includes(candidate) && doc.includes(versionedInstaller) && doc.includes('release-output-manifest.json'),
    'Current instructions must identify the exact candidate asset and its manifest');
  assert.doesNotMatch(doc, /workerStatus=running|6\.0\.3-WinUI桌面版\.exe|SHA256SUMS\.txt/,
    'Current instructions cannot select a historical installer or require an enabled Worker');
}
for (const doc of [readme, index, deployment, troubleshooting, read('docs/' + releaseNotes), read('docs/release/independent-collector-followup.md')]) {
  assert.ok(doc.includes(candidate) && doc.includes(`/releases/tag/${candidate}`),
    'Current user documentation must link the rc.3 candidate and distinguish its actual release state');
  assert.match(doc, /独立[^。\n]*采集|采集[^。\n]*独立/);
  assert.match(doc, /当前所选账号的手机/);
  assert.doesNotMatch(doc, /自动会话发现、自动完整历史、后台采集、后台群监测[^。\n]*保持关闭|自动会话发现、后台采集、自动完整历史和后台群监测[^。\n]*(?:保持关闭|不可用)/,
    'Current instructions cannot describe the implemented independent collection capability as globally unavailable');
}
assert.ok(index.includes(`/releases/tag/${historicalCandidate}`));
assert.match(index, /已发布 rc\.2 历史记录/);
assert.match(index, /sourceCommit/);
for (const doc of [readme, index, deployment]) {
  assert.match(doc, /WebView2/);
  assert.match(doc, /22621/);
  assert.match(doc, /生产 Worker[^。\n]*关闭/);
  assert.match(doc, /认证 profile 复制[^。\n]*禁用|认证 profile 复制[^。\n]*关闭/);
}
assert.ok(readme.includes('docs/' + releaseNotes) && index.includes(releaseNotes));
assert.match(read('docs/' + releaseNotes), /S3 保持 Blocked/);
assert.ok(index.includes(`历史 **${historicVersion}**`) && index.includes('test-report-' + historicVersion + '.md'));

const currentAndHistoricDocs = [
  'current-release-index.md',
  'customer-governance-usage.md',
  'hot-chat-profile-usage.md',
  'local-desktop-deployment.md',
  'local-desktop-troubleshooting.md',
  'release-notes-6.0.3.md',
  'test-report-6.0.3.md',
].sort();
const actualDocs = fs.readdirSync(path.join(repo, 'docs'), { withFileTypes: true })
  .filter(file => file.isFile() && file.name.endsWith('.md'))
  .map(file => file.name)
  .sort();
assert.deepEqual(actualDocs, currentAndHistoricDocs, 'docs/ must contain the active entry points and the known historical records');

for (const retiredDir of ['archive', 'migrations']) {
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
  const historicManifest = JSON.parse(read('releases/release-output-manifest.json').replace(/^\uFEFF/, ''));
  assert.equal(historicManifest.version, historicVersion);
  assert.equal(historicManifest.installer, `知客-${historicVersion}-WinUI桌面版.exe`);
  assert.ok(installers.every(name => name === historicManifest.installer),
    'New candidates are staged separately; releases/ retains only the known historical installer');
}

assert.match(index, /反回滚边界/);
assert.match(index, /VIP 群/);
assert.match(index, /首次安装必须创建空数据空间/);
assert.doesNotMatch(index, /旧版安装包保存在/);
assert.doesNotMatch(readme, /docs\/archive/);

console.log('current docs consistency: current candidate and known historical WinUI records have distinct links');
