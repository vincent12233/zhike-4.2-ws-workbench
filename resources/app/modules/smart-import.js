(()=>{
  const clean=value=>String(value??'').normalize('NFKC').trim();
  const key=value=>clean(value).toLowerCase().replace(/[\s_\-\/\\（）()【】\[\]：:，,。·]/g,'');
  const unique=list=>[...new Set((list||[]).filter(Boolean))];
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
    phone:['标准号码','原始号码','客户号码','手机号码','手机号','联系电话','联系电话号码','电话','号码','微信号','whatsapp号码','whatsapp号','phone','phoneraw','phonenormalized','phonenumber','mobile','mobilephone','cellphone','number','contact'],
    source:['渠道','数据归属','客户归属','来源类型','来源渠道','获客渠道','客户来源','归属','source','leadsource','channel','origin'],
    page:['页面分类','单导页面','来源页面','来源表','来源工作表','source_sheet','页面','page','sheet'],
    assistant:['跟进助理','负责人','跟进人','销售','助理','assistant','owner','agent','sales'],
    status:['进群状态','群状态','客户状态','跟进状态','状态','group_status','status','state'],
    phase:['客户阶段','客户状态阶段','销售阶段','客户分层','customer_stage','阶段','phase','stage'],
    qualification:['资质评级','资质等级','客户资质','客户评级','qualification','qualification_level','rating','grade'],
    group:['群编号','群号','群组编号','群组','group_code','groupid','group_no','group'],
    registered:['登记日期','登记时间','注册日期','注册时间','入群日期','添加日期','导入日期','创建时间','录入时间','首次联系时间','registered_at','registerdate','createdat','日期','时间','registered','date'],
    note:['备注','客户备注','跟进备注','说明','note','notes','remark','comment'],
    recordType:['记录类型','业务类型','数据类型','类型','recordtype','businesstype','type'],
    product:['产品','产品代码','股票','股票代码','股票名称','证券代码','品种','product','productcode','symbol','stock','stockcode'],
    direction:['方向','买卖方向','买卖','操作','交易方向','direction','side','action'],
    amount:['金额','入金金额','充值金额','付款金额','成交金额','amount','deposit','payment','value'],
    currency:['币种','货币','currency','ccy'],
    businessNote:['业务备注','交易备注','入金备注','记录备注','businessnote','transactionnote'],
    followDate:['跟票日期','入金日期','业务日期','交易日期','交易时间','followdate','businessdate','transactiondate']
  };
  const headerPatterns={
    name:/(姓名|名称|联系人|昵称|name|customer|client)/i,
    phone:/(电话|手机|号码|手机号|whatsapp|微信号|phone|mobile|cell|contact)/i,
    source:/(渠道|来源|归属|source|channel|origin|lead)/i,
    page:/(页面|来源表|工作表|sheet|page)/i,
    assistant:/(助理|负责人|跟进人|销售|assistant|owner|agent|sales)/i,
    status:/(状态|进群|群状态|status|state)/i,
    phase:/(阶段|分层|phase|stage)/i,
    qualification:/(资质|评级|等级|qualification|rating|grade)/i,
    group:/(群号|群编号|群组|group)/i,
    registered:/(登记|注册|入群|添加|创建|录入|联系|日期|时间|date|time)/i,
    note:/(备注|说明|note|remark|comment)/i,
    recordType:/(记录类型|业务类型|数据类型|类型|record|business|type)/i,
    product:/(产品|股票|证券|品种|代码|symbol|product|stock)/i,
    direction:/(方向|买卖|操作|side|action)/i,
    amount:/(金额|入金|充值|付款|成交|amount|deposit|payment|value)/i,
    currency:/(币种|货币|currency|ccy)/i,
    businessNote:/(业务备注|交易备注|入金备注|business|transaction)/i,
    followDate:/(跟票|入金|业务|交易).*(日期|时间)|follow|businessdate|transactiondate/i
  };
  function normalizeValue(value,kind,custom={}){const raw=clean(value),lookup=key(raw),customMap=custom?.[kind]||custom||{};for(const [alias,target] of Object.entries({...builtins[kind],...customMap}))if(key(alias)===lookup)return target;return raw;}
  function sourceSignal(value){const raw=clean(value);if(singleSourceSignal.test(raw))return '单导';if(groupSourceSignal.test(raw))return '群粉';return '';}
  function normalizeSource(value,page='',fallback='',aliases={}){const raw=clean(value),mapped=normalizeValue(raw,'source',aliases),safeFallback=clean(fallback),safePage=clean(page);if(raw&&!nonBusinessSource.test(raw)){const direct=sourceSignal(raw)||sourceSignal(mapped);if(direct)return direct;if(mapped&&mapped!==raw&&!nonBusinessSource.test(mapped))return mapped;return raw;}const fallbackSignal=sourceSignal(safeFallback)||sourceSignal(normalizeValue(safeFallback,'source',aliases));if(fallbackSignal)return fallbackSignal;if(safeFallback&&!nonBusinessSource.test(safeFallback)){const normalizedFallback=normalizeValue(safeFallback,'source',aliases);if(normalizedFallback&&!nonBusinessSource.test(normalizedFallback))return normalizedFallback;}const pageSignal=sourceSignal(safePage)||sourceSignal(normalizeValue(safePage,'source',aliases));if(pageSignal)return pageSignal;return '';}
  function looksLikePhone(value){const raw=clean(value),digits=raw.replace(/\D/g,'');if(digits.length<8||digits.length>15||date(raw))return false;if(/^\d{1,6}(?:\.\d+)?$/.test(raw))return false;return /^\+?\d[\d\s().-]{7,}$/.test(raw);}
  function looksLikeAmount(value){const raw=clean(value).replace(/[,$￥₹€£\s]/g,'');return /^-?\d+(?:\.\d+)?$/.test(raw)&&!date(raw)&&!looksLikePhone(value);}
  function valuesFor(rows,index){return (Array.isArray(rows)?rows:[]).map(row=>Array.isArray(row)?row[index]:row?.[index]).map(clean).filter(Boolean).slice(0,30);}
  function fieldHintScore(field,values){if(!values.length)return 0;const ratio=pred=>values.filter(pred).length/values.length;if(field==='phone')return Math.round(ratio(looksLikePhone)*48);if(field==='registered'||field==='followDate')return Math.round(ratio(value=>Boolean(date(value)))*42);if(field==='amount')return Math.round(ratio(looksLikeAmount)*35);if(field==='source')return Math.round(ratio(value=>Boolean(sourceSignal(value)))*32);if(field==='status')return Math.round(ratio(value=>statusSignal.test(value))*32);if(field==='direction')return Math.round(ratio(value=>directionSignal.test(value))*32);if(field==='recordType')return Math.round(ratio(value=>Boolean(normalizeValue(value,'recordType')))*28);if(field==='currency')return Math.round(ratio(value=>/^[A-Za-z]{3}$/.test(value))*20);if(field==='name')return Math.round(ratio(value=>/[A-Za-z\u3400-\u9fff]/.test(value)&&!looksLikePhone(value)&&!date(value))*16);return 0;}
  function fieldCandidates(headers,rows,field,aliases){const aliasesKey=new Set((aliases||[]).map(key));return headers.map((header,index)=>{const normalized=key(header),values=valuesFor(rows,index);let score=0;if(aliasesKey.has(normalized))score+=100;else if((aliases||[]).some(alias=>normalized.includes(key(alias))||key(alias).includes(normalized)))score+=64;if(headerPatterns[field]?.test(normalized))score+=30;score+=fieldHintScore(field,values);if(field==='phone'&&/(日期|date|时间|time)/i.test(normalized))score-=80;if(field==='name'&&/(备注|note|电话|手机|号码|状态|日期)/i.test(normalized))score-=50;if(field==='registered'&&/(姓名|name|电话|phone)/i.test(normalized))score-=60;return {index,score};}).filter(item=>item.score>0).sort((a,b)=>b.score-a.score||a.index-b.index);}
  function inferHeaderMapping(headers,sampleRows=[],options={}){const normalizedHeaders=(headers||[]).map(clean),fields=options.fields||Object.entries(fieldAliases).map(([field,aliases])=>[field,'',aliases]),mapping={},used=new Set(),ranked=[];for(const [field,,aliases] of fields)for(const candidate of fieldCandidates(normalizedHeaders,sampleRows,field,aliases))ranked.push({...candidate,field});ranked.sort((a,b)=>b.score-a.score||a.index-b.index);for(const item of ranked){if(mapping[item.field]!=null||used.has(item.index))continue;mapping[item.field]=item.index;used.add(item.index);}return mapping;}
  function detectHeaderRow(rows,options={}){const list=Array.isArray(rows)?rows:[],limit=Math.min(12,Math.max(1,list.length-1)),fields=options.fields||undefined;let best={index:0,headers:list[0]||[],mapping:{},score:0};for(let index=0;index<limit;index++){const headers=(list[index]||[]).map(clean);if(!headers.filter(Boolean).length)continue;const mapping=inferHeaderMapping(headers,list.slice(index+1,index+21),{fields}),mapped=Object.keys(mapping).length,score=(mapping.phone!=null?100:0)+mapped*8+Math.min(20,headers.filter(Boolean).length);if(score>best.score){best={index,headers,mapping,score};}}return {...best,confidence:mappingConfidence(best.headers,best.mapping)};}
  function inferRecordType(row={},context=''){const values=Object.values(row).map(clean).join(' '),hint=clean(row.recordType||row.type||context),normalized=normalizeValue(hint,'recordType').toLowerCase();if(/入金|充值|付款|deposit|payment/.test(normalized)||(row.amount!==undefined&&clean(row.amount)!==''))return 'deposit';if(/跟票|股票|买卖|ticket|stock/.test(normalized)||row.product||row.symbol||row.direction)return 'ticket';if(/报名|registration|register/.test(normalized))return 'registration';if(/跟进|回访|follow/.test(normalized))return 'followup';if(/入金|充值|付款|deposit|payment/.test(values))return 'deposit';if(/股票|证券|买入|卖出|ticket|stock/.test(values))return 'ticket';if(/报名|注册|registration/.test(values))return 'registration';if(/跟进|回访|follow/.test(values))return 'followup';return 'customer';}
  function classifyRow(row,aliases){return inferRecordType(row);}
  function parseNaturalLine(line,aliases){const raw=clean(line);if(!raw)return null;const labelled=pattern=>{const match=raw.match(pattern);return clean(match?.[1]||'');};const phoneLabel=labelled(/(?:手机号码|手机号|联系电话|电话|号码|whatsapp(?:号码|号)?|微信号)\s*[:：=]?\s*([+\d][\d\s().-]{7,})/i),phoneMatches=[...raw.matchAll(/(?:\+?\d[\d\s().-]{7,}\d)/g)],phoneMatch=phoneMatches.find(match=>looksLikePhone(match[0])),phoneCandidate=phoneLabel||(phoneMatch?.[0]||''),phoneRaw=phoneCandidate,phone=phoneRaw.replace(/\D/g,'').replace(/^91(?=\d{10}$)/,'');const sourceExplicit=labelled(/(?:渠道|来源|归属|来源渠道|客户来源)\s*[:：=]?\s*([^\s,，;；|]+)/i),statusExplicit=labelled(/(?:进群状态|群状态|客户状态|状态)\s*[:：=]?\s*([^\s,，;；|]+)/i),labelledDate=labelled(/(?:登记日期|注册日期|入群日期|添加日期|日期|时间|date)\s*[:：=]?\s*([^\s,，;；|]+)/i),dateMatch=labelledDate?'':(raw.match(/(?:\d{4}[年./-]\d{1,2}[月./-]\d{1,2}日?|\d{1,2}[./-]\d{1,2}[./-]\d{4}|\b\d{8}\b)/)||[])[0],dateRaw=labelledDate||dateMatch,registered=date(dateRaw),rest=raw.replace(phoneMatch?.[0]||'',' ').replace(phoneLabel,' ').replace(dateMatch||'',' ').replace(/(?:渠道|来源|归属|来源渠道|客户来源|进群状态|群状态|客户状态|状态|登记日期|注册日期|入群日期|添加日期|日期|时间|date)\s*[:：=]?\s*[^\s,，;；|]+/gi,' '),source=normalizeSource(sourceExplicit,rest,'',aliases),status=normalizeValue(statusExplicit||((rest.match(/未进群|已进群|在群(?:里)?|已退群|临时退群|退群|重粉|无效/)||[])[0]||''),'status',aliases),tokens=rest.replace(/[:：=]/g,' ').split(/[\s,，;；|/]+/).map(clean).filter(Boolean),exclude=/(群粉|群导|社群|群组|单导|私聊|广告|落地页|自然流量|已进群|未进群|在群|退群|重粉|无效|登记|注册|入群|日期|时间|来源|渠道|状态)/i,name=tokens.find(token=>/[\u3400-\u9fffA-Za-z]/.test(token)&&!exclude.test(token)&&!looksLikePhone(token)&&!date(token))||'',confidence=(phone?60:0)+(name?20:0)+(source?10:0)+(status?5:0)+(registered?5:0);return {phone,rawPhone:phoneRaw,source,status,registered,name,confidence,sourceOrigin:sourceExplicit?'资料':source?'识别':'',statusOrigin:statusExplicit?'资料':status?'识别':'',dateOrigin:registered?(labelledDate?'资料':'识别'):'',recordType:inferRecordType({source,status,name},raw)};}
  function headerSignature(headers){return (headers||[]).map(key).join('|');}
  function mappingConfidence(headers,mapping){const total=Math.max(1,(headers||[]).length),required=['phone'],mapped=Object.keys(mapping||{}),requiredHit=required.filter(k=>mapping?.[k]!=null).length,score=Math.min(100,Math.round((requiredHit?55:0)+(mapped.length/Math.max(1,Math.min(total,8)))*45));return {score,required:requiredHit===required.length,mapped:mapped.length,total};}
  function applyMappingProfile(headers,mapping,profiles){const list=Array.isArray(profiles)?profiles:[],signature=headerSignature(headers),profile=list.find(item=>item?.signature===signature);if(!profile?.mapping)return {mapping,profile:null,confidence:mappingConfidence(headers,mapping)};const next={...mapping};for(const [field,index] of Object.entries(profile.mapping))if(Number.isInteger(index)&&index>=0&&index<headers.length)next[field]=index;return {mapping:next,profile,confidence:mappingConfidence(headers,next)};}
  function rememberMappingProfile(profiles,headers,mapping,max=30){const list=Array.isArray(profiles)?profiles.filter(item=>item&&typeof item==='object'):[],signature=headerSignature(headers),prior=list.find(item=>item.signature===signature),entry={...prior,signature,headers:(headers||[]).map(clean).slice(0,80),mapping:Object.fromEntries(Object.entries(mapping||{}).filter(([,index])=>Number.isInteger(index)&&index>=0)),updatedAt:new Date().toISOString()};return [entry,...list.filter(item=>item.signature!==signature)].slice(0,max);}
  function saveMappingProfile(profiles,name,headers,mapping,max=30){const label=clean(name).slice(0,80)||'未命名映射';const list=rememberMappingProfile(profiles,headers,mapping,max);return list.map(item=>item.signature===headerSignature(headers)?{...item,name:label}:item);}
  function mappingSuggestions(headers,mapping){const suggestions=[];if(mapping?.phone==null)suggestions.push('未识别手机号码列，请确认号码字段或检查样本值');if(mapping?.name==null)suggestions.push('未识别姓名列，可选择客户姓名或联系人');if(mapping?.source==null)suggestions.push('未识别渠道列，将从文件名、工作表名和内容自动推断');if(mapping?.status==null)suggestions.push('未识别状态列，将按渠道和状态关键词自动推断');return suggestions;}
  function rowSuggestions(row){const suggestions=[];if(!row?.phone)suggestions.push('补充手机号码');else if(String(row.phone).length!==10)suggestions.push('检查号码位数');if(row?.confidence!=null&&row.confidence<70)suggestions.push('补充姓名、渠道或登记日期');if(row?.source&&/[\/|或、]/.test(row.source))suggestions.push('渠道存在多个候选值');if(row?.status&&/[\/|或、]/.test(row.status))suggestions.push('状态存在多个候选值');return unique(suggestions);}
  function csvRowSuggestions(row){const suggestions=[];if(!row?.name)suggestions.push('缺少姓名');if(row?.source&&/[\/|或、]/.test(row.source))suggestions.push('渠道有多个候选值');if(row?.status&&/[\/|或、]/.test(row.status))suggestions.push('状态有多个候选值');if(row?.recordType&&/[\/|或、]/.test(row.recordType))suggestions.push('业务类型有多个候选值');return unique(suggestions);}
  window.ZhikeSmartImport={date,normalizeValue,normalizeSource,sourceSignal,looksLikePhone,looksLikeAmount,inferHeaderMapping,detectHeaderRow,inferRecordType,classifyRow,parseNaturalLine,headerSignature,mappingConfidence,applyMappingProfile,rememberMappingProfile,saveMappingProfile,mappingSuggestions,rowSuggestions,csvRowSuggestions};
})();
