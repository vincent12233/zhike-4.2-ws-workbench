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
function cleanVisibleText(value) {
  return String(value || '')
    .replace(/[\u200e\u200f\u202a-\u202e]/g, '')
    .replace(/\s*此聊天中的新消息将在发送(?:7|90)天后自动消失(?:（除非消息已保留）)?。?\s*$/g, '')
    .replace(/\s*\d+\s*条未读消息\s*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
function conversationNodes() {
  const rowSelectors = [
    '[data-testid="chat-list"] [role="row"]',
    '[data-testid="chatlist"] [role="row"]',
    '[aria-label*="Chat list"] [role="row"]',
    '[aria-label*="聊天列表"] [role="row"]',
    '[role="grid"][aria-label*="Chat"] [role="row"]',
    '[role="grid"][aria-label*="聊天"] [role="row"]',
  ];
  const selectors = [
    '#pane-side [role="listitem"]',
    '[data-testid="chat-list"] [role="listitem"]',
    '[aria-label="Chat list"] [role="listitem"]',
    '[aria-label="聊天列表"] [role="listitem"]',
  ];
  const collect = list => {
    const seen = new Set();
    return list.flatMap(selector => {
      try { return [...document.querySelectorAll(selector)]; } catch { return []; }
    }).filter(node => {
      if (seen.has(node)) return false;
      seen.add(node);
      return true;
    });
  };
  const rows = collect(rowSelectors);
  if (rows.length) return rows;
  return collect(selectors);
}
function compactId(value) {
  let hash = 2166136261;
  for (const char of String(value || '')) { hash ^= char.codePointAt(0); hash = Math.imul(hash, 16777619); }
  return `row-${(hash >>> 0).toString(36)}`;
}
function splitAccessibleRow(value) {
  const normalized = cleanVisibleText(value);
  const withoutUnread = normalized.replace(/^\d+\s*条未读消息\s*/, '').trim();
  const stripSystemNotice = input => cleanVisibleText(input)
    .replace(/\s*此聊天中的新消息将在发送(?:7|90)天后自动消失(?:（除非消息已保留）)?。?\s*$/g, '')
    .replace(/\s*\d+\s*条未读消息\s*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const cleanRow = stripSystemNotice(withoutUnread);
  const marker = cleanRow.search(/\s+(?:(?:凌晨|早上|上午|中午|下午|晚上)\s*\d{1,2}:\d{2}|星期[一二三四五六日天]|昨天|今天|前天|\d{4}年\d{1,2}月\d{1,2}日)\s+/);
  if (marker < 0) return { title: cleanRow, preview: '' };
  const title = cleanRow.slice(0, marker).trim();
  const preview = stripSystemNotice(cleanRow.slice(marker).replace(/^\s+(?:(?:凌晨|早上|上午|中午|下午|晚上)\s*\d{1,2}:\d{2}|星期[一二三四五六日天]|昨天|今天|前天|\d{4}年\d{1,2}月\d{1,2}日)\s+/, ''));
  return { title, preview };
}
function readConversationNodes() {
  return conversationNodes().map((node, index) => {
    const label = String(node.getAttribute('aria-label') || node.getAttribute('title') || '').slice(0, 1000);
    const labels = [node, ...node.querySelectorAll?.('[aria-label], [aria-description], [title], [data-pre-plain-text]') || []].map(element => String(element.getAttribute?.('aria-label') || element.getAttribute?.('aria-description') || element.getAttribute?.('title') || element.getAttribute?.('data-pre-plain-text') || '')).filter(Boolean);
    const pageText = labels.join(' ').replace(/\s+/g, ' ').trim().slice(0, 2000);
    const rowParts = splitAccessibleRow(pageText || label);
    let title = (rowParts.title || label || pageText.split(/\s{2,}|\n/)[0] || '').slice(0, 200);
    const previewNode = node.querySelector?.('[data-testid*="last-msg"], [data-testid*="message"], [data-testid*="preview"], [aria-description], span[title]');
    const previewText = stripSystemNotice(previewNode?.getAttribute?.('aria-label') || previewNode?.getAttribute?.('aria-description') || previewNode?.getAttribute?.('title') || previewNode?.getAttribute?.('data-pre-plain-text') || '').slice(0, 4000);
    if (previewText && title.toLocaleLowerCase().endsWith(previewText.toLocaleLowerCase()) && title.length > previewText.length) title = title.slice(0, -previewText.length).trim();
    const rowPreview = stripSystemNotice(rowParts.preview).slice(0, 4000);
    const previewCandidates = [previewText, rowPreview, stripSystemNotice(pageText.replace(title, '').trim()), stripSystemNotice(label)]
      .filter(value => value && value.toLocaleLowerCase() !== title.toLocaleLowerCase());
    const preview = (previewCandidates[0] || '').slice(0, 4000);
    const timeNode = node.querySelector?.('time, [data-testid*="time"], [aria-label*="AM"], [aria-label*="PM"]');
    const lastMessageAt = String(timeNode?.getAttribute?.('datetime') || timeNode?.getAttribute?.('aria-label') || timeNode?.getAttribute?.('title') || '').trim().slice(0, 100);
    const badge = node.querySelector?.('[aria-label*="unread"], [data-testid*="unread"]');
    const previewDirection = /^(你|我|you|me)\s*[:：]/i.test(preview) ? 'send' : 'receive';
    const identityNode = node.querySelector?.('[data-id], [data-testid*="cell-frame-container"], a[href*="chat"]');
    const rawExternalId = node.getAttribute('data-id') || identityNode?.getAttribute?.('data-id') || node.getAttribute('data-testid') || identityNode?.getAttribute?.('data-testid') || '';
    const externalId = String(rawExternalId || compactId(title || label || pageText.slice(0, 200))).slice(0, 200);
    return { index, title, externalId, preview, previewText, listText: pageText, lastMessageAt, previewDirection, previewOnly: true, unreadCount: Number(String(badge?.getAttribute?.('aria-label') || '').match(/\d+/)?.[0] || 0) };
  }).filter(item => item.title || item.externalId || item.preview);
}
function discoverVisibleConversations() { const conversations = readConversationNodes().slice(0, 500); return { supported: conversations.length > 0, conversations }; }
async function discoverAllConversations() {
  const selector = '#pane-side, [data-testid="chat-list"], [data-testid="chatlist"], [aria-label="Chat list"], [aria-label="聊天列表"], [aria-label="Conversation list"], [role="grid"][aria-label*="Chat"], [role="grid"][aria-label*="聊天"]';
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
