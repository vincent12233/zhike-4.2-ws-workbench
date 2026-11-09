import { readFileSync } from 'node:fs';

function configuredToken(value = '') {
  const direct = String(value || '').trim();
  if (direct) return direct;
  const file = String(process.env.ZHIKE_API_TOKEN_FILE || '').trim();
  if (!file) return '';
  try { return readFileSync(file, 'utf8').trim(); } catch { return ''; }
}

export class CheckpointClient {
  constructor(baseUrl = process.env.ZHIKE_API_BASE_URL || '', fetchImpl = fetch, apiToken = process.env.ZHIKE_API_TOKEN || '') {
    this.baseUrl = String(baseUrl || '').replace(/\/$/, '');
    this.fetch = fetchImpl;
    this.apiToken = configuredToken(apiToken);
  }

  headers() {
    if (!this.apiToken) throw new Error('ZHIKE_API_TOKEN is required');
    return { 'content-type': 'application/json', authorization: `Bearer ${this.apiToken}` };
  }

  async send(accountId, checkpoint, signal) {
    if (!this.baseUrl) throw new Error('ZHIKE_API_BASE_URL is required');
    const normalizedAccountId = String(accountId || '').trim();
    if (!normalizedAccountId) throw new Error('accountId is required');
    if (!String(checkpoint?.lastConversationKey || '').trim()) return { saved: 0 };
    if (checkpoint?.accountId && checkpoint.accountId !== normalizedAccountId) throw new Error('checkpoint account mismatch');
    const updatedAt = checkpoint?.updatedAt || new Date().toISOString();
    const response = await this.fetch(`${this.baseUrl}/api/v2/ws/checkpoints`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify([{ accountId: normalizedAccountId, conversationKey: checkpoint?.lastConversationKey || '', cursor: checkpoint?.cursor || '', lastMessageFingerprint: checkpoint?.lastMessageFingerprint || '', updatedAt }]),
      signal,
    });
    if (!response.ok) throw new Error(`checkpoint endpoint returned ${response.status}`);
    return response.json();
  }
}

export class ConnectorApiClient extends CheckpointClient {
  constructor(baseUrl = process.env.ZHIKE_API_BASE_URL || '', { apiToken = process.env.ZHIKE_API_TOKEN || '', fetchImpl = fetch } = {}) {
    super(baseUrl, fetchImpl, apiToken);
  }

  async ingestBatch(batch, signal) {
    if (!this.baseUrl) throw new Error('ZHIKE_API_BASE_URL is required');
    const accountId = String(batch?.accountId || '').trim();
    if (!accountId) throw new Error('accountId is required');
    const messages = Array.isArray(batch.messages) ? batch.messages : [];
    for (const message of messages) {
      if (String(message?.accountId || '').trim() !== accountId) throw new Error('message account mismatch');
    }
    const conversations = Array.isArray(batch.conversations) ? batch.conversations.map((conversation) => {
      if (conversation?.accountId && String(conversation.accountId).trim() !== accountId) throw new Error('conversation account mismatch');
      return { ...conversation, accountId };
    }) : [];
    const payload = {
      protocol: String(batch.protocol || 'zhike.ws.ingest.batch.v1'),
      connectorId: String(batch.connectorId || '').trim(),
      accountId,
      capturedAt: batch.capturedAt || new Date().toISOString(),
      scope: String(batch.scope || 'visible-authorized-content'),
      messages,
      checkpoints: Array.isArray(batch.checkpoints) ? batch.checkpoints : [],
      conversations,
    };
    const response = await this.fetch(`${this.baseUrl}/api/v2/ws/ingest/batch`, {
      method: 'POST', headers: this.headers(), body: JSON.stringify(payload), signal,
    });
    if (!response.ok) throw new Error(`ingest endpoint returned ${response.status}`);
    return response.json();
  }

  async heartbeat(accountId, status = '已连接', signal) {
    const normalizedAccountId = String(accountId || '').trim();
    if (!normalizedAccountId) throw new Error('accountId is required');
    const response = await this.fetch(`${this.baseUrl}/api/v2/ws/heartbeat`, {
      method: 'POST', headers: this.headers(),
      body: JSON.stringify({ accountId: normalizedAccountId, status }), signal,
    });
    if (!response.ok) throw new Error(`heartbeat endpoint returned ${response.status}`);
    return response.json();
  }
}
