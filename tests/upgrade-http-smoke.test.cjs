const {spawn}=require('node:child_process');
const {mkdtempSync,cpSync,rmSync}=require('node:fs');
const os=require('node:os'),path=require('node:path');
const app=process.argv[2];
if(!app) throw new Error('app path required');
const dir=mkdtempSync(path.join(os.tmpdir(),'zhike-upgrade-http-'));
cpSync(app,dir,{recursive:true});
const port='4399',token='upgrade-http';
const child=spawn(process.execPath,['server.mjs'],{cwd:dir,windowsHide:true,env:{...process.env,ZHIKE_PORT:port,ZHIKE_API_TOKEN:token,ZHIKE_SHUTDOWN_TOKEN:token,ZHIKE_DATA_DIR:path.join(dir,'isolated-data')},stdio:'ignore'});
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
(async()=>{
  try {
    let healthy=false;
    for(let i=0;i<120;i++){try{if((await fetch(`http://127.0.0.1:${port}/api/health`)).ok){healthy=true;break;}}catch{}await wait(50);}
    if(!healthy) throw new Error('isolated server did not become healthy');
    const paths=['/modules/smart-import.js','/modules/ticket-record-core.js','/modules/ui-refresh.css','/modules/performance-enhancements.js','/modules/business-enhancements.js','/modules/business-enhancements.css','/modules/accessibility-enhancements.js','/modules/operations-upgrade.js','/modules/operations-upgrade.css','/modules/ws-workbench-core.js','/modules/ws-crm-sync-core.js','/modules/hot-chat-profile-core.js','/modules/ws-workbench.js','/modules/ws-workbench.css','/modules/design-system.css','/modules/customer-governance-ui.js'];
    for(const route of paths){const response=await fetch(`http://127.0.0.1:${port}${route}`);if(!response.ok)throw new Error(`${route} HTTP ${response.status}`);const body=await response.text();if(!body.trim())throw new Error(`${route} empty body`);}
    console.log('upgrade HTTP smoke: isolated server served all new module assets');
    await fetch(`http://127.0.0.1:${port}/api/shutdown`,{method:'POST',headers:{'X-Zhike-Api-Token':token,'X-Zhike-Shutdown-Token':token}});
  } finally {
    if(child.exitCode===null) child.kill();
    for(let i=0;i<12;i++){try{rmSync(dir,{recursive:true,force:true});break;}catch{await wait(200);}}
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
