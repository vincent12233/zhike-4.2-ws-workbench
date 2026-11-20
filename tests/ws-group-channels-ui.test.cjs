'use strict';
// Group channel page module: real module, fake request/redraw, no DOM needed.
const assert = require('node:assert/strict');
const { create } = require('../resources/app/modules/ws-group-channels-ui.js');

const results = [];
async function check(name, fn) {
  try { await fn(); results.push(true); console.log('PASS ' + name); }
  catch (error) { results.push(false); console.log('FAIL ' + name + ' :: ' + error.message); }
}
const ACCOUNT = 'dedicated-1';
const baseRow = { accountId: ACCOUNT, participantCount: 10, catalogStatus: 'active', lastSeenAt: '', groupCodeOrigin: '', pageCategory: '', assistant: '', defaultTags: [], autoCreateCustomers: true, monitorMembership: false, configured: false, revision: 0, updatedAt: '' };
function rows() {
  return [
    { ...baseRow, groupJid: 'a501@g.us', groupName: 'A-501 单导群', groupCode: '', detectedCode: 'A-501', detectedCodeStatus: 'detected', detectedCandidates: ['A-501'], channel: '', channelOrigin: '', channelHint: 'collector-guess', pending: true, pendingReason: 'code-unconfirmed' },
    { ...baseRow, groupJid: 'mix@g.us', groupName: 'A-560 与 F-502', groupCode: '', detectedCode: '', detectedCodeStatus: 'ambiguous', detectedCandidates: ['A-560', 'F-502'], channel: '', channelOrigin: '', channelHint: '', pending: true, pendingReason: 'code-ambiguous' },
    { ...baseRow, groupJid: 'f550@g.us', groupName: '<b>F-550</b> 粉丝群', groupCode: 'F-550', detectedCode: 'F-550', detectedCodeStatus: 'detected', detectedCandidates: ['F-550'], channel: 'FB群粉', channelOrigin: 'rule', channelHint: '', configured: true, pending: false, pendingReason: '', assistant: '小李' },
  ];
}
function harness({ scope = { accountId: ACCOUNT, sequence: 1, workspaceMode: 'dedicated', view: 'group-channels' }, respond } = {}) {
  const calls = [], downloads = [], toasts = [];
  let currentScope = scope;
  const page = create({
    getScope: () => currentScope,
    request: async (pathname, init = {}) => {
      calls.push({ pathname, method: init.method || 'GET', body: init.body ? JSON.parse(init.body) : undefined });
      return respond ? respond(pathname, init) : { rows: rows(), summary: { total: 3, pending: 2, configured: 1 }, builtinChannels: ['单导K', '单导B', 'FB群粉', 'API群粉', '短信群粉'], rules: [{ groupCode: 'F-550', channel: 'FB群粉', enabled: true }] };
    },
    redraw: () => {},
    download: (name, content) => downloads.push({ name, content }),
    toast: message => toasts.push(message),
  });
  return { page, calls, downloads, toasts, setScope: value => { currentScope = value; } };
}

(async () => {
  await check('renders nothing account-specific without a dedicated scope', async () => {
    const { page } = harness({ scope: { accountId: ACCOUNT, sequence: 1, workspaceMode: 'ordinary', view: 'group-channels' } });
    assert.match(page.render(), /请选择可用的专用 WS 账号/);
    assert.equal(await page.load(), false);
  });

  await check('loads with the account scope and renders summary, rows and pending reasons', async () => {
    const { page, calls } = harness();
    assert.equal(await page.load(), true);
    assert.match(calls[0].pathname, /^\/api\/ws\/group-channel-configs\?accountId=dedicated-1/);
    const html = page.render();
    assert.match(html, /群组 <b>3<\/b>/);
    assert.match(html, /待配置 <b>2<\/b>/);
    assert.match(html, /编号待确认/);
    assert.match(html, /名称含多个编号/);
  });

  await check('collector hint is shown as an unconfirmed clue, never as the channel', async () => {
    const { page } = harness(); await page.load();
    const html = page.render();
    const a501 = html.slice(html.indexOf('a501@g.us'), html.indexOf('mix@g.us'));
    assert.match(a501, /未配置/);
    assert.match(a501, /线索：collector-guess/);
    assert.doesNotMatch(a501, /ws-channel-pill/);
  });

  await check('rule-derived channel is labelled as coming from a code rule', async () => {
    const { page } = harness(); await page.load();
    const html = page.render();
    assert.match(html, /<span class="ws-channel-pill">FB群粉<\/span><small class="ws-channel-origin">编号规则<\/small>/);
  });

  await check('group names are escaped', async () => {
    const { page } = harness(); await page.load();
    const html = page.render();
    assert.doesNotMatch(html, /<b>F-550<\/b> 粉丝群/);
    assert.match(html, /&lt;b&gt;F-550&lt;\/b&gt; 粉丝群/);
  });

  await check('detected code needs a click to confirm and sends only the code', async () => {
    const { page, calls } = harness({ respond: (pathname, init) => init.method === 'POST' ? { applied: 1, summary: { ok: 1 }, rows: [{ status: 'ok', applied: true }] } : { rows: rows(), summary: {}, rules: [], builtinChannels: [] } });
    await page.load();
    assert.match(page.render(), /data-ws-action="group-channel-accept-code" data-group-jid="a501@g.us"/);
    assert.equal(await page.run('accept-code', { dataset: { groupJid: 'a501@g.us' } }), true);
    const post = calls.find(call => call.method === 'POST');
    assert.deepEqual(post.body, { accountId: ACCOUNT, groupJid: 'a501@g.us', groupCode: 'A-501' });
    assert.equal(await page.run('accept-code', { dataset: { groupJid: 'mix@g.us' } }), false, 'ambiguous names cannot be one-click confirmed');
  });

  await check('batch set sends one patch with only the chosen field to the selected groups', async () => {
    const { page, calls } = harness({ respond: (pathname, init) => init.method === 'POST' ? { applied: 2, summary: { ok: 2 }, rows: [] } : { rows: rows(), summary: {}, rules: [], builtinChannels: ['单导K'] } });
    await page.load();
    const box = jid => ({ dataset: { wsChannelSelect: jid }, checked: true, matches: selector => selector === '[data-ws-channel-select]' });
    page.control(box('a501@g.us')); page.control(box('f550@g.us'));
    assert.match(page.render(), /已选 2 个群组/);
    page.control({ dataset: {}, value: 'assistant', matches: s => s === '[data-ws-channel-batch="field"]' });
    page.control({ dataset: {}, value: '小王', matches: s => s === '[data-ws-channel-batch="value"]' });
    assert.equal(await page.run('batch-apply', {}), true);
    const post = calls.find(call => call.method === 'POST');
    assert.deepEqual(post.body.patch, { assistant: '小王' });
    assert.deepEqual(post.body.groups.map(group => group.groupJid).sort(), ['a501@g.us', 'f550@g.us']);
  });

  await check('a blocked save shows the server reason instead of a generic failure', async () => {
    const { page } = harness({ respond: (pathname, init) => {
      if (init.method === 'POST') { const error = new Error('群组编号 A-501 已被另一个群组使用。'); error.status = 409; error.body = { applied: 0, rows: [{ status: 'conflict', conflicts: ['群组编号 A-501 已被另一个群组使用。'] }] }; throw error; }
      return { rows: rows(), summary: {}, rules: [], builtinChannels: [] };
    } });
    await page.load();
    await page.run('accept-code', { dataset: { groupJid: 'a501@g.us' } });
    assert.match(page.render(), /role="alert">群组编号 A-501 已被另一个群组使用。/);
  });

  await check('import previews first; apply is only enabled after a preview with writable rows', async () => {
    let lastBody;
    const { page } = harness({ respond: (pathname, init) => {
      if (pathname.includes('/import')) { lastBody = JSON.parse(init.body); return { dryRun: lastBody.dryRun, applied: lastBody.dryRun ? 0 : 1, summary: { ok: 1, unchanged: 0, conflict: 1, rejected: 0 }, rows: [{ line: 2, groupJid: 'a501@g.us', status: 'ok', changes: { channel: { from: '', to: '单导K' } } }, { line: 3, groupJid: 'mix@g.us', status: 'conflict', conflicts: ['冲突'] }] }; }
      return { rows: rows(), summary: {}, rules: [], builtinChannels: [] };
    } });
    await page.load();
    await page.run('import-toggle', {});
    assert.match(page.render(), /data-ws-action="group-channel-import-apply" disabled/);
    page.control({ dataset: {}, value: '群组ID,渠道\na501@g.us,单导K', matches: s => s === '[data-ws-channel-import-text]' });
    await page.run('import-preview', {});
    assert.equal(lastBody.dryRun, true);
    const html = page.render();
    assert.match(html, /导入 1 个可写入的群组/);
    assert.doesNotMatch(html, /data-ws-action="group-channel-import-apply" disabled/);
    assert.match(html, /渠道：空 → 单导K/);
    await page.run('import-apply', {});
    assert.equal(lastBody.dryRun, false);
  });

  await check('export downloads the server CSV', async () => {
    const { page, downloads, calls } = harness({ respond: pathname => pathname.includes('/export') ? { filename: '群组渠道配置.csv', csv: '﻿所属账号,群组ID\r\nd,a501@g.us\r\n' } : { rows: rows(), summary: { total: 3 }, rules: [], builtinChannels: [] } });
    await page.load();
    await page.run('export', {});
    assert.match(calls.at(-1).pathname, /format=json/);
    assert.equal(downloads.length, 1);
    assert.equal(downloads[0].name, '群组渠道配置.csv');
  });

  await check('a stale response from a previous account is discarded', async () => {
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    const h = harness({ respond: async () => { await gate; return { rows: rows(), summary: { total: 3 }, rules: [], builtinChannels: [] }; } });
    const loading = h.page.load();
    h.setScope({ accountId: 'other', sequence: 2, workspaceMode: 'dedicated', view: 'group-channels' });
    release();
    assert.equal(await loading, false);
    assert.doesNotMatch(h.page.render(), /a501@g.us/);
  });

  const failed = results.filter(ok => !ok).length;
  console.log(`WS group channel page: ${results.length - failed}/${results.length}`);
  if (failed) process.exit(1);
})();
