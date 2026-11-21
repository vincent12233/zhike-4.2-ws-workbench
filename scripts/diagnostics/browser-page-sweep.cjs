'use strict';

// Diagnostic: load every page of the shipped app in a real Chromium against an
// isolated sidecar and report page errors, console errors, failed requests,
// blank pages and broken navigation. Synthetic data only; the data root is a
// fresh temporary directory that is removed afterwards.
//
//   node scripts/diagnostics/browser-page-sweep.cjs
//
// Requires a Node runtime with Playwright and Chromium available (for example
// a Linux cloud container). It is not part of scripts/run-tests.cjs and does
// not replace the WebView2 suites or Windows CI: it checks the same HTML, CSS
// and scripts in Chromium. Exits 1 when any issue is found.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { startServer } = require('../../tests/helpers/ws-account-test-sidecar.cjs');

let chromium;
try { ({ chromium } = require('playwright')); }
catch { console.error('Playwright is not available; this diagnostic needs Playwright with Chromium.'); process.exit(2); }

const token = 'sweep-' + 'x'.repeat(26);

function seed() {
  const host = window.__zhikeRegistryHost, state = host.state;
  const day = i => new Date(Date.UTC(2026, 10, 1 + (i % 20))).toISOString().slice(0, 10);
  const statuses = state.settings?.optionLists?.statuses || ['未进群', '在群'];
  for (let i = 0; i < 40; i++) {
    const id = 'SYN' + i;
    state.customers.unshift({
      id, name: (i % 7 === 0 ? '<b>测试</b>&"' : '合成客户') + i, phone: '98' + String(10000000 + i), rawPhone: '+91 98' + String(10000000 + i),
      source: i % 2 ? '群粉' : '单导', status: statuses[i % statuses.length], assistant: i % 3 ? '助理A' : '', tags: i % 4 ? ['标签' + (i % 3)] : [],
      note: i % 5 ? '备注' + i : '', hot: i % 6 === 0, favorite: i % 9 === 0, investor: i % 4 === 0, groupAlias: i % 3 === 0 ? 'A-' + i : '',
      createdAt: day(i) + 'T08:00:00.000Z', date: day(i), due: i % 2 ? day(i + 3) : '', deleted: i === 39, ...(i % 10 === 0 ? { manualLockedFields: ['note'] } : {}),
    });
    if (i % 2 === 0) state.tickets.unshift({ id: 'TK' + i, customerId: id, date: day(i), product: 'P' + (i % 4), direction: i % 4 ? '买' : '卖', note: '' });
    if (i % 3 === 0) state.deposits.unshift({ id: 'DP' + i, customerId: id, date: day(i), amount: 1000 * (i + 1), currency: 'INR', note: '' });
    if (i % 4 === 0) state.registrations.unshift({ id: 'RG' + i, customerId: id, date: day(i), source: '跟进登记', owner: '助理A', status: '已报名', note: '', createdAt: day(i) + 'T09:00:00.000Z' });
    if (i % 5 === 0) state.followups.unshift({ id: 'FU' + i, customerId: id, date: day(i), method: '电话', result: '已联系', note: '已联系', nextDate: day(i + 5) });
  }
  host.persist(); host.render();
}

function snapshot() {
  const state = window.__zhikeRegistryHost.state, ids = (list, prefix) => list.filter(row => String(row.id).startsWith(prefix)).length;
  const first = state.customers.find(row => row.id === 'SYN0');
  return [ids(state.customers, 'SYN'), ids(state.tickets, 'TK'), ids(state.deposits, 'DP'), ids(state.registrations, 'RG'), ids(state.followups, 'FU'),
    (first?.manualLockedFields || []).join(','), first?.name];
}

(async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zhike-page-sweep-'));
  const server = await startServer(dataDir, token);
  const origin = new URL((await server.request('/api/health')).url).origin;
  const browser = await chromium.launch();
  const issues = [];
  let step = 'boot';
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    page.on('pageerror', error => issues.push([step, 'pageerror', error.message]));
    page.on('console', message => { if (message.type() === 'error') issues.push([step, 'console', message.text().slice(0, 200)]); });
    page.on('response', response => { if (response.status() >= 400) issues.push([step, 'http ' + response.status(), new URL(response.url()).pathname]); });
    // The native host adds the local API token; do the same for /api/ only.
    await page.route('**/api/**', route => route.continue({ headers: { ...route.request().headers(), 'x-zhike-api-token': token } }));
    await page.goto(origin + '/');
    await page.waitForTimeout(2000);

    step = 'seed';
    await page.evaluate(seed);
    await page.evaluate(() => window.__zhikeRegistryHost.flushStateWrites());
    const before = await page.evaluate(snapshot);
    step = 'reload';
    await page.reload();
    await page.waitForTimeout(2500);
    const after = await page.evaluate(snapshot);
    if (JSON.stringify(before) !== JSON.stringify(after)) issues.push([step, 'roundtrip', JSON.stringify({ before, after })]);

    const views = (await page.$$eval('.nav-item[data-view]', nodes => [...new Set(nodes.map(node => node.dataset.view))])).filter(view => view !== 'ws-workbench');
    for (const view of views) {
      step = view;
      await page.click(`.nav-item[data-view="${view}"]`, { timeout: 5000 }).catch(error => issues.push([view, 'click', error.message.split('\n')[0]]));
      await page.waitForTimeout(800);
      const length = await page.$eval('#viewContainer', node => node.innerText.trim().length).catch(() => -1);
      if (length < 20) issues.push([view, 'blank', 'view text length ' + length]);
    }

    step = 'customer360';
    await page.click('.nav-item[data-view="customers"]');
    await page.waitForTimeout(800);
    await page.evaluate(() => { const host = window.__zhikeRegistryHost; for (const id of ['SYN0', 'SYN3', 'SYN7']) host.showCustomer(host.state.customers.find(row => row.id === id)); });
    await page.waitForTimeout(800);
    const drawer = await page.$eval('#customerDrawer', node => ({ open: node.classList.contains('open'), text: node.innerText.length })).catch(() => null);
    if (!drawer?.open || drawer.text < 50) issues.push([step, 'drawer', JSON.stringify(drawer)]);
    const escaped = await page.evaluate(() => document.getElementById('customerDrawer').innerText.includes('<b>测试</b>') && !document.querySelector('#customerDrawer b, #viewContainer b'));
    if (!escaped) issues.push([step, 'escaping', 'a customer name containing markup was not shown as text']);

    for (const mode of ['#wsWorkbenchNav', '#wsDedicatedNav']) {
      step = mode;
      await page.click(mode);
      await page.waitForTimeout(1200);
      const workspaceViews = await page.$$eval('.ws-workspace-nav [data-ws-workspace-view]', nodes => [...new Set(nodes.map(node => node.dataset.wsWorkspaceView))]);
      for (const view of workspaceViews) {
        step = mode + ' ' + view;
        await page.click(`.ws-workspace-nav [data-ws-workspace-view="${view}"]`, { timeout: 5000 }).catch(error => issues.push([step, 'click', error.message.split('\n')[0]]));
        await page.waitForTimeout(500);
      }
      step = mode + ' return';
      await page.click('[data-ws-action="return-zhike"]');
      await page.waitForTimeout(800);
      if (!await page.$eval('.nav-item[data-view="home"]', node => node.getClientRects().length > 0).catch(() => false)) issues.push([step, 'navigation', 'main navigation hidden after 返回知客']);
    }
    console.log(`Swept ${views.length} pages, the customer 360 drawer and both WS workspaces; data round-trip ${JSON.stringify(after)}`);
  } finally {
    await browser.close();
    await server.stop();
    fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
  for (const issue of issues) console.log('ISSUE ' + issue.join(' | '));
  console.log(issues.length ? `${issues.length} issue(s) found` : 'No issues found');
  if (issues.length) process.exitCode = 1;
})().catch(error => { console.error(error); process.exitCode = 1; });
