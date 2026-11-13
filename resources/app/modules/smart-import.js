(()=>{
  const clean=value=>String(value??'').normalize('NFKC').trim();
  const key=value=>clean(value).toLowerCase().replace(/[\s_\-\/\\（）()【】\[\]：:，,。·]/g,'');
  const unique=list=>[...new Set((list||[]).filter(Boolean))];
  const isInterestHeader=value=>/(兴趣|偏好|意向|感兴趣|interest|preference|preferencelevel)/i.test(clean(value));
  const isValidDate=(year,month,day)=>{const d=new Date(year,month-1,day);return d.getFullYear()===year&&d.getMonth()===month-1&&d.getDate()===day;};
  const formatDate=(year,month,day)=>isValidDate(year,month,day)?`${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`:'';
  function date(value,baseYear=new Date().getFullYear()){
    let raw=clean(value).replace(/^日期?\s*[:：=]?\s*/i,'').replace(/上午|下午/g,'').replace(/(\d)[Tt].*$/,'$1').replace(/\s+/g,'');
    if(!raw)return '';
    raw=raw.replace(/[年./月]/g,'-').replace(/日/g,'').replace(/-+/g,'-');
    let match=raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);if(match){const value=formatDate(Number(match[1]),Number(match[2]),Number(match[3]));if(value)return value;}
    match=raw.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);if(match){const value=formatDate(Number(match[3]),Number(match[2]),Number(match[1]));if(value)return value;}
    match=raw.match(/^(\d{8})$/);if(match)return formatDate(Number(match[1].slice(0,4)),Number(match[1].slice(4,6)),Number(match[1].slice(6,8)));
    match=raw.match(/^(\d{1,2})-(\d{1,2})$/);if(match)return formatDate(Number(baseYear),Number(match[1]),Number(match[2]));
    if(/^\d{1,6}(?:\.0+)?$/.test(raw)){const serial=Math.trunc(Number(raw));if(serial>=1&&serial<=2958465){const value=new Date(Date.UTC(1899,11,30)+serial*86400000);return formatDate(value.getUTCFullYear(),value.getUTCMonth()+1,value.getUTCDate());}}
    const parsed=Date.parse(clean(value));if(Number.isFinite(parsed)){const d=new Date(parsed),result=formatDate(d.getFullYear(),d.getMonth()+1,d.getDate());if(result)return result;}
    return '';
  }
  const builtins={source:{群导:'群粉',社群:'群粉',微信群:'群粉',whatsapp:'群粉',telegram:'群粉',单导:'单导',私聊:'单导',广告:'单导',落地页:'单导',自然流量:'单导'},status:{进群:'已进群',进了:'已进群',已进:'已进群',在群:'在群',退群:'已退群',退了:'已退群','未进':'未进群','没进':'未进群','重复粉':'重粉'},recordType:{客户:'customer',客户资料:'customer',跟票:'ticket',股票:'ticket',买卖:'ticket',入金:'deposit',充值:'deposit',报名:'registration',跟进:'followup'}};
  const nonBusinessSource=/^(快速录入|快录|文件导入|csv导入|excel导入|批量导入|手工导入)$/i;
  const singleSourceSignal=/(单导|单引|私聊|广告|落地页|自然流量|私域|单客|direct|private)/i;
  const groupSourceSignal=/(群粉|群导|社群|微信群|whatsapp\s*群|telegram\s*群|group\s*(?:lead|fan))/i;
  const statusSignal=/(已?进群|在群(?:里)?|未进群|没进群|已?退群|临时退群|重粉|无效|new|joined|left|active|inactive)/i;
  const directionSignal=/(买入|购买|购入|买|卖出|卖|关注|观察|持有|buy|sell|watch|hold)/i;
  const fieldAliases={
    name:['客户姓名','客户名称','联系人姓名','联系人','姓名','昵称','微信昵称','whatsapp名称','name','customername','fullname','contactname'],
    vipNumber:['VIP编号','VIP号','会员编号','会员号','VIP代码','vipnumber','vipid','vipcode','membershipid'],
    phone:['标准号码','原始号码','客户号码','手机号码','手机号','联系电话','联系电话号码','电话','号码','微信号','whatsapp号码','whatsapp号','phone','phoneraw','phonenormalized','phonenumber','mobile','mobilephone','cellphone','number','contact'],
    source:['渠道','数据归属','客户归属','来源类型','来源渠道','获客渠道','客户来源','归属','source','leadsource','channel','origin'],
    page:['页面分类','单导页面','来源页面','来源表','来源工作表','source_sheet','页面','page','sheet'],
    assistant:['跟进助理','负责人','跟进人','销售','助理','assistant','owner','agent','sales'],
    status:['进群状态','群状态','客户状态','跟进状态','状态','group_status','status','state'],
    phase:['客户阶段','客户状态阶段','销售阶段','客户分层','customer_stage','阶段','phase','stage'],
    qualification:['资质评级','资质等级','客户资质','客户评级','qualification','qualification_level','rating','grade'],
    country:['国家','国家/地区','地区','country','region'],
    language:['语言','客户语言','language','locale'],
    occupation:['职业','工作','职业及工作','occupation','job','work'],
    age:['年龄','age'],
    budget:['预算','投资预算','budget'],
    productInterest:['产品兴趣','股票兴趣','投资偏好','兴趣偏好','productinterest','interest','preference'],
    hot:['热聊','热聊状态','是否热聊','重点聊','hot'],
    investor:['是否股民','股民','投资者','investor','is investor'],
    ticketFlag:['跟票','跟票状态','是否跟票','ticket','has ticket'],
    depositFlag:['入金','入金状态','是否入金','deposit','has deposit'],
    lastFollow:['最后跟进','最后跟进日期','最近跟进','lastfollow','last_follow'],
    group:['群编号','群号','群组编号','群组','group_code','groupid','group_no','group'],
    registered:['登记日期','登记时间','注册日期','注册时间','入群日期','添加日期','导入日期','创建时间','录入时间','首次联系时间','registered_at','registerdate','createdat','日期','时间','registered','date'],
    due:['下次跟进','下次跟进日期','计划跟进','计划跟进日期','跟进日期','计划日期','下次联系','下次联系日期','next_followup','nextfollow','followupdate','duedate','due'],
    note:['备注','客户备注','跟进备注','说明','note','notes','remark','comment'],
    recordType:['记录类型','业务类型','数据类型','类型','recordtype','businesstype','type'],
    product:['产品','产品代码','股票','股票代码','股票名称','证券代码','品种','product','productcode','symbol','stock','stockcode'],
    direction:['方向','买卖方向','买卖','操作','交易方向','direction','side','action'],
    amount:['金额','入金金额','充值金额','付款金额','成交金额','amount','deposit','payment','value'],
    currency:['币种','货币','currency','ccy'],
    businessNote:['业务备注','交易备注','入金备注','记录备注','businessnote','transactionnote'],
    tradeRef:['交易流水号','成交编号','订单号','交易编号','trade_ref','traderef','orderid'],
    externalRef:['外部流水号','批次号','外部编号','external_ref','externalref','batchno'],
    followDate:['跟票日期','入金日期','业务日期','交易日期','交易时间','followdate','businessdate','transactiondate'],
    buyDate:['买入日期','购买日期','买入时间','buydate','buy_date','purchase_date'],
    sellDate:['卖出日期','出售日期','卖出时间','selldate','sell_date','sale_date']
  };
  const canonicalAliases={due:'nextFollow',nextfollow:'nextFollow',next_followup:'nextFollow',followupdate:'nextFollow',duedate:'nextFollow',trade_ref:'tradeRef',traderef:'tradeRef',交易流水号:'tradeRef',流水号:'tradeRef',外部流水号:'externalRef',external_ref:'externalRef',customer_id:'customerId',customerid:'customerId',客户编号:'customerId'};
  function canonicalImportField(value){
    const raw=clean(value),normalized=key(raw);
    if(Object.hasOwn(canonicalAliases,raw))return canonicalAliases[raw];
    if(Object.hasOwn(canonicalAliases,normalized))return canonicalAliases[normalized];
    for(const [field,aliases] of Object.entries(fieldAliases))if(aliases.some(alias=>key(alias)===normalized))return field==='due'?'nextFollow':field;
    return raw;
  }
  const headerPatterns={
    name:/(姓名|名称|联系人|昵称|name|customer|client)/i,
    vipNumber:/(vip|会员).*(编号|号码|代码|id|number|code)/i,
    phone:/(电话|手机|号码|手机号|whatsapp|微信号|phone|mobile|cell|contact)/i,
    source:/(渠道|来源|归属|source|channel|origin|lead)/i,
    page:/(页面|来源表|工作表|sheet|page)/i,
    assistant:/(助理|负责人|跟进人|销售|assistant|owner|agent|sales)/i,
    status:/(状态|进群|群状态|status|state)/i,
    phase:/(阶段|分层|phase|stage)/i,
    qualification:/(资质|评级|等级|qualification|rating|grade)/i,
    group:/(群号|群编号|群组|group)/i,
    registered:/(登记|注册|入群|添加|创建|录入|首次联系|日期|时间|registered|date|time)/i,
    due:/(下次跟进|计划跟进|跟进日期|计划日期|下次联系|next.?follow|followup.?date|due)/i,
    note:/(备注|说明|note|remark|comment)/i,
    recordType:/(记录类型|业务类型|数据类型|类型|record|business|type)/i,
    product:/(产品|股票|证券|品种|代码|symbol|product|stock)/i,
    direction:/(方向|买卖|操作|side|action)/i,
    amount:/(金额|入金|充值|付款|成交|amount|deposit|payment|value)/i,
    currency:/(币种|货币|currency|ccy)/i,
    businessNote:/(业务备注|交易备注|入金备注|business|transaction)/i,
    followDate:/(跟票|入金|业务|交易).*(日期|时间)|follow|businessdate|transactiondate/i,
    buyDate:/(买入|购买).*(日期|时间)|buy.?date|purchase.?date/i,
    sellDate:/(卖出|出售).*(日期|时间)|sell.?date|sale.?date/i
  };
  // The settings page can expose custom channel/group-fan options in several
  // compatible shapes (flat alias map, `source`/`aliases` map, or option
  // catalog arrays).  Normalize all of them here so row classification does
  // not fall back to the generic "群粉" bucket merely because a custom value
  // contains a built-in keyword such as "WhatsApp 群".
  function configuredSourceEntries(aliases={}){
    const entries=[],seen=new Set(),add=(alias,target=alias)=>{const a=clean(alias),t=clean(target);if(!a||!t)return;const signature=`${key(a)}\u0000${key(t)}`;if(seen.has(signature))return;seen.add(signature);entries.push({alias:a,target:t,aliasKey:key(a)});};
    const addList=list=>{if(Array.isArray(list))for(const value of list)add(value);};
    const addMap=map=>{if(!map||typeof map!=='object'||Array.isArray(map))return;for(const [alias,target] of Object.entries(map))if(typeof target==='string')add(alias,target);};
    addList(aliases?.groupFanSources);addList(aliases?.sources);addList(aliases?.optionLists?.groupFanSources);addList(aliases?.optionLists?.sources);
    addMap(aliases?.aliases);addMap(aliases?.source);addMap(aliases?.sourceAliases);addMap(aliases?.optionLists?.channelAliases);
    // Backward-compatible flat alias map. Ignore catalog metadata fields.
    if(aliases&&typeof aliases==='object'&&!Array.isArray(aliases))for(const [alias,target] of Object.entries(aliases))if(!['groupFanSources','sources','optionLists','aliases','source','sourceAliases'].includes(alias)&&typeof target==='string')add(alias,target);
    return entries.sort((a,b)=>b.aliasKey.length-a.aliasKey.length||a.alias.localeCompare(b.alias,'zh-CN'));
  }
  function configuredSourceMatch(value,aliases={}){const raw=clean(value),lookup=key(raw);if(!lookup)return null;return configuredSourceEntries(aliases).find(item=>lookup===item.aliasKey||lookup.includes(item.aliasKey))||null;}
  function normalizeValue(value,kind,custom={}){const raw=clean(value),lookup=key(raw);if(kind==='source'){const configured=configuredSourceMatch(raw,custom);if(configured)return configured.target;}const nested=custom?.[kind],customMaps=[nested,custom].filter(map=>map&&typeof map==='object'&&!Array.isArray(map));for(const map of customMaps)for(const [alias,target] of Object.entries(map))if(typeof target==='string'&&key(alias)===lookup)return target;for(const [alias,target] of Object.entries(builtins[kind]||{}))if(key(alias)===lookup)return target;return raw;}
  function sourceSignal(value,aliases={}){const raw=clean(value),configured=configuredSourceMatch(raw,aliases);if(configured)return configured.target;if(singleSourceSignal.test(raw))return '单导';if(groupSourceSignal.test(raw))return '群粉';return '';}
  function normalizeSource(value,page='',fallback='',aliases={}){const raw=clean(value),configured=configuredSourceMatch(raw,aliases),mapped=configured?.target||normalizeValue(raw,'source',aliases),safeFallback=clean(fallback),safePage=clean(page);if(raw&&!nonBusinessSource.test(raw)){if(configured)return configured.target;const direct=sourceSignal(raw,aliases)||sourceSignal(mapped,aliases);if(direct)return direct;if(mapped&&mapped!==raw&&!nonBusinessSource.test(mapped))return mapped;return raw;}const fallbackConfigured=configuredSourceMatch(safeFallback,aliases),fallbackSignal=sourceSignal(safeFallback,aliases)||sourceSignal(normalizeValue(safeFallback,'source',aliases),aliases);if(fallbackConfigured)return fallbackConfigured.target;if(fallbackSignal)return fallbackSignal;if(safeFallback&&!nonBusinessSource.test(safeFallback)){const normalizedFallback=normalizeValue(safeFallback,'source',aliases);if(normalizedFallback&&!nonBusinessSource.test(normalizedFallback))return normalizedFallback;}const pageConfigured=configuredSourceMatch(safePage,aliases),pageSignal=sourceSignal(safePage,aliases)||sourceSignal(normalizeValue(safePage,'source',aliases),aliases);if(pageConfigured)return pageConfigured.target;if(pageSignal)return pageSignal;return '';}
  function resolveImportSource(route={},rawSource='',fileSource='',page='',aliases={},defaultSource=''){
    const routeSource=clean(route?.source),raw=clean(rawSource),explicit=raw?normalizeSource(raw,'','',aliases):'',pageSource=sourceSignal(page,aliases),fileSourceValue=sourceSignal(fileSource,aliases),routeConfidence=Number(route?.sourceConfidence),hasRouteConfidence=Number.isFinite(routeConfidence),routeCandidate=routeSource||'';
    // A mapped source column or an explicit row label is authoritative.  A
    // source inferred from free text/file metadata keeps the classifier's
    // confidence so low-confidence candidates remain reviewable.
    const authoritativeRoute=routeCandidate&&(!raw||route?.sourceOrigin==='资料'||route?.sourceOrigin==='行标签'||(hasRouteConfidence&&routeConfidence>=0.8));
    const candidateSource=authoritativeRoute?routeCandidate:(explicit||routeCandidate||pageSource||fileSourceValue);
    const selectedDefault=clean(defaultSource)?normalizeSource(defaultSource,'','',aliases):'';
    const defaultApplied=!candidateSource&&Boolean(selectedDefault);
    const source=candidateSource||selectedDefault||'';
    const candidates=[...new Set([...(Array.isArray(route?.sourceCandidates)?route.sourceCandidates:[]),explicit,routeCandidate,pageSource,fileSourceValue,defaultApplied?selectedDefault:''].map(clean).filter(Boolean))];
    const confidence=explicit?1:routeCandidate?(hasRouteConfidence?routeConfidence:0.72):pageSource||fileSourceValue?0.72:defaultApplied?1:0;
    const reason=!source?'missing':route?.sourceAmbiguous?'ambiguous':confidence<0.72?'low-confidence':'';
    return {source,confidence,candidates,reason,needsReview:Boolean(reason),defaultApplied};
  }
  function shouldReviewSource(sourceReview={},context={}){
    if(!sourceReview?.needsReview)return false;
    const type=importHint(context.recordType||context.type||'')||clean(context.recordType||context.type||'').toLowerCase();
    return !(context.existingCustomer&&type&&type!=='customer');
  }
  function looksLikePhone(value){const raw=clean(value),digits=raw.replace(/\D/g,'');if(digits.length<8||digits.length>15||date(raw))return false;if(/^\d{1,6}(?:\.\d+)?$/.test(raw))return false;return /^\+?\d[\d\s().-]{7,}$/.test(raw);}
  function looksLikeAmount(value){const raw=clean(value).replace(/[,$￥₹€£\s]/g,'');return /^-?\d+(?:\.\d+)?$/.test(raw)&&!date(raw)&&!looksLikePhone(value);}
  function valuesFor(rows,index){return (Array.isArray(rows)?rows:[]).map(row=>Array.isArray(row)?row[index]:row?.[index]).map(clean).filter(Boolean).slice(0,30);}
  function fieldHintScore(field,values){if(!values.length)return 0;const ratio=pred=>values.filter(pred).length/values.length;if(field==='phone')return Math.round(ratio(looksLikePhone)*48);if(field==='registered'||field==='followDate')return Math.round(ratio(value=>Boolean(date(value)))*42);if(field==='amount')return Math.round(ratio(looksLikeAmount)*35);if(field==='source')return Math.round(ratio(value=>Boolean(sourceSignal(value)))*32);if(field==='status')return Math.round(ratio(value=>statusSignal.test(value))*32);if(field==='direction')return Math.round(ratio(value=>directionSignal.test(value))*32);if(field==='recordType')return Math.round(ratio(value=>Boolean(normalizeValue(value,'recordType')))*28);if(field==='currency')return Math.round(ratio(value=>/^[A-Za-z]{3}$/.test(value))*20);if(field==='name')return Math.round(ratio(value=>/[A-Za-z\u3400-\u9fff]/.test(value)&&!looksLikePhone(value)&&!date(value))*16);return 0;}
  function fieldCandidates(headers,rows,field,aliases){const aliasesKey=new Set((aliases||[]).map(key));return headers.map((header,index)=>{const normalized=key(header),values=valuesFor(rows,index);let score=0;if(aliasesKey.has(normalized))score+=100;else if((aliases||[]).some(alias=>normalized.includes(key(alias))||key(alias).includes(normalized)))score+=64;if(headerPatterns[field]?.test(normalized))score+=30;score+=fieldHintScore(field,values);if(field==='product'&&isInterestHeader(header))score-=140;if(field==='phone'&&/(日期|date|时间|time)/i.test(normalized))score-=80;if(field==='name'&&/(备注|note|电话|手机|号码|状态|日期)/i.test(normalized))score-=50;if(field==='registered'&&/(姓名|name|电话|phone)/i.test(normalized))score-=60;if((field==='registered'||field==='followDate')&&/(买入|购买|卖出|出售|buy|sell|purchase|sale)/i.test(normalized))score-=90;return {index,score};}).filter(item=>item.score>0).sort((a,b)=>b.score-a.score||a.index-b.index);}
  function inferHeaderMapping(headers,sampleRows=[],options={}){const normalizedHeaders=(headers||[]).map(clean),fields=options.fields||Object.entries(fieldAliases).map(([field,aliases])=>[field,'',aliases]),mapping={},used=new Set(),ranked=[];for(const [field,,aliases] of fields)for(const candidate of fieldCandidates(normalizedHeaders,sampleRows,field,aliases))ranked.push({...candidate,field});ranked.sort((a,b)=>b.score-a.score||a.index-b.index);for(const item of ranked){if(mapping[item.field]!=null||used.has(item.index))continue;mapping[item.field]=item.index;used.add(item.index);}return mapping;}
  function detectHeaderRow(rows,options={}){const list=Array.isArray(rows)?rows:[],limit=Math.min(12,Math.max(1,list.length-1)),fields=options.fields||undefined;let best={index:0,headers:list[0]||[],mapping:{},score:0};for(let index=0;index<limit;index++){const headers=(list[index]||[]).map(clean);if(!headers.filter(Boolean).length)continue;const mapping=inferHeaderMapping(headers,list.slice(index+1,index+21),{fields}),mapped=Object.keys(mapping).length,score=(mapping.phone!=null?100:0)+mapped*8+Math.min(20,headers.filter(Boolean).length);if(score>best.score){best={index,headers,mapping,score};}}return {...best,confidence:mappingConfidence(best.headers,best.mapping)};}
  function inferRecordType(row={},context=''){const values=Object.values(row).map(clean).join(' '),hint=clean(row.recordType||row.type||context),normalized=normalizeValue(hint,'recordType').toLowerCase();if(/跟票|股票|买卖|ticket|stock/.test(normalized)||row.product||row.symbol||row.direction)return 'ticket';if(/入金|充值|付款|deposit|payment/.test(normalized)||(row.amount!==undefined&&clean(row.amount)!==''))return 'deposit';if(/报名|registration|register/.test(normalized))return 'registration';if(/跟进|回访|follow/.test(normalized))return 'followup';if(/股票|证券|买入|卖出|ticket|stock/.test(values))return 'ticket';if(/入金|充值|付款|deposit|payment/.test(values))return 'deposit';if(/报名|注册|registration/.test(values))return 'registration';if(/跟进|回访|follow/.test(values))return 'followup';return 'customer';}
  function classifyImportRow(row={},context={}){
    const normalized={};for(const [name,value] of Object.entries(row||{})){const field=canonicalImportField(name);if(value!==undefined&&value!==null&&clean(value)!=='')normalized[field]=value;}
    const reasons=[],target=importHint(context?.target||context?.mode||''),explicit=normalizeValue(normalized.recordType||context.recordType||'','recordType').toLowerCase();
    if(target==='customer'){if(clean(normalized.phone)||clean(normalized.customerId))reasons.push('identity');if(clean(normalized.name))reasons.push('name');return {type:'customer',confidence:reasons.includes('identity')?1:reasons.includes('name')?.35:0,reasons};}
    if(target==='ticket'&&!explicit)return {type:'ticket',confidence:1,reasons:['target']};
    if(target==='deposit'&&!explicit)return {type:'deposit',confidence:1,reasons:['target']};
    if(explicit&&explicit!=='customer'){reasons.push('recordType');return {type:inferRecordType({recordType:explicit,...normalized}),confidence:1,reasons};}
    if(clean(normalized.product)||clean(normalized.direction)||clean(normalized.buyDate)||clean(normalized.sellDate)){if(clean(normalized.product))reasons.push('product');if(clean(normalized.direction))reasons.push('direction');if(clean(normalized.buyDate)||clean(normalized.sellDate))reasons.push('tradeDate');return {type:'ticket',confidence:reasons.includes('product')&&reasons.includes('direction')?1:.8,reasons};}
    if(clean(normalized.amount)){reasons.push('amount');if(clean(normalized.currency))reasons.push('currency');if(clean(normalized.registered)||clean(normalized.followDate))reasons.push('depositDate');return {type:'deposit',confidence:clean(normalized.currency)?1:.8,reasons};}
    if(/报名|registration/i.test(Object.values(normalized).join(' ')))return {type:'registration',confidence:.8,reasons:['registration']};
    if(/跟进|回访|follow/i.test(Object.values(normalized).join(' ')))return {type:'followup',confidence:.8,reasons:['followup']};
    if(clean(normalized.phone)||clean(normalized.customerId))reasons.push('identity');if(clean(normalized.name))reasons.push('name');return {type:'customer',confidence:reasons.includes('identity')?1:reasons.includes('name')?.35:0,reasons};
  }
  function classifyRow(row,aliases){return classifyImportRow(row,aliases);}
  const businessFlagHeader=/^(?:是否|有无|标记)?(?:跟票|入金|报名|热聊|vip)(?:状态|标记|客户)?$/i;
  const customerDerivedHeader=/^(?:是否)?(?:跟票|入金|热聊|vip|是否股民|最后跟进|下次跟进(?:日期)?|登记(?:日期|时间))$/i;
  function importHint(value){
    const raw=clean(value).toLowerCase();
    if(!raw)return '';
    if(/customer|客户|客户资料|客户中心/.test(raw))return 'customer';
    if(/ticket|跟票|股票|买卖|stock/.test(raw))return 'ticket';
    if(/deposit|入金|充值|付款|payment/.test(raw))return 'deposit';
    if(/registration|register|报名/.test(raw))return 'registration';
    if(/followup|follow|跟进|回访/.test(raw))return 'followup';
    if(/mixed|混合/.test(raw))return 'mixed';
    return '';
  }
  function isBusinessHeader(field,header){
    const text=clean(header);
    if(!text||businessFlagHeader.test(text)||customerDerivedHeader.test(text)||/^(跟票|入金|报名|热聊|vip|跟票状态|入金状态|是否跟票|是否入金)$/i.test(text))return false;
    if(field==='product')return !isInterestHeader(text)&&/(产品|股票|证券|品种|代码|symbol|stock|product)/i.test(text);
    if(field==='direction')return /(方向|买卖|操作|side|action)/i.test(text);
    if(field==='amount')return /(金额|入金|充值|付款|成交|amount|deposit|payment|value)/i.test(text);
    if(field==='currency')return /(币种|货币|currency|ccy)/i.test(text);
    if(field==='recordType')return /(记录类型|业务类型|数据类型|record|business.?type)/i.test(text);
    if(field==='followDate')return /(跟票日期|入金日期|业务日期|交易日期|交易时间|followdate|businessdate|transactiondate)/i.test(text);
    if(field==='buyDate')return /(买入|购买).*(日期|时间)|buy.?date|purchase.?date/i.test(text);
    if(field==='sellDate')return /(卖出|出售).*(日期|时间)|sell.?date|sale.?date/i.test(text);
    if(field==='tradeRef')return /(流水|成交编号|订单号|交易编号|trade.?ref|order.?id)/i.test(text);
    if(field==='externalRef')return /(外部流水|批次号|外部编号|external.?ref|batch)/i.test(text);
    if(field==='businessNote')return /(业务备注|交易备注|跟票备注|入金备注|business.?note|transaction.?note)/i.test(text);
    return false;
  }
  function mappedValue(row,mapping,field){
    const index=mapping?.[field];
    if(!Number.isInteger(index)||index<0)return '';
    return clean(Array.isArray(row)?row[index]:row?.[index]);
  }
  function looksLikeProductCode(value){const raw=clean(value);return /^(?:[A-Z]{1,8}[A-Z0-9.-]{0,12}|\d{4,8})$/.test(raw)&&!/^\d{8}$/.test(raw);}
  function looksLikeCustomerExport(headers=[]){const list=(headers||[]).map(clean);const hasIdentity=list.some(value=>/(姓名|名称|name|customer)/i.test(value))&&list.some(value=>/(电话|手机|号码|phone|mobile|contact)/i.test(value));const hasCustomerCore=list.some(value=>/(渠道|来源|状态|登记|注册|入群|客户阶段|phase|source)/i.test(value));const hasDerived=list.some(value=>customerDerivedHeader.test(value)||businessFlagHeader.test(value));const hasExplicitBusiness=list.some(value=>/(记录类型|业务类型|股票代码|证券代码|买卖方向|交易方向|交易流水|外部流水|跟票日期|业务日期|交易日期|买入日期|卖出日期|币种|currency|trade.?ref|external.?ref|business.?date|transaction.?date)/i.test(value));return hasIdentity&&hasCustomerCore&&hasDerived&&!hasExplicitBusiness;}
  function businessSignals(row,mapping,headers=[]){
    const explicit=importHint(mappedValue(row,mapping,'recordType')),ticketHeader=field=>isBusinessHeader(field,headers?.[mapping?.[field]]),
      product=mappedValue(row,mapping,'product'),direction=mappedValue(row,mapping,'direction'),amount=mappedValue(row,mapping,'amount'),
      followDate=mappedValue(row,mapping,'followDate'),buyDate=mappedValue(row,mapping,'buyDate'),sellDate=mappedValue(row,mapping,'sellDate');
    let ticket=explicit==='ticket'&&ticketHeader('recordType'),deposit=explicit==='deposit'&&ticketHeader('recordType'),registration=explicit==='registration'&&ticketHeader('recordType'),followup=explicit==='followup'&&ticketHeader('recordType');
    // An explicit row type is authoritative. A shared "business date/note"
    // column must not turn a registration or follow-up row into a stock row.
    if(registration||followup)return {ticket:false,deposit:false,registration,followup};
    if(ticketHeader('product')&&looksLikeProductCode(product))ticket=true;
    if(ticketHeader('direction')&&direction)ticket=true;
    if(ticketHeader('buyDate')&&buyDate)ticket=true;
    if(ticketHeader('sellDate')&&sellDate)ticket=true;
    if(ticketHeader('followDate')&&followDate){if(/入金|deposit/i.test(headers?.[mapping?.followDate]||''))deposit=true;else ticket=true;}
    if(ticketHeader('tradeRef')&&mappedValue(row,mapping,'tradeRef'))ticket=true;
    if(ticketHeader('externalRef')&&mappedValue(row,mapping,'externalRef'))ticket=true;
    if(ticketHeader('businessNote')&&mappedValue(row,mapping,'businessNote'))ticket=true;
    if(ticketHeader('amount')&&/^[-+]?\d[\d,]*(?:\.\d+)?$/.test(amount.replace(/,/g,''))&&Number(amount.replace(/,/g,''))>0)deposit=true;
    return {ticket,deposit,registration,followup};
  }
  function inferRowClassification(row,mapping={},headers=[],options={}){
    const aliases=options.aliases||{},values=Array.isArray(row)?row:(row&&typeof row==='object'?Object.values(row):[]),headerList=Array.isArray(headers)?headers:[],mappedValueFor=field=>mappedValue(row,mapping,field),sourceCandidates=[],statusCandidates=[];
    const labelledSource=value=>{const raw=clean(value),match=raw.match(/(?:^|[\s,，;；|])(?:渠道|来源渠道|客户来源|获客渠道|来源|归属)\s*[:：=]\s*([^,，;；|\t]{1,80})/i);return match?clean(match[1]).replace(/\s+(?:状态|登记|日期|助理|群号)\s*[:：=].*$/i,''):'';};
     const addSource=(value,index,priority)=>{const raw=clean(value);if(!raw)return;const header=clean(headerList[index]),labelled=labelledSource(raw),candidate=labelled||raw,configured=configuredSourceMatch(candidate,aliases),normalized=normalizeSource(candidate,'','',aliases),signal=configured?.target||sourceSignal(candidate,aliases)||sourceSignal(normalized,aliases),alias=normalizeValue(candidate,'source',aliases),mapped=Number.isInteger(mapping.source)&&index===mapping.source,explicit=mapped||headerPatterns.source?.test(header)||Boolean(labelled),valueForUse=signal||((alias&&alias!==candidate&&!nonBusinessSource.test(alias))?alias:(explicit&&!nonBusinessSource.test(candidate)?candidate:''));if(valueForUse)sourceCandidates.push({value:valueForUse,index,priority:priority+(configured?22:0)+(signal?8:0)+(explicit?12:0)+(labelled?18:0),origin:mapped?'资料':labelled?'行标签':'识别'});};
    const addStatus=(value,index,priority)=>{const raw=clean(value);if(!raw)return;const normalized=normalizeValue(raw,'status',aliases);if(statusSignal.test(raw)||statusSignal.test(normalized)||normalized!==raw)statusCandidates.push({value:normalized||raw,index,priority});};
    const sourceIndex=Number.isInteger(mapping.source)?mapping.source:-1,pageIndex=Number.isInteger(mapping.page)?mapping.page:-1,statusIndex=Number.isInteger(mapping.status)?mapping.status:-1;
    if(sourceIndex>=0)addSource(values[sourceIndex],sourceIndex,120);
    if(pageIndex>=0)addSource(values[pageIndex],pageIndex,105);
    if(statusIndex>=0)addStatus(values[statusIndex],statusIndex,120);
    values.forEach((value,index)=>{
      const header=clean(headerList[index]);
      if(index!==sourceIndex&&index!==pageIndex)addSource(value,index,headerPatterns.source?.test(header)?95:60);
      if(index!==statusIndex)addStatus(value,index,headerPatterns.status?.test(header)?95:55);
    });
    const filename=clean(options.filename);if(filename)addSource(filename,-1,25);
     const rankedSources=sourceCandidates.sort((a,b)=>b.priority-a.priority||a.index-b.index),bestSource=rankedSources[0],bestStatus=statusCandidates.sort((a,b)=>b.priority-a.priority||a.index-b.index)[0],source=bestSource?.value||'',status=bestStatus?.value||'',sourceCandidateValues=[...new Set(rankedSources.map(item=>item.value).filter(Boolean))],sourceConfidence=!bestSource?0:bestSource.origin==='资料'?1:bestSource.priority>=110?.88:bestSource.priority>=90?.86:bestSource.priority>=80?.72:.5,sourceAmbiguous=sourceCandidateValues.length>1&&rankedSources[1]&&bestSource.priority-rankedSources[1].priority<18;
     return {source,status,sourceOrigin:bestSource?.origin||'',statusOrigin:bestStatus?.index===statusIndex?'资料':status?'识别':'',sourceConfidence,sourceCandidates:sourceCandidateValues,sourceAmbiguous};
  }
  function importBatchMode(batch={}){
    const hint=importHint(batch?.mapping?.recordTypeHint||batch?.recordTypeHint);
    const headers=batch.headers||batch.rows?.[0]||[];
    const customerExport=looksLikeCustomerExport(headers);
    // AI is advisory.  A customer hint is only authoritative when the
    // schema itself looks like a customer-center export; otherwise concrete
    // business values win (prevents a bad AI hint from hiding real tickets).
    if(hint==='customer'&&customerExport)return 'customer';
    if(customerExport)return 'customer';
    let ticket=false,deposit=false,registration=false,followup=false;
    for(const row of Array.isArray(batch?.rows)?batch.rows.slice(1):[]){
      const signals=businessSignals(row,batch.mapping||{},headers);
      ticket=ticket||signals.ticket;deposit=deposit||signals.deposit;registration=registration||signals.registration;followup=followup||signals.followup;
      if([ticket,deposit,registration,followup].filter(Boolean).length>1)return 'mixed';
    }
    if(!ticket&&!deposit&&!registration&&!followup){
      // An AI hint is advisory only. It cannot turn a customer export into a
      // business batch without a concrete business value in the mapped rows.
      return 'customer';
    }
    return ticket?'ticket':deposit?'deposit':registration?'registration':'followup';
  }
  function detectImportDomain(headers=[]){
    const values=(headers||[]).map(clean),joined=values.join('|');
    const phoneRegistry=/(手机位置|设备|多开手机)/i.test(joined)&&/(编号|code)/i.test(joined)&&/(所属角色|角色|role)/i.test(joined)&&/(接码渠道|接码|channel)/i.test(joined);
    return phoneRegistry?'phone-registry':'customer-business';
  }
  function explainImportDecision(row,mapping={},headers=[],options={}){
    const domain=detectImportDomain(headers),batchMode=domain==='phone-registry'?'phone-registry':importHint(options.batchMode||options.target||'')||importBatchMode({headers,rows:[headers,row],mapping}),route=inferRowClassification(row,mapping,headers,{aliases:options.aliases||{},filename:options.filename||''}),sourceReview=resolveImportSource(route,mappedValue(row,mapping,'source'),sourceSignal(options.filename||'',options.aliases||{}),mappedValue(row,mapping,'page'),options.aliases||{},options.defaultSource||''),signals=businessSignals(row,mapping,headers),classification=classifyImportRow({recordType:mappedValue(row,mapping,'recordType'),product:mappedValue(row,mapping,'product'),direction:mappedValue(row,mapping,'direction'),amount:mappedValue(row,mapping,'amount'),currency:mappedValue(row,mapping,'currency')},{target:batchMode}),reasons=[];
    let target='customer';
    if(domain==='phone-registry')target='phone-registry';
    else if(batchMode==='ticket'||classification.type==='ticket'&&signals.ticket)target='ticket';
    else if(batchMode==='deposit'||classification.type==='deposit'&&signals.deposit)target='deposit';
    else if(batchMode==='registration'||classification.type==='registration'&&signals.registration)target='registration';
    else if(batchMode==='followup'||classification.type==='followup'&&signals.followup)target='followup';
    else if(batchMode==='mixed')target=[['ticket',signals.ticket],['deposit',signals.deposit],['registration',signals.registration],['followup',signals.followup]].find(([,matched])=>matched)?.[0]||'customer';
    reasons.push(domain==='phone-registry'?'手机号登记表头命中，固定走本地登记导入，不调用 AI':`批次模式 ${batchMode||'customer'}，本行路由到 ${target}`);
    if(route.source)reasons.push(`渠道 ${route.source}（${route.sourceOrigin||'内容识别'}，置信度 ${Math.round((route.sourceConfidence||0)*100)}%）`);
    if(route.status)reasons.push(`状态 ${route.status}（${route.statusOrigin||'内容识别'}）`);
    const registered=date(mappedValue(row,mapping,'registered')),nextFollow=date(mappedValue(row,mapping,'nextFollow')||mappedValue(row,mapping,'due')),followDate=date(mappedValue(row,mapping,'followDate')),buyDate=date(mappedValue(row,mapping,'buyDate')),sellDate=date(mappedValue(row,mapping,'sellDate'));
    if(registered)reasons.push(`登记日期 ${registered}`);
    if(nextFollow)reasons.push(`下次跟进 ${nextFollow}`);
    if(followDate||buyDate||sellDate)reasons.push(`业务日期 ${buyDate||sellDate||followDate}`);
    const confidence=domain==='phone-registry'?1:Math.max(0,Math.min(1,Math.min(sourceReview.source?sourceReview.confidence||0.72:0.55,Number(classification.confidence)||1)));
    const needsReview=domain!=='phone-registry'&&(sourceReview.needsReview||classification.confidence<0.8||target==='mixed');
    return {domain,target,batchMode,source:sourceReview.source||'',status:route.status||'',dates:{registered,nextFollow,followDate,buyDate,sellDate},confidence,needsReview,reasons,sourceCandidates:sourceReview.candidates||[],aiRequired:false};
  }
  function inferImportMode(headers=[],rows=[],mapping={},hint=''){return importBatchMode({headers,rows:[headers,...(rows||[])],mapping:{...(mapping||{}),recordTypeHint:hint}});}
  function summarizeImportBatch(batch={}){
    const headers=batch.headers||batch.rows?.[0]||[],rows=Array.isArray(batch.rows)?batch.rows.slice(1):[],mode=importBatchMode(batch),summary={mode,total:rows.length,customerRows:0,ticketRows:0,depositRows:0,registrationRows:0,followupRows:0,ambiguousRows:0,invalidRows:0,sourceCounts:{},statusCounts:{}};
    for(const row of rows){
      const phone=mappedValue(row,batch.mapping||{},'phone');
      if(phone&&!looksLikePhone(phone)){summary.invalidRows++;continue;}
      const route=inferRowClassification(row,batch.mapping||{},headers,{aliases:batch.aliases||{},filename:batch.filename});
      if(route.source)summary.sourceCounts[route.source]=(summary.sourceCounts[route.source]||0)+1;
      if(route.status)summary.statusCounts[route.status]=(summary.statusCounts[route.status]||0)+1;
      if(mode==='customer'){summary.customerRows++;continue;}
      const signals=businessSignals(row,batch.mapping||{},headers);
      if(signals.ticket)summary.ticketRows++;
      if(signals.deposit)summary.depositRows++;
      if(signals.registration)summary.registrationRows++;
      if(signals.followup)summary.followupRows++;
      if(!signals.ticket&&!signals.deposit&&!signals.registration&&!signals.followup)summary.ambiguousRows++;
    }
    return summary;
  }
  function shouldWriteBusinessRow(row,mapping,batchMode='',headers=[]){
    const mode=importHint(batchMode);
    if(mode==='customer')return false;
    const signals=businessSignals(row,mapping||{},headers);
    if(mode==='ticket')return signals.ticket;
    if(mode==='deposit')return signals.deposit;
    if(mode==='registration')return signals.registration;
    if(mode==='followup')return signals.followup;
    return signals.ticket||signals.deposit||signals.registration||signals.followup;
  }
  // Customer summary dates are projections of the independent follow-up
  // ledger.  Imports may be sorted newest-first, oldest-first or mixed, so a
  // later loop iteration must never move the customer summary backwards.  For
  // two records on the same day, keep the furthest valid next-follow date so
  // the result is deterministic regardless of row order.
  function latestFollowSummary(current={},incoming={}){
    const currentLast=date(current.lastFollow),incomingDate=date(incoming.date),currentDue=date(current.due),incomingDue=date(incoming.nextDate);
    const fallbackLast=currentLast||clean(current.lastFollow),fallbackDue=currentDue||clean(current.due);
    if(!incomingDate||(currentLast&&incomingDate<currentLast))return {lastFollow:fallbackLast,due:fallbackDue,accepted:false};
    const newer=!currentLast||incomingDate>currentLast;
    const due=incomingDue&&(newer||!currentDue||incomingDue>currentDue)?incomingDue:fallbackDue;
    return {lastFollow:incomingDate,due,accepted:true};
  }
  // Merge imported profile data into an existing customer without overwriting
  // information that is already present.  This is deliberately conservative:
  // import/AI suggestions may fill blanks and add additive facts, but a
  // manually entered value remains authoritative until the user changes it.
  function mergeCustomerFields(customer={},incoming={},options={}){
    if(!customer||typeof customer!=='object')return {customer,changedFields:[]};
    const changedFields=[];
    const locked=new Set([...(Array.isArray(customer.manualLockedFields)?customer.manualLockedFields:[]),...(Array.isArray(customer.aiLockedFields)?customer.aiLockedFields:[])].map(clean));
    const placeholder=/^(?:未命名客户|未命名|未知客户|未知|未分类|未分配|—|-|无)$/i;
    const empty=(field,value)=>{const text=clean(value);if(!text)return true;if(field==='name')return placeholder.test(text);return false;};
    const fill=(field,value)=>{if(locked.has(field)||value===undefined||value===null||!empty(field,customer[field])||empty(field,value))return false;const next=typeof value==='number'?value:clean(value);if(next===''||next===null||next===undefined)return false;customer[field]=next;changedFields.push(field);return true;};
    for(const field of ['name','rawPhone','phone','source','page','channel','assistant','status','phase','qualification','country','language','occupation','age','budget','productInterest','group','registered','lastFollow','due','note']){
      const value=incoming[field];
      if(field==='age'&&value!==undefined&&value!==null&&value!==''&&Number.isFinite(Number(value))){const age=Number(value);if(age>=0&&age<=120)fill(field,age);continue;}
      fill(field,value);
    }
    if(!locked.has('vipNumber')&&empty('vipNumber',customer.vipNumber)&&clean(incoming.vipNumber)){customer.vipNumber=clean(incoming.vipNumber);changedFields.push('vipNumber');}
    // These are additive summary facts from a customer-center export.  A
    // positive fact may be added, never cleared by a later import.
    for(const field of ['hot','investor','ticket','deposit'])if(!locked.has(field)&&incoming[field]===true&&customer[field]!==true){customer[field]=true;changedFields.push(field);}
    const incomingAmount=Number(incoming.amount);const currentAmount=Number(customer.amount);
    if(!locked.has('amount')&&Number.isFinite(incomingAmount)&&incomingAmount>0&&(!Number.isFinite(currentAmount)||currentAmount<=0)){customer.amount=incomingAmount;changedFields.push('amount');}
    if(!locked.has('tags')&&Array.isArray(incoming.tags)&&incoming.tags.length){const tags=[...new Set([...(Array.isArray(customer.tags)?customer.tags:[]),...incoming.tags.map(clean).filter(Boolean)])];if(JSON.stringify(tags)!==JSON.stringify(customer.tags||[])){customer.tags=tags;changedFields.push('tags');}}
    if(changedFields.length)customer.importUpdatedAt=new Date().toISOString();
    return {customer,changedFields:[...new Set(changedFields)]};
  }
  function parseNaturalLine(line,aliases){const raw=clean(line);if(!raw)return null;const labelled=pattern=>{const match=raw.match(pattern);return clean(match?.[1]||'');};const phoneLabel=labelled(/(?:手机号码|手机号|联系电话|电话|号码|whatsapp(?:号码|号)?|微信号)\s*[:：=]?\s*([+\d][\d\s().-]{7,})/i),phoneMatches=[...raw.matchAll(/(?:\+?\d[\d\s().-]{7,}\d)/g)],phoneMatch=phoneMatches.find(match=>looksLikePhone(match[0])),phoneCandidate=phoneLabel||(phoneMatch?.[0]||''),phoneRaw=phoneCandidate,phone=phoneRaw.replace(/\D/g,'').replace(/^91(?=\d{10}$)/,''),vipNumber=labelled(/(?:VIP编号|VIP号|会员编号|会员号|VIP代码|vip(?:number|id|code)?)\s*[:：=]?\s*([A-Za-z0-9][A-Za-z0-9_-]{0,63})/i);const sourceExplicit=labelled(/(?:渠道|来源|归属|来源渠道|客户来源)\s*[:：=]?\s*([^\s,，;；|]+)/i),statusExplicit=labelled(/(?:进群状态|群状态|客户状态|状态)\s*[:：=]?\s*([^\s,，;；|]+)/i),labelledDate=labelled(/(?:登记日期|注册日期|入群日期|添加日期|日期|时间|date)\s*[:：=]?\s*([^\s,，;；|]+)/i),dateMatch=labelledDate?'':(raw.match(/(?:\d{4}[年./-]\d{1,2}[月./-]\d{1,2}日?|\d{1,2}[./-]\d{1,2}[./-]\d{4}|\b\d{8}\b)/)||[])[0],dateRaw=labelledDate||dateMatch,registered=date(dateRaw),rest=raw.replace(phoneMatch?.[0]||'',' ').replace(phoneLabel,' ').replace(dateMatch||'',' ').replace(/(?:VIP编号|VIP号|会员编号|会员号|VIP代码|vip(?:number|id|code)?)\s*[:：=]?\s*[^\s,，;；|]+/gi,' ').replace(/(?:渠道|来源|归属|来源渠道|客户来源|进群状态|群状态|客户状态|状态|登记日期|注册日期|入群日期|添加日期|日期|时间|date)\s*[:：=]?\s*[^\s,，;；|]+/gi,' '),source=normalizeSource(sourceExplicit,rest,'',aliases),status=normalizeValue(statusExplicit||((rest.match(/未进群|已进群|在群(?:里)?|已退群|临时退群|退群|重粉|无效/)||[])[0]||''),'status',aliases),tokens=rest.replace(/[:：=]/g,' ').split(/[\s,，;；|/]+/).map(clean).filter(Boolean),exclude=/(群粉|群导|社群|群组|单导|私聊|广告|落地页|自然流量|已进群|未进群|在群|退群|重粉|无效|登记|注册|入群|日期|时间|来源|渠道|状态|VIP|会员)/i,name=tokens.find(token=>/[\u3400-\u9fffA-Za-z]/.test(token)&&!exclude.test(token)&&!looksLikePhone(token)&&!date(token))||'',confidence=(phone?60:0)+(name?20:0)+(source?10:0)+(status?5:0)+(registered?5:0)+(vipNumber?5:0);return {phone,rawPhone:phoneRaw,source,status,registered,name,vipNumber,confidence,sourceOrigin:sourceExplicit?'资料':source?'识别':'',statusOrigin:statusExplicit?'资料':status?'识别':'',dateOrigin:registered?(labelledDate?'资料':'识别'):'',recordType:inferRecordType({source,status,name},raw)};}
  function headerSignature(headers){return (headers||[]).map(key).join('|');}
  function mappingConfidence(headers,mapping){const total=Math.max(1,(headers||[]).length),required=['phone'],mapped=Object.keys(mapping||{}),requiredHit=required.filter(k=>mapping?.[k]!=null).length,score=Math.min(100,Math.round((requiredHit?55:0)+(mapped.length/Math.max(1,Math.min(total,8)))*45));return {score,required:requiredHit===required.length,mapped:mapped.length,total};}
  function applyMappingProfile(headers,mapping,profiles){const list=Array.isArray(profiles)?profiles:[],signature=headerSignature(headers),profile=list.find(item=>item?.signature===signature);if(!profile?.mapping)return {mapping,profile:null,confidence:mappingConfidence(headers,mapping)};const next={...mapping};for(const [field,index] of Object.entries(profile.mapping))if(Number.isInteger(index)&&index>=0&&index<headers.length)next[field]=index;return {mapping:next,profile,confidence:mappingConfidence(headers,next)};}
  function rememberMappingProfile(profiles,headers,mapping,max=30){const list=Array.isArray(profiles)?profiles.filter(item=>item&&typeof item==='object'):[],signature=headerSignature(headers),prior=list.find(item=>item.signature===signature),entry={...prior,signature,headers:(headers||[]).map(clean).slice(0,80),mapping:Object.fromEntries(Object.entries(mapping||{}).filter(([,index])=>Number.isInteger(index)&&index>=0)),updatedAt:new Date().toISOString()};return [entry,...list.filter(item=>item.signature!==signature)].slice(0,max);}
  function saveMappingProfile(profiles,name,headers,mapping,max=30){const label=clean(name).slice(0,80)||'未命名映射';const list=rememberMappingProfile(profiles,headers,mapping,max);return list.map(item=>item.signature===headerSignature(headers)?{...item,name:label}:item);}
  function mappingSuggestions(headers,mapping){const suggestions=[];if(mapping?.phone==null)suggestions.push('未识别手机号码列，请确认号码字段或检查样本值');if(mapping?.name==null)suggestions.push('未识别姓名列，可选择客户姓名或联系人');if(mapping?.source==null)suggestions.push('未识别渠道列，将从文件名、工作表名和内容自动推断');if(mapping?.status==null)suggestions.push('未识别状态列，将按渠道和状态关键词自动推断');return suggestions;}
  function rowSuggestions(row){const suggestions=[];if(!row?.phone)suggestions.push('补充手机号码');else if(String(row.phone).length!==10)suggestions.push('检查号码位数');if(row?.confidence!=null&&row.confidence<70)suggestions.push('补充姓名、渠道或登记日期');if(row?.source&&/[\/|或、]/.test(row.source))suggestions.push('渠道存在多个候选值');if(row?.status&&/[\/|或、]/.test(row.status))suggestions.push('状态存在多个候选值');return unique(suggestions);}
  function csvRowSuggestions(row){const suggestions=[];if(!row?.name)suggestions.push('缺少姓名');if(row?.source&&/[\/|或、]/.test(row.source))suggestions.push('渠道有多个候选值');if(row?.status&&/[\/|或、]/.test(row.status))suggestions.push('状态有多个候选值');if(row?.recordType&&/[\/|或、]/.test(row.recordType))suggestions.push('业务类型有多个候选值');return unique(suggestions);}
  window.ZhikeSmartImport={date,normalizeValue,normalizeSource,resolveImportSource,shouldReviewSource,sourceSignal,looksLikePhone,looksLikeAmount,canonicalImportField,inferHeaderMapping,detectHeaderRow,detectImportDomain,explainImportDecision,normalizeImportTarget:importHint,inferImportMode,inferRecordType,classifyImportRow,classifyRow,importBatchMode,summarizeImportBatch,shouldWriteBusinessRow,latestFollowSummary,looksLikeCustomerExport,mergeCustomerFields,inferRowClassification,parseNaturalLine,headerSignature,mappingConfidence,applyMappingProfile,rememberMappingProfile,saveMappingProfile,mappingSuggestions,rowSuggestions,csvRowSuggestions};
})();
