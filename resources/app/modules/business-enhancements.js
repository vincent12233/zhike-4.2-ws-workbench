(() => {
  'use strict';
  const host = () => window.__zhikeRegistryHost;
  const view = document.querySelector('#viewContainer');
  if (!view) return;
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
  const clone = value => JSON.parse(JSON.stringify(value));
  const normalizePhone = value => { const digits = String(value ?? '').replace(/\D/g, ''); return digits.length === 12 && digits.startsWith('91') ? digits.slice(2) : digits; };
  const recordCustomerIds = state => new Set((state.customers || []).filter(c => !c.deleted).map(c => String(c.id)));
  const recordsFor = kind => {
    const state = host()?.state;
    if (!state) return [];
    const ids = recordCustomerIds(state), phones = new Set((state.customers || []).filter(c => !c.deleted).flatMap(c => [c.phone, c.rawPhone].map(normalizePhone)).filter(Boolean));
    const list = kind === 'ticket' ? state.tickets : state.deposits;
    return (list || []).filter(record => ids.has(String(record.customerId)) || phones.has(normalizePhone(record.phone))).slice(0, 200);
  };
  const businessSignature = (record, kind) => {
    if (kind === 'ticket' && window.ZhikeTicketRecords?.ticketRecordKey) return window.ZhikeTicketRecords.ticketRecordKey(record);
    const clean = value => String(value ?? '').trim().toLocaleLowerCase();
    const owner = clean(record?.customerId || record?.customer || record?.phone);
    const date = clean(String(record?.date || '').slice(0, 10));
    const note = clean(record?.note);
    return kind === 'ticket'
      ? [owner, date, clean(record?.product || '未指定'), clean(record?.direction || ''), note].join('|')
      : [owner, date, Number(record?.amount) || 0, clean(record?.currency || 'INR'), note].join('|');
  };
  const labelFor = kind => kind === 'ticket' ? '跟票' : '入金';
  const fieldMarkup = kind => kind === 'ticket'
    ? '<label class="business-batch-field"><input type="checkbox" data-biz-field="date"><span>统一日期</span><input type="date" data-biz-value="date"></label><label class="business-batch-field"><input type="checkbox" data-biz-field="product"><span>统一产品/代码</span><input data-biz-value="product" placeholder="留空不修改"></label><label class="business-batch-field"><input type="checkbox" data-biz-field="direction"><span>统一方向</span><select data-biz-value="direction"><option>买入</option><option>卖出</option><option>关注</option></select></label><label class="business-batch-field"><input type="checkbox" data-biz-field="note"><span>统一备注</span><input data-biz-value="note" placeholder="留空不修改"></label>'
    : '<label class="business-batch-field"><input type="checkbox" data-biz-field="date"><span>统一日期</span><input type="date" data-biz-value="date"></label><label class="business-batch-field"><input type="checkbox" data-biz-field="amount"><span>统一金额</span><input type="number" min="0" data-biz-value="amount" placeholder="留空不修改"></label><label class="business-batch-field"><input type="checkbox" data-biz-field="currency"><span>统一币种</span><select data-biz-value="currency"><option>INR</option><option>USD</option><option>CNY</option></select></label><label class="business-batch-field"><input type="checkbox" data-biz-field="note"><span>统一备注</span><input data-biz-value="note" placeholder="留空不修改"></label>';
  let pendingBatch = null;
  function openBatchSelector(kind) {
    const rows = recordsFor(kind), label = labelFor(kind);
    if (!rows.length) { host()?.toast(`当前没有可批量编辑的${label}记录`, 'x'); return; }
    const state = host().state;
    const customer = id => (state.customers || []).find(c => String(c.id) === String(id));
    const list = rows.map(record => { const c = customer(record.customerId), recordDate = kind === 'ticket' ? (window.ZhikeTicketRecords?.effectiveTicketDate?.(record) || record.date) : record.date; return `<label class="business-batch-record"><input type="checkbox" data-biz-record="${esc(record.id)}"><span><strong>${esc(c?.name || record.customer || '未关联客户')}</strong> · ${esc(recordDate || '未记录')} · ${esc(kind === 'ticket' ? record.product || '未指定' : String(record.amount ?? 0) + ' ' + (record.currency || 'INR'))}<small>${esc(record.note || '')}</small></span></label>`; }).join('');
    host().openModal(`批量编辑${label}`, `选择记录后设置需要统一修改的字段，其他字段保持原值。最多展示 ${rows.length} 条。`, `<div class="business-batch-list">${list}</div><div class="business-batch-fields">${fieldMarkup(kind)}</div><div class="notice-line">系统会在写入前检查完全重复记录；不同票据和不同入金不会互相拦截。</div>`, `<button class="btn" data-action="close-modal">取消</button><button class="btn primary" data-be-action="batch-preview-business" data-kind="${kind}">预览变更</button>`);
  }
  function readBatchDraft(kind) {
    const selected = [...document.querySelectorAll('[data-biz-record]:checked')].map(input => String(input.dataset.bizRecord));
    if (!selected.length) throw new Error('请先选择至少一条记录');
    const fields = {};
    document.querySelectorAll('[data-biz-field]:checked').forEach(input => {
      const key = input.dataset.bizField, value = document.querySelector(`[data-biz-value="${key}"]`)?.value ?? '';
      if (key === 'date' && !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('统一日期格式无效');
      if (key === 'amount' && (!value || !Number.isFinite(Number(value)) || Number(value) <= 0)) throw new Error('统一金额必须大于 0');
      fields[key] = key === 'amount' ? Number(value) : String(value).trim();
    });
    if (!Object.keys(fields).length) throw new Error('请至少选择一个需要修改的字段');
    return { kind, selected, fields };
  }
  function previewBatch(kind) {
    try {
      const draft = readBatchDraft(kind), state = host().state, list = kind === 'ticket' ? state.tickets : state.deposits, selected = list.filter(record => draft.selected.includes(String(record.id))), after = selected.map(record => { if (kind !== 'ticket') return { ...record, ...draft.fields }; const next = { ...record, ...draft.fields }; const previousDirection = window.ZhikeTicketRecords?.normalizeDirection?.(record.direction) || record.direction; const direction = window.ZhikeTicketRecords?.normalizeDirection?.(next.direction) || next.direction; if (direction !== previousDirection || direction === '关注') { next.buyDate = ''; next.sellDate = ''; } if (Object.hasOwn(draft.fields, 'date')) { if (direction === '买入') next.buyDate = draft.fields.date; else if (direction === '卖出') next.sellDate = draft.fields.date; } return window.ZhikeTicketRecords?.normalizeTicketRecord?.(next) || next; });
      const selectedIds = new Set(draft.selected), signatureOwners = new Map(), conflicts = [];
      for (const candidate of after) {
        const signature = businessSignature(candidate, kind), owner = signatureOwners.get(signature);
        if (owner && String(owner.id) !== String(candidate.id)) conflicts.push(candidate);
        else signatureOwners.set(signature, candidate);
        if (list.some(record => !selectedIds.has(String(record.id)) && businessSignature(record, kind) === signature)) conflicts.push(candidate);
      }
      pendingBatch = { ...draft, before: selected.map(clone), after, conflicts: conflicts.map(clone) };
      const label = labelFor(kind), names = after.slice(0, 20).map((record, index) => `<span class="batch-preview-name">${esc(record.customer || record.phone || record.id)} · ${esc(String(selected[index].date || ''))} → ${esc(String(record.date || ''))}</span>`).join('');
      host().openModal(`确认批量编辑${label}`, `将修改 ${after.length} 条记录${conflicts.length ? `，发现 ${conflicts.length} 条会形成完全重复` : ''}`, `<div class="batch-preview-summary"><div><span>已选择</span><strong>${after.length}</strong></div><div><span>完全重复</span><strong>${conflicts.length}</strong></div><div><span>字段</span><strong>${Object.keys(draft.fields).length}</strong></div></div><div class="batch-preview-list">${names}</div>${conflicts.length ? '<div class="notice-line danger-line">存在完全重复记录，本次操作已阻止写入。</div>' : ''}`, `<button class="btn" data-action="close-modal">取消</button><button class="btn primary" data-be-action="batch-apply-business" data-kind="${kind}" ${conflicts.length ? 'disabled' : ''}>确认并执行</button>`);
    } catch (error) { host()?.toast(error.message, 'x'); }
  }
  async function applyBatch(kind) {
    if (!pendingBatch || pendingBatch.kind !== kind || pendingBatch.conflicts.length) return;
    const h = host(), state = h.state, list = kind === 'ticket' ? state.tickets : state.deposits, ids = new Set(pendingBatch.selected);
    if (!await h.snapshotBeforeWrite(`批量编辑${labelFor(kind)}前自动快照`)) return;
    const before = pendingBatch.before, after = pendingBatch.after.map(clone), settingsBefore = clone(state.settings), activitiesBefore = clone(state.activities || []), now = new Date().toISOString();
    try {
      for (const beforeRecord of before) {
        const current = list.find(record => String(record.id) === String(beforeRecord.id));
        if (!current || JSON.stringify(current) !== JSON.stringify(beforeRecord)) throw new Error('预览后记录已发生变化，请重新打开批量编辑。');
      }
      for (const record of list) { const index = pendingBatch.selected.indexOf(String(record.id)); if (index >= 0) Object.assign(record, pendingBatch.after[index]); }
      state.settings.businessBatchUndo = { kind, createdAt: now, before, after, ids: [...ids] };
      h.persist(); h.activity(`批量编辑${labelFor(kind)} ${after.length} 条`); await h.flushStateWrites(); pendingBatch = null; h.closeModal(); h.render(); h.toast(`已保存 ${after.length} 条${labelFor(kind)}记录，可撤销本次批量编辑`);
    } catch (error) {
      list.forEach(record => { const index = before.findIndex(item => String(item.id) === String(record.id)); if (index >= 0) Object.assign(record, before[index]); }); state.settings = settingsBefore; state.activities = activitiesBefore;
      h.persist(); h.render(); h.toast(`批量编辑失败，已恢复原记录：${error.message || '保存失败'}`, 'x');
    }
  }
  async function undoBatch(kind) {
    const h = host(), undo = h.state.settings.businessBatchUndo;
    if (!undo || undo.kind !== kind) { h.toast('没有可撤销的批量编辑'); return; }
    if (!confirm(`撤销上次批量编辑的 ${undo.before.length} 条${labelFor(kind)}记录？`)) return;
    if (!await h.snapshotBeforeWrite(`撤销批量编辑${labelFor(kind)}前自动快照`)) return;
    const list = kind === 'ticket' ? h.state.tickets : h.state.deposits, beforeRecords = clone(list), beforeSettings = clone(h.state.settings), beforeActivities = clone(h.state.activities || []);
    try { for (const before of undo.before) { const current = list.find(record => String(record.id) === String(before.id)); if (current) Object.assign(current, before); } h.state.settings.businessBatchUndo = null; h.persist(); h.activity(`撤销批量编辑${labelFor(kind)} ${undo.before.length} 条`); await h.flushStateWrites(); h.render(); h.toast(`已撤销批量编辑，恢复 ${undo.before.length} 条记录`); } catch (error) { h.state.tickets = kind === 'ticket' ? beforeRecords : h.state.tickets; h.state.deposits = kind === 'deposit' ? beforeRecords : h.state.deposits; h.state.settings = beforeSettings; h.state.activities = beforeActivities; h.persist(); h.render(); h.toast(`撤销失败：${error.message || '保存失败'}`, 'x'); }
  }
  function duplicateGroups() {
    const state = host()?.state, groups = new Map();
    for (const customer of (state?.customers || []).filter(c => !c.deleted)) { const phone = normalizePhone(customer.phone || customer.rawPhone); if (phone.length !== 10) continue; if (!groups.has(phone)) groups.set(phone, []); groups.get(phone).push(customer); }
    return [...groups.entries()].filter(([, rows]) => rows.length > 1);
  }
  function openMergeWizard() {
    const groups = duplicateGroups();
    if (!groups.length) { host()?.toast('当前没有可合并的重复客户'); return; }
    const options = groups.map(([phone, rows], index) => `<option value="${index}">${esc(phone)} · ${rows.length} 位客户 · ${esc(rows.map(row => row.name).join('、'))}</option>`).join('');
    host().openModal('合并重复客户', '仅处理客户资料重复。跟票、入金和跟进记录会转移到保留客户，业务记录仍按各自完整字段判断重复。', `<label class="filter-field"><span>重复号码组</span><select id="mergeDuplicateGroup">${options}</select></label><div id="mergeDuplicateMembers" class="merge-members"></div><div class="notice-line">合并后重复客户进入回收站，可通过“撤销上次合并”恢复。系统不会永久删除资料。</div>`, `<button class="btn" data-action="close-modal">取消</button><button class="btn primary" data-be-action="merge-apply" disabled>确认合并</button>`);
    const select = document.querySelector('#mergeDuplicateGroup');
    const update = () => { const rows = groups[Number(select.value)]?.[1] || []; document.querySelector('#mergeDuplicateMembers').innerHTML = `<label class="filter-field"><span>保留客户</span><select id="mergeSurvivor">${rows.map(row => `<option value="${esc(row.id)}">${esc(row.name)} · ${esc(row.rawPhone || row.phone)} · ${row.touched ? '已修改' : '原始资料'}</option>`).join('')}</select></label>${rows.map(row => `<div class="merge-member"><strong>${esc(row.name)}</strong><span>${esc(row.rawPhone || row.phone)} · ${esc(row.source || '未分类')} · ${esc(row.status || '未记录')}</span></div>`).join('')}`; document.querySelector('[data-be-action="merge-apply"]').disabled = rows.length < 2; };
    select?.addEventListener('change', update); update();
  }
  async function applyMerge() {
    const groups = duplicateGroups(), index = Number(document.querySelector('#mergeDuplicateGroup')?.value), group = groups[index]?.[1] || [], survivorId = document.querySelector('#mergeSurvivor')?.value, survivor = group.find(row => String(row.id) === String(survivorId)), duplicates = group.filter(row => String(row.id) !== String(survivorId));
    if (!survivor || !duplicates.length) return;
    const h = host(), state = h.state, affectedIds = new Set([survivor.id, ...duplicates.map(row => row.id)]), backup = { customers: clone(state.customers), tickets: clone(state.tickets), deposits: clone(state.deposits), followups: clone(state.followups), registrations: clone(state.registrations), phoneRegistry: clone(state.phoneRegistry), settings: clone(state.settings), activities: clone(state.activities || []), batchOperations: clone(state.batchOperations || []) };
    if (!await h.snapshotBeforeWrite('合并重复客户前自动快照')) return;
    try {
      for (const duplicate of duplicates) {
        for (const key of ['tickets', 'deposits', 'followups', 'registrations', 'phoneRegistry']) for (const record of state[key] || []) if (String(record.customerId) === String(duplicate.id)) record.customerId = survivor.id;
        const duplicatePhone = duplicate.phone || duplicate.rawPhone; if (duplicatePhone) survivor.legacyPhones = [...new Set([...(survivor.legacyPhones || []), duplicatePhone])];
        for (const key of ['tags']) survivor[key] = [...new Set([...(survivor[key] || []), ...(duplicate[key] || [])])];
        if (!survivor.note && duplicate.note) survivor.note = duplicate.note; else if (survivor.note && duplicate.note && !survivor.note.includes(duplicate.note)) survivor.note = `${survivor.note}\n${duplicate.note}`.slice(0, 2000);
        survivor.hot = Boolean(survivor.hot || duplicate.hot); survivor.favorite = Boolean(survivor.favorite || duplicate.favorite); survivor.investor = Boolean(survivor.investor || duplicate.investor); duplicate.deleted = true; duplicate.deletedAt = new Date().toISOString(); duplicate.duplicateOf = survivor.id;
      }
      state.settings.lastCustomerMerge = { createdAt: new Date().toISOString(), survivorId: survivor.id, duplicateIds: duplicates.map(row => row.id), backup };
      state.batchOperations.unshift({ id: `MERGE-${Date.now()}`, type: '合并重复客户', value: survivor.name, count: duplicates.length, createdAt: new Date().toISOString(), status: '已执行' });
      h.persist(); h.activity(`合并重复客户：保留 ${survivor.name}，合并 ${duplicates.length} 位`); await h.flushStateWrites(); h.closeModal(); h.render(); h.toast(`已合并 ${duplicates.length} 位重复客户，业务记录已转移`);
    } catch (error) { Object.assign(state, backup); h.persist(); h.render(); h.toast(`合并失败，已恢复原资料：${error.message || '保存失败'}`, 'x'); }
  }
  async function undoMerge() {
    const h = host(), merge = h.state.settings.lastCustomerMerge;
    if (!merge?.backup) { h.toast('没有可撤销的客户合并'); return; }
    if (!confirm('撤销上次客户合并？将恢复重复客户和已转移的业务记录。')) return;
    if (!await h.snapshotBeforeWrite('撤销客户合并前自动快照')) return;
    const beforeUndo = { customers: clone(h.state.customers), tickets: clone(h.state.tickets), deposits: clone(h.state.deposits), followups: clone(h.state.followups), registrations: clone(h.state.registrations), phoneRegistry: clone(h.state.phoneRegistry), settings: clone(h.state.settings), activities: clone(h.state.activities || []), batchOperations: clone(h.state.batchOperations || []) }; Object.assign(h.state, clone(merge.backup)); h.state.settings.lastCustomerMerge = null; h.persist(); h.activity('撤销上次客户合并'); try { await h.flushStateWrites(); h.render(); h.toast('已撤销客户合并'); } catch (error) { Object.assign(h.state, beforeUndo); h.persist(); h.render(); h.toast(`撤销失败：${error.message || '保存失败'}`, 'x'); }
  }
  function mount() {
    const h = host(); if (!h) return;
    if (h.state.view === 'tickets' || h.state.view === 'deposits') {
      const kind = h.state.view === 'tickets' ? 'ticket' : 'deposit', actions = view.querySelector('.page-heading .heading-actions');
      if (actions && !actions.querySelector('[data-business-enhance="batch"]')) actions.insertAdjacentHTML('beforeend', `<button class="btn" data-business-enhance="batch" data-kind="${kind}">批量编辑</button>${h.state.settings.businessBatchUndo?.kind === kind ? `<button class="btn subtle" data-business-enhance="undo" data-kind="${kind}">撤销上次批量编辑</button>` : ''}`);
      if (kind === 'ticket') {
        const select = view.querySelector('select[data-business-product-filter]');
        if (select) {
          const listId = 'ticketProductSearchOptions', input = document.createElement('input'), datalist = document.createElement('datalist');
          datalist.id = listId;
          [...select.options].filter(option => option.value).forEach(option => { const item = document.createElement('option'); item.value = option.value; datalist.append(item); });
          input.className = select.className;
          input.dataset.businessProductFilter = '';
          input.setAttribute('list', listId);
          input.setAttribute('aria-label', '股票代码搜索分类');
          input.placeholder = '输入股票代码';
          input.value = select.value;
          select.replaceWith(input);
          input.after(datalist);
          input.addEventListener('input', () => { clearTimeout(input._filterTimer); input._filterTimer = setTimeout(() => input.dispatchEvent(new Event('change', { bubbles: true })), 160); });
        }
      }
    }
    if (h.state.view === 'quality') {
      const actions = view.querySelector('.page-heading .heading-actions');
      if (actions && !actions.querySelector('[data-business-enhance="merge"]')) actions.insertAdjacentHTML('beforeend', `<button class="btn" data-business-enhance="merge">合并重复客户</button>${h.state.settings.lastCustomerMerge ? '<button class="btn subtle" data-business-enhance="undo-merge">撤销上次合并</button>' : ''}`);
    }
  }
  document.addEventListener('click', event => {
    const button = event.target.closest('[data-business-enhance]'); if (button) { const action = button.dataset.businessEnhance; if (action === 'batch') openBatchSelector(button.dataset.kind); else if (action === 'undo') undoBatch(button.dataset.kind); else if (action === 'merge') openMergeWizard(); else if (action === 'undo-merge') undoMerge(); return; }
    const enhanced = event.target.closest('[data-be-action]'); if (!enhanced) return; const action = enhanced.dataset.beAction; if (action === 'batch-preview-business') previewBatch(enhanced.dataset.kind); else if (action === 'batch-apply-business') applyBatch(enhanced.dataset.kind); else if (action === 'merge-apply') applyMerge();
  });
  let queued = false;
  const refresh = () => {
    if (queued) return;
    queued = true;
    const run = () => {
      queued = false;
      const currentView = host()?.state?.view;
      if (!['tickets', 'deposits', 'quality'].includes(currentView)) return;
      mount();
    };
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(run);
    else queueMicrotask(run);
  };
  new MutationObserver(refresh).observe(view, { childList: true }); refresh();
  window.ZhikeBusinessEnhancements = Object.freeze({ businessSignature, duplicateGroups });
})();
