'use strict';

const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { mkdtempSync, rmSync } = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const app = path.join(__dirname, '..', 'resources', 'app');
const dataDir = mkdtempSync(path.join(os.tmpdir(), 'zhike-ws-link-trust-'));
const port = 4539;
const token = 'ws-link-trust-test-token';
const child = spawn(process.env.ZHIKE_TEST_NODE || process.execPath, ['server.mjs'], {
  cwd: app,
  windowsHide: true,
  env: { ...process.env, ZHIKE_DATA_DIR: dataDir, ZHIKE_PORT: String(port), ZHIKE_API_TOKEN: token, ZHIKE_SHUTDOWN_TOKEN: token },
  stdio: 'ignore',
});
const headers = { 'content-type':'application/json', 'x-zhike-api-token':token, origin:`http://127.0.0.1:${port}` };
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

async function request(pathname, init = {}) {
  for (let attempt = 0; attempt < 300; attempt++) {
    try {
      const nextHeaders = { ...headers, ...(init.headers || {}) };
      if (String(init.method || 'GET').toUpperCase() !== 'GET' && pathname !== '/api/state' && !Object.keys(nextHeaders).some(key => key.toLowerCase() === 'x-state-version')) {
        const version = await fetch(`http://127.0.0.1:${port}/api/state/version`, { headers }).then(response => response.json());
        nextHeaders['x-state-version'] = String(version.version || '');
      }
      return await fetch(`http://127.0.0.1:${port}${pathname}`, { ...init, headers:nextHeaders });
    } catch { await wait(40); }
  }
  throw new Error('isolated server did not become available');
}
const body = value => JSON.stringify(value);
const json = response => response.json();
const post = (pathname, value) => request(pathname, { method:'POST', body:body(value) }).then(json);

(async () => {
  try {
    const shared = Array.from({ length:13 }, (_, index) => ({
      id:`C-SHARED-${index + 1}`,
      name:`Shared ${index + 1}`,
      phone:`7000000${String(index + 1).padStart(3, '0')}`,
      rawPhone:`7000000${String(index + 1).padStart(3, '0')}`,
      wsAccountIds:['default'],
      occupation:'',
      source:'WhatsApp',
      deleted:false,
    }));
    const customers = [
      ...shared,
      { id:'C-PHONE', name:'Phone Match', phone:'9888888888', rawPhone:'9888888888', wsAccountIds:['default'], occupation:'', source:'WhatsApp', deleted:false },
      { id:'C-CORRECT', name:'Correction Target', phone:'9555555555', rawPhone:'9555555555', wsAccountIds:['default'], occupation:'', source:'WhatsApp', deleted:false },
      { id:'C-MANUAL', name:'Manual Match', phone:'9777777777', rawPhone:'9777777777', occupation:'', source:'WhatsApp', deleted:false },
      { id:'C-WSID', name:'WS Identity', phone:'9666666666', rawPhone:'9666666666', wsExternalIds:['wa-trusted-id'], wsAccountIds:['default'], occupation:'', source:'WhatsApp', deleted:false },
    ];
    const initial = { schemaVersion:4, customers, savedViews:[], activities:[], tickets:[], deposits:[], followups:[], registrations:[], phoneRegistry:[], batchOperations:[], settings:{ operatingTasks:[] }, channelAliases:{}, importIssues:[], qualityDecisions:{} };
    assert.equal((await request('/api/state', { method:'POST', headers:{ ...headers, 'x-state-version':'' }, body:body(initial) })).status, 200);

    const analyze = async (conversation, result) => {
      const analysis = await post('/api/ws/analyses', { conversationId:conversation.id, result:{ summary:'isolated identity test', confidence:.95, ...result } });
      return post('/api/ws/crm-sync', { conversationId:conversation.id, analysisId:analysis.id });
    };

    const wrong = await post('/api/ws/conversations', {
      externalId:'wa-pending-wrong', title:'Pending wrong', customerId:'C-SHARED-1',
      data:{ customerMatch:'pending', previewOnly:true },
    });
    const wrongSync = await analyze(wrong, { contact:{ phone:'+91 98888 88888' }, profile:{ occupation:'Should not write' } });
    assert.equal(wrongSync.skipped, true, 'pending legacy customer id must not override a different independently matched phone');
    assert.equal(wrongSync.identityPending, true);

    const accountOnly = await post('/api/ws/conversations', {
      externalId:'wa-shared-account-only', title:'No independent identity', customerId:'C-SHARED-2',
      data:{ customerMatch:'identity-unconfirmed', previewOnly:true },
    });
    const accountSync = await analyze(accountOnly, { profile:{ occupation:'Must remain empty' } });
    assert.equal(accountSync.skipped, true, 'sharing one WS login with many customers is never customer identity evidence');
    assert.equal(accountSync.identityPending, true);

    const phoneTrusted = await post('/api/ws/conversations', {
      externalId:'+91 98888 88888', title:'Phone trusted', customerId:'C-PHONE',
      data:{ customerMatch:'pending' },
    });
    const phoneTrustedSync = await analyze(phoneTrusted, { contact:{ phone:'+91 98888 88888' }, profile:{ occupation:'Phone verified occupation' } });
    assert.equal(phoneTrustedSync.skipped, false, 'an exact normalized phone may verify the same pending association');
    assert.equal(phoneTrustedSync.customer.id, 'C-PHONE');

    const corrected = await post('/api/ws/conversations', {
      externalId:'+91 95555 55555', title:'Visible phone identity', customerId:'C-SHARED-3',
      data:{ customerMatch:'pending' },
    });
    const correctedSync = await analyze(corrected, { profile:{ occupation:'Verified correction occupation' } });
    assert.equal(correctedSync.skipped, false, 'a unique visible conversation phone may correct a stale pending association');
    assert.equal(correctedSync.associationCorrected, true);
    assert.equal(correctedSync.customer.id, 'C-CORRECT');
    const correctedRows = await json(await request('/api/ws/conversations?accountId=default&limit=100'));
    const correctedConversation = correctedRows.conversations.find(item => item.id === corrected.id);
    assert.equal(correctedConversation.customerId, 'C-CORRECT');
    assert.equal(correctedConversation.data.customerBindingSource, 'verified-identity');
    assert.equal(correctedConversation.data.previousCustomerAssociationInvalidated, true);
    assert.equal(correctedConversation.data.previousCustomerId, 'C-SHARED-3');

    const manual = await post('/api/ws/conversations', {
      externalId:'wa-manual-link', title:'Manual', customerId:'C-MANUAL', bindingSource:'manual',
    });
    assert.equal(manual.data.customerMatch, 'manual', 'explicit operator binding must persist a reliable source marker');
    assert.equal(manual.data.customerBindingSource, 'manual');
    const manualSync = await analyze(manual, { profile:{ occupation:'Manual verified occupation' } });
    assert.equal(manualSync.skipped, false, 'explicit manual bindings remain compatible with CRM sync');
    assert.equal(manualSync.customer.id, 'C-MANUAL');

    // Simulate an old installation that already produced an analysis_profile
    // event, but whose conversation/customer association is later known only
    // as pending. The duplicate shortcut must not bypass the live trust gate.
    const beforeLegacyState = await json(await request('/api/state'));
    beforeLegacyState.customers = beforeLegacyState.customers.map(item => {
      if (item.id !== 'C-MANUAL') return item;
      const copy = { ...item };
      delete copy.wsExternalId; delete copy.wsExternalIds;
      delete copy.wsConversationId; delete copy.wsConversationIds;
      return copy;
    });
    const legacyVersion = await json(await request('/api/state/version'));
    assert.equal((await request('/api/state', { method:'POST', headers:{ 'x-state-version':legacyVersion.version }, body:body(beforeLegacyState) })).status, 200);
    const { DatabaseSync } = require('node:sqlite');
    const db = new DatabaseSync(path.join(dataDir, 'workspace.sqlite'));
    const stored = db.prepare('SELECT data_json FROM ws_conversations WHERE id=?').get(manual.id);
    const pendingData = JSON.parse(stored.data_json || '{}');
    pendingData.customerMatch = 'pending';
    delete pendingData.customerBindingSource;
    delete pendingData.customerBindingVerifiedAt;
    db.prepare('UPDATE ws_conversations SET data_json=? WHERE id=?').run(JSON.stringify(pendingData), manual.id);
    db.close();
    const beforeDuplicateVersion = await json(await request('/api/state/version'));
    // A profile-only analysis intentionally creates no reminder after the
    // evidence gate.  The duplicate trust check must use the persisted
    // analysis id from the customer sync, not depend on a follow-up object.
    assert.ok(manualSync.customer.wsAnalysisId, 'successful profile sync returns its analysis id even when no reminder is warranted');
    const blockedDuplicate = await post('/api/ws/crm-sync', { conversationId:manual.id, analysisId:manualSync.customer.wsAnalysisId });
    assert.equal(blockedDuplicate.skipped, true, 'an existing hot event must not bypass a now-pending identity link');
    assert.equal(blockedDuplicate.identityPending, true);
    assert.equal(blockedDuplicate.matched, false);
    const afterDuplicateVersion = await json(await request('/api/state/version'));
    assert.equal(afterDuplicateVersion.version, beforeDuplicateVersion.version, 'blocked duplicate must not mutate shared CRM state');

    const trusted = await post('/api/ws/conversations', {
      externalId:'wa-trusted-id', title:'Trusted WS identity', customerId:'C-WSID',
      data:{ customerMatch:'pending' },
    });
    const trustedSync = await analyze(trusted, { profile:{ occupation:'WS verified occupation' } });
    assert.equal(trustedSync.skipped, false, 'an exact stored WS identity may verify the pending association');
    assert.equal(trustedSync.customer.id, 'C-WSID');

    const state = await json(await request('/api/state'));
    assert.equal(state.customers.find(item => item.id === 'C-SHARED-1').occupation, '', 'wrong pending association must not modify the linked customer');
    assert.equal(state.customers.find(item => item.id === 'C-SHARED-2').occupation, '', 'shared-account association must not modify the linked customer');
    assert.equal(state.customers.find(item => item.id === 'C-SHARED-3').occupation, '', 'stale pending customer must remain unchanged when a unique visible phone corrects the association');
    assert.equal(state.customers.find(item => item.id === 'C-CORRECT').occupation, 'Verified correction occupation', 'only the independently verified customer may receive safe profile supplementation');
    assert.equal((state.settings.operatingTasks || []).some(item => ['C-SHARED-1','C-SHARED-2'].includes(String(item.customerId))), false, 'untrusted associations must not create follow-up tasks');

    console.log('WS CRM link trust: pending wrong links and shared accounts are blocked; manual and independent WS identity links pass');
  } finally {
    try { await fetch(`http://127.0.0.1:${port}/api/shutdown`, { method:'POST', headers:{ ...headers, 'x-zhike-shutdown-token':token } }); } catch {}
    if (child.exitCode === null) child.kill();
    try { rmSync(dataDir, { recursive:true, force:true }); } catch {}
  }
})().catch(error => { console.error(error); process.exitCode = 1; });

