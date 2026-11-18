'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repo = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(repo, 'resources', 'app', 'modules', 'ws-workbench.js'), 'utf8');

// The browser UI uploads media first and the broadcast plan references the
// account-scoped media id.  Inline base64 must not be posted to /api/ws/broadcast.
assert.match(source, /wsBroadcastFiles|broadcast-files/,
  'broadcast UI must expose an attachment picker');
assert.match(source, /data-ws-action=["'](?:pick-broadcast-files|clear-broadcast-attachments)/,
  'broadcast UI must expose attachment queue controls');
assert.match(source, /attachments/,
  'broadcast state and plan must carry attachment metadata');
assert.match(source, /payloadKind\s*:\s*(?:broadcastPayloadKind|["'](?:media|image|video|audio|document))/,
  'media plans must identify their payload kind');
assert.match(source, /\/api\/ws\/media/,
  'attachments must be uploaded through the account-scoped WS media endpoint');
assert.match(source, /send-media/,
  'a media queue item must use the native send-media bridge action');
const broadcastStart = source.indexOf("api('/api/ws/broadcast'");
const sendStart = source.indexOf('async function sendBroadcastItem');
const broadcastBlock = broadcastStart >= 0 && sendStart > broadcastStart ? source.slice(broadcastStart, sendStart) : source;
assert.doesNotMatch(broadcastBlock, /dataBase64/,
  'broadcast plan requests must reference media ids rather than inline base64');

console.log('ws-media-send-runtime: attachment upload, media-id plans and send-media dispatch required');
