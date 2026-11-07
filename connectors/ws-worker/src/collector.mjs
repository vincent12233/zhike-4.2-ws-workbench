export function normalizeVisibleMessage(input = {}) {
  return {
    externalMessageId: String(input.externalMessageId || '').trim(),
    conversationKey: String(input.conversationKey || '').trim(),
    body: String(input.body || '').trim(),
    sentAt: String(input.sentAt || '').trim(),
    direction: input.direction === 'outgoing' ? 'outgoing' : 'incoming',
    previewOnly: Boolean(input.previewOnly),
  };
}
