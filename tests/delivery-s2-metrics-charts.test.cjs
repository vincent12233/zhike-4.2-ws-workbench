'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const sourcePath = path.resolve(__dirname, '../resources/app/modules/metrics-charts.js');
const charts = require(sourcePath);
let passed = 0;
function test(name, body) { body(); passed++; console.log('[PASS] '+name); }
const rows = html => (html.match(/<tr\b/g)||[]).length - (html.includes('<thead>') ? 1 : 0);
const positiveRects = html => [...html.matchAll(/<rect\b[^>]*\bwidth="([\d.]+)"[^>]*\bdata-value="([\d.]+)"/g)].filter(match=>Number(match[1])>0&&Number(match[2])===0);
const base = {id:'metrics-test',title:'真实业务投影',scopeLabel:'当前工作区 · 已读取范围',status:'available'};
test('UMD browser export is frozen and never touches service/timer/observer/business state', () => {
 const fail=()=>{throw new Error('Forbidden runtime side effect')};
 const window={fetch:fail};Object.defineProperty(window,'state',{get:fail});
 const sandbox={window,fetch:fail,setTimeout:fail,setInterval:fail,MutationObserver:fail,ResizeObserver:fail};
 vm.runInNewContext(fs.readFileSync(sourcePath,'utf8'),sandbox,{filename:'metrics-charts.js'});
 assert.ok(Object.isFrozen(window.ZhikeMetricsCharts));
 assert.equal(typeof window.ZhikeMetricsCharts.renderTrend,'function');
 assert.ok(window.ZhikeMetricsCharts.renderTrend({...base,points:[{date:'2026-11-01',customers:1,followups:2}]}).includes('<svg'));
});
test('trend consumes both actual series and exposes title, scope, legend, keyboard points and table', () => {
 const points=Object.freeze([Object.freeze({date:'2026-11-01',label:'11/01',customers:2,followups:4}),Object.freeze({date:'2026-11-02',label:'11/02',customers:3,followups:6})]);
 const html=charts.renderTrend({...base,points,notes:['截至当前读取时间']});
 assert.match(html,/<svg\b/);assert.match(html,/客户数/);assert.match(html,/跟进数/);assert.match(html,/当前工作区/);
 assert.match(html,/tabindex="0"/);assert.match(html,/aria-label=/);assert.match(html,/<title>/);assert.match(html,/<table\b/);assert.match(html,/<caption>/);
 assert.match(html,/11\/01/);assert.match(html,/>2<\/td>/);assert.match(html,/>6<\/td>/);assert.equal(rows(html),2);
});
test('missing series values break their lines and are never converted to zero', () => {
 const html=charts.renderTrend({...base,points:[{label:'A',customers:1,followups:2},{label:'B',customers:null,followups:3},{label:'C',customers:4,followups:5}]});
 assert.equal((html.match(/<path\b[^>]*data-series="customers"/g)||[]).length,0);
 assert.equal((html.match(/<path\b[^>]*data-series="followups"/g)||[]).length,1);
 assert.match(html,/未提供/);assert.match(html,/>—<\/td>/);
});
test('zero and entirely unknown trend data do not fabricate a positive chart', () => {
 const zero=charts.renderTrend({...base,points:[{label:'A',customers:0,followups:0}]});
 assert.doesNotMatch(zero,/<svg\b/);assert.match(zero,/均为 0/);assert.match(zero,/>0<\/td>/);
 const unknown=charts.renderTrend({...base,points:[{label:'A',customers:false,followups:'7'},{label:'B',customers:Infinity,followups:-1}]});
 assert.doesNotMatch(unknown,/<svg\b/);assert.match(unknown,/未提供/);
});
test('all external strings and ids are escaped; colors cannot inject SVG/HTML', () => {
 const attack='"><script>alert(1)</script><img src=x onerror=alert(2)>';
 for(const method of ['renderTrend','renderBars','renderDistribution','renderProgress']){
  const html=charts[method]({...base,id:attack,title:attack,scopeLabel:attack,notes:[attack],color:'url(javascript:alert(3))',points:[{label:attack,customers:1,followups:2}],items:[{label:attack,value:1,color:attack}],current:1,total:2});
  assert.doesNotMatch(html,/<script\b|<img\b|javascript:/);
  const tagAttributes=(html.match(/<[^>]+>/g)||[]).map(tag=>tag.replace(/"[^"]*"/g,'""')).join('');
  assert.doesNotMatch(tagAttributes,/\son(?:error|load|click)\s*=/,'Event-handler attributes must not escape quoted accessible labels');
  assert.match(html,/&lt;script&gt;/);assert.match(html,/id="metrics-[a-z0-9_-]+"/);
 }
});
test('large trends bound chart and table to 120 samples, retain endpoints and disclose sampling', () => {
 let numericReads=0;
 const points=Array.from({length:10000},(_,index)=>Object.freeze({label:'记录 '+index,get customers(){numericReads++;return index},get followups(){numericReads++;return index+1}}));
 const html=charts.renderTrend({...base,points});
 assert.ok(rows(html)<=120);assert.ok((html.match(/class="zk-metrics-point"/g)||[]).length<=240);
 assert.match(html,/120 \/ 10000/);assert.match(html,/记录 0/);assert.match(html,/记录 9999/);assert.match(html,/不连线/);
 assert.doesNotMatch(html,/<path\b[^>]*data-series=/);assert.ok(numericReads<=240,'Only sampled immutable projected values are read');
 assert.ok(html.length<180000);
});
test('loading, error and explicit empty hide stale geometry with honest accessible status', () => {
 for(const status of ['loading','error','empty']){
  const html=charts.renderTrend({...base,status,points:[{label:'A',customers:50,followups:60}]});
  assert.doesNotMatch(html,/<svg\b/);assert.match(html,status==='error'?/role="alert"/:/role="status"/);
  assert.ok(!html.includes('>50</td>'),'Stale points cannot masquerade as a loaded result');
 }
});
test('bar values remain raw; zero/unknown rows never draw positive length and input is immutable', () => {
 const items=Object.freeze([Object.freeze({label:'零',value:0}),Object.freeze({label:'有效',value:12}),Object.freeze({label:'未知',value:false}),Object.freeze({label:'字符串',value:'99'})]);
 const html=charts.renderBars({...base,items});
 assert.match(html,/>12<\/td>/);assert.match(html,/>0<\/td>/);assert.match(html,/未提供/);assert.equal(positiveRects(html).length,0);assert.equal(rows(html),4);
 assert.equal((html.match(/<rect\b[^>]*data-value=/g)||[]).length,1);
});
test('empty bar denominator and unsafe/nonfinite values draw no graph', () => {
 for(const values of [[0,0],[null,NaN,false,'3',Infinity,-1,Number.MAX_SAFE_INTEGER+1]]){
  const html=charts.renderBars({...base,items:values.map((value,index)=>({label:'类'+index,value}))});
  assert.doesNotMatch(html,/<svg\b/);assert.doesNotMatch(html,/\bNaN\b|\bInfinity\b/);
 }
});
test('complete distribution shows genuine shares and a zero denominator has no fake percent', () => {
 const html=charts.renderDistribution({...base,items:[{label:'A',value:2},{label:'B',value:3}]});
 assert.match(html,/40%/);assert.match(html,/60%/);assert.match(html,/<svg\b/);
 const zero=charts.renderDistribution({...base,items:[{label:'A',value:0}]});
 assert.doesNotMatch(zero,/<svg\b|data-percent=|0%/);assert.match(zero,/合计为 0/);
});
test('partial/missing distribution never treats unknown as zero or claims a full-population share', () => {
 const missing=charts.renderDistribution({...base,items:[{label:'有效',value:2},{label:'未知',value:null}]});
 assert.match(missing,/未计算占比/);assert.doesNotMatch(missing,/data-percent=|100%/);assert.match(missing,/未提供/);
 const html=charts.renderDistribution({...base,items:Array.from({length:1000},(_,i)=>({label:'类'+i,value:i+1}))});
 assert.ok(rows(html)<=40);assert.match(html,/40 \/ 1000/);assert.match(html,/未计算占比/);assert.doesNotMatch(html,/data-percent=/);assert.ok(html.length<70000);
});
test('progress only calculates against a valid positive denominator and retains actual fraction', () => {
 const html=charts.renderProgress({...base,current:2,total:5});
 assert.match(html,/role="progressbar"/);assert.match(html,/aria-valuenow="40"/);assert.match(html,/40%/);assert.match(html,/2 \/ 5/);
 const zero=charts.renderProgress({...base,current:0,total:5});
 assert.match(zero,/aria-valuenow="0"/);assert.match(zero,/0%/);assert.equal(positiveRects(zero).length,0);
 for(const [current,total]of[[0,0],[null,10],[false,10],[1,'5'],[Infinity,10],[-1,10],[6,5],[1,null]]){
  const unknown=charts.renderProgress({...base,current,total});
  assert.doesNotMatch(unknown,/role="progressbar"|aria-valuenow=|data-percent=/);assert.match(unknown,/无法计算进度/);
 }
});
test('invalid status fails closed and no renderer changes caller data or business formulas', () => {
 const input=Object.freeze({...base,status:'pretend-live',points:Object.freeze([{label:'A',customers:3,followups:4}])});
 assert.doesNotMatch(charts.renderTrend(input),/<svg\b/);assert.match(charts.renderTrend(input),/role="alert"/);
 assert.equal(input.points[0].customers,3);
});
test('invalid caller objects and empty inputs are explicit, without zero totals being invented', () => {
 for(const method of ['renderTrend','renderBars','renderDistribution','renderProgress']){
  assert.match(charts[method](null),/role="alert"/);
  assert.doesNotMatch(charts[method](false),/<svg\b/);
 }
 const empty=charts.renderDistribution({...base,items:[]});
 assert.doesNotMatch(empty,/合计为 0|0%|<svg\b/);assert.match(empty,/暂无分布数据/);
});
test('large and tiny valid numbers remain finite and presentation does not claim 0 or completion prematurely', () => {
 const large=charts.renderTrend({...base,points:[{date:'2026-11-01',customers:Number.MAX_SAFE_INTEGER,followups:1}]});
 assert.match(large,/<svg\b/);assert.doesNotMatch(large,/NaN|Infinity/);
 const tiny=charts.renderProgress({...base,current:1,total:1000000000000000});
 assert.match(tiny,/小于0\.1%/);assert.ok(Number(tiny.match(/aria-valuenow="([^"]+)"/)[1])>0);
 const nearly=charts.renderProgress({...base,current:9999,total:10000});
 assert.match(nearly,/>99\.9%</);assert.doesNotMatch(nearly,/>100%</);
});
console.log(JSON.stringify({suite:'delivery-s2-metrics-charts',checks:passed,passed,network:false,timers:false,realAi:false,realWhatsApp:false}));
