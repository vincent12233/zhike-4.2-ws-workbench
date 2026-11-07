import { buildIngestBatch } from './collector.mjs';

export class CaptureBatchFlusher {
  constructor({ apiClient, profileStore, connectorId = '' } = {}) {
    if (!apiClient || typeof apiClient.ingestBatch !== 'function' || typeof apiClient.send !== 'function') throw new Error('apiClient is required');
    if (!profileStore || typeof profileStore.readCheckpoint !== 'function' || typeof profileStore.writeCheckpoint !== 'function') throw new Error('profileStore is required');
    this.apiClient = apiClient;
    this.profileStore = profileStore;
    this.connectorId = String(connectorId || '').trim();
  }

  async flush(capture = {}, signal) {
    const accountId = String(capture.accountId || '').trim();
    if (!accountId) throw new Error('accountId is required');
    const persisted = capture.checkpoint || await this.profileStore.readCheckpoint(accountId) || {};
    const batch = buildIngestBatch({ ...capture, accountId, checkpoint: persisted, connectorId: capture.connectorId || this.connectorId });
    const response = await this.apiClient.ingestBatch(batch, signal);
    // Protocol v1 commits checkpoints in the same transaction as messages.
    // Only fall back to the legacy endpoint when an adapter deliberately
    // omitted checkpoints from the batch.
    if (batch.checkpoint?.lastConversationKey && (!Array.isArray(batch.checkpoints) || batch.checkpoints.length === 0))
      await this.apiClient.send(accountId, batch.checkpoint, signal);
    await this.profileStore.writeCheckpoint(accountId, batch.checkpoint);
    return { response, batch };
  }
}
