(() => {
  'use strict';

  let host;
  let core;
  let lastView = '';
  let lastRevision = -1;
  let taskSearchTimer;
  const pendingActions = new Set();

  const esc = value => String(value ?? '').replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]);
  const today = () => {
    const date = new Date();
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  };
  const tomorrow = () => {
    const date = new Date();
    date.setDate(date.getDate() + 1);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  };
  const tasks = () => host.state.settings?.operatingTasks || [];
  const save = async () => {
    host.state.settings = host.state.settings || {};
    host.persist();
    await host.flushStateWrites?.();
  };

  async function newTask() {
    const title = await host.requestText('新建任务', '任务会保存到本机任务中心。', '', { label: '任务标题', maxLength: 200 });
    if (!title?.trim()) return;
    const due = await host.requestText('设置截止日期', '可留空；格式为 YYYY-MM-DD。', today(), { label: '截止日期', type: 'date' });
    if (due === null) return;
    const task = core.createTask({ title, due: due || '' }, host.state.customers);
    const previous = tasks();
    host.state.settings.operatingTasks = [...previous, task];
    try {
      await save();
      host.toast('任务已保存');
      render(true);
    } catch (error) {
      host.state.settings.operatingTasks = previous;
      host.persist();
      host.toast(error.message || '任务保存失败，未写入本机数据', 'x');
    }
  }

  async function callFollowupAction(payload) {
    const configured = host.followupAction || host.wsFollowupAction;
    if (typeof configured === 'function') return configured(payload);
    const stateVersion = typeof host.getStateVersion === 'function' ? String(host.getStateVersion() || '') : '';
    const response = await fetch('/api/ws/followup-action', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(stateVersion ? { 'X-State-Version': stateVersion } : {}) },
      body: JSON.stringify(payload),
    });
    let result = {};
    try { result = await response.json(); } catch (_) { /* Preserve the HTTP error below. */ }
    if (!response.ok || result?.ok === false) throw new Error(result?.error || `跟进操作失败（${response.status}）`);
    return result;
  }

  function followupPayload(task, action, due = '', result = '') {
    return {
      action,
      taskId: String(task.id || ''),
      customerId: String(task.customerId || ''),
      accountId: String(task.wsAccountId || task.accountId || 'default'),
      conversationId: String(task.wsConversationId || ''),
      alertKey: String(task.alertKey || ''),
      followupKey: String(task.wsFollowupKey || ''),
      ...(due ? { due } : {}),
      ...(result ? { result } : {}),
    };
  }

  async function runAiAction(task, action) {
    if (!task?.aiGenerated || pendingActions.has(String(task.id))) return;
    let resultText = '';
    if (action === 'complete') {
      resultText = await host.requestText('完成 AI 跟进', '请记录本次实际跟进结果；保存后才会更新最后跟进日期和统计。', '', { label: '跟进结果', maxLength: 2000 });
      if (!String(resultText || '').trim()) return;
      resultText = String(resultText).trim();
    }
    const due = action === 'snooze' ? tomorrow() : '';
    const snapshot = structuredClone(task);
    pendingActions.add(String(task.id));
    render(true);
    try {
      const configuredAction = typeof (host.followupAction || host.wsFollowupAction) === 'function';
      const result = await callFollowupAction(followupPayload(snapshot, action, due, resultText));
      if (result?.task && typeof result.task === 'object') Object.assign(task, result.task);
      if (!configuredAction && typeof host.refreshState === 'function') await host.refreshState();
      else if (!configuredAction) host.persist();
      host.toast(action === 'complete' ? '跟进结果已登记，任务已完成' : action === 'snooze' ? '已延期到明日' : action === 'dismiss' ? '跟进提醒已忽略' : '跟进任务已重新打开');
    } catch (error) {
      Object.keys(task).forEach(key => delete task[key]);
      Object.assign(task, snapshot);
      host.persist();
      host.toast(error.message || '操作失败，已恢复原任务状态', 'x');
    } finally {
      pendingActions.delete(String(task.id));
      render(true);
    }
  }

  async function toggleManualTask(task) {
    const snapshot = { done: Boolean(task.done), status: task.status, updatedAt: task.updatedAt };
    task.done = !snapshot.done;
    task.status = task.done ? 'done' : 'open';
    task.updatedAt = new Date().toISOString();
    try {
      await save();
      render(true);
    } catch (error) {
      Object.assign(task, snapshot);
      host.persist();
      host.toast(error.message || '任务保存失败，状态已恢复', 'x');
      render(true);
    }
  }

  function taskPage(view) {
    const all = tasks();
    const currentDay = today();
    const query = String(host.state.opsTaskQuery || '').trim();
    const status = ['open', 'done', 'dismissed'].includes(host.state.opsTaskFilter) ? host.state.opsTaskFilter : '';
    const bucket = ['today', 'overdue'].includes(host.state.opsTaskBucket) ? host.state.opsTaskBucket : '';
    const aiOnly = Boolean(host.state.opsTaskAiOnly);
    const owner = String(host.state.opsTaskOwner || '');
    const customerIndex = new Map((host.state.customers || []).map(customer => [String(customer.id), customer]));
    const searchableTasks = all.map(task => {
      const customer = customerIndex.get(String(task.customerId || ''));
      return customer ? { ...task, customerName: customer.name, phone: customer.rawPhone || customer.phone } : task;
    });
    const filtered = core.selectTasks(searchableTasks, { search: query, status, bucket, aiOnly, owner }, currentDay);
    const pageSize = Math.max(20, Number(host.state.opsTaskLimit) || 50);
    const visible = filtered.slice(0, pageSize);
    const open = all.filter(task => !core.taskDone(task)).length;
    const completed = all.filter(task => core.taskCompleted(task)).length;
    const dismissed = all.filter(task => core.taskDismissed(task)).length;
    const ownerOptions = [...new Set(all.map(task => String(task.owner || '未分配')).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'zh-CN'));
    const overdue = all.filter(task => !core.taskDone(task) && core.taskBucket(task, currentDay) === 'overdue').length;
    const dueToday = all.filter(task => !core.taskDone(task) && core.taskBucket(task, currentDay) === 'today').length;
    const aiOpen = all.filter(task => task.aiGenerated && !core.taskDone(task)).length;
    const primaryTask = filtered.find(task => !core.taskDone(task));
    const primaryCustomer = primaryTask ? customerIndex.get(String(primaryTask.customerId || '')) : null;
    const statusButton = (key, label) => `<button class="btn small ${status === key ? 'primary active' : ''}" aria-pressed="${status === key}" data-ops-filter="${key}">${label}</button>`;
    const bucketButton = (key, label) => `<button class="btn small ${bucket === key ? 'primary active' : ''}" aria-pressed="${bucket === key}" data-ops-bucket="${key}">${label}</button>`;

    view.innerHTML = `<div class="page-heading ops6-page-heading"><div><span class="ops6-eyebrow">ACTION ORCHESTRATION</span><h1 class="page-title">任务中心</h1><p class="page-subtitle">统一处理人工任务和 AI 跟进提醒；完成结果实时回写客户档案、首页和统计。</p></div><div class="heading-actions"><button class="btn primary" data-ops="new">新建任务</button></div></div>
      <section class="ops6-command-deck" aria-label="任务执行控制面">
        <div class="ops6-command-copy"><span>今日执行焦点</span><strong>${primaryTask ? esc(primaryTask.title) : '当前没有待处理任务'}</strong><p>${primaryTask ? esc(primaryTask.objective || primaryTask.note || '按优先级开始处理，并在完成后登记实际结果。') : '可以新建人工任务；WS 与 AI 产生的跟进提醒也会自动进入这里。'}</p>${primaryTask ? `<div class="ops6-primary-actions"><button class="btn small primary" data-ops-focus="${esc(primaryTask.id)}">定位首要任务</button>${primaryCustomer ? `<button class="btn small" data-ops-customer="${esc(primaryCustomer.id)}">打开客户档案</button>` : ''}</div>` : '<button class="btn small primary" data-ops="new">新建第一项任务</button>'}</div>
        <div class="ops6-signal-grid"><div><span>待处理</span><strong>${open}</strong><small>全部未关闭任务</small></div><div class="urgent"><span>今日 / 逾期</span><strong>${dueToday} / ${overdue}</strong><small>优先处理时间风险</small></div><div><span>AI 跟进</span><strong>${aiOpen}</strong><small>由聊天分析生成</small></div><div><span>已完成 / 已忽略</span><strong>${completed} / ${dismissed}</strong><small>统计口径独立</small></div></div>
        <aside class="ops6-command-rule"><span>执行链路</span><p>打开客户 → 实际跟进 → 登记结果 → 更新档案与下次计划。</p><em><i></i>跨页状态实时同步</em></aside>
      </section>
      <section class="panel ops6-task-workspace">
        <div class="table-toolbar">
          <label class="input-search"><input data-ops-search placeholder="搜索客户、号码、任务、话术或评分依据" value="${esc(query)}"></label>
          ${statusButton('', '全部')}${statusButton('open', '未完成')}${statusButton('done', '已完成')}${statusButton('dismissed', '已忽略')}
          ${bucketButton('today', '今日')}${bucketButton('overdue', '已逾期')}
          <button class="btn small ${aiOnly ? 'primary active' : ''}" aria-pressed="${aiOnly}" data-ops-ai-only>AI 跟进</button>
          <select class="compact-select" data-ops-owner aria-label="负责人筛选"><option value="">全部负责人</option>${ownerOptions.map(value => `<option value="${esc(value)}" ${owner === value ? 'selected' : ''}>${esc(value)}</option>`).join('')}</select>
        </div>
        <div class="ops-task-list">${visible.map(task => {
          const isDone = core.taskDone(task);
          const resolutionLabel = core.taskDismissed(task) ? ' · 已忽略' : core.taskCompleted(task) ? ' · 已完成' : '';
          const busy = pendingActions.has(String(task.id));
          const customer = customerIndex.get(String(task.customerId || ''));
          const contactName = String(customer?.name || task.customerName || '').trim();
          const contactPhone = String(customer?.rawPhone || customer?.phone || task.phone || '').trim();
          const contactLine = [contactName, contactPhone].filter((value, index, values) => value && values.indexOf(value) === index).join(' · ');
          const priority = task.priority === 'high' ? '高优先级' : task.priority === 'low' ? '低优先级' : '普通';
          const bucketName = core.taskBucket(task, currentDay) === 'overdue' ? '已逾期' : core.taskBucket(task, currentDay) === 'today' ? '今日' : '';
          const actions = task.aiGenerated
            ? `<div class="ops-task-actions">${customer ? `<button class="btn small" data-ops-customer="${esc(customer.id)}">客户档案</button>` : ''}${!isDone ? `<button class="btn small primary" data-ops-ai-action="complete" data-id="${esc(task.id)}" ${busy ? 'disabled' : ''}>完成</button><button class="btn small" data-ops-ai-action="snooze" data-id="${esc(task.id)}" ${busy ? 'disabled' : ''}>延期明日</button><button class="btn small danger-text" data-ops-ai-action="dismiss" data-id="${esc(task.id)}" ${busy ? 'disabled' : ''}>忽略</button>` : `<button class="btn small" data-ops-ai-action="reopen" data-id="${esc(task.id)}" ${busy ? 'disabled' : ''}>重新打开</button>`}</div>`
            : `<button class="ops-check" data-ops="toggle" data-id="${esc(task.id)}" aria-label="${isDone ? '恢复任务' : '完成任务'}">${isDone ? '✓' : '○'}</button>`;
          return `<article class="ops-task ${isDone ? 'done' : ''} ${task.aiGenerated ? 'ai-generated' : ''}" data-ops-task-id="${esc(task.id)}">
            ${task.aiGenerated ? '' : actions}
            <div class="ops-task-copy"><strong>${esc(task.title)}${task.aiGenerated ? ' · AI' : ''}${bucketName ? ` · ${bucketName}` : ''}${resolutionLabel}</strong>${contactLine ? `<small class="ops-task-contact">客户：${esc(contactLine)}</small>` : ''}<p>${esc(task.objective || task.note || '')}</p>${task.suggestedOpener ? `<p><b>建议开场：</b>${esc(task.suggestedOpener)}</p>` : ''}${Array.isArray(task.talkingPoints) && task.talkingPoints.length ? `<small>话题推进：${task.talkingPoints.map(esc).join(' → ')}</small>` : ''}${Array.isArray(task.avoidTopics) && task.avoidTopics.length ? `<small class="ws-error-line">避免：${task.avoidTopics.map(esc).join('；')}</small>` : ''}<span class="ops-task-meta">${esc(task.due || '无截止日期')} · ${esc(task.owner || '未分配')}${task.priorityScore != null ? ` · ${Number(task.priorityScore)}/100` : ''}</span>${task.aiGenerated ? actions : ''}</div>
            <span class="ops-priority ${esc(task.priority)}">${priority}</span>
          </article>`;
        }).join('') || '<div class="ops-empty ops6-empty"><strong>当前筛选没有任务</strong><span>调整筛选条件，或新建一项人工任务。</span><button class="btn small primary" data-ops="new">新建任务</button></div>'}</div>
        ${visible.length < filtered.length ? `<div class="table-footer"><span>已显示 ${visible.length} / ${filtered.length} 条</span><button class="btn small" data-ops="load-more">加载更多</button></div>` : filtered.length ? `<div class="table-footer"><span>已显示全部 ${filtered.length} 条</span></div>` : ''}
      </section>`;

    view.querySelector('[data-ops-search]')?.addEventListener('input', event => {
      host.state.opsTaskQuery = event.target.value;
      host.state.opsTaskLimit = 50;
      clearTimeout(taskSearchTimer);
      taskSearchTimer = setTimeout(() => {
        render(true);
        requestAnimationFrame(() => {
          const input = view.querySelector('[data-ops-search]');
          if (input) { input.focus(); input.setSelectionRange(input.value.length, input.value.length); }
        });
      }, 160);
    });
    view.querySelectorAll('[data-ops="new"]').forEach(button => button.addEventListener('click', newTask));
    view.querySelector('[data-ops-focus]')?.addEventListener('click', event => {
      const target = [...view.querySelectorAll('[data-ops-task-id]')].find(item => item.dataset.opsTaskId === event.currentTarget.dataset.opsFocus);
      target?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      target?.classList.add('ops6-focused');
      setTimeout(() => target?.classList.remove('ops6-focused'), 1400);
    });
    view.querySelector('[data-ops="load-more"]')?.addEventListener('click', () => { host.state.opsTaskLimit = pageSize + 50; render(true); });
    view.querySelectorAll('[data-ops-filter]').forEach(button => button.addEventListener('click', () => { host.state.opsTaskFilter = button.dataset.opsFilter; host.state.opsTaskLimit = 50; render(true); }));
    view.querySelectorAll('[data-ops-bucket]').forEach(button => button.addEventListener('click', () => { host.state.opsTaskBucket = bucket === button.dataset.opsBucket ? '' : button.dataset.opsBucket; host.state.opsTaskLimit = 50; render(true); }));
    view.querySelector('[data-ops-ai-only]')?.addEventListener('click', () => { host.state.opsTaskAiOnly = !aiOnly; host.state.opsTaskLimit = 50; render(true); });
    view.querySelector('[data-ops-owner]')?.addEventListener('change', event => { host.state.opsTaskOwner = event.target.value; host.state.opsTaskLimit = 50; render(true); });
    view.querySelectorAll('[data-ops="toggle"]').forEach(button => button.addEventListener('click', () => toggleManualTask(tasks().find(task => String(task.id) === button.dataset.id))));
    view.querySelectorAll('[data-ops-ai-action]').forEach(button => button.addEventListener('click', () => runAiAction(tasks().find(task => String(task.id) === button.dataset.id), button.dataset.opsAiAction)));
  }

  function boardPage(view) {
    const columns = core.stageColumns(host.state.customers || [], host.state.settings?.optionLists?.phases || ['新客户', '潜在客户', '意向客户', '高意向', '成交客户', '暂停跟进']);
    const allCustomers = columns.flatMap(column => column.customers);
    const total = allCustomers.length;
    const todayKey = today();
    const withoutPlan = allCustomers.filter(customer => !customer.due || customer.due === '—').length;
    const overdue = allCustomers.filter(customer => customer.due && customer.due !== '—' && customer.due < todayKey).length;
    const assigned = allCustomers.filter(customer => customer.assistant && customer.assistant !== '未分配').length;
    const focusIndex = columns.reduce((best, column, index) => column.customers.length > columns[best]?.customers.length ? index : best, 0);
    const focusColumn = columns[focusIndex];
    const stageFlow = columns.map((column, index) => `<button data-stage-index="${index}" style="--ops-stage-share:${Math.max(4, Math.round(column.customers.length / Math.max(1, total) * 100))}%"><span>${esc(column.name)}</span><strong>${column.customers.length}</strong><i></i></button>`).join('');
    const boardColumns = columns.map((column, index) => `<section class="ops-column" data-stage-name="${esc(column.name)}"><button class="ops-stage-open" data-stage-index="${index}"><span><small>STAGE ${String(index + 1).padStart(2, '0')}</small><strong>${esc(column.name)}</strong></span><em>${column.customers.length} 位 · 查看全部 →</em></button><div class="ops-cards">${column.customers.slice(0, 80).map(customer => {const badges=[customer.hot?'热聊':'',customer.vipNumber?'VIP':'',customer.qualification||''].filter(Boolean).slice(0,2);return `<button type="button" class="ops-card ops-customer-open" data-ops-customer="${esc(customer.id)}"><header><strong>${esc(customer.name || '未命名客户')}</strong><span>${esc(customer.source || '未分类')}</span></header>${badges.length?`<div class="ops6-card-tags">${badges.map(badge=>`<i>${esc(badge)}</i>`).join('')}</div>`:''}<div class="ops-card-meta"><span>${esc(customer.assistant || '未分配')}</span><span class="${customer.due && customer.due < todayKey ? 'overdue' : ''}">${esc(customer.due || '未排期')}</span></div><span class="ops-card-link">打开统一客户档案 →</span></button>`;}).join('') || '<div class="ops-empty ops6-stage-empty"><strong>此阶段暂无客户</strong><span>客户阶段更新后会自动出现在这里。</span></div>'}</div>${column.customers.length > 80 ? `<button class="ops6-column-more" data-stage-index="${index}">还有 ${column.customers.length - 80} 位 · 查看完整名单</button>` : ''}</section>`).join('');
    view.innerHTML = `<div class="page-heading ops6-page-heading"><div><span class="ops6-eyebrow">CUSTOMER JOURNEY BOARD</span><h1 class="page-title">客户阶段看板</h1><p class="page-subtitle">阶段保留现有业务规则；名单、客户档案和任务状态使用同一份实时数据。</p></div><div class="heading-actions"><button class="btn" data-stage-open-customers>打开客户中心</button></div></div>
      <section class="ops6-stage-command" aria-label="客户阶段控制面"><div class="ops6-stage-overview"><span>当前客户旅程</span><strong>${total} 位客户 · ${columns.length} 个阶段</strong><p>系统设置中的阶段名称直接驱动看板列；客户资料修改后立即重排，不生成副本。</p>${focusColumn ? `<button class="btn small primary" data-stage-index="${focusIndex}">查看主要阶段 · ${esc(focusColumn.name)}</button>` : ''}</div><div class="ops6-stage-stats"><div><span>已分配助理</span><strong>${assigned}</strong></div><div class="urgent"><span>逾期计划</span><strong>${overdue}</strong></div><div><span>尚未排期</span><strong>${withoutPlan}</strong></div></div><div class="ops6-stage-flow">${stageFlow}</div></section>
      <div class="ops-board">${boardColumns}</div>`;
    view.querySelectorAll('[data-stage-index]').forEach(button => button.addEventListener('click', () => {
      const column = columns[Number(button.dataset.stageIndex)];
      host.openModal(column.name + ' · 客户名单', column.customers.length + ' 位客户', column.customers.length ? '<div class="ops-stage-list">' + column.customers.map(customer => '<button class="btn ops-customer-open" data-ops-customer="' + esc(customer.id) + '">' + esc(customer.name || '未命名客户') + ' · ' + esc(customer.assistant || '未分配') + ' →</button>').join('') + '</div>' : '<div class="ops-empty">当前阶段暂无客户</div>', '<button class="btn" data-action="close-modal">关闭</button>');
    }));
    view.querySelector('[data-stage-open-customers]')?.addEventListener('click', () => document.querySelector('.nav-item[data-view="customers"]')?.click());
  }

  document.addEventListener('click', event => {
    const button = event.target.closest('[data-ops-customer]');
    if (!button || !host) return;
    const customer = host.state.customers.find(item => String(item.id) === button.dataset.opsCustomer && !item.deleted);
    if (!customer) { host.toast('客户已更新，请刷新看板'); return; }
    if (typeof host.showCustomer !== 'function') { host.toast('客户档案尚未准备好，请重试'); return; }
    host.closeModal();
    host.showCustomer(customer);
  });

  function render(force = false) {
    if (!host) return;
    const view = document.querySelector('#viewContainer');
    if (!view) return;
    const currentView = host.state.view;
    const renderedForView = currentView === 'operations' ? Boolean(view.querySelector('.ops-task-list')) : currentView === 'stage-board' ? Boolean(view.querySelector('.ops-board')) : true;
    if (!force && currentView === lastView && lastRevision === (host.state.dataRevision || 0) && view.dataset.opsRendered === '1' && renderedForView) return;
    lastView = currentView;
    lastRevision = host.state.dataRevision || 0;
    if (currentView === 'operations') { view.dataset.opsRendered = '1'; taskPage(view); }
    else if (currentView === 'stage-board') { view.dataset.opsRendered = '1'; boardPage(view); }
    else view.dataset.opsRendered = '0';
  }

  window.ZhikeOperationsUI = Object.freeze({ render });
  function boot() {
    host = window.__zhikeRegistryHost;
    core = window.ZhikeOperationsCore;
    if (host && core) { host.showCustomer = host.showCustomer || window.showCustomer; render(); }
  }
  boot();
  if (!host) window.addEventListener('load', boot, { once: true });
})();
