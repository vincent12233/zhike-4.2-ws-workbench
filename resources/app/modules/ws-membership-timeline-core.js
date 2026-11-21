(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ZhikeWsMembershipTimeline = Object.freeze(api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  // V5.0 §28 membership timeline. Every row states how far the evidence goes:
  // 已确认 is only a stored membership write; 已观察 is a real group event whose
  // member is not linked yet; 无法确认 covers approval/permission gaps. Nothing
  // is promoted to 已确认 from a guess.
  const text = value => String(value == null ? '' : value).trim();
  const EVENT = { joined: '进群', removed: '被移除', left: '退群' };
  const esc = value => String(value == null ? '' : value).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const clampConfidence = value => {
    const number = Number(value);
    return Number.isFinite(number) ? Math.max(0, Math.min(100, Math.round(number * 100))) : null;
  };
  const displayTime = value => {
    const ms = Date.parse(text(value));
    if (!Number.isFinite(ms)) return '';
    return new Date(ms).toLocaleString('zh-CN', { hour12: false });
  };

  function classify(event = {}) {
    const status = text(event.status) || 'pending';
    const autoRegistered = event?.data?.autoRegistered === true;
    if (status === 'applied') return { kind: 'confirmed', kindLabel: '已确认', note: autoRegistered ? '已自动登记客户并写入档案' : '已关联客户并写入档案', needsAction: false };
    if (status === 'pending') return { kind: 'observed', kindLabel: '已观察', note: '已读到真实群事件，成员尚未关联客户', needsAction: true };
    if (status === 'review') return { kind: 'unknown', kindLabel: '无法确认', note: '权限、审核或待批准导致无法确认，未建档', needsAction: true };
    if (status === 'ignored') return { kind: 'ignored', kindLabel: '已忽略', note: '人工忽略，保留原始事件', needsAction: false };
    return { kind: 'unknown', kindLabel: '无法确认', note: `未识别的状态：${status}`, needsAction: true };
  }

  function buildMembershipTimeline(events = [], options = {}) {
    const customers = Array.isArray(options.customers) ? options.customers : [];
    const byId = new Map(customers.map(item => [String(item.id), item]));
    return (Array.isArray(events) ? events : [])
      .filter(event => event && typeof event === 'object')
      .map(event => {
        const kind = classify(event);
        const customer = byId.get(String(event.customerId || ''));
        return {
          id: text(event.id),
          eventType: text(event.eventType),
          eventLabel: EVENT[text(event.eventType)] || '未知事件',
          groupName: text(event.data?.groupName || event.groupName || event.groupJid) || '未命名群组',
          member: text(event.memberPhone || event.memberJid) || '未知成员',
          at: displayTime(event.eventAt || event.observedAt || event.createdAt),
          confidencePct: clampConfidence(event.confidence),
          customerName: customer ? text(customer.name || customer.phone || customer.id) : '',
          ...kind,
        };
      })
      .sort((a, b) => Date.parse(b.at || 0) - Date.parse(a.at || 0) || 0);
  }

  function summarizeMembershipTimeline(rows = []) {
    const counts = { confirmed: 0, observed: 0, unknown: 0, ignored: 0, total: 0 };
    for (const row of Array.isArray(rows) ? rows : []) {
      if (row && Object.hasOwn(counts, row.kind)) counts[row.kind] += 1;
      counts.total += 1;
    }
    return counts;
  }

  function renderMembershipTimeline(rows = [], options = {}) {
    const list = Array.isArray(rows) ? rows : [];
    if (!list.length) return `<p class="ws-muted" role="status">${esc(options.emptyText || '尚未保存符合条件的进退群事件。')}</p>`;
    return `<ol class="ws-membership-timeline" data-ws-membership-timeline>${list.map(row => `<li class="ws-membership-event" data-kind="${esc(row.kind)}">
      <span class="ws-membership-kind" data-kind="${esc(row.kind)}">${esc(row.kindLabel)}</span>
      <div class="ws-membership-body"><strong>${esc(row.eventLabel)} · ${esc(row.groupName)}</strong><small>${esc(row.member)}${row.at ? ` · ${esc(row.at)}` : ''}${row.confidencePct == null ? '' : ` · 置信度 ${row.confidencePct}%`}</small><span>${esc(row.note)}${row.customerName ? ` · ${esc(row.customerName)}` : ''}</span></div>
    </li>`).join('')}</ol>`;
  }

  return { classify, buildMembershipTimeline, summarizeMembershipTimeline, renderMembershipTimeline };
});
