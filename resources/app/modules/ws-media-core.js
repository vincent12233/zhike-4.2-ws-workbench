(function attach(root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ZhikeWsMediaCore = factory();
}(globalThis, function createWsMediaCore() {
  'use strict';

  // Local staging policy, not proof of platform acceptance or antivirus scan.
  // Executable extensions/signatures are refused even with an allowed MIME.
  const MIME_RULES = [
    /^image\/(?:jpeg|png|gif|webp|bmp|heic|heif|tiff|svg\+xml)$/i,
    /^video\/(?:mp4|webm|quicktime|3gpp|x-msvideo|mpeg)$/i,
    /^audio\/(?:mpeg|mp4|ogg|webm|wav|x-wav|aac|flac|amr)$/i,
    /^text\/(?:plain|csv|markdown|html|xml)$/i,
    /^application\/(?:pdf|rtf|json|zip|gzip|x-7z-compressed|vnd\.rar|octet-stream)$/i,
    /^application\/msword$/i,
    /^application\/vnd\.ms-(?:excel|powerpoint|word)$/i,
    /^application\/vnd\.openxmlformats-officedocument\.(?:wordprocessingml\.document|spreadsheetml\.sheet|presentationml\.presentation)$/i,
  ];
  const MAX_BYTES = 24 * 1024 * 1024;
  const MAX_TOTAL_BYTES = 72 * 1024 * 1024;
  const MAX_ATTACHMENTS = 10;
  const MAX_FILE_NAME = 255;

  function normalizeMime(value) {
    return String(value || '').trim().toLowerCase().split(';', 1)[0].trim();
  }

  function isAllowedMime(value) {
    const mime = normalizeMime(value);
    return Boolean(mime) && MIME_RULES.some(rule => rule.test(mime));
  }

  function validateContent(fileName, bytes) {
    if (/\.(?:exe|dll|com|scr|msi|msp|bat|cmd|ps1|psm1|vbs|vbe|js|jse|wsf|wsh|hta|lnk|url|reg|cpl|jar|sh)$/i.test(String(fileName || '').trim())) return { allowed: false, reason: '不允许上传可执行文件或脚本附件。' };
    const head = Array.from((bytes || []).subarray(0, 4));
    const hex = head.map(value => value.toString(16).padStart(2, '0')).join('');
    if (hex.startsWith('4d5a') || hex === '7f454c46' || ['feedface', 'feedfacf', 'cefaedfe', 'cffaedfe', 'cafebabe'].includes(hex) || hex.startsWith('2321')) return { allowed: false, reason: '附件包含可执行格式标识，未保存。' };
    return { allowed: true, validation: 'executable-screen-only' };
  }

  function mediaTypeForMime(value) {
    const mime = normalizeMime(value);
    if (mime.startsWith('image/')) return 'image';
    if (mime.startsWith('video/')) return 'video';
    if (mime.startsWith('audio/')) return 'audio';
    return 'document';
  }

  function payloadKindForMime(value) {
    return mediaTypeForMime(value);
  }

  function sanitizeFileName(value, fallback = 'attachment') {
    let name = String(value || '').replace(/[\\/\u0000-\u001f\u007f]/g, '').trim();
    name = name.replace(/\.\.+/g, '.').slice(0, MAX_FILE_NAME);
    return name || fallback;
  }

  function normalizeBase64(value) {
    let raw = String(value || '').trim();
    const comma = raw.indexOf(',');
    if (/^data:[^;]+;base64,/i.test(raw) && comma >= 0) raw = raw.slice(comma + 1);
    raw = raw.replace(/\s+/g, '');
    if (!raw || raw.length % 4 === 1 || !/^[A-Za-z0-9+/]*={0,2}$/.test(raw)) throw new Error('附件 base64 编码无效。');
    return raw;
  }

  function decodeBase64(value, maxBytes = MAX_BYTES) {
    const normalized = normalizeBase64(value);
    const bytes = Buffer.from(normalized, 'base64');
    if (!bytes.length) throw new Error('附件内容不能为空。');
    if (bytes.length > maxBytes) throw new Error(`附件超过 ${Math.floor(maxBytes / 1024 / 1024)} MB 限制。`);
    // Buffer.from silently ignores malformed trailing data; compare the
    // canonical representation to prevent accepting a truncated upload.
    const canonical = bytes.toString('base64').replace(/=+$/, '');
    const supplied = normalized.replace(/=+$/, '');
    if (canonical !== supplied) throw new Error('附件 base64 内容校验失败。');
    return bytes;
  }

  function normalizePayloadKind(value, attachmentKinds = []) {
    const requested = String(value || '').trim().toLowerCase();
    if (['text', 'image', 'video', 'audio', 'document', 'media'].includes(requested)) return requested;
    const kinds = Array.isArray(attachmentKinds) ? attachmentKinds.filter(Boolean) : [];
    return kinds.length === 1 ? kinds[0] : (kinds.length ? 'media' : 'text');
  }

  function normalizeAttachmentRef(value) {
    if (typeof value === 'string') return { mediaId: value.trim() };
    if (!value || typeof value !== 'object' || Array.isArray(value)) return { mediaId: '' };
    return {
      mediaId: String(value.mediaId || value.id || '').trim(),
      caption: String(value.caption || '').slice(0, 12000),
      orderNo: Number.isFinite(Number(value.orderNo)) ? Math.max(0, Math.floor(Number(value.orderNo))) : null,
    };
  }

  function normalizeAttachmentRefs(value) {
    if (!Array.isArray(value)) return [];
    const result = [];
    const seen = new Set();
    for (const item of value) {
      const ref = normalizeAttachmentRef(item);
      if (!ref.mediaId || seen.has(ref.mediaId)) continue;
      seen.add(ref.mediaId);
      result.push(ref);
      if (result.length >= MAX_ATTACHMENTS) break;
    }
    return result;
  }

  return {
    MIME_RULES,
    MAX_BYTES,
    MAX_TOTAL_BYTES,
    MAX_ATTACHMENTS,
    MAX_FILE_NAME,
    normalizeMime,
    isAllowedMime,
    validateContent,
    mediaTypeForMime,
    payloadKindForMime,
    sanitizeFileName,
    normalizeBase64,
    decodeBase64,
    normalizePayloadKind,
    normalizeAttachmentRef,
    normalizeAttachmentRefs,
  };
}));
