const { contextBridge } = require('electron');

// The third-party WS page receives no CRM, AI, clipboard, cookie, or navigation API.
contextBridge.exposeInMainWorld('zhikeWsPage', Object.freeze({ version: '1', purpose: 'visible-page-only' }));
