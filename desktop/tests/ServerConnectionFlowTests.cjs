'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const repo = path.resolve(__dirname, '..', '..');
const read = relative => fs.readFileSync(path.join(repo, relative), 'utf8');

const settings = read('resources/app/app.js');
const host = read('desktop/src/Zhike.Desktop/Views/LegacyUiHostPage.xaml.cs');
const mainWindow = read('desktop/src/Zhike.Desktop/MainWindow.xaml.cs');
const mainXaml = read('desktop/src/Zhike.Desktop/MainWindow.xaml');
const apiClient = read('desktop/src/Zhike.Desktop/Services/ApiClient.cs');
const localService = read('desktop/src/Zhike.Desktop/Services/LocalServiceManager.cs');
const desktopHost = read('resources/app/modules/desktop-host.js');

assert.doesNotMatch(settings, /open-server-connection|server\.connection/);
assert.doesNotMatch(host, /server\.connection|OpenServerConnection|DesktopStorageMode|PostgreSQL/);
assert.match(host, /App\.EnsureLocalServiceAsync/);
assert.match(host, /LegacyBridgeScript\.Build\(true\)/);
assert.match(host, /本机数据服务尚未就绪/);
assert.match(mainWindow, /FlushBeforeCloseAsync\(snapshot:\s*true\)/);
assert.match(host, /source origin is not allowed/);
assert.match(host, /Debug\.WriteLine/);
assert.match(desktopHost, /sync\.updated/);
assert.match(mainWindow, /OpenWorkspaceRoute/);
assert.match(mainWindow, /ContentFrame\.Navigate\(typeof\(LegacyUiHostPage\)\)/);
assert.doesNotMatch(mainWindow, /ReturnToLegacyHost|NativeFallbackRoutes|typeof\((?:Home|Customers|Import|Operations|AiFollowup|WsWorkbench)Page\)/);
assert.doesNotMatch(mainXaml, /<NavigationView\b/);
assert.match(apiClient, /ConfigureLocalSidecar\(\)/);
assert.match(apiClient, /IsLocalSidecar/);
assert.match(localService, /ZHIKE_DATA_DIR/);
assert.match(localService, /ZHIKE_API_TOKEN/);
assert.match(localService, /ZHIKE_PARENT_PID/);
assert.match(localService, /WaitForHealthAsync/);
assert.match(localService, /FindFreePort/);

console.log('desktop local service flow: single workbench, SQLite sidecar, guarded bridge and close flush pass');
