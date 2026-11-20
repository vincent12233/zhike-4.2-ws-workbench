(() => {
  'use strict';
  const base = '/api/ws/group-manager/';
  const pageSize = 25;
  const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[char]);

  function create({ request, getScope, redraw, download }) {
    let current = null;
    const matches = (state, scope) => Boolean(state && scope && state.scope.accountId === scope.accountId &&
      state.scope.groupJid === scope.groupJid && state.scope.sequence === scope.sequence && state.scope.view === scope.view);
    const owns = state => current === state && matches(state, getScope());
    const discardStale = () => { if (current && !matches(current, getScope())) current = null; };
    const reset = () => { current = null; };

    function pathname(state, suffix, parameters = {}) {
      const { accountId, groupJid } = state.scope;
      return base + suffix + '?' + new URLSearchParams({ accountId, groupJid, ...parameters });
    }

    async function open() {
      reset();
      const scope = getScope();
      if (!scope) return;
      const state = { scope, enabled: false, busy: true, messages: [], messageId: '', error: '', report: null, offset: 0, filters: { from: '', to: '', search: '' } };
      current = state;
      try {
        const capability = await request(pathname(state, 'customer-reading/capability'), scope);
        if (!owns(state) || capability.localObservation !== true || capability.accountId !== scope.accountId || capability.groupJid !== scope.groupJid) return;
        state.enabled = true;
        redraw();
        const result = await request(pathname(state, 'messages', { limit: '200' }), scope);
        if (!owns(state)) return;
        if (result.accountId !== scope.accountId || result.groupJid !== scope.groupJid || !Array.isArray(result.messages)) {
          throw new Error('本地消息列表不属于当前账号和群组。');
        }
        state.messages = result.messages.filter(row => row?.accountId === scope.accountId && row.groupJid === scope.groupJid &&
          typeof row.messageId === 'string' && row.messageId).map(row => ({ id: row.messageId, sentAt: row.sentAt, type: row.type,
            sender: String(row.senderJid || row.senderPhone || '') }));
      } catch (error) {
        if (owns(state) && (state.enabled || scope.view === 'group-reading')) {
          state.enabled = true;
          state.error = error?.message || '本地消息加载失败。';
        }
      } finally {
        if (owns(state)) { state.busy = false; if (state.enabled) redraw(); }
      }
    }

    function filteredMessages(state) {
      const { from, to, search } = state.filters;
      if (from && to && from > to) return [];
      return state.messages.filter(row => {
        const stamp = Date.parse(row.sentAt), day = Number.isFinite(stamp) ? new Date(stamp).toISOString().slice(0, 10) : '';
        return (!from || day && day >= from) && (!to || day && day <= to) &&
          (!search || [row.id, row.type, row.sender].join(' ').toLocaleLowerCase().includes(search.toLocaleLowerCase()));
      });
    }

    function filter(name, value) {
      const state = current;
      if (!owns(state) || !state.enabled || state.busy || !['from', 'to', 'search'].includes(name)) return;
      value = String(value || '').trim().slice(0, name === 'search' ? 200 : 10);
      if (name !== 'search' && value && (!/^\d{4}-\d{2}-\d{2}$/.test(value) ||
          !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value)) return;
      state.filters[name] = value;
      state.messageId = ''; state.report = null; state.offset = 0;
      state.error = state.filters.from && state.filters.to && state.filters.from > state.filters.to ? '起始日期不能晚于结束日期。' : '';
      redraw();
    }

    function select(messageId) {
      const state = current;
      if (!owns(state) || !state.enabled || state.busy || state.messageId === messageId) return;
      state.messageId = filteredMessages(state).some(row => row.id === messageId) ? messageId : '';
      state.report = null;
      state.offset = 0;
      state.error = '';
      redraw();
    }

    async function run(action) {
      const state = current;
      if (!owns(state) || !state.enabled || state.busy || !state.messageId) return;
      const exporting = action === 'export';
      if (action !== 'query' && !state.report) return;
      const offset = action === 'next' ? state.report.nextOffset : action === 'previous' ? Math.max(0, state.offset - pageSize) : 0;
      if (offset == null || !['query', 'next', 'previous', 'export'].includes(action)) return;
      const scope = state.scope;
      const messageId = state.messageId;
      const suffix = exporting ? 'customer-reading/export' : 'customer-reading';
      const parameters = exporting ? { messageId } : { messageId, offset: String(offset), limit: String(pageSize) };
      state.busy = true;
      state.error = '';
      redraw();
      try {
        const result = await request(pathname(state, suffix, parameters), scope);
        if (!owns(state) || state.messageId !== messageId) return;
        const belongs = row => row?.accountId === scope.accountId && row.groupJid === scope.groupJid && row.messageId === messageId;
        if (exporting) {
          if (!belongs(result) || typeof result.csv !== 'string' || !Number.isSafeInteger(result.rowCount)) throw new Error('导出响应无效。');
          download(result.csv);
        } else {
          const message = result.messages?.[0];
          if (result.messages?.length !== 1 || !belongs(message) || !Array.isArray(result.rows) || !result.rows.every(belongs)) {
            throw new Error('本地阅读观测不属于当前消息。');
          }
          state.report = result;
          state.offset = offset;
        }
      } catch (error) {
        if (owns(state)) {
          state.error = error?.message || (exporting ? 'CSV 导出失败。' : '本地阅读观测查询失败。');
          if (!exporting) state.report = null;
        }
      } finally {
        if (owns(state)) { state.busy = false; redraw(); }
      }
    }

    function render() {
      const state = current;
      if (!owns(state) || !state.enabled) return '';
      const report = state.report;
      const summary = report?.messages?.[0];
      const visibleMessages = filteredMessages(state);
      const options = visibleMessages.map(row => `<option value="${escape(row.id)}"${row.id === state.messageId ? ' selected' : ''}>${escape([row.sentAt, row.type, row.id, row.sender].filter(Boolean).join(' · '))}</option>`).join('');
      const error = state.error ? `<p class="ws-error-line" role="alert">${escape(state.error)}</p>` : '';
      const verified = row => report?.coverage?.receiptAuthority === 'external-attestation-required-per-row' && row.status === 'read' &&
        typeof row.source === 'string' && row.source.trim() && Number.isFinite(Date.parse(row.verifiedAt)) &&
        (row.readAt === null || Number.isFinite(Date.parse(row.readAt)) && Date.parse(row.readAt) <= Date.parse(row.verifiedAt) &&
          (!Number.isFinite(Date.parse(row.sentAt)) || Date.parse(row.readAt) >= Date.parse(row.sentAt)));
      const display = report ? `<p role="status">观察到 ${escape(summary.observedMembers)} 个成员记录 · 待核实 ${escape(summary.unknownMembers)} 个 · 已关联 ${escape(summary.mappedObservedMembers)} 个</p>
        ${report.rows.length ? `<div class="ws-group-table-wrap"><table class="ws-group-table"><thead><tr><th scope="col">成员标识</th><th scope="col">客户主档</th><th scope="col">规范号码</th><th scope="col">阅读状态</th><th scope="col">观测依据</th></tr></thead><tbody>${report.rows.map(row => `<tr><td>${escape(row.memberId)}</td><td>${escape(row.customer?.name || '未关联客户')}</td><td>${escape(row.customer?.phone || '—')}</td><td>${verified(row) ? '已读（逐人证据已核验）' : '待核实 · unknown'}</td><td>${verified(row) ? `${escape(row.source)} · 核验时间 ${escape(row.verifiedAt)} · 阅读时间 ${escape(row.readAt || '未提供')}` : `${row.memberBasis === 'current-group-record' ? '当前群组记录' : '本地消息证据记录'} · 来源未核验`}</td></tr>`).join('')}</tbody></table></div>` : '<p class="ws-muted">所选消息没有可展示的成员记录。</p>'}
        <div class="ws-workspace-list-pagination"><button type="button" class="btn small" data-ws-action="group-reading-previous" ${state.busy || !state.offset ? 'disabled' : ''}>上一页</button><span>共 ${escape(report.total)} 条观测 · 第 ${state.offset / pageSize + 1} 页</span><button type="button" class="btn small" data-ws-action="group-reading-next" ${state.busy || report.nextOffset == null ? 'disabled' : ''}>下一页</button><button type="button" class="btn small" data-ws-action="group-reading-export" ${state.busy || !report.total ? 'disabled' : ''}>导出 CSV</button></div>` : '';
      return `<section class="ws-workspace-card" aria-label="本地阅读观测" data-ws-group-reading aria-busy="${state.busy}">
        <div class="ws-card-heading"><div><strong>本地阅读观测</strong><span>已保存记录 · ${escape(state.scope.accountId)} · ${escape(state.scope.groupJid)}</span></div></div>
        <p class="ws-muted">成员阅读状态待核实。确认未读、历史有效人数和已读率不可用。</p>
        <p class="ws-muted">历史记录来源未核验，可能包含隔离测试数据；不能证明由本账号发送。仅凭已送达或保存的已读标签不能确认任何成员已读。</p>
        ${state.messages.length ? `<div class="ws-workspace-list-controls"><label>起始日期（UTC）<input type="date" data-ws-group-reading-filter="from" value="${escape(state.filters.from)}" ${state.busy ? 'disabled' : ''}></label><label>结束日期（UTC）<input type="date" data-ws-group-reading-filter="to" value="${escape(state.filters.to)}" ${state.busy ? 'disabled' : ''}></label><label>消息标识、类型或发送者<input type="search" data-ws-group-reading-filter="search" value="${escape(state.filters.search)}" ${state.busy ? 'disabled' : ''}></label></div><p class="ws-muted">仅筛选当前载入的前 200 条本地历史记录：已载入 ${state.messages.length} 条，匹配 ${visibleMessages.length} 条；不代表完整历史。</p><div class="ws-workspace-list-controls"><label>本地捕获消息（发送归属未核验）<select data-ws-group-reading-message ${state.busy ? 'disabled' : ''}><option value="">请选择消息</option>${options}</select></label><button type="button" class="btn small" data-ws-action="group-reading-query" ${!state.messageId || state.busy ? 'disabled' : ''}>查询</button></div>` : ''}
        ${state.busy ? '<p class="ws-muted" role="status">正在读取本地记录…</p>' : (!state.messages.length && !state.error ? '<p class="ws-muted">当前群组没有可选择的本地捕获消息。</p>' : '')}
        ${error}${display}</section>`;
    }

    return Object.freeze({ open, select, filter, run, render, reset, discardStale });
  }

  const api = Object.freeze({ create });
  if (typeof module === 'object' && module.exports) module.exports = api;
  else window.ZhikeWsGroupReading = api;
})();
