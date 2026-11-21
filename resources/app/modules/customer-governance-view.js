(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ZhikeCustomerGovernanceView = Object.freeze(api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  // V5.0 §19 customer 360: field sources, change history and conflicts.
  // Pure renderer: it never fetches and never invents data. Anything it cannot
  // show from the governance payload is reported as missing instead of filled.
  const esc = value => String(value == null ? '' : value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const text = value => String(value == null ? '' : value).trim();
  const FIELD_LABELS = {
    name: '姓名', phone: '手机号', country: '地区', language: '语言', occupation: '职业',
    preferred_name: '称呼', gender: '性别', work_context: '工作背景', is_investor: '是否投资',
    investment_years: '投资经验', holdings: '明确持仓', investment_habits: '投资习惯',
    investment_preferences: '投资偏好', family_context: '家庭情况', life_interests: '生活兴趣',
    future_plans: '未来计划', intent: '客户意向', intentScore: '意向评分', emotion: '情绪',
    customerStage: '客户阶段', aiSummary: '聊天摘要', productInterest: '关注产品', budget: '预算',
    origin: '来源', age: '年龄', source: '来源', channel: '渠道', assistant: '负责助理',
  };
  const ACTION_LABELS = { create: '新建客户', update: '更新资料', restore: '恢复客户', soft_delete: '软删除', purge: '彻底删除' };
  const STATUS_LABELS = { accepted: '已采纳', conflict: '冲突', rejected: '已拒绝' };
  const label = field => FIELD_LABELS[field] || field;
  const displayValue = value => {
    if (value == null || value === '') return '空';
    if (Array.isArray(value)) return value.length ? value.map(item => text(item)).filter(Boolean).join('、') : '空';
    if (typeof value === 'boolean') return value ? '是' : '否';
    if (typeof value === 'object') return Object.keys(value).length ? JSON.stringify(value).slice(0, 300) : '空';
    return text(value);
  };
  const time = value => {
    const ms = Date.parse(text(value));
    return Number.isFinite(ms) ? new Date(ms).toLocaleString('zh-CN', { hour12: false }) : '时间未知';
  };
  const confidence = value => {
    const number = Number(value);
    return Number.isFinite(number) ? `${Math.round(Math.max(0, Math.min(1, number)) * 100)}%` : '—';
  };

  function conflictsHtml(conflicts) {
    const rows = (Array.isArray(conflicts) ? conflicts : []).filter(item => item && typeof item === 'object');
    if (!rows.length) return '';
    return `<div class="governance-conflicts" role="alert"><div class="governance-block-title"><strong>待确认冲突 · ${rows.length}</strong><span>AI 识别值与现有档案不一致，已保留证据，未覆盖档案。</span></div><ul>${rows.map(item => `<li><b>${esc(label(item.fieldName))}</b><span>现有：${esc(displayValue(item.value))}</span><small>来源：${esc(text(item.sourceText).slice(0, 200) || '未记录来源消息')} · 可信度 ${esc(confidence(item.confidence))}</small></li>`).join('')}</ul></div>`;
  }

  function sourcesHtml(evidence) {
    const rows = (Array.isArray(evidence) ? evidence : []).filter(item => item && typeof item === 'object' && item.status !== 'conflict');
    const byField = new Map();
    for (const item of rows) {
      const field = text(item.fieldName);
      if (!field) continue;
      const prior = byField.get(field);
      // Keep the newest evidence per field; the payload is ordered newest first.
      if (!prior || Date.parse(item.updatedAt || item.createdAt || '') > Date.parse(prior.updatedAt || prior.createdAt || '')) byField.set(field, item);
    }
    if (!byField.size) return '<p class="panel-note">尚无已采纳的字段来源记录。</p>';
    const sorted = [...byField.values()].sort((a, b) => text(a.fieldName).localeCompare(text(b.fieldName)));
    return `<div class="ws-group-table-wrap"><table class="ws-group-table governance-source-table"><thead><tr><th>字段</th><th>值</th><th>来源消息</th><th>可信度</th><th>状态</th></tr></thead><tbody>${sorted.map(item => `<tr data-status="${esc(item.status || 'accepted')}"><td>${esc(label(item.fieldName))}</td><td title="${esc(displayValue(item.value))}">${esc(displayValue(item.value))}</td><td title="${esc(text(item.sourceText))}">${esc(text(item.sourceText).slice(0, 80) || '未记录')}</td><td>${esc(confidence(item.confidence))}</td><td>${esc(STATUS_LABELS[item.status] || item.status || '已采纳')}</td></tr>`).join('')}</tbody></table></div>`;
  }

  function historyHtml(actions) {
    const rows = (Array.isArray(actions) ? actions : []).filter(item => item && typeof item === 'object').slice(0, 20);
    if (!rows.length) return '<p class="panel-note">尚无资料变更记录。</p>';
    return `<ol class="governance-history">${rows.map(item => {
      const before = item.before && typeof item.before === 'object' ? item.before : {};
      const after = item.after && typeof item.after === 'object' ? item.after : {};
      const changed = Object.keys(after).filter(key => JSON.stringify(before[key]) !== JSON.stringify(after[key])).slice(0, 6);
      const detail = changed.length
        ? changed.map(key => `${esc(label(key))}：${esc(displayValue(before[key]))} → ${esc(displayValue(after[key]))}`).join('；')
        : (text(item.reason) ? esc(text(item.reason)) : '无字段差异');
      return `<li><b>${esc(ACTION_LABELS[item.action] || item.action || '变更')}</b><span>${detail}</span><small>${esc(time(item.createdAt))} · 来源 ${esc(text(item.source) || '未记录')}${item.confidence ? ` · 可信度 ${esc(confidence(item.confidence))}` : ''}</small></li>`;
    }).join('')}</ol>`;
  }

  /**
   * @param {{evidence?:Array, actions?:Array, conflicts?:Array, error?:string, loading?:boolean}} payload
   */
  function renderGovernancePanel(payload = {}) {
    const safe = payload && typeof payload === 'object' ? payload : {};
    const box = (title, body, note = '') => `<section class="customer-360-section zk-surface governance-panel"><div class="customer-360-section-title"><strong>${esc(title)}</strong>${note ? `<span class="panel-note">${esc(note)}</span>` : ''}</div>${body}</section>`;
    if (safe.loading === true) return box('字段来源与变更记录', '<p class="panel-note">正在读取字段来源、冲突和变更记录…</p>');
    if (text(safe.error)) return box('字段来源与变更记录', `<p class="ws-error-line" role="alert">${esc(safe.error)}</p>`);
    const conflicts = Array.isArray(safe.conflicts) ? safe.conflicts : [];
    return box('字段来源与变更记录', conflictsHtml(conflicts)
      + `<div class="governance-block-title"><strong>字段来源</strong><span>AI 提取值的来源消息与可信度；冲突值不写入档案。</span></div>${sourcesHtml(safe.evidence)}`
      + `<div class="governance-block-title"><strong>资料变更记录</strong><span>最近 20 条，只读。</span></div>${historyHtml(safe.actions)}`);
  }

  return { renderGovernancePanel, FIELD_LABELS, ACTION_LABELS, displayValue };
});
