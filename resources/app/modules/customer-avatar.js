(() => {
  'use strict';

  if (window.ZhikeAvatar) return;

  const sizes = new Set(['xs', 'table', 'list', 'detail', 'hero']);
  const segmenter = typeof Intl.Segmenter === 'function'
    ? new Intl.Segmenter(undefined, { granularity: 'grapheme' })
    : null;
  const initialsPattern = /^[\p{L}\p{N}]/u;
  const person = '<svg class="zk-icon zk-avatar__glyph" viewBox="0 0 24 24" focusable="false"><use href="#i-user"/></svg>';
  const maxImageLength = 384 * 1024;

  function initialOf(name) {
    if (typeof name !== 'string' && !Number.isFinite(name)) return '';
    const value = String(name).trim();
    if (!segmenter) return /^[a-z0-9](?=\s|$|[a-z0-9])/i.exec(value)?.[0].toUpperCase() || '';
    for (const { segment } of segmenter.segment(value)) {
      if (initialsPattern.test(segment)) return /^[a-z]$/.test(segment) ? segment.toUpperCase() : segment;
    }
    return '';
  }

  function uint32(bytes, offset, littleEndian) {
    let value = 0;
    for (let index = 0; index < 4; index++) {
      value = value * 256 + bytes.charCodeAt(offset + (littleEndian ? 3 - index : index));
    }
    return value;
  }

  function isStillPng(bytes) {
    if (!bytes.startsWith('\x89PNG\r\n\x1a\n\x00\x00\x00\x0dIHDR')) return false;
    for (let offset = 8; offset + 12 <= bytes.length;) {
      const type = bytes.slice(offset + 4, offset + 8);
      const size = uint32(bytes, offset, false);
      if (type === 'acTL' || offset + 12 + size > bytes.length) return false;
      if (type === 'IEND') return size === 0 && offset + 12 === bytes.length;
      offset += 12 + size;
    }
    return false;
  }

  function isStillWebp(bytes) {
    if (!bytes.startsWith('RIFF') || bytes.slice(8, 12) !== 'WEBP' || uint32(bytes, 4, true) !== bytes.length - 8) return false;
    let offset = 12;
    while (offset + 8 <= bytes.length) {
      const type = bytes.slice(offset, offset + 4);
      const size = uint32(bytes, offset + 4, true);
      const next = offset + 8 + size + (size % 2);
      if (next > bytes.length || type === 'ANIM' || type === 'ANMF') return false;
      if (type === 'VP8X' && (bytes.charCodeAt(offset + 8) & 0x02)) return false;
      offset = next;
    }
    return offset === bytes.length && offset > 12;
  }

  function safeImage(value) {
    if (typeof value !== 'string' || value.length > maxImageLength) return '';
    const match = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/u.exec(value);
    if (!match || match[0] !== value || match[2].length % 4 !== 0) return '';
    let bytes;
    try {
      bytes = window.atob(match[2]);
    } catch {
      return '';
    }
    const [, format] = match;
    const valid = format === 'png' ? isStillPng(bytes)
      : format === 'webp' ? isStillWebp(bytes)
        : bytes.startsWith('\xff\xd8\xff') && bytes.endsWith('\xff\xd9');
    return valid ? value : '';
  }

  function render({ name, size = 'table', image, vip = false, selected = false } = {}) {
    const initial = initialOf(name);
    const source = safeImage(image);
    const classes = ['zk-avatar', 'zk-avatar--' + (sizes.has(size) ? size : 'table')];
    if (vip === true) classes.push('zk-avatar--vip');
    if (selected === true) classes.push('zk-avatar--selected');
    const fallback = initial ? initial.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;') : person;
    const picture = source
      ? `<img class="zk-avatar__image" src="${source}" alt="" loading="lazy" decoding="async" draggable="false">`
      : '';
    return `<span class="${classes.join(' ')}" aria-hidden="true" data-zk-avatar-state="${source ? 'loading' : 'fallback'}"><span class="zk-avatar__fallback">${fallback}</span>${picture}</span>`;
  }

  function onImageResult(event) {
    const image = event.target;
    if (image?.tagName !== 'IMG' || !image.classList.contains('zk-avatar__image')) return;
    const avatar = image.parentElement;
    if (!avatar?.classList.contains('zk-avatar') || avatar.dataset.zkAvatarState !== 'loading') return;
    if (event.type === 'load' && image.naturalWidth > 0) {
      avatar.dataset.zkAvatarState = 'ready';
    } else {
      avatar.dataset.zkAvatarState = 'error';
      image.remove();
    }
  }

  document.addEventListener('load', onImageResult, true);
  document.addEventListener('error', onImageResult, true);
  window.ZhikeAvatar = Object.freeze({ render });
})();
