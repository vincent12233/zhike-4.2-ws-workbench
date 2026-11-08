(() => {
  'use strict';
  document.documentElement.dataset.desktopHost = 'true';
  window.__desktopHostReady = true;
  const refresh = () => {
    try { window.__zhikeWsFollowups?.refresh?.(); } catch (_) {}
    try { window.__refreshSharedState?.(); } catch (_) {}
  };
  window.__desktopHostRefresh = refresh;
  window.zhikeDesktop?.on?.('sync.updated', refresh);
  window.zhikeDesktop?.on?.('ws.message', refresh);
  window.zhikeDesktop?.on?.('ai.followup', refresh);
  window.addEventListener('zhike:desktop-sync', refresh);
})();
