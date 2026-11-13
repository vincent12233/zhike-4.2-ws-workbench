'use strict';
const assert=require('node:assert/strict');
const {DatabaseSync}=require('node:sqlite');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
const {buildPlan,applyPlan,SOURCE}=require('../scripts/repair-ws-direction-effects.cjs');
const since='2026-11-13T05:00:00.000Z', now='2026-11-13T06:00:00.000Z';
const schema=`
 CREATE TABLE app_state(id INTEGER PRIMARY KEY,json TEXT,revision INTEGER,updated_at TEXT);
 CREATE TABLE customers(id TEXT PRIMARY KEY,phone_normalized TEXT,name TEXT,source TEXT,assistant TEXT,status TEXT,stage TEXT,deleted INTEGER,data_json TEXT);
 CREATE TABLE ws_messages(id TEXT PRIMARY KEY,account_id TEXT,conversation_id TEXT,original_text TEXT,data_json TEXT);
 CREATE TABLE ws_ai_analyses(id TEXT PRIMARY KEY,account_id TEXT,conversation_id TEXT,result_json TEXT,error_message TEXT,created_at TEXT,updated_at TEXT);
 CREATE TABLE customer_governance_actions(id TEXT PRIMARY KEY,customer_id TEXT,action TEXT CHECK(action IN ('create','update','restore','soft_delete','purge')),reason TEXT,source TEXT,confidence REAL,analysis_id TEXT,before_json TEXT,after_json TEXT,created_at TEXT);
 CREATE TABLE ai_jobs(id TEXT PRIMARY KEY,status TEXT,locked_at TEXT,next_attempt_at TEXT,last_error TEXT,updated_at TEXT,analysis_id TEXT);
 CREATE TABLE ai_customer_field_evidence(id TEXT PRIMARY KEY,analysis_id TEXT,status TEXT,updated_at TEXT);
 CREATE TABLE ws_followup_alerts(id TEXT PRIMARY KEY,analysis_id TEXT,status TEXT,data_json TEXT,updated_at TEXT);
 CREATE TABLE hot_chat_profiles(id TEXT PRIMARY KEY,manual_locked INTEGER,manual_color TEXT,status_color TEXT,completeness INTEGER,version INTEGER,data_json TEXT,updated_at TEXT);
 CREATE TABLE hot_chat_profile_fields(id TEXT PRIMARY KEY,profile_id TEXT,field_key TEXT,value_json TEXT,state TEXT,confidence REAL,evidence_json TEXT,manual_locked INTEGER,created_at TEXT,updated_at TEXT);
 CREATE TABLE hot_chat_events(id TEXT PRIMARY KEY,profile_id TEXT,analysis_id TEXT,event_type TEXT,payload_json TEXT);
 CREATE TABLE hot_chat_sync_outbox(id TEXT PRIMARY KEY,event_id TEXT,status TEXT,next_attempt_at TEXT,last_error TEXT,updated_at TEXT);
`;
function fixture({laterEdit=false,protectedField=false,dbPath=':memory:',baselinePath=':memory:'}={}){
 const db=new DatabaseSync(dbPath),baseline=new DatabaseSync(baselinePath);db.exec(schema);baseline.exec(schema);
 const before={id:'c1',name:'Existing',language:'',phone:'100',note:'kept',occupation:''};
 const after={...before,language:'en',occupation:'teacher',aiSyncedAt:'2026-11-13T05:01:00.000Z'};
 const current={...after,...(laterEdit?{occupation:'architect'}:{})};
 const state={customers:[current,{id:'c2',name:'Unrelated',phone:'200'}],tickets:[{id:'t1',customerId:'c1',code:'ONE'}],deposits:[],registrations:[],followups:[],activities:[{id:'activity',analysisId:'a1',source:'ws-ai-sync',text:'old AI effect'}],settings:{operatingTasks:[{id:'ai',aiGenerated:true,wsAnalysisId:'a1',done:false,status:'open'},{id:'done-ai',aiGenerated:true,wsAnalysisId:'a1',done:true,status:'completed',completedAt:since},{id:'manual',aiGenerated:false,wsAnalysisId:'a1',done:false,status:'open'}]}};
 db.prepare('INSERT INTO app_state VALUES(1,?,7,?)').run(JSON.stringify(state),since);
 baseline.prepare('INSERT INTO app_state VALUES(1,?,5,?)').run(JSON.stringify({...state,customers:[before,state.customers[1]],activities:[],settings:{operatingTasks:[]}}),since);
 const insertCustomer=db.prepare('INSERT INTO customers VALUES(?,?,?,?,?,?,?,?,?)');for(const c of state.customers)insertCustomer.run(c.id,c.phone||'',c.name||'','','','','',0,JSON.stringify(c));
 db.prepare('INSERT INTO ws_messages VALUES(?,?,?,?,?)').run('msg','account','conv','BOTH original messages remain\n exactly.',JSON.stringify({source:'ws-webview2'}));
 db.prepare('INSERT INTO ws_ai_analyses VALUES(?,?,?,?,?,?,?)').run('a1','account','conv',JSON.stringify({summary:'wrong role result',transcriptInfo:{directionVersion:3}}),'','2026-11-13T05:01:00.000Z',since);
 db.prepare('INSERT INTO ws_ai_analyses VALUES(?,?,?,?,?,?,?)').run('safe-a','account','conv',JSON.stringify({summary:'verified v4',transcriptInfo:{directionVersion:4}}),'','2026-11-13T05:02:00.000Z',since);
 db.prepare('INSERT INTO ws_ai_analyses VALUES(?,?,?,?,?,?,?)').run('stale-a','account','conv',JSON.stringify({summary:'never applied, still unverified',transcriptInfo:{directionVersion:3}}),'','2026-11-13T05:01:30.000Z',since);
 db.prepare('INSERT INTO customer_governance_actions VALUES(?,?,?,?,?,?,?,?,?,?)').run('action','c1','update','','WS AI',0.9,'a1',JSON.stringify(before),JSON.stringify(after),'2026-11-13T05:01:01.000Z');
 db.prepare('INSERT INTO ai_jobs VALUES(?,?,?,?,?,?,?)').run('j1','completed','','','',since,'a1');
 db.prepare('INSERT INTO ai_customer_field_evidence VALUES(?,?,?,?)').run('e1','a1','accepted',since);
 db.prepare('INSERT INTO ws_followup_alerts VALUES(?,?,?,?,?)').run('alert','a1','open','{}',since);
 db.prepare('INSERT INTO hot_chat_profiles VALUES(?,?,?,?,?,?,?,?)').run('p1',0,'','green',10,1,'{"summary":"wrong role"}',since);
 db.prepare('INSERT INTO hot_chat_profile_fields VALUES(?,?,?,?,?,?,?,?,?,?)').run('f1','p1','occupation','"teacher"','known',0.9,'[{"value":"teacher","confidence":0.9,"text":"fixture evidence"}]',protectedField?1:0,since,since);
 db.prepare('INSERT INTO hot_chat_profile_fields VALUES(?,?,?,?,?,?,?,?,?,?)').run('f2','p1','holdings','[]','missing',0,'[]',0,since,since);
 db.prepare('INSERT INTO hot_chat_events VALUES(?,?,?,?,?)').run('event','p1','a1','analysis_profile',JSON.stringify({facts:[{field:'occupation',value:'teacher',state:'known',confidence:0.9,evidence:'fixture evidence'}]}));
 db.prepare('INSERT INTO hot_chat_sync_outbox VALUES(?,?,?,?,?,?)').run('outbox','event','pending','','',since);
 return {db,baseline,state};
}
const snapshot=db=>Object.fromEntries(db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map(r=>[r.name,db.prepare('SELECT * FROM '+r.name+' ORDER BY 1').all()]));
const readState=db=>JSON.parse(db.prepare('SELECT json FROM app_state').get().json);

{
 const {db,baseline,state}=fixture();const before=snapshot(db),plan=buildPlan(db,baseline,{since,until:now,now});
 assert.deepEqual(snapshot(db),before,'planning/dry-run never writes to any table');
 assert.equal(plan.summary.analyses,2,'old unapplied summaries are selected, verified v4 analysis must not be selected');
 assert.equal(plan.summary.customers,1);assert.equal(plan.summary.dismissedTasks,1);assert.equal(plan.summary.protectedCompletedTasks,1);
 const result=applyPlan(db,plan);assert.equal(result.applied,true);
 const after=readState(db),customer=after.customers[0];
 assert.equal(customer.language,'');assert.equal(customer.occupation,'');assert.equal(customer.note,'kept');assert.equal(Object.hasOwn(customer,'aiSyncedAt'),false);
 assert.deepEqual(after.customers.map(c=>c.id),state.customers.map(c=>c.id));
 for(const key of ['tickets','deposits','registrations','followups'])assert.deepEqual(after[key],state[key],key+' preserved');
 assert.deepEqual(db.prepare('SELECT * FROM ws_messages').all(),before.ws_messages,'original text, IDs and order remain untouched');
 assert.deepEqual(JSON.parse(db.prepare('SELECT data_json FROM customers WHERE id=?').get('c1').data_json),customer,'customer projection tracks repaired app_state');
 assert.equal(after.settings.operatingTasks[0].status,'dismissed');assert.equal(after.settings.operatingTasks[1].status,'completed');assert.equal(after.settings.operatingTasks[2].status,'open');
 assert.equal(db.prepare('SELECT count(*) n FROM hot_chat_profile_fields').get().n,0);
 assert.equal(db.prepare('SELECT completeness FROM hot_chat_profiles').get().completeness,0);
 assert.equal(db.prepare('SELECT event_type FROM hot_chat_events').get().event_type,'analysis_profile_invalidated');
 assert.equal(db.prepare('SELECT status FROM hot_chat_sync_outbox').get().status,'sent');
 assert.equal(db.prepare('SELECT status FROM ai_customer_field_evidence').get().status,'rejected');
 assert.equal(db.prepare('SELECT status FROM ws_followup_alerts').get().status,'dismissed');
 assert.ok(db.prepare('SELECT error_message FROM ws_ai_analyses WHERE id=?').get('stale-a').error_message,'old unapplied analysis is invalidated too');
 assert.equal(db.prepare('SELECT result_json FROM ws_ai_analyses WHERE id=?').get('stale-a').result_json,before.ws_ai_analyses.find(r=>r.id==='stale-a').result_json,'original AI JSON retained for audit');
 assert.equal(db.prepare('SELECT error_message FROM ws_ai_analyses WHERE id=?').get('safe-a').error_message,'','verified v4 result unchanged');
 assert.equal(db.prepare('SELECT action FROM customer_governance_actions WHERE source=?').get(SOURCE).action,'restore');
 const afterFirst=snapshot(db),again=buildPlan(db,baseline,{since,until:now,now});assert.equal(again.summary.analyses,0);assert.equal(applyPlan(db,again).applied,false);assert.deepEqual(snapshot(db),afterFirst,'second run is exactly idempotent');
 db.close();baseline.close();
}
{
 const {db,baseline}=fixture({laterEdit:true,protectedField:true});const plan=buildPlan(db,baseline,{since,until:now,now});assert.ok(plan.summary.conflicts>=2);applyPlan(db,plan);
 assert.equal(readState(db).customers[0].occupation,'architect','later manual change is preserved');
 assert.equal(db.prepare('SELECT count(*) n FROM hot_chat_profile_fields WHERE id=?').get('f1').n,1,'manual lock is preserved');
 assert.equal(db.prepare('SELECT manual_locked FROM hot_chat_profile_fields WHERE id=?').get('f1').manual_locked,1);
 db.close();baseline.close();
}
for(const failAt of ['state','effects']){
 const {db,baseline}=fixture(),before=snapshot(db),plan=buildPlan(db,baseline,{since,until:now,now});
 assert.throws(()=>applyPlan(db,plan,{failAt}),/Injected/);assert.deepEqual(snapshot(db),before,'failure at '+failAt+' rolls back the entire transaction');db.close();baseline.close();
}
{
 const {db,baseline}=fixture(),plan=buildPlan(db,baseline,{since,until:now,now});db.prepare('UPDATE app_state SET revision=revision+1').run();const before=snapshot(db);assert.throws(()=>applyPlan(db,plan),/changed after planning/);assert.deepEqual(snapshot(db),before,'concurrent state change is never overwritten');db.close();baseline.close();
}
{
 const {db,baseline}=fixture(),before=snapshot(db);baseline.prepare('UPDATE app_state SET json=?').run('{"customers":[]}');assert.throws(()=>buildPlan(db,baseline,{since,until:now,now}),/baseline does not contain/);assert.deepEqual(snapshot(db),before,'unrelated baseline never permits a repair');db.close();baseline.close();
}
{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'zhike-direction-repair-'));
 try{
  const dbPath=path.join(root,'workspace.sqlite'),baselinePath=path.join(root,'baseline.sqlite');
  const {db,baseline}=fixture({dbPath,baselinePath});const original=snapshot(db);db.close();baseline.close();
  const args=[path.resolve(__dirname,'../scripts/repair-ws-direction-effects.cjs'),'--db',dbPath,'--baseline',baselinePath,'--since',since,'--until',now];
  const dry=spawnSync(process.execPath,args,{encoding:'utf8'});assert.equal(dry.status,0,dry.stderr);assert.equal(JSON.parse(dry.stdout).mode,'dry-run');
  const dryDb=new DatabaseSync(dbPath,{readOnly:true});assert.deepEqual(snapshot(dryDb),original,'the default CLI makes no database writes');dryDb.close();assert.equal(fs.existsSync(path.join(root,'backups')),false);
  const applied=spawnSync(process.execPath,[...args,'--apply'],{encoding:'utf8'});assert.equal(applied.status,0,applied.stderr);const result=JSON.parse(applied.stdout);assert.equal(result.applied,true);assert.equal(result.backupCreated,true);assert.ok(fs.existsSync(result.backupPath));
  const backedUp=new DatabaseSync(result.backupPath,{readOnly:true});assert.deepEqual(snapshot(backedUp),original,'consistent pre-write SQLite backup contains the exact original state');backedUp.close();
  const repeated=spawnSync(process.execPath,[...args,'--apply'],{encoding:'utf8'});assert.equal(repeated.status,0,repeated.stderr);assert.equal(JSON.parse(repeated.stdout).applied,false);assert.equal(JSON.parse(repeated.stdout).backupCreated,false);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
}
console.log('WS direction repair runtime: dry-run, audited compare-after rollback, manual protection, original/business preservation, projection, invalidated effects, idempotence and failure rollback passed');
