'use strict';

const fullPreview = "~Ada changed this group's settings to allow admins to edit group info";
const clippedPreview = "~Ada changed this group’s settings to…";
const graphic = '<svg width="16" height="16" aria-hidden="true"><path d="M1 4L13 1V13L1 10Z"/></svg>';
const adjacent = (svg,tooltip,visible=clippedPreview,style='') =>
  '<div style="width:460px;display:flex;align-items:center;gap:3px;'+style+'"><span aria-hidden="true">'+svg+'</span><div><span title="'+tooltip+'"><span dir="auto">'+visible+'</span></span></div></div>';
const noticeCases = [
  ["nested-svg-title",adjacent('<svg width="16" height="16" aria-hidden="true"><title>Group notification</title><path d="M1 4h9"/></svg>',''),2],
  ["nested-svg-use",adjacent('<svg width="16" height="16" aria-hidden="true"><use href="#icon-megaphone"/></svg>',''),2],
  ["nested-native-icon",adjacent('<span data-icon="bullhorn-refreshed"><svg width="16" height="16"></svg></span>',''),2],
  ["adjacent-vector-matching-title",adjacent(graphic,fullPreview),2],
  ["adjacent-vector-clipped-title",adjacent(graphic,clippedPreview,fullPreview),2],
  ["adjacent-vector-no-tooltip",adjacent(graphic,''),1],
  ["adjacent-vector-unrelated-title",adjacent(graphic,"~Another actor changed this group's settings to allow admins to edit group info"),1],
  ["far-vector",adjacent(graphic,fullPreview,clippedPreview,'gap:45px'),1],
  ["interactive-vector",adjacent('<button>'+graphic+'</button>',fullPreview),1],
  ["known-receipt-svg",adjacent(graphic.replace('<svg ','<svg data-icon="msg-dblcheck" '),fullPreview),1],
  ["hidden-vector",adjacent(graphic.replace('<svg ','<svg style="visibility:hidden" '),fullPreview),1],
  ["bare-refresh","<div><span aria-hidden='true'><svg width='16' height='16' data-icon='megaphone-refreshed'></svg></span><span dir='auto'>~Alex changed this group’s settings to…</span></div>",2],
  ["bare-bullhorn","<div><svg width='16' height='16' data-icon='bullhorn'></svg><span dir='auto'>~Alex changed this group's settings to…</span></div>",2],
  ["bare-text","<div><span dir='auto'>~Alex changed this group's settings to…</span></div>",1],
  ["bare-wrong-slot","<div><svg width='16' height='16' data-icon='announcement-refreshed'></svg></div><div><span dir='auto'>~Alex changed this group's settings to…</span></div>",1],
  ["bare-forward","<div><span data-testid='forwarded-message'>Forwarded</span></div><div><svg width='16' height='16' data-icon='bullhorn'></svg><span dir='auto'>~Alex changed this group's settings to…</span></div>",1],
  ["bare-title","<div><span data-icon='bullhorn'></span><span dir='auto'>~Alex changed this group's settings to…</span></div>",0],
  ["native","<div data-testid=\"cell-frame-secondary\"><span data-icon=\"megaphone\" aria-hidden=\"true\"></span><span dir=\"ltr\">~Fixture Actor changed this group's settings to…</span></div>",2],
  ["template","<div data-testid=\"last-msg\">~Fixture Actor changed this group's settings to…</div>",1],
  ["icon","<div data-testid=\"cell-frame-secondary\"><span data-icon=\"megaphone\"></span>Business news</div>",0],
  ["forward","<div data-testid=\"cell-frame-secondary\"><span data-icon=\"megaphone\"></span><span data-testid=\"forwarded-message\">~Fixture Actor changed this group's settings to…</span></div>",1],
  ["quoted","<div data-testid=\"cell-frame-secondary\"><span data-icon=\"megaphone\"></span><span data-testid=\"quoted-message\">~Fixture Actor changed this group's settings to…</span></div>",1],
  ["title","<div data-testid=\"cell-frame-title\"><span data-icon=\"megaphone\"></span><span dir=\"ltr\" title=\"~Fixture Actor changed this group's settings to…\">~Fixture Actor changed this group's settings to…</span></div>",0],
  ["copied","<div data-testid=\"last-msg\"><span data-icon=\"msg-dblcheck\"></span><span>~Fixture Actor changed this group's settings to…</span></div>",1],
  ["emoji","<div data-testid=\"last-msg\"><span>📣</span>~Fixture Actor changed this group's settings to…</div>",1],
  ["split","<div><span data-icon=\"megaphone\"></span><span dir=\"ltr\" title=\"~Fixture Actor changed this group's settings to…\">~Fixture Actor changed this group's settings to…</span></div>",2],
  ["user-sender","<div data-testid=\"last-msg\"><span data-icon=\"megaphone\"></span>Sender: ~Fixture Actor changed this group's settings to…</div>",0],
  ["distinct","<div data-testid=\"cell-frame-title\"><span data-icon=\"megaphone\"></span></div><div data-testid=\"last-msg\">~Fixture Actor changed this group's settings to…</div>",1],
  ["strong","<div data-testid=\"last-msg\"><span data-testid=\"group-settings-notification\">Settings update</span></div>",3],
  ["hidden","<div hidden data-testid=\"last-msg\"><span data-icon=\"megaphone\"></span>~Fixture Actor changed this group's settings to…</div>",0],
  ["normal","<div data-testid=\"last-msg\">This group is great</div>",0],
];

function runNoticeScenes(sample, cases, source) {
  const reader = new Function('clean',source+'\nreturn groupSettingsNotice;')(s => String(s||'').trim());
  return cases.map(([name,markup]) => {
    const title = name === 'bare-title' ? '' : name.startsWith('bare-') ? '<div><span dir="auto">Fixture</span></div>' : '<div data-testid="cell-frame-title"><span dir="auto" title="Fixture">Fixture</span></div>';
    sample.innerHTML = '<div id="pane-side"><div role="row">'+title+markup+'</div></div>';
    const result = reader(sample.querySelector('[role="row"]'));
    sample.replaceChildren();
    return result;
  });
}

module.exports = { noticeCases, runNoticeScenes };
