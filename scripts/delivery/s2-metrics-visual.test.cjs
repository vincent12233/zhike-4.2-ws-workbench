'use strict';
// Full shipped CSS + actual metrics renderer in the selected isolated engine. Synthetic values
// establish style inheritance only; no app boot, database, Worker or WS is used.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { runIsolatedRenderer, recordVisualAssertions } = require('../../tests/helpers/isolated-renderer.cjs');
const charts = require('../../resources/app/modules/metrics-charts.js');
const repo = path.resolve(__dirname,'../..'),app=path.join(repo,'resources/app');
const edge=[process.env.ZHIKE_TEST_EDGE,path.join(process.env['ProgramFiles(x86)']||'','Microsoft/Edge/Application/msedge.exe'),path.join(process.env.ProgramFiles||'','Microsoft/Edge/Application/msedge.exe')].filter(Boolean).find(file=>fs.existsSync(file));
if (process.env.ZHIKE_VISUAL_BACKEND === 'edge' || process.env.ZHIKE_GPT_VISUAL_ONLY === '1') assert.ok(edge,'Actual isolated Edge is required for cross-CSS inheritance');
const index=fs.readFileSync(path.join(app,'index.html'),'utf8');
const expectedStyles=[...index.matchAll(/<link\s+rel="stylesheet"\s+href="\.\/([^"]+)"/g)].map(match=>match[1]);
assert.ok(expectedStyles.length>10&&expectedStyles.at(-1)==='modules/scroll-system.css');
const source=index.replace(/<script\b[^>]*>[\s\S]*?<\/script>/g,'').replace('<head>','<head><base href="'+pathToFileURL(app+path.sep).href+'">');
const contentAnchor=/(<section class="view-container" id="viewContainer">)[\s\S]*?(<\/section>)/;
assert.ok(contentAnchor.test(source),'Use the actual shipped main content anchor');
const options={id:'s2-native-inheritance',title:'SVG 图表继承回归',scopeLabel:'隔离合成数值 · 只测试 CSS，不表示真实业务状态',status:'available'};
const points=Array.from({length:7},(_,index)=>({date:'2026-11-'+String(index+1).padStart(2,'0'),label:'11/'+String(index+1).padStart(2,'0'),customers:index+1,followups:8-index}));
const rendered=charts.renderTrend({...options,points})+charts.renderBars({...options,id:'s2-bar-inheritance',items:[{label:'类别 A',value:2},{label:'类别 B',value:4}]})+charts.renderDistribution({...options,id:'s2-distribution-inheritance',items:[{label:'类别 A',value:2},{label:'类别 B',value:3}]});
function inspect(){
 const params=new URLSearchParams(location.search),palette=params.get('palette');
 document.documentElement.dataset.palette=palette;document.documentElement.dataset.theme=palette==='horizon-night'?'dark':'light';document.documentElement.dataset.view='analytics';
 const chart=document.querySelector('[data-chart-kind="trend"]'),svg=chart.querySelector('.zk-metrics-svg');
 const style=element=>{const value=getComputedStyle(element);return {font:parseFloat(value.fontSize),stroke:value.stroke,strokeWidth:parseFloat(value.strokeWidth),fill:value.fill}};
 const axis=[...document.querySelectorAll('.zk-metrics-svg text')].map(element=>({...style(element),visualFont:parseFloat(getComputedStyle(element).fontSize)*element.closest('svg').getBoundingClientRect().width/element.closest('svg').viewBox.baseVal.width}));
 const point=chart.querySelector('.zk-metrics-point');point.focus();
 const pointFocus={active:document.activeElement===point,visible:point.matches(':focus-visible'),outline:getComputedStyle(point).outlineStyle,outlineWidth:parseFloat(getComputedStyle(point).outlineWidth)};
 const details=chart.querySelector('.zk-metrics-details'),summary=details.querySelector('summary');summary.focus();const summaryReachable=document.activeElement===summary;
 details.open=true;const table=details.querySelector('table'),tableRect=table.getBoundingClientRect();
 const result={viewport:{width:innerWidth,height:innerHeight},palette,styles:[...document.querySelectorAll('link[rel="stylesheet"]')].map(link=>({path:decodeURIComponent(new URL(link.href).pathname).split('/resources/app/')[1],loaded:!!link.sheet})),root:style(svg),axis,lines:[...chart.querySelectorAll('.zk-metrics-line')].map(style),circles:[...chart.querySelectorAll('.zk-metrics-point circle')].map(style),pointFocus,summaryReachable,details:{open:details.open,visible:tableRect.width>0&&tableRect.height>0,rows:table.querySelectorAll('tbody tr').length,caption:!!table.querySelector('caption')},docOverflow:document.documentElement.scrollWidth>innerWidth};
 document.getElementById('result').textContent=JSON.stringify(result);parent.postMessage({kind:'s2-metrics-inheritance',index:Number(params.get('case')),result},'*');
}
function matrix(cases){
 const rows=[],frames=[];
 addEventListener('message',event=>{if(event.data?.kind!=='s2-metrics-inheritance')return;rows[event.data.index]=event.data.result;frames[event.data.index]?.remove();if(rows.filter(Boolean).length===cases.length)document.getElementById('result').textContent=JSON.stringify(rows)});
 cases.forEach((item,index)=>{const frame=document.createElement('iframe');frames[index]=frame;frame.width=item.width;frame.height=item.height;frame.style.cssText='position:absolute;inset:0;border:0;opacity:0;pointer-events:none';frame.src='fixture.html?case='+index+'&palette='+item.palette;document.body.appendChild(frame)});
}
const cases=[{width:1280,height:720,palette:'atelier-dawn'},{width:1920,height:1080,palette:'atelier-dawn'},{width:1280,height:720,palette:'horizon-night'},{width:1920,height:1080,palette:'horizon-night'}];
const root=fs.mkdtempSync(path.join(os.tmpdir(),'zhike-s2-metrics-style-'));let cleanupSafe=true;
(async()=>{try{
 const html=source.replace(contentAnchor,(_,open,close)=>open+'<section class="panel">'+rendered+'</section>'+close).replace('</body>','<pre id="result" hidden></pre><script>('+inspect.toString()+')();</script></body>');
 fs.writeFileSync(path.join(root,'fixture.html'),html);
 fs.writeFileSync(path.join(root,'matrix.html'),'<!doctype html><meta charset="utf-8"><pre id="result" hidden></pre><script>('+matrix.toString()+')('+JSON.stringify(cases)+');</script>');
 const {results,metadata}=await runIsolatedRenderer({edge,root,url:pathToFileURL(path.join(root,'matrix.html')).href,expectedViewports:cases.map(({width,height})=>({width,height})),evidenceDirectory:path.join(repo,'.tools/delivery-s2-metrics-visual')});
 if(metadata.mode==='real-webview2-synthetic-layout'){
  assert.ok(metadata.identities.some(identity=>identity.pid===metadata.browserPid&&identity.startedTicks),'The actual Core browser has a verified process identity');
  const events=metadata.events.map(event=>event.event);
  let prior=-1;
  for(const name of ['webview-core-ready','result-verified','result-ready','close-requested','webview-close-requested','webview-browser-exited','process-exit','streams-close']){
   const index=events.indexOf(name);assert.ok(index>prior&&index===events.lastIndexOf(name),'Native lifecycle order: '+name);prior=index;
  }
  assert.ok(metadata.events.some(event=>event.event==='webview-browser-exited'&&event.normal===true&&event.browserPid===metadata.browserPid));
 }else{
  assert.equal(metadata.resourceReleaseOrder,'owned-session-target-browser');
  assert.deepEqual(metadata.events.filter(event=>/^owned-/.test(event.event)).map(event=>event.event),['owned-target-created','owned-session-attached','owned-session-detached','owned-target-close-confirmed','owned-browser-close-requested'],'Actual CDP page resources are created, detached and closed exactly once in ownership order');
 }
 assert.ok(metadata.identities.some(identity=>identity.pid===metadata.pid&&identity.startedTicks),'Lifecycle evidence must identify the exact spawned browser');
 assert.equal(metadata.forceTerminated,false);assert.equal(metadata.exit.code,0);assert.equal(metadata.streamsClosed,true);assert.equal(metadata.cleanupSafe,true);
 for(const [index,result]of results.entries()){
  assert.equal(result.palette,cases[index].palette);
  assert.deepEqual(result.styles.map(row=>row.path),expectedStyles,'The full shipped stylesheet order participates');
  assert.ok(result.styles.every(row=>row.loaded),'Every production stylesheet actually loaded');
  assert.equal(result.root.stroke,'none','The new chart resets the global SVG icon stroke');
  assert.ok(result.axis.length>=8,'Real trend axes and bar labels must be present');
  for(const axis of result.axis){assert.ok(axis.font>=14&&axis.visualFont>=14,'Axis labels must remain readable at both widths');assert.equal(axis.stroke,'none','Axis text must never inherit the global icon stroke');}
  assert.equal(result.lines.length,2);assert.ok(result.lines.every(line=>line.stroke!=='none'&&line.strokeWidth>=2.5),'Series retain their own explicit stroke');
  assert.equal(result.circles.length,14);assert.ok(result.circles.every(circle=>circle.stroke!=='none'&&circle.strokeWidth>=2),'Data points retain their own explicit stroke');
  assert.equal(result.pointFocus.active,true);assert.equal(result.pointFocus.visible,true);assert.equal(result.pointFocus.outline,'solid');assert.ok(result.pointFocus.outlineWidth>=2);
  assert.equal(result.summaryReachable,true);assert.equal(result.details.open,true);assert.equal(result.details.visible,true);assert.equal(result.details.rows,7);assert.equal(result.details.caption,true);
  assert.equal(result.docOverflow,false,'Only the chart plot owns narrow horizontal overflow');
  console.log(JSON.stringify({palette:result.palette,viewport:result.viewport,axisLabels:result.axis.length,stroke:result.root.stroke,keyboardPoint:true,detailsRows:7,docOverflow:false}));
 }
 recordVisualAssertions(metadata);
 console.log(JSON.stringify({suite:'delivery-s2-metrics-real-css-inheritance',cases:results.length,passed:results.length,browserLifecycle:metadata.status,pid:metadata.pid,exit:metadata.exit,streamsClosed:metadata.streamsClosed,cleanupSafe:metadata.cleanupSafe,realBusinessData:false,realWhatsApp:false,realAi:false}));
}catch(error){cleanupSafe=false;throw error}finally{
 const resolved=path.resolve(root);assert.ok(resolved.startsWith(path.resolve(os.tmpdir())+path.sep)&&path.basename(resolved).startsWith('zhike-s2-metrics-style-'));
 if(cleanupSafe)fs.rmSync(resolved,{recursive:true,force:false,maxRetries:20,retryDelay:100});else console.error('Unverified isolated resources retained: '+resolved);
}})().catch(error=>{console.error(error);process.exitCode=1});
