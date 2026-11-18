'use strict';

// Diagnostic only. Exercise shutdown with the workspace runner's launch
// profile and budget, without navigating to any product page.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const {
  CdpConnection, runProcessLifecycle, waitForOwnedDevToolsEndpoint,
} = require('../../../tests/helpers/isolated-edge-runner.cjs');

async function main() {
  assert.equal(process.platform, 'win32');
  const edge = [
    process.env.ZHIKE_TEST_EDGE,
    path.join(process.env['ProgramFiles(x86)'] || '', 'Microsoft/Edge/Application/msedge.exe'),
    path.join(process.env.ProgramFiles || '', 'Microsoft/Edge/Application/msedge.exe'),
  ].filter(Boolean).find(file => fs.existsSync(file));
  assert.ok(edge, 'The same Edge binary as the workspace layout test is required');

  const parent = fs.realpathSync(os.tmpdir());
  const root = fs.mkdtempSync(path.join(parent, 'zhike-edge-zero-page-'));
  const profile = path.join(root, 'edge-profile-' + randomUUID());
  fs.mkdirSync(profile);
  const evidenceDirectory = path.resolve(__dirname, '../../../.tools/edge-exit-observer', 'zero-page-' + randomUUID());
  let connection;
  let cleanupSafe = false;

  try {
    const { result, metadata } = await runProcessLifecycle({
      command: edge,
      args: [
        '--headless=new', '--disable-gpu', '--no-first-run', '--disable-background-networking',
        '--force-device-scale-factor=1', '--remote-debugging-address=127.0.0.1',
        '--remote-debugging-port=0', '--user-data-dir=' + profile, '--window-size=1280,720', 'about:blank',
      ],
      root, profile, timeoutMs: 30000, evidenceDirectory, mode: 'diagnostic-edge-zero-page',
      observerDotnet: process.env.ZHIKE_EDGE_OBSERVER_DOTNET,
      async readResult(context) {
        const endpoint = await waitForOwnedDevToolsEndpoint(profile, context);
        connection = new CdpConnection(endpoint, context);
        await context.wait(connection.opened, 'cdp-connect');
        context.mark('cdp-ready');
        const { processInfo } = await connection.send('SystemInfo.getProcessInfo');
        const observedPids = processInfo.map(row => Number(row.id));
        assert.ok(observedPids.includes(context.child.pid), 'CDP must belong to the newly spawned process');
        await context.observeProcessIds(observedPids);

        const initial = await connection.send('Target.getTargets');
        const pages = initial.targetInfos.filter(target => target.type === 'page');
        assert.ok(pages.length === 0 || (pages.length === 1 && pages[0].url === 'about:blank'),
          'Only the unique about:blank startup page of the owned browser may be closed');
        if (pages.length) {
          const response = await connection.send('Target.closeTarget', { targetId: pages[0].targetId });
          assert.equal(response.success, true);
          context.mark('startup-page-close-confirmed');
        }
        const remaining = await connection.send('Target.getTargets');
        assert.equal(remaining.targetInfos.filter(target => target.type === 'page').length, 0,
          'Zero page targets must be verified before Browser.close');
        const result = { pageTargetsBeforeBrowserClose: 0, productNavigation: false };
        context.mark('zero-page-targets-confirmed');
        context.stageResultEvidence(JSON.stringify(result));
        return result;
      },
      requestClose() {
        assert.ok(connection, 'The owned CDP connection is needed for a graceful close');
        return connection.closeBrowser();
      },
      dispose() {
        connection?.dispose();
      },
    });
    cleanupSafe = metadata.cleanupSafe;
    console.log(JSON.stringify({ ...result, lifecycle: metadata.status, evidence: metadata.evidenceFile }));
  } catch (error) {
    cleanupSafe = error.cleanupSafe === true;
    throw error;
  } finally {
    if (cleanupSafe) {
      const resolved = fs.realpathSync(root);
      assert.equal(path.dirname(resolved), parent);
      assert.match(path.basename(resolved), /^zhike-edge-zero-page-[a-zA-Z0-9]+$/);
      assert.equal(resolved, root);
      fs.rmSync(resolved, { recursive: true });
    } else {
      console.error('Zero-page control did not verify resource release; preserved root: ' + root);
    }
  }
}

main().catch(error => {
  console.error(JSON.stringify({
    code: error.code || error.name, phase: error.phase || 'diagnostic-assertion',
    message: error.message, evidence: error.metadata?.evidenceFile,
  }));
  process.exitCode = 1;
});
