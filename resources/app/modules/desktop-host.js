(() => {
  'use strict';
  document.documentElement.dataset.desktopHost = 'true';
  window.__desktopHostReady = true;
  let refreshPromise = null, wantsWsRefresh = false, wantsSharedRefresh = false;
  const MAX_REFRESH_ITERATIONS = 2;
  const pendingWsAccounts = new Set();
  const yieldRefreshFrame = () => new Promise(resolve => {
    if (typeof window.requestAnimationFrame === 'function') window.requestAnimationFrame(() => resolve());
    else if (typeof setTimeout === 'function') setTimeout(resolve, 16);
    else if (typeof queueMicrotask === 'function') queueMicrotask(resolve);
    else Promise.resolve().then(resolve);
  });
  const queueRefresh = (includeSharedState, payload = null) => {
    wantsWsRefresh = true;
    if (includeSharedState) wantsSharedRefresh = true;
    const accountId = String(payload?.accountId || '').trim();
    if (accountId) pendingWsAccounts.add(accountId);
    if (refreshPromise) return refreshPromise;
    refreshPromise = (async () => {
      let iterations = 0;
      while (wantsWsRefresh || wantsSharedRefresh) {
        const refreshWs = wantsWsRefresh, refreshShared = wantsSharedRefresh;
        const accountIds = [...pendingWsAccounts];
        pendingWsAccounts.clear();
        wantsWsRefresh = false;
        wantsSharedRefresh = false;
        const jobs = [];
        if (refreshWs) {
          if (accountIds.length) for (const id of accountIds) jobs.push(Promise.resolve().then(() => window.__zhikeWsFollowups?.refresh?.(id)));
          else jobs.push(Promise.resolve().then(() => window.__zhikeWsFollowups?.refresh?.()));
        }
        if (refreshShared) jobs.push(Promise.resolve().then(() => window.__refreshSharedState?.()));
        await Promise.allSettled(jobs);
        iterations += 1;
        if ((wantsWsRefresh || wantsSharedRefresh) && iterations >= MAX_REFRESH_ITERATIONS) {
          iterations = 0;
          await yieldRefreshFrame();
        }
      }
    })().finally(() => {
      refreshPromise = null;
      if (wantsWsRefresh || wantsSharedRefresh) queueRefresh(false);
    });
    return refreshPromise;
  };
  const refresh = payload => queueRefresh(true, payload);
  const refreshWsOnly = payload => queueRefresh(false, payload);
  const refreshIngestion = payload => (payload?.background === true && payload?.sharedState !== true) ? refreshWsOnly(payload) : refresh(payload);
  window.__desktopHostRefresh = refresh;
  window.zhikeDesktop?.on?.('sync.updated', refreshIngestion);
  window.zhikeDesktop?.on?.('ws.message', refreshIngestion);
  // The 10-second native heartbeat only advances the WS/AI pipeline. Pulling
  // and rendering the whole CRM here would steal focus from forms on every
  // tick even when the shared state version has not changed.
  window.zhikeDesktop?.on?.('ws.background-tick', refreshWsOnly);
  window.zhikeDesktop?.on?.('ai.followup', refresh);
  window.addEventListener('zhike:desktop-sync', refresh);
  window.addEventListener('visibilitychange', () => {
    window.dispatchEvent(new CustomEvent('zhike:desktop-visibility', {
      detail: { hidden: Boolean(document.hidden) },
    }));
  });
})();
