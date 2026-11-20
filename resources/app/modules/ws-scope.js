(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ZhikeWsScope = Object.freeze(api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const text = value => String(value == null ? '' : value).normalize('NFKC').trim();
  const customerVipNumber = customer => text(customer?.vipNumber || customer?.vipId || customer?.vipCode).slice(0, 64);

  /**
   * VIP 管理的唯一输入是客户主档 VIP 编号。
   * 群组关系、WS 群组绑定和群聊消息永远不会参与这个计数。
   */
  function countVipCustomers(customers = []) {
    return (Array.isArray(customers) ? customers : [])
      .filter(item => item && item.deleted !== true && Boolean(customerVipNumber(item))).length;
  }

  // Display normalization must never create identity evidence. In particular,
  // do not NFKC-normalize, strip format characters or match names for grants.
  const validAccount = value => typeof value === 'string' && value.length > 0 && value.length <= 120
    && value === value.trim() && !/[\p{Cc}\p{Cf}]/u.test(value);
  const validGroupJid = value => typeof value === 'string' && /^[a-z0-9._-]{1,235}@g\.us$/.test(value);

  function bindingIdentity(item, names) {
    const provided = names.filter(name => Object.hasOwn(item, name));
    const values = provided.map(name => item[name]);
    return { value: values[0] ?? '', ambiguous: values.some(value => value !== values[0]) };
  }

  function bindingAuthorization(account, group, requestedAccount) {
    if (!validAccount(requestedAccount)) return 'ACCOUNT_SCOPE_INVALID';
    if (account.ambiguous) return 'ACCOUNT_ID_AMBIGUOUS';
    if (!account.value) return 'ACCOUNT_ID_REQUIRED';
    if (!validAccount(account.value)) return 'ACCOUNT_ID_INVALID';
    if (account.value !== requestedAccount) return 'ACCOUNT_SCOPE_MISMATCH';
    if (group.ambiguous) return 'GROUP_JID_AMBIGUOUS';
    if (!group.value) return 'GROUP_JID_REQUIRED';
    if (!validGroupJid(group.value)) return 'GROUP_JID_INVALID';
    return '';
  }

  function groupBindingValues(source, accountId) {
    const values = [];
    for (const item of Array.isArray(source) ? source : []) {
      if (typeof item === 'string') {
        // Legacy unscoped strings are retained for upgrade display only.
        if (text(item)) values.push({ groupJid: text(item), groupName: '', accountId: '', authorized: false, authorizationReason: 'ACCOUNT_ID_REQUIRED' });
        continue;
      }
      if (!item || typeof item !== 'object' || Array.isArray(item) || item.enabled === false) continue;
      const account = bindingIdentity(item, ['accountId', 'wsAccountId']);
      const group = bindingIdentity(item, ['groupJid', 'jid', 'conversationKey', 'externalId', 'groupId']);
      const scopedAccount = text(account.value);
      if (scopedAccount && scopedAccount !== String(accountId || 'default')) continue;
      const groupJid = text(group.value);
      const groupName = text(item.groupName || item.title || item.name);
      const authorizationReason = Object.hasOwn(item, 'enabled') && typeof item.enabled !== 'boolean'
        ? 'BINDING_ENABLED_INVALID' : bindingAuthorization(account, group, accountId);
      if (groupJid || groupName) values.push({ groupJid, groupName, accountId: scopedAccount, authorized: !authorizationReason, authorizationReason });
    }
    return values;
  }

  /**
   * Canonical WS group-monitor bindings. `wsGroupAllowlist` is the new key;
   * the old `wsVip*` keys are read only when the canonical key is absent.
   * An empty or invalid canonical value revokes legacy grants. Unscoped or
   * name-only entries remain visible with authorized:false; callers must use
   * isWsGroupAuthorized (or filter authorized entries) for actual operations.
   * This function intentionally does not inspect customer VIP fields.
   */
  function normalizeWsGroupBindings(settings = {}, accountId = 'default') {
    const value = settings && typeof settings === 'object' && !Array.isArray(settings) ? settings : {};
    const sources = Object.hasOwn(value, 'wsGroupAllowlist')
      ? ['wsGroupAllowlist']
      : ['wsVipGroupAllowlist', 'wsVipGroups', 'vipGroupBindings'];
    const result = [];
    const seen = new Set();
    for (const source of sources) {
      for (const item of groupBindingValues(value[source], accountId)) {
        // An unscoped/invalid legacy display row must not shadow a scoped grant.
        const key = JSON.stringify([item.accountId, item.groupJid, item.groupName, item.authorizationReason]);
        if (seen.has(key)) continue;
        seen.add(key);
        result.push({ ...item, groupJid: item.groupJid.slice(0, 240), groupName: item.groupName.slice(0, 200), enabled: true, source });
        if (result.length >= 500) return result;
      }
    }
    return result;
  }

  function isWsGroupAuthorized(settings, accountId, groupJid) {
    if (!validAccount(accountId) || !validGroupJid(groupJid)) return false;
    return normalizeWsGroupBindings(settings, accountId).some(item => item.authorized
      && item.accountId === accountId && item.groupJid === groupJid);
  }

  return { customerVipNumber, countVipCustomers, normalizeWsGroupBindings, isWsGroupAuthorized };
});
