'use strict';

const assert = require('node:assert/strict');

(async () => {
  const { ConnectorSession, STATES } = await import('../src/session.mjs');
  const session = new ConnectorSession('acct-1');
  assert.equal(session.status().state, STATES.DISCONNECTED);
  session.transition('open');
  assert.equal(session.status().state, STATES.WAITING_LOGIN);
  session.transition('login');
  assert.equal(session.status().state, STATES.LOGGING_IN);
  session.transition('connected');
  assert.equal(session.status().state, STATES.CONNECTED);
  session.transition('session-expired');
  assert.equal(session.status().state, STATES.SESSION_EXPIRED);
  session.transition('retry');
  assert.equal(session.status().state, STATES.RECONNECTING);
  session.transition('connected');
  assert.equal(session.status().state, STATES.CONNECTED);
  assert.throws(() => session.transition('save-password'), /unsupported/i);
  assert.equal('password' in session.status(), false);
  console.log('WS connector session state machine: login, reconnect and secret-free status pass');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
