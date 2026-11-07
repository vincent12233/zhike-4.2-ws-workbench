const assert = require('node:assert/strict');
const core = require('../resources/app/modules/ws-workbench-core.js');

(async () => {
  let attempts = 0;
  const result = await core.retryTransient(async () => {
    attempts += 1;
    if (attempts < 3) throw new Error('本地数据服务尚未准备好。');
    return { accounts: [{ id: 'default' }] };
  }, { attempts: 4, delayMs: 0 });
  assert.deepEqual(result, { accounts: [{ id: 'default' }] });
  assert.equal(attempts, 3, '账号列表加载应在瞬时服务失败后重试');
  console.log('ws-workbench-init: pass');
})().catch(error => { console.error(error); process.exitCode = 1; });
