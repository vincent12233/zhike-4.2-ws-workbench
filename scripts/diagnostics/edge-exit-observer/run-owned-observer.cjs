'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');
const { spawn } = require('node:child_process');
const { createInterface } = require('node:readline');
const { once } = require('node:events');
const { randomUUID } = require('node:crypto');

const repo = path.resolve(__dirname, '../../..');
const [kind, dotnet = path.join(repo,'.tools/dotnet10/dotnet.exe'), mode = 'standard'] = process.argv.slice(2);
assert.equal(process.platform, 'win32');
assert.ok(['control','edge'].includes(kind), 'Select control or edge');
assert.ok(['standard','trace','matrix'].includes(mode) && (kind === 'edge' || mode === 'standard'));
assert.ok(path.isAbsolute(dotnet) && fs.existsSync(dotnet), 'Use a local absolute path to dotnet.exe');
const observerLibrary = path.join(__dirname,'observer/bin/Release/net10.0/Observer.dll');
assert.ok(fs.existsSync(observerLibrary), 'Build the isolated observer before using it');
const evidence = path.join(repo, '.tools/edge-exit-observer', kind+'-'+mode+'-'+randomUUID());
fs.mkdirSync(evidence, { recursive:true });
console.log('Observation output: '+evidence);
const eventsFile = path.join(evidence,'observer.jsonl');
const runnerPath = path.join(repo,'tests/helpers/isolated-edge-runner.cjs');
const observer = spawn(dotnet,[observerLibrary],
  { cwd:evidence, windowsHide:true, stdio:['pipe','pipe','pipe'] });
const closed = once(observer,'close');
closed.catch(()=>{});
observer.stderr.resume();
observer.stdin.on('error',()=>{});
const lines = createInterface({ input:observer.stdout, crlfDelay:Infinity });
const observations = [], listeners = new Set();
const watchTrigger = kind === 'edge' && mode !== 'matrix' ? 'cdp-transport-closed' : 'close-requested';
let parseError, resolvedCall, observerPid=observer.pid, typeByPid=new Map(), armed=false;
const record = entry => fs.appendFileSync(eventsFile,JSON.stringify(entry)+'\n');
lines.on('line',line=>{
  let event;
  try { event=JSON.parse(line); } catch(error){parseError ||= error;return;}
  observations.push(event);
  record(event);
  for(const listener of listeners) listener(event);
});
function bounded(promise,ms,label) {
  let timer;
  return Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error(label)),ms);})])
    .finally(()=>clearTimeout(timer));
}
function expect(kind,timeoutMs) {
  const old=observations.find(row=>row.kind===kind);
  if(old) return Promise.resolve(old);
  let subscription;
  return bounded(new Promise(resolve=>{
    subscription=row=>{if(row.kind===kind)resolve(row);};
    listeners.add(subscription);
  }),timeoutMs,'Observer did not report '+kind).finally(()=>listeners.delete(subscription));
}
function compile(filename,source,overrides={}) {
  const loaded = new Module(filename,module);
  loaded.filename = filename;
  loaded.paths = Module._nodeModulePaths(path.dirname(filename));
  const original = loaded.require.bind(loaded);
  loaded.require = name=>Object.hasOwn(overrides,name)?overrides[name]:original(name);
  loaded._compile(source,filename);
  return loaded.exports;
}
function replace(source,anchor,changed) {
  assert.ok(source.includes(anchor),'Missing diagnostic anchor: '+anchor);
  return source.replace(anchor,changed);
}
globalThis.__zhikeObserveProcessTypes = list => {
  const known = new Set(['browser','renderer','gpu','utility','zygote','sandbox helper','other']);
  for(const item of list) {
    const role=String(item.type).toLowerCase();
    const metricsRoles = {
      'network.mojom.networkservice':'network-service',
      'storage.mojom.storageservice':'storage-service',
      'tracing.mojom.tracingservice':'tracing-service',
      'audio.mojom.audioservice':'audio-service',
      'data_decoder.mojom.datadecoderservice':'data-decoder-service',
      'chrome.mojom.utilwin':'windows-utility-service',
    };
    typeByPid.set(Number(item.id),known.has(role)?role:metricsRoles[role]||'other');
  }
};
globalThis.__zhikeObservePhase = (event,metadata) => {
  if (event !== watchTrigger) return;
  try {
    const identities=metadata.identities.map(row=>({ pid:row.pid, startedTicks:row.startedTicks,
      role:typeByPid.get(row.pid) || (row.pid===metadata.pid?'root':'unknown') }));
    assert.ok(identities.some(row=>row.pid===metadata.pid));
    const request={kind,rootPid:metadata.pid,identities,closeAtUnixMs:Date.now(),
      deadlineUnixMs:Date.parse(metadata.launchedAt)+metadata.timeoutMs};
    armed=true;
    observer.stdin.write(JSON.stringify(request)+'\n');
    resolvedCall={invocation:metadata.invocation,pid:metadata.pid,closeAtUnixMs:request.closeAtUnixMs,deadlineUnixMs:request.deadlineUnixMs};
  } catch (error) {
    parseError ||= error;
  }
};

function loadRunner() {
  let runnerSource=fs.readFileSync(runnerPath,'utf8');
  runnerSource=replace(runnerSource,
    'const mark = (event, detail = {}) => metadata.events.push({ event, elapsedMs: elapsed(), ...detail });',
    'const mark = (event, detail = {}) => { metadata.events.push({ event, elapsedMs: elapsed(), ...detail }); globalThis.__zhikeObservePhase(event,metadata); };');
  runnerSource=replace(runnerSource,'const ids = data.processInfo.map(row => Number(row.id));',
    'globalThis.__zhikeObserveProcessTypes(data.processInfo); const ids = data.processInfo.map(row => Number(row.id));');
  if(mode==='trace'){
    const traceFile=path.join(evidence,'shutdown-trace.json');
    const flags=['--trace-startup=shutdown','--trace-startup-duration=20','--trace-startup-format=json','--trace-startup-file='+traceFile];
    runnerSource=replace(runnerSource,"'--window-size=1280,720', 'about:blank'],",
      "'--window-size=1280,720', "+flags.map(flag=>JSON.stringify(flag)).join(', ')+", 'about:blank'],");
  }
  return compile(runnerPath,runnerSource);
}

async function runControl(runner) {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'zhike-exit-observer-control-'));
  const result=await runner.runProcessLifecycle({
    command:process.execPath,args:['-e',"process.stdout.write('READY');process.stdin.resume();process.stdin.on('data',()=>setTimeout(()=>process.exit(0),1300))"],
    root,mode:'controlled-node-kernel-observer',timeoutMs:10000,evidenceDirectory:evidence,
    readResult:context=>context.waitForOutput(text=>text.includes('READY')?{ready:true}:undefined),
    requestClose:context=>{context.child.stdin.end('STOP\n');return{acknowledgement:'owned-stdin'}},
  });
  assert.equal(result.metadata.status,'Passed');
  assert.equal(result.metadata.exit.code,0);
  assert.equal(result.metadata.cleanupSafe,true);
  fs.rmdirSync(root);
  const exited=await expect('watch-ended',1500);
  const attached=observations.find(row=>row.kind==='watch-armed');
  assert.equal(attached.body.rootAvailable,true);
  assert.equal(exited.body.ending,'root-exited');
  assert.equal(exited.body.root.exitCode,0);
  assert.ok(observations.some(row=>row.kind==='sample'&&row.body.threads.status==='observed'));
  assert.ok(exited.body.elapsed>1000 && exited.body.elapsed<4000);
  return { result:'Passed', elapsedMs:result.metadata.elapsedMs, expectedHoldMs:1300,
    evidence:result.metadata.invocation, captureEnded:exited.body.ending, observedProcessExit:exited.body.root.exitCode };
}
async function runEdge(runner) {
  process.env.ZHIKE_VISUAL_EVIDENCE=evidence;
  delete process.env.ZHIKE_VISUAL_SNAPSHOTS;
  const filename=path.join(repo,'scripts/delivery/s1-main-visual.test.cjs');
  let source=fs.readFileSync(filename,'utf8');
  let matrixInvocations=0;
  if(mode==='matrix'){
    delete process.env.ZHIKE_VISUAL_ONLY;
    // Stop only after the default matrix's original layout assertion loop.
    // The following palette and screenshot checks use different Edge invocations.
    const followUp="  for(const [name,query] of [['night','palette=horizon-night'],['dawn-dark-legacy','palette=atelier-dawn&legacyTheme=dark']]){";
    assert.equal(source.indexOf(followUp),source.lastIndexOf(followUp),'Unique matrix boundary required');
    source=replace(source,followUp,'  return;\n'+followUp);
    const originalRunner=runner;
    runner={...originalRunner,runIsolatedEdge(options){
      const url=new URL(options.url);
      assert.equal(path.posix.basename(url.pathname),'matrix.html');
      assert.equal(url.search,'');
      assert.equal(options.expectedViewports.length,8);
      assert.equal(options.screenshotPath,undefined);
      assert.equal(++matrixInvocations,1,'Observe exactly one default S1 matrix invocation');
      return originalRunner.runIsolatedEdge(options);
    }};
  } else {
    process.env.ZHIKE_VISUAL_ONLY='snapshots';
    source=replace(source,"[['home','atelier-dawn'],['customers','atelier-dawn'],['operations','atelier-dawn'],['home','horizon-night']]", "[['operations','atelier-dawn']]");
    source=replace(source,"console.log('Final Pro screenshots: 4 real routes and actual topbar text contrast PASS');",
      "console.log('Scoped actual operations screenshot: original route, topbar readability and PNG assertions PASS');");
  }
  source=replace(source,'main().catch(error=>{console.error(error);process.exitCode=1;});','module.exports=main();');
  try {
    // This command remains an explicit independent-Edge diagnostic. The formal
    // renderer default must never silently turn it into a WebView2 observation.
    process.env.ZHIKE_VISUAL_BACKEND='edge';
    await compile(filename,source,{
      '../../tests/helpers/isolated-edge-runner.cjs':runner,
      '../../tests/helpers/isolated-renderer.cjs':{
        runIsolatedRenderer:options=>runner.runIsolatedEdge(options),
        recordVisualAssertions:runner.recordVisualAssertions,
      },
    });
    if(mode==='matrix') assert.equal(matrixInvocations,1);
    return { result:'Passed', ...resolvedCall };
  } catch(error) {
    if(!error.metadata)throw error;
    return { result:'Failed', ...resolvedCall, failure:error.metadata.failure, cleanupSafe:error.metadata.cleanupSafe,
      elapsedMs:error.metadata.elapsedMs };
  }
}
async function main() {
  const ready=await expect('ready',8000);
  assert.equal(ready.body.pid,observerPid);
  const runner = loadRunner();
  const result=kind==='control'?await runControl(runner):await runEdge(runner);
  assert.ifError(parseError);
  const ended = armed ? await expect('watch-ended',1500) : null;
  result.kernelObservation = ended?.body.ending ?? 'not-armed';
  if(mode==='matrix') result.kernelRoot = ended?.body.root ?? null;
  if (result.result !== 'Passed' || result.kernelObservation !== 'root-exited') process.exitCode = 1;
  console.log(JSON.stringify(result));
}
main().catch(error=>{
  console.error(error.message);
  process.exitCode=1;
}).finally(async()=>{
  observer.stdin.end();
  let proof;
  try {
    proof=await bounded(closed,2500,'Independent observer did not close');
    assert.deepEqual(proof,[0,null]);
    assert.ok(observations.some(event=>event.kind==='stopped'));
  } catch(error) {
    if(observer.exitCode===null&&observer.signalCode===null) observer.kill();
    try { proof=await bounded(closed,1000,'Owned observer termination not observed'); }
    catch { proof=null; }
    console.error(error.message);
    process.exitCode=1;
  } finally {
    lines.close();
    record({kind:'observer-exit', pid:observerPid, proof:proof??null});
  }
});
