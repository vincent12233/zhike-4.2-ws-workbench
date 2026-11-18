'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repo = path.resolve(__dirname, '..');
const host = fs.readFileSync(path.join(repo, 'desktop', 'src', 'Zhike.Desktop', 'Views', 'LegacyUiHostPage.xaml.cs'), 'utf8');

// Media sending is a distinct, explicit bridge action.  It must never fall
// back to send-text when the WhatsApp page cannot expose a file input.
assert.match(host, /case\s+"send-media"/,
  'native WS bridge must expose an explicit send-media action');
assert.match(host, /SendWsMediaAsync\s*\(/,
  'send-media must have a dedicated native handler');
assert.match(host, /BuildWsSendMediaScript\s*\(/,
  'send-media must inject a dedicated, verifiable page script');
assert.match(host, /MEDIA_INPUT_NOT_FOUND/,
  'unsupported WS page structures must fail safely without sending text');
assert.match(host, /CONFIRMATION_REQUIRED/,
  'native media sends require explicit user confirmation');
assert.match(host, /WRONG_CONVERSATION/,
  'media sends must verify the foreground conversation before touching the page');
assert.match(host, /dataBase64|base64/i,
  'the bridge contract must carry the uploaded media bytes or a resolved payload');
assert.match(host, /GetBytesAsync\s*\(/,
  'media ids must be resolvable from the local media store when the renderer has no in-memory bytes');

console.log('ws-media-bridge-contract: explicit media action, safety refusal and conversation guard required');
