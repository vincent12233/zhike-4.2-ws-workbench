'use strict';
// Diagnostic-only injection into the named, already-isolated native fixture.
// No production source, profile, token, customer text or business data is read.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const repo = path.resolve(__dirname, '../..');
const output = path.join(repo, '.tools', 'stage51-native-v2');
const file = path.join(output, 'resources', 'app', 'index.html');
const marker = 'stage51-native-input-probe';
const script = String.raw`
(() => {
  'use strict';
  if (window.__stage51NativeInputProbe) return;
  const counts = { wheel: 0, click: 0, keydown: 0, pointermove: 0, pointerdown: 0, pointerup: 0, dragstart: 0, dragover: 0, dragend: 0, drop: 0 };
  const state = { counts, lastInput: null, lastWheel: null, lastPointer: null, lastDrag: null };
  window.__stage51NativeInputProbe = state;
  const regions = [
    ['editor', 'input,textarea,select,[contenteditable="true"]'], ['pre', 'pre'],
    ['table', '.table-scroll'], ['drawer', '#customerDrawer,.ws-assist-drawer-body'], ['ws-navigation', '.ws-workspace-nav-list'],
    ['ws-content', '.ws-workspace-page-content'], ['dialog', '#modal,.modal-body,[role="dialog"]'],
    ['sidebar', '#sidebar,#mainNav'], ['page', '#viewContainer'],
  ];
  const region = (node, closest = false) => {
    if (!(node instanceof Element)) return 'other';
    if (node === document.scrollingElement) return 'document';
    for (let current = node; current; current = closest ? current.parentElement : null) {
      const match = regions.find(([, selector]) => current.matches(selector));
      if (match) return match[0];
    }
    return 'other';
  };
  const allowedTags = new Set(['a','body','button','div','footer','input','li','main','nav','p','pre','section','select','span','table','td','textarea','th','tr']);
  const label = node => node instanceof Element ? {
    tag: allowedTags.has(node.localName) ? node.localName : 'other', classes: region(node, true),
  } : null;
  const nearest = node => node instanceof Element ? node.closest('.ws-workspace-nav-list,.ws-workspace-page-content,[data-scroll-mode]') : null;
  const metrics = node => node ? { ...label(node), mode: ['contain', 'horizontal', 'page', 'handoff'].includes(node.dataset.scrollMode) ? node.dataset.scrollMode : '', top: Math.round(node.scrollTop), height: node.clientHeight, total: node.scrollHeight, connected: node.isConnected } : null;
  const inputPosition = event => ({
    type: event.type, target: label(event.target), timeStamp: event.timeStamp,
    clientX: event.clientX, clientY: event.clientY, screenX: event.screenX, screenY: event.screenY,
  });
  function wheelGeometry() {
    const bounds = selector => {
      const rect = document.querySelector(selector)?.getBoundingClientRect();
      return rect ? { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom } : null;
    };
    const visual = window.visualViewport;
    const { theme, palette, view } = document.documentElement.dataset;
    return {
      dpr: window.devicePixelRatio, width: innerWidth, height: innerHeight,
      visual: visual ? { width: visual.width, height: visual.height, scale: visual.scale, left: visual.offsetLeft, top: visual.offsetTop } : null,
      table: bounds('.table-scroll'), footer: bounds('footer.app-footer'),
      dialog: bounds('#modalBackdrop:not(.hidden) #modal'),
      modalOpen: !!document.querySelector('#modalBackdrop:not(.hidden)'),
      drawerOpen: !!document.querySelector('#customerDrawer.open'),
      theme: ['dark', 'light'].includes(theme) ? theme : null,
      palette: ['atelier-dawn', 'horizon-night'].includes(palette) ? palette : null,
      view: ['home', 'customers', 'ws-workbench', 'settings'].includes(view) ? view : null,
    };
  }
  function sendSample(phase, geometry, eventMs, wheelCount, sample, frameCount) {
    const box = rect => rect && [rect.left, rect.top, rect.right, rect.bottom];
    window.chrome?.webview?.postMessage(JSON.stringify({
      type: 'stage51.input.' + phase, phase, eventMs, wheelCount, frameCount,
      timeOriginMs: performance.timeOrigin, sampleMs: performance.now(),
      geometry: { dpr: geometry.dpr, width: geometry.width, height: geometry.height,
        visualWidth: geometry.visual?.width, visualHeight: geometry.visual?.height,
        visualScale: geometry.visual?.scale, visualLeft: geometry.visual?.left, visualTop: geometry.visual?.top,
        table: box(geometry.table), footer: box(geometry.footer), dialog: box(geometry.dialog),
        theme: geometry.theme, palette: geometry.palette, view: geometry.view,
        modalOpen: geometry.modalOpen, drawerOpen: geometry.drawerOpen },
      state: sample,
    }));
  }
  const focus = () => ({ focus: region(document.activeElement, true), focused: document.hasFocus() });
  const offsets = node => node.isConnected
    ? [node.scrollTop, node.scrollLeft, node.clientHeight, node.scrollHeight, node.clientWidth, node.scrollWidth] : null;
  function scrollCandidates(target) {
    const candidates = new Map();
    const add = (node, label) => {
      if (node && !candidates.has(node) && candidates.size < 10)
        candidates.set(node, { region: label, before: offsets(node) });
    };
    for (const selector of ['#mainNav', '#viewContainer', '.ws-workspace-nav-list', '.ws-workspace-page-content']) {
      const node = document.querySelector(selector);
      if (node) add(node, region(node));
    }
    add(document.scrollingElement, 'document');
    for (let node = target; node instanceof Element && candidates.size < 10; node = node.parentElement) {
      const name = region(node);
      if (node === document.body || candidates.has(node)) continue;
      if (name === 'table' || node.matches('[data-scroll-mode]') || (name === 'pre' || name === 'editor')
        && (node.scrollHeight > node.clientHeight || node.scrollWidth > node.clientWidth)) add(node, name === 'other' ? 'scrollable' : name);
      else if (node.scrollHeight > node.clientHeight + 1 || node.scrollWidth > node.clientWidth + 1) {
        const style = getComputedStyle(node);
        if (/(auto|scroll|overlay)/.test(style.overflowY + ' ' + style.overflowX)) add(node, name === 'other' ? 'scrollable' : name);
      }
    }
    return candidates;
  }
  const positionSample = row => row && [row.clientX, row.clientY, row.screenX, row.screenY];
  const wheelLimit = 256;
  let settleTimer, firstUnsettledWheel = 0;
  function scheduleSettlement(row, sequence, sample, candidates) {
    if (!firstUnsettledWheel) firstUnsettledWheel = sequence;
    const first = firstUnsettledWheel;
    clearTimeout(settleTimer);
    const readOffsets = () => Array.from(candidates.keys(), offsets);
    const compare = (previous, attempts) => {
      if (counts.wheel !== sequence) return;
      const afterQuiet = readOffsets();
      const stable = JSON.stringify(previous) === JSON.stringify(afterQuiet);
      if (!stable && attempts < 3) {
        settleTimer = setTimeout(() => compare(afterQuiet, attempts + 1), 120);
        return;
      }
      sendSample('wheel-settled', wheelGeometry(), row.timeStamp, sequence, {
        ...sample, firstWheelCount: first, quietMs: performance.now() - row.observedAt,
        offsetsStable: stable, overlap: first !== sequence,
        candidates: [...candidates.values()].map((candidate, index) => ({ ...candidate, afterQuiet: afterQuiet[index] })),
      });
      firstUnsettledWheel = 0;
    };
    settleTimer = setTimeout(() => {
      const previous = readOffsets();
      settleTimer = setTimeout(() => compare(previous, 1), 120);
    }, 500);
  }
  let layoutTimer, layoutReports = 0, wheelReports = 0, nextWheelReport = 0;
  function scheduleLayout() {
    if (layoutReports >= 128) return;
    clearTimeout(layoutTimer);
    layoutTimer = setTimeout(() => {
      layoutReports++;
      sendSample('layout', wheelGeometry(), performance.now(), counts.wheel, focus());
    }, 260);
  }
  addEventListener('resize', scheduleLayout, { passive: true });
  window.visualViewport?.addEventListener('resize', scheduleLayout, { passive: true });
  let hud, frameCount = 0, dragPaintPending = false;
  // A bounded, event-driven snapshot: no observer, timer, text or customer identity reads.
  function layoutSnapshot() {
    const cards = document.querySelectorAll('.ops-card');
    const tableScroll = document.querySelector('.table-scroll');
    const table = tableScroll?.querySelector('table');
    const headRect = table?.tHead?.getBoundingClientRect();
    const firstRow = table?.tBodies?.[0]?.rows?.[0];
    let textRect = null;
    if (firstRow) {
      const walker = document.createTreeWalker(firstRow, NodeFilter.SHOW_TEXT);
      for (let index = 0, node = walker.nextNode(); node && index < 20; index++, node = walker.nextNode()) {
        const range = document.createRange();
        range.selectNodeContents(node);
        const rect = [...range.getClientRects()].find(value => value.width > 0 && value.height > 0);
        range.detach();
        if (rect) { textRect = rect; break; }
      }
    }
    const point = textRect ? { x: textRect.left + 1, y: textRect.top + 1 } : null;
    const pointInViewport = !!point && point.x >= 0 && point.x < innerWidth && point.y >= 0 && point.y < innerHeight;
    return { cards: cards.length, draggable: [...cards].filter(node => node.draggable === true).length,
      tableScrollTop: tableScroll ? Math.round(tableScroll.scrollTop) : null,
      theadBottom: headRect ? Math.round(headRect.bottom) : null,
      firstTextTop: textRect ? Math.round(textRect.top) : null,
      pointInViewport, pointTarget: pointInViewport ? label(document.elementFromPoint(point.x, point.y)) : null };
  }
  function paint() {
    if (!document.body) return;
    if (!hud?.isConnected) {
      hud = document.createElement('pre'); hud.id = 'stage51NativeInputHud'; hud.setAttribute('aria-label', 'Isolated input diagnostic');
      hud.style.cssText = 'position:fixed;right:6px;bottom:4px;z-index:2147483647;max-width:600px;max-height:380px;overflow:hidden;margin:0;padding:6px 8px;border:1px solid #79d8ce;border-radius:6px;background:#071a20ed;color:#d5f8ee;font:10px/1.3 Consolas,monospace;white-space:pre-wrap;pointer-events:none;';
      document.body.appendChild(hud);
    }
    if (hud.hidden) return;
    const describe = value => value ? (value.tag || '') + (value.classes ? '.' + value.classes : '') : '-';
    const position = value => value ? 'top=' + value.top + ' height=' + value.height + '/' + value.total + ' connected=' + value.connected : '-';
    const coordinate = value => Number.isFinite(value) ? Math.round(value * 100) / 100 : '-';
    const point = (x, y) => coordinate(x) + ',' + coordinate(y);
    const inputPoint = value => value ? 'client=' + point(value.clientX, value.clientY) + ' screen=' + point(value.screenX, value.screenY) : '-';
    const bounds = value => value ? '[' + point(value.left, value.top) + ' → ' + point(value.right, value.bottom) + ']' : '-';
    const row = state.lastWheel, layout = layoutSnapshot();
    const pointer = row ? row.pointer : state.lastPointer;
    hud.textContent = ['STAGE51 DIAGNOSTIC: trusted inputs only',
      'wheel=' + counts.wheel + ' click=' + counts.click + ' keydown=' + counts.keydown,
      'pointermove=' + counts.pointermove + ' pointerdown=' + counts.pointerdown + ' pointerup=' + counts.pointerup,
      'dragstart=' + counts.dragstart + ' dragover=' + counts.dragover + ' dragend=' + counts.dragend + ' drop=' + counts.drop,
      'last=' + (state.lastInput?.type || '-') + ' target=' + describe(state.lastInput?.target),
      'last drag=' + (state.lastDrag?.type || '-') + ' target=' + describe(state.lastDrag?.target),
      'ops-card=' + layout.cards + ' draggable=true=' + layout.draggable,
      'table scrollTop=' + (layout.tableScrollTop ?? '-') + ' thead.bottom=' + (layout.theadBottom ?? '-') + ' first text.top=' + (layout.firstTextTop ?? '-'),
      'first text point inViewport=' + layout.pointInViewport + ' target=' + describe(layout.pointTarget),
      'last pointer' + (row ? ' before wheel' : '') + '=' + (pointer?.type || '-') + ' target=' + describe(pointer?.target),
      'pointer ' + inputPoint(pointer) + (row && pointer ? ' ageMs=' + coordinate(row.timeStamp - pointer.timeStamp) : ''),
      ...(row ? ['wheel target=' + describe(row.target) + ' point hit=' + describe(row.pointTarget),
        'wheel ' + inputPoint(row),
        'DPR=' + coordinate(row.geometry.dpr) + ' inner=' + point(row.geometry.width, row.geometry.height),
        'visual viewport ' + (row.geometry.visual ? point(row.geometry.visual.width, row.geometry.visual.height) + ' scale=' + coordinate(row.geometry.visual.scale) + ' offset=' + point(row.geometry.visual.left, row.geometry.visual.top) : '-'),
        'table rect=' + bounds(row.geometry.table) + ' footer rect=' + bounds(row.geometry.footer),
        'deltaY=' + row.deltaY + ' deltaX=' + row.deltaX + ' mode=' + row.deltaMode,
        'coordinator=' + row.coordinatorLoaded + ' modal=' + row.modalOpen + ' prevented=' + row.preventedBefore + '/' + row.preventedAfter,
        'owner=' + describe(row.before) + ' mode=' + (row.after?.mode || row.before?.mode || '-'),
        'before ' + position(row.before), 'after ' + position(row.after), 'frame ' + position(row.nextFrame), 'current ' + position(row.currentNode)] : ['No trusted wheel reached the shell DOM.'])].join('\n');
  }
  for (const type of ['click', 'keydown']) addEventListener(type, event => {
    if (!event.isTrusted) return;
    if (type === 'keydown' && !event.repeat) {
      if (event.key === 'F7' && hud) hud.hidden = !hud.hidden;
      if (event.key === 'F8' && frameCount < 128) {
        const frame = ++frameCount;
        const eventMs = event.timeStamp;
        requestAnimationFrame(() => requestAnimationFrame(() =>
          sendSample('frame', wheelGeometry(), eventMs, counts.wheel, focus(), frame)));
      }
    }
    counts[type]++; state.lastInput = { type, target: label(event.target) }; paint();
    if (type === 'click') scheduleLayout();
  }, { capture: true, passive: true });
  addEventListener('pointermove', event => {
    if (!event.isTrusted) return;
    counts.pointermove++;
    // Snapshot the most recent trusted pointer at the next wheel. Avoid
    // painting or recalculating layout in a high-frequency move handler.
    state.lastPointer = inputPosition(event);
  }, { capture: true, passive: true });
  for (const type of ['pointerdown', 'pointerup', 'dragstart', 'dragover', 'dragend', 'drop']) addEventListener(type, event => {
    if (!event.isTrusted) return;
    counts[type]++;
    if (type === 'pointerdown' || type === 'pointerup') state.lastPointer = inputPosition(event);
    state.lastInput = { type, target: label(event.target) };
    if (type.startsWith('drag') || type === 'drop') state.lastDrag = state.lastInput;
    if (type !== 'dragover') { paint(); return; }
    if (dragPaintPending) return;
    dragPaintPending = true;
    requestAnimationFrame(() => { dragPaintPending = false; paint(); });
  }, { capture: true, passive: true });
  addEventListener('wheel', event => {
    if (!event.isTrusted) return;
    const sequence = ++counts.wheel;
    if (sequence > wheelLimit) {
      if (sequence === wheelLimit + 1) {
        clearTimeout(settleTimer);
        sendSample('wheel-limit', wheelGeometry(), event.timeStamp, sequence, focus());
      }
      return;
    }
    const now = performance.now();
    const candidates = scrollCandidates(event.target);
    const owner = nearest(event.target);
    const row = {
      ...inputPosition(event), observedAt: now, pointer: state.lastPointer,
      pointTarget: label(document.elementFromPoint(event.clientX, event.clientY)), geometry: wheelGeometry(),
      deltaMode: event.deltaMode, deltaY: event.deltaY, deltaX: event.deltaX,
      preventedBefore: event.defaultPrevented, modalOpen: !!document.querySelector('#modalBackdrop:not(.hidden)'),
      coordinatorLoaded: !!window.ZhikeScrollCoordinator, before: metrics(owner), after: null, nextFrame: null, currentNode: null,
    };
    const sample = {
      ...focus(), target: row.target?.classes || 'other',
      hit: row.pointTarget?.classes || 'other', pointer: positionSample(row.pointer),
      wheelPoint: positionSample(row), pointerAgeMs: row.pointer ? row.timeStamp - row.pointer.timeStamp : null,
      deltaY: row.deltaY, deltaX: row.deltaX, deltaMode: row.deltaMode,
      ctrl: event.ctrlKey, shift: event.shiftKey, meta: event.metaKey, cancelable: event.cancelable,
      modal: row.modalOpen, preventedBefore: row.preventedBefore, trusted: event.isTrusted,
    };
    sendSample('wheel-arrival', row.geometry, row.timeStamp, sequence, { ...sample, candidates: [...candidates.values()] });
    scheduleSettlement(row, sequence, sample, candidates);
    if (now < nextWheelReport || wheelReports >= 192) return;
    nextWheelReport = now + 90;
    wheelReports++;
    state.lastWheel = row; paint();
    queueMicrotask(() => { row.preventedAfter = event.defaultPrevented; row.after = metrics(owner); paint(); });
    requestAnimationFrame(() => {
      row.preventedAfter = event.defaultPrevented;
      row.nextFrame = metrics(owner);
      const current = owner?.matches('.ws-workspace-nav-list') ? document.querySelector('.ws-workspace-nav-list') : owner?.matches('.ws-workspace-page-content') ? document.querySelector('.ws-workspace-page-content') : owner;
      row.currentNode = metrics(current); paint();
      for (const [node, candidate] of candidates) candidate.afterDispatch = offsets(node);
      requestAnimationFrame(() => {
        for (const [node, candidate] of candidates) candidate.afterFrames = offsets(node);
        sendSample('wheel', row.geometry, row.timeStamp, sequence, {
          ...sample, preventedAfter: row.preventedAfter,
          candidates: [...candidates.values()], overlap: counts.wheel !== sequence,
        });
      });
    });
  }, { capture: true, passive: true });
  const start = () => { paint(); scheduleLayout(); };
  if (document.readyState === 'loading') addEventListener('DOMContentLoaded', start, { once: true }); else start();
})();`;
function injectNativeProbe() {
  assert.equal(process.argv.length, 2, 'No arbitrary fixture path is accepted.');
  for (let current = path.dirname(file); current.length >= repo.length; current = path.dirname(current)) {
    const stat = fs.lstatSync(current);
    assert.ok(stat.isDirectory() && !stat.isSymbolicLink(), 'Reparse-point fixture paths are forbidden.');
    if (current === repo) break;
  }
  for (const filename of [file, path.join(output, 'Zhike.Stage51.Acceptance.exe')]) {
    const stat = fs.lstatSync(filename);
    assert.ok(stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1, 'The isolated fixture requires regular, unlinked files.');
  }
  let html = fs.readFileSync(file, 'utf8');
  html = html.replace(/\n?<script id="stage51-native-input-probe">[\s\S]*?<\/script>\n?/g, '\n');
  assert.ok(html.includes('</body>'), 'The real fixture shell must contain its closing body.');
  const injected = html.replace('</body>', `<script id="${marker}">${script}</script>\n</body>`);
  assert.equal((injected.match(/<script id="stage51-native-input-probe">/g) || []).length, 1);
  fs.writeFileSync(file, injected);
  console.log('Stage 5.1 trusted input HUD injected into the isolated native fixture only; intentional reload required; no production file changed.');
}

module.exports = { script };
if (require.main === module) injectNativeProbe();
