'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const app = path.resolve(__dirname, '../resources/app');
const source = fs.readFileSync(path.join(app, 'modules/customer-avatar.js'), 'utf8');
const html = fs.readFileSync(path.join(app, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(app, 'modules/design-system.css'), 'utf8');
const callbacks = new Map();
const window = { atob };
const document = {
  addEventListener(type, callback, capture) {
    assert.equal(capture, true, 'resource load and error require capture');
    assert.equal(callbacks.has(type), false, 'only one listener per resource event');
    callbacks.set(type, callback);
  },
};
const context = vm.createContext({ window, document });
vm.runInContext(source, context);
const avatar = window.ZhikeAvatar;
vm.runInContext(source, context);
assert.equal(window.ZhikeAvatar, avatar);
assert.deepEqual([...callbacks.keys()], ['load', 'error']);

function verifyInitial(name, expected) {
  const markup = avatar.render({ name });
  assert.ok(markup.includes('data-zk-avatar-state="fallback"'));
  assert.ok(markup.includes('class="zk-avatar__fallback">' + expected + '</span>'), String(name));
  assert.doesNotMatch(markup, /<img\b/);
}

verifyInitial(' Nirbhay Singh ', 'N');
verifyInitial('sainath reddy', 'S');
verifyInitial('किरण', 'कि');
verifyInitial('क्षमा', 'क्ष');
verifyInitial('ராஜ்', 'ரா');
verifyInitial('محمد', 'م');
verifyInitial('🇮🇳 ྿தமிழ்', 'த');
verifyInitial('+919800000000', '9');
verifyInitial(9200000000, '9');
verifyInitial('३१२', '३');
verifyInitial('A\u0301riel', 'A\u0301');

for (const name of ['', ' ', '🧩', '—', undefined, {}, NaN]) {
  assert.match(avatar.render({ name }), /<use href="#i-user"\/>/, String(name));
}

const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aY1sAAAAASUVORK5CYII=';
const pngBytes = Buffer.from(png.split(',')[1], 'base64');
const pngChunk = Buffer.from('000000086163544c000000020000000000000000', 'hex');
const pngAnimated = 'data:image/png;base64,' + Buffer.concat([pngBytes.subarray(0, 33), pngChunk, pngBytes.subarray(33)]).toString('base64');
const webp = 'data:image/webp;base64,UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA';
const webpAnimated = Buffer.alloc(30);
webpAnimated.write('RIFF', 0);
webpAnimated.writeUInt32LE(22, 4);
webpAnimated.write('WEBPVP8X', 8);
webpAnimated.writeUInt32LE(10, 16);
webpAnimated[20] = 2;

for (const image of [
  'https://example.com/photo.jpg', '//example.com/photo.jpg', '/assets/photo.png',
  'file:///local.png', 'blob:local', 'javascript:void(0)',
  'data:image/svg+xml;base64,PHN2Zy8+', 'data:image/gif;base64,R0lGODlh',
  'data:image/png;base64,PHN2Zy8+', 'data:image/png;base64,AAAA_A==',
  'data:image/png;base64,' + 'A'.repeat(384 * 1024),
  png + '\n', png + '" onload="alert(1)', png.replace('image/png', 'image/jpeg'),
  pngAnimated, 'data:image/webp;base64,' + webpAnimated.toString('base64'),
]) {
  const markup = avatar.render({ name: '<script>alert(1)</script>', image, size: 'hero" onclick="evil' });
  assert.match(markup, /zk-avatar--table/);
  assert.match(markup, /data-zk-avatar-state="fallback"/);
  assert.doesNotMatch(markup, /<img|<script|onclick|onload/);
}

const rendered = avatar.render({ name: 'Sharan', size: 'hero', image: png, vip: true, selected: true });
assert.match(rendered, /zk-avatar--hero zk-avatar--vip zk-avatar--selected/);
assert.match(rendered, /aria-hidden="true" data-zk-avatar-state="loading"/);
assert.match(rendered, /<img class="zk-avatar__image"[^>]*alt="" loading="lazy" decoding="async" draggable="false"/);
assert.ok(rendered.includes(png));
assert.match(avatar.render({ image: webp }), /data-zk-avatar-state="loading"/);

function imageNode({ avatarClass = 'zk-avatar', imageClass = 'zk-avatar__image', width = 1, state = 'loading' } = {}) {
  const parentElement = { classList: new Set([avatarClass]), dataset: { zkAvatarState: state } };
  parentElement.classList.contains = name => parentElement.classList.has(name);
  return {
    tagName: 'IMG',
    classList: { contains: name => name === imageClass },
    parentElement,
    naturalWidth: width,
    remove() { this.removed = true; this.parentElement = null; },
  };
}

const load = target => callbacks.get('load')({ type: 'load', target });
const error = target => callbacks.get('error')({ type: 'error', target });
const loaded = imageNode();
load(loaded);
assert.equal(loaded.parentElement.dataset.zkAvatarState, 'ready');
error(loaded);
assert.equal(loaded.parentElement.dataset.zkAvatarState, 'ready', 'settled node ignores a stale event');
assert.equal(loaded.removed, undefined);
for (const [image, dispatch] of [[imageNode(), error], [imageNode({ width: 0 }), load]]) {
  const { parentElement } = image;
  dispatch(image);
  assert.equal(parentElement.dataset.zkAvatarState, 'error');
  assert.equal(image.removed, true);
  dispatch(image);
}
for (const outside of [imageNode({ imageClass: 'profile-image' }), imageNode({ avatarClass: 'ws-unrelated' })]) {
  error(outside);
  assert.equal(outside.parentElement.dataset.zkAvatarState, 'loading');
  assert.equal(outside.removed, undefined);
}

const legacy = { atob };
vm.runInNewContext(source, { window: legacy, document: { addEventListener() {} }, Intl: {} });
assert.match(legacy.ZhikeAvatar.render({ name: 'Nirbhay' }), />N<\/span>/);
assert.match(legacy.ZhikeAvatar.render({ name: 'क्षमा' }), /href="#i-user"/);

assert.ok(html.indexOf('src="./modules/customer-avatar.js"') < html.indexOf('src="./app.js"'));
assert.match(html, /<symbol id="i-user" viewBox="0 0 24 24">/);
const symbols = new Set([...html.matchAll(/<symbol id="(i-[\w-]+)"/g)].map(match => match[1]));
for (const [, id] of html.matchAll(/<use href="#(i-[\w-]+)"/g)) assert.ok(symbols.has(id), id);
for (const [, svg] of html.matchAll(/(<svg class="zk-icon"[^>]+>)/g)) {
  assert.match(svg, /viewBox="0 0 24 24"/);
  assert.match(svg, /aria-hidden="true" focusable="false"/);
}
assert.match(css, /stroke:currentColor/);
assert.match(css, /--ds-avatar-xs:20px;--ds-avatar-table:32px;--ds-avatar-list:36px;--ds-avatar-detail:48px;--ds-avatar-hero:76px/);
assert.match(css, /@media \(forced-colors:active\)/);
console.log('Shared avatar runtime: graphemes, local still rasters, scoped fallback, and sprite wiring');
