'use strict';
// Real loopback WebSocket IO against the actual CDP connection implementation.
// This controlled peer tests ownership/closure only, never real Edge acceptance.
const assert=require('node:assert/strict');
const http=require('node:http');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {performance}=require('node:perf_hooks');
const {createHash,randomUUID}=require('node:crypto');
const {CdpConnection,observeNavigationResources}=require('./helpers/isolated-edge-runner.cjs');
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const ownedTargetId = 'test-owned-target';
function bounded(promise,deadline,phase){let timer;return Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Object.assign(new Error('Controlled transport deadline: '+phase),{code:'CONTROLLED_TIMEOUT',phase})),Math.max(1,deadline-Date.now()))})]).finally(()=>clearTimeout(timer))}
function frame(opcode,payload=Buffer.alloc(0)){
 const data=Buffer.isBuffer(payload)?payload:Buffer.from(payload);
 assert.ok(data.length<126,'The controlled protocol only sends bounded small messages');
 return Buffer.concat([Buffer.from([0x80|opcode,data.length]),data]);
}
async function controlledPeer(mode){
 const sockets=new Set(),events=[],route='/isolated-'+randomUUID();
 const targetTest = mode.startsWith('target-');
 const destroyTarget = (socket, targetId, sessionId) => {
  events.push(sessionId ? 'session-destroyed-written' : 'destroyed-written:' + targetId);
  socket.write(frame(1, JSON.stringify({method:'Target.targetDestroyed', params:{targetId}, ...(sessionId ? {sessionId} : {})})));
 };
 const server=http.createServer((request,response)=>{response.writeHead(404);response.end()});
 server.on('upgrade',(request,socket)=>{
  if(request.url!==route||!request.headers['sec-websocket-key']){socket.destroy();return}
  sockets.add(socket);socket.on('close',()=>{events.push('server-socket-close');sockets.delete(socket)});
  const accept=createHash('sha1').update(request.headers['sec-websocket-key']+'258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: '+accept+'\r\n\r\n');
  let buffered=Buffer.alloc(0);
  socket.on('data',chunk=>{
   buffered=Buffer.concat([buffered,chunk]);
   while(buffered.length>=2){
    const opcode=buffered[0]&15,masked=!!(buffered[1]&0x80);let length=buffered[1]&127,offset=2;
    if(length===126){if(buffered.length<4)return;length=buffered.readUInt16BE(2);offset=4}
    assert.ok(masked&&length<=4096,'Only bounded masked client frames belong to this fixture');
    if(buffered.length<offset+4+length)return;
    const mask=buffered.subarray(offset,offset+4),payload=Buffer.from(buffered.subarray(offset+4,offset+4+length));
    buffered=buffered.subarray(offset+4+length);for(let index=0;index<payload.length;index++)payload[index]^=mask[index%4];
    if(opcode===8){events.push('client-close-request');if(mode!=='stall-close'&&!socket.writableEnded){socket.write(frame(8,payload));socket.end()}continue}
    if(opcode===9){socket.write(frame(10,payload));continue}
    assert.equal(opcode,1);const request=JSON.parse(payload.toString('utf8'));events.push(request.method);
    if(mode==='premature-disconnect'){socket.destroy();continue}
    if(mode==='work-phase-observation'){
     assert.equal(request.method,'Page.navigate');
     assert.equal(request.sessionId,'owned');
     socket.write(frame(1,JSON.stringify({id:request.id,result:{loaderId:'target',frameId:'top'}})));
     socket.write(frame(1,JSON.stringify({method:'Page.lifecycleEvent',sessionId:'owned',params:{name:'load',loaderId:'previous',frameId:'top'}})));
     continue;
    }
    if (targetTest && request.method === 'Target.closeTarget') {
     assert.deepEqual(request.params, {targetId:ownedTargetId});
     if (mode === 'target-early' || mode === 'target-rejected') destroyTarget(socket, ownedTargetId);
     if (mode === 'target-delayed' || mode === 'target-timeout') {
      destroyTarget(socket, 'unrelated');
      destroyTarget(socket, ownedTargetId, 'unrelated-session');
     }
     socket.write(frame(1, JSON.stringify({id:request.id, result:{success:mode !== 'target-rejected'}})));
     events.push('target-ack-written');
     continue;
    }
    if (targetTest && request.method === 'Target.getTargets') {
     socket.write(frame(1, JSON.stringify({id:request.id, result:{targetInfos:[]}})));
     continue;
    }
    assert.equal(request.method,'Browser.close');
    if(mode==='peer-close'){socket.write(frame(8));socket.end();continue}
    socket.write(frame(1,JSON.stringify({id:request.id,result:{}})));events.push('browser-ack-written');
   }
  });
 });
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve)});
 return {
  url:'ws://127.0.0.1:'+server.address().port+route, events,
  destroyOwnedTarget() { for (const socket of sockets) destroyTarget(socket, ownedTargetId); },
  disconnect() { for (const socket of sockets) socket.destroy(); },
  async close() { this.disconnect(); await new Promise(resolve=>server.close(resolve)); },
 };
}
async function test(mode){
 const peer=await controlledPeer(mode),events=[],failures=[],deadline=Date.now()+1500;
 const context={wait:(promise,phase)=>bounded(promise,deadline,phase),mark:(event,detail={})=>events.push({event,...detail}),fail:error=>failures.push(error)};
 const connection=new CdpConnection(peer.url,context);
 try{
  await connection.opened;
  if(mode==='premature-disconnect'){
   const disconnected=error=>['CDP_DISCONNECTED','CDP_CONNECTION_FAILED'].includes(error.code);
   await assert.rejects(connection.send('Controlled.request'),disconnected);
   assert.ok(failures.some(disconnected),'An unsolicited disconnect must reach the fatal channel');
  }else if(mode==='work-phase-observation'){
   connection.navigationSessionId='owned';
   const response=await connection.work('navigation-response',()=>connection.send('Page.navigate',{},'owned'));
   assert.deepEqual(response,{loaderId:'target',frameId:'top'});
   assert.equal(connection.workPhase,null);
   const load=()=>context.wait(connection.event('Page.lifecycleEvent',value=>value.name==='load'&&value.loaderId===response.loaderId,'owned'),'navigation-load');
   await assert.rejects(connection.work('navigation-load',load),error=>error.code==='CONTROLLED_TIMEOUT'&&error.phase==='navigation-load');
   assert.equal(connection.workPhase,'navigation-load','Record the still-pending phase when the work deadline expires');
   assert.deepEqual(events.filter(row=>row.event.startsWith('cdp-work-')),[
    {event:'cdp-work-started',phase:'navigation-response'},
    {event:'cdp-work-completed',phase:'navigation-response'},
    {event:'cdp-work-started',phase:'navigation-load'},
   ]);
   const request=events.find(row=>row.event==='navigation-request-sent');
   assert.ok(request.commandId>0);
   assert.deepEqual(events.find(row=>row.event==='navigation-response-received'),{
    event:'navigation-response-received',commandId:request.commandId,loaderId:'target',frameId:'top',protocolError:false,navigationError:false,
   });
   assert.deepEqual(events.find(row=>row.event==='navigation-lifecycle-received'),{
    event:'navigation-lifecycle-received',name:'load',loaderId:'previous',frameId:'top',
   });
  }else if(mode==='stall-close'){
   await assert.rejects(connection.closeBrowser(),error=>error.code==='CONTROLLED_TIMEOUT'&&error.phase==='cdp-transport-close');
   assert.ok(peer.events.includes('client-close-request'),'A timeout cannot replace the explicit close request');
   assert.ok(!events.some(row=>row.event==='cdp-transport-closed'),'No close event may be invented after a stalled handshake');
  }else{
   const result=await connection.closeBrowser();
   assert.equal(result.acknowledgement,mode==='peer-close'?'peer-closed-after-request':'protocol-response');
   assert.equal(connection.socket.readyState,WebSocket.CLOSED,'Browser acknowledgement must not leave the owned CDP transport open');
   assert.ok(events.some(row=>row.event==='cdp-transport-closed'),'Return only after the actual transport close event');
   if(mode==='ack-only'){
    const names=events.map(row=>row.event);
    const request=events.find(row=>row.event==='browser-close-request-sent');
    assert.deepEqual(events.find(row=>row.event==='browser-close-response-received'),{
     event:'browser-close-response-received',commandId:request.commandId,protocolError:false,
    });
    assert.ok(names.indexOf('browser-close-acknowledged')<names.indexOf('cdp-transport-close-requested'));
    assert.ok(names.indexOf('cdp-transport-close-requested')<names.indexOf('cdp-transport-closed'));
    assert.ok(peer.events.includes('client-close-request'),'The client actively releases its owned acknowledged connection');
   }
  }
  console.log(JSON.stringify({mode,status:'Passed',actualLoopbackWebSocket:true,realEdgeStarted:false,realBrowserAccepted:false,events:events.map(row=>row.event)}));
 }finally{connection.dispose();await delay(20);await peer.close()}
}
async function testTargetClose(mode) {
 const peer = await controlledPeer(mode), events = [];
 const deadline = Date.now() + 1500;
 let acknowledgeTarget;
 const acknowledged = new Promise(resolve => { acknowledgeTarget = resolve; });
 const context = {
  wait: (promise, phase) => bounded(promise, deadline, phase),
  mark(event) { events.push(event); if (event === 'target-close-acknowledged') acknowledgeTarget(); },
  fail(error) { assert.fail(error); },
 };
 const connection = new CdpConnection(peer.url, context);
 try {
  await connection.opened;
  connection.closing = true;
  let targetReleased = false;
  const closing = connection.closeTarget(ownedTargetId).then(() => {
   targetReleased = true;
   return connection.closeBrowser();
  });
  closing.catch(() => {});
  if (mode === 'target-delayed') {
   await bounded(acknowledged, deadline, 'target-acknowledgement');
   await connection.send('Target.getTargets');
   assert.equal(targetReleased, false, 'The ACK and unrelated destruction events cannot release this target');
   assert.ok(!peer.events.includes('Browser.close'));
   peer.destroyOwnedTarget();
   peer.destroyOwnedTarget();
  } else if (mode === 'target-disconnect') {
   await bounded(acknowledged, deadline, 'target-acknowledgement');
   peer.disconnect();
   await assert.rejects(closing, error => ['CDP_DISCONNECTED', 'CDP_CONNECTION_FAILED'].includes(error.code));
  } else if (mode === 'target-timeout') {
   await assert.rejects(closing, error => error.code === 'CONTROLLED_TIMEOUT' && error.phase === 'target-destroyed');
  } else if (mode === 'target-rejected') {
   await assert.rejects(closing, /exact owned target must acknowledge closure/);
  }
  if (mode === 'target-delayed' || mode === 'target-early') {
   await closing;
   assert.equal(events.filter(event => event === 'target-destroyed-observed').length, 1);
   assert.equal(events.indexOf('target-destroyed-observed') < events.indexOf('target-close-acknowledged'), mode === 'target-early');
   assert.ok(peer.events.indexOf('Browser.close') > peer.events.indexOf('destroyed-written:' + ownedTargetId));
  } else {
   assert.equal(targetReleased, false);
   assert.ok(!peer.events.includes('Browser.close'), 'A failed target release cannot be recorded as a graceful browser close');
  }
  console.log(JSON.stringify({mode, status:'Passed', actualLoopbackWebSocket:true, events}));
 } finally {
  connection.dispose();
  await peer.close();
 }
}
function checkResourceObservation(){
 const connection={},root=path.resolve('synthetic-fixture'),metadata={startedMonotonicMs:performance.now()};
 const stop=observeNavigationResources(connection,{root,metadata});
 const event=(method,params)=>connection.navigationResourceEvent('Network.'+method,params);
 const fixture=pathToFileURL(path.join(root,'fixture.html'));fixture.search='case=unrecorded-value';
 const style=pathToFileURL(path.resolve(__dirname,'../resources/app/styles.css'));
 event('requestWillBeSent',{requestId:'fixture',request:{url:fixture.href,headers:{Authorization:'unrecorded-secret'}}});
 event('responseReceived',{requestId:'fixture',response:{status:200}});
 event('loadingFinished',{requestId:'fixture'});
 event('requestWillBeSent',{requestId:'style',request:{url:style.href}});
 event('requestWillBeSent',{requestId:'non-file',request:{url:'https://example.invalid/unrecorded-path'}});
 event('loadingFailed',{requestId:'non-file',errorText:'net::ERR_BLOCKED_BY_CLIENT'});
 const resources=metadata.navigationResources;
 for(let index=3;index<=resources.limit;index++){
  const requestId='extra-'+index;
  event('requestWillBeSent',{requestId,request:{url:style.href}});
  event('loadingFinished',{requestId});
 }
 stop();
 assert.equal(connection.navigationResourceEvent,undefined);
 assert.equal(resources.pendingCount,1);
 assert.equal(resources.requests.length,resources.limit);
 assert.equal(resources.omitted,1);
 assert.equal(resources.requests[0].resource,'<fixture>/fixture.html');
 assert.equal(resources.requests[0].status,200);
 assert.ok(resources.requests[0].finishedMs>=resources.requests[0].responseMs);
 assert.equal(resources.requests[1].resource,'<app>/styles.css');
 assert.equal(resources.requests[2].resource,'<non-file>');
 assert.equal(resources.requests[2].error,'net::ERR_BLOCKED_BY_CLIENT');
 assert.doesNotMatch(JSON.stringify(resources),/unrecorded-|file:\/\/|https:\/\//);
}
(async () => {
 checkResourceObservation();
 const transportModes = ['ack-only', 'peer-close', 'stall-close', 'premature-disconnect', 'work-phase-observation'];
 const targetModes = ['target-delayed', 'target-early', 'target-timeout', 'target-disconnect', 'target-rejected'];
 for (const mode of transportModes) await test(mode);
 for (const mode of targetModes) await testTargetClose(mode);
 console.log(JSON.stringify({suite:'isolated-edge-transport', passed:transportModes.length + targetModes.length, diagnosticResourceChecks:1, realBrowserAccepted:false}));
})().catch(error=>{console.error(error);process.exitCode=1});
