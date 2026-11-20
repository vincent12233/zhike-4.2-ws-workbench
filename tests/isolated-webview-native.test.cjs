'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { once } = require('node:events');
const { createHash, randomUUID } = require('node:crypto');
const { pathToFileURL } = require('node:url');
const { runIsolatedWebView, recordNativeVisualAssertions, assertNativeLifecycle } = require('./helpers/isolated-webview-runner.cjs');

const { scenes:rowMenuScenes, runScenes:runRowMenuScenes, collectorCases, runCollectorScene } = require('./helpers/ws-row-menu-scenes.cjs');
const { filterCases, runFilterScenes } = require('./helpers/ws-group-filter-scenes.cjs');
const { noticeCases, runNoticeScenes } = require('./helpers/ws-group-notice-scenes.cjs');
const { openEvidenceCases, runOpenEvidenceScenes } = require('./helpers/ws-open-chat-evidence-scenes.cjs');
const repo = path.resolve(__dirname, '..');
const evidenceDirectory = path.join(repo, '.tools/native-renderer/controlled-fixture');
const viewport = { width: 640, height: 480 };
const tempParent = path.resolve(os.tmpdir());
const rootPrefix = 'zhike-native-fixture-';
const hostSource = fs.readFileSync(path.join(repo, 'desktop/src/Zhike.Desktop/Views/LegacyUiHostPage.xaml.cs'), 'utf8');
const loginScript = hostSource.match(/private const string WsLoginProbeScript = """\s*([\s\S]*?)\s*""";/)?.[1];
assert.ok(loginScript, 'Run the native login detector against local real-WebView2 documents');
const directoryScript = hostSource.match(/private const string WsVisibleDirectoryScript = """\s*([\s\S]*?)\s*""";/)?.[1];
const chatEvidenceScript = hostSource.match(/private const string WsOpenChatEvidenceScript = """\s*([\s\S]*?)\s*""";/)?.[1];
assert.ok(directoryScript && chatEvidenceScript, 'Exercise the packaged native session readers in a real WebView');
const collectorScript = hostSource.match(/internal static string BuildWsCollectorScript\(string accountId\)\s*\{[\s\S]*?return \$\$"""([\s\S]*?)""";/)?.[1].replaceAll('{{encodedAccount}}', '"qa-menu-slot"');
assert.ok(collectorScript);
const menuScript = hostSource.match(/(  const inspectChatRowMenu = [\s\S]+?)  const verifyDirectoryGroup = /)?.[1];
assert.ok(menuScript, 'Exercise the isolated collector row inspector in a real WebView');
const filterReader = hostSource.match(/(const directoryFilterUi = doc => \{[\s\S]*?)(?=\s*const explicitRead =)/)?.[1];
assert.ok(filterReader, 'Exercise the packaged filter scanner in a real WebView');
const noticeReader = hostSource.match(/(const groupSettingsNotice = [\s\S]*?)(?=\s*const conversationTypeFromNode =)/)?.[1];
assert.ok(noticeReader, 'Exercise packaged group settings notice classification');
const weakList = '<div id="pane-side">' + '<div role="row"><span dir="auto" title="Same title">Same title</span></div>'.repeat(20) + '</div>';
const qaGroup = '120300000012345678@g.us', qaMember = '910000000099@lid';
const bubble = (key, id) => '<div class="message-in" data-id="false_' + key + '_' + id + '_' + qaMember + '">fixture</div>';
const pane = content => '<div id="main"><header>Display title</header>' + content + '</div>';
const eventLog = '<div role="log">' + ['EVENT1','EVENT2'].map(id =>
  '<div role="row" data-id="false_' + qaGroup + '_' + id + '">System update</div>').join('') + '</div>';
const transcriptPane = content => '<section data-testid="conversation-panel-wrapper"><header>Group</header>' + content + '</section>';
const eventTranscript = transcriptPane(eventLog);
const directoryScenes = [
  [weakList + eventTranscript, [qaGroup]],
  [weakList + transcriptPane('') + eventLog, []],
  [weakList + transcriptPane('<aside data-testid="quoted-message">' + eventLog + '</aside>'), []],
  [weakList + '<aside role="dialog">' + eventTranscript + '</aside>', []],
  [weakList, []],
  [weakList + pane(bubble(qaGroup,'AAA01')), []],
  [weakList + pane(bubble(qaGroup,'AAA01') + bubble(qaGroup,'AAA02')), [qaGroup]],
  [weakList + pane(bubble(qaGroup,'AAA01') + bubble('120300000011111111@g.us','BBB02')), []],
  [weakList + pane('<aside data-testid="quoted-message">' + bubble(qaGroup,'AAA01') + bubble(qaGroup,'AAA02') + '</aside>'), []],
  [weakList + pane(bubble('910000000088@c.us','AAA01') + bubble('910000000088@c.us','AAA02')), []],
];
const loginScenes = [
  ['<div data-ref="unrelated"></div>', { login: false, problem: false }],
  ['<div data-ref="pairing"><canvas></canvas></div>', { login: true }],
  ['<canvas aria-label="扫描二维码"></canvas>', { login: true }],
  ['<div role="dialog">Your device was unlinked</div>', { expired: true }],
  ['<div id="pane-side"></div><div id="main"><div role="dialog">Your device was unlinked</div></div>', { chat: true }],
  ['<p>Link with phone number</p>', { login: true, problem: false }],
  ['<p>Update your browser</p>', { login: false, problem: true }],
  ['<div id="pane-side">扫码 / update your browser / synthetic message</div>', { chat: true }],
  ['<div id="pane-side"></div><canvas aria-label="QR code"></canvas>', { login: true }],
  ['<div id="pane-side"></div><div id="main"><canvas aria-label="QR code"></canvas></div>', { chat: true }],
  ['<div id="pane-side"></div><div hidden><canvas aria-label="QR code"></canvas></div>', { chat: true }],
];

function readOptions() {
  const [option, count, ...extra] = process.argv.slice(2);
  if (option === undefined) return { repeat: 1, network: true };
  if (option === '--network-only' && count === undefined) return { repeat: 0, network: true };
  assert.ok(option === '--repeat-normal' && /^[1-5]$/.test(count ?? '') && !extra.length,
    'Use --repeat-normal 1..5 or --network-only');
  return { repeat: Number(count), network: false };
}

function readPendingWindowScene(collectorSource, evidenceSource, selected) {
  const frame = document.createElement('iframe');
  frame.style.cssText = 'width:400px;height:350px';
  document.body.append(frame);
  try {
    const win = frame.contentWindow, doc = frame.contentDocument;
    doc.body.innerHTML = '<div id="side"><div data-testid="chat-list-filters"><button id="all-filter">All</button><button id="group-filter">Groups</button></div><div id="pane-side" style="height:215px; overflow:auto"></div></div>';
    doc.querySelector('#all-filter').setAttribute('aria-selected', String(!selected));
    doc.querySelector('#group-filter').setAttribute('aria-selected', String(selected));
    const list = doc.querySelector('#pane-side');
    const row = (content, attrs='') => '<div role="row" ' + attrs + '>' + content + '</div>';
    const title = value => '<div data-testid="cell-frame-title"><span dir="auto" title="' + value + '">' + value + '</span></div>';
    const secondary = '<div data-testid="last-msg"><span dir="auto" title="Private preview">Private preview</span></div>';
    list.innerHTML = row(title('Twin')+secondary) + row(title('Twin')) + row(secondary)
      + row('<span dir="auto" title="Plain title">Plain title</span>'+secondary)
      + row(title('Private contact'),'data-jid="12345678@c.us"') + row(title('Known'),'data-jid="12023456789@g.us"')
      + row(title('Invisible'),'hidden') + row(title('Outside'),'style="margin-top:500px"');
    const windows = [];
    const receive = raw => {
      const packet = JSON.parse(raw);
      if (packet.type === 'zhike.ws.directory' && packet.pendingGroupWindow) windows.push(packet.pendingGroupWindow.names);
    };
    if (!win.chrome) win.chrome = {};
    if (win.chrome.webview) win.chrome.webview.postMessage = receive;
    else Object.defineProperty(win.chrome,'webview',{value:{postMessage:receive}});
    const anchor = 'window.__zhikeWsDiscoverAll = discoverAll;';
    if (!collectorSource.includes(anchor)) throw Error('Collector discovery entry unavailable');
    const instrumented = collectorSource.replace(anchor,anchor + 'window.fixtureSample = () => publishDirectory(allScan, readRows());');
    const readOpen = win.Function('return ('+evidenceSource+')')();
    win.Function('__zhikeWsTrustedPurpose','__zhikeWsDocumentEpoch','__zhikeReadOpenChat',instrumented)('dedicated',12,readOpen);
    win.__zhikeWsDiscoverAll();
    const first = windows.at(-1) || [];
    const firstName = list.firstElementChild.querySelector('span');
    firstName.textContent = firstName.title = 'Replacement';
    const before = windows.length;
    win.fixtureSample();
    return { first, next:windows.length > before ? windows.at(-1) : [] };
  } finally { frame.remove(); }
}

function fixtureHtml(id, networkUrl) {
  const probe = networkUrl ? `
      const external = document.createElement('script');
      external.src = ${JSON.stringify(networkUrl)};
      external.onload = () => collect('loaded');
      external.onerror = () => collect('blocked');
      document.head.append(external);
  ` : 'collect(null);';
  return `<!doctype html>
<meta charset="utf-8">
<style>#sample { width: 137px; height: 29px; background: rgb(12, 34, 56); }</style>
<div id="sample"></div><pre id="result" hidden></pre>
<script>
  async function collect(network) {
    const sample = document.getElementById('sample');
    const bounds = sample.getBoundingClientRect();
    const loginResults = ${JSON.stringify(loginScenes.map(([markup]) => markup))}.map(markup => {
      sample.innerHTML = markup;
      const probe = () => { return ${loginScript} };
      return JSON.parse(probe());
    });
    const directoryResults = ${JSON.stringify(directoryScenes.map(([markup]) => markup))}.map(markup => {
      sample.innerHTML = markup;
      const directory = JSON.parse((${directoryScript})('dedicated', (${chatEvidenceScript})));
      return { keys:directory.rows.map(row => row.conversationKey), unresolved:directory.unresolvedRowCount };
    });
    let cancelRowMenu = null;
    const scheduleCollectorTask = (callback,delay) => setTimeout(callback,Math.min(35,delay));
    ${menuScript}
    const filterResults = (${runFilterScenes.toString()})(sample,${JSON.stringify(filterCases)},${JSON.stringify(filterReader)});
    const pendingWindowResults = [true,false].map(selected => (${readPendingWindowScene.toString()})(${JSON.stringify(collectorScript)},${JSON.stringify(chatEvidenceScript)},selected));
    const openEvidenceResults = (${runOpenEvidenceScenes.toString()})(sample,${JSON.stringify(openEvidenceCases)},${JSON.stringify(chatEvidenceScript)},${JSON.stringify(directoryScript)},${JSON.stringify(qaGroup)});
    const noticeResults = (${runNoticeScenes.toString()})(sample,${JSON.stringify(noticeCases)},${JSON.stringify(noticeReader)});
    const rowMenuResults = await (${runRowMenuScenes.toString()})(sample,${JSON.stringify(rowMenuScenes)},inspectChatRowMenu);
    const collectorResults = await Promise.all(${JSON.stringify(collectorCases)}.map(async ([name,options]) => ({
      name, ...await (${runCollectorScene.toString()})(${JSON.stringify(collectorScript)},${JSON.stringify(chatEvidenceScript)},${JSON.stringify(qaGroup)},options)
    })));
    document.getElementById('result').textContent = JSON.stringify([{
      viewport: { width: innerWidth, height: innerHeight },
      fixtureId: ${JSON.stringify(id)},
      queryId: new URLSearchParams(location.search).get('case'),
      box: { width: bounds.width, height: bounds.height, background: getComputedStyle(sample).backgroundColor },
      network,
      loginResults, directoryResults, rowMenuResults, collectorResults, filterResults, pendingWindowResults, noticeResults, openEvidenceResults,
      remoteScriptExecuted: window.__syntheticWireScript === true
    }]);
  }
  ${probe}
</script>`;
}

function verifyLifecycle(metadata, host) {
  assert.equal(metadata.mode, 'real-webview2-synthetic-layout');
  assert.equal(metadata.status, 'Passed');
  assert.equal(metadata.timeoutMs, 30000);
  assert.equal(metadata.navigation.succeeded, true);
  assert.ok(metadata.navigation.id);
  assert.equal(metadata.resultCases, 1);
  assert.deepEqual(metadata.exit, { code: 0, signal: null });
  assert.equal(metadata.streamsClosed, true);
  assert.equal(metadata.cleanupSafe, true);
  assert.equal(metadata.forceTerminated, false);
  assert.ok(metadata.identities.some(row => row.pid === metadata.browserPid && row.startedTicks));
  assert.ok(metadata.identities.some(row => row.pid === metadata.pid && row.startedTicks));
  assertNativeLifecycle(metadata);
  for (const [key, file] of [
    ['exeSha256', host],
    ['dllSha256', path.join(path.dirname(host), 'IsolatedWebViewHost.dll')],
    ['runtimeConfigSha256', path.join(path.dirname(host), 'IsolatedWebViewHost.runtimeconfig.json')],
  ]) {
    const expected = fs.statSync(file, { throwIfNoEntry: false })?.isFile()
      ? createHash('sha256').update(fs.readFileSync(file)).digest('hex') : null;
    assert.equal(metadata.hostBuild[key], expected, 'Record only the fingerprint of the actual renderer binary: ' + key);
  }
}

async function runFixture(host, kind, network) {
  const fixtureId = randomUUID();
  const root = fs.mkdtempSync(path.join(tempParent, rootPrefix));
  let cleanupSafe = true;
  try {
    const fixture = path.join(root, 'matrix.html');
    fs.writeFileSync(fixture, fixtureHtml(fixtureId, network?.url), { flag: 'wx' });
    const url = pathToFileURL(fixture);
    url.searchParams.set('case', fixtureId);

    cleanupSafe = false;
    const { results, metadata } = await runIsolatedWebView({
      host, root, url: url.href, viewport, expectedViewports: [viewport], evidenceDirectory,
    });
    cleanupSafe = metadata.cleanupSafe;
    verifyLifecycle(metadata, host);
    assert.deepEqual(results, [{
      viewport, fixtureId, queryId: fixtureId,
      box: { width: 137, height: 29, background: 'rgb(12, 34, 56)' },
      loginResults: loginScenes.map(([, expected]) => expected),
      directoryResults: directoryScenes.map(([, keys]) => ({ keys, unresolved:20 })),
      openEvidenceResults: openEvidenceCases.map(scene => scene.slice(1)),
      noticeResults: noticeCases.map(scene => scene[2]),
      collectorResults: collectorCases.map(([name,options,chatOpens,menuOpens,published]) => ({
        name, actions:0, chatOpens, menuOpens, keys:published ? [qaGroup] : [], verified:chatOpens === 1,
        groupMetadata:options.mode === 'ordinary' ? ['skipped-group','excluded-group'] : published ? ['observed','group-directory'] : [],
        bridgeDirectory:Boolean(published), excluded:options.mode === 'ordinary', observedTargets:options.monitor === 'matched' ? [qaGroup] : [], memberEvents:0
      })),
      rowMenuResults: rowMenuScenes.map(([mode,,status,escaped]) => ({
        status, escaped, itemClicks:0, rowClicks:0, openings:mode === 'preexisting' ? 0 : 1, canOpen:status === 'verified-read-group',
      })),
      filterResults: Object.values(filterCases),
      pendingWindowResults: [{ first:['Twin','Twin','Plain title'], next:['Replacement','Twin','Plain title'] }, { first:[],next:[] }],
      network: network ? 'blocked' : null, remoteScriptExecuted: false,
    }]);
    if (network) assert.deepEqual(network.observed, { connections: 0, requests: 0 });
    recordNativeVisualAssertions(metadata);
    console.log(JSON.stringify({
      kind, status: metadata.status, invocation: metadata.invocation, renderer: metadata.mode,
      elapsedMs: metadata.elapsedMs, browserPid: metadata.browserPid, cleanupSafe: metadata.cleanupSafe,
      networkConnections: network?.observed.connections,
    }));
  } catch (error) {
    if (error.cleanupSafe === true) cleanupSafe = true;
    throw error;
  } finally {
    if (cleanupSafe) {
      const resolved = path.resolve(root);
      assert.equal(path.dirname(resolved), tempParent);
      assert.ok(path.basename(resolved).startsWith(rootPrefix) && !fs.lstatSync(resolved).isSymbolicLink());
      fs.rmSync(resolved, { recursive: true, maxRetries: 5, retryDelay: 100 });
    } else {
      console.error('Retained unverified test fixture: ' + path.basename(root));
    }
  }
}

async function runNetworkFixture(host) {
  // Loopback represents a forbidden network URL and detects even a TCP connection.
  const observed = { connections: 0, requests: 0 };
  const server = http.createServer((_, response) => {
    observed.requests++;
    response.writeHead(200, { 'Content-Type': 'application/javascript' });
    response.end('window.__syntheticWireScript = true;');
  });
  server.on('connection', () => { observed.connections++; });
  const listening = once(server, 'listening');
  server.listen(0, '127.0.0.1');
  await listening;
  try {
    const url = 'http://127.0.0.1:' + server.address().port + '/forbidden-' + randomUUID() + '.js';
    await runFixture(host, 'blocked-network-resource', { url, observed });
  } finally {
    const closed = once(server, 'close');
    server.close();
    server.closeAllConnections();
    await closed;
  }
}

async function main() {
  assert.equal(process.platform, 'win32', 'Windows and the current real WebView2 host are required');
  const host = process.env.ZHIKE_TEST_WEBVIEW_HOST;
  assert.ok(host && path.isAbsolute(host) && fs.statSync(host).isFile(),
    'Pass the fresh host executable explicitly in ZHIKE_TEST_WEBVIEW_HOST');
  const { repeat, network } = readOptions();
  for (let index = 0; index < repeat; index++) {
    await runFixture(host, 'normal-' + (index + 1));
  }
  if (network) await runNetworkFixture(host);
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
