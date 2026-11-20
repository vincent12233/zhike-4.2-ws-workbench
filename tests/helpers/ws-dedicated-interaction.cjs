'use strict';

// Runs inside the isolated WebView with the packaged workbench event handlers.
// Both the account index and the native window bridge are local test doubles.
async function exerciseDedicatedWorkspace(scripts) {
  const accounts = [{ id: 'default', displayName: '普通账号', workspaceMode: 'ordinary' }];
  const opens = [];
  const pages = [];
  const shortcuts = [];
  const collectorCalls = [];
  const catalog = [];
  let directoryReads = 0;
  const groupJid = '120300000002@g.us';
  let collectorState = 'not-started';
  let onStatus;
  const capability = () => ({
    state: 'available', code: 'COLLECTION_INDEPENDENT_SESSION', provider: 'native-independent-session', protocolVersion: 1,
    backgroundCollection: true, automaticHistory: true, groupMonitoring: true, automaticAi: false,
    foregroundFallback: false, manualVisibleImport: true, collectorState,
  });
  const find = selector => document.querySelector(selector);
  async function until(label, read) {
    const deadline = performance.now() + 4000;
    while (performance.now() < deadline) {
      const value = read();
      if (value) return value;
      await new Promise(resolve => setTimeout(resolve, 16));
    }
    const active = find('.ws-workspace-nav-item.active')?.dataset.wsWorkspaceView;
    const alert = find('#viewContainer [role="alert"], .ws-account-form-error')?.textContent?.slice(0, 150);
    throw new Error('Dedicated workspace did not respond to ' + label + ' (active ' + active + ', catalog reads ' + directoryReads + ', detail ' + (alert || 'none') + ')');
  }
  const click = selector => until(selector, () => {
    const button = find(selector);
    if (!button || button.disabled) return false;
    button.click();
    return true;
  });
  document.body.classList.remove('ws-mode', 'ws-workspace-active');
  document.documentElement.dataset.view = 'home';
  find('#viewContainer').replaceChildren();
  window.__zhikeRegistryHost = { state: { view: 'home', customers: [], activities: [], settings: {} } };
  window.zhikeDesktop = {
    onWsStatus(listener) { onStatus = listener; },
    async wsAccounts({ action, account }) {
      if (action === 'create') { accounts.push({ ...account }); return { account }; }
      if (action === 'list') return { accounts: [...accounts] };
      throw new Error('Unexpected account action ' + action);
    },
    async ws({ action, accountId, bounds }) {
      if (action === 'open') opens.push({ accountId, bounds });
      if (action === 'open-collector') {
        collectorCalls.push({ action, accountId, bounds });
        collectorState = 'login-visible';
        return { ok: true, accountId, collectorOnly: true, loginVisible: true, collectionCapability: capability() };
      }
      if (action === 'discover-conversations') {
        collectorCalls.push({ action, accountId });
        if (collectorState === 'running' && !catalog.some(row => row.accountId === accountId))
          catalog.push({ accountId, groupJid, groupName: '目录回归群', status: 'active' });
        return { ok: true, supported: true, accountId, scanning: false, conversations: [],
          groupConversations: [{ externalId: groupJid, groupJid, title: '目录回归群', isGroup: true, conversationType: 'group' }] };
      }
      return { ok: true, accountId, status: '等待登录', collectionCapability: capability() };
    },
  };
  window.fetch = async input => {
    const url = new URL(String(input), 'https://workbench.test');
    const groups = /^\/api\/ws\/accounts\/([^/]+)\/groups$/.exec(url.pathname);
    if (groups) directoryReads++;
    const result = groups ? { groups: catalog.filter(row => row.accountId === decodeURIComponent(groups[1])) } : {};
    return new Response(JSON.stringify(result), { headers: { 'Content-Type': 'application/json' } });
  };
  for (const source of scripts) {
    const script = document.createElement('script');
    script.textContent = source;
    document.body.append(script);
  }
  await click('#wsDedicatedNav');
  await click('#viewContainer button[data-ws-action="create-account"]:not(:disabled)');
  await until('open account form', () => {
    const input = find('#wsAccountDisplayName');
    if (!input) return false;
    input.value = '专用交互测试';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  });
  await click('button[data-ws-action="submit-account"]');
  await until('create and open login', () => opens.length);
  const dedicated = accounts.find(account => account.workspaceMode === 'dedicated');
  if (!dedicated || accounts.length !== 2) throw new Error('Expected exactly one new dedicated account');
  const nav = '.ws-workspace-nav-item[data-ws-workspace-view]';
  const views = [...document.querySelectorAll(nav)].map(item => item.dataset.wsWorkspaceView);
  for (const view of views) {
    await click(nav + '[data-ws-workspace-view="' + view + '"]');
    const page = view === 'chat' ? '#wsBrowserHost' : '[data-ws-workspace-page="' + view + '"]';
    await until('navigate to ' + view, () => find(nav + '.active')?.dataset.wsWorkspaceView === view && find(page)?.getClientRects().length);
    pages.push(view);
    if (['group-broadcast', 'group-mentions', 'group-reading', 'group-permissions'].includes(view)) {
      const count = opens.length;
      await click(page + ' button[data-ws-workspace-view="chat"]');
      await until('open WhatsApp from ' + view, () => opens.length > count && find('#wsBrowserHost')?.getClientRects().length);
      shortcuts.push(view);
    }
  }
  const accountScoped = opens.every(open => open.accountId === dedicated.id);
  const visibleOpens = opens.every(({ bounds }) => bounds && !bounds.hidden && bounds.width > 200 && bounds.height > 100);
  await click(nav + '[data-ws-workspace-view="collection"]');
  await click('[data-ws-workspace-page="collection"] button[data-ws-action="open-collector"]');
  await until('open independent collector login', () => collectorState === 'login-visible' && typeof onStatus === 'function');
  const login = collectorCalls.find(call => call.action === 'open-collector');
  const discoveredBeforePairing = collectorCalls.some(call => call.action === 'discover-conversations');
  collectorState = 'running';
  onStatus({ accountId: dedicated.id, collectorOnly: true, eventName: 'background-tick',
    loginVisible: false, collectionCapability: capability() });
  await until('discover groups after independent pairing', () => collectorCalls.some(call => call.action === 'discover-conversations'));
  await click(nav + '[data-ws-workspace-view="groups"]');
  await until('display discovered group', () => find('[data-ws-workspace-page="groups"]')?.textContent.includes('目录回归群'));
  return { pages, shortcuts, accountScoped, visibleOpens, collector: {
    scoped: collectorCalls.every(call => call.accountId === dedicated.id),
    loginVisible: !login.bounds.hidden && login.bounds.width > 200 && login.bounds.height > 100,
    discoveredBeforePairing, directoryVisible: true,
  } };
}

module.exports = { exerciseDedicatedWorkspace };
