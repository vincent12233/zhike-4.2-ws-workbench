(() => {
  'use strict';
  // Dedicated WS · 群组渠道配置. Reads and writes only the schema-34 channel
  // configuration API. The page never infers a channel from a code prefix and
  // never shows a collector hint as an effective channel.
  const pageSize = 50;
  const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const isJid = value => typeof value === 'string' && /^[a-z0-9._-]{1,235}@g\.us$/.test(value);
  const validScope = scope => Boolean(scope && typeof scope.accountId === 'string' && scope.accountId && scope.workspaceMode === 'dedicated' && scope.view === 'group-channels');
  const sameScope = (left, right) => validScope(left) && validScope(right) && left.accountId === right.accountId && left.sequence === right.sequence;
  const ORIGIN_LABEL = { manual: '手动', import: '导入', rule: '编号规则', '': '' };
  const PENDING_LABEL = { 'code-missing': '未识别编号', 'code-unconfirmed': '编号待确认', 'code-ambiguous': '名称含多个编号', 'channel-missing': '渠道未配置' };
  const STATUS_LABEL = { ok: '可写入', unchanged: '无变化', conflict: '冲突', rejected: '已拒绝' };
  const timeText = value => { const ms = Date.parse(value || ''); return Number.isFinite(ms) ? new Date(ms).toLocaleString('zh-CN', { hour12: false }) : '—'; };

  function create({ getScope, request, redraw, download, toast }) {
    let current = null;
    const reset = () => { current = null; };
    const owns = page => current === page && sameScope(page?.scope, getScope());
    const discardStale = () => { if (current && !owns(current)) reset(); };
    function pageState() {
      discardStale();
      const scope = getScope();
      if (!validScope(scope)) return null;
      if (!current) current = { scope: { ...scope }, rows: [], summary: { total: 0, pending: 0, configured: 0 }, channels: [], rules: [], query: '', pending: '', channel: '', page: 1, selected: new Set(), editing: '', history: { jid: '', rows: [], loading: false }, importOpen: false, importText: '', importPreview: null, batch: { field: 'channel', value: '' }, loaded: false, loading: false, saving: false, error: '', notice: '' };
      return current;
    }
    const accountQuery = (page, extra = {}) => new URLSearchParams({ accountId: page.scope.accountId, ...extra });
    function windowRows(page) {
      const pages = Math.max(1, Math.ceil(page.rows.length / pageSize));
      const number = Math.min(pages, Math.max(1, page.page));
      return { rows: page.rows.slice((number - 1) * pageSize, number * pageSize), number, pages };
    }
    async function load() {
      const page = pageState();
      if (!page || page.loading) return false;
      page.loading = true; page.error = ''; redraw();
      try {
        const params = accountQuery(page);
        if (page.query) params.set('query', page.query);
        if (page.pending) params.set('pending', page.pending);
        if (page.channel) params.set('channel', page.channel);
        const result = await request('/api/ws/group-channel-configs?' + params, {}, page.scope);
        if (!owns(page)) return false;
        if (!Array.isArray(result?.rows)) throw new Error('群组渠道配置响应无效。');
        const accountId = page.scope.accountId;
        if (result.rows.some(row => row.accountId !== accountId || !isJid(row.groupJid))) throw new Error('响应包含其他账号或无效的群组标识，请刷新后重试。');
        page.rows = result.rows;
        page.summary = result.summary || page.summary;
        page.rules = Array.isArray(result.rules) ? result.rules : [];
        const used = new Set(result.rows.map(row => row.channel).filter(Boolean));
        page.channels = [...new Set([...(result.builtinChannels || []), ...page.rules.map(rule => rule.channel), ...used])];
        const known = new Set(page.rows.map(row => row.groupJid));
        page.selected = new Set([...page.selected].filter(jid => known.has(jid)));
        if (page.editing && !known.has(page.editing)) page.editing = '';
        page.loaded = true;
        return true;
      } catch (error) {
        if (owns(page)) { page.error = String(error?.message || '群组渠道配置读取失败。'); page.loaded = false; }
        return false;
      } finally { if (owns(page)) { page.loading = false; redraw(); } }
    }
    function describeResult(result) {
      const s = result?.summary || {};
      const parts = [];
      if (result?.applied) parts.push(`已保存 ${result.applied} 个群组`);
      if (s.unchanged) parts.push(`${s.unchanged} 个无变化`);
      if (s.conflict) parts.push(`${s.conflict} 个冲突未写入`);
      if (s.rejected) parts.push(`${s.rejected} 个被拒绝`);
      return parts.join('，') || '没有需要保存的修改';
    }
    function firstProblem(result) {
      const row = (result?.rows || []).find(item => item.errors?.length || (item.conflicts?.length && !item.applied));
      return row ? [...(row.errors || []), ...(row.conflicts || [])][0] : '';
    }
    async function save(page, body, okMessage) {
      if (page.saving) return null;
      page.saving = true; page.error = ''; page.notice = ''; redraw();
      try {
        const result = await request('/api/ws/group-channel-configs?' + accountQuery(page), { method: 'POST', body: JSON.stringify(body) }, page.scope);
        if (!owns(page)) return null;
        const problem = firstProblem(result);
        if (result?.applied) { page.notice = (okMessage ? okMessage + '：' : '') + describeResult(result); toast?.(page.notice, 'check'); }
        if (problem) page.error = problem;
        else if (!result?.applied) page.notice = describeResult(result);
        return result;
      } catch (error) {
        // A 409 carries the per-row reasons in the body; show the real cause.
        if (owns(page)) page.error = firstProblem(error?.body) || String(error?.message || '保存失败。');
        return null;
      } finally { if (owns(page)) { page.saving = false; redraw(); } }
    }
    const field = (root, name) => root?.querySelector?.(`[data-ws-channel-field="${name}"]`);
    function readEditor(jid) {
      const root = document.querySelector(`[data-ws-channel-editor="${CSS.escape(jid)}"]`);
      if (!root) return null;
      const value = name => String(field(root, name)?.value ?? '').trim();
      const channelSelect = value('channel');
      return {
        groupCode: value('groupCode'),
        channel: channelSelect === '__custom__' ? value('channelCustom') : channelSelect,
        pageCategory: value('pageCategory'), assistant: value('assistant'), defaultTags: value('defaultTags'),
        autoCreateCustomers: Boolean(field(root, 'autoCreateCustomers')?.checked),
        monitorMembership: Boolean(field(root, 'monitorMembership')?.checked),
      };
    }
    async function loadHistory(page, jid) {
      if (page.history.jid === jid && !page.history.loading) { page.history = { jid: '', rows: [], loading: false }; redraw(); return; }
      page.history = { jid, rows: [], loading: true }; redraw();
      try {
        const result = await request('/api/ws/group-channel-configs/history?' + accountQuery(page, { groupJid: jid }), {}, page.scope);
        if (owns(page) && page.history.jid === jid) page.history = { jid, rows: Array.isArray(result?.history) ? result.history : [], loading: false };
      } catch (error) {
        if (owns(page)) { page.history = { jid: '', rows: [], loading: false }; page.error = String(error?.message || '修改历史读取失败。'); }
      } finally { if (owns(page)) redraw(); }
    }
    async function runImport(page, apply) {
      const csv = page.importText.trim();
      if (!csv) { page.error = '请粘贴表格内容或选择 CSV / Excel 文件。'; redraw(); return; }
      page.saving = true; page.error = ''; page.notice = ''; redraw();
      try {
        const result = await request('/api/ws/group-channel-configs/import?' + accountQuery(page), { method: 'POST', body: JSON.stringify({ csv, dryRun: !apply }) }, page.scope);
        if (!owns(page)) return;
        page.importPreview = result;
        if (apply) {
          page.notice = '导入完成：' + describeResult(result);
          toast?.(page.notice, 'check');
          await loadAfterSave(page);
        }
      } catch (error) {
        if (owns(page)) { page.error = String(error?.message || '导入失败。'); page.importPreview = null; }
      } finally { if (owns(page)) { page.saving = false; redraw(); } }
    }
    async function loadAfterSave(page) { page.loading = false; await load(); }
    async function exportCsv(page) {
      try {
        const result = await request('/api/ws/group-channel-configs/export?' + accountQuery(page, { format: 'json' }), {}, page.scope);
        if (!owns(page) || typeof result?.csv !== 'string') throw new Error('导出响应无效。');
        download?.(result.filename || '群组渠道配置.csv', result.csv);
        page.notice = `已导出 ${Math.max(0, result.csv.trim().split(/\r?\n/).length - 1)} 个群组的配置。`;
      } catch (error) { if (owns(page)) page.error = String(error?.message || '导出失败。'); }
      redraw();
    }
    async function run(action, element) {
      const page = pageState();
      if (!page) return false;
      const jid = String(element?.dataset?.groupJid || '');
      if (action === 'refresh') return load();
      if (page.loading || page.saving) return false;
      if (action === 'edit') { page.editing = page.editing === jid ? '' : jid; redraw(); return true; }
      if (action === 'cancel') { page.editing = ''; redraw(); return true; }
      if (action === 'save' && isJid(jid)) {
        const input = readEditor(jid);
        if (!input) return false;
        const result = await save(page, { accountId: page.scope.accountId, groupJid: jid, ...input }, '群组配置');
        if (result?.applied) { page.editing = ''; await loadAfterSave(page); }
        return Boolean(result?.applied);
      }
      if (action === 'accept-code' && isJid(jid)) {
        const row = page.rows.find(item => item.groupJid === jid);
        if (!row?.detectedCode) return false;
        const result = await save(page, { accountId: page.scope.accountId, groupJid: jid, groupCode: row.detectedCode }, `确认编号 ${row.detectedCode}`);
        if (result?.applied) await loadAfterSave(page);
        return Boolean(result?.applied);
      }
      if (action === 'accept-codes') {
        const groups = page.rows.filter(row => page.selected.has(row.groupJid) && !row.groupCode && row.detectedCodeStatus === 'detected');
        if (!groups.length) { page.notice = '所选群组没有可直接确认的识别编号。'; redraw(); return false; }
        const result = await save(page, { items: groups.map(row => ({ accountId: page.scope.accountId, groupJid: row.groupJid, groupCode: row.detectedCode })) }, '批量确认编号');
        if (result?.applied) await loadAfterSave(page);
        return Boolean(result?.applied);
      }
      if (action === 'batch-apply') {
        const groups = [...page.selected].map(groupJid => ({ accountId: page.scope.accountId, groupJid }));
        if (!groups.length) return false;
        const value = page.batch.value.trim();
        const key = page.batch.field;
        if (!['channel', 'assistant', 'pageCategory', 'defaultTags', 'autoCreateCustomers', 'monitorMembership'].includes(key)) return false;
        if (['channel', 'assistant'].includes(key) && !value) { page.error = '请先填写要批量设置的值。'; redraw(); return false; }
        const patch = { [key]: ['autoCreateCustomers', 'monitorMembership'].includes(key) ? value === '是' : value };
        const result = await save(page, { patch, groups }, '批量设置');
        if (result?.applied) await loadAfterSave(page);
        return Boolean(result?.applied);
      }
      if (action === 'select-page') { const rows = windowRows(page).rows; const all = rows.every(row => page.selected.has(row.groupJid)); rows.forEach(row => all ? page.selected.delete(row.groupJid) : page.selected.add(row.groupJid)); redraw(); return true; }
      if (action === 'clear-selection') { page.selected.clear(); redraw(); return true; }
      if (action === 'history' && isJid(jid)) { await loadHistory(page, jid); return true; }
      if (action === 'import-toggle') { page.importOpen = !page.importOpen; page.importPreview = null; redraw(); return true; }
      if (action === 'import-preview') { await runImport(page, false); return true; }
      if (action === 'import-apply') { await runImport(page, true); return true; }
      if (action === 'export') { await exportCsv(page); return true; }
      if (action === 'previous') { page.page = Math.max(1, windowRows(page).number - 1); redraw(); return true; }
      if (action === 'next') { page.page = Math.min(windowRows(page).pages, windowRows(page).number + 1); redraw(); return true; }
      return false;
    }
    /** Input/change events from controls inside the page. Returns true when handled. */
    function control(target) {
      const page = pageState();
      if (!page || !target?.dataset) return false;
      if (target.matches('[data-ws-channel-search]')) { page.query = String(target.value || '').trim().slice(0, 120); page.page = 1; load(); return true; }
      if (target.matches('[data-ws-channel-filter="pending"]')) { page.pending = target.value; page.page = 1; load(); return true; }
      if (target.matches('[data-ws-channel-filter="channel"]')) { page.channel = target.value; page.page = 1; load(); return true; }
      if (target.matches('[data-ws-channel-select]')) {
        const jid = target.dataset.wsChannelSelect;
        if (!isJid(jid)) return true;
        if (target.checked) page.selected.add(jid); else page.selected.delete(jid);
        redraw(); return true;
      }
      if (target.matches('[data-ws-channel-batch="field"]')) { page.batch = { field: target.value, value: '' }; redraw(); return true; }
      if (target.matches('[data-ws-channel-batch="value"]')) { page.batch.value = String(target.value || ''); return true; }
      if (target.matches('[data-ws-channel-import-text]')) { page.importText = String(target.value || ''); page.importPreview = null; return true; }
      if (target.matches('[data-ws-channel-field="channel"]')) {
        const custom = target.closest('[data-ws-channel-editor]')?.querySelector('[data-ws-channel-field="channelCustom"]');
        if (custom) custom.hidden = target.value !== '__custom__';
        return true;
      }
      if (target.matches('[data-ws-channel-import-file]')) { readImportFile(page, target.files?.[0]); return true; }
      return false;
    }
    function readImportFile(page, file) {
      if (!file) return;
      if (file.size > 8 * 1024 * 1024) { page.error = '文件超过 8 MB。'; redraw(); return; }
      const reader = new FileReader();
      const excel = /\.(xlsx|xlsm|xls)$/i.test(file.name);
      reader.onload = () => {
        if (!owns(page)) return;
        try {
          if (excel) {
            const XLSX = window.XLSX;
            if (!XLSX?.read) throw new Error('Excel 解析组件未加载，请改用 CSV。');
            const book = XLSX.read(new Uint8Array(reader.result), { type: 'array' });
            const sheet = book.Sheets[book.SheetNames[0]];
            page.importText = XLSX.utils.sheet_to_csv(sheet, { blankrows: false });
          } else page.importText = String(reader.result || '');
          page.importPreview = null; page.error = ''; page.notice = `已读取 ${file.name}，请先预览再导入。`;
        } catch (error) { page.error = String(error?.message || '文件读取失败。'); }
        redraw();
      };
      reader.onerror = () => { if (owns(page)) { page.error = '文件读取失败。'; redraw(); } };
      if (excel) reader.readAsArrayBuffer(file); else reader.readAsText(file, 'utf-8');
    }

    // ---------- rendering ----------
    function channelOptions(page, selected, { allowEmpty = true, allowCustom = false } = {}) {
      const list = [...new Set([...page.channels, ...(selected ? [selected] : [])])];
      return (allowEmpty ? `<option value="">${allowCustom ? '未配置' : '全部渠道'}</option>` : '') + list.map(channel => `<option value="${escape(channel)}" ${channel === selected ? 'selected' : ''}>${escape(channel)}</option>`).join('') + (allowCustom ? '<option value="__custom__">自定义渠道…</option>' : '');
    }
    function codeCell(row) {
      if (row.groupCode) return `<span class="ws-channel-code">${escape(row.groupCode)}</span>`;
      if (row.detectedCodeStatus === 'detected') return `<span class="ws-channel-code is-detected" title="从群名识别，尚未确认">${escape(row.detectedCode)}</span><button class="btn small" data-ws-action="group-channel-accept-code" data-group-jid="${escape(row.groupJid)}">确认</button>`;
      if (row.detectedCodeStatus === 'ambiguous') return `<span class="ws-channel-flag" title="${escape(row.detectedCandidates.join(' / '))}">多个编号</span>`;
      return '<span class="ws-muted">—</span>';
    }
    function channelCell(row) {
      if (row.channel) return `<span class="ws-channel-pill">${escape(row.channel)}</span>${row.channelOrigin ? `<small class="ws-channel-origin">${escape(ORIGIN_LABEL[row.channelOrigin] || row.channelOrigin)}</small>` : ''}`;
      return `<span class="ws-channel-flag">未配置</span>${row.channelHint ? `<small class="ws-channel-origin" title="采集端提供的线索，未经确认，不作为渠道">线索：${escape(row.channelHint)}</small>` : ''}`;
    }
    function editorRow(page, row) {
      const known = page.channels.includes(row.channel) || !row.channel;
      const channelValue = row.channelOrigin === 'rule' ? '' : row.channel;
      return `<tr class="ws-channel-editor-row"><td colspan="9"><div class="ws-channel-editor" data-ws-channel-editor="${escape(row.groupJid)}">
        <label><span>群组编号</span><input data-ws-channel-field="groupCode" value="${escape(row.groupCode || (row.detectedCodeStatus === 'detected' ? row.detectedCode : ''))}" placeholder="如 A-501" maxlength="20"></label>
        <label><span>渠道${row.channelOrigin === 'rule' ? `（当前由编号规则得出：${escape(row.channel)}）` : ''}</span><select data-ws-channel-field="channel">${channelOptions(page, known ? channelValue : '__custom__', { allowCustom: true })}</select><input data-ws-channel-field="channelCustom" value="${known ? '' : escape(channelValue)}" placeholder="自定义渠道名称" maxlength="60" ${known ? 'hidden' : ''}></label>
        <label><span>页面分类</span><input data-ws-channel-field="pageCategory" value="${escape(row.pageCategory)}" maxlength="60"></label>
        <label><span>跟进助理</span><input data-ws-channel-field="assistant" value="${escape(row.assistant)}" maxlength="60"></label>
        <label class="wide"><span>默认客户标签（逗号分隔）</span><input data-ws-channel-field="defaultTags" value="${escape(row.defaultTags.join('，'))}" maxlength="400"></label>
        <label class="switch"><input type="checkbox" data-ws-channel-field="autoCreateCustomers" ${row.autoCreateCustomers ? 'checked' : ''}><span>自动建档</span></label>
        <label class="switch"><input type="checkbox" data-ws-channel-field="monitorMembership" ${row.monitorMembership ? 'checked' : ''}><span>进退群监测</span></label>
        <div class="ws-channel-editor-actions"><button class="btn small" data-ws-action="group-channel-cancel">取消</button><button class="btn small primary" data-ws-action="group-channel-save" data-group-jid="${escape(row.groupJid)}" ${page.saving ? 'disabled' : ''}>${page.saving ? '保存中…' : '保存'}</button></div>
        <p class="ws-muted">留空渠道表示不手动指定；如果该编号有已确认的规则，会按规则得出渠道。渠道不会根据编号前缀自动推断。</p>
      </div></td></tr>`;
    }
    function historyRow(page, row) {
      if (page.history.jid !== row.groupJid) return '';
      const body = page.history.loading ? '<p class="ws-muted">正在读取修改历史…</p>'
        : page.history.rows.length ? `<ol class="ws-channel-history">${page.history.rows.map(item => `<li><b>第 ${Number(item.revision)} 版</b> · ${escape(timeText(item.createdAt))} · ${escape({ manual: '手动', batch: '批量', import: '导入', rule: '规则' }[item.origin] || item.origin)}<span>${Object.entries(item.changes || {}).map(([key, change]) => `${escape(FIELD_TEXT[key] || key)}：${escape(fmt(change.from))} → ${escape(fmt(change.to))}`).join('；')}</span></li>`).join('')}</ol>`
        : '<p class="ws-muted">尚无修改记录。</p>';
      return `<tr class="ws-channel-history-row"><td colspan="9">${body}</td></tr>`;
    }
    const FIELD_TEXT = { groupCode: '编号', channel: '渠道', pageCategory: '页面分类', assistant: '助理', defaultTags: '标签', autoCreateCustomers: '自动建档', monitorMembership: '监测' };
    const fmt = value => Array.isArray(value) ? (value.join('、') || '空') : typeof value === 'boolean' ? (value ? '开' : '关') : (value === '' || value == null ? '空' : String(value));
    function batchBar(page) {
      if (!page.selected.size) return '';
      const fieldName = page.batch.field;
      const input = fieldName === 'channel'
        ? `<select data-ws-channel-batch="value"><option value="">选择渠道</option>${page.channels.map(channel => `<option ${channel === page.batch.value ? 'selected' : ''}>${escape(channel)}</option>`).join('')}</select>`
        : ['autoCreateCustomers', 'monitorMembership'].includes(fieldName)
          ? `<select data-ws-channel-batch="value"><option value="">请选择</option><option ${page.batch.value === '是' ? 'selected' : ''}>是</option><option ${page.batch.value === '否' ? 'selected' : ''}>否</option></select>`
          : `<input data-ws-channel-batch="value" value="${escape(page.batch.value)}" placeholder="填写新值" maxlength="200">`;
      return `<div class="ws-channel-batch" role="region" aria-label="批量操作"><strong>已选 ${page.selected.size} 个群组</strong>
        <select data-ws-channel-batch="field">${[['channel', '设置渠道'], ['assistant', '设置助理'], ['pageCategory', '设置页面分类'], ['defaultTags', '设置默认标签'], ['autoCreateCustomers', '自动建档开关'], ['monitorMembership', '进退群监测开关']].map(([value, label]) => `<option value="${value}" ${value === fieldName ? 'selected' : ''}>${label}</option>`).join('')}</select>
        ${input}<button class="btn small primary" data-ws-action="group-channel-batch-apply" ${page.saving ? 'disabled' : ''}>应用</button>
        <button class="btn small" data-ws-action="group-channel-accept-codes" ${page.saving ? 'disabled' : ''}>确认识别编号</button>
        <button class="btn small" data-ws-action="group-channel-clear-selection">取消选择</button></div>`;
    }
    function importPanel(page) {
      if (!page.importOpen) return '';
      const preview = page.importPreview;
      const rows = preview?.rows || [];
      const table = rows.length ? `<div class="ws-group-table-wrap"><table class="ws-group-table ws-channel-import-table"><thead><tr><th>行</th><th>群组ID</th><th>结果</th><th>变更 / 原因</th></tr></thead><tbody>${rows.slice(0, 300).map(row => `<tr data-status="${escape(row.status)}"><td>${Number(row.line) || ''}</td><td>${escape(row.groupJid)}</td><td><span class="ws-channel-status" data-status="${escape(row.status)}">${escape(row.applied ? '已写入' : STATUS_LABEL[row.status] || row.status)}</span></td><td>${escape([...(row.errors || []), ...(row.conflicts || [])].join('；') || Object.entries(row.changes || {}).map(([key, change]) => `${FIELD_TEXT[key] || key}：${fmt(change.from)} → ${fmt(change.to)}`).join('；') || '—')}</td></tr>`).join('')}</tbody></table></div>${rows.length > 300 ? `<p class="ws-muted">仅显示前 300 行，共 ${rows.length} 行。</p>` : ''}` : '';
      const okCount = preview?.summary?.ok || 0;
      return `<section class="ws-workspace-card zk-surface ws-channel-import"><div class="ws-card-heading"><div><strong>导入群组配置</strong><span>必须包含“群组ID”列；可选列：群组编号、渠道、页面分类、跟进助理、默认标签、自动建档、进退群监测。空白单元格不会清空已有配置。</span></div></div>
        <div class="ws-channel-import-input"><label class="btn small">选择 CSV / Excel 文件<input type="file" accept=".csv,.tsv,.txt,.xlsx,.xlsm,.xls" data-ws-channel-import-file hidden></label><span class="ws-muted">或直接从 Excel 复制粘贴：</span></div>
        <textarea data-ws-channel-import-text rows="5" placeholder="群组ID,群组编号,渠道,跟进助理&#10;120363xxxx@g.us,A-501,单导K,小王">${escape(page.importText)}</textarea>
        <div class="ws-channel-editor-actions"><button class="btn small" data-ws-action="group-channel-import-preview" ${page.saving ? 'disabled' : ''}>预览与冲突检查</button><button class="btn small primary" data-ws-action="group-channel-import-apply" ${page.saving || !preview || preview.dryRun === false || !okCount ? 'disabled' : ''}>导入 ${okCount} 个可写入的群组</button></div>
        ${preview ? `<p class="ws-muted" role="status">${preview.dryRun === false ? '已导入' : '预览'}：可写入 ${okCount} · 无变化 ${preview.summary?.unchanged || 0} · 冲突 ${preview.summary?.conflict || 0} · 拒绝 ${preview.summary?.rejected || 0}。冲突与被拒绝的行不会写入。</p>` : ''}${table}</section>`;
    }
    function render() {
      const page = pageState();
      if (!page) return '<section class="ws-workspace-card zk-surface"><p>请选择可用的专用 WS 账号后配置群组渠道。</p></section>';
      const win = windowRows(page);
      const allOnPage = win.rows.length && win.rows.every(row => page.selected.has(row.groupJid));
      const tableRows = win.rows.map(row => `<tr class="${row.pending ? 'is-pending' : ''} ${page.selected.has(row.groupJid) ? 'is-selected' : ''}">
          <td><input type="checkbox" aria-label="选择 ${escape(row.groupName)}" data-ws-channel-select="${escape(row.groupJid)}" ${page.selected.has(row.groupJid) ? 'checked' : ''}></td>
          <td class="ws-channel-name"><strong title="${escape(row.groupName)}">${escape(row.groupName)}</strong><small title="真实群组ID">${escape(row.groupJid)} · ${Number(row.participantCount) || 0} 人</small></td>
          <td class="ws-channel-code-cell">${codeCell(row)}</td>
          <td>${channelCell(row)}</td>
          <td>${escape(row.pageCategory || '—')}</td>
          <td>${escape(row.assistant || '—')}</td>
          <td><span class="ws-channel-toggle" data-on="${row.autoCreateCustomers}">${row.autoCreateCustomers ? '建档' : '不建档'}</span><span class="ws-channel-toggle" data-on="${row.monitorMembership}">${row.monitorMembership ? '监测' : '未监测'}</span></td>
          <td>${row.pending ? `<span class="ws-channel-status" data-status="pending">${escape(PENDING_LABEL[row.pendingReason] || '待配置')}</span>` : '<span class="ws-channel-status" data-status="ok">已配置</span>'}</td>
          <td class="ws-channel-actions"><button class="btn small" data-ws-action="group-channel-edit" data-group-jid="${escape(row.groupJid)}">${page.editing === row.groupJid ? '收起' : '编辑'}</button><button class="btn small" data-ws-action="group-channel-history" data-group-jid="${escape(row.groupJid)}">历史</button></td>
        </tr>${page.editing === row.groupJid ? editorRow(page, row) : ''}${historyRow(page, row)}`).join('');
      const empty = page.loading ? '正在读取群组目录…' : page.query || page.pending || page.channel ? '没有符合筛选条件的群组。' : '尚未发现群组。登录专用 WS 后，群组会从真实会话自动进入目录。';
      return `<section class="ws-workspace-card zk-surface ws-channel-centre" aria-busy="${page.loading || page.saving}">
        <div class="ws-card-heading"><div><strong>群组渠道配置中心</strong><span>以真实群组ID为准，群组改名不会丢失配置。渠道只来自手动配置或已确认的编号规则。</span></div>
          <div class="ws-channel-summary"><span>群组 <b>${Number(page.summary.total) || 0}</b></span><span class="is-warn">待配置 <b>${Number(page.summary.pending) || 0}</b></span><span>已配置 <b>${Number(page.summary.configured) || 0}</b></span></div></div>
        <div class="ws-channel-toolbar">
          <input type="search" data-ws-channel-search value="${escape(page.query)}" placeholder="搜索群名、群组ID、编号、渠道、助理" aria-label="搜索群组">
          <select data-ws-channel-filter="pending" aria-label="配置状态"><option value="">全部状态</option><option value="1" ${page.pending === '1' ? 'selected' : ''}>待配置</option><option value="0" ${page.pending === '0' ? 'selected' : ''}>已配置</option></select>
          <select data-ws-channel-filter="channel" aria-label="渠道">${channelOptions(page, page.channel)}</select>
          <span class="ws-channel-toolbar-spacer"></span>
          <button class="btn small" data-ws-action="group-channel-import-toggle">${page.importOpen ? '收起导入' : '导入 Excel/CSV'}</button>
          <button class="btn small" data-ws-action="group-channel-export" ${!page.summary.total ? 'disabled' : ''}>导出</button>
        </div>
        ${page.error ? `<p class="ws-error-line" role="alert">${escape(page.error)}</p>` : ''}${page.notice ? `<p class="ws-channel-notice" role="status">${escape(page.notice)}</p>` : ''}
        ${batchBar(page)}
        <div class="ws-group-table-wrap"><table class="ws-group-table ws-channel-table"><thead><tr><th><input type="checkbox" aria-label="选择本页" data-ws-action="group-channel-select-page" ${allOnPage ? 'checked' : ''}></th><th>群组</th><th>编号</th><th>渠道</th><th>页面分类</th><th>跟进助理</th><th>建档 / 监测</th><th>状态</th><th>操作</th></tr></thead>
        <tbody>${tableRows || `<tr><td colspan="9" class="ws-channel-empty">${escape(empty)}</td></tr>`}</tbody></table></div>
        ${win.pages > 1 ? `<div class="ws-channel-pager"><button class="btn small" data-ws-action="group-channel-previous" ${win.number <= 1 ? 'disabled' : ''}>上一页</button><span>第 ${win.number} / ${win.pages} 页 · 共 ${page.rows.length} 个</span><button class="btn small" data-ws-action="group-channel-next" ${win.number >= win.pages ? 'disabled' : ''}>下一页</button></div>` : ''}
        ${page.rules.length ? `<p class="ws-muted">已确认的编号规则：${page.rules.filter(rule => rule.enabled).map(rule => `${escape(rule.groupCode)} → ${escape(rule.channel)}`).join('，') || '无'}</p>` : ''}
      </section>${importPanel(page)}`;
    }
    return Object.freeze({ load, run, control, render, reset, discardStale });
  }
  const api = Object.freeze({ create });
  if (typeof module === 'object' && module.exports) module.exports = api;
  else window.ZhikeWsGroupChannels = api;
})();
