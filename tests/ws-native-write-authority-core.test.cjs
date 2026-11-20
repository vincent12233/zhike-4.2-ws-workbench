'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { randomBytes, timingSafeEqual } = require('node:crypto');
const { test } = require('node:test');
const source = fs.readFileSync(path.resolve(__dirname, '../resources/app/server.mjs'), 'utf8');
function between(start, end) { const a = source.indexOf(start), b = source.indexOf(end, a); assert.ok(a >= 0 && b > a); return source.slice(a, b); }
function authority(token) {
  const scope = { Buffer, nativeWriteToken: token, timingSafeEqual };
  vm.runInNewContext(between('function wsNativeWriteAuthorized(', 'const testStartupDiagnostics'), scope);
  return value => scope.wsNativeWriteAuthorized({ headers: value === undefined ? {} : { 'x-zhike-native-token': value } });
}
test('capture authority fails closed for absent configuration, session-only credentials and malformed UTF8 lengths', () => {
  const token = randomBytes(32).toString('hex');
  for (const value of [undefined, '', token]) assert.equal(authority('')(value), false);
  const verify = authority(token);
  for (const value of [undefined, '', 'session-token', token.slice(1), '界'.repeat(token.length), 'x'.repeat(token.length)]) assert.equal(verify(value), false);
  assert.equal(verify(token), true);
});
test('manual and imported metadata cannot mint native authority or member/direction evidence', () => {
  const scope = { wsObject: value => JSON.parse(JSON.stringify(value || {})) };
  vm.runInNewContext(between('function wsUnverifiedMessageData(', 'function wsConfirmNativeMessageAuthority('), scope);
  const claimed = { source: 'ws-webview2', nativeAuthorityVerified: true, senderIdentityTrusted: true,
    directionVersion: 4, directionSource: 'class-message-in', senderIdentitySource: 'sender-jid',
    senderId: '917000000001@s.whatsapp.net', observedAt: '2026-11-20T00:00:00.000Z', note: 'preserve history' };
  for (const origin of ['ws-manual', 'ws-restored-history']) {
    const actual = scope.wsUnverifiedMessageData(claimed, origin);
    assert.equal(actual.source, origin); assert.equal(actual.nativeAuthorityVerified, false); assert.equal(actual.senderIdentityTrusted, false);
    assert.equal(actual.directionSource, undefined); assert.equal(actual.directionVersion, undefined); assert.equal(actual.senderIdentitySource, undefined);
    assert.equal(actual.senderId, claimed.senderId); assert.equal(actual.note, claimed.note); assert.equal(actual.observedAt, claimed.observedAt);
  }
  assert.equal(claimed.nativeAuthorityVerified, true, 'do not mutate the caller object');
});
test('group observation requires the server-issued marker, not just source and direction labels', () => {
  const scope = { WS_NATIVE_DIRECTION_SOURCE_MAP: new Map([['class-message-in', 'receive']]) };
  vm.runInNewContext(between('function wsObservedGroupMessageData(', 'function wsRequireConfiguredGroup('), scope);
  const claimed = { source: 'ws-webview2', directionVersion: 4, directionSource: 'class-message-in', senderIdentityTrusted: true };
  assert.equal(scope.wsObservedGroupMessageData(claimed), false);
  assert.equal(scope.wsObservedGroupMessageData({ ...claimed, nativeAuthorityVerified: true }), true);
  assert.equal(scope.wsObservedGroupMessageData({ ...claimed, nativeAuthorityVerified: true, previewOnly: true }), false);
});
