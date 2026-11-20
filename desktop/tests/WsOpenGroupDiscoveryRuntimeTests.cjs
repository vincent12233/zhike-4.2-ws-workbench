'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../src/Zhike.Desktop/Views/LegacyUiHostPage.xaml.cs'), 'utf8');
const evidenceScript = source.match(/private const string WsOpenChatEvidenceScript = """([\s\S]*?)""";/)[1];
const foregroundScript = source.match(/private const string WsVisibleDirectoryScript = """([\s\S]*?)""";/)[1];
const group = '120363000123456789@g.us', sender = '987654321@lid', otherGroup = '11111-22222@g.us';
const visible = () => [{}];
const message = (value, quoted = false) => ({
  getAttribute: name => name === 'data-id' ? value : null, getClientRects: visible,
  matches: selector => selector.includes('msg-container'), closest: selector => quoted && selector.includes('quoted') ? {} : null,
  querySelector: () => null,
});
const title = {getAttribute: () => '同名群'};
let headerId = '', rows = [], hasPane = true;
const header = {getClientRects: visible,getAttribute: field => field === 'data-jid' ? headerId : null,querySelector: () => title};
const pane = {getClientRects:visible,closest:()=>null,querySelector:()=>header,querySelectorAll:()=>rows};
const document = {querySelector: selector => selector === '#main' && hasPane ? pane : null, querySelectorAll: () => []};
const evidence = vm.runInNewContext(evidenceScript,{document});
const foreground = vm.runInNewContext(foregroundScript,{document});
const snapshot = previous => JSON.parse(foreground('dedicated',evidence,previous));
const first = message('false_'+group+'_A1_'+sender);
rows = [first,message('true_'+group+'_B2'),message('false_'+otherGroup+'_C3_'+sender,true)];
const initial = snapshot();
assert.equal(initial.activeGroup.groupJid,group);
assert.equal(initial.activeGroup.displayName,'');
assert.equal(snapshot(initial.openConfirmation).activeGroup.displayName,'同名群');
assert.deepEqual(initial.rows.map(row=>row.conversationKey),[group],'an open group enters the native directory when the list is unavailable');
assert.equal(initial.directoryDiagnostics.confirmedOpen,true);
assert.equal(initial.directoryDiagnostics.listPresent,false);
assert.equal(initial.directoryDiagnostics.renderedRows,0);
assert.ok(!JSON.stringify(initial.directoryDiagnostics).includes(group));
assert.equal(evidence('ordinary').status,'workspace-type-mismatch');
rows = [first,first]; assert.equal(snapshot().openIdentityStatus,'insufficient-message-identities','two DOM copies of one message are insufficient');
rows.push(message('true_'+otherGroup+'_D4')); assert.equal(snapshot().openIdentityStatus,'conflicting-identities');
rows = [first,message('true_'+group+'_B2')]; headerId=otherGroup; assert.equal(snapshot().activeGroup,null);
rows=[];headerId=group;assert.equal(snapshot().activeGroup.groupJid,group,'a verified header can identify an empty chat');
headerId='';assert.equal(snapshot().activeGroup,null,'an empty chat with no machine identity is not confirmed');
hasPane=false;assert.equal(snapshot().openIdentityStatus,'no-open-chat');
const preview = (raw, quoted = false) => ({getAttribute:()=>raw,matches:sel=>sel.includes('last-msg'),closest:sel=>quoted&&sel.includes('quoted')?{}:null,querySelector:()=>null});
const previewRow = nodes => ({querySelectorAll:()=>nodes});
assert.equal(evidence('dedicated',previewRow([preview('false_'+group+'_A1_'+sender)])).key,group);
assert.equal(evidence('dedicated',previewRow([preview('false_'+sender+'_A1_'+group)])).key,'','a sender field cannot become chat evidence');
assert.equal(evidence('dedicated',previewRow([preview('false_'+group+'_A1',true)])).key,'');
assert.equal(evidence('dedicated',previewRow([preview('false_'+group+'_A1'),preview('true_'+otherGroup+'_B2')])).status,'conflicting-identities');
console.log('WS visible message owner: active pane, independent title confirmation, preview structure, participant and mixed-chat rejection pass');
