'use strict';
// Actual isolated Node subprocess IO/lifecycles. This suite never launches Edge
// and cannot establish real-browser or native WinUI acceptance.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { createHash, randomUUID } = require('node:crypto');
const { performance } = require('node:perf_hooks');
const { setTimeout: delay } = require('node:timers/promises');
// Observe the real PowerShell process and its PID requests. The helper
// captures this forwarding wrapper before the original spawn is restored.
const childProcess = require('node:child_process');
const actualSpawn = childProcess.spawn, identityProbes = [];
let probeTestMode;
childProcess.spawn = function (command, args, ...rest) {
  const encodedIndex = args?.indexOf('-EncodedCommand') ?? -1;
  const encoded = encodedIndex >= 0 ? args[encodedIndex + 1] : undefined;
  const script = encoded && Buffer.from(encoded, 'base64').toString('utf16le');
  const isIdentityProbe = script?.includes('$identityRequest=[Console]::ReadLine()');
  if (isIdentityProbe && probeTestMode) {
    args = args.slice();
    // Keep the real PowerShell process alive after its stdin ends.
    args[encodedIndex + 1] = Buffer.from(script + '\nStart-Sleep -Seconds 8', 'utf16le').toString('base64');
  }
  const child = actualSpawn.call(childProcess, command, args, ...rest);
  if (isIdentityProbe) {
    const close = Promise.withResolvers();
    const probe = { pid: child.pid, queries: [], actualClose: null, observedClose: close.promise };
    const observeClose = (code, signal) => {
      probe.actualClose = { code, signal };
      close.resolve();
    };
    const write = child.stdin.write;
    child.stdin.write = function (chunk, ...options) {
      probe.queries.push(String(chunk).trim().split(',').map(Number));
      return write.call(this, chunk, ...options);
    };
    if (probeTestMode === 'probe-unverified-timeout') {
      // Hide only the close proof from the runner. Capture the exact process
      // event here so the controlled test can still verify real release.
      const emit = child.emit;
      child.emit = function (event, ...values) {
        if (event === 'close') {
          const [code, signal] = values;
          observeClose(code, signal);
          return true;
        }
        return emit.call(this, event, ...values);
      };
    } else {
      child.once('close', observeClose);
    }
    identityProbes.push(probe);
  }
  return child;
};
const { runProcessLifecycle, probeIdentities, startWindowsIdentityProbe, validateEdgeOptions, writeScreenshotPng, waitForOwnedDevToolsEndpoint, isOwnedReadinessWait } = require('./helpers/isolated-edge-runner.cjs');
childProcess.spawn = actualSpawn;
assert.equal(typeof validateEdgeOptions,'function','Browser options must be validated before creating a process/profile');
assert.equal(typeof writeScreenshotPng,'function','Screenshot bytes need a tested confined PNG writer');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zhike-edge-runner-test-'));
const evidenceDirectory = path.resolve(__dirname, '../.tools/isolated-edge-runner-lifecycle');
const trackedChildProgram = [
  "const fs=require('node:fs');",
  "const stop=process.argv[1];",
  "setTimeout(()=>process.exit(9),15000);",
  "setInterval(()=>{if(fs.existsSync(stop))process.exit(0)},20);",
].join('');
const script = [
  "const mode=process.argv[1];",
  "const timer=setInterval(()=>{},1000);process.stdin.setEncoding('utf8');",
  `if(mode==='tracked-child'||mode==='late-release'){const child=require('node:child_process').spawn(process.execPath,['-e',${JSON.stringify(trackedChildProgram)},process.argv[2]],{windowsHide:true,detached:true,stdio:'ignore'});child.unref();process.stdout.write('CHILD:'+child.pid+'\\n')}`,
  "if(mode==='early-exit'){process.stdout.write('READY\\n');setTimeout(()=>process.exit(7),20)}",
  "else if(mode==='result-timeout')process.stdout.write('READY\\n');",
  "else process.stdout.write('RESULT:'+(mode==='invalid-result'?'broken-json':JSON.stringify({value:42,synthetic:true}))+'\\n');",
  "process.stdin.on('data',value=>{if(!value.includes('CLOSE'))return;if(mode==='close-timeout')return;",
  "if(mode==='late-release'){setTimeout(()=>process.exit(0),Math.max(0,Number(value.slice(6))-Date.now()));return}",
  "if(mode==='stream-exit-order'){require('node:fs').closeSync(1);require('node:fs').closeSync(2);setTimeout(()=>process.exit(0),400);return}",
  "if(mode==='close-final-buffer'){process.stdout.write('CLOS');setImmediate(()=>process.stdout.end('ED\\n',()=>process.exit(0)));return}",
  "process.exit(['nonzero-close','close-output-eof','close-ack-timeout-after-exit'].includes(mode)?9:0)});",
].join('');
const completed = [], known = [];
let parameterChecks=0;
function parameterCase(name,body){body();parameterChecks++;console.log('[PASS] parameter/path '+name)}
function validateParameters(){
 const evidence=path.join(root,'evidence'),outside=path.join(root,'outside');fs.mkdirSync(evidence);fs.mkdirSync(outside);
 const fixture=path.join(root,'fixture.html');fs.writeFileSync(fixture,'<!doctype html><pre id="result">[]</pre>');
 const base={edge:process.execPath,root,url:pathToFileURL(fixture).href,expectedViewports:[{width:1920,height:1080}],evidenceDirectory:evidence};
 const viewport={width:1920,height:1080},target=path.join(evidence,'capture.png');
 parameterCase('valid optional viewport and confined PNG are normalized without starting a process',()=>{const value=validateEdgeOptions({...base,viewport,screenshotPath:target});assert.deepEqual(value.viewport,viewport);assert.equal(value.screenshotPath,target);assert.equal(fs.existsSync(target),false)});
 parameterCase('legacy matrix accepts omitted Emulation and retains all expected cases',()=>{const value=validateEdgeOptions({...base,expectedViewports:[{width:1280,height:720},{width:1920,height:1080}]});assert.equal(value.viewport,undefined);assert.equal(value.expectedViewports.length,2)});
 parameterCase('owned resource release is fixed and cannot be changed by callers',()=>{assert.equal(Object.hasOwn(validateEdgeOptions(base),'closeStrategy'),false);for(const closeStrategy of['browser','owned-target-first','force-kill','global-targets',true,{},'',undefined])assert.throws(()=>validateEdgeOptions({...base,closeStrategy}),/one fixed session-target-browser order/)});
 parameterCase('viewport rejects strings booleans missing nonfinite negative and excessive dimensions',()=>{for(const value of[{width:0,height:1},{width:-1,height:1},{width:'1920',height:1080},{width:true,height:1},{width:Infinity,height:1},{width:1},{width:8193,height:1},{width:8192,height:8192}])assert.throws(()=>validateEdgeOptions({...base,viewport:value}))});
 parameterCase('expected viewport handshake never accepts an empty or invalid array',()=>{for(const expectedViewports of[[],null,[{width:1,height:false}],[{width:1,height:NaN}]])assert.throws(()=>validateEdgeOptions({...base,expectedViewports}))});
 parameterCase('screenshots require one matching explicit viewport',()=>{assert.throws(()=>validateEdgeOptions({...base,screenshotPath:target}));assert.throws(()=>validateEdgeOptions({...base,viewport:{width:1,height:1},screenshotPath:target}));assert.throws(()=>validateEdgeOptions({...base,viewport,screenshotPath:target,expectedViewports:[viewport,viewport]}))});
 parameterCase('outside and traversal targets are refused',()=>{for(const screenshotPath of[path.join(outside,'capture.png'),path.join(evidence,'..','capture.png')])assert.throws(()=>validateEdgeOptions({...base,viewport,screenshotPath}))});
 parameterCase('ADS non-PNG and directory destinations are refused',()=>{const directory=path.join(evidence,'directory.png');fs.mkdirSync(directory);for(const screenshotPath of[target+':hidden',path.join(evidence,'capture.jpg'),directory])assert.throws(()=>validateEdgeOptions({...base,viewport,screenshotPath}))});
 const link=path.join(evidence,'junction');
 parameterCase('a real filesystem junction cannot redirect a screenshot outside evidence',()=>{fs.symlinkSync(outside,link,process.platform==='win32'?'junction':'dir');try{assert.throws(()=>validateEdgeOptions({...base,viewport,screenshotPath:path.join(link,'capture.png')}))}finally{fs.unlinkSync(link)}});
 const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6DEsAAAAASUVORK5CYII=',bytes=Buffer.from(png,'base64');
 parameterCase('PNG writer preserves original bytes and safely replaces only a regular evidence artifact',()=>{fs.writeFileSync(target,'previous synthetic artifact');const meta=writeScreenshotPng({evidenceDirectory:evidence,screenshotPath:target,data:png,viewport:{width:1,height:1}});assert.ok(fs.readFileSync(target).equals(bytes));assert.equal(meta.sha256,createHash('sha256').update(bytes).digest('hex'));assert.equal(meta.width,1);assert.equal(meta.height,1);assert.deepEqual(fs.readdirSync(evidence).filter(name=>name.startsWith('.capture-')),[])});
 parameterCase('invalid PNG bytes and viewport mismatch never replace the existing evidence',()=>{for(const data of['not_base64',Buffer.from('not png').toString('base64'),bytes.subarray(0,24).toString('base64')])assert.throws(()=>writeScreenshotPng({evidenceDirectory:evidence,screenshotPath:target,data,viewport:{width:1,height:1}}));assert.throws(()=>writeScreenshotPng({evidenceDirectory:evidence,screenshotPath:target,data:png,viewport:{width:2,height:1}}));assert.ok(fs.readFileSync(target).equals(bytes))});
 parameterCase('hard-linked destination is refused without changing the other file',()=>{const original=path.join(outside,'original.png'),hard=path.join(evidence,'hard.png');fs.writeFileSync(original,bytes);fs.linkSync(original,hard);try{assert.throws(()=>writeScreenshotPng({evidenceDirectory:evidence,screenshotPath:hard,data:png,viewport:{width:1,height:1}}));assert.ok(fs.readFileSync(original).equals(bytes))}finally{fs.unlinkSync(hard)}});
 parameterCase('readiness classification admits only ENOENT or EBUSY on the exact owned endpoint path',()=>{const owned=path.join(root,'edge-profile-owned','DevToolsActivePort');for(const code of['ENOENT','EBUSY'])assert.equal(isOwnedReadinessWait({code,path:owned},owned),true);for(const error of[{code:'EPERM',path:owned},{code:'EACCES',path:owned},{code:'EISDIR',path:owned},{code:'EINVAL',path:owned},{code:'EBUSY',path:target},{code:'EBUSY'},{code:'ENOENT',path:'DevToolsActivePort'}])assert.equal(isOwnedReadinessWait(error,owned),false)});
}
async function ensureGone(metadata) {
  const ids = metadata.identities.length ? metadata.identities.map(row=>row.pid) : [metadata.pid].filter(Boolean);
  if (!ids.length) return;
  const until=Date.now()+5000;
  while(Date.now()<until) {
    const rows=await probeIdentities(ids,Math.max(1,until-Date.now()));
    const same=rows.filter(row=>!metadata.identities.length||metadata.identities.some(expected=>row.pid===expected.pid&&row.startedTicks===expected.startedTicks));
    if(!same.length)return;
    await new Promise(resolve=>setTimeout(resolve,20));
  }
  throw new Error('Controlled test process remained; automatic directory cleanup is not permitted');
}
function waitForProbeFixture(promise, deadline, message) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), Math.max(1, deadline - Date.now()));
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
async function runCase(mode, expected) {
  let output, error, preparedProbe, preparationMs;
  const preparationStarted = Date.now();
  const preparationDeadline = preparationStarted + 5000;
  const firstProbe = identityProbes.length;
  const tracksDescendant = mode === 'tracked-child' || mode === 'late-release';
  const stopFile = path.join(root, mode + '-descendant-stop');
  const probeTimeoutCase = mode === 'probe-close-timeout' || mode === 'probe-unverified-timeout';
  probeTestMode = probeTimeoutCase ? mode : undefined;
  try {
    if (probeTimeoutCase) {
      // These cases measure EOF/termination after a verified result. Complete
      // real PowerShell startup and a separate readiness query beforehand,
      // while leaving the actual child identity check inside the lifecycle.
      preparedProbe = startWindowsIdentityProbe(root);
      const rows = await waitForProbeFixture(
        preparedProbe.query([process.pid]), preparationDeadline - 250, 'Controlled identity probe did not become ready'
      );
      assert.equal(rows.length, 1);
      assert.equal(rows[0].pid, process.pid);
      assert.match(rows[0].startedTicks, /^\d+$/);
      preparationMs = Date.now() - preparationStarted;
    }
    output=await runProcessLifecycle({
      startIdentityProbe: probeTimeoutCase ? () => {
        const ready = preparedProbe;
        preparedProbe = undefined;
        return ready;
      } : undefined,
      command:process.execPath,args:['-e',script,mode,stopFile],root,mode:'controlled-node-'+mode,
      timeoutMs:mode === 'late-release' ? 6000 : mode.includes('timeout') ? 3000 : 10000,evidenceDirectory,
      readResult:async context=>{
        if(tracksDescendant){
          const extraPid=await context.waitForOutput(stdout=>{const match=stdout.match(/^CHILD:(\d+)$/m);return match?Number(match[1]):undefined});
          await context.observeProcessIds([extraPid]);
        }
        return context.waitForOutput(stdout=>{
        const match=stdout.match(/^RESULT:(.*)$/m);if(!match)return undefined;
        try{return JSON.parse(match[1])}catch{throw Object.assign(new Error('Invalid controlled result'),{code:'INVALID_RESULT',phase:'result'})}
      })},
      requestClose: context => {
        if (!context.child?.stdin.writable) return { acknowledgement: 'already-exited' };
        if (mode === 'late-release') {
          fs.writeFileSync(stopFile, 'stop this synthetic child\n');
          // Return the root during the final 500ms, after the old probe
          // timer had already sent EOF and rejected further queries.
          const deadline = Date.parse(context.metadata.launchedAt) + context.metadata.timeoutMs;
          context.child.stdin.end('CLOSE ' + (deadline - 380) + '\n');
        } else if (mode === 'close-final-buffer') {
          const ended = new Promise(resolve => context.child.stdout.once('end', resolve));
          context.child.stdin.end('CLOSE\n');
          return ended.then(() => context.waitForOutput(stdout => /^CLOSED\n/m.test(stdout)
            ? { acknowledgement: 'final-buffer' } : undefined));
        } else {
          context.child.stdin.end('CLOSE\n');
          if (mode === 'close-output-eof')
            return context.waitForOutput(stdout => /^CLOSED\n/m.test(stdout) ? { acknowledgement: 'close-output' } : undefined);
          if (mode === 'close-ack-timeout-after-exit') return new Promise(() => {});
        }
        return { acknowledgement: 'stdin-request' };
      },
    });
  } catch(caught){error=caught}
  finally {
    probeTestMode = undefined;
    if (tracksDescendant) fs.writeFileSync(stopFile,'stop this synthetic child\n');
    if (preparedProbe) {
      preparedProbe.requestTermination();
      try {
        await waitForProbeFixture(
          identityProbes[firstProbe].observedClose, preparationDeadline, 'Controlled fixture probe release was not confirmed'
        );
      } finally {
        preparedProbe.detach();
      }
    }
  }
  if (error && !error.metadata) throw error;
  const metadata=(error||output).metadata;known.push(metadata);
  const probes=identityProbes.slice(firstProbe);
  assert.equal(probes.length,1,'The entire lifecycle must reuse one isolated OS identity probe');
  const [probe]=probes;
  const lifecycleQueries=probe.queries;
  assert.equal(metadata.identityProbePid,probe.pid);
  if(metadata.cleanupSafe){assert.deepEqual(probe.actualClose,{code:0,signal:null});assert.equal(metadata.identityProbeClosed,true);}
  await ensureGone(metadata);
  assert.ok(metadata.pid>0);assert.ok(metadata.events.some(event=>event.event==='close-requested'));
  assert.ok(metadata.mode.startsWith('controlled-node-'));
  const saved=JSON.parse(fs.readFileSync(metadata.evidenceFile,'utf8'));
  assert.equal(saved.mode,metadata.mode);assert.equal(saved.timeoutMs,metadata.timeoutMs);
  if(expected==='passed'){
    assert.ifError(error);assert.deepEqual(output.result,{value:42,synthetic:true});assert.equal(metadata.status,'Passed');assert.equal(metadata.exit.code,0);assert.equal(metadata.streamsClosed,true);assert.equal(metadata.cleanupSafe,true);assert.equal(metadata.forceTerminated,false);assert.ok(metadata.identities[0].startedTicks);
  }else{
    assert.ok(error,'The failure must never be converted into a pass');assert.equal(metadata.status,'Failed');assert.equal(saved.status,'Failed');assert.equal(error.code,expected);
  }
  if (probeTimeoutCase) {
    assert.equal(metadata.timeoutMs, 3000);
    assert.deepEqual(lifecycleQueries, [[process.pid], [metadata.pid]]);
    assert.equal(metadata.rootExitProof, 'verified-spawn-handle-exit-and-streams');
    assert.equal(metadata.resultReady, true);
    assert.equal(error.phase,'identity-probe-close');
    assert.equal(metadata.cleanupSafe,false,'Probe timeout keeps the lifecycle failed');
    assert.ok(probe.actualClose,'This test owns an actual PowerShell process and observes its independent close');
    const confirmed = mode === 'probe-close-timeout';
    assert.deepEqual(saved.identityProbeTermination,{
      attempted:true, requested:true, observedClose:confirmed ? probe.actualClose : null, status:confirmed ? 'confirmed' : 'unknown',
    });
    const requested=metadata.events.find(event=>event.event==='identity-probe-termination-requested');
    assert.ok(requested.elapsedMs<metadata.timeoutMs,'The existing budget reserves time for the termination request and proof');
    assert.equal(metadata.events.some(event=>event.event===(confirmed?'identity-probe-termination-confirmed':'identity-probe-termination-unverified')),true);
  }
  if(mode==='result-timeout'){assert.equal(error.phase,'result');assert.equal(metadata.cleanupSafe,true,'A result timeout still closes this controlled process normally');}
  if(['normal','result-timeout','stream-exit-order'].includes(mode)){
    assert.deepEqual(lifecycleQueries,[[metadata.pid]],'A verified directly owned child exit does not need another PID query');
    assert.equal(metadata.rootExitProof,'verified-spawn-handle-exit-and-streams');
  }
  if(mode==='tracked-child'){
    assert.equal(metadata.cleanupSafe,false,'A live observed descendant must still prevent directory cleanup');
    assert.equal(metadata.remainingIdentities.length,1);
    const extra=metadata.identities.find(row=>row.pid!==metadata.pid);assert.ok(extra?.startedTicks);
    assert.deepEqual(lifecycleQueries,[[metadata.pid],[extra.pid],[extra.pid]],'Only the already-exited direct child can be excluded from the final OS identity query');
    assert.equal(metadata.remainingIdentities[0].pid,extra.pid);
  }
  if (mode === 'late-release') {
    const exitEvent = metadata.events.find(event => event.event === 'process-exit');
    assert.ok(exitEvent.elapsedMs >= metadata.timeoutMs - 500, 'The root exited during the former premature probe shutdown window');
    assert.deepEqual(metadata.remainingIdentities, [], 'The released descendant still receives an exact release probe');
    const descendant = metadata.identities.find(row => row.pid !== metadata.pid);
    assert.ok(descendant?.startedTicks);
    assert.deepEqual(lifecycleQueries, [[metadata.pid], [descendant.pid], [descendant.pid]]);
    const releaseIndex = metadata.events.findIndex(event => event.event === 'identity-query-started' && event.phase === 'release');
    const probeCloseIndex = metadata.events.findIndex(event => event.event === 'identity-probe-closed');
    assert.ok(releaseIndex >= 0 && releaseIndex < probeCloseIndex, 'The probe only closes after the last query is in flight');
  }
  if(mode==='close-timeout'){assert.equal(error.phase,'process-exit');assert.equal(metadata.forceTerminated,true,'Only the retained child process handle may be terminated after failure');}
  if(mode==='nonzero-close'){assert.equal(metadata.exit.code,9);assert.equal(metadata.streamsClosed,true);assert.equal(metadata.cleanupSafe,true);}
  if (mode === 'close-output-eof' || mode === 'close-ack-timeout-after-exit') {
    assert.equal(error.phase, 'request-close');
    assert.deepEqual(saved.exit, { code: 9, signal: null });
    assert.equal(saved.streamsClosed, true);
    const timeouts = metadata.events.filter(event => event.event === 'deadline-timeout').map(event => event.phase);
    assert.ok(!timeouts.includes('process-exit') && !timeouts.includes('streams-close'),
      'An actual exit and stream close observed within the budget cannot become secondary timeouts');
    if (mode === 'close-output-eof') {
      assert.deepEqual(timeouts, []);
      assert.equal(saved.cleanupSafe, true, 'The failed close protocol must leave time for owned-process cleanup');
      assert.equal(saved.identityProbeClosed, true);
    } else {
      assert.ok(timeouts.includes('request-close'), 'The independent close acknowledgement deadline still fails');
      assert.equal(saved.cleanupSafe, false);
    }
  }
  if (mode === 'close-final-buffer') {
    assert.ok(metadata.events.some(event => event.event === 'close-request-complete' && event.acknowledgement === 'final-buffer'));
  }
  if(mode==='stream-exit-order'){
    const events=metadata.events.map(event=>event.event),index=name=>events.indexOf(name);
    assert.ok(index('result-ready')<index('close-requested')&&index('close-requested')<index('process-exit'),'A completed result and explicit close request precede actual process exit');
    assert.ok(index('stdout-close')>=0&&index('stderr-close')>=0,'Both actual stream-close events are observed');
    assert.ok(index('streams-close')>index('process-exit')&&index('streams-close')>index('stdout-close')&&index('streams-close')>index('stderr-close'),'Overall child close requires the actual exit and both closed streams without a scheduler-duration assumption');
  }
  completed.push({mode,status:'Passed',testedStatus:metadata.status,errorCode:error?.code||null,elapsedMs:metadata.elapsedMs,preparationMs,evidence:metadata.evidenceFile});
  console.log(JSON.stringify(completed.at(-1)));
}
async function runExclusiveReadinessCase(bounded=false){
 assert.equal(process.platform,'win32','A real Windows FileShare.None test is required, not a mock lock');
 const profile=path.join(root,'edge-profile-'+randomUUID());fs.mkdirSync(profile);
 const endpointFile=path.join(profile,'DevToolsActivePort');
 const quoted="'"+endpointFile.replace(/'/g,"''")+"'";
 const lockScript="$ErrorActionPreference='Stop';$file=[IO.File]::Open("+quoted+",[IO.FileMode]::Create,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None);try{$bytes=[Text.Encoding]::UTF8.GetBytes(\"12345`n/devtools/browser/00000000-0000-0000-0000-000000000000`n\");$file.Write($bytes,0,$bytes.Length);$file.Flush();[Console]::Out.WriteLine('LOCKED');[Console]::Out.Flush();$null=[Console]::In.ReadLine()}finally{$file.Dispose()};[Console]::Out.WriteLine('UNLOCKED');[Console]::Out.Flush();$null=[Console]::In.ReadLine();exit 0";
 const command=path.join(process.env.SystemRoot||'C:\\Windows','System32/WindowsPowerShell/v1.0/powershell.exe');
 let output,error;
 try{output=await runProcessLifecycle({command,args:['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(lockScript,'utf16le').toString('base64')],root,mode:bounded?'controlled-powershell-bounded-readiness':'controlled-powershell-exclusive-readiness',timeoutMs:bounded?4000:10000,evidenceDirectory,
  async readResult(context){
   context.metadata.profile=profile;await context.wait(context.waitForOutput(value=>value.includes('LOCKED')?true:undefined),'lock-ready');let released=false;
   const scoped={...context,mark:(event,detail)=>{context.mark(event,detail);if(event==='cdp-readiness-wait'&&detail?.code==='EBUSY'&&!released&&!bounded){released=true;context.child.stdin.write('RELEASE\n')}}};
   const endpoint=await waitForOwnedDevToolsEndpoint(profile,scoped);assert.ok(endpoint.startsWith('ws://127.0.0.1:12345/devtools/browser/'),'The owned file supplies the expected isolated protocol shape');
   assert.ok(released&&context.metadata.devToolsReadiness.ebusy>0,'Actual exclusive sharing must be observed before recovery');return {syntheticReadinessRecovered:true};
  },requestClose:context=>{if(context.child?.stdin.writable)context.child.stdin.end('CLOSE\n');return {acknowledgement:'stdin-request'}}
 })}catch(caught){error=caught}
 const metadata=(error||output).metadata;known.push(metadata);await ensureGone(metadata);
 if(bounded){assert.ok(error);assert.equal(error.code,'EDGE_RUNNER_TIMEOUT');assert.equal(metadata.status,'Failed');assert.equal(metadata.timeoutMs,4000);assert.ok(metadata.devToolsReadiness.ebusy>1,'A still-locked file must stop at the existing deadline, not reset it per poll')}else{assert.ifError(error);assert.equal(metadata.status,'Passed')}
 assert.equal(metadata.exit.code,0);assert.equal(metadata.cleanupSafe,true);assert.equal(metadata.forceTerminated,false);
 assert.doesNotMatch(JSON.stringify(metadata),/ws:\/\/|devtools\/browser/,'Readiness diagnostics must not record the endpoint token');
 completed.push({mode:bounded?'real-windows-bounded-readiness':'real-windows-exclusive-readiness',status:'Passed',testedStatus:metadata.status,busyPolls:metadata.devToolsReadiness.ebusy,evidence:metadata.evidenceFile});console.log(JSON.stringify(completed.at(-1)));
}

async function runResultEvidenceCase(mode) {
  const timeoutMs = 6000, bytes = '{"synthetic":true}';
  const originalWrite = fs.promises.writeFile;
  let closeRequested = false, childExited = false, evidenceWriteStarted = false, contextAtResult, output, error;
  const remaining = () => timeoutMs - (performance.now() - contextAtResult.metadata.startedMonotonicMs);
  fs.promises.writeFile = async function (file, ...args) {
    if (!file.endsWith('.result.json')) return originalWrite.call(this, file, ...args);
    evidenceWriteStarted = true;
    assert.ok(closeRequested && childExited, 'Raw result persistence must follow the close request and actual process exit');
    if (mode === 'write-error') throw Object.assign(new Error('Controlled diagnostic volume error'), { code: 'ENOSPC' });
    await delay(Math.max(1, Math.ceil(remaining() + 100)));
    return originalWrite.call(this, file, ...args);
  };
  try {
    output = await runProcessLifecycle({
      command: process.execPath, args: ['-e', "process.stdout.write('RESULT');process.stdin.resume();process.stdin.on('data',()=>process.exit(0))"],
      root, mode: 'controlled-result-evidence-' + mode, timeoutMs, evidenceDirectory,
      async readResult(context) {
        contextAtResult = context;
        context.child.once('exit', () => { childExited = true; });
        await context.waitForOutput(text => text.includes('RESULT') || undefined);
        const result = JSON.parse(bytes);
        if (mode === 'old-inline') {
          // Reproduce a volume stall in the former synchronous write position.
          Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, Math.ceil(remaining() + 100));
          fs.writeFileSync(context.evidenceStem + '.result.json', bytes + '\n');
        } else {
          context.stageResultEvidence(bytes);
        }
        return result;
      },
      requestClose(context) {
        closeRequested = true;
        context.child.stdin.end('CLOSE\n');
      },
    });
  } catch(caught) { error = caught; }
  finally { fs.promises.writeFile = originalWrite; }
  if (error && !error.metadata) throw error;
  const metadata = (error || output).metadata;
  known.push(metadata);
  await ensureGone(metadata);
  const event = name => metadata.events.find(row => row.event === name);
  assert.equal(metadata.timeoutMs, timeoutMs);
  if (mode === 'old-inline') {
    assert.equal(error.code, 'EDGE_RUNNER_TIMEOUT');
    assert.equal(error.phase, 'result');
    assert.equal(metadata.resultReady, undefined, 'A fulfillment queued after the work deadline cannot validate the result');
    assert.equal(Math.round(event('deadline-timeout').deadlineMs), timeoutMs - 1500);
    assert.equal(metadata.status, 'Failed');
    assert.equal(metadata.cleanupSafe, false);
    assert.ok(event('close-requested').elapsedMs > timeoutMs);
  } else {
    assert.ok(evidenceWriteStarted && childExited);
    assert.equal(metadata.cleanupSafe, true);
    assert.equal(metadata.forceTerminated, false);
    assert.ok(event('streams-close').elapsedMs < timeoutMs);
    assert.ok(event('runner-lifecycle-complete').elapsedMs < timeoutMs);
    if (mode === 'write-error') {
      assert.equal(error.code, 'RESULT_EVIDENCE_WRITE_FAILED');
      assert.equal(metadata.status, 'Failed');
      assert.equal(metadata.failure.phase, 'evidence-write');
      assert.deepEqual(metadata.resultEvidenceFailure, { code: 'ENOSPC' });
    } else {
      assert.ifError(error);
      assert.equal(metadata.status, 'Passed');
      assert.deepEqual(output.result, { synthetic: true });
      assert.equal(fs.readFileSync(metadata.resultFile, 'utf8'), bytes + '\n');
      assert.ok(event('runner-final').elapsedMs > timeoutMs, 'Diagnostic writes may complete after the already-verified budget');
    }
  }
  completed.push({ mode: metadata.mode, status: 'Passed', testedStatus: metadata.status, elapsedMs: metadata.elapsedMs,
    finalElapsedMs: event('runner-final').elapsedMs, evidence: metadata.evidenceFile });
  console.log(JSON.stringify(completed.at(-1)));
}

(async()=>{
 let cleanupAllowed=false;
 try {
  if (process.argv.includes('--result-evidence-only')) {
    await runResultEvidenceCase('old-inline');
    await runResultEvidenceCase('delayed-write');
    await runResultEvidenceCase('write-error');
    cleanupAllowed = true;
    return;
  }
  validateParameters();
  await runCase('close-output-eof','PROCESS_OUTPUT_EOF');
  await runCase('close-ack-timeout-after-exit','EDGE_RUNNER_TIMEOUT');
  await runCase('close-final-buffer','passed');
  await runExclusiveReadinessCase();
  await runExclusiveReadinessCase(true);
  await runCase('normal','passed');
  await runCase('invalid-result','INVALID_RESULT');
  await runCase('result-timeout','EDGE_RUNNER_TIMEOUT');
  await runCase('close-timeout','EDGE_RUNNER_TIMEOUT');
  await runCase('probe-close-timeout','EDGE_RUNNER_TIMEOUT');
  await runCase('probe-unverified-timeout','EDGE_RUNNER_TIMEOUT');
  await runCase('nonzero-close','PROCESS_EXIT_NONZERO');
  await runCase('early-exit','PROCESS_EARLY_EXIT');
  await runCase('stream-exit-order','passed');
  await runCase('tracked-child','OWNED_PROCESSES_REMAIN');
  await runCase('late-release','passed');
  await runResultEvidenceCase('delayed-write');
  await runResultEvidenceCase('write-error');
  cleanupAllowed=true;
  console.log(JSON.stringify({suite:'isolated-edge-runner-lifecycle',parameterChecks,actualControlledChildCases:completed.length,passed:completed.length,realEdgeStarted:false,realBrowserAccepted:false}));
 }finally{
  for(const metadata of known)await ensureGone(metadata);
  if(cleanupAllowed){const resolved=path.resolve(root);assert.ok(resolved.startsWith(path.resolve(os.tmpdir())+path.sep)&&path.basename(resolved).startsWith('zhike-edge-runner-test-'));fs.rmSync(resolved,{recursive:true,force:false,maxRetries:20,retryDelay:100})}
  else console.error('Controlled lifecycle failure evidence root retained: '+root);
 }
})().catch(error=>{console.error(error);process.exitCode=1});
