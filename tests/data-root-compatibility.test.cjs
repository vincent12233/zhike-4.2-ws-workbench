'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repo = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(repo, relative), 'utf8');
const files = {
  app: read('desktop/src/Zhike.Desktop/App.xaml.cs'),
  queue: read('desktop/src/Zhike.Desktop/Services/LocalQueue.cs'),
  profiles: read('desktop/src/Zhike.Desktop/Services/WebViewProfileService.cs'),
  accounts: read('desktop/src/Zhike.Desktop/Services/WsAccountStore.cs'),
  layout: read('desktop/src/Zhike.Desktop/Services/WindowLayoutService.cs'),
  ai: read('desktop/src/Zhike.Desktop/Services/AiBridgeService.cs'),
  tools: read('desktop/src/Zhike.Desktop/Services/DesktopToolsService.cs'),
  service: read('desktop/src/Zhike.Desktop/Services/LocalServiceManager.cs'),
  server: read('resources/app/server.mjs'),
  setup: read('zhike-desktop-setup.iss'),
};

for (const [name, source] of Object.entries(files))
  assert.doesNotMatch(source, /["']Zhike["']/, `${name} must not read the pre-6.0 data root`);

assert.match(files.app, /SpecialFolder\.LocalApplicationData\),\s*"Zhike6"/);
assert.match(files.app, /new LocalServiceManager\(resourceRoot, dataRoot\)/);
assert.match(files.queue, /LocalApplicationData\),\s*"Zhike6",\s*"queue"/);
assert.match(files.profiles, /LocalApplicationData\),\s*"Zhike6",\s*"ws-profiles"/);
assert.match(files.accounts, /LocalApplicationData\),\s*"Zhike6",\s*"ws-accounts"/);
assert.match(files.layout, /LocalApplicationData\),\s*"Zhike6",\s*"window"/);
assert.match(files.ai, /LocalApplicationData\),\s*"Zhike6"/);
assert.match(files.tools, /LocalApplicationData\),\s*"Zhike6"/);
assert.match(files.service, /Environment\["ZHIKE_DATA_DIR"\]\s*=\s*_dataRoot/);
assert.match(files.server, /(?:path\.)?join\(dataDir,\s*'workspace\.sqlite'\)/);
assert.match(files.setup, /6\.0 data is stored below %LOCALAPPDATA%\\\\Zhike6/);
assert.doesNotMatch(files.setup, /\{localappdata\}\\Zhike(?:6)?(?:\\|\")/i,
  'installer must never treat the user data root as an application install directory');

console.log('data-root isolation: 6.0 uses a new %LOCALAPPDATA%\\Zhike6 workspace and never reads the old Zhike root');
