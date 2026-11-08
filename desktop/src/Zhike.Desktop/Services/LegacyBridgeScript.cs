namespace Zhike.Desktop.Services;

public static class LegacyBridgeScript
{
    public const string Source = """
      (() => {
        const listeners = new Map();
        const pending = new Map();
        window.__DESKTOP_APP__ = true;
        window.__LOCAL_DB__ = true;
        const host = {
          version: '5.1',
          invoke(method, payload = {}, options = {}) {
            const requestId = (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);
            return new Promise((resolve, reject) => {
              const timer = setTimeout(() => { pending.delete(requestId); reject(new Error('desktop bridge timeout')); }, options.timeoutMs || 15000);
              pending.set(requestId, { resolve, reject, timer });
              window.chrome.webview.postMessage(JSON.stringify({
                type: 'zhike.bridge.request', requestId, bridgeVersion: '5.1',
                method, payload, timeoutMs: options.timeoutMs || 15000,
                accountId: options.accountId || null
              }));
            });
          },
          on(name, handler) {
            const set = listeners.get(name) || new Set();
            set.add(handler); listeners.set(name, set);
            return () => set.delete(handler);
          }
        };
        window.zhikeDesktop = host;
        const proxy = prefix => new Proxy({}, { get: (_, name) => (...args) => host.invoke(`${prefix}.${String(name)}`, args[0] || {}) });
        window.zhikeTools = window.zhikeTools || proxy('tools');
        window.zhikeWs = window.zhikeWs || proxy('ws');
        window.zhikeAi = window.zhikeAi || proxy('ai');
        const nativeFetch = window.fetch.bind(window);
        window.fetch = async (input, init = {}) => {
          const url = typeof input === 'string' ? input : input?.url || '';
          if (!url.startsWith('/api/')) return nativeFetch(input, init);
          const method = String(init.method || (typeof input === 'object' ? input.method : 'GET') || 'GET').toUpperCase();
          let body = {};
          try { body = init.body ? JSON.parse(init.body) : {}; } catch (_) { body = {}; }
          const result = await host.invoke('legacy.api', { path: url, method, body });
          const status = result.ok ? 200 : (result.errorCode === 'AUTH_REQUIRED' ? 401 : 502);
          return new Response(JSON.stringify(result.data ?? { ok: result.ok, errorCode: result.errorCode, message: result.message }), { status, headers: { 'Content-Type': 'application/json' } });
        };
        window.chrome.webview.addEventListener('message', event => {
          const message = event.data || {};
          if (message.type === 'zhike.bridge.response') {
            const item = pending.get(message.requestId); if (!item) return;
            clearTimeout(item.timer); pending.delete(message.requestId);
            message.ok ? item.resolve(message) : item.reject(Object.assign(new Error(message.message || 'bridge error'), { code: message.errorCode }));
          }
          if (message.type === 'zhike.bridge.event') window.__zhikeDesktopDispatch?.(message);
        });
        window.__zhikeDesktopDispatch = (event) => {
          const set = listeners.get(event.name) || [];
          set.forEach((handler) => { try { handler(event.payload); } catch (_) {} });
        };
      })();
      """;
}
