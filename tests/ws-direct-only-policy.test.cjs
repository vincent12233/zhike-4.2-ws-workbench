'use strict';
// Synthetic host authority for native-ingest positive fixtures; never a renderer fallback.
const nativeAuthorityToken = require('node:crypto').randomBytes(32).toString('hex');

const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { mkdtempSync, rmSync } = require('node:fs');
const path = require('node:path');
const fs = require('node:fs');
const { DatabaseSync } = require('node:sqlite');
const core = require('../resources/app/modules/ws-workbench-core.js');

assert.equal(core.conversationType({externalId:'123@g.us',conversationType:'direct'}),'group');
assert.equal(core.conversationType({externalId:'123@g.us',conversationType:'vip_group',vipGroup:true}),'vip_group');
assert.equal(core.isVipGroupConversation({externalId:'123@g.us',vipGroup:true,isGroup:true}),true);
assert.equal(core.isExcludedGroupConversation({externalId:'123@g.us',isGroup:true}),true);
const vipTranscript=core.buildVipMemberTranscript([
  {direction:'receive',originalText:'I am an engineer',data:{conversationType:'vip_group',senderId:'919876543210@c.us',senderName:'Existing',senderIdentityTrusted:true}},
  {direction:'receive',originalText:'I am a billionaire',data:{conversationType:'vip_group',senderId:'911111111111@c.us',senderName:'Other',senderIdentityTrusted:true}},
],{senderId:'919876543210@c.us',senderName:'Existing',senderIdentityTrusted:true});
assert.equal(vipTranscript.memberScoped,true);assert.equal(vipTranscript.targetStatementCount,1);assert.match(vipTranscript.text,/群成员\[Existing\]/);assert.match(vipTranscript.text,/群成员\[Other\]/);
const vipChunks=core.splitHistoryTranscript([
  {direction:'receive',originalText:'I am an engineer',data:{conversationType:'vip_group',senderId:'919876543210@c.us',senderName:'Existing',senderIdentityTrusted:true}},
  {direction:'receive',originalText:'I am a billionaire',data:{conversationType:'vip_group',senderId:'911111111111@c.us',senderName:'Other',senderIdentityTrusted:true}},
],{maxChars:16000});
assert.match(vipChunks[0].text,/群成员\[Existing\]/);
assert.match(vipChunks[0].text,/群成员\[Other\]/);
const workbenchSource=fs.readFileSync(path.join(__dirname,'../resources/app/modules/ws-workbench.js'),'utf8');
assert.match(workbenchSource,/function vipGroupMemberAnalysisScopes\(messages\)/);
assert.match(workbenchSource,/core\.buildVipMemberTranscript\?\.\(messages, requestedMemberIdentity/);
assert.match(workbenchSource,/memberScoped:\s*transcript\.memberScoped === true/);
assert.match(workbenchSource,/core\.buildNaturalChatAnalysisPrompt\(chunk\.text, \{ conversationId: conversation\.id, memberIdentity \}\)/);
assert.match(workbenchSource,/memberResults\.push\(await analyzeStoredConversation\(conversation, context/);
assert.equal(core.conversationType({externalId:'123@c.us',data:{isGroup:true}}),'group');
assert.equal(core.conversationType({title:'+91 1234567890',externalId:'numeric-name'}),'unknown');
assert.equal(core.conversationType({data_json:JSON.stringify({conversationType:'direct'})}),'direct');
assert.equal(core.conversationType({externalId:'status@broadcast',conversationType:'direct'}),'unknown');
assert.equal(core.detectChatImportType('[11/13/26, 10:30] Alice created this group').type,'group');
assert.equal(core.detectChatImportType('[11/13/26, 10:30] Alice: hello\n[11/13/26, 10:31] Bob: hello\n[11/13/26, 10:32] Carol: hello').reason,'multiple-senders');
assert.equal(core.detectChatImportType('[11/13/26, 10:30] Alice: I created this group at work').type,'unknown','ordinary message prose must not prove group identity');

const app=path.join(__dirname,'../resources/app');
const data=mkdtempSync(path.join(require('node:os').tmpdir(),'zhike-direct-policy-'));
const port=29000+(process.pid%18000),token='isolated-direct-policy';
const headers={'content-type':'application/json','x-zhike-native-token': nativeAuthorityToken, 'x-zhike-api-token':token};
let child, logs='';
let activeAccountId='default';
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function call(route,body,expected=200){
  if(route.startsWith('/api/ws/')&&!/[?&](?:accountId|allAccounts)=/.test(route))route+=(route.includes('?')?'&':'?')+'accountId='+activeAccountId;
  if(body&&route.startsWith('/api/ws/'))body={accountId:activeAccountId,...body};
  const version=await fetch(`http://127.0.0.1:${port}/api/state/version`,{headers}).then(r=>r.json());
  const response=await fetch(`http://127.0.0.1:${port}${route}`,{method:body===undefined?'GET':'POST',headers:{...headers,'x-state-version':version.version},body:body===undefined?undefined:JSON.stringify(body)});
  const result=await response.json();assert.equal(response.status,expected,JSON.stringify(result));return result;
}
async function start(){
  logs='';child=spawn(process.env.ZHIKE_TEST_NODE||process.execPath,['server.mjs'],{cwd:app,env:{...process.env,ZHIKE_DATA_DIR:data,ZHIKE_PORT:String(port),ZHIKE_NATIVE_WRITE_TOKEN: nativeAuthorityToken, ZHIKE_API_TOKEN:token,ZHIKE_SHUTDOWN_TOKEN:token},windowsHide:true,stdio:['ignore','pipe','pipe']});
  child.stdout.on('data',b=>logs+=b);child.stderr.on('data',b=>logs+=b);
  for(let i=0;i<1000;i++){try{await call('/api/health');return;}catch{if(child.exitCode!==null)break;await wait(30);}}
  throw Error(`isolated server did not start: ${logs}`);
}
async function stop(){
  if(!child||child.exitCode!==null)return;
  const exit=new Promise(resolve=>child.once('exit',resolve));
  try{await fetch(`http://127.0.0.1:${port}/api/shutdown`,{method:'POST',headers:{...headers,'x-zhike-shutdown-token':token}});}catch{}
  const outcome=await Promise.race([exit.then(()=>true),wait(3000).then(()=>false)]);
  if(!outcome){child.kill();await exit;}
}
function inspect(fn){const db=new DatabaseSync(path.join(data,'workspace.sqlite'),{readOnly:true});try{return fn(db);}finally{db.close();}}
(async()=>{try{
  await start();
  await call('/api/state',{customers:[{id:'C1',name:'Existing',phone:'9876543210'}],settings:{operatingTasks:[]},tickets:[],deposits:[],followups:[],activities:[]});
  const mixed=await call('/api/ws/ingest/batch',{checkpoints:[{conversationKey:'123@g.us',conversationType:'group',displayName:'Group'},{conversationKey:'919876543210',conversationType:'direct',displayName:'Existing',unreadCount:0,historyLoaded:true,historyMessageCount:1,coverage:'read-history',directionVersion:4,directionUnresolvedCount:0,historyFingerprint:'direct-history',lastMessageFingerprint:'direct-history'}],messages:[{conversationKey:'123@g.us',externalMessageId:'group-new',body:'GROUP_BODY_MUST_NOT_SAVE',direction:'incoming'},{conversationKey:'919876543210',externalMessageId:'direct-new',body:'Direct original',direction:'incoming',directionSource:'class-message-in',sentAt:'2026-11-13T10:00:00Z'}]});
  assert.equal(mixed.accepted,1);
  assert.equal(inspect(db=>db.prepare("SELECT COUNT(*) n FROM ws_conversations WHERE external_id='123@g.us'").get().n),1,'ordinary group identity is retained for fixed-seat monitoring');
  assert.equal(inspect(db=>db.prepare("SELECT COUNT(*) n FROM ws_messages WHERE original_text='GROUP_BODY_MUST_NOT_SAVE'").get().n),0);
  await call('/api/ws/ingest/batch',{checkpoints:[{conversationKey:'contradictory-group',conversationType:'group'},{conversationKey:'contradictory-group',conversationType:'direct'}],messages:[{conversationKey:'contradictory-group',externalMessageId:'contradictory-message',body:'GROUP_CONTRADICTORY_MUST_NOT_SAVE',direction:'incoming'}]});
  assert.equal(inspect(db=>db.prepare("SELECT COUNT(*) n FROM ws_conversations WHERE external_id='contradictory-group'").get().n),1,'group evidence wins over a later contradictory direct checkpoint while retaining monitor metadata');
  const list=await call('/api/ws/conversations');const direct=list.conversations.find(c=>c.externalId==='919876543210');assert.ok(direct);
  assert.equal(list.conversations.some(c=>c.externalId==='123@g.us'),false,'ordinary groups stay out of personal inventory');
  assert.ok(list.groupConversations.some(c=>c.externalId==='123@g.us'),'ordinary groups remain selectable by the monitor');
  await call('/api/ws/ai-jobs',{conversationId:direct.id,idempotencyKey:'direct-allowed'},201);
  await call('/api/ws/accounts',{id:'dedicated-policy-group',workspaceMode:'dedicated'},201);
  activeAccountId='dedicated-policy-group';
  const profile=(await call('/api/ws/group-monitors/profiles',{slotKey:'policy-group-seat',enabled:true},201)).profile;
  await call('/api/ws/group-monitors/'+profile.id+'/targets/scan',{targets:[{groupJid:'vip-room@g.us',groupName:'Observed group',enabled:true}]});
  const vipIngest=await call('/api/ws/ingest/batch',{
    checkpoints:[{conversationKey:'vip-room@g.us',conversationType:'vip_group',vipGroup:true,isGroup:true,displayName:'VIP Room',unreadCount:0,historyLoaded:true,historyMessageCount:3,coverage:'read-history',directionVersion:4,directionUnresolvedCount:0,lastMessageFingerprint:'vip-list'}],
    messages:[
      {conversationKey:'vip-room@g.us',conversationType:'vip_group',externalMessageId:'vip-a',body:'I am an engineer',direction:'incoming',directionSource:'class-message-in',senderId:'919876543210@c.us',senderPhone:'9876543210',senderName:'Existing',senderIdentitySource:'sender-jid',sentAt:'2026-11-13T10:01:00Z'},
      {conversationKey:'vip-room@g.us',conversationType:'vip_group',externalMessageId:'vip-b',body:'I am a billionaire',direction:'incoming',directionSource:'class-message-in',senderId:'911111111111@c.us',senderPhone:'1111111111',senderName:'Other',senderIdentitySource:'sender-jid',sentAt:'2026-11-13T10:02:00Z'},
      {conversationKey:'vip-room@g.us',conversationType:'vip_group',externalMessageId:'vip-c',body:'Thanks for sharing',direction:'outgoing',directionSource:'class-message-out',senderName:'Self',senderIdentitySource:'message-preamble',sentAt:'2026-11-13T10:03:00Z'},
    ],
  });
  assert.equal(vipIngest.accepted,3,'whitelisted VIP group stores the complete multi-party transcript');
  const vip=(await call('/api/ws/conversations')).conversations.find(c=>c.externalId==='vip-room@g.us');
  assert.ok(vip);assert.equal(vip.data.conversationType,'vip_group');assert.equal(vip.customerId,'','group conversation itself must never bind one customer');
  await call('/api/ws/conversations',{externalId:'vip-room@g.us',customerId:'C1'});
  assert.equal(inspect(db=>db.prepare('SELECT customer_id FROM ws_conversations WHERE id=?').get(vip.id).customer_id),'','a legacy conversation update cannot bind an entire VIP group to one customer');
  assert.equal(inspect(db=>JSON.parse(db.prepare("SELECT data_json FROM ws_messages WHERE external_id='vip-a'").get().data_json).senderId),'919876543210@c.us');
  assert.equal((await call('/api/ws/ai-jobs',{conversationId:vip.id,idempotencyKey:'vip-standard-analysis'},422)).code,'WS_GROUP_MEMBER_SCOPE_REQUIRED');
  const genericVipAnalysis=await call('/api/ws/analyses',{conversationId:vip.id,result:{summary:'Whole room summary',confidence:.9,profileFacts:{occupation:{value:'Billionaire',state:'known',confidence:.9,evidence:'I am a billionaire',sourceRole:'customer'}},followupStrategy:{shouldFollowUp:true,priorityScore:99}},confidence:.9},422);
  assert.equal(genericVipAnalysis.code,'WS_GROUP_MEMBER_SCOPE_REQUIRED','whole-group AI output cannot enter the personal analysis pipeline');
  const memberIdentity={senderId:'919876543210@c.us',senderPhone:'9876543210',senderName:'Existing',identitySource:'sender-jid',trusted:true};
  await call('/api/ws/ai-jobs',{conversationId:vip.id,idempotencyKey:'group-member-analysis',payload:{memberScoped:true,memberIdentity}},201);
  const scopedVipAnalysis=await call('/api/ws/analyses',{conversationId:vip.id,result:{summary:'Engineer member is engaged',confidence:.9,memberIdentity,transcriptInfo:{memberScoped:true,memberIdentity,directionVersion:4},profileFacts:{occupation:{value:'Engineer',state:'known',confidence:.9,evidence:'I am an engineer',sourceRole:'customer'},future_plans:{value:'Buy an island',state:'known',confidence:.9,evidence:'I am a billionaire',sourceRole:'customer'}},followupStrategy:{shouldFollowUp:true,qualificationScore:70,engagementScore:80,priorityScore:75,scoreConfidence:.8,reason:'Member replied',objective:'Discuss needs'}},confidence:.9});
  const scopedVipSync=await call('/api/ws/crm-sync',{conversationId:vip.id,analysisId:scopedVipAnalysis.id});
  assert.equal(scopedVipSync.matched,true);assert.equal(scopedVipSync.created,false);assert.equal(scopedVipSync.customer.occupation,'Engineer');assert.notEqual(scopedVipSync.customer.future_plans,'Buy an island','another member evidence cannot fill the matched customer');
  assert.equal(inspect(db=>db.prepare('SELECT customer_id FROM ws_conversations WHERE id=?').get(vip.id).customer_id),'','VIP group remains multi-member after a customer-level sync');
  const unknownMember={senderId:'919222222222@c.us',senderPhone:'2222222222',identitySource:'sender-jid',trusted:true};
  const unknownScoped=await call('/api/ws/analyses',{conversationId:vip.id,result:{summary:'Unknown member',confidence:.9,memberIdentity:unknownMember,transcriptInfo:{memberScoped:true,memberIdentity:unknownMember,directionVersion:4},profileFacts:{occupation:{value:'Doctor',state:'known',confidence:.9,evidence:'Unknown',sourceRole:'customer'}}},confidence:.9},422);
  assert.equal(unknownScoped.code,'WS_GROUP_MEMBER_IDENTITY_UNCONFIRMED');assert.equal((await call('/api/state')).customers.length,1,'unobserved member analysis never auto-creates a customer');
  activeAccountId='default';
  await call('/api/ws/ingest/batch',{checkpoints:[{conversationKey:'unknown-row',conversationType:'unknown',historyLoaded:true,historyMessageCount:1,coverage:'read-history'}],messages:[{conversationKey:'unknown-row',externalMessageId:'unknown-new',body:'UNKNOWN_BODY_MUST_NOT_SAVE',direction:'incoming'}]});
  const unknown=(await call('/api/ws/conversations')).conversations.find(c=>c.externalId==='unknown-row');assert.ok(unknown);assert.equal(unknown.data.historyLoaded,false);
  assert.equal(inspect(db=>db.prepare("SELECT COUNT(*) n FROM ws_messages WHERE conversation_id=?").get(unknown.id).n),0);
  const unknownDenied=await call('/api/ws/ai-jobs',{conversationId:unknown.id,idempotencyKey:'unknown-denied'},422);assert.equal(unknownDenied.code,'WS_CONVERSATION_TYPE_UNCONFIRMED');
  const awaiting=await call(`/api/ws/analyses?conversationId=${unknown.id}`);
  assert.equal(awaiting.analysis,null);assert.equal(awaiting.total,0,'history with no saved analysis is an empty view, not a service failure');
  await call('/api/ws/conversations',{externalId:'new-group@g.us',title:'Group'},422);

  // Create a genuine pre-upgrade fixture while the service is stopped. The old
  // message remains evidence and must survive retirement of pending group work.
   const legacy=await call('/api/ws/conversations',{externalId:'legacy-before-upgrade',title:'Legacy',conversationType:'direct',unreadCount:0,data:{conversationType:'direct',historyLoaded:true,historyFingerprint:'legacy-history',lastMessageFingerprint:'legacy-history',directionVersion:4}});
   await call('/api/ws/messages',{conversationId:legacy.id,externalId:'legacy-message',direction:'send',originalText:'LEGACY_ORIGINAL_PRESERVED'});
  const priorAnalysis=await call('/api/ws/analyses',{conversationId:legacy.id,result:{summary:'Historical pre-upgrade analysis',confidence:.9}});
  const job=await call('/api/ws/ai-jobs',{conversationId:legacy.id,idempotencyKey:'legacy-job'},201);
  await call('/api/ws/ai-jobs',{action:'claim',jobId:job.job.id});
  const run=await call('/api/ws/collection-runs',{},201);
  await call('/api/ws/collection-items',{runId:run.run.id,conversationId:legacy.id,status:'queued'});
  const state=await call('/api/state');state.settings.operatingTasks=[{id:'group-task',aiGenerated:true,wsAccountId:'default',wsConversationId:legacy.id,customerId:'C1',status:'open',done:false}];await call('/api/state',state);
  await stop();
  const db=new DatabaseSync(path.join(data,'workspace.sqlite'));const now=new Date().toISOString();
  db.prepare("UPDATE ws_conversations SET external_id='legacy@g.us',data_json=? WHERE id=?").run(JSON.stringify({conversationType:'direct'}),legacy.id);
  db.prepare('INSERT INTO ws_followup_alerts(id,account_id,conversation_id,analysis_id,alert_key,priority,reason,followup_time,status,snoozed_until,data_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)').run('legacy-alert','default',legacy.id,priorAnalysis.id,'legacy-alert-key',80,'Old group suggestion',now,'open','','{}',now,now);db.close();
  await start();
  assert.equal(inspect(db=>db.prepare('SELECT status FROM ai_jobs WHERE id=?').get(job.job.id).status),'cancelled');
  assert.equal(inspect(db=>db.prepare("SELECT status FROM ws_followup_alerts WHERE id='legacy-alert'").get().status),'dismissed');
  assert.equal(inspect(db=>db.prepare('SELECT original_text FROM ws_messages WHERE conversation_id=?').get(legacy.id).original_text),'LEGACY_ORIGINAL_PRESERVED');
  const retired=await call('/api/state');assert.equal(retired.customers.length,1);assert.equal(retired.followups.length,0);assert.equal(retired.settings.operatingTasks[0].groupExcluded,true);assert.equal(retired.settings.operatingTasks[0].status,'dismissed');
  assert.ok(!(await call('/api/ws/conversations')).conversations.some(c=>c.id===legacy.id));
  const blocked=[['/api/ws/ai-jobs',{action:'claim',jobId:job.job.id}],['/api/ws/analyses',{conversationId:legacy.id,result:{summary:'late result',confidence:.9}}],['/api/ws/crm-sync',{conversationId:legacy.id,analysisId:'legacy-analysis'}],['/api/ws/messages',{conversationId:legacy.id,direction:'receive',originalText:'late group'}],['/api/ws/messages/batch',{conversationId:legacy.id,messages:[{direction:'receive',originalText:'late group'}]}]];
  blocked.push(['/api/ws/followup-action',{action:'reopen',taskId:'group-task'}]);
  blocked.push(['/api/ws/followup-action',{action:'complete',taskId:'group-task',result:'Must not count a group action as a customer contact'}]);
  blocked.push(['/api/ws/followup-alerts',{id:'legacy-alert',status:'open'}]);
  blocked.push(['/api/ws/hot-chat/profile/events',{customerId:'C1',conversationId:legacy.id,type:'analysis_profile',source:'AI',payload:{summary:'Late group facts'}}]);
  blocked.push(['/api/ws/hot-chat/profile/facts',{customerId:'C1',conversationId:legacy.id,source:'AI',fields:{occupation:{value:'Engineer',state:'known',confidence:.9,evidence:'Group member: I am an engineer'}}}]);
  for(const [route,body] of blocked){const denied=await call(route,body,422);assert.equal(denied.code,['/api/ws/ai-jobs','/api/ws/analyses','/api/ws/crm-sync'].includes(route)?'WS_WORKSPACE_MODE_MISMATCH':'WS_GROUP_EXCLUDED',route);}
  assert.equal(inspect(db=>db.prepare('SELECT COUNT(*) n FROM ws_ai_analyses WHERE conversation_id=?').get(legacy.id).n),1,'late analysis must not be saved; preserved historical analysis remains archived');
  assert.equal((await call('/api/ws/followup-alerts?allAccounts=1')).alerts.length,0);
  const exported=await call('/api/ws/export');
  exported.followupAlerts.find(alert=>alert.id==='legacy-alert').status='open';
  await call('/api/ws/import',exported);
  assert.equal(inspect(db=>db.prepare("SELECT status FROM ws_followup_alerts WHERE id='legacy-alert'").get().status),'dismissed','restoring an older backup must not revive group reminders');
  assert.equal(inspect(db=>db.prepare('SELECT original_text FROM ws_messages WHERE conversation_id=?').get(legacy.id).original_text),'LEGACY_ORIGINAL_PRESERVED','backup restore preserves historical raw evidence');
  assert.equal((await call('/api/state')).followups.length,0);
  const topLevelGroup=await call('/api/ws/export');
  const topLevelRow=topLevelGroup.conversations.find(row=>row.id===legacy.id);
  topLevelRow.externalId='opaque-legacy-group';topLevelRow.data={};topLevelRow.conversationType='group';
  await call('/api/ws/import',topLevelGroup);
  const topLevelDenied=await call('/api/ws/analyses',{conversationId:legacy.id,result:{summary:'Must retain imported group classification',confidence:.9}},422);
  assert.equal(topLevelDenied.code,'WS_WORKSPACE_MODE_MISMATCH','top-level group metadata must survive restore');
  const olderBackup=await call('/api/ws/export');
  const olderRow=olderBackup.conversations.find(row=>row.id===legacy.id);olderRow.data={};delete olderRow.conversationType;delete olderRow.isGroup;
  await call('/api/ws/import',olderBackup);
  const olderDenied=await call('/api/ws/analyses',{conversationId:legacy.id,result:{summary:'An older backup cannot erase known group identity',confidence:.9}},422);
  assert.equal(olderDenied.code,'WS_WORKSPACE_MODE_MISMATCH','known group identity must survive restoring an older untyped backup');
  console.log('WS direct-only policy: core identity, mixed ingest, unknown rejection, legacy group retirement, late-write guards pass');
}finally{await stop();rmSync(data,{recursive:true,force:true});}})().catch(error=>{console.error(error);process.exitCode=1;});
