const { contextBridge } = require('electron');

// The third-party WS page receives no CRM, AI, clipboard, cookie, or navigation API.
// These helpers return only coarse page-state markers or text explicitly selected by the user.
const exists = selectors => selectors.some(selector => {
  try { return Boolean(document.querySelector(selector)); } catch { return false; }
});
function probeStatus() {
  return {
    readyState: String(document.readyState || 'loading').slice(0, 20),
    url: String(globalThis.location?.href || '').slice(0, 300),
    title: String(document.title || '').slice(0, 120),
    online: navigator.onLine !== false,
    hasChatShell: exists(['#pane-side', '#side', '[data-testid="chat-list"]', '[data-testid="chatlist"]', '[aria-label="Chat list"]', '[aria-label="Conversation list"]', '[aria-label*="Chats"]', 'main[role="main"]', '[role="grid"]']),
    hasAppShell: exists(['#app', '[data-testid="app"]']),
    hasQrMarker: exists(['[data-testid="qrcode"]', '[data-ref] canvas', 'canvas[aria-label*="Scan"]']),
    hasLoginMarker: exists(['input[type="tel"]', 'input[name="phone"]', '[data-testid="link-device-phone-number-code-screen"]']),
    hasExpiredMarker: exists(['[data-testid="alert-phone-logged-out"]', '[data-testid="connection-error"]', '[data-testid="offline-alert"]']),
  };
}
function captureSelection() {
  const source = String(window.getSelection?.()?.toString() || '');
  const text = source.slice(0, 120000);
  return { text, length: text.length, truncated: source.length > text.length };
}
function conversationNodes() { return [...document.querySelectorAll('#pane-side [role="listitem"], [data-testid="chat-list"] [role="listitem"], [aria-label="Chat list"] [role="listitem"]')]; }
function readConversationNodes() {
  return conversationNodes().map((node, index) => { const label = String(node.getAttribute('aria-label') || node.getAttribute('title') || '').slice(0, 1000); const badge = node.querySelector?.('[aria-label*="unread"], [data-testid*="unread"]'); return { index, title: label.slice(0, 200), externalId: String(node.getAttribute('data-id') || node.getAttribute('data-testid') || '').slice(0, 200), preview: label.slice(0, 1000), unreadCount: Number(String(badge?.getAttribute?.('aria-label') || '').match(/\d+/)?.[0] || 0) }; }).filter(item => item.title || item.externalId);
}
function discoverVisibleConversations() { const conversations = readConversationNodes().slice(0, 500); return { supported: conversations.length > 0, conversations }; }
async function discoverAllConversations() {
  const selector = '#pane-side, [data-testid="chat-list"], [aria-label="Chat list"], [aria-label="Conversation list"]';
  const container = document.querySelector(selector);
  if (!container) return discoverVisibleConversations();
  const seen = new Map(); let stableRounds = 0; let lastSize = 0; let scannedRounds = 0;
  for (let round = 0; round < 24 && stableRounds < 3; round += 1) {
    scannedRounds = round + 1;
    for (const item of readConversationNodes()) { const key = item.externalId || `${item.title}|${item.preview}`; if (key && !seen.has(key)) seen.set(key, { ...item, index: seen.size }); }
    const before = Number(container.scrollTop || 0); container.scrollTop = Math.min(Number(container.scrollHeight || before), before + Math.max(480, Number(container.clientHeight || 480) * 0.9));
    await new Promise(resolve => setTimeout(resolve, 180));
    const size = seen.size; stableRounds = size === lastSize ? stableRounds + 1 : 0; lastSize = size;
    if (container.scrollTop <= before && Number(container.scrollHeight || 0) <= Number(container.clientHeight || 0)) break;
  }
  return { supported: seen.size > 0, conversations: [...seen.values()].slice(0, 500), scannedRounds, coverage: seen.size ? 'page-list-scanned' : 'none' };
}
function captureVisibleMessages() {
  const nodes = [...document.querySelectorAll('[data-pre-plain-text], [data-testid="msg-container"]')].slice(-500);
  return { supported: nodes.length > 0, messages: nodes.map((node, index) => { const outgoing = Boolean(node.closest?.('.message-out, [data-testid="msg-out"]')); const raw = String(node.getAttribute('aria-label') || node.getAttribute('data-pre-plain-text') || '').slice(0, 12000); return { index, text: outgoing ? `我：${raw}` : `客户：${raw}`, direction: outgoing ? 'send' : 'receive', marker: String(node.getAttribute('data-id') || '').slice(0, 200) }; }).filter(item => item.text) };
}
contextBridge.exposeInMainWorld('zhikeWsPage', Object.freeze({ version: '4', purpose: 'visible-page-only-with-list-scan', probeStatus, captureSelection, discoverVisibleConversations, discoverAllConversations, captureVisibleMessages }));
