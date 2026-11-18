(() => {
  const defaults={workspace_name:'本地客户库',workspace_subtitle:'离线数据空间',admin_name:'本地管理员',home_title:'今日工作台',home_subtitle:'本地客户运营概览 · 今天先处理最重要的事'};
  const notify=(message,icon='x')=>{const host=window.__zhikeRegistryHost;if(host?.toast){host.toast(String(message),icon);return;}console.warn(String(message));};
  let config={},scheduled=false;
  const setText=(selector,value)=>{const node=document.querySelector(selector);if(node&&value&&node.textContent!==value)node.textContent=value;};
  function applyMenu(item,key){const setting=config.menu?.[key];if(!setting)return;const label=item.querySelector('span');if(label&&setting.label)label.textContent=String(setting.label).slice(0,32);item.hidden=setting.visible===false;}
  function apply(){
    scheduled=false;
    if(config.theme)document.documentElement.dataset.theme=config.theme;
    if(config.density)document.documentElement.dataset.density=config.density;
    setText('#workspaceName',config.workspace_name||defaults.workspace_name);setText('#workspaceSubtitle',config.workspace_subtitle||defaults.workspace_subtitle);setText('#adminName',config.admin_name||defaults.admin_name);
    for(const item of document.querySelectorAll('#mainNav [data-view]'))applyMenu(item,item.dataset.view);const gpt=document.querySelector('#gptAssistantNav');if(gpt)applyMenu(gpt,'gpt');
    const title=document.querySelector('#viewContainer .page-title');if(title&&(title.textContent.trim()==='今日工作台'||title.dataset.runtimeHome==='1')){title.dataset.runtimeHome='1';const homeTitle=config.home_title||defaults.home_title,homeSubtitle=config.home_subtitle||defaults.home_subtitle;if(title.textContent!==homeTitle)title.textContent=homeTitle;const subtitle=title.closest('.page-heading')?.querySelector('.page-subtitle');if(subtitle&&subtitle.textContent!==homeSubtitle)subtitle.textContent=homeSubtitle;}
  }
  function schedule(){if(scheduled)return;scheduled=true;requestAnimationFrame(apply);}
  async function load(){try{const response=await fetch('/api/state',{cache:'no-store'});if(!response.ok)return;const state=await response.json();config=state.settings?.runtimeCustomization||{};apply();renderSettingsPanel();}catch(error){console.warn('运行时工作台配置读取失败',error);}}
  function renderSettingsPanel(){
    if(!document.querySelector('[data-view="settings"].active'))return;const root=document.querySelector('#viewContainer');if(!root||root.querySelector('#runtimeCustomizationPanel'))return;
    const count=Object.keys(config).filter(key=>key!=='menu').length+Object.keys(config.menu||{}).length,panel=document.createElement('section');panel.className='panel';panel.id='runtimeCustomizationPanel';panel.innerHTML=`<div class="panel-heading"><div><h2 class="panel-title">GPT 工作台内容</h2><p class="page-subtitle">当前有 ${count} 组运行时配置。GPT 只能修改显示配置，不能改启动、数据库或安全代码。</p></div><button class="btn" id="resetRuntimeCustomization" type="button" ${count?'':'disabled'}>恢复默认内容</button></div>`;root.append(panel);panel.querySelector('button')?.addEventListener('click',reset);
  }
  async function reset(){
    if(!confirm('恢复工作台默认内容？客户资料和业务数据不会改变，恢复前会创建快照。'))return;
    try{const response=await fetch('/api/state',{cache:'no-store'});if(!response.ok)throw new Error('读取本机数据失败');const state=await response.json(),version=String(state.version||'');const snapshot=await fetch('/api/snapshot',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({reason:'恢复工作台默认内容前自动快照'})});if(!snapshot.ok)throw new Error('快照创建失败');state.settings=state.settings||{};delete state.settings.runtimeCustomization;delete state.version;delete state.initialized;const saved=await fetch('/api/state',{method:'PUT',headers:{'Content-Type':'application/json','X-State-Version':version},body:JSON.stringify(state)});if(!saved.ok)throw new Error('默认内容保存失败');location.reload();}catch(error){notify(`恢复失败：${error.message}`);}
  }
  window.addEventListener('zhike-runtime-config-updated',load);
  const viewRoot=document.querySelector('#viewContainer');
  if(viewRoot)new MutationObserver(()=>{schedule();renderSettingsPanel();}).observe(viewRoot,{childList:true});
  load();
})();

// Transfer guidance reuses the established export/restore actions.
(() => {
  const key='zhike-motion-preference';
  function read(){try{return localStorage.getItem(key)||'system';}catch{return 'system';}}
  function apply(value){document.documentElement.dataset.motion=value;}
  apply(read());
  const view=document.querySelector('#viewContainer');
  if(!view)return;
  function mount(){
    const heading=view.querySelector('h1');
    if(!heading?.textContent.includes('系统设置')||view.querySelector('#motionPreference'))return;
    const panel=document.createElement('section');panel.className='panel motion-settings';
    panel.innerHTML='<div class="panel-heading"><h2 class="panel-title">界面动效</h2></div><div class="motion-settings-body"><label for="motionPreference">渐变流动与交互动画</label><select id="motionPreference"><option value="system">跟随系统</option><option value="off">关闭动效</option></select><p>关闭后保留渐变配色，停止流动、呼吸和过渡动画。此偏好保存在当前电脑。</p></div>';
    view.append(panel);const input=panel.querySelector('select');input.value=read();
    input.addEventListener('change',()=>{apply(input.value);try{localStorage.setItem(key,input.value);}catch{}});
  }
  new MutationObserver(mount).observe(view,{childList:true});mount();
})();

// Transfer guidance reuses the established export/restore actions.
(() => {
  const view = document.querySelector('#viewContainer');
  if (!view) return;
  function mount() {
    if (!view.querySelector('#backupFile') || view.querySelector('#transferGuide')) return;
    const panel = document.createElement('section');
    panel.id = 'transferGuide';
    panel.className = 'panel transfer-guide';
    panel.innerHTML = `<div class="panel-heading"><h2 class="panel-title">业务 JSON 备份与恢复</h2><span class="panel-note">业务记录备份 · 非完整设备迁移</span></div>
      <div class="transfer-steps">
        <article><span class="transfer-number">1</span><h3>旧电脑：导出业务备份</h3><p>备份客户、跟进、报名、跟票、入金等本地业务记录。此入口不覆盖全部 WS、AI 账本、媒体文件及设备设置。</p><button class="btn primary" data-action="backup">导出业务 JSON 备份</button></article>
        <article><span class="transfer-number">2</span><h3>新电脑：选择备份恢复</h3><p>打开工作台后选择 JSON 文件。系统会检查格式、展示数量差异，并在替换前保存当前工作区快照。</p><button class="btn" data-action="import-backup">选择备份并预览</button></article>
        <article><span class="transfer-number">3</span><h3>恢复后：核对资料</h3><p>核对客户与业务记录数量、任务和设置。GPT API Key 请重新填写；自动快照仅用于原工作区回退。</p><button class="btn" id="transferVerify">查看当前记录数量</button></article>
      </div><div id="transferStatus" class="transfer-status" role="status" aria-live="polite">JSON 仅恢复其已包含的业务记录，客户 CSV 仅用于表格交换；完整设备迁移尚未启用。</div>`;
    view.querySelector('.business-summary')?.after(panel);
    panel.querySelector('#transferVerify').addEventListener('click', async () => {
      const status = panel.querySelector('#transferStatus');
      status.textContent = '正在读取当前工作区…';
      try {
        const response = await fetch('/api/state', {cache:'no-store'});
        if (!response.ok) throw new Error('读取失败，请检查保存状态后重试。');
        const state = await response.json();
        const labels = {customers:'客户',followups:'跟进',registrations:'报名',tickets:'跟票',deposits:'入金',phoneRegistry:'号码登记'};
        status.textContent = Object.entries(labels).map(([key,label]) => `${label} ${Array.isArray(state[key]) ? state[key].length : 0}`).join(' · ');
      } catch (error) { status.textContent = error.message; }
    });
  }
  new MutationObserver(mount).observe(view, {childList:true});
  mount();
})();
