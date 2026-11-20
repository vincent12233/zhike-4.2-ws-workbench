(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ZhikeWsBusinessPages = api;
})(typeof window !== 'undefined' ? window : globalThis, function (root) {
  'use strict';
  const string = value => String(value == null ? '' : value);
  const redact = value => string(value).replace(/\bBearer\s+[^\s,;]+/gi, 'Bearer [已脱敏]').replace(/\bsk-[a-z0-9_-]{6,}/gi, '[已脱敏]').replace(/((?:api[_ -]?key|access[_ -]?token|authorization|password|cookie|secret)\s*[:=]\s*)[^\s,;]+/gi, '$1[已脱敏]');
  const esc = value => redact(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const missing = value => value == null || string(value).trim() === '' ? '未提供' : value;
  const labels = { pending: '待处理', queued: '已排队', running: '处理中', completed: '已完成', failed: '失败', cancelled: '已取消', retry_scheduled: '待重试', retryable: '可重试', active: '在群', left: '已退群', ignored: '已忽略', applied: '已应用', approved: '已批准', rejected: '已拒绝', conflict: '冲突', linked: '已关联', unlinked: '未关联', valid: '号码格式有效', invalid: '号码待核验', unprovided: '未提供号码', success: '成功', error: '失败', admin: '管理员', superadmin: '群主', member: '成员' };
  const label = value => labels[string(value)] || missing(value);
  const option = (value, text, selected) => `<option value="${esc(value)}"${string(value) === string(selected) ? ' selected' : ''}>${esc(text)}</option>`;
  const field = (name, value) => `<dt>${esc(name)}</dt><dd>${esc(missing(value))}</dd>`;
  const status = value => `<span class="ws-status-badge">${esc(label(value))}</span>`;
  const button = (action, text, view, id = '', disabled = false) => `<button type="button" class="btn small" data-ws-action="${esc(action)}" data-business-view="${esc(view)}" data-record-id="${esc(id)}"${disabled ? ' disabled' : ''}>${esc(text)}</button>`;
  function renderPersonAvatar({ name, size = 'table', selected = false, vip = false }) {
    // The current WS/CRM projections have no authorized personal image field.
    return root.ZhikeAvatar?.render({ name: redact(name), size, selected, vip }) || '';
  }
  function renderAvatarAvailability() {
    return '<p class="ws-muted ws-avatar-availability" data-ws-avatar-capability="blocked">尚未接入获授权的 WhatsApp 头像来源，当前显示姓名首字母或默认头像。</p>';
  }
  function renderPersonIdentity({ name, fallbackName, secondary, size, selected, vip }) {
    const title = missing(string(name).trim() || fallbackName);
    const displayName = string(name).trim() === string(secondary).trim() ? '' : name;
    return `<div class="ws-person-identity">${renderPersonAvatar({ name: displayName, size, selected, vip })}<div class="ws-person-copy"><strong title="${esc(title)}">${esc(title)}</strong>${secondary && title !== secondary ? `<small title="${esc(secondary)}">${esc(secondary)}</small>` : ''}</div></div>`;
  }
  function safeDetails(value, key = '', depth = 0) {
    if (/password|cookie|token|api.?key|authorization|secret|message.?text|original.?text|prompt|payload|raw.?body/i.test(key)) return '[已脱敏]';
    if (depth > 5) return '[层级已限制]';
    if (Array.isArray(value)) return value.slice(0, 30).map(item => safeDetails(item, key, depth + 1));
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).slice(0, 50).map(([name, item]) => [name, safeDetails(item, name, depth + 1)]));
    return typeof value === 'string' ? redact(value).slice(0, 2000) : value;
  }
  function directoryState(page) {
    if (!page.business) page.business = { loaded: false, loading: false, rows: [], total: null, page: 1, pageCount: 1, pageSize: 40, coverage: '', error: '', requestSerial: 0 };
    page.businessFilters ||= {};
    return page.business;
  }
  function buildDirectoryQuery(view, page, accountId) {
    if (!['contacts', 'logs'].includes(view)) throw new Error('不支持的业务查询页面。');
    const filters = page.businessFilters || {};
    const query = new URLSearchParams({ accountId: string(accountId), q: string(page.filter).slice(0, 160), page: string(Math.max(1, Math.floor(Number(page.page) || 1))), pageSize: '40' });
    if (!query.get('accountId').trim()) throw new Error('必须选择明确的账号。');
    if (view === 'contacts') query.set('duplicate', ['duplicate', 'single'].includes(filters.duplicate) ? filters.duplicate : 'all');
    else {
      query.set('category', ['snapshot', 'diagnostic'].includes(filters.category) ? filters.category : 'audit');
      for (const key of ['type', 'sourceType', 'outcome', 'jobId', 'objectId']) if (filters[key]) query.set(key, string(filters[key]).slice(0, 200));
      for (const key of ['from', 'to']) if (filters[key]) {
        const date = new Date(filters[key]);
        if (!Number.isFinite(date.getTime())) throw new Error('时间筛选无效，请重新选择。');
        query.set(key, date.toISOString());
      }
      if (query.has('from') && query.has('to') && query.get('from') > query.get('to')) throw new Error('开始时间不能晚于结束时间。');
    }
    return '/api/ws/workspace/' + (view === 'logs' ? 'audit' : 'contacts') + '?' + query.toString();
  }
  function acceptDirectoryResult(business, result, accountId) {
    if (!string(accountId).trim() || !result || string(result.accountId) !== string(accountId) || !Array.isArray(result.rows) || result.rows.some(row => string(row.accountId) !== string(accountId))) throw new Error('账号作用域不符，已拒绝显示。');
    if (!Number.isSafeInteger(Number(result.total)) || Number(result.total) < 0) throw new Error('目录数量无效，请重试。');
    business.rows = result.rows.slice(0, 40).map(row => safeDetails(row));
    business.total = Math.max(0, Number(result.total) || 0);
    business.page = Math.max(1, Number(result.page) || 1);
    business.pageCount = Math.max(1, Number(result.pageCount) || Math.ceil(business.total / 40));
    business.pageSize = 40;
    business.coverage = result.coverage && typeof result.coverage === 'object' ? '本类来源：' + (result.coverage[result.category] || []).join('、') : string(result.coverage);
    business.sourceTypes = Array.isArray(result.coverage?.[result.category]) ? result.coverage[result.category].slice() : [];
    business.unavailableSources = Array.isArray(result.coverage?.unavailable) ? result.coverage.unavailable.map(item => ({ source: string(item.source), reason: redact(item.reason) })) : [];
    business.unavailableReason = string(result.unavailableReason);
    business.types = Array.isArray(result.types) ? result.types.slice(0, 100) : [];
    business.outcomes = Array.isArray(result.outcomes) ? result.outcomes.slice(0, 100) : [];
    business.category = result.category || '';
    business.loaded = true;
    business.error = '';
    return true;
  }
  async function loadDirectory({ view, page, accountId, request, isCurrent }) {
    const business = directoryState(page), sequence = ++business.requestSerial;
    const expectedCategory = ['snapshot', 'diagnostic'].includes(page.businessFilters.category) ? page.businessFilters.category : 'audit';
    business.loading = true; business.error = ''; business.rows = []; business.total = null; business.loaded = false;
    try {
      const result = await request(buildDirectoryQuery(view, page, accountId));
      if (sequence !== business.requestSerial || !isCurrent()) return false;
      if (view === 'logs' && result.category !== expectedCategory) throw new Error('记录类别不符，已拒绝混合展示。');
      acceptDirectoryResult(business, result, accountId);
      page.page = business.page;
      if (!business.rows.some(row => string(row.id) === string(page.detailId))) page.detailId = '';
      return true;
    } catch (error) {
      if (sequence === business.requestSerial && isCurrent()) { business.error = redact(error?.message || '读取失败，请重试。').slice(0, 240); business.rows = []; business.loaded = false; }
      return false;
    } finally { if (sequence === business.requestSerial) business.loading = false; }
  }
  function pagination(view, current, total, pages, loading = false) {
    return `<div class="ws-workspace-list-pagination"><span>${total == null ? '尚未读取' : `共 ${Number(total).toLocaleString()} 条`} · 每页 40 条</span><button class="btn small" type="button" data-ws-action="business-page" data-business-view="${esc(view)}" data-page-delta="-1"${current <= 1 || loading ? ' disabled' : ''}>上一页</button><span>${current} / ${pages}</span><button class="btn small" type="button" data-ws-action="business-page" data-business-view="${esc(view)}" data-page-delta="1"${current >= pages || loading ? ' disabled' : ''}>下一页</button></div>`;
  }
  function accountSelect(accounts, accountId) {
    return `<label>所属账号<select data-ws-business-account aria-label="业务列表所属账号">${accounts.map(row => option(row.id, row.displayName || row.name || row.id, accountId)).join('')}</select></label>`;
  }
  function renderFilters(view, page, business, accounts, accountId) {
    const filters = page.businessFilters || {};
    const input = (key, title, type = 'text') => `<label>${title}<input type="${type}" data-ws-business-filter="${key}" maxlength="200" value="${esc(filters[key])}"${type === 'text' ? ' placeholder="全部"' : ''}></label>`;
    const extra = view === 'contacts'
      ? `<label>重复号码<select data-ws-business-filter="duplicate">${[['all', '全部'], ['duplicate', '存在重复'], ['single', '无重复']].map(([value, title]) => option(value, title, filters.duplicate || 'all')).join('')}</select></label>`
      : `<label>记录类别<select data-ws-business-filter="category">${[['audit', '正式审计记录'], ['snapshot', '运行状态快照'], ['diagnostic', '诊断日志（未开放）']].map(([value, title]) => option(value, title, filters.category || 'audit')).join('')}</select></label><label>记录来源<select data-ws-business-filter="sourceType">${option('', '全部已接入来源', filters.sourceType)}${[...new Set([...(business.sourceTypes || []), ...(filters.sourceType ? [filters.sourceType] : [])])].map(value => option(value, value, filters.sourceType)).join('')}</select></label>${input('from', '开始时间', 'datetime-local')}${input('to', '结束时间', 'datetime-local')}<label>操作类型<select data-ws-business-filter="type">${option('', '全部', filters.type)}${(business.types || []).map(value => option(value, value, filters.type)).join('')}</select></label><label>操作结果<select data-ws-business-filter="outcome">${option('', '全部', filters.outcome)}${(business.outcomes || []).map(value => option(value, label(value), filters.outcome)).join('')}</select></label>${input('jobId', '关联任务')}${input('objectId', '关联对象')}`;
    return `<form class="ws-business-filter-grid" data-ws-business-form="${view}"><label>搜索<input type="search" data-ws-business-query maxlength="160" value="${esc(page.filter)}" placeholder="${view === 'contacts' ? '姓名、号码或标识' : '动作、任务或对象'}" aria-label="${view === 'contacts' ? '搜索通讯录' : '搜索操作日志'}"></label>${accountSelect(accounts, accountId)}${extra}<div class="ws-business-filter-actions"><button type="submit" class="btn small"${business.loading ? ' disabled' : ''}>${business.loading ? '读取中…' : '查询'}</button>${button('business-reset', '重置筛选', view, '', business.loading)}</div></form>`;
  }
  function renderDirectory(view, page, accounts, accountId) {
    const business = directoryState(page), isContacts = view === 'contacts';
    const rows = business.rows || [];
    const selected = rows.find(row => string(row.id) === string(page.detailId));
    const columns = isContacts ? ['联系人', '原始号码', '规范号码', 'CRM 关联', '重复记录', '数据来源', '更新时间', '详情'] : ['时间', '操作类型', '结果', '来源', '关联任务', '关联对象', '操作者', '详情'];
    const bodyRows = rows.map(row => `<tr${isContacts && selected === row ? ' class="is-selected"' : ''}><td>${isContacts ? renderPersonIdentity({ name: row.name === '未提供' ? '' : row.name, secondary: row.externalId, selected: selected === row }) : `<strong>${esc(missing(row.at))}</strong>`}</td>${isContacts ? `<td>${esc(missing(row.phone))}</td><td>${esc(missing(row.normalizedPhone))}<small>${esc(label(row.phoneStatus))}</small></td><td>${status(row.crmLinkStatus)}<small>${esc(row.customerId)}</small></td><td>${!row.normalizedPhone || row.duplicateCount == null || Number(row.duplicateCount) < 1 ? '未提供，无法判断重复' : Number(row.duplicateCount) > 1 ? `<span class="ws-business-warning">重复 ${Number(row.duplicateCount)} 条</span>` : '无重复'}</td><td>${esc(missing(row.sourceLabel || row.source))}</td><td>${esc(missing(row.updatedAt))}</td>` : `<td>${esc(missing(row.action))}</td><td>${status(row.outcome)}</td><td>${esc(missing(row.source))}</td><td>${esc(missing(row.jobId))}</td><td>${esc(missing(row.objectType))}<small>${esc(row.objectId)}</small></td><td>${esc(missing(row.actor))}</td>`}<td>${button('business-detail', selected?.id === row.id ? '收起' : '查看', view, row.id)}</td></tr>`).join('');
    const detailFields = selected ? isContacts
      ? field('账号', selected.accountId) + field('联系人标识', selected.externalId) + field('本机会话', selected.conversationId) + field('原始号码', selected.phone) + field('规范号码', selected.normalizedPhone) + field('号码状态', label(selected.phoneStatus)) + field('CRM 客户 ID', selected.customerId) + field('关联状态', label(selected.crmLinkStatus)) + field('数据来源', selected.sourceLabel || selected.source) + field('语言', selected.language) + field('更新时间', selected.updatedAt)
      : field('记录类别', selected.category === 'audit' ? '正式审计记录' : '运行状态快照') + field('记录 ID', selected.recordId) + field('数据来源', selected.source) + field('时间', selected.at) + field('账号', selected.accountId) + field('群组', selected.groupJid) + field('关联任务', selected.jobId) + field('关联对象', selected.objectId) + field('关联链路', selected.correlationId) + field('错误或原因', selected.reason) : '';
    const empty = business.loading ? '正在读取本机数据…' : business.error ? '读取失败；请检查错误详情后重试。' : business.unavailableReason || (business.loaded ? '当前筛选条件下没有记录。' : '尚未读取；请点击查询或刷新。');
    const visibleCategory = rows.length ? business.category : page.businessFilters.category || 'audit';
    const category = isContacts ? '已同步本机通讯录' : visibleCategory === 'audit' ? '正式审计记录' : visibleCategory === 'snapshot' ? '运行状态快照' : '诊断日志';
    return `<section class="ws-workspace-card ws-business-directory zk-surface" data-business-directory="${view}" aria-busy="${business.loading ? 'true' : 'false'}"><div class="ws-card-heading"><div><strong>${category}</strong><span>${esc(business.coverage || (isContacts ? '仅展示已同步到本机的联系人目录；不代表 WhatsApp 全部通讯录。' : '查询现有审计来源，不创建第二套审计记录。'))}</span></div>${status(isContacts ? '只读目录' : category)}</div>${renderFilters(view, page, business, accounts, accountId)}${business.error ? `<p class="ws-error-line" role="alert">${esc(business.error)}</p>` : ''}<div class="ws-business-directory-body ${selected ? 'has-detail' : ''}"><div class="ws-business-directory-main"><div class="ws-workspace-table-wrap"><table class="ws-group-table ws-business-table"><thead><tr>${columns.map(title => `<th scope="col">${title}</th>`).join('')}</tr></thead><tbody>${bodyRows || `<tr><td colspan="${columns.length}"><p class="ws-business-empty" role="status">${esc(empty)}</p></td></tr>`}</tbody></table></div>${pagination(view, business.page || 1, business.total, business.pageCount || 1, business.loading)}</div>${selected ? `<aside class="ws-business-detail zk-surface" data-ws-business-selected-detail aria-label="${isContacts ? '联系人详情' : '日志详情'}"><div class="ws-card-heading"><strong>${isContacts ? '联系人详情' : '日志详情'}</strong>${button('business-detail-close', '收起详情', view)}</div>${isContacts ? renderPersonIdentity({ name: selected.name === '未提供' ? '' : selected.name, secondary: selected.externalId, size: 'detail', selected: true }) + renderAvatarAvailability() : ''}<dl>${detailFields}</dl>${!isContacts && selected.details ? `<details><summary>已脱敏记录详情</summary><pre>${esc(JSON.stringify(safeDetails(selected.details), null, 2))}</pre></details>` : ''}${isContacts ? '<p class="ws-muted">通讯录只读；未验证联系人不会自动写入 CRM，也不会覆盖人工资料。</p>' : ''}</aside>` : ''}</div>${!isContacts ? `<p class="ws-muted">正式审计、运行快照和诊断日志分别查询。运行快照不能替代完整审计；诊断文件不通过本页面开放。</p>${business.unavailableSources?.length ? `<details><summary>未接入来源及原因</summary><dl>${business.unavailableSources.map(item => field(item.source, item.reason)).join('')}</dl></details>` : ''}` : ''}</section>`;
  }
  function localWindow(rows, page) {
    const query = string(page.filter).trim().toLowerCase();
    const matched = rows.filter(row => (!page.statusFilter || page.statusFilter === 'all' || string(row.status) === page.statusFilter) && (!page.groupFilter || page.groupFilter === 'all' || string(row.groupJid) === page.groupFilter) && (!query || Object.values(row).some(value => typeof value !== 'object' && string(value).toLowerCase().includes(query))));
    const pageCount = Math.max(1, Math.ceil(matched.length / 40));
    page.page = Math.max(1, Math.min(pageCount, Number(page.page) || 1));
    return { rows: matched.slice((page.page - 1) * 40, page.page * 40), total: matched.length, pageCount };
  }
  function renderMembers(rows, page) {
    const windowed = localWindow(rows, page);
    const groups = [...new Map(rows.map(row => [string(row.groupJid), row.groupName || row.groupJid])).entries()];
    const selected = windowed.rows.find(row => string(row.groupJid) + '|' + string(row.memberJid) === page.detailId);
    return `<div class="ws-business-local-controls"><label>所属群组<select data-ws-member-group>${option('all', '全部已加载群组', page.groupFilter || 'all')}${groups.map(([id, name]) => option(id, name, page.groupFilter)).join('')}</select></label><span>已加载 ${rows.length} 条关系 · 匹配 ${windowed.total} 条（最多读取 1000 条）</span></div><div class="ws-workspace-table-wrap"><table class="ws-group-table ws-business-table"><thead><tr>${['成员', '号码', '所属群组', '角色 / 管理员', '成员状态', '关联客户', '最近观察', '详情'].map(title => `<th>${title}</th>`).join('')}</tr></thead><tbody>${windowed.rows.map(row => `<tr${selected === row ? ' class="is-selected"' : ''}><td>${renderPersonIdentity({ name: row.displayName === row.memberJid ? '' : row.displayName, fallbackName: row.memberJid, secondary: row.memberJid, selected: selected === row })}</td><td>${esc(missing(row.memberPhone))}</td><td>${esc(missing(row.groupName || row.groupJid))}<small>${esc(row.groupJid)}</small></td><td>${esc(label(row.role))}</td><td>${status(row.status)}</td><td>${esc(missing(row.customerId))}</td><td>${esc(missing(row.lastSeenAt || row.updatedAt))}</td><td>${button('business-detail', '查看', 'members', string(row.groupJid) + '|' + string(row.memberJid))}</td></tr>`).join('') || '<tr><td colspan="8">当前已加载范围没有匹配成员。</td></tr>'}</tbody></table></div>${pagination('members', page.page, windowed.total, windowed.pageCount)}${selected ? `<aside class="ws-business-inline-detail zk-surface" data-ws-business-selected-detail><div class="ws-card-heading"><strong>成员关系详情</strong>${button('business-detail-close', '收起详情', 'members')}</div>${renderPersonIdentity({ name: selected.displayName === selected.memberJid ? '' : selected.displayName, fallbackName: selected.memberJid, secondary: selected.memberJid, size: 'detail', selected: true })}${renderAvatarAvailability()}<dl>${field('账号', selected.accountId) + field('群组', selected.groupJid) + field('成员标识', selected.memberJid) + field('角色', label(selected.role)) + field('来源', selected.source) + field('首次观察', selected.firstSeenAt) + field('最近观察', selected.lastSeenAt) + field('人工保护', selected.manualLocked == null ? '' : selected.manualLocked ? '已保护' : '未锁定')}</dl></aside>` : ''}`;
  }
  function customerRows(customers, conversations, accountId) {
    if (!string(accountId).trim()) return [];
    const links = new Map();
    for (const row of conversations || []) if (string(row.accountId) === string(accountId) && row.customerId) {
      const id = string(row.customerId);
      links.set(id, [...(links.get(id) || []), string(row.id)]);
    }
    return (customers || []).filter(row => !row.deleted && links.has(string(row.id))).map(row => ({ id: row.id, accountId, name: row.name, phone: row.phone || row.rawPhone, source: row.source, assistant: row.assistant, status: row.status, phase: row.phase, display: { vip: Boolean(string(row.vipNumber).trim()) }, createdAt: row.createdAt, updatedAt: row.updatedAt, registeredAt: row.registered || row.registeredAt || row.registrationDate, conversations: links.get(string(row.id)) }));
  }
  function renderCustomers(rows, page) {
    const windowed = localWindow(rows, page), selected = rows.find(row => string(row.id) === string(page.detailId));
    return `<section class="ws-workspace-card zk-surface"><div class="ws-card-heading"><div><strong>已关联 CRM 客户</strong><span>唯一客户主档 × 当前账号明确的会话关联；不按姓名猜测或自动建档。</span></div></div><div class="ws-workspace-table-wrap"><table class="ws-group-table ws-business-table"><thead><tr>${['客户', '号码', '渠道', '客户阶段', '状态', '负责人', '详情'].map(title => `<th>${title}</th>`).join('')}</tr></thead><tbody>${windowed.rows.map(row => `<tr${selected === row ? ' class="is-selected"' : ''}><td>${renderPersonIdentity({ name: row.name, secondary: row.id, selected: selected === row, vip: row.display?.vip })}</td><td>${esc(missing(row.phone))}</td><td>${esc(missing(row.source))}</td><td>${esc(missing(row.phase))}</td><td>${esc(label(row.status))}</td><td>${esc(missing(row.assistant))}</td><td>${button('business-detail', '查看档案', 'crm', row.id)}</td></tr>`).join('') || '<tr><td colspan="7">当前账号没有明确关联的匹配客户。</td></tr>'}</tbody></table></div>${pagination('crm', page.page, windowed.total, windowed.pageCount)}${selected ? `<aside class="ws-business-inline-detail zk-surface" data-ws-business-selected-detail><div class="ws-card-heading"><strong>客户主档 · 只读</strong>${button('business-detail-close', '收起详情', 'crm')}</div>${renderPersonIdentity({ name: selected.name, fallbackName: '未命名客户', size: 'detail', selected: true, vip: selected.display?.vip })}${renderAvatarAvailability()}<dl>${field('客户 ID', selected.id) + field('号码', selected.phone) + field('渠道', selected.source) + field('阶段', selected.phase) + field('负责人', selected.assistant) + field('登记日期', selected.registeredAt || selected.createdAt) + field('关联会话', selected.conversations.join('、'))}</dl><p class="ws-muted">人工维护字段不在本列表覆盖；AI 候选、冲突与最终差异在下方原审核中心处理。</p></aside>` : ''}</section>`;
  }
  function renderLocalFilters(view, rows, page) {
    const statuses = [...new Set(rows.map(row => string(row.status)).filter(Boolean))];
    return `<div class="ws-workspace-list-controls"><label>搜索<input id="wsWorkspaceSearch-${view}" data-ws-workspace-search="${view}" type="search" maxlength="160" value="${esc(page.filter)}" placeholder="搜索当前已加载记录"></label><label>状态<select data-ws-workspace-status="${view}">${option('all', '全部', page.statusFilter || 'all')}${statuses.map(value => option(value, label(value), page.statusFilter)).join('')}</select></label></div>`;
  }
  function renderTasks(rows, page) {
    const windowed = localWindow(rows, page), selected = rows.find(row => string(row.id || row.alertKey) === string(page.detailId));
    const table = `<div class="ws-workspace-table-wrap"><table class="ws-group-table ws-business-table"><thead><tr>${['任务 / 客户', '状态', '优先级', '跟进时间', '跟进原因', '详情'].map(title => `<th>${title}</th>`).join('')}</tr></thead><tbody>${windowed.rows.map(row => `<tr><td><strong>${esc(missing(row.title || row.externalId))}</strong><small>${esc(row.customerId || row.conversationId)}</small></td><td>${status(row.status)}</td><td>${row.priorityScore == null ? esc(missing(row.priority)) : `${Number(row.priorityScore)}/100`}</td><td>${esc(missing(row.followupTime))}</td><td>${esc(missing(row.reason))}</td><td>${button('business-detail', '查看任务', 'tasks', row.id || row.alertKey)}</td></tr>`).join('') || '<tr><td colspan="6">当前账号已加载范围没有匹配任务。</td></tr>'}</tbody></table></div>`;
    return { html: `<section class="ws-workspace-card zk-surface"><div class="ws-card-heading"><div><strong>客户跟进任务</strong><span>只展示现有跟进服务已返回的记录；操作继续使用原有任务服务。</span></div></div>${renderLocalFilters('tasks', rows, page)}${table}${pagination('tasks', page.page, windowed.total, windowed.pageCount)}${selected ? `<div class="ws-card-heading" data-ws-business-selected-detail><strong>任务详情</strong>${button('business-detail-close', '收起详情', 'tasks')}</div><dl class="ws-business-fields">${field('任务 ID', selected.id || selected.alertKey) + field('客户', selected.customerId) + field('来源会话', selected.conversationId) + field('状态', label(selected.status)) + field('失败原因', selected.lastError || selected.error) + field('建议动作', selected.objective || selected.nextStep) + field('跟进时间', selected.followupTime)}</dl>` : ''}</section>`, selected };
  }
  function renderRunDetails(run, items, capability) {
    const available = capability?.state === 'available' && capability.code === 'COLLECTION_INDEPENDENT_SESSION'
      && capability.provider === 'native-independent-session' && capability.protocolVersion === 1
      && capability.backgroundCollection === true && capability.automaticHistory === true && capability.groupMonitoring === true
      && capability.foregroundFallback === false && capability.automaticAi === false && capability.manualVisibleImport === true
      && ['not-started', 'awaiting-login', 'login-visible', 'running', 'paused', 'error'].includes(capability.collectorState);
    const reason = capability?.state === 'blocked' ? string(capability.reason).slice(0, 500) : '';
    const notice = available
      ? `<p class="ws-coverage-warning" role="status" data-collection-capability="available">独立采集会话：${esc(({ 'not-started': '未启动', 'awaiting-login': '等待扫码', 'login-visible': '登录页已打开', running: '采集中', paused: '已暂停', error: '异常' })[capability.collectorState])}。请使用当前所选账号的手机扫码。任务进度来自已保存记录，自动 AI 处理关闭。</p>`
      : `<p class="ws-coverage-warning" role="status" data-collection-capability="blocked">COLLECTION_CAPABILITY_BLOCKED：${esc(reason || '当前桌面未提供独立采集会话；前台聊天和手动导入可用。')}</p>`;
    if (!run) return `<section class="ws-workspace-card zk-surface"><strong>任务详情与断点</strong>${notice}<p class="ws-muted">当前账号暂无本机采集任务；未提供的进度不显示为成功。</p></section>`;
    return `<section class="ws-workspace-card zk-surface"><div class="ws-card-heading"><strong>任务详情与断点</strong><span>${available ? '任务保存状态' : '历史保存状态'}：${esc(label(run.status))}</span></div>${notice}<dl class="ws-business-fields">${field('任务 ID', run.id) + field('更新时间', run.updatedAt) + field('最近成功', run.lastSuccessAt) + field('重试次数', run.retryCount) + field('续采次数', run.resumeCount) + field('失败原因', run.lastError)}</dl><details><summary>查看 checkpoint / 游标</summary><pre>${esc(redact(run.cursor || run.checkpoint || '未提供'))}</pre></details>${Array.isArray(items) ? `<p class="ws-muted">本机采集项 ${items.length} 条；任务、checkpoint 和原队列保留。</p>` : ''}</section>`;
  }
  function renderCollectionItems(rows) {
    return `<div class="ws-workspace-table-wrap"><table class="ws-group-table ws-business-table"><thead><tr>${['来源会话', '采集状态', '分析状态', '覆盖范围', '尝试次数', '断点', '失败原因', '更新时间'].map(title => `<th>${title}</th>`).join('')}</tr></thead><tbody>${rows.map(row => `<tr><td>${esc(missing(row.conversationId))}<small>${esc(row.id)}</small></td><td>${status(row.status)}</td><td>${status(row.analysisStatus)}</td><td>${esc(missing(row.coverageStatus))}</td><td>${esc(missing(row.attempts))}</td><td>${esc(missing(row.checkpoint))}</td><td>${esc(missing(row.lastError))}</td><td>${esc(missing(row.updatedAt))}</td></tr>`).join('')}</tbody></table></div>`;
  }
  // --- WS 通讯录排除 -------------------------------------------------------
  // 这个目录只决定“自动建档时跳过哪些身份”，不是第二套客户库。
  function exclusionState(page) {
    if (!page.exclusion) page.exclusion = { loaded: false, loading: false, rules: [], hits: [], summary: { total: 0, enabled: 0, hits: 0 }, error: '', query: '', requestSerial: 0 };
    return page.exclusion;
  }
  function invalidateExclusions(page) {
    const view = exclusionState(page);
    view.requestSerial = Number(view.requestSerial || 0) + 1;
    view.mutationSerial = Number(view.mutationSerial || 0) + 1;
    view.loading = false;
    view.mutating = false;
  }
  function exclusionSelection(page) {
    const visible = new Set((exclusionState(page).rules || []).map(rule => String(rule.id)));
    return new Set((page.exclusionSelected || []).map(String).filter(id => visible.has(id)));
  }
  function parseExclusionImport(value) {
    const lines = string(value).split(/\r?\n/).map(line => line.trim()).filter(Boolean);
    if (!lines.length) throw new Error('请先粘贴要导入的身份。');
    if (lines.length > 2000) throw new Error(`本次有 ${lines.length} 条身份，超过每批 2000 条上限；请分批导入，本次未提交任何记录。`);
    return lines.map(identity => ({ identity }));
  }
  async function loadExclusions(page, { request, isCurrent, query = exclusionState(page).query || '' } = {}) {
    const view = exclusionState(page);
    const serial = view.requestSerial = Number(view.requestSerial || 0) + 1;
    const current = () => serial === view.requestSerial && (!isCurrent || isCurrent());
    view.loading = true;
    view.error = '';
    view.query = query;
    try {
      const search = query ? `&query=${encodeURIComponent(query)}` : '';
      const [rules, hits] = await Promise.all([
        request(`/api/ws/contact-exclusions?includeDisabled=1${search}`),
        request('/api/ws/contact-exclusions/hits?limit=500'),
      ]);
      if (!current()) return false;
      view.rules = Array.isArray(rules?.rules) ? rules.rules : [];
      view.summary = rules?.summary || view.summary;
      view.hits = Array.isArray(hits?.hits) ? hits.hits : [];
      view.loaded = true;
      page.exclusionSelected = [...exclusionSelection(page)];
      return true;
    } catch (error) {
      if (current()) view.error = string(error?.message || error);
      return false;
    } finally {
      // Release only this originating request; never clear a newer load.
      if (serial === view.requestSerial) view.loading = false;
    }
  }
  async function updateExclusions(page, { request, isCurrent, action, id = '', body = {} } = {}) {
    const view = exclusionState(page);
    if (view.mutating || (isCurrent && !isCurrent())) return false;
    const serial = view.mutationSerial = Number(view.mutationSerial || 0) + 1;
    const current = () => serial === view.mutationSerial && (!isCurrent || isCurrent());
    const bulk = action.startsWith('bulk-');
    const ids = bulk ? [...exclusionSelection(page)] : id ? [String(id)] : [];
    const completed = [];
    let failure = '';
    let attempted = false;
    view.mutating = true;
    view.error = '';
    view.result = null;
    try {
      if (action === 'add' || action === 'import') {
        if (action === 'import') body = { items: parseExclusionImport(view.importText), source: 'import' };
        else view.addDraft = { ...body };
        attempted = true;
        const response = await request('/api/ws/contact-exclusions', { method: 'POST', body: JSON.stringify(body) });
        if (!current()) return false;
        const rejected = Array.isArray(response?.rejected) ? response.rejected : [];
        view.result = { message: `${action === 'import' ? '导入' : '添加'}完成：${response?.rules?.length || 0} 条成功，${rejected.length} 条被拒。`, rejected };
        if (action === 'import') view.importText = rejected.map(item => string(item.identity)).join('\n');
        else view.addDraft = {};
      } else {
        if (!ids.length) return false;
        for (const ruleId of ids) {
          if (!current()) return false;
          const remove = action === 'delete' || action === 'bulk-delete';
          attempted = true;
          await request('/api/ws/contact-exclusions/' + encodeURIComponent(ruleId), { method: remove ? 'DELETE' : 'PATCH', ...(remove ? {} : { body: JSON.stringify({ enabled: bulk ? action === 'bulk-enable' : body.enabled }) }) });
          if (!current()) return false;
          completed.push(ruleId);
        }
        view.result = { message: `已处理 ${completed.length} 条排除规则。`, rejected: [] };
      }
    } catch (error) {
      if (!current()) return false;
      failure = (bulk ? `已完成 ${completed.length} 条，剩余 ${ids.length - completed.length} 条未完成。` : '') + string(error?.message || error);
    } finally {
      if (current()) {
        page.exclusionSelected = [...exclusionSelection(page)].filter(ruleId => !completed.includes(ruleId));
      }
      if (serial === view.mutationSerial) view.mutating = false;
    }
    if (!current()) return false;
    if (failure && !attempted) { view.error = failure; return false; }
    await loadExclusions(page, { request, isCurrent: current });
    if (!current()) return false;
    if (failure) view.error = failure + (view.error ? `；刷新失败：${view.error}` : '');
    return !failure;
  }
  function renderExclusions(page) {
    const view = exclusionState(page);
    const rules = view.rules || [];
    const selectedIds = exclusionSelection(page);
    const busy = Boolean(view.loading || view.mutating);
    const disabled = busy ? ' disabled' : '';
    const hitQuery = string(view.hitQuery).trim().toLocaleLowerCase();
    const hits = (view.hits || []).filter(hit => !hitQuery || [hit.ruleName, hit.ruleValue, hit.accountId, hit.groupJid, hit.memberPhone, hit.memberJid, hit.action].some(value => string(value).toLocaleLowerCase().includes(hitQuery)));
    const draft = view.addDraft || {};
    const summary = view.summary || { total: 0, enabled: 0, hits: 0 };
    const rows = rules.map(rule => {
      const checked = selectedIds.has(rule.id);
      return `<tr${checked ? ' class="is-selected"' : ''}><td><input type="checkbox" data-ws-exclusion-select="${esc(rule.id)}"${checked ? ' checked' : ''} aria-label="选择排除规则 ${esc(rule.displayName || rule.value)}"></td><td>${renderPersonIdentity({ name: rule.displayName, fallbackName: rule.value, secondary: rule.value })}</td><td>${esc(missing(rule.phone || (rule.kind === 'phone' ? rule.value : '')))}<small>${esc(rule.kind)}</small></td><td>${esc(missing(rule.note))}</td><td>${esc(missing(rule.source))}</td><td>${rule.enabled ? '<span class="ws-status-badge" data-status="active">排除中</span>' : '<span class="ws-status-badge" data-status="disabled">已停用</span>'}</td><td>${esc(missing(rule.updatedAt))}</td><td><button type="button" class="btn small" data-ws-action="exclusion-toggle" data-record-id="${esc(rule.id)}" data-record-enabled="${rule.enabled ? '1' : '0'}">${rule.enabled ? '取消排除' : '启用排除'}</button> <button type="button" class="btn small danger" data-ws-action="exclusion-delete" data-record-id="${esc(rule.id)}">移除</button></td></tr>`;
    }).join('');
    const hitRows = hits.map(hit => `<tr><td>${esc(missing(hit.ruleName || hit.ruleValue))}</td><td>${esc(missing(hit.accountId))}</td><td>${esc(missing(hit.groupJid))}</td><td>${esc(missing(hit.memberPhone || hit.memberJid))}</td><td>${esc(missing(hit.action))}</td><td>${esc(missing(hit.createdAt))}</td></tr>`).join('');
    return `<section class="ws-workspace-card zk-surface" data-ws-exclusion-page aria-busy="${busy ? 'true' : 'false'}">
      <div class="ws-card-heading"><div><strong>通讯录排除</strong><span>此通讯录用于排除专用 WS 群成员自动建档；它不是 CRM 客户通讯录，不会创建、修改或删除客户。</span></div><span class="ws-status-badge">排除中 ${Number(summary.enabled || 0)} / 共 ${Number(summary.total || 0)}</span></div>
      <div class="ws-workspace-metrics" aria-label="排除统计"><div><span>排除规则</span><strong>${Number(summary.total || 0)}</strong><small>含已停用</small></div><div><span>正在生效</span><strong>${Number(summary.enabled || 0)}</strong><small>阻止自动建档</small></div><div><span>命中次数</span><strong>${Number(summary.hits || 0)}</strong><small>累计跳过</small></div></div>
      <form class="ws-business-filter-grid" data-ws-exclusion-form="search"><label>搜索<input type="search" data-ws-exclusion-query maxlength="160" value="${esc(view.query)}" placeholder="姓名、号码、备注或标识" aria-label="搜索排除名单"></label><div class="ws-business-filter-actions"><button type="submit" class="btn small">查询</button><button type="button" class="btn small" data-ws-action="exclusion-refresh">刷新</button></div></form>
      <details class="ws-exclusion-add"${view.importText || view.result || view.error || view.mutating ? ' open' : ''}><summary>新增或批量导入排除规则</summary>
        <form data-ws-exclusion-form="add"><label>身份（号码、JID 或业务作用域 ID）<input name="identity" maxlength="200" required value="${esc(draft.identity)}" placeholder="例如 +919876543210"></label><label>名称（可选）<input name="displayName" maxlength="120" value="${esc(draft.displayName)}"></label><label>备注（可选）<input name="note" maxlength="300" value="${esc(draft.note)}"></label><button type="submit" class="btn small primary"${disabled}>加入排除名单</button></form>
        <form data-ws-exclusion-form="import"><label>批量导入<textarea name="items" rows="4" placeholder="每行一个号码或一个身份标识；每批最多 2000 条，昵称不会被接受">${esc(view.importText)}</textarea></label><button type="submit" class="btn small"${disabled}>批量导入</button></form>
        ${view.result ? `<p role="status">${esc(view.result.message)}</p>${view.result.rejected?.length ? `<details open><summary>被拒记录及原因（${view.result.rejected.length} 条）</summary><ul>${view.result.rejected.map(item => `<li>${esc(item.identity)}：${esc(item.reason)}</li>`).join('')}</ul></details>` : ''}` : ''}
      </details>
      <div class="ws-business-bulk"><span>已选 ${selectedIds.size} 条</span><button type="button" class="btn small" data-ws-action="exclusion-bulk-enable"${selectedIds.size && !busy ? '' : ' disabled'}>启用所选</button><button type="button" class="btn small" data-ws-action="exclusion-bulk-disable"${selectedIds.size && !busy ? '' : ' disabled'}>取消排除所选</button><button type="button" class="btn small danger" data-ws-action="exclusion-bulk-delete"${selectedIds.size && !busy ? '' : ' disabled'}>移除所选</button></div>
      ${view.error ? `<p class="ws-error-line" role="alert">${esc(view.error)}</p>` : ''}
      <div class="ws-workspace-table-wrap"><table class="ws-group-table ws-business-table"><thead><tr><th scope="col"><input type="checkbox" data-ws-exclusion-select-all${rules.length && selectedIds.size === rules.length ? ' checked' : ''}${disabled} aria-label="全选当前名单"></th>${['身份', '号码', '备注', '来源', '状态', '最近更新', '操作'].map(title => `<th scope="col">${title}</th>`).join('')}</tr></thead><tbody>${rows || `<tr><td colspan="8"><p class="ws-business-empty" role="status">${view.loading ? '正在读取排除名单…' : view.loaded ? '当前没有排除规则。' : '尚未读取；请点击刷新。'}</p></td></tr>`}</tbody></table></div>
    </section>
    <section class="ws-workspace-card zk-surface"><div class="ws-card-heading"><div><strong>排除命中记录</strong><span>每次因排除名单而跳过自动建档都会留下证据，用于核对为什么某位群成员没有成为客户。</span></div></div><form class="ws-business-filter-grid" data-ws-exclusion-form="hits"><label>筛选命中记录<input type="search" name="hitQuery" maxlength="160" value="${esc(view.hitQuery)}" placeholder="规则、账号、群组或成员"></label><button type="submit" class="btn small">筛选</button></form><p class="ws-muted">仅查询最近最多 500 条已加载命中记录，当前匹配 ${hits.length} 条；不代表全部历史。</p>${hits.length ? `<div class="ws-workspace-table-wrap"><table class="ws-group-table ws-business-table"><thead><tr>${['规则', '账号', '群组', '成员', '动作', '时间'].map(title => `<th scope="col">${title}</th>`).join('')}</tr></thead><tbody>${hitRows}</tbody></table></div>` : `<p class="ws-muted">${view.loading ? '正在读取命中记录…' : view.error ? '命中记录未能刷新，请重试。' : hitQuery ? '最近已加载记录中没有匹配项。' : '尚无命中记录。'}</p>`}</section>`;
  }
  return { esc, redact, safeDetails, label, renderPersonAvatar, renderAvatarAvailability, directoryState, buildDirectoryQuery, acceptDirectoryResult, loadDirectory, renderDirectory, localWindow, renderMembers, customerRows, renderCustomers, renderLocalFilters, renderTasks, renderRunDetails, renderCollectionItems, exclusionState, exclusionSelection, invalidateExclusions, parseExclusionImport, loadExclusions, updateExclusions, renderExclusions };
});
