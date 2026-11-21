(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ZhikeWsAiStatus = Object.freeze(api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  // V5.0 §27 ordinary-WS AI status strip: account, authorisation, collection,
  // queue and failures. Only real state is shown; a missing value is 暂无/未知
  // and never a zero that could be mistaken for a healthy reading.
  const text = value => String(value == null ? '' : value).trim();
  const num = value => Number.isFinite(Number(value)) ? Math.max(0, Math.floor(Number(value))) : 0;
  const time = value => {
    const ms = Date.parse(text(value));
    return Number.isFinite(ms) ? new Date(ms).toLocaleString('zh-CN', { hour12: false }) : '';
  };
  const CONNECTED = /^(?:已连接|已授权|在线|正常)/;
  const BROKEN = /(?:失败|异常|错误|失效|受限)/;

  function buildAiStatus(input = {}) {
    const state = input && typeof input === 'object' ? input : {};
    const queue = state.aiQueueStats && typeof state.aiQueueStats === 'object' ? state.aiQueueStats : {};
    const accountId = text(state.accountId) || text(state.accountDisplayName);
    const wsStatus = text(state.wsStatus);
    const collector = text(state.collectorLabel) || text(state.collectorState);
    const lastAt = time(state.lastCollectedAt || state.collectionRun?.updatedAt || state.collectionRun?.createdAt);
    const pending = num(queue.queued) + num(queue.running) + num(queue.retryable);
    const failed = num(queue.failed) + num(queue.deadLetter);
    const error = text(state.aiBackgroundError);
    const authTone = !wsStatus ? 'unknown' : BROKEN.test(wsStatus) ? 'error' : CONNECTED.test(wsStatus) ? 'ok' : 'warn';
    const collectTone = !collector ? 'unknown' : /不可用|未启动|等待|检查|显示/.test(collector) ? 'warn' : BROKEN.test(collector) ? 'error' : 'ok';
    const queueTone = failed > 0 ? 'error' : pending > 0 ? 'warn' : 'ok';
    const rows = [
        { key: 'account', label: '当前账号', value: accountId || '未选择账号', tone: accountId ? 'ok' : 'warn' },
        { key: 'auth', label: '授权状态', value: wsStatus || '未知', tone: authTone },
        { key: 'collection', label: '采集状态', value: collector || '未知', tone: collectTone },
        { key: 'lastAt', label: '最近采集', value: lastAt || '暂无记录', tone: lastAt ? 'ok' : 'unknown' },
        { key: 'queue', label: '待分析', value: `${pending} 个任务`, tone: queueTone },
        { key: 'failed', label: '失败', value: `${failed} 个`, tone: failed > 0 ? 'error' : 'ok' },
      ];
    const tone = error || rows.some(item => item.tone === 'error') ? 'error'
      : rows.some(item => item.tone === 'warn') ? 'warn' : 'ok';
    return { ready: Boolean(accountId), rows, pending, failed, error, tone };
  }

  function renderAiStatusStrip(input) {
    const status = buildAiStatus(input);
    const esc = value => String(value == null ? '' : value).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
    const cells = status.rows.map(item => `<div class="ws-ai-status-cell" data-tone="${esc(item.tone)}" data-ai-status="${esc(item.key)}"><span>${esc(item.label)}</span><strong>${esc(item.value)}</strong></div>`).join('');
    return `<div class="ws-ai-status" data-ws-ai-status data-tone="${esc(status.tone)}" role="status">${cells}${status.error ? `<p class="ws-ai-status-error">${esc(status.error)}</p>` : ''}</div>`;
  }

  return { buildAiStatus, renderAiStatusStrip };
});
