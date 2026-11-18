'use strict';

// Deterministic transport used only by isolated Stage 3 tests and development
// fixtures.  It deliberately has no credential, cookie, WebView, network, or
// platform integration.  The production WS collector can implement the same
// read-only shape later without changing the group-manager domain contract.

const text = value => String(value == null ? '' : value).normalize('NFKC').trim();
const groupJid = value => {
  const normalized = text(value).toLocaleLowerCase();
  if (!normalized.endsWith('@g.us')) throw new Error('groupJid is required');
  return normalized;
};
const accountId = value => {
  const normalized = text(value);
  if (!normalized) throw new Error('accountId is required');
  return normalized;
};
const clone = value => JSON.parse(JSON.stringify(value));

function createMockTransport(options = {}) {
  const accounts = new Map();
  const source = options.fixtures && typeof options.fixtures === 'object' ? options.fixtures : {};
  const seed = (scope, fixture = {}) => {
    const id = accountId(scope);
    accounts.set(id, {
      connection: { status: 'disconnected', lastError: '', lastConnectedAt: '' },
      groups: Array.isArray(fixture.groups) ? fixture.groups.map(item => ({ ...item, groupJid: groupJid(item.groupJid) })) : [],
      members: Array.isArray(fixture.members) ? fixture.members.map(item => ({ ...item, groupJid: groupJid(item.groupJid) })) : [],
      messages: Array.isArray(fixture.messages) ? fixture.messages.map(item => ({ ...item, groupJid: groupJid(item.groupJid) })) : [],
      readEvidence: Array.isArray(fixture.readEvidence) ? fixture.readEvidence.map(item => ({ ...item, groupJid: groupJid(item.groupJid) })) : [],
    });
    return snapshot(id);
  };
  const ensure = scope => accounts.get(accountId(scope)) || (seed(accountId(scope)), accounts.get(accountId(scope)));
  function snapshot(scope) {
    const data = ensure(scope);
    return clone({ accountId: accountId(scope), groups: data.groups, members: data.members, messages: data.messages, readEvidence: data.readEvidence });
  }
  for (const [id, fixture] of Object.entries(source)) seed(id, fixture);

  return Object.freeze({
    transport: 'mock',
    accounts: () => [...accounts.keys()],
    seed,
    connect(scope) {
      const id = accountId(scope);
      ensure(id);
      accounts.get(id).connection = { status: 'connected', lastError: '', lastConnectedAt: new Date().toISOString() };
      return { accountId: id, transport: 'mock', connected: true, credentials: false };
    },
    disconnect(scope, reason = '') {
      const id = accountId(scope); ensure(id);
      accounts.get(id).connection = { ...accounts.get(id).connection, status: 'disconnected', lastError: text(reason), };
      return { accountId: id, transport: 'mock', connected: false, credentials: false };
    },
    status(scope) { const id = accountId(scope); ensure(id); return clone({ accountId: id, ...accounts.get(id).connection }); },
    heartbeat(scope) { const id = accountId(scope); const data = ensure(id); if (data.connection.status !== 'connected') return { ok: false, accountId: id, status: data.connection.status }; return { ok: true, accountId: id, status: 'connected', checkedAt: new Date().toISOString() }; },
    sync(scope, group, options = {}) {
      const id = accountId(scope), jid = groupJid(group), data = ensure(id);
      const checkpoint = text(options.checkpoint);
      return { accountId: id, groupJid: jid, checkpoint, groups: clone(data.groups.filter(item => item.groupJid === jid)), members: clone(data.members.filter(item => item.groupJid === jid)), messages: clone(data.messages.filter(item => item.groupJid === jid)), readEvidence: clone(data.readEvidence.filter(item => item.groupJid === jid)), complete: options.failAt ? false : true };
    },
    listGroups(scope) { return clone(ensure(scope).groups); },
    listMembers(scope, group) {
      const jid = groupJid(group);
      return clone(ensure(scope).members.filter(item => item.groupJid === jid));
    },
    listMessages(scope, group) {
      const jid = groupJid(group);
      return clone(ensure(scope).messages.filter(item => item.groupJid === jid));
    },
    listReadEvidence(scope, group) {
      const jid = groupJid(group);
      return clone(ensure(scope).readEvidence.filter(item => item.groupJid === jid));
    },
    snapshot,
  });
}

module.exports = Object.freeze({ createMockTransport });
