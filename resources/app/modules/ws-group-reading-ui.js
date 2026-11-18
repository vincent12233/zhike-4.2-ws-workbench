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
      state.scope.groupJid === scope.groupJid && state.scope.sequence === scope.sequence);
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
      const state = { scope, enabled: false, busy: true, messages: [], messageId: '', error: '', report: null, offset: 0 };
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
          typeof row.messageId === 'string' && row.messageId).map(row => ({ id: row.messageId, sentAt: row.sentAt, type: row.type }));
      } catch (error) {
        if (owns(state) && state.enabled) state.error = error?.message || '本地消息加载失败。';
      } finally {
        if (owns(state)) { state.busy = false; if (state.enabled) redraw(); }
      }
    }

    function select(messageId) {
      const state = current;
      if (!owns(state) || !state.enabled || state.busy || state.messageId === messageId) return;
      state.messageId = state.messages.some(row => row.id === messageId) ? messageId : '';
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
      const options = state.messages.map(row => `<option value="${escape(row.id)}"${row.id === state.messageId ? ' selected' : ''}>${escape([row.sentAt, row.type, row.id].filter(Boolean).join(' · '))}</option>`).join('');
      const error = state.error ? `<p class="ws-error-line" role="alert">${escape(state.error)}</p>` : '';
      const display = report ? `<p role="status">观察到 ${escape(summary.observedMembers)} 个成员记录 · 待核实 ${escape(summary.unknownMembers)} 个 · 已关联 ${escape(summary.mappedObservedMembers)} 个</p>
        ${report.rows.length ? `<div class="ws-group-table-wrap"><table class="ws-group-table"><thead><tr><th scope="col">成员标识</th><th scope="col">客户主档</th><th scope="col">规范号码</th><th scope="col">阅读状态</th><th scope="col">观测依据</th></tr></thead><tbody>${report.rows.map(row => `<tr><td>${escape(row.memberId)}</td><td>${escape(row.customer?.name || '未关联客户')}</td><td>${escape(row.customer?.phone || '—')}</td><td>待核实</td><td>${row.memberBasis === 'current-group-record' ? '当前群组记录' : '本地消息证据记录'}</td></tr>`).join('')}</tbody></table></div>` : '<p class="ws-muted">所选消息没有可展示的成员记录。</p>'}
        <div class="ws-workspace-list-pagination"><button type="button" class="btn small" data-ws-action="group-reading-previous" ${state.busy || !state.offset ? 'disabled' : ''}>上一页</button><span>共 ${escape(report.total)} 条观测 · 第 ${state.offset / pageSize + 1} 页</span><button type="button" class="btn small" data-ws-action="group-reading-next" ${state.busy || report.nextOffset == null ? 'disabled' : ''}>下一页</button><button type="button" class="btn small" data-ws-action="group-reading-export" ${state.busy || !report.total ? 'disabled' : ''}>导出 CSV</button></div>` : '';
      return `<section class="ws-workspace-card" aria-label="本地阅读观测" data-ws-group-reading aria-busy="${state.busy}">
        <div class="ws-card-heading"><div><strong>本地阅读观测</strong><span>隔离环境 · ${escape(state.scope.accountId)} · ${escape(state.scope.groupJid)}</span></div></div>
        <p class="ws-muted">成员阅读状态待核实。确认未读、历史有效人数和已读率不可用。</p>
        ${state.messages.length ? `<div class="ws-workspace-list-controls"><label>本地捕获消息（最多 200 条）<select data-ws-group-reading-message ${state.busy ? 'disabled' : ''}><option value="">请选择消息</option>${options}</select></label><button type="button" class="btn small" data-ws-action="group-reading-query" ${!state.messageId || state.busy ? 'disabled' : ''}>查询</button></div>` : ''}
        ${state.busy ? '<p class="ws-muted" role="status">正在读取本地记录…</p>' : (!state.messages.length && !state.error ? '<p class="ws-muted">当前群组没有可选择的本地捕获消息。</p>' : '')}
        ${error}${display}</section>`;
    }

    return Object.freeze({ open, select, run, render, reset, discardStale });
  }

  const api = Object.freeze({ create });
  if (typeof module === 'object' && module.exports) module.exports = api;
  else window.ZhikeWsGroupReading = api;
})();
