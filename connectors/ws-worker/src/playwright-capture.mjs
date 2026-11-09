/*
 * Optional Docker capture adapter. It only reads text that is currently
 * rendered and visible in the user's authorized WhatsApp Web page. It never
 * reads cookies, localStorage, passwords, QR payloads or platform databases.
 * The desktop WebView2 adapter remains the preferred interactive path.
 */

function collectVisibleDom(accountId) {
  // Keep every helper inside the function: Playwright serializes this
  // function into the page context and cannot see Node-side closures.
  const visible = (node) => {
    if (!node) return false;
    const rect = node.getBoundingClientRect?.();
    return Boolean(rect && rect.width > 0 && rect.height > 0);
  };
  const clean = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();
  const text = (node) => clean(node?.innerText || node?.textContent || '');
  const conversations = [];
  const seenConversations = new Set();
  for (const row of document.querySelectorAll('[role="listitem"], [data-testid="cell-frame-container"]')) {
    if (!visible(row)) continue;
    const conversationKey = clean(row.getAttribute('data-id') || row.getAttribute('data-chat-id') || row.getAttribute('aria-label') || '');
    if (!conversationKey || seenConversations.has(conversationKey)) continue;
    seenConversations.add(conversationKey);
    conversations.push({
      conversationKey,
      displayName: clean(row.querySelector('[title], span[dir="auto"]')?.getAttribute('title') || row.querySelector('span[dir="auto"]')?.textContent || ''),
      lastMessagePreview: text(row).slice(-500),
      lastMessageAt: '',
      unreadCount: Number(row.querySelector('[aria-label*="unread" i]')?.textContent || 0) || 0,
      visibleOnly: true,
    });
  }
  const messages = [];
  const seenMessages = new Set();
  for (const node of document.querySelectorAll('[data-testid="msg-container"], [data-pre-plain-text]')) {
    if (!visible(node)) continue;
    const body = text(node.querySelector('span.selectable-text') || node);
    if (!body || /scan to log in|扫码登录/i.test(body)) continue;
    const externalMessageId = clean(node.getAttribute('data-id') || node.getAttribute('data-message-id') || '');
    const conversationKey = clean(node.closest('[data-id]')?.getAttribute('data-id') || document.querySelector('[data-testid="conversation-header"] [title]')?.getAttribute('title') || 'visible');
    const fingerprint = [externalMessageId, conversationKey, body].join('\u001f');
    if (seenMessages.has(fingerprint)) continue;
    seenMessages.add(fingerprint);
    messages.push({
      conversationKey,
      externalMessageId,
      body,
      direction: /message-out|data-pre-plain-text="\[.*\] you:/i.test(node.outerHTML || '') ? 'outgoing' : 'incoming',
      sentAt: '',
      cursor: externalMessageId,
    });
  }
  const pageText = clean(document.body?.innerText || '');
  const hasQr = Boolean(document.querySelector('[data-testid="qrcode"], canvas[aria-label*="QR" i]'));
  const loginRequired = hasQr || /scan to log in|use whatsapp on your computer|扫码登录/i.test(pageText);
  const sessionExpired = /session expired|会话已过期|重新登录/i.test(pageText) && !loginRequired;
  const knownShell = Boolean(document.querySelector('[role="application"], [data-testid="chat-list"], [aria-label*="chat" i], [aria-label*="聊天"]'));
  const structureRecognized = loginRequired || sessionExpired || knownShell || conversations.length > 0 || messages.length > 0;
  return {
    type: 'zhike.ws.capture',
    accountId,
    capturedAt: new Date().toISOString(),
    conversations,
    messages,
    loginRequired,
    sessionExpired,
    structureRecognized,
  };
}

export async function startPlaywrightCapture({
  accountId,
  profileDirectory,
  url = process.env.ZHIKE_WS_URL || 'https://web.whatsapp.com/',
  intervalMs = 5000,
  headless = String(process.env.ZHIKE_WS_HEADLESS || 'false').toLowerCase() === 'true',
  onCapture,
  onState = () => {},
} = {}) {
  if (!String(accountId || '').trim()) throw new Error('accountId is required');
  if (typeof onCapture !== 'function') throw new Error('onCapture is required');
  const { chromium } = await import('playwright');
  const context = await chromium.launchPersistentContext(profileDirectory, {
    headless,
    viewport: { width: 1440, height: 900 },
  });
  const page = context.pages()[0] || await context.newPage();
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  let stopped = false;
  let running = false;
  let mutationTimer;
  const capture = async () => {
    if (stopped || running || page.isClosed()) return;
    running = true;
    try {
      const payload = await page.evaluate(collectVisibleDom, String(accountId).trim());
      if (payload.sessionExpired) {
        onState({ state: '会话过期', accountId: String(accountId).trim() });
        return;
      }
      if (payload.loginRequired) {
        onState({ state: '等待登录', accountId: String(accountId).trim() });
        return;
      }
      if (!payload.structureRecognized) {
        onState({ state: '连接失败', code: 'page-structure-changed', accountId: String(accountId).trim(), message: '无法识别当前 WhatsApp 页面结构，已暂停本轮写入。' });
        return;
      }
      await onCapture(payload);
      onState({ state: '已连接', accountId: String(accountId).trim() });
    } catch (error) {
      onState({ state: '连接失败', accountId: String(accountId).trim(), message: String(error?.message || error).slice(0, 300) });
    } finally {
      running = false;
    }
  };
  const triggerCapture = () => {
    clearTimeout(mutationTimer);
    mutationTimer = setTimeout(() => void capture(), 350);
  };
  await page.exposeBinding('__zhikeDomChanged', triggerCapture);
  await page.evaluate(() => {
    window.__zhikeCaptureObserver?.disconnect?.();
    window.__zhikeCaptureObserver = new MutationObserver(() => window.__zhikeDomChanged?.());
    window.__zhikeCaptureObserver.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
  });
  await capture();
  // DOM changes provide near-real-time capture. Keep a low-frequency poll for
  // browser throttling, missed mutations and session-state transitions.
  const timer = setInterval(() => void capture(), Math.max(30_000, Number(intervalMs) || 30_000));
  return {
    page,
    context,
    stop: async () => {
      stopped = true;
      clearInterval(timer);
      clearTimeout(mutationTimer);
      await context.close();
    },
  };
}

export { collectVisibleDom };
