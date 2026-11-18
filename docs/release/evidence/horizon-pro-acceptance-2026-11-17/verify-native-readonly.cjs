'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const root=path.resolve(process.argv[2]||'');
assert.equal(path.dirname(root).toLowerCase(),path.resolve(os.tmpdir()).toLowerCase());
assert.match(path.basename(root),/^zhike-stage51-native-[a-f0-9]{32}$/);
assert.equal(fs.lstatSync(root).isSymbolicLink(),false);
assert.equal(fs.readFileSync(path.join(root,'.stage51-isolated'),'utf8'),'zhike-stage51-isolated-ui-v1');
const connection=JSON.parse(fs.readFileSync(path.join(root,'connection.private.json'),'utf8'));
assert.equal(connection.isolated,true);assert.equal(path.resolve(connection.root),root);
const endpoint=new URL(connection.endpoint);assert.equal(endpoint.hostname,'127.0.0.1');
async function main(){
 const response=await fetch(new URL('/api/state',endpoint),{headers:{'x-zhike-api-token':connection.apiToken,origin:endpoint.origin},signal:AbortSignal.timeout(10000)});
 assert.equal(response.status,200);const state=await response.json();
 const tasks=state.settings.operatingTasks||[];
 const changed=state.customers.filter(c=>(c.phaseHistory||[]).length);
 const output={checkedAtUtc:new Date().toISOString(),scope:'read-only GET /api/state in a marker-verified synthetic root',synthetic:true,productionOpened:false,realWs:false,realAi:false,
 counts:Object.fromEntries(['customers','registrations','followups','tickets','deposits'].map(key=>[key,state[key].length])),
 manualTasks:tasks.map(t=>({id:t.id,status:t.status,done:t.done})),
 phaseHistory:changed.map(c=>({id:c.id,phase:c.phase,history:c.phaseHistory})),
 manualOccupationProtected:state.customers.find(c=>c.id==='C-manual')?.occupation==='人工维护职业'};
 assert.deepEqual(output.counts,{customers:52,registrations:3,followups:2,tickets:1,deposits:1});
 assert.equal(output.manualOccupationProtected,true);
 const out=path.join(__dirname,'native-business-readback.json');fs.writeFileSync(out,JSON.stringify(output,null,2)+'\n');
 console.log(JSON.stringify({counts:output.counts,manualTasks:output.manualTasks,phaseCustomerCount:changed.length,phaseRecords:changed.reduce((n,c)=>n+c.phaseHistory.length,0),manualOccupationProtected:true}));
}
main().catch(e=>{console.error(JSON.stringify({status:'Failed',code:e.code||e.name}));process.exitCode=1});
