'use strict';

const openEvidenceCases = [
  ['chat-named-group-info','single-message-owner','single-message-owner',false],
  ['banner','awaiting-owner-confirmation','verified',true],
  ['unlabelled-banner','awaiting-owner-confirmation','verified',true],
  ['message-banner','single-message-owner','single-message-owner',false],
  ['below-banner','single-message-owner','single-message-owner',false],
  ['title-only-banner','single-message-owner','single-message-owner',false],
  ["one-header","awaiting-owner-confirmation","verified",true],
  ["display-contents","awaiting-owner-confirmation","verified",true],
  ["bare-participant","awaiting-owner-confirmation","verified",true],
  ["selected","awaiting-owner-confirmation","verified",true],
  ["linked","awaiting-owner-confirmation","verified",true],
  ["no-group-context","single-message-owner","single-message-owner",false],
  ["immediate","awaiting-owner-confirmation","awaiting-owner-confirmation",false],
  ["renamed","awaiting-owner-confirmation","awaiting-owner-confirmation",false],
  ["owner-switched","awaiting-owner-confirmation","awaiting-owner-confirmation",false],
  ["quote","no-message-envelopes","no-message-envelopes",false],
  ["malformed","unsupported-message-envelope","unsupported-message-envelope",false],
  ["nested-conflict","conflicting-identities","conflicting-identities",false],
  ["two-owners","conflicting-identities","conflicting-identities",false],
  ["no-envelope","no-message-envelopes","no-message-envelopes",false],
  ["selected-mismatch","conflicting-identities","conflicting-identities",false],
  ["direct-owner","single-message-owner","single-message-owner",false],
  ["unbound-link","single-message-owner","single-message-owner",false],
];

function runOpenEvidenceScenes(sample,cases,source,directorySource,group) {
  const frame=document.createElement('iframe');
  sample.append(frame);
  try {
    const win=frame.contentWindow, doc=win.document;
    let clock=100000000;
    win.Date.now=()=>clock;
    const read=win.Function('return ('+source+')')(), directory=win.Function('return ('+directorySource+')')();
    return cases.map(([name])=>{
      const other='120300000099999999@g.us';
      const sender=name==='bare-participant' ? 'opaqueDevice' : 'qa-participant:11@lid';
      const owner=name==='direct-owner' ? '910000001111@lid' : group;
      const attr=name==='malformed' ? 'false_fixture@unknown_A11' : 'true_'+owner+'_A11_'+sender;
      let header='<span data-testid="conversation-header-title">Fixture Group</span>';
      if (name==='chat-named-group-info') header='<span dir="auto" title="Group info">Group info</span>';
      if (!name.includes('banner') && !['chat-named-group-info','selected','no-group-context','linked','selected-mismatch','unbound-link'].includes(name)) header+='<button data-testid="group-info">Group info</button>';
      if (name==='linked') header+='<div data-testid="group-info"><a href="https://web.whatsapp.com/send?jid='+group+'">Info</a></div>';
      if (name==='unbound-link') header+='<a href="https://web.whatsapp.com/send?text='+group+'">Details</a>';
      let row='<div role="row" data-message-key="'+attr+'"><div class="message-out">caption</div></div>';
      if (name==='display-contents') row='<section style="display:contents" data-id="'+attr+'"><div class="message-out">caption</div></section>';
      if (name==='quote') row='<div class="message-out"><div data-testid="quoted-message">'+row+'</div></div>';
      if (name==='no-envelope') row='<div role="row"><div class="message-out">caption</div></div>';
      if (name==='nested-conflict') row='<div role="row" data-id="'+attr+'"><div class="message-out" data-id="true_'+group+'_DIFFERENT">caption</div></div>';
      if (name==='two-owners') row+='<div role="row" data-id="true_'+other+'_OTHER"><div class="message-out">next</div></div>';
      const banner='<div '+(name==='unlabelled-banner' ? '' : 'data-testid="group-description-banner"')+'><strong>Group description</strong>'+(name==='title-only-banner' ? '' : '<button>Read more</button><button aria-label="Close">×</button>')+'</div>';
      if (name==='message-banner') row=row.replace('caption',banner);
      const selected=name==='unlabelled-banner' ? '<div role="row" aria-selected="true"><span dir="auto" title="Fixture Group">fixture</span></div>' : ['selected','selected-mismatch'].includes(name) ? '<div role="row" aria-selected="true" data-jid="'+group+'"><span dir="auto" title="'+(name==='selected'?'Fixture Group':'Another title')+'">fixture</span></div>' : '';
      doc.body.innerHTML='<div id="pane-side">'+selected+'</div><div id="main"><header>'+header+'</header>'+(['banner','unlabelled-banner','title-only-banner'].includes(name)?banner:'')+'<div role="log">'+row+'</div>'+(name==='below-banner'?banner:'')+'</div>';
      const snap=previous=>JSON.parse(directory('dedicated',read,previous));
      const first=snap(null);
      if (name==='renamed') doc.querySelector('header span').textContent='Renamed';
      if (name==='owner-switched') doc.querySelector('[data-message-key]').setAttribute('data-message-key','true_'+other+'_A12_'+sender);
      clock+=name==='immediate'?30:200;
      const next=snap(first.openConfirmation);
      const confirmed=next.activeGroup?.groupJid===group && next.activeGroup.displayName==='Fixture Group';
      if (first.activeGroup) throw Error('Single sample attributed identity in '+name);
      return [first.openIdentityStatus,next.openIdentityStatus,Boolean(confirmed)];
    });
  } finally { frame.remove(); }
}

module.exports={openEvidenceCases,runOpenEvidenceScenes};
