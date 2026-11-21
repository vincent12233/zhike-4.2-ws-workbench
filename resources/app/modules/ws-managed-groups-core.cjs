(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ZhikeManagedGroups = Object.freeze(api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  // V9.1 dedicated-WS group registry. A local group is identified by an
  // operator-maintained alias, never by a guessed WhatsApp JID. The channel is
  // chosen by the operator; no prefix inference and no assistant field.
  const text = value => String(value == null ? '' : value).trim();
  const key = value => text(value).toLowerCase();
  const MAX_ALIAS = 64;
  const MAX_NAME = 200;
  const MAX_CHANNEL = 40;

  function normalizeAlias(alias) {
    const value = text(alias).replace(/\s+/g, ' ');
    if (!value) return '';
    return value.slice(0, MAX_ALIAS);
  }

  function validateGroup(input = {}, options = {}) {
    const group = input && typeof input === 'object' ? input : {};
    const channels = Array.isArray(options.channels) ? options.channels.map(text).filter(Boolean) : [];
    const errors = [];
    const channel = text(group.channel).slice(0, MAX_CHANNEL);
    const groupName = text(group.groupName || group.name).replace(/\s+/g, ' ').slice(0, MAX_NAME);
    const groupAlias = normalizeAlias(group.groupAlias || group.alias);
    if (!channel) errors.push({ field: 'channel', code: 'CHANNEL_REQUIRED', message: '请选择渠道。' });
    else if (channels.length && !channels.includes(channel) && !options.allowCustomChannel) errors.push({ field: 'channel', code: 'CHANNEL_UNKNOWN', message: '渠道不在可选列表中。' });
    if (!groupName) errors.push({ field: 'groupName', code: 'NAME_REQUIRED', message: '请填写 WhatsApp 中显示的群名。' });
    if (!groupAlias) errors.push({ field: 'groupAlias', code: 'ALIAS_REQUIRED', message: '请填写群别名。' });
    return { ok: errors.length === 0, errors, value: { channel, groupName, groupAlias, aliasKey: key(groupAlias) } };
  }

  function findAliasConflict(groups = [], aliasKey, ignoreId = '') {
    const target = key(aliasKey);
    if (!target) return null;
    return (Array.isArray(groups) ? groups : []).find(item => item && key(item.groupAlias) === target && String(item.id || '') !== String(ignoreId || '')) || null;
  }

  // Duplicate names are legal: only the alias is unique inside one workspace.
  function detectDuplicateNames(groups = [], groupName) {
    const target = key(groupName);
    return (Array.isArray(groups) ? groups : []).filter(item => item && key(item.groupName) === target && item.enabled !== false).length;
  }

  function importRows(rows = [], existing = [], options = {}) {
    const channels = Array.isArray(options.channels) ? options.channels.map(text).filter(Boolean) : [];
    const seen = new Set();
    const accepted = [];
    const rejected = [];
    const list = Array.isArray(existing) ? existing.slice() : [];
    (Array.isArray(rows) ? rows : []).forEach((row, index) => {
      const check = validateGroup(row, { channels, allowCustomChannel: options.allowCustomChannel });
      if (!check.ok) { rejected.push({ row: index + 1, errors: check.errors, input: row }); return; }
      const { groupAlias, aliasKey } = check.value;
      if (seen.has(aliasKey)) { rejected.push({ row: index + 1, errors: [{ field: 'groupAlias', code: 'DUPLICATE_IN_FILE', message: `文件内群别名重复：${groupAlias}` }] }); return; }
      seen.add(aliasKey);
      const conflict = findAliasConflict(list, aliasKey);
      if (conflict) {
        const unchanged = text(conflict.channel) === check.value.channel && text(conflict.groupName) === check.value.groupName;
        if (unchanged) { rejected.push({ row: index + 1, skipped: true, errors: [{ field: 'groupAlias', code: 'ALREADY_EXISTS', message: `群别名 ${groupAlias} 已存在且内容相同，本次跳过。` }], existing: conflict }); return; }
        rejected.push({ row: index + 1, errors: [{ field: 'groupAlias', code: 'CONFLICT', message: `群别名 ${groupAlias} 已存在，需人工确认后更新。` }], existing: conflict });
        return;
      }
      const entry = { ...check.value };
      list.push(entry);
      accepted.push(entry);
    });
    return { accepted, rejected, total: accepted.length + rejected.length };
  }

  // A customer may name the alias it belongs to. Resolution never guesses from
  // a name fragment and never invents a WhatsApp identity.
  function resolveAlias(groups = [], alias) {
    const target = key(alias);
    if (!target) return { status: 'none', group: null };
    const matches = (Array.isArray(groups) ? groups : []).filter(item => item && item.enabled !== false && key(item.groupAlias) === target);
    if (matches.length === 1) return { status: 'matched', group: matches[0] };
    if (matches.length > 1) return { status: 'ambiguous', matches };
    return { status: 'missing', group: null };
  }

  // Matching to a real chat: name candidates are suggestions only; a binding
  // requires an explicit operator confirmation and a real id supplied by the
  // authenticated session.
  function suggestMatches(groups = [], candidates = []) {
    const list = Array.isArray(candidates) ? candidates : [];
    return (Array.isArray(groups) ? groups : []).map(group => {
      if (group.jid) return { groupId: group.id, status: 'bound', jid: group.jid, candidates: [] };
      const named = list.filter(item => item && key(item.groupName) === key(group.groupName));
      return { groupId: group.id, status: named.length === 0 ? 'unmatched' : named.length === 1 ? 'suggested' : 'ambiguous', jid: null, candidates: named.map(item => item.jid || null).filter(Boolean) };
    });
  }

  function canConfirmMatch(candidate) { return Boolean(candidate && /@g\.us$/i.test(text(candidate.jid))); }

  return { normalizeAlias, validateGroup, findAliasConflict, detectDuplicateNames, importRows, resolveAlias, suggestMatches, canConfirmMatch };
});
