'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const repo = path.resolve(__dirname, '..');
const scope = require(path.join(repo, 'resources/app/modules/ws-scope.js'));
const source = fs.readFileSync(path.join(repo, 'resources/app/modules/ws-workbench.js'), 'utf8');
const start = source.indexOf('  function configuredVipGroups(');
const end = source.indexOf('  async function wsBridge(', start);
assert.ok(start > 0 && end > start);
const settings = { wsGroupAllowlist: [
  { accountId: 'a', groupJid: '120-456@g.us', groupName: 'Same name' },
  { accountId: 'b', groupJid: '120-999@g.us', groupName: 'Same name' },
  { accountId: 'a', groupName: 'Name only' },
], wsVipGroups: ['legacy@g.us'] };
const context = vm.createContext({ window: { ZhikeWsScope: scope }, state: { activeAccountId: 'a' },
  text: value => String(value ?? '').trim(), getHost: () => ({ state: { settings } }) });
vm.runInContext(source.slice(start, end), context);
const read = () => Array.from(vm.runInContext('configuredVipGroups()', context));
assert.deepEqual(read(), ['120-456@g.us'], 'collector receives only an exact group JID for the selected account');
settings.wsGroupAllowlist = [];
assert.deepEqual(read(), [], 'revocation must reach the native collector despite old settings');
delete settings.wsGroupAllowlist;
assert.deepEqual(read(), [], 'legacy unscoped strings cannot silently authorize a collector');
settings.wsVipGroups = [{ accountId: 'a', groupJid: '120-456@g.us' }];
assert.deepEqual(read(), ['120-456@g.us'], 'explicit account/JID upgrade mappings remain usable');
context.window.ZhikeWsScope = undefined;
assert.deepEqual(read(), [], 'missing authorization module must fail closed');
console.log('WS collector bridge scope: exact account/JID grants and revocation PASS');
