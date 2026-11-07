import { mkdir } from 'node:fs/promises';
import { ConnectorSession } from './session.mjs';
import { ProfileStore } from './profile-store.mjs';
import { ConnectorApiClient } from './checkpoint-client.mjs';
import { CaptureBatchFlusher } from './flush-loop.mjs';
import { startPlaywrightCapture } from './playwright-capture.mjs';

const profileRoot = process.env.ZHIKE_PROFILE_ROOT || '/profiles';
await mkdir(profileRoot, { recursive: true });
console.log(JSON.stringify({ service: 'ws-connector', status: 'starting', profileRoot }));
const session = new ConnectorSession(process.env.ZHIKE_CONNECTOR_ID || 'docker-default');
const profiles = new ProfileStore(profileRoot);
const apiClient = new ConnectorApiClient();
const flusher = new CaptureBatchFlusher({ apiClient, profileStore: profiles, connectorId: process.env.ZHIKE_CONNECTOR_ID || 'docker-default' });
const accountQueues = new Map();
const lastHeartbeatAt = new Map();
const accountIds = String(process.env.ZHIKE_ACCOUNT_IDS || '').split(',').map((value) => value.trim()).filter(Boolean);
for (const accountId of accountIds) await profiles.ensure(accountId);
console.log(JSON.stringify({
  service: 'ws-connector',
  status: session.status(),
  capabilities: ['visible-conversation-list', 'visible-messages', 'checkpoint-resume', 'idempotent-batch'],
  scope: 'visible-authorized-content',
  apiAuthConfigured: Boolean(process.env.ZHIKE_API_TOKEN || process.env.ZHIKE_API_TOKEN_FILE),
}));

function enqueueCapture(capture) {
  const accountId = String(capture?.accountId || '').trim();
  if (!accountId) {
    console.error(JSON.stringify({ service: 'ws-connector', status: 'invalid-capture', message: 'accountId is required' }));
    return;
  }
  const previous = accountQueues.get(accountId) || Promise.resolve();
  const next = previous.catch(() => {}).then(() => flusher.flush(capture).then(async ({ response }) => {
    const now = Date.now();
    if (now - (lastHeartbeatAt.get(accountId) || 0) >= 30_000 && typeof apiClient.heartbeat === 'function') {
      try { await apiClient.heartbeat(accountId, '已连接'); } catch (error) {
        console.error(JSON.stringify({ service: 'ws-connector', status: 'heartbeat-failed', message: String(error?.message || error).slice(0, 300) }));
      }
      lastHeartbeatAt.set(accountId, now);
    }
    return response;
  }));
  accountQueues.set(accountId, next);
  next.then((response) => {
    console.log(JSON.stringify({ service: 'ws-connector', status: 'flushed', accepted: response?.accepted || 0, deduplicated: response?.deduplicated || 0 }));
  }).catch((error) => {
    console.error(JSON.stringify({ service: 'ws-connector', status: 'flush-failed', message: String(error?.message || error).slice(0, 300) }));
  }).finally(() => {
    if (accountQueues.get(accountId) === next) accountQueues.delete(accountId);
  });
}

// Capture adapters submit one JSON object per line on stdin. In addition, an
// optional Playwright mode can be enabled by explicitly setting an account ID
// and WS URL. It must never invent messages and only evaluates visible DOM text.
let inputBuffer = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  inputBuffer += chunk;
  if (inputBuffer.length > 8 * 1024 * 1024) {
    inputBuffer = '';
    console.error(JSON.stringify({ service: 'ws-connector', status: 'invalid-capture', message: 'capture line exceeds 8 MB' }));
    return;
  }
  let newline;
  while ((newline = inputBuffer.indexOf('\n')) >= 0) {
    const line = inputBuffer.slice(0, newline).trim();
    inputBuffer = inputBuffer.slice(newline + 1);
    if (!line) continue;
    let capture;
    try { capture = JSON.parse(line); } catch { console.error(JSON.stringify({ service: 'ws-connector', status: 'invalid-capture' })); continue; }
    enqueueCapture(capture);
  }
});

if (process.env.ZHIKE_WS_URL && accountIds.length > 0) {
  for (const accountId of accountIds) {
    const profileDirectory = await profiles.ensure(accountId);
    startPlaywrightCapture({
      accountId,
      profileDirectory,
      url: process.env.ZHIKE_WS_URL,
      onCapture: (capture) => new Promise((resolve) => { enqueueCapture(capture); resolve(); }),
      onState: (state) => console.log(JSON.stringify({ service: 'ws-connector', ...state })),
    }).catch((error) => console.error(JSON.stringify({ service: 'ws-connector', status: 'playwright-start-failed', accountId, message: String(error?.message || error).slice(0, 300) })));
  }
}

setInterval(() => {}, 60_000);
export { flusher };
