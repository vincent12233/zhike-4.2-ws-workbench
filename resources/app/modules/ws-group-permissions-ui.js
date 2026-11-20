(() => {
  'use strict';
  const limit = 1000, pageSize = 40, maxSelected = 100;
  const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const isJid = value => typeof value === 'string' && /^[a-z0-9._-]{1,235}@g\.us$/.test(value);
  const date = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : '';
  const validScope = scope => Boolean(scope && typeof scope.accountId === 'string' && scope.accountId &&
    scope.workspaceMode === 'dedicated' && scope.view === 'group-permissions');
  const sameScope = (left, right) => validScope(left) && validScope(right) && left.accountId === right.accountId && left.sequence === right.sequence;

  function create({ getScope, request, redraw, openLogs }) {
    let current = null;
    const reset = () => { current = null; };
    const owns = page => current === page && sameScope(page?.scope, getScope());
    const discardStale = () => { if (current && !owns(current)) reset(); };
    function pageState() {
      discardStale();
      const scope = getScope();
      if (!validScope(scope)) return null;
      if (!current) current = { scope: { ...scope }, groups: [], selected: new Set(), query: '', page: 1, loaded: false, loading: false, error: '', preview: false };
      return current;
    }
    function windowRows(page) {
      const query = page.query.toLocaleLowerCase();
      const filtered = page.groups.filter(row => !query || (row.name + ' ' + row.groupJid).toLocaleLowerCase().includes(query));
      const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
      const number = Math.min(pages, Math.max(1, page.page));
      return { rows: filtered.slice((number - 1) * pageSize, number * pageSize), total: filtered.length, number, pages };
    }
    async function load() {
      const page = pageState();
      if (!page || page.loading) return false;
      page.loading = true; page.error = ''; page.preview = false; redraw();
      try {
        const accountId = page.scope.accountId;
        const result = await request('/api/ws/accounts/' + encodeURIComponent(accountId) + '/groups?' + new URLSearchParams({ accountId, limit: String(limit) }), page.scope);
        if (!owns(page)) return false;
        if (result?.accountId !== accountId || !Array.isArray(result.groups) || result.groups.length > limit) throw new Error('目录响应不属于当前账号或超过请求上限。');
        const seen = new Set();
        page.groups = result.groups.map(row => {
          if (row?.accountId !== accountId || !isJid(row.groupJid) || seen.has(row.groupJid)) throw new Error('目录包含其他账号、无效或重复的群组标识，请刷新后重试。');
          seen.add(row.groupJid);
          // Directory metadata never attests admin rights or send permissions.
          // Do not copy caller labels, data, monitoring flags or member states.
          return { groupJid: row.groupJid, name: String(row.groupName || row.groupJid).slice(0, 240), lastSeenAt: date(row.lastSeenAt) };
        });
        page.selected = new Set([...page.selected].filter(jid => seen.has(jid)));
        page.loaded = true; page.page = 1;
        return true;
      } catch (error) {
        if (owns(page)) { page.groups = []; page.selected.clear(); page.loaded = false; page.error = String(error?.message || '本地目录读取失败。'); }
        return false;
      } finally { if (owns(page)) { page.loading = false; redraw(); } }
    }
    function search(value) {
      const page = pageState(); if (!page || page.loading) return;
      page.query = String(value || '').trim().slice(0, 200); page.page = 1; page.preview = false; redraw();
    }
    function select(jid, checked) {
      const page = pageState();
      if (!page || page.loading || !isJid(jid) || !windowRows(page).rows.some(row => row.groupJid === jid)) return false;
      if (checked && !page.selected.has(jid) && page.selected.size >= maxSelected) { page.error = '最多选择 100 个群组进行本地预览。'; redraw(); return false; }
      if (checked) page.selected.add(jid); else page.selected.delete(jid);
      page.error = ''; page.preview = false; redraw(); return true;
    }
    async function run(action) {
      const page = pageState(); if (!page || page.loading) return false;
      if (action === 'refresh') return load();
      if (action === 'logs') { openLogs?.(page.scope); return true; }
      if (action === 'preview') page.preview = page.selected.size > 0;
      else if (action === 'clear') { page.selected.clear(); page.preview = false; page.error = ''; }
      else if (action === 'previous') page.page = Math.max(1, windowRows(page).number - 1);
      else if (action === 'next') page.page = Math.min(windowRows(page).pages, windowRows(page).number + 1);
      else return false; // No platform permission mutation exists in this adapter.
      redraw(); return true;
    }
    function render() {
      const page = pageState();
      if (!page) return '<section class="ws-workspace-card zk-surface"><p>请选择可用的专用账号。权限状态 UNKNOWN，实际开关群 BLOCKED。</p></section>';
      const window = windowRows(page), selected = page.groups.filter(row => page.selected.has(row.groupJid));
      const latest = page.groups.map(row => row.lastSeenAt).filter(Boolean).sort().at(-1) || 'UNKNOWN';
      const permissionCells = '<td>UNKNOWN</td><td>UNKNOWN</td><td>UNKNOWN · 尚无可信核验记录</td>';
      const preview = page.preview ? `<section class="ws-workspace-card zk-surface" data-ws-permission-preview><div class="ws-card-heading"><strong>所选群组预览 · ${selected.length} 个</strong></div><p>当前账号：${escape(page.scope.accountId)}。以下仅是本地选择，不会提交权限变更。</p><div class="ws-group-table-wrap"><table class="ws-group-table"><thead><tr><th>群组</th><th>精确 JID</th><th>本账号管理员资格</th><th>成员发言权限</th><th>真实权限核验时间</th></tr></thead><tbody>${selected.map(row => `<tr><td>${escape(row.name)}</td><td>${escape(row.groupJid)}</td>${permissionCells}</tr>`).join('')}</tbody></table></div></section>` : '';
      return `<section class="ws-workspace-card zk-surface" aria-busy="${page.loading}"><div class="ws-card-heading"><div><strong>本地群组权限清单</strong><span>当前专用账号：${escape(page.scope.accountId)}</span></div><span class="ws-status-badge" data-status="disabled">实际权限变更 BLOCKED</span></div><p class="ws-muted">尚无可信的平台权限核验来源，本版本适配器没有经过验证的开群、关群能力。目录记录、监测开关、群成员状态和 CRM 分类均不能证明管理员资格。</p><p class="ws-muted">最近目录时间：${escape(latest)}。目录时间不是权限核验时间；最多载入 1000 条本地记录，不代表完整群目录。</p><div class="ws-workspace-list-controls"><label>搜索群名或精确 JID<input type="search" data-ws-permission-search value="${escape(page.query)}" ${page.loading ? 'disabled' : ''}></label><button type="button" class="btn small" data-ws-action="group-permission-refresh" ${page.loading ? 'disabled' : ''}>刷新本地目录</button><button type="button" class="btn small" data-ws-action="group-permission-preview" ${page.loading || !selected.length ? 'disabled' : ''}>预览所选 ${selected.length} 个群组</button><button type="button" class="btn small" data-ws-action="group-permission-clear" ${page.loading || !selected.length ? 'disabled' : ''}>清空选择</button></div>${page.error ? `<p class="ws-error-line" role="alert">${escape(page.error)}</p>` : ''}${page.loading ? '<p role="status">正在读取本地目录…</p>' : !page.loaded ? '<p class="ws-muted">目录尚未成功读取。</p>' : !window.total ? '<p class="ws-muted">当前载入范围内没有匹配的群组。</p>' : `<div class="ws-group-table-wrap"><table class="ws-group-table"><thead><tr><th>选择</th><th>群组</th><th>精确 JID</th><th>最近目录时间</th><th>本账号管理员资格</th><th>成员发言权限</th><th>真实权限核验时间</th></tr></thead><tbody>${window.rows.map(row => `<tr><td><input type="checkbox" data-ws-permission-select="${escape(row.groupJid)}" aria-label="选择 ${escape(row.groupJid)}" ${page.selected.has(row.groupJid) ? 'checked' : ''}></td><td>${escape(row.name)}</td><td>${escape(row.groupJid)}</td><td>${escape(row.lastSeenAt || 'UNKNOWN')}</td>${permissionCells}</tr>`).join('')}</tbody></table></div><div class="ws-workspace-list-pagination"><button type="button" class="btn small" data-ws-action="group-permission-previous" ${window.number <= 1 ? 'disabled' : ''}>上一页</button><span>匹配 ${window.total} 条 · 第 ${window.number}/${window.pages} 页 · 已选 ${selected.length} 个（含筛选外选择）</span><button type="button" class="btn small" data-ws-action="group-permission-next" ${window.number >= window.pages ? 'disabled' : ''}>下一页</button></div>`}<div class="ws-workspace-list-controls"><button type="button" class="btn small" disabled aria-label="开群不可用">开群（允许成员发言）· BLOCKED</button><button type="button" class="btn small" disabled aria-label="关群不可用">关群（仅管理员发言）· BLOCKED</button><button type="button" class="btn small" data-ws-action="group-permission-logs" ${page.loading ? 'disabled' : ''}>查看当前账号日志</button></div><p class="ws-muted">阻断原因：管理员资格 UNKNOWN；当前发言权限 UNKNOWN；真实权限核验时间 UNKNOWN；平台操作未验证。</p></section>${preview}`;
    }
    return Object.freeze({ load, search, select, run, render, reset, discardStale });
  }

  function renderMentions() {
    return `<section class="ws-workspace-card zk-surface"><div class="ws-card-heading"><strong>原生与隐藏 @ 能力说明</strong><span class="ws-status-badge" data-status="disabled">本版本执行 BLOCKED</span></div><div class="ws-group-table-wrap"><table class="ws-group-table"><thead><tr><th>模式</th><th>当前状态</th><th>边界</th></tr></thead><tbody><tr><td>原生 @ 提及</td><td>BLOCKED · 尚未验收</td><td>WhatsApp 官方帮助说明可在群聊中手工输入 @ 并选择成员。本版本尚未验证程序化生成原生提及实体；正文里的 @ 文本不等于原生提及。</td></tr><tr><td>隐藏式 @</td><td>B_MODE_BLOCKED_UNSUPPORTED</td><td>仅表示本版本适配器没有经过验证的隐藏式群提及能力，不代表所有 WhatsApp 平台绝对不支持。不能用普通文本或状态动态的私密提及冒充群提及。</td></tr></tbody></table></div><p class="ws-muted">实际通知验收：Windows 未测 · Android 未测 · iOS 未测。没有本轮真实收件端证据，不能承诺通知、震动、声音或锁屏提醒。</p><p class="ws-muted">Meta Groups API 是 Cloud API 的独立接口，官方前提包括 OBA（官方企业账号）、Cloud API 号码和相应权限。本地 WebView 登录或群 JID 不能证明 OBA 资格，也不能推导 Cloud API 的 GROUP_ID、BUSINESS_PHONE_NUMBER_ID 或接口授权。</p><button type="button" class="btn small" disabled>原生 @ 发送 · BLOCKED</button><button type="button" class="btn small" disabled>隐藏 @ 发送 · B_MODE_BLOCKED_UNSUPPORTED</button></section>`;
  }
  const api = Object.freeze({ create, renderMentions });
  if (typeof module === 'object' && module.exports) module.exports = api;
  else window.ZhikeWsGroupPermissions = api;
})();
