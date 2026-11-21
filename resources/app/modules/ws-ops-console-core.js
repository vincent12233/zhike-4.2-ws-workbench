(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ZhikeWsOpsConsole = Object.freeze(api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  // V5.0 §30 operations console strip: account scope, connection, collector,
  // monitored groups and the event backlog, read from live state only.
  const text = value => String(value == null ? '' : value).trim();
  const num = value => Number.isFinite(Number(value)) ? Math.max(0, Math.floor(Number(value))) : null;
  const esc = value => String(value == null ? '' : value).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const displayTime = value => {
    const ms = Date.parse(text(value));
    return Number.isFinite(ms) ? new Date(ms).toLocaleString('zh-CN', { hour12: false }) : '';
  };
  const BROKEN = /(?:失败|异常|错误|失效|受限)/;

  function buildOpsConsole(input = {}) {
    const state = input && typeof input === 'object' ? input : {};
    const dedicated = text(state.mode) === 'dedicated';
    const accounts = num(state.accountCount);
    const connected = num(state.connectedCount);
    const targets = num(state.targetCount);
    const liveAt = displayTime(state.lastObservedAt || state.collectedAt);
    const counts = state.eventCounts && typeof state.eventCounts === 'object' ? state.eventCounts : {};
    const pendingEvents = (num(counts.pending) || 0) + (num(counts.review) || 0);
    const wsStatus = text(state.wsStatus);
    const collector = text(state.collectorLabel);
    const authTone = !wsStatus ? 'unknown' : BROKEN.test(wsStatus) ? 'error' : wsStatus === '已连接' ? 'ok' : 'warn';
    const collectorTone = !collector ? 'unknown' : BROKEN.test(collector) ? 'error' : /不可用|未启动|等待|检查/.test(collector) ? 'warn' : 'ok';
    const rows = [
      { key: 'accounts', label: '账号', value: accounts == null ? '未知' : `${accounts} 个 · 已连接 ${connected ?? 0}`, tone: accounts ? 'ok' : 'warn' },
      { key: 'connection', label: 'WS 连接', value: wsStatus || '未知', tone: authTone },
      { key: 'collector', label: '采集会话', value: collector || '未知', tone: collectorTone },
      ...(dedicated ? [{ key: 'targets', label: '监测群组', value: targets == null ? '未知' : `${targets} 个`, tone: targets ? 'ok' : 'warn' }] : []),
      { key: 'lastAt', label: '最近采集', value: liveAt || '暂无记录', tone: liveAt ? 'ok' : 'unknown' },
      { key: 'backlog', label: '待处理事件', value: `${pendingEvents} 条`, tone: pendingEvents > 0 ? 'warn' : 'ok' },
    ];
    const tone = rows.some(row => row.tone === 'error') ? 'error' : rows.some(row => row.tone === 'warn') ? 'warn' : 'ok';
    return { rows, tone, dedicated, pendingEvents };
  }

  function renderOpsConsole(input = {}) {
    const consoleState = buildOpsConsole(input);
    const cells = consoleState.rows.map(row => `<div class="ws-ops-cell" data-tone="${esc(row.tone)}" data-ops="${esc(row.key)}"><span>${esc(row.label)}</span><strong>${esc(row.value)}</strong></div>`).join('');
    const title = consoleState.dedicated ? '专用 WS 运营态势' : 'WS 采集态势';
    return `<section class="ws-ops-console" data-ws-ops-console data-tone="${esc(consoleState.tone)}" aria-label="${esc(title)}"><div class="ws-ops-console-head"><strong>${esc(title)}</strong><small>只显示本机已保存的真实状态；未读取的值显示为未知。</small></div><div class="ws-ops-console-grid">${cells}</div></section>`;
  }

  return { buildOpsConsole, renderOpsConsole };
});
