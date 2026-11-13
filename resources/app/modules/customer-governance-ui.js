(() => {
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const root = document.querySelector('#viewContainer');
  if (!root) return;
  let purgeToken = '';
  const mutationHeaders = () => ({ 'Content-Type': 'application/json', 'X-State-Version': String(window.__zhikeRegistryHost?.getStateVersion?.() ?? '') });

  const panelHtml = () => `
    <section id="customerGovernancePanel" class="panel v4-panel">
      <div class="panel-heading">
        <h2 class="panel-title">AI 客户档案自动治理</h2>
        <span class="panel-note">AI 自动建档、补齐和审计；永久删除需要二次确认</span>
      </div>
      <div class="v4-health-grid">
        <div><span>自动治理动作</span><strong data-gov-count>读取中…</strong></div>
        <div><span>字段冲突</span><strong data-gov-conflicts>读取中…</strong></div>
        <div><span>软删除</span><strong data-gov-deleted>读取中…</strong></div>
      </div>
      <div class="v4-actions governance-actions">
        <input data-gov-id placeholder="客户编号">
        <input data-gov-reason placeholder="操作原因（可选）">
        <button class="btn" data-gov-action="refresh">刷新审计</button>
        <button class="btn" data-gov-action="soft-delete">移入回收站</button>
        <button class="btn" data-gov-action="restore">恢复客户</button>
        <button class="btn danger" data-gov-action="purge-request">申请永久删除</button>
        <button class="btn danger" data-gov-action="purge-confirm" disabled>确认永久删除</button>
      </div>
      <div class="notice-line" data-gov-notice>AI 同步会自动补齐空字段，已有人工内容不会被覆盖。</div>
      <div class="table-scroll">
        <table class="data-table"><thead><tr><th>时间</th><th>客户</th><th>动作</th><th>原因</th><th>来源</th></tr></thead>
        <tbody data-gov-rows><tr><td colspan="5" class="muted-cell">读取中…</td></tr></tbody></table>
      </div>
    </section>`;

  async function load(panel) {
    const response = await fetch('/api/data-governance/audit?limit=20', { cache: 'no-store' });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || '无法读取治理审计');
    panel.querySelector('[data-gov-count]').textContent = result.total || 0;
    panel.querySelector('[data-gov-conflicts]').textContent = (result.conflicts || []).length;
    panel.querySelector('[data-gov-deleted]').textContent = (result.actions || []).filter(row => row.action === 'soft_delete').length;
    panel.querySelector('[data-gov-rows]').innerHTML = (result.actions || []).map(row => `<tr><td>${esc(new Date(row.createdAt).toLocaleString())}</td><td>${esc(row.customerId)}</td><td>${esc(row.action)}</td><td>${esc(row.reason || '')}</td><td>${esc(row.source || '')}</td></tr>`).join('') || '<tr><td colspan="5" class="muted-cell">暂无自动治理记录</td></tr>';
  }

  function mount() {
    if (!root.querySelector('h1')?.textContent.includes('数据治理') || root.querySelector('#customerGovernancePanel')) return;
    root.insertAdjacentHTML('beforeend', panelHtml());
    const panel = root.querySelector('#customerGovernancePanel');
    const notice = message => { panel.querySelector('[data-gov-notice]').textContent = message; };
    const refreshHost = async successMessage => {
      try {
        if (window.__zhikeRegistryHost?.refreshState) await window.__zhikeRegistryHost.refreshState();
        notice(successMessage);
        return true;
      } catch (error) {
        console.warn('[知客] 客户治理已写入，但主界面刷新失败：', error?.message || error);
        notice(`${successMessage} 主界面刷新失败，请手动刷新页面。`);
        return false;
      }
    };
    panel.addEventListener('click', async event => {
      const button = event.target.closest('[data-gov-action]');
      if (!button) return;
      const action = button.dataset.govAction;
      const customerId = panel.querySelector('[data-gov-id]').value.trim();
      const reason = panel.querySelector('[data-gov-reason]').value.trim() || '数据治理操作';
      if (action !== 'refresh' && !customerId) { notice('请先输入客户编号。'); return; }
      try {
        if (action === 'refresh') { await load(panel); notice('审计记录已刷新。'); return; }
        if (action === 'soft-delete' || action === 'restore') {
          const response = await fetch(`/api/data-governance/customers/${encodeURIComponent(customerId)}/${action}`, { method: 'POST', headers: mutationHeaders(), body: JSON.stringify({ reason }) });
          const result = await response.json();
          if (!response.ok || !result.ok) throw new Error(result.error || '操作失败');
          await refreshHost(action === 'soft-delete' ? '客户已移入回收站。' : '客户已恢复。');
          await load(panel);
          return;
        }
        if (action === 'purge-request') {
          const response = await fetch(`/api/data-governance/customers/${encodeURIComponent(customerId)}/purge-request`, { method: 'POST', headers: mutationHeaders(), body: JSON.stringify({ reason }) });
          const result = await response.json();
          if (!response.ok || !result.confirmationToken) throw new Error(result.error || '无法生成确认令牌');
          purgeToken = result.confirmationToken;
          panel.querySelector('[data-gov-action="purge-confirm"]').disabled = false;
          notice('永久删除确认已生成，请再次点击“确认永久删除”完成。');
          return;
        }
        if (action === 'purge-confirm') {
          if (!purgeToken) throw new Error('请先申请永久删除');
          const response = await fetch(`/api/data-governance/customers/${encodeURIComponent(customerId)}/purge-confirm`, { method: 'POST', headers: mutationHeaders(), body: JSON.stringify({ reason, confirmationToken: purgeToken }) });
          const result = await response.json();
          if (!response.ok || !result.ok) throw new Error(result.error || '永久删除失败');
          purgeToken = '';
          button.disabled = true;
          await refreshHost('客户及关联跟进、任务已永久删除，审计记录已保留。');
          await load(panel);
        }
      } catch (error) { notice(error.message || '治理操作失败，请重试。'); }
    });
    load(panel).catch(error => notice(error.message || '无法读取治理审计。'));
  }

  const observer = new MutationObserver(mount);
  observer.observe(root, { childList: true });
  mount();
})();
