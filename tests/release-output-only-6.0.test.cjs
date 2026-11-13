'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repo = path.resolve(__dirname, '..');
const installer = fs.readFileSync(path.join(repo, 'scripts/build-winui-installer.ps1'), 'utf8');
const bundle = fs.readFileSync(path.join(repo, 'scripts/build-winui-bundle.ps1'), 'utf8');

assert.match(installer, /\[switch\]\$ReleaseGate/);
assert.ok(installer.includes('if ($ReleaseGate) {'));
assert.match(installer, /if \(\$ReleaseGate\) \{ Join-Path \$repo 'releases' \} else \{ Join-Path \$repo 'work\\winui-installer-output' \}/, 'formal gated builds must default to releases while development builds remain under work');
assert.ok(installer.includes("-\\d+\\.\\d+\\.\\d+-WinUI"));
assert.match(installer, /release-output-manifest\.json/);
assert.match(installer, /formal release output must contain exactly one versioned installer/);
assert.match(installer, /releaseGate\s*=\s*'passed'/);
assert.match(installer, /version\s*=\s*\$AppVersion/);
assert.match(installer, /sha256\s*=\s*\$installerHash/);
assert.match(installer, /recovery\s*=.*不重新启用旧客户端/);
assert.doesNotMatch(installer, /rollback\s*=.*上一版安装包/);

assert.match(bundle, /Assert-ChildPath \$out \(Join-Path \$repo 'work'\)/);
assert.match(bundle, /releaseGate = if \(\$ReleaseGate\) \{ 'passed' \}/);
assert.match(bundle, /zhike-winui-\$Version-\$RuntimeIdentifier/);

console.log('release output contract: the formal output is manifest-backed and contains one current 6.0 installer only');
