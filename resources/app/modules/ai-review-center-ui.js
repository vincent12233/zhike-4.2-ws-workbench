'use strict';

// Reviews remain read-only without an explicit isolated writer lease.
(function attachAiReviewCenter(root) {
  if (!root?.document) return;
  const text = value => String(value ?? '');
  const esc = value => text(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const state = { host: null, accountId: '', loading: false, busy: false, error: '', data: null, detail: null, controller: null, generation: 0, views: new Map() };
  const host = () => root.document.querySelector('[data-ws-workspace-page="ai"],[data-ws-workspace-page="crm"]');
  const currentAccount = () => text(host()?.dataset?.wsAccountId || 'default');
  function view() { const key = currentAccount(); if (!state.views.has(key)) state.views.set(key, { query: '', status: '', page: 1 }); return state.views.get(key); }
  function filtered(rows) { const current = view(), query = current.query.trim().toLocaleLowerCase(); return rows.filter(row => (!current.status || (row.verificationStatus || row.status) === current.status) && (!query || JSON.stringify(row).toLocaleLowerCase().includes(query))); }
  const scope = pathname => pathname + (pathname.includes('?') ? '&' : '?') + 'accountId=' + encodeURIComponent(currentAccount());
  async function api(pathname, init = {}, signal) {
    const response = await root.fetch(scope(pathname), { cache: 'no-store', ...init, signal, headers: { 'Content-Type': 'application/json', ...(init.headers || {}) } });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) { const error = new Error(body.error || body.message || 'AI 审核中心暂不可用。'); error.status = response.status; error.code = body.code || body.errorCode || ''; throw error; }
    return body;
  }
  const label = status => ({ pending: '待处理', queued: '已排队', running: '处理中', completed: '已完成', failed: '失败', cancelled: '已取消', retry_scheduled: '待重试', retryable: '待重试', applied: '已补全', rejected: '已拒绝', conflict: '资料冲突' })[status] || status || '未知';
  function render() {
    const target = host();
    if (!target) return;
    let panel = root.document.querySelector('#stage4AiReviewCenter');
    if (!panel) { panel = root.document.createElement('section'); panel.id = 'stage4AiReviewCenter'; panel.className = 'ws-workspace-card stage4-ai-review-center'; target.appendChild(panel); }
    const current = view(), allJobs = filtered(state.data?.jobs || []), allSuggestions = filtered(state.data?.suggestions || []);
    const pageCount = Math.max(1, Math.ceil(Math.max(allJobs.length, allSuggestions.length) / 25)); current.page = Math.min(current.page, pageCount);
    const offset = (current.page - 1) * 25, jobs = allJobs.slice(offset, offset + 25), suggestions = allSuggestions.slice(offset, offset + 25);
    const enabled = Boolean(state.data);
    const writable = enabled && Boolean(root.__stage4AiLease) && !state.busy;
    const disabled = condition => condition ? ' disabled' : '';
    const jobRows = jobs.length ? jobs.map(job => '<div class="stage4-ai-row"><span><strong>' + esc(job.jobType || job.id) + '</strong><small>' + esc(job.customerId || job.conversationId || job.groupJid || '未关联客户') + ' · ' + esc(job.updatedAt || job.createdAt || '') + '</small><small>' + esc(job.lastError || '') + '</small></span><span class="stage4-ai-actions"><em>' + esc(label(job.status)) + '</em><button class="btn small" data-stage4-action="detail" data-job-id="' + esc(job.id) + '">详情</button>' + (['failed','cancelled'].includes(job.status) ? '<button class="btn small" data-stage4-action="retry-job" data-job-id="' + esc(job.id) + '"' + disabled(!writable) + '>重试</button>' : '<button class="btn small" data-stage4-action="cancel-job" data-job-id="' + esc(job.id) + '"' + disabled(!writable || !['pending','queued','retry_scheduled'].includes(job.status)) + ' title="运行中任务需由持有任务租约的 Worker 取消">取消</button>') + '</span></div>').join('') : '<p class="ws-muted">暂无 AI 任务。</p>';
    const rows = suggestions.length ? suggestions.map(item => '<div class="stage4-ai-row" data-suggestion-id="' + esc(item.id) + '"><span><strong>' + esc(item.fieldName) + '：' + esc(typeof item.candidateValue === 'object' ? JSON.stringify(item.candidateValue) : item.candidateValue) + '</strong><small>' + esc(item.sourceEvidence || '没有来源证据') + ' · ' + esc(item.customerId) + '</small><small>现有值：' + esc(JSON.stringify(item.existingValue ?? null)) + ' · 实际写入：' + esc(JSON.stringify(item.appliedValue ?? null)) + '</small></span><span class="stage4-ai-actions"><em>' + esc(label(item.verificationStatus)) + '</em><button type="button" class="btn small" data-stage4-action="approve" data-suggestion-id="' + esc(item.id) + '"' + disabled(!writable || item.verificationStatus !== 'pending') + '>批准</button><button type="button" class="btn small" data-stage4-action="reject" data-suggestion-id="' + esc(item.id) + '"' + disabled(!writable || item.verificationStatus !== 'pending') + '>拒绝</button></span></div>').join('') : '<p class="ws-muted">暂无资料候选。</p>';
    panel.innerHTML = '<div class="ws-card-heading"><div><strong>AI 队列与 CRM 审核中心' + (enabled ? '' : ' · FROZEN') + '</strong><span>来源证据、字段差异与审核结果</span></div><button type="button" class="btn small" data-stage4-action="refresh"' + disabled(state.loading || state.busy) + '>刷新</button></div><p aria-live="polite">' + (state.loading ? '正在加载…' : enabled ? '隔离验证 · 账号 ' + esc(state.accountId) : '未启用') + '</p>' + (state.error ? '<p class="ws-error-line" role="alert">' + esc(state.error) + '</p>' : '') + '<div class="stage4-ai-section"><h3>AI 任务</h3>' + jobRows + '</div><div class="stage4-ai-section"><h3>CRM 候选审核</h3>' + rows + '</div>' + (!enabled ? '<p class="ws-muted">生产入口保持 FROZEN。</p>' : '');
    panel.innerHTML += '<div class="stage4-ai-actions"><input aria-label="搜索已加载的 AI 任务和候选资料" data-stage4-filter="query" value="' + esc(current.query) + '" placeholder="搜索已加载记录，回车应用"><select aria-label="AI 与审核状态" data-stage4-filter="status"><option value="">全部状态</option>' + ['pending','queued','running','completed','failed','cancelled','retry_scheduled','applied','rejected','conflict'].map(status => '<option value="' + status + '"' + (current.status === status ? ' selected' : '') + '>' + esc(label(status)) + '</option>').join('') + '</select><button class="btn small" data-stage4-action="previous"' + disabled(current.page <= 1) + '>上一页</button><span>第 ' + current.page + ' / ' + pageCount + ' 页 · 已加载范围：任务 ' + allJobs.length + '，候选 ' + allSuggestions.length + '</span><button class="btn small" data-stage4-action="next"' + disabled(current.page >= pageCount) + '>下一页</button></div>';
    if (state.detail) panel.innerHTML += '<details open><summary>任务详情 · 来源证据与审计</summary><pre>' + esc(JSON.stringify(state.detail, null, 2)) + '</pre></details>';
  }
  async function refresh() {
    if (!host() || state.busy) return;
    const accountId = currentAccount(), generation = ++state.generation;
    state.controller?.abort();
    const controller = new AbortController(); state.controller = controller;
    const timer = root.setTimeout(() => controller.abort(), 10000);
    state.accountId = accountId; state.loading = true; state.error = ''; state.data = null; state.detail = null; render();
    try {
      const jobs = await api('/api/ws/ai-pipeline/jobs?limit=50', {}, controller.signal);
      const suggestions = await api('/api/ws/ai-pipeline/suggestions?limit=50', {}, controller.signal);
      if (generation === state.generation && currentAccount() === accountId) state.data = { ...jobs, suggestions: suggestions.suggestions || [] };
    } catch (error) {
      if (generation === state.generation) state.error = error.status === 404 || error.code === 'AI_PIPELINE_DISABLED' ? '生产 AI 队列仍处于 FROZEN，隔离审核中心未启用。' : (error.name === 'AbortError' ? '读取超时或页面已切换，请重试。' : error.message);
    } finally { root.clearTimeout(timer); if (generation === state.generation) { state.loading = false; render(); } }
  }
  async function action(event) {
    const button = event.target.closest('[data-stage4-action]');
    if (!button || button.disabled) return;
    const actionName = button.dataset.stage4Action;
    if (actionName === 'previous' || actionName === 'next') { view().page = Math.max(1, view().page + (actionName === 'next' ? 1 : -1)); render(); return; }
    if (actionName === 'refresh') return refresh();
    const lease = root.__stage4AiLease, accountId = currentAccount();
    if (['detail', 'cancel-job', 'retry-job'].includes(actionName) && button.dataset.jobId) {
      if (state.busy || (actionName !== 'detail' && !lease)) return;
      state.busy = true; const controller = new AbortController(), timer = root.setTimeout(() => controller.abort(), 10000);
      try {
        const result = await api(actionName === 'detail' ? '/api/ws/ai-pipeline/jobs/' + encodeURIComponent(button.dataset.jobId) : '/api/ws/ai-pipeline/jobs', actionName === 'detail' ? {} : { method: 'POST', body: JSON.stringify({ action: actionName === 'cancel-job' ? 'cancel' : 'retry', accountId, jobId: button.dataset.jobId, lease, actor: 'operator' }) }, controller.signal);
        if (currentAccount() === accountId && actionName === 'detail') state.detail = result;
      } catch (error) { if (currentAccount() === accountId) state.error = error.message; }
      finally { root.clearTimeout(timer); state.busy = false; }
      if (actionName !== 'detail' && !state.error) await refresh(); else render();
      return;
    }
    if (state.busy || !state.data || !lease || !['approve', 'reject'].includes(actionName) || !button.dataset.suggestionId) return;
    state.busy = true; state.error = ''; render();
    const controller = new AbortController(), timer = root.setTimeout(() => controller.abort(), 10000);
    try {
      const version = root.__zhikeRegistryHost?.getStateVersion?.();
      await api('/api/ws/ai-pipeline/suggestions/' + encodeURIComponent(button.dataset.suggestionId) + '/' + actionName, {
        method: 'POST', headers: version == null ? {} : { 'X-State-Version': String(version) },
        body: JSON.stringify({ action: actionName, suggestionId: button.dataset.suggestionId, accountId, lease, actor: 'operator', reason: actionName === 'reject' ? '人工拒绝' : '人工批准' }),
      }, controller.signal);
      await root.__zhikeRegistryHost?.refreshState?.();
    } catch (error) { if (currentAccount() === accountId) state.error = error.message || '审核操作失败。'; }
    finally { root.clearTimeout(timer); state.busy = false; }
    if (!state.error) await refresh(); else render();
  }
  function filter(event) { const field = event.target?.dataset?.stage4Filter; if (!['query', 'status'].includes(field)) return; view()[field] = text(event.target.value); view().page = 1; render(); }
  function mount() {
    const target = host();
    if (state.host === target && state.accountId === currentAccount()) return;
    state.host?.removeEventListener('click', action);
    state.host?.removeEventListener('change', filter);
    state.host = target; state.controller?.abort(); state.generation++;
    if (!target) return;
    target.addEventListener('click', action); target.addEventListener('change', filter); state.accountId = currentAccount(); state.data = null;
    render(); void refresh();
  }
  const observer = new MutationObserver(mount);
  root.addEventListener('DOMContentLoaded', mount, { once: true });
  observer.observe(root.document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-ws-account-id'] });
  root.ZhikeAiReviewCenter = Object.freeze({ mount, refresh, render });
  mount();
})(typeof globalThis !== 'undefined' ? globalThis : this);
