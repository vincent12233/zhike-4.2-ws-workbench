'use strict';
// Render the complete production shell, including legacy chrome wrappers.
// Boot/network/native lifecycle are suppressed; rendering helpers and core
// remain the real production implementation for browser layout fixtures.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const repo = path.resolve(__dirname, '../..');

function renderWsWorkbenchFixture(options = {}) {
  // Packaged-content smoke must render the staged implementation, not silently
  // fall back to checkout sources. Existing source-layout callers keep default.
  const resourceRoot = path.resolve(options.resourceRoot || path.join(repo, 'resources/app'));
  const core = require(path.join(resourceRoot, 'modules/ws-workbench-core.js'));
  const businessSource = fs.readFileSync(path.join(resourceRoot, 'modules/ws-business-pages.js'), 'utf8');
  const avatarSource = fs.readFileSync(path.join(resourceRoot, 'modules/customer-avatar.js'), 'utf8');
  const source = fs.readFileSync(path.join(resourceRoot, 'modules/ws-workbench.js'), 'utf8');
  const width = Number(options.width) || 1440;
  const target = { innerHTML: '' };
  const host = { state: { view: 'ws-workbench', settings: {}, customers: [], activities: [] } };
  const document = {
    querySelector: selector => selector === '#viewContainer' ? target : null,
    querySelectorAll: () => [],
    getElementById: () => null,
    addEventListener: () => {},
    activeElement: null,
  };
  const sandbox = {
    document, window: { ZhikeWsCore: core, __zhikeRegistryHost: host, innerWidth: width, innerHeight: Number(options.height) || 900 },
    localStorage: { getItem: () => null, setItem: () => {} },
    requestAnimationFrame: () => 0,
    setTimeout: () => 0, clearTimeout: () => {}, setInterval: () => 0, clearInterval: () => {},
    URL, URLSearchParams, AbortController,
  };
  vm.createContext(sandbox);
  const draftsSource = fs.readFileSync(path.join(resourceRoot, 'modules/ws-group-drafts-ui.js'), 'utf8');
  const readingSource = fs.readFileSync(path.join(resourceRoot, 'modules/ws-group-reading-ui.js'), 'utf8');
  vm.runInContext(readingSource, sandbox, { filename: 'ws-group-reading-ui.js' });
  vm.runInContext(draftsSource, sandbox, { filename: 'ws-group-drafts-ui.js' });
  vm.runInContext(avatarSource, sandbox, { filename: 'customer-avatar.js' });
  vm.runInContext(businessSource, sandbox, { filename: 'ws-business-pages.js' });
  const businessPages = sandbox.window.ZhikeWsBusinessPages;
  const bootCall = /  boot\(\);\s*\}\)\(\);\s*$/;
  assert.match(source, bootCall, 'test fixture must suppress only the production boot entry point');
  vm.runInNewContext(source.replace(bootCall, '  globalThis.__wsRenderFixture = { state, render, wsWorkspacePageState };\n})();'), sandbox, { filename: 'ws-workbench-full-render-fixture.js' });
  const { state, render, wsWorkspacePageState } = sandbox.__wsRenderFixture;
  state.active = true;
  state.workspaceMode = options.workspaceMode || 'ordinary';
  state.wsWorkspaceView = options.view || 'chat';
  state.wsWorkspaceNavCollapsed = options.navCollapsed === true;
  state.assistDrawerOpen = options.assistOpen === true;
  state.backgroundActive = options.backgroundActive === true;
  state.wsStatus = options.wsStatus || '未连接';
  state.error = options.error || '';
  state.manualToolsVisible = options.manualToolsVisible === true;
  if (state.manualToolsVisible) { state.localPanelsCollapsed = false; state.captureCollapsed = false; }
  if (typeof options.localPanelsCollapsed === 'boolean') state.localPanelsCollapsed = options.localPanelsCollapsed;
  state.accounts = Array.isArray(options.accounts) ? options.accounts.slice() : [{ id: 'default', displayName: '布局验收账号', status: state.wsStatus }];
  state.activeAccountId = options.activeAccountId || 'default';
  if (Array.isArray(options.groupCatalog)) state.groupCatalog = options.groupCatalog.slice();
  if (options.groupMonitor) Object.assign(state.groupMonitor, options.groupMonitor);
  if (Array.isArray(options.conversations)) state.conversations = options.conversations.slice();
  if (options.lastLoadedAt) state.lastLoadedAt = String(options.lastLoadedAt);
  if (options.monitorDetailsOpen === true) wsWorkspacePageState('groups').monitorDetailsOpen = true;
  if (options.detailGroupId) wsWorkspacePageState('groups').detailGroupId = String(options.detailGroupId);
  if (options.businessResult) businessPages.acceptDirectoryResult(businessPages.directoryState(wsWorkspacePageState(state.wsWorkspaceView)), options.businessResult, state.activeAccountId);
  if (options.businessFilters) wsWorkspacePageState(state.wsWorkspaceView).businessFilters = { ...options.businessFilters };
  if (options.businessDetailId) wsWorkspacePageState(state.wsWorkspaceView).detailId = String(options.businessDetailId);
  render({ skipNativeResize: true });
  assert.ok(target.innerHTML.includes('ws-workbench-shell'), 'the actual complete production render must produce its shell');
  return target.innerHTML;
}
module.exports = { renderWsWorkbenchFixture };
