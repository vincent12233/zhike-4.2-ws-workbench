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
        const AI_REQUEST_TIMEOUT_MS = 115000;
        const AI_CONTROL_TIMEOUT_MS = 60000;
        const AI_CANCEL_TIMEOUT_MS = 5000;
        const MAX_MESSAGE_CHARS = 50 * 1024 * 1024;
        const createRequestId = () => (globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : `${Date.now()}-${Math.random()}`);
        const postAiCancellation = (targetRequestId) => {
          if (!targetRequestId) return;
          try {
            const envelope = JSON.stringify({
              type: 'zhike.bridge.request', requestId: createRequestId(), bridgeVersion: '6.0',
              method: 'ai.cancel', payload: { requestId: targetRequestId }, timeoutMs: AI_CANCEL_TIMEOUT_MS,
              accountId: null
            });
            if (envelope.length <= MAX_MESSAGE_CHARS) window.chrome.webview.postMessage(envelope);
          } catch (_) {}
        };
        window.__DESKTOP_APP__ = true;
        window.__LOCAL_DB__ = __ZHikeLocalDbFlag__;
        window.__ZHIKE_STORAGE_MODE__ = __ZhikeStorageMode__;
        const host = {
          version: '6.0',
          invoke(method, payload = {}, options = {}) {
            const requestId = createRequestId();
            const normalizedOptions = options && typeof options === 'object' ? options : {};
            const isAiRequest = method === 'ai.request' || method === 'ai' || method === 'ai.wsautomatic';
            const isAiNetworkControl = /^ai\.(?:testconnection|test|listmodels|models)$/i.test(method);
            const aiPayload = isAiRequest && payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {};
            const aiOperationId = isAiRequest ? String(aiPayload.requestId || requestId).slice(0, 128) : '';
            const bridgePayload = isAiRequest ? { ...aiPayload, requestId: aiOperationId } : payload;
            const path = method === 'legacy.api' ? String(payload?.path || '') : '';
            const verb = method === 'legacy.api' ? String(payload?.method || 'GET').toUpperCase() : 'GET';
            const isSnapshotWrite = verb !== 'GET' && verb !== 'HEAD' && /^\/api\/snapshots?(?:\/.*\/restore)?$/i.test(path);
            const isLargeWrite = verb !== 'GET' && verb !== 'HEAD' && (/^\/api\/state(?:\/|$)/i.test(path) || /^\/api\/import\//i.test(path));
            const isRestoreCommit = method === 'workspace.restore.part' && payload?.last === true;
            const timeoutLimit = isSnapshotWrite || isRestoreCommit ? SNAPSHOT_TIMEOUT_MS : WRITE_TIMEOUT_MS;
            const defaultTimeout = isSnapshotWrite || isRestoreCommit ? SNAPSHOT_TIMEOUT_MS : isLargeWrite ? WRITE_TIMEOUT_MS : isAiRequest ? AI_REQUEST_TIMEOUT_MS : isAiNetworkControl ? AI_CONTROL_TIMEOUT_MS : DEFAULT_TIMEOUT_MS;
            const timeoutMs = Math.min(timeoutLimit, Math.max(1000, Number(normalizedOptions.timeoutMs) || defaultTimeout));
            const envelope = JSON.stringify({
              type: 'zhike.bridge.request', requestId, bridgeVersion: '6.0',
              method, payload: bridgePayload, timeoutMs,
              accountId: normalizedOptions.accountId || null
            });
            if (envelope.length > MAX_MESSAGE_CHARS)
              return Promise.reject(Object.assign(new Error('desktop bridge payload is too large (limit 50 MB)'), { code: 'MESSAGE_TOO_LARGE' }));
            const signal = normalizedOptions.signal;
            if (signal?.aborted)
              return Promise.reject(Object.assign(new Error(`desktop bridge cancelled (${method})`), { code: 'CANCELLED' }));
            return new Promise((resolve, reject) => {
              const item = { resolve, reject, method, timer: null, signal: null, abortHandler: null };
              const fail = (error, cancelNative) => {
                if (pending.get(requestId) !== item) return;
                clearTimeout(item.timer); pending.delete(requestId);
                if (item.signal && item.abortHandler) item.signal.removeEventListener('abort', item.abortHandler);
                if (cancelNative && isAiRequest) postAiCancellation(aiOperationId);
                reject(error);
              };
              item.timer = setTimeout(() => fail(Object.assign(new Error(`desktop bridge timeout (${method})`), { code: 'TIMEOUT' }), true), timeoutMs);
              pending.set(requestId, item);
              if (signal?.addEventListener) {
                item.signal = signal;
                item.abortHandler = () => fail(Object.assign(new Error(`desktop bridge cancelled (${method})`), { code: 'CANCELLED' }), true);
                signal.addEventListener('abort', item.abortHandler, { once: true });
                if (signal.aborted) { item.abortHandler(); return; }
              }
              try { window.chrome.webview.postMessage(envelope); }
              catch (error) { fail(error, false); }
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
        const proxy = prefix => new Proxy({}, { get: (target, name) => target[name] || ((payload = {}, options = {}) => host.invoke(`${prefix}.${String(name)}`, payload, options).then(result => result.data ?? result)) });
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
        const restoreWorkspace = async (body, version) => {
          const transferId = crypto.randomUUID();
          let offset = 0, last = false;
          try {
            while (offset < body.length) {
              let end = Math.min(body.length, offset + 1024 * 1024);
              if (end < body.length && /[\uD800-\uDBFF]/.test(body[end - 1])) end--;
              last = end === body.length;
              const result = await host.invoke('workspace.restore.part', { transferId, offset, chunk: body.slice(offset, end), last, version });
              if (last) return Response.json(result.data);
              if (result.data?.nextOffset !== end) throw new Error('恢复分段未确认。');
              offset = end;
            }
            throw new Error('恢复请求为空。');
          } catch (error) {
            if (!last) await host.invoke('workspace.restore.part', { transferId, discard: true }).catch(() => {});
            const code = error?.code || 'SERVICE_UNAVAILABLE', message = error?.message || '工作区恢复结果未确认。';
            return Response.json({ code, error: message, errorCode: code, message }, { status: code === 'WORKSPACE_RESTORE_REJECTED' ? 409 : 503 });
          }
        };
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
          if (method === 'POST' && url === '/api/workspace/restore' && typeof init.body === 'string') {
            const version = Object.keys(headers).find(name => name.toLowerCase() === 'x-state-version');
            if (!version) return Response.json({ code: 'WORKSPACE_RESTORE_REJECTED', error: '恢复必须提供数据版本。' }, { status: 428 });
            return restoreWorkspace(init.body, headers[version]);
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
            if (item.signal && item.abortHandler) item.signal.removeEventListener('abort', item.abortHandler);
            if (message.ok) item.resolve(message);
            else {
              const error = Object.assign(new Error(message.message || 'bridge error'), { code: message.errorCode });
              // Only send outcome metadata crosses this error boundary. Never
              // attach arbitrary native payloads, bytes, credentials or data.
              if (/^ws(?:\.|$)/i.test(item.method) && message.data && typeof message.data === 'object') {
                if (['failed', 'unknown', 'local_attempted'].includes(message.data.deliveryState)) error.deliveryState = message.data.deliveryState;
                if (typeof message.data.dispatchAttempted === 'boolean') error.dispatchAttempted = message.data.dispatchAttempted;
                if (message.data.deliveryState === 'failed' && message.data.dispatchAttempted === false) {
                  if (message.data.notAttempted === true) error.notAttempted = true;
                  if (message.data.phase === 'preflight') error.phase = 'preflight';
                }
              }
              item.reject(error);
            }
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
