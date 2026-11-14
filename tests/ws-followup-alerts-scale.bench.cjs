'use strict';
// Standalone isolated benchmark: node tests/ws-followup-alerts-scale.bench.cjs
// Seeds only a fresh temporary ZHIKE_DATA_DIR. It is intentionally not part
// of the normal regression suite because 50k fixture creation is expensive.
const assert = require('node:assert/strict');
const { spawn, execFileSync } = require('node:child_process');
const { mkdtempSync, rmSync, statSync, existsSync } = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { performance } = require('node:perf_hooks');
const { DatabaseSync } = require('node:sqlite');

const app = path.join(__dirname, '../resources/app');
const sizes = String(process.env.ZHIKE_BENCH_SIZES || '10000,50000').split(',').map(Number).filter(value => Number.isInteger(value) && value > 0);
const warmIterations = Math.max(3, Math.min(30, Number(process.env.ZHIKE_BENCH_RUNS) || 12));
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const round = value => Math.round(value * 10) / 10;
const percentile = (values, p) => { const sorted = [...values].sort((a,b) => a-b); return round(sorted[Math.min(sorted.length-1, Math.ceil(sorted.length*p)-1)]); };
const fileBytes = file => existsSync(file) ? statSync(file).size : 0;

async function benchmark(size, ordinal) {
  const activeCount = Math.max(1, Math.round(size * .01));
  const data = mkdtempSync(path.join(os.tmpdir(), 'zhike-alert-scale-'));
  const port = 38000 + ((process.pid + ordinal * 1001) % 16000);
  const token = `isolated-alert-scale-${process.pid}-${ordinal}`;
  const headers = { 'x-zhike-api-token':token };
  let child, logs = '';
  const endpoint = `http://127.0.0.1:${port}`;
  const walPath = path.join(data, 'workspace.sqlite-wal');
  async function get(route) {
    const start = performance.now();
    const response = await fetch(endpoint + route, { headers, signal:AbortSignal.timeout(120000) });
    const body = await response.json();
    assert.equal(response.status, 200, JSON.stringify(body));
    return { ms:round(performance.now()-start), body };
  }
  async function stop() {
    if (!child || child.exitCode !== null) return;
    const exit = new Promise(resolve => child.once('exit', resolve));
    try { await fetch(endpoint + '/api/shutdown', { method:'POST', headers:{ ...headers, 'x-zhike-shutdown-token':token }, signal:AbortSignal.timeout(3000) }); } catch {}
    if (!await Promise.race([exit.then(() => true), wait(5000).then(() => false)])) { child.kill(); await exit; }
  }
  function memoryBytes() {
    if (!child || child.exitCode !== null) return null;
    try {
      if (process.platform === 'win32') {
        const output = execFileSync('powershell.exe', ['-NoProfile','-Command',`(Get-Process -Id ${Number(child.pid)}).WorkingSet64`], { encoding:'utf8', timeout:5000 });
        return Number(output.trim()) || null;
      }
      const status = require('node:fs').readFileSync(`/proc/${child.pid}/status`, 'utf8');
      return Number(status.match(/^VmRSS:\s*(\d+)/m)?.[1] || 0) * 1024 || null;
    } catch { return null; }
  }
  try {
    child = spawn(process.env.ZHIKE_TEST_NODE || process.execPath, ['server.mjs'], {
      cwd:app,
      env:{ ...process.env, ZHIKE_DATA_DIR:data, ZHIKE_PORT:String(port), ZHIKE_API_TOKEN:token, ZHIKE_SHUTDOWN_TOKEN:token },
      windowsHide:true, stdio:['ignore','pipe','pipe'],
    });
    child.stdout.on('data', value => logs += value);
    child.stderr.on('data', value => logs += value);
    let ready = false;
    for (let attempt = 0; attempt < 1000; attempt++) {
      try { await get('/api/health'); ready = true; break; }
      catch { if (child.exitCode !== null) break; await wait(30); }
    }
    if (!ready) throw Error(`isolated server did not start: ${logs}`);
    const db = new DatabaseSync(path.join(data, 'workspace.sqlite'));
    try {
      assert.ok(db.prepare("SELECT id FROM ws_accounts WHERE id='default'").get(), 'default test account exists');
      const now = new Date().toISOString();
      const customers = [], tasks = [];
      const conversationInsert = db.prepare('INSERT INTO ws_conversations(id,account_id,external_id,title,customer_id,last_message_text,intent_level,data_json,created_at,updated_at,last_message_at,unread_count,language) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)');
      const analysisInsert = db.prepare('INSERT INTO ws_ai_analyses(id,account_id,conversation_id,result_json,confidence,provider_name,model,error_message,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)');
      const quietResult = JSON.stringify({ summary:'Synthetic follow-up', confidence:.9, followupStrategy:{ shouldFollowUp:true, priorityScore:40, reason:'Synthetic evidence', objective:'Synthetic next step' } });
      const activeResult = JSON.stringify({ summary:'Synthetic priority follow-up', confidence:.9, followupStrategy:{ shouldFollowUp:true, priorityScore:90, reason:'Synthetic evidence', objective:'Synthetic next step' } });
      db.exec('BEGIN IMMEDIATE');
      for (let i = 0; i < size; i++) {
        const suffix = String(i).padStart(6,'0');
        const customerId = `C${suffix}`, conversationId = `v${suffix}`, analysisId = `a${suffix}`;
        const active = i >= size-activeCount;
        customers.push({ id:customerId, name:`Synthetic ${suffix}` });
        tasks.push({ id:`t${suffix}`, aiGenerated:true, wsAccountId:'default', wsConversationId:conversationId, wsAnalysisId:analysisId, customerId, due:active ? '2020-01-01' : '2099-01-01', done:false, status:'open' });
        conversationInsert.run(conversationId,'default',`9190${suffix}`,`Synthetic ${suffix}`,'','','',JSON.stringify({ conversationType:'direct' }),now,now,'',0,'');
        analysisInsert.run(analysisId,'default',conversationId,active ? activeResult : quietResult,.9,'synthetic','synthetic','',now,now);
      }
      db.prepare('INSERT INTO app_state(id,json,updated_at,revision) VALUES(1,?,?,1)').run(JSON.stringify({ customers, settings:{ operatingTasks:tasks }, tickets:[], deposits:[], followups:[], registrations:[], phoneRegistry:[], activities:[] }),now);
      db.exec('COMMIT');
      if (process.env.ZHIKE_BENCH_INDEXES === '1') db.exec('CREATE INDEX idx_bench_ws_alert_order ON ws_ai_analyses(created_at DESC,id DESC) WHERE confidence>=0.3');
    } finally { db.close(); }
    const memoryBefore = memoryBytes(), walBefore = fileBytes(walPath);
    const cold = await get('/api/ws/followup-alerts?allAccounts=1&limit=100');
    assert.equal(cold.body.alerts.length, Math.min(100, activeCount), 'first page contains actionable synthetic alerts');
    const memoryAfterCold = memoryBytes(), walAfterCold = fileBytes(walPath);
    const warm = [];
    for (let i = 0; i < warmIterations; i++) {
      const result = await get('/api/ws/followup-alerts?allAccounts=1&limit=100');
      assert.equal(result.body.alerts.length, Math.min(100, activeCount));
      warm.push(result.ms);
    }
    const memoryAfterWarm = memoryBytes(), walAfterWarm = fileBytes(walPath);
    const profileDb = new DatabaseSync(path.join(data, 'workspace.sqlite'), { readOnly:true });
    let sqlScanMs, stateReadParseMs, sqlRows = 0, queryPlan;
    try {
      const sql = 'SELECT a.*, c.title, c.external_id, c.customer_id, c.data_json AS conversation_data_json, c.unread_count AS conversation_unread_count FROM ws_ai_analyses a JOIN ws_conversations c ON c.id=a.conversation_id AND c.account_id=a.account_id WHERE 1=1 AND a.confidence>=0.3 ORDER BY a.created_at DESC,a.id DESC';
      const sqlStart = performance.now();
      for (const row of profileDb.prepare(sql).iterate()) { if (row.id) sqlRows++; }
      sqlScanMs = round(performance.now()-sqlStart);
      const stateStart = performance.now();
      JSON.parse(profileDb.prepare('SELECT json FROM app_state WHERE id=1').get().json);
      stateReadParseMs = round(performance.now()-stateStart);
      queryPlan = profileDb.prepare(`EXPLAIN QUERY PLAN ${sql}`).all().map(row => row.detail);
    } finally { profileDb.close(); }
    const result = { size, activeCount, indexed:process.env.ZHIKE_BENCH_INDEXES === '1', coldMs:cold.ms, warmP50Ms:percentile(warm,.5), warmP95Ms:percentile(warm,.95), warmMs:warm, sqlScanMs, sqlRows, stateReadParseMs, queryPlan, workingSetMB:{ before:round((memoryBefore||0)/1048576), afterCold:round((memoryAfterCold||0)/1048576), afterWarm:round((memoryAfterWarm||0)/1048576) }, walBytes:{ before:walBefore, afterCold:walAfterCold, afterWarm:walAfterWarm } };
    assert.equal(walAfterWarm, walAfterCold, 'read-only repeat polling must not grow WAL');
    console.log(JSON.stringify(result));
    return result;
  } catch (error) {
    console.error(`isolated server exit=${child?.exitCode ?? 'running'} logs=${logs.slice(-4000)}`);
    throw error;
  } finally {
    await stop();
    if (data.startsWith(os.tmpdir()) && path.basename(data).startsWith('zhike-alert-scale-')) rmSync(data, { recursive:true, force:true });
  }
}
(async () => { for (let i = 0; i < sizes.length; i++) await benchmark(sizes[i],i); })().catch(error => { console.error(error); process.exitCode=1; });
