'use strict';

// Serialized into a local WebView2 fixture. Probe uses the production script,
// browser layout, native CSS selectors, DOM events and MutationObserver.
const scenes = [
  ['owned', ['Group info','Mark as unread'], 'verified-read-group', true],
  ['dropdown', ['Exit group','Mark as unread'], 'verified-read-group', true],
  ['business', ['Archive chat','Mute notifications','Unpin chat','Mark as unread','Add to favourites','Add to list','Clear chat','Exit group'], 'verified-read-group', true],
  ['business', ['Archive chat','Mark as unread','Clear chat','Delete chat'], 'type-unconfirmed', true],
  ['context', ['退出群组','标记为未读'], 'verified-read-group', true],
  ['owned', ['Group info','Mark as read'], 'unread', true],
  ['owned', ['Exit group','Mark as unread','Mark as read'], 'unread', true],
  ['owned', ['Contact info','Exit group','Mark as unread'], 'type-unconfirmed', true],
  ['owned', ['Group info'], 'read-state-unknown', true],
  ['foreign', ['Group info','Mark as unread'], 'menu-unowned', false],
  ['multiple', ['Group info','Mark as unread'], 'menu-unowned', false],
  ['nested', ['Group info','Mark as unread'], 'menu-unowned', false],
  ['recycled', ['Group info','Mark as unread'], 'row-changed', true],
  ['preexisting', ['Group info','Mark as unread'], 'navigation-busy', false],
  ['late', ['Group info','Mark as unread'], 'menu-unowned', false],
  ['absent', ['Group info','Mark as unread'], 'menu-unavailable', false],
];

async function runScenes(sample, definitions, inspectChatRowMenu) {
  const outputs = [];
  for (const [mode, labels] of definitions) {
    sample.innerHTML = '<div role="row" style="position:fixed;top:36px;left:16px;width:250px;height:36px"><span dir="auto" title="fixture">fixture</span></div><button id="other">Other</button>';
    const row = sample.querySelector('[role="row"]');
    const title = row.querySelector('span');
    const other = sample.querySelector('#other');
    const trigger = document.createElement('button');
    trigger.setAttribute('aria-haspopup','menu');
    trigger.textContent = '⋁';
    if (!['context','late','business'].includes(mode)) row.append(trigger);
    let escaped = false, itemClicks = 0, rowClicks = 0, openings = 0;
    row.addEventListener('click', () => rowClicks++);
    const buildMenu = event => {
      const menu = document.createElement('div');
      menu.id = 'example-menu';
      if (mode === 'dropdown') menu.setAttribute('data-animate-dropdown-menu','true');
      else if (mode !== 'business') menu.setAttribute('role','menu');
      const rect = trigger.getBoundingClientRect();
      const x = event.type === 'contextmenu' ? event.clientX : rect.left + rect.width / 2;
      const y = event.type === 'contextmenu' ? event.clientY : rect.top + rect.height / 2;
      Object.assign(menu.style,{position:'fixed',background:'white',left:x+'px',top:y+'px',width:'160px'});
      for (const label of labels) {
        const item = document.createElement('div');
        if (mode === 'dropdown') item.setAttribute('data-animate-dropdown-item','true');
        else if (mode === 'business') item.tabIndex = 0;
        else item.setAttribute('role','menuitem');
        item.textContent = label;
        item.addEventListener('click', () => itemClicks++);
        menu.append(item);
      }
      menu.addEventListener('keydown', key => {
        if (key.key === 'Escape') { escaped = true; menu.remove(); }
      });
      return menu;
    };
    const open = event => {
      event.stopPropagation();
      event.preventDefault();
      openings++;
      if (mode === 'absent') return;
      const menu = buildMenu(event);
      if (mode === 'late') { setTimeout(() => sample.append(menu), 20); return; }
      if (mode === 'foreign') other.setAttribute('aria-controls', menu.id);
      else if (mode !== 'context' && mode !== 'business') trigger.setAttribute('aria-controls', menu.id);
      if (mode === 'multiple' || mode === 'nested') {
        const extra = buildMenu(event);
        extra.id = 'other-menu';
        (mode === 'multiple' ? sample : menu).append(extra);
      }
      sample.append(menu);
      if (mode === 'recycled') {
        // A virtualized list can change a mounted row and restore its original
        // text before the menu animation finishes. Mutation records still win.
        title.firstChild.data = 'another conversation';
        title.firstChild.data = 'fixture';
      }
    };
    trigger.addEventListener('click',open);
    row.addEventListener('contextmenu',open);
    if (mode === 'preexisting') sample.append(buildMenu({type:'contextmenu',clientX:20,clientY:20}));
    const answer = await new Promise(resolve => {
      if (!inspectChatRowMenu(row,() => true,(status,evidence) => resolve({status,evidence})))
        resolve({status:'navigation-busy',evidence:null});
    });
    outputs.push({status:answer.status, escaped, itemClicks, rowClicks, openings,
      canOpen:!!(answer.evidence?.group && answer.evidence.read && !answer.evidence.unread && !answer.evidence.direct)});
  }
  sample.replaceChildren();
  return outputs;
}

// Exercise the complete production dispatcher as installed in a blank collector
// document. Only the native message transport and WhatsApp's UI are fixtures.
const collectorCases = [
  // id, options, chats opened, menus opened, canonical entries published
  ['read-menu', {menu:'read'}, 1,1,1],
  ['native-group-settings-preview', {notification:true, unread:true, allow:true}, 1,0,1],
  ['unread-known-group', {type:'group', unread:true, allow:true}, 1,0,1],
  ['unknown-read-known-group', {type:'group', allow:true}, 1,0,1],
  ['unread-business-filter', {businessFilter:true, unread:true, allow:true}, 1,0,1],
  ['unread-filtered', {filter:true, unread:true, allow:true}, 1,0,1],
  ['unread-menu-group', {menu:'unread', unread:true, allow:true}, 1,1,1],
  ['group-only-menu', {menu:'group-only', allow:true}, 1,1,1],
  ['direct', {type:'direct', unread:true, allow:true}, 0,0,0],
  ['contact-menu', {menu:'contact', unread:true, allow:true}, 0,1,0],
  ['passive-policy', {type:'group', unread:true, passive:true}, 0,0,1],
  ['unread-monitor-target', {type:'group', unread:true, passive:true, allow:true, monitor:'matched'}, 0,0,1],
  ['unread-other-monitor', {type:'group', unread:true, passive:true, allow:true, monitor:'other'}, 0,0,1],
  ['unread-ordinary-exclusion', {type:'group', unread:true, passive:true, mode:'ordinary'}, 0,0,0],
  ['unread-foreground', {type:'group', role:'foreground', unread:true, allow:true}, 0,0,0],
];
async function runCollectorScene(collectorSource, evidenceSource, jid, options) {
  const frame = document.createElement('iframe');
  frame.style.cssText = 'width:440px;height:280px';
  document.body.append(frame);
  const win = frame.contentWindow, doc = win.document;
  try {
    doc.body.innerHTML = '<div id="pane-side" style="height:200px"><div role="row"><span dir="auto" title="Fixture">Fixture</span><button aria-haspopup="menu">⋁</button></div></div>';
    const row = doc.querySelector('[role="row"]'), button = row.querySelector('button');
    if (options.notification) {
      row.insertAdjacentHTML('beforeend',"<div data-testid='cell-frame-secondary'><span data-icon='megaphone'></span><span>~Fixture Actor changed this group's settings to…</span></div>");
    }
    if (options.businessFilter) {
      const side = doc.createElement('div');
      side.id = 'side';
      doc.body.append(side);
      side.innerHTML='<input placeholder="Search or start a new chat"><div class="filter-chips"><button>All</button><button>Unread 2</button><button>My label</button><button aria-label="More lists"><span data-icon="chevron-down"></span></button></div>';
      side.append(row.parentElement);
      const search=side.querySelector('input'), bar=side.querySelector('.filter-chips'), arrow=bar.lastElementChild;
      arrow.onclick=() => {
        const menu=doc.createElement('div');
        menu.setAttribute('role','menu');
        const rect=arrow.getBoundingClientRect();
        menu.style.cssText='position:fixed;left:'+rect.left+'px;top:'+rect.bottom+'px;background:white';
        menu.innerHTML='<button>My label</button><button><i data-icon="heart"></i>Favourites</button><button><i data-icon="group"></i>Groups</button>';
        menu.lastElementChild.onclick=() => {
          menu.remove();
          search.placeholder='Search group chats';
          bar.innerHTML='<button>All</button><button>Groups</button>';
          bar.append(arrow);
        };
        side.append(menu);
      };
    }
    if (options.filter) {
      const side = doc.createElement('div');
      side.id = 'side';
      side.innerHTML = '<div data-testid="chat-list-filters"><button id="all-filter" aria-selected="false">All</button><button id="group-filter" aria-selected="true">Groups</button></div>';
      doc.body.append(side);
      side.append(row.parentElement);
    }
    if (options.type) row.setAttribute('data-chat-type',options.type);
    if (options.unread) row.setAttribute('data-unread','true');
    if (options.passive) {
      // An identified unread row can be indexed without touching the unresolved
      // unread group in the same window, even with active verification disabled.
      const sibling = row.cloneNode(true);
      sibling.setAttribute('data-jid',jid);
      row.after(sibling);
    }
    let actions = 0, chatOpens = 0, menuOpens = 0;
    doc.addEventListener('click',event => {
      if (event.target.closest('[role="row"]') && !row.contains(event.target)) chatOpens++;
    });
    button.onclick = event => {
      event.stopPropagation();
      menuOpens++;
      const menu = doc.createElement('div');
      menu.id = 'actions';
      button.setAttribute('aria-controls',menu.id);
      menu.setAttribute('role','menu');
      const actionLabels = [options.menu === 'contact' ? 'Contact info' : 'Exit group'];
      if (options.menu !== 'group-only') actionLabels.push(options.unread ? 'Mark as read' : 'Mark as unread');
      for (const label of actionLabels) {
        const action = doc.createElement('button');
        action.setAttribute('role','menuitem');
        action.textContent = label;
        menu.append(action);
      }
      menu.onclick = () => actions++;
      menu.onkeydown = key => { if (key.key === 'Escape') menu.remove(); };
      doc.body.append(menu);
    };
    row.onclick = () => {
      chatOpens++;
      const pane = doc.createElement('div');
      pane.id = 'main';
      pane.innerHTML = '<header>Fixture</header>' + ['EVENT1','EVENT2'].map(id =>
        '<div class="message-in" data-id="false_' + jid + '_' + id + '_910000000099@lid">fixture</div>').join('');
      doc.body.append(pane);
    };
    const packets = [];
    const send = raw => packets.push(JSON.parse(raw));
    if (!win.chrome) win.chrome = {};
    if (win.chrome.webview) win.chrome.webview.postMessage = send;
    else Object.defineProperty(win.chrome,'webview',{value:{postMessage:send}});
    win.__zhikeWsCollectorRole = options.role || 'background';
    const readOpen = win.Function('return ('+evidenceSource+')')();
    win.Function('__zhikeWsTrustedPurpose','__zhikeWsDocumentEpoch','__zhikeReadOpenChat','__zhikeWsAllowOpenUnreadGroups',collectorSource)(options.mode || 'dedicated',17,readOpen,options.allow === true);
    if (options.monitor) {
      const target = options.monitor === 'matched' ? jid : '120300000099999999@g.us';
      win.__zhikeWsConfigureGroupMonitor({profileId:'qa-monitor',targets:[{targetId:'qa-target',groupJid:target,groupName:'Fixture',enabled:true}]});
      win.__zhikeWsGroupMonitorStart();
    }
    const started = win.__zhikeWsDiscoverDirectory();
    const deadline = performance.now() + 8000;
    while (started.scanning && !packets.some(packet => packet.coverage === 'group-open-verified' || packet.type === 'zhike.ws.directory' && packet.finished) && performance.now() < deadline)
      await new Promise(done => setTimeout(done,50));
    const discovery = win.__zhikeWsDiscover();
    const group = discovery.groupConversations.find(row => row.conversationKey === jid);
    const monitoring = packets.filter(packet => packet.type === 'zhike.ws.capture');
    return {actions,chatOpens,menuOpens,groupMetadata:group ? [group.status,group.coverage] : [],
      bridgeDirectory:monitoring.some(packet => (packet.conversations || []).some(row => row.conversationKey === jid
        && row.coverage === 'group-directory' && row.collectionStatus === 'observed' && !row.historyLoaded)),
      excluded:discovery.excludedConversations.some(row => row.conversationKey === jid),
      observedTargets:[...new Set(monitoring.flatMap(packet => (packet.conversations || []).filter(row => row.coverage === 'group-monitor-visible').map(row => row.conversationKey)))],
      memberEvents:monitoring.reduce((count,packet) => count + (packet.groupEvents?.length || 0),0),
      keys:[...new Set(packets.filter(packet => packet.type === 'zhike.ws.directory')
      .flatMap(packet => packet.rows.map(row => row.conversationKey)))],
      verified:packets.some(packet => packet.coverage === 'group-open-verified' && packet.accountId === 'qa-menu-slot')
        && packets.some(packet => packet.type === 'zhike.ws.directory' && packet.accountId === 'qa-menu-slot' && packet.collectorEpoch === 17 && packet.rows.some(row => row.conversationKey === jid))};
  } finally { win.__zhikeStopCapture?.(); frame.remove(); }
}

module.exports = { scenes, runScenes, collectorCases, runCollectorScene };
