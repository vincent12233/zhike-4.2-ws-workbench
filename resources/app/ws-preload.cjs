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
contextBridge.exposeInMainWorld('zhikeWsPage', Object.freeze({ version: '2', purpose: 'visible-page-only', probeStatus, captureSelection }));
