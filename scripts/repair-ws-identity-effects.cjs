'use strict';
const {DatabaseSync,backup}=require('node:sqlite');
const {readFileSync,existsSync,mkdirSync}=require('node:fs');
const {resolve,dirname,join}=require('node:path');
const {isDeepStrictEqual:equal}=require('node:util');
const {createHash}=require('node:crypto');
const {buildScopedPlan,applyPlan}=require('./repair-ws-direction-effects.cjs');
const SOURCE='WS identity repair v4';
const REASON='会话身份未匹配现有客户，旧客户联动已撤回；聊天分析保留。';
const parse=(s,f={})=>{try{return JSON.parse(s);}catch{return f;}};
const clone=v=>JSON.parse(JSON.stringify(v));
const array=v=>Array.isArray(v)?v:[];
const phone=value=>{const s=String(value||'').normalize('NFKC').replace(/[\u200e\u200f\u202a-\u202e]/g,'').trim();if(!/^\+?[\d\s().-]+$/.test(s))return '';let n=s.replace(/\D/g,'');if(n.startsWith('00'))n=n.slice(2);return n.length===12&&n.startsWith('91')?n.slice(2):n.length>=7&&n.length<=15?n:'';};
const ASSOCIATION_SOURCE='WS unverified association repair v4';
const hash=v=>createHash('sha256').update(typeof v==='string'?v:JSON.stringify(v)).digest('hex');

function buildAssociationPlan(db,baseline,targets,{now=new Date().toISOString()}={}){
 if(!Array.isArray(targets)||!targets.length||targets.length>100||new Set(targets.map(t=>String(t.accountId)+'\x1f'+String(t.conversationId))).size!==targets.length)throw new Error('Explicit unique conversation targets required.');
 const envelope=db.prepare('SELECT json,revision FROM app_state WHERE id=1').get(),state=parse(envelope?.json,null),base=parse(baseline.prepare('SELECT json FROM app_state WHERE id=1').get()?.json,null);
 if(!Array.isArray(state?.customers)||!Array.isArray(base?.customers))throw new Error('Current and baseline customer states required.');
 const links=[];let phoneNoCandidate=0,aliasUnverifiable=0;
 for(const t of targets){
  if(!/^[-\w]{1,160}$/.test(String(t.conversationId||''))||!/^[-\w]{1,160}$/.test(String(t.accountId||''))||!t.expectedCustomerId||!/^[a-f\d]{64}$/i.test(String(t.expectedDataSha256||'')))throw new Error('Invalid explicit conversation target.');
  const c=db.prepare('SELECT * FROM ws_conversations WHERE id=? AND account_id=?').get(t.conversationId,t.accountId);if(!c)throw new Error('Target conversation missing.');const data=parse(c.data_json);
  if(!c.customer_id&&data.unverifiedAssociationRepair?.source===ASSOCIATION_SOURCE)continue;
  if(c.customer_id!==t.expectedCustomerId||hash(c.data_json)!==t.expectedDataSha256)throw new Error('Target association changed.');
  const old=baseline.prepare('SELECT customer_id FROM ws_conversations WHERE id=? AND account_id=?').get(c.id,c.account_id);
  if(old?.customer_id)throw new Error('Baseline association is not explicitly empty.');
  if(!old){const latestBaseline=baseline.prepare('SELECT MAX(updated_at) latest FROM ws_conversations').get()?.latest;if(!latestBaseline||!c.created_at||c.created_at<=latestBaseline||data.discovery!=='visible-page'||data.source!=='ws-list-discovery'||data.customerBindingVerifiedAt)throw new Error('Absent baseline target is not a newer automatic list discovery.');}
  if(data.customerMatch==='manual'||data.customerBindingSource==='manual'||!['automatic','pending'].includes(data.customerMatch))throw new Error('Target is not a new automatic/pending association.');
  const identityPhones=[c.external_id,c.title].map(phone).filter(Boolean);
  const evidenceFor=person=>{const allowedAccount=!array(person.wsAccountIds).length||array(person.wsAccountIds).includes(c.account_id);return [person.phone,person.rawPhone,...array(person.legacyPhones)].map(phone).filter(Boolean).some(n=>identityPhones.includes(n))||allowedAccount&&([person.wsExternalId,...array(person.wsExternalIds)].filter(Boolean).includes(c.external_id)||[person.wsConversationId,...array(person.wsConversationIds)].filter(Boolean).includes(c.id));};
  if([...state.customers,...base.customers].some(evidenceFor))throw new Error('Independent customer identity candidate exists.');
  if(db.prepare("SELECT count(*) n FROM hot_chat_events WHERE account_id=? AND conversation_id=? AND event_type='analysis_profile'").get(c.account_id,c.id).n)throw new Error('Target has active AI profile effects.');
  if((state.settings?.operatingTasks||[]).some(t=>t.aiGenerated&&t.wsConversationId===c.id&&String(t.wsAccountId||'default')===c.account_id&&!t.identityInvalidated))throw new Error('Target has an AI task effect.');
  links.push(c);if(identityPhones.length)phoneNoCandidate++;else aliasUnverifiable++;
 }
 return {links,envelope,now,messagesHash:hash(db.prepare('SELECT * FROM ws_messages ORDER BY id').all()),customersHash:hash(db.prepare('SELECT * FROM customers ORDER BY id').all()),summary:{targets:targets.length,conversationsUnlinked:links.length,phoneNoCandidate,aliasUnverifiable,customerCount:state.customers.length}};
}
function applyAssociationPlan(db,plan,{failAfterFirst=false}={}){
 if(!plan.links.length)return {applied:false,...plan.summary};db.exec('BEGIN IMMEDIATE');
 try{
  const current=db.prepare('SELECT json,revision FROM app_state WHERE id=1').get();if(!equal(current,plan.envelope))throw new Error('Customer/business state changed after planning.');
  for(let i=0;i<plan.links.length;i++){const c=plan.links[i],live=db.prepare('SELECT * FROM ws_conversations WHERE id=? AND account_id=?').get(c.id,c.account_id);if(!live||live.customer_id!==c.customer_id||live.data_json!==c.data_json)throw new Error('Conversation changed after planning.');
   const data={...parse(c.data_json),customerMatch:'pending',customerBindingSource:'identity-unmatched',crmIdentityStatus:'unmatched',crmIdentityPending:true,previousCustomerAssociationInvalidated:true,previousCustomerId:c.customer_id,unverifiedAssociationRepair:{source:ASSOCIATION_SOURCE,reason:'无独立客户身份依据，撤销本轮同账号回退关联。',repairedAt:plan.now}};
   db.prepare("UPDATE ws_conversations SET customer_id='',data_json=?,updated_at=? WHERE id=? AND account_id=?").run(JSON.stringify(data),plan.now,c.id,c.account_id);if(failAfterFirst&&i===0)throw new Error('Injected association failure.');
  }
  if(!equal(db.prepare('SELECT json,revision FROM app_state WHERE id=1').get(),plan.envelope)||hash(db.prepare('SELECT * FROM customers ORDER BY id').all())!==plan.customersHash||hash(db.prepare('SELECT * FROM ws_messages ORDER BY id').all())!==plan.messagesHash)throw new Error('Customer, business or message preservation invariant failed.');
  if(db.prepare('PRAGMA foreign_key_check').all().length)throw new Error('Foreign key invariant failed.');db.exec('COMMIT');return {applied:true,...plan.summary};
 }catch(e){db.exec('ROLLBACK');throw e;}
}

function buildIdentityPlan(db,baseline,ids,{now=new Date().toISOString()}={}){
 if(!Array.isArray(ids)||!ids.length||ids.length>100||new Set(ids).size!==ids.length||ids.some(id=>!/^[-\w]{1,160}$/.test(id)))throw new Error('An explicit unique analysis ID list is required.');
 const baseState=parse(baseline.prepare('SELECT json FROM app_state WHERE id=1').get()?.json,null);
 if(!Array.isArray(baseState?.customers))throw new Error('Baseline state is missing.');
 const currentState=parse(db.prepare('SELECT json FROM app_state WHERE id=1').get()?.json,null);
 const allEvents=db.prepare("SELECT * FROM hot_chat_events WHERE event_type='analysis_profile' ORDER BY created_at,id").all();
 const selected=new Set(ids),analyses=[],links=[];
 for(const id of ids){
  const analysis=db.prepare('SELECT * FROM ws_ai_analyses WHERE id=?').get(id);
  if(!analysis)throw new Error('An explicitly selected analysis does not exist.');
  if(analysis.error_message===REASON||db.prepare("SELECT 1 FROM customer_governance_actions WHERE source=? AND action='restore' AND analysis_id=?").get(SOURCE,id))continue;
  const event=allEvents.find(e=>e.analysis_id===id);
  if(!event)throw new Error('Selected analysis has no active audited CRM effect.');
  const conversation=db.prepare('SELECT * FROM ws_conversations WHERE id=? AND account_id=?').get(event.conversation_id,event.account_id);
  if(!conversation||conversation.customer_id!==event.customer_id)throw new Error('Selected conversation association changed; no repair planned.');
  const identityPhones=[conversation.external_id,conversation.title].map(phone).filter(Boolean);
  if(!identityPhones.length)throw new Error('Selected conversation is not a verifiable pure-phone unmatched identity.');
  const candidates=baseState.customers.filter(c=>[c.phone,c.rawPhone,...array(c.legacyPhones)].map(phone).filter(Boolean).some(p=>identityPhones.includes(p))||[c.wsExternalId,...array(c.wsExternalIds)].filter(Boolean).includes(conversation.external_id)||[c.wsConversationId,...array(c.wsConversationIds)].filter(Boolean).includes(conversation.id));
  const baselineConversation=baseline.prepare('SELECT customer_id FROM ws_conversations WHERE id=? AND account_id=?').get(conversation.id,conversation.account_id);
  if(candidates.length||baselineConversation?.customer_id)throw new Error('A baseline identity association exists; explicit unmatched repair refused.');
  analyses.push(analysis);links.push({conversation,customerId:event.customer_id,analysisId:id});
 }
 const activeIds=new Set(analyses.map(a=>a.id));
 const keepEvents=allEvents.filter(e=>!activeIds.has(e.analysis_id));
 const protectedFields=new Map();
 // A later verified AI update is as authoritative as a later manual edit.
 for(const link of links){
  const fields=protectedFields.get(String(link.customerId))||new Set();
  for(const action of db.prepare("SELECT * FROM customer_governance_actions WHERE customer_id=? AND source='WS AI' AND action='update' ORDER BY created_at").all(link.customerId)){
   if(selected.has(action.analysis_id)||!keepEvents.some(e=>e.analysis_id===action.analysis_id)||action.created_at<=analyses.find(a=>a.id===link.analysisId).created_at)continue;
   const b=parse(action.before_json),a=parse(action.after_json);
   for(const key of new Set([...Object.keys(b),...Object.keys(a)]))if(!equal(b[key],a[key]))fields.add(key);
  }
  protectedFields.set(String(link.customerId),fields);
 }
 const since=analyses.map(a=>a.created_at).sort()[0]||now;
 const plan=buildScopedPlan(db,baseline,{since,until:now,now,analyses,source:SOURCE,reason:REASON,kind:'identity',protectedFields});
 plan.links=links;
 let externalIdsRemoved=0,conversationIdsRemoved=0;
 for(const id of new Set(links.map(l=>String(l.customerId)))){
  const customer=plan.state.customers.find(c=>String(c.id)===id),original=currentState.customers.find(c=>String(c.id)===id),base=baseState.customers.find(c=>String(c.id)===id);
  const related=links.filter(l=>String(l.customerId)===id);
  const good=keepEvents.filter(e=>String(e.customer_id)===id).map(e=>db.prepare('SELECT external_id,id FROM ws_conversations WHERE id=? AND account_id=?').get(e.conversation_id,e.account_id)).filter(Boolean);
  const keepExternal=new Set([base?.wsExternalId,...array(base?.wsExternalIds),...good.map(c=>c.external_id)].filter(Boolean));
  const keepConversation=new Set([base?.wsConversationId,...array(base?.wsConversationIds),...good.map(c=>c.id)].filter(Boolean));
  const addedByBad=(key,value)=>plan.actions.some(a=>String(a.customer_id)===id&&array(parse(a.after_json)[key]).includes(value)&&!array(parse(a.before_json)[key]).includes(value));
  for(const[key,targets,keep]of [['wsExternalIds',related.map(l=>l.conversation.external_id),keepExternal],['wsConversationIds',related.map(l=>l.conversation.id),keepConversation]]){
   if(!Array.isArray(customer[key]))continue;
   const remove=new Set(targets.filter(value=>!keep.has(value)&&addedByBad(key,value)));
   const before=customer[key].length;customer[key]=customer[key].filter(value=>!remove.has(value));
   if(key==='wsExternalIds')externalIdsRemoved+=array(original[key]).filter(v=>targets.includes(v)&&!keep.has(v)&&addedByBad(key,v)).length;
   else conversationIdsRemoved+=array(original[key]).filter(v=>targets.includes(v)&&!keep.has(v)&&addedByBad(key,v)).length;
   if(before!==customer[key].length)plan.summary.identityArrayCleanupFields=(plan.summary.identityArrayCleanupFields||0)+1;
  }
  // Login-account membership is shared, never a contact identity: retain it.
  if(Array.isArray(original.wsAccountIds))customer.wsAccountIds=[...new Set([...original.wsAccountIds,...array(customer.wsAccountIds)])];
  const last=plan.changes.filter(c=>c.customerId===id).at(-1);if(last)last.after=clone(customer);
 }
 const keepProfileIds=[...new Set(keepEvents.map(e=>e.profile_id))];
 plan.preservedEffects={events:keepEvents,analyses:keepEvents.map(e=>db.prepare('SELECT * FROM ws_ai_analyses WHERE id=?').get(e.analysis_id)),profiles:keepProfileIds.map(id=>db.prepare('SELECT * FROM hot_chat_profiles WHERE id=?').get(id)),profileFields:keepProfileIds.flatMap(id=>db.prepare('SELECT * FROM hot_chat_profile_fields WHERE profile_id=? ORDER BY id').all(id)),evidence:keepEvents.flatMap(e=>db.prepare('SELECT * FROM ai_customer_field_evidence WHERE analysis_id=? ORDER BY id').all(e.analysis_id)),outbox:keepEvents.flatMap(e=>db.prepare('SELECT * FROM hot_chat_sync_outbox WHERE event_id=? ORDER BY id').all(e.id))};
 Object.assign(plan.summary,{conversationsUnlinked:links.length,externalIdsRemoved,conversationIdsRemoved,preservedActiveEvents:keepEvents.length,preservedActiveProfiles:plan.preservedEffects.profiles.length,sharedAccountsPreserved:links.every(l=>array(currentState.customers.find(c=>String(c.id)===String(l.customerId))?.wsAccountIds).every(a=>array(plan.state.customers.find(c=>String(c.id)===String(l.customerId))?.wsAccountIds).includes(a)))});
 return plan;
}
function applyIdentityPlan(db,plan,options={}){
 return applyPlan(db,plan,{...options,additionalWrites:()=>{
  for(const link of plan.links){const c=link.conversation;const live=db.prepare('SELECT * FROM ws_conversations WHERE id=? AND account_id=?').get(c.id,c.account_id);if(!live||live.customer_id!==c.customer_id||live.data_json!==c.data_json)throw new Error('Conversation changed after planning.');
   const data={...parse(c.data_json),customerMatch:'pending',customerBindingSource:'identity-unmatched',crmIdentityStatus:'unmatched',crmIdentityPending:true,previousCustomerAssociationInvalidated:true,previousCustomerId:c.customer_id,identityRepair:{source:SOURCE,analysisId:link.analysisId,reason:REASON,repairedAt:plan.now}};
   db.prepare("UPDATE ws_conversations SET customer_id='',data_json=?,updated_at=? WHERE id=? AND account_id=?").run(JSON.stringify(data),plan.now,c.id,c.account_id);
   db.prepare("UPDATE ws_collection_items SET analysis_status='completed',followup_status='none',last_error=?,updated_at=? WHERE conversation_id=? AND account_id=?").run(REASON,plan.now,c.id,c.account_id);
  }
  for(const row of plan.preservedEffects.events)if(!equal(db.prepare('SELECT * FROM hot_chat_events WHERE id=?').get(row.id),row))throw new Error('Non-target event changed.');
  for(const row of plan.preservedEffects.analyses)if(!equal(db.prepare('SELECT * FROM ws_ai_analyses WHERE id=?').get(row.id),row))throw new Error('Non-target analysis changed.');
  for(const row of plan.preservedEffects.profiles)if(!equal(db.prepare('SELECT * FROM hot_chat_profiles WHERE id=?').get(row.id),row))throw new Error('Non-target profile changed.');
  for(const row of plan.preservedEffects.profileFields)if(!equal(db.prepare('SELECT * FROM hot_chat_profile_fields WHERE id=?').get(row.id),row))throw new Error('Non-target profile field changed.');
  for(const row of plan.preservedEffects.evidence)if(!equal(db.prepare('SELECT * FROM ai_customer_field_evidence WHERE id=?').get(row.id),row))throw new Error('Non-target field evidence changed.');
  for(const row of plan.preservedEffects.outbox)if(!equal(db.prepare('SELECT * FROM hot_chat_sync_outbox WHERE id=?').get(row.id),row))throw new Error('Non-target outbox changed.');
  options.additionalWrites?.();
 }});
}
async function main(argv=process.argv.slice(2)){
 const o={};for(let i=0;i<argv.length;i++){if(argv[i]==='--apply')o.apply=true;else if(['--db','--baseline','--analysis-ids-file','--conversation-ids-file'].includes(argv[i]))o[argv[i].slice(2)]=argv[++i];else throw new Error('Unsupported argument.');}
 if(!o.db||!o.baseline||Boolean(o['analysis-ids-file'])===Boolean(o['conversation-ids-file']))throw new Error('Explicit --db, --baseline and exactly one target-list mode required.');
 const dbPath=resolve(o.db),basePath=resolve(o.baseline);if(dbPath===basePath||!existsSync(dbPath)||!existsSync(basePath))throw new Error('Database and distinct baseline must exist.');
 if(o.apply&&existsSync(join(dirname(dbPath),'.workbench.lock')))throw new Error('Close the application before offline repair.');
 const associationMode=Boolean(o['conversation-ids-file']);const manifest=JSON.parse(readFileSync(resolve(o['conversation-ids-file']||o['analysis-ids-file']),'utf8'));if(manifest.protocol!==(associationMode?'zhike.ws-unverified-association-repair.v1':'zhike.ws-crm-link-repair.v1'))throw new Error('Explicit repair manifest protocol required.');
 const db=new DatabaseSync(dbPath,{readOnly:!o.apply}),baseline=new DatabaseSync(basePath,{readOnly:true});
 try{db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000');const prepare=()=>associationMode?buildAssociationPlan(db,baseline,manifest.targets):buildIdentityPlan(db,baseline,manifest.analysisIds);let plan=prepare();
  if(!o.apply){console.log(JSON.stringify({mode:'dry-run',...plan.summary},null,2));return;}
  let backupPath='';if(associationMode?plan.links.length:plan.analyses.length){const dir=join(dirname(dbPath),'backups',(associationMode?'pre-ws-association-repair-':'pre-ws-identity-repair-')+Date.now());mkdirSync(dir,{recursive:true});backupPath=join(dir,'workspace.sqlite');await backup(db,backupPath);plan=prepare();}
  console.log(JSON.stringify({mode:'apply',backupCreated:!!backupPath,backupPath,...(associationMode?applyAssociationPlan(db,plan):applyIdentityPlan(db,plan))},null,2));
 }finally{baseline.close();db.close();}
}
module.exports={buildIdentityPlan,applyIdentityPlan,buildAssociationPlan,applyAssociationPlan,main,SOURCE,REASON};
if(require.main===module)main().catch(()=>{console.error('Identity repair refused or failed; use the explicit target list, baseline and closed application state. No sensitive details are logged.');process.exitCode=1;});
