import { mkdir } from 'node:fs/promises';
import { ConnectorSession } from './session.mjs';

const profileRoot = process.env.ZHIKE_PROFILE_ROOT || '/profiles';
await mkdir(profileRoot, { recursive: true });
console.log(JSON.stringify({ service: 'ws-connector', status: 'starting', profileRoot }));
const session = new ConnectorSession(process.env.ZHIKE_CONNECTOR_ID || 'docker-default');
console.log(JSON.stringify({
  service: 'ws-connector',
  status: session.status(),
  capabilities: ['visible-conversation-list', 'visible-messages', 'checkpoint-resume', 'idempotent-batch'],
  scope: 'visible-authorized-content',
}));

// The collector is intentionally idle until an account is paired by the API.
// It must never invent messages or seed demo data.
setInterval(() => {}, 60_000);
