'use strict';

// Installed only in a prepared native acceptance output. The probe observes
// trusted clicks, reads fixed readiness predicates, and exports timings on demand.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function install() {
  assert.equal(process.argv.length, 3, 'Supply one prepared native fixture directory.');
  const output = path.resolve(process.argv[2]);
  assert.ok(['stage51-native-output', 'stage51-native-v2', 'stage52-native'].includes(path.basename(output)), 'Invalid fixture output name.');
  const shell = path.join(output, 'resources/app/index.html');
  const binary = path.join(output, 'Zhike.Stage51.Acceptance.exe');
  for (const file of [shell, binary]) {
    const stat = fs.lstatSync(file);
    assert.ok(stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1, 'Fixture files must be regular and unlinked.');
    assert.equal(fs.realpathSync(file).toLowerCase(), file.toLowerCase(), 'Fixture path must not traverse a junction.');
  }
  const html = fs.readFileSync(shell, 'utf8');
  const marker = 's3-native-performance-probe';
  assert.ok(!html.includes(marker), 'Probe already installed.');
  assert.equal(html.split('</body>').length, 2, 'Expected one closing shell body.');
  fs.writeFileSync(shell, html.replace('</body>', '<script id="' + marker + '">(' + probe.toString() + ')();</script>\n</body>'));
  console.log('Installed native performance timing probe in the isolated fixture shell.');
}

function probe() {
  if (document.documentElement.dataset.stage51Isolated !== 'true') {
    // The isolated host registers its marker on Window before this script.
    // A Document listener would run before the host regardless of registration order.
    window.addEventListener('DOMContentLoaded', () => {
      if (document.documentElement.dataset.stage51Isolated === 'true') probe();
    }, { once: true });
    return;
  }
  const $ = selector => document.querySelector(selector);
  const visible = selector => {
    const element = $(selector);
    return !!element?.getClientRects().length && getComputedStyle(element).visibility === 'visible';
  };
  const view = () => document.documentElement.dataset.view;
  const crm = () => view() === 'customers' && visible('.customer6-workspace tr[data-customer]');
  const home = () => view() === 'home' && visible('.home-dashboard-primary');
  const workspace = () => view() === 'ws-workbench' && visible('.ws-workbench-page');
  const readyPage = page => {
    const section = $('[data-ws-workspace-page="' + page + '"][aria-busy="false"]');
    return workspace() && section && !section.querySelector('.ws-error-line[role="alert"]');
  };
  const groups = () => readyPage('groups') && visible('.ws-group-directory-main [data-ws-action="group-directory-detail"]');
  const members = () => readyPage('members') && visible('[data-ws-workspace-page="members"] .ws-business-table [data-ws-action="business-detail"]');
  const drawer = () => visible('#customerDrawer.open .drawer-head h2');
  const modal = () => visible('#modalBackdrop:not(.hidden) #modal .modal-header');

  const presentedAccount = () => $('.ws-workbench-page')?.dataset.wsAccountId;
  function accountSwitch(account) {
    // switchAccount renders its target before awaiting the native request.
    // Clicking that account again is a no-op even while the first switch is busy.
    if (!['default', 'native-b'].includes(account) || presentedAccount() === account) return null;
    return [
      'account-' + account,
      () => workspace() && presentedAccount() === account &&
        !!$('.ws-cockpit-accounts [data-ws-action="create-account"]:not(:disabled)') && !$('.ws-error-banner')
    ];
  }

  function match(target) {
    const nav = target.closest('#mainNav [data-view], [data-workspace-target], [data-ws-action="return-zhike"]');
    if (nav) {
      if (nav.dataset.view === 'customers') return ['crm-list', crm];
      if (nav.dataset.view === 'home') return ['home', home];
      if (nav.dataset.view === 'ws-workbench' || nav.dataset.workspaceTarget === 'ws') {
        return ['ws-entry', () => workspace() && visible('.ws-workspace-nav-list') &&
          !$('.ws-workspace-page-content[aria-busy="true"]')];
      }
      if (nav.dataset.workspaceTarget === 'main' || nav.dataset.wsAction === 'return-zhike') {
        return ['return-crm', () => !workspace() && (home() || crm())];
      }
    }
    if (target.closest('[data-action="close-customer-drawer"]')) return ['customer-detail-close', () => !drawer()];
    if (view() === 'customers' && target.closest('tr[data-customer]') && !target.closest('button,input')) {
      return ['customer-detail-open', drawer];
    }
    if (target.closest('#appearanceButton, [data-action="new-customer"]')) return ['dialog-open', modal];
    if (target.closest('#modal [data-action="close-modal"], #modal [data-shell-action="cancel"]') ||
        target.id === 'modalBackdrop') return ['dialog-close', () => !modal()];

    const item = target.closest('[data-ws-workspace-view], [data-ws-action]');
    if (!item) return null;
    if (item.dataset.wsWorkspaceView === 'groups') return ['groups-list', groups];
    if (item.dataset.wsWorkspaceView === 'members') return ['members-list', members];
    if (item.dataset.wsWorkspaceView === 'overview') return ['ws-overview', () => readyPage('overview')];
    if (item.dataset.wsAction === 'group-directory-detail') {
      if (visible('.ws-group-detail-panel')) return ['group-detail-close', () => !visible('.ws-group-detail-panel')];
      return ['group-detail-open', () => visible('.ws-group-detail-panel')];
    }
    if (item.dataset.wsAction === 'switch-account') return accountSwitch(item.dataset.accountId);
    return null;
  }

  const rowLimit = 192;
  const rows = [];
  const panel = document.createElement('details');
  panel.style.cssText = 'position:fixed;right:8px;bottom:8px;z-index:2147483647;color:white;background:#172235;padding:4px 8px;font:12px monospace';
  const label = document.createElement('summary');
  const copy = document.createElement('textarea');
  copy.readOnly = true;
  copy.rows = 8;
  copy.cols = 68;
  panel.append(label, copy);
  document.body.append(panel);
  label.textContent = 'S3 timing · 0';
  panel.addEventListener('toggle', () => {
    if (panel.open) {
      copy.value = JSON.stringify(rows);
      copy.focus({ preventScroll: true });
      copy.select();
    }
  });

  let pending;
  const elapsed = (from, to) => Math.round((to - from) * 10) / 10;
  function finish(task, outcome, now) {
    rows.push({
      operation: task.name, outcome, inputType: task.inputType, inputUtc: new Date(performance.timeOrigin + task.input).toISOString(),
      dispatchMs: elapsed(task.input, task.dispatch),
      readyMs: outcome === 'ready' ? elapsed(task.input, task.firstReady) : null,
      nextFrameMs: outcome === 'ready' ? elapsed(task.input, now) : null
    });
    pending = null;
    label.textContent = 'S3 timing · ' + rows.length + ' · ' + task.name + ' ' +
      (outcome === 'ready' ? elapsed(task.input, task.firstReady) + 'ms' : outcome);
  }

  function observeInput(event) {
    if (!event.isTrusted || !(event.target instanceof Element) || rows.length >= rowLimit) return;
    const operation = event.type === 'click' ? match(event.target) :
      event.target.id === 'wsTopAccount' ? accountSwitch(event.target.value) : null;
    if (!operation) return;
    const dispatch = performance.now();
    if (pending) finish(pending, 'interrupted', dispatch);
    if (rows.length >= rowLimit) return;
    const [name, ready] = operation;
    const task = { name, inputType: event.type, input: Math.min(event.timeStamp, dispatch), dispatch, firstReady: null };
    if (ready()) {
      finish(task, 'already-ready', dispatch);
      return;
    }
    pending = task;
    function observe() {
      if (pending !== task) return;
      const now = performance.now();
      if (now - dispatch >= 15000) {
        finish(task, 'readiness-not-observed', now);
        return;
      }
      if (ready()) {
        if (task.firstReady !== null) {
          finish(task, 'ready', now);
          return;
        }
        task.firstReady = now;
      } else task.firstReady = null;
      requestAnimationFrame(observe);
    }
    requestAnimationFrame(observe);
  }
  for (const type of ['click', 'change']) {
    document.addEventListener(type, observeInput, { capture: true, passive: true });
  }
}

if (require.main === module) install();
module.exports = { probe };
