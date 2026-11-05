const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');

const mainPath = process.argv[2];
if (!mainPath) throw new Error('main.cjs path required');

const main = fs.readFileSync(mainPath, 'utf8');
const start = main.indexOf('const desktopToolsPath');
const end = main.indexOf("ipcMain.handle('zhike-desktop-tools'");
assert(start >= 0 && end > start, 'automatic backup implementation was not found');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zhike-backup-test-'));
const out = path.join(dir, 'backups');
fs.mkdirSync(out);

let fail = false;
const state = {
  customers: [{ id: 'C1' }],
  settings: { operatingTasks: [{ id: 'T1' }] },
  registrations: [],
  version: '12',
  initialized: true,
};
const ws = {
  schemaVersion: 5,
  settings: [{ conversationId: 'conv-1', enabled: true }],
  conversations: [{ id: 'conv-1', externalId: 'wa-1' }],
  messages: [{ id: 'msg-1', conversationId: 'conv-1', externalId: 'm-1', direction: 'receive', originalText: 'hello' }],
  analyses: [],
  replies: [],
};

const context = vm.createContext({
  ...fs,
  path,
  userDataPath: dir,
  servicePort: 4198,
  apiToken: 'test',
  mainWindow: null,
  AbortSignal,
  fetch: async url => {
    if (fail) throw new Error('offline');
    const payload = String(url).endsWith('/api/ws/export') ? ws : state;
    return { ok: true, json: async () => structuredClone(payload) };
  },
});

(async () => {
  try {
    for (let i = 1; i <= 5; i++) fs.writeFileSync(path.join(out, `zhike-auto-2026-01-0${i}T00-00-00-000Z.json`), '{}');
    fs.writeFileSync(path.join(out, 'my-own-backup.json'), 'preserve');
    fs.writeFileSync(path.join(dir, 'desktop-tools.json'), JSON.stringify({ backup: { directory: out, enabled: true, minutes: 60, keep: 3 } }));

    vm.runInContext(main.slice(start, end), context);
    const result = await vm.runInContext('automaticBackup(true)', context);
    assert(result.ok);

    const files = fs.readdirSync(out).filter(name => name.startsWith('zhike-auto-'));
    assert.equal(files.length, 3);
    assert(fs.existsSync(path.join(out, 'my-own-backup.json')));
    const payload = JSON.parse(fs.readFileSync(path.join(out, files.sort().at(-1))));
    assert.equal(payload.version, 5);
    assert.equal(payload.schemaVersion, 5);
    assert.equal(payload.customers[0].id, 'C1');
    assert.equal(payload.settings.operatingTasks[0].id, 'T1');
    assert.equal(payload.ws.messages[0].externalId, 'm-1');
    assert(!('initialized' in payload));
    assert((await vm.runInContext('automaticBackup()', context)).skipped);

    fail = true;
    await assert.rejects(() => vm.runInContext('automaticBackup(true)', context));
    assert(JSON.parse(fs.readFileSync(path.join(dir, 'desktop-tools.json'))).backup.lastError.includes('offline'));
    console.log('automatic backup: complete payload, retention, unrelated-file preservation, interval guard and failure state passed');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
