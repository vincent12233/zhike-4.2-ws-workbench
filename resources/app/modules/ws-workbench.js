(() => {
  const core = window.ZhikeWsCore;
  const getHost = () => window.__zhikeRegistryHost;
  const esc = value => getHost()?.esc?.(value) || String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const state = {
    active: false,
    currentConversationId: '',
    conversations: [],
    messages: [],
    settings: core.normalizeTranslationSettings({}),
    aiEnabled: true,
    wsStatus: '未连接',
    wsDetail: '',
    analysis: null,
    aiBusy: false,
    translationBusy: new Set(),
    leftCollapsed: false,
    rightCollapsed: false,
    captureDirection: 'receive',
    translationStatus: '翻译服务未检测',
    error: '',
  };
  let rendering = false;
  let observer;

  function toast(message, icon = 'check') { getHost()?.toast?.(message, icon); }
  function activeConversation() { return state.conversations.find(item => String(item.id) === String(state.currentConversationId)) || null; }
  function nowIso() { return new Date().toISOString(); }
  function stableHash(value) { let hash = 2166136261; for (const char of String(value || '')) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619); return (hash >>> 0).toString(36); }
  function localDateTime(value = new Date()) { return new Date(value.getTime() - value.getTimezoneOffset() * 60000).toISOString().slice(0, 16); }
  async function api(pathname, init = {}) {
    const response = await fetch(pathname, { cache: 'no-store', ...init, headers: { 'Content-Type': 'application/json', ...(init.headers || {}) } });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || 'WS 本机数据服务暂不可用。');
    return body;
  }
  function boundsForBrowserView() {
    const node = $('#wsBrowserHost');
    if (!node) return null;
    const rect = node.getBoundingClientRect();
    return { x: Math.round(rect.left), y: Math.round(rect.top), width: Math.round(rect.width), height: Math.round(rect.height) };
  }
  async function wsBridge(action) {
    if (!window.zhikeDesktop?.ws) throw new Error('当前页面没有桌面 WS 视图能力，请从知客安装版打开。');
    return window.zhikeDesktop.ws({ action, bounds: boundsForBrowserView() });
  }
  function updateStatusDom() {
    const status = $('#wsStatusBadge');
    if (status) { status.textContent = state.wsStatus; status.dataset.status = state.wsStatus; }
    const detail = $('#wsStatusDetail');
    if (detail) detail.textContent = state.wsDetail || (state.wsStatus === '已连接' ? '连接状态由用户确认；知客不读取 WS Cookie。' : '请在中栏自行完成扫码或登录。');
  }
  function setStatus(status, detail = '') { state.wsStatus = status; state.wsDetail = detail; updateStatusDom(); }
  async function openWs(action = 'open') {
    try { const result = await wsBridge(action); setStatus(result.status || (action === 'reconnect' ? '正在重连' : '等待登录')); toast(action === 'close' ? 'WS 页面已关闭' : 'WS 页面已打开，请自行登录'); }
    catch (error) { setStatus('连接失败', error.message); toast(error.message, 'x'); }
  }
  async function loadConversations() {
    try {
      const result = await api('/api/ws/conversations?limit=200');
      state.conversations = Array.isArray(result.conversations) ? result.conversations : [];
      if (!state.currentConversationId && state.conversations[0]) state.currentConversationId = state.conversations[0].id;
      if (state.currentConversationId) await loadConversationData(state.currentConversationId, false);
    } catch (error) { state.error = error.message; }
  }
  async function loadConversationData(id, redraw = true) {
    state.currentConversationId = String(id || '');
    state.analysis = null;
    if (!state.currentConversationId) { state.messages = []; if (redraw) render(); return; }
    try {
      const [settings, messages] = await Promise.all([
        api(`/api/ws/settings?conversationId=${encodeURIComponent(state.currentConversationId)}`),
        api(`/api/ws/messages?conversationId=${encodeURIComponent(state.currentConversationId)}&limit=500`),
      ]);
      state.settings = core.normalizeTranslationSettings(settings);
      state.settings.aiEnabled = settings.aiEnabled !== false;
      state.wsStatus = settings.status || state.wsStatus;
      state.messages = core.dedupeMessages(messages.messages || []);
      state.translationStatus = state.settings.enabled ? '翻译已开启 · 可按方向关闭' : '翻译已关闭 · 手动翻译仍可用';
      if (redraw) render();
    } catch (error) { state.error = error.message; if (redraw) render(); }
  }
  async function createConversation() {
    const externalId = ($('#wsConversationExternalId')?.value || '').trim();
    const title = ($('#wsConversationTitle')?.value || '').trim();
    if (!externalId) { toast('请输入 WS 会话标识；不读取平台账号或 Cookie。', 'x'); return; }
    try {
      const item = await api('/api/ws/conversations', { method: 'POST', body: JSON.stringify({ externalId, title }) });
      const existing = state.conversations.find(row => String(row.id) === String(item.id));
      state.conversations = existing ? state.conversations.map(row => row.id === item.id ? item : row) : [item, ...state.conversations];
      await loadConversationData(item.id);
      toast(existing ? '已打开现有 WS 会话' : '已建立本机会话记录');
    } catch (error) { toast(error.message, 'x'); }
  }
  function renderConversationList() {
    const rows = state.conversations.map(item => `<button class="ws-session-row ${String(item.id) === String(state.currentConversationId) ? 'active' : ''}" data-ws-action="select-conversation" data-id="${esc(item.id)}"><span class="ws-session-avatar">${esc((item.title || 'WS').slice(0, 1))}</span><span class="ws-session-copy"><strong>${esc(item.title || item.externalId)}</strong><small>${esc(item.lastMessageText || '尚未导入聊天内容')}</small></span><em>${esc(item.intentLevel || '待分析')}</em></button>`).join('');
    return rows || '<div class="ws-empty">还没有本机会话。输入会话标识后建立记录，不会预置演示数据。</div>';
  }
  function renderMessageRows() {
    if (!state.messages.length) return '<div class="ws-empty ws-message-empty">导入当前可见聊天后，原文和译文会显示在这里。</div>';
    return state.messages.map(message => `<article class="ws-message-row ${message.direction === 'send' ? 'send' : 'receive'}" data-message-id="${esc(message.id)}"><div class="ws-message-meta"><span>${message.direction === 'send' ? '我发送' : '客户收到'}</span><time>${esc(String(message.createdAt || '').slice(0, 16).replace('T', ' '))}</time><button class="link-button" data-ws-action="translate-message" data-id="${esc(message.id)}">${state.translationBusy.has(String(message.id)) ? '翻译中…' : '手动翻译'}</button></div><div class="ws-message-original" ${state.settings.showOriginal ? '' : 'hidden'}><small>原文</small><p>${esc(message.originalText)}</p></div>${message.translatedText ? `<div class="ws-message-translated"><small>译文 · ${esc(message.targetLanguage || state.settings.targetLanguage)}</small><p>${esc(message.translatedText)}</p></div>` : '<div class="ws-message-untranslated">尚无译文；可点击“手动翻译”。</div>'}</article>`).join('');
  }
  function renderAnalysis() {
    const analysis = state.analysis;
    if (!analysis) return '<div class="ws-empty">选择“分析当前聊天”后，AI 才会处理本地已导入的消息。</div>';
    const tags = (analysis.tags || []).map(tag => `<span class="ws-tag">${esc(tag)}</span>`).join('');
    const needs = (analysis.needs || []).map(item => `<li>${esc(item)}</li>`).join('');
    return `<div class="ws-analysis-result"><div class="ws-ai-summary"><strong>${esc(analysis.summary || '暂无摘要')}</strong><span class="ws-confidence ${analysis.lowConfidence ? 'low' : ''}">${analysis.lowConfidence ? 'AI 判断置信度较低，请人工确认。' : `置信度 ${Math.round((Number(analysis.confidence) || 0) * 100)}%`}</span></div><dl class="ws-fact-grid"><div><dt>意向</dt><dd>${esc(analysis.intent || '未识别')} ${analysis.intentScore == null ? '' : `· ${esc(analysis.intentScore)}`}</dd></div><div><dt>情绪</dt><dd>${esc(analysis.emotion || '未识别')}</dd></div><div><dt>语言</dt><dd>${esc(analysis.language || '未识别')}</dd></div><div><dt>紧急程度</dt><dd>${esc(analysis.urgency || '未识别')}</dd></div><div><dt>产品兴趣</dt><dd>${esc(Array.isArray(analysis.productInterest) ? analysis.productInterest.join('、') : analysis.productInterest || '未提取')}</dd></div><div><dt>预算</dt><dd>${esc(analysis.budget || '未提取')}</dd></div></dl>${needs ? `<div class="ws-analysis-section"><strong>需求</strong><ul>${needs}</ul></div>` : ''}${tags ? `<div class="ws-analysis-section"><strong>标签建议</strong><div class="ws-tag-list">${tags}</div></div>` : ''}<div class="ws-analysis-section"><strong>下一步</strong><p>${esc(analysis.nextStep || '请人工确认下一步沟通')}</p><p class="ws-muted">${esc(analysis.followupTime || '')}</p></div>${analysis.error ? `<p class="ws-error-line">${esc(analysis.error)}</p>` : ''}</div>`;
  }
  function render() {
    const host = getHost();
    if (!host || !state.active || host.state.view !== 'ws-workbench') return;
    rendering = true;
    const current = activeConversation();
    const target = $('#viewContainer');
    if (!target) { rendering = false; return; }
    target.innerHTML = `<div class="ws-workbench-page"><div class="page-heading ws-page-heading"><div><h1 class="page-title">WS 工作台</h1><p class="page-subtitle">个人 WS 登录、可见聊天翻译与客户运营辅助 · 不保存密码、Cookie、二维码或秘密 Token</p></div><div class="heading-actions"><span id="wsStatusBadge" class="ws-status-badge" data-status="${esc(state.wsStatus)}">${esc(state.wsStatus)}</span><button class="btn small" data-ws-action="toggle-left">${state.leftCollapsed ? '显示会话' : '隐藏会话'}</button><button class="btn small" data-ws-action="toggle-right">${state.rightCollapsed ? '显示辅助' : '隐藏辅助'}</button></div></div><div class="ws-layout ${state.leftCollapsed ? 'left-collapsed' : ''} ${state.rightCollapsed ? 'right-collapsed' : ''}"><aside class="ws-sessions-panel"><div class="ws-panel-heading"><div><strong>会话</strong><span>${state.conversations.length} 个本地记录</span></div><button class="icon-button" data-ws-action="new-conversation" title="建立会话">＋</button></div><div class="ws-create-session"><input id="wsConversationExternalId" placeholder="会话标识（由你输入）" maxlength="160"><input id="wsConversationTitle" placeholder="客户名称（可选）" maxlength="80"><button class="btn small primary" data-ws-action="create-conversation">建立本机会话</button></div><div class="ws-session-list">${renderConversationList()}</div></aside><section class="ws-center-panel"><div class="ws-login-toolbar"><div><strong>WS 登录入口</strong><span id="wsStatusDetail">${esc(state.wsDetail || '请在中栏自行完成扫码或登录。')}</span></div><div class="ws-toolbar-actions"><button class="btn small primary" data-ws-action="open">打开 WS</button><button class="btn small" data-ws-action="login">登录 WS</button><button class="btn small" data-ws-action="reconnect">重新连接</button><button class="btn small" data-ws-action="reload">刷新页面</button><button class="btn small" data-ws-action="mark-connected">我已登录</button><button class="btn small danger" data-ws-action="close">退出 WS</button><button class="btn small" data-ws-action="clear-session">清除本地会话</button></div></div><div id="wsBrowserHost" class="ws-browser-host"><div class="ws-browser-placeholder"><strong>官方 WS 页面会显示在这里</strong><span>用户自行登录；知客不会读取密码、Cookie 或二维码。</span></div></div><div class="ws-capture-panel"><div class="ws-capture-heading"><div><strong>导入当前可见聊天</strong><span>请从 WS 页面复制你允许处理的聊天文本，再粘贴到这里。</span></div><select id="wsCaptureDirection"><option value="receive" ${state.captureDirection === 'receive' ? 'selected' : ''}>客户收到</option><option value="send" ${state.captureDirection === 'send' ? 'selected' : ''}>我发送</option></select></div><textarea id="wsVisibleChat" rows="4" placeholder="粘贴当前可见聊天内容；每行会作为一条本地消息保存"></textarea><div class="ws-capture-actions"><span class="ws-muted">${current ? `当前会话：${esc(current.title || current.externalId)}` : '请先建立或选择本机会话'}</span><button class="btn small" data-ws-action="clear-capture">清空</button><button class="btn small primary" data-ws-action="import-visible">保存并处理</button></div></div><div class="ws-message-list">${renderMessageRows()}</div></section><aside class="ws-assist-panel"><section class="ws-card ws-translation-card"><div class="ws-card-heading"><div><strong>翻译控制</strong><span id="wsTranslationStatus">${esc(state.translationStatus)}</span></div><label class="ws-switch"><input id="wsTranslateEnabled" type="checkbox" ${state.settings.enabled ? 'checked' : ''}><span>总开关</span></label></div><div class="ws-control-grid"><label><input id="wsReceiveEnabled" type="checkbox" ${state.settings.receive ? 'checked' : ''} ${state.settings.enabled ? '' : 'disabled'}> 自动翻译收到</label><label><input id="wsSendEnabled" type="checkbox" ${state.settings.send ? 'checked' : ''} ${state.settings.enabled ? '' : 'disabled'}> 自动翻译发送</label><label><input id="wsShowOriginal" type="checkbox" ${state.settings.showOriginal ? 'checked' : ''}> 显示原文</label><label>目标语言<select id="wsTargetLanguage"><option ${state.settings.targetLanguage === '中文' ? 'selected' : ''}>中文</option><option ${state.settings.targetLanguage === 'English' ? 'selected' : ''}>English</option><option ${state.settings.targetLanguage === 'हिन्दी' ? 'selected' : ''}>हिन्दी</option><option ${state.settings.targetLanguage === 'العربية' ? 'selected' : ''}>العربية</option></select></label></div><p class="ws-muted">翻译失败时保留原文；关闭翻译后不调用翻译 API，历史译文不会删除。</p></section><section class="ws-card ws-ai-card"><div class="ws-card-heading"><div><strong>AI 分析</strong><span>只分析当前已导入的文本</span></div><label class="ws-switch"><input id="wsAiEnabled" type="checkbox" ${state.aiEnabled ? 'checked' : ''}><span>AI 开关</span></label></div><button class="btn small primary ws-full-button" data-ws-action="analyze" ${!current || !state.messages.length || !state.aiEnabled || state.aiBusy ? 'disabled' : ''}>${state.aiBusy ? '分析中…' : '分析当前聊天'}</button><div class="ws-analysis-content">${renderAnalysis()}</div></section><section class="ws-card"><div class="ws-card-heading"><div><strong>客户资料</strong><span>确认后写入现有知客客户中心</span></div></div><div class="ws-customer-fields"><input id="wsCustomerName" placeholder="客户姓名" value="${esc(state.analysis?.contact?.name || current?.title || '')}"><input id="wsCustomerPhone" placeholder="电话（可选）" value="${esc(state.analysis?.contact?.phone || '')}"><input id="wsCustomerCountry" placeholder="国家/地区" value="${esc(state.analysis?.country || '')}"><input id="wsCustomerProduct" placeholder="产品兴趣" value="${esc(Array.isArray(state.analysis?.productInterest) ? state.analysis.productInterest.join('、') : state.analysis?.productInterest || '')}"><input id="wsCustomerBudget" placeholder="预算" value="${esc(state.analysis?.budget || '')}"><textarea id="wsCustomerNote" rows="3" placeholder="备注或 AI 摘要">${esc(state.analysis?.summary || '')}</textarea></div><button class="btn small ws-full-button" data-ws-action="save-customer" ${!current ? 'disabled' : ''}>保存到客户中心</button><div class="ws-customer-match" id="wsCustomerMatch"></div></section><section class="ws-card"><div class="ws-card-heading"><div><strong>跟进记录</strong><span>保存到现有任务中心</span></div></div><textarea id="wsFollowupNote" rows="3" placeholder="本次跟进结果"></textarea><label class="ws-follow-date">下次跟进 <input id="wsNextFollow" type="date"></label><button class="btn small ws-full-button" data-ws-action="save-followup" ${!current ? 'disabled' : ''}>保存跟进</button></section><section class="ws-card"><div class="ws-card-heading"><div><strong>回复建议</strong><span>默认只复制或预览，不自动发送</span></div></div><textarea id="wsReplyInput" rows="3" placeholder="输入想回复的内容"></textarea><div class="ws-reply-actions"><button class="btn small" data-ws-action="translate-reply" ${!current ? 'disabled' : ''}>翻译预览</button><button class="btn small primary" data-ws-action="copy-reply" ${!current ? 'disabled' : ''}>复制回复</button></div><div id="wsReplyPreview" class="ws-reply-preview"></div></section></aside></div></div>`;
    updateStatusDom();
    rendering = false;
    requestAnimationFrame(() => { if (state.active && host.state.view === 'ws-workbench') wsBridge('resize').catch(() => {}); });
  }
  async function saveSettings() {
    const current = activeConversation();
    if (!current) return;
    try {
      await api('/api/ws/settings?conversationId=' + encodeURIComponent(current.id), { method: 'PUT', body: JSON.stringify({ ...state.settings, aiEnabled: state.aiEnabled, status: state.wsStatus }) });
      state.translationStatus = state.settings.enabled ? '翻译已开启 · 可按方向关闭' : '翻译已关闭 · 手动翻译仍可用';
      updateStatusDom();
    } catch (error) { toast(error.message, 'x'); }
  }
  async function translateText(originalText, direction) {
    if (!String(originalText || '').trim()) throw new Error('原文为空，无法翻译。');
    if (!window.zhikeAI?.request || !window.zhikeAI?.status) throw new Error('当前没有可用的 AI 翻译服务。');
    const status = await window.zhikeAI.status().catch(() => ({ configured: false }));
    if (!status.configured) throw new Error('请先在 GPT 运营助手中配置 AI 服务；原文已保留。');
    const result = await window.zhikeAI.request({ assistantMode: 'general', analysisDepth: 'standard', input: '请把下面' + (direction === 'receive' ? '客户收到的' : '准备发送的') + '内容翻译成' + state.settings.targetLanguage + '。只返回译文，不要解释，不要添加引号，不要改变数字、网址或联系方式：\n' + String(originalText).slice(0, 12000), context: { feature: 'ws-translation', direction, targetLanguage: state.settings.targetLanguage } });
    const translated = String(result?.text || '').trim();
    if (!translated) throw new Error('翻译服务没有返回译文。');
    state.translationStatus = '翻译服务正常 · ' + (result.providerName || 'AI');
    return translated;
  }
  async function persistMessage(message) {
    const saved = await api('/api/ws/messages', { method: 'POST', body: JSON.stringify(message) });
    const index = state.messages.findIndex(item => String(item.id) === String(saved.id) || (message.externalId && item.externalId === message.externalId));
    if (index >= 0) state.messages[index] = saved; else state.messages.push(saved);
    state.messages = core.dedupeMessages(state.messages);
    return saved;
  }
  async function translateMessage(id) {
    const message = state.messages.find(item => String(item.id) === String(id));
    if (!message) return;
    state.translationBusy.add(String(id)); render();
    try {
      const translated = await translateText(message.originalText, message.direction);
      await persistMessage({ ...message, id: message.id, conversationId: message.conversationId, externalId: message.externalId, translatedText: translated, targetLanguage: state.settings.targetLanguage });
      toast('单条消息翻译已保存');
    } catch (error) { toast(error.message + ' 原文仍保留。', 'x'); }
    finally { state.translationBusy.delete(String(id)); render(); }
  }
  function splitVisibleText(value) {
    return String(value || '').split(/\r?\n/).map(item => item.trim()).filter(Boolean).slice(0, 80).map((item, index) => {
      let direction = state.captureDirection;
      const match = item.match(/^\[?\s*(我|me|you|客户|customer)\s*\]?[:：]\s*(.*)$/i);
      if (match) { direction = /我|me/i.test(match[1]) ? 'send' : 'receive'; item = match[2].trim(); }
      return { direction, text: item, index };
    }).filter(item => item.text);
  }
  async function importVisible() {
    const current = activeConversation();
    const input = $('#wsVisibleChat');
    if (!current) { toast('请先建立或选择本机会话。', 'x'); return; }
    const rows = splitVisibleText(input?.value);
    if (!rows.length) { toast('请先粘贴当前可见聊天文本。', 'x'); return; }
    input.value = '';
    let saved = 0, failed = 0;
    for (const row of rows) {
      const externalId = 'manual-' + stableHash(current.id + '|' + row.direction + '|' + row.text);
      let translatedText = '';
      if (core.shouldTranslate(state.settings, row.direction)) {
        try { translatedText = await translateText(row.text, row.direction); } catch (error) { failed += 1; state.translationStatus = error.message; }
      }
      try { await persistMessage({ conversationId: current.id, externalId, direction: row.direction, originalText: row.text, translatedText, targetLanguage: state.settings.targetLanguage, order: state.messages.length + row.index + 1, data: { source: 'user-paste' } }); saved += 1; } catch { failed += 1; }
    }
    const conversation = state.conversations.find(item => String(item.id) === String(current.id));
    if (conversation) { conversation.lastMessageText = rows.at(-1).text.slice(0, 4000); conversation.updatedAt = nowIso(); }
    render();
    toast('已保存 ' + saved + ' 条可见消息' + (failed ? '，' + failed + ' 条待重试' : ''), failed ? 'x' : 'check');
  }
  async function analyzeConversation() {
    const current = activeConversation();
    if (!current || !state.messages.length) { toast('请先建立会话并导入可见聊天。', 'x'); return; }
    if (!window.zhikeAI?.request) { toast('当前没有可用的 AI 服务，请先配置 GPT 运营助手。', 'x'); return; }
    state.aiBusy = true; render();
    try {
      const transcript = state.messages.slice(-40).map(item => (item.direction === 'send' ? '我' : '客户') + '：' + item.originalText).join('\n');
      const result = await window.zhikeAI.request({ assistantMode: 'operations', analysisDepth: 'standard', input: '只分析下面当前用户选择的 WS 会话文本。只返回一个 JSON 对象，不要 Markdown，不要编造未出现的资料。字段必须包含 summary、intent、intentScore、emotion、urgency、language、needs（数组）、productInterest（数组）、budget、contact（对象，含 name/phone/country）、tags（数组）、customerStage、nextStep、followupTime、replySuggestion、confidence（0 到 1）。\n' + transcript, context: { feature: 'ws-analysis', conversationId: current.id, title: current.title || '' } });
      state.analysis = core.parseAiResult(result?.text || '');
      state.analysis.providerName = result.providerName || '';
      state.analysis.model = result.model || '';
      await api('/api/ws/analyses', { method: 'POST', body: JSON.stringify({ conversationId: current.id, result: state.analysis, confidence: state.analysis.confidence, providerName: state.analysis.providerName, model: state.analysis.model }) });
      toast(state.analysis.lowConfidence ? '分析完成，但需要人工确认' : '当前聊天分析已保存', state.analysis.lowConfidence ? 'x' : 'check');
    } catch (error) { state.analysis = { summary: '', lowConfidence: true, error: error.message, warning: 'AI 判断置信度较低，请人工确认。' }; toast(error.message, 'x'); }
    finally { state.aiBusy = false; render(); }
  }
  function customerProfileFromForm(current) {
    const analysis = state.analysis || {};
    const contact = analysis.contact && typeof analysis.contact === 'object' ? analysis.contact : {};
    const host = getHost();
    return { wsExternalId: current.externalId, conversationId: current.id, phone: ($('#wsCustomerPhone')?.value || contact.phone || '').trim(), name: ($('#wsCustomerName')?.value || contact.name || current.title || '未命名客户').trim(), country: ($('#wsCustomerCountry')?.value || contact.country || analysis.country || '').trim(), productInterest: ($('#wsCustomerProduct')?.value || (Array.isArray(analysis.productInterest) ? analysis.productInterest.join('、') : analysis.productInterest || '')).trim(), budget: ($('#wsCustomerBudget')?.value || analysis.budget || '').trim(), note: ($('#wsCustomerNote')?.value || analysis.summary || '').trim(), language: analysis.language || '', intent: analysis.intent || '', intentScore: analysis.intentScore ?? '', emotion: analysis.emotion || '', aiSummary: analysis.summary || '', tags: Array.isArray(analysis.tags) ? analysis.tags : [], source: 'WhatsApp', channel: 'WhatsApp', assistant: '未分配' };
  }
  async function saveCustomer() {
    const current = activeConversation(), host = getHost();
    if (!current || !host) { toast('请先建立或选择本机会话。', 'x'); return; }
    const profile = customerProfileFromForm(current), match = core.matchCustomer(host.state.customers, profile);
    if (match.kind === 'ambiguous') {
      const target = $('#wsCustomerMatch');
      if (target) target.innerHTML = '<p class="ws-error-line">发现多个候选客户：' + match.candidates.map(item => esc(item.name || item.rawPhone || item.id)).join('、') + '。请先在客户中心确认合并。</p>';
      toast('无法确定唯一客户，未写入。', 'x');
      return;
    }
    let customer = match.customer, created = false;
    const before = customer ? JSON.parse(JSON.stringify(customer)) : null;
    if (!customer) {
      created = true;
      customer = { id: 'CWS-' + Date.now().toString(36) + '-' + stableHash(profile.wsExternalId), name: profile.name || '未命名客户', rawPhone: profile.phone, phone: core.normalizePhone(profile.phone), source: profile.source, channel: profile.channel, assistant: profile.assistant, status: '未进群', phase: '新客户', qualification: '待评估', hot: false, investor: false, group: '—', ticket: false, deposit: false, amount: 0, registered: new Date().toISOString().slice(0, 10), lastFollow: '', due: new Date().toISOString().slice(0, 10), note: '', deleted: false, touched: true };
      host.state.customers.unshift(customer);
    }
    Object.assign(customer, { name: profile.name || customer.name, rawPhone: profile.phone || customer.rawPhone || '', phone: core.normalizePhone(profile.phone || customer.phone || ''), wsExternalId: profile.wsExternalId, wsConversationId: profile.conversationId, country: profile.country, language: profile.language, productInterest: profile.productInterest, budget: profile.budget, intent: profile.intent, intentScore: profile.intentScore, emotion: profile.emotion, aiSummary: profile.aiSummary, tags: profile.tags, note: profile.note || customer.note || '', touched: true });
    host.persist();
    try {
      await host.flushStateWrites();
      await api('/api/ws/conversations', { method: 'POST', body: JSON.stringify({ id: current.id, externalId: current.externalId, title: current.title, customerId: customer.id, lastMessageText: current.lastMessageText || '' }) });
      current.customerId = customer.id;
      render();
      toast(created ? 'WS 客户已保存到客户中心' : '客户档案已更新');
    } catch (error) {
      if (created) host.state.customers = host.state.customers.filter(item => item !== customer); else Object.assign(customer, before);
      host.persist();
      toast('客户保存失败，原资料已恢复：' + error.message, 'x');
      render();
    }
  }
  async function saveFollowup() {
    const current = activeConversation(), host = getHost();
    if (!current || !host) { toast('请先建立会话。', 'x'); return; }
    const customer = host.state.customers.find(item => String(item.id) === String(current.customerId));
    if (!customer) { toast('请先确认并保存客户资料，再登记跟进。', 'x'); return; }
    const note = ($('#wsFollowupNote')?.value || '').trim();
    if (!note) { toast('请填写本次跟进结果。', 'x'); return; }
    const record = { id: 'FWS-' + Date.now().toString(36) + '-' + stableHash(note), customerId: customer.id, customer: customer.name, phone: customer.rawPhone || customer.phone || '', date: nowIso(), method: 'WhatsApp', registration: '', result: note, note, nextDate: $('#wsNextFollow')?.value || '' };
    const before = { followups: host.state.followups.slice(), lastFollow: customer.lastFollow, due: customer.due };
    host.state.followups.unshift(record);
    customer.lastFollow = record.date.slice(0, 10);
    customer.due = record.nextDate || customer.due;
    host.persist();
    try {
      await host.flushStateWrites();
      host.activity('WS 工作台登记跟进：' + customer.name);
      await host.flushStateWrites();
      $('#wsFollowupNote').value = '';
      toast('跟进记录已保存到任务中心');
    } catch (error) {
      host.state.followups = before.followups;
      customer.lastFollow = before.lastFollow;
      customer.due = before.due;
      host.persist();
      toast('跟进保存失败，原资料已恢复：' + error.message, 'x');
    }
    render();
  }
  async function translateReply() {
    const input = ($('#wsReplyInput')?.value || '').trim();
    if (!input) { toast('请先输入回复内容。', 'x'); return; }
    const preview = $('#wsReplyPreview');
    if (!preview) return;
    try {
      const translated = core.shouldTranslate(state.settings, 'send') ? await translateText(input, 'send') : input;
      preview.innerHTML = '<div class="ws-reply-warning">' + (core.isSensitiveReply(input) ? '此内容可能涉及敏感承诺，请人工确认后再复制。' : '发送前请人工确认译文。') + '</div><strong>译文预览</strong><p>' + esc(translated) + '</p>';
      preview.dataset.translated = translated;
    } catch (error) { preview.innerHTML = '<p class="ws-error-line">' + esc(error.message) + ' 原文可继续使用。</p>'; toast(error.message, 'x'); }
  }
  async function copyReply() {
    const input = ($('#wsReplyInput')?.value || '').trim();
    if (!input) { toast('请先输入回复内容。', 'x'); return; }
    await translateReply();
    const preview = $('#wsReplyPreview'), translated = preview?.dataset.translated || input;
    if (core.isSensitiveReply(input) && !confirm('内容可能涉及付款、退款、密码、验证、金融、法律、医疗、价格或交付承诺。确认只复制到剪贴板，不自动发送？')) return;
    try {
      if (!window.zhikeDesktop?.tools) throw new Error('当前环境没有本机剪贴板能力。');
      await window.zhikeDesktop.tools({ action: 'copy', text: translated });
      const current = activeConversation();
      if (current) await api('/api/ws/replies', { method: 'POST', body: JSON.stringify({ conversationId: current.id, originalText: input, translatedText: translated, status: 'copied' }) });
      toast('回复已复制到剪贴板，请回到 WS 页面人工发送。');
    } catch (error) { toast(error.message, 'x'); }
  }
  async function handleAction(action, element) {
    if (action === 'open' || action === 'login' || action === 'reload' || action === 'reconnect' || action === 'close' || action === 'clear-session') return openWs(action === 'open' ? 'open' : action === 'login' ? 'login' : action === 'reload' ? 'reload' : action === 'reconnect' ? 'reconnect' : action);
    if (action === 'mark-connected' || action === 'mark-expired' || action === 'mark-reconnecting') {
      try { const result = await wsBridge(action); setStatus(result.status); } catch (error) { toast(error.message, 'x'); }
      return;
    }
    if (action === 'toggle-left') { state.leftCollapsed = !state.leftCollapsed; render(); return; }
    if (action === 'toggle-right') { state.rightCollapsed = !state.rightCollapsed; render(); return; }
    if (action === 'new-conversation') { $('#wsConversationExternalId')?.focus(); return; }
    if (action === 'create-conversation') return createConversation();
    if (action === 'select-conversation') return loadConversationData(element.dataset.id);
    if (action === 'clear-capture') { if ($('#wsVisibleChat')) $('#wsVisibleChat').value = ''; return; }
    if (action === 'import-visible') return importVisible();
    if (action === 'translate-message') return translateMessage(element.dataset.id);
    if (action === 'analyze') return analyzeConversation();
    if (action === 'save-customer') return saveCustomer();
    if (action === 'save-followup') return saveFollowup();
    if (action === 'translate-reply') return translateReply();
    if (action === 'copy-reply') return copyReply();
  }
  function applyControlChange(target) {
    if (target.matches('#wsCaptureDirection')) { state.captureDirection = target.value === 'send' ? 'send' : 'receive'; return; }
    if (target.matches('#wsTranslateEnabled')) state.settings.enabled = target.checked;
    if (target.matches('#wsReceiveEnabled')) state.settings.receive = target.checked;
    if (target.matches('#wsSendEnabled')) state.settings.send = target.checked;
    if (target.matches('#wsShowOriginal')) state.settings.showOriginal = target.checked;
    if (target.matches('#wsTargetLanguage')) state.settings.targetLanguage = target.value;
    if (target.matches('#wsAiEnabled')) state.aiEnabled = target.checked;
    if (target.matches('#wsTranslateEnabled, #wsReceiveEnabled, #wsSendEnabled, #wsShowOriginal, #wsTargetLanguage, #wsAiEnabled')) {
      state.settings = core.normalizeTranslationSettings(state.settings);
      state.translationStatus = state.settings.enabled ? '翻译已开启 · 可按方向关闭' : '翻译已关闭 · 手动翻译仍可用';
      saveSettings();
      render();
    }
  }
  function activate() {
    const host = getHost();
    if (!host) return;
    state.active = true;
    host.state.view = 'ws-workbench';
    state.error = '';
    $('#crumbCurrent').textContent = 'WS 工作台';
    $$('.nav-item').forEach(item => item.classList.toggle('active', item.dataset.view === 'ws-workbench'));
    document.body.classList.add('ws-mode');
    render();
    loadConversations().then(render);
    wsBridge('status').then(result => setStatus(result.status)).catch(() => {});
  }
  function deactivate() {
    if (!state.active) return;
    state.active = false;
    document.body.classList.remove('ws-mode');
    wsBridge('close').catch(() => {});
  }
  async function exportWsData() { return api('/api/ws/export'); }
  async function importWsData(value) { if (!value || typeof value !== 'object') return { skipped: true }; return api('/api/ws/import', { method: 'POST', body: JSON.stringify(value) }); }
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
      handleAction(element.dataset.wsAction, element);
    }, true);
    view?.addEventListener('change', event => {
      if (event.target.closest('.ws-workbench-page')) {
        event.stopImmediatePropagation();
        applyControlChange(event.target);
      }
    }, true);
    window.zhikeDesktop?.onWsStatus?.(payload => { if (payload) setStatus(payload.status || '未连接', payload.detail || ''); });
    window.addEventListener('resize', () => { if (state.active) wsBridge('resize').catch(() => {}); });
    observer = new MutationObserver(() => { if (!rendering && state.active && host.state.view === 'ws-workbench' && !$('#viewContainer .ws-workbench-page')) render(); });
    observer.observe(view, { childList: true });
  }
  boot();
})();

