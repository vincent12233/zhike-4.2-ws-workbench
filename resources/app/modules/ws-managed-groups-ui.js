(() => {
  'use strict';
  // V9.2 dedicated WS · 群组管理. Only channel, group name and group alias are
  // entered here. The page never asks for an assistant or a JID, never infers a
  // channel from an alias prefix, and never turns a name suggestion into a
  // binding.
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const text = value => String(value == null ? '' : value).trim();
  const STATUS = { unmatched: '未匹配', suggested: '有候选待确认', confirmed: '已确认身份' };
  const timeText = value => { const ms = Date.parse(text(value)); return Number.isFinite(ms) ? new Date(ms).toLocaleString('zh-CN', { hour12: false }) : '—'; };
  const DEFAULT_CHANNELS = ['FB群粉', 'API群粉', '短信群粉', '单导K', '单导B'];

  function create({ getScope, request, redraw, toast, getCustomers }) {
    let page = null;
    const owns = () => page && getScope();
    function ensure() {
      if (!getScope()) return null;
      if (!page) page = { rows: [], channels: DEFAULT_CHANNELS.slice(), query: '', editing: '', importText: '', preview: null, candidates: [], busy: false, message: '', error: '' };
      return page;
    }
    async function load() {
      const state = ensure(); if (!state) return false;
      state.busy = true; state.error = '';
      try {
        const response = await request('/api/ws/managed-groups?includeDisabled=1&query=' + encodeURIComponent(state.query));
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(body.error || `读取群组失败（${response.status}）`);
        state.rows = Array.isArray(body.groups) ? body.groups : [];
        if (Array.isArray(body.channels) && body.channels.length) state.channels = [...new Set([...DEFAULT_CHANNELS, ...body.channels])];
        return true;
      } catch (error) { state.error = error.message || '本机服务不可用。'; return false; }
      finally { state.busy = false; if (owns()) redraw(); }
    }
    async function send(pathname, init) {
      const state = ensure(); if (!state) return null;
      state.busy = true; state.error = ''; state.message = '';
      try {
        const response = await request(pathname, init);
        const body = await response.json().catch(() => ({}));
        if (!response.ok) { state.error = body.error || `操作失败（${response.status}）`; return null; }
        return body;
      } catch (error) { state.error = error.message || '本机服务不可用。'; return null; }
      finally { state.busy = false; }
    }
    async function save(form) {
      const state = ensure(); if (!state) return;
      const payload = { channel: text(form.channel), groupName: text(form.groupName), groupAlias: text(form.groupAlias) };
      if (!payload.channel) { state.error = '请选择渠道。'; redraw(); return; }
      if (!payload.groupName || !payload.groupAlias) { state.error = '群名和群别名都不能为空。'; redraw(); return; }
      const body = await send(state.editing ? '/api/ws/managed-groups/' + encodeURIComponent(state.editing) : '/api/ws/managed-groups', { method: state.editing ? 'PATCH' : 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
      if (body) { state.message = state.editing ? '已保存修改。' : '已新增群组。'; state.editing = ''; state.preview = null; }
      await load();
    }
    async function toggle(id, enabled) {
      const body = await send('/api/ws/managed-groups/' + encodeURIComponent(id), { method: enabled ? 'PATCH' : 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ enabled }) });
      if (body) { const state = ensure(); state.message = enabled ? '已启用。' : '已停用，历史客户关联保留。'; }
      await load();
    }
    async function previewImport() {
      const state = ensure(); if (!state) return;
      const rows = state.importText.split('\n').map(line => line.trim()).filter(Boolean).map(line => {
        const cells = line.includes('\t') ? line.split('\t') : line.split(',').map(cell => cell.trim());
        return { channel: text(cells[0]), groupName: text(cells[1]), groupAlias: text(cells[2]) };
      });
      if (!rows.length) { state.error = '请先粘贴或选择 CSV 内容。'; redraw(); return; }
      const body = await send('/api/ws/managed-groups/import', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ rows, dryRun: true }) });
      if (body) { state.preview = body; state.message = `可新增 ${body.accepted.length} 行，需处理 ${body.rejected.length} 行。`; }
      redraw();
    }
    async function commitImport() {
      const state = ensure(); if (!state?.preview) { if (state) { state.error = '请先预览导入结果。'; redraw(); } return; }
      const rows = state.importText.split('\n').map(line => line.trim()).filter(Boolean).map(line => {
        const cells = line.includes('\t') ? line.split('\t') : line.split(',').map(cell => cell.trim());
        return { channel: text(cells[0]), groupName: text(cells[1]), groupAlias: text(cells[2]) };
      });
      const body = await send('/api/ws/managed-groups/import', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ rows, dryRun: false }) });
      if (body) { state.message = `已导入 ${body.created} 个群组。`; state.preview = null; state.importText = ''; }
      await load();
    }
    async function loadCandidates() {
      const state = ensure(); if (!state) return;
      const body = await send('/api/ws/managed-groups/match/candidates', { method: 'GET' });
      if (body) { state.candidates = Array.isArray(body.suggestions) ? body.suggestions : []; state.message = '候选仅作建议，需人工确认。'; }
      redraw();
    }
    async function confirmMatch(id, jid) {
      const state = ensure(); if (!state) return;
      const body = await send('/api/ws/managed-groups/match/confirm', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id, jid }) });
      if (body) state.message = '已确认绑定。';
      await load();
    }
    async function unbind(id) {
      const state = ensure(); if (!state) return;
      const body = await send('/api/ws/managed-groups/match/unbind', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id }) });
      if (body) state.message = '已解除绑定。';
      await load();
    }
    function render() {
      const state = ensure();
      if (!state) return '<section class="ws-workspace-card zk-surface"><p class="ws-muted">请先打开专用 WS 并选择账号。</p></section>';
      // V9.2: channel statistics come from each group's configured channel,
      // never from the alias prefix or the customer source text.
      const registered = (typeof getCustomers === 'function' ? getCustomers() : []).filter(customer => customer && !customer.deleted && customer.groupId);
      const perGroup = new Map();
      for (const customer of registered) {
        if (!perGroup.has(customer.groupId)) perGroup.set(customer.groupId, new Set());
        perGroup.get(customer.groupId).add(String(customer.id));
      }
      const channelStats = new Map();
      for (const row of state.rows) {
        const ids = perGroup.get(row.id) || new Set();
        const stat = channelStats.get(row.channel) || { groups: 0, enabled: 0, registrations: 0, customers: new Set() };
        stat.groups += 1;
        if (row.enabled) stat.enabled += 1;
        stat.registrations += ids.size;
        for (const id of ids) stat.customers.add(id);
        channelStats.set(row.channel, stat);
      }
      const statsRows = [...channelStats.entries()].map(([channel, stat]) => `<tr><td>${esc(channel)}</td><td>${stat.enabled} / ${stat.groups}</td><td>${stat.registrations}</td><td>${stat.customers.size}</td></tr>`).join('');
      const statsHtml = `<details class="mg-stats" open><summary>群组渠道统计</summary><p class="ws-muted">登记关系按客户与群组的登记计算；去重客户按客户 ID 去重。这里不是 WhatsApp 实际在群人数。</p><div class="table-scroll"><table class="data-table"><thead><tr><th>渠道</th><th>启用 / 群组</th><th>登记关系</th><th>去重客户</th></tr></thead><tbody>${statsRows || '<tr><td colspan="4">暂无登记群组。</td></tr>'}</tbody></table></div></details>`;
      const editing = state.rows.find(row => row.id === state.editing);
      const channelOptions = [...new Set([...state.channels, editing?.channel].filter(Boolean))].map(channel => `<option value="${esc(channel)}" ${editing?.channel === channel ? 'selected' : ''}>${esc(channel)}</option>`).join('');
      const rows = state.rows.map(row => `<tr>
        <td>${esc(row.channel)}</td><td>${esc(row.groupName)}</td><td><strong>${esc(row.groupAlias)}</strong></td>
        <td>${esc(STATUS[row.matchStatus] || row.matchStatus)}</td><td>${esc(timeText(row.lastCollectedAt))}</td>
        <td>${row.enabled ? '' : '<span class="status-tag tag-gray">已停用</span> '}
          <button type="button" class="btn small" data-mg="edit" data-id="${esc(row.id)}">编辑</button>
          <button type="button" class="btn small" data-mg="toggle" data-id="${esc(row.id)}" data-enabled="${row.enabled ? 'false' : 'true'}">${row.enabled ? '停用' : '启用'}</button>
        </td></tr>`).join('');
      const rejected = (state.preview?.rejected || []).map(item => `<li>第 ${item.row} 行：${esc(item.errors?.[0]?.message || '需人工确认')}${item.skipped ? '（跳过）' : ''}</li>`).join('');
      const candidates = state.candidates.map(item => `<li>${esc(item.group?.groupAlias || '')} · ${esc(STATUS[item.status] || item.status)}${item.status === 'ambiguous' ? ' · 多个同名候选' : ''}${item.group?.jid ? ` · 已绑定 ${esc(item.group.jid)}` : ' · 待核验'}
        ${item.group?.jid ? `<button type="button" class="btn small" data-mg="unbind" data-id="${esc(item.groupId)}">解除绑定</button>` : ''}</li>`).join('');
      return `<section class="ws-workspace-card zk-surface" id="managedGroupsPage" data-managed-groups>
        <div class="ws-card-heading"><div><strong>群组管理</strong><span>渠道、群名、群别名由人工维护；群别名用于客户登记匹配，不冒充 WhatsApp 身份。</span></div></div>
        ${state.error ? `<p class="ws-error-line" role="alert">${esc(state.error)}</p>` : ''}
        ${state.message ? `<p class="ws-muted" role="status">${esc(state.message)}</p>` : ''}
        <form class="mg-form" data-mg-form>
          <label>渠道<select name="channel" required>${channelOptions}</select></label>
          <label>群名<input name="groupName" maxlength="200" required value="${esc(editing?.groupName || '')}" placeholder="WhatsApp 中显示的群名称"></label>
          <label>群别名<input name="groupAlias" maxlength="64" required value="${esc(editing?.groupAlias || '')}" placeholder="例如 A-501"></label>
          <button type="submit" class="btn primary" ${state.busy ? 'disabled' : ''}>${editing ? '保存修改' : '新增群组'}</button>
          ${editing ? '<button type="button" class="btn small" data-mg="cancel">取消编辑</button>' : ''}
        </form>
        <div class="mg-search"><input data-mg-query type="search" maxlength="120" value="${esc(state.query)}" placeholder="搜索群别名、群名或渠道"><button type="button" class="btn small" data-mg="search">搜索</button><button type="button" class="btn small" data-mg="candidates">AI 候选</button></div>
        <div class="table-scroll"><table class="data-table"><thead><tr><th>渠道</th><th>群名</th><th>群别名</th><th>匹配状态</th><th>最后采集</th><th>操作</th></tr></thead><tbody>${rows || '<tr><td colspan="6"><div class="empty-state"><strong>还没有登记群组</strong><p>填写渠道、群名和群别名即可新增，不需要 WhatsApp JID。</p></div></td></tr>'}</tbody></table></div>
        ${statsHtml}
        <details class="mg-import"><summary>批量导入（先预览，再提交）</summary>
          <textarea data-mg-import rows="6" placeholder="每行：渠道,群名,群别名"></textarea>
          <div class="mg-import-actions"><button type="button" class="btn small" data-mg="preview">预览导入</button><button type="button" class="btn small primary" data-mg="commit" ${state.preview ? '' : 'disabled'}>确认提交</button></div>
          ${rejected ? `<ul class="mg-rejected">${rejected}</ul>` : ''}
        </details>
        ${candidates ? `<div class="mg-candidates"><strong>AI 候选（仅建议）</strong><ul>${candidates}</ul></div>` : ''}
      </section>`;
    }
    function bind() {
      setTimeout(() => {
        const root = document.querySelector('[data-managed-groups]');
        if (!root || root.dataset.bound === '1') return;
        root.dataset.bound = '1';
        const state = ensure();
        root.querySelector('[data-mg-form]')?.addEventListener('submit', event => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          void save({ channel: form.get('channel'), groupName: form.get('groupName'), groupAlias: form.get('groupAlias') });
        });
        root.querySelector('[data-mg-import]')?.addEventListener('input', event => { if (state) state.importText = event.currentTarget.value; });
        root.querySelector('[data-mg-query]')?.addEventListener('change', event => { if (state) { state.query = event.currentTarget.value; void load(); } });
        root.addEventListener('click', event => {
          const trigger = event.target.closest('[data-mg]');
          const action = trigger?.dataset.mg;
          if (!action) return;
          if (action === 'search') { if (state) { state.query = root.querySelector('[data-mg-query]')?.value || ''; void load(); } }
          else if (action === 'edit') { if (state) { state.editing = trigger.dataset.id; state.error = ''; redraw(); } }
          else if (action === 'cancel') { if (state) { state.editing = ''; redraw(); } }
          else if (action === 'toggle') { void toggle(trigger.dataset.id, trigger.dataset.enabled === 'true'); }
          else if (action === 'preview') { if (state) state.importText = root.querySelector('[data-mg-import]')?.value || state.importText; void previewImport(); }
          else if (action === 'commit') { void commitImport(); }
          else if (action === 'candidates') { void loadCandidates(); }
          else if (action === 'unbind') { void unbind(trigger.dataset.id); }
          else if (action === 'confirm' && trigger.dataset.jid) { void confirmMatch(trigger.dataset.id, trigger.dataset.jid); }
        });
      }, 0);
    }
    return { load, render, bind, reset: () => { page = null; } };
  }
  window.ZhikeWsManagedGroups = { create };
})();
