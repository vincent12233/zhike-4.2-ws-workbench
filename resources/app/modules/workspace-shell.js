(() => {
  'use strict';
  // Presentation-only preferences. Never read/write CRM settings or credentials.
  const KEY = 'zhike.workspace-shell.v1';
  const palettes = new Set(['atelier-dawn', 'horizon-night']);
  const root = document.documentElement;
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch {}
  let palette = palettes.has(saved.palette) ? saved.palette : 'atelier-dawn';
  let preview = null, previewObserver = null;
  let lastMainView = /^[a-z][a-z0-9-]{0,40}$/.test(saved.lastMainView || '') && saved.lastMainView !== 'ws-workbench'
    ? saved.lastMainView : 'home';
  function notify(message) { window.__zhikeRegistryHost?.toast?.(message, 'x'); }
  function persist() {
    try { localStorage.setItem(KEY, JSON.stringify({ version: 1, palette, lastMainView })); }
    catch { notify('外观已应用，但本机偏好未能保存；业务资料未修改。'); }
  }
  function setPalette(value) {
    if (!palettes.has(value)) return false;
    finishPreview(false);
    palette = value; root.dataset.palette = palette; persist();
    return true;
  }
  root.dataset.palette = palette;
  function currentTheme() { return palette === 'horizon-night' ? 'dark' : 'light'; }
  function syncWorkspace() {
    const view = root.dataset.view || 'home', isWs = view === 'ws-workbench';
    if (!isWs && /^[a-z][a-z0-9-]{0,40}$/.test(view) && view !== lastMainView) { lastMainView = view; persist(); }
    for (const button of document.querySelectorAll('[data-workspace-target]')) {
      const active = (button.dataset.workspaceTarget === 'ws') === isWs;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    }
  }
  function navigationAvailable(entry) {
    return entry && !entry.hidden && !entry.disabled && !entry.classList?.contains('hidden') &&
      entry.getAttribute('aria-disabled') !== 'true' && entry.getAttribute('aria-hidden') !== 'true';
  }
  function navigate(workspace) {
    const current = root.dataset.view || 'home';
    if ((workspace === 'ws') === (current === 'ws-workbench')) return;
    const route = workspace === 'ws' ? 'ws-workbench' : lastMainView;
    // The legacy follow-up workspace is reached through the customer workflow,
    // without adding a new main-sidebar item or a generic routing capability.
    if (workspace === 'main' && route === 'followups') {
      const entry=document.querySelector('#mainNav [data-view="customers"]');
      if (!navigationAvailable(entry)) {
        notify('工作台入口不可用，请检查导航设置或当前权限。'); return;
      }
      const restore=window.__zhikeRegistryHost?.restoreFollowupView;
      if (typeof restore === 'function') { restore(); return; }
    }
    let button = document.querySelector('#mainNav [data-view="' + route + '"]');
    if (workspace === 'main' && !navigationAvailable(button)) {
      button = document.querySelector('#mainNav [data-view="home"]');
      if (!navigationAvailable(button)) {
        button = [...document.querySelectorAll('#mainNav .nav-item[data-view]')]
          .find(entry => entry.dataset.view !== 'ws-workbench' && navigationAvailable(entry));
      }
    }
    if (!navigationAvailable(button)) {
      notify('工作台入口不可用，请检查导航设置或当前权限。'); return;
    }
    // Reuse the existing navigation event path and Native/Core lifecycle.
    button.click();
  }
  function appearanceDialog() {
    const host = window.__zhikeRegistryHost;
    if (!host?.openModal) { notify('界面尚未准备完成，请稍后重试。'); return; }
    finishPreview(false);
    preview = palette;
    host.openModal('外观偏好', '仅保存在当前设备，不改变业务规则。',
      '<div data-shell-appearance><fieldset class="appearance-palettes"><legend>工作台主题</legend>' +
      '<label><input type="radio" name="shellPalette" value="atelier-dawn" ' + (palette === 'atelier-dawn' ? 'checked' : '') +
      '>晨光蓝紫<span>清晰浅色面板与蓝紫重点</span></label>' +
      '<label><input type="radio" name="shellPalette" value="horizon-night" ' + (palette === 'horizon-night' ? 'checked' : '') +
      '>Horizon 夜色<span>保留深海色与克制光带</span></label></fieldset>' +
      '<p class="panel-note" role="status">选择即可预览；点击“完成”保存。取消或关闭窗口会恢复原主题。WhatsApp 内部主题保持独立。</p></div>',
      '<button class="btn" data-shell-action="reset">恢复默认外观</button>' +
      '<button class="btn" data-shell-action="cancel">取消预览</button>' +
      '<button class="btn primary" data-shell-action="close">完成</button>'
    );
    // Observe the existing modal lifecycle instead of changing its business
    // close handler. Escape, backdrop, header close and replacement all cancel.
    const backdrop = document.querySelector('#modalBackdrop'), modal = document.querySelector('#modal');
    if (backdrop && modal) {
      previewObserver = new MutationObserver(() => {
        if (backdrop.classList.contains('hidden') || !document.querySelector('#modal [data-shell-appearance]')) finishPreview(false);
      });
      previewObserver.observe(backdrop, { attributes: true, attributeFilter: ['class'] });
      previewObserver.observe(modal, { childList: true, subtree: true });
    }
  }
  function finishPreview(save) {
    previewObserver?.disconnect(); previewObserver = null;
    if (preview === null) return;
    const selected = preview; preview = null;
    if (save && selected !== palette) { palette = selected; persist(); }
    root.dataset.palette = palette;
  }
  function previewPalette(value) {
    if (preview === null || !palettes.has(value)) return;
    preview = value; root.dataset.palette = value;
  }
  document.addEventListener('click', event => {
    const workspace = event.target.closest('[data-workspace-target]');
    if (workspace) { navigate(workspace.dataset.workspaceTarget); return; }
    if (event.target.closest('#appearanceButton')) { appearanceDialog(); return; }
    const action = event.target.closest('[data-shell-action]');
    if (!action?.closest('#modal') || !document.querySelector('#modal [data-shell-appearance]')) return;
    if (action.dataset.shellAction === 'close' || action.dataset.shellAction === 'cancel') {
      finishPreview(action.dataset.shellAction === 'close');
      window.__zhikeRegistryHost?.closeModal?.();
    }
    if (action.dataset.shellAction === 'reset') {
      previewPalette('atelier-dawn');
      for (const radio of document.querySelectorAll('#modal input[name="shellPalette"]')) radio.checked = radio.value === 'atelier-dawn';
    }
  });
  document.addEventListener('change', event => {
    if (event.target.name !== 'shellPalette' || !event.target.closest('#modal [data-shell-appearance]')) return;
    previewPalette(event.target.value);
  });
  const observer = new MutationObserver(syncWorkspace);
  observer.observe(root, { attributes: true, attributeFilter: ['data-view'] });
  window.addEventListener('beforeunload', () => { finishPreview(false); observer.disconnect(); }, { once: true });
  window.ZhikeWorkspaceShell = Object.freeze({ setPalette, getPalette: () => palette, currentTheme });
  syncWorkspace();
})();
