'use strict';
const assert=require('node:assert/strict');const{DatabaseSync}=require('node:sqlite');const fs=require('node:fs');const os=require('node:os');const path=require('node:path');const{spawnSync}=require('node:child_process');const{createHash}=require('node:crypto');
const{buildAssociationPlan,applyAssociationPlan}=require('../scripts/repair-ws-identity-effects.cjs');
const schema=fs.readFileSync(path.join(__dirname,'ws-direction-effects-repair.test.cjs'),'utf8').match(/const schema=`([\s\S]*?)`;/)[1];
const hash=s=>createHash('sha256').update(s).digest('hex');
const put=(d,t,r)=>{const k=Object.keys(r);d.prepare(`INSERT INTO ${t}(${k.join(',')}) VALUES(${k.map(()=>'?')})`).run(...k.map(x=>r[x]));};
const snap=d=>Object.fromEntries(d.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map(r=>[r.name,d.prepare('SELECT * FROM '+r.name+' ORDER BY 1').all()]));
function fixture({dbPath=':memory:',basePath=':memory:'}={}){
 const db=new DatabaseSync(dbPath),base=new DatabaseSync(basePath);for(const d of[db,base])d.exec(schema+`ALTER TABLE hot_chat_events ADD COLUMN account_id TEXT;ALTER TABLE hot_chat_events ADD COLUMN conversation_id TEXT;CREATE TABLE ws_conversations(id TEXT PRIMARY KEY,account_id TEXT,external_id TEXT,title TEXT,customer_id TEXT,data_json TEXT,created_at TEXT,updated_at TEXT);`);
 const state={customers:[{id:'customer',phone:'1234567890',name:'Existing'}],tickets:[{id:'t',code:'TEST'}],followups:[],registrations:[],deposits:[],settings:{operatingTasks:[]}};
 for(const d of[db,base])put(d,'app_state',{id:1,json:JSON.stringify(state),revision:8,updated_at:'2026-11-13T05:00:00.000Z'});
 put(db,'customers',{id:'customer',phone_normalized:'1234567890',name:'Existing',source:'',assistant:'',status:'',stage:'',deleted:0,data_json:JSON.stringify(state.customers[0])});
 put(db,'ws_messages',{id:'original',account_id:'account',conversation_id:'conv1',original_text:'我方回复\n客户回复，原文保留',data_json:'{"source":"ws-webview2"}'});
 const targets=[];for(let i=1;i<=4;i++){const identity=i<=2?`+91 999000000${i}`:'unresolved-alias-'+i;const data=JSON.stringify({source:'ws-list-discovery',discovery:'visible-page',customerMatch:'pending',historyLoaded:true,directionVersion:4});const c={id:'conv'+i,account_id:'account',external_id:identity,title:identity,customer_id:'customer',data_json:data,created_at:i===4?'2026-11-13T06:00:00.000Z':'2026-11-12T05:00:00.000Z',updated_at:'2026-11-13T06:30:00.000Z'};put(db,'ws_conversations',c);if(i!==4)put(base,'ws_conversations',{...c,customer_id:'',updated_at:'2026-11-13T05:00:00.000Z'});targets.push({accountId:c.account_id,conversationId:c.id,expectedCustomerId:c.customer_id,expectedDataSha256:hash(data)});}
 return {db,base,targets};
}
{
 const{db,base,targets}=fixture(),before=snap(db),p=buildAssociationPlan(db,base,targets);assert.equal(p.summary.conversationsUnlinked,4);assert.equal(p.summary.phoneNoCandidate,2);assert.equal(p.summary.aliasUnverifiable,2);assert.deepEqual(snap(db),before,'planning is read-only');applyAssociationPlan(db,p);const after=snap(db);for(const table of Object.keys(before).filter(t=>t!=='ws_conversations'))assert.deepEqual(after[table],before[table],'only conversation pointer/audit changes: '+table);assert.ok(after.ws_conversations.every(c=>c.customer_id===''));assert.ok(after.ws_conversations.every(c=>JSON.parse(c.data_json).unverifiedAssociationRepair.previousCustomerId===undefined&&JSON.parse(c.data_json).previousCustomerId==='customer'));const once=snap(db);assert.equal(applyAssociationPlan(db,buildAssociationPlan(db,base,targets)).applied,false);assert.deepEqual(snap(db),once,'idempotent, no extra writes');db.close();base.close();
}
{
 const{db,base,targets}=fixture(),before=snap(db),p=buildAssociationPlan(db,base,targets);assert.throws(()=>applyAssociationPlan(db,p,{failAfterFirst:true}),/Injected/);assert.deepEqual(snap(db),before,'failed first update rolls back all conversations and all other tables');db.close();base.close();
}
for(const type of['baseline','manual','candidate','old-absent','ai-effect']){
 const{db,base,targets}=fixture();
 if(type==='baseline')base.prepare("UPDATE ws_conversations SET customer_id='customer' WHERE id='conv1'").run();
 if(type==='manual'){const data=JSON.stringify({customerMatch:'manual',customerBindingSource:'manual'});db.prepare("UPDATE ws_conversations SET data_json=? WHERE id='conv1'").run(data);targets[0].expectedDataSha256=hash(data);}
 if(type==='candidate')db.prepare("UPDATE ws_conversations SET title='00911234567890' WHERE id='conv1'").run();
 if(type==='old-absent')db.prepare("UPDATE ws_conversations SET created_at='2026-11-12T01:00:00.000Z' WHERE id='conv4'").run();
 if(type==='ai-effect')put(db,'hot_chat_events',{id:'effect',profile_id:'p',analysis_id:'a',event_type:'analysis_profile',payload_json:'{}',account_id:'account',conversation_id:'conv1'});
 const before=snap(db);assert.throws(()=>buildAssociationPlan(db,base,targets),/Baseline|automatic|candidate|Absent|active AI/,'refuse '+type);assert.deepEqual(snap(db),before,'refused plan writes nothing');db.close();base.close();
}
{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'zhike-association-repair-'));try{const dbPath=path.join(root,'workspace.sqlite'),basePath=path.join(root,'baseline.sqlite'),manifest=path.join(root,'targets.json');const{db,base,targets}=fixture({dbPath,basePath}),before=snap(db);db.close();base.close();fs.writeFileSync(manifest,JSON.stringify({protocol:'zhike.ws-unverified-association-repair.v1',targets}));const args=[path.resolve(__dirname,'../scripts/repair-ws-identity-effects.cjs'),'--db',dbPath,'--baseline',basePath,'--conversation-ids-file',manifest];const dry=spawnSync(process.execPath,args,{encoding:'utf8'});assert.equal(dry.status,0,dry.stderr);assert.equal(JSON.parse(dry.stdout).mode,'dry-run');const check=new DatabaseSync(dbPath,{readOnly:true});assert.deepEqual(snap(check),before);check.close();assert.equal(fs.existsSync(path.join(root,'backups')),false);const applied=spawnSync(process.execPath,[...args,'--apply'],{encoding:'utf8'});assert.equal(applied.status,0,applied.stderr);const output=JSON.parse(applied.stdout);assert.equal(output.backupCreated,true);const backupDb=new DatabaseSync(output.backupPath,{readOnly:true});assert.deepEqual(snap(backupDb),before,'backup contains exact pre-write state');backupDb.close();}finally{fs.rmSync(root,{recursive:true,force:true});}
}
console.log('WS association-only repair: explicit four targets, empty/new baseline, manual/candidate/effect refusal, default dry-run, exact backup, original/business preservation, rollback and idempotence passed');
