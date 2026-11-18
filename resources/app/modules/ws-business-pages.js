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
    const reason = capability?.state === 'blocked' ? string(capability.reason).slice(0, 500) : '';
    const unavailable = `<p class="ws-coverage-warning" role="status" data-collection-capability="blocked">COLLECTION_CAPABILITY_BLOCKED：${esc(reason || '后台采集依赖复制认证状态，已按安全边界停用；前台聊天和手动导入可用。')}</p>`;
    if (!run) return `<section class="ws-workspace-card zk-surface"><strong>任务详情与断点</strong>${unavailable}<p class="ws-muted">当前账号暂无本机历史采集任务；未提供的进度不显示为成功。</p></section>`;
    return `<section class="ws-workspace-card zk-surface"><div class="ws-card-heading"><strong>任务详情与断点</strong><span>历史保存状态：${esc(label(run.status))}</span></div>${unavailable}<dl class="ws-business-fields">${field('任务 ID', run.id) + field('更新时间', run.updatedAt) + field('最近成功', run.lastSuccessAt) + field('重试次数', run.retryCount) + field('续采次数', run.resumeCount) + field('失败原因', run.lastError)}</dl><details><summary>查看 checkpoint / 游标</summary><pre>${esc(redact(run.cursor || run.checkpoint || '未提供'))}</pre></details>${Array.isArray(items) ? `<p class="ws-muted">本地历史采集项 ${items.length} 条；任务、checkpoint 和原队列保留，页面切换不启动消费者。</p>` : ''}</section>`;
  }
  function renderCollectionItems(rows) {
    return `<div class="ws-workspace-table-wrap"><table class="ws-group-table ws-business-table"><thead><tr>${['来源会话', '采集状态', '分析状态', '覆盖范围', '尝试次数', '断点', '失败原因', '更新时间'].map(title => `<th>${title}</th>`).join('')}</tr></thead><tbody>${rows.map(row => `<tr><td>${esc(missing(row.conversationId))}<small>${esc(row.id)}</small></td><td>${status(row.status)}</td><td>${status(row.analysisStatus)}</td><td>${esc(missing(row.coverageStatus))}</td><td>${esc(missing(row.attempts))}</td><td>${esc(missing(row.checkpoint))}</td><td>${esc(missing(row.lastError))}</td><td>${esc(missing(row.updatedAt))}</td></tr>`).join('')}</tbody></table></div>`;
  }
  return { esc, redact, safeDetails, label, renderPersonAvatar, renderAvatarAvailability, directoryState, buildDirectoryQuery, acceptDirectoryResult, loadDirectory, renderDirectory, localWindow, renderMembers, customerRows, renderCustomers, renderLocalFilters, renderTasks, renderRunDetails, renderCollectionItems };
});
