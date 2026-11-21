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
  // Duplicate-customer merge and its single-step undo.
  //
  // A merge changes only (1) the survivor's merged fields, (2) the duplicates'
  // deleted/duplicateOf marks and (3) the customerId of business records that
  // pointed at a duplicate. The undo point therefore stores just those
  // customers (before and after) and references to the moved records. Undo
  // restores exactly that scope, leaves every unrelated workspace setting and
  // record as it is now, and refuses when any involved item changed since.
  const MERGE_UNDO_VERSION = 2;
  const MERGE_RECORD_KEYS = ['tickets', 'deposits', 'followups', 'registrations', 'phoneRegistry'];
  const stableJson = value => JSON.stringify(value, (key, item) => item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.keys(item).sort().map(name => [name, item[name]])) : item);
  const sameData = (left, right) => stableJson(left) === stableJson(right);
  const replaceObject = (target, source) => { for (const key of Object.keys(target)) delete target[key]; Object.assign(target, clone(source)); };
  const byId = (list, id) => (list || []).filter(row => row && String(row.id) === String(id));
  function mergeCustomerFields(survivor, duplicates, deletedAt) {
    for (const duplicate of duplicates) {
      const duplicatePhone = duplicate.phone || duplicate.rawPhone; if (duplicatePhone) survivor.legacyPhones = [...new Set([...(survivor.legacyPhones || []), duplicatePhone])];
      for (const key of ['tags']) survivor[key] = [...new Set([...(survivor[key] || []), ...(duplicate[key] || [])])];
      if (!survivor.note && duplicate.note) survivor.note = duplicate.note; else if (survivor.note && duplicate.note && !survivor.note.includes(duplicate.note)) survivor.note = `${survivor.note}\n${duplicate.note}`.slice(0, 2000);
      survivor.hot = Boolean(survivor.hot || duplicate.hot); survivor.favorite = Boolean(survivor.favorite || duplicate.favorite); survivor.investor = Boolean(survivor.investor || duplicate.investor); duplicate.deleted = true; duplicate.deletedAt = deletedAt(duplicate); duplicate.duplicateOf = survivor.id;
    }
  }
  // Converts an undo point written by an earlier version (a full workspace
  // backup) into the same scoped plan, so legacy undo cannot overwrite
  // settings or unrelated records either.
  function legacyMergePlan(merge, state) {
    const backup = merge.backup || {}, ids = [String(merge.survivorId), ...(merge.duplicateIds || []).map(String)];
    const before = ids.map(id => byId(backup.customers, id));
    if (before.some(rows => rows.length !== 1)) return { conflicts: ['合并前备份中缺少或重复了相关客户'] };
    const customersBefore = before.map(rows => clone(rows[0]));
    const customersAfter = clone(customersBefore), survivorAfter = customersAfter[0];
    mergeCustomerFields(survivorAfter, customersAfter.slice(1), duplicate => byId(state.customers, duplicate.id)[0]?.deletedAt ?? duplicate.deletedAt);
    const duplicateIds = new Set(ids.slice(1)), movedRecords = [];
    for (const key of MERGE_RECORD_KEYS) (backup[key] || []).forEach((record, index) => {
      if (!record || !duplicateIds.has(String(record.customerId))) return;
      const ref = { key, from: record.customerId, to: survivorAfter.id };
      if (record.id !== undefined && record.id !== null && record.id !== '') ref.id = record.id; else { ref.index = index; ref.after = { ...clone(record), customerId: survivorAfter.id }; }
      movedRecords.push(ref);
    });
    const createdAt = Date.parse(merge.createdAt || 0), operation = (state.batchOperations || []).find(op => op?.type === '合并重复客户' && Math.abs(Date.parse(op.createdAt || 0) - createdAt) < 5000);
    return { version: MERGE_UNDO_VERSION, survivorId: survivorAfter.id, duplicateIds: ids.slice(1), customersBefore, customersAfter, movedRecords, batchOperationId: operation?.id ?? null };
  }
  function resolveMergePlan(merge, state) {
    if (!merge || typeof merge !== 'object') return { conflicts: ['没有可撤销的客户合并'] };
    if (merge.version === MERGE_UNDO_VERSION) return merge;
    if (merge.version === undefined && merge.backup) return legacyMergePlan(merge, state);
    return { conflicts: [`撤销记录版本 ${merge.version} 不受支持`] };
  }
  function locateMovedRecord(state, ref) {
    const list = state[ref.key] || [];
    if (ref.id !== undefined) { const rows = byId(list, ref.id); return rows.length === 1 ? { record: rows[0] } : { conflict: rows.length ? `${ref.key} 记录 ${ref.id} 的编号重复` : `${ref.key} 记录 ${ref.id} 已不存在` }; }
    const record = list[ref.index];
    return record && sameData(record, ref.after) ? { record } : { conflict: `${ref.key} 中一条无编号记录已变化` };
  }
  // Every involved customer and record must be exactly as the merge left it;
  // anything else is a later edit, a deletion or an ID collision.
  function mergeUndoConflicts(plan, state) {
    if (plan.conflicts) return { conflicts: plan.conflicts };
    const conflicts = [], customers = [], records = [];
    plan.customersAfter.forEach(after => {
      const rows = byId(state.customers, after.id);
      if (rows.length !== 1) conflicts.push(rows.length ? `客户编号 ${after.id} 重复` : `客户 ${after.name || after.id} 已不存在`);
      else if (!sameData(rows[0], after)) conflicts.push(`客户 ${after.name || after.id} 在合并后已被修改`);
      else customers.push(rows[0]);
    });
    for (const ref of plan.movedRecords) {
      const found = locateMovedRecord(state, ref);
      if (found.conflict) conflicts.push(found.conflict);
      else if (String(found.record.customerId) !== String(ref.to)) conflicts.push(`${ref.key} 记录 ${ref.id ?? ref.index} 已转给其他客户`);
      else records.push({ record: found.record, ref });
    }
    return { conflicts, customers, records };
  }
  async function applyMerge() {
    const groups = duplicateGroups(), index = Number(document.querySelector('#mergeDuplicateGroup')?.value), group = groups[index]?.[1] || [], survivorId = document.querySelector('#mergeSurvivor')?.value, survivor = group.find(row => String(row.id) === String(survivorId)), duplicates = group.filter(row => String(row.id) !== String(survivorId));
    if (!survivor || !duplicates.length) return;
    const h = host(), state = h.state, involved = [survivor, ...duplicates];
    if (involved.some(row => byId(state.customers, row.id).length !== 1)) { h.toast('相关客户编号重复，无法安全合并，请先人工处理', 'x'); return; }
    if (!await h.snapshotBeforeWrite('合并重复客户前自动快照')) return;
    if (involved.some(row => { const rows = byId(h.state.customers, row.id); return rows.length !== 1 || rows[0] !== row; })) { h.toast('客户资料在合并确认期间已变化，请重新打开合并向导', 'x'); return; }
    const customersBefore = involved.map(row => clone(row)), previousMerge = state.settings.lastCustomerMerge ?? null, duplicateIds = new Set(duplicates.map(row => String(row.id)));
    const movedRecords = [], moved = [];
    for (const key of MERGE_RECORD_KEYS) (state[key] || []).forEach((record, recordIndex) => {
      if (!record || !duplicateIds.has(String(record.customerId))) return;
      const ref = { key, from: record.customerId, to: survivor.id };
      if (record.id !== undefined && record.id !== null && record.id !== '') ref.id = record.id; else ref.index = recordIndex;
      movedRecords.push(ref); moved.push({ record, ref });
    });
    const now = new Date().toISOString(), operationId = `MERGE-${Date.now()}`;
    let activityId = null;
    try {
      for (const { record } of moved) record.customerId = survivor.id;
      for (const { record, ref } of moved) if (ref.index !== undefined) ref.after = clone(record);
      mergeCustomerFields(survivor, duplicates, () => now);
      state.settings.lastCustomerMerge = { version: MERGE_UNDO_VERSION, createdAt: now, survivorId: survivor.id, duplicateIds: duplicates.map(row => row.id), customersBefore, customersAfter: involved.map(row => clone(row)), movedRecords, batchOperationId: operationId };
      state.batchOperations.unshift({ id: operationId, type: '合并重复客户', value: survivor.name, count: duplicates.length, createdAt: now, status: '已执行' });
      h.persist(); h.activity(`合并重复客户：保留 ${survivor.name}，合并 ${duplicates.length} 位`); activityId = state.activities?.[0]?.id ?? null; await h.flushStateWrites(); h.closeModal(); h.render(); h.toast(`已合并 ${duplicates.length} 位重复客户，业务记录已转移`);
    } catch (error) {
      // Roll back only what this merge touched and keep the previous undo point.
      involved.forEach((row, rowIndex) => replaceObject(row, customersBefore[rowIndex]));
      for (const { record, ref } of moved) record.customerId = ref.from;
      state.settings.lastCustomerMerge = previousMerge;
      state.batchOperations = (state.batchOperations || []).filter(op => op?.id !== operationId);
      if (activityId) state.activities = (state.activities || []).filter(item => item?.id !== activityId);
      h.persist(); h.render(); h.toast(`合并失败，已恢复原资料：${error.message || '保存失败'}`, 'x');
    }
  }
  async function undoMerge() {
    const h = host(), merge = h.state.settings.lastCustomerMerge;
    if (!merge) { h.toast('没有可撤销的客户合并'); return; }
    const refuse = conflicts => h.toast(`无法安全撤销上次合并：${conflicts.slice(0, 3).join('；')}${conflicts.length > 3 ? ` 等 ${conflicts.length} 项` : ''}。撤销点已保留，请核对后人工处理，或使用“合并重复客户前自动快照”恢复。`, 'x');
    const plan = resolveMergePlan(merge, h.state);
    let check = mergeUndoConflicts(plan, h.state);
    if (check.conflicts.length) { refuse(check.conflicts); return; }
    if (!confirm('撤销上次客户合并？将恢复参与合并的客户和已转移的业务记录，其他资料和设置保持不变。')) return;
    if (!await h.snapshotBeforeWrite('撤销客户合并前自动快照')) return;
    // The snapshot is asynchronous; re-check against the state as it is now.
    if (!sameData(h.state.settings.lastCustomerMerge, merge)) { h.toast('撤销点已变化，请重新操作', 'x'); return; }
    check = mergeUndoConflicts(plan, h.state);
    if (check.conflicts.length) { refuse(check.conflicts); return; }
    const state = h.state, customersNow = check.customers.map(row => clone(row)), operation = plan.batchOperationId == null ? null : byId(state.batchOperations, plan.batchOperationId)[0] || null, operationNow = operation ? clone(operation) : null;
    let activityId = null;
    try {
      check.customers.forEach((row, rowIndex) => replaceObject(row, plan.customersBefore[rowIndex]));
      for (const { record, ref } of check.records) record.customerId = ref.from;
      if (operation) { operation.status = '已撤销'; operation.undoneAt = new Date().toISOString(); }
      state.settings.lastCustomerMerge = null;
      h.persist(); h.activity('撤销上次客户合并'); activityId = state.activities?.[0]?.id ?? null; await h.flushStateWrites(); h.render(); h.toast('已撤销客户合并');
    } catch (error) {
      check.customers.forEach((row, rowIndex) => replaceObject(row, customersNow[rowIndex]));
      for (const { record, ref } of check.records) record.customerId = ref.to;
      if (operation) replaceObject(operation, operationNow);
      state.settings.lastCustomerMerge = merge;
      if (activityId) state.activities = (state.activities || []).filter(item => item?.id !== activityId);
      h.persist(); h.render(); h.toast(`撤销失败：${error.message || '保存失败'}`, 'x');
    }
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
