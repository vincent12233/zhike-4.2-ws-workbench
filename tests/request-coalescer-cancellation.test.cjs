'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const repo=path.resolve(__dirname,'..');
const source=fs.readFileSync(path.join(repo,'resources/app/modules/desktop-performance.js'),'utf8');
const listeners=new Map();
const context={
  window:{fetch:null},
  document:{hidden:false,addEventListener(){},removeEventListener(){}},
  globalThis:{performance:{now:()=>0},dispatchEvent(){}},
  CustomEvent:class{},
  Promise,
  Response,
  AbortController,
  setTimeout,
  clearTimeout,
};
vm.runInNewContext(source,context);
const coalescer=context.window.ZhikeDesktopPerformance.requestCoalescer;
let release;
const pending=new Promise(resolve=>{release=resolve;});
const controller=new AbortController();
const first=coalescer('cancel-key',()=>pending,controller.signal);
controller.abort();
assert.rejects(first,/AbortError|aborted/i,'aborted caller must reject even while shared request continues');
release({ok:true});
(async()=>{
  await assert.rejects(first,/AbortError|aborted/i);
  const value=await coalescer('next',()=>Promise.resolve({ok:true}));
  assert.equal(value.ok,true);
  console.log('request coalescer cancellation: caller abort does not cancel or await shared read');
})().catch(error=>{console.error(error);process.exitCode=1;});
