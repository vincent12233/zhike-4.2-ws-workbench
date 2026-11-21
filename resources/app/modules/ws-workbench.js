(() => {
  const core = window.ZhikeWsCore;
  const businessPages = window.ZhikeWsBusinessPages;
  const hotProfileCore = window.ZhikeHotChatProfile || {};
  const getHost = () => window.__zhikeRegistryHost;
  const readPanelCollapsed = panel => {
    try {
      const saved = localStorage.getItem(`zhike.ws.${panel}.collapsed`);
      return saved == null ? panel === 'capture' : saved === 'true';
    } catch { return panel === 'capture'; }
  };
  const writePanelCollapsed = (panel, value) => {
    try { localStorage.setItem(`zhike.ws.${panel}.collapsed`, String(Boolean(value))); } catch {}
  };
  const ASSIST_DRAWER_TABS = new Set(['ai', 'profile', 'reply', 'broadcast', 'export', 'diagnostics']);
  // Missing mode is the only legacy ordinary default. Explicit unknown modes
  // never gain a workspace or an executable account selection.
  function normalizeWorkspaceMode(value) { return value === undefined ? 'ordinary' : value === 'ordinary' || value === 'dedicated' ? value : null; }
  function accountWorkspaceMode(account) { return normalizeWorkspaceMode(account?.workspaceMode); }
  function workspaceLabel(mode = state.workspaceMode) { return mode === 'dedicated' ? '专用 WS' : '普通 WS'; }
  const WS_MODE_VIEW_IDS = Object.freeze({
    ordinary: new Set(['overview', 'accounts', 'chat', 'collection', 'ai', 'crm', 'tasks', 'logs', 'settings']),
    dedicated: new Set(['overview', 'accounts', 'chat', 'groups', 'group-channels', 'members', 'contacts', 'exclusions', 'collection', 'crm', 'logs', 'settings', 'group-broadcast', 'group-mentions', 'group-reading', 'group-permissions']),
  });
  const WS_BLOCKED_VIEWS = new Set(['group-mentions']);
  function workspaceViewAllowed(view, mode = state.workspaceMode) { return Boolean(WS_MODE_VIEW_IDS[mode]?.has(view)); }
  function workspaceViews(mode = state.workspaceMode) { return WS_WORKSPACE_VIEW_META.filter(item => workspaceViewAllowed(item.id, mode)).map(item => item.id === 'chat' && mode === 'dedicated' ? { ...item, label: '专用登录', hint: '独立专用账号扫码与原生会话' } : item); }
  function modeAccount(accountId, mode = state.workspaceMode) { return state.accounts.find(item => String(item.id) === String(accountId) && accountWorkspaceMode(item) === mode); }
  const WS_WORKSPACE_VIEW_META = Object.freeze([
    { id: 'overview', label: '工作台首页', icon: 'home', hint: '账号、采集与工作入口' },
    { id: 'accounts', label: '账号管理', icon: 'phone', hint: '多账号与连接状态' },
    { id: 'chat', label: '前台聊天', icon: 'chat-stack', hint: '原生 WS 聊天与客户档案' },
    { id: 'groups', label: '群组管理', icon: 'layers', hint: '群组目录与监测端口' },
    { id: 'group-channels', label: '群组渠道配置', icon: 'filter', hint: '群组编号、渠道、助理与批量导入' },
    { id: 'members', label: '群成员管理', icon: 'users-group', hint: '成员事件与 CRM 关系' },
    { id: 'collection', label: '数据采集', icon: 'database', hint: '采集任务、断点与跳过规则' },
    { id: 'contacts', label: '通讯录管理', icon: 'user', hint: '已同步联系人与号码核验' },
    { id: 'exclusions', label: '通讯录排除', icon: 'shield', hint: '排除名单不进入自动建档' },
    { id: 'ai', label: 'AI助手', icon: 'spark', hint: '队列、证据与分析结果' },
    { id: 'crm', label: 'CRM客户', icon: 'user', hint: '客户主档匹配与冲突' },
    { id: 'tasks', label: '任务中心', icon: 'clipboard-check', hint: '跟进任务与提醒' },
    { id: 'logs', label: '操作日志', icon: 'history', hint: '审计记录、运行快照与关联查询' },
    { id: 'group-broadcast', label: '群组发送', icon: 'message', hint: '草稿与目标预览 · 实际发送 BLOCKED' },
    { id: 'group-mentions', label: '群组 @ 提及', icon: 'users-group', hint: '能力说明 · 原生及隐藏提及 BLOCKED' },
    { id: 'group-reading', label: '群组已读', icon: 'clipboard-check', hint: '本地历史查询 · 真实回执采集 BLOCKED' },
    { id: 'group-permissions', label: '群组开关', icon: 'shield', hint: '本地权限清单 · 实际权限变更 BLOCKED' },
    { id: 'settings', label: '工具与设置', icon: 'settings', hint: '翻译、导入、导出与安全开关' },
  ]);
  const WS_WORKSPACE_VIEW_IDS = new Set(WS_WORKSPACE_VIEW_META.map(item => item.id));
  function readWsWorkspaceView(mode = 'ordinary') {
    try {
      const value = localStorage.getItem('zhike.ws.workspace-view.' + mode)
        ?? (mode === 'ordinary' ? localStorage.getItem('zhike.ws.workspace-view') : null);
      return workspaceViewAllowed(value, mode) ? value : 'overview';
    } catch { return 'overview'; }
  }
  function readWsWorkspaceCollapsed() {
    try {
      const saved = localStorage.getItem('zhike.ws.workspace-nav-collapsed');
      return saved == null ? false : saved === 'true';
    } catch { return false; }
  }
  function writeWsWorkspaceState(view, collapsed) {
    try {
      const normalized = workspaceViewAllowed(view) ? view : 'overview';
      localStorage.setItem('zhike.ws.workspace-view.' + state.workspaceMode, normalized);
      localStorage.setItem('zhike.ws.workspace-nav-collapsed', String(Boolean(collapsed)));
    } catch {}
  }
  function wsWorkspacePageState(view = state?.wsWorkspaceView, accountId = state?.activeAccountId) {
    const key = `${text(accountId || 'default')}:${WS_WORKSPACE_VIEW_IDS.has(view) ? view : 'overview'}`;
    if (!state.wsWorkspacePageState[key]) state.wsWorkspacePageState[key] = { scrollTop: 0, filter: '', statusFilter: 'all', page: 1, busy: false, status: '尚未刷新', error: '' };
    return state.wsWorkspacePageState[key];
  }
  function clampAssistDrawerWidth(value) {
    const numeric = Number(value);
    return Math.min(620, Math.max(360, Number.isFinite(numeric) ? Math.round(numeric) : 460));
  }
  function assistDrawerColumnWidth(layout = $('.ws-layout')) {
    const desired = clampAssistDrawerWidth(state?.assistDrawerWidth ?? 460);
    const viewportWidth = Number(window.innerWidth || 0);
    if (viewportWidth > 0 && viewportWidth <= 900) return desired;
    const layoutWidth = Number(layout?.getBoundingClientRect?.().width || layout?.clientWidth || viewportWidth || 1280);
    const leftWidth = state?.wsWorkspaceView === 'chat' ? 0 : state?.leftCollapsed ? 48 : (viewportWidth > 0 && viewportWidth <= 1060 ? 180 : viewportWidth <= 1320 ? 204 : 232);
    const centerMin = viewportWidth > 0 && viewportWidth <= 1060 ? 300 : 360;
    const available = Math.floor(layoutWidth - leftWidth - centerMin - 16);
    return Math.max(250, Math.min(desired, available > 0 ? available : desired));
  }
  function normalizeAssistDrawerOffset(value) {
    const candidate = value && typeof value === 'object' ? value : {};
    const y = Number(candidate.y);
    const viewportHeight = Number(window.innerHeight || 900);
    // The drawer fills its page column. Keep the persisted nudge deliberately
    // small so its header and close button cannot be dragged off-screen.
    const maxY = Math.min(64, Math.max(0, viewportHeight - 180));
    return {
      // Horizontal movement is intentionally disabled. The drawer must stay
      // inside the right page column and never overlap the native WS surface.
      x: 0,
      y: Number.isFinite(y) ? Math.max(-maxY, Math.min(maxY, Math.round(y))) : 0,
    };
  }
  function readAssistDrawerState(key) {
    const defaults = { open: Number(window.innerWidth || 1440) >= 1200 && !readPanelCollapsed('right'), tab: 'profile', width: 360, offset: { x: 0, y: 0 } };
    try {
      const raw = localStorage.getItem(`zhike.ws.assist-drawer.${key}`);
      if (raw == null) return defaults[key];
      if (key === 'open') return raw === 'true';
      if (key === 'tab') return ASSIST_DRAWER_TABS.has(raw) ? raw : defaults.tab;
      if (key === 'width') return clampAssistDrawerWidth(raw);
      if (key === 'offset') return normalizeAssistDrawerOffset(JSON.parse(raw));
    } catch {}
    return defaults[key];
  }
  function writeAssistDrawerState(key, value) {
    try {
      const normalized = key === 'width'
        ? clampAssistDrawerWidth(value)
        : key === 'tab'
          ? (ASSIST_DRAWER_TABS.has(String(value)) ? String(value) : 'ai')
          : key === 'offset'
            ? normalizeAssistDrawerOffset(value)
            : Boolean(value);
      localStorage.setItem(`zhike.ws.assist-drawer.${key}`, key === 'offset' ? JSON.stringify(normalized) : String(normalized));
    } catch {}
  }
  const esc = value => getHost()?.esc?.(value) || String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const nowIso = () => new Date().toISOString();
  const text = value => String(value == null ? '' : value).trim();
  const COLLECTION_CAPABILITY_BLOCKED = 'COLLECTION_CAPABILITY_BLOCKED';
  const BLOCKED_COLLECTION_CAPABILITY = Object.freeze({ state: 'blocked', code: COLLECTION_CAPABILITY_BLOCKED, reason: '当前桌面未提供独立采集会话；前台聊天和手动导入可用。', backgroundCollection: false, automaticHistory: false, groupMonitoring: false, automaticAi: false, foregroundFallback: false, manualVisibleImport: true, collectorState: 'not-started' });
  const COLLECTOR_STATES = new Set(['not-started', 'awaiting-login', 'login-visible', 'running', 'paused', 'error']);
  const COLLECTOR_ACTION_FEATURES = Object.freeze({ 'discover-conversations': 'backgroundCollection', 'collect-all-read': 'automaticHistory', 'configure-group-monitor': 'groupMonitoring', 'start-group-monitor': 'groupMonitoring', 'configure-ws-groups': 'backgroundCollection' });
  const COLLECTOR_SESSION_ACTIONS = new Set(['open-collector', 'hide-collector', 'pause-collector', 'resume-collector']);
  function normalizeCollectionCapability(native) {
    if (native?.state === 'available' && native.code === 'COLLECTION_INDEPENDENT_SESSION'
        && native.provider === 'native-independent-session' && native.protocolVersion === 1
        && native.backgroundCollection === true && native.automaticHistory === true && native.groupMonitoring === true
        && native.automaticAi === false && native.foregroundFallback === false && native.manualVisibleImport === true
        && COLLECTOR_STATES.has(native.collectorState)) {
      return { state: 'available', code: native.code, provider: native.provider, protocolVersion: 1,
        backgroundCollection: true, automaticHistory: true, groupMonitoring: true, automaticAi: false,
        foregroundFallback: false, manualVisibleImport: true, collectorState: native.collectorState,
        collectorLoginStatus: text(native.collectorLoginStatus), collectorDetail: text(native.collectorDetail).slice(0, 500),
        reason: core.collectorStatusMessage(native) };
    }
    return { ...BLOCKED_COLLECTION_CAPABILITY, reason: native?.state === 'blocked' && native?.code === COLLECTION_CAPABILITY_BLOCKED ? text(native.reason).slice(0, 500) || BLOCKED_COLLECTION_CAPABILITY.reason : BLOCKED_COLLECTION_CAPABILITY.reason };
  }
  function collectionCapability(accountId = state.activeAccountId) {
    const native = state.accounts.find(account => String(account.id) === String(accountId))?.collectionCapability;
    return normalizeCollectionCapability(native);
  }
  function collectionReady(feature = 'backgroundCollection', accountId = state.activeAccountId) {
    const capability = collectionCapability(accountId);
    return capability.state === 'available' && capability[feature] === true && capability.collectorState === 'running';
  }
  function rememberCollectionCapability(payload, accountId = payload?.accountId) {
    if (!payload?.collectionCapability || !accountId || String(payload.accountId || '') !== String(accountId)) return false;
    const capability = normalizeCollectionCapability(payload.collectionCapability);
    const previous = state.accounts.find(account => String(account.id) === String(accountId))?.collectionCapability;
    if (JSON.stringify(previous) === JSON.stringify(capability)) return false;
    state.accounts = state.accounts.map(account => String(account.id) === String(accountId) ? { ...account, collectionCapability: capability } : account);
    if (String(accountId) === String(state.activeAccountId)) {
      if (capability.collectorState !== 'running' && state.groupMonitor?.accountId === String(accountId)) {
        state.groupMonitor.discovery = null;
        state.groupMonitor.liveObservations?.clear();
      }
      if (previous?.collectorState !== capability.collectorState || capability.collectorState !== 'running') state.readHistoryAutoStarted = false;
      state.wsGroupConfigSignatures.delete(String(accountId));
      groupMonitorNativeSignature = '';
      restartBackgroundPolling();
      updateStatusDom();
    }
    return true;
  }
  function collectionBlockedResult(accountId = state.activeAccountId) {
    const capability = collectionCapability(accountId);
    const code = capability.state === 'available' ? 'COLLECTOR_NOT_READY' : COLLECTION_CAPABILITY_BLOCKED;
    const reason = capability.reason;
    return { blocked: true, supported: false, started: false, retryable: false, code, error: `${code}：${reason}`, collectionCapability: capability };
  }
  function rejectCollectionAction(context = captureContext('')) {
    const result = collectionBlockedResult(context.accountId);
    if (!contextCurrent(context)) return result;
    state.error = result.error;toast(result.error, 'x');render();return result;
  }
  function collectionCapabilityNotice(accountId = state.activeAccountId) {
    const capability = collectionCapability(accountId);
    if (capability.state === 'available') return `<p class="ws-coverage-warning" role="status" data-collection-capability="available">${esc(core.collectorStatusMessage(capability))}</p>`;
    const result = collectionBlockedResult(accountId);
    return `<p class="ws-coverage-warning" role="status" data-collection-capability="blocked">${esc(result.error)}</p>`;
  }
  function collectionControlAttributes(feature = 'backgroundCollection') {
    return collectionReady(feature) ? '' : `disabled aria-disabled="true" title="${esc(collectionBlockedResult().error)}"`;
  }
  function collectorStatusLabel(capability = collectionCapability()) {
    if (capability.state !== 'available') return '后台采集不可用';
    if (['awaiting-login', 'login-visible'].includes(capability.collectorState) && capability.collectorLoginStatus === '等待登录') return '采集会话等待扫码';
    return ({ 'not-started': '采集会话未启动', 'awaiting-login': '正在检查采集会话', 'login-visible': '正在显示采集窗口', running: '独立采集会话已就绪', paused: '后台采集已暂停', error: '采集会话异常' })[capability.collectorState];
  }
  function renderAiStatus() {
    const statusCore = typeof window !== 'undefined' ? window.ZhikeWsAiStatus : null;
    if (!statusCore?.renderAiStatusStrip) return '';
    const account = activeAccount();
    return statusCore.renderAiStatusStrip({
      accountId: account?.title || account?.name || state.activeAccountId,
      wsStatus: state.wsStatus,
      collectorLabel: collectorStatusLabel(),
      collectionRun: state.collectionRun,
      aiQueueStats: state.aiQueueStats,
      aiBackgroundError: state.aiBackgroundError,
    });
  }

  function renderOpsConsole() {
    const consoleCore = typeof window !== 'undefined' ? window.ZhikeWsOpsConsole : null;
    if (!consoleCore?.renderOpsConsole) return '';
    const monitor = state.groupMonitor || {};
    const health = monitor.health || {};
    const metrics = Array.isArray(state.accountMetrics?.accounts) ? state.accountMetrics.accounts : [];
    const connectedCount = metrics.filter(row => row && row.lastKnownStatus === '已连接').length;
    const targets = (monitor.profile?.targets || []).filter(item => item && item.enabled).length;
    return consoleCore.renderOpsConsole({
      mode: state.workspaceMode,
      accountCount: Array.isArray(state.accounts) ? state.accounts.length : null,
      connectedCount,
      wsStatus: state.wsStatus,
      collectorLabel: collectorStatusLabel(),
      targetCount: health.targetCount ?? targets,
      lastObservedAt: monitor.profile?.lastObservedAt || '',
      collectedAt: state.collectionRun?.updatedAt || state.collectionRun?.createdAt || '',
      eventCounts: health.eventCounts || {},
    });
  }

  function renderCollectorControls() {
    const capability = collectionCapability();
    if (capability.state !== 'available') return '';
    const busy = state.busy?.collector || state.busy?.connection ? 'disabled aria-disabled="true"' : '';
    const running = capability.collectorState === 'running';
    const open = `<button type="button" class="btn small" data-ws-action="open-collector" ${busy}>${running ? '暂停并查看采集会话' : '打开独立采集登录'}</button>`;
    const visible = state.collectorLoginVisible || capability.collectorState === 'login-visible';
    const saved = state.accountMetrics?.accounts?.some(row => row.accountId === state.activeAccountId && row.workspaceMode === state.workspaceMode && row.collectorSavedSession === 'confirmed');
    const canResume = visible || ['paused', 'awaiting-login'].includes(capability.collectorState) || (saved && capability.collectorState === 'not-started');
    const resume = `<button type="button" class="btn small primary" data-ws-action="resume-collector" ${busy}>${visible ? '已完成扫码，开始采集' : capability.collectorState === 'not-started' ? '恢复已配对的采集会话' : '继续后台采集'}</button>`;
    const back = `<button type="button" class="btn small" data-ws-action="hide-collector" ${busy}>返回前台聊天</button>`;
    return `<div class="ws-runtime-actions" data-collector-controls>${visible ? '' : open}${running ? `<button type="button" class="btn small" data-ws-action="pause-collector" ${busy}>暂停后台采集</button>` : canResume ? resume : ''}${visible || capability.collectorState === 'awaiting-login' ? back : ''}</div>`;
  }
  async function collectorAction(action) {
    if (!COLLECTOR_SESSION_ACTIONS.has(action) || state.busy.collector || state.busy.connection) return;
    const context = captureContext('');
    if (collectionCapability(context.accountId).state !== 'available') return rejectCollectionAction(context);
    const operation = state.collectorActionSequence = Number(state.collectorActionSequence || 0) + 1;
    state.busy.collector = true;
    try {
      if (action === 'open-collector' || action === 'hide-collector') {
        state.wsWorkspaceView = 'chat';
        state.mobilePanel = 'center';
        writeWsWorkspaceState('chat', state.wsWorkspaceNavCollapsed);
        state.active = true;
        render({ skipNativeResize: true });
      }
      if (action === 'open-collector' || action === 'resume-collector') startBackgroundRuntime();
      const result = await wsBridge(action, context);
      assertContext(context);
      if (result?.ok === false || result?.error) throw new Error(result.error || '采集会话操作失败。');
      if (typeof result?.loginVisible === 'boolean') state.collectorLoginVisible = result.loginVisible;
      state.error = '';
      if (action === 'hide-collector') state.wsWorkspaceView = 'chat';
      if (action === 'resume-collector' && !collectionReady('backgroundCollection', context.accountId)) {
        toast(text(result?.detail) || '正在检查独立采集会话。如需扫码，请点“打开独立采集登录”。', 'info');
      }
      if (collectionReady('backgroundCollection', context.accountId)) void refreshCollectionSummary({ background: true });
      return result;
    } catch (error) {
      if (contextCurrent(context)) { state.error = error.message || '采集会话操作失败。'; toast(state.error, 'x'); }
    } finally {
      if (operation === state.collectorActionSequence) { state.busy.collector = false; render({ skipNativeResize: true }); }
    }
  }
  function createGroupMonitorState(accountId = 'default') {
    return { accountId: String(accountId || 'default'), profile: null, health: null, events: [], loading: false, busy: false, error: '', statusFilter: 'all', draftJid: '', draftName: '', lastLoadedAt: '', catalog: [], liveObservations: new Map() };
  }
  const CONVERSATION_RENDER_BATCH = 120;
  const VERIFIED_NATIVE_DIRECTION_SOURCE_MAP = new Map([
    ['class-message-out', 'send'], ['class-message-in', 'receive'],
    ['data-id-outgoing', 'send'], ['data-id-incoming', 'receive'],
    ['icon-tail-out', 'send'], ['icon-tail-in', 'receive'],
    ['palette-outgoing', 'send'], ['palette-incoming', 'receive'],
    ['geometry-align-outgoing', 'send'], ['geometry-align-incoming', 'receive'],
    ['geometry-right', 'send'], ['geometry-left', 'receive'],
  ]);
  const state = {
    active: false,
    // `active` only describes whether the WS route is currently visible.
    // Once the user has opened WS successfully, `backgroundActive` keeps the
    // account-scoped collection/AI pipeline alive while another Zhike page is
    // displayed or the desktop window is minimised.
    backgroundActive: false,
    accounts: [],
    accountMetrics: null,
    workspaceMode: 'ordinary',
    workspaceGeneration: 0,
    activeAccountId: '',
    accountBusy: false,
    accountFormOpen: false,
    accountFormName: '',
    accountFormId: '',
    accountFormError: '',
    accountLoadSequence: 0,
    accountPresentationGeneration: 0,
    connectionAttemptGeneration: 0,
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
    aiAuthorization: null,
    aiAuthorizationOperation: 0,
    aiAuthorizationBusy: false,
    wsStatus: '未连接',
    wsDetail: '',
    collectorLoginVisible: false,
    wsErrorCategory: '',
    analysis: null,
    analysisMeta: null,
    archive: null,
    archiveError: '',
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
    messageCollapsed: readPanelCollapsed('messages'),
    // The manual import and local transcript are useful while reviewing a
    // conversation, but they should not permanently consume the WS viewport.
    // Keep their individual collapsed states and add a persisted master
    // switch so the operator can hand the whole lower band back to WhatsApp.
    localPanelsCollapsed: readPanelCollapsed('local-panels'),
    manualToolsVisible: false,
    assistDrawerOpen: readAssistDrawerState('open'),
    assistDrawerTab: readAssistDrawerState('tab'),
    assistDrawerWidth: readAssistDrawerState('width'),
    assistDrawerOffset: readAssistDrawerState('offset'),
    loginLayoutExpanded: false,
    mobilePanel: 'center',
    // The WS route owns this secondary navigation. It is deliberately
    // separate from the application's main sidebar and never controls the
    // WebView/Worker lifecycle.
    wsWorkspaceView: readWsWorkspaceView(),
    wsWorkspaceNavCollapsed: readWsWorkspaceCollapsed(),
    wsWorkspacePageState: Object.create(null),
    captureDirection: 'receive',
    conversationQuery: '',
    conversationWindowStart: 0,
    translationStatus: '翻译服务未检测',
    // 群发始终先生成可审计的发送计划。只有当前台 WS 会话与队列目标
    // 一致时才允许 native bridge 发送，避免后台采集或误切会话造成串发。
    broadcast: {
      selectedIds: new Set(),
      originalText: '',
      translatedText: '',
      targetLanguage: '',
      caption: '',
      attachments: [],
      uploading: false,
      plan: null,
      loading: false,
      error: '',
      lastBatchId: '',
    },
    export: { running: false, includeMedia: true, error: '', lastFileName: '' },
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
    summaryLoaded: { collection: false, followups: false, ai: false },
    discoveredConversations: [],
    // Keep the raw group rows from the logged-in WS list separate from the
    // customer/AI inventory. Ordinary groups remain excluded from collection,
    // but the operator must be able to select one to explicitly bind it for
    // group monitoring without first knowing its internal JID.
    discoveredGroupConversations: [],
    // Account-scoped catalog returned by the native collector. This is kept
    // separate from the rendered conversation list so a virtualized/hidden
    // group can still be selected for monitoring.
    groupCatalog: [],
    groupMembers: { accountId: '', rows: [], enabled: null, error: '' },
    visibleConversationFingerprint: '',
    collectionRefreshing: false,
    collectionRefreshQueued: false,
    previewAnalysisSignatures: new Map(),
    analysisRefreshPending: new Set(),
    listSyncBusy: false,
    listSyncOperation: 0,
    aiQueueStats: { queued: 0, running: 0, retryable: 0, completed: 0, failed: 0, deadLetter: 0, retryCount: 0, total: 0 },
    aiBackgroundError: '',
    aiRetryScope: null,
    wsGroupConfigSignatures: new Map(),
    groupMonitor: createGroupMonitorState(),
  };
  let rendering = false;
  let observer;
  let browserResizeObserver;
  let browserResizeObservedHost;
  let settingsSaveTimer;
  let settingsSaveSequence = 0;
  let collectionRefreshTimer;
  let groupMonitorRefreshTimer;
  let groupMonitorNativeSignature = '';
  let backgroundStartPromise = null;
  let backgroundGeneration = 0;
  let backgroundStartGeneration = 0;
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
  let lastResizeGeometry = null;
  let conversationLoadFrame = 0;
  const backgroundAccountRefreshQueue = new Set();
  let backgroundAccountRefreshPromise = null;
  let assistDrawerResize = null;
  let assistDrawerMove = null;
  let assistPointerListenersBound = false;
  let bootRetryTimer = null;
  let bootInitialized = false;
  const assistPointerMoveHandler = event => { handleAssistDrawerResizeMove(event); handleAssistDrawerMove(event); };
  const assistPointerUpHandler = event => { handleAssistDrawerResizeEnd(event); handleAssistDrawerMoveEnd(event); };
  const assistPointerCancelHandler = event => { handleAssistDrawerResizeEnd(event); handleAssistDrawerMoveEnd(event); };
  function bindAssistPointerListeners() {
    if (assistPointerListenersBound) return;
    assistPointerListenersBound = true;
    document.addEventListener('pointermove', assistPointerMoveHandler, { passive: false });
    document.addEventListener('pointerup', assistPointerUpHandler, { passive: true });
    document.addEventListener('pointercancel', assistPointerCancelHandler, { passive: true });
  }
  function unbindAssistPointerListeners() {
    if (!assistPointerListenersBound || assistDrawerResize || assistDrawerMove) return;
    assistPointerListenersBound = false;
    document.removeEventListener('pointermove', assistPointerMoveHandler);
    document.removeEventListener('pointerup', assistPointerUpHandler);
    document.removeEventListener('pointercancel', assistPointerCancelHandler);
  }
  let assistDrawerReturnFocus = null;

  function restartBackgroundPolling() {
    clearInterval(collectionRefreshTimer);
    collectionRefreshTimer = undefined;
    clearInterval(groupMonitorRefreshTimer);
    groupMonitorRefreshTimer = undefined;
    // The desktop WebView2 overlay can make the parent document report
    // `hidden` while the WS view is still visible and logged in.  Gating the
    // collection poll on document.hidden therefore stopped list-level
    // collection entirely in the native shell. Collection and the durable AI
    // queue remain active after the user leaves the WS route. Current-chat DOM
    // capture is a visible-page fallback only and must not run in the
    // background (the native collector owns full-history capture there). The
    // visible WebView has no persistent capture script and is never polled
    // for message DOM while the operator is chatting.
    if (!state.backgroundActive || !collectionReady('backgroundCollection')) return;
    if (state.workspaceMode === 'dedicated') void scanGroupMonitorTargets({ automatic: true });
    else if (state.workspaceMode === 'ordinary') void readOrdinaryCollectorDirectory(captureContext(''), true);
    // Keep one background scheduler for both the collection pipeline and the
    // fixed group seat. Two independent intervals race on account switches
    // and make the runtime contract report duplicate hidden refresh timers.
    collectionRefreshTimer = setInterval(() => {
      if (!state.backgroundActive) return;
      if (state.workspaceMode === 'ordinary') void refreshCollectionSummary({ background: true });
      if (state.workspaceMode === 'dedicated') void scanGroupMonitorTargets({ automatic: true });
      if (state.groupMonitor?.profile?.enabled || (state.workspaceMode === 'dedicated' && ['groups', 'collection'].includes(state.wsWorkspaceView))) {
        void loadGroupMonitor({ background: true, silent: true });
      }
    }, 12000);
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
  function accountStorageKey(mode = state.workspaceMode) { return 'zhike.ws.activeAccountId.' + mode; }
  function readStoredAccountId(mode = state.workspaceMode) {
    try { return text(localStorage.getItem(accountStorageKey(mode)) ?? (mode === 'ordinary' ? localStorage.getItem('zhike.ws.activeAccountId') : '')); } catch { return ''; }
  }
  function writeStoredAccountId(id) { try { localStorage.setItem(accountStorageKey(), String(id || '')); } catch {} }
  function captureContext(conversationId = state.currentConversationId) {
    return { accountId: String(state.activeAccountId || ''), conversationId: String(conversationId || ''), sequence: Number(state.accountLoadSequence || 0) };
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
    if (!state.backgroundActive && !collectionRefreshTimer && !groupMonitorRefreshTimer) return;
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
    state.listSyncOperation = Number(state.listSyncOperation || 0) + 1;
    state.readHistoryAutoStarted = false;
    state.busy.import = false;
    state.busy.customer = false;
    state.busy.followup = false;
    state.busy.reply = false;
    state.busy.capture = false;
    state.busy.connection = false;
    state.busy.readHistory = false;
    state.collectorActionSequence = Number(state.collectorActionSequence || 0) + 1;
    state.busy.collector = false;
    state.translationBusy.clear();
    clearInterval(collectionRefreshTimer);
    collectionRefreshTimer = undefined;
    clearInterval(groupMonitorRefreshTimer);
    groupMonitorRefreshTimer = undefined;
    groupMonitorNativeSignature = '';
    state.groupMonitor.loading = false;
    state.groupMonitor.busy = false;
  }
  async function loadAccounts() {
    const sequence = ++state.accountLoadSequence;
    const workspaceMode = state.workspaceMode;
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
        if (!response.accounts.length && workspaceMode === 'ordinary') throw new Error('WS 账号列表为空，正在重试。');
        return response;
      }, { attempts: 6, delayMs: attempt => Math.min(1200, 100 * (2 ** attempt)) });
      if (sequence !== state.accountLoadSequence || workspaceMode !== state.workspaceMode) return;
      const loadedAccounts = result.accounts.filter(account => accountWorkspaceMode(account) === workspaceMode);
      state.accounts = loadedAccounts;
      state.accountMetrics = result.accountMetrics || null;
      const preferred = state.pendingRestoreAccountId || readStoredAccountId();
      const selected = loadedAccounts.find(item => String(item.id) === preferred)
        || loadedAccounts.find(item => String(item.id) === state.activeAccountId)
        || loadedAccounts.find(item => String(item.id) === 'default') || loadedAccounts[0];
      const selectedId = selected ? String(selected.id) : '';
      if (selectedId !== state.activeAccountId) resetAccountPresentation(selectedId);
      state.pendingRestoreAccountId = '';
      writeStoredAccountId(state.activeAccountId);
      const active = activeAccount();
      if (active) {
        try {
          const status = await window.zhikeDesktop.ws({ action: 'status', accountId: active.id });
          if (sequence === state.accountLoadSequence && workspaceMode === state.workspaceMode) updateAccountStatus(status);
          if (result.accountMetrics && sequence === state.accountLoadSequence && workspaceMode === state.workspaceMode) {
            // Read the completed probe observation without creating or probing
            // any additional account WebView.
            const refreshed = await window.zhikeDesktop.wsAccounts({ action: 'list' });
            if (sequence === state.accountLoadSequence && workspaceMode === state.workspaceMode) state.accountMetrics = refreshed?.accountMetrics || null;
          }
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
    if (trackLiveCollector(payload) === false) return;
    if (id === state.activeAccountId && payload.collectorOnly === true && typeof payload.loginVisible === 'boolean') state.collectorLoginVisible = payload.loginVisible;
    const capabilityChanged = rememberCollectionCapability(payload, id);
    if (!capabilityChanged && id === state.activeAccountId && state.backgroundActive && state.workspaceMode === 'dedicated'
        && collectionReady('groupMonitoring', id) && !state.groupMonitor?.discovery) restartBackgroundPolling();
    // Native heartbeats are emitted by both the visible read-only probe and
    // the isolated collector. They carry telemetry only; rebuilding the
    // entire WS shell for every tick detaches the browser anchor long enough
    // to make the live WhatsApp surface visibly shake.
    const isBackgroundTick = payload?.eventName === 'background-tick' || payload?.background === true;
    const current = state.accounts.find(item => String(item.id) === id);
    const nextStatus = payload.status || current?.status;
    const nextDetail = payload.collectorOnly === true ? current?.statusDetail : payload.detail || current?.statusDetail;
    const isTelemetryTick = payload?.eventName === 'background-tick' && !text(payload?.detail);
    const statusChanged = Boolean(current && current.status !== nextStatus);
    const detailChanged = Boolean(current && current.statusDetail !== nextDetail);
    if (statusChanged || detailChanged) state.accounts = state.accounts.map(item => String(item.id) === id ? { ...item, status: nextStatus, statusDetail: nextDetail } : item);
    if (payload?.status) updateAccountStatusDom(id, nextStatus);
    if (id === String(state.activeAccountId) && payload.status
        && !(isTelemetryTick && payload.status === state.wsStatus)) setStatus(payload.status, payload.detail || '');
    const host = getHost();
    if ((capabilityChanged || (!isBackgroundTick && statusChanged)) && id === String(state.activeAccountId) && state.active && host?.state?.view === 'ws-workbench') render({ skipNativeResize: true });
  }
  // Background account probes must update only the account rail. Re-rendering
  // the entire shell here would detach the native WebView anchor and recreate
  // the visible WhatsApp surface, which is the source of the periodic shake
  // users saw while another account was being inspected.
  function updateAccountStatusDom(accountId, status) {
    const id = text(accountId);
    if (!id || !status) return;
    const row = Array.from(document.querySelectorAll('.ws-account-row[data-account-id]'))
      .find(node => String(node.getAttribute('data-account-id') || '') === id);
    if (!row) return;
    const statusNode = row.querySelector('.ws-account-status');
    if (statusNode) {
      statusNode.textContent = status;
      statusNode.dataset.status = status;
    }
    const account = state.accounts.find(item => String(item.id) === id);
    if (account?.lastSeen) row.title = `上次状态：${account.lastKnownStatus || status} · ${displayTime(account.lastSeen)}`;
  }
  function openAccountForm() {
    if (state.accountBusy) return;
    state.accountFormOpen = true;
    state.accountFormName = '';
    state.accountFormId = '';
    state.accountFormError = '';
    state.error = '';
    render();
    requestAnimationFrame(() => $('#wsAccountDisplayName')?.focus());
  }
  function cancelAccountForm() {
    if (state.accountBusy) return;
    state.accountFormOpen = false;
    state.accountFormName = '';
    state.accountFormId = '';
    state.accountFormError = '';
    render();
  }
  function withWsAccountTimeout(task, timeoutMs = 12000) {
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('WS 账号创建超时。')), timeoutMs);
    });
    return Promise.race([Promise.resolve().then(task), timeout]).finally(() => clearTimeout(timer));
  }
  async function createWsAccountRecord(account) {
    const requestedMode = normalizeWorkspaceMode(account?.workspaceMode);
    if (!requestedMode) throw new Error('WS 账号用途无效。');
    account = { ...account, workspaceMode: requestedMode };
    const validateCreated = created => {
      if (String(created?.id || '').toLowerCase() !== String(account.id).toLowerCase() || accountWorkspaceMode(created) !== requestedMode) {
        const error = new Error('WS 账号编号或用途不匹配，未切换账号。'); error.code = 'WS_ACCOUNT_MODE_MISMATCH'; throw error;
      }
      return created;
    };
    let bridgeError = null;
    async function confirmNativeIndex(created) {
      validateCreated(created);
      if (typeof window.zhikeDesktop?.wsAccounts !== 'function') throw new Error('账号已保存到本机服务，桌面账号索引尚不可用；请刷新账号列表后重试。');
      const listed = await withWsAccountTimeout(() => window.zhikeDesktop.wsAccounts({ action: 'list' }), 12000);
      const indexed = (Array.isArray(listed?.accounts) ? listed.accounts : []).find(item => String(item?.id || '').toLowerCase() === String(created.id).toLowerCase());
      if (!indexed) throw new Error('账号已保存到本机服务，但桌面索引尚未同步；请刷新账号列表后重试。');
      return validateCreated(indexed);
    }
    // Prefer the native bridge because it also creates the isolated WebView2
    // profile index. A transient bridge/startup failure must not make the
    // account button appear broken while the loopback SQLite service is ready.
    if (typeof window.zhikeDesktop?.wsAccounts === 'function') {
      try {
        const result = await withWsAccountTimeout(() => window.zhikeDesktop.wsAccounts({ action: 'create', account }), 12000);
        if (result?.account?.id) return validateCreated(result.account);
        bridgeError = new Error('WS 账号创建没有返回有效账号。');
      } catch (error) {
        if (error?.code === 'WS_ACCOUNT_INDEX_WRITE_FAILED' || error?.code === 'WS_ACCOUNT_MODE_MISMATCH') throw error;
        bridgeError = error;
      }
    } else {
      bridgeError = new Error('桌面 WS 账号桥接暂未注入。');
    }
    // The bundled sidecar is the source of truth. This fallback covers the
    // short window in which the native bridge is reconnecting, and also makes
    // account creation usable after a renderer-only reload.
    try {
      const result = await api('/api/ws/accounts', {
        method: 'POST',
        timeout: 30000,
        body: JSON.stringify(account),
      }, { accountId: 'default' });
      if (result?.account?.id) return await confirmNativeIndex(result.account);
      throw new Error('本机账号服务没有返回有效账号。');
    } catch (apiError) {
      if (apiError?.code === 'WS_ACCOUNT_MODE_MISMATCH') throw apiError;
      // A bridge can finish its local write just after the timeout. Read back
      // the account before reporting failure so the user never creates a
      // hidden duplicate or loses a successfully committed account.
      try {
        const listed = await api('/api/ws/accounts', { timeout: 10000 }, { accountId: 'default' });
        const existing = (Array.isArray(listed?.accounts) ? listed.accounts : [])
          .find(item => String(item?.id || '').toLowerCase() === String(account?.id || '').toLowerCase());
        if (existing?.id) return await confirmNativeIndex(existing);
      } catch (readError) { if (readError?.code === 'WS_ACCOUNT_MODE_MISMATCH') throw readError; }
      const bridgeMessage = bridgeError?.message ? `（桌面桥接：${bridgeError.message}）` : '';
      throw new Error(`${apiError?.message || 'WS 账号创建失败。'}${bridgeMessage}`);
    }
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
    const workspaceMode = state.workspaceMode;
    const generation = state.accountPresentationGeneration;
    const workspaceGeneration = state.workspaceGeneration;
    const ownsWorkspace = () => workspaceMode === state.workspaceMode && workspaceGeneration === state.workspaceGeneration;
    const ownsCreate = () => ownsWorkspace() && generation === state.accountPresentationGeneration;
    state.accountBusy = true; render();
    try {
      // A lost response may follow a committed account. Explicit form retries
      // reuse the same identity instead of producing another account/profile.
      const id = state.accountFormId || (state.accountFormId = `ws-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`);
      const result = { account: await createWsAccountRecord({ id, displayName, workspaceMode, provider: 'WhatsApp Web', origin: 'https://web.whatsapp.com', status: '未连接' }) };
      if (!ownsCreate()) return;
      if (!result?.account?.id) throw new Error('WS 账号创建没有返回有效账号。');
      const accounts = new Map(state.accounts.map(item => [String(item.id), item]));
      accounts.set(String(result.account.id), result.account);
      state.accounts = [...accounts.values()];
      state.accountFormOpen = false;
      state.accountFormName = '';
      state.accountFormId = '';
      state.accountFormError = '';
      const switched = await switchAccount(result.account.id, { openLogin: true, created: true });
      if (!ownsWorkspace()) return;
      if (switched) toast(`已添加账号「${displayName}」，可在 WhatsApp 页面完成登录。`);
    } catch (error) {
      if (!ownsWorkspace()) return;
      state.accountFormError = error.message || 'WS 账号创建失败。';
      toast(state.accountFormError, 'x');
    }
    finally { if (ownsWorkspace()) { state.accountBusy = false; render(); } }
  }
  async function switchAccount(accountId, { openLogin = false, created = false } = {}) {
    const id = text(accountId);
    if (!id || !modeAccount(id)) return false;
    if (openLogin) {
      state.wsWorkspaceView = 'chat';
      state.mobilePanel = 'center';
      writeWsWorkspaceState('chat', state.wsWorkspaceNavCollapsed);
      if (id === String(state.activeAccountId)) {
        await connectionAction('open');
        return state.activeAccountId === id && !state.error;
      }
    } else if (id === String(state.activeAccountId)) return true;
    const previous = state.activeAccountId;
    const sequence = ++state.accountLoadSequence;
    const ownsSwitch = () => sequence === state.accountLoadSequence;
    void cancelAllAiWork();
    state.accountBusy = true;
    resetAccountPresentation(id);
    writeStoredAccountId(id); render();
    try {
      const result = await window.zhikeDesktop.ws({ action: 'open', accountId: id, bounds: boundsForBrowserView() });
      if (!ownsSwitch()) return false;
      if (result?.ok === false || result?.status === '连接失败') throw new Error(result.detail || result.error || 'WhatsApp 页面打开失败。');
      if (result?.status && result.accountId === id) {
        updateAccountStatus(result);
        if (result.status === '已连接' && !state.liveDirectory?.foregroundChecked) void refreshForegroundDirectory();
      }
      await syncWsGroupAllowlist(captureContext(''), true).catch(() => null);
      if (!ownsSwitch()) return false;
      await loadConversations();
      if (!ownsSwitch()) return false;
      await loadGroupMonitor({ silent: true });
      if (!ownsSwitch()) return false;
      if (state.wsWorkspaceView === 'members') {
        await loadGroupMembers(captureContext(''));
        if (!ownsSwitch()) return false;
      }
      state.error = '';
      if (state.backgroundActive) void refreshCollectionSummary({ background: true });
      return true;
    } catch (error) {
      if (!ownsSwitch()) return false;
      if (openLogin) {
        state.error = `${created ? '账号已创建。' : ''}打开 WhatsApp 失败：${text(error?.message || error)}`;
        setStatus('连接失败', state.error);
        toast(state.error, 'x');
        return false;
      }
      resetAccountPresentation(previous);
      writeStoredAccountId(previous);
      state.error = error.message || 'WS 账号切换失败，已恢复原账号。';
      try {
        if (!previous || !modeAccount(previous)) return false;
        try { await window.zhikeDesktop.ws({ action: 'open', accountId: previous, bounds: boundsForBrowserView() }); } catch {}
        if (!ownsSwitch()) return false;
        await loadConversations();
        if (!ownsSwitch()) return false;
        await loadGroupMonitor({ silent: true });
        if (!ownsSwitch()) return false;
        if (state.wsWorkspaceView === 'members') {
          await loadGroupMembers(captureContext(''));
          if (!ownsSwitch()) return false;
        }
      } catch (restoreError) {
        if (!ownsSwitch()) return false;
        throw restoreError;
      }
      return false;
    } finally { if (ownsSwitch()) { state.accountBusy = false; render(); } }
  }

  function resetAccountPresentation(accountId) {
    state.liveDirectory = null;
    state.livePreviewId = '';
    state.visibleForegroundChat = null;
    flushDraftPersist();
    invalidateExclusionPage();
    groupDrafts?.reset();
    ++state.accountPresentationGeneration;
    state.collectorActionSequence = Number(state.collectorActionSequence || 0) + 1;
    // Clear only the account-scoped UI projection. Persisted tasks, leases,
    // providers and native chat instances are owned by their existing services.
    const id = String(accountId || '');
    groupMonitorNativeSignature = '';
    state.collectionRefreshing = false;
    state.collectionRefreshQueued = false;
    state.readHistoryAutoStarted = false;
    state.previewAnalysisSignatures.clear();
    state.analysisRefreshPending.clear();
    state.listSyncBusy = false;
    state.listSyncOperation = Number(state.listSyncOperation || 0) + 1;
    state.visibleConversationFingerprint = '';
    state.aiBackgroundError = '';
    clearTimeout(settingsSaveTimer); settingsSaveTimer = undefined; ++settingsSaveSequence;
    state.aiAuthorization = null;
    state.aiRetryScope = null;
    state.aiAuthorizationOperation += 1;
    state.aiAuthorizationBusy = false;
    state.busy.import = false; state.busy.customer = false; state.busy.followup = false; state.busy.connection = false; state.busy.reply = false; state.busy.capture = false; state.busy.readHistory = false; state.busy.collector = false; state.aiBusy = false; state.translationBusy.clear();
    state.activeAccountId = id;
    state.wsStatus = '未连接'; state.wsDetail = ''; state.collectorLoginVisible = false;
    state.lastLoadedAt = '';
    state.collectionRun = null; state.followupAlerts = []; state.readHistorySkipped = [];
    state.aiQueueStats = { queued: 0, running: 0, retryable: 0, completed: 0, failed: 0, deadLetter: 0, retryCount: 0, total: 0 };
    state.summaryLoaded = { collection: false, followups: false, ai: false };
    state.groupMonitor = createGroupMonitorState(id);
    state.groupCatalog = [];
    state.groupMembers = { accountId: id, rows: [], enabled: null, error: '' };
    state.currentConversationId = '';
    state.conversationSelectionManual = false;
    state.conversationWindowStart = 0;
    state.conversations = []; state.discoveredConversations = []; state.discoveredGroupConversations = []; state.messages = []; state.historyCoverage = { loaded: 0, total: 0, complete: false }; state.analysis = null; state.analysisMeta = null; state.replies = [];
    state.hotProfile = null; state.hotProfileError = ''; state.hotProfileBusy = false;
    state.hotProfileEdits = Object.create(null); state.hotProfileColorDraft = '';
    state.archive = null; state.archiveError = ''; state.crmSyncStatus = ''; state.matchCandidates = [];
    state.broadcast = { selectedIds: new Set(), originalText: '', translatedText: '', targetLanguage: '', caption: '', attachments: [], uploading: false, plan: null, loading: false, error: '', lastBatchId: '' };
    state.export = { running: false, includeMedia: true, error: '', lastFileName: '' };
  }

  function toast(message, icon = 'check') { getHost()?.toast?.(message, icon); }
  function activeConversation() { return state.conversations.find(item => String(item.id) === String(state.currentConversationId)) || null; }
  function liveDirectory() {
    if (!state.liveDirectory) state.liveDirectory = {
      accountId: state.activeAccountId, mode: state.workspaceMode, foreground: new Map(), collector: new Map(),
      foregroundGeneration: 0, foregroundTicket: 0, foregroundRead: null, foregroundChecked: false,
      verifiedOpenGroups: new Map(),
      collectorGeneration: 0, epoch: 0, scanId: 0, chunks: new Set(), scannedKeys: new Set(), lastChunk: null, endChunk: null, finalized: false,
    };
    return state.liveDirectory;
  }
  function workspaceLiveDirectoryRows(mode) {
    const directory = state.liveDirectory;
    if (!directory || mode !== state.workspaceMode || directory.accountId !== state.activeAccountId || directory.mode !== mode) return [];
    const rows = new Map(directory.collector);
    if (mode === 'dedicated') for (const [key, row] of directory.verifiedOpenGroups || []) {
      if (!rows.has(key) || rows.get(key).liveObservedAt <= row.liveObservedAt) rows.set(key, row);
    }
    for (const [key, row] of directory.foreground) {
      const collected = rows.get(key);
      if (!collected || collected.liveObservedAt <= row.liveObservedAt) rows.set(key, row);
    }
    return [...rows.values()];
  }
  function updateVisibleContactsDom() {
    const contacts = $('#wsVisibleContactDirectory');
    if (contacts) {
      const html = renderVisibleContactDirectory();
      if (contacts.innerHTML !== html) contacts.innerHTML = html;
    }
  }
  function updateLiveDirectoryDom() {
    if (!state.active) return;
    const runtime = $('#wsLiveCollectionRuntime');
    if (runtime) runtime.innerHTML = liveCollectionRuntimeRows();
    if (state.workspaceMode === 'dedicated') { updateDedicatedLiveDirectoryDom(); return; }
    const list = $('.ws-session-list');
    if (list) {
      const html = renderConversationList();
      if (list.innerHTML !== html) list.innerHTML = html;
    }
    const count = $('#wsDirectoryCount');
    if (count) count.textContent = ordinaryDirectoryCount();
  }
  function addLiveDirectoryRows(destination, payload, source, scannedKeys, preserveExisting = false) {
    const dedicated = state.workspaceMode === 'dedicated';
    const rows = dedicated ? payload.groupConversations : payload.conversations;
    if (!Array.isArray(rows)) return;
    const at = Number.isFinite(Date.parse(payload.observedAt)) ? new Date(payload.observedAt).toISOString() : nowIso();
    for (const item of rows) {
      if (!item || (item.accountId && item.accountId !== state.activeAccountId)) continue;
      const key = text(item.externalId || item.conversationKey || item.groupJid);
      if (!key || (dedicated ? !/@g\.us$/i.test(key) : !isAutomaticDirectConversation(item))) continue;
      if (preserveExisting && scannedKeys?.has(key)) continue;
      const row = normalizeListItem({ ...item, externalId: key, title: item.title || item.displayName || item.groupName || key });
      if (destination.size >= 50000 && !destination.has(key)) destination.delete(destination.keys().next().value);
      destination.set(key, { ...row, accountId: state.activeAccountId, groupJid: dedicated ? key : undefined, liveSource: source, liveObservedAt: at });
      scannedKeys?.add(key);
    }
  }
  function collectorDirectoryMatches(payload) {
    const directory = state.liveDirectory;
    return directory && payload.accountId === state.activeAccountId && payload.workspaceMode === state.workspaceMode
      && collectionReady('backgroundCollection') && Number(payload.sessionGeneration) === directory.collectorGeneration
      && directory.collectorGeneration > 0 && Number(payload.collectorEpoch) === directory.epoch && directory.epoch > 0;
  }
  function mergeCollectorDirectory(payload, pushed) {
    const directory = liveDirectory();
    const scanId = Number(payload.scanId) || 0;
    if (scanId < directory.scanId || (directory.finalized && scanId === directory.scanId)) return;
    if (scanId > directory.scanId) {
      directory.scanId = scanId; directory.chunks.clear(); directory.scannedKeys.clear(); directory.lastChunk = null; directory.finalized = false; directory.endChunk = null;
      directory.incomplete = false;
      directory.collectorGaps = null;
      directory.collectorSkipped = null; directory.probeControls = null; directory.pendingGroupWindow = null;
    }
    if (pushed) {
      if (!Number.isSafeInteger(payload.chunkIndex) || payload.chunkIndex < 0 || directory.chunks.has(payload.chunkIndex)) return;
      directory.chunks.add(payload.chunkIndex);
      if (state.workspaceMode === 'dedicated' && scanId > 0 && Array.isArray(payload.pendingGroupNames)
          && (!directory.pendingGroupWindow || payload.chunkIndex > directory.pendingGroupWindow.chunk)) {
        directory.pendingGroupWindow = { chunk: payload.chunkIndex, names: payload.pendingGroupNames.slice(0,50)
          .filter(name => typeof name === 'string' && name.trim()).map(name => name.trim().slice(0,150)) };
      }
      if (payload.finished && payload.complete) directory.lastChunk = payload.chunkIndex;
    }
    addLiveDirectoryRows(directory.collector, payload, 'collector', directory.scannedKeys, !pushed && directory.chunks.size > 0);
    if (Number.isSafeInteger(payload.unresolvedRowCount) && payload.unresolvedRowCount >= 0) {
      directory.collectorGaps = Math.max(directory.collectorGaps || 0, payload.unresolvedRowCount);
    }
    if (state.workspaceMode === 'dedicated' && payload.directoryDiagnostics) {
      const chunk = Number.isSafeInteger(payload.chunkIndex) ? payload.chunkIndex : -1;
      if (!directory.probeControls || directory.probeControls.chunk <= chunk) {
        directory.probeControls = { chunk, filter: payload.directoryDiagnostics.groupFilterStatus, menu: payload.directoryDiagnostics.menuProbeStatus, open:payload.openIdentityStatus };
      }
      directory.collectorSkipped ||= {};
      for (const key of ['skippedUnread', 'skippedReadUnknown', 'skippedTypeUnknown', 'groupNoticeRows', 'verifiedNoticeRows']) {
        const count = payload.directoryDiagnostics[key];
        if (Number.isSafeInteger(count) && count > 0) directory.collectorSkipped[key] = Math.max(directory.collectorSkipped[key] || 0, count);
      }
    }
    directory.lastCollectorReadAt = nowIso();
    directory.collectorObserved = true;
    directory.collectorError = '';
    if (pushed && payload.finished) directory.endChunk = payload.chunkIndex;
    if (payload.finished && !payload.complete) directory.incomplete = true;
    if (directory.lastChunk !== null && directory.chunks.size === directory.lastChunk + 1) {
      if (!directory.collectorGaps) for (const key of directory.collector.keys()) if (!directory.scannedKeys.has(key)) directory.collector.delete(key);
      directory.finalized = true;
      directory.incomplete = directory.collectorGaps > 0;
    }
    updateLiveDirectoryDom();
    return true;
  }
  function rememberCollectorDirectoryResult(result, context) {
    if (!result?.supported || !contextCurrent(context) || !collectionReady('backgroundCollection')
        || result.accountId !== state.activeAccountId || (result.workspaceMode && result.workspaceMode !== state.workspaceMode)) return;
    if ((result.collectorEpoch != null || state.liveDirectory?.epoch > 0) && !collectorDirectoryMatches(result)) return;
    mergeCollectorDirectory(result, false);
    return true;
  }
  function receiveWorkspaceLiveEvent(payload) {
    if (payload?.eventName === 'directory-save-error') {
      const directory = state.liveDirectory;
      if (directory && payload.accountId === state.activeAccountId && payload.workspaceMode === state.workspaceMode &&
          Number.isSafeInteger(payload.sessionGeneration) && payload.sessionGeneration > 0 &&
          payload.sessionGeneration === Math.max(directory.foregroundGeneration, directory.collectorGeneration)) {
        directory.saveError = text(payload.detail || '目录保存失败。').slice(0, 240);
        directory.saveErrorGeneration = payload.sessionGeneration;
        directory.saveErrorAt = text(payload.observedAt) || nowIso();
        updateLiveDirectoryDom();
      }
      return true;
    }
    if (payload?.eventName !== 'live-directory' && payload?.eventName !== 'live-group-observation') return false;
    if (payload.collectorOnly === true && collectorDirectoryMatches(payload)) {
      if (payload.eventName === 'live-directory') {
        const merged = mergeCollectorDirectory(payload, true);
        if (merged && state.workspaceMode === 'ordinary' && Array.isArray(payload.conversations) && payload.conversations.some(isAutomaticDirectConversation)) maybeStartAutomaticReadHistoryCollection(captureContext(''));
      }
      else if (state.workspaceMode === 'dedicated') receiveDedicatedGroupObservation(payload);
    }
    return true;
  }
  function recordLiveIngestion(payload) {
    if (payload?.accountId !== state.activeAccountId || (payload.workspaceMode && payload.workspaceMode !== state.workspaceMode)) return;
    const directory = liveDirectory();
    if (payload.directoryOnly === true) {
      if (payload.sessionGeneration && payload.sessionGeneration !== Math.max(directory.foregroundGeneration, directory.collectorGeneration)) return;
      directory.lastDirectorySavedAt = nowIso();
      if (payload.sessionGeneration === directory.saveErrorGeneration) directory.saveError = '';
      updateLiveDirectoryDom();
      return;
    }
    if (payload.background !== true || !Number.isSafeInteger(payload.accepted) || payload.accepted < 0) return;
    directory.insertedMessages = (directory.insertedMessages || 0) + payload.accepted;
    if (state.workspaceMode === 'dedicated' && Number.isSafeInteger(payload.observedMembersAdded) && payload.observedMembersAdded >= 0) {
      directory.insertedMembers = (directory.insertedMembers || 0) + payload.observedMembersAdded;
    }
    directory.lastReceiptAt = nowIso();
    const runtime = $('#wsLiveCollectionRuntime');
    if (runtime) runtime.innerHTML = liveCollectionRuntimeRows();
  }
  function recordLiveHistory(payload) {
    if (payload?.collectorOnly !== true || !['collection-run-start', 'collection-complete', 'collection-retry-scheduled', 'history-retryable', 'collection-paused'].includes(payload.eventName)) return;
    if (!collectorDirectoryMatches(payload)) return false;
    const directory = liveDirectory();
    directory.historyDetail = text(payload.detail).slice(0, 250);
    directory.historyObservedAt = text(payload.observedAt) || nowIso();
    directory.historyMissing = Number.isSafeInteger(payload.retryable) && payload.retryable >= 0 ? payload.retryable : null;
    const runtime = $('#wsLiveCollectionRuntime');
    if (runtime) runtime.innerHTML = liveCollectionRuntimeRows();
    return true;
  }
  function trackLiveCollector(payload) {
    if (!payload?.collectionCapability || payload.accountId !== state.activeAccountId) return;
    const directory = liveDirectory();
    const generation = Number(payload.sessionGeneration ?? payload.collectionCapability.sessionGeneration) || 0;
    const epoch = Number(payload.source === 'foreground-visible' ? payload.collectionCapability.collectorEpoch : payload.collectorEpoch ?? payload.collectionCapability.collectorEpoch) || 0;
    if (payload.workspaceMode && payload.workspaceMode !== directory.mode) return false;
    if (generation && (generation < directory.collectorGeneration || (generation === directory.collectorGeneration && epoch > 0 && epoch < directory.epoch))) return false;
    const ready = payload.collectionCapability.collectorState === 'running';
    if (ready && (!generation || !epoch)) return;
    if (directory.collectorReady === ready && directory.collectorGeneration === generation && directory.epoch === epoch) return;
    if (directory.collectorGeneration && (directory.collectorReady !== ready || directory.collectorGeneration !== generation || directory.epoch !== epoch)) {
      directory.collectorRead = null;
      state.readHistoryAutoStarted = false;
    }
    directory.collectorReady = ready;
    directory.collectorGeneration = generation || directory.collectorGeneration;
    directory.epoch = epoch || directory.epoch;
    directory.scanId = 0; directory.scannedKeys.clear(); directory.chunks.clear(); directory.lastChunk = null; directory.finalized = false; directory.endChunk = null;
    directory.collectorObserved = false; directory.incomplete = false; directory.nextCollectorReadAt = 0;
    directory.collectorGaps = null;
    directory.collectorSkipped = null; directory.probeControls = null;
    directory.historyRetryAt = 0; directory.historyFailures = 0;
    const hadRows = directory.collector.size || directory.pendingGroupWindow?.names.length;
    directory.pendingGroupWindow = null;
    if (hadRows) { directory.collector.clear(); updateLiveDirectoryDom(); }
  }
  function refreshForegroundDirectory() {
    if (!state.active || state.wsStatus !== '已连接' || !modeAccount(state.activeAccountId)) return Promise.resolve(null);
    const directory = liveDirectory();
    if (directory.foregroundRead) return directory.foregroundRead;
    const context = captureContext(''), ticket = ++directory.foregroundTicket;
    const owns = () => contextCurrent(context) && directory === state.liveDirectory && ticket === directory.foregroundTicket;
    directory.foregroundRead = (async () => {
      try {
        const result = await wsBridge('discover-visible-conversations', context);
        if (!owns()) return null;
        if (result?.accountId !== context.accountId || result.workspaceMode !== directory.mode || result.source !== 'foreground-visible'
            || !result.supported || !Number.isSafeInteger(result.sessionGeneration) || result.sessionGeneration < Math.max(1, directory.foregroundGeneration)) {
          directory.foreground.clear(); directory.foregroundChecked = false; directory.contactsVisible = false;
          directory.openIdentityStatus = ''; directory.currentOpenGroup = null; directory.foregroundDiagnostics = null;
          directory.foregroundError = text(result?.error || result?.detail || '暂未读到当前账号的前台目录。').slice(0, 240);
          return null;
        }
        const observedAt = nowIso();
        if (result.sessionGeneration !== directory.foregroundGeneration) {
          directory.foreground.clear(); directory.foregroundChecked = false; directory.lastForegroundReadAt = ''; directory.foregroundGaps = null;
          directory.verifiedOpenGroups.clear(); directory.groupVerification = null;
        }
        directory.foregroundGeneration = result.sessionGeneration;
        if (directory.mode === 'dedicated') {
          directory.foregroundDiagnostics = result.directoryDiagnostics || null;
          directory.openIdentityStatus = text(result.openIdentityStatus);
          const jid = text(result.activeGroup?.groupJid).toLowerCase();
          directory.currentOpenGroup = directory.openIdentityStatus === 'verified' && /^[a-z0-9._-]+@g\.us$/.test(jid)
            ? { groupJid: jid, externalId: jid, displayName: text(result.activeGroup.displayName).slice(0,150) || jid,
              isGroup: true, conversationType: 'group', accountId: context.accountId, liveSource: 'foreground-open-group', liveObservedAt: observedAt } : null;
          if (directory.currentOpenGroup) directory.verifiedOpenGroups.set(jid, directory.currentOpenGroup);
        }
        directory.chatListVisible = result.conversationListVisible !== false;
        if (directory.chatListVisible) {
          directory.foreground.clear();
          addLiveDirectoryRows(directory.foreground, result, 'foreground-visible');
          directory.foregroundGaps = Number.isSafeInteger(result.unresolvedRowCount) && result.unresolvedRowCount >= 0 ? result.unresolvedRowCount : null;
          directory.foregroundChecked = true; directory.lastForegroundReadAt = observedAt;
        }
        directory.contactsVisible = directory.mode === 'ordinary' && result.contactsVisible === true;
        directory.contactsObservedAt = directory.contactsVisible ? observedAt : '';
        directory.contacts = new Map();
        directory.contactGaps = Number.isSafeInteger(result.unresolvedContactCount) && result.unresolvedContactCount >= 0 ? result.unresolvedContactCount : null;
        if (directory.contactsVisible && Array.isArray(result.contacts)) {
          for (const contact of result.contacts) {
            const id = text(contact?.contactId);
            if (!/^\d{1,20}@(c\.us|s\.whatsapp\.net|lid)$/i.test(id) || (contact.accountId && contact.accountId !== context.accountId)) continue;
            directory.contacts.set(id, text(contact.displayName).slice(0, 150) || id);
          }
        }
        directory.foregroundError = '';
        return result;
      } catch (error) {
        if (owns()) {
          directory.foreground.clear(); directory.foregroundChecked = false; directory.contactsVisible = false;
          directory.openIdentityStatus = ''; directory.currentOpenGroup = null; directory.foregroundDiagnostics = null;
          directory.foregroundError = text(error?.message || '前台目录读取失败。').slice(0, 240);
        }
        return null;
      }
      finally { if (owns()) { directory.foregroundRead = null; updateLiveDirectoryDom(); updateVisibleContactsDom(); } }
    })();
    return directory.foregroundRead;
  }
  function invalidateForegroundDirectory() {
    state.visibleForegroundChat = null;
    const directory = state.liveDirectory;
    if (!directory) return;
    directory.foregroundTicket++; directory.foregroundRead = null; directory.foregroundChecked = false; directory.foregroundError = '';
    directory.contacts = null; directory.contactsVisible = false; directory.foregroundGaps = null;
    directory.verifiedOpenGroups.clear(); directory.currentOpenGroup = null; directory.foregroundDiagnostics = null; directory.openIdentityStatus = ''; directory.groupVerification = null;
    updateVisibleContactsDom();
    directory.foreground.clear();
    updateLiveDirectoryDom();
  }
  function broadcastCandidates() {
    return (Array.isArray(state.conversations) ? state.conversations : [])
      .filter(item => explicitConversationType(item) === 'direct' && Number(item.unreadCount || 0) === 0)
      .slice(0, 50);
  }
  function broadcastSelectedRows() {
    const allowed = new Set(broadcastCandidates().map(item => String(item.id)));
    return [...(state.broadcast?.selectedIds || [])]
      .filter(id => allowed.has(String(id)))
      .map(id => state.conversations.find(item => String(item.id) === String(id)))
      .filter(Boolean);
  }
  function broadcastIdempotencyKey(payload = {}) {
    // The server also checks a canonical content hash: a renderer hash collision
    // must reject conflicting content, never recover an unrelated old plan.
    const canonical = {
      accountId: text(payload.accountId),
      conversationIds: [...new Set((payload.conversationIds || []).map(String))].sort(),
      originalText: text(payload.originalText), translatedText: text(payload.translatedText),
      targetLanguage: text(payload.targetLanguage), caption: text(payload.caption),
      payloadKind: text(payload.payloadKind),
      attachments: (payload.attachments || []).map((item, index) => ({
        mediaId: text(item.mediaId || item.id), orderNo: index,
        fileName: text(item.fileName), mimeType: text(item.mimeType), sizeBytes: Number(item.sizeBytes || 0),
      })),
    };
    return 'ws-broadcast-v2:' + canonical.accountId + ':' + stableHash(JSON.stringify(canonical));
  }
  function broadcastPlanRows() {
    return Array.isArray(state.broadcast?.plan?.items) ? state.broadcast.plan.items : [];
  }
  function broadcastAttachmentKind(attachment) {
    const mime = text(attachment?.mimeType || attachment?.type).toLocaleLowerCase();
    if (mime.startsWith('image/')) return 'image';
    if (mime.startsWith('video/')) return 'video';
    if (mime.startsWith('audio/')) return 'audio';
    return 'document';
  }
  function broadcastPayloadKind(attachments) {
    const rows = Array.isArray(attachments) ? attachments : [];
    if (!rows.length) return 'text';
    const kinds = [...new Set(rows.map(broadcastAttachmentKind))];
    return kinds.length === 1 ? kinds[0] : 'media';
  }
  function readFileAsBase64(file) {
    return new Promise((resolve, reject) => {
      if (!file || typeof FileReader !== 'function') { reject(new Error('当前环境不支持读取附件。')); return; }
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('附件读取失败，未加入发送队列。'));
      reader.onload = () => {
        const value = String(reader.result || '');
        const comma = value.indexOf(',');
        resolve(comma >= 0 ? value.slice(comma + 1) : value);
      };
      reader.readAsDataURL(file);
    });
  }
  async function addBroadcastFiles(fileList) {
    const b = state.broadcast;
    const files = [...(fileList || [])];
    if (!files.length) return;
    if (files.length + (Array.isArray(b.attachments) ? b.attachments.length : 0) > 10) {
      toast('单次群发最多添加 10 个附件。', 'x');
      return;
    }
    const context = captureContext('');
    b.uploading = true;
    b.error = '';
    render();
    try {
      for (const file of files) {
        assertContext(context);
        const size = Number(file?.size || 0);
        if (!size || size > 24 * 1024 * 1024) throw new Error(`附件“${text(file?.name) || '未命名'}”超过 24 MB，未加入队列。`);
        const dataBase64 = await readFileAsBase64(file);
        assertContext(context);
        const uploaded = await api('/api/ws/media', {
          method: 'POST',
          timeout: 120000,
          body: JSON.stringify({ accountId: state.activeAccountId, fileName: text(file.name) || 'attachment', mimeType: text(file.type) || 'application/octet-stream', dataBase64 }),
        }, context);
        assertContext(context);
        const media = uploaded?.media || uploaded || {};
        const mediaId = text(media.mediaId || media.id);
        if (!mediaId) throw new Error('本机媒体服务没有返回媒体编号，附件未加入队列。');
        b.attachments.push({
          id: `attachment-${Date.now().toString(36)}-${stableHash(`${mediaId}:${file.name}`)}`,
          mediaId,
          fileName: text(media.fileName || file.name) || 'attachment',
          mimeType: text(media.mimeType || file.type) || 'application/octet-stream',
          sizeBytes: Number(media.sizeBytes || size),
          size,
          payloadKind: broadcastAttachmentKind(media),
        });
      }
      toast(`已加入 ${files.length} 个附件，创建群发计划后仍需逐条确认发送。`);
    } catch (error) {
      if (contextCurrent(context)) { b.error = error.message || '附件上传失败。'; toast(b.error, 'x'); }
    } finally {
      if (contextCurrent(context)) { b.uploading = false; render(); }
    }
  }
  function removeBroadcastAttachment(id) {
    const key = text(id);
    state.broadcast.attachments = (Array.isArray(state.broadcast.attachments) ? state.broadcast.attachments : []).filter(item => String(item.id || item.mediaId) !== key && String(item.mediaId) !== key);
    state.broadcast.error = '';
    render();
  }
  async function exportAllWsData() {
    const exportState = state.export || (state.export = { running: false, includeMedia: true, error: '', lastFileName: '' });
    if (exportState.running) return;
    const context = captureContext('');
    exportState.running = true;
    exportState.error = '';
    render();
    try {
      const query = new URLSearchParams({ accountId: String(state.activeAccountId || 'default'), includeMedia: exportState.includeMedia === false ? '0' : '1' });
      const response = await fetch(`/api/ws/export?${query.toString()}`, { cache: 'no-store' });
      if (!response.ok) throw new Error(`导出失败（${response.status}）。`);
      const blob = await response.blob();
      assertContext(context);
      const fileName = `zhike-ws-${state.activeAccountId}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url; anchor.download = fileName; anchor.rel = 'noopener'; anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      exportState.lastFileName = fileName;
      toast('WS 客户、联系人、群组、消息和分析数据已开始下载。');
    } catch (error) {
      if (contextCurrent(context)) { exportState.error = error.message || '导出失败。'; toast(exportState.error, 'x'); }
    } finally {
      if (contextCurrent(context)) { exportState.running = false; render(); }
    }
  }
  function stableHash(value) { return core.stableHash(value); }
  function explicitConversationType(conversation) { return core.conversationType?.(conversation) || 'unknown'; }
  function isExplicitGroupConversation(conversation) { return core.isGroupConversation?.(conversation) === true; }
  function isAutomaticDirectConversation(conversation) { return explicitConversationType(conversation) === 'direct'; }
  // There is no VIP group: VIP is only a CRM customer tag. Ordinary WS works on
  // private chats only; every group belongs to the dedicated WS group workflow.
  function isAutomaticCollectibleConversation(conversation) {
    return isAutomaticDirectConversation(conversation);
  }
  function isNativeManagedConversation(conversation) {
    const data = conversation?.data || {};
    const source = text(data.source || data.discovery || conversation?.source).toLocaleLowerCase();
    return /(?:ws-webview2|ws-list|visible-page|native)/.test(source)
      || Number(data.directionCaptureVersion || data.directionVersion || 0) > 0
      || Boolean(data.historyFingerprint || data.lastMessageFingerprint);
  }
  function canManuallyProcessConversation(conversation) {
    if (!conversation || isExplicitGroupConversation(conversation)) return false;
    return isAutomaticCollectibleConversation(conversation) || !isNativeManagedConversation(conversation);
  }
  function ordinaryGroupExclusionMessage(action = '采集、AI 分析或跟进提醒') {
    return `此群聊不适用于${action}。请在专用 WS 的群组管理中选择该群。`;
  }
  function personalConversationRows(rows) {
    return (Array.isArray(rows) ? rows : []).filter(row => !isExplicitGroupConversation(row));
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
    state.archive = null;
    state.archiveError = '';
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
      replyOperationSource: '',
      replyRevision: 0,
    };
  }
  function currentDraft() {
    const key = `${state.activeAccountId || 'default'}:${String(state.currentConversationId || '__new__')}`;
    if (!state.drafts.has(key)) {
      const restored = restoreDraftReply(key);
      const draft = blankDraft();
      if (restored) draft.replyInput = restored;
      state.drafts.set(key, draft);
    }
    return state.drafts.get(key);
  }
  // Reply text survives a window close/reopen. Only the operator's unsent
  // text is stored (never AI previews, errors or captured messages), scoped by
  // account + conversation so switching accounts cannot leak a draft across.
  const DRAFT_STORAGE_KEY = 'zhike.ws.reply-drafts';
  let draftPersistTimer = null;
  let draftPersistGeneration = 0;
  const pendingDraftPersists = new Map();
  const draftPersistErrors = new Map();
  function replyDraftKey() { return `${state.activeAccountId || 'default'}:${String(state.currentConversationId || '__new__')}`; }
  function draftPersistenceMessage() {
    if (draftPersistErrors.has(replyDraftKey())) return '本机草稿保存失败，当前文字仍保留在此窗口。请保持窗口打开并重试保存。';
    return draftPersistErrors.size ? `另有 ${draftPersistErrors.size} 份草稿尚未保存，文字仍保留在此窗口。请保持窗口打开并重试保存。` : '';
  }
  function updateDraftPersistenceStatus() {
    const message = draftPersistenceMessage(), label = $('#wsDraftPersistenceStatus'), retry = $('#wsDraftPersistRetry');
    if (label) label.textContent = message;
    if (retry) retry.hidden = !message;
  }
  function readDraftStore() {
    const parsed = JSON.parse(localStorage.getItem(DRAFT_STORAGE_KEY) || '{}');
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('草稿存储内容不可读取。');
    return parsed;
  }
  function restoreDraftReply(key) {
    // A failed write stays available in memory even if its view is rebuilt.
    if (pendingDraftPersists.has(key)) return pendingDraftPersists.get(key);
    try {
      const value = readDraftStore()[key];
      return typeof value === 'string' ? value : '';
    } catch { draftPersistErrors.set(key, true); return ''; }
  }
  function persistDraftReply(key, value) {
    // An immediate clear/write supersedes the delayed snapshot for this key.
    // Other accounts' pending replies still need to be persisted.
    pendingDraftPersists.delete(key);
    if (!pendingDraftPersists.size && draftPersistTimer !== null) {
      clearTimeout(draftPersistTimer); draftPersistTimer = null; ++draftPersistGeneration;
    }
    try {
      const store = readDraftStore();
      const text = String(value ?? '');
      delete store[key];
      // Never truncate this recovery copy or evict another unsent reply.
      // The existing send/copy limits are enforced at their own entry points.
      if (text.length) store[key] = text;
      localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(store));
      draftPersistErrors.delete(key);
      return true;
    } catch {
      pendingDraftPersists.set(key, String(value ?? ''));
      draftPersistErrors.set(key, true);
      return false;
    } finally { updateDraftPersistenceStatus(); }
  }
  function scheduleDraftPersist(key, value) {
    pendingDraftPersists.set(key, String(value ?? ''));
    if (draftPersistTimer !== null) clearTimeout(draftPersistTimer);
    const generation = ++draftPersistGeneration;
    draftPersistTimer = setTimeout(() => {
      if (generation === draftPersistGeneration) flushDraftPersist();
    }, 250);
  }
  function flushDraftPersist() {
    ++draftPersistGeneration;
    if (draftPersistTimer !== null) clearTimeout(draftPersistTimer);
    draftPersistTimer = null;
    const snapshots = [...pendingDraftPersists];
    pendingDraftPersists.clear();
    for (const [key, value] of snapshots) persistDraftReply(key, value);
  }
  function updateReplyDraftInput(draft, value, newRevision = false) {
    if (newRevision || draft.replyInput !== value) {
      draft.replyRevision = Number(draft.replyRevision || 0) + 1;
      draft.replyOperationId = ''; draft.replyOperationSource = '';
    }
    draft.replyInput = value;
    scheduleDraftPersist(replyDraftKey(), value);
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
    if (!profile) return `<section class="ws-card ws-hot-profile-card" data-assist-section="profile"><div class="ws-card-heading"><div><strong>热聊客户档案</strong><span>从自然聊天逐步补齐，不连续盘问客户</span></div><button class="btn small" data-ws-action="refresh-hot-profile">刷新</button></div><div class="ws-empty">当前会话还没有热聊档案。完成一次 AI 分析或点击刷新后，会显示已了解、待确认和待了解内容。</div>${state.hotProfileError ? `<p class="ws-error-line">${esc(state.hotProfileError)}</p>` : ''}</section>`;
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
    return `<section class="ws-card ws-hot-profile-card" data-assist-section="profile" data-color="${esc(color)}">
      <div class="ws-card-heading"><div><strong>热聊客户档案</strong><span>已完成 ${Number(profile.completeness || 0)}% · 只补空字段，冲突保留原值并记录证据</span></div><button class="btn small" data-ws-action="refresh-hot-profile" ${state.hotProfileBusy ? 'disabled' : ''}>${state.hotProfileBusy ? '刷新中…' : '刷新'}</button></div>
      <div class="ws-hot-profile-toolbar"><label>客户状态<select id="wsHotProfileColor" data-hot-profile-color>${colorOptions}</select></label><span class="ws-hot-profile-status status-${esc(color)}">${esc(HOT_PROFILE_COLORS[color])}</span><button class="btn small" data-ws-action="save-hot-profile-color">保存标记</button></div>
      <div class="ws-hot-profile-progress"><span style="width:${Math.max(0, Math.min(100, Number(profile.completeness) || 0))}%"></span></div>
      <div class="ws-hot-profile-overview"><span class="ws-hot-profile-missing">待了解：${esc(missing)}</span>${derived.progress ? `<span>沟通进度：${esc(derived.progress)}</span>` : ''}${derived.temperature ? `<span>客户温度：${esc(derived.temperature)}</span>` : ''}${derived.summary ? `<span>AI 摘要：${esc(derived.summary)}</span>` : ''}<span class="${derived.noReply.cooldown ? 'is-warning' : ''}">${esc(derived.noReply.reason)}</span>${derived.tags.length ? `<span>标签：${esc(derived.tags.join('、'))}</span>` : ''}</div>
      ${topics ? `<div class="ws-hot-profile-topics"><strong>下一步自然话题</strong><div>${topics}</div></div>` : ''}
      <div class="ws-hot-profile-fields">${fields}</div>
      ${state.hotProfileError ? `<p class="ws-error-line">${esc(state.hotProfileError)}</p>` : ''}
    </section>`;
  }
  function renderDataArchiveSummary() {
    const archive = state.archive;
    if (!state.currentConversationId) return '<section class="ws-card ws-data-archive-card zk-surface zk-surface--accent" data-assist-section="profile"><div class="ws-card-heading"><div><strong>统一数据档案</strong><span>客户主档与 WS 关联记录</span></div></div><div class="ws-empty">在前台聊天选择会话后，可查看关联客户档案。</div></section>';
    if (!archive) return '<section class="ws-card ws-data-archive-card zk-surface zk-surface--accent" data-assist-section="profile"><div class="ws-card-heading"><div><strong>统一数据档案</strong><span>正在读取客户主档与 WS 关联记录…</span></div></div><div class="ws-empty">档案库连接中…</div></section>';
    if (!archive.matched || !archive.customer) return `<section class="ws-card ws-data-archive-card zk-surface zk-surface--accent" data-assist-section="profile"><div class="ws-card-heading"><div><strong>统一数据档案</strong><span>当前会话暂未匹配客户主档</span></div></div><div class="ws-empty">${esc(archive.match?.kind === 'ambiguous' ? '检测到多个候选客户，已保留原档案并等待人工确认。' : '未找到现有客户档案；不会自动新增客户。')}</div>${state.archiveError ? `<p class="ws-error-line">${esc(state.archiveError)}</p>` : ''}</section>`;
    const customer = archive.customer || {};
    const records = archive.records || {};
    const ws = archive.ws || {};
    const conversation = archive.conversation;
    const personalIdentity = String(archive.accountId) === String(state.activeAccountId)
      && String(conversation?.accountId) === String(state.activeAccountId)
      && String(conversation?.id || '') === String(state.currentConversationId)
      && explicitConversationType(conversation) === 'direct';
    const avatar = personalIdentity ? businessPages?.renderPersonAvatar?.({
      name: customer.name, size: 'detail', vip: Boolean(text(customer.vipNumber)),
    }) || '' : '';
    const count = key => Number(Array.isArray(records[key]) ? records[key].length : 0);
    return `<section class="ws-card ws-data-archive-card zk-surface zk-surface--accent" data-assist-section="profile"><div class="ws-card-heading"><div><strong>统一数据档案</strong><span>客户主档、业务记录与 WS 原文已连接</span></div><span class="ws-profile-status">${esc(customer.deleted ? '已归档' : '已关联')}</span></div><div class="ws-person-identity">${avatar}<div class="ws-person-copy"><strong title="${esc(customer.name || customer.phone || '未命名客户')}">${esc(customer.name || customer.phone || '未命名客户')}</strong><small>${esc(customer.phone || customer.rawPhone || '未登记号码')} · 登记 ${esc(customer.registered || '未记录')}</small></div></div>${personalIdentity ? businessPages?.renderAvatarAvailability?.() || '' : ''}<div class="ws-data-archive-stats"><span>完整消息 <b>${Number(ws.messageTotal || ws.messages?.length || 0).toLocaleString()}</b></span><span>跟票 <b>${count('tickets')}</b></span><span>报名 <b>${count('registrations')}</b></span><span>入金 <b>${count('deposits')}</b></span><span>跟进 <b>${count('followups') + count('tasks')}</b></span><span>群组事件 <b>${Number(ws.groupMembershipEvents?.length || 0)}</b></span></div><p class="ws-muted">档案库只读联动；AI 只补现有客户空字段，冲突和低置信度保留待确认。</p></section>`;
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
      const url = new URL(pathname, window.location.origin);
      const groupDraftRestoreRoute = url.pathname === '/api/ws/group-drafts/restore';
      const accountId = groupDraftRestoreRoute ? '' : String(context?.accountId || url.searchParams.get('accountId') || state.activeAccountId || '');
      const globalAccountRoute = groupDraftRestoreRoute || /^\/api\/ws\/accounts(?:\/|$)/.test(url.pathname) || url.searchParams.get('allAccounts') === '1';
      if (url.pathname.startsWith('/api/ws/') && !accountId && !globalAccountRoute) throw new Error('请先添加并选择当前用途的 WS 账号。');
      if (url.pathname.startsWith('/api/ws/') && accountId && !url.searchParams.has('accountId')) url.searchParams.set('accountId', accountId);
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
        ? await coalescer(`${accountId}:${url.pathname}${url.search}${url.hash}`, execute, controller.signal)
        : await execute();
      if (controller.signal.aborted) throw new DOMException('The operation was aborted.', 'AbortError');
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        // Preserve the native bridge's actionable error (for example a
        // recovering sidecar or an expired local session) instead of hiding
        // every failure behind the same generic WS message.
        const error = new Error(body.error || body.message || body.errorCode || 'WS 本机数据服务暂不可用。');
        error.status = response.status; error.code = body.code || body.errorCode || ''; error.body = body; throw error;
      }
      return body;
    } catch (error) {
      if (error?.name === 'AbortError') throw new Error('WS 本机数据服务响应超时，请重试。');
      throw error;
    } finally { clearTimeout(timer); }
  }
  async function loadAllConversationPages(context = captureContext('')) {
    const conversations = [], groupConversations = [], seen = new Set(), seenGroups = new Set(), seenCursors = new Set();
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
      for (const item of Array.isArray(result.groupConversations) ? result.groupConversations : []) {
        const id = String(item?.id || item?.externalId || '');
        if (!id || seenGroups.has(id)) continue;
        seenGroups.add(id);
        groupConversations.push(item);
      }
      newest = newestConversationWatermark([result.scannedNewest], newest);
      const nextCursor = text(result.nextCursor);
      if (!nextCursor) return { conversations, groupConversations, pages: page + 1, watermark: newest || newestConversationWatermark(conversations) };
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
    const conversations = [], groupConversations = [], excludedIds = new Set(), seen = new Set(), seenGroups = new Set(), seenCursors = new Set();
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
      for (const item of Array.isArray(result.groupConversations) ? result.groupConversations : []) {
        const id = String(item?.id || item?.externalId || '');
        if (!id || seenGroups.has(id)) continue;
        seenGroups.add(id);
        groupConversations.push(item);
      }
      for (const id of Array.isArray(result.excludedConversationIds) ? result.excludedConversationIds : []) excludedIds.add(String(id));
      newest = newestConversationWatermark([result.scannedNewest, ...rows], newest);
      const scannedThrough = conversationWatermark(result.scannedThrough) || conversationWatermark(rows.at(-1));
      const crossedPreviousWatermark = Boolean(scannedThrough) && compareConversationWatermarks(scannedThrough, previousWatermark) <= 0;
      const nextCursor = text(result.nextCursor);
      if (crossedPreviousWatermark || !nextCursor) {
        return { conversations, groupConversations, excludedIds: [...excludedIds], pages: page + 1, watermark: newest, incremental: true };
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
    const hidden = !state.active || state.wsWorkspaceView !== 'chat' || style.display === 'none' || style.visibility === 'hidden' || rect.width < 40 || rect.height < 40;
    return { hidden, x: Math.round(rect.left), y: Math.round(rect.top), width: Math.round(rect.width), height: Math.round(rect.height) };
  }
  function configuredWsGroups(accountId = state.activeAccountId) {
    const settings = getHost()?.state?.settings || {};
    // WS 群组监测使用独立的绑定清单，不能从客户 VIP 编号推导群组。
    // 保留旧字段只为兼容升级过来的工作区；规范化逻辑集中在 ws-scope.js。
    const scoped = window.ZhikeWsScope?.normalizeWsGroupBindings?.(settings, accountId);
    // Labels and legacy VIP markers never authorize collection. The canonical
    // account/JID scope also makes an explicit empty list revoke old bindings.
    if (!Array.isArray(scoped)) return [];
    return [...new Set(scoped.filter(item => item.authorized === true)
      .map(item => item.groupJid))].slice(0, 500);
  }
  async function wsBridge(action, context = null, extra = null) {
    const scopedId = String(context?.accountId || state.activeAccountId || '');
    if (!scopedId || !modeAccount(scopedId)) {
      if (action === 'hide') return { skipped: true };
      throw new Error('请先添加并选择当前用途的 WS 账号。');
    }
    if ((COLLECTOR_ACTION_FEATURES[action] && !collectionReady(COLLECTOR_ACTION_FEATURES[action], context?.accountId || state.activeAccountId))
        || (COLLECTOR_SESSION_ACTIONS.has(action) && collectionCapability(context?.accountId || state.activeAccountId).state !== 'available')) {
      const result = collectionBlockedResult(context?.accountId || state.activeAccountId);
      const error = new Error(result.error);Object.assign(error, result, { data: { collectionCapability: result.collectionCapability } });throw error;
    }
    if (!window.zhikeDesktop?.ws) throw new Error('当前页面没有桌面 WS 视图能力，请从知客安装版打开。');
    const capabilityAtDispatch = modeAccount(scopedId)?.collectionCapability;
    const result = await window.zhikeDesktop.ws({ ...(extra && typeof extra === 'object' ? extra : {}), action, accountId: context?.accountId || state.activeAccountId || 'default', bounds: boundsForBrowserView() });
    const requestedId = String(context?.accountId || state.activeAccountId || 'default');
    if ((COLLECTOR_SESSION_ACTIONS.has(action) || COLLECTOR_ACTION_FEATURES[action]) && String(result?.accountId || '') !== requestedId) throw new Error('采集会话账号不匹配，已丢弃返回结果。');
    const ownsCapability = !COLLECTOR_ACTION_FEATURES[action] || modeAccount(scopedId)?.collectionCapability === capabilityAtDispatch;
    if (ownsCapability && (!context || contextCurrent({ ...context, conversationId: '' })) && String(result?.accountId || '') === requestedId) {
      if (trackLiveCollector(result) !== false) rememberCollectionCapability(result, requestedId);
    }
    return result;
  }
  async function syncWsGroupAllowlist(context = captureContext(''), force = false) {
    if (!collectionReady('backgroundCollection', context.accountId)) return collectionBlockedResult(context.accountId);
    const accountId = String(context?.accountId || state.activeAccountId || 'default');
    const wsGroups = configuredWsGroups(accountId);
    const signature = JSON.stringify(wsGroups);
    if (!force && state.wsGroupConfigSignatures.get(accountId) === signature) return { accepted:wsGroups.length, unchanged:true };
    const result = await wsBridge('configure-ws-groups', { ...context, accountId }, { wsGroups });
    state.wsGroupConfigSignatures.set(accountId, signature);
    return result;
  }
  function groupMonitorContext() { return captureContext(''); }
  function mergeDiscoveredGroupRows(rows = []) {
    const merged = new Map();
    for (const item of [...(Array.isArray(state.discoveredGroupConversations) ? state.discoveredGroupConversations : []), ...(Array.isArray(rows) ? rows : [])]) {
      const normalized = normalizeListItem(item);
      if (!isExplicitGroupConversation(normalized)) continue;
      const key = text(normalized?.groupJid || normalized?.externalId || normalized?.id || normalized?.title).toLocaleLowerCase();
      if (key) merged.set(key, normalized);
    }
    state.discoveredGroupConversations = [...merged.values()].slice(0, 500);
    return state.discoveredGroupConversations;
  }
  function discoveryGroupRows(result = {}) {
    return [
      ...(Array.isArray(result?.groupConversations) ? result.groupConversations : []),
      // Keep compatibility with a collector built before the separate field
      // was introduced; only explicitly identified groups are admitted.
      ...(Array.isArray(result?.excludedConversations) ? result.excludedConversations : []),
    ];
  }
  function groupMonitorEventLabel(type) {
    return type === 'joined' ? '进群' : type === 'removed' ? '被移除' : type === 'left' ? '退群' : '未知事件';
  }
  function groupMonitorStatusLabel(profile) {
    if (!profile) return '未配置';
    if (!profile.enabled) return '已暂停';
    if (!collectionReady('groupMonitoring')) return '已配置，等待采集会话';
    if (profile.status === 'error') return '异常';
    const live = currentGroupObservations(profile);
    if (live.recent) return '现场观测到 ' + live.recent + ' / ' + live.total + ' 个监测群组';
    if (live.lastSeenAt) return '近期未在现场看到已选群组';
    if (profile.observationState === 'no-targets' || Number(profile.targetCount) === 0) return '等待选择监测群组';
    if (profile.observationState === 'stale') return '近期未采到群组数据';
    if (profile.observationState === 'recent' && profile.lastObservedAt && Number(profile.recentTargetCount) > 0) {
      return '最近保存记录：采到 ' + Number(profile.recentTargetCount) + ' / ' + Number(profile.targetCount) + ' 个监测群组';
    }
    return '等待首次群组采集';
  }
  function currentGroupObservations(profile) {
    const targets = (profile?.targets || []).filter(target => target.enabled);
    const live = { total: targets.length, recent: 0, lastSeenAt: '', targetTimes: new Map() };
    const observations = state.groupMonitor?.liveObservations;
    if (!profile?.enabled || !observations || !collectionReady('groupMonitoring')) return live;
    const since = Date.now() - Math.max(15, Number(profile.pollIntervalSec) || 45) * 3000;
    for (const target of targets) {
      const observation = observations.get(text(target.groupJid).toLowerCase());
      if (!observation || observation.profileId !== profile.id || observation.targetId !== target.id
          || observation.generation !== state.liveDirectory?.collectorGeneration || observation.epoch !== state.liveDirectory?.epoch) continue;
      const at = observation.observedAt;
      if (at < (target.data?.observationStartAt || '') || at < (profile.data?.observationStartAt || '')) continue;
      live.targetTimes.set(target.id, at);
      if (at > live.lastSeenAt) live.lastSeenAt = at;
      if (Date.parse(at) >= since) live.recent++;
    }
    return live;
  }
  function receiveDedicatedGroupObservation(payload) {
    const monitor = state.groupMonitor, profile = monitor?.profile;
    if (payload?.accountId !== state.activeAccountId || payload.workspaceMode !== 'dedicated' || state.workspaceMode !== 'dedicated'
        || payload.collectorOnly !== true || !collectionReady('groupMonitoring') || monitor?.accountId !== state.activeAccountId
        || !profile?.enabled || !Array.isArray(payload.groupJids)) return;
    const timestamp = Date.parse(payload.observedAt);
    if (!Number.isFinite(timestamp) || timestamp > Date.now()) return;
    const observedAt = new Date(timestamp).toISOString();
    const jids = new Set(payload.groupJids.slice(0, 500).map(jid => text(jid).toLowerCase()));
    monitor.liveObservations ||= new Map();
    const enabledJids = new Set((profile.targets || []).filter(target => target.enabled).map(target => text(target.groupJid).toLowerCase()));
    for (const jid of monitor.liveObservations.keys()) if (!enabledJids.has(jid)) monitor.liveObservations.delete(jid);
    let changed = false;
    for (const target of profile.targets || []) {
      const jid = text(target.groupJid).toLowerCase();
      if (!target.enabled || !jids.has(jid)) continue;
      const previous = monitor.liveObservations.get(jid);
      if (previous && previous.observedAt >= observedAt) continue;
      monitor.liveObservations.set(jid, { observedAt, profileId: profile.id, targetId: target.id,
        generation: state.liveDirectory?.collectorGeneration, epoch: state.liveDirectory?.epoch });
      changed = true;
    }
    if (changed) updateDedicatedLiveDirectoryDom();
  }
  function groupMonitorDiscoveredGroups() {
    const catalogRows = (Array.isArray(state.groupCatalog) ? state.groupCatalog : []).map(item => ({
      groupJid: item.groupJid,
      externalId: item.groupJid,
      title: item.groupName,
      data: { channelId: item.channelId, sourceId: item.channelId, discoverySource: item.discoverySource },
    }));
    const rows = [...workspaceLiveDirectoryRows('dedicated'), ...catalogRows, ...(Array.isArray(state.conversations) ? state.conversations : []), ...(Array.isArray(state.discoveredConversations) ? state.discoveredConversations : []), ...(Array.isArray(state.discoveredGroupConversations) ? state.discoveredGroupConversations : [])];
    const values = new Map();
    for (const row of rows) {
      const data = row?.data || {};
      const groupJid = text(row?.groupJid || row?.externalId || data.groupJid || data.groupId || data.externalId);
      if (!/@g\.us$/i.test(groupJid)) continue;
      const groupName = text(row?.title || row?.name || data.groupName || groupJid);
      const sourceId = text(data.sourceId || data.source_id || data.source || '');
      const channelId = text(data.channelId || data.channel_id || sourceId);
      const sourceName = text(data.sourceName || data.source_name || data.channelName || data.channel_name || data.sourceLabel || data.channel || '');
      const channelName = text(data.channelName || data.channel_name || '');
      const groupFanType = text(data.groupFanType || data.group_fan_type || data.groupFanSource || data.group_fan_source || (/(?:单导|群粉|群导|社群|group)/i.test(sourceName) ? sourceName : ''));
      const key = groupJid.toLocaleLowerCase();
      if (!values.has(key)) values.set(key, { groupJid, groupName, sourceId, channelId, sourceName, channelName, groupFanType, enabled: true });
    }
    return [...values.values()];
  }
  function groupMonitorCustomers() {
    const customers = getHost()?.state?.customers;
    return (Array.isArray(customers) ? customers : []).filter(item => item && item.deleted !== true).slice(0, 300);
  }
  function renderGroupMonitorBody() {
    const capabilityBlocked = !collectionReady('groupMonitoring');
    const monitor = state.groupMonitor || {};
    const profile = monitor.profile;
    const health = monitor.health || {};
    const live = currentGroupObservations(profile);
    const eventCounts = health.eventCounts || {};
    if (!profile) return `${collectionCapabilityNotice()}<div class="ws-group-monitor-empty"><p>尚未选择监测群组。可先在群组目录勾选目标并点“监测所选群组”。独立采集会话就绪后会执行监测。</p><button class="btn small primary" data-ws-action="group-monitor-create" ${collectionControlAttributes('groupMonitoring')}>${monitor.busy ? '创建中…' : '创建固定席位'}</button>${monitor.error ? `<p class="ws-error-line" role="alert">${esc(monitor.error)}</p>` : ''}</div>`;
    const targetRows = (Array.isArray(profile.targets) ? profile.targets : []).map(target => { const channel = text(target.data?.channelName || target.data?.sourceName || ''); const groupFanType = text(target.data?.groupFanType || target.data?.groupFanSource || ''); return `<div class="ws-group-monitor-target"><div><strong>${esc(target.groupName || target.groupJid)}</strong><small>${esc(target.groupJid)}${channel ? ` · 渠道：${esc(channel)}` : ''}${groupFanType ? ` · 群粉类型：${esc(groupFanType)}` : ''} · ${target.enabled ? (capabilityBlocked ? '已配置，等待采集会话' : '已启用') : '未启用'}${live.targetTimes.has(target.id) ? ` · 现场 ${esc(displayTime(live.targetTimes.get(target.id)))}` : target.lastSeenAt ? ` · 历史 ${esc(displayTime(target.lastSeenAt))}` : ''}</small></div><button class="btn small ${target.enabled ? '' : 'primary'}" data-ws-action="group-monitor-target-toggle" data-target-id="${esc(target.id)}" data-enabled="${target.enabled ? 'true' : 'false'}" ${!target.enabled ? collectionControlAttributes('groupMonitoring') : ''}>${target.enabled ? '停止' : '启用'}</button></div>`; }).join('');
    const customers = groupMonitorCustomers();
    const timeline = typeof window !== 'undefined' ? window.ZhikeWsMembershipTimeline : null;
    const eventTimeline = timeline?.buildMembershipTimeline ? timeline.buildMembershipTimeline(monitor.events || [], { customers }) : [];
    const timelineCounts = timeline?.summarizeMembershipTimeline ? timeline.summarizeMembershipTimeline(eventTimeline) : null;
    const eventRows = (Array.isArray(monitor.events) ? monitor.events : []).map(event => {
      const groupName = text(event.data?.groupName || event.groupJid);
      const customer = customers.find(item => String(item.id) === String(event.customerId || ''));
      const status = text(event.status || 'pending');
      const autoRegistered = event.data?.autoRegistered === true;
      const evidence = timeline?.classify ? timeline.classify(event) : null;
      const needsResolve = !customer && ['pending', 'review'].includes(status);
      const options = [`<option value="">选择现有客户</option>`, ...customers.map(item => `<option value="${esc(item.id)}">${esc(item.name || item.rawPhone || item.phone || item.id)}</option>`)].join('');
      return `<article class="ws-group-monitor-event" data-event-id="${esc(event.id)}" data-evidence="${esc(evidence?.kind || '')}"><div class="ws-group-monitor-event-head"><strong>${esc(groupMonitorEventLabel(event.eventType))} · ${esc(groupName)}</strong>${evidence ? `<span class="ws-membership-kind" data-kind="${esc(evidence.kind)}">${esc(evidence.kindLabel)}</span>` : ''}<span class="ws-group-monitor-badge status-${esc(status)}">${esc(status === 'applied' ? (autoRegistered ? '已自动登记' : '已写入档案') : status === 'review' ? '待人工确认' : status === 'pending' ? '待关联客户' : '已忽略')}</span></div><p>${esc(event.memberPhone || event.memberJid || '未知成员')} · ${esc(displayTime(event.eventAt || event.observedAt))} · 置信度 ${Math.round(Number(event.confidence || 0) * 100)}%</p>${customer ? `<small>${autoRegistered ? '已自动登记：' : '已关联：'}${esc(customer.name || customer.id)}</small>` : needsResolve ? `<div class="ws-group-monitor-event-actions"><select data-group-monitor-customer="${esc(event.id)}">${options}</select><button class="btn small primary" data-ws-action="group-monitor-resolve" data-event-id="${esc(event.id)}">关联并写入</button><button class="btn small" data-ws-action="group-monitor-ignore" data-event-id="${esc(event.id)}">忽略</button></div>` : `<small>${esc(event.reviewReason || '未匹配现有客户')}</small>`}</article>`;
    }).join('');
    const loadedAutoRegisteredCount = (Array.isArray(monitor.events) ? monitor.events : []).filter(event => event.status === 'applied' && event.data?.autoRegistered === true).length;
    const autoRegisteredCount = Number.isFinite(Number(eventCounts.autoRegistered)) ? Number(eventCounts.autoRegistered) : loadedAutoRegisteredCount;
    const filter = monitor.statusFilter || 'all';
    const draft = monitor;
    const discoveredGroups = groupMonitorDiscoveredGroups();
    const pickerOptions = discoveredGroups.map(group => `<option value="${esc(group.groupJid)}">${esc(group.groupName || group.groupJid)}</option>`).join('');
    const groupPicker = `<div class="ws-group-monitor-picker"><select id="wsGroupMonitorPicker" aria-label="从当前 WS 群组选择"><option value="">${discoveredGroups.length ? '从当前 WS 群组选择' : '登录 WS 后显示可选群组'}</option>${pickerOptions}</select><button class="btn small" data-ws-action="group-monitor-add-selected" ${monitor.busy || state.workspaceMode !== 'dedicated' || !discoveredGroups.length ? 'disabled' : ''}>添加所选群组</button></div>`;
    const addTargetForm = `<div class="ws-group-monitor-add">${groupPicker}<div class="ws-group-monitor-manual"><input id="wsGroupMonitorJid" value="${esc(draft.draftJid || '')}" placeholder="高级入口：群组 JID（可选）" maxlength="180"><input id="wsGroupMonitorName" value="${esc(draft.draftName || '')}" placeholder="群组名称（可选）" maxlength="240"><button class="btn small primary" data-ws-action="group-monitor-add-target" ${monitor.busy || capabilityBlocked ? 'disabled' : ''}>手动添加</button></div></div>`;
    return `${collectionCapabilityNotice()}<div class="ws-group-monitor-toolbar"><div><span class="ws-group-monitor-status ${capabilityBlocked ? 'status-blocked' : live.recent ? 'status-running' : live.lastSeenAt || profile.observationState === 'stale' ? 'status-blocked' : 'status-paused'}"><i></i>${esc(groupMonitorStatusLabel(profile))}</span><small>${health.targetCount ?? (profile.targets || []).filter(item => item.enabled).length} 个已选群组 · 最近现场采集 ${esc(displayTime(live.lastSeenAt) || '暂无')} · 最近保存记录 ${esc(profile.lastObservedAt ? displayTime(profile.lastObservedAt) : '暂无')}</small></div><div class="ws-group-monitor-actions"><button class="btn small" data-ws-action="group-monitor-scan" ${monitor.busy || state.workspaceMode !== 'dedicated' || (capabilityBlocked && state.wsStatus !== '已连接') ? 'disabled' : ''}>${monitor.busy ? '扫描中…' : '读取现场群组'}</button><button class="btn small ${profile.enabled ? '' : 'primary'}" data-ws-action="group-monitor-toggle" data-enabled="${profile.enabled ? 'true' : 'false'}" ${!profile.enabled ? collectionControlAttributes('groupMonitoring') : ''}>${profile.enabled ? '暂停监控' : '启动监控'}</button></div></div><div class="ws-group-monitor-stats"><span>已写入 <b>${Number(eventCounts.applied || 0)}</b></span><span>自动登记 <b>${autoRegisteredCount}</b></span><span>待关联 <b>${Number(eventCounts.pending || 0)}</b></span><span>待确认 <b>${Number(eventCounts.review || 0)}</b></span><span>已忽略 <b>${Number(eventCounts.ignored || 0)}</b></span></div><div class="ws-group-monitor-targets"><div class="ws-group-monitor-section-title"><strong>监控群组</strong><small>只监测明确添加的 WS 群组</small></div>${addTargetForm}${targetRows || '<p class="ws-muted">尚未添加监测群组；登录 WS 后从群组列表选择即可，无需查找 JID。</p>'}</div><div class="ws-group-monitor-events"><div class="ws-group-monitor-section-title"><strong>最近进退群事件</strong>${timelineCounts ? `<small class="ws-membership-summary" role="status">已确认 ${timelineCounts.confirmed} · 已观察 ${timelineCounts.observed} · 无法确认 ${timelineCounts.unknown}</small>` : ''}<select id="wsGroupMonitorStatusFilter"><option value="all" ${filter === 'all' ? 'selected' : ''}>全部</option><option value="pending" ${filter === 'pending' ? 'selected' : ''}>待关联</option><option value="review" ${filter === 'review' ? 'selected' : ''}>待确认</option><option value="applied" ${filter === 'applied' ? 'selected' : ''}>已写入</option></select></div>${eventRows || '<p class="ws-muted">尚未保存符合条件的进退群事件。</p>'}</div>${monitor.error ? `<p class="ws-error-line">${esc(monitor.error)}</p>` : ''}<p class="ws-muted">监测群组绑定只决定 WS 监测范围，与 VIP 客户管理完全独立。确认进入群组的成员会自动登记客户档案并写入“已进群”状态；审核中、待批准和无法确认的事件不会建档，保留记录供人工处理。</p>`;
  }
  function renderGroupMonitorCard() {
    return `<section id="wsGroupMonitorCard" class="ws-card ws-group-monitor-card" data-assist-section="diagnostics"><div class="ws-card-heading"><div><strong>固定 WS 群组监测端口</strong><span>本机群组与监测配置 · 独立采集会话 · 前台聊天保留</span></div><button class="btn small" data-ws-action="group-monitor-refresh" ${state.groupMonitor?.loading ? 'disabled' : ''}>${state.groupMonitor?.loading ? '刷新中…' : '刷新'}</button></div><div data-group-monitor-body>${renderGroupMonitorBody()}</div></section>`;
  }
  function renderBroadcastCard() {
    const b = state.broadcast || {};
    const candidates = broadcastCandidates();
    const selected = new Set([...b.selectedIds].map(String));
    const attachments = Array.isArray(b.attachments) ? b.attachments : [];
    const candidateRows = candidates.slice(0, 80).map(item => {
      const id = String(item.id);
      const title = text(item.title || item.externalId || id);
      const preview = text(item.lastMessageText || '').slice(0, 46);
      return `<label class="ws-broadcast-recipient"><input type="checkbox" data-ws-broadcast-select="${esc(id)}" ${selected.has(id) ? 'checked' : ''}><span><strong>${esc(title)}</strong><small>${esc(item.externalId || '')}${preview ? ` · ${esc(preview)}` : ''}</small></span></label>`;
    }).join('');
    const planRows = broadcastPlanRows().map(item => {
      const target = state.conversations.find(row => String(row.id) === String(item.conversationId));
      const title = text(target?.title || target?.externalId || item.conversationId);
      const canSend = broadcastCanRetry(item);
      const attachmentCount = Array.isArray(item.attachments) ? item.attachments.length : 0;
      const payloadLabel = attachmentCount ? `媒体 ${attachmentCount} 个${item.caption || item.originalText ? ' · 含说明' : ''}` : '文本';
      return `<div class="ws-broadcast-plan-row"><span><strong>${esc(title)}</strong><small>${esc(broadcastDeliveryLabel(item))} · ${esc(payloadLabel)}</small></span>${canSend ? `<button class="btn small" data-ws-action="send-broadcast-item" data-broadcast-audit-id="${esc(item.id)}" ${b.loading ? 'disabled' : ''}>在当前会话发送</button>` : '<span class="ws-broadcast-sent">已阻止重发</span>'}</div>`;
    }).join('');
    const attachmentRows = attachments.map(item => `<li class="ws-broadcast-attachment"><span class="ws-broadcast-attachment-kind">${esc(broadcastAttachmentKind(item).toUpperCase())}</span><span class="ws-broadcast-attachment-copy"><strong>${esc(item.fileName || 'attachment')}</strong><small>${esc(item.mimeType || 'application/octet-stream')} · ${Math.max(1, Math.round(Number(item.sizeBytes || item.size || 0) / 1024))} KB · ${esc(item.mediaId || '未上传')}</small></span><button class="icon-button" data-ws-action="remove-broadcast-attachment" data-attachment-id="${esc(item.id || item.mediaId)}" title="移除附件">×</button></li>`).join('');
    return `<section id="wsBroadcastCard" class="ws-card ws-broadcast-card" data-assist-section="broadcast">
      <div class="ws-card-heading"><div><strong>群发与翻译</strong><span>只面向已读一对一会话；文本、图片、视频、音频和文件均先入队再逐条确认</span></div><span class="ws-broadcast-count">已选 ${selected.size}/${candidates.length}</span></div>
      <div class="ws-broadcast-toolbar"><button class="btn small" data-ws-action="broadcast-select-all" ${!candidates.length ? 'disabled' : ''}>全选已读</button><button class="btn small" data-ws-action="broadcast-clear-selection">清空</button><span class="ws-muted">未读会话、普通群聊和未确认目标不会加入群发。</span></div>
      <div class="ws-broadcast-recipient-list">${candidateRows || '<p class="ws-muted">当前账号没有可群发的已读一对一会话。</p>'}</div>
      <textarea id="wsBroadcastText" rows="3" placeholder="输入群发原文或媒体说明；发送前可以先生成译文预览。">${esc(b.originalText || '')}</textarea>
      <div class="ws-broadcast-attachment-toolbar"><input id="wsBroadcastFiles" type="file" multiple accept="image/*,video/*,audio/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.zip" hidden><button class="btn small" data-ws-action="pick-broadcast-files" ${b.uploading || b.loading ? 'disabled' : ''}>${b.uploading ? '上传中…' : '添加图片 / 文件'}</button><span class="ws-muted">最多 10 个附件，单个不超过 24 MB</span></div>
      ${attachments.length ? `<ul class="ws-broadcast-attachments" aria-label="群发附件队列">${attachmentRows}</ul>` : '<p class="ws-broadcast-attachment-empty">尚未添加附件；纯文本群发仍可直接创建计划。</p>'}
      <div class="ws-broadcast-compose"><label>译为<select id="wsBroadcastLanguage">${languageOptions(b.targetLanguage || state.settings.sendLanguage || state.settings.targetLanguage, true)}</select></label><button class="btn small" data-ws-action="translate-broadcast" ${b.loading || !text(b.originalText) ? 'disabled' : ''}>${b.loading ? '处理中…' : '翻译预览'}</button><button class="btn small primary" data-ws-action="create-broadcast-plan" ${b.loading || b.uploading ? 'disabled' : ''}>创建群发计划</button></div>
      ${b.translatedText ? `<div class="ws-broadcast-preview"><small>译文预览 · ${esc(b.targetLanguage || '目标语言')}</small><p>${esc(b.translatedText)}</p></div>` : ''}
      ${b.error ? `<p class="ws-error-line">${esc(b.error)}</p>` : ''}
      ${b.plan ? `<div class="ws-broadcast-plan"><div class="ws-broadcast-plan-heading"><strong>发送队列 · ${esc(b.lastBatchId)}</strong><button class="btn small" data-ws-action="clear-broadcast-plan">清除视图</button></div>${planRows || '<p class="ws-muted">队列为空。</p>'}</div>` : ''}
    </section>`;
  }
  function renderWsExportCard() {
    const exportState = state.export || {};
    return `<section id="wsExportCard" class="ws-card ws-export-card" data-assist-section="export">
      <div class="ws-card-heading"><div><strong>导出全部 WS 数据</strong><span>联系人、客户、群组、成员、完整消息、AI 分析、客户档案与媒体索引统一导出</span></div></div>
      <label class="ws-export-option"><input id="wsExportIncludeMedia" type="checkbox" ${exportState.includeMedia !== false ? 'checked' : ''}> 包含媒体元数据与下载索引（不打包本地二进制）</label>
      <p class="ws-muted">导出按当前账号隔离，服务端流式写出；前台 WS 页面保持原位，不会切换会话或滚动。</p>
      <button class="btn small primary ws-full-button" data-ws-action="export-all" ${exportState.running ? 'disabled' : ''}>${exportState.running ? '准备导出…' : '导出当前账号全部资料'}</button>
      ${exportState.lastFileName ? `<p class="ws-export-success">已生成：${esc(exportState.lastFileName)}</p>` : ''}
      ${exportState.error ? `<p class="ws-error-line">${esc(exportState.error)}</p>` : ''}
    </section>`;
  }
  async function syncGroupMonitorNative(profile, context = groupMonitorContext()) {
    if (!window.zhikeDesktop?.ws) return { skipped: true };
    assertContext(context);
    if (!collectionReady('groupMonitoring', context.accountId)) {
      if (!profile || !profile.enabled) return wsBridge(profile ? 'pause-group-monitor' : 'stop-group-monitor', context);
      return collectionBlockedResult(context.accountId);
    }
    const signature = JSON.stringify(profile ? {
      accountId: context.accountId,
      profileId: profile.id,
      enabled: Boolean(profile.enabled),
      intervalSec: Number(profile.pollIntervalSec || 45),
      targets: (Array.isArray(profile.targets) ? profile.targets : []).filter(item => item.enabled).map(item => ({
        targetId: item.id,
        groupJid: item.groupJid,
        groupName: item.groupName,
        sourceId: item.sourceId,
        sourceName: item.sourceName,
        channelName: item.channelName,
        groupFanType: item.groupFanType,
        enabled: true,
      })),
    } : { accountId: context.accountId, profileId: '', enabled: false });
    if (signature === groupMonitorNativeSignature) return { unchanged: true };
    try {
      if (!profile) {
        await wsBridge('stop-group-monitor', context);
        assertContext(context);
        groupMonitorNativeSignature = signature;
        return { stopped: true };
      }
      const config = JSON.parse(signature);
      await wsBridge('configure-group-monitor', context, {
        profileId: config.profileId,
        intervalSec: config.intervalSec,
        enabled: config.enabled,
        targets: config.targets,
      });
      assertContext(context);
      await wsBridge(config.enabled && config.targets.length ? 'start-group-monitor' : 'pause-group-monitor', context);
      assertContext(context);
      groupMonitorNativeSignature = signature;
      return { configured: true };
    } catch (error) {
      if (/collector|后台群组监控|尚未就绪|WS 账号/i.test(String(error?.message || ''))) {
        return { pending: true, reason: String(error.message).slice(0, 220) };
      }
      throw error;
    }
  }
  function updateGroupMonitorDom() {
    const card = $('#wsGroupMonitorCard');
    const body = card?.querySelector('[data-group-monitor-body]');
    if (body) body.innerHTML = renderGroupMonitorBody();
    const refresh = card?.querySelector('[data-ws-action="group-monitor-refresh"]');
    if (refresh) { refresh.disabled = Boolean(state.groupMonitor?.loading); refresh.textContent = state.groupMonitor?.loading ? '刷新中…' : '刷新'; }
  }
  async function loadGroupMonitor(options = {}) {
    if (!modeAccount(state.activeAccountId)) return;
    const background = options.background === true;
    const context = groupMonitorContext();
    const monitor = state.groupMonitor?.accountId === String(context.accountId)
      ? state.groupMonitor : (state.groupMonitor = createGroupMonitorState(context.accountId));
    // A slow sidecar response must not let the 15-second poller overlap and
    // apply an older profile/event snapshot after a newer one.
    if (monitor.loading) {
      if (!options.afterWrite) return monitor.loadFinished;
      await monitor.loadFinished;
      assertContext(context);
      return loadGroupMonitor({ ...options, afterWrite: false });
    }
    let finish;
    monitor.loadFinished = new Promise(resolve => { finish = resolve; });
    monitor.loading = true;
    if (!background && !options.silent) { updateGroupMonitorDom(); render(); }
    const archiveRequest = {};
    monitor.archiveRequest = archiveRequest;
    // Authorization and startup of an explicitly selected monitor must not
    // queue behind an optional archive read, including a slow or failed one.
    const archive = api(`/api/ws/accounts/${encodeURIComponent(context.accountId)}/groups?status=active&limit=1000`, {}, context).then(catalog => {
      if (state.groupMonitor !== monitor || monitor.archiveRequest !== archiveRequest || !contextCurrent(context)) return;
      const groups = Array.isArray(catalog.groups) ? catalog.groups : [];
      const directoryChanged = Boolean(monitor.archiveError) || JSON.stringify(monitor.catalog) !== JSON.stringify(groups);
      monitor.catalog = groups;
      state.groupCatalog = monitor.catalog.slice(0, 1000);
      monitor.archiveError = '';
      if (directoryChanged) updateDedicatedLiveDirectoryDom();
    }).catch(() => {
      if (state.groupMonitor === monitor && monitor.archiveRequest === archiveRequest && contextCurrent(context) && !monitor.archiveError) {
        monitor.archiveError = '本地历史目录暂时无法读取。';
        updateDedicatedLiveDirectoryDom();
      }
    });
    try {
      const list = await api('/api/ws/group-monitors/profiles', {}, context);
      assertContext(context);
      const profiles = Array.isArray(list.profiles) ? list.profiles : [];
      const profile = profiles.find(item => String(item.accountId) === String(context.accountId) && /^fixed-group-seat(?:-|$)/i.test(String(item.slotKey || ''))) || profiles.find(item => String(item.accountId) === String(context.accountId)) || null;
      if (!profile) {
        monitor.profile = null; monitor.health = null; monitor.events = []; monitor.error = ''; monitor.lastLoadedAt = nowIso();
      } else {
        const detail = await api(`/api/ws/group-monitors/${encodeURIComponent(profile.id)}`, {}, context);
        assertContext(context);
        const status = text(monitor.statusFilter || 'all') || 'all';
        const events = await api(`/api/ws/group-monitors/${encodeURIComponent(profile.id)}/events?status=${encodeURIComponent(status)}&limit=60`, {}, context);
        assertContext(context);
        monitor.profile = detail.profile || profile;
        monitor.health = detail.health || null;
        monitor.events = Array.isArray(events.events) ? events.events : [];
        monitor.error = '';
        monitor.lastLoadedAt = nowIso();
        if (background) await getHost()?.refreshState?.();
      }
      assertContext(context);
      const sync = await syncGroupMonitorNative(monitor.profile, context);
      assertContext(context);
      if (sync?.pending && monitor.profile?.enabled) monitor.error = '采集会话尚未执行监测配置，将在下次刷新时重试。' + sync.reason;
    } catch (error) {
      if (contextCurrent(context)) monitor.error = String(error?.message || '固定群组监控暂时不可用').slice(0, 240);
    } finally {
      // Always release this request's object. A stale account request must
      // neither strand its old lock nor unlock/overwrite the new account.
      monitor.loading = false;
      finish();
      if (state.groupMonitor === monitor && contextCurrent(context)) {
        updateGroupMonitorDom();
        if (!background && !options.silent) render();
      }
    }
    await archive;
    return monitor;
  }
  async function createGroupMonitor() {
    if (!collectionReady('groupMonitoring')) return rejectCollectionAction();
    return runGroupMonitorAction(async (monitor, context) => {
      await ensureGroupMonitorProfile(monitor, context);
      return '固定 WS 群组监控席位已就绪';
    });
  }
  async function ensureGroupMonitorProfile(monitor, context) {
    if (monitor.profile?.id) return monitor.profile;
    const result = await api('/api/ws/group-monitors/profiles', {
      method: 'POST', body: JSON.stringify({ slotKey: 'fixed-group-seat', ifAbsent: true, enabled: true, pollIntervalSec: 45 }),
    }, context);
    assertContext(context);
    if (!result.profile?.id || String(result.profile.accountId) !== String(context.accountId)) throw new Error('未能取得当前账号的监测席位');
    return result.profile;
  }
  async function runGroupMonitorAction(operation) {
    const context = groupMonitorContext();
    const monitor = state.groupMonitor;
    if (!monitor || monitor.busy || String(monitor.accountId) !== String(context.accountId)) return;
    monitor.busy = true;
    monitor.error = '';
    updateGroupMonitorDom();
    try {
      const message = await operation(monitor, context);
      assertContext(context);
      await loadGroupMonitor({ afterWrite: true, silent: true });
      assertContext(context);
      if (monitor.error) throw new Error(monitor.error);
      if (message) toast(message);
    } catch (error) {
      if (contextCurrent(context)) {
        monitor.error = error.message || '群组监测操作失败';
        toast(monitor.error, 'x');
      }
    } finally {
      monitor.busy = false;
      if (contextCurrent(context)) render({ skipNativeResize: true });
    }
  }
  async function scanGroupMonitorTargets({ automatic = false } = {}) {
    if (!collectionReady('groupMonitoring')) {
      if (!automatic && state.workspaceMode === 'dedicated' && state.wsStatus === '已连接') return refreshForegroundDirectory();
      return automatic ? undefined : rejectCollectionAction();
    }
    const context = groupMonitorContext();
    const monitor = state.groupMonitor;
    if (state.workspaceMode !== 'dedicated' || !monitor || String(monitor.accountId) !== context.accountId) return;
    const previous = monitor.discovery;
    if (previous?.promise || (automatic && previous && (!previous.retryAt || Date.now() < previous.retryAt))) return previous.promise;
    const discovery = { note: '正在读取独立采集会话的群组列表…', retryAt: 0 };
    monitor.discovery = discovery;
    const owns = () => state.groupMonitor === monitor && monitor.discovery === discovery && contextCurrent(context);
    discovery.promise = (async () => {
      try {
        const result = await wsBridge('discover-conversations', context);
        if (!owns()) return;
        if (!result?.supported) throw new Error(result?.error || '采集会话未能读取群组列表');
        rememberCollectorDirectoryResult(result, context);
        const groups = discoveryGroupRows(result);
        mergeDiscoveredGroupRows(groups);
        const observed = new Set(groups.map(row => text(row.groupJid || row.externalId || row.conversationKey).toLowerCase()).filter(jid => /@g\.us$/.test(jid))).size;
        discovery.note = result.scanning ? '正在读取 WhatsApp 群列表，识别到的群会直接显示在目录中。'
          : observed ? `本次目录读取识别到 ${observed} 个群组。` : '本次读取尚未识别到群组，可打开采集会话核对群列表并重试。';
        await loadGroupMonitor({ silent: true, afterWrite: true });
        if (owns() && !automatic) toast(discovery.note);
      } catch (error) {
        if (!owns()) return;
        discovery.note = '群目录读取失败：' + String(error?.message || '请重新打开独立采集会话').slice(0, 200);
        discovery.retryAt = Date.now() + 60000;
        if (!automatic) toast(discovery.note, 'x');
      } finally {
        discovery.promise = null;
        if (owns() && state.active && ['groups', 'collection'].includes(state.wsWorkspaceView)) render({ skipNativeResize: true });
        else if (monitor.discovery === discovery && !contextCurrent(context)) monitor.discovery = null;
      }
    })();
    return discovery.promise;
  }
  async function saveGroupMonitorTargets(targets) {
    if (state.workspaceMode !== 'dedicated' || !modeAccount(state.activeAccountId, 'dedicated')) return;
    if (!targets.length) return toast('请先选择需要监测的群组', 'x');
    return runGroupMonitorAction(async (monitor, context) => {
      const profile = await ensureGroupMonitorProfile(monitor, context);
      assertContext(context);
      await api(`/api/ws/group-monitors/${encodeURIComponent(profile.id)}/targets/scan`, {
        method: 'POST', body: JSON.stringify({ targets }),
      }, context);
      assertContext(context);
      monitor.draftJid = '';
      monitor.draftName = '';
      return `已保存 ${targets.length} 个监测群组${!profile.enabled ? '，席位当前已暂停' : collectionReady('groupMonitoring') ? '' : '，等待独立采集会话就绪'}`;
    });
  }
  function addDirectoryMonitorTargets() {
    const selected = new Set(groupDirectoryState().selectedGroupIds);
    const targets = groupDirectoryRows().filter(row => selected.has(row.directoryId))
      .map(row => ({ groupJid: row.groupJid, groupName: row.groupName, channelId: row.channelId, enabled: true }));
    return saveGroupMonitorTargets(targets);
  }
  async function addGroupMonitorTarget(selectedGroup = null) {
    if (!collectionReady('groupMonitoring')) return rejectCollectionAction();
    const monitor = state.groupMonitor;
    const groupJid = text(selectedGroup?.groupJid || monitor.draftJid).toLocaleLowerCase();
    if (!/^[a-z0-9._-]+@g\.us$/.test(groupJid)) {
      monitor.error = '请输入有效的 WhatsApp 群组 JID（例如 120363000000000000@g.us）。';
      updateGroupMonitorDom();
      return;
    }
    const groupName = text(selectedGroup?.groupName || monitor.draftName) || groupJid;
    return saveGroupMonitorTargets([{ ...selectedGroup, groupJid, groupName, enabled: true }]);
  }
  async function addSelectedGroupMonitorTarget() {
    const monitor = state.groupMonitor;
    if (monitor.busy) return;
    const groupJid = text($('#wsGroupMonitorPicker')?.value);
    const selectedGroup = groupMonitorDiscoveredGroups().find(item => item.groupJid.toLocaleLowerCase() === groupJid.toLocaleLowerCase());
    if (!selectedGroup) {
      monitor.error = '请先登录 WS 并从当前群组列表选择一个群组。';
      updateGroupMonitorDom();
      return;
    }
    return saveGroupMonitorTargets([selectedGroup]);
  }
  async function toggleGroupMonitor(enabled) {
    if (enabled && !collectionReady('groupMonitoring')) return rejectCollectionAction();
    const monitor = state.groupMonitor;
    if (!monitor.profile || monitor.busy) return;
    return runGroupMonitorAction(async (_monitor, context) => {
      await api(`/api/ws/group-monitors/${encodeURIComponent(monitor.profile.id)}`, { method: 'PATCH', body: JSON.stringify({ enabled }) }, context);
      return enabled ? '已启用群组监测配置' : '群组监控已暂停';
    });
  }
  async function toggleGroupMonitorTarget(element) {
    const monitor = state.groupMonitor;
    const targetId = text(element?.dataset?.targetId);
    const enabled = element?.dataset?.enabled !== 'true';
    if (enabled && !collectionReady('groupMonitoring')) return rejectCollectionAction();
    if (!monitor.profile || !targetId || monitor.busy) return;
    return runGroupMonitorAction(async (_monitor, context) => {
      await api(`/api/ws/group-monitors/${encodeURIComponent(monitor.profile.id)}/targets/${encodeURIComponent(targetId)}/${enabled ? 'enable' : 'disable'}`, { method: 'POST', body: JSON.stringify({}) }, context);
    });
  }
  async function resolveGroupMonitorEvent(element, action = 'resolve') {
    const monitor = state.groupMonitor;
    const eventId = text(element?.dataset?.eventId);
    if (!monitor.profile || !eventId || monitor.busy) return;
    const selected = $$('[data-group-monitor-customer]').find(node => String(node.dataset.groupMonitorCustomer || '') === eventId)?.value || '';
    if (action !== 'ignore' && !selected) { toast('请选择客户中心中已有的客户。', 'x'); return; }
    return runGroupMonitorAction(async (_monitor, context) => {
      await api(`/api/ws/group-monitors/${encodeURIComponent(monitor.profile.id)}/events/${encodeURIComponent(eventId)}/resolve`, { method: 'POST', body: JSON.stringify(action === 'ignore' ? { action: 'ignore', reason: '人工忽略' } : { customerId: selected, lock: true }) }, context);
      return action === 'ignore' ? '事件已忽略' : '已关联现有客户并写入群组关系';
    });
  }
  function wsBackgroundStatus() {
    const capability = collectionCapability();
    if (capability.state !== 'available') return { label: '后台采集不可用', tone: 'blocked', code: COLLECTION_CAPABILITY_BLOCKED };
    return {
      label: collectorStatusLabel(capability),
      tone: capability.collectorState === 'running' ? 'running' : capability.collectorState === 'error' ? 'blocked' : capability.collectorState === 'paused' ? 'idle' : 'waiting',
    };
  }
  function dedicatedLoginDetail() {
    const account = accountDisplayName(activeAccount()) || state.activeAccountId;
    if (state.collectorLoginVisible) return `${account} · ${core.collectorStatusMessage(collectionCapability())}`;
    if (state.wsStatus === '已连接') return `${account} · 前台登录。当前账号已连接。`;
    return `${account} · 前台登录。${state.wsDetail || (['等待登录', '会话过期'].includes(state.wsStatus) ? '请在 WhatsApp 中扫码关联此设备。' : '正在检查当前账号的 WhatsApp 页面。')}`;
  }
  function updateStatusDom() {
    const backgroundStatus = $('.ws-chat-background-status');
    if (backgroundStatus) {
      const current = wsBackgroundStatus();
      if (backgroundStatus.textContent !== current.label) backgroundStatus.textContent = current.label;
      if (backgroundStatus.dataset.tone !== current.tone) backgroundStatus.dataset.tone = current.tone;
      const capability = collectionCapability();
      backgroundStatus.dataset.collectionCapability = capability.state;
      backgroundStatus.title = capability.state === 'available' ? capability.reason : collectionBlockedResult().error;
      backgroundStatus.setAttribute?.('aria-label', capability.state === 'available' ? current.label : collectionBlockedResult().error);
    }
    const badge = $('#wsStatusBadge');
    if (badge) {
      if (badge.textContent !== state.wsStatus) badge.textContent = state.wsStatus;
      if (badge.dataset.status !== state.wsStatus) badge.dataset.status = state.wsStatus;
      const errorCategory = state.wsErrorCategory || '';
      if (badge.dataset.errorCategory !== errorCategory) badge.dataset.errorCategory = errorCategory;
    }
    const detail = $('#wsStatusDetail');
    const dedicatedDetail = $('#wsDedicatedLoginDetail');
    if (dedicatedDetail) dedicatedDetail.textContent = dedicatedLoginDetail();
    const statusDetail = state.wsDetail || (state.wsStatus === '已连接' ? '已通过页面结构确认 WS 主界面；未读取 Cookie 或消息正文。' : '请在中栏自行完成扫码或登录。');
    if (detail) {
      if (detail.textContent !== statusDetail) detail.textContent = statusDetail;
      if (detail.title !== statusDetail) detail.title = statusDetail;
    }
  }
  function updateAiBackgroundErrorDom() {
    const node = $('#wsAiBackgroundError');
    if (!node) return;
    const message = String(state.aiBackgroundError || '').trim();
    node.hidden = !message;
    const textNode = node.querySelector('[data-ws-ai-error-text]');
    if (textNode) textNode.textContent = message;
    const retry = node.querySelector('[data-ws-action="resume-ai-queue"]');
    if (retry) retry.hidden = !state.aiRetryScope;
  }
  function setStatus(status, detail = '') {
    const previous = state.wsStatus;
    state.wsStatus = status || '未连接';
    if (state.wsStatus === '已连接' && previous !== state.wsStatus) void refreshForegroundDirectory();
    if (state.wsStatus !== '已连接' && previous === '已连接') invalidateForegroundDirectory();
    state.wsDetail = detail;
    if (!['连接失败', '会话过期'].includes(state.wsStatus)) state.wsErrorCategory = '';
    updateStatusDom();
    if (previous !== state.wsStatus && state.workspaceMode === 'dedicated' && state.wsWorkspaceView === 'chat') updateDedicatedLiveDirectoryDom();
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
    if (!state.active || !modeAccount(state.activeAccountId)) return;
    const bounds = boundsForBrowserView();
    const signature = JSON.stringify(bounds);
    if (signature === lastResizeBounds && !resizeInFlight) return;
    // Scrollbars and fractional layout rounding can move the host by a pixel
    // while the shell settles. Do not send a native resize for these cosmetic
    // changes; repeated 1px bridge calls are what make the embedded WS page
    // appear to shiver during polling and scrolling.
    if (!bounds.hidden && lastResizeGeometry &&
      Math.abs(bounds.x - lastResizeGeometry.x) < 2 &&
      Math.abs(bounds.y - lastResizeGeometry.y) < 2 &&
      Math.abs(bounds.width - lastResizeGeometry.width) < 2 &&
      Math.abs(bounds.height - lastResizeGeometry.height) < 2 &&
      !resizeInFlight) return;
    if (resizeInFlight) { resizePending = true; return; }
    resizeInFlight = true;
    resizePending = false;
    lastResizeBounds = signature;
    lastResizeGeometry = bounds.hidden ? null : { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height };
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
    if (state.busy.connection || state.busy.collector) return;
    if (action === 'clear-session' && !confirm('清除本机 WS 会话后需要重新扫码或登录。客户资料、翻译、AI 分析和跟进记录不会删除。确认继续？')) return;
    const attempt = ++state.connectionAttemptGeneration;
    const workspaceMode = state.workspaceMode, workspaceGeneration = state.workspaceGeneration;
    const requestedAccountId = state.activeAccountId;
    const presentationGeneration = state.accountPresentationGeneration;
    const ownsRequest = () => workspaceMode === state.workspaceMode && workspaceGeneration === state.workspaceGeneration
      && attempt === state.connectionAttemptGeneration && requestedAccountId === state.activeAccountId
      && presentationGeneration === state.accountPresentationGeneration;
    const stopAfterAction = action === 'close' || action === 'clear-session';
    state.busy.connection = true;
    if (['open', 'login', 'reload', 'reconnect'].includes(action) && state.active) {
      state.wsWorkspaceView = 'chat';
      state.mobilePanel = 'center';
      writeWsWorkspaceState('chat', state.wsWorkspaceNavCollapsed);
      render({ skipNativeResize: true });
    }
    let context = null;
    try {
      const restarted = ['open', 'login', 'reload', 'reconnect'].includes(action) ? startBackgroundRuntime() : false;
      if (restarted && !state.accounts.length) await loadAccounts();
      if (!ownsRequest()) return;
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
      if (!ownsRequest()) return;
      if (!result || result.ok === false || result.status === '连接失败') {
        throw Object.assign(new Error(result?.detail || result?.error || 'WhatsApp 页面打开失败。'), { errorCategory: result?.errorCategory });
      }
      state.error = '';
      if (['open', 'login', 'reload', 'reconnect', 'close', 'clear-session'].includes(action)) state.collectorLoginVisible = false;
      setStatus(result.status || (action === 'reconnect' ? '正在重连' : stopAfterAction ? '未连接' : '等待登录'), result.detail || '');
      if (result.status === '已连接' && !state.liveDirectory?.foregroundChecked && ['open', 'login', 'reload', 'reconnect', 'probe'].includes(action)) void refreshForegroundDirectory();
      if (['open', 'login', 'reload', 'reconnect', 'probe'].includes(action)) {
        await syncWsGroupAllowlist(context, action !== 'probe').catch(() => null);
      }
      assertContext(context);
      if (!ownsRequest()) return;
      if (action === 'clear-session') toast('WS 隔离登录会话已清除，本地业务记录仍保留');
      else if (action === 'close') toast('WS 页面已关闭，本地业务记录仍保留');
      else if (result.isolatedPreview === true) toast(result.detail);
      else if (action === 'probe') toast('WS 登录状态已重新检测');
      else if (result.status === '已连接') toast('当前账号已登录 WhatsApp');
      else toast('WS 页面已打开，请自行扫码或登录');
      if (!stopAfterAction && state.backgroundActive) {
        // A connected account may already have direct-chat rows in the local
        // inventory.  Do not use that as a reason to skip discovery: group
        // rows are exposed through the separate groupConversations stream and
        // must be refreshed after login/reload as well.  The previous
        // `!state.conversations.length` guard left the group picker stale (or
        // empty) whenever the account had any existing customer chats.
        if (state.wsStatus === '已连接' || result.status === '已连接') await loadConversations();
        assertContext(context);
        if (!ownsRequest()) return;
        void refreshCollectionSummary({ background: true });
      }
    } catch (error) {
      if (ownsRequest() && (!context || contextCurrent(context))) {
        const detail = wsErrorDetail(error);
        const category = classifyWsError(error);
        state.error = detail;
        setStatus(category === 'session-expired' ? '会话过期' : category === 'unpaired' ? '等待登录' : '连接失败', detail);
        toast(detail, 'x');
      }
    } finally {
      if (ownsRequest()) { state.busy.connection = false; render(); }
    }
  }

  async function loadConversations() {
    if (!modeAccount(state.activeAccountId)) return;
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
      state.summaryLoaded = { collection: Boolean(runResult), followups: Boolean(alertResult), ai: Boolean(aiQueueResult?.stats) };
      state.collectionRun = runResult?.run || null;
      state.followupAlerts = alertResult?.alerts || [];
      if (aiQueueResult?.stats) { assertContext(context); state.aiQueueStats = aiQueueResult.stats; }
      applyConversationInventory(result, accountId);
      mergeDiscoveredGroupRows(result.groupConversations);
      const previousConversationId = String(state.currentConversationId || '');
      if (state.conversationSelectionManual && !state.conversations.some(item => String(item.id) === previousConversationId)) state.conversationSelectionManual = false;
      state.currentConversationId = resolveInitialConversationId(state.conversations, previousConversationId, state.conversationSelectionManual);
      if (state.currentConversationId) await loadConversationData(state.currentConversationId, false, { ...context, conversationId: String(state.currentConversationId) });
      else if (previousConversationId) await loadConversationData('', false, { ...context, conversationId: '' });
      assertContext(context);
      state.lastLoadedAt = nowIso();
      liveDirectory().localReadError = '';
      await refreshAiAuthorization(context);
    } catch (error) {
      if (sequence === loadSequence && contextCurrent(context)) {
        state.error = error.message;
        liveDirectory().localReadError = text(error.message || '本机查询失败').slice(0, 240);
      }
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
    return stats ? [stats.queued, stats.running, stats.retryable, stats.completed, stats.failed, stats.deadLetter, stats.retryCount, stats.total].join('\u0001') : '';
  }
  function captureWorkbenchScroll() {
    return ['.ws-session-list', '.ws-message-list', '.ws-assist-panel', '.ws-center-panel'].map(selector => {
      const node = $(selector);
      if (!node) return null;
      const maxTop = Math.max(0, Number(node.scrollHeight || 0) - Number(node.clientHeight || 0));
      const maxLeft = Math.max(0, Number(node.scrollWidth || 0) - Number(node.clientWidth || 0));
      return {
        selector,
        top: Number(node.scrollTop || 0),
        left: Number(node.scrollLeft || 0),
        // Preserve a pane that was pinned to its end when new cards/messages
        // are added. Keeping the bottom anchor avoids the thumb jumping when
        // the right assistant panel grows during AI/collector updates.
        atBottom: maxTop > 0 && maxTop - Number(node.scrollTop || 0) < 8,
        atRight: maxLeft > 0 && maxLeft - Number(node.scrollLeft || 0) < 8,
      };
    }).filter(Boolean);
  }
  function restoreWorkbenchScroll(positions) {
    for (const position of positions) {
      const node = $(position.selector);
      if (!node) continue;
      const hasTopMetrics = Number.isFinite(Number(node.scrollHeight)) && Number.isFinite(Number(node.clientHeight));
      const hasLeftMetrics = Number.isFinite(Number(node.scrollWidth)) && Number.isFinite(Number(node.clientWidth));
      const maxTop = hasTopMetrics ? Math.max(0, Number(node.scrollHeight) - Number(node.clientHeight)) : Math.max(0, Number(position.top) || 0);
      const maxLeft = hasLeftMetrics ? Math.max(0, Number(node.scrollWidth) - Number(node.clientWidth)) : Math.max(0, Number(position.left) || 0);
      const targetTop = position.atBottom && hasTopMetrics ? maxTop : Math.min(Math.max(0, position.top), maxTop);
      const targetLeft = position.atRight && hasLeftMetrics ? maxLeft : Math.min(Math.max(0, position.left), maxLeft);
      // Assign only when the clamped target differs. A no-op write still emits
      // scroll events in some WebView2 builds and can make the thumb flash.
      if (Math.abs(Number(node.scrollTop || 0) - targetTop) > 0.5) node.scrollTop = targetTop;
      if (Math.abs(Number(node.scrollLeft || 0) - targetLeft) > 0.5) node.scrollLeft = targetLeft;
    }
  }
  function renderPreservingScroll() {
    const positions = captureWorkbenchScroll();
    // Restore before the browser's next paint. Waiting for requestAnimationFrame
    // leaves a blank/top-of-panel frame and lets the global scroll coordinator
    // restore a competing position.
    render();
    restoreWorkbenchScroll(positions);
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
  function readOrdinaryCollectorDirectory(context, automatic = false) {
    if (state.workspaceMode !== 'ordinary' || !contextCurrent(context) || !collectionReady()) return Promise.resolve(null);
    const directory = liveDirectory();
    if (directory.collectorRead) return directory.collectorRead;
    if (automatic && directory.nextCollectorReadAt > Date.now()) return Promise.resolve(null);
    directory.nextCollectorReadAt = Date.now() + 90000;
    const generation = directory.collectorGeneration, epoch = directory.epoch;
    const pending = (async () => {
      try {
        const result = await wsBridge('discover-conversations', context);
        if (directory !== state.liveDirectory || !contextCurrent(context) || !collectionReady()
            || (generation && generation !== directory.collectorGeneration) || (epoch && epoch !== directory.epoch)) return null;
        if (!result?.supported) {
          directory.nextCollectorReadAt = Date.now() + 12000;
          directory.collectorError = text(result?.error || result?.detail || '后台目录暂不可读。').slice(0, 240);
          updateLiveDirectoryDom();
          return null;
        }
        if (!rememberCollectorDirectoryResult(result, context)) return null;
        if (result?.supported && (result.conversations || []).some(isAutomaticDirectConversation)) maybeStartAutomaticReadHistoryCollection(context);
        return result;
      } catch (error) {
        if (directory === state.liveDirectory && contextCurrent(context)) {
          directory.nextCollectorReadAt = Date.now() + 12000;
          directory.collectorError = `WS 会话列表读取失败：${String(error?.message || '页面暂不可读').slice(0, 240)}`;
          updateLiveDirectoryDom();
        }
        return null;
      } finally { if (directory.collectorRead === pending) directory.collectorRead = null; }
    })();
    directory.collectorRead = pending;
    return pending;
  }
  async function refreshCollectionSummary(options = {}) {
    if (!modeAccount(state.activeAccountId)) return;
    if (!collectionReady('backgroundCollection')) return collectionBlockedResult();
    if (!state.backgroundActive) return;
    if (state.workspaceMode === 'dedicated') return loadGroupMonitor({ background: true, silent: true });
    const context = captureContext('');
    const liveRead = readOrdinaryCollectorDirectory(context, true);
    if (state.loading || state.collectionRefreshing) { state.collectionRefreshQueued = true; return liveRead; }
    const backgroundRefresh = options?.background === true;
    // Collection refresh is account-scoped. Selecting another conversation
    // must not strand the global refresh lock or cancel list/run updates.
    let selectedConversationId = String(state.currentConversationId || '');
    const beforeRenderSignature = collectionRenderSignature();
    const previousConversationSignature = currentConversationRefreshSignature();
    const previousQueueSignature = aiQueueSignature();
    state.collectionRefreshing = true;
    try {
      await syncWsGroupAllowlist(context).catch(() => null);
      const [result, run, alerts, aiQueue] = await Promise.all([
        loadConversationDeltaPages(context),
        api('/api/ws/collection-runs', {}, context),
        api('/api/ws/followup-alerts?limit=8', {}, context),
        api('/api/ws/ai-jobs?limit=20', {}, context).catch(() => null),
      ]);
      assertContext(context);
      applyConversationInventory(result, context.accountId);
      liveDirectory().localReadError = '';
      mergeDiscoveredGroupRows(result.groupConversations);
      selectedConversationId = reconcilePersonalConversationSelection();
      state.collectionRun = run.run || null;
      state.followupAlerts = alerts.alerts || [];
      if (aiQueue?.stats) state.aiQueueStats = aiQueue.stats;
      await refreshAiAuthorization(context);
      let listSyncResult = { synced: 0, analyzed: 0 };
      if (collectionReady() && (!state.collectionRun || !['paused', 'stopped', 'completed'].includes(state.collectionRun.status))) {
        const visible = await liveRead;
        assertContext(context);
        if (visible?.supported) {
          if (/WS 会话列表读取失败|后台采集视图尚未就绪/.test(String(state.error || ''))) state.error = '';
          const visibleRows = (visible.conversations || []).map(normalizeListItem);
          mergeDiscoveredGroupRows(discoveryGroupRows(visible));
          const visibleConversations = visibleRows.filter(isAutomaticCollectibleConversation);
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
        }
      }
      assertContext(context);
      await refreshSelectedConversationState(context, selectedConversationId, previousConversationSignature, previousQueueSignature);
      assertContext(context);
      scheduleAiQueuePump({ ...context, conversationId: '' });
      // The safety poll reads one small page when the account is unchanged and
      // walks further only while rows remain newer than the saved watermark.
      // Avoid replacing the workbench DOM unless visible data actually changed.
      if ((!backgroundRefresh || !state.active) && collectionRenderSignature() !== beforeRenderSignature) renderPreservingScroll();
    } catch (error) {
      if (contextCurrent(context) && error?.message && !/过期操作/.test(error.message)) {
        state.error = error.message;
        liveDirectory().localReadError = text(error.message).slice(0, 240);
        const runtime = $('#wsLiveCollectionRuntime');
        if (runtime) runtime.innerHTML = liveCollectionRuntimeRows();
        // A transient collector/API error must not rebuild the visible WS
        // shell while the operator is chatting. Keep the error in state so a
        // later route refresh can show it without stealing the WebView.
        if (!backgroundRefresh || !state.active) renderPreservingScroll();
        else updateStatusDom();
      }
    } finally {
      if (contextCurrent(context)) {
        state.collectionRefreshing = false;
        if (state.collectionRefreshQueued && state.backgroundActive && !state.loading) {
          state.collectionRefreshQueued = false;
          queueMicrotask(() => { void refreshCollectionSummary({ background: backgroundRefresh }); });
        }
      }
    }
  }
  function requestAccountPipelineRefresh(accountId = '') {
    if (!modeAccount(accountId || state.activeAccountId)) return Promise.resolve({ skipped: true });
    if (!collectionReady('backgroundCollection', accountId || state.activeAccountId)) return Promise.resolve(collectionBlockedResult(accountId || state.activeAccountId));
    const targetId = text(accountId) || String(state.activeAccountId || 'default');
    if (!state.backgroundActive) return Promise.resolve({ skipped: true });
    if (targetId === String(state.activeAccountId || 'default')) return refreshCollectionSummary({ background: true });
    if (state.workspaceMode === 'dedicated') return Promise.resolve({ deferred: true, accountId: targetId });
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
        await refreshCollectionSummary({ background: true });
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
  function automaticAiGranted(context = captureContext('')) {
    const authorization = state.aiAuthorization;
    return !state.aiAuthorizationBusy && authorization?.active === true && authorization.authorization?.accountId === context.accountId;
  }
  async function refreshAiAuthorization(context = captureContext('')) {
    const operation = state.aiAuthorizationOperation;
    if (state.aiAuthorizationBusy) return null;
    try {
      const result = await api('/api/ws/ai-automation', {}, context);
      assertContext(context);
      if (operation !== state.aiAuthorizationOperation || state.aiAuthorizationBusy) return null;
      state.aiAuthorization = result;
      return result;
    } catch (error) {
      if (contextCurrent(context) && operation === state.aiAuthorizationOperation && !state.aiAuthorizationBusy) state.aiAuthorization = null;
      return null;
    }
  }
  function renderAiAuthorization() {
    const value = state.aiAuthorization, grant = value?.authorization, quote = value?.pricing?.quote;
    const current = activeConversation();
    const dollars = amount => '$' + (Number(amount || 0) / 1000000).toFixed(6);
    const auditLabel = { granted: '已明确授权', replaced: '授权已替换', pause: '已暂停', resume: '已明确恢复', revoke: '已撤销',
      reserved: '已保留本次费用上限', dispatched: '已通过发送检查', completed: '分析返回完成', failed: '请求失败，额度保留', unknown: '结果未确认，额度保留',
      'pricing-verified': '已核验官方计费文档', 'pricing-verification-failed': '计费核验失败，自动分析关闭', 'workspace-restored': '恢复数据后已撤销授权' };
    return `<section class="ws-analysis-section" data-ws-ai-authorization><strong>授权自动分析</strong>
      <p class="ws-muted">默认关闭。仅限当前普通账号中明确选定的一个已读私聊，完整原生历史不超过 16000 字符及 1000 条消息；授权最长 24 小时。手动分析保持原入口。</p>
      <p>${esc(value?.reason || '尚未读取授权状态。')}</p>
      ${quote ? `<p class="ws-muted">模型：${esc(quote.model)}；<a href="${esc(quote.source)}" target="_blank" rel="noopener">官方计费依据</a>，核验有效至 ${esc(quote.expiresAt || '尚未核验')}。${value.pricing.available ? `每次保守保留 ${dollars(value.pricing.perAttemptMicros)} USD。` : '无有效费率时不能授权。'}成功、取消或结果不明均不退还本地额度；不含税费或汇率。需已配置 OpenAI 官方密钥，账号的模型可用性由服务方决定。</p>` : ''}
      <button class="btn small" data-ws-action="ai-authorization-verify-pricing">核验官方计费依据（读取公开文档）</button>
      <p class="ws-muted">费率核验有效期为 30 天，可重新核验；价格或模型能力改变后需重新授权。额度按模型最多 272000 输入 token 与每次最多 4096 输出 token 的费用，再上浮 10% 保留，不按字符估算实际账单。</p>
      ${grant ? `<p>授权私聊：${esc(state.conversations.find(item => item.id === grant.conversationId)?.title || grant.conversationId)} · 总额 ${dollars(grant.budgetMicros)} · 已保留 ${dollars(grant.reservedMicros)}</p><div class="ws-row-actions"><button class="btn small" data-ws-action="ai-authorization-pause">暂停</button><button class="btn small" data-ws-action="ai-authorization-resume">明确恢复</button><button class="btn small" data-ws-action="ai-authorization-revoke">撤销</button></div>` : ''}
      <label>新授权总额度（USD）<input data-ws-ai-budget type="number" min="0.25" max="100" step="0.01" value="1"></label>
      <label><input data-ws-ai-consent type="checkbox">我同意将当前账号的“${esc(current?.title || '尚未选择私聊')}”聊天发送给上述服务，并按显示的费用上限自动分析；重新授权会建立新的额度。</label>
      <button class="btn small" data-ws-action="ai-authorization-grant" ${!current || state.workspaceMode !== 'ordinary' || !value?.pricing?.available ? 'disabled' : ''}>授权并开始</button>
      <button class="btn small" data-ws-action="ai-authorization-refresh">刷新授权</button>
      <details><summary>最近 30 条授权与费用审计</summary>${(value?.audit || []).map(item => `<p>${esc(item.createdAt)} · ${esc(auditLabel[item.action] || item.action)}${Number.isSafeInteger(item.detail?.reservedMicros) ? ` · 保留 ${dollars(item.detail.reservedMicros)} USD` : ''}${Number.isSafeInteger(item.detail?.budgetMicros) ? ` · 总额度 ${dollars(item.detail.budgetMicros)} USD` : ''}</p>`).join('') || '<p>尚无记录。</p>'}</details></section>`;
  }
  async function aiAuthorizationAction(action, element) {
    if (state.aiAuthorizationBusy && !['pause', 'revoke'].includes(action)) return;
    const operation = ++state.aiAuthorizationOperation;
    const context = captureContext(''), current = activeConversation();
    if (!modeAccount(context.accountId)) return;
    if (action === 'refresh') { await refreshAiAuthorization(context); if (contextCurrent(context)) render(); return; }
    const block = element?.closest?.('[data-ws-ai-authorization]');
    const grant = state.aiAuthorization?.authorization;
    const body = { action, authorizationId: grant?.id, expectedAuthorizationId: grant?.id || '', expectedRevision: Number(grant?.revision || 0) };
    if (action === 'grant') {
      if (!block?.querySelector('[data-ws-ai-consent]')?.checked) { toast('请先勾选具体私聊、服务和费用授权。', 'x'); return; }
      body.consent = true; body.conversationId = current?.id; body.quoteId = state.aiAuthorization?.pricing?.quote?.id;
      body.commandId = window.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`;
      body.budgetMicros = Math.round(Number(block.querySelector('[data-ws-ai-budget]')?.value) * 1000000);
    }
    if (action === 'resume') body.consent = true;
    state.aiAuthorizationBusy = true;
    try {
      let stopped = null;
      if (action === 'pause' || action === 'revoke') {
        state.aiAuthorization = { ...state.aiAuthorization, active: false };
        stopped = cancelBackgroundAiPump();
      }
      assertContext(context);
      const result = await api('/api/ws/ai-automation', { method: 'POST', body: JSON.stringify(body) }, context);
      if (stopped) await stopped.catch(() => {});
      assertContext(context);
      if (operation !== state.aiAuthorizationOperation) return;
      state.aiAuthorization = result;
      state.aiAuthorizationBusy = false;
      render();
      if (result.active && (action === 'grant' || action === 'resume')) scheduleAiQueuePump(context);
    } catch (error) { if (contextCurrent(context) && operation === state.aiAuthorizationOperation) toast(error.message || '自动分析授权失败。', 'x'); }
    finally { if (contextCurrent(context) && operation === state.aiAuthorizationOperation) state.aiAuthorizationBusy = false; }
  }
  function scheduleAiQueuePump(context = captureContext(''), retryScope = null) {
    const pumpContext = { ...context, conversationId: '' };
    const authorizationId = state.aiAuthorization?.authorization?.id;
    if (!authorizationId || !automaticAiGranted(pumpContext) || (retryScope && retryScope.authorizationId !== authorizationId) || !state.backgroundActive || !state.aiEnabled || !contextCurrent(pumpContext)) return aiPumpPromise || Promise.resolve({ skipped: true });
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
          const result = await resumeQueuedAiJobs(pumpContext, { signal: controller.signal, authorizationId, retryScope });
          succeeded += Number(result?.succeeded || 0);
        } while (!retryScope && state.aiAuthorization?.authorization?.id === authorizationId && aiPumpQueued && !controller.signal.aborted && contextCurrent(pumpContext) && state.backgroundActive && state.aiEnabled && !state.aiBusy);
        if (contextCurrent(pumpContext)) { state.aiBackgroundError = ''; state.aiRetryScope = null; }
        updateAiBackgroundErrorDom();
        return { succeeded };
      })().catch(error => {
        if (!isAiCancellation(error, controller.signal) && contextCurrent(pumpContext)) {
          aiPumpQueued = false;
          state.aiRetryScope = error.retryScope || null;
          state.aiBackgroundError = `后台 AI 分析待重试：${String(error?.message || 'AI 服务暂不可用').replace(/[\r\n\t]+/g, ' ').slice(0, 240)}`;
          // Background retries must never rebuild the visible WS shell. A
          // full redraw replaces the right scroll container and restores its
          // position one frame later, which makes the WebView and scrollbar
          // visibly jump while the operator is chatting.
          updateAiBackgroundErrorDom();
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
            if (state.backgroundActive && contextCurrent(pumpContext)) void refreshCollectionSummary({ background: true });
          });
        }
      });
    });
    return aiPumpPromise || Promise.resolve({ queued: true });
  }
  async function resumeQueuedAiJobs(context = captureContext(''), options = {}) {
    const signal = options.signal;
    if (!state.aiEnabled || state.loading || state.aiBusy) return { processed: 0, succeeded: 0 };
    await refreshAiAuthorization(context);
    throwIfAiCancelled(signal); assertContext(context);
    const grant = state.aiAuthorization?.authorization;
    if (!automaticAiGranted(context) || grant?.id !== options.authorizationId) return { processed: 0, succeeded: 0 };
    const conversation = state.conversations.find(item => item.id === grant.conversationId);
    const fingerprint = conversation && fullHistorySourceFingerprint(conversation);
    if (!fingerprint || !isAutomaticDirectConversation(conversation)) return { processed: 0, succeeded: 0 };
    if (conversation.unread === true || Number(conversation.unreadCount || 0) > 0 || text(conversation.collectionStatus) === 'skipped_unread') return { processed: 0, succeeded: 0 };
    const retryScope = { authorizationId: grant.id, conversationId: conversation.id, sourceFingerprint: fingerprint };
    if (options.retryScope && (options.retryScope.conversationId !== conversation.id || options.retryScope.sourceFingerprint !== fingerprint)) return { processed: 0, succeeded: 0 };
    const result = await analyzeStoredConversation(conversation, { ...context, conversationId: '' }, { signal, automatic: true, authorizationId: grant.id });
    await refreshAiAuthorization(context);
    if (result.cancelled) throw aiCancellationError();
    if (!result.ok && !result.pending && !result.disabled) throw Object.assign(new Error(result.reason || '授权自动分析尚未完成。'), { retryScope });
    return { processed: result.ok ? 1 : 0, succeeded: result.ok && !result.resumed ? 1 : 0 };
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
      const legacy = legacyByExternalId.get(`list-item-${normalized.index}`) || legacyByExternalId.get(`visible-${normalized.index}`);
      const externalId = text(normalized.externalId || legacy?.externalId || `visible-${normalized.index}`); const title = text(normalized.title || externalId);
      const preview = listPreviewText(normalized);
      const match = core.matchCustomer(getHost()?.state?.customers || [], {
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
        conversationType: 'direct',
        isGroup: false,
        customerId: matchedCustomerId,
        lastMessageText: preview,
        unreadCount: Number(item.unreadCount || 0),
        data: { discovery: 'visible-page', conversationType: 'direct', isGroup: false, previewOnly: true, historyLoaded: false, customerMatch: matchedCustomerId ? 'automatic' : 'pending' },
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
    // Ordinary WS analyses private chats only, so a job is never member-scoped.
    const memberScope = '';
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
  async function beginAiJob(conversation, transcript, context, feature = 'ws-analysis', authorizationId = '') {
    const idempotencyKey = aiJobIdempotencyKey(conversation, transcript) + (authorizationId ? ':authorization:' + authorizationId : '');
    const queued = await api('/api/ws/ai-jobs', {
      method: 'POST',
      body: JSON.stringify({
        conversationId: conversation.id,
        idempotencyKey,
        maxAttempts: 5,
        payload: {
          feature,
          ...(authorizationId ? { authorizationId } : {}),
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
    if (existing?.status === 'running') {
      await api('/api/ws/ai-jobs', { method: 'POST', body: JSON.stringify({ action: 'recover-expired', jobId: existing.id }) }, context);
      assertContext(context);
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
      const result = await api('/api/ws/ai-jobs', { method: 'POST', body: JSON.stringify({ action: 'fail', jobId: job.id, leaseToken: job.leaseToken, error: String(reason || 'AI 分析失败').slice(0, 1000), retryable: true }) }, context);
      if (contextCurrent(context)) state.aiQueueStats = result.stats || state.aiQueueStats;
      return true;
    } catch (error) {
      // Do not leave a claimed job looking healthy when the failure write
      // itself was rejected. The durable queue will recover the lease, while
      // the visible WS panel exposes an actionable retry state without a full
      // shell redraw or a swallowed exception.
      if (contextCurrent(context)) {
        state.aiRetryScope = null;
        state.aiBackgroundError = `后台 AI 队列回写失败：${String(error?.message || '任务状态暂时无法保存').replace(/[\r\n\t]+/g, ' ').slice(0, 240)}`;
        updateAiBackgroundErrorDom();
      }
      return false;
    }
  }
  async function completeAiJob(job, analysisId, context) {
    if (!job?.id || !analysisId) return;
    try {
      const result = await api('/api/ws/ai-jobs', { method: 'POST', body: JSON.stringify({ action: 'complete', jobId: job.id, leaseToken: job.leaseToken, analysisId }) }, context);
      if (contextCurrent(context)) state.aiQueueStats = result.stats || state.aiQueueStats;
      return true;
    } catch (error) {
      if (contextCurrent(context)) {
        state.aiRetryScope = null;
        state.aiBackgroundError = `后台 AI 队列完成状态未保存：${String(error?.message || '任务状态暂时无法保存').replace(/[\r\n\t]+/g, ' ').slice(0, 240)}`;
        updateAiBackgroundErrorDom();
      }
      return false;
    }
  }
  // V5.0 §15 incremental analysis: remember the analysed content per
  // conversation so an unchanged chat is not analysed again.
  async function persistAnalysedFingerprint(conversation, fingerprint, context) {
    if (!conversation?.externalId || !fingerprint) return;
    const analysedAt = new Date().toISOString();
    try {
      await api('/api/ws/conversations', { method: 'POST', body: JSON.stringify({ externalId: conversation.externalId, data: { lastAnalyzedFingerprint: fingerprint, lastAnalyzedAt: analysedAt } }) }, context);
    } catch { return; }
    const local = state.conversations.find(item => String(item.id) === String(conversation.id));
    if (local) local.data = { ...(local.data || {}), lastAnalyzedFingerprint: fingerprint, lastAnalyzedAt: analysedAt };
  }
  async function analyzeStoredConversation(conversation, context, options = {}) {
    const signal = options.signal;
    throwIfAiCancelled(signal);
    if (!state.aiEnabled) return { ok: false, reason: 'AI 分析已关闭。', disabled: true };
    if (!window.zhikeAI?.request || !window.zhikeAI?.status) return { ok: false, reason: '当前运行环境不支持 AI 安全桥接。' };
    if (!conversation?.id) return { ok: false, reason: '缺少会话标识。' };
    if (options.automatic === true && (!automaticAiGranted(context) || state.aiAuthorization.authorization.id !== options.authorizationId || state.aiAuthorization.authorization.conversationId !== conversation.id)) return { ok: false, disabled: true, reason: '当前私聊尚未明确授权自动分析。' };
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
    // Ordinary WS analyses private chats only. A group is never analysed or
    // written to a customer here (there is no VIP group exception).
    if (isExplicitGroupConversation(currentConversation)) return { ok: false, reason: ordinaryGroupExclusionMessage('AI 分析') };
    // V5.0 §15 incremental analysis: an explicit range narrows the transcript,
    // and an unchanged automatic conversation is skipped instead of paying for
    // a repeat run that would also churn CRM fields and reminders.
    const incremental = window.ZhikeAnalysisIncremental;
    const scope = incremental?.selectMessagesForAnalysis?.(messages, { rangeStart: options.rangeStart, rangeEnd: options.rangeEnd }) || { messages, ranged: false, dropped: 0, unknownTime: 0, total: messages.length };
    const analysisMessages = scope.messages;
    if (!analysisMessages.length) return { ok: false, reason: '所选时间范围内没有可分析消息。' };
    if (options.automatic === true && options.force !== true && scope.ranged !== true) {
      const unchanged = incremental?.shouldSkipAnalysis?.({ currentFingerprint: sourceFingerprint, lastFingerprint: text(currentConversation?.data?.lastAnalyzedFingerprint) });
      if (unchanged?.skip && unchanged.reason === 'unchanged') return { ok: true, skipped: true, reason: '聊天没有新增内容，已跳过重复分析。', analysis: null };
    }
    const chunks = core.splitHistoryTranscript(analysisMessages, { maxChars: 16000 });
    if (!chunks.length) return { ok: false, reason: '聊天没有可分析的文本，媒体消息原记录已保留。' };
    const transcript = { text: chunks.map(item => item.text).join('\n'), included: analysisMessages.length, total: analysisMessages.length, truncated: false, chunkCount: chunks.length };
    transcript.historyComplete = messageHistory.complete;
    transcript.historyLoaded = messageHistory.loaded;
    transcript.historyTotal = messageHistory.total;
    transcript.analysisScope = { ranged: scope.ranged === true, rangeStart: scope.rangeStart || '', rangeEnd: scope.rangeEnd || '', dropped: Number(scope.dropped || 0), unknownTime: Number(scope.unknownTime || 0), total: Number(scope.total || messages.length) };
    transcript.sourceFingerprint = sourceFingerprint;
    transcript.directionVersion = transcriptDirectionVersion(currentConversation, sourceFingerprint);
    let aiJob;
    try {
      aiJob = await beginAiJob(conversation, transcript, context, messageHistory.complete ? 'ws-full-history-analysis' : 'ws-list-preview-analysis', options.automatic === true ? options.authorizationId : '');
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
    const service = await window.zhikeAI.status(options.automatic === true ? { provider: 'openai' } : {}).catch(() => ({ configured: false }));
    if (signal?.aborted) {
      await failAiJob(aiJob?.job, context, 'AI 分析已取消，任务保留待重试。');
      return { ok: false, reason: 'AI 分析已取消。', cancelled: true };
    }
    if (!service.configured) {
      const reason = options.automatic === true
        ? '自动分析需要配置 OpenAI 官方 API Key。'
        : '请在 GPT 运营助手的设置中配置 AI 服务商和 API Key。';
      await failAiJob(aiJob.job, context, reason);
      return { ok: false, reason };
    }
    try {
      const analysis = await analyzeHistoryChunks(chunks, conversation, context, aiJob.job, {
        signal,
        automatic: options.automatic === true,
      });
      throwIfAiCancelled(signal);
      const latestConversation = state.conversations.find(item => String(item.id) === String(conversation.id)) || conversation;
      if (fullHistorySourceFingerprint(latestConversation) !== sourceFingerprint) throw new Error('分析期间聊天已更新，旧分析进度已保留；等待重新采集完整历史。');
      analysis.transcriptInfo = { ...transcript, text: undefined, analyzedChunks: chunks.length };
       const saved = await api('/api/ws/analyses', { method: 'POST', body: JSON.stringify({ conversationId: conversation.id, jobId: aiJob.job.id, leaseToken: aiJob.job.leaseToken, memberIdentity: null, result: analysis, confidence: analysis.confidence, providerName: analysis.providerName, model: analysis.model }) }, context);
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
      // V5.0 §15: record what was analysed so the next poll of an unchanged
      // conversation is skipped rather than re-billed.
      if (scope.ranged !== true) await persistAnalysedFingerprint(currentConversation, sourceFingerprint, context);
      return { ok: true, analysis, analysisMeta: saved };
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
    if (options.automatic === true) {
      throwIfAiCancelled(signal); assertContext(context);
      if (chunks.length !== 1 || options.memberScoped === true || !automaticAiGranted(context)) throw new Error('当前自动分析仅支持已授权的单段普通私聊。');
      const result = await window.zhikeAI.wsautomatic({ accountId: context.accountId, conversationId: conversation.id, jobId: job.id, leaseToken: job.leaseToken }, { signal, accountId: context.accountId });
      throwIfAiCancelled(signal); assertContext(context);
      const parsed = core.parseAiResult(result?.text || '');
      if (parsed.error) throw new Error(parsed.error);
      return { ...parsed, providerName: result.providerName || '', model: result.model || '', automaticAttemptId: result.attemptId || '' };
    }
    // Ordinary WS analyses private chats only; nothing is scoped to a group member.
    const memberScoped = false;
    const memberIdentity = null;
    const memberKey = '';
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
        context: { feature: 'ws-history-segment', conversationId: conversation.id, memberScoped, memberKey, chunkNumber: chunk.chunkNumber, chunkCount: chunk.chunkCount, startMessage: chunk.startIndex + 1, endMessage: chunk.endIndex + 1 },
      }, { signal });
      throwIfAiCancelled(signal);
      assertContext(context);
      const parsed = core.parseAiResult(result?.text || '');
      if (parsed.error) throw new Error(parsed.error);
      parsed.providerName = result.providerName || ''; parsed.model = result.model || '';
      analyses.push(parsed);
      if (job?.id) await api('/api/ws/ai-jobs', { method: 'POST', body: JSON.stringify({ action: 'checkpoint', jobId: job.id, leaseToken: job.leaseToken, completedChunks: chunk.chunkNumber, chunkCount: chunks.length, result: core.mergeAiAnalyses(analyses) }) }, context);
    }
    const merged = core.mergeAiAnalyses(analyses);
    if (chunks.length > 1) {
      throwIfAiCancelled(signal);
      assertContext(context);
      if (!state.aiEnabled) throw new Error('AI 分析已关闭。');
      const synthesis = JSON.stringify({ summary: merged.summary, contact: merged.contact, profileFacts: merged.profileFacts, recentAnalysis: analyses.at(-1), instruction: '合并各段已提取证据；资金实力使用全部证据，聊天粘度和跟进意愿以最近会话为准。不得把历史兴趣当成当前意愿。' });
      const result = await window.zhikeAI.request({ assistantMode: 'operations', analysisDepth: 'standard', input: core.buildNaturalChatAnalysisPrompt(synthesis, { conversationId: conversation.id, memberIdentity }), context: { feature: 'ws-history-synthesis', conversationId: conversation.id, memberScoped, memberKey, chunkCount: chunks.length } }, { signal });
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
    assertContext(context);
    const directItems = (Array.isArray(items) ? items : [])
      .map(normalizeListItem)
      .filter(isAutomaticCollectibleConversation);
    if (state.listSyncBusy || !directItems.length) return { synced: 0, analyzed: 0 };
    state.listSyncBusy = true;
    const operation = state.listSyncOperation = Number(state.listSyncOperation || 0) + 1;
    const presentationGeneration = state.accountPresentationGeneration;
    const workspaceGeneration = state.workspaceGeneration;
    const runId = String(state.collectionRun?.id || '');
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
          if (runId) {
            const checkpoint = `list-only-${stableHash(JSON.stringify([externalId, text(item.title), text(item.lastMessageAt), Number(item.unreadCount || 0)]))}`;
            if (!preserveHistoryCollectionState(conversation) || unreadConversation) {
              await api('/api/ws/collection-items', { method: 'PATCH', body: JSON.stringify({
                runId,
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
        if (runId) {
          // List previews must never overwrite full-history/history-stale
          // coverage. Native ingest owns source fingerprint invalidation and
          // will queue a fresh capture when the real list fingerprint changes.
          if (!preserveHistoryCollectionState(conversation) || unreadConversation) {
            const itemPatch = { runId, conversationId: conversation.id, status: unreadConversation ? 'skipped_unread' : 'completed', coverageStatus: unreadConversation ? 'unread-skipped' : 'list-preview', checkpoint: fingerprint };
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
        assertContext(context);
        synced += results.reduce((sum, value) => sum + Number(value?.synced || 0), 0);
        progressed += results.reduce((sum, value) => sum + Number(value?.progressed || 0), 0);
      }
      // AI may spend up to the provider budget on a single conversation.
      // Queue it on the independent single-lane pump so list persistence and
      // collection progress never wait for an AI network request.
      scheduleAiQueuePump({ ...context, conversationId: '' });
      if (progressed) {
        if (runId) {
          const itemsResult = await api(`/api/ws/collection-items?runId=${encodeURIComponent(runId)}`, {}, context);
          assertContext(context);
          const items = Array.isArray(itemsResult.items) ? itemsResult.items : [];
          const completed = items.filter(item => item.status === 'completed').length;
          const analyzedItems = items.filter(item => item.analysisStatus === 'completed').length;
          const failed = items.filter(item => item.status === 'failed').length;
          const retryable = items.filter(item => ['failed', 'retryable'].includes(item.status) || ['retryable', 'failed'].includes(item.analysisStatus)).length;
          const runResult = await api('/api/ws/collection-runs', { method: 'PATCH', body: JSON.stringify({ id: runId, status: 'discovering', total: items.length, discovered: items.length, completed, analyzed: Math.max(analyzedItems, analyzed), failed, retryable, cursor: JSON.stringify({ mode: 'list-preview', synced, progressed, analyzed, syncedAt: nowIso() }), lastSuccessAt: nowIso() }) }, context);
          assertContext(context);
          if (runResult?.run && String(state.collectionRun?.id || '') === runId) state.collectionRun = runResult.run;
        }
        const refreshed = await loadConversationDeltaPages(context);
        assertContext(context);
        applyConversationInventory(refreshed, context.accountId);
        reconcilePersonalConversationSelection();
      }
      if (analyzed && getHost()?.refreshState) await getHost().refreshState().catch(() => {});
      return { synced, progressed, analyzed };
    } finally {
      // A same-account directory refresh invalidates the response sequence,
      // but the operation still owns its lock. A new account/mode does not.
      if (operation === state.listSyncOperation && context.accountId === state.activeAccountId && presentationGeneration === state.accountPresentationGeneration
          && workspaceGeneration === state.workspaceGeneration) state.listSyncBusy = false;
    }
  }
  async function createCollectionRun() {
    if (!collectionReady('automaticHistory')) return rejectCollectionAction();
    const context = captureContext('');
    try {
      const result = await api('/api/ws/collection-runs', { method: 'POST', body: JSON.stringify({}) }, context);
      assertContext(context);
      state.collectionRun = result.run;
      render();
      if (collectionReady('automaticHistory')) await collectAllReadConversations();
      else toast('已创建采集任务，请登录并保持 WS 连接后开始自动采集');
    } catch (error) { if (contextCurrent(context)) { state.error = error.message; render(); } }
  }
  async function collectAllReadConversations() {
    if (!collectionReady('automaticHistory')) return rejectCollectionAction();
    if (state.workspaceMode !== 'ordinary') return;
    if (state.busy.readHistory) return;
    const context = captureContext('');
    state.busy.readHistory = true;
    state.readHistoryAutoStarted = true;
    state.error = '';
    render();
    try {
      const result = await wsBridge('collect-all-read', context);
      assertContext(context);
      if (!result?.supported || !result.started) throw new Error(result?.error || '当前 WS 页面不支持已读会话自动采集。');
      const directory = liveDirectory();
      directory.historyFailures = 0; directory.historyRetryAt = 0; directory.historyDetail = '已启动已读会话历史采集';
      directory.historyObservedAt = nowIso();
      state.readHistorySkipped = Array.isArray(result.skippedUnread) ? result.skippedUnread : [];
      toast(`已启动已读会话自动采集${state.readHistorySkipped.length ? `，当前窗口跳过未读 ${state.readHistorySkipped.length} 个` : ''}。`);
    } catch (error) {
      if (contextCurrent(context)) {
        const directory = liveDirectory();
        directory.historyFailures = (directory.historyFailures || 0) + 1;
        directory.historyRetryAt = Date.now() + Math.min(300000, 12000 * 2 ** Math.min(directory.historyFailures - 1, 5));
        directory.historyDetail = String(error?.message || '历史采集未启动').slice(0, 250);
        directory.historyObservedAt = nowIso();
        state.readHistoryAutoStarted = false; state.busy.readHistory = false;
        state.error = error.message || '已读会话自动采集失败。'; toast(state.error, 'x'); render();
      }
      return;
    }
    try {
      if (!state.collectionRun?.id) {
        const created = await api('/api/ws/collection-runs', { method: 'POST', body: JSON.stringify({}) }, context);
        assertContext(context);
        state.collectionRun = created.run;
      }
      const running = await api('/api/ws/collection-runs', { method: 'PATCH', body: JSON.stringify({ id: state.collectionRun.id, status: 'running' }) }, context);
      assertContext(context);
      if (running?.run) state.collectionRun = running.run;
      void refreshCollectionSummary({ background: true });
      void loadGroupMonitor({ background: true, silent: true });
    } catch (error) {
      if (contextCurrent(context)) state.error = '已启动实时采集，本机任务进度暂时无法保存。';
    } finally {
      if (contextCurrent(context)) { state.busy.readHistory = false; render(); }
    }
  }
  function maybeStartAutomaticReadHistoryCollection(context = captureContext()) {
    if (!collectionReady('automaticHistory', context.accountId)) return collectionBlockedResult(context.accountId);
    if (!state.backgroundActive || !collectionReady('automaticHistory', context.accountId) || state.readHistoryAutoStarted || state.busy.readHistory) return;
    if (state.collectionRun && ['paused', 'stopped', 'completed'].includes(state.collectionRun.status)) return;
    if ((state.liveDirectory?.historyRetryAt || 0) > Date.now()) return;
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
    const context = captureContext('');
    const runId = state.collectionRun.id;
    try {
      const capability = collectionCapability(context.accountId);
      if (status === 'paused' || status === 'stopped') {
        if (capability.state === 'available') {
          const paused = await wsBridge('pause-collector', context);
          assertContext(context);
          if (paused?.ok === false || paused?.error || collectionCapability(context.accountId).collectorState !== 'paused') throw new Error(paused?.error || '后台采集暂停尚未确认，任务状态未修改。');
        }
      } else if (status === 'running' || status === 'discovering') {
        if (capability.state === 'available' && capability.collectorState === 'paused') {
          await wsBridge('resume-collector', context);
          assertContext(context);
        }
        if (!collectionReady('automaticHistory', context.accountId)) return rejectCollectionAction(context);
      }
      const result = await api('/api/ws/collection-runs', { method: 'PATCH', body: JSON.stringify({ id: runId, status }) }, context);
      assertContext(context);
      state.collectionRun = result.run;
      toast(status === 'paused' ? '采集已暂停' : status === 'stopped' ? '采集已停止' : '采集已继续'); render();
      if (status === 'running') await resumeCollectionFromCheckpoint(context);
    } catch (error) { if (contextCurrent(context)) { state.error = error.message; render(); } }
  }
  async function resumeCollectionFromCheckpoint(context = captureContext()) {
    if (!collectionReady('automaticHistory', context.accountId)) return rejectCollectionAction(context);
    if (!state.collectionRun?.id || !['running','discovering'].includes(state.collectionRun.status) || !collectionReady('automaticHistory', context.accountId)) return;
    assertContext(context);
    const visible = await readOrdinaryCollectorDirectory(context);
    assertContext(context);
    if (!visible?.supported) return;
    const visibleRows = (Array.isArray(visible.conversations) ? visible.conversations : []).map(normalizeListItem);
    mergeDiscoveredGroupRows(discoveryGroupRows(visible));
    const items = visibleRows.filter(isAutomaticCollectibleConversation);
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
    if (!collectionReady('backgroundCollection')) return rejectCollectionAction();
    if (state.workspaceMode === 'dedicated') return scanGroupMonitorTargets();
    const context = captureContext();
    try {
      const result = await readOrdinaryCollectorDirectory(context); assertContext(context); if (!result?.supported) throw new Error(result?.error || '当前页面结构未识别'); const visibleRows = (result.conversations || []).map(normalizeListItem); mergeDiscoveredGroupRows(discoveryGroupRows(result)); state.discoveredConversations = visibleRows.filter(isAutomaticCollectibleConversation);
      const queued = await enqueueDiscoveredConversations(state.discoveredConversations, false, context);
      const listSync = await syncConversationListPreviews(state.discoveredConversations, context);
      assertContext(context);
      state.visibleConversationFingerprint = visibleConversationFingerprint(state.discoveredConversations);
      if (!state.discoveredConversations.length || !state.collectionRun) {
        toast(result.scanning ? '正在扫描会话列表，等待个人会话' : '当前未发现可采集的个人会话');
        render();
        return;
      }
      const runResult = await api('/api/ws/collection-runs', { method: 'PATCH', body: JSON.stringify({ id: state.collectionRun.id, status: 'discovering', discovered: state.discoveredConversations.length, total: state.discoveredConversations.length, cursor: JSON.stringify({ lastExternalId: text(state.discoveredConversations.at(-1)?.externalId || ''), discovered: state.discoveredConversations.length, scannedAt: nowIso() }), lastSuccessAt: nowIso() }) }, context);
      assertContext(context);
      state.collectionRun = runResult.run;
      toast(`已发现 ${state.discoveredConversations.length} 个会话，入队 ${queued} 个${listSync.synced ? `，列表消息 ${listSync.synced} 条` : ''}`); render();
    }
    catch (error) { if (contextCurrent(context)) { state.error = error.message; render(); } }
  }
  async function captureVisibleMessages() {
    const current = activeConversation();
    const context = captureContext(current?.id || '');
    state.visibleForegroundChat = null;
    try {
      const result = await wsBridge('capture-visible-messages', context);
      assertContext(context);
      if (!result?.supported || result.accountId !== context.accountId || !Array.isArray(result.messages) || !result.messages.length)
        throw new Error(result?.error || '当前页面没有可识别的可见消息');
      const key = text(result.conversationKey);
      const messages = result.messages.filter(row => text(row.conversationKey) === key && text(row.text || row.body));
      if (!key || !messages.length) throw new Error('当前聊天身份或可见消息未确认，请在 WhatsApp 中打开聊天后重试。');
      if (state.workspaceMode !== 'ordinary' || isExplicitGroupConversation(result)) throw new Error('此入口读取普通 WS 当前的一对一聊天，群组请从专用 WS 查看。');
      if (!current || !canManuallyProcessConversation(current) || key !== text(current.externalId) || !/@(?:c\.us|s\.whatsapp\.net|lid)$/i.test(key)) {
        state.visibleForegroundChat = { accountId: context.accountId, title: text(result.displayName || key),
          messages: messages.slice(-100).map(row => text(row.text || row.body)), observedAt: nowIso() };
        toast(`已读取前台聊天的 ${state.visibleForegroundChat.messages.length} 条可见消息。`); render();
        return;
      }
      const draft = currentDraft(); draft.captureText = messages.map(item => item.text || item.body).join('\n'); state.captureDirection = 'receive'; render();
      await importVisible(context);
      assertContext(context);
      const analysisResult = state.aiEnabled && state.messages.length ? await analyzeConversation(context) : { ok: false, disabled: !state.aiEnabled };
      if (!contextCurrent(context)) return;
      if (state.collectionRun?.id) { await api('/api/ws/collection-items', { method: 'PATCH', body: JSON.stringify({ runId: state.collectionRun.id, conversationId: current.id, status: 'completed', analysisStatus: analysisResult.ok ? 'completed' : analysisResult.disabled ? 'pending' : 'retryable', coverageStatus: 'visible', checkpoint: String(result.messages.length), lastError: analysisResult.ok || analysisResult.disabled ? '' : String(analysisResult.reason || '').slice(0, 500) }) }, context); await api('/api/ws/collection-runs', { method: 'PATCH', body: JSON.stringify({ id: state.collectionRun.id, cursor: JSON.stringify({ conversationId: current.id, messageCount: result.messages.length, capturedAt: nowIso() }), lastSuccessAt: nowIso() }) }, context); }
      toast(`已采集当前会话 ${result.messages.length} 条可见消息`);
    } catch (error) {
      if (current?.id && contextCurrent(context) && state.collectionRun?.id) { try { await api('/api/ws/collection-items', { method: 'PATCH', body: JSON.stringify({ runId: state.collectionRun.id, conversationId: current.id, status: 'failed', attempts: 1, lastError: error.message }) }, context); } catch {} }
      if (contextCurrent(context)) { state.error = error.message; render(); }
    }
  }
  function renderVisibleForegroundChat() {
    const chat = state.visibleForegroundChat;
    if (!chat || chat.accountId !== state.activeAccountId) return '';
    return `<section class="ws-card" data-ws-visible-chat><strong>${esc(chat.title)} · 前台可见消息</strong><time>${esc(displayTime(chat.observedAt))}</time>${chat.messages.map(message => `<p>${esc(message)}</p>`).join('')}</section>`;
  }
  function renderFollowupAlerts(alerts = state.followupAlerts || []) {
    if (!alerts.length) return '<p class="ws-muted">当前没有自动识别出的待跟进客户。</p>';
    return `<div class="ws-followup-alerts">${alerts.map(item => {
      const confidence = Math.round(Number(item.confidence || 0) * 100);
      // V5.0 §18: show the reminder state, its owner, and whether the date was
      // stated in chat. A cadence suggestion is labelled 建议时间（待确认）.
      const alertState = item.displayStatus || { key: item.status === 'done' ? 'done' : item.status === 'dismissed' ? 'cancelled' : 'pending', label: item.status === 'done' ? '已完成' : item.status === 'dismissed' ? '已取消' : '待处理' };
      const timeLabel = item.followupTime ? `${item.timeConfirmed === false ? '建议时间（待确认）' : '计划'} ${esc(String(item.followupTime).slice(0, 16))}` : '未设置时间';
      return `<article class="ws-followup-alert ${esc(item.priority || 'today')}" data-alert-status="${esc(alertState.key || 'pending')}">
        <div class="ws-followup-alert-head"><strong>${esc(item.title || item.externalId || '未命名客户')}</strong><span class="ws-alert-status">${esc(alertState.label || '待处理')}</span><span>${esc(item.reason || item.intent || '建议跟进')}</span></div>
        <p>${esc(item.objective || item.nextStep || item.summary || '请人工查看会话并确认下一步')}</p>
        ${item.opener ? `<p class="ws-followup-opener"><strong>建议开场：</strong>${esc(item.opener)}</p>` : ''}
        ${Array.isArray(item.talkingPoints) && item.talkingPoints.length ? `<p class="ws-muted">话题：${item.talkingPoints.map(esc).join(' → ')}</p>` : ''}
        ${Array.isArray(item.avoidTopics) && item.avoidTopics.length ? `<p class="ws-error-line">避免：${item.avoidTopics.map(esc).join('；')}</p>` : ''}
        <div class="ws-followup-alert-meta"><span>${timeLabel}</span><span>负责人 ${esc(item.assistant || '未分配')}</span><span>优先级 ${Number(item.priorityScore || 0)}/100</span><span>置信度 ${confidence}%</span></div>
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
  function wsCollectionPipelineStages() {
    const run = state.collectionRun;
    const fullHistoryCount = state.conversations.filter(item => item.data?.historyLoaded === true && Number(item.data?.directionVersion || 0) >= 4 && Boolean(fullHistorySourceFingerprint(item))).length;
    const discovered = Math.max(0, Number(run?.discovered || 0));
    const skipped = Math.max(0, Number(run?.skipped || 0));
    const analyzed = Math.max(0, Number(run?.analyzed || 0));
    const retryable = Math.max(0, Number(run?.retryable || 0));
    const pendingHistory = Math.max(0, discovered - fullHistoryCount - skipped);
    const profileReady = Math.min(analyzed, Number(run?.completed || analyzed));
    const pipeline = [
      ['历史列表发现', discovered, run ? '已同步' : '等待登录'],
      ['完整历史', fullHistoryCount, pendingHistory ? `待补采 ${pendingHistory}` : '已完成'],
      ['AI 分析', analyzed, fullHistoryCount > analyzed ? `队列 ${fullHistoryCount - analyzed}` : '已同步'],
      ['档案与任务', profileReady, state.aiEnabled ? '本机已有结果' : 'AI 已关闭'],
    ];
    return { run, fullHistoryCount, discovered, skipped, analyzed, retryable, pendingHistory, profileReady, pipeline };
  }
  function renderWsCockpit() {
    const run = state.collectionRun;
    const status = state.wsStatus === '已连接' ? '已连接' : state.wsStatus || '等待登录';
    const background = collectorStatusLabel();
    const activeId = String(state.activeAccountId || '');
    const accountPills = state.accounts.length
      ? state.accounts.map(account => {
        const active = String(account.id) === activeId;
        const accountStatus = accountStatusLabel(account);
        return `<button class="ws-account-pill ${active ? 'active' : ''}" data-ws-action="switch-account" data-account-id="${esc(account.id)}" aria-pressed="${active ? 'true' : 'false'}"><i></i><span>${esc(accountDisplayName(account))}</span><small>${esc(accountStatus)}</small></button>`;
      }).join('')
      : '<span class="ws-cockpit-empty">暂无账号</span>';
    const collectionAction = renderCollectorControls();
    return `<div class="ws-command-rail" aria-label="WS 账号与采集控制舱"><div class="ws-cockpit-bar">
      <div class="ws-cockpit-accounts" aria-label="WS 账号列表"><span class="ws-cockpit-label">账号</span>${accountPills}<button class="ws-account-pill add" data-ws-action="create-account" ${state.accountBusy ? 'disabled' : ''}>＋ 添加账号</button></div>
      <div class="ws-cockpit-controls" aria-label="WS 连接与采集控制"><button class="ws-cockpit-action primary" data-ws-action="open" ${state.busy.connection ? 'disabled' : ''}>${state.wsStatus === '已连接' ? '已打开 WS' : '扫码登录'}</button><span class="ws-cockpit-status ${state.wsStatus === '已连接' ? 'is-online' : ''}" title="WS 连接状态" aria-label="WS 连接状态"><i></i>${esc(status)}</span><span class="ws-cockpit-status" title="${esc(collectionCapability().state === 'available' ? collectionCapability().reason : collectionBlockedResult().error)}" aria-label="${esc(background)}"><i></i>${esc(background)}</span>${collectionAction}<button class="ws-cockpit-action" data-ws-action="reconnect">重新连接</button></div>
    </div></div>`;
  }
  function assistDrawerTabMeta(tab) {
    const meta = {
      ai: { title: 'AI 分析', subtitle: '从完整聊天提取客户意向、资质与下一步动作' },
      profile: { title: '客户档案', subtitle: '只补齐已匹配客户的缺失资料，不创建重复客户' },
      reply: { title: '回复建议', subtitle: '翻译与建议仅供预览，发送前由你确认' },
      broadcast: { title: '群发中心', subtitle: '媒体先上传入队，逐个会话确认后发送并留审计' },
      export: { title: '数据导出', subtitle: '导出客户、联系人、群组、消息、分析和媒体索引' },
      diagnostics: { title: '采集诊断', subtitle: '当前后台能力、历史采集记录与翻译状态' },
    };
    return meta[ASSIST_DRAWER_TABS.has(String(tab)) ? String(tab) : 'ai'] || meta.ai;
  }
  function renderWsAssistTabs() {
    // Accessible tab titles: title="AI 分析", title="客户档案", title="回复建议", title="采集诊断".
    const tabs = [['ai', 'AI 分析'], ['profile', '客户档案'], ['reply', '回复建议'], ['broadcast', '会话批量发送'], ['export', '数据导出'], ['diagnostics', '采集诊断']].filter(([id]) => state.workspaceMode !== 'dedicated' || id !== 'broadcast');
    return `<nav class="ws-assist-tabs" aria-label="WS 辅助面板" role="tablist">${tabs.map(([key, label]) => {
      const active = state.assistDrawerTab === key;
      return `<button class="ws-assist-tab ${active ? 'active' : ''}" data-ws-action="focus-assist" data-assist-target="${key}" data-assist-drawer-tab="${key}" title="${label}" role="tab" aria-selected="${active ? 'true' : 'false'}">${label}</button>`;
    }).join('')}</nav>`;
  }
  function renderWsFlowStrip() {
    const { run, fullHistoryCount, discovered, analyzed, profileReady } = wsCollectionPipelineStages();
    const followupCount = Array.isArray(state.followupAlerts) ? state.followupAlerts.length : 0;
    const stages = [
      ['列表同步', discovered, run ? '会话列表已同步' : '等待登录'],
      ['完整历史', fullHistoryCount, fullHistoryCount ? '双方消息已落库' : collectorStatusLabel()],
      ['AI 分析', analyzed, state.aiEnabled ? '本机历史分析' : 'AI 已关闭'],
      ['档案补齐', profileReady, profileReady ? '只补现有客户空字段' : '等待分析结果'],
      ['跟进任务', followupCount, followupCount ? '已进入任务中心' : '暂无待跟进'],
    ];
    return `<div class="ws-process-rail"><section class="ws-flow-strip" aria-label="采集与跟进流程"><div class="ws-flow-heading"><strong>采集与跟进流程</strong><span>本机历史与当前采集能力分开显示</span></div><div class="ws-flow-stages">${stages.map(([label, value, detail], index) => `<div class="ws-flow-node ${value ? 'has-progress' : ''}"><span class="ws-flow-index">${index + 1}</span><div><strong>${esc(label)}</strong><b>${Number(value).toLocaleString()}</b><small>${esc(detail)}</small></div></div>${index < stages.length - 1 ? '<span class="ws-flow-arrow" aria-hidden="true">›</span>' : ''}`).join('')}</div></section></div>`;
  }
  function captureWorkspaceNavScroll() {
    const node = $('.ws-workspace-nav-list');
    if (node) state.wsWorkspaceNavScroll = { top: Number(node.scrollTop || 0), left: Number(node.scrollLeft || 0) };
  }
  function restoreWorkspaceNavScroll() {
    const node = $('.ws-workspace-nav-list'), saved = state.wsWorkspaceNavScroll;
    if (!node || !saved) return;
    const maxTop = Math.max(0, Number(node.scrollHeight || 0) - Number(node.clientHeight || 0));
    const maxLeft = Math.max(0, Number(node.scrollWidth || 0) - Number(node.clientWidth || 0));
    const top = Math.min(Math.max(0, saved.top), maxTop), left = Math.min(Math.max(0, saved.left), maxLeft);
    if (Math.abs(Number(node.scrollTop || 0) - top) > 0.5) node.scrollTop = top;
    if (Math.abs(Number(node.scrollLeft || 0) - left) > 0.5) node.scrollLeft = left;
  }
  function renderWsWorkspaceNav() {
    // CSS contract: .ws-workspace-nav.is-collapsed keeps the WebView anchor
    // mounted while only the secondary navigation rail changes width.
    const collapsed = Boolean(state.wsWorkspaceNavCollapsed);
    const active = workspaceViewAllowed(state.wsWorkspaceView) ? state.wsWorkspaceView : 'overview';
    return `<aside class="ws-workspace-nav ${collapsed ? 'is-collapsed' : ''}" aria-label="WS 工作台功能导航"><div class="ws-workspace-nav-heading"><span class="ws-workspace-nav-mark">WS</span><div><strong>${workspaceLabel()}</strong><small>账号用途创建后固定</small></div><button type="button" class="ws-workspace-nav-toggle" data-ws-action="toggle-workspace-nav" aria-expanded="${collapsed ? 'false' : 'true'}" title="${collapsed ? '展开 WS 工作区导航' : '收起 WS 工作区导航'}">${collapsed ? '›' : '‹'}</button></div><div class="ws-workspace-mode-switch" aria-label="切换 WS 用途">${['ordinary', 'dedicated'].map(mode => `<button type="button" data-ws-workspace-mode="${mode}" aria-pressed="${state.workspaceMode === mode}">${workspaceLabel(mode)}</button>`).join('')}</div><nav class="ws-workspace-nav-list">${workspaceViews().map(item => `<button type="button" class="ws-workspace-nav-item ${item.id === active ? 'active' : ''}" data-ws-workspace-view="${item.id}" aria-current="${item.id === active ? 'page' : 'false'}" title="${esc(item.label)} · ${esc(item.hint)}"><span class="ws-workspace-nav-icon" aria-hidden="true"><svg class="zk-icon" viewBox="0 0 24 24" focusable="false"><use href="#i-${esc(item.icon)}"/></svg></span><span class="ws-workspace-nav-copy"><strong>${esc(item.label)}</strong><small>${esc(item.hint)}</small></span></button>`).join('')}</nav><div class="ws-workspace-nav-foot"><span class="ws-workspace-nav-status" title="${esc(collectionCapability().state === 'available' ? collectionCapability().reason : collectionBlockedResult().error)}"><i></i><span>${esc(collectorStatusLabel())}</span></span><button type="button" class="ws-workspace-return" data-ws-action="return-zhike" title="返回知客"><span aria-hidden="true">↩</span><span>返回知客</span></button></div></aside>`;
  }
  function groupDirectoryState() {
    const page = wsWorkspacePageState('groups');
    page.groupFilters ||= { memberCount: 'all', permission: 'all', collection: 'all' };
    page.selectedGroupIds ||= [];
    return page;
  }
  const groupDrafts = window.ZhikeWsGroupDrafts?.create({
    getScope: () => state.active && state.workspaceMode === 'dedicated' && state.wsWorkspaceView === 'group-broadcast'
      && getHost()?.state?.view === 'ws-workbench' && modeAccount(state.activeAccountId)
      ? captureContext('') : null,
    request: (pathname, init, context) => api(pathname, init, context),
    redraw: () => render({ skipNativeResize: true }),
  });
  const groupPermissions = window.ZhikeWsGroupPermissions?.create({
    getScope: () => state.active && state.workspaceMode === 'dedicated' && modeAccount(state.activeAccountId) &&
      state.wsWorkspaceView === 'group-permissions' && getHost()?.state?.view === 'ws-workbench'
      ? { ...captureContext(''), workspaceMode: state.workspaceMode, view: state.wsWorkspaceView } : null,
    request: (pathname, scope) => api(pathname, {}, scope),
    redraw: () => render({ skipNativeResize: true }),
    openLogs: scope => {
      if (!contextCurrent(scope) || state.workspaceMode !== 'dedicated' || state.wsWorkspaceView !== 'group-permissions') return;
      state.wsWorkspaceView = 'logs'; writeWsWorkspaceState('logs', state.wsWorkspaceNavCollapsed);
      render({ skipNativeResize: true }); return refreshWorkspacePage();
    },
  });
  const groupChannels = window.ZhikeWsGroupChannels?.create({
    getScope: () => state.active && state.workspaceMode === 'dedicated' && modeAccount(state.activeAccountId) &&
      state.wsWorkspaceView === 'group-channels' && getHost()?.state?.view === 'ws-workbench'
      ? { ...captureContext(''), workspaceMode: state.workspaceMode, view: state.wsWorkspaceView } : null,
    request: (pathname, init, scope) => api(pathname, init, scope),
    redraw: () => render({ skipNativeResize: true }),
    toast: (message, icon) => toast(message, icon),
    download: (name, content) => {
      const url = URL.createObjectURL(new Blob([content], { type: 'text/csv;charset=utf-8' }));
      const link = document.createElement('a'); link.href = url; link.download = name; document.body.appendChild(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    },
  });
  const groupReading = window.ZhikeWsGroupReading?.create({
    getScope: () => {
      if (!state.active || state.workspaceMode !== 'dedicated' || !modeAccount(state.activeAccountId) ||
          !['groups', 'group-reading'].includes(state.wsWorkspaceView) || getHost()?.state?.view !== 'ws-workbench') return null;
      const readingPage = state.wsWorkspaceView === 'group-reading' ? wsWorkspacePageState('group-reading') : null;
      const selected = readingPage ? readingPage.groupJid : groupDirectoryState().detailGroupId;
      if (!selected) return null;
      const context = captureContext('');
      const group = (readingPage ? readingPage.groups : state.groupCatalog)?.find(row => text(row.groupJid) === selected && String(row.accountId) === context.accountId);
      return group ? { ...context, groupJid: selected, view: state.wsWorkspaceView } : null;
    },
    request: (pathname, scope) => api(pathname, {}, scope),
    redraw: () => render({ skipNativeResize: true }),
    download: csv => {
      const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = 'zhike-group-reading-' + new Date().toISOString().slice(0, 10) + '.csv';
      anchor.rel = 'noopener';
      try { anchor.click(); } finally { setTimeout(() => URL.revokeObjectURL(url), 1000); }
    },
  });
  function renderWorkspaceGroupReading() {
    const page = wsWorkspacePageState('group-reading');
    const groups = (page.groups || []).filter(row => String(row.accountId) === String(state.activeAccountId));
    const accounts = (state.accounts || []).filter(account => accountWorkspaceMode(account) === 'dedicated');
    return `<section class="ws-workspace-card zk-surface"><div class="ws-card-heading"><div><strong>群组消息历史查询</strong><span>真实回执采集 BLOCKED</span></div><button type="button" class="btn small" disabled aria-label="真实回执采集不可用">采集真实回执 · BLOCKED</button></div><p class="ws-muted">尚无生产回执采集来源，也没有可核验的本账号出站消息来源。当前只查询已保存的本地历史；记录可能来自隔离测试，发送归属与阅读状态均待核实。</p><div class="ws-workspace-list-controls"><label>专用账号<select data-ws-business-account>${accounts.map(row => `<option value="${esc(row.id)}"${String(row.id) === String(state.activeAccountId) ? ' selected' : ''}>${esc(accountDisplayName(row) || row.id)}</option>`).join('')}</select></label><label>已保存群组<select data-ws-reading-group ${page.busy ? 'disabled' : ''}><option value="">请选择群组</option>${groups.map(row => `<option value="${esc(row.groupJid)}"${row.groupJid === page.groupJid ? ' selected' : ''}>${esc(row.name || row.groupName || '未命名群组')} · ${esc(row.groupJid)}</option>`).join('')}</select></label></div>${!groups.length ? '<p class="ws-muted">暂无已加载群组。刷新只读取当前账号的本地目录，不连接平台。</p>' : '<p class="ws-muted">目录最多载入 1000 条；选择具体群组后查询消息。</p>'}</section>${groupReading?.render() || ''}`;
  }
  function groupDirectoryRows() {
    const collectionByGroup = new Map((state.conversations || []).map(row => [text(row.externalId || row.groupJid), text(row.collectionStatus)]));
    const targetsByJid = new Map((state.groupMonitor?.profile?.targets || []).map(target => [text(target.groupJid).toLowerCase(), target]));
    const saved = new Map();
    for (const item of state.groupCatalog || []) {
      const jid = text(item.groupJid).toLowerCase();
      if ((!item.accountId || String(item.accountId) === String(state.activeAccountId)) && /^[a-z0-9._-]+@g\.us$/.test(jid)) saved.set(jid, { ...item, groupJid: jid });
    }
    const rows = [];
    for (const live of workspaceLiveDirectoryRows('dedicated')) {
      const jid = text(live.groupJid || live.externalId || live.conversationKey).toLowerCase();
      if (!/^[a-z0-9._-]+@g\.us$/.test(jid) || (live.accountId && live.accountId !== state.activeAccountId)) continue;
      const known = saved.get(jid);
      rows.push({ ...known, accountId: state.activeAccountId, groupJid: jid,
        groupName: text(live.displayName || live.title || live.groupName) || known?.groupName || jid,
        directorySource: live.liveSource === 'foreground-open-group' ? '前台群聊核验' : live.liveSource === 'foreground-visible' ? '前台现场' : '采集会话现场', liveObservedAt: live.liveObservedAt });
      saved.delete(jid);
    }
    rows.push(...[...saved.values()].map(item => ({ ...item, directorySource: '历史记录' })));
    return rows.map(item => {
        const rawCount = item.participantCount ?? item.memberCount;
        const count = rawCount != null && rawCount !== '' && Number.isFinite(Number(rawCount)) && Number(rawCount) > 0 ? Number(rawCount) : null;
        const permission = typeof item.permissions === 'string' ? text(item.permissions) : text(item.sendPermission || item.messagePermission);
      const target = targetsByJid.get(text(item.groupJid).toLowerCase());
      return { ...item, monitorTarget: target || item.monitorTarget, directoryId: text(item.groupJid || item.id), directoryCount: count, directoryPermission: permission || '未提供', directoryCollection: text(item.collectionStatus || item.data?.collectionStatus || collectionByGroup.get(text(item.groupJid))) || '未提供' };
      }).filter(item => item.directoryId);
  }
  function updateDedicatedLiveDirectoryDom() {
    if (state.active && state.workspaceMode === 'dedicated' && state.wsWorkspaceView === 'chat') {
      const panel = $('#wsGroupVerification');
      if (panel) {
        const html = renderGroupVerification('chat');
        if (panel.innerHTML !== html) {
          const height = panel.offsetHeight;
          panel.innerHTML = html;
          if (panel.offsetHeight !== height) queueResizeWsView();
        }
      }
      return;
    }
    if (state.active && state.workspaceMode === 'dedicated' && ['groups', 'collection', 'overview', 'settings'].includes(state.wsWorkspaceView))
      render({ skipNativeResize: true });
  }
  function groupDirectorySummary(rows = groupDirectoryRows()) {
    const live = rows.filter(row => row.directorySource !== '历史记录').length;
    const coverage = liveDirectoryGapMessage();
    const observed = live || state.liveDirectory?.foregroundChecked || state.liveDirectory?.collectorObserved;
    return (observed ? `现场已识别 ${live} 个群组` : '现场群目录尚无读取回执') + ` · 仅有历史记录 ${rows.length - live} 个` + (coverage ? ' · ' + coverage : '');
  }
  function groupDirectoryWindow() {
    const page = groupDirectoryState(), allRows = groupDirectoryRows(), filters = page.groupFilters;
    const selected = new Set(page.selectedGroupIds);
    const rows = allRows.filter(item => {
      if (page.showSelectedOnly && !selected.has(item.directoryId)) return false;
      const count = item.directoryCount;
      if (filters.memberCount === 'known' && count == null || filters.memberCount === 'unknown' && count != null) return false;
      if (filters.memberCount === 'under50' && (count == null || count >= 50)) return false;
      if (filters.memberCount === '50to199' && (count == null || count < 50 || count >= 200)) return false;
      if (filters.memberCount === '200plus' && (count == null || count < 200)) return false;
      if (filters.permission !== 'all' && item.directoryPermission !== filters.permission) return false;
      if (filters.collection !== 'all' && item.directoryCollection !== filters.collection) return false;
      return true;
    });
    return { ...workspaceListWindow(rows, 'groups'), allRows, selected };
  }
  function unreadGroupControl() {
    const account = modeAccount(state.activeAccountId, 'dedicated');
    if (state.workspaceMode !== 'dedicated' || !account) return '';
    const enabled = account.openUnreadGroups === true;
    return `<label class="ws-inline-checkbox"><input type="checkbox" data-ws-action="toggle-open-unread-groups" ${enabled ? 'checked' : ''} ${state.busy?.collector || state.busy?.connection ? 'disabled' : ''}> 允许后台打开未读群以核验群号（WhatsApp 可能同步为已读）</label>`;
  }
  async function changeUnreadGroupPolicy() {
    const account = modeAccount(state.activeAccountId, 'dedicated');
    if (state.workspaceMode !== 'dedicated' || !account || state.busy.collector || state.busy.connection) return;
    const context = captureContext('');
    const next = account.openUnreadGroups !== true;
    const running = collectionCapability(context.accountId).collectorState === 'running';
    const operation = state.collectorActionSequence = Number(state.collectorActionSequence || 0) + 1;
    state.busy.collector = true;
    let paused = false, saved = false;
    try {
      if (running) {
        await wsBridge('pause-collector', context);
        paused = true;
        assertContext(context);
      }
      const result = await api('/api/ws/accounts/' + encodeURIComponent(context.accountId), { method:'PATCH', body:JSON.stringify({ settings:{ openUnreadGroups:next } }) }, context);
      assertContext(context);
      if (result?.account?.id !== context.accountId || result.account.workspaceMode !== 'dedicated' || result.account.settings?.openUnreadGroups !== next)
        throw new Error('账号设置回执尚未确认。');
      modeAccount(context.accountId, 'dedicated').openUnreadGroups = next;
      saved = true;
      if (paused) {
        await wsBridge('resume-collector', context);
        assertContext(context);
        paused = false;
        if (state.groupMonitor?.accountId === context.accountId) state.groupMonitor.discovery = null;
        if (collectionReady('backgroundCollection', context.accountId)) void scanGroupMonitorTargets({ automatic:true });
      }
      toast(next ? '已允许为核验群号打开未读群。' : '已切换为保留未读状态。');
    } catch (error) {
      if (contextCurrent(context)) toast((saved ? '设置已保存。' : '') + (error.message || '修改未读群核验设置失败。') + (paused ? ' 后台采集待恢复。' : ''), 'x');
    } finally {
      if (operation === state.collectorActionSequence) { state.busy.collector = false; render({ skipNativeResize:true }); }
    }
  }
  function groupDiscoveryNote() {
    const directory = state.liveDirectory;
    const discovery = state.groupMonitor?.discovery;
    if (discovery?.retryAt) return discovery.note || '';
    if (directory?.endChunk == null || directory.chunks.size !== directory.endChunk + 1
        || directory.accountId !== state.activeAccountId || directory.mode !== 'dedicated')
      return discovery?.note || '';
    const groups = directory.scannedKeys.size;
    if (groups) return `本轮已核验 ${groups} 个群组。` + (directory.incomplete ? ' 部分列表行仍待核验。' : ' 正在等待新增群组。');
    if (directory.collectorGaps) return '本轮读取已结束。WhatsApp 列表中有待核验的行，尚未取得可靠的群号。';
    if (directory.incomplete) return '本轮目录读取未完成，正在等待下一次采集。';
    return '本轮读取已结束，暂未发现群组，正在等待新数据。';
  }
  function renderPendingGroupWindow(query) {
    const directory = state.liveDirectory;
    if (!directory || directory.accountId !== state.activeAccountId || directory.mode !== 'dedicated' || state.workspaceMode !== 'dedicated') return '';
    const names = directory.pendingGroupWindow?.names;
    if (!names?.length) return '';
    const search = text(query).trim().toLocaleLowerCase();
    const shown = names.filter(name => !search || name.toLocaleLowerCase().includes(search));
    if (!shown.length) return '';
    return `<aside class="ws-group-details"><strong>已发现，群号待核验</strong><p>最近一次 WhatsApp 群组筛选窗口有 ${names.length} 条待核验。核验群号后可选择监测。</p><div style="max-height:16rem;overflow:auto"><ul>${shown.map(name => '<li>' + esc(name) + '</li>').join('')}</ul></div></aside>`;
  }
  function renderGroupDirectory() {
    const progressNote = groupDiscoveryNote();
    const page = groupDirectoryState(), windowed = groupDirectoryWindow(), filters = page.groupFilters;
    const options = (values, selected) => values.map(([value, label]) => `<option value="${esc(value)}" ${selected === value ? 'selected' : ''}>${esc(label)}</option>`).join('');
    const actualOptions = key => [['all', '全部'], ...[...new Set(windowed.allRows.map(row => row[key]))].sort().map(value => [value, value])];
    const selectedCount = windowed.allRows.filter(row => windowed.selected.has(row.directoryId)).length;
    const allVisibleSelected = windowed.rows.length > 0 && windowed.rows.every(row => windowed.selected.has(row.directoryId));
    const detail = windowed.allRows.find(row => row.directoryId === page.detailGroupId);
    return `<section class="ws-workspace-card ws-group-directory zk-surface"><div class="ws-card-heading"><div><strong>群组目录</strong><span>${esc(groupDirectorySummary(windowed.allRows))}</span></div>${state.groupMonitor?.archiveError ? `<small>${esc(state.groupMonitor.archiveError)}</small>` : ''}</div><div class="ws-group-filters ws-workspace-list-controls"><label>搜索群组<input id="wsWorkspaceSearch-groups" data-ws-workspace-search="groups" type="search" maxlength="160" value="${esc(page.filter)}" placeholder="群名称或群组标识"></label><label>所属账号<select data-ws-group-filter="accountId">${(state.accounts || []).map(account => `<option value="${esc(account.id)}" ${String(account.id) === String(state.activeAccountId) ? 'selected' : ''}>${esc(accountDisplayName(account))}</option>`).join('')}</select></label><label>成员数量<select data-ws-group-filter="memberCount">${options([['all', '全部'], ['known', '已提供'], ['unknown', '未提供'], ['under50', '50 人以下'], ['50to199', '50–199 人'], ['200plus', '200 人及以上']], filters.memberCount)}</select></label><label>发言权限<select data-ws-group-filter="permission">${options(actualOptions('directoryPermission'), filters.permission)}</select></label><label>采集状态<select data-ws-group-filter="collection">${options(actualOptions('directoryCollection'), filters.collection)}</select></label></div>${renderCollectorControls()}${unreadGroupControl()}${renderPendingGroupWindow(page.filter)}${progressNote ? `<p class="ws-muted" role="status">${esc(progressNote)}</p>` : ''}<div class="ws-group-batch-bar"><span role="status">已选择 <strong>${selectedCount}</strong> 个群组 · 匹配 ${windowed.matched} 条</span><div><button type="button" class="btn small" data-ws-action="group-monitor-scan" ${state.wsStatus === '已连接' || collectionReady('groupMonitoring') ? '' : 'disabled'}>读取现场群组</button><button type="button" class="btn small primary" data-ws-action="group-monitor-add-directory" ${!selectedCount || state.groupMonitor?.busy ? 'disabled' : ''}>监测所选群组</button><button type="button" class="btn small" data-ws-action="group-directory-selected" ${selectedCount || page.showSelectedOnly ? '' : 'disabled'}>${page.showSelectedOnly ? '显示全部群组' : '仅查看已选'}</button><button type="button" class="btn small" data-ws-action="group-directory-copy" ${selectedCount ? '' : 'disabled'}>复制所选标识</button><button type="button" class="btn small" data-ws-action="group-directory-clear" ${selectedCount ? '' : 'disabled'}>清除选择</button></div></div><div class="ws-group-directory-body ${detail ? 'has-detail' : ''}"><div class="ws-group-directory-main"><div class="ws-group-table-wrap"><table class="ws-group-table"><thead><tr><th scope="col"><input type="checkbox" class="ws-group-selection" data-ws-group-select-all aria-label="选择当前页全部群组" ${allVisibleSelected ? 'checked' : ''} ${windowed.rows.length ? '' : 'disabled'}></th><th scope="col">群组名称</th><th scope="col">所属账号</th><th scope="col">成员数量</th><th scope="col">发言权限</th><th scope="col">采集状态</th><th scope="col">最近记录</th><th scope="col">详情</th></tr></thead><tbody>${windowed.rows.length ? windowed.rows.map(item => `<tr class="${windowed.selected.has(item.directoryId) ? 'is-selected' : ''}"><td><input type="checkbox" class="ws-group-selection" data-ws-group-select="${esc(item.directoryId)}" aria-label="选择 ${esc(item.groupName || item.name || item.groupJid)}" ${windowed.selected.has(item.directoryId) ? 'checked' : ''}></td><td><strong>${esc(item.groupName || item.name || '未命名群组')}</strong><small>${esc(item.directorySource)} · ${esc(item.groupJid || item.id)}</small></td><td>${esc(accountDisplayName(activeAccount()) || state.activeAccountId)}</td><td>${item.directoryCount == null ? '未提供' : item.directoryCount.toLocaleString()}</td><td>${esc(item.directoryPermission)}</td><td><span class="ws-group-state">${esc(item.directoryCollection)}</span><small>${item.monitorTarget?.enabled ? '监测已配置' : item.monitorTarget ? '监测已停用' : '未加入监测'}</small></td><td>${esc(displayTime(item.liveObservedAt || item.lastSyncAt || item.lastSeenAt || item.updatedAt) || '未提供')}</td><td><button type="button" class="btn small" data-ws-action="group-directory-detail" data-group-id="${esc(item.directoryId)}" aria-expanded="${page.detailGroupId === item.directoryId ? 'true' : 'false'}">${page.detailGroupId === item.directoryId ? '收起' : '查看'}</button></td></tr>`).join('') : `<tr><td colspan="8"><div class="ws-empty">${windowed.allRows.length ? '当前筛选条件下没有群组。' : '尚无已核验群号的群组。'}</div></td></tr>`}</tbody></table></div><div class="ws-workspace-list-pagination"><span>每页 40 条 · 共 ${windowed.matched} 条</span><button type="button" class="btn small" data-ws-action="workspace-list-page" data-list-view="groups" data-page-delta="-1" ${windowed.page <= 1 ? 'disabled' : ''}>上一页</button><span>${windowed.page} / ${windowed.pageCount}</span><button type="button" class="btn small" data-ws-action="workspace-list-page" data-list-view="groups" data-page-delta="1" ${windowed.page >= windowed.pageCount ? 'disabled' : ''}>下一页</button></div></div>${detail ? `<aside class="ws-group-detail-panel" aria-label="群组详情"><div class="ws-card-heading"><strong>${esc(detail.groupName || detail.name || detail.groupJid)}</strong><button type="button" class="btn small" data-ws-action="group-directory-detail" data-group-id="${esc(detail.directoryId)}">收起详情</button></div><dl><dt>群组标识</dt><dd>${esc(detail.groupJid || detail.id)}</dd><dt>群组说明</dt><dd>${esc(detail.description || detail.data?.description || '未提供')}</dd><dt>成员数量</dt><dd>${detail.directoryCount ?? '未提供'}</dd><dt>发言权限</dt><dd>${esc(detail.directoryPermission)}</dd><dt>采集状态</dt><dd>${esc(detail.directoryCollection)}</dd><dt>目录状态</dt><dd>${esc(detail.status || '未提供')}</dd></dl></aside>` : ''}</div></section><details class="ws-group-details" data-ws-group-monitor-details ${page.monitorDetailsOpen ? 'open' : ''}><summary>群组监测设置与历史事件</summary>${page.monitorDetailsOpen ? renderGroupMonitorCard() : '<p class="ws-muted">展开后查看现有监测席位、绑定群组和真实事件。</p>'}</details>`;
  }
  function applyGroupDirectoryControl(target) {
    if (state.wsWorkspaceView !== 'groups') return false;
    const page = groupDirectoryState();
    if (target.dataset.wsGroupFilter != null) {
      const key = target.dataset.wsGroupFilter;
      if (key === 'accountId') { void switchAccount(target.value); return true; }
      if (!['memberCount', 'permission', 'collection'].includes(key)) return false;
      page.groupFilters[key] = String(target.value || 'all');
      page.page = 1;
    } else if (target.dataset.wsGroupSelect != null || target.dataset.wsGroupSelectAll != null) {
      const selected = new Set(page.selectedGroupIds);
      const ids = target.dataset.wsGroupSelectAll != null ? groupDirectoryWindow().rows.map(row => row.directoryId) : [String(target.dataset.wsGroupSelect)];
      const valid = new Set(groupDirectoryRows().map(row => row.directoryId));
      for (const id of ids) if (valid.has(id)) { if (target.checked) selected.add(id); else selected.delete(id); }
      page.selectedGroupIds = [...selected];
    } else return false;
    render({ skipNativeResize: true });
    return true;
  }
  function workspaceListWindow(rows, view = state.wsWorkspaceView) {
    const page = wsWorkspacePageState(view);
    const source = Array.isArray(rows) ? rows : [];
    const statusOf = item => String(item.status || item.collectionStatus || item.lastKnownStatus || item.priority || 'unknown');
    const statuses = [...new Set(source.map(statusOf))].sort();
    const query = String(page.filter || '').trim().toLocaleLowerCase();
    const matches = source.filter(item => {
      if (page.statusFilter && page.statusFilter !== 'all' && statusOf(item) !== page.statusFilter) return false;
      if (!query) return true;
      return [item.id, item.displayName, item.name, item.title, item.externalId, item.groupJid, item.groupName, item.memberJid, item.memberPhone, item.customerId, item.conversationId, item.lastError, item.reason, item.eventType, item.type, item.detail].some(value => String(value || '').toLocaleLowerCase().includes(query));
    });
    const pageSize = 40;
    const pageCount = Math.max(1, Math.ceil(matches.length / pageSize));
    page.page = Math.max(1, Math.min(pageCount, Math.floor(Number(page.page) || 1)));
    return { rows: matches.slice((page.page - 1) * pageSize, page.page * pageSize), loaded: source.length, matched: matches.length, page: page.page, pageCount, statuses };
  }
  function renderWorkspaceList(view, rows, renderRows) {
    const page = wsWorkspacePageState(view);
    const windowed = workspaceListWindow(rows, view);
    return `<section class="ws-workspace-list" data-ws-list="${esc(view)}"><div class="ws-workspace-list-controls"><label>搜索 <input id="wsWorkspaceSearch-${esc(view)}" data-ws-workspace-search="${esc(view)}" type="search" maxlength="160" value="${esc(page.filter)}" placeholder="搜索当前已加载记录"></label><label>状态 <select data-ws-workspace-status="${esc(view)}"><option value="all">全部</option>${windowed.statuses.map(value => `<option value="${esc(value)}" ${page.statusFilter === value ? 'selected' : ''}>${esc(value)}</option>`).join('')}</select></label><span role="status">已加载 ${windowed.loaded} 条 · 匹配 ${windowed.matched} 条</span></div><div class="ws-workspace-list-rows">${windowed.rows.length ? renderRows(windowed.rows) : '<p class="ws-muted">当前条件下没有匹配记录。</p>'}</div><div class="ws-workspace-list-pagination"><button type="button" class="btn small" data-ws-action="workspace-list-page" data-list-view="${esc(view)}" data-page-delta="-1" ${windowed.page <= 1 ? 'disabled' : ''}>上一页</button><span>${windowed.page} / ${windowed.pageCount}</span><button type="button" class="btn small" data-ws-action="workspace-list-page" data-list-view="${esc(view)}" data-page-delta="1" ${windowed.page >= windowed.pageCount ? 'disabled' : ''}>下一页</button></div></section>`;
  }
  function renderWorkspaceSummaryRows(rows, kind) {
    const memberAvatar = kind === 'members' ? businessPages?.renderPersonAvatar?.({ size: 'xs' }) || '' : '';
    return rows.map(item => {
      const title = kind === 'groups' ? item.groupName || item.name || item.groupJid : kind === 'members' ? item.memberPhone || item.memberJid : item.title || item.externalId || item.name || item.id;
      const detail = kind === 'groups' ? `${item.groupJid || ''} · ${Number(item.participantCount || 0)} 名成员` : kind === 'members' ? `${item.groupName || item.groupJid || ''} · ${item.eventType || item.type || (item.customerId ? '客户 ' + item.customerId : '未关联客户')} · ${displayTime(item.eventAt || item.observedAt || item.lastSeenAt || item.updatedAt)}` : item.detail || item.externalId || item.id || '';
      const identity = `<span class="ws-person-copy"><strong>${esc(title || '未命名')}</strong><small>${esc(detail)}</small></span>`;
      return `<div class="ws-workspace-row">${memberAvatar ? `<div class="ws-person-identity">${memberAvatar}${identity}</div>` : identity}<em>${esc(item.status || item.collectionStatus || 'unknown')}</em></div>`;
    }).join('');
  }
  function applyWorkspaceListFilter(target) {
    const view = target?.dataset?.wsWorkspaceSearch || target?.dataset?.wsWorkspaceStatus;
    if (!WS_WORKSPACE_VIEW_IDS.has(view) || view !== state.wsWorkspaceView) return false;
    const page = wsWorkspacePageState(view);
    const search = target.dataset.wsWorkspaceSearch != null;
    if (search) page.filter = String(target.value || '').slice(0, 160);
    else page.statusFilter = String(target.value || 'all');
    page.page = 1;
    const caret = target.selectionStart;
    render({ skipNativeResize: true });
    if (search) {
      const input = document.getElementById('wsWorkspaceSearch-' + view);
      input?.focus();
      if (Number.isInteger(caret)) input?.setSelectionRange?.(caret, caret);
    }
    return true;
  }
  function workspacePageHeader(meta, account) {
    const page = wsWorkspacePageState(meta.id);
    const status = page.error || page.status || '尚未刷新';
    return `<div class="ws-workspace-page-heading"><div><span class="ws-workspace-eyebrow">WS 工作台</span><h2 id="wsWorkspacePageTitle">${esc(meta.label)}</h2><p>${esc(meta.hint)}</p></div><div class="ws-workspace-page-actions"><span class="ws-workspace-scope">当前账号：${esc(account)}</span><span class="ws-workspace-page-status" aria-live="polite">${esc(status)}</span><button type="button" class="btn small" data-ws-action="refresh-workspace-page" data-ws-page-refresh="${esc(meta.id)}" ${page.busy ? 'disabled' : ''}>${page.busy ? '刷新中…' : '刷新'}</button></div></div>`;
  }
  async function loadGroupMembers(context = captureContext('')) {
    const accountId = String(context.accountId || 'default');
    state.groupMembers = { accountId, rows: [], enabled: null, error: '' };
    try {
      const result = await api('/api/ws/group-manager/members?limit=1000', {}, context);
      assertContext(context);
      state.groupMembers = { accountId, rows: (Array.isArray(result.members) ? result.members : []).filter(row => String(row.accountId) === accountId), enabled: true, error: '' };
    } catch (error) {
      if (!contextCurrent(context)) return;
      if (error.status === 404 && error.code === 'GROUP_MANAGER_DISABLED') { state.groupMembers = { accountId, rows: [], enabled: false, error: '' }; return; }
      state.groupMembers = { accountId, rows: [], enabled: null, error: String(error.message || '群成员读取失败') }; throw error;
    }
  }
  async function refreshWorkspacePage() {
    const view = state.wsWorkspaceView;
    if (view === 'group-broadcast') return groupDrafts?.load();
    if (!workspaceViewAllowed(view) || WS_BLOCKED_VIEWS.has(view) || view === 'chat') return;
    if (!modeAccount(state.activeAccountId)) { if (view === 'accounts' || view === 'overview') await loadAccounts(); return; }
    const accountId = String(state.activeAccountId || 'default');
    const page = wsWorkspacePageState(view, accountId);
    const accountSequence = Number(state.accountLoadSequence || 0);
    if (page.busy && page.refreshAccountSequence === accountSequence) return;
    const refreshGeneration = Number(page.refreshGeneration || 0) + 1;
    page.refreshGeneration = refreshGeneration;
    page.refreshAccountSequence = accountSequence;
    const context = captureContext('');
    const ownsPage = () => page.refreshGeneration === refreshGeneration;
    const currentPageRequest = () => ownsPage() && (view === 'accounts' ? String(state.activeAccountId || 'default') === accountId : contextCurrent(context));
    page.busy = true;
    page.error = '';
    page.status = '正在刷新…';
    render();
    try {
      if (view === 'contacts' || view === 'logs') {
        if (!businessPages) throw new Error('业务页面模块未加载，请重新打开应用。');
        const loading = businessPages.loadDirectory({ view, page, accountId, request: pathname => api(pathname, {}, context), isCurrent: () => contextCurrent(context) });
        render();
        const accepted = await loading;
        assertContext(context);
        if (!accepted) throw new Error(businessPages.directoryState(page).error || '数据已过期，请重新查询。');
      } else if (view === 'exclusions') {
        if (!businessPages) throw new Error('业务页面模块未加载，请重新打开应用。');
        const scope = exclusionPageScope();
        const loading = businessPages.loadExclusions(page, { request: scope.request, isCurrent: scope.isCurrent });
        render();
        const accepted = await loading;
        assertContext(context);
        if (!accepted) throw new Error(businessPages.exclusionState(page).error || '数据已过期，请重新查询。');
      } else if (view === 'accounts') {
        await loadAccounts();
        if (state.error) throw new Error(state.error);
      } else if (view === 'members') {
        await Promise.all([loadGroupMonitor(), loadGroupMembers(context)]);
      } else if (view === 'group-channels') {
        if (!await groupChannels?.load()) throw new Error('群组渠道配置读取失败，请查看页面中的具体原因。');
      } else if (view === 'group-permissions') {
        if (!await groupPermissions?.load()) throw new Error('本地权限清单读取失败，请查看具体原因。');
      } else if (view === 'group-reading') {
        const catalog = await api('/api/ws/group-manager/groups?limit=1000', {}, context);
        assertContext(context);
        if (catalog.accountId !== accountId || !Array.isArray(catalog.groups)) throw new Error('群组目录不属于当前账号。');
        page.groups = catalog.groups.filter(row => String(row.accountId) === accountId && /^[a-z0-9._-]{1,235}@g\.us$/.test(String(row.groupJid)));
        if (!page.groups.some(row => row.groupJid === page.groupJid)) page.groupJid = '';
        if (currentPageRequest() && state.wsWorkspaceView === view) await groupReading?.open();
      } else if (view === 'groups' || (state.workspaceMode === 'dedicated' && ['overview','collection','settings'].includes(view))) {
        await loadGroupMonitor();
        if (state.groupMonitor.error) throw new Error(state.groupMonitor.error);
        if (view === 'groups' && currentPageRequest() && state.wsWorkspaceView === view) await groupReading?.open();
      } else if (view === 'crm') {
        await Promise.all([loadDataArchive(captureContext(), false), loadHotProfile(captureContext(), false)]);
        if (state.archiveError || state.hotProfileError) throw new Error(state.archiveError || state.hotProfileError);
        await window.ZhikeAiReviewCenter?.refresh?.();
      } else if (view === 'settings') {
        const settings = await api('/api/ws/settings?conversationId=' + encodeURIComponent(state.currentConversationId || ''), {}, context);
        assertContext(context);
        state.settings = core.normalizeTranslationSettings(settings);
        state.aiEnabled = settings.aiEnabled !== false;
      } else {
        // A page refresh reads persisted status. It must not invoke the
        // collection poller, scan WhatsApp or schedule an AI consumer.
        const [run, alerts, queue] = await Promise.all([
          api('/api/ws/collection-runs', {}, context),
          api('/api/ws/followup-alerts?limit=8', {}, context),
          api('/api/ws/ai-jobs?limit=20', {}, context),
        ]);
        assertContext(context);
        state.collectionRun = run.run || null;
        state.summaryLoaded = { collection: true, followups: true, ai: Boolean(queue.stats) };
        if (view === 'collection') {
          page.collectionItems = [];
          page.collectionItemsLoaded = false;
          if (state.collectionRun?.id) {
            const items = await api('/api/ws/collection-items?runId=' + encodeURIComponent(state.collectionRun.id) + '&limit=1000', {}, context);
            assertContext(context);
            page.collectionItems = (items.items || []).filter(item => String(item.accountId) === accountId);
          }
          page.collectionItemsLoaded = true;
        }
        state.followupAlerts = alerts.alerts || [];
        if (queue.stats) state.aiQueueStats = queue.stats;
        if (view === 'ai') await window.ZhikeAiReviewCenter?.refresh?.();
      }
      if (!currentPageRequest()) return;
      page.status = `已刷新 ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
    } catch (error) {
      if (currentPageRequest()) { page.error = String(error?.message || '页面刷新失败，请重试。').slice(0, 240); page.status = '刷新失败'; }
    } finally {
      // Release the originating page even after an account/navigation change;
      // a stale request must never strand its Refresh button in busy state.
      if (ownsPage()) page.busy = false;
      if (currentPageRequest() && state.wsWorkspaceView === view) render();
    }
  }
  function renderWorkspaceOperationalOverview() {
    if (state.workspaceMode === 'dedicated') {
      const monitor = state.groupMonitor || {};
      const profile = monitor.profile;
      return `<section class="ws-workspace-card zk-surface"><div class="ws-card-heading"><div><strong>群组采集与监测</strong><span>${esc(collectorStatusLabel())}</span></div><button type="button" class="btn small" data-ws-workspace-view="collection">打开群组采集</button></div><p>${esc(monitor.lastLoadedAt ? groupMonitorStatusLabel(profile) : '等待加载当前账号的监测配置')}</p><p class="ws-muted">${esc(groupDirectorySummary())}。最近现场采集 ${esc(displayTime(currentGroupObservations(profile).lastSeenAt) || '暂无')}。</p></section>`;
    }
    const read = String(wsWorkspacePageState('overview').status || '').startsWith('已刷新');
    const run = state.collectionRun;
    const metrics = [
      ['采集任务', run ? businessPages?.label(run.status) || run.status : '未提供', run ? `任务 ${run.id}` : '尚无任务或未读取'],
      ['已加载跟进提醒', read && state.summaryLoaded?.followups ? state.followupAlerts.length : '—', '当前账号服务返回范围'],
      ['AI 排队任务', read && state.summaryLoaded?.ai ? Number(state.aiQueueStats.queued || 0) : '—', '本机队列状态；不启动消费者'],
    ];
    return `<section class="ws-workspace-metrics" aria-label="真实业务状态">${metrics.map(([title, value, note]) => `<div><span>${esc(title)}</span><strong>${esc(value)}</strong><small>${esc(note)}</small></div>`).join('')}</section><section class="ws-workspace-card zk-surface"><div class="ws-card-heading"><div><strong>资料审核</strong><span>候选、冲突与审计从原 CRM 审核服务读取；本页未读取时不显示虚假计数。</span></div><button type="button" class="btn small" data-ws-workspace-view="crm">进入 CRM 审核</button></div></section>`;
  }
  function renderWorkspaceMembers() {
    const memberState = state.groupMembers || {};
    const rows = String(memberState.accountId) === String(state.activeAccountId) ? (memberState.rows || []).filter(row => String(row.accountId) === String(state.activeAccountId)) : [];
    const page = wsWorkspacePageState('members');
    const events = (state.groupMonitor?.events || []).filter(item => String(item.accountId || '') === String(state.activeAccountId));
    return `<section class="ws-workspace-card zk-surface"><div class="ws-card-heading"><div><strong>群成员明细</strong><span>当前账号已同步的成员关系；同一成员跨群分别展示，不按显示名称合并。</span></div></div>${memberState.error ? `<p class="ws-error-line" role="alert">${esc(memberState.error)}</p>` : ''}${memberState.enabled === false ? '<p class="ws-muted">独立群管理未启用；下方仅显示旧监测历史。</p>' : businessPages ? businessPages.renderLocalFilters('members', rows, page) + businessPages.renderMembers(rows, page) : '<p class="ws-error-line">业务页面模块未加载。</p>'}</section><section class="ws-workspace-card zk-surface"><div class="ws-card-heading"><strong>已加载进退事件</strong><span>仅为既有监测服务已返回的历史范围；审核中不计作确认入群。</span></div>${events.length ? renderWorkspaceSummaryRows(events, 'members') : '<p class="ws-muted">暂无已加载事件。</p>'}</section>`;
  }
  function renderWorkspaceCustomers() {
    if (!businessPages) return '<p class="ws-error-line">业务页面模块未加载。</p>';
    const page = wsWorkspacePageState('crm'), customers = getHost()?.state?.customers;
    if (!Array.isArray(customers)) return '<section class="ws-workspace-card zk-surface"><p class="ws-muted">客户主档尚未加载；请先在知客客户中心读取本机资料。</p></section>';
    const rows = businessPages.customerRows(customers, state.conversations, state.activeAccountId);
    return businessPages.renderLocalFilters('crm', rows, page) + businessPages.renderCustomers(rows, page);
  }
  function renderWorkspaceTaskPage() {
    if (!businessPages) return renderWorkspaceList('tasks', state.followupAlerts || [], rows => renderFollowupAlerts(rows));
    const result = businessPages.renderTasks(state.followupAlerts || [], wsWorkspacePageState('tasks'));
    return (!state.summaryLoaded?.followups ? '<p class="ws-muted" role="status">跟进摘要尚未成功读取；空列表不代表当前账号没有任务。</p>' : '') + result.html + (result.selected ? `<section class="ws-workspace-card zk-surface">${renderFollowupAlerts([result.selected])}</section>` : '');
  }
  function renderWorkspaceReadDirectory(view) {
    return businessPages ? businessPages.renderDirectory(view, wsWorkspacePageState(view), state.accounts || [], String(state.activeAccountId || 'default')) : '<p class="ws-error-line" role="alert">业务页面模块未加载，请重新打开应用。</p>';
  }
  function renderGroupWhatsAppLink(instruction) {
    const account = modeAccount(state.activeAccountId, 'dedicated');
    if (!account || state.workspaceMode !== 'dedicated') return '';
    return `<section class="ws-workspace-card zk-surface"><div class="ws-card-heading"><div><strong>${esc(accountDisplayName(account))}</strong><span>${esc(instruction)}</span></div><button type="button" class="btn small" data-ws-workspace-view="chat">打开此账号的 WhatsApp</button></div></section>`;
  }
  function groupVerificationReason(status) {
    return ({
      'no-open-chat': '前台尚未打开聊天。',
      'no-message-envelopes': '聊天页没有提供可核验的消息标识。',
      'unsupported-message-envelope': 'WhatsApp 提供的消息标识格式尚未识别。',
      'unconfirmed-message-position': '聊天页中有消息标识，但尚不能确认它属于当前聊天的消息。',
      'single-message-owner': '只有一条带归属的消息，还缺少另一项群身份依据。',
      'awaiting-owner-confirmation': '已取得群号线索，等待确认当前聊天仍对应这个群。',
      'insufficient-message-identities': '当前群聊中可见的消息身份线索不足，尚不能确认群标识。',
      'conflicting-identities': '当前页面出现互相冲突的会话标识，无法确认群组。',
      'source-unavailable': '当前 WhatsApp 页面结构未提供可读取的会话标识。',
      'workspace-type-mismatch': '已打开的会话无法确认为此专用账号的群聊。',
    })[status] || '尚未取得可核验的当前群标识。';
  }
  function renderGroupVerification(view) {
    const directory = state.liveDirectory?.accountId === state.activeAccountId && state.liveDirectory.mode === 'dedicated' ? state.liveDirectory : null;
    const groups = workspaceLiveDirectoryRows('dedicated').length;
    const diag = directory?.foregroundDiagnostics;
    const gap = liveDirectoryGapMessage();
    const confirmedList = directory?.foregroundChecked || directory?.collectorObserved;
    const status = directory?.foregroundError ? '前台读取失败。' + directory.foregroundError : gap ? ('现场已识别 ' + groups + ' 个群组。' + gap) : (groups
      ? '本账号现场已识别 ' + groups + ' 个群组。' : diag?.listPresent === false ? 'WhatsApp 当前页面没有可读取的聊天列表。'
        : confirmedList ? '本轮目录没有返回可核验的群标识。' : '尚未收到此账号的现场群目录回执。');
    const connected = state.wsStatus === '已连接';
    const action = view === 'chat'
      ? `<button type="button" class="btn small" data-ws-action="verify-open-group" ${connected && !directory?.groupVerificationBusy ? '' : 'disabled'}>${directory?.groupVerificationBusy ? '正在核验…' : '核验已打开的群聊'}</button>`
      : '<button type="button" class="btn small" data-ws-workspace-view="chat">打开 WhatsApp 核验群聊</button>';
    const diagnosticLines = [];
    if (directory?.showGroupDiagnostics) {
      diagnosticLines.push('前台连接 · ' + (state.wsStatus || '未知'), '后台连接 · ' + collectorStatusLabel());
      for (const [label, value] of [['前台最近读取', directory.lastForegroundReadAt], ['后台最近读取', directory.lastCollectorReadAt]]) diagnosticLines.push(label + ' · ' + (value || '尚无回执'));
      if (diag) {
        for (const [label, key] of [['前台列表行','renderedRows'], ['带可靠标识的列表行','stableRows'], ['未核实列表行','unresolvedRows']]) {
          if (Number.isSafeInteger(diag[key]) && diag[key] >= 0) diagnosticLines.push(label + ' · ' + diag[key]);
        }
        if (Array.isArray(diag.rowStructureSample) && diag.rowStructureSample.length) diagnosticLines.push('行结构样本 · ' + JSON.stringify(diag.rowStructureSample));
      }
      const filterReasons = {
        'not-checked':'尚未检查', 'not-offered':'没有可确认的群组筛选控件', ambiguous:'筛选控件有歧义',
        selecting:'正在切换', selected:'已确认 WhatsApp 群组列表', 'selection-unconfirmed':'WhatsApp 尚未确认已选群组筛选'
      };
      const menuReasons = {
        'verified-group':'已确认群聊类型，等待核验群号', 'verified-read-group':'已确认一条已读群聊，等待核验群号', unread:'菜单显示该会话未读', 'read-state-unknown':'菜单未确认已读状态',
        'type-unconfirmed':'菜单未确认群组类型', 'menu-unavailable':'未找到可读的行菜单', 'menu-unowned':'无法确定菜单对应哪一行',
        'row-changed':'列表行已变化', 'navigation-busy':'采集窗口正处理其他操作'
      };
      const modes = directory.probeControls;
      if (modes && Object.hasOwn(filterReasons, modes.filter)) diagnosticLines.push('后台群组筛选 · ' + filterReasons[modes.filter]);
      if (modes && Object.hasOwn(menuReasons, modes.menu)) diagnosticLines.push('后台行菜单 · ' + menuReasons[modes.menu]);
      if (modes?.open && modes.open !== 'verified') diagnosticLines.push('后台聊天核验 · ' + (modes.open === 'no-open-chat' ? '后台尚未打开聊天。' : groupVerificationReason(modes.open)));
      if (directory.collectorSkipped?.groupNoticeRows > 0) diagnosticLines.push(`后台群通知预览 · ${directory.collectorSkipped.groupNoticeRows} 行，其中 ${directory.collectorSkipped.verifiedNoticeRows || 0} 行含群通知标记`);
      if (directory.collectorError) diagnosticLines.push('后台读取失败 · ' + directory.collectorError);
      for (const [key, label] of [['skippedUnread','未读'], ['skippedReadUnknown','已读状态无法确认'], ['skippedTypeUnknown','会话类型无法确认']]) {
        const skipped = directory.collectorSkipped?.[key];
        if (skipped > 0) diagnosticLines.push('本轮后台跳过 · ' + label + '至少 ' + skipped + ' 行');
      }
      if (directory.openIdentityStatus && !directory.currentOpenGroup) diagnosticLines.push(groupVerificationReason(directory.openIdentityStatus));
    }
    const instruction = collectionReady('backgroundCollection') ? '后台会自动发现群组。也可以手动核验前台已打开的群聊。'
      : connected ? '手动核验时，在当前账号打开群聊，然后点“核验已打开的群聊”。' : '使用前台手动核验时，请先登录当前账号。';
    const verification = directory?.groupVerification;
    return `<div class="ws-group-verify-copy" role="status"><strong>群组核验</strong> <span>${esc(status)}</span>
      ${verification ? `<span>${esc(verification)}</span>` : ''}</div>
      <div class="ws-group-verify-actions"><span>${esc(instruction)}</span>${action}<button type="button" class="btn small" data-ws-action="group-verification-diagnostics" aria-expanded="${Boolean(directory?.showGroupDiagnostics)}">${directory?.showGroupDiagnostics ? '收起诊断' : '查看诊断'}</button></div>
      ${diagnosticLines.length ? `<div class="ws-group-verify-diagnostics">${diagnosticLines.map(line => `<span>${esc(line)}</span>`).join('')}</div>` : ''}`;
  }
  async function verifyOpenedGroup() {
    if (state.workspaceMode !== 'dedicated' || state.wsStatus !== '已连接' || !modeAccount(state.activeAccountId)) return;
    const directory = liveDirectory(), context = captureContext('');
    if (directory.groupVerificationBusy) return;
    directory.groupVerificationBusy = true;
    const generation = directory.foregroundGeneration;
    const current = () => contextCurrent(context) && state.liveDirectory === directory && state.wsStatus === '已连接' && (!generation || generation === directory.foregroundGeneration);
    try {
      updateDedicatedLiveDirectoryDom();
      if (directory.foregroundRead) await directory.foregroundRead;
      if (!current()) return;
      const result = await refreshForegroundDirectory();
      if (!current()) return;
      const group = directory.currentOpenGroup;
      directory.groupVerification = result && group ? '已核验群聊 · ' + group.displayName + (group.displayName === group.groupJid ? '' : ' · ' + group.groupJid) + ' · ' + group.liveObservedAt
        : '本次核验 · ' + (directory.foregroundError || groupVerificationReason(directory.openIdentityStatus));
    } finally {
      directory.groupVerificationBusy = false;
      if (current()) updateDedicatedLiveDirectoryDom();
    }
  }
  function liveDirectoryGapMessage() {
    const directory = state.liveDirectory;
    if (!directory || directory.accountId !== state.activeAccountId || directory.mode !== state.workspaceMode) return '';
    const counts = [];
    if (directory.foregroundChecked && directory.foregroundGaps > 0) counts.push('前台至少 ' + directory.foregroundGaps + ' 行');
    if (directory.collectorObserved && directory.collectorGaps > 0) counts.push('后台本轮至少 ' + directory.collectorGaps + ' 行');
    return counts.length ? counts.join('、') + '缺少可靠标识或无法确认类型，已识别数量仅覆盖可核实的行。' : '';
  }
  function renderVisibleContactDirectory() {
    if (state.workspaceMode !== 'ordinary') return '';
    const directory = state.liveDirectory;
    const observed = directory?.accountId === state.activeAccountId && directory.mode === 'ordinary' && directory.contactsVisible;
    const contacts = observed ? [...directory.contacts] : [];
    const summary = observed ? '当前可见联系人（已识别 ' + contacts.length + ' 位）' : '查看前台联系人';
    const gaps = observed && directory.contactGaps > 0 ? `<p class="ws-muted">另有至少 ${directory.contactGaps} 行缺少可靠的联系人标识。</p>` : '';
    const details = observed ? (contacts.length
      ? `<p class="ws-muted">联系人选择器记录于 ${esc(directory.contactsObservedAt)}。与该联系人的聊天状态尚未确认。</p><ul class="ws-visible-contact-list">${contacts.map(([id, name]) => `<li><strong>${esc(name)}</strong> <small>${esc(id)}</small></li>`).join('')}</ul>`
      : '<p class="ws-muted">已读取联系人选择器，当前窗口没有可识别的联系人。</p>')
      : '<p class="ws-muted">在此账号的 WhatsApp 中打开“新建聊天”，再读取当前可见联系人。</p>';
    return `<details${directory?.contactsExpanded ? ' open' : ''}><summary>${esc(summary)}</summary>${details}${gaps}<button type="button" class="btn small" data-ws-action="refresh-visible-contacts" ${state.wsStatus === '已连接' ? '' : 'disabled'}>读取可见联系人</button></details>`;
  }
  function liveCollectionRuntimeRows() {
    const directory = state.liveDirectory?.accountId === state.activeAccountId && state.liveDirectory?.mode === state.workspaceMode ? state.liveDirectory : null;
    const capability = collectionCapability(), ordinary = state.workspaceMode === 'ordinary';
    const collectorRead = directory?.collectorObserved === true && capability.collectorState === 'running';
    const visible = directory?.foregroundChecked === true;
    const coverage = [];
    if (visible) coverage.push(directory.chatListVisible === false ? '前台上次可见聊天列表' : '前台当前可见列表');
    if (!ordinary && directory?.verifiedOpenGroups?.size) coverage.push('前台已打开群聊核验');
    if (collectorRead) coverage.push(directory.incomplete ? '后台列表部分可读，存在缺口' : directory.finalized ? '后台已读完本轮可访问的列表' : '后台已读取部分列表');
    const rows = [
      ['当前账号', activeAccount() ? accountDisplayName(activeAccount()) + ' · ' + state.activeAccountId : '尚未选择'],
      ['前台连接', state.wsStatus || '尚未确认'], ['后台连接', collectorStatusLabel(capability)],
      ['现场目录', coverage.length ? coverage.join('；') + ' · ' + workspaceLiveDirectoryRows(state.workspaceMode).length + (ordinary ? ' 个私聊' : ' 个群组') : '尚无现场观测'],
      ['最后读取前台目录', directory?.lastForegroundReadAt || '尚无读取回执'],
      ['最后读取后台目录', directory?.lastCollectorReadAt || '尚无读取回执'],
      ['本次选中账号后后台新入库消息', Number.isSafeInteger(directory?.insertedMessages) ? directory.insertedMessages + ' 条 · 最近回执 ' + directory.lastReceiptAt : '尚无入库回执'],
    ];
    if (ordinary) {
      rows.push(['已读会话历史', [directory?.historyDetail || '尚无历史采集回执', directory?.historyObservedAt,
        directory?.historyRetryAt > Date.now() ? '下次可重试 ' + new Date(directory.historyRetryAt).toISOString() : ''].filter(Boolean).join(' · ')]);
      rows.push(['历史采集缺口', Number.isSafeInteger(directory?.historyMissing) ? directory.historyMissing + ' 项待重试' : '尚未确认']);
    }
    if (!ordinary) rows.push(['本次选中账号后新增可识别成员', Number.isSafeInteger(directory?.insertedMembers) ? directory.insertedMembers + ' 位' : '尚无成员入库回执']);
    const gaps = liveDirectoryGapMessage();
    if (gaps) rows.push(['会话识别缺口', gaps]);
    if (directory?.lastDirectorySavedAt) rows.push(['最近目录保存回执', directory.lastDirectorySavedAt]);
    if (directory?.saveError) rows.push(['目录保存失败', directory.saveError + ' · ' + directory.saveErrorAt]);
    const auth = state.aiAuthorization;
    rows.push(['自动 AI', ordinary ? auth?.active === true && auth.authorization?.accountId === state.activeAccountId ? '已授权所选私聊' : auth?.active === false ? '关闭' : '授权状态尚未读取' : '关闭']);
    if (directory?.localReadError) rows.push(['本机查询错误', directory.localReadError]);
    const error = directory?.collectorError || directory?.foregroundError || (state.error !== directory?.localReadError ? state.error : '');
    if (error) rows.push(['最近错误', error]);
    return rows.map(([label, value]) => `<div><strong>${esc(label)}</strong><p>${esc(value)}</p></div>`).join('');
  }
  function renderWsWorkspacePage(view) {
    const activeView = workspaceViewAllowed(view) ? view : 'overview';
    const meta = workspaceViews().find(item => item.id === activeView) || WS_WORKSPACE_VIEW_META[0];
    if (activeView === 'group-mentions') return `<section class="ws-workspace-page-content" data-ws-workspace-page="group-mentions"><div class="ws-workspace-page-heading"><h2>群组 @ 提及</h2><span class="ws-status-badge" data-status="disabled">自动提及 BLOCKED</span></div>${renderGroupWhatsAppLink('可在群聊中手动选择要 @ 的成员。')}${window.ZhikeWsGroupPermissions?.renderMentions() || '<section class="ws-workspace-card"><p>能力说明模块未加载；隐藏提及 B_MODE_BLOCKED_UNSUPPORTED，原生提及 BLOCKED。</p></section>'}</section>`;
    if (activeView === 'group-broadcast') return `<section class="ws-workspace-page-content" data-ws-workspace-page="group-broadcast" data-ws-account-id="${esc(state.activeAccountId || '')}"><div class="ws-workspace-page-heading"><h2>群组发送草稿</h2><span class="ws-status-badge" data-status="disabled">自动发送 BLOCKED</span></div>${groupDrafts?.render() || '<section class="ws-workspace-card"><p>草稿模块未加载，请重新打开应用。实际发送：BLOCKED。</p></section>'}${renderGroupWhatsAppLink('可在 WhatsApp 中选择目标群，核对内容并手动发送。')}</section>`;
    if (WS_BLOCKED_VIEWS.has(activeView)) return `<section class="ws-workspace-page-content" data-ws-workspace-page="${esc(activeView)}"><div class="ws-workspace-page-heading"><h2>${esc(meta.label)}</h2><span class="ws-status-badge" data-status="disabled">BLOCKED</span></div><section class="ws-workspace-card zk-surface"><p>${esc(meta.hint)}</p><p>此功能尚未通过真实平台验证，暂不能执行此操作。</p></section></section>`;
    const account = accountDisplayName(activeAccount()) || state.activeAccountId || 'default';
    const run = state.collectionRun || {};
    const stats = state.aiQueueStats || {};
    let body = '';
    if (activeView === 'overview') body = renderOpsConsole() + `<section class="ws-workspace-card ws-workspace-welcome zk-surface zk-surface--accent"><span class="ws-workspace-eyebrow">WORKSPACE / OVERVIEW</span><h3>开始今天的客户运营</h3><p>在独立工作区管理账号、查看真实采集记录，并随时回到前台聊天。</p><button type="button" class="btn primary" data-ws-workspace-view="chat">${state.workspaceMode === 'dedicated' ? '打开专用账号登录' : '进入前台聊天'} <span aria-hidden="true">↗</span></button></section><section class="ws-workspace-metrics" aria-label="已加载工作区概况"><div><span>已登记账号</span><strong>${state.accounts.length}</strong><small>当前用途登记记录</small></div><div><span>已加载会话</span><strong>${state.lastLoadedAt ? (state.conversations || []).length : '—'}</strong><small>${state.lastLoadedAt ? '当前账号本地记录' : '等待读取本地记录'}</small></div><div><span>已加载群组</span><strong>${state.groupMonitor?.lastLoadedAt ? groupDirectoryRows().length : '—'}</strong><small>${state.groupMonitor?.lastLoadedAt ? '当前账号同步目录' : '等待同步群组目录'}</small></div></section><section class="ws-workspace-card zk-surface"><div class="ws-card-heading"><div><strong>工作区入口</strong><span>每项功能拥有独立页面，页面切换保留账号会话。</span></div><span class="ws-status-badge">${esc(state.wsStatus)}</span></div><div class="ws-workspace-entry-grid">${workspaceViews().filter(item => !['overview', 'chat'].includes(item.id)).map(item => `<button type="button" class="ws-workspace-entry zk-surface zk-surface--interactive" data-ws-workspace-view="${item.id}"><span class="ws-workspace-nav-icon" aria-hidden="true"><svg class="zk-icon" viewBox="0 0 24 24" focusable="false"><use href="#i-${esc(item.icon)}"/></svg></span><span><strong>${esc(item.label)}</strong><small>${esc(item.hint)}</small></span><span aria-hidden="true">↗</span></button>`).join('')}</div></section><section class="ws-workspace-card zk-surface"><div class="ws-card-heading"><div><strong>运行说明</strong><span>任务按当前账号的配置执行。</span></div><span class="ws-status-badge">按配置运行</span></div><p class="ws-muted">自动 AI 默认关闭，可在 AI 页面明确授权一个私聊及费用上限。群组自动建档仅处理已启用监控中确认的成员事件；请在对应账号内核对任务配置。</p></section>`;
    else if (activeView === 'accounts') body = `<section class="ws-workspace-card zk-surface"><div class="ws-card-heading"><div><strong>账号与连接</strong><span>账号作用域独立，切换保留各账号隔离会话。</span></div><button class="btn small" data-ws-action="create-account">＋ 添加账号</button></div>${state.workspaceMode === 'dedicated' ? '<button type="button" class="btn primary" data-ws-workspace-view="chat">打开当前专用账号登录</button>' : ''}${renderAccountForm()}${renderAccountMetrics()}${renderCollectorControls()}${renderWorkspaceList('accounts', state.accounts, rows => renderAccountList(rows))}</section>`;
    else if (activeView === 'groups') body = `<section class="ws-workspace-card zk-surface ws-group-verify" id="wsGroupVerification">${renderGroupVerification('groups')}</section>` + renderGroupDirectory() + (groupReading?.render() || '');
    else if (activeView === 'group-reading') body = renderWorkspaceGroupReading() + renderGroupWhatsAppLink('可在对应群聊里打开本人发送的消息，查看平台提供的消息信息。');
    else if (activeView === 'group-channels') body = groupChannels?.render() || '<section class="ws-workspace-card"><p class="ws-error-line" role="alert">群组渠道配置模块未加载，请重新打开应用。</p></section>';
    else if (activeView === 'group-permissions') body = (groupPermissions?.render() || '<section class="ws-workspace-card"><p>权限模块未加载；管理员资格与发言权限 UNKNOWN，实际开关群 BLOCKED。</p></section>') + renderGroupWhatsAppLink('群管理员可在 WhatsApp 群组设置中核对和调整发言权限。');
    else if (activeView === 'members') body = renderWorkspaceMembers();
    else if (activeView === 'collection' && state.workspaceMode === 'dedicated') body = renderOpsConsole() + `<section class="ws-workspace-card zk-surface"><div class="ws-card-heading"><strong>群组采集会话</strong><span>${esc(collectorStatusLabel())}</span></div>${renderCollectorControls()}<p class="ws-muted" role="status">${esc(state.groupMonitor?.discovery?.note || '前台登录后读取当前可见群组，独立采集会话就绪后继续发现。')} ${esc(groupDirectorySummary())}。</p><div class="ws-runtime-actions"><button type="button" class="btn small" data-ws-action="group-monitor-scan" ${state.wsStatus === '已连接' || collectionReady('groupMonitoring') ? '' : 'disabled'}>读取现场群组</button><button type="button" class="btn small" data-ws-workspace-view="groups">选择监测群组</button><button type="button" class="btn small" data-ws-workspace-view="exclusions">管理建档排除名单</button></div></section>${renderGroupMonitorCard()}`;
    else if (activeView === 'collection') { const page = wsWorkspacePageState('collection'); body = `${renderCollectionCard()}${businessPages ? businessPages.renderRunDetails(state.collectionRun, page.collectionItems, collectionCapability()) : ''}<section class="ws-workspace-card zk-surface"><div class="ws-card-heading"><div><strong>当前任务采集项</strong><span>当前账号、当前任务已读取的最多 1000 条采集项，保留失败原因与 checkpoint。</span></div><button type="button" class="btn small" data-ws-action="collection-history">查看任务历史</button></div>${renderWorkspaceList('collection', page.collectionItems || [], rows => businessPages ? businessPages.renderCollectionItems(rows) : renderWorkspaceSummaryRows(rows, 'collection'))}</section>${renderWsFlowStrip()}`; }
    else if (activeView === 'contacts') body = renderWorkspaceReadDirectory('contacts');
    else if (activeView === 'exclusions') body = businessPages ? businessPages.renderExclusions(wsWorkspacePageState('exclusions')) : '<p class="ws-error-line" role="alert">业务页面模块未加载，请重新打开应用。</p>';
    else if (activeView === 'ai') body = `<section class="ws-workspace-card zk-surface"><div class="ws-card-heading"><div><strong>AI 智能分析队列</strong><span>保留手动分析；自动分析按当前账号的明确授权和总预算执行。</span></div></div><div class="ws-workspace-metrics"><div><span>待分析</span><strong>${state.summaryLoaded?.ai ? Number(stats.queued || 0) : '—'}</strong><small>真实队列状态</small></div><div><span>处理中</span><strong>${state.summaryLoaded?.ai ? Number(stats.running || 0) : '—'}</strong><small>当前已领取任务</small></div><div><span>失败/死信</span><strong>${state.summaryLoaded?.ai ? Number(stats.failed || 0) : '—'}/${state.summaryLoaded?.ai ? Number(stats.deadLetter || 0) : '—'}</strong><small>保留错误证据</small></div></div>${renderAiAuthorization()}${renderAnalysis()}</section>`;
    else if (activeView === 'crm') body = `${renderWorkspaceCustomers()}<details class="ws-workspace-card zk-surface"><summary>当前会话关联档案与资料补全</summary>${renderDataArchiveSummary()}${renderHotProfile()}</details><section class="ws-workspace-card zk-surface"><p class="ws-muted">CRM 主档是唯一权威来源。普通聊天只匹配已有客户；多匹配进入冲突处理；人工字段不覆盖。AI 候选、来源证据、批准/拒绝及审计继续使用原审核中心。</p></section>`;
    else if (activeView === 'tasks') body = `${renderWorkspaceTaskPage()}<section class="ws-workspace-card zk-surface"><div class="ws-workspace-metrics"><div><span>历史采集任务</span><strong>${esc(run.status || '未提供')}</strong><small>${run.id ? esc(run.id) : '尚无任务或未读取'}</small></div><div><span>已加载待跟进</span><strong>${state.summaryLoaded?.followups ? state.followupAlerts.length : '—'}</strong><small>当前服务返回范围</small></div><div><span>待重试</span><strong>${run.id ? Number(run.retryable || 0) : '—'}</strong><small>未读取不当作成功</small></div></div><button class="btn small" data-ws-action="open-tasks">打开知客任务中心</button></section>`;
    else if (activeView === 'logs') body = renderWorkspaceReadDirectory('logs');
    else if (activeView === 'settings' && state.workspaceMode === 'dedicated') body = `<section class="ws-workspace-card zk-surface"><div class="ws-card-heading"><strong>专用账号设置</strong><span>${esc(accountDisplayName(activeAccount()) || state.activeAccountId)}</span></div><div class="ws-workspace-settings-grid"><div><strong>群组监测</strong><p>${esc(groupMonitorStatusLabel(state.groupMonitor?.profile))}</p><button class="btn small" data-ws-workspace-view="collection">打开群组设置</button></div><div><strong>自动建档排除</strong><p>管理当前账号的排除号码和成员标识。</p><button class="btn small" data-ws-workspace-view="exclusions">管理排除名单</button></div><div><strong>登录会话</strong><p>${esc(state.wsStatus)}</p><button class="btn small" data-ws-workspace-view="chat">打开账号登录</button><button class="btn small" data-ws-action="clear-session">清除登录会话</button></div></div></section>`;
    else if (activeView === 'settings') body = `<section class="ws-workspace-card zk-surface"><div class="ws-card-heading"><div><strong>WS 工作区设置</strong><span>只管理当前账号与工作区偏好。</span></div></div><div class="ws-workspace-settings-grid"><div><strong>翻译</strong><p>${esc(state.translationStatus)}</p><button class="btn small" data-ws-action="focus-assist" data-assist-target="diagnostics">打开翻译设置</button></div><div><strong>自动处理</strong><p>自动 AI 默认关闭，可在 AI 页面明确授权一个私聊及费用上限。群监控按当前账号保存的配置运行。</p><span class="ws-status-badge">按配置运行</span></div></div></section><section class="ws-workspace-card zk-surface"><div class="ws-card-heading"><div><strong>会话工具</strong><span>打开现有功能；发送与采集继续遵循原有确认和账号边界。</span></div></div><div class="ws-workspace-settings-grid"><div><strong>手动导入与本地消息</strong><p>使用现有导入、译文与本地消息记录。</p><button type="button" class="btn small" data-ws-action="open-local-tools">打开本地工具</button></div><div><strong>数据导出</strong><p>导出已有客户、群组、消息和媒体索引。</p><button type="button" class="btn small" data-ws-action="focus-assist" data-assist-target="export">打开导出工具</button></div>${state.workspaceMode === 'ordinary' ? '<div><strong>会话批量发送</strong><p>仅限已有一对一会话，逐个会话人工确认。</p><button type="button" class="btn small" data-ws-action="focus-assist" data-assist-target="broadcast">打开会话发送</button></div>' : ''}<div><strong>登录会话</strong><p>清除后需要重新扫码；本地业务记录保留。</p><button type="button" class="btn small" data-ws-action="clear-session">清除登录会话</button></div></div></section>`;
    if (activeView === 'overview') body = body.replace('<section class="ws-workspace-card zk-surface"><div class="ws-card-heading"><div><strong>工作区入口</strong>', renderWorkspaceOperationalOverview() + '<section class="ws-workspace-card zk-surface"><div class="ws-card-heading"><div><strong>工作区入口</strong>');
    if (activeView === 'settings') body += `<section class="ws-workspace-card zk-surface"><div class="ws-card-heading"><div><strong>AI 配置与本机诊断</strong><span>复用现有设置与加密密钥服务，不创建第二套凭据存储。</span></div></div><div class="ws-workspace-settings-grid"><div><strong>GPT / API Key 配置</strong><p>打开原 GPT 本机设置，只显示配置状态与尾号；本页不读取或展示明文密钥。</p><button type="button" class="btn small" data-gpt-action="settings">打开 GPT 本机设置</button></div><div><strong>采集与连接诊断</strong><p>使用原 WS 诊断面板查看实际服务状态；没有可用性能采样时不伪造 CPU 或内存数据。</p><button type="button" class="btn small" data-ws-action="focus-assist" data-assist-target="diagnostics">打开现有运行诊断</button></div></div></section>`;
    if (activeView === 'overview' || activeView === 'collection') body += `<section class="ws-workspace-card zk-surface"><div class="ws-card-heading"><strong>现场采集状态</strong></div><div class="ws-workspace-settings-grid" id="wsLiveCollectionRuntime">${liveCollectionRuntimeRows()}</div></section>`;
    if (state.workspaceMode === 'ordinary' && (activeView === 'overview' || activeView === 'collection')) body += `<section class="ws-workspace-card zk-surface" id="wsVisibleContactDirectory">${renderVisibleContactDirectory()}</section>`;
    const page = wsWorkspacePageState(activeView);
    return activeView === 'chat' ? '' : `<section class="ws-workspace-page-content" data-ws-workspace-page="${esc(activeView)}" data-ws-account-id="${esc(state.activeAccountId || 'default')}" aria-busy="${page.busy ? 'true' : 'false'}" aria-labelledby="wsWorkspacePageTitle">${workspacePageHeader(meta, account)}${state.wsStatus === '连接失败' ? renderWsErrorBanner() : ''}${activeView === 'collection' ? '' : collectionCapabilityNotice()}${page.error ? `<p class="ws-error-line" role="alert">${esc(page.error)}</p>` : ''}${body}</section>`;
  }
  function renderWsErrorBanner() {
    if (!state.error) return '';
    const reconnect = state.wsStatus === '连接失败' || (state.error === state.wsDetail && ['会话过期', '等待登录'].includes(state.wsStatus));
    return `<div class="ws-error-banner" role="alert"><span>${esc(state.error)}</span><button class="btn small" data-ws-action="${reconnect ? 'open' : 'retry-load'}" ${state.busy.connection ? 'disabled' : ''}>${reconnect ? '重试打开 WS' : '重试加载'}</button></div>`;
  }
  function renderCollectionCard() {
    const { run, fullHistoryCount, pipeline } = wsCollectionPipelineStages();
    const capability = collectionCapability();
    const available = capability.state === 'available';
    const disabled = collectionControlAttributes('automaticHistory');
    const pipelineHtml = `<div class="ws-collection-pipeline">${pipeline.map(([label, value], index) => `<div class="ws-pipeline-stage ${value ? 'has-progress' : ''}"><span class="ws-pipeline-index">${index + 1}</span><div><strong>${esc(label)}</strong><b>${Number(value).toLocaleString()}</b><small>本机已保存记录</small></div></div>`).join('')}</div><p class="ws-coverage-warning">以上为已保存的历史任务计数。自动分析按当前账号的授权设置运行。</p>`;
    const notice = collectionCapabilityNotice();
    const sessionControls = renderCollectorControls();
    if (!run) return `<section class="ws-card ws-collection-card" data-assist-section="diagnostics" data-collection-capability="${esc(capability.state)}"><div class="ws-card-heading"><div><strong>采集任务与历史</strong><span>先为独立采集会话扫码登录，再开始采集已读聊天</span></div></div>${notice}${sessionControls}${pipelineHtml}<button class="btn small primary ws-full-button" data-ws-action="create-collection-run" ${disabled}>新建采集任务</button><button class="btn small" data-ws-action="collect-all-read" ${disabled}>补采完整聊天</button></section>`;
    const pending = Math.max(0, Number(run.total || 0) - Number(run.completed || 0) - Number(run.failed || 0) - Number(run.skipped || 0));
    const controls = run.status === 'paused' ? `<button class="btn small" data-ws-action="resume-collection" ${available && capability.collectorState === 'paused' ? '' : disabled}>继续任务</button>` : ['created', 'running', 'discovering'].includes(run.status) ? `<button class="btn small" data-ws-action="pause-collection">暂停任务</button><button class="btn small danger" data-ws-action="stop-collection">停止任务</button>` : '';
    return `<section class="ws-card ws-collection-card" data-assist-section="diagnostics" data-run-status="${esc(run.status)}" data-collection-capability="${esc(capability.state)}"><div class="ws-card-heading"><div><strong>采集任务与历史</strong><span>${available ? '任务保存状态' : '历史保存状态'}：${esc(run.status)} · 更新于 ${esc(displayTime(run.updatedAt))}${run.lastSuccessAt ? ` · 上次成功 ${esc(displayTime(run.lastSuccessAt))}` : ''}</span></div><div>${controls}<button class="btn small" data-ws-action="resume-collection-checkpoint" ${disabled}>从断点继续</button><button class="btn small" data-ws-action="collect-all-read" ${disabled}>补采完整聊天</button><button class="btn small" data-ws-action="create-collection-run" ${disabled}>新建任务</button></div></div>${notice}${sessionControls}${pipelineHtml}<div class="ws-collection-stats"><b>${Number(run.completed || 0)}/${Number(run.total || run.discovered || 0)}</b><span>列表已同步</span><b>${Number(run.analyzed || 0)}</b><span>已分析</span><b>${fullHistoryCount}</b><span>完整聊天</span><b>${Number(run.skipped || 0)}</b><span>跳过未读</span><b>${Number(run.retryable || 0)}</b><span>待重试</span><b>${pending}</b><span>待处理</span><b>${Number(run.resumeCount || 0)}</b><span>续采次数</span></div>${run.lastError ? `<p class="ws-error-line">${esc(run.lastError)}</p>` : ''}<p class="ws-muted">任务、checkpoint、消息与原队列保留。后台只读取已读且已确认身份的会话；前台聊天和手动导入可同时使用。</p></section>`;
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
      const archive = await api(`/api/data-archive/customer?accountId=${encodeURIComponent(state.activeAccountId)}&conversationId=${encoded}`, {}, context).catch(error => ({ matched: false, customer: null, records: {}, ws: {}, match: { kind: 'error' }, error: error.message }));
      assertContext(context);
      state.archive = archive;
      state.archiveError = archive.error || '';
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
      // Profile refreshes can follow an AI CRM sync. Refresh the read-only
      // archive projection in the same account/conversation scope so the
      // customer card never shows stale business/WS counts.
      void loadDataArchive(context, false);
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
  async function loadDataArchive(context = captureContext(), redraw = true) {
    const current = activeConversation();
    if (!current) { state.archive = null; state.archiveError = ''; if (redraw) render(); return; }
    try {
      const result = await api(`/api/data-archive/customer?accountId=${encodeURIComponent(state.activeAccountId)}&conversationId=${encodeURIComponent(current.id)}`, {}, context);
      assertContext(context);
      state.archive = result;
      state.archiveError = '';
    } catch (error) {
      if (contextCurrent(context)) state.archiveError = String(error?.message || '统一数据档案读取失败').slice(0, 240);
    } finally {
      if (contextCurrent(context) && redraw) render();
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
    if (/@g\.us$/i.test(externalId)) { toast('请在专用 WS 的群组管理中选择该群。', 'x'); return; }
    const context = captureContext();
    state.busy.customer = true;
    render();
    try {
      const item = await api('/api/ws/conversations', { method: 'POST', body: JSON.stringify({
        externalId, title, conversationType: 'direct', data: { source: 'user-local-manual', conversationType: 'direct' },
      }) }, context);
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
  function ordinaryConversationRows() {
    const live = workspaceLiveDirectoryRows('ordinary');
    if (!live.length) return state.conversations;
    const saved = new Map(state.conversations.filter(row => row.accountId === state.activeAccountId).map(row => [row.externalId, row]));
    const liveKeys = new Set(live.map(row => row.externalId));
    return [...live.map(row => {
      const local = saved.get(row.externalId);
      return { ...local, ...row, id: local?.id, title: row.title || local?.title, lastMessageText: row.previewText || '',
        liveOnly: !local, data: local?.data || row.data };
    }), ...state.conversations.filter(row => !liveKeys.has(row.externalId))];
  }
  function ordinaryDirectoryCount() {
    const live = workspaceLiveDirectoryRows('ordinary').length;
    const observed = state.workspaceMode === 'ordinary' && (live > 0 || state.liveDirectory?.foregroundChecked || state.liveDirectory?.finalized);
    const count = observed ? `${live} 个实时会话` : state.lastLoadedAt || state.conversations.length ? `${state.conversations.length} 个本地记录` : '等待目录读取';
    if (liveDirectoryGapMessage()) return `已识别 ${live} 个私聊 · 部分会话未能识别`;
    if (observed && state.liveDirectory?.chatListVisible === false && !state.liveDirectory.collectorObserved) return `上次前台已识别 ${live} 个私聊`;
    return `${count} · ${accountDisplayName(activeAccount())}`;
  }
  function renderConversationList() {
    const query = state.conversationQuery.trim().toLocaleLowerCase();
    const matches = ordinaryConversationRows().filter(item => !query || `${item.title || ''} ${item.externalId || ''} ${item.lastMessageText || ''}`.toLocaleLowerCase().includes(query));
    const lastWindowStart = Math.max(0, Math.floor(Math.max(0, matches.length - 1) / CONVERSATION_RENDER_BATCH) * CONVERSATION_RENDER_BATCH);
    const windowStart = Math.min(lastWindowStart, Math.max(0, Number(state.conversationWindowStart) || 0));
    if (windowStart !== state.conversationWindowStart) state.conversationWindowStart = windowStart;
    const windowEnd = Math.min(matches.length, windowStart + CONVERSATION_RENDER_BATCH);
    const rows = matches.slice(windowStart, windowEnd).map(item => {
      const stamp = displayTime(item.lastMessageAt || item.updatedAt);
      if (item.liveOnly) {
        const selected = state.livePreviewId === item.externalId;
        return `<button class="ws-session-row ${selected ? 'active' : ''}" data-ws-action="select-live-conversation" data-id="${esc(item.externalId)}" aria-expanded="${selected}"><span class="ws-session-copy"><strong>${esc(item.title || item.externalId)}</strong><small>${esc(item.lastMessageText || '现场未提供消息预览')}</small><time>${esc(stamp)} · ${item.liveSource === 'collector' ? '独立采集会话' : '前台 WhatsApp'}</time></span></button>${selected ? `<div class="ws-card"><strong>${esc(item.title || item.externalId)}</strong><p>${esc(item.lastMessageText || '现场未提供消息预览')}</p><button class="btn small" data-ws-action="open">打开此账号的 WhatsApp</button></div>` : ''}`;
      }
      const rawHistoryLoaded = item.data?.historyLoaded === true;
      const historyLoaded = rawHistoryLoaded && Number(item.data?.directionVersion || 0) >= 4;
      const historyCount = Number(item.data?.historyMessageCount || 0);
      const coverage = item.liveSource ? '实时会话' : historyLoaded ? `完整聊天 ${historyCount || ''} 条` : (rawHistoryLoaded ? '待重采校验消息方向' : (item.data?.previewOnly ? '列表预览' : '已导入消息'));
      const selected = String(item.id) === String(state.currentConversationId);
      const kind = String(item.accountId) === String(state.activeAccountId) ? explicitConversationType(item) : 'unknown';
      const group = kind === 'group';
      const name = text(item.title) === text(item.externalId) ? '' : item.title;
      const avatar = kind === 'direct' ? businessPages?.renderPersonAvatar?.({ name, size: 'list', selected }) : '';
      const glyph = avatar || `<span class="ws-session-glyph" ${group ? 'role="img" aria-label="群聊"' : 'aria-hidden="true"'}><svg class="zk-icon" viewBox="0 0 24 24" focusable="false" aria-hidden="true"><use href="#i-${group ? 'users-group' : 'message'}"/></svg></span>`;
      return `<button class="ws-session-row ${selected ? 'active' : ''}" data-ws-action="select-conversation" data-id="${esc(item.id)}">${glyph}<span class="ws-session-copy"><strong>${esc(item.title || item.externalId)}</strong><small>${esc(item.lastMessageText || '尚未导入聊天内容')}</small><time>${esc(stamp || '暂无消息时间')} · ${esc(coverage)}</time></span><span class="ws-session-side"><em>${esc(item.intentLevel || '待分析')}</em>${Number(item.unreadCount) > 0 ? `<b>${Math.min(99, Number(item.unreadCount))}</b>` : ''}</span></button>`;
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
    return `<div class="ws-empty">${query ? '没有匹配的会话。' : liveDirectoryGapMessage() ? esc(liveDirectoryGapMessage()) : state.workspaceMode === 'ordinary' ? '暂无会话。登录 WhatsApp 后可刷新当前窗口可见的个人会话。' : '尚无记录。'}</div>`;
  }
  function summarizeAccountMetrics(accounts, snapshot, mode, now = Date.now()) {
    const scoped = accounts.filter(account => accountWorkspaceMode(account) === mode);
    const rows = new Map((Array.isArray(snapshot?.accounts) ? snapshot.accounts : []).filter(row => row?.workspaceMode === mode).map(row => [String(row.accountId), row]));
    const result = { registered: scoped.length, saved: 0, savedUnknown: 0, savedForeground: 0, savedCollector: 0, savedSessionUnknown: 0, online: 0, onlineUnknown: 0, foreground: 0, collector: 0, webViewUnknown: 0, running: 0, runningUnknown: 0, generatedAt: snapshot?.generatedAt || '' };
    for (const account of scoped) {
      const row = rows.get(String(account.id));
      if (row?.savedSession === 'confirmed') result.saved += 1;
      else if (row?.savedSession !== 'none') result.savedUnknown += 1;
      for (const [field, counter] of [['foregroundSavedSession', 'savedForeground'], ['collectorSavedSession', 'savedCollector']]) {
        if (row?.[field] === 'confirmed') result[counter] += 1;
        else if (row?.[field] !== 'none') result.savedSessionUnknown += 1;
      }
      const at = Date.parse(row?.lastOnlineProbeAt || ''), age = now - at;
      const fresh = Number.isFinite(at) && age >= 0 && age <= 30000;
      if (row?.onlineState === 'recent' && fresh) result.online += 1;
      else if (row?.onlineState !== 'not-online' || !fresh) result.onlineUnknown += 1;
      if (typeof row?.foregroundInitialized === 'boolean' && typeof row?.collectorInitialized === 'boolean') {
        result.foreground += Number(row.foregroundInitialized); result.collector += Number(row.collectorInitialized);
      } else result.webViewUnknown += 1;
      if (typeof row?.collectorRunning === 'boolean') result.running += Number(row.collectorRunning);
      else result.runningUnknown += 1;
    }
    return result;
  }
  function renderAccountMetrics() {
    const metrics = summarizeAccountMetrics(state.accounts, state.accountMetrics, state.workspaceMode);
    const value = (count, unknown) => unknown === metrics.registered && unknown > 0 ? '未知' : String(count);
    const unknown = count => count ? ` · ${count} 个未知` : '';
    const generated = Date.parse(metrics.generatedAt);
    return `<section class="ws-account-metrics" aria-label="当前用途账号指标"><div class="ws-workspace-metrics">
      <div><span>已登记账号</span><strong>${metrics.registered}</strong><small>${esc(workspaceLabel())}登记记录</small></div>
      <div><span>已保存登录会话</span><strong>${metrics.savedSessionUnknown === metrics.registered * 2 && metrics.savedSessionUnknown > 0 ? '未知' : metrics.savedForeground + metrics.savedCollector}</strong><small>前台 ${metrics.savedForeground} · 采集 ${metrics.savedCollector} · 对应 ${metrics.saved} 个账号${unknown(metrics.savedSessionUnknown)}</small></div>
      <div><span>近期检测在线账号</span><strong>${value(metrics.online, metrics.onlineUnknown)}</strong><small>30 秒内前台登录检测${unknown(metrics.onlineUnknown)}</small></div>
      <div><span>已初始化 WebView2</span><strong>${value(metrics.foreground + metrics.collector, metrics.webViewUnknown)}</strong><small>前台 ${metrics.foreground} · 后台 ${metrics.collector}${unknown(metrics.webViewUnknown)}</small></div>
      <div><span>运行采集会话</span><strong>${value(metrics.running, metrics.runningUnknown)}</strong><small>独立采集已启动${unknown(metrics.runningUnknown)}</small></div>
    </div><p class="ws-muted">${Number.isFinite(generated) ? `本机快照：${esc(new Date(generated).toLocaleString())}。` : '尚未读取本机运行快照。'}登记和保存登录不代表当前在线；历史状态不推定登录。点击页面刷新更新指标，不会新开登录窗口。</p></section>`;
  }
  function renderAccountList(accounts = state.accounts) {
    if (state.accountsLoading) return '<div class="ws-empty ws-loading">正在加载 WS 账号…</div>';
    if (!accounts.length) return '<div class="ws-empty">暂无 WS 账号。点击“添加账号”创建本机登录页。</div>';
    return accounts.map(account => {
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
    return `<div class="ws-account-form" role="dialog" aria-label="添加 WS 账号"><p>用途：${workspaceLabel()}；创建后不可更改，登录会话独立。</p><label for="wsAccountDisplayName">本机显示名称</label><input id="wsAccountDisplayName" maxlength="80" autocomplete="off" placeholder="例如：个人号、工作号" value="${esc(state.accountFormName)}"><div class="ws-account-form-actions"><button class="btn small primary" data-ws-action="submit-account" ${state.accountBusy ? 'disabled' : ''}>${state.accountBusy ? '创建中…' : '创建并登录'}</button><button class="btn small" data-ws-action="cancel-account" ${state.accountBusy ? 'disabled' : ''}>取消</button></div>${state.accountFormError ? `<p class="ws-account-form-error">${esc(state.accountFormError)}</p>` : ''}</div>`;
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
    if (!state.messages.length) return '<div class="ws-empty ws-message-empty">当前会话暂无已保存的消息。可在 WhatsApp 查看聊天，或点“采集当前消息”读取前台可见原文。</div>';
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
  function syncWorkbenchAttributes(current, next, preserveScrollAttributes = false) {
    if (!current || !next) return;
    for (const attribute of [...current.attributes]) {
      if (preserveScrollAttributes && (attribute.name.startsWith('data-scroll-') || attribute.name === 'tabindex')) continue;
      if (!next.hasAttribute(attribute.name)) current.removeAttribute(attribute.name);
    }
    for (const attribute of [...next.attributes]) {
      if (preserveScrollAttributes && (attribute.name.startsWith('data-scroll-') || attribute.name === 'tabindex')) continue;
      if (current.getAttribute(attribute.name) !== attribute.value) current.setAttribute(attribute.name, attribute.value);
    }
  }
  function workbenchChildKey(node, occurrence = 0) {
    if (node.id) return `id:${node.id}`;
    const section = node.dataset?.assistSection;
    if (section) return `assist:${section}:${occurrence}`;
    const className = [...(node.classList || [])].find(value => String(value).startsWith('ws-')) || node.tagName;
    return `class:${className || ''}:${occurrence}`;
  }
  function reconcileWorkbenchChildren(current, next, preservedIds = new Set(), preserveScrollAttributes = false) {
    if (!current || !next) return;
    const currentChildren = [...current.children];
    const used = new Set();
    const occurrences = new Map();
    const nextChildren = [...next.children];
    const keyFor = child => {
      if (child.id) return `id:${child.id}`;
      const base = child.dataset?.assistSection ? `assist:${child.dataset.assistSection}` : `class:${[...(child.classList || [])].find(value => String(value).startsWith('ws-')) || child.tagName}`;
      const occurrence = occurrences.get(base) || 0;
      occurrences.set(base, occurrence + 1);
      return `${base}:${occurrence}`;
    };
    const desired = nextChildren.map(child => ({ child, key: keyFor(child) }));
    for (const { child, key } of desired) {
      const existing = currentChildren.find(candidate => !used.has(candidate) && workbenchChildKey(candidate, Number(key.split(':').at(-1)) || 0) === key);
      if (existing) {
        used.add(existing);
        if (preservedIds.has(existing.id)) {
          syncWorkbenchAttributes(existing, child, preserveScrollAttributes);
        } else {
          existing.replaceWith(child.cloneNode(true));
        }
      } else {
        current.appendChild(child.cloneNode(true));
      }
    }
    for (const child of currentChildren) if (!used.has(child) && !preservedIds.has(child.id)) child.remove();
  }
  function patchWorkbenchCenter(current, next, preservedBrowserHost) {
    if (!current || !next) return;
    syncWorkbenchAttributes(current, next);
    const oldHost = current.querySelector('#wsBrowserHost');
    const nextHost = next.querySelector('#wsBrowserHost');
    reconcileWorkbenchChildren(current, next, new Set(['wsBrowserHost']));
    if (oldHost && !current.contains(oldHost)) current.appendChild(oldHost);
    if (!oldHost && nextHost) current.querySelector('#wsBrowserHost')?.replaceWith(nextHost.cloneNode(true));
    const verification = current.querySelector('#wsGroupVerification'), host = current.querySelector('#wsBrowserHost');
    if (verification && host && verification.nextElementSibling !== host) current.insertBefore(verification, host);
    // The native host is intentionally never replaced or moved. It remains at
    // the same DOM anchor while the toolbar/capture/message siblings update.
    if (preservedBrowserHost && oldHost && preservedBrowserHost !== oldHost) preservedBrowserHost.replaceWith(oldHost);
  }
  function patchWorkbenchAssist(current, next) {
    if (!current || !next) return;
    syncWorkbenchAttributes(current, next, true);
    // Keep the drawer and its scroll body mounted while replacing only the
    // header controls, tabs and cards. This avoids a scroll-top jump on every
    // background AI/collection tick and keeps the native WebView untouched.
    const currentDrawer = current.querySelector('#wsAssistDrawer');
    const nextDrawer = next.querySelector('#wsAssistDrawer');
    if (currentDrawer && nextDrawer) {
      syncWorkbenchAttributes(currentDrawer, nextDrawer, true);
      const currentHeader = currentDrawer.querySelector('.ws-assist-drawer-header');
      const nextHeader = nextDrawer.querySelector('.ws-assist-drawer-header');
      if (currentHeader && nextHeader) {
        // Keep the live header mounted. Replacing it during a background
        // collection tick disconnects the resize handle and drops keyboard
        // focus while the operator is using the drawer.
        syncWorkbenchAttributes(currentHeader, nextHeader, true);
        const currentTitle = currentHeader.querySelector('#wsAssistDrawerTitle');
        const nextTitle = nextHeader.querySelector('#wsAssistDrawerTitle');
        const currentSubtitle = currentHeader.querySelector('.ws-assist-drawer-title span');
        const nextSubtitle = nextHeader.querySelector('.ws-assist-drawer-title span');
        if (currentTitle && nextTitle && currentTitle.textContent !== nextTitle.textContent) currentTitle.textContent = nextTitle.textContent;
        if (currentSubtitle && nextSubtitle && currentSubtitle.textContent !== nextSubtitle.textContent) currentSubtitle.textContent = nextSubtitle.textContent;
      }
      const currentTabs = currentDrawer.querySelector('.ws-assist-tabs');
      const nextTabs = nextDrawer.querySelector('.ws-assist-tabs');
      if (currentTabs && nextTabs) {
        syncWorkbenchAttributes(currentTabs, nextTabs, true);
        const currentTabNodes = [...currentTabs.children];
        const nextTabNodes = [...nextTabs.children];
        nextTabNodes.forEach((nextTab, index) => {
          const currentTab = currentTabNodes[index];
          if (!currentTab) return;
          syncWorkbenchAttributes(currentTab, nextTab, true);
          if (currentTab.textContent !== nextTab.textContent) currentTab.textContent = nextTab.textContent;
        });
        for (const currentTab of currentTabNodes.slice(nextTabNodes.length)) currentTab.remove();
        for (const nextTab of nextTabNodes.slice(currentTabNodes.length)) currentTabs.appendChild(nextTab.cloneNode(true));
      }
      const currentBody = currentDrawer.querySelector('#wsAssistDrawerBody');
      const nextBody = nextDrawer.querySelector('#wsAssistDrawerBody');
      if (currentBody && nextBody) {
        const activeElement = document.activeElement;
        const activeBodyId = activeElement && currentBody.contains(activeElement) ? String(activeElement.id || '') : '';
        const activeSelection = activeBodyId && typeof activeElement.selectionStart === 'number'
          ? { start: activeElement.selectionStart, end: activeElement.selectionEnd } : null;
        syncWorkbenchAttributes(currentBody, nextBody, true);
        reconcileWorkbenchChildren(currentBody, nextBody, new Set(), true);
        if (activeBodyId) {
          const restored = document.getElementById(activeBodyId);
          if (restored && currentBody.contains(restored)) {
            restored.focus?.({ preventScroll: true });
            if (activeSelection && typeof restored.setSelectionRange === 'function') {
              try { restored.setSelectionRange(activeSelection.start, activeSelection.end); } catch {}
            }
          }
        }
      }
    }
    reconcileWorkbenchChildren(current, next, new Set(['wsAssistDrawer']), true);
  }
  function mountWsWorkbenchShell(target, markup) {
    // The desktop WebView always exposes template elements. Minimal contract
    // harnesses may provide only innerHTML; retain that compatibility path
    // without affecting the production incremental mount.
    if (typeof document.createElement !== 'function') {
      target.innerHTML = markup;
      return;
    }
    const template = document.createElement('template');
    template.innerHTML = String(markup || '').trim();
    const nextShell = template.content.firstElementChild;
    const nextPage = nextShell?.querySelector('.ws-workbench-page');
    const currentShell = target.querySelector('.ws-workbench-shell');
    const currentPage = target.querySelector('.ws-workbench-page');
    if (!nextPage || !currentPage || !currentShell) {
      target.innerHTML = markup;
      return;
    }
    syncWorkbenchAttributes(currentShell, nextShell);
    const currentNav = currentShell.querySelector('.ws-workspace-nav');
    const nextNav = nextShell.querySelector('.ws-workspace-nav');
    if (currentNav && nextNav) currentNav.replaceWith(nextNav.cloneNode(true));
    syncWorkbenchAttributes(currentPage, nextPage);
    const nextLayout = nextPage.querySelector('.ws-layout');
    const currentLayout = currentPage.querySelector('.ws-layout');
    if (!nextLayout || !currentLayout) {
      target.innerHTML = markup;
      return;
    }
    syncWorkbenchAttributes(currentLayout, nextLayout);
    const currentSessions = currentLayout.querySelector('#wsSessionsPanel');
    const nextSessions = nextLayout.querySelector('#wsSessionsPanel');
    if (currentSessions && nextSessions) currentSessions.replaceWith(nextSessions.cloneNode(true));
    const currentCenter = currentLayout.querySelector('.ws-center-panel');
    const nextCenter = nextLayout.querySelector('.ws-center-panel');
    const currentHost = currentCenter?.querySelector('#wsBrowserHost');
    if (currentCenter && nextCenter) patchWorkbenchCenter(currentCenter, nextCenter, currentHost);
    const currentAssist = currentLayout.querySelector('#wsAssistPanel');
    const nextAssist = nextLayout.querySelector('#wsAssistPanel');
    if (currentAssist && nextAssist) patchWorkbenchAssist(currentAssist, nextAssist);
    // Update direct page chrome around the preserved layout without replacing
    // the layout itself. This keeps the native WebView anchor mounted.
    const pageChildren = [...currentPage.children];
    const desiredChildren = [...nextPage.children];
    const currentLayoutAfter = currentPage.querySelector('.ws-layout');
    const desiredKeys = new Set(desiredChildren.filter(child => child !== nextLayout).map((child, index) => workbenchChildKey(child, index)));
    for (const desired of desiredChildren) {
      if (desired === nextLayout) continue;
      const key = workbenchChildKey(desired, desiredChildren.indexOf(desired));
      const existing = pageChildren.find(child => child !== currentLayoutAfter && workbenchChildKey(child, desiredChildren.indexOf(desired)) === key);
      if (existing) existing.replaceWith(desired.cloneNode(true));
      else currentPage.insertBefore(desired.cloneNode(true), currentLayoutAfter || null);
    }
    for (const child of pageChildren) {
      if (child === currentLayoutAfter) continue;
      const key = workbenchChildKey(child, pageChildren.indexOf(child));
      if (!desiredKeys.has(key)) child.remove();
    }
  }
  function render(options = {}) {
    groupReading?.discardStale();
    groupPermissions?.discardStale();
    groupChannels?.discardStale();
    groupDrafts?.discardStale();
    const host = getHost();
    if (!host || !state.active || host.state.view !== 'ws-workbench') return;
    const target = $('#viewContainer');
    if (!target) return;
    captureWorkspaceNavScroll();
    if (!modeAccount(state.activeAccountId)) {
      const blocked = WS_BLOCKED_VIEWS.has(state.wsWorkspaceView) || state.wsWorkspaceView === 'group-broadcast' ? renderWsWorkspacePage(state.wsWorkspaceView) : '';
      target.innerHTML = `<div class="ws-workbench-shell ${state.wsWorkspaceNavCollapsed ? 'ws-nav-collapsed' : ''}" data-ws-workspace-mode="${state.workspaceMode}">${renderWsWorkspaceNav()}<div class="ws-workbench-page ws-workspace-empty"><section class="ws-workspace-page-content"><h2>${workspaceLabel()}</h2><p role="status">${state.accountsLoading ? '正在读取此用途的账号…' : '当前用途暂无可用账号。添加账号后需独立扫码登录。'}</p>${state.error ? '<p class="ws-error-line" role="alert">' + esc(state.error) + '</p>' : ''}<button class="btn primary" data-ws-action="create-account">添加${workspaceLabel()}账号</button><button class="btn" data-ws-action="refresh-accounts">刷新账号列表</button>${renderAccountForm()}${renderAccountMetrics()}</section>${blocked}</div></div>`;
      restoreWorkspaceNavScroll();
      return;
    }
    const previousWorkspacePage = $('[data-ws-workspace-page]');
    if (previousWorkspacePage) wsWorkspacePageState(previousWorkspacePage.dataset.wsWorkspacePage, previousWorkspacePage.dataset.wsAccountId).scrollTop = Number(previousWorkspacePage.scrollTop || 0);
    // Keep the native WebView host node alive while the surrounding shell is
    // refreshed.  Collection polling and AI queue updates can redraw this
    // page frequently; replacing #wsBrowserHost on every redraw makes the
    // native overlay detach/re-attach and produces a visible jump or flicker
    // in the WhatsApp surface.  The host is reinserted into the new shell
    // immediately after the markup is replaced, so the business state still
    // renders normally while the native session keeps its anchor node.
    const preservedBrowserHost = $('#wsBrowserHost');
    const draftInput = state.wsWorkspaceView === 'group-broadcast' ? document.activeElement : null;
    const draftInputKey = draftInput?.dataset?.wsGroupDraftInput;
    const draftSelection = [draftInput?.selectionStart, draftInput?.selectionEnd];
    // Keep the right assistant drawer alive across shell redraws. Its body is
    // the only assistant scroll owner; replacing that node makes the browser
    // briefly create a new scroll box at top before the old position can be
    // restored. We still patch its children below so counters and AI results
    // are rendered from current state without touching the native WebView.
    const preservedAssistPanel = $('#wsAssistPanel');
    const preservedAssistBody = $('#wsAssistDrawerBody');
    const preservedAssistScrollTop = Number(preservedAssistBody?.scrollTop || 0);
    const preservedAssistScrollLeft = Number(preservedAssistBody?.scrollLeft || 0);
    rendering = true;
    const current = activeConversation();
    const draft = currentDraft();
    const captureRows = core.parseVisibleChat(draft.captureText, state.captureDirection);
    const receiveCount = captureRows.filter(row => row.direction === 'receive').length;
    const sendCount = captureRows.length - receiveCount;
    const errorBanner = renderWsErrorBanner();
    const loadingBanner = state.loading ? '<div class="ws-loading-banner">正在读取本机会话数据…</div>' : '';
    const matchHtml = state.matchCandidates.length ? `<div class="ws-match-candidates"><strong>请选择要关联的客户：</strong>${state.matchCandidates.map(item => `<button class="btn small" data-ws-action="save-customer-to" data-id="${esc(item.id)}">${esc(item.name || item.rawPhone || item.id)}</button>`).join('')}</div>` : '';
    const replyHistory = state.replies.slice(0, 5).map(item => `<li><span>${esc((item.translatedText || item.originalText || '').slice(0, 80))}</span><time>${esc(displayTime(item.createdAt))}</time></li>`).join('');
    const failedTranslations = state.messages.filter(item => item.translationStatus === 'failed' || item.translationError).length;
    const loadedDirections = loadedMessageDirectionCounts();
    const statusDetail = state.wsDetail || (state.wsStatus === '已连接' ? '已通过页面结构确认 WS 主界面；未读取 Cookie 或消息正文。' : '请在中栏自行完成扫码或登录。');
    const collectionRun = state.collectionRun;
    const fullHistoryCount = state.conversations.filter(item => item.data?.historyLoaded === true && Number(item.data?.directionVersion || 0) >= 4 && Boolean(fullHistorySourceFingerprint(item))).length;
    const { label: runtimeStatus, tone: runtimeTone } = wsBackgroundStatus();
    const loginFocus = state.wsStatus !== '已连接' && state.captureCollapsed && !state.loginLayoutExpanded;
    const runtimeOverview = `<div class="ws-runtime-strip" aria-label="WS 后台运行概览">
      <span class="ws-runtime-primary" data-tone="${runtimeTone}"><i></i><b>${runtimeStatus}</b></span>
      <span><small>列表</small><b>${Number(collectionRun?.discovered || state.conversations.length || 0).toLocaleString()}</b></span>
      <span><small>完整历史</small><b>${fullHistoryCount.toLocaleString()}</b></span>
      <span><small>待分析</small><b>${Number(state.aiQueueStats.queued || 0).toLocaleString()}</b></span>
      <span><small>死信</small><b>${Number(state.aiQueueStats.deadLetter || 0).toLocaleString()}</b></span>
      <span><small>跳过未读</small><b>${Number(collectionRun?.skipped || state.readHistorySkipped.length || 0).toLocaleString()}</b></span>
      <div class="ws-runtime-actions"><button type="button" data-ws-action="open-home">今日工作台</button><button type="button" data-ws-action="open-tasks">任务中心</button></div>
    </div>`;
    const assistPanelClosed = !state.assistDrawerOpen;
    const markup = `
      <div class="ws-workbench-shell ${state.wsWorkspaceNavCollapsed ? 'ws-nav-collapsed' : ''}">
        ${renderWsWorkspaceNav()}
      <div class="ws-workbench-page workspace-${WS_WORKSPACE_VIEW_IDS.has(state.wsWorkspaceView) ? state.wsWorkspaceView : 'overview'} ${loginFocus ? 'is-login-focus' : ''} ${state.manualToolsVisible ? 'ws-local-tools-open' : ''}" data-ws-account-id="${esc(state.activeAccountId || 'default')}">
        ${renderWsWorkspacePage(state.wsWorkspaceView)}
        <div class="page-heading ws-page-heading">
          <div><h1 class="page-title">${state.workspaceMode === 'dedicated' ? '专用登录' : '前台聊天'}</h1>${state.workspaceMode === 'dedicated' ? `<p id="wsDedicatedLoginDetail" class="page-subtitle ws-dedicated-login-detail" role="status">${esc(dedicatedLoginDetail())}</p>` : ''}<p class="page-subtitle" title="登录资料由各自的 WebView2 会话保存，不复制账号认证数据" aria-label="内嵌 WhatsApp Web；前台聊天可用；后台采集使用独立扫码会话；登录资料由各自的 WebView2 会话保存，不复制账号认证数据">内嵌 WhatsApp Web · 前台聊天可用；后台采集使用独立扫码会话</p></div>
          <div class="heading-actions">
            <span class="ws-chat-background-status" data-tone="${runtimeTone}" data-collection-capability="${esc(collectionCapability().state)}" role="status" title="${esc(collectionCapability().state === 'available' ? collectionCapability().reason : collectionBlockedResult().error)}" aria-label="${esc(collectionCapability().state === 'available' ? runtimeStatus : collectionBlockedResult().error)}">${esc(runtimeStatus)}</span>
            ${renderCollectorControls()}
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
            <button class="btn small ws-heading-collapse ws-chat-advanced" data-ws-action="toggle-left" aria-expanded="${state.leftCollapsed ? 'false' : 'true'}" aria-controls="wsSessionsPanel">${state.leftCollapsed ? '显示会话' : '隐藏会话'}</button>
            <button class="btn small ws-heading-collapse" data-ws-action="toggle-right" aria-expanded="${state.assistDrawerOpen ? 'true' : 'false'}" aria-controls="wsAssistPanel">${state.assistDrawerOpen ? '收起CRM' : '展开CRM'}</button>
          </div>
        </div>
        ${errorBanner}${loadingBanner}
        ${renderWsCockpit()}
        <div class="ws-mobile-tabs">
          <button data-ws-action="mobile-left" class="${state.mobilePanel === 'left' ? 'active' : ''}">会话</button>
          <button data-ws-action="mobile-center" class="${state.mobilePanel === 'center' ? 'active' : ''}">聊天</button>
          <button data-ws-action="mobile-right" class="${state.mobilePanel === 'right' ? 'active' : ''}">翻译与 AI</button>
        </div>
        <div class="ws-layout ${state.leftCollapsed ? 'left-collapsed' : ''} ${assistPanelClosed ? 'right-collapsed assist-closed' : 'assist-open'} mobile-${state.mobilePanel}" style="--ws-assist-column-width:${assistDrawerColumnWidth()}px;--ws-assist-drawer-width:${state.assistDrawerWidth}px;--ws-assist-drawer-offset-x:${state.assistDrawerOffset.x}px;--ws-assist-drawer-offset-y:${state.assistDrawerOffset.y}px">
          <aside id="wsSessionsPanel" class="ws-sessions-panel" aria-label="WS 账号与会话">
            <button class="ws-sidebar-collapse ws-sidebar-collapse-left" data-ws-action="toggle-left" aria-expanded="${state.leftCollapsed ? 'false' : 'true'}" aria-controls="wsSessionsPanel" title="${state.leftCollapsed ? '展开会话栏' : '收起会话栏'}"><span aria-hidden="true">${state.leftCollapsed ? '›' : '‹'}</span><b>${state.leftCollapsed ? '会话' : '收起'}</b></button>
            <div class="ws-panel-heading"><div><strong>WS 账号</strong><span>${state.accounts.length} 个已登记账号</span></div><button class="btn small" data-ws-action="create-account" ${state.accountBusy ? 'disabled' : ''}>＋ 添加账号</button></div>
            ${renderAccountForm()}<div class="ws-account-list">${renderAccountList()}</div>
            <div class="ws-panel-heading ws-conversation-heading"><div><strong>会话</strong><span id="wsDirectoryCount">${esc(ordinaryDirectoryCount())}</span></div>${state.workspaceMode === 'ordinary' ? '<button class="btn small" data-ws-action="refresh-live-conversations">刷新实时会话</button>' : ''}<button class="icon-button" data-ws-action="new-conversation" title="建立会话">＋</button></div>
            <input id="wsConversationSearch" class="ws-search-input" placeholder="搜索客户、标识或消息" value="${esc(state.conversationQuery)}">
            <div class="ws-create-session">
              <input id="wsConversationExternalId" placeholder="会话标识（由你输入）" maxlength="160" value="${esc(state.createExternalId)}">
              <input id="wsConversationTitle" placeholder="客户名称（可选）" maxlength="80" value="${esc(state.createTitle)}">
              <button class="btn small primary" data-ws-action="create-conversation" ${state.busy.customer ? 'disabled' : ''}>${state.busy.customer ? '正在建立…' : '建立本机会话'}</button>
            </div>
            ${state.workspaceMode === 'ordinary' ? `<div id="wsVisibleContactDirectory">${renderVisibleContactDirectory()}</div>` : ''}
            <div class="ws-session-list">${renderConversationList()}</div>
          </aside>
          <section id="wsCenterPanel" class="ws-center-panel ${state.messageCollapsed ? 'messages-collapsed' : ''} ${state.localPanelsCollapsed ? 'local-panels-collapsed' : ''}">
            <div class="ws-login-toolbar ws-command-rail">
              <div class="ws-login-summary"><strong>${esc(accountDisplayName(activeAccount()) || 'WS 登录入口')}</strong><span id="wsStatusDetail" class="ws-login-status" title="${esc(statusDetail)}">${esc(statusDetail)}</span></div>
              ${runtimeOverview}
              <div class="ws-toolbar-actions">
                <button class="btn small primary ws-toolbar-open" data-ws-action="open" ${state.busy.connection || state.busy.collector ? 'disabled' : ''}>${state.busy.connection ? '处理中…' : state.workspaceMode === 'dedicated' ? (state.wsStatus === '已连接' ? '打开专用会话' : '打开专用登录') : state.wsStatus === '已连接' ? '已打开 WS' : '打开 WS'}</button>
                ${state.wsStatus !== '已连接' ? `<button class="btn small" data-ws-action="toggle-login-layout">${loginFocus ? '显示工作区' : '扩大登录区'}</button>` : ''}
                <button class="btn small" data-ws-action="probe">检测状态</button>
                <button class="btn small" data-ws-action="discover-conversations" ${collectionControlAttributes()}>扫描全部会话列表</button>
                <button class="btn small primary ws-toolbar-collect" data-ws-action="collect-all-read" ${collectionControlAttributes('automaticHistory')}>采集已读完整聊天</button>
                <button class="btn small" data-ws-action="reconnect">重新连接</button>
                <button class="btn small" data-ws-action="reload">刷新页面</button>
                <button class="btn small danger" data-ws-action="close">关闭 WS</button>
                <button class="btn small" data-ws-action="clear-session">清除登录会话</button>
                <button class="btn small ws-local-panels-toggle" data-ws-action="toggle-local-panels" aria-expanded="${state.localPanelsCollapsed ? 'false' : 'true'}" aria-controls="wsCenterPanel">${state.localPanelsCollapsed ? '展开本地面板' : '收起本地面板'}</button>
              </div>
            </div>
            ${state.workspaceMode === 'dedicated' && state.wsWorkspaceView === 'chat' ? `<section class="ws-group-verify" id="wsGroupVerification">${renderGroupVerification('chat')}</section>` : ''}
            <div id="wsBrowserHost" class="ws-browser-host"><div class="ws-browser-placeholder"><strong>官方 WS 页面会显示在这里</strong><span>用户自行登录；知客不会读取密码、Cookie 或二维码。</span></div></div>
            ${state.localPanelsCollapsed ? '' : `
            <div class="ws-local-workspace">
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
            ${renderVisibleForegroundChat()}<div class="ws-message-heading ${state.messageCollapsed ? 'is-collapsed' : ''}">
              <div class="ws-message-heading-copy"><strong>本地消息</strong><span>${state.historyCoverage.complete ? '本机已保存的完整聊天记录' : '已保存的聊天记录'} · 当前已加载：我方 ${loadedDirections.send} · 客户 ${loadedDirections.receive} · 待核实 ${loadedDirections.pending}</span></div>
              <div class="ws-message-heading-actions">${failedTranslations ? `<button class="btn small" data-ws-action="retry-failed">重试 ${failedTranslations} 条失败翻译</button>` : ''}<button class="btn small ws-message-toggle" data-ws-action="toggle-messages" aria-expanded="${state.messageCollapsed ? 'false' : 'true'}" aria-controls="wsMessagePanel">${state.messageCollapsed ? '展开本地消息' : '收起本地消息'}</button><button class="btn small ws-local-panels-toggle" data-ws-action="toggle-local-panels" aria-expanded="true" aria-controls="wsCenterPanel">彻底收起</button></div>
            </div>
            <div id="wsMessagePanel" class="ws-message-panel ${state.messageCollapsed ? 'is-collapsed' : ''}">${state.messageCollapsed ? '<div class="ws-message-collapsed-note">已收起保存的聊天记录。</div>' : `<div class="ws-message-list">${renderMessageRows()}</div>`}</div></div>`}
          </section>
          <aside id="wsAssistPanel" class="ws-assist-panel ws-chat-crm ${state.assistDrawerOpen ? 'is-open' : 'is-closed'}" aria-label="CRM客户档案与辅助工具" style="--ws-assist-column-width:${assistDrawerColumnWidth()}px;--ws-assist-drawer-width:${state.assistDrawerWidth}px">
            ${state.assistDrawerOpen ? '<button class="ws-assist-drawer-backdrop" data-ws-action="assist-backdrop" aria-label="关闭辅助面板" tabindex="-1"></button>' : ''}
            <button class="ws-assist-launcher" data-ws-action="open-assist-drawer" aria-expanded="${state.assistDrawerOpen ? 'true' : 'false'}" aria-controls="wsAssistDrawer" title="展开CRM客户档案">CRM</button>
            <div id="wsAssistDrawer" class="ws-assist-drawer ${state.assistDrawerOpen ? 'is-open' : 'is-closed'}" role="dialog" aria-modal="false" aria-labelledby="wsAssistDrawerTitle">
              <header class="ws-assist-drawer-header" data-assist-drawer-drag="true">
                <div class="ws-assist-drawer-title"><strong id="wsAssistDrawerTitle">${esc(assistDrawerTabMeta(state.assistDrawerTab).title)}</strong><span>${esc(assistDrawerTabMeta(state.assistDrawerTab).subtitle)}</span></div>
                <button id="wsAssistDrawerHandle" class="ws-assist-drawer-handle" data-ws-action="assist-drawer-handle" aria-label="拖动调整辅助面板宽度" title="拖动调整宽度">⋮</button>
                <button id="wsAssistDrawerClose" class="ws-assist-drawer-close" data-ws-action="close-assist-drawer" aria-label="关闭辅助面板">×</button>
              </header>
              ${renderWsAssistTabs()}
              <div id="wsAssistDrawerBody" class="ws-assist-drawer-body">
            <button class="ws-sidebar-collapse ws-sidebar-collapse-right" data-ws-action="toggle-right" aria-expanded="${state.assistDrawerOpen ? 'true' : 'false'}" aria-controls="wsAssistPanel" title="${state.assistDrawerOpen ? '收起辅助栏' : '展开辅助栏'}"><span aria-hidden="true">${state.assistDrawerOpen ? '›' : '‹'}</span><b>${state.assistDrawerOpen ? '收起' : '辅助'}</b></button>
            ${renderDataArchiveSummary()}
            ${renderHotProfile()}
            <section class="ws-card" data-assist-section="profile">
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
            <section class="ws-card ws-translation-card" data-assist-section="diagnostics">
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
             <section class="ws-card ws-ai-card" data-assist-section="ai">
              <div class="ws-card-heading"><div><strong>AI 分析</strong><span>${state.historyCoverage.complete ? `当前客户完整聊天 ${state.historyCoverage.loaded} 条` : '完整历史采集完成后分析全部客户聊天'} · 队列 ${Number(state.aiQueueStats.queued || 0)} 待处理 / ${Number(state.aiQueueStats.retryable || 0)} 待重试 / ${Number(state.aiQueueStats.deadLetter || 0)} 死信</span></div><label class="ws-switch"><input id="wsAiEnabled" type="checkbox" ${state.aiEnabled ? 'checked' : ''}><span>AI 开关</span></label></div>
              ${renderAiStatus()}
              <div id="wsAiBackgroundError" class="ws-error-line" ${state.aiBackgroundError ? '' : 'hidden'}><span data-ws-ai-error-text>${esc(state.aiBackgroundError || '')}</span><button class="btn small" data-ws-action="resume-ai-queue" ${state.aiRetryScope ? '' : 'hidden'}>立即重试</button></div>
              <button class="btn small primary ws-full-button" data-ws-action="analyze" ${!current || !state.messages.length || !state.aiEnabled || state.aiBusy ? 'disabled' : ''}>${state.aiBusy ? '分析中…' : state.analysis ? '重新分析当前聊天' : '分析当前聊天'}</button>
              <button class="btn small ws-full-button" data-ws-action="analyze-recent" ${!current || !state.messages.length || !state.aiEnabled || state.aiBusy ? 'disabled' : ''}>重新分析最近 7 天</button>
              ${renderAiAuthorization()}
              <div class="ws-analysis-content">${renderAnalysis()}</div>
            </section>
            ${renderCollectionCard()}
            ${renderGroupMonitorCard()}
            ${state.workspaceMode === 'ordinary' ? renderBroadcastCard() : ''}
            ${renderWsExportCard()}
            <section class="ws-card" data-assist-section="reply">
              <div class="ws-card-heading"><div><strong>跟进记录</strong><span>保存前创建本机快照，失败自动回滚</span></div></div>
              <textarea id="wsFollowupNote" rows="3" placeholder="本次跟进结果">${esc(draft.followupNote)}</textarea>
              <label class="ws-follow-date">下次跟进 <input id="wsNextFollow" type="date" value="${esc(draft.nextFollow)}"></label>
              <button class="btn small ws-full-button" data-ws-action="save-followup" ${!current || state.busy.followup ? 'disabled' : ''}>${state.busy.followup ? '保存中…' : '保存跟进'}</button>
            </section>
            <section class="ws-card" data-assist-section="reply">
              <div class="ws-card-heading"><div><strong>回复建议</strong><span>默认只预览或复制，绝不自动发送</span></div></div>
              <textarea id="wsReplyInput" rows="3" placeholder="输入或采用 AI 回复建议">${esc(draft.replyInput)}</textarea>
              <p id="wsDraftPersistenceStatus" class="ws-error-line" role="status">${esc(draftPersistenceMessage())}</p><button id="wsDraftPersistRetry" class="btn small" data-ws-action="retry-draft-persist" ${draftPersistenceMessage() ? '' : 'hidden'}>重试保存草稿</button>
              <div class="ws-reply-actions"><button class="btn small" data-ws-action="translate-reply" ${!current || state.busy.reply ? 'disabled' : ''}>手动翻译预览</button><button class="btn small primary" data-ws-action="copy-reply" ${!current || state.busy.reply ? 'disabled' : ''}>${state.busy.reply ? '处理中…' : '确认并复制'}</button></div>
              <div id="wsReplyPreview" class="ws-reply-preview">${draft.replyError ? `<p class="ws-error-line">${esc(draft.replyError)}</p>` : draft.replyPreview ? `<div class="ws-reply-warning">发送前请人工确认译文。</div><strong>预览 · ${esc(draft.replyPreviewLanguage || '原文')}</strong><p>${esc(draft.replyPreview)}</p>` : '<span class="ws-muted">尚未生成预览。</span>'}</div>
              ${replyHistory ? `<div class="ws-reply-history"><strong>最近复制记录</strong><ul>${replyHistory}</ul></div>` : ''}
            </section>
              </div>
            </div>
          </aside>
        </div>
        ${renderWsFlowStrip()}
      </div>
      </div>
    `;
    mountWsWorkbenchShell(target, markup);
    restoreWorkspaceNavScroll();
    const mountedWorkspacePage = $('[data-ws-workspace-page]');
    if (mountedWorkspacePage) mountedWorkspacePage.scrollTop = wsWorkspacePageState().scrollTop;
    const mountedAssistBody = $('#wsAssistDrawerBody');
    if (mountedAssistBody) {
      const maxTop = Math.max(0, Number(mountedAssistBody.scrollHeight || 0) - Number(mountedAssistBody.clientHeight || 0));
      const maxLeft = Math.max(0, Number(mountedAssistBody.scrollWidth || 0) - Number(mountedAssistBody.clientWidth || 0));
      mountedAssistBody.scrollTop = Math.min(Math.max(0, preservedAssistScrollTop), maxTop);
      mountedAssistBody.scrollLeft = Math.min(Math.max(0, preservedAssistScrollLeft), maxLeft);
    }
    updateStatusDom();
    rendering = false;
    if (['query', 'message'].includes(draftInputKey)) {
      const replacement = document.querySelector(`[data-ws-group-draft-input="${draftInputKey}"]`);
      replacement?.focus?.({ preventScroll: true });
      if (Number.isInteger(draftSelection[0])) replacement?.setSelectionRange?.(...draftSelection);
    }
    const browserHost = $('#wsBrowserHost');
    if (browserHost && typeof ResizeObserver === 'function' && browserResizeObservedHost !== browserHost) {
      browserResizeObserver?.disconnect?.();
      browserResizeObserver = new ResizeObserver(() => {
        if (state.active) queueResizeWsView();
      });
      browserResizeObservedHost = browserHost;
      browserResizeObserver.observe(browserHost);
    }
    if (options.skipNativeResize !== true) queueResizeWsView();
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
    if (!canManuallyProcessConversation(current)) { toast(isExplicitGroupConversation(current) ? ordinaryGroupExclusionMessage() : '当前聊天类型尚未确认是一对一会话，已停止导入。', 'x'); return; }
    if (importType.type === 'group') { toast(`检测到明确的 WhatsApp 群聊导出；${ordinaryGroupExclusionMessage('客户采集、AI 分析或提醒')}`, 'x'); return; }
    if (importType.reason === 'multiple-senders') { toast(`检测到 ${Number(importType.senderCount || 0)} 位发言人，无法确认为一对一聊天；请导入单个客户的一对一记录。`, 'x'); return; }
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

  // Re-analyse only the last `days` of the current private chat (V5.0 §15).
  // Messages without a known send time cannot be proven to be in range, so
  // they are excluded; the result says how many were left out.
  function recentRangeStart(days = 7) {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() - Math.max(1, Math.floor(days)) + 1);
    return start.toISOString();
  }
  async function analyzeRecentConversation(context = captureContext()) {
    return analyzeConversation({ ...context, rangeStart: recentRangeStart(7), force: true });
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
          body: JSON.stringify({ conversationId: current.id, jobId: aiJob.job.id, leaseToken: aiJob.job.leaseToken, result: state.analysis, confidence: state.analysis.confidence, providerName: state.analysis.providerName, model: state.analysis.model }),
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
      void loadDataArchive({ ...context, conversationId: current.id }, false);
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
    updateReplyDraftInput(draft, suggestion, true);
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
    const draftKey = `${context.accountId}:${String(current.id)}`;
    const revision = Number(draft.replyRevision || 0);
    const sameInput = () => Number(draft.replyRevision || 0) === revision && text(draft.replyInput) === input;
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
          if (sameInput()) {
            draft.replyPreview = output;
            draft.replyPreviewSource = input;
            draft.replyPreviewLanguage = language;
          }
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
      const copyConfirmed = copied?.copied === true || (copied?.ok === true && Number(copied.length) === output.length);
      if (!copyConfirmed || copied.truncated || (copied.length != null && Number(copied.length) !== output.length)) throw new Error('回复复制不完整，已停止并保留原文。');
      assertContext(context);
      const operationSource = JSON.stringify([context.accountId, current.id, input, output]);
      const operationId = draft.replyOperationSource === operationSource && draft.replyOperationId
        ? draft.replyOperationId : 'ws-reply-' + Date.now().toString(36) + '-' + stableHash(operationSource + ':' + revision);
      if (sameInput()) { draft.replyOperationId = operationId; draft.replyOperationSource = operationSource; }
      const saved = await api('/api/ws/replies', {
        method: 'POST',
        body: JSON.stringify({ conversationId: current.id, originalText: input, translatedText: output, status: 'copied', idempotencyKey: operationId }),
      }, context);
      assertContext(context);
      state.replies = [saved, ...state.replies.filter(item => String(item.id) !== String(saved.id))].slice(0, 10);
      if (draft.replyOperationId === operationId) { draft.replyOperationId = ''; draft.replyOperationSource = ''; }
      // A copied reply is no longer an unsent draft; drop it from durable
      // storage so a reopen does not resurrect already-handled text.
      // The user can keep typing while clipboard or audit I/O is pending.
      // Clear only the exact input revision that was copied and recorded.
      if (sameInput()) {
        draft.replyInput = '';
        persistDraftReply(draftKey, '');
        draft.replyRevision = revision + 1;
      }
      toast(`回复已完整复制（${output.length} 字），请回到 WS 页面人工发送。`);
    } catch (error) {
      if (contextCurrent(context)) { if (sameInput()) draft.replyError = error.message; toast(error.message, 'x'); }
    } finally {
      if (contextCurrent(context)) { state.busy.reply = false; render(); }
    }
  }

  async function translateBroadcast() {
    const b = state.broadcast;
    const input = text(b.originalText || $('#wsBroadcastText')?.value);
    if (!input) { toast('请先输入群发原文。', 'x'); return; }
    const context = captureContext('');
    b.loading = true; b.error = '';
    render();
    try {
      const result = await translateText(input, 'send', context);
      assertContext(context);
      b.originalText = input;
      b.translatedText = result.translated;
      b.targetLanguage = result.destination;
      toast('群发译文已生成，原文保持不变。');
    } catch (error) {
      if (contextCurrent(context)) { b.error = `${error.message || '翻译失败'} 原文仍保留。`; toast(b.error, 'x'); }
    } finally {
      if (contextCurrent(context)) { b.loading = false; render(); }
    }
  }

  async function createBroadcastPlan() {
    const b = state.broadcast;
    const recipients = broadcastSelectedRows();
    const originalText = text(b.originalText || $('#wsBroadcastText')?.value);
    const attachments = Array.isArray(b.attachments) ? b.attachments.filter(item => text(item.mediaId || item.id)) : [];
    if (!recipients.length) { toast('请至少选择一个已读的一对一会话；群聊和未读会话不会加入群发。', 'x'); return; }
    if (!originalText && !attachments.length) { toast('请先输入群发原文或添加附件。', 'x'); return; }
    if (!confirm(`将为 ${recipients.length} 个已读一对一会话创建群发计划。创建后仍需在对应会话中逐条确认发送，是否继续？`)) return;
    const context = captureContext('');
    b.loading = true; b.error = '';
    render();
    try {
      let translatedText = text(b.translatedText);
      let targetLanguage = text(b.targetLanguage);
      if (originalText && !translatedText && core.shouldTranslate(state.settings, 'send')) {
        const result = await translateText(originalText, 'send', context);
        translatedText = result.translated;
        targetLanguage = result.destination;
      }
      assertContext(context);
      const payload = {
          accountId: context.accountId,
          conversationIds: recipients.map(item => item.id),
          payloadKind: broadcastPayloadKind(attachments),
          caption: text(b.caption || originalText),
          attachments: attachments.map((item, index) => ({ mediaId: text(item.mediaId || item.id), fileName: text(item.fileName), mimeType: text(item.mimeType), sizeBytes: Number(item.sizeBytes || item.size || 0), orderNo: Number(item.orderNo || index) })),
          originalText,
          translatedText: translatedText || originalText,
          targetLanguage,
          confirm: true,
      };
      payload.idempotencyKey = broadcastIdempotencyKey(payload);
      const result = await api('/api/ws/broadcast', { method: 'POST', body: JSON.stringify(payload) }, context);
      assertContext(context);
      b.originalText = originalText;
      b.translatedText = translatedText || originalText;
      b.targetLanguage = targetLanguage;
      b.plan = result.dispatch || null;
      b.lastBatchId = text(result.dispatch?.batchId);
      toast(result.existed ? '已恢复原群发计划，未重复创建发送记录。' : '群发计划已创建，请按队列逐条确认发送。');
    } catch (error) {
      if (contextCurrent(context)) { b.error = error.message || '群发计划创建失败。'; toast(b.error, 'x'); }
    } finally {
      if (contextCurrent(context)) { b.loading = false; render(); }
    }
  }

  function broadcastDeliveryState(item) {
    const value = text(item?.deliveryState || item?.nativeResult?.deliveryState);
    if (['local_attempted', 'platform_accepted', 'delivered', 'unknown', 'failed'].includes(value)) return value;
    // Historical "sent" without platform evidence must never mean delivered.
    return item?.status === 'queued' ? 'queued' : 'unknown';
  }
  function broadcastCanRetry(item) {
    const delivery = broadcastDeliveryState(item);
    if (['local_attempted', 'platform_accepted', 'delivered', 'unknown'].includes(delivery)) return false;
    if (item?.status === 'queued' && !item?.attemptId) return item.retryAllowed !== false;
    return delivery === 'failed' && item?.retryAllowed === true;
  }
  function broadcastDeliveryLabel(item) {
    const labels = { queued: '待当前会话确认', local_attempted: '本地已尝试 · 平台结果待核实',
      platform_accepted: '平台已接受 · 尚未确认送达', delivered: '已送达',
      unknown: '结果未知 · 已阻止重发', failed: '明确失败 · 未产生发送动作' };
    return labels[broadcastDeliveryState(item)] || labels.unknown;
  }
  async function sendBroadcastItem(element) {
    const b = state.broadcast;
    if (b.loading) return;
    const auditId = text(element?.dataset?.broadcastAuditId);
    const item = broadcastPlanRows().find(row => String(row.id) === auditId);
    if (!item) { toast('发送队列项不存在，请刷新群发计划。', 'x'); return; }
    if (!broadcastCanRetry(item)) { toast('该项已有发送尝试或结果待核实，已阻止重复发送。', 'x'); return; }
    const current = activeConversation();
    if (!current || String(current.id) !== String(item.conversationId) ||
        (item.accountId && String(item.accountId) !== String(state.activeAccountId))) {
      toast('为避免误发，请先在 WS 前台打开该队列对应的会话；知客不会自动切换聊天窗口。', 'x');
      return;
    }
    if (!confirm('确认向“' + text(current.title || current.externalId || current.id) + '”尝试发送？本地点击不代表平台接受或送达，未知结果不会自动重发。')) return;
    const context = captureContext(current.id);
    const mediaItems = Array.isArray(item.attachments) && item.attachments.length ? item.attachments
      : (item.payloadKind && item.payloadKind !== 'text' ? [{ mediaId: item.mediaId, fileName: item.fileName, mimeType: item.mimeType }] : []);
    let attemptId = '', authorizationRequested = false, externalEffectPossible = false, bridgeInFlight = false;
    const outcomes = [];
    const publish = audit => {
      if (!audit || !contextCurrent(context) || state.broadcast !== b) return;
      b.plan = { ...b.plan, items: (b.plan?.items || []).map(row => String(row.id) === auditId ? audit : row) };
    };
    const record = async (deliveryState, extra = {}) => {
      const acknowledged = await api('/api/ws/send', {
        method: 'POST',
        body: JSON.stringify({ accountId: context.accountId, auditId, attemptId,
          status: deliveryState === 'failed' ? 'failed' : 'sending', deliveryState,
          nativeConfirmed: deliveryState === 'local_attempted',
          nativeResult: { deliveryState, dispatchAttempted: externalEffectPossible, items: outcomes }, ...extra }),
      }, context);
      publish(acknowledged?.audit);
      return acknowledged;
    };
    b.loading = true; b.error = '';
    render();
    try {
      authorizationRequested = true;
      const begun = await api('/api/ws/send', {
        method: 'POST', body: JSON.stringify({ accountId: context.accountId, auditId, action: 'begin-attempt' }),
      }, context);
      attemptId = text(begun.attemptId || begun.audit?.attemptId);
      if (!attemptId) throw new Error('发送服务未授权本次尝试；未调用 WS。');
      publish(begun.audit);
      assertContext(context);
      const commands = mediaItems.length ? mediaItems : [null];
      for (const [index, media] of commands.entries()) {
        assertContext(context);
        const local = media && (b.attachments || []).find(candidate => text(candidate.mediaId || candidate.id) === text(media.mediaId || media.id));
        const attachmentId = media ? text(media.id || media.attachmentId) : '';
        bridgeInFlight = true;
        let bridge;
        try { bridge = await wsBridge(media ? 'send-media' : 'send-text', context, media ? {
          confirmed: true, conversationId: current.id, conversationKey: current.externalId || current.id,
          mediaId: text(media.mediaId || media.id), fileName: text(media.fileName || local?.fileName) || 'attachment',
          mimeType: text(media.mimeType || local?.mimeType) || 'application/octet-stream',
          caption: Object.hasOwn(media, 'caption') ? text(media.caption)
            : index === 0 ? text(item.caption || item.originalText || b.originalText) : '',
        } : { confirmed: true, conversationId: current.id, conversationKey: current.externalId || current.id,
          text: text(item.translatedText || item.originalText) }); }
        catch (error) {
          const preflight = error?.deliveryState === 'failed' && error?.dispatchAttempted === false &&
            (error?.notAttempted === true || error?.phase === 'preflight');
          bridgeInFlight = !preflight;
          externalEffectPossible ||= !preflight;
          const deliveryState = preflight ? 'failed' : 'unknown';
          const proof = { ok: false, deliveryState, dispatchAttempted: !preflight,
            ...(preflight ? { notAttempted: true, phase: 'preflight' } : {}) };
          outcomes.push({ attachmentId, mediaId: media ? text(media.mediaId || media.id) : '', deliveryState, result: proof });
          await record(deliveryState, { attachmentId, phase: 'in-progress', nativeResult: proof,
            errorMessage: String(error?.message || '发送结果未知').slice(0, 1000) });
          throw error;
        }
        bridgeInFlight = false;
        const deliveryState = bridge?.ok === false && bridge?.deliveryState === 'failed' && bridge?.dispatchAttempted === false &&
          (bridge?.notAttempted === true || bridge?.phase === 'preflight') ? 'failed'
          : bridge?.ok === true && bridge?.deliveryState === 'local_attempted' && bridge?.dispatchAttempted === true ? 'local_attempted' : 'unknown';
        externalEffectPossible ||= deliveryState !== 'failed';
        outcomes.push({ attachmentId, mediaId: media ? text(media.mediaId || media.id) : '', deliveryState, result: bridge });
        // Persist each attachment before proceeding. Even a late result belongs
        // to the captured account, but must not mutate the new account's UI.
        await record(deliveryState, { attachmentId, phase: 'in-progress', nativeResult: bridge });
        if (deliveryState !== 'local_attempted') {
          const error = new Error(bridge?.error || '本次发送没有可靠的本地尝试确认。');
          error.deliveryState = deliveryState; error.dispatchAttempted = deliveryState !== 'failed';
          throw error;
        }
        assertContext(context);
        if (commands.length > 1 && index < commands.length - 1) await new Promise(resolve => setTimeout(resolve, 350));
      }
      await record('local_attempted', { phase: 'completed' });
      if (contextCurrent(context)) toast('本地已尝试，平台接受与送达尚未确认；不会自动重发。');
    } catch (error) {
      const explicitlyNotDispatched = error?.deliveryState === 'failed' && error?.dispatchAttempted === false;
      const authorizationUnknown = authorizationRequested && !attemptId;
      const deliveryState = !authorizationUnknown && !externalEffectPossible && (explicitlyNotDispatched || !bridgeInFlight) ? 'failed' : 'unknown';
      if (authorizationUnknown) publish({ ...item, status: 'sending', deliveryState: 'unknown', retryAllowed: false });
      if (attemptId) {
        // If acknowledgement fails, the durable prepared intent and this local
        // fallback still prevent a blind retry after uncertain external effects.
        publish({ ...item, status: deliveryState === 'failed' ? 'failed' : 'sending', deliveryState,
          retryAllowed: deliveryState === 'failed', attemptId });
        try { await record(deliveryState, { phase: 'completed', errorMessage: String(error?.message || '发送结果未知').slice(0, 1000),
          ...(deliveryState === 'failed' ? { nativeResult: { ok: false, notAttempted: true, phase: 'preflight', dispatchAttempted: false, deliveryState, items: outcomes } } : {}) }); } catch {}
      }
      if (contextCurrent(context)) {
        b.error = authorizationUnknown ? '发送授权响应未确认，未调用 WS；请刷新计划核对，已阻止重复尝试。'
          : deliveryState === 'unknown' ? '发送结果未知，已阻止重发；请先核实平台记录。' : (error.message || '发送前被拒绝，未产生发送动作。');
        toast(b.error, 'x');
      }
    } finally {
      if (contextCurrent(context) && state.broadcast === b) { b.loading = false; render(); }
    }
  }

  function clearBroadcastPlan() {
    state.broadcast.plan = null;
    state.broadcast.lastBatchId = '';
    state.broadcast.error = '';
    render();
  }

  function assistDrawerBody() {
    return $('#wsAssistDrawerBody');
  }

  function focusAssistDrawerTab(tab, open = true) {
    if (state.workspaceMode === 'dedicated' && tab === 'broadcast') return;
    const nextTab = ASSIST_DRAWER_TABS.has(String(tab)) ? String(tab) : 'ai';
    state.assistDrawerTab = nextTab;
    writeAssistDrawerState('tab', nextTab);
    if (open && !state.assistDrawerOpen) {
      state.assistDrawerOpen = true;
      writeAssistDrawerState('open', true);
      render({ skipNativeResize: true });
    }
    requestAnimationFrame(() => {
      const meta = assistDrawerTabMeta(nextTab);
      const title = $('#wsAssistDrawerTitle');
      const subtitle = $('#wsAssistDrawer .ws-assist-drawer-title span');
      if (title && title.textContent !== meta.title) title.textContent = meta.title;
      if (subtitle && subtitle.textContent !== meta.subtitle) subtitle.textContent = meta.subtitle;
      const body = assistDrawerBody();
      const node = body?.querySelector(`[data-assist-section="${nextTab}"]`);
      if (body && node) {
        const bodyRect = body.getBoundingClientRect?.();
        const nodeRect = node.getBoundingClientRect?.();
        const relativeTop = bodyRect && nodeRect
          ? nodeRect.top - bodyRect.top + Number(body.scrollTop || 0)
          : Number(node.offsetTop || 0);
        const targetTop = relativeTop - 8;
        body.scrollTo({ top: Math.max(0, targetTop), behavior: 'smooth' });
      }
      $$('.ws-assist-tab').forEach(button => {
        const active = button.dataset.assistDrawerTab === nextTab;
        button.classList.toggle('active', active);
        button.setAttribute('aria-selected', active ? 'true' : 'false');
      });
    });
  }

  function openAssistDrawer(tab = state.assistDrawerTab, returnFocus = null) {
    if (state.workspaceMode === 'dedicated' && tab === 'broadcast') tab = 'profile';
    const nextTab = ASSIST_DRAWER_TABS.has(String(tab)) ? String(tab) : 'ai';
    if (returnFocus) assistDrawerReturnFocus = returnFocus;
    state.assistDrawerTab = nextTab;
    state.assistDrawerOpen = true;
    if (Number(window.innerWidth || 0) > 0 && Number(window.innerWidth) <= 900) state.mobilePanel = 'right';
    writeAssistDrawerState('tab', nextTab);
    writeAssistDrawerState('open', true);
    render({ skipNativeResize: true });
    requestAnimationFrame(() => {
      $('#wsAssistDrawerClose')?.focus?.();
      focusAssistDrawerTab(nextTab, false);
    });
  }

  function closeAssistDrawer() {
    state.assistDrawerOpen = false;
    writeAssistDrawerState('open', false);
    render({ skipNativeResize: true });
    requestAnimationFrame(() => {
      const target = assistDrawerReturnFocus?.isConnected ? assistDrawerReturnFocus : $('.ws-assist-launcher');
      target?.focus?.();
      assistDrawerReturnFocus = null;
    });
  }

  function handleAssistDrawerResizeStart(event) {
    const handle = event.target?.closest?.('[data-ws-action="assist-drawer-handle"]');
    const drawer = $('#wsAssistDrawer');
    const layout = $('.ws-layout');
    if (!handle || !drawer || !layout || !state.assistDrawerOpen) return;
    assistDrawerResize = {
      pointerId: event.pointerId,
      startX: Number(event.clientX || 0),
      startWidth: clampAssistDrawerWidth(state.assistDrawerWidth),
      drawer,
      layout,
      handle,
    };
    handle.setPointerCapture?.(event.pointerId);
    bindAssistPointerListeners();
    event.preventDefault();
    event.stopPropagation();
  }

  function handleAssistDrawerResizeMove(event) {
    const resize = assistDrawerResize;
    if (!resize || (resize.pointerId != null && event.pointerId !== resize.pointerId)) return;
    const delta = resize.startX - Number(event.clientX || 0);
    const width = Math.min(assistDrawerColumnWidth(resize.layout), clampAssistDrawerWidth(resize.startWidth + delta));
    state.assistDrawerWidth = width;
    resize.drawer.style.setProperty('--ws-assist-drawer-width', `${width}px`);
    resize.layout.style.setProperty('--ws-assist-column-width', `${width}px`);
    resize.layout.style.setProperty('--ws-assist-drawer-width', `${width}px`);
    event.preventDefault();
  }

  function handleAssistDrawerResizeEnd(event) {
    const resize = assistDrawerResize;
    if (!resize || (resize.pointerId != null && event.pointerId != null && event.pointerId !== resize.pointerId)) return;
    writeAssistDrawerState('width', state.assistDrawerWidth);
    resize.handle?.releasePointerCapture?.(resize.pointerId);
    assistDrawerResize = null;
    unbindAssistPointerListeners();
  }

  function assistDrawerMoveLimit() {
    return Math.min(64, Math.max(0, Number(window.innerHeight || 900) - 180));
  }

  function handleAssistDrawerMoveStart(event) {
    const header = event.target?.closest?.('[data-assist-drawer-drag]');
    const drawer = $('#wsAssistDrawer');
    if (!header || !drawer || !state.assistDrawerOpen || Number(window.innerWidth || 0) <= 900) return;
    // Buttons retain their click behavior; only the empty header surface moves
    // the drawer. Horizontal movement stays locked to the page column.
    if (event.target?.closest?.('button, input, select, textarea, a')) return;
    const offset = normalizeAssistDrawerOffset(state.assistDrawerOffset);
    assistDrawerMove = {
      pointerId: event.pointerId,
      startY: Number(event.clientY || 0),
      startOffsetY: offset.y,
      drawer,
      header,
    };
    header.setPointerCapture?.(event.pointerId);
    bindAssistPointerListeners();
    event.preventDefault();
    event.stopPropagation();
  }

  function handleAssistDrawerMove(event) {
    const move = assistDrawerMove;
    if (!move || (move.pointerId != null && event.pointerId !== move.pointerId)) return;
    const delta = Number(event.clientY || 0) - move.startY;
    const limit = assistDrawerMoveLimit();
    const y = Math.max(-limit, Math.min(limit, Math.round(move.startOffsetY + delta)));
    state.assistDrawerOffset = { x: 0, y };
    move.drawer.style.setProperty('--ws-assist-drawer-offset-x', '0px');
    move.drawer.style.setProperty('--ws-assist-drawer-offset-y', `${y}px`);
    event.preventDefault();
  }

  function handleAssistDrawerMoveEnd(event) {
    const move = assistDrawerMove;
    if (!move || (move.pointerId != null && event.pointerId != null && event.pointerId !== move.pointerId)) return;
    writeAssistDrawerState('offset', state.assistDrawerOffset);
    move.header?.releasePointerCapture?.(move.pointerId);
    assistDrawerMove = null;
    unbindAssistPointerListeners();
  }

  async function retryFailedTranslations() {
    const failed = state.messages.filter(item => item.translationStatus === 'failed' || item.translationError);
    for (const message of failed) await translateMessage(message.id);
  }
  let exclusionPageEpoch = 0;
  function invalidateExclusionPage() {
    if (state.wsWorkspaceView !== 'exclusions') return;
    exclusionPageEpoch += 1;
    const page = wsWorkspacePageState('exclusions');
    businessPages?.invalidateExclusions(page);
    page.refreshGeneration = Number(page.refreshGeneration || 0) + 1;
    page.busy = false;
    page.status = '尚未刷新';
  }
  function exclusionPageScope() {
    const context = captureContext('');
    const page = wsWorkspacePageState('exclusions', context.accountId);
    const epoch = exclusionPageEpoch;
    const isCurrent = () => state.active && state.wsWorkspaceView === 'exclusions' && epoch === exclusionPageEpoch && contextCurrent(context);
    const request = (pathname, init = {}) => {
      if (!isCurrent()) throw new Error('排除页面已切换，已停止后续操作。');
      return api(pathname, init, context);
    };
    const refresh = async (query) => {
      if (!isCurrent()) return;
      const loading = businessPages.loadExclusions(page, { request, isCurrent, ...(query === undefined ? {} : { query }) });
      render({ skipNativeResize: true });
      await loading;
      if (isCurrent()) render({ skipNativeResize: true });
    };
    return { page, request, isCurrent, refresh };
  }
  async function updateExclusionPage(scope, options) {
    const updating = businessPages.updateExclusions(scope.page, { ...scope, ...options });
    if (scope.isCurrent()) render({ skipNativeResize: true });
    await updating;
    if (scope.isCurrent()) render({ skipNativeResize: true });
  }
  async function submitExclusionForm(form) {
    if (!businessPages || !state.active || state.wsWorkspaceView !== 'exclusions') return;
    const scope = exclusionPageScope();
    const view = businessPages.exclusionState(scope.page);
    if (view.mutating || view.loading) return;
    const mode = form.dataset.wsExclusionForm;
    if (mode === 'search') return scope.refresh(String(form.querySelector('[data-ws-exclusion-query]')?.value || '').trim());
    const data = Object.fromEntries(new FormData(form).entries());
    if (mode === 'hits') {
      view.hitQuery = String(data.hitQuery || '').trim().slice(0, 160);
      render({ skipNativeResize: true });
      return;
    }
    if (mode === 'import') view.importText = String(data.items || '');
    if (mode === 'add' || mode === 'import') return updateExclusionPage(scope, { action: mode, body: data });
  }
  function selectExclusionRules(target) {
    const box = target?.closest?.('[data-ws-exclusion-select]');
    const all = target?.closest?.('[data-ws-exclusion-select-all]');
    if (!box && !all) return false;
    if (!businessPages || !state.active || state.wsWorkspaceView !== 'exclusions') return true;
    const page = wsWorkspacePageState('exclusions');
    const view = businessPages.exclusionState(page);
    if (view.mutating || view.loading) return true;
    const selected = businessPages.exclusionSelection(page);
    if (all) page.exclusionSelected = all.checked ? view.rules.map(rule => String(rule.id)) : [];
    else {
      const id = String(box.dataset.wsExclusionSelect);
      if (box.checked && view.rules.some(rule => String(rule.id) === id)) selected.add(id);
      else selected.delete(id);
      page.exclusionSelected = [...selected];
    }
    render({ skipNativeResize: true });
    return true;
  }
  async function handleAction(action, element) {
    if (action.startsWith('group-draft-')) return groupDrafts?.run(action.slice('group-draft-'.length), String(element?.dataset?.draftId || ''));
    if (state.workspaceMode === 'dedicated' && (action.includes('broadcast') || (action === 'focus-assist' && element?.dataset?.assistTarget === 'broadcast'))) throw new Error('专用群组发送能力尚未验收：BLOCKED。');
    if (action === 'return-zhike') { (document.querySelector('[data-workspace-target="main"]') || document.querySelector('.nav-item[data-view="home"]'))?.click(); return; }
    if (action.startsWith('business-')) {
      const view = String(element?.dataset?.businessView || state.wsWorkspaceView);
      if (view !== state.wsWorkspaceView || !['contacts', 'logs', 'members', 'crm', 'tasks'].includes(view)) return;
      const page = wsWorkspacePageState(view);
      if (action === 'business-detail') {
        const id = String(element?.dataset?.recordId || ''); page.detailId = page.detailId === id ? '' : id;
        render({ skipNativeResize: true });
        if (page.detailId && (Number(window.innerWidth || 0) < 1440 || !['contacts', 'logs'].includes(view))) document.querySelector(`[data-ws-workspace-page="${view}"] [data-ws-business-selected-detail]`)?.scrollIntoView?.({ block: 'nearest', behavior: 'auto' });
        return;
      }
      if (action === 'business-detail-close') { page.detailId = ''; render({ skipNativeResize: true }); return; }
      if (action === 'business-reset') { page.filter = ''; page.businessFilters = {}; page.page = 1; page.detailId = ''; return refreshWorkspacePage(); }
      if (action === 'business-search') { page.page = 1; page.detailId = ''; return refreshWorkspacePage(); }
      if (action === 'business-page') {
        page.page = Math.max(1, page.page + (Number(element?.dataset?.pageDelta) > 0 ? 1 : -1)); page.detailId = '';
        if (view === 'contacts' || view === 'logs') return refreshWorkspacePage();
        render({ skipNativeResize: true }); return;
      }
      return;
    }
    if (action?.startsWith('exclusion-')) {
      if (!businessPages) { toast('业务页面模块未加载。', 'x'); return; }
      const scope = exclusionPageScope();
      if (!scope.isCurrent()) return;
      const view = businessPages.exclusionState(scope.page);
      if (view.mutating || view.loading) return;
      if (action === 'exclusion-toggle' || action === 'exclusion-delete') {
        const id = String(element?.dataset?.recordId || '');
        if (!view.rules.some(rule => String(rule.id) === id)) return;
        return updateExclusionPage(scope, { action: action === 'exclusion-delete' ? 'delete' : 'toggle', id, body: { enabled: element?.dataset?.recordEnabled !== '1' } });
      }
      if (['exclusion-bulk-enable', 'exclusion-bulk-disable', 'exclusion-bulk-delete'].includes(action)) {
        return updateExclusionPage(scope, { action: action.slice('exclusion-'.length) });
      }
      if (action === 'exclusion-refresh') return scope.refresh();
      return;
    }
    if (action === 'collection-history') {
      wsWorkspacePageState().scrollTop = Number(document.querySelector('[data-ws-workspace-page]')?.scrollTop || 0);
      state.wsWorkspaceView = 'logs';
      const page = wsWorkspacePageState('logs'); page.businessFilters = { category: 'snapshot', sourceType: 'ws_collection_runs' }; page.page = 1; page.detailId = '';
      writeWsWorkspaceState('logs', state.wsWorkspaceNavCollapsed); render();
      return refreshWorkspacePage();
    }
    if (COLLECTOR_SESSION_ACTIONS.has(action)) return collectorAction(action);
    if (['open', 'login', 'reload', 'reconnect', 'close', 'clear-session', 'probe'].includes(action)) return connectionAction(action);
    if (action === 'create-account') return openAccountForm();
    if (action === 'refresh-accounts') return loadAccounts();
    if (action === 'submit-account') return createAccount();
    if (action === 'cancel-account') return cancelAccountForm();
    if (action === 'switch-account') return switchAccount(element?.dataset?.accountId, { openLogin: state.workspaceMode === 'dedicated' });
    if (action === 'capture-selection') return captureSelection();
    if (action === 'toggle-capture') { state.captureCollapsed = !state.captureCollapsed; writePanelCollapsed('capture', state.captureCollapsed); render(); return; }
    if (action === 'toggle-messages') { state.messageCollapsed = !state.messageCollapsed; writePanelCollapsed('messages', state.messageCollapsed); render(); return; }
    if (action === 'toggle-local-panels') { state.localPanelsCollapsed = !state.localPanelsCollapsed; state.manualToolsVisible = !state.localPanelsCollapsed; writePanelCollapsed('local-panels', state.localPanelsCollapsed); render(); return; }
    if (action === 'toggle-workspace-nav') { state.wsWorkspaceNavCollapsed = !state.wsWorkspaceNavCollapsed; writeWsWorkspaceState(state.wsWorkspaceView, state.wsWorkspaceNavCollapsed); render(); return; }
    if (action.startsWith('group-channel-')) return groupChannels?.run(action.slice('group-channel-'.length), element);
    if (action.startsWith('group-permission-')) return groupPermissions?.run(action.slice('group-permission-'.length));
    if (action.startsWith('group-reading-')) return groupReading?.run(action.slice('group-reading-'.length));
    if (action.startsWith('group-directory-')) {
      if (state.wsWorkspaceView !== 'groups') return;
      const page = groupDirectoryState();
      if (action === 'group-directory-detail') page.detailGroupId = page.detailGroupId === element?.dataset?.groupId ? '' : String(element?.dataset?.groupId || '');
      else if (action === 'group-directory-clear') { page.selectedGroupIds = []; page.showSelectedOnly = false; }
      else if (action === 'group-directory-selected') { page.showSelectedOnly = !page.showSelectedOnly; page.page = 1; }
      else if (action === 'group-directory-copy') {
        const selected = new Set(page.selectedGroupIds);
        const ids = groupDirectoryRows().filter(row => selected.has(row.directoryId)).map(row => row.directoryId);
        if (!ids.length) return;
        if (!window.zhikeDesktop?.tools) throw new Error('当前环境没有本机剪贴板能力。');
        const context = captureContext(''), output = ids.join('\n');
        const copied = await window.zhikeDesktop.tools({ action: 'copy', text: output });
        assertContext(context);
        if (copied?.copied !== true || copied.truncated === true || (copied.length != null && Number(copied.length) !== output.length)) throw new Error('群组标识复制失败，请重试。');
        toast(`已复制 ${ids.length} 个群组标识`);
        return;
      } else return;
      render({ skipNativeResize: true });
      if (action === 'group-directory-detail') return groupReading?.open();
      return;
    }
    if (action === 'open-local-tools') {
      wsWorkspacePageState().scrollTop = Number(document.querySelector('[data-ws-workspace-page]')?.scrollTop || 0);
      state.wsWorkspaceView = 'chat';
      state.manualToolsVisible = true;
      state.localPanelsCollapsed = false;
      state.captureCollapsed = false;
      writeWsWorkspaceState('chat', state.wsWorkspaceNavCollapsed);
      render();
      return;
    }
    if (action === 'refresh-workspace-page') return refreshWorkspacePage();
    if (action === 'workspace-list-page') {
      const view = String(element?.dataset?.listView || '');
      if (view !== state.wsWorkspaceView) return;
      const page = wsWorkspacePageState(view);
      page.page = Math.max(1, page.page + (Number(element.dataset.pageDelta) > 0 ? 1 : -1));
      render({ skipNativeResize: true });
      return;
    }
    if (action === 'toggle-login-layout') { state.loginLayoutExpanded = !state.loginLayoutExpanded; render(); return; }
    if (action === 'toggle-left') { state.leftCollapsed = !state.leftCollapsed; writePanelCollapsed('left', state.leftCollapsed); render(); return; }
    if (action === 'toggle-right') {
      assistDrawerReturnFocus = element || $('.ws-heading-collapse[data-ws-action="toggle-right"]');
      if (state.assistDrawerOpen) closeAssistDrawer();
      else openAssistDrawer(state.assistDrawerTab, assistDrawerReturnFocus);
      return;
    }
    if (action === 'open-assist-drawer') { openAssistDrawer(state.assistDrawerTab, element); return; }
    if (action === 'close-assist-drawer' || action === 'assist-backdrop') { closeAssistDrawer(); return; }
    if (action === 'focus-assist') {
      if (state.wsWorkspaceView !== 'chat') {
        wsWorkspacePageState().scrollTop = Number(document.querySelector('[data-ws-workspace-page]')?.scrollTop || 0);
        state.wsWorkspaceView = 'chat';
        writeWsWorkspaceState('chat', state.wsWorkspaceNavCollapsed);
      }
      state.assistDrawerOpen = true;
      openAssistDrawer(element?.dataset?.assistTarget || 'ai', element);
      queueResizeWsView();
      return;
    }
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
    if (action === 'group-monitor-create') return createGroupMonitor();
    if (action === 'group-monitor-refresh') return loadGroupMonitor();
    if (action === 'group-verification-diagnostics' && state.workspaceMode === 'dedicated') {
      const directory = liveDirectory();
      directory.showGroupDiagnostics = !directory.showGroupDiagnostics;
      updateDedicatedLiveDirectoryDom();
      return;
    }
    if (action === 'toggle-open-unread-groups') return changeUnreadGroupPolicy();
    if (action === 'verify-open-group') return verifyOpenedGroup();
    if (action === 'group-monitor-scan') return scanGroupMonitorTargets();
    if (action === 'group-monitor-add-target') return addGroupMonitorTarget();
    if (action === 'group-monitor-add-directory') return addDirectoryMonitorTargets();
    if (action === 'group-monitor-add-selected') return addSelectedGroupMonitorTarget();
    if (action === 'group-monitor-toggle') return toggleGroupMonitor(element?.dataset?.enabled !== 'true');
    if (action === 'group-monitor-target-toggle') return toggleGroupMonitorTarget(element);
    if (action === 'group-monitor-resolve') return resolveGroupMonitorEvent(element, 'resolve');
    if (action === 'group-monitor-ignore') return resolveGroupMonitorEvent(element, 'ignore');
    if (action === 'broadcast-select-all') { state.broadcast.selectedIds = new Set(broadcastCandidates().map(item => String(item.id))); render(); return; }
    if (action === 'broadcast-clear-selection') { state.broadcast.selectedIds.clear(); render(); return; }
    if (action === 'pick-broadcast-files') { $('#wsBroadcastFiles')?.click?.(); return; }
    if (action === 'remove-broadcast-attachment') { removeBroadcastAttachment(element?.dataset?.attachmentId); return; }
    if (action === 'translate-broadcast') return translateBroadcast();
    if (action === 'create-broadcast-plan') return createBroadcastPlan();
    if (action === 'send-broadcast-item') return sendBroadcastItem(element);
    if (action === 'clear-broadcast-plan') return clearBroadcastPlan();
    if (action === 'export-all') return exportAllWsData();
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
    if (action === 'refresh-visible-contacts') {
      if (state.workspaceMode !== 'ordinary') return;
      liveDirectory().contactsExpanded = true;
      const context = captureContext('');
      const result = await refreshForegroundDirectory();
      if (contextCurrent(context) && result?.contactsVisible !== true) toast(result ? '请在 WhatsApp 中打开“新建聊天”，再读取可见联系人。' : '请检查当前账号的前台连接。', 'x');
      return;
    }
    if (action === 'refresh-live-conversations') {
      const result = await refreshForegroundDirectory();
      if (state.workspaceMode !== 'ordinary') return;
      if (collectionReady()) await readOrdinaryCollectorDirectory(captureContext(''));
      else if (!result) toast('请打开当前账号的 WhatsApp，确认已登录后重试。', 'x');
      return;
    }
    if (action === 'select-live-conversation') {
      const key = text(element.dataset.id);
      if (workspaceLiveDirectoryRows('ordinary').some(row => row.externalId === key)) state.livePreviewId = state.livePreviewId === key ? '' : key;
      updateLiveDirectoryDom();
      return;
    }
    if (action === 'select-conversation') { state.livePreviewId = ''; state.mobilePanel = 'center'; state.conversationSelectionManual = true; return loadConversationData(element.dataset.id); }
    if (action === 'clear-capture') { currentDraft().captureText = ''; render(); return; }
    if (action === 'import-visible') return importVisible();
    if (action === 'translate-message') return translateMessage(element.dataset.id);
    if (action === 'retry-failed') return retryFailedTranslations();
    if (action === 'resume-ai-queue') {
      const retryScope = state.aiRetryScope, context = captureContext('');
      if (!retryScope) return;
      const status = await refreshAiAuthorization(context);
      if (!contextCurrent(context) || state.aiRetryScope !== retryScope) return;
      if (!status?.active) { toast(status?.reason || '无法确认原自动分析授权，请刷新后重试。', 'x'); return; }
      if (status.authorization?.id !== retryScope.authorizationId) { toast('原自动分析授权已更换，请核对当前授权。', 'x'); return; }
      const conversation = state.conversations.find(item => item.id === retryScope.conversationId);
      if (!conversation || fullHistorySourceFingerprint(conversation) !== retryScope.sourceFingerprint) { toast('该次分析的聊天历史已变更。', 'x'); return; }
      return scheduleAiQueuePump(context, retryScope);
    }
    if (action === 'open-home' || action === 'open-tasks') {
      const route = action === 'open-home' ? 'home' : 'operations';
      document.querySelector(`.nav-item[data-view="${route}"]`)?.click();
      return;
    }
    if (action.startsWith('ai-authorization-')) return aiAuthorizationAction(action.slice('ai-authorization-'.length), element);
    if (action === 'analyze') return analyzeConversation();
    if (action === 'analyze-recent') return analyzeRecentConversation();
    if (action === 'use-ai-reply') return useAiReply();
    if (action === 'retry-draft-persist') { flushDraftPersist(); updateDraftPersistenceStatus(); return; }
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
    if (target.matches('[data-ws-group-draft-select]')) { groupDrafts?.select(target.dataset.wsGroupDraftSelect, Boolean(target.checked)); return; }
    if (target.closest?.('.ws-channel-centre, .ws-channel-import') && groupChannels?.control(target)) return;
    if (target.matches('[data-ws-permission-search]')) { groupPermissions?.search(target.value); return; }
    if (target.matches('[data-ws-permission-select]')) { groupPermissions?.select(target.dataset.wsPermissionSelect, Boolean(target.checked)); return; }
    if (target.matches('[data-ws-reading-group]')) {
      if (state.workspaceMode !== 'dedicated' || state.wsWorkspaceView !== 'group-reading' || !modeAccount(state.activeAccountId)) return;
      const page = wsWorkspacePageState('group-reading');
      page.groupJid = (page.groups || []).some(row => row.accountId === state.activeAccountId && row.groupJid === target.value) ? target.value : '';
      groupReading?.reset(); render({ skipNativeResize: true });
      return groupReading?.open();
    }
    if (target.matches('[data-ws-group-reading-filter]')) { groupReading?.filter(target.dataset.wsGroupReadingFilter, target.value); return; }
    if (target.matches('[data-ws-group-reading-message]')) { groupReading?.select(target.value); return; }
    if (target.matches('[data-ws-business-account]')) {
      const view = state.wsWorkspaceView;
      void switchAccount(target.value).then(switched => { if (switched && state.wsWorkspaceView === view) return refreshWorkspacePage(); });
      return;
    }
    if (target.matches('[data-ws-business-filter]')) {
      if (!['contacts', 'logs'].includes(state.wsWorkspaceView)) return;
      const key = String(target.dataset.wsBusinessFilter || '');
      if (!['duplicate', 'category', 'type', 'sourceType', 'outcome', 'from', 'to', 'jobId', 'objectId'].includes(key)) return;
      const page = wsWorkspacePageState(); page.businessFilters ||= {};
      if (key === 'category' && page.businessFilters.category !== target.value) { page.businessFilters.type = ''; page.businessFilters.outcome = ''; page.businessFilters.sourceType = ''; }
      page.businessFilters[key] = String(target.value || '').slice(0, 200);
      return;
    }
    if (target.matches('[data-ws-member-group]')) { const page = wsWorkspacePageState('members'); page.groupFilter = String(target.value || 'all'); page.page = 1; page.detailId = ''; render({ skipNativeResize: true }); return; }
    if (applyGroupDirectoryControl(target)) return;
    if (target.matches('[data-ws-workspace-status]')) { applyWorkspaceListFilter(target); return; }
    if (target.matches('#wsTopAccount')) { void switchAccount(target.value, { openLogin: state.workspaceMode === 'dedicated' }); return; }
    if (target.matches('#wsBroadcastFiles')) { void addBroadcastFiles(target.files); return; }
    if (target.matches('[data-ws-broadcast-select]')) {
      const id = String(target.dataset.wsBroadcastSelect || '');
      if (id) {
        if (target.checked) state.broadcast.selectedIds.add(id);
        else state.broadcast.selectedIds.delete(id);
        render();
      }
      return;
    }
    if (target.matches('#wsBroadcastLanguage')) { state.broadcast.targetLanguage = text(target.value); render(); return; }
    if (target.matches('#wsExportIncludeMedia')) { state.export.includeMedia = target.checked; return; }
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
    if (target.matches('#wsGroupMonitorStatusFilter')) {
      state.groupMonitor.statusFilter = text(target.value) || 'all';
      void loadGroupMonitor({ silent: true });
      return;
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
    if (target.matches('[data-ws-group-draft-input]')) { groupDrafts?.input(target.dataset.wsGroupDraftInput, target.value); groupDrafts?.syncInputs(document); return; }
    if (target.matches('[data-ws-business-query]')) { wsWorkspacePageState().filter = String(target.value || '').slice(0, 160); return; }
    if (target.matches('[data-ws-business-filter]')) { applyControlChange(target); return; }
    if (target.matches('[data-ws-workspace-search]')) { applyWorkspaceListFilter(target); return; }
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
    if (target.matches('#wsBroadcastText')) { state.broadcast.originalText = target.value; state.broadcast.caption = target.value; state.broadcast.translatedText = ''; state.broadcast.error = ''; return; }
    if (target.matches('#wsGroupMonitorJid')) { state.groupMonitor.draftJid = target.value; state.groupMonitor.error = ''; return; }
    if (target.matches('#wsGroupMonitorName')) { state.groupMonitor.draftName = target.value; return; }
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
    if (target.id !== 'wsReplyInput') draft[key] = target.value;
    if (target.id === 'wsReplyInput') {
      updateReplyDraftInput(draft, target.value);
      if (draft.replyPreviewSource !== target.value) {
        draft.replyPreview = '';
        draft.replyPreviewSource = '';
        draft.replyError = '';
      }
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
    const mode = arguments.length ? arguments[0] : state.workspaceMode;
    const host = getHost();
    if (!host) return;
    const workspaceMode = normalizeWorkspaceMode(mode);
    if (!workspaceMode) throw new Error('WS 工作区用途无效。');
    const reentering = !state.active;
    if (workspaceMode !== state.workspaceMode) {
      void wsBridge('hide').catch(() => {});
      stopBackgroundRuntime();
      ++state.workspaceGeneration;
      state.workspaceMode = workspaceMode;
      state.accounts = [];
      state.pendingRestoreAccountId = '';
      resetAccountPresentation('');
      state.wsWorkspaceView = readWsWorkspaceView(workspaceMode);
      state.accountFormOpen = false; state.accountFormName = ''; state.accountFormId = ''; state.accountFormError = '';
      if (state.assistDrawerTab === 'broadcast') state.assistDrawerTab = 'profile';
    }
    const firstBackgroundStart = startBackgroundRuntime();
    state.active = true;
    host.state.view = 'ws-workbench';
    document.documentElement.dataset.view = 'ws-workbench';
    state.error = '';
    $('#crumbCurrent').textContent = workspaceLabel();
    $$('.nav-item').forEach(item => item.classList.toggle('active', item.dataset.view === 'ws-workbench' && item.dataset.wsWorkspaceMode === state.workspaceMode));
    document.body.classList.add('ws-mode');
    render();
    if (!firstBackgroundStart) {
      if (!modeAccount(state.activeAccountId)) return;
      // The account and native collector were intentionally kept alive while
      // another Zhike page was visible. Re-entering WS only remounts the UI;
      // it must not start another poller, queue pump or account load.
      if (reentering && workspaceMode === 'dedicated' && state.wsWorkspaceView === 'chat') void connectionAction('open');
      else queueResizeWsView();
      void refreshCollectionSummary({ background: true });
      void loadGroupMonitor({ background: true, silent: true });
      return;
    }
    const startGeneration = backgroundGeneration;
    if (backgroundStartPromise && backgroundStartGeneration === startGeneration) return;
    backgroundStartGeneration = startGeneration;
    let startAccount = null;
    const ownsStart = () => state.backgroundActive && startGeneration === backgroundGeneration
      && (!startAccount || (startAccount.id === state.activeAccountId && startAccount.generation === state.accountPresentationGeneration && startAccount.attempt === state.connectionAttemptGeneration));
    backgroundStartPromise = (async () => {
      await loadAccounts();
      if (!ownsStart() || !modeAccount(state.activeAccountId)) return;
      startAccount = { id: state.activeAccountId, generation: state.accountPresentationGeneration, attempt: state.connectionAttemptGeneration };
      render();
      let openError = null;
      if (workspaceMode !== 'dedicated' || state.wsWorkspaceView === 'chat') {
        try {
          const opened = await wsBridge('open');
          if (opened?.ok === false || opened?.status === '连接失败') throw new Error(opened.detail || opened.error || 'WS 账号页面打开失败。');
          if (ownsStart() && opened?.status === '已连接') {
            setStatus(opened.status, opened.detail || '');
            if (!state.liveDirectory?.foregroundChecked) void refreshForegroundDirectory();
          }
        } catch (error) {
          if (!ownsStart()) return;
          openError = error;
          state.error = error.message || 'WS 账号页面打开失败。';
        }
      }
      if (!ownsStart()) return;
      await syncWsGroupAllowlist(captureContext(''), true).catch(() => null);
      if (!ownsStart()) return;
      await loadConversations();
      if (!ownsStart()) return;
      await loadGroupMonitor({ silent: true });
      if (!ownsStart()) return;
      const result = await wsBridge('status');
      if (!ownsStart()) return;
      updateAccountStatus(result);
      if (openError) {
        state.error = openError.message || 'WS 账号页面打开失败。';
        setStatus('连接失败', wsErrorDetail(openError));
      } else {
        setStatus(result.status, result.detail || '');
      }
      render();
      await refreshCollectionSummary({ background: true });
    })().catch(error => {
      if (ownsStart()) { state.error = error.message || 'WS 初始化失败。'; setStatus('连接失败', state.error); render(); }
    }).finally(() => {
      if (backgroundStartGeneration === startGeneration) {
        backgroundStartPromise = null;
        backgroundStartGeneration = 0;
      }
    });
  }
  function deactivate() {
    flushDraftPersist();
    if (!state.active) return;
    invalidateExclusionPage();
    groupDrafts?.reset();
    state.active = false;
    groupReading?.reset();
    groupPermissions?.reset();
    groupChannels?.reset();
    assistDrawerResize = null;
    assistDrawerMove = null;
    unbindAssistPointerListeners();
    browserResizeObserver?.disconnect?.();
    browserResizeObserver = undefined;
    browserResizeObservedHost = undefined;
    lastResizeBounds = '';
    lastResizeGeometry = null;
    document.body.classList.remove('ws-mode');
    wsBridge('hide').catch(() => {});
    if (backgroundAccountRefreshQueue.size) void requestAccountPipelineRefresh(backgroundAccountRefreshQueue.values().next().value);
  }
  async function exportWsData(accountId = '') { return api('/api/ws/export'+(accountId?'?accountId='+encodeURIComponent(accountId):''), { timeout: 30000 }); }
  async function listWsBackupAccounts() { return api('/api/ws/accounts', { timeout: 30000 }); }
  async function ensureWsBackupAccount(accountId, displayName, workspaceMode) {
    const id = String(accountId || '').trim(); if (!id) throw new Error('备份中的 WS 账号编号为空。');
    const requestedMode = normalizeWorkspaceMode(workspaceMode);
    if (!requestedMode) throw new Error('备份中的 WS 账号用途无效。');
    const checkExisting = row => {
      if (String(row?.id || '') !== id) throw new Error('备份账号编号大小写与本机账号不一致，恢复已取消。');
      const actualMode = accountWorkspaceMode(row);
      if (!actualMode || (workspaceMode !== undefined && actualMode !== requestedMode)) throw new Error('备份账号用途与本机账号不一致，恢复已取消。');
      return { created: false, workspaceMode: actualMode };
    };
    const find = rows => rows.find(item => String(item?.id || '').toLowerCase() === id.toLowerCase());
    const listed = await listWsBackupAccounts(); if (!Array.isArray(listed.accounts)) throw new Error('无法读取 WS 账号清单，恢复已取消。');
    const existing = find(listed.accounts); if (existing) return checkExisting(existing);
    try {
      const result = await api('/api/ws/accounts', { method: 'POST', timeout: 30000, body: JSON.stringify({ id, displayName: String(displayName || id), workspaceMode: requestedMode }) }, { accountId: id });
      if (!result?.account || String(result.account.id) !== id || accountWorkspaceMode(result.account) !== requestedMode) throw new Error('恢复账号编号或用途未确认，恢复已取消。');
      return { created: true, workspaceMode: requestedMode };
    } catch (error) {
      const refreshed = await listWsBackupAccounts();
      const confirmed = Array.isArray(refreshed.accounts) && find(refreshed.accounts);
      if (confirmed) {
        if (accountWorkspaceMode(confirmed) !== requestedMode) throw new Error('恢复账号用途未确认，恢复已取消。');
        return checkExisting(confirmed);
      }
      throw error;
    }
  }
  async function deleteWsBackupAccount(accountId) {
    const id=String(accountId||'').trim();if(!id||id==='default')throw new Error('不能删除默认 WS 账号。');
    return api('/api/ws/accounts/'+encodeURIComponent(id),{method:'DELETE',timeout:30000},{accountId:id});
  }
  async function importWsData(value, accountId = '') {
    if (!value || typeof value !== 'object') return { skipped: true };
    return api('/api/ws/import', { method: 'POST', timeout: 60000, body: JSON.stringify({...value,accountId:accountId||value.accountId||''}) }, { accountId: accountId || value.accountId || '' });
  }
  async function importWsGroupDrafts(payload) {
    return api('/api/ws/group-drafts/restore', { method: 'POST', timeout: 60000, body: JSON.stringify(payload) });
  }
  window.__zhikeWsBackup = Object.freeze({ exportData: exportWsData, importData: importWsData, importGroupDrafts: importWsGroupDrafts, listAccounts: listWsBackupAccounts, ensureAccount: ensureWsBackupAccount, deleteAccount: deleteWsBackupAccount });
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
    openWorkspace: () => activate('ordinary'),
  });
  window.__zhikeWsWorkspace = Object.freeze({ open: mode => activate(mode), getMode: () => state.workspaceMode });
  function boot() {
    if (bootInitialized) return;
    const host = getHost();
    if (!host) {
      // The registry host is mounted asynchronously by the shell. Keep one
      // bounded retry timer instead of creating an unbounded timer chain on
      // every failed probe, and release it once the page is unloaded.
      if (bootRetryTimer == null) bootRetryTimer = setTimeout(() => {
        bootRetryTimer = null;
        boot();
      }, 50);
      return;
    }
    bootInitialized = true;
    document.addEventListener('toggle', event => {
      if (event.target?.isConnected && event.target.matches?.('#wsVisibleContactDirectory details') && state.workspaceMode === 'ordinary') {
        liveDirectory().contactsExpanded = event.target.open;
      }
    }, true);
    const nav = $('#mainNav');
    nav?.addEventListener('click', event => {
      const item = event.target.closest('[data-view]');
      if (!item) return;
      if (item.dataset.view === 'ws-workbench') {
        event.preventDefault();
        event.stopImmediatePropagation();
        activate(item.dataset.wsWorkspaceMode || 'ordinary');
      } else deactivate();
    }, true);
    const view = $('#viewContainer');
    view?.addEventListener('click', event => {
      const target = event.target;
      const modeItem = target?.closest?.('button[data-ws-workspace-mode]');
      if (modeItem) { event.preventDefault(); event.stopImmediatePropagation(); activate(modeItem.dataset.wsWorkspaceMode); return; }
      const workspaceItem = target?.closest?.('[data-ws-workspace-view]');
      if (workspaceItem) {
        event.preventDefault();
        event.stopImmediatePropagation();
        const nextView = String(workspaceItem.dataset.wsWorkspaceView || '');
        if (!workspaceViewAllowed(nextView)) return;
        invalidateExclusionPage();
        groupDrafts?.reset();
        wsWorkspacePageState(state.wsWorkspaceView).scrollTop = Number(document.querySelector('[data-ws-workspace-page]')?.scrollTop || 0);
        state.wsWorkspaceView = nextView;
        wsWorkspacePageState(nextView);
        writeWsWorkspaceState(nextView, state.wsWorkspaceNavCollapsed);
        if (nextView === 'chat' && state.workspaceMode === 'dedicated' && modeAccount(state.activeAccountId)) {
          state.mobilePanel = 'center';
          if (!state.busy.connection && !state.busy.collector) { void connectionAction('open'); return; }
        }
        render();
        if (modeAccount(state.activeAccountId) && !WS_BLOCKED_VIEWS.has(nextView) && nextView !== 'chat' && wsWorkspacePageState(nextView).status === '尚未刷新') void refreshWorkspacePage();
        return;
      }
      // Page-layer drawer clicks close the drawer when they land outside it.
      // The native WS host is explicitly excluded so normal chatting remains
      // uninterrupted while the auxiliary panel is open.
      if (state.wsWorkspaceView === 'chat' && state.assistDrawerOpen && !target?.closest?.('#wsAssistDrawer, #wsBrowserHost, .ws-assist-launcher, button, input, select, label, [data-ws-action="toggle-right"], [data-ws-action="open-assist-drawer"]')) {
        event.preventDefault();
        event.stopImmediatePropagation();
        closeAssistDrawer();
        return;
      }
      const element = target?.closest?.('[data-ws-action]');
      if (!element) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      Promise.resolve(handleAction(element.dataset.wsAction, element)).catch(error => {
        state.error = error.message || 'WS 操作失败，请重试。';
        toast(state.error, 'x');
        render();
      });
    }, true);
    view?.addEventListener('toggle', event => {
      if (state.wsWorkspaceView !== 'groups' || !event.target?.matches?.('[data-ws-group-monitor-details]')) return;
      const page = groupDirectoryState(), open = Boolean(event.target.open);
      if (Boolean(page.monitorDetailsOpen) === open) return;
      page.monitorDetailsOpen = open;
      render({ skipNativeResize: true });
    }, true);
    view?.addEventListener('pointerdown', event => {
      const target = event.target;
      if (target?.closest?.('[data-ws-action="assist-drawer-handle"]')) {
        handleAssistDrawerResizeStart(event);
        return;
      }
      if (target?.closest?.('[data-assist-drawer-drag]')) handleAssistDrawerMoveStart(event);
    }, true);
    view?.addEventListener('change', event => {
      if (!event.target.closest('.ws-workbench-page')) return;
      event.stopImmediatePropagation();
      if (selectExclusionRules(event.target)) return;
      applyControlChange(event.target);
    }, true);
    view?.addEventListener('input', event => {
      if (!event.target.closest('.ws-workbench-page')) return;
      applyInput(event.target);
    }, true);
    view?.addEventListener('submit', event => {
      const form = event.target?.closest?.('[data-ws-group-draft-search]');
      if (!form) return;
      event.preventDefault(); event.stopImmediatePropagation();
      void groupDrafts?.run('search');
    }, true);
    view?.addEventListener('submit', event => {
      const form = event.target?.closest?.('[data-ws-business-form]');
      if (!form) return;
      event.preventDefault(); event.stopImmediatePropagation();
      void handleAction('business-search', { dataset: { businessView: form.dataset.wsBusinessForm } });
    }, true);
    // WS directory exclusion forms: search, single add and batch import.
    view?.addEventListener('submit', event => {
      const form = event.target?.closest?.('[data-ws-exclusion-form]');
      if (!form) return;
      event.preventDefault(); event.stopImmediatePropagation();
      void submitExclusionForm(form);
    }, true);
    // keydown Escape closes the assistant drawer without touching the native chat surface.
    view?.addEventListener('keydown', event => {
      const target = event.target;
      if (event.key === 'Escape' && state.assistDrawerOpen && target?.closest?.('#wsAssistDrawer')) {
        event.preventDefault();
        closeAssistDrawer();
        return;
      }
      if (target?.id === 'wsAccountDisplayName') {
        if (event.key === 'Escape') { event.preventDefault(); cancelAccountForm(); return; }
        if (event.key === 'Enter') { event.preventDefault(); void createAccount(); return; }
      }
      if (target?.id === 'wsVisibleChat' && event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
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
      const rows = ordinaryConversationRows();
      const matchCount = query
        ? rows.reduce((count, item) => count + (`${item.title || ''} ${item.externalId || ''} ${item.lastMessageText || ''}`.toLocaleLowerCase().includes(query) ? 1 : 0), 0)
        : rows.length;
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
    window.zhikeDesktop?.on?.('sync.updated', recordLiveIngestion);
    window.zhikeDesktop?.onWsStatus?.(payload => {
      if (!payload) return;
      if (receiveWorkspaceLiveEvent(payload)) return;
      if (payload.accountId === state.activeAccountId && recordLiveHistory(payload) === false) return;
      if (payload.restoreAccountId) {
        // Native restore events can belong to the other workspace. Resolve
        // against this mode's fresh list before changing presentation/storage.
        if (modeAccount(payload.restoreAccountId)) {
          void cancelAllAiWork();
          ++state.accountLoadSequence;
          resetAccountPresentation(payload.restoreAccountId);
          writeStoredAccountId(state.activeAccountId);
          state.accountBusy = false;
          updateAccountStatus({ ...payload, accountId: state.activeAccountId, status: payload.status || '连接失败' });
        }
        state.pendingRestoreAccountId = String(payload.restoreAccountId);
        void loadAccounts();
        return;
      }
      if (!modeAccount(payload.accountId || state.activeAccountId)) return;
      const wasConnected = state.wsStatus === '已连接';
      const payloadAccountId = text(payload.accountId);
      updateAccountStatus(payload);
      if (payloadAccountId && payload.status) {
        // Keep the non-active account rail current without rebuilding the
        // live WS shell. updateAccountStatus also handles direct bridge
        // responses; this explicit branch documents the background event
        // boundary and protects the multi-account path from future refactors.
        updateAccountStatusDom(payloadAccountId, payload.status);
      }
      if (payloadAccountId && payloadAccountId !== String(state.activeAccountId || 'default')) {
        if (state.backgroundActive && (payload.status === '已连接' || payload.eventName || payload.accepted != null || payload.queuedForRetry)) void requestAccountPipelineRefresh(payloadAccountId);
        return;
      }
      if (payload.eventName === 'collection-complete' || payload.coverage === 'read-history-complete') state.readHistoryAutoStarted = false;
      // Native background heartbeats arrive every few seconds without a new
      // detail string. Replacing the status text with the default sentence on
      // each tick makes the compact toolbar re-measure and can move the
      // embedded WebView/scrollbar even though no business state changed.
      const isTelemetryTick = payload.eventName === 'background-tick' && !text(payload.detail);
      if (isTelemetryTick && payload.status === state.wsStatus) updateStatusDom();
      else if (!payloadAccountId && payload.status) setStatus(payload.status, payload.detail || '');
      if (state.backgroundActive && collectionReady()) {
        if (payload.accepted != null || payload.queuedForRetry) state.wsDetail = payload.detail || state.wsDetail;
        // QR login completes asynchronously after the Open/Reload action.
        // The first connected status event is therefore the other discovery
        // boundary: refresh the account once here so the group picker is
        // populated without requiring a second manual click.  Subsequent
        // heartbeat ticks keep the cheap summary refresh only.
        if (!wasConnected && payloadAccountId === String(state.activeAccountId || 'default')) void loadConversations();
        void refreshCollectionSummary({ background: payload.background === true || payload.eventName === 'background-tick' || payload.accepted != null || payload.queuedForRetry });
      }
    });
    window.addEventListener('resize', () => {
      if (state.active) {
        const normalizedOffset = normalizeAssistDrawerOffset(state.assistDrawerOffset);
        if (normalizedOffset.y !== state.assistDrawerOffset.y) {
          state.assistDrawerOffset = normalizedOffset;
          writeAssistDrawerState('offset', normalizedOffset);
          const drawer = $('#wsAssistDrawer');
          drawer?.style?.setProperty('--ws-assist-drawer-offset-y', `${normalizedOffset.y}px`);
        }
        queueResizeWsView();
      }
    });
    window.addEventListener('beforeunload', () => {
      if (bootRetryTimer != null) { clearTimeout(bootRetryTimer); bootRetryTimer = null; }
      flushDraftPersist();
      stopBackgroundRuntime();
    });
    window.addEventListener('offline', () => setStatus('连接失败', '网络已断开；知客本地客户功能仍可使用。'));
    window.addEventListener('online', () => {
      if (!state.backgroundActive) return;
      wsBridge('probe').then(result => {
        setStatus(result.status, result.detail || '');
        if (result.status === '已连接') void refreshCollectionSummary({ background: true });
      }).catch(() => {});
    });
    observer = new MutationObserver(() => {
      if (!rendering && state.active && host.state.view === 'ws-workbench' && !$('#viewContainer .ws-workbench-page')) render();
    });
    observer.observe(view, { childList: true });
  }
  boot();
})();

