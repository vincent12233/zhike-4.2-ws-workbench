'use strict';
(function attachMetricsCharts(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ZhikeMetricsCharts = api;
})(typeof window === 'object' ? window : globalThis, function metricsCharts() {
  const MAX_POINTS = 120, MAX_ITEMS = 40;
  const input = value => value && typeof value==='object' && !Array.isArray(value) ? value : {status:'error'};
  const SERIES = Object.freeze([{key:'customers',label:'客户数'}, {key:'followups',label:'跟进数'}]);
  const string = (value, limit = 240) => typeof value === 'string' ? value.slice(0, limit) : typeof value === 'number' && Number.isFinite(value) ? String(value).slice(0, limit) : '';
  const escape = value => string(value, 4000).replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const numeric = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER ? value : null;
  const format = value => value == null ? '—' : value !== 0 && value < .000001 ? String(value) : value.toLocaleString('zh-CN',{maximumFractionDigits:20});
  const position = value => String(Math.round(value * 1000) / 1000);
  const percent = value => value>0&&value<.1 ? '小于0.1%' : (value<100&&Math.round(value*10)===1000 ? '99.9' : position(Math.round(value * 10) / 10)) + '%';
  function identifier(kind, options) {
    const value = string(options.id || options.title || kind, 256);
    if (/^[a-z][a-z0-9_-]{0,63}$/i.test(value)) return 'metrics-' + value + '-' + kind;
    let hash = 2166136261;
    for (let index=0;index<value.length;index++) hash = Math.imul(hash ^ value.charCodeAt(index), 16777619);
    return 'metrics-' + kind + '-' + (hash >>> 0).toString(36);
  }
  function status(options) { return options.status == null ? 'available' : ['available','empty','loading','error'].includes(options.status) ? options.status : 'error'; }
  function message(text, error = false) { return '<p class="zk-metrics-empty" role="' + (error?'alert':'status') + '">' + escape(text) + '</p>'; }
  function early(options) {
    const state=status(options);
    return state==='available' ? '' : message(({loading:'正在读取图表数据…',error:'图表数据读取失败，请重试。',empty:'当前范围暂无图表数据。'})[state],state==='error');
  }
  function table(title, columns, rows) {
    if (!rows.length) return '';
    return '<details class="zk-metrics-details"><summary>查看数据明细</summary><div class="zk-metrics-data"><table><caption>'+escape(title)+' · 数据明细</caption><thead><tr>'+columns.map(value=>'<th scope="col">'+escape(value)+'</th>').join('')+'</tr></thead><tbody>'+rows.map(row=>'<tr>'+row.map(value=>'<td>'+escape(value)+'</td>').join('')+'</tr>').join('')+'</tbody></table></div></details>';
  }
  function frame(kind, options, body, dataTable = '', extraNotes = []) {
    const id=identifier(kind,options),title=string(options.title,120)||'业务指标',scope=string(options.scopeLabel);
    const notes=[...(Array.isArray(options.notes)?options.notes.slice(0,3).filter(value=>typeof value==='string').map(value=>string(value)):[]),...extraNotes];
    return '<section class="zk-metrics-chart" id="'+id+'" data-chart-kind="'+kind+'" data-chart-state="'+status(options)+'" aria-labelledby="'+id+'-heading"><header class="zk-metrics-heading"><h3 id="'+id+'-heading">'+escape(title)+'</h3>'+(scope?'<p>'+escape(scope)+'</p>':'')+'</header>'+body+(notes.length?'<ul class="zk-metrics-notes">'+notes.map(note=>'<li>'+escape(note)+'</li>').join('')+'</ul>':'')+dataTable+'</section>';
  }
  function svg(kind, options, height, content, description) {
    const id=identifier(kind,options);
    return '<div class="zk-metrics-plot"><svg class="zk-metrics-svg" viewBox="0 0 720 '+height+'" role="group" aria-labelledby="'+id+'-svg-title '+id+'-svg-desc"><title id="'+id+'-svg-title">'+escape(string(options.title,120)||'业务指标')+'</title><desc id="'+id+'-svg-desc">'+escape(description)+'</desc>'+content+'</svg></div>';
  }
  function legend() { return '<ul class="zk-metrics-legend" aria-label="图例">'+SERIES.map(series=>'<li><i data-series="'+series.key+'" aria-hidden="true"></i>'+series.label+'</li>').join('')+'</ul>'; }
  function sampledIndices(length) {
    if (length<=MAX_POINTS) return Array.from({length},(_,index)=>index);
    return Array.from({length:MAX_POINTS},(_,index)=>Math.floor(index*(length-1)/(MAX_POINTS-1)));
  }
  function renderTrend(options = {}) {
    options=input(options);
    const unavailable=early(options);
    if (unavailable) return frame('trend',options,unavailable);
    const source=Array.isArray(options.points)?options.points:[],partial=source.length>MAX_POINTS;
    if(!source.length)return frame('trend',options,message('当前范围暂无趋势数据。'));
    const points=sampledIndices(source.length).map(index=>{
      const point=source[index]||{};
      return {label:string(point.label,64)||string(point.date,64)||'第 '+(index+1)+' 项',customers:numeric(point.customers),followups:numeric(point.followups)};
    });
    const dataTable=table(options.title,['日期 / 标签','客户数','跟进数'],points.map(point=>[point.label,format(point.customers),format(point.followups)]));
    const notes=[];
    if (partial) notes.push('已抽样 '+points.length+' / '+source.length+' 个数据点；采样点不连线，明细仅为这些采样点。');
    const values=points.flatMap(point=>SERIES.map(series=>point[series.key])).filter(value=>value!=null);
    const missing=points.some(point=>SERIES.some(series=>point[series.key]==null));
    if (missing) notes.push('部分数值未提供或无效，以“—”展示；缺失位置不按 0 连线。');
    if (!values.some(value=>value>0)) return frame('trend',options,message(values.length?'当前已提供的序列数值均为 0。':'当前序列数值未提供。'),dataTable,notes);
    const width=648,left=48,top=24,bottom=204,max=Math.max(...values),x=index=>left+(points.length===1?width/2:index*width/(points.length-1)),y=value=>bottom-value/max*(bottom-top);
    let content='';
    for(let index=0;index<=4;index++){
      const value=max*index/4,py=y(value);
      content+='<g class="zk-metrics-grid" aria-hidden="true"><line x1="'+left+'" x2="'+(left+width)+'" y1="'+position(py)+'" y2="'+position(py)+'"/><text x="'+(left-8)+'" y="'+position(py+4)+'" text-anchor="end">'+escape(format(value))+'</text></g>';
    }
    for(const series of SERIES){
      if(!partial){
        let segment=[];
        const flush=()=>{if(segment.length>1)content+='<path class="zk-metrics-line" data-series="'+series.key+'" d="'+segment.map((point,index)=>(index?'L':'M')+point.join(' ')).join(' ')+'"/>';segment=[]};
        points.forEach((point,index)=>{if(point[series.key]==null)flush();else segment.push([position(x(index)),position(y(point[series.key]))])});flush();
      }
      points.forEach((point,index)=>{
        const value=point[series.key];if(value==null)return;
        const label=point.label+'，'+series.label+' '+format(value);
        content+='<g class="zk-metrics-point" data-series="'+series.key+'" tabindex="0" role="img" aria-label="'+escape(label)+'"><title>'+escape(label)+'</title><circle cx="'+position(x(index))+'" cy="'+position(y(value))+'" r="4" data-value="'+value+'"/></g>';
      });
    }
    const labels=[...new Set([0,Math.floor((points.length-1)/2),points.length-1])].filter(index=>index>=0);
    for(const index of labels)content+='<text class="zk-metrics-axis-label" x="'+position(x(index))+'" y="232" text-anchor="'+(index===0&&points.length>1?'start':index===points.length-1&&points.length>1?'end':'middle')+'">'+escape(string(points[index].label,10))+'</text>';
    return frame('trend',options,legend()+svg('trend',options,252,content,'客户数与跟进数；可通过键盘查看数据点或展开数据明细。'),dataTable,notes);
  }
  function items(options) {
    const source=Array.isArray(options.items)?options.items:[];
    return {total:source.length,rows:source.slice(0,MAX_ITEMS).map((item,index)=>({label:string(item?.label,96)||'第 '+(index+1)+' 类',value:numeric(item?.value)}))};
  }
  function barsSvg(kind, options, rows) {
    if(!rows.length)return message('当前范围暂无类别数据。');
    const positive=rows.flatMap(row=>row.value==null?[]:[row.value]),max=Math.max(0,...positive);
    if(max===0)return message(positive.length?'当前已提供的数值均为 0。':'当前数值未提供。');
    let content='';
    rows.forEach((row,index)=>{
      const y=24+index*40,description=row.label+'，'+(row.value==null?'未提供':format(row.value));
      content+='<g class="zk-metrics-bar" tabindex="0" role="img" aria-label="'+escape(description)+'"><title>'+escape(description)+'</title><text x="0" y="'+(y+16)+'">'+escape(string(row.label,12))+'</text>';
      if(row.value>0)content+='<rect x="192" y="'+y+'" width="'+position(row.value/max*400)+'" height="24" rx="5" data-value="'+row.value+'"/>';
      content+='<text x="608" y="'+(y+16)+'">'+escape(format(row.value))+'</text></g>';
    });
    return svg(kind,options,Math.max(104,rows.length*40+32),content,'横条长度对比当前展示的原始数值；未提供项目不绘制横条。');
  }
  function renderBars(options = {}) {
    options=input(options);
    const unavailable=early(options);if(unavailable)return frame('bars',options,unavailable);
    const {rows,total}=items(options),notes=total>MAX_ITEMS?['已展示 '+rows.length+' / '+total+' 类；图形与明细仅覆盖这些类别。']:[];
    if(rows.some(row=>row.value==null))notes.push('部分数值未提供或无效，以“—”展示，不按 0 绘制。');
    return frame('bars',options,barsSvg('bars',options,rows),table(options.title,['类别','原始数值'],rows.map(row=>[row.label,format(row.value)])),notes);
  }
  function renderDistribution(options = {}) {
    options=input(options);
    const unavailable=early(options);if(unavailable)return frame('distribution',options,unavailable);
    const {rows,total}=items(options);
    if(!rows.length)return frame('distribution',options,message('当前范围暂无分布数据。'));
    const sum=total<=MAX_ITEMS&&rows.every(row=>row.value!=null)?rows.reduce((value,row)=>value+row.value,0):null;
    const partial=sum==null||!Number.isFinite(sum)||sum>Number.MAX_SAFE_INTEGER;
    if(partial){
      const notes=['已展示 '+rows.length+' / '+total+' 类；存在未展示、缺失或异常值，未计算占比；仅对比已展示的原始数值。'];
      return frame('distribution',options,barsSvg('distribution',options,rows),table(options.title,['类别','原始数值'],rows.map(row=>[row.label,format(row.value)])),notes);
    }
    if(!sum)return frame('distribution',options,message('当前提供的数值合计为 0，暂无可计算占比。'),table(options.title,['类别','原始数值'],rows.map(row=>[row.label,format(row.value)])));
    let x=0,content='';
    rows.forEach((row,index)=>{
      const share=row.value/sum*100,width=row.value/sum*672,label=row.label+'，'+format(row.value)+'，'+percent(share);
      if(row.value>0)content+='<g class="zk-metrics-segment" data-color="'+(index%4)+'" tabindex="0" role="img" aria-label="'+escape(label)+'"><title>'+escape(label)+'</title><rect x="'+position(24+x)+'" y="24" width="'+position(width)+'" height="36" data-value="'+row.value+'" data-percent="'+position(share)+'"/></g>';
      x+=width;
    });
    const key='<ul class="zk-metrics-distribution-key" aria-label="类别与占比">'+rows.map((row,index)=>'<li><i data-color="'+index%4+'" aria-hidden="true"></i><span>'+escape(row.label)+'</span><b>'+percent(row.value/sum*100)+'</b></li>').join('')+'</ul>';
    return frame('distribution',options,svg('distribution',options,84,content,'当前完整提供类别的数量分布；类别和占比见下方图例。')+key,table(options.title,['类别','原始数值','占比'],rows.map(row=>[row.label,format(row.value),percent(row.value/sum*100)])));
  }
  function renderProgress(options = {}) {
    options=input(options);
    const unavailable=early(options);if(unavailable)return frame('progress',options,unavailable);
    const current=numeric(options.current),total=numeric(options.total),dataTable=table(options.title,['指标','原始数值'],[['当前数值',format(current)],['总量',format(total)]]);
    if(current==null||total==null||total===0||current>total)return frame('progress',options,message('数据未提供、分母为 0 或数值冲突，无法计算进度。'),dataTable);
    const value=current/total*100,label=percent(value);
    const body='<div class="zk-metrics-progress" role="progressbar" aria-label="'+escape(string(options.title,120)||'业务进度')+'" aria-valuemin="0" aria-valuemax="100" aria-valuenow="'+value+'" aria-valuetext="'+escape(format(current)+' / '+format(total)+'，'+label)+'"><span>'+escape(format(current)+' / '+format(total))+'</span><strong>'+label+'</strong><svg class="zk-metrics-progress-track" viewBox="0 0 100 8" preserveAspectRatio="none" aria-hidden="true"><rect class="zk-metrics-progress-background" width="100" height="8" rx="4"/>'+(current>0?'<rect class="zk-metrics-progress-value" width="'+position(value)+'" height="8" rx="4" data-value="'+current+'" data-percent="'+value+'"/>':'')+'</svg></div>';
    return frame('progress',options,body,dataTable);
  }
  return Object.freeze({renderTrend,renderBars,renderDistribution,renderProgress});
});
