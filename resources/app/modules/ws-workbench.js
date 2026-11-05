(() => {
  const core = window.ZhikeWsCore;
  const getHost = () => window.__zhikeRegistryHost;
  const esc = value => getHost()?.esc?.(value) || String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const nowIso = () => new Date().toISOString();
  const text = value => String(value == null ? '' : value).trim();
  const state = {
    active: false,
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
    leftCollapsed: false,
    rightCollapsed: false,
    mobilePanel: 'center',
    captureDirection: 'receive',
    conversationQuery: '',
    translationStatus: '翻译服务未检测',
    loading: false,
    lastLoadedAt: '',
    drafts: new Map(),
    matchCandidates: [],
    createExternalId: '',
    createTitle: '',
    error: '',
    collectionRun: null,
    followupAlerts: [],
    discoveredConversations: [],
  };
  let rendering = false;
  let observer;
  let settingsSaveTimer;
  let settingsSaveSequence = 0;
  let collectionRefreshTimer;
  let loadSequence = 0;

  function toast(message, icon = 'check') { getHost()?.toast?.(message, icon); }
  function activeConversation() { return state.conversations.find(item => String(item.id) === String(state.currentConversationId)) || null; }
  function stableHash(value) { return core.stableHash(value); }
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
    const key = String(state.currentConversationId || '__new__');
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
  async function api(pathname, init = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Number(init.timeout) || 20000);
    try {
      const response = await fetch(pathname, {
        cache: 'no-store',
        ...init,
        signal: controller.signal,
        headers: { 'Content-Type': 'application/json', ...(init.headers || {}) },
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
  async function wsBridge(action) {
    if (!window.zhikeDesktop?.ws) throw new Error('当前页面没有桌面 WS 视图能力，请从知客安装版打开。');
    return window.zhikeDesktop.ws({ action, bounds: boundsForBrowserView() });
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
    state.busy.connection = true;
    try {
      const result = await wsBridge(action);
      setStatus(result.status || (action === 'reconnect' ? '正在重连' : action === 'close' || action === 'clear-session' ? '未连接' : '等待登录'), result.detail || '');
      if (action === 'clear-session') toast('WS 隔离登录会话已清除，本地业务记录仍保留');
      else if (action === 'close') toast('WS 页面已关闭，本地业务记录仍保留');
      else if (action === 'probe') toast('WS 登录状态已重新检测');
      else toast('WS 页面已打开，请自行扫码或登录');
    } catch (error) {
      setStatus('连接失败', error.message);
      toast(error.message, 'x');
    } finally {
      state.busy.connection = false;
      render();
    }
  }

  async function loadConversations() {
    const sequence = ++loadSequence;
    state.loading = true;
    state.error = '';
    render();
    try {
      const result = await api('/api/ws/conversations?limit=200');
      if (sequence !== loadSequence) return;
      try { state.collectionRun = (await api('/api/ws/collection-runs')).run || null; } catch {}
      try { state.followupAlerts = (await api('/api/ws/followup-alerts?limit=8')).alerts || []; } catch {}
      state.conversations = Array.isArray(result.conversations) ? result.conversations : [];
      if (!state.currentConversationId && state.conversations[0]) state.currentConversationId = state.conversations[0].id;
      if (state.currentConversationId) await loadConversationData(state.currentConversationId, false);
      state.lastLoadedAt = nowIso();
    } catch (error) {
      if (sequence === loadSequence) state.error = error.message;
    } finally {
      if (sequence === loadSequence) { state.loading = false; render(); }
    }
  }
  async function refreshCollectionSummary() {
    if (!state.active || state.loading) return;
    try {
      const [result, run, alerts] = await Promise.all([
        api('/api/ws/conversations?limit=200'),
        api('/api/ws/collection-runs'),
        api('/api/ws/followup-alerts?limit=8'),
      ]);
      state.conversations = Array.isArray(result.conversations) ? result.conversations : state.conversations;
      state.collectionRun = run.run || null;
      state.followupAlerts = alerts.alerts || [];
      if (state.wsStatus === '已连接') {
        const visible = await wsBridge('discover-conversations').catch(() => null);
        if (visible?.supported && visible.conversations?.length) await enqueueDiscoveredConversations(visible.conversations, false);
      }
      render();
    } catch {}
  }
  async function enqueueDiscoveredConversations(items, announce = true) {
    if (!Array.isArray(items) || !items.length) return 0;
    if (!state.collectionRun) state.collectionRun = (await api('/api/ws/collection-runs', { method: 'POST', body: JSON.stringify({}) })).run;
    let queued = 0;
    for (const item of items) {
      const externalId = text(item.externalId || `visible-${item.index}`); const title = text(item.title || externalId);
      const conversation = await api('/api/ws/conversations', { method: 'POST', body: JSON.stringify({ externalId, title, lastMessageText: text(item.preview).slice(0, 4000), unreadCount: Number(item.unreadCount || 0), data: { discovery: 'visible-page', previewOnly: true, historyLoaded: false } }) });
      await api('/api/ws/collection-items', { method: 'POST', body: JSON.stringify({ runId: state.collectionRun.id, conversationId: conversation.id, status: 'queued' }) });
      queued += 1;
    }
    state.conversations = (await api('/api/ws/conversations?limit=200')).conversations || state.conversations;
    if (announce) toast(`已发现 ${items.length} 个会话，入队 ${queued} 个`);
    return queued;
  }
  async function createCollectionRun() {
    try { state.collectionRun = (await api('/api/ws/collection-runs', { method: 'POST', body: JSON.stringify({}) })).run; toast('已创建采集任务，请开始读取 WhatsApp Web 会话'); render(); }
    catch (error) { state.error = error.message; render(); }
  }
  async function updateCollectionRun(status) {
    if (!state.collectionRun?.id) return;
    try { state.collectionRun = (await api('/api/ws/collection-runs', { method: 'PATCH', body: JSON.stringify({ id: state.collectionRun.id, status }) })).run; toast(status === 'paused' ? '采集已暂停' : status === 'stopped' ? '采集已停止' : '采集已继续'); render(); }
    catch (error) { state.error = error.message; render(); }
  }
  async function discoverConversations() {
    try {
      const result = await wsBridge('discover-conversations'); if (!result?.supported) throw new Error(result?.error || '当前页面结构未识别'); state.discoveredConversations = result.conversations || [];
      const queued = await enqueueDiscoveredConversations(state.discoveredConversations, false);
      state.collectionRun = (await api('/api/ws/collection-runs', { method: 'PATCH', body: JSON.stringify({ id: state.collectionRun.id, status: 'discovering', discovered: state.discoveredConversations.length, total: state.discoveredConversations.length }) })).run;
      toast(`已发现 ${state.discoveredConversations.length} 个会话，入队 ${queued} 个`); render();
    }
    catch (error) { state.error = error.message; render(); }
  }
  async function captureVisibleMessages() {
    const current = activeConversation(); if (!current) { toast('请先选择一个本机会话', 'x'); return; }
    try {
      const result = await wsBridge('capture-visible-messages'); if (!result?.supported || !result.messages?.length) throw new Error(result?.error || '当前页面没有可识别的可见消息');
      const draft = currentDraft(); draft.captureText = result.messages.map(item => item.text).join('\n'); state.captureDirection = 'receive'; render();
      await importVisible();
      if (state.collectionRun?.id) await api('/api/ws/collection-items', { method: 'PATCH', body: JSON.stringify({ runId: state.collectionRun.id, conversationId: current.id, status: 'completed', analysisStatus: 'pending', checkpoint: String(result.messages.length) }) });
      toast(`已采集当前会话 ${result.messages.length} 条可见消息`);
    } catch (error) {
      if (state.collectionRun?.id) { try { await api('/api/ws/collection-items', { method: 'PATCH', body: JSON.stringify({ runId: state.collectionRun.id, conversationId: current.id, status: 'failed', attempts: 1, lastError: error.message }) }); } catch {} }
      state.error = error.message; render();
    }
  }
  function renderCollectionCard() {
    const run = state.collectionRun;
    if (!run) return `<section class="ws-card ws-collection-card"><div class="ws-card-heading"><div><strong>采集与跟进</strong><span>尚未创建采集任务</span></div></div><p class="ws-muted">采集会话后再由 AI 分析，并把需要跟进的客户写入跟进记录。</p><button class="btn small primary ws-full-button" data-ws-action="create-collection-run">创建采集任务</button></section>`;
    const pending = Math.max(0, run.total - run.completed - run.failed - run.skipped);
    const alerts = state.followupAlerts || [];
    const alertHtml = alerts.length ? `<div class="ws-followup-alerts">${alerts.map(item => `<div class="ws-followup-alert"><strong>${esc(item.title || item.externalId || '未命名客户')}</strong><span>${esc(item.intent || item.urgency || '建议跟进')}</span><p>${esc(item.nextStep || item.summary || '请人工查看会话并确认下一步')}</p></div>`).join('')}</div>` : '<p class="ws-muted">当前没有自动识别出的待跟进客户。</p>';
    const controls = run.status === 'paused' ? '<button class="btn small" data-ws-action="resume-collection">继续</button>' : ['created','running','discovering'].includes(run.status) ? '<button class="btn small" data-ws-action="pause-collection">暂停</button><button class="btn small danger" data-ws-action="stop-collection">停止</button>' : '';
    return `<section class="ws-card ws-collection-card"><div class="ws-card-heading"><div><strong>采集与跟进</strong><span>${esc(run.status)} · 更新于 ${esc(displayTime(run.updatedAt))}</span></div><div>${controls}<button class="btn small" data-ws-action="create-collection-run">新建任务</button></div></div><div class="ws-collection-stats"><b>${run.completed}/${run.total || run.discovered}</b><span>已采集</span><b>${run.analyzed}</b><span>已分析</span><b>${run.retryable}</b><span>待重试</span><b>${pending}</b><span>待处理</span></div>${run.lastError ? `<p class="ws-error-line">${esc(run.lastError)}</p>` : ''}${alertHtml}</section>`;
  }
  async function loadConversationData(id, redraw = true) {
    state.currentConversationId = String(id || '');
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
        api(`/api/ws/settings?conversationId=${encoded}`),
        api(`/api/ws/messages?conversationId=${encoded}&limit=500`),
        api(`/api/ws/analyses?conversationId=${encoded}&limit=1`),
        api(`/api/ws/replies?conversationId=${encoded}&limit=10`),
      ]);
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
      state.error = error.message;
    } finally {
      state.loading = false;
      if (redraw) render();
    }
  }
  async function createConversation() {
    if (state.busy.customer) return;
    const externalId = text($('#wsConversationExternalId')?.value || state.createExternalId);
    const title = text($('#wsConversationTitle')?.value || state.createTitle);
    if (!externalId) { toast('请输入 WS 会话标识；不读取平台账号或 Cookie。', 'x'); return; }
    state.busy.customer = true;
    render();
    try {
      const item = await api('/api/ws/conversations', { method: 'POST', body: JSON.stringify({ externalId, title }) });
      const existing = state.conversations.find(row => String(row.id) === String(item.id));
      state.conversations = existing ? state.conversations.map(row => String(row.id) === String(item.id) ? item : row) : [item, ...state.conversations];
      state.createExternalId = '';
      state.createTitle = '';
      state.mobilePanel = 'center';
      await loadConversationData(item.id, false);
      toast(existing ? '已打开现有 WS 会话' : '已建立本机会话记录');
    } catch (error) {
      state.error = error.message;
      toast(error.message, 'x');
    } finally {
      state.busy.customer = false;
      render();
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
  function renderMessageRows() {
    if (!state.messages.length) return '<div class="ws-empty ws-message-empty">导入当前可见聊天后，原文和译文会显示在这里。</div>';
    return state.messages.map(message => {
      const busy = state.translationBusy.has(String(message.id));
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
            <label class="ws-top-switch"><input id="wsTopTranslateEnabled" type="checkbox" ${state.settings.enabled ? 'checked' : ''}>翻译</label>
            <select id="wsTopTranslationMode" title="翻译模式">
              <option value="both" ${translationModeValue() === 'both' ? 'selected' : ''}>双向翻译</option>
              <option value="receive" ${translationModeValue() === 'receive' ? 'selected' : ''}>只翻译接收</option>
              <option value="send" ${translationModeValue() === 'send' ? 'selected' : ''}>只翻译发送</option>
              <option value="manual" ${translationModeValue() === 'manual' ? 'selected' : ''}>仅手动</option>
              <option value="off" ${translationModeValue() === 'off' ? 'selected' : ''}>全部关闭</option>
            </select>
            <button class="btn small" data-ws-action="toggle-left">${state.leftCollapsed ? '显示会话' : '隐藏会话'}</button>
            <button class="btn small" data-ws-action="toggle-right">${state.rightCollapsed ? '显示辅助' : '隐藏辅助'}</button>
          </div>
        </div>
        ${errorBanner}${loadingBanner}
        <div class="ws-mobile-tabs">
          <button data-ws-action="mobile-left" class="${state.mobilePanel === 'left' ? 'active' : ''}">会话</button>
          <button data-ws-action="mobile-center" class="${state.mobilePanel === 'center' ? 'active' : ''}">聊天</button>
          <button data-ws-action="mobile-right" class="${state.mobilePanel === 'right' ? 'active' : ''}">翻译与 AI</button>
        </div>
        <div class="ws-layout ${state.leftCollapsed ? 'left-collapsed' : ''} ${state.rightCollapsed ? 'right-collapsed' : ''} mobile-${state.mobilePanel}">
          <aside class="ws-sessions-panel">
            <div class="ws-panel-heading"><div><strong>会话</strong><span>${state.conversations.length} 个本地记录</span></div><button class="icon-button" data-ws-action="new-conversation" title="建立会话">＋</button></div>
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
              <div><strong>WS 登录入口</strong><span id="wsStatusDetail">${esc(state.wsDetail || '请在中栏自行完成扫码或登录。')}</span></div>
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
          <aside class="ws-assist-panel">
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
    requestAnimationFrame(resizeWsView);
  }

  async function saveSettings(sequence) {
    const current = activeConversation();
    if (!current) return;
    try {
      const saved = await api('/api/ws/settings?conversationId=' + encodeURIComponent(current.id), {
        method: 'PUT',
        body: JSON.stringify({ ...state.settings, aiEnabled: state.aiEnabled }),
      });
      if (sequence !== settingsSaveSequence) return;
      state.settings = core.normalizeTranslationSettings(saved);
      state.aiEnabled = saved.aiEnabled !== false;
      state.translationStatus = state.settings.enabled ? `${core.translationMode(state.settings)} · 设置已保存` : '翻译已关闭 · 手动翻译仍可用';
    } catch (error) {
      state.error = '翻译设置保存失败：' + error.message;
      toast(state.error, 'x');
    }
  }
  function queueSaveSettings() {
    clearTimeout(settingsSaveTimer);
    const sequence = ++settingsSaveSequence;
    settingsSaveTimer = setTimeout(() => saveSettings(sequence), 220);
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
  async function translationServiceStatus() {
    if (!window.zhikeAI?.request || !window.zhikeAI?.status) throw new Error('当前没有可用的 AI 翻译服务。');
    const status = await window.zhikeAI.status().catch(() => ({ configured: false }));
    if (!status.configured) throw new Error('请先在 GPT 运营助手中配置 AI 服务；原文已保留。');
    state.translationStatus = `翻译服务正常 · ${status.providerName || status.provider || 'AI'}`;
    return status;
  }
  async function translateText(originalText, direction) {
    const source = text(originalText);
    if (!source) throw new Error('原文为空，无法翻译。');
    await translationServiceStatus();
    const destination = translationDestination(direction);
    const prompt = `请把下面${direction === 'receive' ? '客户发来的' : '准备发送给客户的'}内容翻译成${destination}。只返回译文，不要解释，不要添加引号，不要改变数字、网址或联系方式：\n${source.slice(0, 9600)}`;
    const result = await window.zhikeAI.request({
      assistantMode: 'general',
      analysisDepth: 'standard',
      input: prompt,
      context: { feature: 'ws-translation', direction, targetLanguage: destination },
    });
    const translated = text(result?.text);
    if (!translated) throw new Error('翻译服务没有返回译文。');
    state.translationStatus = `翻译服务正常 · ${result.providerName || 'AI'}`;
    return { translated, destination };
  }
  async function persistMessage(message) {
    const saved = await api('/api/ws/messages', { method: 'POST', body: JSON.stringify(message) });
    const index = state.messages.findIndex(item => String(item.id) === String(saved.id) || (message.externalId && item.externalId === message.externalId));
    if (index >= 0) state.messages[index] = saved;
    else state.messages.push(saved);
    state.messages = core.dedupeMessages(state.messages);
    return saved;
  }
  async function markTranslationFailure(message, error) {
    try {
      return await persistMessage({
        ...message,
        id: message.id,
        conversationId: message.conversationId,
        externalId: message.externalId,
        translationStatus: 'failed',
        translationError: String(error?.message || error || '翻译失败').slice(0, 500),
      });
    } catch { return message; }
  }
  async function translateMessage(id) {
    const message = state.messages.find(item => String(item.id) === String(id));
    if (!message || state.translationBusy.has(String(id))) return;
    state.translationBusy.add(String(id));
    render();
    try {
      const result = await translateText(message.originalText, message.direction);
      await persistMessage({
        ...message,
        id: message.id,
        conversationId: message.conversationId,
        externalId: message.externalId,
        translatedText: result.translated,
        targetLanguage: result.destination,
        translationStatus: 'translated',
        translationError: '',
      });
      toast('单条消息翻译已保存');
    } catch (error) {
      await markTranslationFailure(message, error);
      toast(error.message + ' 原文仍保留。', 'x');
    } finally {
      state.translationBusy.delete(String(id));
      render();
    }
  }
  async function translateMessagesInBatches(messages) {
    const pending = messages.filter(message => !message.translatedText && core.shouldTranslate(state.settings, message.direction));
    if (!pending.length) return { translated: 0, failed: 0 };
    try { await translationServiceStatus(); }
    catch (error) {
      for (const message of pending) await markTranslationFailure(message, error);
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
        await markTranslationFailure(message, error);
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
          const result = await window.zhikeAI.request({
            assistantMode: 'general',
            analysisDepth: 'standard',
            input: `把 JSON 数组中每个 text 翻译成${group.destination}。保持 id 不变，只返回 JSON 数组，每项格式为 {"id":"原id","translation":"译文"}，不要 Markdown 或解释：\n${JSON.stringify(payload)}`,
            context: { feature: 'ws-translation-batch', direction: group.direction, targetLanguage: group.destination, count: payload.length },
          });
          const parsed = new Map(core.parseTranslationBatch(result?.text || '').map(item => [item.id, item.translation]));
          for (const message of chunk) {
            const value = parsed.get(String(message.id));
            if (!value) {
              await markTranslationFailure(message, new Error('批量翻译结果缺少该消息。'));
              failed++;
              continue;
            }
            await persistMessage({ ...message, translatedText: value, targetLanguage: group.destination, translationStatus: 'translated', translationError: '' });
            translated++;
          }
        } catch (error) {
          for (const message of chunk) await markTranslationFailure(message, error);
          failed += chunk.length;
        }
      }
    }
    return { translated, failed };
  }
  async function importVisible() {
    if (state.busy.import) return;
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
        if (conversation) { conversation.customerId = String(match.customer.id); await api('/api/ws/conversations', { method: 'POST', body: JSON.stringify({ externalId: conversation.externalId, customerId: String(match.customer.id) }) }); }
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
      });
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
      const translation = await translateMessagesInBatches(stored);
      const inserted = Number(result.inserted ?? stored.filter(item => !item.existed).length);
      const existed = Number(result.existed || 0);
      toast(`原文已保存 ${inserted} 条${existed ? `，跳过重复 ${existed} 条` : ''}${translation.translated ? `，翻译 ${translation.translated} 条` : ''}${translation.failed ? `，${translation.failed} 条翻译待重试` : ''}`, translation.failed ? 'x' : 'check');
    } catch (error) {
      state.error = '导入失败，输入内容已保留：' + error.message;
      toast(state.error, 'x');
    } finally {
      state.busy.import = false;
      render();
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

  async function analyzeConversation() {
    const current = activeConversation();
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
      state.analysis = core.parseAiResult(result?.text || '');
      state.analysis.providerName = result.providerName || '';
      state.analysis.model = result.model || '';
      state.analysis.transcriptInfo = transcript;
      const saved = await api('/api/ws/analyses', {
        method: 'POST',
        body: JSON.stringify({ conversationId: current.id, result: state.analysis, confidence: state.analysis.confidence, providerName: state.analysis.providerName, model: state.analysis.model }),
      });
      state.analysisMeta = saved;
      seedDraftFromAnalysis();
      const conversation = state.conversations.find(item => String(item.id) === String(current.id));
      if (conversation) {
        conversation.intentLevel = state.analysis.intent || conversation.intentLevel;
        conversation.language = state.analysis.language || conversation.language;
        conversation.updatedAt = nowIso();
      }
      toast(state.analysis.lowConfidence ? '分析完成，但需要人工确认' : `分析完成：已使用最近 ${transcript.included} 条消息`, state.analysis.lowConfidence ? 'x' : 'check');
    } catch (error) {
      state.analysis = { summary: '', lowConfidence: true, confidence: 0, error: error.message, warning: 'AI 判断置信度较低，请人工确认。' };
      try {
        state.analysisMeta = await api('/api/ws/analyses', { method: 'POST', body: JSON.stringify({ conversationId: current.id, result: state.analysis, confidence: 0, errorMessage: error.message }) });
      } catch {}
      toast(error.message, 'x');
    } finally {
      state.aiBusy = false;
      render();
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
      account: state.analysis?.contact?.account || '',
      source: 'WhatsApp',
      channel: 'WhatsApp',
      assistant: '未分配',
    };
  }
  function applyProfileToCustomer(customer, profile) {
    const patch = {
      name: profile.name,
      rawPhone: profile.phone,
      phone: profile.phone ? core.normalizePhone(profile.phone) : '',
      wsExternalId: profile.wsExternalId,
      wsConversationId: profile.conversationId,
      wsAccountId: profile.account,
      country: profile.country,
      language: profile.language,
      productInterest: profile.productInterest,
      budget: profile.budget,
      phase: profile.customerStage,
      intent: profile.intent,
      intentScore: profile.intentScore,
      emotion: profile.emotion,
      aiSummary: profile.aiSummary,
      note: profile.note,
    };
    for (const [key, value] of Object.entries(patch)) if (value !== '' && value != null) customer[key] = value;
    if (profile.tags.length) customer.tags = [...new Set([...(Array.isArray(customer.tags) ? customer.tags : []), ...profile.tags])];
    customer.touched = true;
  }
  async function saveCustomerTo(explicitId = '') {
    const current = activeConversation();
    const host = getHost();
    if (state.busy.customer) return;
    if (!current || !host) { toast('请先建立或选择本机会话。', 'x'); return; }
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
    if (snapshotReady === false) { state.busy.customer = false; render(); return; }
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
      const linked = await api('/api/ws/conversations', {
        method: 'POST',
        body: JSON.stringify({ id: current.id, externalId: current.externalId, customerId: customer.id, language: profile.language }),
      });
      current.customerId = customer.id;
      if (linked) Object.assign(current, linked);
      toast(created ? 'WS 客户已保存到客户中心' : '客户档案已更新并关联当前会话');
    } catch (error) {
      if (created) host.state.customers = beforeCustomers;
      else Object.assign(customer, before);
      host.persist();
      await host.flushStateWrites().catch(() => {});
      toast('客户保存失败，原资料已恢复：' + error.message, 'x');
    } finally {
      state.busy.customer = false;
      render();
    }
  }
  async function saveFollowup() {
    const current = activeConversation();
    const host = getHost();
    const draft = currentDraft();
    if (state.busy.followup) return;
    if (!current || !host) { toast('请先建立会话。', 'x'); return; }
    const customer = host.state.customers.find(item => String(item.id) === String(current.customerId) && !item.deleted);
    if (!customer) { toast('请先确认并保存客户资料，再登记跟进。', 'x'); return; }
    const note = text(draft.followupNote);
    if (!note) { toast('请填写本次跟进结果。', 'x'); return; }
    const recentDuplicate = host.state.followups.find(item => String(item.customerId) === String(customer.id) && text(item.note || item.result) === note && text(item.nextDate) === text(draft.nextFollow) && Date.now() - Date.parse(item.date || 0) < 120000);
    if (recentDuplicate) { toast('相同跟进刚刚已经保存，未重复写入。'); return; }
    state.busy.followup = true;
    render();
    const snapshotReady = await host.snapshotBeforeWrite?.('WS 跟进保存前自动快照');
    if (snapshotReady === false) { state.busy.followup = false; render(); return; }
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
    const before = { followups: host.state.followups.slice(), lastFollow: customer.lastFollow, due: customer.due };
    host.state.followups.unshift(record);
    customer.lastFollow = record.date.slice(0, 10);
    customer.due = record.nextDate || customer.due;
    host.persist();
    try {
      await host.flushStateWrites();
      host.activity('WS 工作台登记跟进：' + customer.name);
      await host.flushStateWrites();
      draft.followupNote = '';
      draft.nextFollow = '';
      toast('跟进记录已保存到任务中心');
    } catch (error) {
      host.state.followups = before.followups;
      customer.lastFollow = before.lastFollow;
      customer.due = before.due;
      host.persist();
      await host.flushStateWrites().catch(() => {});
      toast('跟进保存失败，原资料已恢复：' + error.message, 'x');
    } finally {
      state.busy.followup = false;
      render();
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
    const draft = currentDraft();
    const input = text(draft.replyInput || $('#wsReplyInput')?.value);
    if (!input) { toast('请先输入回复内容。', 'x'); return null; }
    state.busy.reply = true;
    draft.replyError = '';
    render();
    try {
      const result = await translateText(input, 'send');
      draft.replyPreview = result.translated;
      draft.replyPreviewSource = input;
      draft.replyPreviewLanguage = result.destination;
      return result.translated;
    } catch (error) {
      draft.replyError = error.message + ' 原文仍可继续使用。';
      toast(error.message, 'x');
      return null;
    } finally {
      state.busy.reply = false;
      render();
    }
  }
  async function copyReply() {
    const current = activeConversation();
    const draft = currentDraft();
    const input = text(draft.replyInput || $('#wsReplyInput')?.value);
    if (state.busy.reply) return;
    if (!current || !input) { toast('请先输入回复内容。', 'x'); return; }
    state.busy.reply = true;
    draft.replyError = '';
    render();
    try {
      let output = input;
      let language = '原文';
      if (core.shouldTranslate(state.settings, 'send')) {
        if (draft.replyPreviewSource === input && draft.replyPreview) {
          output = draft.replyPreview;
          language = draft.replyPreviewLanguage || sendLanguage();
        } else {
          const result = await translateText(input, 'send');
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
      draft.replyOperationId ||= 'ws-reply-' + Date.now().toString(36) + '-' + stableHash(current.id + input + output);
      const saved = await api('/api/ws/replies', {
        method: 'POST',
        body: JSON.stringify({ conversationId: current.id, originalText: input, translatedText: output, status: 'copied', idempotencyKey: draft.replyOperationId }),
      });
      state.replies = [saved, ...state.replies.filter(item => String(item.id) !== String(saved.id))].slice(0, 10);
      draft.replyOperationId = '';
      toast(`回复已完整复制（${output.length} 字），请回到 WS 页面人工发送。`);
    } catch (error) {
      draft.replyError = error.message;
      toast(error.message, 'x');
    } finally {
      state.busy.reply = false;
      render();
    }
  }

  async function retryFailedTranslations() {
    const failed = state.messages.filter(item => item.translationStatus === 'failed' || item.translationError);
    for (const message of failed) await translateMessage(message.id);
  }
  async function handleAction(action, element) {
    if (['open', 'login', 'reload', 'reconnect', 'close', 'clear-session', 'probe'].includes(action)) return connectionAction(action);
    if (action === 'capture-selection') return captureSelection();
    if (action === 'toggle-left') { state.leftCollapsed = !state.leftCollapsed; render(); return; }
    if (action === 'toggle-right') { state.rightCollapsed = !state.rightCollapsed; render(); return; }
    if (action === 'mobile-left' || action === 'mobile-center' || action === 'mobile-right') { state.mobilePanel = action.slice(7); render(); return; }
    if (action === 'new-conversation') { state.mobilePanel = 'left'; render(); requestAnimationFrame(() => $('#wsConversationExternalId')?.focus()); return; }
    if (action === 'create-conversation') return createConversation();
    if (action === 'create-collection-run') return createCollectionRun();
    if (action === 'pause-collection') return updateCollectionRun('paused');
    if (action === 'resume-collection') return updateCollectionRun('running');
    if (action === 'stop-collection') return updateCollectionRun('stopped');
    if (action === 'discover-conversations') return discoverConversations();
    if (action === 'capture-visible-messages') return captureVisibleMessages();
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
    collectionRefreshTimer = setInterval(() => { void refreshCollectionSummary(); }, 30000);
    host.state.view = 'ws-workbench';
    state.error = '';
    $('#crumbCurrent').textContent = 'WS 工作台';
    $$('.nav-item').forEach(item => item.classList.toggle('active', item.dataset.view === 'ws-workbench'));
    document.body.classList.add('ws-mode');
    render();
    loadConversations();
    wsBridge('status').then(result => setStatus(result.status, result.detail || '')).catch(error => setStatus('连接失败', error.message));
  }
  function deactivate() {
    if (!state.active) return;
    state.active = false;
    clearInterval(collectionRefreshTimer);
    collectionRefreshTimer = undefined;
    document.body.classList.remove('ws-mode');
    wsBridge('hide').catch(() => {});
  }
  async function exportWsData() { return api('/api/ws/export', { timeout: 30000 }); }
  async function importWsData(value) {
    if (!value || typeof value !== 'object') return { skipped: true };
    return api('/api/ws/import', { method: 'POST', timeout: 60000, body: JSON.stringify(value) });
  }
  window.__zhikeWsBackup = Object.freeze({ exportData: exportWsData, importData: importWsData });
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
      if (event.target.id === 'wsVisibleChat' && event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        importVisible();
      }
    }, true);
    view?.addEventListener('scroll', () => { if (state.active) requestAnimationFrame(resizeWsView); }, true);
    window.zhikeDesktop?.onWsStatus?.(payload => { if (payload) setStatus(payload.status || '未连接', payload.detail || ''); });
    window.addEventListener('resize', () => { if (state.active) requestAnimationFrame(resizeWsView); });
    window.addEventListener('offline', () => setStatus('连接失败', '网络已断开；知客本地客户功能仍可使用。'));
    window.addEventListener('online', () => { if (state.active) wsBridge('probe').then(result => setStatus(result.status, result.detail || '')).catch(() => {}); });
    observer = new MutationObserver(() => {
      if (!rendering && state.active && host.state.view === 'ws-workbench' && !$('#viewContainer .ws-workbench-page')) render();
    });
    observer.observe(view, { childList: true });
  }
  boot();
})();
