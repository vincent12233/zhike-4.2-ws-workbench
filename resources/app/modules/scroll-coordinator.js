(() => {
  'use strict';

  const STORAGE_KEY = 'zhike.scroll.positions.v1';
  const MAX_POSITIONS = 200;
  const positions = new Map();
  let pointerRegion = null;
  let mountFrame = 0;
  let restoreFrame = 0;
  let scrollingUntil = 0;
  let scrollEndTimer = 0;
  let idleTimer = 0;
  const idleQueue = new Set();
  const modalRuntimeId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const modalActionAttributes = [
    'data-action',
    'data-gpt-action',
    'data-registry-action',
    'data-be-action',
    'data-text-cancel',
    'data-text-submit',
  ];
  let modalWasOpen = false;
  let modalFingerprint = '';
  let modalPositionScope = '';
  let modalPositionPrefix = '';
  let modalSequence = 0;

  const definitions = [
    { selector: '#viewContainer', mode: 'page', id: 'page' },
    { selector: '#mainNav', mode: 'contain', id: 'navigation', scope: 'shell' },
    { selector: '.modal-body', mode: 'contain', id: 'modal' },
    { selector: '#customerDrawer,.customer-drawer,.details-drawer', mode: 'contain', id: 'customer-drawer' },
    { selector: '.preview-table-wrap', mode: 'contain', id: 'import-preview' },
    { selector: '.global-search-results', mode: 'contain', id: 'search-results' },
    { selector: '.batch-preview-list', mode: 'contain', id: 'batch-preview' },
    { selector: '.business-batch-list', mode: 'contain', id: 'business-batch' },
    { selector: '.v4-dimension-table', mode: 'contain', id: 'dimension-table' },
    { selector: '.v4-report', mode: 'contain', id: 'report' },
    { selector: '.gpt-context', mode: 'contain', id: 'gpt-context' },
    { selector: '.gpt-messages', mode: 'contain', id: 'gpt-messages' },
    { selector: '.ws-account-list', mode: 'contain', id: 'ws-accounts' },
    { selector: '.ws-session-list', mode: 'contain', id: 'ws-sessions' },
    { selector: '.ws-capture-panel:not(.is-collapsed)', mode: 'contain', id: 'ws-capture' },
    { selector: '.ws-message-list', mode: 'contain', id: 'ws-messages' },
    { selector: '.ws-assist-panel', mode: 'contain', id: 'ws-assist' },
    { selector: '.ws-hot-profile-fields', mode: 'contain', id: 'ws-profile-fields' },
    { selector: '.table-scroll', mode: 'horizontal', id: 'table' },
    { selector: '.table-wrap', mode: 'horizontal', id: 'table-wrap' },
    { selector: '.task-table-wrap', mode: 'horizontal', id: 'task-table' },
    { selector: '.registry-table-wrap', mode: 'horizontal', id: 'registry-table' },
    { selector: '.home-task-scroll', mode: 'horizontal', id: 'home-task-table' },
    { selector: '.pill-list', mode: 'horizontal', id: 'pills' },
    { selector: '.saved-view-strip', mode: 'horizontal', id: 'saved-views' },
    { selector: '.subnav', mode: 'horizontal', id: 'subnav' },
    { selector: '.ops-board', mode: 'horizontal', id: 'stage-board' },
  ];

  function routeName() {
    return String(window.__zhikeRegistryHost?.state?.view || document.body?.classList.contains('ws-mode') && 'ws-workbench' || 'home');
  }

  function safeNumber(value) {
    const number = Number(value);
    return Number.isFinite(number) && number >= 0 ? Math.min(number, 10000000) : 0;
  }

  function loadPositions() {
    try {
      const rows = JSON.parse(sessionStorage.getItem(STORAGE_KEY) || '[]');
      if (!Array.isArray(rows)) return;
      for (const row of rows.slice(-MAX_POSITIONS)) {
        if (!Array.isArray(row) || typeof row[0] !== 'string' || !row[1] || typeof row[1] !== 'object') continue;
        if (row[0].startsWith('modal:')) continue;
        positions.set(row[0].slice(0, 180), { top: safeNumber(row[1].top), left: safeNumber(row[1].left) });
      }
    } catch { /* Scroll positions are optional session state. */ }
  }

  function safeSemanticToken(value) {
    const token = String(value || '').trim().toLowerCase();
    return /^[a-z][a-z0-9:_-]{0,63}$/.test(token) ? token : '';
  }

  function stableHash(value) {
    let hash = 2166136261;
    for (let index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
  }

  // Modal identity is derived only from developer-owned semantic attributes.
  // It never reads headings, form values, customer data or other text content.
  function safeModalFingerprint(modal) {
    const explicit = safeSemanticToken(modal?.dataset?.scrollKey || modal?.dataset?.modalType);
    if (explicit) return `explicit-${stableHash(explicit)}`;
    const tokens = new Set();
    const selector = modalActionAttributes.map(name => `[${name}]`).join(',');
    for (const node of modal?.querySelectorAll?.(selector) || []) {
      for (const name of modalActionAttributes) {
        if (!node.hasAttribute?.(name)) continue;
        const token = safeSemanticToken(node.getAttribute?.(name)) || 'present';
        tokens.add(`${name}:${token}`);
      }
    }
    return `semantic-${stableHash([...tokens].sort().join('|') || 'generic-modal')}`;
  }

  function syncModalIdentity() {
    const modal = document.querySelector('#modal');
    const open = !document.querySelector('#modalBackdrop')?.classList.contains('hidden');
    if (!modal || !open) {
      discardModalPositions(modalPositionPrefix);
      modalWasOpen = false;
      modalFingerprint = '';
      modalPositionScope = '';
      modalPositionPrefix = '';
      return;
    }
    const fingerprint = safeModalFingerprint(modal);
    if (!modalWasOpen || fingerprint !== modalFingerprint) {
      discardModalPositions(modalPositionPrefix);
      modalSequence += 1;
      modalPositionScope = `${modalRuntimeId}-${modalSequence}-${fingerprint}`;
      modalPositionPrefix = `modal:${routeName()}:${modalPositionScope}`;
    }
    modalWasOpen = true;
    modalFingerprint = fingerprint;
  }

  function persistPositions() {
    try {
      const rows = [...positions.entries()].filter(([key]) => !key.startsWith('modal:')).slice(-MAX_POSITIONS);
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(rows));
    } catch { /* Do not let session storage affect business pages. */ }
  }

  function discardModalPositions(prefix) {
    if (!prefix) return;
    for (const key of positions.keys()) if (key.startsWith(`${prefix}::`)) positions.delete(key);
  }

  function regionScope(node) {
    if (node.dataset.scrollScope) return node.dataset.scrollScope;
    if (node.id === 'mainNav') return 'shell';
    if (node.closest?.('#modal')) {
      if (!modalPositionScope) syncModalIdentity();
      return modalPositionPrefix || `modal:${routeName()}:closed`;
    }
    return routeName();
  }

  function positionKey(node) {
    return `${regionScope(node)}::${node.dataset.scrollId || node.id || 'region'}`;
  }

  function savePosition(node) {
    if (!(node instanceof Element) || !node.dataset.scrollMode) return;
    positions.delete(positionKey(node));
    positions.set(positionKey(node), { top: safeNumber(node.scrollTop), left: safeNumber(node.scrollLeft) });
    if (positions.size > MAX_POSITIONS) positions.delete(positions.keys().next().value);
  }

  function findRegion(target) {
    if (!(target instanceof Element)) return null;
    // The visible sidebar contains fixed brand/workspace/footer chrome around
    // the actual #mainNav scroller. A wheel anywhere inside that visible rail
    // belongs to navigation; it must never fall through to the business page.
    if (target.closest('#sidebar')) return document.querySelector('#mainNav');
    return target.closest('[data-scroll-mode]');
  }

  function registerRegions(root = document) {
    for (const definition of definitions) {
      const nodes = [];
      if (root instanceof Element && root.matches(definition.selector)) nodes.push(root);
      nodes.push(...root.querySelectorAll(definition.selector));
      nodes.forEach((node, index) => {
        if (!node.dataset.scrollMode) node.dataset.scrollMode = definition.mode;
        if (!node.dataset.scrollId) node.dataset.scrollId = node.id || `${definition.id}-${index}`;
        if (definition.scope && !node.dataset.scrollScope) node.dataset.scrollScope = definition.scope;
        if (definition.mode === 'contain' && !node.hasAttribute('tabindex')) node.tabIndex = 0;
      });
    }
  }

  function restorePositions(root = document) {
    cancelAnimationFrame(restoreFrame);
    restoreFrame = requestAnimationFrame(() => {
      registerRegions(root);
      const nodes = [];
      if (root instanceof Element && root.matches('[data-scroll-mode]')) nodes.push(root);
      nodes.push(...root.querySelectorAll('[data-scroll-mode]'));
      for (const node of nodes) {
        const saved = positions.get(positionKey(node));
        if (!saved) continue;
        const maxTop = Math.max(0, node.scrollHeight - node.clientHeight);
        const maxLeft = Math.max(0, node.scrollWidth - node.clientWidth);
        node.scrollTop = Math.min(saved.top, maxTop);
        node.scrollLeft = Math.min(saved.left, maxLeft);
      }
    });
  }

  function scheduleMount(root = document) {
    if (mountFrame) return;
    mountFrame = requestAnimationFrame(() => {
      mountFrame = 0;
      registerRegions(root);
      syncModalState();
      restorePositions(root);
    });
  }

  function normalizedDelta(event, axis, viewport = 800) {
    let value = axis === 'x' ? Number(event.deltaX || (event.shiftKey ? event.deltaY : 0)) : Number(event.deltaY || 0);
    if (event.deltaMode === 1) value *= 16;
    else if (event.deltaMode === 2) value *= Math.max(120, Number(viewport) || 800);
    return Math.max(-1200, Math.min(1200, Number.isFinite(value) ? value : 0));
  }

  function canConsume(node, axis, delta) {
    if (!node || !delta) return false;
    const current = axis === 'x' ? node.scrollLeft : node.scrollTop;
    const maximum = axis === 'x' ? node.scrollWidth - node.clientWidth : node.scrollHeight - node.clientHeight;
    if (maximum <= 1) return false;
    return delta < 0 ? current > 0.5 : current < maximum - 0.5;
  }

  function applyDelta(node, axis, delta) {
    if (!node || !Number.isFinite(delta) || !delta) return false;
    const property = axis === 'x' ? 'scrollLeft' : 'scrollTop';
    const maximum = Math.max(0, axis === 'x' ? node.scrollWidth - node.clientWidth : node.scrollHeight - node.clientHeight);
    const current = safeNumber(node[property]);
    const next = Math.max(0, Math.min(maximum, current + delta));
    if (Math.abs(next - current) < 0.5) return false;
    node[property] = next;
    return true;
  }

  function markScrollActivity() {
    const wasScrolling = isScrolling();
    scrollingUntil = performance.now() + 150;
    document.documentElement.classList.add('zk-scroll-active');
    if (!wasScrolling) document.dispatchEvent(new CustomEvent('zhike:scroll-start'));
    clearTimeout(scrollEndTimer);
    scrollEndTimer = setTimeout(() => {
      if (isScrolling()) return;
      document.documentElement.classList.remove('zk-scroll-active');
      persistPositions();
      document.dispatchEvent(new CustomEvent('zhike:scroll-end'));
      flushIdleQueue();
    }, 170);
  }

  function isScrolling() {
    return performance.now() < scrollingUntil;
  }

  function onWheel(event) {
    markScrollActivity();
    const modalOpen = !document.querySelector('#modalBackdrop')?.classList.contains('hidden');
    const modal = document.querySelector('#modal');
    if (modalOpen && modal && !(event.target instanceof Element && modal.contains(event.target))) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    let region = findRegion(event.target);
    if (modalOpen && modal && (!region || !modal.contains(region))) region = modal.querySelector('.modal-body');
    if (!region) return;
    const horizontalIntent = event.shiftKey || Math.abs(event.deltaX) > Math.abs(event.deltaY);
    const mode = region.dataset.scrollMode;
    if (mode === 'horizontal') {
      if (!horizontalIntent) return; // A normal wheel belongs to the page.
      const delta = normalizedDelta(event, 'x', region.clientWidth);
      if (!canConsume(region, 'x', delta)) return;
      event.preventDefault();
      event.stopPropagation();
      region.scrollLeft += delta;
      savePosition(region);
      return;
    }
    if (horizontalIntent || mode === 'page') return;
    const delta = normalizedDelta(event, 'y', region.clientHeight);
    if (mode === 'contain') {
      event.preventDefault();
      event.stopPropagation();
      if (applyDelta(region, 'y', delta)) savePosition(region);
      return;
    }
    // Handoff regions keep native behaviour until reaching their boundary.
    // Only explicit contain regions are forbidden from moving the page.
  }

  function keyboardTarget() {
    const active = findRegion(document.activeElement);
    if (active?.isConnected) return active;
    if (pointerRegion?.isConnected) return pointerRegion;
    return document.querySelector('#viewContainer');
  }

  function onKeyDown(event) {
    if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.target instanceof Element && event.target.closest('input,textarea,select,[contenteditable="true"]')) return;
    const node = keyboardTarget();
    if (!node) return;
    const horizontal = node.dataset.scrollMode === 'horizontal';
    let axis = horizontal ? 'x' : 'y';
    let delta = 0;
    if (event.key === 'ArrowDown' && !horizontal) delta = 44;
    else if (event.key === 'ArrowUp' && !horizontal) delta = -44;
    else if (event.key === 'PageDown' && !horizontal) delta = Math.max(120, node.clientHeight * .86);
    else if (event.key === 'PageUp' && !horizontal) delta = -Math.max(120, node.clientHeight * .86);
    else if (event.key === 'ArrowRight' && horizontal) delta = 72;
    else if (event.key === 'ArrowLeft' && horizontal) delta = -72;
    else if (event.key === 'Home') delta = -Infinity;
    else if (event.key === 'End') delta = Infinity;
    else return;
    event.preventDefault();
    markScrollActivity();
    if (!Number.isFinite(delta)) {
      if (axis === 'x') node.scrollLeft = delta < 0 ? 0 : node.scrollWidth;
      else node.scrollTop = delta < 0 ? 0 : node.scrollHeight;
    } else if (axis === 'x') node.scrollLeft += delta;
    else node.scrollTop += delta;
    savePosition(node);
  }

  function syncModalState() {
    const open = !document.querySelector('#modalBackdrop')?.classList.contains('hidden');
    syncModalIdentity();
    document.documentElement.classList.toggle('zk-scroll-modal-open', open);
    if (!open) restorePositions(document);
  }

  function runWhenIdle(callback) {
    if (typeof callback !== 'function') return;
    if (!isScrolling()) { callback(); return; }
    idleQueue.add(callback);
    clearTimeout(idleTimer);
    idleTimer = setTimeout(flushIdleQueue, 180);
  }

  function flushIdleQueue() {
    if (isScrolling()) {
      clearTimeout(idleTimer);
      idleTimer = setTimeout(flushIdleQueue, 100);
      return;
    }
    const callbacks = [...idleQueue];
    idleQueue.clear();
    callbacks.forEach(callback => { try { callback(); } catch (error) { console.error('[scroll] idle callback failed', error); } });
  }

  loadPositions();
  registerRegions();
  restorePositions();
  document.addEventListener('wheel', onWheel, { capture: true, passive: false });
  document.addEventListener('scroll', event => {
    const region = findRegion(event.target);
    if (region) savePosition(region);
  }, { capture: true, passive: true });
  document.addEventListener('pointerover', event => { pointerRegion = findRegion(event.target); }, { passive: true });
  document.addEventListener('keydown', onKeyDown, true);
  window.addEventListener('pagehide', persistPositions, { capture: true });

  // One narrow observer replaces page-specific wheel patches. It watches only
  // direct view replacements and modal visibility, never the full WS subtree.
  const observer = new MutationObserver(records => {
    let viewChanged = false;
    let modalChanged = false;
    for (const record of records) {
      if (record.target === document.querySelector('#viewContainer')) viewChanged = true;
      if (record.target === document.querySelector('#modalBackdrop') || record.target === document.querySelector('#modal')) modalChanged = true;
    }
    if (viewChanged) scheduleMount(document.querySelector('#viewContainer') || document);
    if (modalChanged) { scheduleMount(document.querySelector('#modal') || document); syncModalState(); }
  });
  const view = document.querySelector('#viewContainer');
  const backdrop = document.querySelector('#modalBackdrop');
  const modal = document.querySelector('#modal');
  if (view) observer.observe(view, { childList: true });
  if (backdrop) observer.observe(backdrop, { attributes: true, attributeFilter: ['class', 'hidden'] });
  if (modal) observer.observe(modal, { childList: true });

  window.ZhikeScrollCoordinator = Object.freeze({
    registerRegions,
    restorePositions,
    savePosition,
    isScrolling,
    runWhenIdle,
    canConsume,
    applyDelta,
    normalizedDelta,
    safeModalFingerprint,
    positionCount: () => positions.size,
  });
})();
