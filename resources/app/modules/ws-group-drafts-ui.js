(() => {
  'use strict';
  const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[char]);
  const isJid = value => typeof value === 'string' && /^[a-z0-9._-]+@g\.us$/.test(value);
  const statuses = { DRAFT:'草稿 · 未发送', CANCELLED:'已取消 · 未发送' };
  const statusLabel = value => statuses[value] || '未知状态';
  const sameScope = (left, right) => Boolean(left && right && left.accountId === right.accountId && left.sequence === right.sequence);

  function create({ getScope, request, redraw, uuid = () => globalThis.crypto.randomUUID() }) {
    let current = null;
    const owns = page => Boolean(page && current === page && sameScope(page.scope, getScope()));
    const reset = () => { current = null; };
    const discardStale = () => { if (current && !owns(current)) reset(); };
    function pageState() {
      discardStale();
      const scope = getScope();
      if (!scope || !scope.accountId) return null;
      if (!current) current = { scope:{ ...scope }, query:'', groups:[], selected:new Map(), nextOffset:null,
        message:'', drafts:[], loaded:false, loading:false, saving:false, cancelling:'', error:'', notice:'', preview:false,
        readGeneration:0, mutationGeneration:0, revision:0, pendingCreate:null };
      return current;
    }
    const url = (page, params = {}) => '/api/ws/group-drafts?' + new URLSearchParams({ accountId:page.scope.accountId, ...params });
    const signature = page => JSON.stringify([page.scope.accountId, page.message, [...page.selected.keys()].sort()]);
    const changed = page => { page.revision++; page.pendingCreate = null; page.preview = false; page.error = ''; page.notice = ''; };
    function validate(page) {
      if (!page.message.trim()) return '请输入草稿正文。';
      if (page.message.length > 4000) return '正文不能超过 4000 字。';
      if (!page.selected.size || page.selected.size > 100) return '请选择 1 至 100 个群组。';
      if (![...page.selected.keys()].every(isJid)) return '群组标识无效，请重新选择。';
      return '';
    }
    function draftValid(row, page) {
      return Boolean(row && row.accountId === page.scope.accountId && typeof row.id === 'string' && row.id
        && typeof row.message === 'string' && Array.isArray(row.targets) && row.targets.length > 0 && row.targets.length <= 100
        && row.targets.every(target => isJid(target?.groupJid)));
    }
    function acceptDraft(page, result, id) {
      const draft = result?.draft;
      if (!draftValid(draft, page) || draft.id !== id) throw new Error('草稿响应不属于当前账号或请求。');
      return draft;
    }
    function upsertDraft(page, draft) {
      page.drafts = [draft, ...page.drafts.filter(row => row.id !== draft.id)].sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || ''))).slice(0, 30);
      // An earlier GET must not overwrite a newly saved/cancelled draft.
      page.readGeneration++; page.loading = false;
    }
    async function load(more = false) {
      const page = pageState();
      if (!page) return false;
      const offset = more ? page.nextOffset : 0;
      if (more && (page.loading || !Number.isInteger(offset) || offset <= 0)) return false;
      const generation = ++page.readGeneration, query = page.query.trim();
      page.loading = true; page.error = '';
      const currentRequest = () => owns(page) && generation === page.readGeneration;
      redraw();
      try {
        const result = await request(url(page, { q:query, offset:String(offset) }), {}, page.scope);
        if (!currentRequest()) return false;
        if (result?.accountId !== page.scope.accountId || !Array.isArray(result.groups) || !Array.isArray(result.drafts)) throw new Error('草稿目录响应不属于当前账号。');
        if (result.drafts.some(row => !draftValid(row, page))) throw new Error('草稿历史包含其他账号或无效目标。');
        const groups = result.groups.filter(row => isJid(row?.groupJid)).map(row => ({ groupJid:row.groupJid, name:String(row.name || row.groupJid) }));
        page.groups = [...new Map([...(more ? page.groups : []), ...groups].map(row => [row.groupJid, row])).values()];
        for (const row of groups) if (page.selected.has(row.groupJid)) page.selected.set(row.groupJid, row);
        page.nextOffset = Number.isInteger(result.nextOffset) && result.nextOffset > offset ? result.nextOffset : null;
        page.drafts = result.drafts.slice(0, 30); page.loaded = true;
        return true;
      } catch (error) { if (currentRequest()) page.error = error?.message || '读取草稿失败，请重试。'; return false; }
      finally { if (currentRequest()) { page.loading = false; redraw(); } }
    }
    function input(field, value) {
      const page = pageState();
      if (!page) return false;
      const next = String(value ?? '');
      if (field === 'message' && page.message !== next) { page.message = next; changed(page); }
      else if (field === 'query' && page.query !== next) {
        page.query = next.slice(0, 200); page.readGeneration++; page.loading = false; page.nextOffset = null; page.error = '';
      }
      return true;
    }
    function select(jid, checked) {
      const page = pageState();
      if (!page) return false;
      const row = page.groups.find(item => item.groupJid === jid) || page.selected.get(jid);
      if (!row || !isJid(jid)) return false;
      if (checked && !page.selected.has(jid) && page.selected.size >= 100) page.error = '最多选择 100 个群组。';
      else if (checked !== page.selected.has(jid)) { if (checked) page.selected.set(jid, row); else page.selected.delete(jid); changed(page); }
      redraw(); return true;
    }
    async function save() {
      const page = pageState();
      if (!page || page.saving || page.cancelling) return false;
      const problem = validate(page);
      if (problem) { page.error = problem; redraw(); return false; }
      const content = signature(page), revision = page.revision;
      if (page.pendingCreate?.signature === content && page.pendingCreate.saved) return true;
      try {
        if (page.pendingCreate?.signature !== content) {
          const id = uuid();
          if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) throw new Error('无法生成草稿编号，请重新打开应用。');
          page.pendingCreate = { id, signature:content, saved:false };
        }
      } catch (error) { page.error = error?.message || '无法生成草稿编号。'; redraw(); return false; }
      const pending = page.pendingCreate, generation = ++page.mutationGeneration;
      const payload = { accountId:page.scope.accountId, action:'create', id:pending.id, message:page.message, targets:[...page.selected.keys()].sort() };
      page.saving = true; page.error = ''; page.notice = ''; page.readGeneration++; page.loading = false;
      const currentMutation = () => owns(page) && generation === page.mutationGeneration;
      const currentContent = () => currentMutation() && revision === page.revision && page.pendingCreate === pending;
      redraw();
      try {
        const result = await request(url(page), { method:'POST', body:JSON.stringify(payload) }, page.scope);
        if (!currentContent()) return false;
        const draft = acceptDraft(page, result, pending.id);
        if (!['DRAFT', 'CANCELLED'].includes(draft.status)) throw new Error('服务返回了未知草稿状态，请刷新历史。');
        if (draft.message !== payload.message || JSON.stringify(draft.targets.map(row => row.groupJid).sort()) !== JSON.stringify(payload.targets)) throw new Error('保存结果与当前草稿内容不一致。');
        upsertDraft(page, draft); pending.saved = true;
        page.notice = draft.status === 'CANCELLED' ? '该草稿已取消，未发送。编辑内容后可另存新草稿。' : '草稿已保存，尚未发送。';
        return true;
      } catch (error) { if (currentContent()) page.error = (error?.message || '保存草稿失败。') + ' 内容已保留，可重试保存。'; return false; }
      finally { if (currentMutation()) { page.saving = false; redraw(); } }
    }
    async function cancel(id) {
      const page = pageState();
      if (!page || page.saving || page.cancelling) return false;
      const existing = page.drafts.find(row => row.id === id && row.status === 'DRAFT');
      if (!existing) return false;
      const generation = ++page.mutationGeneration;
      page.cancelling = id; page.error = ''; page.notice = ''; page.readGeneration++; page.loading = false;
      const currentMutation = () => owns(page) && generation === page.mutationGeneration;
      redraw();
      try {
        const result = await request(url(page), { method:'POST', body:JSON.stringify({ accountId:page.scope.accountId, action:'cancel', id }) }, page.scope);
        if (!currentMutation()) return false;
        const draft = acceptDraft(page, result, id);
        if (draft.status !== 'CANCELLED') throw new Error('服务未确认草稿取消，请刷新历史。');
        if (draft.message !== existing.message || JSON.stringify(draft.targets.map(row => row.groupJid).sort()) !== JSON.stringify(existing.targets.map(row => row.groupJid).sort())) throw new Error('取消结果与原草稿内容不一致，请刷新历史。');
        upsertDraft(page, draft); page.notice = '草稿已取消，未发送。'; return true;
      } catch (error) { if (currentMutation()) page.error = error?.message || '取消草稿失败，请重试。'; return false; }
      finally { if (currentMutation()) { page.cancelling = ''; redraw(); } }
    }
    async function run(action, id = '') {
      const page = pageState();
      if (!page) return false;
      if (action === 'search' || action === 'refresh') return load();
      if (action === 'more') return load(true);
      if (action === 'save') return save();
      if (action === 'cancel') return cancel(id);
      if (action === 'remove') return select(id, false);
      if (action === 'select-page') {
        const merged = new Map([...page.selected, ...page.groups.map(row => [row.groupJid, row])]);
        if (merged.size > 100) page.error = '当前结果加入后超过 100 个群组，请逐个选择。';
        else if (merged.size !== page.selected.size) { page.selected = merged; changed(page); }
      } else if (action === 'clear-selection') { if (page.selected.size) { page.selected.clear(); changed(page); } }
      else if (action === 'preview') { page.error = validate(page); page.preview = !page.error; }
      else if (action === 'send') page.error = '真实群组发送尚未验证：BLOCKED。';
      else return false;
      redraw(); return true;
    }
    function syncInputs(document) {
      const page = pageState();
      if (!page) return;
      const saved = page.pendingCreate?.saved && page.pendingCreate.signature === signature(page);
      const button = document.querySelector('[data-ws-group-draft-save]');
      if (button) { button.disabled = Boolean(page.saving || page.cancelling || saved); button.textContent = page.saving ? '保存中…' : saved ? '此版本已保存' : '保存草稿'; }
      const counter = document.querySelector('[data-ws-group-draft-count]');
      if (counter) counter.textContent = page.message.length + ' / 4000';
      const preview = document.querySelector('[data-ws-group-draft-preview]');
      if (preview) preview.hidden = !page.preview;
      const error = document.querySelector('[data-ws-group-draft-error]');
      if (error) { error.textContent = page.error; error.hidden = !page.error; }
      const notice = document.querySelector('[data-ws-group-draft-notice]');
      if (notice) { notice.textContent = page.notice; notice.hidden = !page.notice; }
    }
    function render() {
      const page = pageState();
      if (!page) return '<section class="ws-workspace-card"><h2>群组发送草稿</h2><p>专用账号尚未启用，请先添加并选择专用 WS 账号。</p><p>实际发送：BLOCKED</p></section>';
      const saved = page.pendingCreate?.saved && page.pendingCreate.signature === signature(page);
      const selected = [...page.selected.values()];
      const identity = row => `<strong>${escape(row.name || row.groupJid)}</strong><code>${escape(row.groupJid)}</code>`;
      const groups = page.groups.map(row => `<label class="ws-group-draft-choice"><input type="checkbox" data-ws-group-draft-select="${escape(row.groupJid)}" ${page.selected.has(row.groupJid) ? 'checked' : page.selected.size >= 100 ? 'disabled' : ''}><span>${identity(row)}</span></label>`).join('');
      const targets = selected.map(row => `<li><span>${identity(row)}</span><button type="button" class="btn small" data-ws-action="group-draft-remove" data-draft-id="${escape(row.groupJid)}">移除</button></li>`).join('');
      const history = page.drafts.map(draft => `<details class="ws-group-draft-history"><summary><strong>${escape(statusLabel(draft.status))}</strong> · ${escape(draft.createdAt || '')} · ${draft.targets.length} 个群</summary><p class="ws-group-draft-body">${escape(draft.message)}</p><small>草稿编号：${escape(draft.id)}${draft.cancelledAt ? ' · 取消于 ' + escape(draft.cancelledAt) : ''}</small><table><thead><tr><th>群组</th><th>目标状态</th></tr></thead><tbody>${draft.targets.map(row => `<tr><td>${identity(row)}</td><td>${escape(statusLabel(row.status))}</td></tr>`).join('')}</tbody></table>${draft.status === 'DRAFT' ? `<button type="button" class="btn small" data-ws-action="group-draft-cancel" data-draft-id="${escape(draft.id)}" ${page.saving || page.cancelling ? 'disabled' : ''}>${page.cancelling === draft.id ? '取消中…' : '取消未发送草稿'}</button>` : ''}</details>`).join('');
      return `<section class="ws-group-drafts" aria-label="群组发送草稿"><p class="ws-error-line" role="alert" data-ws-group-draft-error ${page.error ? '' : 'hidden'}>${escape(page.error)}</p><p role="status" data-ws-group-draft-notice ${page.notice ? '' : 'hidden'}>${escape(page.notice)}</p><div class="ws-group-draft-columns"><section class="ws-workspace-card"><div class="ws-card-heading"><div><strong>选择群组</strong><span>当前专用账号：${escape(page.scope.accountId)} · 已选 ${selected.length} / 100</span></div></div><form class="ws-group-draft-toolbar" data-ws-group-draft-search><label>名称或群 JID<input type="search" data-ws-group-draft-input="query" value="${escape(page.query)}" maxlength="200" placeholder="搜索群目录"></label><button type="submit" class="btn">搜索</button></form><div class="ws-group-draft-toolbar"><button type="button" class="btn small" data-ws-action="group-draft-select-page" ${!page.groups.length ? 'disabled' : ''}>选中当前结果</button><button type="button" class="btn small" data-ws-action="group-draft-clear-selection" ${!selected.length ? 'disabled' : ''}>清空已选</button></div><div class="ws-group-draft-choices" aria-busy="${page.loading}">${groups || `<p class="ws-muted">${page.loading ? '正在读取群目录…' : page.loaded ? '没有匹配的群组。' : '点击搜索读取当前账号的群目录。'}</p>`}</div>${page.nextOffset !== null ? `<button type="button" class="btn small" data-ws-action="group-draft-more" ${page.loading ? 'disabled' : ''}>加载更多群组</button>` : ''}<p class="ws-muted">搜索和翻页保留已选群组。</p></section><section class="ws-workspace-card"><div class="ws-card-heading"><div><strong>编辑草稿</strong><span>最多 4000 字；保存不会发送消息。</span></div></div><label>正文<textarea data-ws-group-draft-input="message" maxlength="4000" rows="7" placeholder="输入要保存的群组消息">${escape(page.message)}</textarea></label><small data-ws-group-draft-count>${page.message.length} / 4000</small><h3>已选目标 · ${selected.length}</h3><ul class="ws-group-draft-targets">${targets || '<li>尚未选择群组。</li>'}</ul><div class="ws-group-draft-toolbar"><button type="button" class="btn" data-ws-action="group-draft-preview">预览草稿</button><button type="button" class="btn primary" data-ws-action="group-draft-save" data-ws-group-draft-save ${page.saving || page.cancelling || saved ? 'disabled' : ''}>${page.saving ? '保存中…' : saved ? '此版本已保存' : '保存草稿'}</button><button type="button" class="btn" disabled aria-disabled="true" title="真实群组发送尚未验证">实际发送 · BLOCKED</button></div><p class="ws-muted">群组发送、@ 提及及已读回执尚未通过真实平台验证。</p><section class="ws-group-draft-preview" data-ws-group-draft-preview ${page.preview ? '' : 'hidden'}><h3>发送内容预览 · 当前仅保存草稿</h3><p class="ws-group-draft-body">${escape(page.message)}</p><ul>${selected.map(row => `<li>${identity(row)}</li>`).join('')}</ul></section></section></div><section class="ws-workspace-card"><div class="ws-card-heading"><div><strong>最近 30 条草稿</strong><span>记录及逐目标状态来自当前专用账号。</span></div><button type="button" class="btn small" data-ws-action="group-draft-refresh" ${page.loading ? 'disabled' : ''}>刷新历史</button></div>${history || '<p class="ws-muted">暂无草稿记录。</p>'}</section></section>`;
    }
    return { render, load, run, input, select, syncInputs, reset, discardStale };
  }
  window.ZhikeWsGroupDrafts = Object.freeze({ create });
})();
