(() => {
  'use strict';
  const budgets = Object.freeze({ shellInteractiveMs: 1500, routeSwitchMs: 300, wsMountMs: 3000 });
  const inFlight = new Map();
  const searchCache = new WeakMap();
  function searchIndex(rows, query, fields = []) {
    const needle = String(query || '').trim().toLocaleLowerCase();
    if (!needle) return rows;
    return rows.filter(row => {
      if (!row || typeof row !== 'object') return false;
      const signature = fields.map(field => String(row[field] ?? '')).join('\u0001');
      let cached = searchCache.get(row);
      if (!cached || cached.signature !== signature) { cached = { signature, text: signature.toLocaleLowerCase() }; searchCache.set(row, cached); }
      return cached.text.includes(needle);
    });
  }
  const cloneResult = value => value instanceof Response ? value.clone() : value;
  function requestCoalescer(key, factory) {
    const cacheKey = String(key || 'default');
    const current = inFlight.get(cacheKey);
    if (current) return current.then(cloneResult);
    const shared = Promise.resolve().then(factory);
    inFlight.set(cacheKey, shared);
    shared.finally(() => { if (inFlight.get(cacheKey) === shared) inFlight.delete(cacheKey); }).catch(() => {});
    return shared.then(cloneResult);
  }
  function pauseHiddenPolling(onVisible, onHidden = () => {}) {
    const update = () => document.hidden ? onHidden() : onVisible();
    document.addEventListener('visibilitychange', update, { passive: true });
    update();
    return () => document.removeEventListener('visibilitychange', update);
  }
  function measure(label, work) {
    const started = globalThis.performance?.now?.() ?? Date.now();
    return Promise.resolve().then(work).finally(() => {
      const elapsed = (globalThis.performance?.now?.() ?? Date.now()) - started;
      globalThis.dispatchEvent?.(new CustomEvent('zhike:performance', { detail: { label, elapsed, budget: budgets[`${label}Ms`] || null } }));
    });
  }
  const nativeFetch = window.fetch?.bind(window);
  if (nativeFetch) {
    window.fetch = (input, init = {}) => {
      const method = String(init.method || (typeof input === 'object' ? input?.method : 'GET') || 'GET').toUpperCase();
      const url = typeof input === 'string' ? input : input?.url || '';
      if (method !== 'GET' || !/^\/api\//.test(url)) return nativeFetch(input, init);
      // A shared GET must not be cancelled by one caller's AbortSignal. The
      // caller still receives a cloned response; non-coalesced requests keep
      // their original cancellation semantics.
      const sharedInit = { ...init };
      delete sharedInit.signal;
      return requestCoalescer(`global:${url}`, () => nativeFetch(input, sharedInit));
    };
  }
  window.ZhikeDesktopPerformance = Object.freeze({ budgets, requestCoalescer, pauseHiddenPolling, measure, searchIndex });
})();
