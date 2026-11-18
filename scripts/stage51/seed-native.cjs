'use strict';
// Synthetic fixture setup through actual isolated APIs; never starts WS or AI.
const assert = require('node:assert/strict');
const fs = require('node:fs'); const path = require('node:path'); const os = require('node:os');
const root = path.resolve(process.argv[2] || '');
assert.equal(path.dirname(root).toLowerCase(), path.resolve(os.tmpdir()).toLowerCase());
assert.match(path.basename(root), /^zhike-stage51-native-[a-f0-9]{32}$/);
assert.equal(fs.lstatSync(root).isSymbolicLink(), false);
assert.equal(fs.readFileSync(path.join(root, '.stage51-isolated'), 'utf8'), 'zhike-stage51-isolated-ui-v1');
const connection = JSON.parse(fs.readFileSync(path.join(root, 'connection.private.json'), 'utf8'));
assert.equal(connection.isolated, true); assert.equal(path.resolve(connection.root), root);
const endpoint = new URL(connection.endpoint); assert.equal(endpoint.hostname, '127.0.0.1'); assert.equal(endpoint.protocol, 'http:');
const headers = { 'content-type': 'application/json', 'x-zhike-api-token': connection.apiToken, origin: endpoint.origin };
const output = { synthetic: true, realWs: false, paidAi: false, accounts: [], groups: [], members: [], jobs: [], suggestions: [] };
async function call(route, body, method = 'POST') {
  const response = await fetch(new URL(route, endpoint), { method, headers, ...(method === 'GET' ? {} : { body: JSON.stringify(body || {}) }) });
  const value = await response.json(); assert.ok(response.ok, route + ': ' + JSON.stringify(value)); return value;
}
(async () => {
  if (fs.existsSync(path.join(root, 'seed-evidence.json'))) throw new Error('Fixture already seeded; preserve evidence instead of reseeding');
  const current = await call('/api/state', null, 'GET');
  assert.equal(current.customers.length, 0, 'seed only a fresh isolated workspace');
  const version = (await call('/api/state/version', null, 'GET')).version;
  const state = { ...current, customers: [{ id: 'C-native', name: '隔离测试客户', phone: '919000000051', rawPhone: '919000000051', occupation: '', language: '', country: '', deleted: false }, { id: 'C-manual', name: '人工资料保护测试', phone: '919000000052', rawPhone: '919000000052', occupation: '人工维护职业', deleted: false }], settings: { ...current.settings, workspaceName: '阶段 5.1 隔离验收' } };
  const put = await fetch(new URL('/api/state', endpoint), { method: 'PUT', headers: { ...headers, 'x-state-version': String(version) }, body: JSON.stringify(state) }); assert.equal(put.status, 200);
  await call('/api/ws/accounts', { id: 'native-b', displayName: '隔离账号 B' });
  const lease = (await call('/api/ws/fencing', { action: 'acquire', scopeKey: 'stage51-seed', ownerId: 'isolated-seed', leaseMs: 120000 })).lease;
  for (const accountId of ['default', 'native-b']) {
    output.accounts.push(accountId);
    for (const [i, groupJid] of ['12035101@g.us', '12035102@g.us'].entries()) {
      await call('/api/ws/group-manager/groups?accountId=' + accountId, { groupJid, name: '同名隔离群 ' + (i + 1), channelId: 'synthetic', participantCount: 1 }); output.groups.push({ accountId, groupJid });
      const member = await call('/api/ws/group-manager/members?accountId=' + accountId, { groupJid, memberJid: '919000000051@s.whatsapp.net', type: 'joined', approvalStatus: 'confirmed', sourceEventId: accountId + ':' + groupJid + ':joined', correlationId: 'native-flow-' + accountId }); output.members.push(member.member);
    }
    const conversationId = 'native-chat-' + accountId;
    await call('/api/ws/conversations', { id: conversationId, accountId, externalId: 'synthetic-' + accountId, title: 'TEST-' + accountId, unreadCount: 0, data: { conversationType: 'direct', historyLoaded: true, historyFingerprint: 'native-history', lastMessageFingerprint: 'native-history', directionVersion: 5 } });
    for (const [i, status] of ['pending', 'failed', 'completed'].entries()) {
      const jobBody = { accountId, conversationId, customerId: 'C-native', jobType: '隔离任务-' + status, idempotencyKey: 'native-' + accountId + '-' + status, correlationId: 'native-flow-' + accountId, lease };
      const job = (await call('/api/ws/ai-pipeline/jobs', jobBody)).job;
      if (status !== 'pending') {
        const claimed = (await call('/api/ws/ai-pipeline/jobs', { ...jobBody, action: 'claim', jobId: job.id })).job;
        await call('/api/ws/ai-pipeline/jobs', { ...jobBody, action: status === 'failed' ? 'fail' : 'complete', jobId: job.id, leaseToken: claimed.leaseToken, retryable: false, error: '明确标记的隔离失败样本', result: status === 'completed' ? { summary: '隔离 Mock 结果', confidence: 0.95, profileFacts: {} } : undefined });
      }
      output.jobs.push({ id: job.id, accountId, status });
      if (status === 'completed') {
        const items = await call('/api/ws/ai-pipeline/suggestions', { accountId, conversationId, jobId: job.id, customerId: 'C-native', lease, candidates: [{ fieldName: 'occupation', candidateValue: '工程师', sourceEvidence: '隔离样本：我是一名工程师', confidence: 0.95 }, { fieldName: 'language', candidateValue: 'English', sourceEvidence: '隔离样本：I speak English', confidence: 0.95 }] }); output.suggestions.push(...items.suggestions);
        const conflictJob = (await call('/api/ws/ai-pipeline/jobs', { ...jobBody, jobType: '隔离人工字段冲突', customerId: 'C-manual', idempotencyKey: 'native-conflict-job-' + accountId })).job;
        output.jobs.push({ id: conflictJob.id, accountId, status: conflictJob.status });
        const conflict = await call('/api/ws/ai-pipeline/suggestions', { accountId, jobId: conflictJob.id, customerId: 'C-manual', lease, idempotencyKey: 'native-conflict-' + accountId, candidates: [{ fieldName: 'occupation', candidateValue: '律师', sourceEvidence: '隔离冲突样本', confidence: 0.95 }] }); output.suggestions.push(...conflict.suggestions);
      }
    }
  }
  const after = await call('/api/state', null, 'GET'); assert.equal(after.customers.length, 2); assert.ok(output.members.every(item => item.customerId === 'C-native'));
  fs.writeFileSync(path.join(root, 'seed-evidence.json'), JSON.stringify(output, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  console.log(JSON.stringify({ seeded: true, synthetic: true, accounts: output.accounts.length, groups: output.groups.length, members: output.members.length, customerCount: after.customers.length, jobs: output.jobs.length, suggestions: output.suggestions.length }));
})().catch(error => { console.error(error.message); process.exitCode = 1; });
