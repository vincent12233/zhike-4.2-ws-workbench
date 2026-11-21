const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const {mkdtempSync,readFileSync,rmSync}=require('node:fs');
const {copyIsolatedAppFixture}=require('./helpers/isolated-app-fixture.cjs');
const os=require('node:os'),path=require('node:path');
const app=process.argv[2];
if(!app) throw new Error('app path required');
const dir=mkdtempSync(path.join(os.tmpdir(),'zhike-upgrade-http-'));
copyIsolatedAppFixture(app,dir);
const port='4399',token='upgrade-http';
const child=spawn(process.env.ZHIKE_TEST_NODE || process.execPath,['server.mjs'],{cwd:dir,windowsHide:true,env:{...process.env,ZHIKE_PORT:port,ZHIKE_API_TOKEN:token,ZHIKE_SHUTDOWN_TOKEN:token,ZHIKE_DATA_DIR:path.join(dir,'isolated-data')},stdio:'ignore'});
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
(async()=>{
  try {
    let healthy=false;
    // The copied app initializes the complete migration chain before health
    // becomes available; keep a bounded cold-start window for clean machines.
    for(let i=0;i<1200;i++){try{if((await fetch(`http://127.0.0.1:${port}/api/health`)).ok){healthy=true;break;}}catch{}await wait(50);}
    if(!healthy) throw new Error('isolated server did not become healthy');
    const paths=['/assets/atelier-dawn.svg','/modules/customer-avatar.js', '/modules/workspace-shell.js', '/modules/metrics-charts.js','/modules/smart-import.js','/modules/ticket-record-core.js','/modules/ui-refresh.css','/modules/performance-enhancements.js','/modules/business-enhancements.js','/modules/business-enhancements.css','/modules/accessibility-enhancements.js','/modules/operations-upgrade.js','/modules/operations-upgrade.css','/modules/ws-workbench-core.js','/modules/ws-crm-sync-core.js','/modules/hot-chat-profile-core.js','/modules/ws-business-pages.js', '/modules/ws-workbench.js','/modules/ws-workbench.css','/modules/design-system.css','/modules/customer-governance-ui.js'];
    for(const route of paths){const response=await fetch(`http://127.0.0.1:${port}${route}`);if(!response.ok)throw new Error(`${route} HTTP ${response.status}`);const body=await response.text();if(!body.trim())throw new Error(`${route} empty body`);}
    // The fixed list above predates many pages. Also fetch every local asset
    // the shipped index.html actually loads, so a new module that is missing
    // from the sidecar allowlist fails here instead of 404ing in the app.
    const html=readFileSync(path.join(app,'index.html'),'utf8');
    const htmlAssets=[...new Set([...html.matchAll(/(?:src|href)="\.\/?([^"]+)"/g)].map(match=>`/${match[1].replace(/^\//,'')}`))];
    assert.ok(htmlAssets.includes('/modules/ws-managed-groups-ui.js'),'index.html asset discovery must find the managed group page module');
    for(const route of htmlAssets){
      const response=await fetch(`http://127.0.0.1:${port}${route}`);
      assert.equal(response.status,200,`index.html asset ${route} must be served by the sidecar`);
      const body=Buffer.from(await response.arrayBuffer());
      assert.ok(body.equals(readFileSync(path.join(app,route.slice(1)))),`index.html asset ${route} must be served byte-for-byte`);
    }
    const readingAsset = await fetch(`http://127.0.0.1:${port}/modules/ws-group-reading-ui.js`);
    assert.equal(readingAsset.status, 200);
    assert.match(readingAsset.headers.get('content-type') || '', /^text\/javascript\b/);
    const readingScript = await readingAsset.text();
    assert.equal(readingScript, readFileSync(path.join(app, 'modules', 'ws-group-reading-ui.js'), 'utf8'));
    assert.match(readingScript, /window\.ZhikeWsGroupReading\s*=\s*api/);
    // V9.2 dedicated-WS managed group page: index.html loads it, so the
    // installed sidecar must serve it byte-for-byte as JavaScript.
    const managedAsset = await fetch(`http://127.0.0.1:${port}/modules/ws-managed-groups-ui.js`);
    assert.equal(managedAsset.status, 200, '/modules/ws-managed-groups-ui.js must be served by the sidecar allowlist');
    assert.match(managedAsset.headers.get('content-type') || '', /^text\/javascript\b/);
    assert.equal(await managedAsset.text(), readFileSync(path.join(app, 'modules', 'ws-managed-groups-ui.js'), 'utf8'));
    console.log('upgrade HTTP smoke: isolated server served all new module assets and '+htmlAssets.length+' index.html assets');
    await fetch(`http://127.0.0.1:${port}/api/shutdown`,{method:'POST',headers:{'X-Zhike-Api-Token':token,'X-Zhike-Shutdown-Token':token}});
  } finally {
    if(child.exitCode===null) child.kill();
    for(let i=0;i<12;i++){try{rmSync(dir,{recursive:true,force:true});break;}catch{await wait(200);}}
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
