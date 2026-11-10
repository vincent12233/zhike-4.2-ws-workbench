namespace Zhike.Desktop.Services;

public static class LegacyBridgeScript
{
    private const string SourceTemplate = """
      (() => {
        const listeners = new Map();
        const pending = new Map();
        const DEFAULT_TIMEOUT_MS = 15000;
        const WRITE_TIMEOUT_MS = 120000;
        const SNAPSHOT_TIMEOUT_MS = 300000;
        const MAX_MESSAGE_CHARS = 50 * 1024 * 1024;
        window.__DESKTOP_APP__ = true;
        window.__LOCAL_DB__ = __ZHikeLocalDbFlag__;
        window.__ZHIKE_STORAGE_MODE__ = __ZhikeStorageMode__;
        const host = {
          version: '5.1',
          invoke(method, payload = {}, options = {}) {
            const requestId = (globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : `${Date.now()}-${Math.random()}`);
            const path = method === 'legacy.api' ? String(payload?.path || '') : '';
            const verb = method === 'legacy.api' ? String(payload?.method || 'GET').toUpperCase() : 'GET';
            const isSnapshotWrite = verb !== 'GET' && verb !== 'HEAD' && /^\/api\/snapshots?(?:\/.*\/restore)?$/i.test(path);
            const isLargeWrite = verb !== 'GET' && verb !== 'HEAD' && (/^\/api\/state(?:\/|$)/i.test(path) || /^\/api\/import\//i.test(path));
            const timeoutLimit = isSnapshotWrite ? SNAPSHOT_TIMEOUT_MS : WRITE_TIMEOUT_MS;
            const timeoutMs = Math.min(timeoutLimit, Math.max(1000, Number(options.timeoutMs) || (isSnapshotWrite ? SNAPSHOT_TIMEOUT_MS : isLargeWrite ? WRITE_TIMEOUT_MS : DEFAULT_TIMEOUT_MS)));
            const envelope = JSON.stringify({
              type: 'zhike.bridge.request', requestId, bridgeVersion: '5.1',
              method, payload, timeoutMs,
              accountId: options.accountId || null
            });
            if (envelope.length > MAX_MESSAGE_CHARS)
              return Promise.reject(Object.assign(new Error('desktop bridge payload is too large (limit 50 MB)'), { code: 'MESSAGE_TOO_LARGE' }));
            return new Promise((resolve, reject) => {
              const timer = setTimeout(() => { pending.delete(requestId); reject(new Error(`desktop bridge timeout (${method})`)); }, timeoutMs);
              pending.set(requestId, { resolve, reject, timer });
              try { window.chrome.webview.postMessage(envelope); }
              catch (error) { clearTimeout(timer); pending.delete(requestId); reject(error); }
            });
          },
          on(name, handler) {
            const set = listeners.get(name) || new Set();
            set.add(handler); listeners.set(name, set);
            return () => set.delete(handler);
          },
          ws: (payload = {}, options = {}) => host.invoke('ws', payload, options).then(result => result.data ?? result),
          wsAccounts: (payload = {}, options = {}) => host.invoke('ws.accounts', payload, options).then(result => result.data ?? result),
          ai: (payload = {}, options = {}) => host.invoke('ai', payload, options).then(result => result.data ?? result),
          tools: (payload = {}, options = {}) => host.invoke('tools', payload, options).then(result => result.data ?? result),
          onWsStatus: (handler) => host.on('ws.status', handler),
          onCustomer: (handler) => host.on('open.customer', handler),
          onError: (handler) => host.on('tools.error', handler),
        };
        window.zhikeDesktop = host;
        const proxy = prefix => new Proxy({}, { get: (target, name) => target[name] || ((...args) => host.invoke(`${prefix}.${String(name)}`, args[0] || {}).then(result => result.data ?? result)) });
        window.zhikeTools = window.zhikeTools || proxy('tools');
        window.zhikeWs = window.zhikeWs || proxy('ws');
        window.zhikeAi = window.zhikeAi || proxy('ai');
        window.zhikeAI = window.zhikeAI || window.zhikeAi;
        // Excel import is a local parsing operation, not an AI request. The
        // generic proxy exposes unknown properties as bridge calls, so this
        // method must always override the proxy's `ai.parseExcel` fallback.
        window.zhikeAI.parseExcel = async ({ bytes } = {}) => {
          if (!window.XLSX) throw new Error('当前桌面资源未加载 Excel 解析器，请重新安装资源包。');
          const source = bytes instanceof ArrayBuffer ? bytes : (bytes?.buffer instanceof ArrayBuffer ? bytes.buffer : bytes);
          if (!source) throw new Error('Excel 内容为空。');
          const book = window.XLSX.read(source, { type: 'array', cellDates: true });
          const tables = book.SheetNames.map(name => {
            const sheet = book.Sheets[name];
            return { name, rows: window.XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: false }) };
          });
          return { tables, sheets: tables.map(item => ({ name: item.name, rows: item.rows.length })), text: tables.map(item => `--- ${item.name} ---\n${item.rows.map(row => row.join('\t')).join('\n')}`).join('\n\n') };
        };
        const nativeFetch = window.fetch.bind(window);
        window.fetch = async (input, init = {}) => {
          const url = typeof input === 'string' ? input : input?.url || '';
          if (!url.startsWith('/api/') || !window.__LOCAL_DB__) return nativeFetch(input, init);
          const method = String(init.method || (typeof input === 'object' ? input.method : 'GET') || 'GET').toUpperCase();
          const headers = {};
          const sourceHeaders = init.headers || (typeof input === 'object' ? input.headers : null);
          if (sourceHeaders) {
            if (sourceHeaders instanceof Headers) sourceHeaders.forEach((value, key) => { headers[key] = value; });
            else Object.entries(sourceHeaders).forEach(([key, value]) => { headers[key] = String(value); });
          }
          if (method !== 'GET' && method !== 'HEAD' && !Object.keys(headers).some(key => key.toLowerCase() === 'x-idempotency-key')) headers['X-Idempotency-Key'] = `desktop-${globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : Date.now()}`;
          let body = {};
          let bodyKind = 'json';
          if (init.body) {
            if (typeof init.body === 'string') { try { body = JSON.parse(init.body); } catch (_) { body = init.body; bodyKind = 'text'; } }
            else if (init.body instanceof ArrayBuffer || ArrayBuffer.isView(init.body)) {
              const view = init.body instanceof ArrayBuffer ? new Uint8Array(init.body) : new Uint8Array(init.body.buffer, init.body.byteOffset, init.body.byteLength);
              let binary = ''; for (const byte of view) binary += String.fromCharCode(byte);
              body = { base64: btoa(binary) }; bodyKind = 'binary';
            }
          }
          let result;
          try { result = await host.invoke('legacy.api', { path: url, method, headers, body, bodyKind }); }
          catch (error) { result = { ok: false, errorCode: error?.code || 'SERVICE_UNAVAILABLE', message: error?.message || '本机服务暂不可用。' }; }
          const status = result.ok ? 200 : ({ AUTH_REQUIRED: 401, CONFLICT: 409, UNSUPPORTED: 501, SERVICE_UNAVAILABLE: 503, UPSTREAM_ERROR: 502 }[result.errorCode] || 400);
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

    public static string Build(bool apiConfigured)
        // The parameter is kept for source compatibility with older callers,
        // but the production WinUI shell now has one storage path: the
        // guarded loopback SQLite service. Never fall back to localStorage.
        => SourceTemplate
            .Replace("__ZHikeLocalDbFlag__", "true", StringComparison.Ordinal)
            .Replace("__ZhikeStorageMode__", "'local'", StringComparison.Ordinal);

    public static string Source => Build(true);
}
