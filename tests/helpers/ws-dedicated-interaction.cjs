'use strict';

// Runs inside the isolated WebView with the packaged workbench event handlers.
// Both the account index and the native window bridge are local test doubles.
async function exerciseDedicatedWorkspace(scripts) {
  const accounts = [{ id: 'default', displayName: '普通账号', workspaceMode: 'ordinary' }];
  const opens = [];
  const pages = [];
  const shortcuts = [];
  const collectorCalls = [];
  const foregroundLogins = new Set();
  const foregroundReads = [];
  let directoryReads = 0;
  const groupJid = '120300000002@g.us';
  const foregroundGroup = '前台现场测试群';
  const foregroundContact = '前台现场测试客户';
  const pickerContact = '只在联系人选择器出现';
  let pickerVisible = false;
  let collectorState = 'not-started';
  let onStatus;
  const capability = id => ({
    state: 'available', code: 'COLLECTION_INDEPENDENT_SESSION', provider: 'native-independent-session', protocolVersion: 1,
    backgroundCollection: true, automaticHistory: true, groupMonitoring: true, automaticAi: false,
    foregroundFallback: false, manualVisibleImport: true, collectorState: id === 'default' ? 'not-started' : collectorState,
    collectorLoginStatus: id !== 'default' && collectorState === 'running' ? '已连接' : '等待登录',
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
      if (action === 'discover-visible-conversations') {
        if (!foregroundLogins.has(accountId)) throw new Error('Expected an authenticated foreground account');
        foregroundReads.push(accountId);
        const ordinary = accountId === 'default';
        return { ok: true, supported: true, accountId, workspaceMode: ordinary ? 'ordinary' : 'dedicated',
          source: 'foreground-visible', sessionGeneration: ordinary ? 9 : 7, collectorEpoch: 0, coverage: 'foreground-visible-only',
          unresolvedRowCount: ordinary && !pickerVisible ? 2 : 0, contactsVisible: ordinary && pickerVisible, conversationListVisible: !ordinary || !pickerVisible,
          contacts: ordinary && pickerVisible ? [{ contactId: '100000003@lid', displayName: pickerContact }] : [],
          conversations: ordinary && !pickerVisible ? [{ conversationKey: '123456789@c.us', displayName: foregroundContact, conversationType: 'direct' }] : [],
          groupConversations: ordinary ? [] : [{ conversationKey: '120300000001@g.us', groupJid: '120300000001@g.us', displayName: foregroundGroup, isGroup: true, conversationType: 'group' }] };
      }
      if (action === 'open-collector') {
        collectorCalls.push({ action, accountId, bounds });
        collectorState = 'login-visible';
        return { ok: true, accountId, collectorOnly: true, loginVisible: true, collectionCapability: capability(accountId) };
      }
      if (action === 'discover-conversations') {
        collectorCalls.push({ action, accountId });
        if (collectorState !== 'running' || accountId === 'default') throw new Error('Background discovery requires this account to be paired');
        return { ok: true, supported: true, accountId, workspaceMode: 'dedicated', source: 'collector', collectorOnly: true,
          sessionGeneration: 7, collectorEpoch: 3, scanId: 1, scanning: true, coverage: 'scan-in-progress', conversations: [], groupConversations: [] };
      }
      return { ok: true, accountId, status: foregroundLogins.has(accountId) ? '已连接' : '等待登录', collectionCapability: capability(accountId) };
    },
  };
  window.fetch = async input => {
    const url = new URL(String(input), 'https://workbench.test');
    const groups = /^\/api\/ws\/accounts\/([^/]+)\/groups$/.exec(url.pathname);
    if (groups) directoryReads++;
    // The simulated local index remains empty for the entire test, including after pairing.
    const result = groups ? { groups: [] } : { conversations: [], messages: [] };
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
  const loginForeground = (id, mode) => {
    foregroundLogins.add(id);
    onStatus({ accountId: id, workspaceMode: mode, status: '已连接', sessionGeneration: mode === 'ordinary' ? 9 : 7, collectionCapability: capability(id) });
  };
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
  loginForeground(dedicated.id, 'dedicated');
  await until('read paired foreground group list', () => foregroundReads.includes(dedicated.id));
  await click(nav + '[data-ws-workspace-view="groups"]');
  await until('dedicated foreground groups with empty SQLite before collector pairing',
    () => find('[data-ws-workspace-page="groups"]')?.textContent.includes(foregroundGroup));
  await click(nav + '[data-ws-workspace-view="collection"]');
  await click('[data-ws-workspace-page="collection"] button[data-ws-action="open-collector"]');
  await until('open independent collector login', () => collectorState === 'login-visible' && typeof onStatus === 'function');
  const login = collectorCalls.find(call => call.action === 'open-collector');
  const discoveredBeforePairing = collectorCalls.some(call => call.action === 'discover-conversations');
  collectorState = 'running';
  onStatus({ accountId: dedicated.id, workspaceMode: 'dedicated', collectorOnly: true, eventName: 'background-tick',
    sessionGeneration: 7, collectorEpoch: 3, loginVisible: false, collectionCapability: capability(dedicated.id) });
  await until('discover groups after independent pairing', () => collectorCalls.some(call => call.action === 'discover-conversations'));
  const groupEvent = { accountId: dedicated.id, workspaceMode: 'dedicated', collectorOnly: true, eventName: 'live-directory',
    sessionGeneration: 7, collectorEpoch: 3, source: 'collector', scanId: 1, chunkIndex: 0, finished: true, complete: true,
    conversations: [], groupConversations: [{ conversationKey: groupJid, groupJid, title: '目录回归群', isGroup: true, conversationType: 'group' }] };
  onStatus(groupEvent);
  await click(nav + '[data-ws-workspace-view="groups"]');
  await until('display both foreground and second-screen background groups', () => {
    const text = find('[data-ws-workspace-page="groups"]')?.textContent || '';
    return text.includes(foregroundGroup) && text.includes('目录回归群');
  });
  await click('.ws-workspace-nav [data-ws-workspace-mode="ordinary"]');
  await click(nav + '[data-ws-workspace-view="chat"]');
  await until('ordinary chat', () => find(nav + '.active')?.dataset.wsWorkspaceView === 'chat' && find('.ws-session-list'));
  loginForeground('default', 'ordinary');
  await until('ordinary foreground contact with empty SQLite', () => find('.ws-session-list')?.textContent.includes(foregroundContact));
  await click('#wsVisibleContactDirectory summary');
  pickerVisible = true;
  await click('#wsVisibleContactDirectory [data-ws-action="refresh-visible-contacts"]');
  await until('contact picker result', () => find('#wsVisibleContactDirectory details[open] li')?.textContent.includes(pickerContact));
  const preservedList = find('.ws-session-list').textContent;
  const contactsSeparate = preservedList.includes(foregroundContact) && !preservedList.includes(pickerContact) && !find('#wsVisibleContactDirectory li button');
  const directoryGapVisible = find('#wsDirectoryCount')?.textContent.includes('部分会话未能识别');
  onStatus({ ...groupEvent, scanId: 2 });
  const ordinaryList = find('.ws-session-list').textContent;
  const ordinaryIsolated = !ordinaryList.includes(foregroundGroup) && !ordinaryList.includes('目录回归群');
  await click('.ws-workspace-nav [data-ws-workspace-mode="dedicated"]');
  await click(nav + '[data-ws-workspace-view="groups"]');
  loginForeground(dedicated.id, 'dedicated');
  const dedicatedList = await until('restore dedicated foreground directory after switching accounts', () => {
    const value = find('[data-ws-workspace-page="groups"]')?.textContent;
    return value?.includes(foregroundGroup) && value;
  });
  const isolated = ordinaryIsolated && !dedicatedList.includes(foregroundContact);
  return { pages, shortcuts, accountScoped, visibleOpens, collector: {
    scoped: collectorCalls.every(call => call.accountId === dedicated.id),
    loginVisible: !login.bounds.hidden && login.bounds.width > 200 && login.bounds.height > 100,
    discoveredBeforePairing, directoryVisible: true, bothForegroundDirectories: foregroundReads.includes('default') && foregroundReads.includes(dedicated.id),
    isolated, localIndexReads: directoryReads > 0, contactsSeparate, directoryGapVisible,
  } };
}

module.exports = { exerciseDedicatedWorkspace };
