(() => {
  const core = window.ZhikeWsCore;
  const getHost = () => window.__zhikeRegistryHost;
  const readPanelCollapsed = panel => {
    try { return localStorage.getItem(`zhike.ws.${panel}.collapsed`) === 'true'; } catch { return false; }
  };
  const writePanelCollapsed = (panel, value) => {
    try { localStorage.setItem(`zhike.ws.${panel}.collapsed`, String(Boolean(value))); } catch {}
  };
  const esc = value => getHost()?.esc?.(value) || String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const nowIso = () => new Date().toISOString();
  const text = value => String(value == null ? '' : value).trim();
  const state = {
    active: false,
    accounts: [],
    activeAccountId: 'default',
    accountBusy: false,
    accountFormOpen: false,
    accountFormName: '',
    accountFormError: '',
    accountLoadSequence: 0,
    pendingRestoreAccountId: '',
    currentConversationId: '',
    conversations: [],
    messages: [],
    replies: [],
    settings: core.normalizeTranslationSettings({}),
    aiEnabled: true,
    wsStatus: '未连接',
    wsDetail: '',
    analysis: null,
    analysisMeta: null,
    aiBusy: false,
    translationBusy: new Set(),
    busy: { import: false, customer: false, followup: false, reply: false, capture: false, connection: false },
    leftCollapsed: readPanelCollapsed('left'),
    rightCollapsed: readPanelCollapsed('right'),
    mobilePanel: 'center',
    captureDirection: 'receive',
    conversationQuery: '',
    translationStatus: '翻译服务未检测',
    loading: false,
    accountsLoading: false,
    lastLoadedAt: '',
    drafts: new Map(),
    matchCandidates: [],
    createExternalId: '',
    createTitle: '',
    error: '',
    collectionRun: null,
    followupAlerts: [],
    discoveredConversations: [],
    visibleConversationFingerprint: '',
    collectionRefreshing: false,
    collectionRefreshQueued: false,
    autoCaptureSignature: '',
    previewAnalysisSignatures: new Map(),
    previewAnalysisQueue: [],
    listSyncBusy: false,
  };
  let rendering = false;
  let observer;
  let browserResizeObserver;
  let settingsSaveTimer;
  let settingsSaveSequence = 0;
  let collectionRefreshTimer;
  let autoCaptureTimer;
  let loadSequence = 0;

  function activeAccount() {
    return state.accounts.find(item => String(item.id) === String(state.activeAccountId)) || null;
  }
  function accountStatusLabel(account) {
    return account?.status || (String(account?.id) === 'default' ? '未连接' : '未连接');
  }
  function accountDisplayName(account) {
    return text(account?.displayName || account?.id || 'WS 账号');
  }
  function accountStorageKey() { return 'zhike.ws.activeAccountId'; }
  function readStoredAccountId() {
    try { return text(localStorage.getItem(accountStorageKey())) || 'default'; } catch { return 'default'; }
  }
  function writeStoredAccountId(id) { try { localStorage.setItem(accountStorageKey(), String(id || 'default')); } catch {} }
  function captureContext(conversationId = state.currentConversationId) {
    return { accountId: String(state.activeAccountId || 'default'), conversationId: String(conversationId || ''), sequence: Number(state.accountLoadSequence || 0) };
  }
  function contextCurrent(context) {
    return core.contextCurrent(context, { accountId: state.activeAccountId, conversationId: state.currentConversationId, sequence: state.accountLoadSequence });
  }
  function assertContext(context) { if (!contextCurrent(context)) throw new Error('WS 账号已切换，已丢弃过期操作。'); }
  async function loadAccounts() {
    const sequence = ++state.accountLoadSequence;
    state.accountsLoading = true;
    state.error = '';
    render();
    try {
      const result = await core.retryTransient(async () => {
        if (!window.zhikeDesktop?.wsAccounts) throw new Error('当前页面没有桌面 WS 账号能力。');
        const response = await window.zhikeDesktop.wsAccounts({ action: 'list' });
        if (!response || !Array.isArray(response.accounts)) throw new Error('WS 账号列表暂未准备好。');
        return response;
      }, { attempts: 6, delayMs: attempt => Math.min(1200, 100 * (2 ** attempt)) });
      if (sequence !== state.accountLoadSequence && !state.pendingRestoreAccountId) return;
      state.accounts = Array.isArray(result?.accounts) ? result.accounts : [];
      const stored = readStoredAccountId();
      const pending = state.pendingRestoreAccountId;
      const preferred = pending || stored;
      if (state.accounts.some(item => String(item.id) === preferred)) state.activeAccountId = preferred;
      else if (state.accounts.some(item => String(item.id) === 'default')) {
        state.activeAccountId = 'default';
        if (pending) state.error = 'WS 上一个账号已不存在，已切换到默认账号；请重新添加并登录。';
      }
      state.pendingRestoreAccountId = '';
      writeStoredAccountId(state.activeAccountId);
      const active = activeAccount();
      if (active) {
        try {
          const status = await window.zhikeDesktop.ws({ action: 'status', accountId: active.id });
          updateAccountStatus(status);
        } catch {}
      }
    } catch (error) {
      if (sequence === state.accountLoadSequence) state.error = error.message || 'WS 账号列表加载失败。';
    } finally {
      if (sequence === state.accountLoadSequence) { state.accountsLoading = false; render(); }
    }
  }
  function updateAccountStatus(payload) {
    const id = text(payload?.accountId);
    if (!id) return;
    state.accounts = state.accounts.map(item => String(item.id) === id ? { ...item, status: payload.status || item.status, statusDetail: payload.detail || item.statusDetail } : item);
    if (id === String(state.activeAccountId) && payload.status) setStatus(payload.status, payload.detail || '');
    const host = getHost();
    if (state.active && host?.state?.view === 'ws-workbench') render();
  }
  function openAccountForm() {
    if (state.accountBusy) return;
    state.accountFormOpen = true;
    state.accountFormName = '';
    state.accountFormError = '';
    state.error = '';
    render();
    requestAnimationFrame(() => $('#wsAccountDisplayName')?.focus());
  }
  function cancelAccountForm() {
    if (state.accountBusy) return;
    state.accountFormOpen = false;
    state.accountFormName = '';
    state.accountFormError = '';
    render();
  }
  async function createAccount() {
    if (state.accountBusy) return;
    const displayName = text(state.accountFormName || $('#wsAccountDisplayName')?.value);
    if (!displayName) {
      state.accountFormError = '请输入本机显示名称。';
      render();
      requestAnimationFrame(() => $('#wsAccountDisplayName')?.focus());
      return;
    }
    if (displayName.length > 80) {
      state.accountFormError = '显示名称最多 80 个字符。';
      render();
      requestAnimationFrame(() => $('#wsAccountDisplayName')?.focus());
      return;
    }
    state.accountBusy = true; render();
    try {
      const id = `ws-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
      const result = await window.zhikeDesktop.wsAccounts({ action: 'create', account: { id, displayName, provider: 'WhatsApp Web', origin: 'https://web.whatsapp.com', status: '未连接' } });
      if (!result?.account?.id) throw new Error('WS 账号创建没有返回有效账号。');
      state.accounts = [...state.accounts, result.account];
      state.accountFormOpen = false;
      state.accountFormName = '';
      state.accountFormError = '';
      await switchAccount(result.account.id);
      toast('已添加 WS 账号，请在中栏完成扫码或登录。');
    } catch (error) {
      state.accountFormError = error.message || 'WS 账号创建失败。';
      toast(state.accountFormError, 'x');
    }
    finally { state.accountBusy = false; render(); }
  }
  async function switchAccount(accountId) {
    const id = text(accountId) || 'default';
    if (id === String(state.activeAccountId)) return;
    if (!state.accounts.some(item => String(item.id) === id)) return;
    const previous = state.activeAccountId;
    const sequence = ++state.accountLoadSequence;
    state.accountBusy = true;
    state.collectionRefreshing = false;
    state.collectionRefreshQueued = false;
    state.autoCaptureSignature = '';
    state.previewAnalysisSignatures.clear();
    state.previewAnalysisQueue = [];
    state.listSyncBusy = false;
    state.visibleConversationFingerprint = '';
    clearTimeout(settingsSaveTimer); settingsSaveTimer = undefined; ++settingsSaveSequence;
    state.busy.import = false; state.busy.customer = false; state.busy.followup = false; state.busy.connection = false; state.busy.reply = false; state.busy.capture = false; state.aiBusy = false; state.translationBusy.clear();
    state.activeAccountId = id;
    state.currentConversationId = '';
    state.conversations = []; state.messages = []; state.analysis = null; state.analysisMeta = null; state.replies = [];
    writeStoredAccountId(id); render();
    try {
      await window.zhikeDesktop.ws({ action: 'open', accountId: id, bounds: boundsForBrowserView() });
      if (sequence !== state.accountLoadSequence) return;
      await loadConversations();
      state.error = '';
    } catch (error) {
      state.activeAccountId = previous;
      writeStoredAccountId(previous);
      state.error = error.message || 'WS 账号切换失败，已恢复原账号。';
      try { await window.zhikeDesktop.ws({ action: 'open', accountId: previous, bounds: boundsForBrowserView() }); } catch {}
      await loadConversations();
    } finally { state.accountBusy = false; render(); }
  }

  function toast(message, icon = 'check') { getHost()?.toast?.(message, icon); }
  function activeConversation() { return state.conversations.find(item => String(item.id) === String(state.currentConversationId)) || null; }
  function stableHash(value) { return core.stableHash(value); }
  function visibleConversationFingerprint(items) {
    const rows = (Array.isArray(items) ? items : []).map(item => [
      text(item?.externalId || ''),
      text(item?.title || ''),
      text(item?.preview || '').slice(0, 400),
      Number(item?.unreadCount || 0),
    ]).sort((left, right) => left[0].localeCompare(right[0]));
    return stableHash(JSON.stringify(rows));
  }
  function translationBusyKey(messageId, context = captureContext()) { return `${context.accountId}:${context.conversationId || state.currentConversationId}:${String(messageId)}`; }
  function blankDraft() {
    return {
      captureText: '',
      customerName: '',
      customerPhone: '',
      customerCountry: '',
      customerLanguage: '',
      customerProduct: '',
      customerBudget: '',
      customerStage: '',
      customerIntent: '',
      customerTags: '',
      customerNote: '',
      followupNote: '',
      nextFollow: '',
      replyInput: '',
      replyPreview: '',
      replyPreviewSource: '',
      replyPreviewLanguage: '',
      replyError: '',
      replyOperationId: '',
    };
  }
  function currentDraft() {
    const key = `${state.activeAccountId || 'default'}:${String(state.currentConversationId || '__new__')}`;
    if (!state.drafts.has(key)) state.drafts.set(key, blankDraft());
    return state.drafts.get(key);
  }
  function seedDraftFromAnalysis() {
    const draft = currentDraft();
    const analysis = state.analysis || {};
    const contact = analysis.contact || {};
    const current = activeConversation();
    if (!draft.customerName) draft.customerName = contact.name || current?.title || '';
    if (!draft.customerPhone) draft.customerPhone = contact.phone || '';
    if (!draft.customerCountry) draft.customerCountry = contact.country || analysis.country || '';
    if (!draft.customerLanguage) draft.customerLanguage = analysis.language || current?.language || '';
    if (!draft.customerProduct) draft.customerProduct = Array.isArray(analysis.productInterest) ? analysis.productInterest.join('、') : analysis.productInterest || '';
    if (!draft.customerBudget) draft.customerBudget = analysis.budget || '';
    if (!draft.customerStage) draft.customerStage = analysis.customerStage || '';
    if (!draft.customerIntent) draft.customerIntent = analysis.intent || '';
    if (!draft.customerTags) draft.customerTags = Array.isArray(analysis.tags) ? analysis.tags.join('、') : '';
    if (!draft.customerNote) draft.customerNote = analysis.summary || '';
    if (!draft.nextFollow) draft.nextFollow = core.suggestedDate(analysis.followupTime);
  }
  async function api(pathname, init = {}, context = null) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Number(init.timeout) || 20000);
    try {
      const accountId = String(context?.accountId || state.activeAccountId || 'default');
      const url = new URL(pathname, window.location.origin);
      if (url.pathname.startsWith('/api/ws/') && !url.searchParams.has('accountId')) url.searchParams.set('accountId', accountId);
      const nextInit = { ...init };
      if (nextInit.body && typeof nextInit.body === 'string' && /^\s*\{/.test(nextInit.body)) {
        try { nextInit.body = JSON.stringify({ ...JSON.parse(nextInit.body), accountId }); } catch {}
      }
      const response = await fetch(url.pathname + url.search + url.hash, {
        cache: 'no-store',
        ...nextInit,
        signal: controller.signal,
        headers: { 'Content-Type': 'application/json', ...(nextInit.headers || {}) },
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || 'WS 本机数据服务暂不可用。');
      return body;
    } catch (error) {
      if (error?.name === 'AbortError') throw new Error('WS 本机数据服务响应超时，请重试。');
      throw error;
    } finally { clearTimeout(timer); }
  }
  function boundsForBrowserView() {
    const node = $('#wsBrowserHost');
    if (!node) return { hidden: true };
    const rect = node.getBoundingClientRect();
    const style = getComputedStyle(node);
    const hidden = !state.active || style.display === 'none' || style.visibility === 'hidden' || rect.width < 40 || rect.height < 40;
    return { hidden, x: Math.round(rect.left), y: Math.round(rect.top), width: Math.round(rect.width), height: Math.round(rect.height) };
  }
  async function wsBridge(action, context = null) {
    if (!window.zhikeDesktop?.ws) throw new Error('当前页面没有桌面 WS 视图能力，请从知客安装版打开。');
    return window.zhikeDesktop.ws({ action, accountId: context?.accountId || state.activeAccountId || 'default', bounds: boundsForBrowserView() });
  }
  function updateStatusDom() {
    const badge = $('#wsStatusBadge');
    if (badge) { badge.textContent = state.wsStatus; badge.dataset.status = state.wsStatus; }
    const detail = $('#wsStatusDetail');
    if (detail) detail.textContent = state.wsDetail || (state.wsStatus === '已连接' ? '已通过页面结构确认 WS 主界面；未读取 Cookie 或消息正文。' : '请在中栏自行完成扫码或登录。');
  }
  function setStatus(status, detail = '') {
    state.wsStatus = status || '未连接';
    state.wsDetail = detail;
    updateStatusDom();
  }
  async function resizeWsView() {
    if (!state.active) return;
    const bounds = boundsForBrowserView();
    await wsBridge(bounds.hidden ? 'hide' : 'resize').catch(() => {});
  }
  async function connectionAction(action) {
    if (state.busy.connection) return;
    if (action === 'clear-session' && !confirm('清除本机 WS 会话后需要重新扫码或登录。客户资料、翻译、AI 分析和跟进记录不会删除。确认继续？')) return;
    const context = captureContext('');
    state.busy.connection = true;
    try {
      const result = await wsBridge(action, context);
      assertContext(context);
      setStatus(result.status || (action === 'reconnect' ? '正在重连' : action === 'close' || action === 'clear-session' ? '未连接' : '等待登录'), result.detail || '');
      if (action === 'clear-session') toast('WS 隔离登录会话已清除，本地业务记录仍保留');
      else if (action === 'close') toast('WS 页面已关闭，本地业务记录仍保留');
      else if (action === 'probe') toast('WS 登录状态已重新检测');
      else toast('WS 页面已打开，请自行扫码或登录');
    } catch (error) {
      if (contextCurrent(context)) { setStatus('连接失败', error.message); toast(error.message, 'x'); }
    } finally {
      if (contextCurrent(context)) { state.busy.connection = false; render(); }
    }
  }

  async function loadConversations() {
    const sequence = ++loadSequence;
    const accountId = String(state.activeAccountId || 'default');
    const context = captureContext('');
    state.loading = true;
    state.error = '';
    render();
    try {
      const [result, runResult, alertResult] = await Promise.all([
        api('/api/ws/conversations?limit=200', {}, context),
        api('/api/ws/collection-runs', {}, context).catch(() => null),
        api('/api/ws/followup-alerts?limit=8', {}, context).catch(() => null),
      ]);
      if (sequence !== loadSequence || !contextCurrent(context)) return;
      if (runResult) { assertContext(context); state.collectionRun = runResult.run || null; }
      if (alertResult) { assertContext(context); state.followupAlerts = alertResult.alerts || []; }
      state.conversations = Array.isArray(result.conversations) ? result.conversations : [];
      if (!state.currentConversationId && state.conversations[0]) state.currentConversationId = state.conversations[0].id;
      if (state.currentConversationId) await loadConversationData(state.currentConversationId, false, { ...context, conversationId: String(state.currentConversationId) });
      assertContext(context);
      state.lastLoadedAt = nowIso();
    } catch (error) {
      if (sequence === loadSequence && contextCurrent(context)) state.error = error.message;
    } finally {
      if (sequence === loadSequence && contextCurrent(context)) { state.loading = false; render(); }
    }
  }
  async function refreshCollectionSummary() {
    if (!state.active) return;
    if (state.loading || state.collectionRefreshing) { state.collectionRefreshQueued = true; return; }
    const context = captureContext();
    state.collectionRefreshing = true;
    try {
      const [result, run, alerts] = await Promise.all([
        api('/api/ws/conversations?limit=200', {}, context),
        api('/api/ws/collection-runs', {}, context),
        api('/api/ws/followup-alerts?limit=8', {}, context),
      ]);
      assertContext(context);
      state.conversations = Array.isArray(result.conversations) ? result.conversations : state.conversations;
      state.collectionRun = run.run || null;
      state.followupAlerts = alerts.alerts || [];
      let listSyncResult = { synced: 0, analyzed: 0 };
      if (state.wsStatus === '已连接' && (!state.collectionRun || !['paused', 'stopped', 'completed'].includes(state.collectionRun.status))) {
        const visible = await wsBridge('discover-conversations', context).catch(() => null);
        assertContext(context);
        if (visible?.supported) {
          const fingerprint = visibleConversationFingerprint(visible.conversations);
          if (fingerprint !== state.visibleConversationFingerprint) {
            if (visible.conversations?.length) await enqueueDiscoveredConversations(visible.conversations, false, context);
            state.visibleConversationFingerprint = fingerprint;
          }
          listSyncResult = await syncConversationListPreviews(visible.conversations, context);
          if (listSyncResult.synced) {
            const refreshedAlerts = await api('/api/ws/followup-alerts?limit=8', {}, context);
            assertContext(context);
            state.followupAlerts = refreshedAlerts.alerts || [];
          }
        }
      }
      assertContext(context);
      render();
    } catch (error) { if (contextCurrent(context) && error?.message && !/过期操作/.test(error.message)) state.error = error.message; } finally {
      if (contextCurrent(context)) {
        state.collectionRefreshing = false;
        if (state.collectionRefreshQueued && state.active && !state.loading) {
          state.collectionRefreshQueued = false;
          queueMicrotask(() => { void refreshCollectionSummary(); });
        }
      }
    }
  }
  async function enqueueDiscoveredConversations(items, announce = true, context = captureContext()) {
    if (!Array.isArray(items) || !items.length) return 0;
    assertContext(context);
    if (!state.collectionRun) {
      const runResult = await api('/api/ws/collection-runs', { method: 'POST', body: JSON.stringify({}) }, context);
      assertContext(context);
      state.collectionRun = runResult.run;
    }
    let queued = 0;
    for (const item of items) {
      const normalized = normalizeListItem(item);
      const legacy = state.conversations.find(row => [`list-item-${normalized.index}`, `visible-${normalized.index}`].includes(String(row.externalId || '')));
      const externalId = text(normalized.externalId || legacy?.externalId || `visible-${normalized.index}`); const title = text(normalized.title || externalId);
      const preview = listPreviewText(normalized);
      const match = core.matchCustomer(getHost()?.state?.customers || [], {
        wsExternalId: externalId,
        wsAccountId: context.accountId,
        phone: core.extractPhone(`${externalId} ${title} ${preview}`),
      });
      const matchedCustomerId = match?.kind === 'phone' || match?.kind === 'ws-id' || match?.kind === 'account' ? String(match.customer?.id || '') : '';
      assertContext(context);
      const conversation = await api('/api/ws/conversations', { method: 'POST', body: JSON.stringify({ externalId, title, customerId: matchedCustomerId, lastMessageText: preview, unreadCount: Number(item.unreadCount || 0), data: { discovery: 'visible-page', previewOnly: true, historyLoaded: false, customerMatch: matchedCustomerId ? 'automatic' : 'pending' } }) }, context);
      assertContext(context);
      await api('/api/ws/collection-items', { method: 'POST', body: JSON.stringify({ runId: state.collectionRun.id, conversationId: conversation.id, status: 'queued' }) }, context);
      assertContext(context);
      queued += 1;
    }
    assertContext(context);
    const refreshed = await api('/api/ws/conversations?limit=200', {}, context);
    assertContext(context);
    state.conversations = refreshed.conversations || state.conversations;
    if (announce) toast(`已发现 ${items.length} 个会话，入队 ${queued} 个`);
    return queued;
  }
  function splitListPreview(value) {
    const normalized = text(value).replace(/[\u200e\u200f\u202a-\u202e]/g, '').replace(/\s+/g, ' ').trim();
    const withoutUnread = normalized.replace(/^\d+\s*条未读消息\s*/, '').trim();
    const stripSystemNotice = input => text(input)
      .replace(/\s*此聊天中的新消息将在发送(?:7|90)天后自动消失(?:（除非消息已保留）)?。?\s*$/g, '')
      .replace(/\s*\d+\s*条未读消息\s*/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    const cleanRow = stripSystemNotice(withoutUnread);
    const marker = cleanRow.search(/\s+(?:(?:凌晨|早上|上午|中午|下午|晚上)\s*\d{1,2}:\d{2}|星期[一二三四五六日天]|昨天|今天|前天|\d{4}年\d{1,2}月\d{1,2}日)\s+/);
    if (marker < 0) return { title: cleanRow, preview: '' };
    const title = cleanRow.slice(0, marker).trim();
    const preview = stripSystemNotice(cleanRow.slice(marker).replace(/^\s+(?:(?:凌晨|早上|上午|中午|下午|晚上)\s*\d{1,2}:\d{2}|星期[一二三四五六日天]|昨天|今天|前天|\d{4}年\d{1,2}月\d{1,2}日)\s+/, ''));
    return { title, preview };
  }
  function normalizeListItem(item) {
    const declaredTitle = text(item?.title);
    const listText = text(item?.listText).replace(/[\u200e\u200f\u202a-\u202e]/g, '').replace(/\s+/g, ' ').trim();
    const parts = splitListPreview(listText || declaredTitle || item?.preview || '');
    const cleanText = value => text(value)
      .replace(/\s*此聊天中的新消息将在发送(?:7|90)天后自动消失(?:（除非消息已保留）)?。?\s*$/g, '')
      .replace(/\s*\d+\s*条未读消息\s*/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    const explicitPreview = cleanText(item?.previewText);
    const itemPreview = cleanText(item?.preview);
    let title = cleanText(declaredTitle || parts.title);
    let preview = parts.preview || (explicitPreview && explicitPreview !== title ? explicitPreview : '') || (itemPreview && itemPreview !== title ? itemPreview : '');
    if (preview && title.toLocaleLowerCase().endsWith(preview.toLocaleLowerCase()) && title.length > preview.length) title = title.slice(0, -preview.length).trim();
    // WhatsApp's row-level accessibility text sometimes omits the date marker
    // from listText, while title and preview are still available separately.
    // Prefer the declared title and strip it from the combined row text.
    if (!preview && listText && title && listText !== title) {
      const lowerListText = listText.toLocaleLowerCase();
      const lowerTitle = title.toLocaleLowerCase();
      const stripped = lowerListText.startsWith(lowerTitle) ? listText.slice(title.length).trim() : '';
      if (stripped && stripped !== title) preview = cleanText(stripped);
    }
    const previewText = cleanText(preview);
    return { ...item, title: cleanText(title || listText), previewText, preview: previewText };
  }
  function listPreviewText(item, fallbackTitle = '') {
    const normalized = normalizeListItem(item);
    const title = text(normalized?.title);
    const explicit = text(normalized?.previewText);
    const listText = text(normalized?.listText);
    const fallback = text(normalized?.preview).replace(title, '').trim();
    const knownTitle = text(fallbackTitle);
    let fromKnownTitle = '';
    if (listText && knownTitle && listText.toLocaleLowerCase().startsWith(knownTitle.toLocaleLowerCase())) {
      fromKnownTitle = listText.slice(knownTitle.length).trim();
    }
    if (!fromKnownTitle && knownTitle && title && title.toLocaleLowerCase().startsWith(knownTitle.toLocaleLowerCase()) && title.length > knownTitle.length) {
      fromKnownTitle = title.slice(knownTitle.length).trim();
    }
    const fromDeclaredTitle = listText && title && listText.toLocaleLowerCase().startsWith(title.toLocaleLowerCase()) ? listText.slice(title.length).trim() : '';
    return (explicit || fallback || fromKnownTitle || fromDeclaredTitle || (title !== listText ? listText.replace(title, '').trim() : '')).slice(0, 4000);
  }
  function listPreviewFingerprint(item, preview) {
    return stableHash(JSON.stringify([text(item?.externalId), preview, text(item?.lastMessageAt), text(item?.previewDirection || 'receive')]));
  }
  async function analyzeStoredConversation(conversation, context) {
    if (!state.aiEnabled) return { ok: false, reason: 'AI 分析已关闭。', disabled: true };
    if (!window.zhikeAI?.request || !window.zhikeAI?.status) return { ok: false, reason: '当前运行环境不支持 AI 安全桥接。' };
    if (!conversation?.id) return { ok: false, reason: '缺少会话标识。' };
    let messagesResult;
    try { messagesResult = await api(`/api/ws/messages?conversationId=${encodeURIComponent(conversation.id)}&limit=500`, {}, context); }
    catch (error) { return { ok: false, reason: `读取会话消息失败：${error.message || '本机接口异常'}` }; }
    const messages = core.dedupeMessages(messagesResult.messages || []);
    if (!messages.length) return { ok: false, reason: '当前会话暂无可分析消息。' };
    const transcript = core.buildTranscript(messages, { maxChars: 8200, maxMessages: 40 });
    const service = await window.zhikeAI.status().catch(() => ({ configured: false }));
    if (!service.configured) return { ok: false, reason: 'AI 服务未配置，请先在 GPT 运营助手中配置 TeamoRouter 或 OpenAI。' };
    try {
      const result = await window.zhikeAI.request({
        assistantMode: 'operations',
        analysisDepth: 'standard',
        input: '只分析下面当前 WS 会话文本。只返回一个 JSON 对象，不要 Markdown，不要编造未出现的资料。字段必须包含 summary、intent、intentScore、emotion、urgency、language、needs（数组）、productInterest（数组）、budget、contact（对象，含 name/phone/country/account）、tags（数组）、customerStage、nextStep、followupTime、replySuggestion、confidence（0 到 1）。\n' + transcript.text,
        context: { feature: 'ws-list-preview-analysis', conversationId: conversation.id, title: conversation.title || '', includedMessages: transcript.included, truncated: transcript.truncated },
      });
      const analysis = core.parseAiResult(result?.text || '');
      analysis.providerName = result.providerName || '';
      analysis.model = result.model || '';
      analysis.transcriptInfo = transcript;
      await api('/api/ws/analyses', { method: 'POST', body: JSON.stringify({ conversationId: conversation.id, result: analysis, confidence: analysis.confidence, providerName: analysis.providerName, model: analysis.model }) }, context);
      if (state.collectionRun?.id) await api('/api/ws/collection-items', { method: 'PATCH', body: JSON.stringify({
        runId: state.collectionRun.id,
        conversationId: conversation.id,
        status: 'completed',
        analysisStatus: 'completed',
        coverageStatus: 'list-preview',
        lastError: '',
      }) }, context).catch(() => {});
      return { ok: true };
    } catch (error) {
      const message = String(error?.message || 'AI 分析请求失败').replace(/[\r\n\t]+/g, ' ').slice(0, 300);
      return { ok: false, reason: message || 'AI 分析请求失败。' };
    }
  }
  async function markAnalysisRetryable(conversation, context, reason) {
    if (!state.collectionRun?.id || !conversation?.id) return;
    // Keep the preview eligible for the next background poll. The signature is
    // only committed after a successful analysis; transient AI/network errors
    // must not permanently suppress follow-up analysis and reminders.
    state.previewAnalysisSignatures.delete(String(conversation.id));
    await api('/api/ws/collection-items', { method: 'PATCH', body: JSON.stringify({
      runId: state.collectionRun.id,
      conversationId: conversation.id,
      status: 'completed',
      analysisStatus: 'retryable',
      coverageStatus: 'list-preview',
      lastError: String(reason || 'AI 分析待重试').slice(0, 500),
    }) }, context).catch(() => {});
  }
  async function syncConversationListPreviews(items, context = captureContext()) {
    if (state.listSyncBusy || !Array.isArray(items) || !items.length) return { synced: 0, analyzed: 0 };
    state.listSyncBusy = true;
    let synced = 0, analyzed = 0;
    try {
      const byExternal = new Map(state.conversations.map(item => [String(item.externalId || ''), item]));
      for (const rawItem of items.slice(0, 500)) {
        assertContext(context);
        const item = normalizeListItem(rawItem);
        const legacyByIndex = new Map(state.conversations.filter(row => /^(?:list-item|visible)-\d+$/.test(String(row.externalId || ''))).map(row => [Number(String(row.externalId).split('-').at(-1)), row]));
        const legacy = legacyByIndex.get(Number(item?.index));
        const externalId = text(item?.externalId || legacy?.externalId || `visible-${item?.index}`);
        const conversation = byExternal.get(externalId) || legacy;
        const preview = listPreviewText(item, conversation?.lastMessageText || conversation?.title || '');
        if (!externalId || !preview || !conversation) continue;
        const fingerprint = listPreviewFingerprint(item, preview);
        const messageExternalId = `list-preview-${fingerprint}`;
        const result = await api('/api/ws/messages/batch', { method: 'POST', timeout: 30000, body: JSON.stringify({ conversationId: conversation.id, fingerprint: `list-preview-${fingerprint}`, messages: [{ externalId: messageExternalId, direction: item.previewDirection === 'send' ? 'send' : 'receive', originalText: preview, order: Date.now(), data: { source: 'ws-list-preview', previewOnly: true, listText: text(item.listText).slice(0, 2000), lastMessageAt: text(item.lastMessageAt), fingerprint } }] }) }, context);
        assertContext(context);
        const inserted = Number(result.inserted || 0);
        const updated = Number(result.updated || 0);
        // A repeated fingerprint still means the list preview is valid. Mark
        // the collection item complete even when the message was already stored.
        if (!inserted && !updated && !Number(result.existed || 0)) continue;
        synced += Math.max(1, inserted + updated);
        const refreshedConversation = state.conversations.find(row => String(row.id) === String(conversation.id));
        if (refreshedConversation) { refreshedConversation.lastMessageText = preview; refreshedConversation.lastMessageAt = nowIso(); refreshedConversation.updatedAt = refreshedConversation.lastMessageAt; }
        const previewSignatureKey = String(conversation.id);
        const previewChanged = state.previewAnalysisSignatures.get(previewSignatureKey) !== fingerprint;
        // A repeated list refresh must not downgrade an already analyzed item
        // back to pending. Only a new preview fingerprint starts a fresh AI run.
        if (state.collectionRun?.id) {
          const itemPatch = { runId: state.collectionRun.id, conversationId: conversation.id, status: 'completed', coverageStatus: 'list-preview', checkpoint: fingerprint };
          if (previewChanged) itemPatch.analysisStatus = 'pending';
          await api('/api/ws/collection-items', { method: 'PATCH', body: JSON.stringify(itemPatch) }, context).catch(() => {});
        }
        if (previewChanged) {
          state.previewAnalysisSignatures.set(previewSignatureKey, fingerprint);
          if (state.aiEnabled && window.zhikeAI?.request) state.previewAnalysisQueue.push({ conversation, fingerprint });
        }
      }
      for (let budget = 0; budget < 5 && state.previewAnalysisQueue.length; budget += 1) {
        const task = state.previewAnalysisQueue.shift();
        const analysis = await analyzeStoredConversation(task.conversation, context);
        if (analysis.ok) analyzed += 1;
        else if (!analysis.disabled) await markAnalysisRetryable(task.conversation, context, analysis.reason);
      }
      if (synced) {
        if (state.collectionRun?.id) {
          const itemsResult = await api(`/api/ws/collection-items?runId=${encodeURIComponent(state.collectionRun.id)}`, {}, context).catch(() => ({ items: [] }));
          const items = Array.isArray(itemsResult.items) ? itemsResult.items : [];
          const completed = items.filter(item => item.status === 'completed').length;
          const analyzedItems = items.filter(item => item.analysisStatus === 'completed').length;
          const failed = items.filter(item => item.status === 'failed').length;
          const retryable = items.filter(item => ['failed', 'retryable'].includes(item.status) || ['retryable', 'failed'].includes(item.analysisStatus)).length;
          const runResult = await api('/api/ws/collection-runs', { method: 'PATCH', body: JSON.stringify({ id: state.collectionRun.id, status: 'discovering', total: items.length, discovered: items.length, completed, analyzed: Math.max(analyzedItems, analyzed), failed, retryable, cursor: JSON.stringify({ mode: 'list-preview', synced, analyzed, syncedAt: nowIso() }), lastSuccessAt: nowIso() }) }, context).catch(() => null);
          if (runResult?.run) state.collectionRun = runResult.run;
        }
        const refreshed = await api('/api/ws/conversations?limit=200', {}, context);
        assertContext(context);
        state.conversations = refreshed.conversations || state.conversations;
      }
      return { synced, analyzed };
    } finally { state.listSyncBusy = false; }
  }
  async function createCollectionRun() {
    const context = captureContext();
    try {
      const result = await api('/api/ws/collection-runs', { method: 'POST', body: JSON.stringify({}) }, context);
      assertContext(context);
      state.collectionRun = result.run;
      toast('已创建采集任务，请开始读取 WhatsApp Web 会话'); render();
    } catch (error) { if (contextCurrent(context)) { state.error = error.message; render(); } }
  }
  async function updateCollectionRun(status) {
    if (!state.collectionRun?.id) return;
    const context = captureContext();
    const runId = state.collectionRun.id;
    try {
      const result = await api('/api/ws/collection-runs', { method: 'PATCH', body: JSON.stringify({ id: runId, status }) }, context);
      assertContext(context);
      state.collectionRun = result.run;
      toast(status === 'paused' ? '采集已暂停' : status === 'stopped' ? '采集已停止' : '采集已继续'); render();
      if (status === 'running') await resumeCollectionFromCheckpoint(context);
    } catch (error) { if (contextCurrent(context)) { state.error = error.message; render(); } }
  }
  async function resumeCollectionFromCheckpoint(context = captureContext()) {
    if (!state.collectionRun?.id || !['running','discovering'].includes(state.collectionRun.status) || state.wsStatus !== '已连接') return;
    assertContext(context);
    const visible = await wsBridge('discover-conversations', context).catch(() => null);
    assertContext(context);
    if (!visible?.supported) return;
    const items = Array.isArray(visible.conversations) ? visible.conversations : [];
    if (items.length) await enqueueDiscoveredConversations(items, false, context);
    const listSync = await syncConversationListPreviews(items, context);
    if (listSync.synced) state.followupAlerts = (await api('/api/ws/followup-alerts?limit=8', {}, context)).alerts || state.followupAlerts;
    const cursor = JSON.stringify({ lastExternalId: text(items.at(-1)?.externalId || ''), discovered: items.length, scannedAt: nowIso() });
    const result = await api('/api/ws/collection-runs', { method: 'PATCH', body: JSON.stringify({ id: state.collectionRun.id, status: 'discovering', discovered: Math.max(Number(state.collectionRun.discovered || 0), items.length), total: Math.max(Number(state.collectionRun.total || 0), items.length), cursor, resumeCount: Number(state.collectionRun.resumeCount || 0) + 1, lastSuccessAt: nowIso() }) }, context);
    assertContext(context);
    state.collectionRun = result.run;
    state.discoveredConversations = items;
    state.visibleConversationFingerprint = visibleConversationFingerprint(items);
    render();
  }
  async function discoverConversations() {
    const context = captureContext();
    try {
      const result = await wsBridge('discover-conversations'); assertContext(context); if (!result?.supported) throw new Error(result?.error || '当前页面结构未识别'); state.discoveredConversations = result.conversations || [];
      const queued = await enqueueDiscoveredConversations(state.discoveredConversations, false, context);
      const listSync = await syncConversationListPreviews(state.discoveredConversations, context);
      assertContext(context);
      state.visibleConversationFingerprint = visibleConversationFingerprint(state.discoveredConversations);
      const runResult = await api('/api/ws/collection-runs', { method: 'PATCH', body: JSON.stringify({ id: state.collectionRun.id, status: 'discovering', discovered: state.discoveredConversations.length, total: state.discoveredConversations.length, cursor: JSON.stringify({ lastExternalId: text(state.discoveredConversations.at(-1)?.externalId || ''), discovered: state.discoveredConversations.length, scannedAt: nowIso() }), lastSuccessAt: nowIso() }) }, context);
      assertContext(context);
      state.collectionRun = runResult.run;
      toast(`已发现 ${state.discoveredConversations.length} 个会话，入队 ${queued} 个${listSync.synced ? `，列表消息 ${listSync.synced} 条` : ''}`); render();
    }
    catch (error) { if (contextCurrent(context)) { state.error = error.message; render(); } }
  }
  async function captureVisibleMessages() {
    const current = activeConversation(); if (!current) { toast('请先选择一个本机会话', 'x'); return; }
    const context = captureContext(current.id);
    try {
      const result = await wsBridge('capture-visible-messages'); assertContext(context); if (!result?.supported || !result.messages?.length) throw new Error(result?.error || '当前页面没有可识别的可见消息');
      const draft = currentDraft(); draft.captureText = result.messages.map(item => item.text).join('\n'); state.captureDirection = 'receive'; render();
      await importVisible(context);
      assertContext(context);
      if (state.aiEnabled && state.messages.length) await analyzeConversation(context);
      if (state.collectionRun?.id) { await api('/api/ws/collection-items', { method: 'PATCH', body: JSON.stringify({ runId: state.collectionRun.id, conversationId: current.id, status: 'completed', analysisStatus: 'pending', coverageStatus: 'visible', checkpoint: String(result.messages.length) }) }, context); await api('/api/ws/collection-runs', { method: 'PATCH', body: JSON.stringify({ id: state.collectionRun.id, cursor: JSON.stringify({ conversationId: current.id, messageCount: result.messages.length, capturedAt: nowIso() }), lastSuccessAt: nowIso() }) }, context); }
      toast(`已采集当前会话 ${result.messages.length} 条可见消息`);
    } catch (error) {
      if (contextCurrent(context) && state.collectionRun?.id) { try { await api('/api/ws/collection-items', { method: 'PATCH', body: JSON.stringify({ runId: state.collectionRun.id, conversationId: current.id, status: 'failed', attempts: 1, lastError: error.message }) }, context); } catch {} }
      if (contextCurrent(context)) { state.error = error.message; render(); }
    }
  }
  async function autoCaptureCurrentConversation() {
    if (!state.active || state.wsStatus !== '已连接' || state.loading || state.busy.import || state.aiBusy) return;
    const current = activeConversation();
    if (!current || ['paused', 'stopped', 'completed'].includes(state.collectionRun?.status)) return;
    const context = captureContext(current.id);
    const result = await wsBridge('capture-visible-messages').catch(() => null);
    if (!contextCurrent(context)) return;
    if (!result?.supported || !result.messages?.length) return;
    const text = result.messages.map(item => item.text).join('\n').trim();
    if (!text || text === state.autoCaptureSignature) return;
    state.autoCaptureSignature = text;
    const draft = currentDraft();
    draft.captureText = text;
    state.captureDirection = 'receive';
    await importVisible(context);
    if (!contextCurrent(context)) return;
    if (state.aiEnabled && state.messages.length) await analyzeConversation(context);
    if (state.collectionRun?.id) { await api('/api/ws/collection-items', { method: 'PATCH', body: JSON.stringify({ runId: state.collectionRun.id, conversationId: current.id, status: 'completed', analysisStatus: state.aiEnabled ? 'completed' : 'pending', coverageStatus: 'visible', checkpoint: String(result.messages.length) }) }, context).catch(() => {}); await api('/api/ws/collection-runs', { method: 'PATCH', body: JSON.stringify({ id: state.collectionRun.id, cursor: JSON.stringify({ conversationId: current.id, messageCount: result.messages.length, capturedAt: nowIso() }), lastSuccessAt: nowIso() }) }, context).catch(() => {}); }
  }
  function renderFollowupAlerts() {
    const alerts = state.followupAlerts || [];
    if (!alerts.length) return '<p class="ws-muted">当前没有自动识别出的待跟进客户。</p>';
    return `<div class="ws-followup-alerts">${alerts.map(item => {
      const confidence = Math.round(Number(item.confidence || 0) * 100);
      return `<article class="ws-followup-alert ${esc(item.priority || 'today')}">
        <div class="ws-followup-alert-head"><strong>${esc(item.title || item.externalId || '未命名客户')}</strong><span>${esc(item.reason || item.intent || '建议跟进')}</span></div>
        <p>${esc(item.nextStep || item.summary || '请人工查看会话并确认下一步')}</p>
        <div class="ws-followup-alert-meta"><span>${item.followupTime ? `计划 ${esc(String(item.followupTime).slice(0, 16))}` : '未设置时间'}</span><span>置信度 ${confidence}%</span></div>
        <div class="ws-followup-alert-actions"><button class="btn small" data-ws-action="open-followup-alert" data-id="${esc(item.conversationId)}">查看会话</button><button class="btn small" data-ws-action="done-followup-alert" data-alert-id="${esc(item.id || '')}" data-alert-key="${esc(item.alertKey || '')}">已处理</button><button class="btn small" data-ws-action="snooze-followup-alert" data-alert-id="${esc(item.id || '')}" data-alert-key="${esc(item.alertKey || '')}">明日提醒</button><button class="btn small" data-ws-action="dismiss-followup-alert" data-alert-id="${esc(item.id || '')}" data-alert-key="${esc(item.alertKey || '')}">忽略</button></div>
      </article>`;
    }).join('')}</div>`;
  }
  async function updateFollowupAlert(element, status) {
    const context = captureContext();
    const snoozedUntil = status === 'snoozed' ? new Date(Date.now() + 86400000).toISOString() : '';
    try {
      const result = await api('/api/ws/followup-alerts', { method: 'PATCH', body: JSON.stringify({ id: text(element?.dataset?.alertId), alertKey: text(element?.dataset?.alertKey), status, snoozedUntil }) }, context);
      assertContext(context);
      const saved = result.alert;
      state.followupAlerts = state.followupAlerts.map(item => String(item.id) === String(saved.id) ? { ...item, status: saved.status, snoozedUntil: saved.snoozedUntil } : item).filter(item => !['done','dismissed'].includes(item.status));
      render();
      toast(status === 'done' ? '已标记为已处理' : status === 'snoozed' ? '已安排明日提醒' : '已忽略本条提醒');
    } catch (error) { if (contextCurrent(context)) toast(error.message, 'x'); }
  }
  function renderCollectionCard() {
    const run = state.collectionRun;
    if (!run) return `<section class="ws-card ws-collection-card"><div class="ws-card-heading"><div><strong>AI 跟进提醒</strong><span>列表级采集已开启，不打开会话也会同步最新预览</span></div></div>${renderFollowupAlerts()}<p class="ws-muted">创建采集任务后可持续更新会话、分析和提醒。</p><button class="btn small primary ws-full-button" data-ws-action="create-collection-run">创建采集任务</button></section>`;
    const pending = Math.max(0, run.total - run.completed - run.failed - run.skipped);
    const controls = run.status === 'paused' ? '<button class="btn small" data-ws-action="resume-collection">继续</button>' : ['created','running','discovering'].includes(run.status) ? '<button class="btn small" data-ws-action="pause-collection">暂停</button><button class="btn small danger" data-ws-action="stop-collection">停止</button>' : '';
    return `<section class="ws-card ws-collection-card"><div class="ws-card-heading"><div><strong>采集与跟进</strong><span>${esc(run.status)} · 列表级自动采集（无需打开会话） · 更新于 ${esc(displayTime(run.updatedAt))}${run.lastSuccessAt ? ` · 最近成功 ${esc(displayTime(run.lastSuccessAt))}` : ''}</span></div><div>${controls}${['running','discovering','paused'].includes(run.status) ? '<button class="btn small" data-ws-action="resume-collection-checkpoint">从断点继续</button>' : ''}<button class="btn small" data-ws-action="create-collection-run">新建任务</button></div></div><div class="ws-collection-stats"><b>${run.completed}/${run.total || run.discovered}</b><span>已采集</span><b>${run.analyzed}</b><span>已分析</span><b>${run.retryable}</b><span>待重试</span><b>${pending}</b><span>待处理</span><b>${run.resumeCount || 0}</b><span>续采次数</span></div>${run.lastError ? `<p class="ws-error-line">${esc(run.lastError)}</p>` : ''}${renderFollowupAlerts()}</section>`;
  }
  async function loadConversationData(id, redraw = true, parentContext = null) {
    const conversationId = String(id || '');
    const context = { ...(parentContext || captureContext(conversationId)), conversationId };
    if (context.sequence !== Number(state.accountLoadSequence || 0) || context.accountId !== String(state.activeAccountId || 'default')) return;
    state.currentConversationId = conversationId;
    state.analysis = null;
    state.analysisMeta = null;
    state.replies = [];
    state.matchCandidates = [];
    state.error = '';
    if (!state.currentConversationId) {
      state.messages = [];
      if (redraw) render();
      return;
    }
    state.loading = true;
    if (redraw) render();
    try {
      const encoded = encodeURIComponent(state.currentConversationId);
      const [settings, messages, analyses, replies] = await Promise.all([
        api(`/api/ws/settings?conversationId=${encoded}`, {}, context),
        api(`/api/ws/messages?conversationId=${encoded}&limit=500`, {}, context),
        api(`/api/ws/analyses?conversationId=${encoded}&limit=1`, {}, context),
        api(`/api/ws/replies?conversationId=${encoded}&limit=10`, {}, context),
      ]);
      assertContext(context);
      state.settings = core.normalizeTranslationSettings(settings);
      state.aiEnabled = settings.aiEnabled !== false;
      state.messages = core.dedupeMessages(messages.messages || []);
      state.analysisMeta = Array.isArray(analyses.analyses) ? analyses.analyses[0] || null : analyses.analysis || null;
      state.analysis = state.analysisMeta?.result || null;
      state.replies = Array.isArray(replies.replies) ? replies.replies : [];
      seedDraftFromAnalysis();
      state.translationStatus = state.settings.enabled ? `${core.translationMode(state.settings)} · 可按方向关闭` : '翻译已关闭 · 手动翻译仍可用';
      state.lastLoadedAt = nowIso();
    } catch (error) {
      if (contextCurrent(context)) state.error = error.message;
    } finally {
      if (contextCurrent(context)) { state.loading = false; if (redraw) render(); }
    }
  }
  async function createConversation() {
    if (state.busy.customer) return;
    const externalId = text($('#wsConversationExternalId')?.value || state.createExternalId);
    const title = text($('#wsConversationTitle')?.value || state.createTitle);
    if (!externalId) { toast('请输入 WS 会话标识；不读取平台账号或 Cookie。', 'x'); return; }
    const context = captureContext();
    state.busy.customer = true;
    render();
    try {
      const item = await api('/api/ws/conversations', { method: 'POST', body: JSON.stringify({ externalId, title }) }, context);
      assertContext(context);
      const existing = state.conversations.find(row => String(row.id) === String(item.id));
      state.conversations = existing ? state.conversations.map(row => String(row.id) === String(item.id) ? item : row) : [item, ...state.conversations];
      state.createExternalId = '';
      state.createTitle = '';
      state.mobilePanel = 'center';
      await loadConversationData(item.id, false, { ...context, conversationId: String(item.id) });
      if (contextCurrent(context)) toast(existing ? '已打开现有 WS 会话' : '已建立本机会话记录');
    } catch (error) {
      if (contextCurrent(context)) { state.error = error.message; toast(error.message, 'x'); }
    } finally {
      if (contextCurrent(context)) { state.busy.customer = false; render(); }
    }
  }

  function displayTime(value) {
    const source = String(value || '');
    return source ? source.slice(0, 16).replace('T', ' ') : '';
  }
  function renderConversationList() {
    const query = state.conversationQuery.trim().toLocaleLowerCase();
    const rows = state.conversations.filter(item => !query || `${item.title || ''} ${item.externalId || ''} ${item.lastMessageText || ''}`.toLocaleLowerCase().includes(query)).map(item => {
      const stamp = displayTime(item.lastMessageAt || item.updatedAt);
      return `<button class="ws-session-row ${String(item.id) === String(state.currentConversationId) ? 'active' : ''}" data-ws-action="select-conversation" data-id="${esc(item.id)}"><span class="ws-session-avatar">${esc((item.title || 'WS').slice(0, 1))}</span><span class="ws-session-copy"><strong>${esc(item.title || item.externalId)}</strong><small>${esc(item.lastMessageText || '尚未导入聊天内容')}</small><time>${esc(stamp || '暂无消息时间')}</time></span><span class="ws-session-side"><em>${esc(item.intentLevel || '待分析')}</em>${Number(item.unreadCount) > 0 ? `<b>${Math.min(99, Number(item.unreadCount))}</b>` : ''}</span></button>`;
    }).join('');
    if (rows) return rows;
    return `<div class="ws-empty">${state.conversations.length ? '没有匹配的会话。' : '还没有本机会话。输入会话标识后建立记录，不会预置演示数据。'}</div>`;
  }
  function renderAccountList() {
    if (state.accountsLoading) return '<div class="ws-empty ws-loading">正在加载 WS 账号…</div>';
    if (!state.accounts.length) return '<div class="ws-empty">暂无 WS 账号。点击“添加账号”创建本机登录页。</div>';
    return state.accounts.map(account => {
      const active = String(account.id) === String(state.activeAccountId);
      const status = accountStatusLabel(account);
      const initial = esc(accountDisplayName(account).slice(0, 1).toUpperCase());
      return `<button class="ws-account-row ${active ? 'active' : ''}" data-ws-action="switch-account" data-account-id="${esc(account.id)}" aria-current="${active ? 'true' : 'false'}">
        <span class="ws-account-avatar">${initial}</span><span class="ws-account-copy"><strong>${esc(accountDisplayName(account))}</strong><small>${esc(account.id)}</small></span><span class="ws-account-status" data-status="${esc(status)}">${esc(status)}</span>
      </button>`;
    }).join('');
  }
  function renderAccountForm() {
    if (!state.accountFormOpen) return '';
    return `<div class="ws-account-form" role="dialog" aria-label="添加 WS 账号"><label for="wsAccountDisplayName">本机显示名称</label><input id="wsAccountDisplayName" maxlength="80" autocomplete="off" placeholder="例如：个人号、工作号" value="${esc(state.accountFormName)}"><div class="ws-account-form-actions"><button class="btn small primary" data-ws-action="submit-account" ${state.accountBusy ? 'disabled' : ''}>${state.accountBusy ? '创建中…' : '创建并登录'}</button><button class="btn small" data-ws-action="cancel-account" ${state.accountBusy ? 'disabled' : ''}>取消</button></div>${state.accountFormError ? `<p class="ws-account-form-error">${esc(state.accountFormError)}</p>` : ''}</div>`;
  }
  function renderMessageRows() {
    if (!state.messages.length) return '<div class="ws-empty ws-message-empty">导入当前可见聊天后，原文和译文会显示在这里。</div>';
    return state.messages.map(message => {
      const busy = state.translationBusy.has(translationBusyKey(message.id));
      const failed = message.translationStatus === 'failed' || Boolean(message.translationError);
      const showOriginal = state.settings.showOriginal || !message.translatedText || failed;
      const stamp = message.data?.timestamp || message.createdAt || '';
      return `<article class="ws-message-row ${message.direction === 'send' ? 'send' : 'receive'} ${failed ? 'failed' : ''}" data-message-id="${esc(message.id)}"><div class="ws-message-meta"><span>${message.direction === 'send' ? '我发送' : '客户发来'}</span><time>${esc(displayTime(stamp))}</time><button class="link-button" data-ws-action="translate-message" data-id="${esc(message.id)}" ${busy ? 'disabled' : ''}>${busy ? '翻译中…' : failed ? '重试翻译' : '手动翻译'}</button></div><div class="ws-message-original" ${showOriginal ? '' : 'hidden'}><small>原文</small><p>${esc(message.originalText)}</p></div>${message.translatedText ? `<div class="ws-message-translated"><small>译文 · ${esc(message.targetLanguage || state.settings.targetLanguage)}</small><p>${esc(message.translatedText)}</p></div>` : `<div class="ws-message-untranslated">${failed ? `翻译失败：${esc(message.translationError || '服务暂不可用')}，原文已安全保存。` : '尚无译文；可点击“手动翻译”。'}</div>`}</article>`;
    }).join('');
  }
  function renderAnalysis() {
    const analysis = state.analysis;
    if (!analysis) return '<div class="ws-empty">选择“分析当前聊天”后，AI 才会处理本地已导入的消息。</div>';
    const tags = (analysis.tags || []).map(tag => `<span class="ws-tag">${esc(tag)}</span>`).join('');
    const needs = (analysis.needs || []).map(item => `<li>${esc(item)}</li>`).join('');
    const analyzedAt = displayTime(state.analysisMeta?.createdAt);
    return `<div class="ws-analysis-result"><div class="ws-ai-summary"><strong>${esc(analysis.summary || '暂无摘要')}</strong><span class="ws-confidence ${analysis.lowConfidence ? 'low' : ''}">${analysis.lowConfidence ? 'AI 判断置信度较低，请人工确认。' : `置信度 ${Math.round((Number(analysis.confidence) || 0) * 100)}%`}</span>${analyzedAt ? `<small>分析于 ${esc(analyzedAt)}</small>` : ''}</div><dl class="ws-fact-grid"><div><dt>意向</dt><dd>${esc(analysis.intent || '未识别')} ${analysis.intentScore == null ? '' : `· ${esc(analysis.intentScore)}`}</dd></div><div><dt>情绪</dt><dd>${esc(analysis.emotion || '未识别')}</dd></div><div><dt>语言</dt><dd>${esc(analysis.language || '未识别')}</dd></div><div><dt>紧急程度</dt><dd>${esc(analysis.urgency || '未识别')}</dd></div><div><dt>客户阶段</dt><dd>${esc(analysis.customerStage || '未识别')}</dd></div><div><dt>国家/地区</dt><dd>${esc(analysis.contact?.country || analysis.country || '未提取')}</dd></div><div><dt>产品兴趣</dt><dd>${esc(Array.isArray(analysis.productInterest) ? analysis.productInterest.join('、') : analysis.productInterest || '未提取')}</dd></div><div><dt>预算</dt><dd>${esc(analysis.budget || '未提取')}</dd></div></dl>${needs ? `<div class="ws-analysis-section"><strong>需求</strong><ul>${needs}</ul></div>` : ''}${tags ? `<div class="ws-analysis-section"><strong>标签建议</strong><div class="ws-tag-list">${tags}</div></div>` : ''}<div class="ws-analysis-section"><strong>下一步</strong><p>${esc(analysis.nextStep || '请人工确认下一步沟通')}</p><p class="ws-muted">${esc(analysis.followupTime || '')}</p></div>${analysis.replySuggestion ? `<div class="ws-analysis-section ws-ai-reply"><strong>AI 回复建议</strong><p>${esc(analysis.replySuggestion)}</p><button class="btn small" data-ws-action="use-ai-reply">采用到回复框</button></div>` : ''}${analysis.error ? `<p class="ws-error-line">${esc(analysis.error)}</p>` : ''}</div>`;
  }
  function languageOptions(selected, includeAuto = false) {
    const values = [includeAuto ? '自动识别' : '', '中文', 'English', 'हिन्दी', 'العربية', 'Español', 'Português', 'Français', 'Deutsch', 'Русский'].filter(Boolean);
    if (selected && !values.includes(selected)) values.push(selected);
    return values.map(value => `<option value="${esc(value)}" ${value === selected ? 'selected' : ''}>${esc(value)}</option>`).join('');
  }
  function translationModeValue() {
    if (!state.settings.enabled) return 'off';
    if (state.settings.receive && state.settings.send) return 'both';
    if (state.settings.receive) return 'receive';
    if (state.settings.send) return 'send';
    return 'manual';
  }
  function render() {
    const host = getHost();
    if (!host || !state.active || host.state.view !== 'ws-workbench') return;
    const target = $('#viewContainer');
    if (!target) return;
    rendering = true;
    const current = activeConversation();
    const draft = currentDraft();
    const captureRows = core.parseVisibleChat(draft.captureText, state.captureDirection);
    const receiveCount = captureRows.filter(row => row.direction === 'receive').length;
    const sendCount = captureRows.length - receiveCount;
    const errorBanner = state.error ? `<div class="ws-error-banner"><span>${esc(state.error)}</span><button class="btn small" data-ws-action="retry-load">重试加载</button></div>` : '';
    const loadingBanner = state.loading ? '<div class="ws-loading-banner">正在读取本机会话数据…</div>' : '';
    const matchHtml = state.matchCandidates.length ? `<div class="ws-match-candidates"><strong>请选择要关联的客户：</strong>${state.matchCandidates.map(item => `<button class="btn small" data-ws-action="save-customer-to" data-id="${esc(item.id)}">${esc(item.name || item.rawPhone || item.id)}</button>`).join('')}</div>` : '';
    const replyHistory = state.replies.slice(0, 5).map(item => `<li><span>${esc((item.translatedText || item.originalText || '').slice(0, 80))}</span><time>${esc(displayTime(item.createdAt))}</time></li>`).join('');
    const failedTranslations = state.messages.filter(item => item.translationStatus === 'failed' || item.translationError).length;
    target.innerHTML = `
      <div class="ws-workbench-page">
        <div class="page-heading ws-page-heading">
          <div><h1 class="page-title">WS 工作台</h1><p class="page-subtitle">个人 WS 登录、可见聊天翻译与客户运营辅助 · 不保存密码、Cookie、二维码或秘密 Token</p></div>
          <div class="heading-actions">
            <span id="wsStatusBadge" class="ws-status-badge" data-status="${esc(state.wsStatus)}">${esc(state.wsStatus)}</span>
            <select id="wsTopAccount" class="ws-top-account" title="切换 WS 账号">${state.accounts.map(account => `<option value="${esc(account.id)}" ${String(account.id) === String(state.activeAccountId) ? 'selected' : ''}>${esc(accountDisplayName(account))}</option>`).join('')}</select>
            <label class="ws-top-switch"><input id="wsTopTranslateEnabled" type="checkbox" ${state.settings.enabled ? 'checked' : ''}>翻译</label>
            <select id="wsTopTranslationMode" title="翻译模式">
              <option value="both" ${translationModeValue() === 'both' ? 'selected' : ''}>双向翻译</option>
              <option value="receive" ${translationModeValue() === 'receive' ? 'selected' : ''}>只翻译接收</option>
              <option value="send" ${translationModeValue() === 'send' ? 'selected' : ''}>只翻译发送</option>
              <option value="manual" ${translationModeValue() === 'manual' ? 'selected' : ''}>仅手动</option>
              <option value="off" ${translationModeValue() === 'off' ? 'selected' : ''}>全部关闭</option>
            </select>
            <button class="btn small ws-heading-collapse" data-ws-action="toggle-left" aria-expanded="${state.leftCollapsed ? 'false' : 'true'}" aria-controls="wsSessionsPanel">${state.leftCollapsed ? '显示会话' : '隐藏会话'}</button>
            <button class="btn small ws-heading-collapse" data-ws-action="toggle-right" aria-expanded="${state.rightCollapsed ? 'false' : 'true'}" aria-controls="wsAssistPanel">${state.rightCollapsed ? '显示辅助' : '隐藏辅助'}</button>
          </div>
        </div>
        ${errorBanner}${loadingBanner}
        <div class="ws-mobile-tabs">
          <button data-ws-action="mobile-left" class="${state.mobilePanel === 'left' ? 'active' : ''}">会话</button>
          <button data-ws-action="mobile-center" class="${state.mobilePanel === 'center' ? 'active' : ''}">聊天</button>
          <button data-ws-action="mobile-right" class="${state.mobilePanel === 'right' ? 'active' : ''}">翻译与 AI</button>
        </div>
        <div class="ws-layout ${state.leftCollapsed ? 'left-collapsed' : ''} ${state.rightCollapsed ? 'right-collapsed' : ''} mobile-${state.mobilePanel}">
          <aside id="wsSessionsPanel" class="ws-sessions-panel" aria-label="WS 账号与会话">
            <button class="ws-sidebar-collapse ws-sidebar-collapse-left" data-ws-action="toggle-left" aria-expanded="${state.leftCollapsed ? 'false' : 'true'}" aria-controls="wsSessionsPanel" title="${state.leftCollapsed ? '展开会话栏' : '收起会话栏'}"><span aria-hidden="true">${state.leftCollapsed ? '›' : '‹'}</span><b>${state.leftCollapsed ? '会话' : '收起'}</b></button>
            <div class="ws-panel-heading"><div><strong>WS 账号</strong><span>${state.accounts.length} 个本机隔离会话</span></div><button class="btn small" data-ws-action="create-account" ${state.accountBusy ? 'disabled' : ''}>＋ 添加账号</button></div>
            ${renderAccountForm()}<div class="ws-account-list">${renderAccountList()}</div>
            <div class="ws-panel-heading ws-conversation-heading"><div><strong>会话</strong><span>${state.conversations.length} 个本地记录 · ${esc(accountDisplayName(activeAccount()))}</span></div><button class="icon-button" data-ws-action="new-conversation" title="建立会话">＋</button></div>
            <input id="wsConversationSearch" class="ws-search-input" placeholder="搜索客户、标识或消息" value="${esc(state.conversationQuery)}">
            <div class="ws-create-session">
              <input id="wsConversationExternalId" placeholder="会话标识（由你输入）" maxlength="160" value="${esc(state.createExternalId)}">
              <input id="wsConversationTitle" placeholder="客户名称（可选）" maxlength="80" value="${esc(state.createTitle)}">
              <button class="btn small primary" data-ws-action="create-conversation" ${state.busy.customer ? 'disabled' : ''}>${state.busy.customer ? '正在建立…' : '建立本机会话'}</button>
            </div>
            <div class="ws-session-list">${renderConversationList()}</div>
          </aside>
          <section class="ws-center-panel">
            <div class="ws-login-toolbar">
              <div><strong>${esc(accountDisplayName(activeAccount()) || 'WS 登录入口')}</strong><span id="wsStatusDetail">${esc(state.wsDetail || '请在中栏自行完成扫码或登录。')}</span></div>
              <div class="ws-toolbar-actions">
                <button class="btn small primary" data-ws-action="open" ${state.busy.connection ? 'disabled' : ''}>${state.wsStatus === '已连接' ? '已打开 WS' : '打开 WS'}</button>
                <button class="btn small" data-ws-action="probe">检测状态</button>
                <button class="btn small" data-ws-action="discover-conversations">采集列表预览</button>
                <button class="btn small" data-ws-action="reconnect">重新连接</button>
                <button class="btn small" data-ws-action="reload">刷新页面</button>
                <button class="btn small danger" data-ws-action="close">关闭 WS</button>
                <button class="btn small" data-ws-action="clear-session">清除登录会话</button>
              </div>
            </div>
            <div id="wsBrowserHost" class="ws-browser-host"><div class="ws-browser-placeholder"><strong>官方 WS 页面会显示在这里</strong><span>用户自行登录；知客不会读取密码、Cookie 或二维码。</span></div></div>
            <div class="ws-capture-panel">
              <div class="ws-capture-heading">
                <div><strong>导入当前可见聊天</strong><span>可先在 WS 页面选中文字，再点击读取；也可手动粘贴。</span></div>
                <select id="wsCaptureDirection"><option value="receive" ${state.captureDirection === 'receive' ? 'selected' : ''}>客户发来</option><option value="send" ${state.captureDirection === 'send' ? 'selected' : ''}>我发送</option></select>
              </div>
              <textarea id="wsVisibleChat" rows="4" placeholder="支持“我：… / 客户：…”以及带日期、时间、发送人的聊天文本">${esc(draft.captureText)}</textarea>
              <div id="wsCapturePreview" class="ws-capture-preview">识别 ${captureRows.length} 条：客户发来 ${receiveCount} 条，我发送 ${sendCount} 条</div>
              <div class="ws-capture-actions">
                <span class="ws-muted">${current ? `当前会话：${esc(current.title || current.externalId)}` : '请先建立或选择本机会话'}</span>
                <button class="btn small" data-ws-action="capture-selection" ${state.busy.capture ? 'disabled' : ''}>${state.busy.capture ? '读取中…' : '读取选中文字'}</button>
                <button class="btn small" data-ws-action="capture-visible-messages" ${state.busy.import ? 'disabled' : ''}>采集当前消息</button>
                <button class="btn small" data-ws-action="clear-capture">清空</button>
                <button class="btn small primary" data-ws-action="import-visible" ${!current || !captureRows.length || state.busy.import ? 'disabled' : ''}>${state.busy.import ? '保存处理中…' : '保存并处理'}</button>
              </div>
            </div>
            <div class="ws-message-heading"><strong>本地消息</strong><span>原文优先落库，翻译失败不丢消息</span>${failedTranslations ? `<button class="btn small" data-ws-action="retry-failed">重试 ${failedTranslations} 条失败翻译</button>` : ''}</div>
            <div class="ws-message-list">${renderMessageRows()}</div>
          </section>
          <aside id="wsAssistPanel" class="ws-assist-panel" aria-label="翻译与 AI 辅助">
            <button class="ws-sidebar-collapse ws-sidebar-collapse-right" data-ws-action="toggle-right" aria-expanded="${state.rightCollapsed ? 'false' : 'true'}" aria-controls="wsAssistPanel" title="${state.rightCollapsed ? '展开辅助栏' : '收起辅助栏'}"><span aria-hidden="true">${state.rightCollapsed ? '‹' : '›'}</span><b>${state.rightCollapsed ? '辅助' : '收起'}</b></button>
            <section class="ws-card ws-translation-card">
              <div class="ws-card-heading"><div><strong>翻译控制</strong><span id="wsTranslationStatus">${esc(state.translationStatus)}</span></div><label class="ws-switch"><input id="wsTranslateEnabled" type="checkbox" ${state.settings.enabled ? 'checked' : ''}><span>总开关</span></label></div>
              <div class="ws-control-grid">
                <label><input id="wsReceiveEnabled" type="checkbox" ${state.settings.receive ? 'checked' : ''}> 自动翻译客户消息</label>
                <label><input id="wsSendEnabled" type="checkbox" ${state.settings.send ? 'checked' : ''}> 自动翻译发送内容</label>
                <label><input id="wsShowOriginal" type="checkbox" ${state.settings.showOriginal ? 'checked' : ''}> 显示原文</label>
                <label>接收译为<select id="wsTargetLanguage">${languageOptions(state.settings.targetLanguage)}</select></label>
                <label class="ws-wide-control">发送译为<select id="wsSendLanguage">${languageOptions(state.settings.sendLanguage, true)}</select></label>
              </div>
              <p class="ws-muted">发送选择“自动识别”时使用当前会话 AI 识别语言；无法确定时会要求人工选择。关闭总开关只停止自动调用，不删除方向偏好或历史译文。</p>
            </section>
            <section class="ws-card ws-ai-card">
              <div class="ws-card-heading"><div><strong>AI 分析</strong><span>只分析当前已导入的文本</span></div><label class="ws-switch"><input id="wsAiEnabled" type="checkbox" ${state.aiEnabled ? 'checked' : ''}><span>AI 开关</span></label></div>
              <button class="btn small primary ws-full-button" data-ws-action="analyze" ${!current || !state.messages.length || !state.aiEnabled || state.aiBusy ? 'disabled' : ''}>${state.aiBusy ? '分析中…' : state.analysis ? '重新分析当前聊天' : '分析当前聊天'}</button>
              <div class="ws-analysis-content">${renderAnalysis()}</div>
            </section>
            ${renderCollectionCard()}
            <section class="ws-card">
              <div class="ws-card-heading"><div><strong>客户资料</strong><span>所有 AI 字段均可人工修改后再保存</span></div></div>
              <div class="ws-customer-fields">
                <input id="wsCustomerName" placeholder="客户姓名" value="${esc(draft.customerName)}">
                <input id="wsCustomerPhone" placeholder="电话（可选）" value="${esc(draft.customerPhone)}">
                <input id="wsCustomerCountry" placeholder="国家/地区" value="${esc(draft.customerCountry)}">
                <input id="wsCustomerLanguage" placeholder="客户语言" value="${esc(draft.customerLanguage)}">
                <input id="wsCustomerProduct" placeholder="产品兴趣" value="${esc(draft.customerProduct)}">
                <input id="wsCustomerBudget" placeholder="预算" value="${esc(draft.customerBudget)}">
                <input id="wsCustomerStage" placeholder="客户阶段" value="${esc(draft.customerStage)}">
                <input id="wsCustomerIntent" placeholder="意向等级" value="${esc(draft.customerIntent)}">
                <input id="wsCustomerTags" class="ws-span-2" placeholder="标签，用逗号或顿号分隔" value="${esc(draft.customerTags)}">
                <textarea id="wsCustomerNote" rows="3" placeholder="备注或 AI 摘要">${esc(draft.customerNote)}</textarea>
              </div>
              <button class="btn small ws-full-button" data-ws-action="save-customer" ${!current || state.busy.customer ? 'disabled' : ''}>${state.busy.customer ? '保存中…' : '确认并保存到客户中心'}</button>
              <div class="ws-customer-match" id="wsCustomerMatch">${matchHtml}</div>
            </section>
            <section class="ws-card">
              <div class="ws-card-heading"><div><strong>跟进记录</strong><span>保存前创建本机快照，失败自动回滚</span></div></div>
              <textarea id="wsFollowupNote" rows="3" placeholder="本次跟进结果">${esc(draft.followupNote)}</textarea>
              <label class="ws-follow-date">下次跟进 <input id="wsNextFollow" type="date" value="${esc(draft.nextFollow)}"></label>
              <button class="btn small ws-full-button" data-ws-action="save-followup" ${!current || state.busy.followup ? 'disabled' : ''}>${state.busy.followup ? '保存中…' : '保存跟进'}</button>
            </section>
            <section class="ws-card">
              <div class="ws-card-heading"><div><strong>回复建议</strong><span>默认只预览或复制，绝不自动发送</span></div></div>
              <textarea id="wsReplyInput" rows="3" placeholder="输入或采用 AI 回复建议">${esc(draft.replyInput)}</textarea>
              <div class="ws-reply-actions"><button class="btn small" data-ws-action="translate-reply" ${!current || state.busy.reply ? 'disabled' : ''}>手动翻译预览</button><button class="btn small primary" data-ws-action="copy-reply" ${!current || state.busy.reply ? 'disabled' : ''}>${state.busy.reply ? '处理中…' : '确认并复制'}</button></div>
              <div id="wsReplyPreview" class="ws-reply-preview">${draft.replyError ? `<p class="ws-error-line">${esc(draft.replyError)}</p>` : draft.replyPreview ? `<div class="ws-reply-warning">发送前请人工确认译文。</div><strong>预览 · ${esc(draft.replyPreviewLanguage || '原文')}</strong><p>${esc(draft.replyPreview)}</p>` : '<span class="ws-muted">尚未生成预览。</span>'}</div>
              ${replyHistory ? `<div class="ws-reply-history"><strong>最近复制记录</strong><ul>${replyHistory}</ul></div>` : ''}
            </section>
          </aside>
        </div>
      </div>
    `;
    updateStatusDom();
    rendering = false;
    browserResizeObserver?.disconnect?.();
    browserResizeObserver = undefined;
    const browserHost = $('#wsBrowserHost');
    if (browserHost && typeof ResizeObserver === 'function') {
      browserResizeObserver = new ResizeObserver(() => {
        if (state.active) requestAnimationFrame(resizeWsView);
      });
      browserResizeObserver.observe(browserHost);
    }
    requestAnimationFrame(resizeWsView);
  }

  async function saveSettings(sequence, context, snapshot) {
    context ||= captureContext();
    const current = activeConversation();
    if (!current || !contextCurrent(context)) return;
    const settings = snapshot || { ...state.settings, aiEnabled: state.aiEnabled };
    try {
      const saved = await api('/api/ws/settings?conversationId=' + encodeURIComponent(current.id), {
        method: 'PUT',
        body: JSON.stringify(settings),
      }, context);
      if (sequence !== settingsSaveSequence || !contextCurrent(context)) return;
      state.settings = core.normalizeTranslationSettings(saved);
      state.aiEnabled = saved.aiEnabled !== false;
      state.translationStatus = state.settings.enabled ? `${core.translationMode(state.settings)} · 设置已保存` : '翻译已关闭 · 手动翻译仍可用';
    } catch (error) {
      if (sequence === settingsSaveSequence && contextCurrent(context)) {
        state.error = '翻译设置保存失败：' + error.message;
        toast(state.error, 'x');
      }
    }
  }
  function queueSaveSettings() {
    clearTimeout(settingsSaveTimer);
    const sequence = ++settingsSaveSequence;
    const context = captureContext();
    const snapshot = { ...state.settings, aiEnabled: state.aiEnabled };
    settingsSaveTimer = setTimeout(() => saveSettings(sequence, context, snapshot), 220);
  }
  function sendLanguage() {
    if (state.settings.sendLanguage && state.settings.sendLanguage !== '自动识别') return state.settings.sendLanguage;
    const draft = currentDraft();
    return text(draft.customerLanguage || state.analysis?.language || activeConversation()?.language);
  }
  function translationDestination(direction) {
    if (direction === 'receive') return state.settings.targetLanguage || '中文';
    const language = sendLanguage();
    if (!language) throw new Error('尚未识别客户语言，请在“发送译为”中选择语言，或先运行 AI 分析。');
    return language;
  }
  async function translationServiceStatus(context = captureContext()) {
    assertContext(context);
    if (!window.zhikeAI?.request || !window.zhikeAI?.status) throw new Error('当前没有可用的 AI 翻译服务。');
    const status = await window.zhikeAI.status().catch(() => ({ configured: false }));
    assertContext(context);
    if (!status.configured) throw new Error('请先在 GPT 运营助手中配置 AI 服务；原文已保留。');
    state.translationStatus = `翻译服务正常 · ${status.providerName || status.provider || 'AI'}`;
    return status;
  }
  async function translateText(originalText, direction, context = captureContext()) {
    const source = text(originalText);
    if (!source) throw new Error('原文为空，无法翻译。');
    assertContext(context);
    await translationServiceStatus(context);
    const destination = translationDestination(direction);
    const prompt = `请把下面${direction === 'receive' ? '客户发来的' : '准备发送给客户的'}内容翻译成${destination}。只返回译文，不要解释，不要添加引号，不要改变数字、网址或联系方式：\n${source.slice(0, 9600)}`;
    const result = await window.zhikeAI.request({
      assistantMode: 'general',
      analysisDepth: 'standard',
      input: prompt,
      context: { feature: 'ws-translation', direction, targetLanguage: destination },
    });
    assertContext(context);
    const translated = text(result?.text);
    if (!translated) throw new Error('翻译服务没有返回译文。');
    assertContext(context);
    state.translationStatus = `翻译服务正常 · ${result.providerName || 'AI'}`;
    return { translated, destination };
  }
  async function persistMessage(message, context = captureContext(message?.conversationId)) {
    assertContext(context);
    const saved = await api('/api/ws/messages', { method: 'POST', body: JSON.stringify(message) }, context);
    assertContext(context);
    const index = state.messages.findIndex(item => String(item.id) === String(saved.id) || (message.externalId && item.externalId === message.externalId));
    if (index >= 0) state.messages[index] = saved;
    else state.messages.push(saved);
    state.messages = core.dedupeMessages(state.messages);
    return saved;
  }
  async function markTranslationFailure(message, error, context = captureContext(message?.conversationId)) {
    try {
      return await persistMessage({
        ...message,
        id: message.id,
        conversationId: message.conversationId,
        externalId: message.externalId,
        translationStatus: 'failed',
        translationError: String(error?.message || error || '翻译失败').slice(0, 500),
      }, context);
    } catch { return message; }
  }
  async function translateMessage(id, parentContext = null) {
    const message = state.messages.find(item => String(item.id) === String(id));
    if (!message) return;
    const context = parentContext || captureContext(message.conversationId);
    const busyKey = translationBusyKey(id, context);
    if (!contextCurrent(context) || state.translationBusy.has(busyKey)) return;
    state.translationBusy.add(busyKey);
    render();
    try {
      const result = await translateText(message.originalText, message.direction, context);
      assertContext(context);
      await persistMessage({
        ...message,
        id: message.id,
        conversationId: message.conversationId,
        externalId: message.externalId,
        translatedText: result.translated,
        targetLanguage: result.destination,
        translationStatus: 'translated',
        translationError: '',
      }, context);
      if (contextCurrent(context)) toast('单条消息翻译已保存');
    } catch (error) {
      if (contextCurrent(context)) await markTranslationFailure(message, error, context);
      if (contextCurrent(context)) toast(error.message + ' 原文仍保留。', 'x');
    } finally {
      state.translationBusy.delete(busyKey);
      if (contextCurrent(context)) render();
    }
  }
  async function translateMessagesInBatches(messages, context = captureContext()) {
    assertContext(context);
    const pending = messages.filter(message => !message.translatedText && core.shouldTranslate(state.settings, message.direction));
    if (!pending.length) return { translated: 0, failed: 0 };
    try { await translationServiceStatus(context); }
    catch (error) {
      for (const message of pending) if (contextCurrent(context)) await markTranslationFailure(message, error, context);
      return { translated: 0, failed: pending.length };
    }
    let translated = 0;
    let failed = 0;
    const groups = new Map();
    for (const message of pending) {
      try {
        const destination = translationDestination(message.direction);
        const key = `${message.direction}|${destination}`;
        if (!groups.has(key)) groups.set(key, { destination, direction: message.direction, messages: [] });
        groups.get(key).messages.push(message);
      } catch (error) {
        if (contextCurrent(context)) await markTranslationFailure(message, error, context);
        failed++;
      }
    }
    for (const group of groups.values()) {
      let queue = [...group.messages];
      while (queue.length) {
        const chunk = [];
        let characters = 0;
        while (queue.length && chunk.length < 12) {
          const next = queue[0];
          const size = String(next.originalText || '').length;
          if (chunk.length && characters + size > 7200) break;
          chunk.push(queue.shift());
          characters += size;
        }
        const payload = chunk.map(item => ({ id: item.id, text: String(item.originalText || '').slice(0, 2500) }));
        try {
          assertContext(context);
          const result = await window.zhikeAI.request({
            assistantMode: 'general',
            analysisDepth: 'standard',
            input: `把 JSON 数组中每个 text 翻译成${group.destination}。保持 id 不变，只返回 JSON 数组，每项格式为 {"id":"原id","translation":"译文"}，不要 Markdown 或解释：\n${JSON.stringify(payload)}`,
            context: { feature: 'ws-translation-batch', direction: group.direction, targetLanguage: group.destination, count: payload.length },
          });
          const parsed = new Map(core.parseTranslationBatch(result?.text || '').map(item => [item.id, item.translation]));
          for (const message of chunk) {
            assertContext(context);
            const value = parsed.get(String(message.id));
            if (!value) {
              await markTranslationFailure(message, new Error('批量翻译结果缺少该消息。'), context);
              failed++;
              continue;
            }
            assertContext(context);
            await persistMessage({ ...message, translatedText: value, targetLanguage: group.destination, translationStatus: 'translated', translationError: '' }, context);
            translated++;
          }
        } catch (error) {
          for (const message of chunk) if (contextCurrent(context)) await markTranslationFailure(message, error, context);
          failed += chunk.length;
        }
      }
    }
    return { translated, failed };
  }
  async function importVisible(context = captureContext()) {
    if (state.busy.import) return;
    assertContext(context);
    const current = activeConversation();
    const draft = currentDraft();
    const rows = core.parseVisibleChat(draft.captureText, state.captureDirection);
    if (!current) { toast('请先建立或选择本机会话。', 'x'); return; }
    if (!rows.length) { toast('请先选择或粘贴当前可见聊天文本。', 'x'); return; }
    if (!draft.customerPhone) draft.customerPhone = core.extractPhone(rows.map(row => row.text).join('\n'));
    if (draft.customerPhone) {
      const match = core.matchCustomer(getHost()?.state?.customers || [], { phone: draft.customerPhone });
      state.matchCandidates = match.candidates || [];
      if (match.kind === 'phone' && match.customer) {
        const conversation = state.conversations.find(item => String(item.id) === String(current.id));
        if (conversation) { assertContext(context); conversation.customerId = String(match.customer.id); await api('/api/ws/conversations', { method: 'POST', body: JSON.stringify({ externalId: conversation.externalId, customerId: String(match.customer.id) }) }, context); assertContext(context); }
        draft.customerName = draft.customerName || match.customer.name || '';
        draft.customerCountry = draft.customerCountry || match.customer.country || '';
        toast(`已按号码匹配客户：${match.customer.name || match.customer.id}`);
      }
    }
    state.busy.import = true;
    state.error = '';
    render();
    try {
      const fingerprint = core.visibleChatFingerprint(rows);
      const baseOrder = state.messages.reduce((max, item) => Math.max(max, Number(item.order) || 0), 0);
      const messages = rows.map((row, index) => ({
        externalId: row.timestamp
          ? 'visible-' + stableHash(`${current.id}|${row.timestamp}|${row.sender}|${row.direction}|${row.text}`)
          : 'manual-' + stableHash(`${current.id}|${fingerprint}|${index}|${row.direction}|${row.text}`),
        direction: row.direction,
        originalText: row.text,
        order: baseOrder + index + 1,
        translationStatus: core.shouldTranslate(state.settings, row.direction) ? 'pending' : 'none',
        data: { source: 'user-visible-selection', batchFingerprint: fingerprint, timestamp: row.timestamp, sender: row.sender },
      }));
      const result = await api('/api/ws/messages/batch', {
        method: 'POST',
        timeout: 30000,
        body: JSON.stringify({ conversationId: current.id, fingerprint, messages }),
      }, context);
      assertContext(context);
      const stored = Array.isArray(result.messages) ? result.messages : [];
      state.messages = core.dedupeMessages([...state.messages, ...stored]);
      draft.captureText = '';
      const conversation = state.conversations.find(item => String(item.id) === String(current.id));
      if (conversation && rows.length) {
        conversation.lastMessageText = rows.at(-1).text.slice(0, 4000);
        conversation.lastMessageAt = nowIso();
        conversation.updatedAt = conversation.lastMessageAt;
      }
      render();
      const translation = contextCurrent(context) ? await translateMessagesInBatches(stored, context) : { translated: 0, failed: 0 };
      const inserted = Number(result.inserted ?? stored.filter(item => !item.existed).length);
      const existed = Number(result.existed || 0);
      toast(`原文已保存 ${inserted} 条${existed ? `，跳过重复 ${existed} 条` : ''}${translation.translated ? `，翻译 ${translation.translated} 条` : ''}${translation.failed ? `，${translation.failed} 条翻译待重试` : ''}`, translation.failed ? 'x' : 'check');
    } catch (error) {
      if (contextCurrent(context)) { state.error = '导入失败，输入内容已保留：' + error.message; toast(state.error, 'x'); }
    } finally {
      state.busy.import = false;
      if (contextCurrent(context)) render();
    }
  }
  async function captureSelection() {
    if (state.busy.capture) return;
    state.busy.capture = true;
    render();
    try {
      const result = await wsBridge('capture-selection');
      const selected = text(result?.text);
      if (!selected) throw new Error('没有读取到选中文字。请先在 WS 页面拖动选择允许处理的聊天内容。');
      currentDraft().captureText = selected;
      state.mobilePanel = 'center';
      toast('已读取当前选中的可见文字，请确认识别结果后保存');
    } catch (error) {
      toast(error.message, 'x');
    } finally {
      state.busy.capture = false;
      render();
    }
  }

  async function analyzeConversation(context = captureContext()) {
    const current = activeConversation();
    if (context.conversationId && context.conversationId !== String(current?.id || '')) return;
    assertContext(context);
    if (state.aiBusy) return;
    if (!current || !state.messages.length) { toast('请先建立会话并导入可见聊天。', 'x'); return; }
    if (!state.aiEnabled) { toast('当前会话的 AI 分析已关闭。', 'x'); return; }
    if (!window.zhikeAI?.request || !window.zhikeAI?.status) { toast('当前没有可用的 AI 服务，请先配置 GPT 运营助手。', 'x'); return; }
    state.aiBusy = true;
    state.error = '';
    render();
    const transcript = core.buildTranscript(state.messages, { maxChars: 8200, maxMessages: 40 });
    try {
      const service = await window.zhikeAI.status().catch(() => ({ configured: false }));
      if (!service.configured) throw new Error('请先在 GPT 运营助手中配置 AI 服务。');
      const result = await window.zhikeAI.request({
        assistantMode: 'operations',
        analysisDepth: 'standard',
        input: '只分析下面当前用户选择的 WS 会话文本。只返回一个 JSON 对象，不要 Markdown，不要编造未出现的资料。字段必须包含 summary、intent、intentScore、emotion、urgency、language、needs（数组）、productInterest（数组）、budget、contact（对象，含 name/phone/country/account）、tags（数组）、customerStage、nextStep、followupTime、replySuggestion、confidence（0 到 1）。\n' + transcript.text,
        context: { feature: 'ws-analysis', conversationId: current.id, title: current.title || '', includedMessages: transcript.included, truncated: transcript.truncated },
      });
      assertContext(context);
      state.analysis = core.parseAiResult(result?.text || '');
      state.analysis.providerName = result.providerName || '';
      state.analysis.model = result.model || '';
      state.analysis.transcriptInfo = transcript;
      const saved = await api('/api/ws/analyses', {
        method: 'POST',
        body: JSON.stringify({ conversationId: current.id, result: state.analysis, confidence: state.analysis.confidence, providerName: state.analysis.providerName, model: state.analysis.model }),
      }, context);
      assertContext(context);
      state.analysisMeta = saved;
      if (state.collectionRun?.id) await api('/api/ws/collection-items', { method: 'PATCH', body: JSON.stringify({ runId: state.collectionRun.id, conversationId: current.id, status: 'completed', analysisStatus: 'completed', coverageStatus: 'visible' }) }, context).catch(() => {});
      seedDraftFromAnalysis();
      const conversation = state.conversations.find(item => String(item.id) === String(current.id));
      if (conversation) {
        conversation.intentLevel = state.analysis.intent || conversation.intentLevel;
        conversation.language = state.analysis.language || conversation.language;
        conversation.updatedAt = nowIso();
      }
      toast(state.analysis.lowConfidence ? '分析完成，但需要人工确认' : `分析完成：已使用最近 ${transcript.included} 条消息`, state.analysis.lowConfidence ? 'x' : 'check');
    } catch (error) {
      if (contextCurrent(context)) {
        state.analysis = { summary: '', lowConfidence: true, confidence: 0, error: error.message, warning: 'AI 判断置信度较低，请人工确认。' };
        try { state.analysisMeta = await api('/api/ws/analyses', { method: 'POST', body: JSON.stringify({ conversationId: current.id, result: state.analysis, confidence: 0, errorMessage: error.message }) }, context); } catch {}
        toast(error.message, 'x');
      }
    } finally {
      if (contextCurrent(context)) { state.aiBusy = false; render(); }
    }
  }

  function customerProfileFromDraft(current) {
    const draft = currentDraft();
    return {
      wsExternalId: current.externalId,
      conversationId: current.id,
      phone: text(draft.customerPhone),
      name: text(draft.customerName) || current.title || '未命名客户',
      country: text(draft.customerCountry),
      language: text(draft.customerLanguage),
      productInterest: text(draft.customerProduct),
      budget: text(draft.customerBudget),
      customerStage: text(draft.customerStage),
      intent: text(draft.customerIntent),
      note: text(draft.customerNote),
      tags: text(draft.customerTags).split(/[、,，;；]+/).map(text).filter(Boolean).slice(0, 30),
      aiSummary: state.analysis?.summary || '',
      intentScore: state.analysis?.intentScore ?? '',
      emotion: state.analysis?.emotion || '',
      wsAccountId: String(state.activeAccountId || 'default'),
      account: state.analysis?.contact?.account || '',
      source: 'WhatsApp',
      channel: 'WhatsApp',
      assistant: '未分配',
    };
  }
  function applyProfileToCustomer(customer, profile) {
    return core.mergeCustomerProfile(customer, profile);
  }
  async function saveCustomerTo(explicitId = '') {
    const current = activeConversation();
    const host = getHost();
    if (state.busy.customer) return;
    if (!current || !host) { toast('请先建立或选择本机会话。', 'x'); return; }
    const context = captureContext(current.id);
    const profile = customerProfileFromDraft(current);
    let customer = explicitId ? host.state.customers.find(item => String(item.id) === String(explicitId) && !item.deleted) : null;
    let match = customer ? { kind: 'confirmed', customer, candidates: [customer] } : core.matchCustomer(host.state.customers, profile);
    if (match.kind === 'ambiguous') {
      state.matchCandidates = match.candidates;
      render();
      toast('发现多个候选客户，请人工选择要关联的客户。', 'x');
      return;
    }
    customer ||= match.customer;
    if (!customer && !profile.phone && !profile.wsExternalId) { toast('缺少 WS 标识和电话，无法安全创建客户。', 'x'); return; }
    state.busy.customer = true;
    state.matchCandidates = [];
    render();
    const snapshotReady = await host.snapshotBeforeWrite?.('WS 客户保存前自动快照');
    if (snapshotReady === false) { if (contextCurrent(context)) { state.busy.customer = false; render(); } return; }
    assertContext(context);
    const created = !customer;
    const beforeCustomers = host.state.customers.slice();
    const before = customer ? JSON.parse(JSON.stringify(customer)) : null;
    if (!customer) {
      customer = {
        id: 'CWS-' + Date.now().toString(36) + '-' + stableHash(profile.wsExternalId || profile.phone),
        name: profile.name,
        rawPhone: profile.phone,
        phone: core.normalizePhone(profile.phone),
        source: profile.source,
        channel: profile.channel,
        assistant: profile.assistant,
        status: '未进群',
        phase: '新客户',
        qualification: '待评估',
        hot: false,
        investor: false,
        group: '—',
        ticket: false,
        deposit: false,
        amount: 0,
        registered: new Date().toISOString().slice(0, 10),
        lastFollow: '',
        due: new Date().toISOString().slice(0, 10),
        note: '',
        deleted: false,
        touched: true,
      };
      host.state.customers.unshift(customer);
    }
    applyProfileToCustomer(customer, profile);
    host.persist();
    try {
      await host.flushStateWrites();
      assertContext(context);
      const linked = await api('/api/ws/conversations', {
        method: 'POST',
        body: JSON.stringify({ id: current.id, externalId: current.externalId, customerId: customer.id, language: profile.language }),
      }, context);
      assertContext(context);
      current.customerId = customer.id;
      if (linked) Object.assign(current, linked);
      if (contextCurrent(context)) toast(created ? 'WS 客户已保存到客户中心' : '客户档案已更新并关联当前会话');
    } catch (error) {
      if (created) host.state.customers = beforeCustomers;
      else Object.assign(customer, before);
      host.persist();
      await host.flushStateWrites().catch(() => {});
      if (contextCurrent(context)) toast('客户保存失败，原资料已恢复：' + error.message, 'x');
    } finally {
      if (contextCurrent(context)) { state.busy.customer = false; render(); }
    }
  }
  async function saveFollowup() {
    const current = activeConversation();
    const host = getHost();
    const draft = currentDraft();
    if (state.busy.followup) return;
    if (!current || !host) { toast('请先建立会话。', 'x'); return; }
    const context = captureContext(current.id);
    const customer = host.state.customers.find(item => String(item.id) === String(current.customerId) && !item.deleted);
    if (!customer) { toast('请先确认并保存客户资料，再登记跟进。', 'x'); return; }
    const note = text(draft.followupNote);
    if (!note) { toast('请填写本次跟进结果。', 'x'); return; }
    const recentDuplicate = host.state.followups.find(item => String(item.customerId) === String(customer.id) && text(item.note || item.result) === note && text(item.nextDate) === text(draft.nextFollow) && Date.now() - Date.parse(item.date || 0) < 120000);
    if (recentDuplicate) { toast('相同跟进刚刚已经保存，未重复写入。'); return; }
    state.busy.followup = true;
    render();
    const snapshotReady = await host.snapshotBeforeWrite?.('WS 跟进保存前自动快照');
    if (snapshotReady === false) { if (contextCurrent(context)) { state.busy.followup = false; render(); } return; }
    assertContext(context);
    const operationId = 'ws-follow-' + Date.now().toString(36) + '-' + stableHash(current.id + note + draft.nextFollow);
    const record = {
      id: 'FWS-' + Date.now().toString(36) + '-' + stableHash(operationId),
      customerId: customer.id,
      customer: customer.name,
      phone: customer.rawPhone || customer.phone || '',
      date: nowIso(),
      method: 'WhatsApp',
      registration: '',
      result: note,
      note,
      nextDate: draft.nextFollow || '',
      wsConversationId: current.id,
      wsOperationId: operationId,
    };
    const previousTasks = (host.state.settings.operatingTasks || []).slice();
    const before = { followups: host.state.followups.slice(), tasks: previousTasks, lastFollow: customer.lastFollow, due: customer.due };
    host.state.followups.unshift(record);
    customer.lastFollow = record.date.slice(0, 10);
    customer.due = record.nextDate || customer.due;
    if (record.nextDate) {
      const tasks = host.state.settings.operatingTasks || [];
      const existingTask = tasks.find(item => !item.done && String(item.wsConversationId || '') === String(current.id));
      const taskInput = {
        title: `跟进 ${customer.name || customer.rawPhone || customer.phone}`,
        due: record.nextDate,
        customerId: customer.id,
        owner: customer.assistant || '未分配',
        priority: /高|紧急|urgent|hot/i.test(String(state.analysis?.urgency || '')) || Number(state.analysis?.intentScore || 0) >= 80 ? 'high' : 'normal',
        note: note,
      };
      if (existingTask) Object.assign(existingTask, taskInput, { updatedAt: nowIso(), wsConversationId: current.id, wsOperationId: operationId });
      else {
        const task = window.ZhikeOperationsCore?.createTask?.(taskInput, host.state.customers) || { id: `TWS-${Date.now().toString(36)}`, ...taskInput, done: false, createdAt: nowIso(), updatedAt: nowIso() };
        host.state.settings.operatingTasks = [{ ...task, wsConversationId: current.id, wsOperationId: operationId }, ...tasks];
      }
    }
    host.persist();
    try {
      await host.flushStateWrites();
      assertContext(context);
      host.activity('WS 工作台登记跟进：' + customer.name);
      await host.flushStateWrites();
      if (state.collectionRun?.id) await api('/api/ws/collection-items', { method: 'PATCH', body: JSON.stringify({ runId: state.collectionRun.id, conversationId: current.id, followupStatus: 'confirmed', nextFollowupAt: record.nextDate || '' }) }, context).catch(() => {});
      draft.followupNote = '';
      draft.nextFollow = '';
      if (contextCurrent(context)) toast(record.nextDate ? '跟进记录与下一次任务已同步保存' : '跟进记录已保存');
    } catch (error) {
      core.restoreFollowupSnapshot(host.state, customer, { followups: before.followups, customer: { lastFollow: before.lastFollow, due: before.due } });
      host.state.settings.operatingTasks = before.tasks;
      host.persist();
      await host.flushStateWrites().catch(() => {});
      if (contextCurrent(context)) toast('跟进保存失败，原资料已恢复：' + error.message, 'x');
    } finally {
      if (contextCurrent(context)) { state.busy.followup = false; render(); }
    }
  }

  function useAiReply() {
    const suggestion = text(state.analysis?.replySuggestion);
    if (!suggestion) { toast('当前分析没有回复建议。', 'x'); return; }
    const draft = currentDraft();
    draft.replyInput = suggestion;
    draft.replyPreview = '';
    draft.replyPreviewSource = '';
    draft.replyError = '';
    render();
    requestAnimationFrame(() => $('#wsReplyInput')?.focus());
  }
  async function translateReply() {
    const context = captureContext();
    const draft = currentDraft();
    const input = text(draft.replyInput || $('#wsReplyInput')?.value);
    if (!input) { toast('请先输入回复内容。', 'x'); return null; }
    state.busy.reply = true;
    draft.replyError = '';
    render();
    try {
      assertContext(context);
      const result = await translateText(input, 'send', context);
      assertContext(context);
      draft.replyPreview = result.translated;
      draft.replyPreviewSource = input;
      draft.replyPreviewLanguage = result.destination;
      return result.translated;
    } catch (error) {
      if (contextCurrent(context)) { draft.replyError = error.message + ' 原文仍可继续使用。'; toast(error.message, 'x'); }
      return null;
    } finally {
      if (contextCurrent(context)) { state.busy.reply = false; render(); }
    }
  }
  async function copyReply() {
    const current = activeConversation();
    const draft = currentDraft();
    const input = text(draft.replyInput || $('#wsReplyInput')?.value);
    if (state.busy.reply) return;
    if (!current || !input) { toast('请先输入回复内容。', 'x'); return; }
    const context = captureContext(current.id);
    state.busy.reply = true;
    draft.replyError = '';
    render();
    try {
      assertContext(context);
      let output = input;
      let language = '原文';
      if (core.shouldTranslate(state.settings, 'send')) {
        if (draft.replyPreviewSource === input && draft.replyPreview) {
          output = draft.replyPreview;
          language = draft.replyPreviewLanguage || sendLanguage();
        } else {
          const result = await translateText(input, 'send', context);
          assertContext(context);
          output = result.translated;
          language = result.destination;
          draft.replyPreview = output;
          draft.replyPreviewSource = input;
          draft.replyPreviewLanguage = language;
        }
      } else {
        draft.replyPreview = input;
        draft.replyPreviewSource = input;
        draft.replyPreviewLanguage = '原文';
      }
      if (core.isSensitiveReply(input) || core.isSensitiveReply(output)) {
        if (!confirm('内容可能涉及付款、退款、密码、验证、金融、法律、医疗、价格或交付承诺。确认只复制到剪贴板，不自动发送？')) return;
      }
      if (!window.zhikeDesktop?.tools) throw new Error('当前环境没有本机剪贴板能力。');
      const copied = await window.zhikeDesktop.tools({ action: 'copy', text: output });
      if (!copied?.ok || copied.truncated || Number(copied.length) !== output.length) throw new Error('回复复制不完整，已停止并保留原文。');
      assertContext(context);
      draft.replyOperationId ||= 'ws-reply-' + Date.now().toString(36) + '-' + stableHash(current.id + input + output);
      const saved = await api('/api/ws/replies', {
        method: 'POST',
        body: JSON.stringify({ conversationId: current.id, originalText: input, translatedText: output, status: 'copied', idempotencyKey: draft.replyOperationId }),
      }, context);
      assertContext(context);
      state.replies = [saved, ...state.replies.filter(item => String(item.id) !== String(saved.id))].slice(0, 10);
      draft.replyOperationId = '';
      toast(`回复已完整复制（${output.length} 字），请回到 WS 页面人工发送。`);
    } catch (error) {
      if (contextCurrent(context)) { draft.replyError = error.message; toast(error.message, 'x'); }
    } finally {
      if (contextCurrent(context)) { state.busy.reply = false; render(); }
    }
  }

  async function retryFailedTranslations() {
    const failed = state.messages.filter(item => item.translationStatus === 'failed' || item.translationError);
    for (const message of failed) await translateMessage(message.id);
  }
  async function handleAction(action, element) {
    if (['open', 'login', 'reload', 'reconnect', 'close', 'clear-session', 'probe'].includes(action)) return connectionAction(action);
    if (action === 'create-account') return openAccountForm();
    if (action === 'submit-account') return createAccount();
    if (action === 'cancel-account') return cancelAccountForm();
    if (action === 'switch-account') return switchAccount(element?.dataset?.accountId);
    if (action === 'capture-selection') return captureSelection();
    if (action === 'toggle-left') { state.leftCollapsed = !state.leftCollapsed; writePanelCollapsed('left', state.leftCollapsed); render(); return; }
    if (action === 'toggle-right') { state.rightCollapsed = !state.rightCollapsed; writePanelCollapsed('right', state.rightCollapsed); render(); return; }
    if (action === 'mobile-left' || action === 'mobile-center' || action === 'mobile-right') { state.mobilePanel = action.slice(7); render(); return; }
    if (action === 'new-conversation') { state.mobilePanel = 'left'; render(); requestAnimationFrame(() => $('#wsConversationExternalId')?.focus()); return; }
    if (action === 'create-conversation') return createConversation();
    if (action === 'create-collection-run') return createCollectionRun();
    if (action === 'pause-collection') return updateCollectionRun('paused');
    if (action === 'resume-collection') return updateCollectionRun('running');
    if (action === 'stop-collection') return updateCollectionRun('stopped');
    if (action === 'resume-collection-checkpoint') return resumeCollectionFromCheckpoint();
    if (action === 'discover-conversations') return discoverConversations();
    if (action === 'capture-visible-messages') return captureVisibleMessages();
    if (action === 'open-followup-alert') { state.mobilePanel = 'center'; return loadConversationData(element.dataset.id); }
    if (action === 'done-followup-alert') return updateFollowupAlert(element, 'done');
    if (action === 'snooze-followup-alert') return updateFollowupAlert(element, 'snoozed');
    if (action === 'dismiss-followup-alert') return updateFollowupAlert(element, 'dismissed');
    if (action === 'select-conversation') { state.mobilePanel = 'center'; return loadConversationData(element.dataset.id); }
    if (action === 'clear-capture') { currentDraft().captureText = ''; render(); return; }
    if (action === 'import-visible') return importVisible();
    if (action === 'translate-message') return translateMessage(element.dataset.id);
    if (action === 'retry-failed') return retryFailedTranslations();
    if (action === 'analyze') return analyzeConversation();
    if (action === 'use-ai-reply') return useAiReply();
    if (action === 'save-customer') return saveCustomerTo();
    if (action === 'save-customer-to') return saveCustomerTo(element.dataset.id);
    if (action === 'save-followup') return saveFollowup();
    if (action === 'translate-reply') return translateReply();
    if (action === 'copy-reply') return copyReply();
    if (action === 'retry-load') return loadConversations();
  }
  function applyTranslationMode(value) {
    if (value === 'off') state.settings.enabled = false;
    else {
      state.settings.enabled = true;
      state.settings.receive = value === 'both' || value === 'receive';
      state.settings.send = value === 'both' || value === 'send';
    }
  }
  function applyControlChange(target) {
    if (target.matches('#wsTopAccount')) { void switchAccount(target.value); return; }
    if (target.matches('#wsCaptureDirection')) { state.captureDirection = target.value === 'send' ? 'send' : 'receive'; render(); return; }
    if (target.matches('#wsTopTranslationMode')) applyTranslationMode(target.value);
    if (target.matches('#wsTopTranslateEnabled, #wsTranslateEnabled')) state.settings.enabled = target.checked;
    if (target.matches('#wsReceiveEnabled')) state.settings.receive = target.checked;
    if (target.matches('#wsSendEnabled')) state.settings.send = target.checked;
    if (target.matches('#wsShowOriginal')) state.settings.showOriginal = target.checked;
    if (target.matches('#wsTargetLanguage')) state.settings.targetLanguage = target.value;
    if (target.matches('#wsSendLanguage')) state.settings.sendLanguage = target.value;
    if (target.matches('#wsAiEnabled')) state.aiEnabled = target.checked;
    if (target.matches('#wsTopTranslationMode, #wsTopTranslateEnabled, #wsTranslateEnabled, #wsReceiveEnabled, #wsSendEnabled, #wsShowOriginal, #wsTargetLanguage, #wsSendLanguage, #wsAiEnabled')) {
      state.settings = core.normalizeTranslationSettings(state.settings);
      state.translationStatus = state.settings.enabled ? core.translationMode(state.settings) + ' · 正在保存设置' : '翻译已关闭 · 手动翻译仍可用';
      queueSaveSettings();
      render();
    }
  }
  function applyInput(target) {
    if (target.matches('#wsConversationSearch')) {
      state.conversationQuery = target.value;
      const list = $('.ws-session-list');
      if (list) list.innerHTML = renderConversationList();
      return;
    }
    if (target.matches('#wsConversationExternalId')) { state.createExternalId = target.value; return; }
    if (target.matches('#wsConversationTitle')) { state.createTitle = target.value; return; }
    if (target.matches('#wsAccountDisplayName')) { state.accountFormName = target.value; state.accountFormError = ''; return; }
    const draft = currentDraft();
    const fields = {
      wsVisibleChat: 'captureText',
      wsCustomerName: 'customerName',
      wsCustomerPhone: 'customerPhone',
      wsCustomerCountry: 'customerCountry',
      wsCustomerLanguage: 'customerLanguage',
      wsCustomerProduct: 'customerProduct',
      wsCustomerBudget: 'customerBudget',
      wsCustomerStage: 'customerStage',
      wsCustomerIntent: 'customerIntent',
      wsCustomerTags: 'customerTags',
      wsCustomerNote: 'customerNote',
      wsFollowupNote: 'followupNote',
      wsNextFollow: 'nextFollow',
      wsReplyInput: 'replyInput',
    };
    const key = fields[target.id];
    if (!key) return;
    draft[key] = target.value;
    if (target.id === 'wsReplyInput' && draft.replyPreviewSource !== target.value) {
      draft.replyPreview = '';
      draft.replyPreviewSource = '';
      draft.replyError = '';
    }
    if (target.id === 'wsVisibleChat') {
      const rows = core.parseVisibleChat(target.value, state.captureDirection);
      const receive = rows.filter(row => row.direction === 'receive').length;
      const preview = $('#wsCapturePreview');
      if (preview) preview.textContent = `识别 ${rows.length} 条：客户发来 ${receive} 条，我发送 ${rows.length - receive} 条`;
      const button = $('[data-ws-action="import-visible"]');
      if (button) button.disabled = !activeConversation() || !rows.length || state.busy.import;
    }
  }
  function activate() {
    const host = getHost();
    if (!host) return;
    state.active = true;
    clearInterval(collectionRefreshTimer);
    clearInterval(autoCaptureTimer);
    collectionRefreshTimer = setInterval(() => { void refreshCollectionSummary(); }, 12000);
    autoCaptureTimer = setInterval(() => { void autoCaptureCurrentConversation().catch(() => {}); }, 15000);
    host.state.view = 'ws-workbench';
    state.error = '';
    $('#crumbCurrent').textContent = 'WS 工作台';
    $$('.nav-item').forEach(item => item.classList.toggle('active', item.dataset.view === 'ws-workbench'));
    document.body.classList.add('ws-mode');
    render();
    loadAccounts().then(() => {
      render();
      return wsBridge('open').catch(error => { state.error = error.message || 'WS 账号页面打开失败。'; }).then(() => loadConversations());
    }).then(() => wsBridge('status')).then(result => { updateAccountStatus(result); setStatus(result.status, result.detail || ''); render(); return refreshCollectionSummary(); }).catch(error => setStatus('连接失败', error.message));
  }
  function deactivate() {
    if (!state.active) return;
    state.active = false;
    browserResizeObserver?.disconnect?.();
    browserResizeObserver = undefined;
    clearInterval(collectionRefreshTimer);
    collectionRefreshTimer = undefined;
    clearInterval(autoCaptureTimer);
    autoCaptureTimer = undefined;
    document.body.classList.remove('ws-mode');
    wsBridge('hide').catch(() => {});
  }
  async function exportWsData() { return api('/api/ws/export', { timeout: 30000 }); }
  async function importWsData(value) {
    if (!value || typeof value !== 'object') return { skipped: true };
    return api('/api/ws/import', { method: 'POST', timeout: 60000, body: JSON.stringify(value) });
  }
  window.__zhikeWsBackup = Object.freeze({ exportData: exportWsData, importData: importWsData });
  window.__zhikeWsFollowups = Object.freeze({
    load: async (limit = 8) => {
      const safeLimit = Math.min(30, Math.max(1, Number(limit) || 8));
      const result = await api(`/api/ws/followup-alerts?limit=${safeLimit}`);
      return Array.isArray(result.alerts) ? result.alerts : [];
    },
    openWorkspace: () => activate(),
  });
  function boot() {
    const host = getHost();
    if (!host) { setTimeout(boot, 50); return; }
    const nav = $('#mainNav');
    nav?.addEventListener('click', event => {
      const item = event.target.closest('[data-view]');
      if (!item) return;
      if (item.dataset.view === 'ws-workbench') {
        event.preventDefault();
        event.stopImmediatePropagation();
        activate();
      } else deactivate();
    }, true);
    const view = $('#viewContainer');
    view?.addEventListener('click', event => {
      const element = event.target.closest('[data-ws-action]');
      if (!element) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      Promise.resolve(handleAction(element.dataset.wsAction, element)).catch(error => {
        state.error = error.message || 'WS 操作失败，请重试。';
        toast(state.error, 'x');
        render();
      });
    }, true);
    view?.addEventListener('change', event => {
      if (!event.target.closest('.ws-workbench-page')) return;
      event.stopImmediatePropagation();
      applyControlChange(event.target);
    }, true);
    view?.addEventListener('input', event => {
      if (!event.target.closest('.ws-workbench-page')) return;
      applyInput(event.target);
    }, true);
    view?.addEventListener('keydown', event => {
      if (event.target.id === 'wsAccountDisplayName') {
        if (event.key === 'Escape') { event.preventDefault(); cancelAccountForm(); return; }
        if (event.key === 'Enter') { event.preventDefault(); void createAccount(); return; }
      }
      if (event.target.id === 'wsVisibleChat' && event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        importVisible();
      }
    }, true);
    // WS BrowserView is docked to the workbench viewport; page scrolling is
    // disabled in ws-mode, so it must not chase nested scroll containers.
    window.zhikeDesktop?.onWsStatus?.(payload => {
      if (!payload) return;
      if (payload.restoreAccountId) {
        ++state.accountLoadSequence;
        state.pendingRestoreAccountId = String(payload.restoreAccountId);
        state.activeAccountId = String(payload.restoreAccountId);
        writeStoredAccountId(state.activeAccountId);
        state.accountBusy = false;
        state.busy.import = false; state.busy.customer = false; state.busy.followup = false; state.busy.reply = false; state.busy.capture = false; state.aiBusy = false; state.translationBusy.clear();
        state.currentConversationId = '';
        state.conversations = [];
        updateAccountStatus({ ...payload, accountId: state.activeAccountId, status: payload.status || '连接失败' });
        if (state.accounts.some(item => String(item.id) === state.activeAccountId)) void loadConversations();
        render();
        return;
      }
      updateAccountStatus(payload);
      setStatus(payload.status || '未连接', payload.detail || '');
      if (state.active && payload.status === '已连接') void refreshCollectionSummary();
    });
    window.addEventListener('resize', () => { if (state.active) requestAnimationFrame(resizeWsView); });
    window.addEventListener('offline', () => setStatus('连接失败', '网络已断开；知客本地客户功能仍可使用。'));
    window.addEventListener('online', () => {
      if (!state.active) return;
      wsBridge('probe').then(result => {
        setStatus(result.status, result.detail || '');
        if (result.status === '已连接') void refreshCollectionSummary();
      }).catch(() => {});
    });
    observer = new MutationObserver(() => {
      if (!rendering && state.active && host.state.view === 'ws-workbench' && !$('#viewContainer .ws-workbench-page')) render();
    });
    observer.observe(view, { childList: true });
  }
  boot();
})();
