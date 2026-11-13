(()=>{
  'use strict';
  const host=()=>window.__zhikeRegistryHost;
  const text=value=>String(value??'').trim().toLocaleLowerCase();
  function pageWindow(items,page=1,size=50){const list=Array.isArray(items)?items:[],per=Math.max(1,Number(size)||50),pages=Math.max(1,Math.ceil(list.length/per)),current=Math.min(pages,Math.max(1,Number(page)||1));return {page:current,size:per,pages,start:(current-1)*per,rows:list.slice((current-1)*per,current*per),total:list.length};}
  function tableWindow(items,offset=0,limit=200){const list=Array.isArray(items)?items:[],size=Math.max(1,Number(limit)||200),start=Math.min(list.length,Math.max(0,Number(offset)||0));return {start,end:Math.min(list.length,start+size),rows:list.slice(start,start+size),total:list.length,hasMore:start+size<list.length};}
  function virtualRange(total,scrollTop,rowHeight=42,viewportHeight=420,overscan=8){const count=Math.max(0,Number(total)||0),height=Math.max(1,Number(rowHeight)||42),viewport=Math.max(1,Number(viewportHeight)||420),extra=Math.max(0,Number(overscan)||8),start=Math.max(0,Math.floor(Math.max(0,Number(scrollTop)||0)/height)-extra),visible=Math.ceil(viewport/height)+extra*2;return {start,end:Math.min(count,start+visible),padTop:start*height,padBottom:Math.max(0,(count-Math.min(count,start+visible))*height),total:count};}
  function buildSearchIndex(records){const index=new Map();for(const record of Array.isArray(records)?records:[]){if(!record||record.deleted)continue;const id=String(record.id??'');if(!id)continue;const value=[record.name,record.phone,record.rawPhone,record.group,record.note,record.channel,record.assistant].map(text).filter(Boolean).join(' ');for(const token of value.split(/[^\p{L}\p{N}_+]+/u).filter(Boolean)){let ids=index.get(token);if(!ids)index.set(token,ids=new Set());ids.add(id);}index.set(`*${id}`,value);}return index;}
  function searchIndex(index,query,records){const q=text(query);if(!q)return new Set((records||[]).filter(record=>!record.deleted).map(record=>String(record.id)));const ids=new Set();for(const [key,value] of index||[]){if(key.startsWith('*')&&value.includes(q))ids.add(key.slice(1));}return ids;}
  function diffSummary(current,backup,keys=['customers','tickets','deposits','followups','registrations','phoneRegistry']){const left=current&&typeof current==='object'?current:{},right=backup&&typeof backup==='object'?backup:{};return keys.map(key=>({key,current:Array.isArray(left[key])?left[key].length:0,backup:Array.isArray(right[key])?right[key].length:0,delta:(Array.isArray(right[key])?right[key].length:0)-(Array.isArray(left[key])?left[key].length:0)}));}
  window.ZhikePerformance={pageWindow,tableWindow,virtualRange,buildSearchIndex,searchIndex,diffSummary};
  function mountStyles(){if(document.querySelector('#performanceEnhancementStyles'))return;const style=document.createElement('style');style.id='performanceEnhancementStyles';style.textContent='.perf-table-viewport{contain:layout style}.perf-table tbody tr{content-visibility:auto;contain-intrinsic-size:44px}.performance-notice{display:flex;align-items:center;gap:8px;margin:0 0 10px;padding:9px 12px;border:1px solid #76b8c866;border-radius:8px;background:#effaf9;color:#28656b;font-size:12px}.performance-notice strong{font-weight:650}.sync-status[data-reliability-status="1"]{cursor:pointer;text-decoration:underline;text-underline-offset:3px}';document.head?.append(style);}
  function mount(){mountStyles();const h=host(),view=document.querySelector('#viewContainer');if(!h||!view)return;view.querySelectorAll('.data-table:not(.perf-table)').forEach(table=>{table.classList.add('perf-table');table.closest('.table-scroll')?.classList.add('perf-table-viewport');});if(h.state.view==='customers'&&!view.querySelector('#performanceNotice')){const customerCount=Array.isArray(h.state.customers)?h.state.customers.reduce((count,row)=>count+(!row.deleted?1:0),0):0;if(customerCount>=10000){const notice=document.createElement('div');notice.id='performanceNotice';notice.className='performance-notice';notice.innerHTML='<strong>大数据模式</strong><span>当前客户库超过 10,000 条，筛选结果按分页展示，表格启用按需绘制。</span>';view.querySelector('.page-heading')?.after(notice);}}const detailViews=new Set(['tickets','deposits','registrations','activity']);if(detailViews.has(h.state.view)&&view.querySelector('.data-table tbody tr:nth-child(201)')&&!view.querySelector('#detailPerformanceNotice')){const notice=document.createElement('div');notice.id='detailPerformanceNotice';notice.className='performance-notice';notice.innerHTML='<strong>明细窗口</strong><span>统计使用全部记录；表格区域按需绘制，滚动和筛选不会改变统计结果。</span>';view.querySelector('.page-heading')?.after(notice);}const badge=document.querySelector('#syncStatus');if(badge){badge.setAttribute('aria-live','polite');if(badge.textContent==='数据冲突'||badge.textContent==='保存异常'){badge.dataset.reliabilityStatus='1';badge.setAttribute('role','button');badge.tabIndex=0;badge.title=badge.textContent==='数据冲突'?'检测到相同记录冲突，点击导出恢复副本并同步共享数据':'保存异常，点击重试本机数据同步';if(!badge.dataset.reliabilityKey){badge.dataset.reliabilityKey='1';badge.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();badge.click();}});}}}}
  let mountPending=false, lastMountAt=0, remountTimer=0;
  function scheduleMount(){
    if(mountPending)return;
    const now=performance.now();
    const wait=Math.max(0,80-(now-lastMountAt));
    mountPending=true;
    clearTimeout(remountTimer);
    remountTimer=setTimeout(()=>requestAnimationFrame(()=>{mountPending=false;lastMountAt=performance.now();mount();}),wait);
  }
  if(typeof document!=='undefined'){
    scheduleMount();
    // Observe only the application view. Observing document.body caused every
    // WebView2/WS status mutation to schedule a layout pass while the user
    // was scrolling, which produced intermittent frame drops.
    const target=document.querySelector('#viewContainer')||document.body;
    new MutationObserver(scheduleMount).observe(target,{childList:true});
  }
})();
