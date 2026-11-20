'use strict';

// Expected status, number of group clicks, All restorations, and prior-row eligibility.
const filterCases = {
  waBusiness: ['selected',1,1,true],
  waAccessibleSearch: ['selected',1,1,true],
  waPaintedPlaceholder: ['selected',1,1,true],
  waRolelessMenu: ['selected',1,1,true],
  waAlreadySelected: ['selected',0,0,true],
  waSpoofed: ['ambiguous',0,0,false],
  waConcurrent: ['ambiguous',0,0,false],
  waFar: ['ambiguous',0,0,false],
  waForeignOwner: ['ambiguous',0,0,false],
  waUnchangedSearch: ['selection-unconfirmed',1,0,false],
  waOptimisticTab: ['selection-unconfirmed',1,1,false],
  waInactiveSearch: ['not-offered',0,0,false],
  visible: ['selected', 1, 1, false],
  recycled: ['selected', 1, 1, true],
  labelledPanel: ['selected', 1, 1, true],
  customSelected: ['ambiguous', 0, 0, false],
  rowMenu: ['not-checked', 0, 0, false],
  overflow: ['selected', 1, 1, false],
  business: ['selected', 1, 1, false],
  duplicateAll: ['not-offered', 0, 0, false],
  fakeLabels: ['not-offered', 0, 0, false],
  custom: ['not-offered', 0, 0, false],
  hidden: ['not-offered', 0, 0, false],
  ambiguous: ['ambiguous', 0, 0, false],
  busy: ['ambiguous', 0, 0, false],
  unconfirmed: ['selection-unconfirmed', 1, 0, false],
  alreadySelected: ['selected', 0, 0, true],
  foreground: ['not-checked', 0, 0, false],
  monitored: ['not-checked', 0, 0, false],
  cancelled: ['selecting', 1, 1, false],
};

function runFilterScenes(sample, cases, source) {
  return Object.keys(cases).map(scene => {
    if (scene.startsWith('wa')) {
      const side = document.createElement('div');
      side.id = 'side';
      side.style.cssText='position:fixed;left:8px;top:8px;width:360px;background:white';
      sample.replaceChildren(side);
      const search = scene === 'waPaintedPlaceholder' ? '<div><div role="textbox" contenteditable="true"></div><span class="hint" aria-hidden="true"></span></div>' : '<input>';
      side.innerHTML = search + '<div class="filters"></div><div id="pane-side"><div role="row"><button>Groups</button></div></div>';
      const toolbar=side.querySelector('.filters'), list=side.querySelector('#pane-side'), before=list.firstElementChild;
      const setSearch = value => {
        const hint=side.querySelector('.hint');
        if (hint) hint.textContent=value;
        else side.querySelector('input').setAttribute(scene === 'waAccessibleSearch' ? 'aria-label' : 'placeholder',value);
      };
      const dot = '<i class="label-swatch">●</i>';
      const down = '<svg width="16" height="16" aria-hidden="true"><path d="m2 5 6 6 6-6"/></svg>';
      const heart = '<svg width="16" height="16" aria-hidden="true"><path d="M2 7C2 2 7 2 8 5C9 2 14 2 14 7L8 14Z"/></svg>';
      const groupGlyph = '<svg width="16" height="16" aria-hidden="true"><path d="M1 14Q1 9 6 9Q11 9 11 14ZM7 4A2 2 0 1 0 3 4"/></svg>';
      let clicks=0,restores=0;
      const draw = selected => {
        setSearch(scene === 'waInactiveSearch' ? 'Search message history' : selected && !['waUnchangedSearch','waOptimisticTab'].includes(scene) ? 'Search group chats' : 'Search or start a new chat');
        toolbar.innerHTML = '<button>All</button>' + (selected ? '<button>Groups</button>' : '<button>Unread 2</button><button>'+dot+'10.27</button><button>'+dot+'商业</button><button>'+dot+'进群</button>')
          + '<button aria-label="More chat filters">'+down+'</button>';
        if (selected && scene === 'waOptimisticTab') {
          toolbar.setAttribute('data-testid','chat-list-filters');
          toolbar.firstElementChild.id='all-filter';
          toolbar.children[1].id='group-filter';
          toolbar.children[1].setAttribute('aria-pressed','true');
        }
        toolbar.firstElementChild.onclick=() => { restores++; draw(false); };
        const arrow=toolbar.lastElementChild;
        arrow.onclick=() => {
          const menu=document.createElement('div');
          if (scene !== 'waRolelessMenu') menu.setAttribute('role','menu');
          const rect=arrow.getBoundingClientRect();
          menu.id='fixture-group-menu';
          menu.style.cssText='position:fixed;z-index:20;width:164px;background:white;top:'+(rect.bottom+4)+'px;left:'+(scene === 'waFar' ? rect.right+100 : rect.left-75)+'px';
          const choices=['Groups','1','2','3','4','5','6','7','8'].map(n=>'<button>'+dot+n+'</button>').join('');
          menu.innerHTML = choices+'<button>'+heart+'Favourites</button><button>'+(scene === 'waSpoofed' ? dot : groupGlyph)+'Groups</button>';
          if (scene === 'waForeignOwner') before.setAttribute('aria-controls',menu.id);
          if (scene === 'waConcurrent') sample.insertAdjacentHTML('beforeend','<div role="menu">Unrelated</div>');
          for (const choice of menu.querySelectorAll('button')) choice.onclick=() => { throw Error('Selected non-platform filter entry'); };
          menu.lastElementChild.onclick=() => { clicks++; menu.remove(); draw(true); };
          sample.append(menu);
        };
      };
      draw(scene === 'waAlreadySelected');
      const exercise = new Function('list','row',`
        let cancelRowMenu=null;
        const backgroundCollectorRole=true,groupMonitoringAllowed=true,groupMonitorState={enabled:false};
        const allScanGeneration=1, allScan={generation:1,monitorOnly:false};
        const readHistoryScan=null, highPriorityHistoryRetryPending=false,lastListInteractionAt=0;
        const rowNodes=()=>Array.from(list.children),tasks=[],scheduleCollectorTask=cb=>tasks.push(cb);
        ${source}
        let prior=false;
        prepareDirectoryFilter(allScan,()=>{prior=groupFilterSelected(row);restoreDirectoryFilter(allScan);});
        while(tasks.length)tasks.shift()();
        return [groupFilterStatus,prior];`);
      const [status,prior]=exercise(list,before);
      if (restores && toolbar.querySelectorAll('button').length!==6) throw Error('All chat filter was not restored');
      sample.replaceChildren();
      return [status,clicks,restores,prior];
    }
    const allButton = '<button id="all-filter" aria-selected="true">All</button>';
    const groupButton = '<button id="group-filter" aria-selected="false">Groups</button>';
    const customButton = '<button aria-selected="false">Groups</button>';
    const overflowButton = '<button aria-label="More filters" aria-controls="more-filters" aria-expanded="false"><span data-icon="chevron-down"></span></button>';
    let chips = groupButton;
    const business = ['business','duplicateAll','fakeLabels'].includes(scene);
    if (scene === 'overflow' || business) chips = overflowButton;
    if (scene === 'custom') chips = customButton;
    if (scene === 'hidden') chips = '<section hidden>' + groupButton + '</section>';
    if (scene === 'ambiguous') chips += '<button data-testid="filter-groups">群组</button>';
    sample.innerHTML = '<div id="side"><div data-testid="chat-list-filters">' + allButton + chips + '</div><div id="pane-side"><div role="row"><button>Groups</button></div></div></div>';
    const toolbar = sample.querySelector('[data-testid="chat-list-filters"]');
    const list = sample.querySelector('#pane-side'), before = list.firstElementChild;
    const original = toolbar.firstElementChild;
    if (business) {
      toolbar.removeAttribute('data-testid');
      original.removeAttribute('id');
      const mark=scene === 'fakeLabels' ? '' : '<i data-icon="label"></i>';
      original.insertAdjacentHTML('afterend','<button>Unread 2</button><button>'+mark+'Groups</button><button>'+mark+'Sales</button>');
      if (scene === 'duplicateAll') toolbar.lastElementChild.insertAdjacentHTML('beforebegin','<button>All</button>');
    }
    let clicks = 0, restores = 0;
    const onGroup = () => {
      clicks++;
      if (scene === 'unconfirmed') return;
      original.setAttribute('aria-selected', 'false');
      if (!toolbar.querySelector('#group-filter')) toolbar.insertAdjacentHTML('beforeend', groupButton);
      toolbar.querySelector('#group-filter').setAttribute('aria-selected', 'true');
      if (scene === 'recycled') before.setAttribute('data-id', 'new-conversation');
      if (scene === 'labelledPanel') list.setAttribute('aria-labelledby', 'group-filter');
      list.insertAdjacentHTML('beforeend', '<div role="row">mounted after filter</div>');
    };
    original.onclick = () => {
      restores++;
      original.setAttribute('aria-selected', 'true');
      toolbar.querySelector('#group-filter').setAttribute('aria-selected', 'false');
    };
    for (const b of toolbar.querySelectorAll('button')) if (b !== original) b.onclick = onGroup;
    if (scene === 'customSelected') {
      original.setAttribute('aria-selected', 'false');
      toolbar.insertAdjacentHTML('beforeend', '<button aria-selected="true">My lists</button>');
    }
    if (scene === 'alreadySelected') {
      original.setAttribute('aria-selected', 'false');
      toolbar.querySelector('#group-filter').setAttribute('aria-selected', 'true');
    }
    if (scene === 'busy') sample.insertAdjacentHTML('beforeend', '<div role="menu"><button>Unrelated</button></div>');
    if (scene === 'overflow' || business) {
      const arrow = toolbar.lastElementChild;
      arrow.onclick = () => {
        arrow.setAttribute('aria-expanded', 'true');
        sample.insertAdjacentHTML('beforeend', '<div role="menu" id="more-filters"><button aria-label="Groups">Groups</button><button data-testid="filter-groups">Groups</button></div>');
        const menu = sample.querySelector('#more-filters');
        menu.lastElementChild.onclick = () => { menu.remove(); arrow.setAttribute('aria-expanded', 'false'); onGroup(); };
        menu.firstElementChild.onclick = () => { throw Error('Clicked custom label'); };
      };
    }
    const exercise = new Function('scene','list','before',`
      let cancelRowMenu=scene === 'rowMenu' ? () => {} : null;
      const backgroundCollectorRole=scene !== 'foreground', groupMonitoringAllowed=true;
      const groupMonitorState={enabled:scene === 'monitored',status:'running',targets:[{enabled:true}]};
      let allScanGeneration=1, allScan={generation:1,monitorOnly:false};
      const readHistoryScan=null, highPriorityHistoryRetryPending=false, lastListInteractionAt=0;
      const rowNodes=() => Array.from(list.children), tasks=[], scheduleCollectorTask=cb => tasks.push(cb);
      ${source}
      const run=allScan;
      let prior;
      prepareDirectoryFilter(run,() => {
        prior=groupFilterSelected(before);
        if (['visible','overflow','business','recycled','labelledPanel'].includes(scene) && !groupFilterSelected(list.lastElementChild))
          throw Error('Missing official filter evidence on newly mounted row');
        restoreDirectoryFilter(run);
      });
      if (scene === 'cancelled') {
        allScanGeneration++; restoreDirectoryFilter(run); allScan=null;
        prior=false;
      }
      while (tasks.length) tasks.shift()();
      return [groupFilterStatus,prior];`);
    const [status,prior] = exercise(scene,list,before);
    sample.replaceChildren();
    return [status,clicks,restores,prior];
  });
}

module.exports = { filterCases, runFilterScenes };
