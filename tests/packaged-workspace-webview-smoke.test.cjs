'use strict';

// Real WebView2 over manifest-verified packaged HTML/CSS and WS renderers.
// Only synthetic render state is supplied. Boot, API, native WS and product
// startup are not executed. The renderer retains its existing file/network
// allowlist; packaged image bytes are embedded instead of granting new paths.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { pathToFileURL } = require('node:url');
const { renderWsWorkbenchFixture } = require('./helpers/ws-workbench-render-fixture.cjs');
const { runIsolatedWebView, recordNativeVisualAssertions } = require('./helpers/isolated-webview-runner.cjs');
const { createContrastInspector } = require('./helpers/visual-contrast.cjs');
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const scenes = Object.freeze([
  { mode: 'ordinary', view: 'accounts' }, { mode: 'ordinary', view: 'chat' },
  { mode: 'dedicated', view: 'accounts' }, { mode: 'dedicated', view: 'groups' },
  { mode: 'dedicated', view: 'exclusions' }, { mode: 'dedicated', view: 'group-broadcast' },
]);

function loadBundle(stage) {
  assert.ok(path.isAbsolute(stage), 'Pass an absolute staged bundle directory');
  const manifestBytes = fs.readFileSync(path.join(stage, 'bundle-manifest.json'));
  const manifest = JSON.parse(manifestBytes);
  assert.match(manifest.sourceCommit, /^[a-f0-9]{40}$/i);
  assert.equal(manifest.releaseGate, 'passed', 'Smoke the release-gated bundle');
  assert.equal(manifest.selfContained, true);
  assert.equal(manifest.runtime, 'win-x64');
  assert.ok(Array.isArray(manifest.files) && manifest.files.length);
  const entries = new Map();
  for (const entry of manifest.files) {
    assert.ok(typeof entry.path === 'string' && !entry.path.includes('\\') && !path.posix.isAbsolute(entry.path)
      && !entry.path.split('/').some(part => !part || part === '.' || part === '..') && !entry.path.includes(':'), 'Manifest paths must stay relative');
    assert.ok(!entries.has(entry.path), 'Duplicate manifest path');
    assert.match(entry.sha256, /^[a-f0-9]{64}$/i);
    assert.ok(Number.isSafeInteger(entry.bytes) && entry.bytes >= 0);
    entries.set(entry.path, entry);
  }
  const consumed = new Map();
  const read = relative => {
    assert.ok(relative.startsWith('resources/app/') && !relative.split('/').includes('..'), 'Only packaged app resources are read');
    const entry = entries.get(relative);
    assert.ok(entry, 'Resource missing from bundle manifest: ' + relative);
    const file = path.join(stage, ...relative.split('/'));
    for (let current = file; ; current = path.dirname(current)) {
      assert.equal(fs.lstatSync(current).isSymbolicLink(), false, 'Packaged paths must not contain links');
      if (current === stage) break;
      assert.notEqual(current, path.dirname(current), 'Packaged resource escaped stage');
    }
    const bytes = fs.readFileSync(file);
    assert.equal(bytes.length, entry.bytes, 'Packaged byte count: ' + relative);
    assert.equal(sha256(bytes), entry.sha256.toLowerCase(), 'Packaged SHA256: ' + relative);
    consumed.set(relative, { path: relative, bytes: bytes.length, sha256: sha256(bytes) });
    return bytes;
  };
  const resource = relative => read('resources/app/' + relative);
  const dataUrl = (reference, from = 'index.html') => {
    if (reference.startsWith('data:') || reference.startsWith('#')) return reference;
    assert.ok(!/^[a-z]+:|^\/|^\\/i.test(reference), 'Only local packaged image references are allowed');
    const relative = path.posix.normalize(path.posix.join(path.posix.dirname(from), reference));
    assert.ok(!relative.startsWith('../') && !/[?#]/.test(relative), 'Image reference must remain in app resources');
    const mime = { '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.woff2': 'font/woff2' }[path.posix.extname(relative).toLowerCase()];
    assert.ok(mime, 'Unsupported packaged resource type: ' + relative);
    return 'data:' + mime + ';base64,' + resource(relative).toString('base64');
  };
  let html = resource('index.html').toString('utf8');
  assert.match(html, /id="wsWorkbenchNav"[^>]*data-ws-workspace-mode="ordinary"/);
  assert.match(html, /id="wsDedicatedNav"[^>]*data-ws-workspace-mode="dedicated"/);
  html = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
  let stylesheetCount = 0;
  html = html.replace(/<link\s+rel="stylesheet"\s+href="\.\/([^"]+)"\s*\/?\s*>/g, (_, relative) => {
    stylesheetCount++;
    let css = resource(relative).toString('utf8');
    assert.doesNotMatch(css, /@import\b/i, 'Unexpected CSS import requires explicit packaged validation');
    css = css.replace(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*))\s*\)/g,
      (_, double, single, unquoted) => 'url("' + dataUrl((double ?? single ?? unquoted).trim(), relative) + '")');
    assert.doesNotMatch(css, /<\/style/i);
    return '<style data-packaged-stylesheet="' + relative + '">' + css + '</style>';
  });
  assert.ok(stylesheetCount > 0);
  assert.doesNotMatch(html, /<link[^>]+rel="stylesheet"/i, 'Every packaged stylesheet must be validated');
  html = html.replace(/(<img\b[^>]*\bsrc=")([^"]+)(")/gi, (_, before, reference, after) => before + dataUrl(reference) + after);
  for (const file of ['modules/ws-workbench-core.js', 'modules/ws-business-pages.js', 'modules/customer-avatar.js', 'modules/ws-group-reading-ui.js', 'modules/ws-group-drafts-ui.js', 'modules/ws-workbench.js']) resource(file);
  return { manifest, manifestSha256: sha256(manifestBytes), consumed, stylesheetCount, html,
    resourceRoot: path.join(stage, 'resources/app') };
}

function buildFixtures(bundle, viewport) {
  return scenes.map(scene => {
    const accountId = 'synthetic-' + scene.mode;
    return { ...scene, html: renderWsWorkbenchFixture({ resourceRoot: bundle.resourceRoot,
      workspaceMode: scene.mode, view: scene.view, width: viewport.width, height: viewport.height,
      activeAccountId: accountId, accounts: [{ id: accountId, displayName: '隔离渲染账号', workspaceMode: scene.mode, status: '未连接' }],
      groupCatalog: [{ accountId, groupJid: '120300000001@g.us', groupName: '隔离群组', participantCount: 2, status: 'unknown' }],
    }) };
  });
}

async function browserSmoke(fixtures) {
  const errors = [];
  addEventListener('error', event => errors.push(event.message || 'resource-load-error'), true);
  addEventListener('unhandledrejection', event => errors.push(String(event.reason)));
  document.documentElement.dataset.view = 'ws-workbench';
  document.documentElement.dataset.desktopHost = 'webview2';
  document.documentElement.dataset.palette = 'atelier-dawn';
  document.body.classList.add('ws-mode', 'ws-workspace-active');
  const target = document.getElementById('viewContainer');
  const visible = node => Boolean(node && node.getClientRects().length && getComputedStyle(node).display !== 'none' && getComputedStyle(node).visibility !== 'hidden');
  const rect = node => { const r = node.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; };
  const results = [];
  const { textSample } = createContrastInspector(node => getComputedStyle(node));
  for (const fixture of fixtures) {
    target.innerHTML = fixture.html;
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const shell = target.querySelector('.ws-workbench-shell'), nav = shell?.querySelector('.ws-workspace-nav');
    const content = fixture.view === 'chat' ? shell?.querySelector('.workspace-chat') : shell?.querySelector('[data-ws-workspace-page="' + fixture.view + '"]');
    const active = nav?.querySelector('.ws-workspace-nav-item.active');
    results.push({ mode: fixture.mode, view: fixture.view, rendered: visible(shell) && visible(content),
      activeView: active?.dataset.wsWorkspaceView, pressedMode: nav?.querySelector('[data-ws-workspace-mode][aria-pressed="true"]')?.dataset.wsWorkspaceMode,
      navViews: [...(nav?.querySelectorAll('[data-ws-workspace-view]') || [])].map(node => node.dataset.wsWorkspaceView),
      modeButtons: [...nav.querySelectorAll('[data-ws-workspace-mode]')].map(node => ({ mode: node.dataset.wsWorkspaceMode, ...textSample(node) })),
      nav: nav ? rect(nav) : null, content: content ? rect(content) : null,
      shellDisplay: shell ? getComputedStyle(shell).display : '',
      surface: shell ? getComputedStyle(shell).getPropertyValue('--ds-surface').trim() : '',
      mainSidebarHidden: !visible(document.getElementById('sidebar')),
      documentOverflow: document.documentElement.scrollWidth > innerWidth + 1,
      hostVisible: visible(shell?.querySelector('#wsBrowserHost')),
      blocked: fixture.view === 'group-broadcast' && /BLOCKED/.test(content?.textContent || ''),
    });
  }
  document.getElementById('result').textContent = JSON.stringify([{ viewport: { width: innerWidth, height: innerHeight }, errors, scenes: results,
    stylesheetCount: document.querySelectorAll('style[data-packaged-stylesheet]').length }]);
}

function fixtureDocument(bundle, fixtures) {
  const script = createContrastInspector.toString() + '\n(' + browserSmoke.toString() + ')(' + JSON.stringify(fixtures).replace(/</g, '\\u003c') + ');';
  return bundle.html.replace('</body>', '<pre id="result" hidden></pre><script>' + script + '</script></body>');
}

function assertSmokeResult(result, stylesheetCount) {
  assert.deepEqual(result.errors, []);
  assert.equal(result.stylesheetCount, stylesheetCount);
  assert.equal(result.scenes.length, scenes.length);
  for (const [index, row] of result.scenes.entries()) {
    const expected = scenes[index];
    assert.equal(row.mode, expected.mode); assert.equal(row.view, expected.view);
    assert.equal(row.pressedMode, expected.mode); assert.equal(row.activeView, expected.view);
    assert.equal(row.rendered, true, expected.mode + '/' + expected.view + ' must render');
    assert.equal(row.mainSidebarHidden, true); assert.equal(row.documentOverflow, false);
    assert.ok(row.surface && ['grid', 'flex'].includes(row.shellDisplay), 'Packaged WS styles must actually apply');
    assert.ok(row.nav.width > 100 && row.content.width > 300 && row.content.height > 0);
    assert.equal(row.navViews.includes('groups'), expected.mode === 'dedicated');
    assert.equal(row.navViews.includes('ai'), expected.mode === 'ordinary');
    assert.equal(row.modeButtons.length, 2);
    for (const button of row.modeButtons) assert.ok(button.contrast >= 4.5, 'Workspace purpose button contrast: ' + button.mode + ' = ' + button.contrast);
    if (expected.view === 'chat') assert.equal(row.hostVisible, true);
    if (expected.view === 'group-broadcast') assert.equal(row.blocked, true);
  }
}

async function main() {
  const [stage, output, ...extra] = process.argv.slice(2);
  assert.ok(stage && output && !extra.length, 'Usage: node packaged-workspace-webview-smoke.test.cjs ABSOLUTE_STAGE ABSOLUTE_EVIDENCE_DIR');
  assert.ok(path.isAbsolute(output));
  const bundle = loadBundle(path.resolve(stage));
  fs.mkdirSync(output, { recursive: true });
  const report = { scope: 'packaged-workspace-html-css-in-isolated-webview2', status: 'failed', sourceCommit: bundle.manifest.sourceCommit,
    bundleManifestSha256: bundle.manifestSha256, productStarted: false, realAccountsUsed: false,
    limitations: ['Does not start the installed WinUI product.', 'Does not log in to WhatsApp, contact APIs, or verify platform capabilities.'], runs: [] };
  try {
    for (const viewport of [{ width: 1366, height: 768 }, { width: 1920, height: 1080 }]) {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zhike-packaged-ws-'));
      let cleanupSafe = true;
      try {
        const fixture = path.join(root, 'workspace.html');
        fs.writeFileSync(fixture, fixtureDocument(bundle, buildFixtures(bundle, viewport)), { flag: 'wx' });
        cleanupSafe = false;
        const { results, metadata } = await runIsolatedWebView({ root, url: pathToFileURL(fixture).href, viewport,
          expectedViewports: [viewport], evidenceDirectory: output, screenshotPath: path.join(output, 'workspace-' + viewport.width + '.png') });
        cleanupSafe = metadata.cleanupSafe;
        const [result] = results;
        assertSmokeResult(result, bundle.stylesheetCount);
        recordNativeVisualAssertions(metadata);
        report.runs.push({ viewport, scenes: result.scenes, evidenceFile: path.basename(metadata.evidenceFile), hostBuild: metadata.hostBuild, runtimeVersion: metadata.runtimeVersion });
      } catch (error) {
        if (error.cleanupSafe === true) cleanupSafe = true;
        throw error;
      } finally {
        if (cleanupSafe) fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
      }
    }
    report.status = 'passed';
    console.log('Packaged WS WebView2 smoke: 2 viewports x 6 ordinary/dedicated scenes passed');
  } catch (error) { report.error = { code: error.code || error.name, message: error.message }; throw error; }
  finally { report.resources = [...bundle.consumed.values()]; fs.writeFileSync(path.join(output, 'packaged-workspace-result.json'), JSON.stringify(report, null, 2)); }
}

module.exports = { loadBundle, buildFixtures, fixtureDocument, assertSmokeResult, scenes };
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
