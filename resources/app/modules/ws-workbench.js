(() => {
  const core = window.ZhikeWsCore;
  const hotProfileCore = window.ZhikeHotChatProfile || {};
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
  const CONVERSATION_RENDER_BATCH = 120;
  const VERIFIED_NATIVE_DIRECTION_SOURCE_MAP = new Map([
    ['class-message-out', 'send'], ['class-message-in', 'receive'],
    ['data-id-outgoing', 'send'], ['data-id-incoming', 'receive'],
    ['icon-tail-out', 'send'], ['icon-tail-in', 'receive'],
    ['palette-outgoing', 'send'], ['palette-incoming', 'receive'],
  ]);
  const state = {
    active: false,
    // `active` only describes whether the WS route is currently visible.
    // Once the user has opened WS successfully, `backgroundActive` keeps the
    // account-scoped collection/AI pipeline alive while another Zhike page is
    // displayed or the desktop window is minimised.
    backgroundActive: false,
    accounts: [],
    activeAccountId: 'default',
    accountBusy: false,
    accountFormOpen: false,
    accountFormName: '',
    accountFormError: '',
    accountLoadSequence: 0,
    pendingRestoreAccountId: '',
    currentConversationId: '',
    conversationSelectionManual: false,
    conversations: [],
    conversationWatermarks: new Map(),
    messages: [],
    historyCoverage: { loaded: 0, total: 0, complete: false },
    replies: [],
    settings: core.normalizeTranslationSettings({}),
    aiEnabled: true,
    wsStatus: '未连接',
    wsDetail: '',
    wsErrorCategory: '',
    analysis: null,
    analysisMeta: null,
    hotProfile: null,
    hotProfileError: '',
    hotProfileBusy: false,
    hotProfileEdits: Object.create(null),
    hotProfileColorDraft: '',
    crmSyncStatus: '',
    aiBusy: false,
    translationBusy: new Set(),
    busy: { import: false, customer: false, followup: false, reply: false, capture: false, connection: false, readHistory: false },
    leftCollapsed: readPanelCollapsed('left'),
    rightCollapsed: readPanelCollapsed('right'),
    captureCollapsed: readPanelCollapsed('capture'),
    mobilePanel: 'center',
    captureDirection: 'receive',
    conversationQuery: '',
    conversationWindowStart: 0,
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
    readHistorySkipped: [],
    readHistoryAutoStarted: false,
    followupAlerts: [],
    discoveredConversations: [],
    visibleConversationFingerprint: '',
    collectionRefreshing: false,
    collectionRefreshQueued: false,
    autoCaptureSignature: '',
    previewAnalysisSignatures: new Map(),
    analysisRefreshPending: new Set(),
    listSyncBusy: false,
    aiQueueStats: { queued: 0, running: 0, retryable: 0, completed: 0, failed: 0, total: 0 },
    aiBackgroundError: '',
    vipGroupConfigSignatures: new Map(),
  };
  let rendering = false;
  let observer;
  let browserResizeObserver;
  let settingsSaveTimer;
  let settingsSaveSequence = 0;
  let collectionRefreshTimer;
  let autoCaptureTimer;
  let backgroundStartPromise = null;
  let backgroundGeneration = 0;
  let backgroundStartGeneration = 0;
  let autoCaptureNoticeAt = 0;
  let loadSequence = 0;
  let aiPumpPromise = null;
  let aiPumpController = null;
  let aiPumpQueued = false;
  let aiPumpScheduled = false;
  let manualAiController = null;
  // ResizeObserver can emit several notifications while the three-column
  // layout settles. Keep only one frame and one native bridge call in flight;
  // otherwise each notification queues a WebView2 round-trip and makes
  // scrolling/dragging feel sticky.
  let resizeFramePending = false;
  let resizeInFlight = false;
  let resizePending = false;
  let lastResizeBounds = '';
  let conversationLoadFrame = 0;
  const backgroundAccountRefreshQueue = new Set();
  let backgroundAccountRefreshPromise = null;

  function restartBackgroundPolling() {
    clearInterval(collectionRefreshTimer);
    clearInterval(autoCaptureTimer);
    collectionRefreshTimer = undefined;
    autoCaptureTimer = undefined;
    // The desktop WebView2 overlay can make the parent document report
    // `hidden` while the WS view is still visible and logged in.  Gating the
    // collection poll on document.hidden therefore stopped list-level
    // collection entirely in the native shell. Collection and the durable AI
    // queue remain active after the user leaves the WS route. Current-chat DOM
    // capture is a visible-page fallback only and must not run in the
    // background (the native collector owns full-history capture there).
    if (!state.backgroundActive) return;
    collectionRefreshTimer = setInterval(() => { if (state.backgroundActive) void refreshCollectionSummary(); }, 12000);
    autoCaptureTimer = setInterval(() => { if (state.active && !document.hidden) void autoCaptureCurrentConversation(); }, 15000);
  }
  const refreshPollingVisibility = () => { if (state.backgroundActive) restartBackgroundPolling(); };
  if (window.ZhikeDesktopPerformance?.pauseHiddenPolling) window.ZhikeDesktopPerformance.pauseHiddenPolling(refreshPollingVisibility, refreshPollingVisibility);
  else document.addEventListener('visibilitychange', refreshPollingVisibility);

  function activeAccount() {
    return state.accounts.find(item => String(item.id) === String(state.activeAccountId)) || null;
  }
  function accountStatusLabel(account) {
    const status = account?.status || (String(account?.id) === 'default' ? '未连接' : '未连接');
    // The server deliberately clears stale runtime status after restart. Keep
    // that honest while showing reconnect context from the persisted last
    // observation, instead of making the account look silently lost.
    if (status === '未连接' && account?.lastKnownStatus === '已连接' && account?.lastSeen) return '待检测';
    return status;
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
  function aiCancellationError(message = 'AI 分析已取消。') {
    const error = new Error(message);
    error.name = 'AbortError';
    error.code = 'CANCELLED';
    return error;
  }
  function isAiCancellation(error, signal = null) {
    return Boolean(signal?.aborted || error?.name === 'AbortError' || error?.code === 'CANCELLED' || /取消|cancelled|canceled|WS 账号已切换|过期操作/i.test(String(error?.message || '')));
  }
  function throwIfAiCancelled(signal) {
    if (signal?.aborted) throw aiCancellationError();
  }
  function cancelBackgroundAiPump() {
    aiPumpQueued = false;
    aiPumpController?.abort?.();
    return aiPumpPromise || Promise.resolve();
  }
  function cancelAllAiWork() {
    const pending = cancelBackgroundAiPump();
    manualAiController?.abort?.();
    return pending;
  }
  function startBackgroundRuntime() {
    const started = !state.backgroundActive;
    state.backgroundActive = true;
    if (started) {
      backgroundGeneration += 1;
      state.readHistoryAutoStarted = false;
    }
    restartBackgroundPolling();
    return started;
  }
  function stopBackgroundRuntime() {
    if (!state.backgroundActive && !collectionRefreshTimer && !autoCaptureTimer) return;
    state.backgroundActive = false;
    backgroundAccountRefreshQueue.clear();
    backgroundGeneration += 1;
    ++state.accountLoadSequence;
    ++loadSequence;
    void cancelAllAiWork();
    clearTimeout(settingsSaveTimer);
    settingsSaveTimer = undefined;
    ++settingsSaveSequence;
    state.loading = false;
    state.accountsLoading = false;
    state.accountBusy = false;
    state.aiBusy = false;
    state.collectionRefreshing = false;
    state.collectionRefreshQueued = false;
    state.listSyncBusy = false;
    state.readHistoryAutoStarted = false;
    state.busy.import = false;
    state.busy.customer = false;
    state.busy.followup = false;
    state.busy.reply = false;
    state.busy.capture = false;
    state.busy.connection = false;
    state.busy.readHistory = false;
    state.translationBusy.clear();
    clearInterval(collectionRefreshTimer);
    collectionRefreshTimer = undefined;
    clearInterval(autoCaptureTimer);
    autoCaptureTimer = undefined;
  }
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
        // Do not replace a previously loaded list with a transient empty
        // response. The backend repairs the default row, but this guard also
        // protects the first render while the service is still opening its
        // SQLite profile.
        if (!response.accounts.length) throw new Error('WS 账号列表为空，正在重试。');
        return response;
      }, { attempts: 6, delayMs: attempt => Math.min(1200, 100 * (2 ** attempt)) });
      if (sequence !== state.accountLoadSequence && !state.pendingRestoreAccountId) return;
      const loadedAccounts = Array.isArray(result?.accounts) ? result.accounts : [];
      if (!loadedAccounts.length && state.accounts.length) throw new Error('WS 账号列表为空，已保留当前账号。');
      state.accounts = loadedAccounts;
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
         } catch (error) {
           if (sequence === state.accountLoadSequence) state.error = `WS 账号状态检测失败：${String(error?.message || '桌面视图暂不可用').slice(0, 200)}`;
         }
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
      const switched = await switchAccount(result.account.id);
      if (!switched) {
        state.accountFormError = '账号已创建，但当前窗口切换失败；请从账号列表重新选择。';
        toast(state.accountFormError, 'x');
        return;
      }
      toast('已添加 WS 账号，请在中栏完成扫码或登录。');
    } catch (error) {
      state.accountFormError = error.message || 'WS 账号创建失败。';
      toast(state.accountFormError, 'x');
    }
    finally { state.accountBusy = false; render(); }
  }
  async function switchAccount(accountId) {
    const id = text(accountId) || 'default';
    if (id === String(state.activeAccountId)) return true;
    if (!state.accounts.some(item => String(item.id) === id)) return false;
    const previous = state.activeAccountId;
    const sequence = ++state.accountLoadSequence;
    void cancelAllAiWork();
    state.accountBusy = true;
    state.collectionRefreshing = false;
    state.collectionRefreshQueued = false;
    state.autoCaptureSignature = '';
    state.readHistoryAutoStarted = false;
    state.previewAnalysisSignatures.clear();
    state.analysisRefreshPending.clear();
    state.listSyncBusy = false;
    state.visibleConversationFingerprint = '';
    state.aiBackgroundError = '';
    clearTimeout(settingsSaveTimer); settingsSaveTimer = undefined; ++settingsSaveSequence;
    state.busy.import = false; state.busy.customer = false; state.busy.followup = false; state.busy.connection = false; state.busy.reply = false; state.busy.capture = false; state.busy.readHistory = false; state.aiBusy = false; state.translationBusy.clear();
    state.activeAccountId = id;
    state.currentConversationId = '';
    state.conversationSelectionManual = false;
    state.conversationWindowStart = 0;
    state.conversations = []; state.messages = []; state.historyCoverage = { loaded: 0, total: 0, complete: false }; state.analysis = null; state.analysisMeta = null; state.replies = [];
    writeStoredAccountId(id); render();
    try {
      await window.zhikeDesktop.ws({ action: 'open', accountId: id, bounds: boundsForBrowserView() });
      if (sequence !== state.accountLoadSequence) return false;
      await syncVipGroupAllowlist(captureContext(''), true);
      await loadConversations();
      state.error = '';
      if (state.backgroundActive) void refreshCollectionSummary();
      return true;
    } catch (error) {
      state.activeAccountId = previous;
      writeStoredAccountId(previous);
      state.error = error.message || 'WS 账号切换失败，已恢复原账号。';
      try { await window.zhikeDesktop.ws({ action: 'open', accountId: previous, bounds: boundsForBrowserView() }); } catch {}
      await loadConversations();
      return false;
    } finally { state.accountBusy = false; render(); }
  }

  function toast(message, icon = 'check') { getHost()?.toast?.(message, icon); }
  function activeConversation() { return state.conversations.find(item => String(item.id) === String(state.currentConversationId)) || null; }
  function stableHash(value) { return core.stableHash(value); }
  function explicitConversationType(conversation) { return core.conversationType?.(conversation) || 'unknown'; }
  function isExplicitGroupConversation(conversation) { return core.isGroupConversation?.(conversation) === true; }
  function isAutomaticDirectConversation(conversation) { return explicitConversationType(conversation) === 'direct'; }
  function isAutomaticVipGroupConversation(conversation) {
    const data = conversation?.data || {};
    return explicitConversationType(conversation) === 'vip_group' || data.vipGroup === true;
  }
  function isAutomaticCollectibleConversation(conversation) {
    return isAutomaticDirectConversation(conversation) || isAutomaticVipGroupConversation(conversation);
  }
  function isNativeManagedConversation(conversation) {
    const data = conversation?.data || {};
    const source = text(data.source || data.discovery || conversation?.source).toLocaleLowerCase();
    return /(?:ws-webview2|ws-list|visible-page|native)/.test(source)
      || Number(data.directionCaptureVersion || data.directionVersion || 0) > 0
      || Boolean(data.historyFingerprint || data.lastMessageFingerprint);
  }
  function canManuallyProcessConversation(conversation) {
    if (!conversation || (isExplicitGroupConversation(conversation) && !isAutomaticVipGroupConversation(conversation))) return false;
    return isAutomaticCollectibleConversation(conversation) || !isNativeManagedConversation(conversation);
  }
  function ordinaryGroupExclusionMessage(action = '采集、AI 分析或跟进提醒') {
    return `普通群聊未绑定为 VIP 群，不纳入${action}；系统设置中已绑定的 VIP 群会按可信成员身份分别处理。`;
  }
  function personalConversationRows(rows) {
    return (Array.isArray(rows) ? rows : []).filter(row => !isExplicitGroupConversation(row) || isAutomaticVipGroupConversation(row));
  }
  function vipGroupMemberAnalysisScopes(messages) {
    const scopes = [];
    for (const message of Array.isArray(messages) ? messages : []) {
      if (message?.direction === 'send') continue;
      const identity = core.messageMemberIdentity?.(message) || {};
      if (identity.trusted !== true || (!text(identity.senderId) && !text(identity.senderPhone))) continue;
      const existing = scopes.find(item => core.sameMemberIdentity?.(item, identity));
      if (existing) {
        if (!existing.senderId && identity.senderId) existing.senderId = identity.senderId;
        if (!existing.senderPhone && identity.senderPhone) existing.senderPhone = identity.senderPhone;
        if (!existing.senderName && identity.senderName) existing.senderName = identity.senderName;
        if (!existing.identitySource && identity.identitySource) existing.identitySource = identity.identitySource;
      } else scopes.push({
        senderId: text(identity.senderId),
        senderPhone: text(identity.senderPhone),
        senderName: text(identity.senderName),
        identitySource: text(identity.identitySource),
        trusted: true,
      });
    }
    return scopes;
  }
  function vipMemberScopeKey(memberIdentity = {}) {
    const identity = core.messageMemberIdentity?.(memberIdentity) || memberIdentity || {};
    return text(identity.senderId).toLocaleLowerCase() || text(identity.senderPhone) || '';
  }
  function fullHistorySourceFingerprint(conversation) {
    const data = conversation?.data || {};
    const collected = text(data.historyFingerprint);
    const latest = text(data.lastMessageFingerprint);
    // Direction v4 is confirmed only when every final-history bubble has a
    // resolved sender side. Older histories remain readable but cannot drive
    // AI/CRM automation until the native collector safely recollects them.
    return isAutomaticCollectibleConversation(conversation) && data.historyLoaded === true && Number(data.directionVersion || 0) >= 4 && collected && latest && collected === latest ? collected : '';
  }
  function isNavigationConversationPreview(conversation) {
    const data = conversation?.data || {};
    if (data.navigationOnly === true || ['navigation', 'sidebar-navigation'].includes(text(data.rowType || data.kind).toLocaleLowerCase())) return true;
    const previewOnly = data.previewOnly === true || text(data.lastMessageSource) === 'ws-list-preview' || text(data.source) === 'ws-list-discovery' || text(data.discovery) === 'visible-page';
    if (!previewOnly) return false;
    const navigationLabel = /^(?:已?归档|全部|所有|未读|特别关注|群组|社区|状态|频道|收藏|archived?|all|unread|groups?|communities?|status)(?:\d+)?$/i;
    return [conversation?.title, conversation?.externalId, data.displayName]
      .map(value => text(value).replace(/[\s：:·•()（）\[\]【】_-]+/g, ''))
      .some(value => navigationLabel.test(value));
  }
  function isLegacyConversationPreview(conversation) {
    const data = conversation?.data || {};
    return data.previewOnly === true || text(data.lastMessageSource) === 'ws-list-preview' || text(data.source) === 'ws-list-discovery' || text(data.discovery) === 'visible-page';
  }
  function preferredInitialConversation(conversations) {
    const rows = Array.isArray(conversations) ? conversations.filter(Boolean) : [];
    return rows.find(item => Boolean(fullHistorySourceFingerprint(item))) || rows.find(item => !isNavigationConversationPreview(item)) || null;
  }
  function resolveInitialConversationId(conversations, currentConversationId, manuallySelected) {
    const rows = Array.isArray(conversations) ? conversations.filter(Boolean) : [];
    const current = rows.find(item => String(item.id) === String(currentConversationId || '')) || null;
    if (manuallySelected && current) return String(current.id);
    const preferred = preferredInitialConversation(rows);
    if (!current) return preferred ? String(preferred.id) : '';
    if (fullHistorySourceFingerprint(current)) return String(current.id);
    if (isLegacyConversationPreview(current)) return preferred ? String(preferred.id) : '';
    return String(current.id);
  }
  function reconcilePersonalConversationSelection() {
    const currentId = String(state.currentConversationId || '');
    if (!currentId || state.conversations.some(item => String(item.id) === currentId)) return currentId;
    state.currentConversationId = resolveInitialConversationId(state.conversations, '', false);
    state.conversationSelectionManual = false;
    state.messages = [];
    state.historyCoverage = { loaded: 0, total: 0, complete: false };
    state.analysis = null;
    state.analysisMeta = null;
    state.replies = [];
    return String(state.currentConversationId || '');
  }
  function preserveHistoryCollectionState(conversation) {
    const data = conversation?.data || {};
    return data.historyLoaded === true || data.historyStale === true;
  }
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
  async function loadAllConversationMessages(conversationId, context = captureContext(conversationId)) {
    const encoded = encodeURIComponent(String(conversationId || ''));
    if (!encoded) return { messages: [], total: 0, loaded: 0, complete: false };
    const rows = [];
    let offset = 0;
    let total = null;
    let pageCount = 0;
    while (pageCount < 100) {
      assertContext(context);
      const result = await api(`/api/ws/messages?conversationId=${encoded}&limit=1000&offset=${offset}`, {}, context);
      assertContext(context);
      const page = Array.isArray(result?.messages) ? result.messages : [];
      rows.push(...page);
      if (total == null && Number.isFinite(Number(result?.total))) total = Math.max(0, Number(result.total));
      pageCount += 1;
      if (!page.length || result?.hasMore === false || (total != null && rows.length >= total)) break;
      offset += page.length;
    }
    const allMessages = core.dedupeMessages(rows);
    const conversation = state.conversations.find(item => String(item.id) === String(conversationId));
    const currentHistoryFingerprint = fullHistorySourceFingerprint(conversation);
    const messages = conversation?.data?.historyLoaded === true ? allMessages.filter(item => item.data?.previewOnly !== true && item.data?.source !== 'ws-list-preview') : allMessages;
    const expected = total == null ? allMessages.length : total;
    const databaseComplete = total != null ? allMessages.length >= total : pageCount < 100;
    return { messages, total: messages.length, loaded: messages.length, databaseComplete, complete: databaseComplete && Boolean(currentHistoryFingerprint), sourceFingerprint: currentHistoryFingerprint };
  }
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
  const HOT_PROFILE_LABELS = Object.freeze({
    preferred_name: '客户姓名或称呼',
    age: '客户年龄',
    gender: '客户性别',
    occupation: '职业及工作情况',
    work_context: '工作背景',
    is_investor: '是否为股民',
    investment_years: '股龄 / 投资经验',
    holdings: '当前持仓情况',
    investment_habits: '投资习惯',
    investment_preferences: '投资偏好',
    family_context: '家庭状况',
    life_interests: '生活兴趣',
    future_plans: '未来规划',
  });
  const HOT_PROFILE_STATE_LABELS = Object.freeze({ known: '已了解', missing: '待了解', pending: '待确认', declined: '客户暂不愿透露' });
  const HOT_PROFILE_COLORS = Object.freeze({ green: '资料完整', blue: '正常维护', amber: '重点了解', red: '优先跟进', gray: '暂缓打扰' });
  function hotProfileFieldValue(value) {
    if (Array.isArray(value)) return value.join('、');
    if (value === true) return '是';
    if (value === false) return '否';
    return text(value);
  }
  function hotProfileProfileFields(profile) {
    const fields = profile?.fields && typeof profile.fields === 'object' ? profile.fields : {};
    const keys = Array.isArray(hotProfileCore.PROFILE_FIELDS) && hotProfileCore.PROFILE_FIELDS.length ? hotProfileCore.PROFILE_FIELDS : Object.keys(HOT_PROFILE_LABELS);
    return keys.map(field => ({ field, ...(fields[field] || { field, value: null, state: 'missing', confidence: 0, evidence: [], manualLocked: false }) }));
  }
  function hotProfileDerived(profile) {
    const fields = Object.fromEntries(hotProfileProfileFields(profile).map(item => [item.field, item]));
    const missingFields = hotProfileProfileFields(profile).filter(item => item.state !== 'known' && item.state !== 'declined').map(item => item.field);
    const persistedTopics = Array.isArray(profile?.nextTopics) ? profile.nextTopics.map(text).filter(Boolean).slice(0, 3) : [];
    const nextTopics = persistedTopics.length ? persistedTopics : (hotProfileCore.deriveNextTopics?.({ profile: fields, missingFields, naturalNextTopics: state.analysis?.naturalNextTopics }) || missingFields.slice(0, 3));
    const messages = Array.isArray(state.messages) ? state.messages : [];
    const lastInbound = messages.filter(item => item.direction !== 'send').at(-1)?.createdAt || '';
    const lastOutbound = messages.filter(item => item.direction === 'send').at(-1)?.createdAt || '';
    const persistedNoReply = profile?.noReply && typeof profile.noReply === 'object' ? profile.noReply : null;
    const noReply = persistedNoReply?.noReply
      ? { reason: persistedNoReply.reason || '客户暂未回复，按冷却周期再跟进。', cooldown: true }
      : (hotProfileCore.assessNoReply?.({ lastInboundAt: lastInbound, lastOutboundAt: lastOutbound, followupCount: state.followupAlerts?.length || 0 }) || { reason: '可在自然话题中适度跟进。', cooldown: false });
    return { fields, missingFields, nextTopics, noReply, progress: text(profile?.conversationProgress), summary: text(profile?.profileSummary), temperature: text(profile?.customerTemperature), tags: Array.isArray(profile?.tags) ? profile.tags.map(text).filter(Boolean).slice(0, 8) : [] };
  }
  function hotProfileEditValue(item) {
    if (Object.hasOwn(state.hotProfileEdits, item.field)) return state.hotProfileEdits[item.field];
    return hotProfileFieldValue(item.value);
  }
  function hotProfileEvidence(item) {
    const evidence = Array.isArray(item.evidence) ? item.evidence : [];
    const latest = evidence.at(-1);
    return text(latest?.text || latest?.evidence || '') || '尚未记录可核验聊天依据';
  }
  function renderHotProfile() {
    const profile = state.hotProfile;
    if (!profile) return `<section class="ws-card ws-hot-profile-card"><div class="ws-card-heading"><div><strong>热聊客户档案</strong><span>从自然聊天逐步补齐，不连续盘问客户</span></div><button class="btn small" data-ws-action="refresh-hot-profile">刷新</button></div><div class="ws-empty">当前会话还没有热聊档案。完成一次 AI 分析或点击刷新后，会显示已了解、待确认和待了解内容。</div>${state.hotProfileError ? `<p class="ws-error-line">${esc(state.hotProfileError)}</p>` : ''}</section>`;
    const derived = hotProfileDerived(profile);
    const color = HOT_PROFILE_COLORS[state.hotProfileColorDraft] ? state.hotProfileColorDraft : (HOT_PROFILE_COLORS[profile.statusColor] ? profile.statusColor : 'gray');
    const colorOptions = Object.entries(HOT_PROFILE_COLORS).map(([value, label]) => `<option value="${value}" ${value === color ? 'selected' : ''}>${label}</option>`).join('');
    const fields = hotProfileProfileFields(profile).map(item => {
      const stateLabel = HOT_PROFILE_STATE_LABELS[item.state] || item.state || '待了解';
      const locked = Boolean(item.manualLocked);
      const value = hotProfileEditValue(item);
      return `<div class="ws-hot-profile-field" data-state="${esc(item.state || 'missing')}">
        <div class="ws-hot-profile-field-head"><strong>${esc(HOT_PROFILE_LABELS[item.field] || item.field)}</strong><span class="ws-hot-profile-state state-${esc(item.state || 'missing')}">${esc(stateLabel)}</span></div>
        <input class="ws-hot-profile-input" data-hot-profile-field="${esc(item.field)}" value="${esc(value)}" placeholder="${item.state === 'declined' ? '客户暂不愿透露' : '聊天中自然了解后再补充'}" ${locked ? 'aria-readonly="true" readonly' : ''}>
        <small class="ws-hot-profile-evidence">${esc(hotProfileEvidence(item))}${locked ? ' · 已锁定' : ''}</small>
        <div class="ws-hot-profile-actions"><button class="btn small" data-ws-action="confirm-hot-profile" data-field="${esc(item.field)}">确认</button><button class="btn small ${locked ? 'danger' : ''}" data-ws-action="lock-hot-profile" data-field="${esc(item.field)}" data-locked="${locked ? 'true' : 'false'}">${locked ? '解除锁定' : '确认并锁定'}</button></div>
      </div>`;
    }).join('');
    const topics = derived.nextTopics.map(field => `<span class="ws-hot-profile-topic">${esc(HOT_PROFILE_LABELS[field] || field)}</span>`).join('');
    const missing = derived.missingFields.length ? derived.missingFields.map(field => HOT_PROFILE_LABELS[field] || field).slice(0, 5).join('、') : '核心资料已基本完整';
    return `<section class="ws-card ws-hot-profile-card" data-color="${esc(color)}">
      <div class="ws-card-heading"><div><strong>热聊客户档案</strong><span>已完成 ${Number(profile.completeness || 0)}% · 只补空字段，冲突保留原值并记录证据</span></div><button class="btn small" data-ws-action="refresh-hot-profile" ${state.hotProfileBusy ? 'disabled' : ''}>${state.hotProfileBusy ? '刷新中…' : '刷新'}</button></div>
      <div class="ws-hot-profile-toolbar"><label>客户状态<select id="wsHotProfileColor" data-hot-profile-color>${colorOptions}</select></label><span class="ws-hot-profile-status status-${esc(color)}">${esc(HOT_PROFILE_COLORS[color])}</span><button class="btn small" data-ws-action="save-hot-profile-color">保存标记</button></div>
      <div class="ws-hot-profile-progress"><span style="width:${Math.max(0, Math.min(100, Number(profile.completeness) || 0))}%"></span></div>
      <div class="ws-hot-profile-overview"><span class="ws-hot-profile-missing">待了解：${esc(missing)}</span>${derived.progress ? `<span>沟通进度：${esc(derived.progress)}</span>` : ''}${derived.temperature ? `<span>客户温度：${esc(derived.temperature)}</span>` : ''}${derived.summary ? `<span>AI 摘要：${esc(derived.summary)}</span>` : ''}<span class="${derived.noReply.cooldown ? 'is-warning' : ''}">${esc(derived.noReply.reason)}</span>${derived.tags.length ? `<span>标签：${esc(derived.tags.join('、'))}</span>` : ''}</div>
      ${topics ? `<div class="ws-hot-profile-topics"><strong>下一步自然话题</strong><div>${topics}</div></div>` : ''}
      <div class="ws-hot-profile-fields">${fields}</div>
      ${state.hotProfileError ? `<p class="ws-error-line">${esc(state.hotProfileError)}</p>` : ''}
    </section>`;
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
      const requestHeaders = { 'Content-Type': 'application/json', ...(nextInit.headers || {}) };
      const mutatingHotProfile = url.pathname.startsWith('/api/ws/hot-chat/profile') && String(nextInit.method || 'GET').toUpperCase() !== 'GET';
      if ((url.pathname === '/api/ws/crm-sync' || mutatingHotProfile) && !Object.keys(requestHeaders).some(key => key.toLowerCase() === 'x-state-version')) {
        const version = getHost()?.getStateVersion?.();
        if (version !== undefined) requestHeaders['X-State-Version'] = String(version || '');
      }
      const execute = async () => fetch(url.pathname + url.search + url.hash, {
        cache: 'no-store',
        ...nextInit,
        ...(canCoalesce ? {} : { signal: controller.signal }),
        headers: requestHeaders,
      });
      const coalescer = window.ZhikeDesktopPerformance?.requestCoalescer;
      const canCoalesce = !nextInit.method || String(nextInit.method).toUpperCase() === 'GET';
      const response = canCoalesce && coalescer
        ? await coalescer(`${accountId}:${url.pathname}${url.search}${url.hash}`, execute)
        : await execute();
      if (controller.signal.aborted) throw new DOMException('The operation was aborted.', 'AbortError');
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        // Preserve the native bridge's actionable error (for example a
        // recovering sidecar or an expired local session) instead of hiding
        // every failure behind the same generic WS message.
        throw new Error(body.error || body.message || body.errorCode || 'WS 本机数据服务暂不可用。');
      }
      return body;
    } catch (error) {
      if (error?.name === 'AbortError') throw new Error('WS 本机数据服务响应超时，请重试。');
      throw error;
    } finally { clearTimeout(timer); }
  }
  async function loadAllConversationPages(context = captureContext('')) {
    const conversations = [], seen = new Set(), seenCursors = new Set();
    let cursor = '', newest = null;
    // The service page is intentionally bounded; this loop is the product's
    // all-conversations contract. A cursor cycle is treated as corruption
    // rather than silently returning a partial account.
    for (let page = 0; page < 1000; page += 1) {
      const suffix = cursor ? `&cursor=${encodeURIComponent(cursor)}` : '';
      const result = await api(`/api/ws/conversations?limit=1000${suffix}`, {}, context);
      assertContext(context);
      for (const item of Array.isArray(result.conversations) ? result.conversations : []) {
        const id = String(item?.id || '');
        if (!id || seen.has(id)) continue;
        seen.add(id);
        conversations.push(item);
      }
      newest = newestConversationWatermark([result.scannedNewest], newest);
      const nextCursor = text(result.nextCursor);
      if (!nextCursor) return { conversations, pages: page + 1, watermark: newest || newestConversationWatermark(conversations) };
      if (seenCursors.has(nextCursor)) throw new Error('WS 会话分页游标重复，已停止加载以避免遗漏或死循环。');
      seenCursors.add(nextCursor);
      cursor = nextCursor;
    }
    throw new Error('WS 会话数量超过单次安全加载范围，未返回不完整结果。');
  }
  function conversationWatermark(value) {
    const updatedAt = text(value?.updatedAt || value?.updated_at);
    const id = text(value?.id);
    return updatedAt && id ? { updatedAt, id } : null;
  }
  function compareConversationWatermarks(left, right) {
    if (!left && !right) return 0;
    if (!left) return -1;
    if (!right) return 1;
    const timeOrder = String(left.updatedAt).localeCompare(String(right.updatedAt));
    return timeOrder || String(left.id).localeCompare(String(right.id));
  }
  function newestConversationWatermark(rows, fallback = null) {
    let newest = fallback;
    for (const row of Array.isArray(rows) ? rows : []) {
      const candidate = conversationWatermark(row);
      if (compareConversationWatermarks(candidate, newest) > 0) newest = candidate;
    }
    return newest;
  }
  function mergeConversationInventory(current, changed, excludedIds = []) {
    const merged = new Map((Array.isArray(current) ? current : []).map(row => [String(row.id), row]));
    for (const id of excludedIds || []) merged.delete(String(id));
    for (const row of Array.isArray(changed) ? changed : []) if (row?.id) merged.set(String(row.id), row);
    return [...merged.values()].sort((left, right) => -compareConversationWatermarks(conversationWatermark(left), conversationWatermark(right)));
  }
  async function loadConversationDeltaPages(context = captureContext('')) {
    const accountId = String(context.accountId || state.activeAccountId || 'default');
    const previousWatermark = state.conversationWatermarks.get(accountId);
    if (!previousWatermark || !state.conversations.length) return loadAllConversationPages(context);
    const conversations = [], excludedIds = new Set(), seen = new Set(), seenCursors = new Set();
    let cursor = '', newest = previousWatermark;
    for (let page = 0; page < 1000; page += 1) {
      const suffix = cursor ? `&cursor=${encodeURIComponent(cursor)}` : '';
      const result = await api(`/api/ws/conversations?limit=250${suffix}`, {}, context);
      assertContext(context);
      const rows = Array.isArray(result.conversations) ? result.conversations : [];
      for (const item of rows) {
        const id = String(item?.id || '');
        if (!id || seen.has(id)) continue;
        seen.add(id);
        conversations.push(item);
      }
      for (const id of Array.isArray(result.excludedConversationIds) ? result.excludedConversationIds : []) excludedIds.add(String(id));
      newest = newestConversationWatermark([result.scannedNewest, ...rows], newest);
      const scannedThrough = conversationWatermark(result.scannedThrough) || conversationWatermark(rows.at(-1));
      const crossedPreviousWatermark = Boolean(scannedThrough) && compareConversationWatermarks(scannedThrough, previousWatermark) <= 0;
      const nextCursor = text(result.nextCursor);
      if (crossedPreviousWatermark || !nextCursor) {
        return { conversations, excludedIds: [...excludedIds], pages: page + 1, watermark: newest, incremental: true };
      }
      if (seenCursors.has(nextCursor)) throw new Error('WS 会话增量分页游标重复，已停止加载以避免遗漏或死循环。');
      seenCursors.add(nextCursor);
      cursor = nextCursor;
    }
    throw new Error('WS 会话增量超过单次安全加载范围，未更新水位。');
  }
  function applyConversationInventory(result, accountId = state.activeAccountId) {
    const scopedAccountId = String(accountId || 'default');
    const nextRows = result?.incremental
      ? mergeConversationInventory(state.conversations, result.conversations, result.excludedIds)
      : (Array.isArray(result?.conversations) ? result.conversations : state.conversations);
    state.conversations = personalConversationRows(nextRows);
    const watermark = result?.watermark || newestConversationWatermark(state.conversations, state.conversationWatermarks.get(scopedAccountId));
    if (watermark) state.conversationWatermarks.set(scopedAccountId, watermark);
    return state.conversations;
  }
  function boundsForBrowserView() {
    const node = $('#wsBrowserHost');
    if (!node) return { hidden: true };
    const rect = node.getBoundingClientRect();
    const style = getComputedStyle(node);
    const hidden = !state.active || style.display === 'none' || style.visibility === 'hidden' || rect.width < 40 || rect.height < 40;
    return { hidden, x: Math.round(rect.left), y: Math.round(rect.top), width: Math.round(rect.width), height: Math.round(rect.height) };
  }
  function configuredVipGroups(accountId = state.activeAccountId) {
    const settings = getHost()?.state?.settings || {};
    const sources = [settings.wsVipGroupAllowlist, settings.wsVipGroups, settings.vipGroupBindings];
    const values = [];
    for (const source of sources) for (const item of Array.isArray(source) ? source : []) {
      if (typeof item === 'string') { if (text(item)) values.push(text(item)); continue; }
      if (!item || typeof item !== 'object' || item.enabled === false) continue;
      const scopedAccount = text(item.accountId || item.wsAccountId);
      if (scopedAccount && scopedAccount !== String(accountId || 'default')) continue;
      for (const value of [item.conversationKey, item.externalId, item.jid, item.groupId, item.title, item.name])
        if (text(value)) values.push(text(value));
    }
    return [...new Set(values)].slice(0, 500);
  }
  function isConfiguredVipGroupIdentifier(...values) {
    const normalize = value => text(value).normalize('NFKC').toLocaleLowerCase();
    const configured = new Set(configuredVipGroups().map(normalize).filter(Boolean));
    return values.some(value => configured.has(normalize(value)));
  }
  async function wsBridge(action, context = null, extra = null) {
    if (!window.zhikeDesktop?.ws) throw new Error('当前页面没有桌面 WS 视图能力，请从知客安装版打开。');
    return window.zhikeDesktop.ws({ ...(extra && typeof extra === 'object' ? extra : {}), action, accountId: context?.accountId || state.activeAccountId || 'default', bounds: boundsForBrowserView() });
  }
  async function syncVipGroupAllowlist(context = captureContext(''), force = false) {
    const accountId = String(context?.accountId || state.activeAccountId || 'default');
    const vipGroups = configuredVipGroups(accountId);
    const signature = JSON.stringify(vipGroups);
    if (!force && state.vipGroupConfigSignatures.get(accountId) === signature) return { accepted:vipGroups.length, unchanged:true };
    const result = await wsBridge('configure-vip-groups', { ...context, accountId }, { vipGroups });
    state.vipGroupConfigSignatures.set(accountId, signature);
    return result;
  }
  function updateStatusDom() {
    const badge = $('#wsStatusBadge');
    if (badge) { badge.textContent = state.wsStatus; badge.dataset.status = state.wsStatus; badge.dataset.errorCategory = state.wsErrorCategory || ''; }
    const detail = $('#wsStatusDetail');
    const statusDetail = state.wsDetail || (state.wsStatus === '已连接' ? '已通过页面结构确认 WS 主界面；未读取 Cookie 或消息正文。' : '请在中栏自行完成扫码或登录。');
    if (detail) { detail.textContent = statusDetail; detail.title = statusDetail; }
  }
  function setStatus(status, detail = '') {
    state.wsStatus = status || '未连接';
    state.wsDetail = detail;
    if (!['连接失败', '会话过期'].includes(state.wsStatus)) state.wsErrorCategory = '';
    updateStatusDom();
  }
  function classifyWsError(error) {
    const supplied = text(error?.errorCategory || error?.category || '');
    if (['unpaired', 'network', 'session-expired', 'structure-changed', 'service'].includes(supplied)) return supplied;
    const message = text(error?.message || error).toLocaleLowerCase();
    if (/qr|scan|扫码|配对|pair|login|登录|未连接/.test(message)) return 'unpaired';
    if (/network|net::|offline|dns|timeout|超时|网络|断开/.test(message)) return 'network';
    if (/expired|session|logout|过期|会话/.test(message)) return 'session-expired';
    if (/selector|dom|structure|页面结构|未识别|元素/.test(message)) return 'structure-changed';
    return 'service';
  }
  function wsErrorDetail(error, fallback = 'WS 服务暂时不可用，请稍后重试。') {
    const category = classifyWsError(error);
    const labels = { unpaired: 'WS 尚未配对或等待登录', network: 'WS 网络连接异常', 'session-expired': 'WS 会话已过期', 'structure-changed': 'WS 页面结构变化，暂时无法识别', service: 'WS 服务异常' };
    state.wsErrorCategory = category;
    return `${labels[category] || labels.service}：${text(error?.message || error?.error || fallback).slice(0, 180)}`;
  }
  function queueResizeWsView() {
    if (!state.active || resizeFramePending) return;
    resizeFramePending = true;
    requestAnimationFrame(() => {
      resizeFramePending = false;
      void resizeWsView();
    });
  }
  async function resizeWsView() {
    if (!state.active) return;
    const bounds = boundsForBrowserView();
    const signature = JSON.stringify(bounds);
    if (signature === lastResizeBounds && !resizeInFlight) return;
    if (resizeInFlight) { resizePending = true; return; }
    resizeInFlight = true;
    resizePending = false;
    lastResizeBounds = signature;
    try { await wsBridge(bounds.hidden ? 'hide' : 'resize'); }
    catch { /* a transient bridge failure is retried on the next layout change */ }
    finally {
      resizeInFlight = false;
      if (resizePending && state.active) {
        resizePending = false;
        const nextSignature = JSON.stringify(boundsForBrowserView());
        if (nextSignature !== lastResizeBounds) queueResizeWsView();
      }
    }
  }
  async function connectionAction(action) {
    if (state.busy.connection) return;
    if (action === 'clear-session' && !confirm('清除本机 WS 会话后需要重新扫码或登录。客户资料、翻译、AI 分析和跟进记录不会删除。确认继续？')) return;
    const stopAfterAction = action === 'close' || action === 'clear-session';
    state.busy.connection = true;
    let context = null;
    try {
      const restarted = ['open', 'login', 'reload', 'reconnect'].includes(action) ? startBackgroundRuntime() : false;
      if (restarted && !state.accounts.length) await loadAccounts();
      // A deliberate Close/Clear is the user's cancellation boundary, not a
      // best-effort consequence of a successful native response. Stop model
      // work and timers before awaiting WebView2 so a slow/failed bridge can
      // never leave the old account writing in the background.
      if (stopAfterAction) {
        stopBackgroundRuntime();
        state.busy.connection = true;
      }
      context = captureContext('');
      const result = await wsBridge(action, context);
      assertContext(context);
      if (['open', 'login', 'reload', 'reconnect', 'probe'].includes(action))
        await syncVipGroupAllowlist(context, ['open', 'login', 'reload', 'reconnect'].includes(action));
      setStatus(result.status || (action === 'reconnect' ? '正在重连' : action === 'close' || action === 'clear-session' ? '未连接' : '等待登录'), result.detail || '');
      if (action === 'clear-session') toast('WS 隔离登录会话已清除，本地业务记录仍保留');
      else if (action === 'close') toast('WS 页面已关闭，本地业务记录仍保留');
      else if (action === 'probe') toast('WS 登录状态已重新检测');
      else toast('WS 页面已打开，请自行扫码或登录');
      if (!stopAfterAction && state.backgroundActive) {
        if (!state.conversations.length) await loadConversations();
        void refreshCollectionSummary();
      }
    } catch (error) {
      if (!context || contextCurrent(context)) { const detail = wsErrorDetail(error); setStatus(classifyWsError(error) === 'session-expired' ? '会话过期' : classifyWsError(error) === 'unpaired' ? '等待登录' : '连接失败', detail); toast(detail, 'x'); }
    } finally {
      if (!context || contextCurrent(context)) { state.busy.connection = false; render(); }
      if (stopAfterAction) stopBackgroundRuntime();
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
      const [result, runResult, alertResult, aiQueueResult] = await Promise.all([
        loadAllConversationPages(context),
        api('/api/ws/collection-runs', {}, context).catch(() => null),
        api('/api/ws/followup-alerts?limit=8', {}, context).catch(() => null),
        api('/api/ws/ai-jobs?limit=20', {}, context).catch(() => null),
      ]);
      if (sequence !== loadSequence || !contextCurrent(context)) return;
      if (runResult) { assertContext(context); state.collectionRun = runResult.run || null; }
      if (alertResult) { assertContext(context); state.followupAlerts = alertResult.alerts || []; }
      if (aiQueueResult?.stats) { assertContext(context); state.aiQueueStats = aiQueueResult.stats; }
      applyConversationInventory(result, accountId);
      const previousConversationId = String(state.currentConversationId || '');
      if (state.conversationSelectionManual && !state.conversations.some(item => String(item.id) === previousConversationId)) state.conversationSelectionManual = false;
      state.currentConversationId = resolveInitialConversationId(state.conversations, previousConversationId, state.conversationSelectionManual);
      if (state.currentConversationId) await loadConversationData(state.currentConversationId, false, { ...context, conversationId: String(state.currentConversationId) });
      else if (previousConversationId) await loadConversationData('', false, { ...context, conversationId: '' });
      assertContext(context);
      state.lastLoadedAt = nowIso();
    } catch (error) {
      if (sequence === loadSequence && contextCurrent(context)) state.error = error.message;
    } finally {
      if (sequence === loadSequence && contextCurrent(context)) { state.loading = false; render(); }
    }
  }
  function currentConversationRefreshSignature(conversation = activeConversation()) {
    if (!conversation) return '';
    const data = conversation.data || {};
    return [
      conversation.id,
      conversation.updatedAt || conversation.updated_at,
      conversation.lastMessageAt,
      conversation.lastMessageText,
      conversation.collectionStatus,
      data.historyLoaded === true ? '1' : '0',
      data.historyStale === true ? '1' : '0',
      Number(data.historyMessageCount || 0),
      Number(data.directionCaptureVersion || 0),
      Number(data.directionVersion || 0),
      text(data.historyFingerprint),
      text(data.lastMessageFingerprint),
    ].join('\u0001');
  }
  function aiQueueSignature(stats = state.aiQueueStats) {
    return stats ? [stats.queued, stats.running, stats.retryable, stats.completed, stats.failed, stats.total].join('\u0001') : '';
  }
  function captureWorkbenchScroll() {
    return ['.ws-session-list', '.ws-message-list', '.ws-assist-panel', '.ws-center-panel'].map(selector => {
      const node = $(selector);
      return node ? { selector, top: Number(node.scrollTop || 0), left: Number(node.scrollLeft || 0) } : null;
    }).filter(Boolean);
  }
  function renderPreservingScroll() {
    const positions = captureWorkbenchScroll();
    render();
    if (!positions.length) return;
    requestAnimationFrame(() => {
      for (const position of positions) {
        const node = $(position.selector);
        if (!node) continue;
        node.scrollTop = position.top;
        node.scrollLeft = position.left;
      }
    });
  }
  async function refreshSelectedConversationState(context, expectedConversationId, previousConversationSignature, previousQueueSignature) {
    const conversationId = String(expectedConversationId || '');
    if (conversationId !== String(state.currentConversationId || '')) return;
    const current = activeConversation();
    if (!conversationId || !current) return;
    const currentSignature = currentConversationRefreshSignature(current);
    const expectedMessages = Number(current.data?.historyMessageCount || 0);
    const messagesChanged = currentSignature !== previousConversationSignature || (expectedMessages > 0 && expectedMessages !== Number(state.historyCoverage.loaded || 0));
    const analysisChanged = aiQueueSignature() !== previousQueueSignature || state.analysisRefreshPending.has(conversationId);
    if (!messagesChanged && !analysisChanged) return;
    const selectedContext = { ...context, conversationId };
    const [messageHistory, analyses] = await Promise.all([
      messagesChanged ? loadAllConversationMessages(conversationId, selectedContext) : Promise.resolve(null),
      analysisChanged ? api(`/api/ws/analyses?conversationId=${encodeURIComponent(conversationId)}&limit=1`, {}, selectedContext) : Promise.resolve(null),
    ]);
    assertContext(selectedContext);
    if (messageHistory) {
      state.messages = messageHistory.messages;
      state.historyCoverage = { loaded: messageHistory.loaded, total: messageHistory.total, complete: messageHistory.complete };
    }
    if (analyses) {
      const latest = Array.isArray(analyses.analyses) ? analyses.analyses[0] || null : analyses.analysis || null;
      if (latest && String(latest.id || '') !== String(state.analysisMeta?.id || '')) {
        state.analysisMeta = latest;
        state.analysis = latest.result || null;
        seedDraftFromAnalysis();
      }
      if (latest) state.analysisRefreshPending.delete(conversationId);
    }
  }
  async function refreshCollectionSummary() {
    if (!state.backgroundActive) return;
    if (state.loading || state.collectionRefreshing) { state.collectionRefreshQueued = true; return; }
    // Collection refresh is account-scoped. Selecting another conversation
    // must not strand the global refresh lock or cancel list/run updates.
    const context = captureContext('');
    let selectedConversationId = String(state.currentConversationId || '');
    const beforeRenderSignature = collectionRenderSignature();
    const previousConversationSignature = currentConversationRefreshSignature();
    const previousQueueSignature = aiQueueSignature();
    state.collectionRefreshing = true;
    try {
      await syncVipGroupAllowlist(context).catch(() => null);
      const [result, run, alerts, aiQueue] = await Promise.all([
        loadConversationDeltaPages(context),
        api('/api/ws/collection-runs', {}, context),
        api('/api/ws/followup-alerts?limit=8', {}, context),
        api('/api/ws/ai-jobs?limit=20', {}, context).catch(() => null),
      ]);
      assertContext(context);
      applyConversationInventory(result, context.accountId);
      selectedConversationId = reconcilePersonalConversationSelection();
      state.collectionRun = run.run || null;
      state.followupAlerts = alerts.alerts || [];
      if (aiQueue?.stats) state.aiQueueStats = aiQueue.stats;
      let listSyncResult = { synced: 0, analyzed: 0 };
      if (state.wsStatus === '已连接' && (!state.collectionRun || !['paused', 'stopped', 'completed'].includes(state.collectionRun.status))) {
         const visible = await wsBridge('discover-conversations', context).catch(error => {
           if (contextCurrent(context)) state.error = `WS 会话列表读取失败：${String(error?.message || '页面暂不可读').slice(0, 240)}`;
           return null;
         });
        assertContext(context);
        if (visible?.supported) {
          const visibleConversations = (visible.conversations || []).map(normalizeListItem).filter(isAutomaticCollectibleConversation);
          const fingerprint = visibleConversationFingerprint(visibleConversations);
          if (fingerprint !== state.visibleConversationFingerprint) {
            if (visibleConversations.length) await enqueueDiscoveredConversations(visibleConversations, false, context);
            state.visibleConversationFingerprint = fingerprint;
          }
          listSyncResult = await syncConversationListPreviews(visibleConversations, context);
          if (listSyncResult.synced) {
            const refreshedAlerts = await api('/api/ws/followup-alerts?limit=8', {}, context);
            assertContext(context);
            state.followupAlerts = refreshedAlerts.alerts || [];
          }
          maybeStartAutomaticReadHistoryCollection(context);
        }
      }
      assertContext(context);
      await refreshSelectedConversationState(context, selectedConversationId, previousConversationSignature, previousQueueSignature);
      assertContext(context);
      scheduleAiQueuePump({ ...context, conversationId: '' });
      // The safety poll reads one small page when the account is unchanged and
      // walks further only while rows remain newer than the saved watermark.
      // Avoid replacing the workbench DOM unless visible data actually changed.
      if (collectionRenderSignature() !== beforeRenderSignature) renderPreservingScroll();
    } catch (error) {
      if (contextCurrent(context) && error?.message && !/过期操作/.test(error.message)) {
        state.error = error.message;
        renderPreservingScroll();
      }
    } finally {
      if (contextCurrent(context)) {
        state.collectionRefreshing = false;
        if (state.collectionRefreshQueued && state.backgroundActive && !state.loading) {
          state.collectionRefreshQueued = false;
          queueMicrotask(() => { void refreshCollectionSummary(); });
        }
      }
    }
  }
  function requestAccountPipelineRefresh(accountId = '') {
    const targetId = text(accountId) || String(state.activeAccountId || 'default');
    if (!state.backgroundActive) return Promise.resolve({ skipped: true });
    if (targetId === String(state.activeAccountId || 'default')) return refreshCollectionSummary();
    backgroundAccountRefreshQueue.add(targetId);
    // Never take the foreground WhatsApp account away while the operator is
    // chatting. The durable native collector keeps ingesting; queued AI/CRM
    // work is drained as soon as the user leaves the WS route.
    if (state.active) return Promise.resolve({ deferred: true, accountId: targetId });
    if (backgroundAccountRefreshPromise) return backgroundAccountRefreshPromise;
    const returnAccountId = String(state.activeAccountId || 'default');
    backgroundAccountRefreshPromise = (async () => {
      while (backgroundAccountRefreshQueue.size && state.backgroundActive && !state.active) {
        const nextAccountId = backgroundAccountRefreshQueue.values().next().value;
        backgroundAccountRefreshQueue.delete(nextAccountId);
        if (!state.accounts.some(item => String(item.id) === String(nextAccountId))) continue;
        if (String(state.activeAccountId) !== String(nextAccountId)) {
          const switched = await switchAccount(nextAccountId);
          if (!switched) continue;
        }
        if (state.active || !state.backgroundActive) break;
        const context = captureContext('');
        const status = await wsBridge('status', context).catch(() => null);
        if (status?.status) { updateAccountStatus(status); setStatus(status.status, status.detail || ''); }
        await refreshCollectionSummary();
        // refreshCollectionSummary schedules the durable AI pump. Wait for the
        // current bounded batch before rotating so account-switch cancellation
        // cannot strand a claimed job in the running state.
        scheduleAiQueuePump(context);
        await Promise.resolve();
        if (aiPumpPromise) await aiPumpPromise;
      }
    })().finally(async () => {
      try {
        let restoredBySwitch = false;
        if (returnAccountId && String(state.activeAccountId) !== returnAccountId && state.accounts.some(item => String(item.id) === returnAccountId)) {
          restoredBySwitch = await switchAccount(returnAccountId);
        }
        if (returnAccountId && String(state.activeAccountId) === returnAccountId) {
          const restoreContext = captureContext('');
          const restoredStatus = await wsBridge('status', restoreContext).catch(() => null);
          if (restoredStatus?.status && contextCurrent(restoreContext)) {
            updateAccountStatus({ ...restoredStatus, accountId: returnAccountId });
            setStatus(restoredStatus.status, restoredStatus.detail || '');
          }
          // switchAccount already restores the account list. If the queue
          // rotated back to the original account by itself, restore it here.
          if (!restoredBySwitch && contextCurrent(restoreContext)) await loadConversations();
        }
      } finally {
        backgroundAccountRefreshPromise = null;
        if (backgroundAccountRefreshQueue.size && state.backgroundActive && !state.active) void requestAccountPipelineRefresh(backgroundAccountRefreshQueue.values().next().value);
      }
    });
    return backgroundAccountRefreshPromise;
  }
  function collectionRenderSignature() {
    const conversations = state.conversations || [];
    const start = Math.max(0, Math.min(Number(state.conversationWindowStart) || 0, Math.max(0, conversations.length - 1)));
    const visibleRows = conversations.slice(start, start + CONVERSATION_RENDER_BATCH);
    const selected = conversations.find(row => String(row.id) === String(state.currentConversationId || ''));
    // Only the rendered window participates in the paint signature. Total,
    // newest and selected rows preserve correctness without mapping all 50k
    // conversations on every 12-second safety poll.
    const rowSignature = row => {
      const data = row.data || {};
      return [row.id, row.updatedAt || row.updated_at, row.unreadCount, String(row.lastMessageText || '').slice(0, 120), row.collectionStatus, data.historyLoaded === true ? 1 : 0, data.historyStale === true ? 1 : 0, Number(data.historyMessageCount || 0), Number(data.directionCaptureVersion || 0), Number(data.directionVersion || 0), text(data.historyFingerprint), text(data.lastMessageFingerprint)].join('\u0001');
    };
    const list = [conversations.length, start, rowSignature(conversations[0] || {}), rowSignature(selected || {}), visibleRows.map(rowSignature).join('\u0002')].join('\u0003');
    const run = state.collectionRun ? [state.collectionRun.id, state.collectionRun.status, state.collectionRun.total, state.collectionRun.discovered, state.collectionRun.collecting, state.collectionRun.completed, state.collectionRun.analyzed, state.collectionRun.skipped, state.collectionRun.failed, state.collectionRun.retryable, state.collectionRun.updatedAt || state.collectionRun.updated_at].join('\u0001') : '';
    const alerts = (state.followupAlerts || []).map(row => [row.id, row.status, row.nextFollow, row.updatedAt || row.updated_at].join('\u0001')).join('\u0002');
    const queue = aiQueueSignature();
    const lastMessage = state.messages.at(-1);
    const messages = [state.currentConversationId, state.messages.length, lastMessage?.id, lastMessage?.updatedAt || lastMessage?.updated_at, state.historyCoverage.loaded, state.historyCoverage.total, state.historyCoverage.complete ? 1 : 0].join('\u0001');
    const analysis = [state.analysisMeta?.id, state.analysisMeta?.updatedAt || state.analysisMeta?.updated_at || state.analysisMeta?.createdAt, state.analysisRefreshPending.has(String(state.currentConversationId || '')) ? 1 : 0].join('\u0001');
    return `${list}|${run}|${alerts}|${queue}|${messages}|${analysis}|${state.error || ''}|${state.aiBackgroundError || ''}`;
  }
  function scheduleAiQueuePump(context = captureContext('')) {
    const pumpContext = { ...context, conversationId: '' };
    if (!state.backgroundActive || !state.aiEnabled || !contextCurrent(pumpContext)) return aiPumpPromise || Promise.resolve({ skipped: true });
    aiPumpQueued = true;
    if (aiPumpPromise || aiPumpScheduled || state.aiBusy) return aiPumpPromise || Promise.resolve({ queued: true });
    aiPumpScheduled = true;
    queueMicrotask(() => {
      aiPumpScheduled = false;
      if (!aiPumpQueued || aiPumpPromise || state.aiBusy || !state.backgroundActive || !state.aiEnabled || !contextCurrent(pumpContext)) return;
      const controller = new AbortController();
      aiPumpController = controller;
      aiPumpQueued = false;
      let succeeded = 0;
      aiPumpPromise = (async () => {
        do {
          aiPumpQueued = false;
          throwIfAiCancelled(controller.signal);
          if (!contextCurrent(pumpContext) || !state.backgroundActive || !state.aiEnabled || state.aiBusy) throw aiCancellationError();
          const result = await resumeQueuedAiJobs(pumpContext, { signal: controller.signal });
          succeeded += Number(result?.succeeded || 0);
        } while (aiPumpQueued && !controller.signal.aborted && contextCurrent(pumpContext) && state.backgroundActive && state.aiEnabled && !state.aiBusy);
        if (contextCurrent(pumpContext)) state.aiBackgroundError = '';
        return { succeeded };
      })().catch(error => {
        if (!isAiCancellation(error, controller.signal) && contextCurrent(pumpContext)) {
          aiPumpQueued = false;
          state.aiBackgroundError = `后台 AI 分析待重试：${String(error?.message || 'AI 服务暂不可用').replace(/[\r\n\t]+/g, ' ').slice(0, 240)}`;
          renderPreservingScroll();
        }
        return { succeeded };
      }).finally(() => {
        if (aiPumpController === controller) aiPumpController = null;
        aiPumpPromise = null;
        const restart = aiPumpQueued && state.backgroundActive && state.aiEnabled && !state.aiBusy && contextCurrent(pumpContext);
        if (restart) scheduleAiQueuePump(pumpContext);
        else if (succeeded > 0 && state.backgroundActive && contextCurrent(pumpContext)) {
          // Refresh the shared customer/task state once per completed pump
          // batch so Home or Task Center updates even while the WS route is
          // hidden. Never refresh once an account switch invalidates context.
          void Promise.resolve().then(() => getHost()?.refreshState?.()).catch(() => {}).then(() => {
            if (state.backgroundActive && contextCurrent(pumpContext)) void refreshCollectionSummary();
          });
        }
      });
    });
    return aiPumpPromise || Promise.resolve({ queued: true });
  }
  async function resumeQueuedAiJobs(context = captureContext(''), options = {}) {
    const signal = options.signal;
    if (!state.aiEnabled || state.loading || state.aiBusy) return { processed: 0, succeeded: 0 };
    let processed = 0, succeeded = 0;
    throwIfAiCancelled(signal);
    const queue = await api('/api/ws/ai-jobs?status=queued,retryable&limit=12', {}, context);
    throwIfAiCancelled(signal);
    assertContext(context);
    if (queue?.stats) state.aiQueueStats = queue.stats;
    for (const job of (queue?.jobs || [])) {
      if (processed >= 3) break;
      throwIfAiCancelled(signal);
      if (state.aiBusy) throw aiCancellationError();
      const conversation = state.conversations.find(item => String(item.id) === String(job.conversationId));
      if (!conversation) continue;
      // Only an explicitly identified one-to-one conversation can enter the
      // automatic model/CRM pipeline. Groups and unresolved chat types remain
      // untouched until the native collector supplies authoritative metadata.
      if (!isAutomaticCollectibleConversation(conversation)) continue;
      // Unread conversations are deliberately never opened or analyzed by the
      // background collector. They remain queued for a later user-initiated
      // read, even if a stale AI job survived a restart.
      if (conversation.unread === true || Number(conversation.unreadCount || 0) > 0 || text(conversation.collectionStatus) === 'skipped_unread') continue;
      // A sidebar preview is discovery metadata, not a customer transcript.
      // Do not create summaries, CRM updates or follow-up reminders until the
      // native collector has explicitly confirmed that it reached the top of
      // this conversation and persisted its complete readable history.
      const sourceFingerprint = fullHistorySourceFingerprint(conversation);
      if (!sourceFingerprint || text(job.payload?.sourceFingerprint) !== sourceFingerprint) continue;
      const result = await analyzeStoredConversation(conversation, { ...context, conversationId: '' }, { signal });
      if (result.cancelled) throw aiCancellationError();
      if (!result.ok && !result.pending && !result.disabled) throw new Error(result.reason || 'AI 分析失败。');
      if (result.ok || result.pending) processed += 1;
      if (result.ok) succeeded += 1;
    }
    // A list scan persists newly discovered previews as collection items before
    // attempting AI.  Resume those items after a restart or while AI was
    // temporarily disabled; no renderer-only queue is needed and no 50k list
    // is held in memory.  The server-side limit keeps each poll bounded.
    if (processed < 3 && state.collectionRun?.id) {
      const pending = await api(`/api/ws/collection-items?runId=${encodeURIComponent(state.collectionRun.id)}&historyReady=1&status=queued,collecting,retryable,completed&analysisStatus=pending,retryable&limit=100`, {}, context);
      const readyItems = (pending?.items || []).filter(item => state.conversations.some(row => String(row.id) === String(item.conversationId) && fullHistorySourceFingerprint(row)));
      for (const item of readyItems.slice(0, Math.max(0, 3 - processed))) {
        throwIfAiCancelled(signal);
        if (state.aiBusy) throw aiCancellationError();
        const conversation = state.conversations.find(row => String(row.id) === String(item.conversationId));
        if (!conversation) continue;
        if (item.status === 'skipped_unread' || item.coverageStatus === 'unread-skipped' || conversation.unread === true || Number(conversation.unreadCount || 0) > 0) continue;
        if (!fullHistorySourceFingerprint(conversation)) continue;
        const result = await analyzeStoredConversation(conversation, { ...context, conversationId: '' }, { signal });
        if (result.cancelled) throw aiCancellationError();
        if (!result.ok && !result.pending && !result.disabled) throw new Error(result.reason || 'AI 分析失败。');
        if (result.ok || result.pending) {
          processed += 1;
          if (result.ok) succeeded += 1;
          if (result.ok && item.checkpoint) state.previewAnalysisSignatures.set(String(conversation.id), String(item.checkpoint));
        }
      }
    }
    return { processed, succeeded };
  }
  async function enqueueDiscoveredConversations(items, announce = true, context = captureContext()) {
    const directItems = (Array.isArray(items) ? items : [])
      .map(normalizeListItem)
      .filter(isAutomaticCollectibleConversation);
    if (!directItems.length) return 0;
    assertContext(context);
    if (!state.collectionRun) {
      const runResult = await api('/api/ws/collection-runs', { method: 'POST', body: JSON.stringify({}) }, context);
      assertContext(context);
      state.collectionRun = runResult.run;
    }
    const legacyByExternalId = new Map((state.conversations || []).map(row => [String(row.externalId || ''), row]));
    let queued = 0;
    const enqueueOne = async item => {
      const normalized = normalizeListItem(item);
      if (!isAutomaticCollectibleConversation(normalized)) return 0;
      const conversationType = isAutomaticVipGroupConversation(normalized) ? 'vip_group' : 'direct';
      const vipGroup = conversationType === 'vip_group';
      const legacy = legacyByExternalId.get(`list-item-${normalized.index}`) || legacyByExternalId.get(`visible-${normalized.index}`);
      const externalId = text(normalized.externalId || legacy?.externalId || `visible-${normalized.index}`); const title = text(normalized.title || externalId);
      const preview = listPreviewText(normalized);
      const match = vipGroup ? null : core.matchCustomer(getHost()?.state?.customers || [], {
        wsExternalId: externalId,
        wsAccountId: context.accountId,
        // Conversation identity must come from the contact row itself.  A
        // phone number mentioned inside the latest message may belong to a
        // friend, company or payment recipient and must never link a customer.
        phone: core.extractPhone(`${externalId} ${title}`),
      });
      const matchedCustomerId = match?.kind === 'phone' || match?.kind === 'ws-id' || match?.kind === 'conversation' ? String(match.customer?.id || '') : '';
      assertContext(context);
      const conversation = await api('/api/ws/conversations', { method: 'POST', body: JSON.stringify({
        externalId,
        title,
        conversationType,
        isGroup: vipGroup,
        vipGroup,
        customerId: vipGroup ? '' : matchedCustomerId,
        lastMessageText: preview,
        unreadCount: Number(item.unreadCount || 0),
        data: { discovery: 'visible-page', conversationType, isGroup: vipGroup, vipGroup, previewOnly: true, historyLoaded: false, customerMatch: vipGroup ? 'member-scoped' : (matchedCustomerId ? 'automatic' : 'pending') },
      }) }, context);
      assertContext(context);
      await api('/api/ws/collection-items', { method: 'POST', body: JSON.stringify({ runId: state.collectionRun.id, conversationId: conversation.id, status: 'queued' }) }, context);
      assertContext(context);
      return 1;
    };
    for (let offset = 0; offset < directItems.length; offset += 8) {
      const chunk = directItems.slice(offset, offset + 8);
      const results = await Promise.all(chunk.map(enqueueOne));
      queued += results.reduce((sum, value) => sum + value, 0);
    }
    assertContext(context);
    const refreshed = await loadConversationDeltaPages(context);
    assertContext(context);
    applyConversationInventory(refreshed, context.accountId);
    reconcilePersonalConversationSelection();
    if (announce) toast(`已发现 ${directItems.length} 个可采集会话，入队 ${queued} 个`);
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
  async function syncAnalysisToCrm(conversation, analysis, analysisMeta, context, options = {}) {
    const syncCore = window.ZhikeWsCrmSync;
    if (!syncCore || !analysisMeta?.id || !conversation?.id) {
      state.crmSyncStatus = '分析已保存，等待同步编号';
      return { ok: true, skipped: true, matched: false, created: false, reason: '分析结果已保存，缺少同步所需编号。' };
    }
    if (!syncCore.shouldAutoSync(analysis)) {
      state.crmSyncStatus = '分析已保存，无可补充的客户字段';
      return { ok: true, skipped: true, matched: false, created: false, reason: '分析已保存，当前没有可安全补充的客户字段。' };
    }
    try {
      const host = getHost();
      await host?.flushStateWrites?.();
      const result = await api('/api/ws/crm-sync', { method: 'POST', timeout: 30000, body: JSON.stringify({ conversationId: conversation.id, analysisId: analysisMeta.id }) }, context);
      assertContext(context);
      let refreshWarning = '';
      if (!result.skipped || options.refreshHost !== false) {
        try { await host?.refreshState?.(); }
        catch (refreshError) { refreshWarning = String(refreshError?.message || '界面刷新失败，请手动刷新页面。'); console.warn('[知客] WS 客户同步成功，但界面刷新失败：', refreshWarning); }
      }
      const alerts = await api('/api/ws/followup-alerts?limit=8', {}, context).catch(() => null);
      if (alerts && contextCurrent(context)) state.followupAlerts = alerts.alerts || state.followupAlerts;
      const conflictCount = Array.isArray(result.conflicts) ? result.conflicts.length : 0;
      if (options.notify !== false && contextCurrent(context)) {
        if (result.skipped) toast(result.reason || (result.conflict ? 'AI 已记录冲突并保留客户原值' : '未匹配现有客户，已保留分析且未新增客户'), result.conflict ? 'check' : 'x');
        else if (conflictCount) toast(`AI 已补充现有客户资料并记录 ${conflictCount} 项冲突（保留原值）${result.followup ? '，跟进提醒已刷新' : ''}`, 'check');
        else toast(result.followup ? 'AI 已补充现有客户资料并刷新跟进提醒' : 'AI 已补充现有客户资料');
      }
      state.crmSyncStatus = result.skipped
        ? (result.conflict ? '已记录冲突并保留客户原值' : (result.reason || '未匹配现有客户，已保留分析且未新增客户'))
        : (conflictCount
          ? `已自动补充现有客户资料；记录 ${conflictCount} 项冲突并保留原值${result.followup ? '，跟进已同步' : ''}`
          : (result.followup ? '已自动补充现有客户资料并同步跟进' : '已自动补充现有客户资料'));
      if (refreshWarning) state.crmSyncStatus += `（${refreshWarning}）`;
      if (!result.skipped) window.dispatchEvent(new CustomEvent('zhike:followups-changed', { detail: { customerId: result.customer?.id || '', taskId: result.task?.id || '' } }));
      return refreshWarning ? { ...result, refreshWarning } : result;
    } catch (error) {
      state.crmSyncStatus = `同步失败：${error.message}`;
      if (options.notify !== false && contextCurrent(context)) toast(`AI 结果已保存，但同步知客客户库失败：${error.message}`, 'x');
      return { ok: false, reason: error.message };
    }
  }
  function aiJobIdempotencyKey(conversation, transcript) {
    const sourceFingerprint = text(transcript?.sourceFingerprint);
    const memberScope = transcript?.memberScoped === true
      ? vipMemberScopeKey(transcript.memberIdentity)
      : '';
    // Keep manual imports (which have no authoritative source fingerprint)
    // compatible with their existing key. Native full-history analyses must
    // include the server-authoritative fingerprint so a corrected/recollected
    // history cannot reuse a completed job from an older source generation.
    const identity = sourceFingerprint
      ? JSON.stringify(memberScope
        ? [sourceFingerprint, memberScope, text(transcript?.text)]
        : [sourceFingerprint, text(transcript?.text)])
      : memberScope
        ? JSON.stringify([memberScope, text(transcript?.text)])
        : text(transcript?.text);
    return `ws:${conversation.id}:${stableHash(identity)}`;
  }
  function transcriptDirectionVersion(conversation, sourceFingerprint = '') {
    const version = Number(conversation?.data?.directionVersion || 0);
    return text(sourceFingerprint) && Number.isFinite(version) && version >= 4 ? version : 0;
  }
  async function beginAiJob(conversation, transcript, context, feature = 'ws-analysis') {
    const idempotencyKey = aiJobIdempotencyKey(conversation, transcript);
    const queued = await api('/api/ws/ai-jobs', {
      method: 'POST',
      body: JSON.stringify({
        conversationId: conversation.id,
        idempotencyKey,
        maxAttempts: 5,
        payload: {
          feature,
          includedMessages: transcript.included,
          totalMessages: transcript.total,
          historyComplete: transcript.historyComplete === true,
          truncated: transcript.truncated,
          fingerprint: stableHash(transcript.text),
          sourceFingerprint: text(transcript.sourceFingerprint),
          memberScoped: transcript.memberScoped === true,
          memberIdentity: transcript.memberScoped === true ? transcript.memberIdentity : null,
        },
      }),
    }, context);
    assertContext(context);
    state.aiQueueStats = queued.stats || state.aiQueueStats;
    const existing = queued.job;
    if (existing?.status === 'completed' && existing.analysisId) {
      const rows = await api(`/api/ws/analyses?conversationId=${encodeURIComponent(conversation.id)}&limit=50`, {}, context);
      const saved = (rows.analyses || []).find(item => String(item.id) === String(existing.analysisId));
      if (saved) return { job: existing, completed: true, analysis: saved };
    }
    const claimed = await api('/api/ws/ai-jobs', { method: 'POST', body: JSON.stringify({ action: 'claim', jobId: existing.id }) }, context);
    assertContext(context);
    state.aiQueueStats = claimed.stats || state.aiQueueStats;
    if (!claimed.claimed) return { job: claimed.job, pending: true };
    return { job: claimed.job, pending: false };
  }
  async function failAiJob(job, context, reason) {
    if (!job?.id) return;
    try {
      const result = await api('/api/ws/ai-jobs', { method: 'POST', body: JSON.stringify({ action: 'fail', jobId: job.id, error: String(reason || 'AI 分析失败').slice(0, 1000), retryable: true }) }, context);
      if (contextCurrent(context)) state.aiQueueStats = result.stats || state.aiQueueStats;
    } catch {}
  }
  async function completeAiJob(job, analysisId, context) {
    if (!job?.id || !analysisId) return;
    try {
      const result = await api('/api/ws/ai-jobs', { method: 'POST', body: JSON.stringify({ action: 'complete', jobId: job.id, analysisId }) }, context);
      if (contextCurrent(context)) state.aiQueueStats = result.stats || state.aiQueueStats;
    } catch {}
  }
  async function analyzeStoredConversation(conversation, context, options = {}) {
    const signal = options.signal;
    throwIfAiCancelled(signal);
    if (!state.aiEnabled) return { ok: false, reason: 'AI 分析已关闭。', disabled: true };
    if (!window.zhikeAI?.request || !window.zhikeAI?.status) return { ok: false, reason: '当前运行环境不支持 AI 安全桥接。' };
    if (!conversation?.id) return { ok: false, reason: '缺少会话标识。' };
    const sourceFingerprint = fullHistorySourceFingerprint(conversation);
    if (!sourceFingerprint) return { ok: false, reason: '聊天列表已更新，等待重新采集完整历史后再分析。', pending: true };
    let messageHistory = options.messageHistory;
    if (!messageHistory) {
      try {
        messageHistory = await loadAllConversationMessages(conversation.id, context);
        throwIfAiCancelled(signal);
      } catch (error) {
        if (isAiCancellation(error, signal)) return { ok: false, reason: 'AI 分析已取消。', cancelled: true };
        return { ok: false, reason: `读取会话消息失败：${error.message || '本机接口异常'}` };
      }
    }
    const currentConversation = state.conversations.find(item => String(item.id) === String(conversation.id)) || conversation;
    if (fullHistorySourceFingerprint(currentConversation) !== sourceFingerprint || messageHistory.sourceFingerprint !== sourceFingerprint) return { ok: false, reason: '读取期间聊天已更新，旧记录已保留；等待重新采集完整历史。', pending: true };
    const messages = messageHistory.messages;
    if (!messages.length) return { ok: false, reason: '当前会话暂无可分析消息。' };
    const vipGroup = isAutomaticVipGroupConversation(currentConversation);
    const requestedMemberIdentity = options.memberIdentity && vipMemberScopeKey(options.memberIdentity)
      ? options.memberIdentity
      : null;
    if (vipGroup && !requestedMemberIdentity) {
      const memberScopes = vipGroupMemberAnalysisScopes(messages);
      if (!memberScopes.length) {
        return {
          ok: false,
          pending: true,
          identityPending: true,
          reason: 'VIP 群历史已保留，但尚未读取到可信的发言人 WS ID 或手机号，暂不写入客户档案。',
        };
      }
      const memberResults = [];
      for (const memberIdentity of memberScopes) {
        throwIfAiCancelled(signal);
        memberResults.push(await analyzeStoredConversation(conversation, context, {
          ...options,
          messageHistory,
          memberIdentity,
        }));
      }
      const failed = memberResults.find(item => !item.ok && !item.pending && !item.disabled);
      if (failed) return { ...failed, memberResults };
      const succeeded = memberResults.filter(item => item.ok);
      return {
        ok: succeeded.length > 0,
        pending: succeeded.length === 0 && memberResults.some(item => item.pending),
        memberScoped: true,
        analyzedMembers: succeeded.length,
        totalMembers: memberScopes.length,
        memberResults,
        analysis: succeeded.at(-1)?.analysis,
        analysisMeta: succeeded.at(-1)?.analysisMeta,
        reason: succeeded.length ? '' : (memberResults.find(item => item.reason)?.reason || 'VIP 群成员分析等待重试。'),
      };
    }
    let memberTranscript = null;
    if (vipGroup) {
      memberTranscript = core.buildVipMemberTranscript?.(messages, requestedMemberIdentity, { maxChars: 48000 });
      if (!memberTranscript?.memberScoped || Number(memberTranscript.targetStatementCount || 0) < 1) {
        return { ok: false, pending: true, identityPending: true, reason: 'VIP 群当前发言人没有可归属的本人原文，已保留聊天但不写入客户档案。' };
      }
    }
    const chunks = core.splitHistoryTranscript(messages, { maxChars: 16000 });
    if (!chunks.length) return { ok: false, reason: '聊天没有可分析的文本，媒体消息原记录已保留。' };
    const transcript = { text: chunks.map(item => item.text).join('\n'), included: messages.length, total: messages.length, truncated: false, chunkCount: chunks.length };
    transcript.historyComplete = messageHistory.complete;
    transcript.historyLoaded = messageHistory.loaded;
    transcript.historyTotal = messageHistory.total;
    transcript.sourceFingerprint = sourceFingerprint;
    transcript.directionVersion = transcriptDirectionVersion(currentConversation, sourceFingerprint);
    if (vipGroup) {
      transcript.memberScoped = true;
      transcript.memberIdentity = memberTranscript.memberIdentity;
      transcript.targetStatementCount = memberTranscript.targetStatementCount;
    }
    let aiJob;
    try {
      aiJob = await beginAiJob(conversation, transcript, context, vipGroup
        ? 'ws-vip-member-full-history-analysis'
        : (messageHistory.complete ? 'ws-full-history-analysis' : 'ws-list-preview-analysis'));
      throwIfAiCancelled(signal);
      if (aiJob.completed && aiJob.analysis) {
        const analysis = aiJob.analysis.result || {};
        const crmResult = await syncAnalysisToCrm(conversation, analysis, aiJob.analysis, context, { refreshHost: false, notify: false });
        if (crmResult?.ok !== false) state.analysisRefreshPending.add(String(conversation.id));
        return crmResult?.ok === false ? { ok: false, reason: crmResult.reason || 'AI 结果同步知客客户库失败。' } : { ok: true, analysis, analysisMeta: aiJob.analysis, resumed: true };
      }
      if (aiJob.pending) return { ok: false, reason: 'AI 分析任务已在后台运行，稍后将自动刷新。', pending: true };
    } catch (error) {
      if (isAiCancellation(error, signal)) return { ok: false, reason: 'AI 分析已取消。', cancelled: true };
      return { ok: false, reason: `AI 任务入队失败：${error.message || '本机接口异常'}` };
    }
    const service = await window.zhikeAI.status().catch(() => ({ configured: false }));
    if (signal?.aborted) {
      await failAiJob(aiJob?.job, context, 'AI 分析已取消，任务保留待重试。');
      return { ok: false, reason: 'AI 分析已取消。', cancelled: true };
    }
    if (!service.configured) { await failAiJob(aiJob.job, context, 'AI 服务未配置，请先配置 TeamoRouter 或 OpenAI。'); return { ok: false, reason: 'AI 服务未配置，请先在 GPT 运营助手中配置 TeamoRouter 或 OpenAI。' }; }
    try {
      const analysis = await analyzeHistoryChunks(chunks, conversation, context, aiJob.job, {
        signal,
        memberIdentity: vipGroup ? memberTranscript.memberIdentity : null,
        memberScoped: vipGroup,
      });
      throwIfAiCancelled(signal);
      const latestConversation = state.conversations.find(item => String(item.id) === String(conversation.id)) || conversation;
      if (fullHistorySourceFingerprint(latestConversation) !== sourceFingerprint) throw new Error('分析期间聊天已更新，旧分析进度已保留；等待重新采集完整历史。');
      analysis.transcriptInfo = { ...transcript, text: undefined, analyzedChunks: chunks.length };
      if (vipGroup) analysis.memberIdentity = memberTranscript.memberIdentity;
       const saved = await api('/api/ws/analyses', { method: 'POST', body: JSON.stringify({ conversationId: conversation.id, jobId: aiJob.job.id, memberIdentity: vipGroup ? memberTranscript.memberIdentity : null, result: analysis, confidence: analysis.confidence, providerName: analysis.providerName, model: analysis.model }) }, context);
       throwIfAiCancelled(signal);
       await completeAiJob(aiJob.job, saved.id, context);
       throwIfAiCancelled(signal);
       const crmResult = await syncAnalysisToCrm(conversation, analysis, saved, context, { refreshHost: false, notify: false });
       if (crmResult?.ok === false) throw new Error(crmResult.reason || 'AI 结果同步知客客户库失败。');
       if (state.collectionRun?.id) await api('/api/ws/collection-items', { method: 'PATCH', body: JSON.stringify({
        runId: state.collectionRun.id,
        conversationId: conversation.id,
        status: 'completed',
        analysisStatus: 'completed',
        coverageStatus: messageHistory.complete ? 'full-history' : 'partial-history',
        lastError: '',
       }) }, context);
      state.analysisRefreshPending.add(String(conversation.id));
      return { ok: true, analysis, analysisMeta: saved, memberIdentity: vipGroup ? memberTranscript.memberIdentity : null };
    } catch (error) {
      if (isAiCancellation(error, signal)) {
        await failAiJob(aiJob?.job, context, 'AI 分析已取消，任务保留待重试。');
        return { ok: false, reason: 'AI 分析已取消。', cancelled: true };
      }
      await failAiJob(aiJob?.job, context, error.message);
      const message = String(error?.message || 'AI 分析请求失败').replace(/[\r\n\t]+/g, ' ').slice(0, 300);
      return { ok: false, reason: message || 'AI 分析请求失败。' };
    }
  }
  async function analyzeHistoryChunks(chunks, conversation, context, job, options = {}) {
    const signal = options.signal;
    const memberScoped = options.memberScoped === true;
    const memberIdentity = memberScoped ? (core.messageMemberIdentity?.(options.memberIdentity) || options.memberIdentity || {}) : null;
    const memberKey = memberScoped ? vipMemberScopeKey(memberIdentity) : '';
    const checkpoint = job?.payload?.checkpoint;
    const resumeAt = checkpoint?.chunkCount === chunks.length ? Math.min(chunks.length, Number(checkpoint.completedChunks) || 0) : 0;
    const analyses = resumeAt && checkpoint?.result ? [checkpoint.result] : [];
    for (const chunk of chunks.slice(analyses.length ? resumeAt : 0)) {
      throwIfAiCancelled(signal);
      assertContext(context);
      if (!state.aiEnabled) throw new Error('AI 分析已关闭，尚未提交的分段已停止。');
      state.crmSyncStatus = `正在分析聊天 ${chunk.chunkNumber}/${chunk.chunkCount} 段`;
      const result = await window.zhikeAI.request({ assistantMode: 'operations', analysisDepth: 'standard',
        input: core.buildNaturalChatAnalysisPrompt(chunk.text, { conversationId: conversation.id, memberIdentity }),
        context: { feature: memberScoped ? 'ws-vip-member-history-segment' : 'ws-history-segment', conversationId: conversation.id, memberScoped, memberKey, chunkNumber: chunk.chunkNumber, chunkCount: chunk.chunkCount, startMessage: chunk.startIndex + 1, endMessage: chunk.endIndex + 1 },
      }, { signal });
      throwIfAiCancelled(signal);
      assertContext(context);
      const parsed = core.parseAiResult(result?.text || '');
      if (parsed.error) throw new Error(parsed.error);
      parsed.providerName = result.providerName || ''; parsed.model = result.model || '';
      analyses.push(parsed);
      if (job?.id) await api('/api/ws/ai-jobs', { method: 'POST', body: JSON.stringify({ action: 'checkpoint', jobId: job.id, completedChunks: chunk.chunkNumber, chunkCount: chunks.length, result: core.mergeAiAnalyses(analyses) }) }, context);
    }
    const merged = core.mergeAiAnalyses(analyses);
    if (chunks.length > 1) {
      throwIfAiCancelled(signal);
      assertContext(context);
      if (!state.aiEnabled) throw new Error('AI 分析已关闭。');
      const synthesis = JSON.stringify({ summary: merged.summary, contact: merged.contact, profileFacts: merged.profileFacts, recentAnalysis: analyses.at(-1), instruction: '合并各段已提取证据；资金实力使用全部证据，聊天粘度和跟进意愿以最近会话为准。不得把历史兴趣当成当前意愿。' });
      const result = await window.zhikeAI.request({ assistantMode: 'operations', analysisDepth: 'standard', input: core.buildNaturalChatAnalysisPrompt(synthesis, { conversationId: conversation.id, memberIdentity }), context: { feature: memberScoped ? 'ws-vip-member-history-synthesis' : 'ws-history-synthesis', conversationId: conversation.id, memberScoped, memberKey, chunkCount: chunks.length } }, { signal });
      throwIfAiCancelled(signal);
      assertContext(context);
      const final = core.parseAiResult(result?.text || '');
      if (final.error) throw new Error(final.error);
      // Keep every extracted profile fact even if the synthesis omits a field.
      const synthesized = { ...core.mergeAiAnalyses([merged, final]), providerName: result.providerName || '', model: result.model || '' };
      if (memberScoped) {
        synthesized.memberIdentity = memberIdentity;
        synthesized.transcriptInfo = { ...(synthesized.transcriptInfo || {}), memberScoped: true, memberIdentity };
      }
      return synthesized;
    }
    if (memberScoped) {
      merged.memberIdentity = memberIdentity;
      merged.transcriptInfo = { ...(merged.transcriptInfo || {}), memberScoped: true, memberIdentity };
    }
    return merged;
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
    const directItems = (Array.isArray(items) ? items : [])
      .map(normalizeListItem)
      .filter(isAutomaticCollectibleConversation);
    if (state.listSyncBusy || !directItems.length) return { synced: 0, analyzed: 0 };
    state.listSyncBusy = true;
    let synced = 0, analyzed = 0, progressed = 0;
    try {
      const byExternal = new Map(state.conversations.map(item => [String(item.externalId || ''), item]));
      const legacyByIndex = new Map(state.conversations
        .filter(row => /^(?:list-item|visible)-\d+$/.test(String(row.externalId || '')))
        .map(row => [Number(String(row.externalId).split('-').at(-1)), row]));
      const syncOnePreview = async rawItem => {
        assertContext(context);
        const item = normalizeListItem(rawItem);
        if (!isAutomaticCollectibleConversation(item)) return { synced: 0, progressed: 0 };
        const legacy = legacyByIndex.get(Number(item?.index));
        const externalId = text(item?.externalId || legacy?.externalId || `visible-${item?.index}`);
        const conversation = byExternal.get(externalId) || legacy;
        const preview = listPreviewText(item, conversation?.lastMessageText || conversation?.title || '');
        if (!externalId || !conversation) return { synced: 0, progressed: 0 };
        // Some WhatsApp rows legitimately have no preview (for example a
        // newly created chat, a media-only row, or a system notice).  They
        // are still discovered and must not remain permanently queued.  Mark
        // them as list-only coverage so the run can reach N/N while AI waits
        // for an actual message transcript.
        const unreadConversation = item.status === 'skipped_unread' || item.unread === true || Number(item.unreadCount || 0) > 0 || /(?:unread|未读|new message|条未读消息)/i.test(text(item.unreadMarker));
        if (!preview) {
          if (state.collectionRun?.id) {
            const checkpoint = `list-only-${stableHash(JSON.stringify([externalId, text(item.title), text(item.lastMessageAt), Number(item.unreadCount || 0)]))}`;
            if (!preserveHistoryCollectionState(conversation) || unreadConversation) {
              await api('/api/ws/collection-items', { method: 'PATCH', body: JSON.stringify({
                runId: state.collectionRun.id,
                conversationId: conversation.id,
                status: unreadConversation ? 'skipped_unread' : 'completed',
                coverageStatus: unreadConversation ? 'unread-skipped' : 'list-only',
                checkpoint,
                lastError: unreadConversation ? '检测到未读会话，按规则跳过；请先在 WhatsApp 中自行阅读。' : '',
              }) }, context);
            }
          }
          return { synced: 0, progressed: 1 };
        }
        const fingerprint = listPreviewFingerprint(item, preview);
        const messageExternalId = `list-preview-${fingerprint}`;
        const result = await api('/api/ws/messages/batch', { method: 'POST', timeout: 30000, body: JSON.stringify({ conversationId: conversation.id, fingerprint: `list-preview-${fingerprint}`, messages: [{ externalId: messageExternalId, direction: item.previewDirection === 'send' ? 'send' : 'receive', originalText: preview, order: Date.now(), data: { source: 'ws-list-preview', previewOnly: true, listText: text(item.listText).slice(0, 2000), lastMessageAt: text(item.lastMessageAt), fingerprint } }] }) }, context);
        assertContext(context);
        const inserted = Number(result.inserted || 0);
        const updated = Number(result.updated || 0);
        // A repeated fingerprint still means the list preview is valid. Mark
        // the collection item complete even when the message was already
        // stored (or the server reports no-op counters after a retry).
        const refreshedConversation = state.conversations.find(row => String(row.id) === String(conversation.id));
        // Keep the server's chronology. The list scan may repeat unchanged
        // previews every few seconds; stamping them with now would reorder
        // the whole sidebar and create needless rerenders.
        if (refreshedConversation && preview !== refreshedConversation.lastMessageText) refreshedConversation.lastMessageText = preview;
        const previewSignatureKey = String(conversation.id);
        const previewChanged = state.previewAnalysisSignatures.get(previewSignatureKey) !== fingerprint;
        // A repeated list refresh must not downgrade an already analyzed item
        // back to pending. Only a new preview fingerprint starts a fresh AI run.
        if (state.collectionRun?.id) {
          // List previews must never overwrite full-history/history-stale
          // coverage. Native ingest owns source fingerprint invalidation and
          // will queue a fresh capture when the real list fingerprint changes.
          if (!preserveHistoryCollectionState(conversation) || unreadConversation) {
            const itemPatch = { runId: state.collectionRun.id, conversationId: conversation.id, status: unreadConversation ? 'skipped_unread' : 'completed', coverageStatus: unreadConversation ? 'unread-skipped' : 'list-preview', checkpoint: fingerprint };
            if (unreadConversation) itemPatch.lastError = '检测到未读会话，按规则跳过；请先在 WhatsApp 中自行阅读。';
            else if (previewChanged) itemPatch.analysisStatus = 'pending';
            await api('/api/ws/collection-items', { method: 'PATCH', body: JSON.stringify(itemPatch) }, context);
          }
        }
        // Keep a new preview pending in the persisted collection item.  The
        // next background poll (or a restart) resumes it through the durable
        // AI queue; never retain work only in renderer memory.
        return { synced: Math.max(1, inserted + updated), progressed: 1 };
      };
      // Keep the list scan responsive while avoiding a thousand serial
      // network round trips when a WhatsApp account has a large chat list.
      const previewItems = directItems.slice(0, 5000);
      for (let offset = 0; offset < previewItems.length; offset += 8) {
        const results = await Promise.all(previewItems.slice(offset, offset + 8).map(syncOnePreview));
        synced += results.reduce((sum, value) => sum + Number(value?.synced || 0), 0);
        progressed += results.reduce((sum, value) => sum + Number(value?.progressed || 0), 0);
      }
      // AI may spend up to the provider budget on a single conversation.
      // Queue it on the independent single-lane pump so list persistence and
      // collection progress never wait for an AI network request.
      scheduleAiQueuePump({ ...context, conversationId: '' });
      if (progressed) {
        if (state.collectionRun?.id) {
          const itemsResult = await api(`/api/ws/collection-items?runId=${encodeURIComponent(state.collectionRun.id)}`, {}, context);
          const items = Array.isArray(itemsResult.items) ? itemsResult.items : [];
          const completed = items.filter(item => item.status === 'completed').length;
          const analyzedItems = items.filter(item => item.analysisStatus === 'completed').length;
          const failed = items.filter(item => item.status === 'failed').length;
          const retryable = items.filter(item => ['failed', 'retryable'].includes(item.status) || ['retryable', 'failed'].includes(item.analysisStatus)).length;
          const runResult = await api('/api/ws/collection-runs', { method: 'PATCH', body: JSON.stringify({ id: state.collectionRun.id, status: 'discovering', total: items.length, discovered: items.length, completed, analyzed: Math.max(analyzedItems, analyzed), failed, retryable, cursor: JSON.stringify({ mode: 'list-preview', synced, progressed, analyzed, syncedAt: nowIso() }), lastSuccessAt: nowIso() }) }, context);
          if (runResult?.run) state.collectionRun = runResult.run;
        }
        const refreshed = await loadConversationDeltaPages(context);
        assertContext(context);
        applyConversationInventory(refreshed, context.accountId);
        reconcilePersonalConversationSelection();
      }
      if (analyzed && getHost()?.refreshState) await getHost().refreshState().catch(() => {});
      return { synced, progressed, analyzed };
    } finally { state.listSyncBusy = false; }
  }
  async function createCollectionRun() {
    const context = captureContext();
    try {
      const result = await api('/api/ws/collection-runs', { method: 'POST', body: JSON.stringify({}) }, context);
      assertContext(context);
      state.collectionRun = result.run;
      render();
      if (state.wsStatus === '已连接') await collectAllReadConversations();
      else toast('已创建采集任务，请登录并保持 WS 连接后开始自动采集');
    } catch (error) { if (contextCurrent(context)) { state.error = error.message; render(); } }
  }
  async function collectAllReadConversations() {
    if (state.busy.readHistory) return;
    if (state.wsStatus !== '已连接') { toast('请先登录并保持 WS 已连接。', 'x'); return; }
    const context = captureContext();
    state.busy.readHistory = true;
    state.readHistoryAutoStarted = true;
    state.error = '';
    render();
    try {
      if (!state.collectionRun?.id) {
        const created = await api('/api/ws/collection-runs', { method: 'POST', body: JSON.stringify({}) }, context);
        assertContext(context);
        state.collectionRun = created.run;
      }
      const running = await api('/api/ws/collection-runs', { method: 'PATCH', body: JSON.stringify({ id: state.collectionRun.id, status: 'running' }) }, context);
      assertContext(context);
      if (running?.run) state.collectionRun = running.run;
      const result = await wsBridge('collect-all-read', context);
      assertContext(context);
      if (!result?.supported || !result.started) throw new Error(result?.error || '当前 WS 页面不支持已读会话自动采集。');
      state.readHistorySkipped = Array.isArray(result.skippedUnread) ? result.skippedUnread : [];
      toast(`已启动已读会话自动采集${state.readHistorySkipped.length ? `，当前窗口跳过未读 ${state.readHistorySkipped.length} 个` : ''}。`);
      void refreshCollectionSummary();
    } catch (error) {
      state.readHistoryAutoStarted = false;
      if (contextCurrent(context)) { state.error = error.message || '已读会话自动采集失败。'; toast(state.error, 'x'); }
    } finally {
      if (contextCurrent(context)) { state.busy.readHistory = false; render(); }
    }
  }
  function maybeStartAutomaticReadHistoryCollection(context = captureContext()) {
    if (!state.backgroundActive || state.wsStatus !== '已连接' || state.readHistoryAutoStarted || state.busy.readHistory) return;
    if (state.collectionRun && ['paused', 'stopped', 'completed'].includes(state.collectionRun.status)) return;
    // List discovery and preview sync always happen first. Once the page is
    // connected, start one durable read-history pass for this account. The
    // native collector re-checks unread badges immediately before opening each
    // row, so background refreshes cannot accidentally mark unread chats read.
    state.readHistoryAutoStarted = true;
    queueMicrotask(() => {
      if (!contextCurrent(context)) { state.readHistoryAutoStarted = false; return; }
      void collectAllReadConversations();
    });
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
    const items = (Array.isArray(visible.conversations) ? visible.conversations : []).map(normalizeListItem).filter(isAutomaticCollectibleConversation);
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
    state.readHistoryAutoStarted = false;
    await collectAllReadConversations();
  }
  async function discoverConversations() {
    const context = captureContext();
    try {
      const result = await wsBridge('discover-conversations'); assertContext(context); if (!result?.supported) throw new Error(result?.error || '当前页面结构未识别'); state.discoveredConversations = (result.conversations || []).map(normalizeListItem).filter(isAutomaticCollectibleConversation);
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
    if (!canManuallyProcessConversation(current)) { toast(isExplicitGroupConversation(current) ? ordinaryGroupExclusionMessage() : '当前聊天类型尚未确认是一对一会话，已停止读取。', 'x'); return; }
    const context = captureContext(current.id);
    try {
      const result = await wsBridge('capture-visible-messages'); assertContext(context); if (!result?.supported || !result.messages?.length) throw new Error(result?.error || '当前页面没有可识别的可见消息');
      const draft = currentDraft(); draft.captureText = result.messages.map(item => item.text).join('\n'); state.captureDirection = 'receive'; render();
      await importVisible(context);
      assertContext(context);
      const analysisResult = state.aiEnabled && state.messages.length ? await analyzeConversation(context) : { ok: false, disabled: !state.aiEnabled };
      if (!contextCurrent(context)) return;
      if (state.collectionRun?.id) { await api('/api/ws/collection-items', { method: 'PATCH', body: JSON.stringify({ runId: state.collectionRun.id, conversationId: current.id, status: 'completed', analysisStatus: analysisResult.ok ? 'completed' : analysisResult.disabled ? 'pending' : 'retryable', coverageStatus: 'visible', checkpoint: String(result.messages.length), lastError: analysisResult.ok || analysisResult.disabled ? '' : String(analysisResult.reason || '').slice(0, 500) }) }, context); await api('/api/ws/collection-runs', { method: 'PATCH', body: JSON.stringify({ id: state.collectionRun.id, cursor: JSON.stringify({ conversationId: current.id, messageCount: result.messages.length, capturedAt: nowIso() }), lastSuccessAt: nowIso() }) }, context); }
      toast(`已采集当前会话 ${result.messages.length} 条可见消息`);
    } catch (error) {
      if (contextCurrent(context) && state.collectionRun?.id) { try { await api('/api/ws/collection-items', { method: 'PATCH', body: JSON.stringify({ runId: state.collectionRun.id, conversationId: current.id, status: 'failed', attempts: 1, lastError: error.message }) }, context); } catch {} }
      if (contextCurrent(context)) { state.error = error.message; render(); }
    }
  }
  async function autoCaptureCurrentConversation() {
    if (!state.active || state.wsStatus !== '已连接' || state.loading || state.busy.import || state.aiBusy) return;
    const current = activeConversation();
    if (!current || !isAutomaticCollectibleConversation(current) || ['paused', 'stopped', 'completed'].includes(state.collectionRun?.status)) return;
    const context = captureContext(current.id);
    try {
      const result = await wsBridge('capture-visible-messages');
      if (!contextCurrent(context)) return;
      if (!result?.supported || !result.messages?.length) return;
      const capturedText = result.messages.map(item => item.text).join('\n').trim();
      if (!capturedText || capturedText === state.autoCaptureSignature) return;
      const draft = currentDraft();
      draft.captureText = capturedText;
      state.captureDirection = 'receive';
      await importVisible(context);
      if (!contextCurrent(context)) return;
       const analysisResult = state.aiEnabled && state.messages.length ? await analyzeConversation(context) : { ok: false, disabled: !state.aiEnabled };
       if (!contextCurrent(context)) return;
       if (analysisResult.ok || analysisResult.disabled) state.autoCaptureSignature = capturedText;
       else state.autoCaptureSignature = '';
      if (state.collectionRun?.id) {
        await api('/api/ws/collection-items', { method: 'PATCH', body: JSON.stringify({ runId: state.collectionRun.id, conversationId: current.id, status: 'completed', analysisStatus: analysisResult.ok ? 'completed' : analysisResult.disabled ? 'pending' : 'retryable', coverageStatus: 'visible', checkpoint: String(result.messages.length), lastError: analysisResult.ok || analysisResult.disabled ? '' : String(analysisResult.reason || '').slice(0, 500) }) }, context);
        await api('/api/ws/collection-runs', { method: 'PATCH', body: JSON.stringify({ id: state.collectionRun.id, cursor: JSON.stringify({ conversationId: current.id, messageCount: result.messages.length, capturedAt: nowIso() }), lastSuccessAt: nowIso() }) }, context);
      }
    } catch (error) {
      if (!contextCurrent(context)) return;
      state.error = `后台采集暂时失败：${String(error?.message || 'WS 页面暂不可读').slice(0, 240)}`;
      if (Date.now() - autoCaptureNoticeAt > 60000) {
        autoCaptureNoticeAt = Date.now();
        toast(state.error, 'x');
        render();
      }
    }
  }
  function renderFollowupAlerts() {
    const alerts = state.followupAlerts || [];
    if (!alerts.length) return '<p class="ws-muted">当前没有自动识别出的待跟进客户。</p>';
    return `<div class="ws-followup-alerts">${alerts.map(item => {
      const confidence = Math.round(Number(item.confidence || 0) * 100);
      return `<article class="ws-followup-alert ${esc(item.priority || 'today')}">
        <div class="ws-followup-alert-head"><strong>${esc(item.title || item.externalId || '未命名客户')}</strong><span>${esc(item.reason || item.intent || '建议跟进')}</span></div>
        <p>${esc(item.objective || item.nextStep || item.summary || '请人工查看会话并确认下一步')}</p>
        ${item.opener ? `<p class="ws-followup-opener"><strong>建议开场：</strong>${esc(item.opener)}</p>` : ''}
        ${Array.isArray(item.talkingPoints) && item.talkingPoints.length ? `<p class="ws-muted">话题：${item.talkingPoints.map(esc).join(' → ')}</p>` : ''}
        ${Array.isArray(item.avoidTopics) && item.avoidTopics.length ? `<p class="ws-error-line">避免：${item.avoidTopics.map(esc).join('；')}</p>` : ''}
        <div class="ws-followup-alert-meta"><span>${item.followupTime ? `计划 ${esc(String(item.followupTime).slice(0, 16))}` : '未设置时间'}</span><span>优先级 ${Number(item.priorityScore || 0)}/100</span><span>置信度 ${confidence}%</span></div>
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
    const fullHistoryCount = state.conversations.filter(item => item.data?.historyLoaded === true && Number(item.data?.directionVersion || 0) >= 4 && Boolean(fullHistorySourceFingerprint(item))).length;
    const discovered=Math.max(0,Number(run?.discovered||0)),skipped=Math.max(0,Number(run?.skipped||0)),analyzed=Math.max(0,Number(run?.analyzed||0)),retryable=Math.max(0,Number(run?.retryable||0));
    const pendingHistory=Math.max(0,discovered-fullHistoryCount-skipped),pipeline=[['列表级自动采集',discovered,run?'已同步':'等待登录'],['完整历史',fullHistoryCount,pendingHistory?`待补采 ${pendingHistory}`:'已完成'],['AI 分析',analyzed,fullHistoryCount>analyzed?`队列 ${fullHistoryCount-analyzed}`:'已同步'],['档案与任务',Math.min(analyzed,Number(run?.completed||analyzed)),state.aiEnabled?'自动联动':'AI 已关闭']];
    const pipelineHtml=`<div class="ws-collection-pipeline">${pipeline.map(([label,value,detail],index)=>`<div class="ws-pipeline-stage ${value?'has-progress':''}"><span class="ws-pipeline-index">${index+1}</span><div><strong>${esc(label)}</strong><b>${Number(value).toLocaleString()}</b><small>${esc(detail)}</small></div></div>`).join('')}</div><p class="ws-coverage-warning">会话列表只代表已发现；只有“完整历史”计数才表示该客户双方聊天已采集、方向已核实并成功落库。</p>`;
    if (!run) return `<section class="ws-card ws-collection-card"><div class="ws-card-heading"><div><strong>登录即采集</strong><span>扫码登录后自动同步会话列表与实时消息；后台逐个补采已读会话完整历史，前台仍可正常聊天</span></div></div>${pipelineHtml}<p class="ws-muted">未读会话永不自动打开；普通群和类型不明会话不进入分析，系统设置中明确绑定的 VIP 群按成员身份进入同一采集与分析链。AI 结果统一进入任务中心和今日工作台。</p><button class="btn small primary ws-full-button" data-ws-action="create-collection-run">立即启动后台采集</button></section>`;
    const pending = Math.max(0, run.total - run.completed - run.failed - run.skipped);
    const controls = run.status === 'paused' ? '<button class="btn small" data-ws-action="resume-collection">继续</button>' : ['created','running','discovering'].includes(run.status) ? '<button class="btn small" data-ws-action="pause-collection">暂停</button><button class="btn small danger" data-ws-action="stop-collection">停止</button>' : '';
    return `<section class="ws-card ws-collection-card" data-run-status="${esc(run.status)}"><div class="ws-card-heading"><div><strong>登录即采集</strong><span>${esc(run.status)} · 后台运行 · 更新于 ${esc(displayTime(run.updatedAt))}${run.lastSuccessAt ? ` · 最近成功 ${esc(displayTime(run.lastSuccessAt))}` : ''}</span></div><div>${controls}${['running','discovering','paused'].includes(run.status) ? '<button class="btn small" data-ws-action="resume-collection-checkpoint">从断点继续</button>' : ''}<button class="btn small" data-ws-action="collect-all-read" ${state.busy.readHistory ? 'disabled' : ''}>${state.busy.readHistory ? '采集中…' : '补采完整聊天'}</button><button class="btn small" data-ws-action="create-collection-run">新建任务</button></div></div>${pipelineHtml}<div class="ws-collection-stats"><b>${run.completed}/${run.total || run.discovered}</b><span>列表已同步</span><b>${run.analyzed}</b><span>已分析</span><b>${fullHistoryCount}</b><span>完整历史</span><b>${run.skipped || 0}</b><span>跳过未读</span><b>${run.retryable}</b><span>待重试</span><b>${pending}</b><span>待处理</span><b>${run.resumeCount || 0}</b><span>续采次数</span></div>${run.lastError ? `<p class="ws-error-line">${esc(run.lastError)}</p>` : ''}<p class="ws-muted">你可以离开 WS 页面或最小化知客；只要应用仍打开且账号未退出，后台采集与 AI 队列会继续。普通群不参与；已绑定 VIP 群按成员身份采集分析。正式提醒统一同步到任务中心与今日工作台。</p></section>`;
  }
  async function loadConversationData(id, redraw = true, parentContext = null) {
    const conversationId = String(id || '');
    const context = { ...(parentContext || captureContext(conversationId)), conversationId };
    if (context.sequence !== Number(state.accountLoadSequence || 0) || context.accountId !== String(state.activeAccountId || 'default')) return;
    if (String(state.currentConversationId || '') !== conversationId && manualAiController) {
      manualAiController.abort();
      state.aiBusy = false;
    }
    state.currentConversationId = conversationId;
    state.analysis = null;
    state.analysisMeta = null;
    state.hotProfile = null;
    state.hotProfileError = '';
    state.hotProfileBusy = false;
    state.hotProfileEdits = Object.create(null);
    state.hotProfileColorDraft = '';
    state.crmSyncStatus = '';
    state.historyCoverage = { loaded: 0, total: 0, complete: false };
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
      const [settings, analyses, replies] = await Promise.all([
        api(`/api/ws/settings?conversationId=${encoded}`, {}, context),
        api(`/api/ws/analyses?conversationId=${encoded}&limit=1`, {}, context),
        api(`/api/ws/replies?conversationId=${encoded}&limit=10`, {}, context),
      ]);
      assertContext(context);
      const messageHistory = await loadAllConversationMessages(state.currentConversationId, context);
      assertContext(context);
      state.settings = core.normalizeTranslationSettings(settings);
      state.aiEnabled = settings.aiEnabled !== false;
      state.messages = messageHistory.messages;
      state.historyCoverage = { loaded: messageHistory.loaded, total: messageHistory.total, complete: messageHistory.complete };
      state.analysisMeta = Array.isArray(analyses.analyses) ? analyses.analyses[0] || null : analyses.analysis || null;
      state.analysis = state.analysisMeta?.result || null;
      if (state.analysisMeta) state.analysisRefreshPending.delete(String(state.currentConversationId));
      state.replies = Array.isArray(replies.replies) ? replies.replies : [];
      // The hot-chat profile is intentionally loaded independently of the CRM
      // draft. It is scoped by account + conversation and may not have a
      // customer id yet while the user is still deciding whether to link one.
      const hot = await api(`/api/ws/hot-chat/profile/diagnostics?conversationId=${encoded}&customerId=${encodeURIComponent(text(activeConversation()?.customerId))}`, {}, context).catch(error => ({ profile: null, error: error.message }));
      assertContext(context);
      state.hotProfile = hot.profile || null;
      state.hotProfileError = hot.error || '';
      state.hotProfileEdits = Object.create(null);
      seedDraftFromAnalysis();
      state.translationStatus = state.settings.enabled ? `${core.translationMode(state.settings)} · 可按方向关闭` : '翻译已关闭 · 手动翻译仍可用';
      state.lastLoadedAt = nowIso();
    } catch (error) {
      if (contextCurrent(context)) state.error = error.message;
    } finally {
      if (contextCurrent(context)) { state.loading = false; if (redraw) render(); }
    }
  }
  async function loadHotProfile(context = captureContext(), redraw = true) {
    const current = activeConversation();
    if (!current) { state.hotProfile = null; state.hotProfileError = ''; if (redraw) render(); return; }
    state.hotProfileBusy = true;
    if (redraw) render();
    try {
      const encoded = encodeURIComponent(current.id);
      const customerId = encodeURIComponent(text(current.customerId));
      const result = await api(`/api/ws/hot-chat/profile/diagnostics?conversationId=${encoded}&customerId=${customerId}`, {}, context);
      assertContext(context);
      state.hotProfile = result.profile || null;
      state.hotProfileError = '';
      state.hotProfileEdits = Object.create(null);
      state.hotProfileColorDraft = '';
    } catch (error) {
      if (contextCurrent(context)) {
        state.hotProfileError = String(error?.message || '热聊档案读取失败').slice(0, 240);
        // Keep the last good snapshot visible when a refresh is transiently
        // unavailable; this is safer than replacing a useful profile with an
        // empty state during an offline/WS reconnect.
      }
    } finally {
      if (contextCurrent(context)) { state.hotProfileBusy = false; if (redraw) render(); }
    }
  }
  async function saveHotProfileFact(element, locked = false) {
    const current = activeConversation();
    if (!current || state.hotProfileBusy) return;
    const field = text(element?.dataset?.field);
    if (!field) return;
    const value = Object.hasOwn(state.hotProfileEdits, field) ? state.hotProfileEdits[field] : hotProfileFieldValue(state.hotProfile?.fields?.[field]?.value);
    if (!value && !['is_investor'].includes(field)) { toast('请先填写或从聊天分析中得到该资料，再确认。', 'x'); return; }
    const context = captureContext(current.id);
    state.hotProfileBusy = true;
    render();
    try {
      const result = await api('/api/ws/hot-chat/profile/confirm', {
        method: 'POST',
        body: JSON.stringify({ conversationId: current.id, customerId: text(current.customerId), field, value, confidence: 1, evidence: locked ? '人工确认并锁定' : '人工确认', locked }),
      }, context);
      assertContext(context);
      state.hotProfile = result.profile || state.hotProfile;
      state.hotProfileError = '';
      state.hotProfileColorDraft = '';
      delete state.hotProfileEdits[field];
      toast(locked ? `${HOT_PROFILE_LABELS[field] || field}已确认并锁定` : `${HOT_PROFILE_LABELS[field] || field}已确认`);
    } catch (error) {
      if (contextCurrent(context)) { state.hotProfileError = error.message || '热聊资料保存失败'; toast(state.hotProfileError, 'x'); }
    } finally {
      if (contextCurrent(context)) { state.hotProfileBusy = false; render(); }
    }
  }
  async function saveHotProfileColor() {
    const current = activeConversation();
    const color = text($('#wsHotProfileColor')?.value || state.hotProfile?.statusColor || 'gray');
    if (!current || !HOT_PROFILE_COLORS[color]) return;
    const context = captureContext(current.id);
    state.hotProfileBusy = true;
    render();
    try {
      const result = await api('/api/ws/hot-chat/profile/confirm', { method: 'POST', body: JSON.stringify({ conversationId: current.id, customerId: text(current.customerId), color, locked: true }) }, context);
      assertContext(context);
      state.hotProfile = result.profile || state.hotProfile;
      state.hotProfileError = '';
      state.hotProfileColorDraft = '';
      toast(`客户状态已标记为“${HOT_PROFILE_COLORS[color]}”`);
    } catch (error) {
      if (contextCurrent(context)) { state.hotProfileError = error.message || '客户状态保存失败'; toast(state.hotProfileError, 'x'); }
    } finally {
      if (contextCurrent(context)) { state.hotProfileBusy = false; render(); }
    }
  }
  async function createConversation() {
    if (state.busy.customer) return;
    const externalId = text($('#wsConversationExternalId')?.value || state.createExternalId);
    const title = text($('#wsConversationTitle')?.value || state.createTitle);
    if (!externalId) { toast('请输入 WS 会话标识；不读取平台账号或 Cookie。', 'x'); return; }
    const groupJid = /@g\.us$/i.test(externalId);
    const vipGroup = groupJid && isConfiguredVipGroupIdentifier(externalId, title);
    if (groupJid && !vipGroup) { toast(ordinaryGroupExclusionMessage(' WS 客户采集、AI 分析或跟进提醒'), 'x'); return; }
    const context = captureContext();
    state.busy.customer = true;
    render();
    try {
      const conversationType = vipGroup ? 'vip_group' : 'direct';
      const item = await api('/api/ws/conversations', { method: 'POST', body: JSON.stringify({ externalId, title, conversationType, isGroup:vipGroup, vipGroup, data: { source: 'user-local-manual', conversationType, isGroup:vipGroup, vipGroup } }) }, context);
      assertContext(context);
      const existing = state.conversations.find(row => String(row.id) === String(item.id));
      state.conversations = existing ? state.conversations.map(row => String(row.id) === String(item.id) ? item : row) : [item, ...state.conversations];
      state.createExternalId = '';
      state.createTitle = '';
      state.mobilePanel = 'center';
      state.conversationSelectionManual = true;
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
    const matches = state.conversations.filter(item => !query || `${item.title || ''} ${item.externalId || ''} ${item.lastMessageText || ''}`.toLocaleLowerCase().includes(query));
    const lastWindowStart = Math.max(0, Math.floor(Math.max(0, matches.length - 1) / CONVERSATION_RENDER_BATCH) * CONVERSATION_RENDER_BATCH);
    const windowStart = Math.min(lastWindowStart, Math.max(0, Number(state.conversationWindowStart) || 0));
    if (windowStart !== state.conversationWindowStart) state.conversationWindowStart = windowStart;
    const windowEnd = Math.min(matches.length, windowStart + CONVERSATION_RENDER_BATCH);
    const rows = matches.slice(windowStart, windowEnd).map(item => {
      const stamp = displayTime(item.lastMessageAt || item.updatedAt);
      const rawHistoryLoaded = item.data?.historyLoaded === true;
      const historyLoaded = rawHistoryLoaded && Number(item.data?.directionVersion || 0) >= 4;
      const historyCount = Number(item.data?.historyMessageCount || 0);
      const coverage = historyLoaded ? `完整聊天 ${historyCount || ''} 条` : (rawHistoryLoaded ? '待重采校验消息方向' : (item.data?.previewOnly ? '列表预览' : '已导入消息'));
      return `<button class="ws-session-row ${String(item.id) === String(state.currentConversationId) ? 'active' : ''}" data-ws-action="select-conversation" data-id="${esc(item.id)}"><span class="ws-session-avatar">${esc((item.title || 'WS').slice(0, 1))}</span><span class="ws-session-copy"><strong>${esc(item.title || item.externalId)}</strong><small>${esc(item.lastMessageText || '尚未导入聊天内容')}</small><time>${esc(stamp || '暂无消息时间')} · ${esc(coverage)}</time></span><span class="ws-session-side"><em>${esc(item.intentLevel || '待分析')}</em>${Number(item.unreadCount) > 0 ? `<b>${Math.min(99, Number(item.unreadCount))}</b>` : ''}</span></button>`;
    }).join('');
    if (rows) {
      const previous = windowStart > 0
        ? '<button class="btn small ws-session-page" data-ws-action="previous-conversations">上一页</button>'
        : '';
      const next = windowEnd < matches.length
        ? '<button class="btn small ws-session-page" data-ws-action="next-conversations">下一页</button>'
        : '';
      return `${rows}<div class="ws-session-pagination">${previous}<span>${windowStart + 1}–${windowEnd} / ${matches.length}</span>${next}</div>`;
    }
    return `<div class="ws-empty">${state.conversations.length ? '没有匹配的会话。' : '还没有本机会话。输入会话标识后建立记录，不会预置演示数据。'}</div>`;
  }
  function renderAccountList() {
    if (state.accountsLoading) return '<div class="ws-empty ws-loading">正在加载 WS 账号…</div>';
    if (!state.accounts.length) return '<div class="ws-empty">暂无 WS 账号。点击“添加账号”创建本机登录页。</div>';
    return state.accounts.map(account => {
      const active = String(account.id) === String(state.activeAccountId);
      const status = accountStatusLabel(account);
      const initial = esc(accountDisplayName(account).slice(0, 1).toUpperCase());
       const statusTitle = account?.lastSeen ? `上次状态：${account.lastKnownStatus || '未知'} · ${displayTime(account.lastSeen)}` : '';
       return `<button class="ws-account-row ${active ? 'active' : ''}" data-ws-action="switch-account" data-account-id="${esc(account.id)}" aria-current="${active ? 'true' : 'false'}" title="${esc(statusTitle)}">
        <span class="ws-account-avatar">${initial}</span><span class="ws-account-copy"><strong>${esc(accountDisplayName(account))}</strong><small>${esc(account.id)}</small></span><span class="ws-account-status" data-status="${esc(status)}">${esc(status)}</span>
      </button>`;
    }).join('');
  }
  function renderAccountForm() {
    if (!state.accountFormOpen) return '';
    return `<div class="ws-account-form" role="dialog" aria-label="添加 WS 账号"><label for="wsAccountDisplayName">本机显示名称</label><input id="wsAccountDisplayName" maxlength="80" autocomplete="off" placeholder="例如：个人号、工作号" value="${esc(state.accountFormName)}"><div class="ws-account-form-actions"><button class="btn small primary" data-ws-action="submit-account" ${state.accountBusy ? 'disabled' : ''}>${state.accountBusy ? '创建中…' : '创建并登录'}</button><button class="btn small" data-ws-action="cancel-account" ${state.accountBusy ? 'disabled' : ''}>取消</button></div>${state.accountFormError ? `<p class="ws-account-form-error">${esc(state.accountFormError)}</p>` : ''}</div>`;
  }
  function messageDirectionPresentation(message = {}) {
    const data = message.data && typeof message.data === 'object' && !Array.isArray(message.data) ? message.data : {};
    const directionSource = text(data.directionSource);
    const nativeDirectionPending = data.source === 'ws-webview2'
      && (Number(data.directionVersion || 0) < 4 || VERIFIED_NATIVE_DIRECTION_SOURCE_MAP.get(directionSource) !== message.direction);
    if (nativeDirectionPending) return { label: '发言方向待核实', className: 'direction-pending' };
    return message.direction === 'send'
      ? { label: '我发送', className: 'send' }
      : { label: '客户发来', className: 'receive' };
  }
  function loadedMessageDirectionCounts(messages = state.messages) {
    const counts = { send: 0, receive: 0, pending: 0 };
    for (const message of Array.isArray(messages) ? messages : []) {
      const direction = messageDirectionPresentation(message).className;
      if (direction === 'send') counts.send += 1;
      else if (direction === 'receive') counts.receive += 1;
      else counts.pending += 1;
    }
    return counts;
  }
  function renderMessageRows() {
    if (!state.messages.length) return '<div class="ws-empty ws-message-empty">后台采集或手动导入完成后，客户与我方双方的原文、译文和发送方向会显示在这里。</div>';
    return state.messages.map(message => {
      const busy = state.translationBusy.has(translationBusyKey(message.id));
      const failed = message.translationStatus === 'failed' || Boolean(message.translationError);
      const showOriginal = state.settings.showOriginal || !message.translatedText || failed;
      const sentAt = core.messageSentAt?.(message) || '';
      const unknownCollectedTime = message.data?.source === 'ws-webview2' && !sentAt;
      const fallbackStamp = message.data?.timestamp || message.createdAt || '';
      const observedAt = message.observedAt || message.data?.observedAt || message.createdAt || '';
      const timeLabel = unknownCollectedTime ? '发送时间未识别' : displayTime(sentAt || fallbackStamp);
      const timeTitle = unknownCollectedTime && observedAt ? ` title="${esc(`采集于 ${displayTime(observedAt)}`)}"` : '';
      const direction = messageDirectionPresentation(message);
      return `<article class="ws-message-row ${direction.className} ${failed ? 'failed' : ''}" data-message-id="${esc(message.id)}"><div class="ws-message-meta"><span>${direction.label}</span><time${timeTitle}>${esc(timeLabel)}</time><button class="link-button" data-ws-action="translate-message" data-id="${esc(message.id)}" ${busy ? 'disabled' : ''}>${busy ? '翻译中…' : failed ? '重试翻译' : '手动翻译'}</button></div><div class="ws-message-original" ${showOriginal ? '' : 'hidden'}><small>原文</small><p>${esc(message.originalText)}</p></div>${message.translatedText ? `<div class="ws-message-translated"><small>译文 · ${esc(message.targetLanguage || state.settings.targetLanguage)}</small><p>${esc(message.translatedText)}</p></div>` : `<div class="ws-message-untranslated">${failed ? `翻译失败：${esc(message.translationError || '服务暂不可用')}，原文已安全保存。` : '尚无译文；可点击“手动翻译”。'}</div>`}</article>`;
    }).join('');
  }
  function renderAnalysis() {
    const analysis = state.analysis;
    if (!analysis) return '<div class="ws-empty">选择“分析当前聊天”后，AI 才会处理本地已导入的消息。</div>';
    if (analysis.error) return `<div class="ws-empty"><strong>上次分析未成功</strong><p class="ws-error-line">${esc(analysis.error)}</p><p>原始聊天仍保留；完整采集完成后会自动重试，也可点击“重新分析当前聊天”。</p></div>`;
    const tags = (analysis.tags || []).map(tag => `<span class="ws-tag">${esc(tag)}</span>`).join('');
    const needs = (analysis.needs || []).map(item => `<li>${esc(item)}</li>`).join('');
    const analyzedAt = displayTime(state.analysisMeta?.createdAt);
    const strategy = analysis.followupStrategy && typeof analysis.followupStrategy === 'object' ? analysis.followupStrategy : {};
    const talkingPoints = (strategy.talkingPoints || []).map(item => `<li>${esc(item)}</li>`).join('');
    const avoidTopics = (strategy.avoidTopics || []).map(item => `<li>${esc(item)}</li>`).join('');
    const reanalyzeWhen = (strategy.reanalyzeWhen || []).map(item => `<li>${esc(item)}</li>`).join('');
    const priorityScore = Math.max(0, Math.min(100, Number(strategy.priorityScore) || 0));
    const followupStrategy = strategy.shouldFollowUp === false ? '' : `<div class="ws-analysis-section ws-followup-strategy"><strong>智能跟进方案 · 综合优先级 ${priorityScore}/100</strong><p><b>资金实力：</b>${Number(strategy.qualificationScore || 0)}/100${strategy.qualificationReason ? ` · ${esc(strategy.qualificationReason)}` : ''}</p><p><b>聊天粘度：</b>${Number(strategy.engagementScore || 0)}/100${strategy.engagementReason ? ` · ${esc(strategy.engagementReason)}` : ''}</p>${strategy.scoreReason ? `<p><b>评分依据：</b>${esc(strategy.scoreReason)}</p>` : ''}${strategy.reason ? `<p>${esc(strategy.reason)}</p>` : ''}${strategy.objective ? `<p><b>本次目标：</b>${esc(strategy.objective)}</p>` : ''}${strategy.bestTime ? `<p><b>建议时间：</b>${esc(strategy.bestTime)}</p>` : ''}${strategy.opener ? `<p><b>建议开场：</b>${esc(strategy.opener)}</p>` : ''}${talkingPoints ? `<b>话题推进</b><ol>${talkingPoints}</ol>` : ''}${avoidTopics ? `<b>避免事项</b><ul>${avoidTopics}</ul>` : ''}${reanalyzeWhen ? `<b>重新分析条件</b><ul>${reanalyzeWhen}</ul>` : ''}<small>评分由 AI 根据完整聊天中的资金实力与互动粘度生成；AI 不会自动发送消息。</small></div>`;
    const coverage = analysis.transcriptInfo?.historyComplete
       ? (analysis.transcriptInfo?.truncated
         ? `完整历史已保存 ${Number(analysis.transcriptInfo.historyTotal || analysis.transcriptInfo.total || 0)} 条，AI 分析覆盖 ${Number(analysis.transcriptInfo.included || 0)} 条（历史过长，已分段截取）`
         : `完整历史 ${Number(analysis.transcriptInfo.historyTotal || analysis.transcriptInfo.total || 0)} 条`)
       : `已分析 ${Number(analysis.transcriptInfo?.included || 0)} 条${analysis.transcriptInfo?.truncated ? '（历史过长，已分段截取）' : ''}`;
    return `<div class="ws-analysis-result"><div class="ws-ai-summary"><strong>${esc(analysis.summary || '暂无摘要')}</strong><span class="ws-confidence ${analysis.lowConfidence ? 'low' : ''}">${analysis.lowConfidence ? 'AI 置信度较低，已按只补空字段策略自动处理；冲突保留原值。' : `置信度 ${Math.round((Number(analysis.confidence) || 0) * 100)}%`}</span><small>分析覆盖：${esc(coverage)}</small>${analyzedAt ? `<small>分析于 ${esc(analyzedAt)}</small>` : ''}${state.crmSyncStatus ? `<small class="ws-crm-sync-status">知客联动：${esc(state.crmSyncStatus)}</small>` : ''}</div><dl class="ws-fact-grid"><div><dt>意向</dt><dd>${esc(analysis.intent || '未识别')} ${analysis.intentScore == null ? '' : `· ${esc(analysis.intentScore)}`}</dd></div><div><dt>情绪</dt><dd>${esc(analysis.emotion || '未识别')}</dd></div><div><dt>语言</dt><dd>${esc(analysis.language || '未识别')}</dd></div><div><dt>紧急程度</dt><dd>${esc(analysis.urgency || '未识别')}</dd></div><div><dt>客户阶段</dt><dd>${esc(analysis.customerStage || '未识别')}</dd></div><div><dt>国家/地区</dt><dd>${esc(analysis.contact?.country || analysis.country || '未提取')}</dd></div><div><dt>产品兴趣</dt><dd>${esc(Array.isArray(analysis.productInterest) ? analysis.productInterest.join('、') : analysis.productInterest || '未提取')}</dd></div><div><dt>预算</dt><dd>${esc(analysis.budget || '未提取')}</dd></div></dl>${needs ? `<div class="ws-analysis-section"><strong>需求</strong><ul>${needs}</ul></div>` : ''}${tags ? `<div class="ws-analysis-section"><strong>标签建议</strong><div class="ws-tag-list">${tags}</div></div>` : ''}${followupStrategy}<div class="ws-analysis-section"><strong>下一步</strong><p>${esc(analysis.nextStep || '请人工确认下一步沟通')}</p><p class="ws-muted">${esc(strategy.bestTime || analysis.followupTime || '')}</p></div>${analysis.replySuggestion ? `<div class="ws-analysis-section ws-ai-reply"><strong>AI 回复建议</strong><p>${esc(analysis.replySuggestion)}</p><button class="btn small" data-ws-action="use-ai-reply">采用到回复框</button></div>` : ''}${analysis.error ? `<p class="ws-error-line">${esc(analysis.error)}</p>` : ''}</div>`;
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
    const loadedDirections = loadedMessageDirectionCounts();
    const statusDetail = state.wsDetail || (state.wsStatus === '已连接' ? '已通过页面结构确认 WS 主界面；未读取 Cookie 或消息正文。' : '请在中栏自行完成扫码或登录。');
    const collectionRun = state.collectionRun;
    const fullHistoryCount = state.conversations.filter(item => item.data?.historyLoaded === true && Number(item.data?.directionVersion || 0) >= 4 && Boolean(fullHistorySourceFingerprint(item))).length;
    const runtimeStatus = state.backgroundActive ? (state.wsStatus === '已连接' ? '后台持续运行' : '后台等待连接') : '后台未启动';
    const runtimeTone = state.backgroundActive && state.wsStatus === '已连接' ? 'running' : state.backgroundActive ? 'waiting' : 'idle';
    const runtimeOverview = `<div class="ws-runtime-strip" aria-label="WS 后台运行概览">
      <span class="ws-runtime-primary" data-tone="${runtimeTone}"><i></i><b>${runtimeStatus}</b></span>
      <span><small>列表</small><b>${Number(collectionRun?.discovered || state.conversations.length || 0).toLocaleString()}</b></span>
      <span><small>完整历史</small><b>${fullHistoryCount.toLocaleString()}</b></span>
      <span><small>待分析</small><b>${Number(state.aiQueueStats.queued || 0).toLocaleString()}</b></span>
      <span><small>跳过未读</small><b>${Number(collectionRun?.skipped || state.readHistorySkipped.length || 0).toLocaleString()}</b></span>
      <div class="ws-runtime-actions"><button type="button" data-ws-action="open-home">今日工作台</button><button type="button" data-ws-action="open-tasks">任务中心</button></div>
    </div>`;
    target.innerHTML = `
      <div class="ws-workbench-page">
        <div class="page-heading ws-page-heading">
          <div><h1 class="page-title">WS 工作台</h1><p class="page-subtitle">多账号后台采集、完整历史与 AI 客户运营 · 前台聊天不受影响 · 不保存密码、Cookie、二维码或秘密 Token</p></div>
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
              <div class="ws-login-summary"><strong>${esc(accountDisplayName(activeAccount()) || 'WS 登录入口')}</strong><span id="wsStatusDetail" class="ws-login-status" title="${esc(statusDetail)}">${esc(statusDetail)}</span></div>
              ${runtimeOverview}
              <div class="ws-toolbar-actions">
                <button class="btn small primary ws-toolbar-open" data-ws-action="open" ${state.busy.connection ? 'disabled' : ''}>${state.wsStatus === '已连接' ? '已打开 WS' : '打开 WS'}</button>
                <button class="btn small" data-ws-action="probe">检测状态</button>
                <button class="btn small" data-ws-action="discover-conversations">扫描全部会话列表</button>
                <button class="btn small primary ws-toolbar-collect" data-ws-action="collect-all-read" ${state.busy.readHistory ? 'disabled' : ''}>${state.busy.readHistory ? '采集中…' : '自动采集已读会话'}</button>
                <button class="btn small" data-ws-action="reconnect">重新连接</button>
                <button class="btn small" data-ws-action="reload">刷新页面</button>
                <button class="btn small danger" data-ws-action="close">关闭 WS</button>
                <button class="btn small" data-ws-action="clear-session">清除登录会话</button>
              </div>
            </div>
            <div id="wsBrowserHost" class="ws-browser-host"><div class="ws-browser-placeholder"><strong>官方 WS 页面会显示在这里</strong><span>用户自行登录；知客不会读取密码、Cookie 或二维码。</span></div></div>
            <div class="ws-capture-panel ${state.captureCollapsed ? 'is-collapsed' : ''}">
              <div class="ws-capture-heading">
                <div><strong>导入当前可见聊天</strong><span>可先在 WS 页面选中文字，再点击读取；也可手动粘贴。</span></div>
                <div class="ws-capture-heading-actions"><button class="btn small" data-ws-action="toggle-capture" aria-expanded="${state.captureCollapsed ? 'false' : 'true'}">${state.captureCollapsed ? '展开导入' : '收起导入'}</button>${state.captureCollapsed ? '' : '<select id="wsCaptureDirection"><option value="receive" ' + (state.captureDirection === 'receive' ? 'selected' : '') + '>客户发来</option><option value="send" ' + (state.captureDirection === 'send' ? 'selected' : '') + '>我发送</option></select>'}</div>
              </div>
              ${state.captureCollapsed ? '<div class="ws-capture-collapsed-note">导入区已收起，已保留当前草稿内容。</div>' : `<textarea id="wsVisibleChat" rows="4" placeholder="支持“我：… / 客户：…”以及带日期、时间、发送人的聊天文本">${esc(draft.captureText)}</textarea>
              <div id="wsCapturePreview" class="ws-capture-preview">识别 ${captureRows.length} 条：客户发来 ${receiveCount} 条，我发送 ${sendCount} 条</div>
              <div class="ws-capture-actions">
                <span class="ws-muted">${current ? `当前会话：${esc(current.title || current.externalId)}` : '请先建立或选择本机会话'}</span>
                <button class="btn small" data-ws-action="capture-selection" ${state.busy.capture ? 'disabled' : ''}>${state.busy.capture ? '读取中…' : '读取选中文字'}</button>
                <button class="btn small" data-ws-action="capture-visible-messages" ${state.busy.import ? 'disabled' : ''}>采集当前消息</button>
                <button class="btn small" data-ws-action="clear-capture">清空</button>
                <button class="btn small primary" data-ws-action="import-visible" ${!current || !captureRows.length || state.busy.import ? 'disabled' : ''}>${state.busy.import ? '保存处理中…' : '保存并处理'}</button>
              </div>`}
            </div>
            <div class="ws-message-heading"><strong>本地消息</strong><span>${state.historyCoverage.complete ? '完整聊天采集已完成' : '完整历史采集中；列表预览不会代替完整聊天'} · 当前已加载：我方 ${loadedDirections.send} · 客户 ${loadedDirections.receive} · 待核实 ${loadedDirections.pending}</span>${failedTranslations ? `<button class="btn small" data-ws-action="retry-failed">重试 ${failedTranslations} 条失败翻译</button>` : ''}</div>
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
              <div class="ws-card-heading"><div><strong>AI 分析</strong><span>${state.historyCoverage.complete ? `当前客户完整聊天 ${state.historyCoverage.loaded} 条` : '完整历史采集完成后分析全部客户聊天'} · 队列 ${Number(state.aiQueueStats.queued || 0)} 待处理 / ${Number(state.aiQueueStats.retryable || 0)} 待重试</span></div><label class="ws-switch"><input id="wsAiEnabled" type="checkbox" ${state.aiEnabled ? 'checked' : ''}><span>AI 开关</span></label></div>
              ${state.aiBackgroundError ? `<div class="ws-error-line"><span>${esc(state.aiBackgroundError)}</span><button class="btn small" data-ws-action="resume-ai-queue">立即重试</button></div>` : ''}
              <button class="btn small primary ws-full-button" data-ws-action="analyze" ${!current || !state.messages.length || !state.aiEnabled || state.aiBusy ? 'disabled' : ''}>${state.aiBusy ? '分析中…' : state.analysis ? '重新分析当前聊天' : '分析当前聊天'}</button>
              <div class="ws-analysis-content">${renderAnalysis()}</div>
            </section>
            ${renderCollectionCard()}
            ${renderHotProfile()}
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
        if (state.active) queueResizeWsView();
      });
      browserResizeObserver.observe(browserHost);
    }
    queueResizeWsView();
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
    const importType = core.detectChatImportType?.(draft.captureText) || { type: 'unknown', reason: 'insufficient-group-evidence', senderCount: 0 };
    const rows = core.parseVisibleChat(draft.captureText, state.captureDirection);
    if (!current) { toast('请先建立或选择本机会话。', 'x'); return; }
    const vipGroup = isAutomaticVipGroupConversation(current);
    if (!canManuallyProcessConversation(current)) { toast(isExplicitGroupConversation(current) ? ordinaryGroupExclusionMessage() : '当前聊天类型尚未确认是一对一会话，已停止导入。', 'x'); return; }
    if (importType.type === 'group' && !vipGroup) { toast(`检测到明确的 WhatsApp 群聊导出；${ordinaryGroupExclusionMessage('客户采集、AI 分析或提醒')}`, 'x'); return; }
    if (importType.reason === 'multiple-senders' && !vipGroup) { toast(`检测到 ${Number(importType.senderCount || 0)} 位发言人，无法确认为一对一聊天；请导入单个客户的一对一记录。`, 'x'); return; }
    if (!rows.length) { toast('请先选择或粘贴当前可见聊天文本。', 'x'); return; }
    // Only contact identity fields may auto-fill the customer phone. Numbers
    // mentioned in chat content can belong to a third party. A phone entered
    // manually by the user remains authoritative.
    if (!draft.customerPhone) draft.customerPhone = core.extractPhone(`${current.externalId || ''} ${current.title || ''}`);
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
        data: { source: 'user-visible-selection', batchFingerprint: fingerprint, timestamp: row.timestamp, sender: row.sender, ...(vipGroup ? { conversationType:'vip_group', isGroup:true, vipGroup:true, senderName:row.sender, senderIdentityTrusted:false, senderIdentitySource:'manual-visible-label' } : {}) },
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
    const current = activeConversation();
    if (current && !canManuallyProcessConversation(current)) { toast(isExplicitGroupConversation(current) ? ordinaryGroupExclusionMessage() : '当前聊天类型尚未确认是一对一会话，已停止读取。', 'x'); return; }
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
    if (context.conversationId && context.conversationId !== String(current?.id || '')) return { ok: false, reason: 'WS 会话已切换。' };
    assertContext(context);
    if (state.aiBusy) return { ok: false, reason: 'AI 分析正在进行。' };
    if (!current || !state.messages.length) { toast('请先建立会话并导入可见聊天。', 'x'); return { ok: false, reason: '当前会话暂无可分析消息。' }; }
    if (!canManuallyProcessConversation(current)) {
      const reason = isExplicitGroupConversation(current) ? ordinaryGroupExclusionMessage('AI 分析、客户补档或跟进提醒') : '当前聊天类型尚未确认是一对一会话，已停止 AI 分析。';
      toast(reason, 'x');
      return { ok: false, reason, group: isExplicitGroupConversation(current), pending: !isExplicitGroupConversation(current) };
    }
    if (current.data?.historyLoaded === true && Number(current.data?.directionVersion || 0) < 4) {
      const reason = '旧历史消息的发送方向尚未校验，请等待完成方向 v4 重采后再分析。';
      toast(reason, 'x');
      return { ok: false, reason, pending: true };
    }
    if (!state.aiEnabled) { toast('当前会话的 AI 分析已关闭。', 'x'); return { ok: false, reason: 'AI 分析已关闭。', disabled: true }; }
    if (!window.zhikeAI?.request || !window.zhikeAI?.status) { toast('当前没有可用的 AI 服务，请先配置 GPT 运营助手。', 'x'); return { ok: false, reason: '当前没有可用的 AI 服务。' }; }
    if (isAutomaticVipGroupConversation(current)) {
      const memberScopes = vipGroupMemberAnalysisScopes(state.messages);
      if (!memberScopes.length) {
        const reason = 'VIP 群聊天已保留，但尚未读取到可信的发言人 WS ID 或手机号，暂不写入客户档案。';
        toast(reason, 'x');
        return { ok: false, pending: true, identityPending: true, reason };
      }
      state.aiBusy = true;
      state.error = '';
      state.aiBackgroundError = '';
      const pendingPump = cancelBackgroundAiPump();
      const controller = new AbortController();
      manualAiController = controller;
      render();
      try {
        await pendingPump.catch(() => {});
        const result = await analyzeStoredConversation(current, context, { signal: controller.signal });
        if (!result.ok) {
          if (!result.cancelled) toast(result.reason || 'VIP 群成员分析等待重试。', 'x');
          return result;
        }
        state.analysis = result.analysis || result.memberResults?.filter(item => item.ok).at(-1)?.analysis || {};
        state.analysisMeta = result.analysisMeta || result.memberResults?.filter(item => item.ok).at(-1)?.analysisMeta || null;
        seedDraftFromAnalysis();
        toast(`VIP 群分析完成：已按 ${result.analyzedMembers || memberScopes.length} 位可信发言人分开处理，未归属其他成员事实。`, 'check');
        return result;
      } finally {
        if (manualAiController === controller) manualAiController = null;
        if (contextCurrent(context)) {
          state.aiBusy = false;
          render();
          if (state.backgroundActive && state.aiEnabled) scheduleAiQueuePump({ ...context, conversationId: '' });
        }
      }
    }
    const chunks = core.splitHistoryTranscript(state.messages, { maxChars: 16000 });
    if (!chunks.length) { toast('聊天没有可分析的文本，媒体消息原记录已保留。', 'x'); return { ok: false, reason: '无可分析文本' }; }
    state.aiBusy = true;
    state.error = '';
    state.aiBackgroundError = '';
    const pendingPump = cancelBackgroundAiPump();
    const controller = new AbortController();
    manualAiController = controller;
    render();
    const sourceFingerprint = fullHistorySourceFingerprint(current);
    // Manually imported chats remain analyzable, but only a native transcript
    // with matching collected/latest fingerprints may claim full-history
    // coverage or participate in automatic background analysis.
    const directionVersion = transcriptDirectionVersion(current, sourceFingerprint);
    const transcript = {
      text: chunks.map(item => item.text).join('\n'),
      included: state.messages.length,
      total: state.messages.length,
      truncated: false,
      historyComplete: state.historyCoverage.complete === true && Boolean(sourceFingerprint),
      chunkCount: chunks.length,
      sourceFingerprint,
      ...(directionVersion ? { directionVersion } : {}),
    };
    let aiJob;
    try {
      await pendingPump.catch(() => {});
      throwIfAiCancelled(controller.signal);
      assertContext(context);
      aiJob = await beginAiJob(current, transcript, context, 'ws-analysis');
      throwIfAiCancelled(controller.signal);
      if (aiJob.pending) throw new Error('AI 分析任务已在后台运行，稍后将自动刷新。');
      if (aiJob.completed && aiJob.analysis) {
        state.analysis = aiJob.analysis.result || {};
        state.analysisMeta = aiJob.analysis;
      } else {
        const service = await window.zhikeAI.status().catch(() => ({ configured: false }));
        if (!service.configured) { await failAiJob(aiJob.job, context, '请先在 GPT 运营助手中配置 AI 服务。'); throw new Error('请先在 GPT 运营助手中配置 AI 服务。'); }
        state.analysis = await analyzeHistoryChunks(chunks, current, context, aiJob.job, { signal: controller.signal });
        throwIfAiCancelled(controller.signal);
        state.analysis.transcriptInfo = { ...transcript, text: undefined, analyzedChunks: chunks.length };
        const saved = await api('/api/ws/analyses', {
          method: 'POST',
          body: JSON.stringify({ conversationId: current.id, jobId: aiJob.job.id, result: state.analysis, confidence: state.analysis.confidence, providerName: state.analysis.providerName, model: state.analysis.model }),
        }, context);
        assertContext(context);
        state.analysisMeta = saved;
        await completeAiJob(aiJob.job, saved.id, context);
      }
      const crmResult = await syncAnalysisToCrm(current, state.analysis, state.analysisMeta, context);
      if (crmResult?.ok === false) throw new Error(crmResult.reason || 'AI 结果同步知客客户库失败。');
      assertContext(context);
      state.analysisRefreshPending.delete(String(current.id));
       if (state.collectionRun?.id) {
         try { await api('/api/ws/collection-items', { method: 'PATCH', body: JSON.stringify({ runId: state.collectionRun.id, conversationId: current.id, status: 'completed', analysisStatus: 'completed', coverageStatus: 'visible' }) }, context); }
         catch (error) { state.error = `采集进度保存失败：${String(error?.message || '本机接口异常').slice(0, 240)}`; }
       }
      seedDraftFromAnalysis();
      const conversation = state.conversations.find(item => String(item.id) === String(current.id));
      if (conversation) {
        conversation.intentLevel = state.analysis.intent || conversation.intentLevel;
        conversation.language = state.analysis.language || conversation.language;
        conversation.updatedAt = nowIso();
      }
      toast(state.analysis.lowConfidence ? `分析完成：低置信度结果已按只补空字段策略自动同步（最近 ${transcript.included} 条消息）` : `分析完成：已使用最近 ${transcript.included} 条消息`, 'check');
      return { ok: true, analysis: state.analysis, crm: crmResult };
    } catch (error) {
      if (isAiCancellation(error, controller.signal)) {
        if (aiJob?.job && !aiJob.completed) await failAiJob(aiJob.job, context, 'AI 分析已取消，任务保留待重试。');
        return { ok: false, reason: 'AI 分析已取消。', cancelled: true };
      }
      if (aiJob?.job && !aiJob.completed) await failAiJob(aiJob.job, context, error.message);
      if (contextCurrent(context)) {
        state.analysis = { summary: '', lowConfidence: true, confidence: 0, error: error.message, warning: 'AI 分析失败，已保留原始聊天；重试后仍按只补空字段策略处理。' };
        try { state.analysisMeta = await api('/api/ws/analyses', { method: 'POST', body: JSON.stringify({ conversationId: current.id, result: state.analysis, confidence: 0, errorMessage: error.message }) }, context); } catch {}
        toast(error.message, 'x');
      }
      return { ok: false, reason: String(error?.message || 'AI 分析失败') };
    } finally {
      if (manualAiController === controller) manualAiController = null;
      if (contextCurrent(context)) {
        state.aiBusy = false;
        render();
        if (state.backgroundActive && state.aiEnabled) scheduleAiQueuePump({ ...context, conversationId: '' });
      }
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
      void loadHotProfile({ ...context, conversationId: current.id }, false);
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
       if (state.collectionRun?.id) {
         try { await api('/api/ws/collection-items', { method: 'PATCH', body: JSON.stringify({ runId: state.collectionRun.id, conversationId: current.id, followupStatus: 'confirmed', nextFollowupAt: record.nextDate || '' }) }, context); }
         catch (error) { state.error = `跟进同步失败：${String(error?.message || '本机接口异常').slice(0, 240)}`; }
       }
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
    if (action === 'toggle-capture') { state.captureCollapsed = !state.captureCollapsed; writePanelCollapsed('capture', state.captureCollapsed); render(); return; }
    if (action === 'toggle-left') { state.leftCollapsed = !state.leftCollapsed; writePanelCollapsed('left', state.leftCollapsed); render(); return; }
    if (action === 'toggle-right') { state.rightCollapsed = !state.rightCollapsed; writePanelCollapsed('right', state.rightCollapsed); render(); return; }
    if (action === 'mobile-left' || action === 'mobile-center' || action === 'mobile-right') { state.mobilePanel = action.slice(7); render(); return; }
    if (action === 'new-conversation') { state.mobilePanel = 'left'; render(); requestAnimationFrame(() => $('#wsConversationExternalId')?.focus()); return; }
    if (action === 'next-conversations' || action === 'previous-conversations') {
      const delta = action === 'next-conversations' ? CONVERSATION_RENDER_BATCH : -CONVERSATION_RENDER_BATCH;
      state.conversationWindowStart = Math.max(0, state.conversationWindowStart + delta);
      const list = $('.ws-session-list');
      if (list) { list.innerHTML = renderConversationList(); list.scrollTop = 0; }
      return;
    }
    if (action === 'create-conversation') return createConversation();
    if (action === 'create-collection-run') return createCollectionRun();
    if (action === 'pause-collection') return updateCollectionRun('paused');
    if (action === 'resume-collection') return updateCollectionRun('running');
    if (action === 'stop-collection') return updateCollectionRun('stopped');
    if (action === 'resume-collection-checkpoint') return resumeCollectionFromCheckpoint();
    if (action === 'discover-conversations') return discoverConversations();
    if (action === 'collect-all-read') return collectAllReadConversations();
    if (action === 'capture-visible-messages') return captureVisibleMessages();
    if (action === 'open-followup-alert') { state.mobilePanel = 'center'; state.conversationSelectionManual = true; return loadConversationData(element.dataset.id); }
    if (action === 'done-followup-alert') return updateFollowupAlert(element, 'done');
    if (action === 'snooze-followup-alert') return updateFollowupAlert(element, 'snoozed');
    if (action === 'dismiss-followup-alert') return updateFollowupAlert(element, 'dismissed');
    if (action === 'refresh-hot-profile') return loadHotProfile();
    if (action === 'confirm-hot-profile') return saveHotProfileFact(element, false);
    if (action === 'lock-hot-profile') return saveHotProfileFact(element, element?.dataset?.locked !== 'true');
    if (action === 'save-hot-profile-color') return saveHotProfileColor();
    if (action === 'select-conversation') { state.mobilePanel = 'center'; state.conversationSelectionManual = true; return loadConversationData(element.dataset.id); }
    if (action === 'clear-capture') { currentDraft().captureText = ''; render(); return; }
    if (action === 'import-visible') return importVisible();
    if (action === 'translate-message') return translateMessage(element.dataset.id);
    if (action === 'retry-failed') return retryFailedTranslations();
    if (action === 'resume-ai-queue') { state.aiBackgroundError = ''; render(); return scheduleAiQueuePump(captureContext('')); }
    if (action === 'open-home' || action === 'open-tasks') {
      const route = action === 'open-home' ? 'home' : 'operations';
      document.querySelector(`.nav-item[data-view="${route}"]`)?.click();
      return;
    }
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
    if (target.matches('#wsAiEnabled')) {
      state.aiEnabled = target.checked;
      if (state.aiEnabled) {
        state.aiBackgroundError = '';
        scheduleAiQueuePump(captureContext(''));
      } else {
        state.aiBackgroundError = '';
        void cancelAllAiWork();
      }
    }
    if (target.matches('[data-hot-profile-color]')) { state.hotProfileColorDraft = target.value; return; }
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
      state.conversationWindowStart = 0;
      const list = $('.ws-session-list');
      if (list) list.innerHTML = renderConversationList();
      return;
    }
    if (target.matches('#wsConversationExternalId')) { state.createExternalId = target.value; return; }
    if (target.matches('#wsConversationTitle')) { state.createTitle = target.value; return; }
    if (target.matches('#wsAccountDisplayName')) { state.accountFormName = target.value; state.accountFormError = ''; return; }
    if (target.matches('[data-hot-profile-field]')) { state.hotProfileEdits[target.dataset.hotProfileField] = target.value; return; }
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
    const firstBackgroundStart = startBackgroundRuntime();
    state.active = true;
    host.state.view = 'ws-workbench';
    state.error = '';
    $('#crumbCurrent').textContent = 'WS 工作台';
    $$('.nav-item').forEach(item => item.classList.toggle('active', item.dataset.view === 'ws-workbench'));
    document.body.classList.add('ws-mode');
    render();
    if (!firstBackgroundStart) {
      // The account and native collector were intentionally kept alive while
      // another Zhike page was visible. Re-entering WS only remounts the UI;
      // it must not start another poller, queue pump or account load.
      queueResizeWsView();
      void refreshCollectionSummary();
      return;
    }
    const startGeneration = backgroundGeneration;
    if (backgroundStartPromise && backgroundStartGeneration === startGeneration) return;
    backgroundStartGeneration = startGeneration;
    backgroundStartPromise = (async () => {
      await loadAccounts();
      if (!state.backgroundActive || startGeneration !== backgroundGeneration) return;
      render();
      await wsBridge('open').catch(error => { if (state.backgroundActive && startGeneration === backgroundGeneration) state.error = error.message || 'WS 账号页面打开失败。'; });
      if (!state.backgroundActive || startGeneration !== backgroundGeneration) return;
      await syncVipGroupAllowlist(captureContext(''), true).catch(() => null);
      await loadConversations();
      if (!state.backgroundActive || startGeneration !== backgroundGeneration) return;
      const result = await wsBridge('status');
      if (!state.backgroundActive || startGeneration !== backgroundGeneration) return;
      updateAccountStatus(result);
      setStatus(result.status, result.detail || '');
      render();
      await refreshCollectionSummary();
    })().catch(error => {
      if (state.backgroundActive && startGeneration === backgroundGeneration) setStatus('连接失败', error.message);
    }).finally(() => {
      if (backgroundStartGeneration === startGeneration) {
        backgroundStartPromise = null;
        backgroundStartGeneration = 0;
      }
    });
  }
  function deactivate() {
    if (!state.active) return;
    state.active = false;
    browserResizeObserver?.disconnect?.();
    browserResizeObserver = undefined;
    document.body.classList.remove('ws-mode');
    wsBridge('hide').catch(() => {});
    if (backgroundAccountRefreshQueue.size) void requestAccountPipelineRefresh(backgroundAccountRefreshQueue.values().next().value);
  }
  async function exportWsData(accountId = '') { return api('/api/ws/export'+(accountId?'?accountId='+encodeURIComponent(accountId):''), { timeout: 30000 }); }
  async function importWsData(value, accountId = '') {
    if (!value || typeof value !== 'object') return { skipped: true };
    return api('/api/ws/import', { method: 'POST', timeout: 60000, body: JSON.stringify({...value,accountId:accountId||value.accountId||''}) });
  }
  window.__zhikeWsBackup = Object.freeze({ exportData: exportWsData, importData: importWsData });
  window.__zhikeWsFollowups = Object.freeze({
    // Native WebView2 ingestion publishes ws.message/sync.updated as soon as
    // a batch is committed to the local SQLite sidecar.  Keep the renderer
    // refresh entry point explicit so newly collected messages trigger the
    // same list-sync → AI analysis → CRM/follow-up refresh path immediately,
    // instead of waiting for the 12-second safety poll.
    refresh: accountId => requestAccountPipelineRefresh(accountId),
    load: async (limit = 8) => {
      const safeLimit = Math.min(30, Math.max(1, Number(limit) || 8));
      const result = await api(`/api/ws/followup-alerts?allAccounts=1&limit=${safeLimit}`);
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
    // Windowed rendering keeps the DOM bounded even after browsing an account
    // with tens of thousands of conversations. Reaching the rail end advances
    // to the next fixed-size window instead of rebuilding every prior row.
    view?.addEventListener('scroll', event => {
      const list = event.target;
      if (!(list instanceof Element) || !list.classList.contains('ws-session-list')) return;
      if (list.scrollHeight - list.scrollTop - list.clientHeight > 240) return;
      const query = state.conversationQuery.trim().toLocaleLowerCase();
      const matchCount = query
        ? state.conversations.reduce((count, item) => count + (`${item.title || ''} ${item.externalId || ''} ${item.lastMessageText || ''}`.toLocaleLowerCase().includes(query) ? 1 : 0), 0)
        : state.conversations.length;
      if (state.conversationWindowStart + CONVERSATION_RENDER_BATCH >= matchCount || conversationLoadFrame) return;
      conversationLoadFrame = requestAnimationFrame(() => {
        conversationLoadFrame = 0;
        if (!state.active || !list.isConnected) return;
        state.conversationWindowStart += CONVERSATION_RENDER_BATCH;
        list.innerHTML = renderConversationList();
        list.scrollTop = 0;
      });
    }, true);
    // WS BrowserView is docked to the workbench viewport; page scrolling is
    // disabled in ws-mode, so it must not chase nested scroll containers.
    window.zhikeDesktop?.onWsStatus?.(payload => {
      if (!payload) return;
      if (payload.restoreAccountId) {
        void cancelAllAiWork();
        ++state.accountLoadSequence;
        state.pendingRestoreAccountId = String(payload.restoreAccountId);
        state.activeAccountId = String(payload.restoreAccountId);
        writeStoredAccountId(state.activeAccountId);
        state.accountBusy = false;
        state.busy.import = false; state.busy.customer = false; state.busy.followup = false; state.busy.connection = false; state.busy.reply = false; state.busy.capture = false; state.busy.readHistory = false; state.aiBusy = false; state.translationBusy.clear();
        state.currentConversationId = '';
        state.conversationSelectionManual = false;
        state.conversationWindowStart = 0;
        state.conversations = [];
        state.analysisRefreshPending.clear();
        updateAccountStatus({ ...payload, accountId: state.activeAccountId, status: payload.status || '连接失败' });
        // The restore event can arrive before the first account-list response.
        // Always reload the list so the pending account is resolved instead of
        // leaving the sidebar empty until a manual refresh.
        void loadAccounts();
        render();
        return;
      }
      updateAccountStatus(payload);
      const payloadAccountId = text(payload.accountId);
      if (payloadAccountId && payloadAccountId !== String(state.activeAccountId || 'default')) {
        if (state.backgroundActive && (payload.status === '已连接' || payload.eventName || payload.accepted != null || payload.queuedForRetry)) void requestAccountPipelineRefresh(payloadAccountId);
        return;
      }
      if (payload.eventName === 'collection-complete' || payload.coverage === 'read-history-complete') state.readHistoryAutoStarted = false;
      setStatus(payload.status || '未连接', payload.detail || '');
      if (state.backgroundActive && payload.status === '已连接') {
        if (payload.accepted != null || payload.queuedForRetry) state.wsDetail = payload.detail || state.wsDetail;
        void refreshCollectionSummary();
      }
    });
    window.addEventListener('resize', () => { if (state.active) queueResizeWsView(); });
    window.addEventListener('beforeunload', () => { stopBackgroundRuntime(); });
    window.addEventListener('offline', () => setStatus('连接失败', '网络已断开；知客本地客户功能仍可使用。'));
    window.addEventListener('online', () => {
      if (!state.backgroundActive) return;
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
