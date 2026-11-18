'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../resources/app/modules/v4-data-center.js'), 'utf8');
const entry = source.replace(/\}\)\(\);\s*$/, 'globalThis.enhancer = { dataCenter, batchLog }; $&');
const successfulReport = { ok: true, schemaVersion: 25, databaseBytes: 2 * 1048576, anomalies: { orphaned: { tickets: 1, deposits: 2, followups: 0, registrations: 0 } } };

function fixture() {
  const requests = [];
  const downloads = [];
  const fields = new Map();
  let heading;
  let search;
  let panel;
  let batchSections;
  const view = {
    querySelector(selector) {
      if (selector === '#recentSnapshot') return document.documentElement.dataset.view === 'data' ? {} : null;
      if (selector === '#v4Diagnostics') return panel || null;
      if (selector === '[data-activity-search]') return search || null;
      if (selector === '#v4BatchLog') return batchSections[0] || null;
      return null;
    },
    querySelectorAll(selector) { return selector === 'h1' ? [heading] : []; },
    appendChild(section) { panel = section; },
    insertAdjacentHTML(position, html) {
      assert.equal(position, 'beforeend');
      batchSections.push(html);
    },
  };
  const modal = { querySelector: () => null };
  const document = {
    documentElement: { dataset: {} },
    addEventListener() {},
    querySelector(selector) {
      if (selector === '#viewContainer') return view;
      if (selector === '#modal') return modal;
      return null;
    },
    createElement(tag) {
      if (tag === 'a') return { click() { downloads.push({ name: this.download, blob: this.href }); } };
      return { querySelector(selector) {
        if (!fields.has(selector)) fields.set(selector, {});
        return fields.get(selector);
      } };
    },
  };
  const runtime = {
    document, Blob, setTimeout() {}, clearTimeout() {}, URL: { createObjectURL: blob => blob },
    MutationObserver: class { observe() {} },
    fetch(route, options) {
      assert.equal(options.cache, 'no-store');
      assert.equal(options.method || 'GET', 'GET');
      return new Promise((resolve, reject) => requests.push({
        route, reject,
        respond(payload, status = 200) { resolve({ ok: status === 200, status, json: async () => payload }); },
      }));
    },
  };
  vm.runInNewContext(entry, runtime);
  function render(route) {
    document.documentElement.dataset.view = route;
    heading = { textContent: { data: '数据中心', activity: '操作记录', customers: '客户中心' }[route] };
    search = route === 'activity' ? {} : null;
    panel = null;
    batchSections = [];
  }
  return { render, requests, downloads, fields, get batchSections() { return batchSections; }, ...runtime.enhancer };
}

const flush = () => new Promise(setImmediate);
const batch = value => ({ batchOperations: [{ value, count: 2, status: '已执行', createdAt: '2026-11-17T12:00Z' }] });

test('diagnostics never renders HTTP 503 numbers and retries with the original export', async () => {
  const f = fixture();
  f.render('data');
  await f.dataCenter();
  assert.equal(f.requests[0].route, '/api/diagnostics');
  const exportButton = f.fields.get('#v4DownloadDiagnostic');
  assert.equal(exportButton.disabled, true, 'no export while the initial read is pending');
  f.requests[0].respond(successfulReport);
  await flush();
  const text = key => f.fields.get(key).textContent;
  const exportReport = exportButton.onclick;
  assert.equal(exportButton.disabled, false, 'a valid report enables export');
  const retry = f.fields.get('#v4RunDiagnostic').onclick;
  assert.deepEqual([text('#v4Schema'), text('#v4Integrity'), text('#v4Orphans'), text('#v4Size')], ['v25', '正常', 3, '2.00 MB']);
  exportReport();
  assert.equal(f.downloads.length, 1);
  assert.deepEqual(JSON.parse(await f.downloads[0].blob.text()), successfulReport);

  const failed = retry();
  assert.equal(exportButton.disabled, true, 'a recheck disables export while pending');
  f.requests[1].respond({ error: 'unavailable' }, 503);
  await failed;
  assert.deepEqual([text('#v4Schema'), text('#v4Integrity'), text('#v4Orphans'), text('#v4Size')], ['—', '—', '—', '—']);
  assert.match(text('#v4Report'), /诊断读取失败.*重新检查/);
  assert.equal(exportButton.disabled, true, 'a failed read leaves export disabled');
  exportReport();
  assert.equal(f.downloads.length, 1, 'a failed retry cannot export a stale or error report');

  const recovered = retry();
  f.requests[2].respond({ ...successfulReport, ok: false });
  await recovered;
  assert.equal(text('#v4Integrity'), '需要处理', 'a valid report can still describe an integrity problem');
  assert.equal(text('#v4Orphans'), 3);
  assert.equal(exportButton.disabled, false, 'a valid integrity warning remains exportable');
});

test('incomplete diagnostics and late responses cannot replace current status', async () => {
  const f = fixture();
  f.render('data');
  await f.dataCenter();
  const retry = f.fields.get('#v4RunDiagnostic').onclick;
  const latest = retry();
  const exportButton = f.fields.get('#v4DownloadDiagnostic');
  assert.equal(exportButton.disabled, true);
  f.requests[1].respond({ ...successfulReport, anomalies: { orphaned: { tickets: 0 } } });
  await latest;
  f.requests[0].respond(successfulReport);
  await flush();
  assert.equal(f.fields.get('#v4Schema').textContent, '—');
  assert.match(f.fields.get('#v4Report').textContent, /诊断读取失败/);
  assert.equal(exportButton.disabled, true, 'late success cannot enable export after the latest failure');

  const older = retry();
  const current = retry();
  f.requests[3].respond(successfulReport);
  await current;
  f.requests[2].respond(null, 503);
  await older;
  assert.equal(exportButton.disabled, false, 'late failure cannot disable an export for the latest valid report');
});

test('pending operation history cannot mount after leaving the activity page', async () => {
  const f = fixture();
  f.render('activity');
  const late = f.batchLog();
  assert.equal(f.requests[0].route, '/api/state');
  f.render('customers');
  f.requests[0].respond(batch('STALE_A'));
  await late;
  assert.equal(f.batchSections.length, 0);
});

test('only the current activity render can mount operation history once', async () => {
  const f = fixture();
  f.render('activity');
  const old = f.batchLog();
  f.render('activity');
  const current = f.batchLog();
  const duplicate = f.batchLog();
  assert.equal(f.requests.length, 2);
  f.requests[0].respond(batch('STALE_A'));
  await old;
  assert.equal(f.batchSections.length, 0);
  f.requests[1].respond(batch('CURRENT_B'));
  await Promise.all([current, duplicate]);
  assert.equal(f.batchSections.length, 1);
  assert.match(f.batchSections[0], /CURRENT_B/);
  assert.doesNotMatch(f.batchSections[0], /STALE_A/);
});
