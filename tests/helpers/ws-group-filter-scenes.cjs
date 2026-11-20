'use strict';

// Expected status, number of group clicks, All restorations, and prior-row eligibility.
const filterCases = {
  visible: ['selected', 1, 1, false],
  recycled: ['selected', 1, 1, true],
  labelledPanel: ['selected', 1, 1, true],
  customSelected: ['ambiguous', 0, 0, false],
  rowMenu: ['not-checked', 0, 0, false],
  overflow: ['selected', 1, 1, false],
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
    const allButton = '<button id="all-filter" aria-selected="true">All</button>';
    const groupButton = '<button id="group-filter" aria-selected="false">Groups</button>';
    const customButton = '<button aria-selected="false">Groups</button>';
    const overflowButton = '<button aria-label="More filters" aria-controls="more-filters" aria-expanded="false"><span data-icon="chevron-down"></span></button>';
    let chips = groupButton;
    if (scene === 'overflow') chips = overflowButton;
    if (scene === 'custom') chips = customButton;
    if (scene === 'hidden') chips = '<section hidden>' + groupButton + '</section>';
    if (scene === 'ambiguous') chips += '<button data-testid="filter-groups">群组</button>';
    sample.innerHTML = '<div id="side"><div data-testid="chat-list-filters">' + allButton + chips + '</div><div id="pane-side"><div role="row"><button>Groups</button></div></div></div>';
    const toolbar = sample.querySelector('[data-testid="chat-list-filters"]');
    const list = sample.querySelector('#pane-side'), before = list.firstElementChild;
    const original = toolbar.firstElementChild;
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
    for (const b of toolbar.querySelectorAll('button:not(#all-filter)')) b.onclick = onGroup;
    if (scene === 'customSelected') {
      original.setAttribute('aria-selected', 'false');
      toolbar.insertAdjacentHTML('beforeend', '<button aria-selected="true">My lists</button>');
    }
    if (scene === 'alreadySelected') {
      original.setAttribute('aria-selected', 'false');
      toolbar.querySelector('#group-filter').setAttribute('aria-selected', 'true');
    }
    if (scene === 'busy') sample.insertAdjacentHTML('beforeend', '<div role="menu"><button>Unrelated</button></div>');
    if (scene === 'overflow') {
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
        if (['visible','overflow','recycled','labelledPanel'].includes(scene) && !groupFilterSelected(list.lastElementChild))
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
