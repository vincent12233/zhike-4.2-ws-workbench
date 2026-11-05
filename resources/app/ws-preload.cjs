const { contextBridge } = require('electron');

// The third-party WS page receives no CRM, AI, clipboard, cookie, or navigation API.
// These helpers return only coarse page-state markers or text explicitly selected by the user.
const exists = selectors => selectors.some(selector => {
  try { return Boolean(document.querySelector(selector)); } catch { return false; }
});
function probeStatus() {
  return {
    readyState: String(document.readyState || 'loading').slice(0, 20),
    online: navigator.onLine !== false,
    hasChatShell: exists(['#pane-side', '[data-testid="chat-list"]', '[aria-label="Chat list"]', '[aria-label="Conversation list"]']),
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
function discoverVisibleConversations() {
  const nodes = [...document.querySelectorAll('#pane-side [role="listitem"], [data-testid="chat-list"] [role="listitem"], [aria-label="Chat list"] [role="listitem"]')].slice(0, 500);
  return { supported: nodes.length > 0, conversations: nodes.map((node, index) => { const label = String(node.getAttribute('aria-label') || node.getAttribute('title') || '').slice(0, 1000); const badge = node.querySelector?.('[aria-label*="unread"], [data-testid*="unread"]'); return { index, title: label.slice(0, 200), externalId: String(node.getAttribute('data-id') || node.getAttribute('data-testid') || '').slice(0, 200), preview: label.slice(0, 1000), unreadCount: Number(String(badge?.getAttribute?.('aria-label') || '').match(/\d+/)?.[0] || 0) }; }).filter(item => item.title || item.externalId) };
}
function captureVisibleMessages() {
  const nodes = [...document.querySelectorAll('[data-pre-plain-text], [data-testid="msg-container"]')].slice(-500);
  return { supported: nodes.length > 0, messages: nodes.map((node, index) => { const outgoing = Boolean(node.closest?.('.message-out, [data-testid="msg-out"]')); const raw = String(node.getAttribute('aria-label') || node.getAttribute('data-pre-plain-text') || '').slice(0, 12000); return { index, text: outgoing ? `我：${raw}` : `客户：${raw}`, direction: outgoing ? 'send' : 'receive', marker: String(node.getAttribute('data-id') || '').slice(0, 200) }; }).filter(item => item.text) };
}
contextBridge.exposeInMainWorld('zhikeWsPage', Object.freeze({ version: '3', purpose: 'visible-page-only', probeStatus, captureSelection, discoverVisibleConversations, captureVisibleMessages }));
