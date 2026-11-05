let wsActiveAccountId = 'default';
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('zhikeDesktop',Object.freeze({
  tools:value=>ipcRenderer.invoke('zhike-desktop-tools',value),
  onCustomer:callback=>{if(typeof callback==='function')ipcRenderer.on('zhike-open-customer',(_event,id)=>callback(id));},
  onError:callback=>{if(typeof callback==='function')ipcRenderer.on('zhike-tools-error',(_event,message)=>callback(message));},
  ws:value=>{const payload={...(value||{}),accountId:String(value?.accountId||'default')};if(['open','login','reload','reconnect'].includes(payload.action))wsActiveAccountId=payload.accountId;return ipcRenderer.invoke('zhike-ws',payload);},
  wsAccounts:value=>ipcRenderer.invoke('zhike-ws-accounts',value||{action:'list'}),
  onWsStatus:callback=>{if(typeof callback==='function')ipcRenderer.on('zhike-ws-status',(_event,payload)=>{if(!payload?.accountId||String(payload.accountId)===wsActiveAccountId)callback(payload);});}
}));

contextBridge.exposeInMainWorld('zhikeAI', Object.freeze({
  status: value => ipcRenderer.invoke('zhike-ai-status', value),
  saveKey: value => ipcRenderer.invoke('zhike-ai-save-key', value),
  removeKey: value => ipcRenderer.invoke('zhike-ai-remove-key', value),
  testConnection: value => ipcRenderer.invoke('zhike-ai-test', value),
  listModels: value => ipcRenderer.invoke('zhike-ai-models', value),
  parseExcel: value => ipcRenderer.invoke('zhike-ai-parse-excel', value),
  selectWorkspace: () => ipcRenderer.invoke('zhike-ai-select-workspace'),
  cancel: value => ipcRenderer.invoke('zhike-ai-cancel', value),
  request: value => ipcRenderer.invoke('zhike-ai-request', value),
}));
