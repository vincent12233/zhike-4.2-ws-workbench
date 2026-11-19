'use strict';
// Compile and execute the actual native presentation methods. XAML controls
// and the session owner are value-only stubs; visibility logic is never copied
// into a test-side model. This does not claim Windows compositor acceptance.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const repo = path.resolve(__dirname, '../..');
const source = fs.readFileSync(path.join(repo, 'desktop/src/Zhike.Desktop/Views/LegacyUiHostPage.xaml.cs'), 'utf8');

function member(name, optional = false) {
  const match = new RegExp('^    private (?:static )?(?:void|bool|double|string|long)\\s+' + name + '\\b', 'm').exec(source);
  if (!match && optional) return null;
  assert.ok(match, 'Production member must exist: ' + name);
  const begin = match.index;
  const brace = source.indexOf('{', begin), arrow = source.indexOf('=>', begin);
  if (arrow >= 0 && (brace < 0 || arrow < brace)) return source.slice(begin, source.indexOf(';', arrow) + 1);
  let depth = 0, mode = 'code';
  for (let i = brace; i < source.length; i++) {
    const ch = source[i], next = source[i + 1];
    if (mode === 'line') { if (ch === '\n') mode = 'code'; continue; }
    if (mode === 'block') { if (ch === '*' && next === '/') { mode = 'code'; i++; } continue; }
    if (mode === 'string' || mode === 'char') {
      if (ch === '\\') { i++; continue; }
      if (ch === (mode === 'string' ? '"' : "'")) mode = 'code';
      continue;
    }
    if (ch === '/' && next === '/') { mode = 'line'; i++; continue; }
    if (ch === '/' && next === '*') { mode = 'block'; i++; continue; }
    if (ch === '"') { mode = 'string'; continue; }
    if (ch === "'") { mode = 'char'; continue; }
    if (ch === '{') depth++;
    if (ch === '}' && --depth === 0) return source.slice(begin, i + 1);
  }
  assert.fail('Could not find end of production member: ' + name);
}
const names = ['SyncPooledWsPresentation', 'HideWsOverlay', 'IsWsChatPresentationActive',
  'ApplyTrustedWsRouteVisibility', 'ApplyWsBounds', 'SnapToRaster', 'StringValue', 'GetDouble', 'GetLong', 'GetBool'];
const extracted = names.map(name => ({ name, code: member(name) }));
for (const name of ['ShowWsOverlay', 'RestoreWsOverlayPresentation']) {
  const code = member(name, true); if (code) extracted.push({ name, code });
}
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'zhike-ws-presentation-'));
try {
  const generated = path.join(temporary, 'PresentationHost.generated.cs');
  fs.writeFileSync(generated, 'using System.Text.Json;\npartial class PresentationHost {\n' + extracted.map(row => row.code).join('\n\n') + '\n}\n');
  const bundledDotnet = path.join(repo, '.tools/dotnet-linux/dotnet');
  const dotnet = process.env.ZHIKE_TEST_DOTNET || (process.platform !== 'win32' && fs.existsSync(bundledDotnet) ? bundledDotnet : 'dotnet');
  let output;
  try {
    output = execFileSync(dotnet, ['run', '--project', path.join(__dirname, 'WsPresentationRuntime/WsPresentationRuntime.csproj'),
      '-c', 'Release', '-p:PresentationGeneratedHost=' + generated],
    { cwd: repo, encoding: 'utf8', timeout: 90000, maxBuffer: 2 * 1024 * 1024, windowsHide: true });
  } catch (error) {
    if (error.stdout) process.stdout.write(error.stdout);
    if (error.stderr) process.stderr.write(error.stderr);
    throw error;
  }
  process.stdout.write(output);
  assert.match(output, /"passed":10,"failed":0/, 'All native presentation transitions must execute successfully');
  console.log(JSON.stringify({ suite: 'WS presentation runtime', source: 'actual extracted production C#', realWinUI: false,
    realWhatsApp: false, methods: extracted.map(({ name, code }) => ({ name, sha256: crypto.createHash('sha256').update(code).digest('hex') })) }));
} finally { fs.rmSync(temporary, { recursive: true, force: true }); }
