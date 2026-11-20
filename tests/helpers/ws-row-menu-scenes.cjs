'use strict';

// Serialized into a local WebView2 fixture. Probe uses the production script,
// browser layout, native CSS selectors, DOM events and MutationObserver.
const scenes = [
  ['owned', ['Group info','Mark as unread'], 'verified-read-group', true],
  ['dropdown', ['Exit group','Mark as unread'], 'verified-read-group', true],
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
    if (!['context','late'].includes(mode)) row.append(trigger);
    let escaped = false, itemClicks = 0, rowClicks = 0, openings = 0;
    row.addEventListener('click', () => rowClicks++);
    const buildMenu = event => {
      const menu = document.createElement('div');
      menu.id = 'example-menu';
      if (mode === 'dropdown') menu.setAttribute('data-animate-dropdown-menu','true');
      else menu.setAttribute('role','menu');
      const rect = trigger.getBoundingClientRect();
      const x = event.type === 'contextmenu' ? event.clientX : rect.left + rect.width / 2;
      const y = event.type === 'contextmenu' ? event.clientY : rect.top + rect.height / 2;
      Object.assign(menu.style,{position:'fixed',background:'white',left:x+'px',top:y+'px',width:'160px'});
      for (const label of labels) {
        const item = document.createElement('div');
        if (mode === 'dropdown') item.setAttribute('data-animate-dropdown-item','true');
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
      else if (mode !== 'context') trigger.setAttribute('aria-controls', menu.id);
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
async function runCollectorScene(collectorSource, evidenceSource, jid) {
  const frame = document.createElement('iframe');
  frame.style.cssText = 'width:440px;height:280px';
  document.body.append(frame);
  const win = frame.contentWindow, doc = win.document;
  try {
    doc.body.innerHTML = '<div id="pane-side" style="height:200px"><div role="row"><span dir="auto" title="Fixture">Fixture</span><button aria-haspopup="menu">⋁</button></div></div>';
    const row = doc.querySelector('[role="row"]'), button = row.querySelector('button');
    let actions = 0, chatOpens = 0;
    button.onclick = event => {
      event.stopPropagation();
      const menu = doc.createElement('div');
      menu.id = 'actions';
      button.setAttribute('aria-controls',menu.id);
      menu.setAttribute('role','menu');
      menu.innerHTML = '<button role="menuitem">Exit group</button><button role="menuitem">Mark as unread</button>';
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
    win.__zhikeWsCollectorRole = 'background';
    const readOpen = win.Function('return ('+evidenceSource+')')();
    win.Function('__zhikeWsTrustedPurpose','__zhikeWsDocumentEpoch','__zhikeReadOpenChat',collectorSource)('dedicated',17,readOpen);
    win.__zhikeWsDiscoverDirectory();
    const deadline = performance.now() + 8000;
    while (!packets.some(packet => packet.coverage === 'group-open-verified') && performance.now() < deadline)
      await new Promise(done => setTimeout(done,50));
    return {actions,chatOpens,keys:[...new Set(packets.filter(packet => packet.type === 'zhike.ws.directory')
      .flatMap(packet => packet.rows.map(row => row.conversationKey)))],
      verified:packets.some(packet => packet.coverage === 'group-open-verified' && packet.accountId === 'qa-menu-slot')
        && packets.some(packet => packet.type === 'zhike.ws.directory' && packet.accountId === 'qa-menu-slot' && packet.collectorEpoch === 17 && packet.rows.some(row => row.conversationKey === jid))};
  } finally { win.__zhikeStopCapture?.(); frame.remove(); }
}

module.exports = { scenes, runScenes, runCollectorScene };
