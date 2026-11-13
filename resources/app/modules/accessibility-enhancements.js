(() => {
  'use strict';
  const modalBackdrop = () => document.querySelector('#modalBackdrop');
  const modal = () => document.querySelector('#modal');
  const focusableSelector = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
  const labelFromText = element => String(element.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 80);
  function labelControls(root = document) {
    root.querySelectorAll('button,[role="button"]').forEach(button => {
      if (button.getAttribute('aria-label') || button.getAttribute('aria-labelledby')) return;
      const title = button.getAttribute('title');
      const text = labelFromText(button);
      if (title) button.setAttribute('aria-label', title);
      else if (text && text.length <= 80) button.setAttribute('aria-label', text);
    });
    root.querySelectorAll('input,select,textarea').forEach(input => {
      if (input.getAttribute('aria-label') || input.getAttribute('aria-labelledby')) return;
      const label = input.closest('label');
      const labelText = label ? labelFromText(label).replace(input.value || '', '').trim() : '';
      const value = input.getAttribute('placeholder') || labelText;
      if (value) input.setAttribute('aria-label', value.slice(0, 100));
    });
    let tableIndex = 0;
    root.querySelectorAll('table').forEach(table => {
      const tablePrefix = `a11y-th-${Date.now().toString(36)}-${tableIndex++}`;
      if (!table.getAttribute('aria-label') && !table.getAttribute('aria-labelledby')) {
        const heading = table.closest('.panel')?.querySelector('.panel-title,h2,h3')?.textContent?.trim();
        if (heading) table.setAttribute('aria-label', heading);
      }
      const headers = [...table.querySelectorAll('thead th')];
      headers.forEach((th, index) => { if (!th.id) th.id = `${tablePrefix}-${index}`; });
      table.querySelectorAll('tbody tr').forEach(row => row.querySelectorAll('td').forEach((cell, index) => { if (!cell.getAttribute('headers')) { const th = headers[index]; if (th?.id) cell.setAttribute('headers', th.id); } }));
    });
  }
  function syncNavigation() {
    document.querySelectorAll('#mainNav [data-view]').forEach(item => {
      const active = item.classList.contains('active');
      item.setAttribute('aria-current', active ? 'page' : 'false');
      item.setAttribute('tabindex', '0');
    });
    const search = document.querySelector('#globalSearch');
    if (search && !search.getAttribute('aria-label')) search.setAttribute('aria-label', '搜索客户、号码、群编号，按 Enter 打开');
    const backup = document.querySelector('#backupButton');
    if (backup && !backup.getAttribute('aria-label')) backup.setAttribute('aria-label', '立即备份');
  }
  function syncModal() {
    const backdrop = modalBackdrop(), dialog = modal();
    if (!backdrop || !dialog) return;
    const hidden = backdrop.classList.contains('hidden');
    backdrop.setAttribute('aria-hidden', hidden ? 'true' : 'false');
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    const title = dialog.querySelector('h2,h1');
    if (title) { title.id ||= 'a11y-dialog-title'; dialog.setAttribute('aria-labelledby', title.id); }
    if (!hidden) labelControls(dialog);
  }
  function trapModalFocus(event) {
    const dialog = modal(), backdrop = modalBackdrop();
    if (!dialog || !backdrop || backdrop.classList.contains('hidden')) return;
    if (event.key === 'Escape') { dialog.querySelector('[data-action="close-modal"],.modal-close')?.click(); return; }
    if (event.key !== 'Tab') return;
    const nodes = [...dialog.querySelectorAll(focusableSelector)].filter(node => node.offsetParent !== null);
    if (!nodes.length) return;
    const first = nodes[0], last = nodes[nodes.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }
  function keyboardNavigation(event) {
    const target = event.target.closest?.('#mainNav [data-view]');
    if (!target || !['ArrowDown', 'ArrowUp', 'Home', 'End', 'Enter', ' '].includes(event.key)) return;
    const items = [...document.querySelectorAll('#mainNav [data-view]:not([hidden])')];
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); target.click(); return; }
    const index = items.indexOf(target); if (index < 0) return;
    event.preventDefault();
    const next = event.key === 'Home' ? items[0] : event.key === 'End' ? items.at(-1) : items[(index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length];
    next?.focus();
  }
  labelControls(); syncNavigation(); syncModal();
  document.addEventListener('keydown', trapModalFocus, true);
  document.addEventListener('keydown', keyboardNavigation, true);
  let queued = false;
  const refresh = () => {
    if (queued) return;
    queued = true;
    const run = () => {
      queued = false;
      // A full accessibility pass is intentionally limited to the active
      // view. The shell, embedded WS page and toast region can mutate without
      // requiring a rescan of every customer/table row.
      labelControls(document.querySelector('#viewContainer') || document);
      syncNavigation();
      syncModal();
    };
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(run);
    else queueMicrotask(run);
  };
  // Observe only owned DOM roots. Watching document.body made every WS
  // overlay/status mutation trigger a complete page scan while scrolling.
  const viewRoot = document.querySelector('#viewContainer');
  if (viewRoot) new MutationObserver(refresh).observe(viewRoot, { childList: true });
  const backdrop = modalBackdrop();
  if (backdrop) new MutationObserver(refresh).observe(backdrop, { attributes: true, attributeFilter: ['class', 'hidden'] });
  const dialog = modal();
  if (dialog) new MutationObserver(refresh).observe(dialog, { childList: true });
  const nav = document.querySelector('#mainNav');
  if (nav) new MutationObserver(refresh).observe(nav, { attributes: true, attributeFilter: ['class', 'hidden'] });
})();
