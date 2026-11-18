'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { runIsolatedRenderer } = require('../../tests/helpers/isolated-renderer.cjs');
const { renderWsWorkbenchFixture } = require('../../tests/helpers/ws-workbench-render-fixture.cjs');
const repo = path.resolve(__dirname, '../..');
const edge = [process.env.ZHIKE_TEST_EDGE, path.join(process.env['ProgramFiles(x86)'] || '', 'Microsoft/Edge/Application/msedge.exe'), path.join(process.env.ProgramFiles || '', 'Microsoft/Edge/Application/msedge.exe')].filter(Boolean).find(file => fs.existsSync(file));
if (process.env.ZHIKE_VISUAL_BACKEND === 'edge' || process.env.ZHIKE_GPT_VISUAL_ONLY === '1') assert.ok(edge, 'A real Edge browser is required; layout acceptance cannot be replaced by a CSS string assertion.');
const tempParent = path.resolve(os.tmpdir()), root = fs.mkdtempSync(path.join(tempParent, 'zhike-stage51-layout-'));
// Production stylesheet order and complete production render() markup are
// both required. Simplified fixtures previously omitted chrome wrappers.
const index = fs.readFileSync(path.join(repo, 'resources/app/index.html'), 'utf8');
const css = [...index.matchAll(/<link\s+rel="stylesheet"\s+href="\.\/([^"]+)"/g)].map(match => fs.readFileSync(path.join(repo, 'resources/app', match[1]), 'utf8')).join('\n');
const wsSource = fs.readFileSync(path.join(repo, 'resources/app/modules/ws-workbench.js'), 'utf8');
const mountStart = wsSource.indexOf('  function syncWorkbenchAttributes('), mountEnd = wsSource.indexOf('  function render(options = {})', mountStart);
assert.ok(mountStart >= 0 && mountEnd > mountStart, 'Use production incremental mount helpers for DOM identity checks');
const mountHelpers = wsSource.slice(mountStart, mountEnd);
const groupCatalog = Array.from({ length:30 }, (_, i) => ({ accountId:'default', groupJid:'layout-'+i+'@g.us', groupName:'布局验收群组 '+(i+1), participantCount:42, permissions:'所有成员', collectionStatus:'已同步', lastSyncAt:'2026-11-16T10:00:00Z' }));
const base = { assistOpen:true, groupCatalog, groupMonitor:{lastLoadedAt:'2026-11-16T10:00:00Z'}, backgroundActive:true };
const fixtures = {
  groups:renderWsWorkbenchFixture({...base,view:'groups'}),
  groupsDetail:renderWsWorkbenchFixture({...base,view:'groups',detailGroupId:'layout-0@g.us'}),
  groupsExpanded:renderWsWorkbenchFixture({...base,view:'groups',monitorDetailsOpen:true}),
  chat:renderWsWorkbenchFixture({...base,view:'chat'}),
  home:renderWsWorkbenchFixture({...base,view:'overview'}),
  tasks:renderWsWorkbenchFixture({...base,view:'tasks'}),
  collection:renderWsWorkbenchFixture({...base,view:'collection'}),
  tools:renderWsWorkbenchFixture({...base,view:'chat',manualToolsVisible:true,localPanelsCollapsed:false,captureCollapsed:true}),
};
for (const markup of Object.values(fixtures)) {
  assert.ok(markup.includes('ws-command-rail') && markup.includes('ws-process-rail'), 'Complete production fixtures must include the legacy chrome that caused the real WinUI regression');
}
const html = `<!doctype html><html lang="zh-CN" data-theme="dark" data-palette="horizon-night" data-view="ws-workbench" data-desktop-host="webview2"><meta charset="utf-8"><style>${css}</style><style>html,body{margin:0}#fixture{height:100vh;width:100%}</style><body class="ws-mode ws-workspace-active"><div id="fixture">${fixtures.groups}</div><pre id="result" hidden></pre><script>
${mountHelpers}
const fixtures=${JSON.stringify(fixtures)},target=document.getElementById('fixture');
const rect=e=>{const r=e.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height,bottom:r.bottom}};
const type=e=>{const s=getComputedStyle(e);return{font:s.fontSize,display:s.display,overscroll:s.overscrollBehaviorY}};
const chrome=()=>[...target.querySelector('.ws-workbench-page').children].filter(e=>e.matches('.ws-command-rail,.ws-process-rail')).map(e=>({display:getComputedStyle(e).display,height:rect(e).height}));
const page=target.querySelector('.ws-workbench-page'),nav=target.querySelector('.ws-workspace-nav'),content=target.querySelector('[data-ws-workspace-page="groups"]');
const navList=nav.querySelector('.ws-workspace-nav-list');
const navOverflow=getComputedStyle(navList).overflowY,navScrollable=navList.scrollHeight>navList.clientHeight;
navList.scrollTop=navList.scrollHeight;
const navScrollOffset=navList.scrollTop,navReachable=rect(navList.lastElementChild).bottom<=rect(navList).bottom+1;
navList.scrollTop=0;
const expanded={nav:rect(nav),content:rect(content),type:type(content),title:type(content.querySelector('h2')),navType:type(nav.querySelector('.ws-workspace-nav-copy strong')),button:rect(content.querySelector('[data-ws-action="refresh-workspace-page"]')),input:rect(content.querySelector('input[type="search"]')),tableType:type(content.querySelector('td')),row:rect(content.querySelector('tbody tr')),scrollable:content.scrollHeight>content.clientHeight,overflow:document.documentElement.scrollWidth>innerWidth,navOverflow,navScrollable,navScrollOffset,navReachable,chrome:chrome(),primary:getComputedStyle(content.querySelector('.btn.primary')||content.querySelector('.btn')).backgroundImage};
nav.classList.add('is-collapsed');const collapsed={nav:rect(nav),content:rect(content)};nav.classList.remove('is-collapsed');
const monitor=content.querySelector('.ws-group-details'),monitorCollapsed=rect(monitor).height;const monitorTemplate=document.createElement('template');monitorTemplate.innerHTML=fixtures.groupsExpanded;const populatedMonitor=monitorTemplate.content.querySelector('.ws-group-details');monitor.replaceWith(populatedMonitor);populatedMonitor.open=true;const monitorExpanded=rect(populatedMonitor).height;populatedMonitor.open=false;
const initialHost=target.querySelector('#wsBrowserHost'),closedGroupMain=rect(content.querySelector('.ws-group-directory-main'));mountWsWorkbenchShell(target,fixtures.groupsDetail);const detailPanel=target.querySelector('.ws-group-detail-panel'),detailMain=target.querySelector('.ws-group-directory-main');const groupDetail={main:rect(detailMain),panel:rect(detailPanel),position:getComputedStyle(detailPanel).position,close:rect(detailPanel.querySelector('button')),overflow:document.documentElement.scrollWidth>innerWidth};mountWsWorkbenchShell(target,fixtures.groups);const groupDetailClosed={main:rect(target.querySelector('.ws-group-directory-main')),panelCount:target.querySelectorAll('.ws-group-detail-panel').length};mountWsWorkbenchShell(target,fixtures.chat);
const browser=target.querySelector('#wsBrowserHost'),chatPage=target.querySelector('.ws-workbench-page');
const frontChat={browser:rect(browser),title:type(chatPage.querySelector('h1')),sessions:type(chatPage.querySelector('.ws-sessions-panel')),local:type(chatPage.querySelector('.ws-local-workspace')),runtime:type(chatPage.querySelector('.ws-runtime-strip')),crm:rect(chatPage.querySelector('.ws-assist-panel')),body:type(chatPage.querySelector('.ws-assist-drawer-body')),button:rect(chatPage.querySelector('.ws-toolbar-actions .btn')),overflow:document.documentElement.scrollWidth>innerWidth,chrome:chrome(),primary:getComputedStyle(chatPage.querySelector('.ws-toolbar-actions .btn.primary')).backgroundImage,toolbar:rect(chatPage.querySelector('.ws-login-toolbar')),backgroundPill:type(chatPage.querySelector('.ws-chat-background-status'))};
const before=rect(browser);chatPage.querySelector('.ws-runtime-strip').textContent='周期更新'+ '9'.repeat(80);const after=rect(browser);const stable=before.width===after.width&&before.height===after.height&&before.y===after.y;
// Resolve the current shared fill in the real browser. The fixture carries the
// same palette hook as production so a WS fallback or competing override cannot
// satisfy the comparison using legacy literals or a missing custom property.
const accentReference=document.createElement('div');accentReference.style.backgroundImage='var(--ds-primary-fill)';document.body.appendChild(accentReference);const expectedPrimary=getComputedStyle(accentReference).backgroundImage;accentReference.remove();
const layout=chatPage.querySelector('.ws-layout'),assist=chatPage.querySelector('.ws-assist-panel');layout.classList.replace('assist-open','assist-closed');assist.classList.replace('is-open','is-closed');const closedChat=rect(browser);layout.classList.replace('assist-closed','assist-open');assist.classList.replace('is-closed','is-open');
mountWsWorkbenchShell(target,fixtures.tools);const localWorkspace=target.querySelector('.ws-local-workspace'),localButton=localWorkspace.querySelector('.ws-capture-heading-actions .btn');const localTools={display:getComputedStyle(localWorkspace).display,overflow:getComputedStyle(localWorkspace).overflowY,button:rect(localButton),font:type(localButton).font};
mountWsWorkbenchShell(target,fixtures.home);const home={chrome:chrome(),primary:getComputedStyle(target.querySelector('.ws-workspace-welcome .btn.primary')).backgroundImage};const sameWhileHidden=target.querySelector('#wsBrowserHost')===browser&&browser.isConnected;
mountWsWorkbenchShell(target,fixtures.tasks);const taskFlow=target.querySelector('[data-ws-workspace-page="tasks"]>.ws-process-rail');const tasks={chrome:chrome(),flow:taskFlow?type(taskFlow):null,flowRect:taskFlow?rect(taskFlow):null,statsCount:target.querySelectorAll('[data-ws-workspace-page="tasks"] .ws-workspace-metrics>div').length};
mountWsWorkbenchShell(target,fixtures.collection);const collectionFlow=target.querySelector('[data-ws-workspace-page="collection"] .ws-process-rail');const collection={chrome:chrome(),nestedFlow:type(collectionFlow),flowRect:rect(collectionFlow),stripRect:rect(collectionFlow.querySelector('.ws-flow-strip'))};
mountWsWorkbenchShell(target,fixtures.chat);const sameAfterReturn=target.querySelector('#wsBrowserHost')===browser&&browser.isConnected&&browser===initialHost;
const payload={viewport:{width:innerWidth,height:innerHeight},media:{compact:matchMedia('(max-width:1439px)').matches,narrow:matchMedia('(max-width:1199px)').matches},expanded,collapsed,monitorCollapsed,monitorExpanded,closedGroupMain,groupDetail,groupDetailClosed,frontChat,closedChat,localTools,home,tasks,collection,stable,sameWhileHidden,sameAfterReturn,expectedPrimary};document.getElementById('result').textContent=JSON.stringify(payload);parent.postMessage({kind:'ws-layout',index:Number(new URLSearchParams(location.search).get('case')),payload},'*');
</script></body></html>`;
fs.writeFileSync(path.join(root, 'layout.html'), html);
const cases = [[1920,1080,1],[1920,1080,1.25],[1920,1080,1.5],[2560,1440,1],[2560,1440,1.25],[2560,1440,1.5]].filter(item => !process.env.ZHIKE_LAYOUT_CASE || item[0]+'-'+item[2] === process.env.ZHIKE_LAYOUT_CASE);
assert.ok(cases.length, 'ZHIKE_LAYOUT_CASE must identify an existing physical-width/scale pair');
// Fixed child CSS viewports avoid six browser startups and non-client frame
// offsets. This is a CSS layout model, not native Windows monitor/DPI proof.
const matrixFile = path.join(root, 'matrix.html');
fs.writeFileSync(matrixFile, `<!doctype html><meta charset="utf-8"><style>html,body{margin:0;overflow:hidden}iframe{position:absolute;inset:0;border:0;opacity:0;pointer-events:none}</style><pre id="result" hidden></pre><script>const cases=${JSON.stringify(cases)},results=[],viewportFrames=[];window.addEventListener('message',event=>{if(event.data?.kind!=='ws-layout')return;results[event.data.index]=event.data.payload;viewportFrames[event.data.index]?.remove();if(results.filter(Boolean).length===cases.length)document.getElementById('result').textContent=JSON.stringify(results)});cases.forEach((item,index)=>{const frame=document.createElement('iframe');viewportFrames[index]=frame;frame.style.width=Math.round(item[0]/item[2])+'px';frame.style.height=Math.round(item[1]/item[2])+'px';frame.src='layout.html?case='+index;document.body.appendChild(frame)});</script>`);
let cleanupSafe = true;
(async () => { try {
  const { results, metadata } = await runIsolatedRenderer({ edge, root, url: pathToFileURL(matrixFile).href, expectedViewports: cases.map(([width,height,scale]) => ({width:Math.round(width/scale),height:Math.round(height/scale)})), evidenceDirectory: path.join(repo,'.tools/delivery-s1-edge-layout') });
  console.log(JSON.stringify({browserLifecycle:metadata.status,pid:metadata.pid,mode:metadata.mode,exit:metadata.exit,streamsClosed:metadata.streamsClosed,cleanupSafe:metadata.cleanupSafe,evidence:metadata.evidenceFile}));
  for (const [caseIndex,[physicalWidth,physicalHeight,scale]] of cases.entries()) {
    const width=Math.round(physicalWidth/scale),height=Math.round(physicalHeight/scale),result=results[caseIndex];
    assert.deepEqual(result.viewport,{width,height});assert.equal(result.media.compact,width<=1439);assert.equal(result.media.narrow,width<=1199);
    assert.equal(result.expanded.nav.width,250);assert.equal(result.collapsed.nav.width,76);assert.equal(result.collapsed.content.width-result.expanded.content.width,174);
    assert.equal(result.expanded.type.font,'14px');assert.equal(result.expanded.title.font,'20px','V4.1 WS workspace page title');assert.equal(result.expanded.navType.font,'14px');assert.equal(result.expanded.tableType.font,'14px');
    assert.ok(result.expanded.row.height>=52);assert.ok(result.expanded.button.height>=44&&result.expanded.input.height>=44);assert.equal(result.expanded.type.overscroll,'contain');assert.equal(result.expanded.scrollable,true);assert.equal(result.expanded.overflow,false);assert.equal(result.expanded.navReachable,true);
    assert.equal(result.expanded.navOverflow,'auto','WS navigation owns vertical scroll when its content overflows');
    if(result.expanded.navScrollable)assert.ok(result.expanded.navScrollOffset>0,'Overflowing WS navigation can scroll to its last item');
    assert.ok(result.monitorCollapsed<=80&&result.monitorExpanded-result.monitorCollapsed>=40,'Collapsed actual monitor details release vertical space');
    assert.equal(result.groupDetail.position,'static','Group details retain their own grid column instead of overlay positioning');assert.equal(result.groupDetail.overflow,false);assert.ok(result.groupDetail.close.height>=44);assert.equal(result.groupDetailClosed.panelCount,0);assert.equal(result.groupDetailClosed.main.width,result.closedGroupMain.width,'Closing group details restores the full table width');
    if(width>=1440){assert.equal(result.groupDetail.panel.width,340);assert.equal(result.groupDetail.panel.y,result.groupDetail.main.y,'Wide group details align beside the table');assert.ok(result.groupDetail.panel.x>=result.groupDetail.main.x+result.groupDetail.main.width+19);assert.equal(result.groupDetailClosed.main.width-result.groupDetail.main.width,360,'The close action releases the full right detail column and gap')}else{assert.equal(result.groupDetail.panel.width,result.groupDetail.main.width);assert.ok(result.groupDetail.panel.y>=result.groupDetail.main.bottom,'Narrow group details stack below the table without covering it')}
    for(const state of [result.expanded,result.frontChat,result.home,result.tasks,result.collection]){assert.equal(state.chrome.length,2,'Actual production legacy wrappers must remain represented in the test');for(const rail of state.chrome){assert.equal(rail.display,'none','Direct legacy cockpit/process wrappers cannot consume page height');assert.equal(rail.height,0)}}
    assert.ok(result.tasks.flow===null||(result.tasks.flow.display==='none'&&result.tasks.flowRect.height===0),'Tasks must omit or hide the entire duplicate process wrapper');assert.equal(result.tasks.statsCount,3,'Tasks retain their real statistics cards');
    assert.notEqual(result.collection.nestedFlow.display,'none','Collection retains its own nested process projection');
    assert.ok(result.collection.stripRect.height>=100&&result.collection.flowRect.height>=result.collection.stripRect.height,'Collection process wrappers must contain the entire flow instead of clipping it to a legacy 68px band');
    assert.match(result.expectedPrimary,/^linear-gradient\(/,'The actual palette must expose the shared primary fill; a missing token cannot pass as none');
    for(const primary of [result.frontChat.primary,result.home.primary])assert.equal(primary,result.expectedPrimary,'Primary controls use the exact current shared DS gradient despite later Horizon important rules');
    assert.equal(result.frontChat.title.font,'20px','V4.1 WS chat page title');assert.equal(result.frontChat.sessions.display,'none');assert.equal(result.frontChat.local.display,'none');assert.equal(result.frontChat.runtime.display,'none');assert.equal(result.frontChat.body.overscroll,'contain');assert.equal(result.frontChat.backgroundPill.display,'flex');
    assert.ok(result.frontChat.browser.width>=560&&result.frontChat.browser.height>=380,'Full real-render chrome must leave a usable native chat region');assert.ok(result.frontChat.browser.height>=height-220,'Legacy chrome must not steal native chat height');
    assert.ok(result.frontChat.browser.bottom<=height&&result.frontChat.crm.bottom<=height);assert.ok(result.frontChat.crm.width>=340&&result.frontChat.crm.width<=380);assert.ok(result.frontChat.browser.x+result.frontChat.browser.width<=result.frontChat.crm.x);assert.equal(result.closedChat.width-result.frontChat.browser.width,result.frontChat.crm.width-52);
    assert.ok(result.frontChat.button.height>=44);assert.ok(result.frontChat.toolbar.height<=68,'Native actions occupy one stable command row');assert.equal(result.frontChat.overflow,false);assert.equal(result.stable,true);
    assert.equal(result.localTools.display,'flex');assert.equal(result.localTools.overflow,'auto');assert.ok(result.localTools.button.height>=44);assert.equal(result.localTools.font,'14px');assert.equal(result.sameWhileHidden,true);assert.equal(result.sameAfterReturn,true);
    console.log(JSON.stringify({browser:metadata.mode+'; complete production render; CSS viewport model, not native Windows DPI',physical:[physicalWidth,physicalHeight],scale,viewport:result.viewport,navigation:result.expanded.nav.width,chat:result.frontChat.browser,crm:result.frontChat.crm.width,groupDetail:width>=1440?'right 340px':'stacked',tasksFlow:'hidden',collectionFlowHeight:result.collection.flowRect.height}));
  }
  console.log('stage5.5A full-render layout: chrome wrappers hidden, one native command row, blue/purple controls, readable tables and preserved native host PASS');
} catch (error) { if (error.cleanupSafe === false) cleanupSafe = false; throw error; } finally {
  const resolved=path.resolve(root);assert.ok(resolved.startsWith(tempParent+path.sep)&&path.basename(resolved).startsWith('zhike-stage51-layout-'),'Only this isolated test root can be removed');
  if (cleanupSafe) fs.rmSync(resolved,{recursive:true,force:false,maxRetries:20,retryDelay:100});
  else console.error('Isolated browser resource ownership/exit was not verified; test root retained: '+resolved);
} })().catch(error => { console.error(error); process.exitCode = 1; });
