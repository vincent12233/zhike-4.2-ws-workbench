(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ZhikeWsScope = Object.freeze(api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const text = value => String(value == null ? '' : value).normalize('NFKC').trim();
  const normalize = value => text(value).replace(/[\u200e\u200f\u202a-\u202e]/g, '').replace(/\s+/g, ' ').toLocaleLowerCase();
  const customerVipNumber = customer => text(customer?.vipNumber || customer?.vipId || customer?.vipCode).slice(0, 64);

  /**
   * VIP 管理的唯一输入是客户主档 VIP 编号。
   * 群组关系、WS 群组绑定和群聊消息永远不会参与这个计数。
   */
  function countVipCustomers(customers = []) {
    return (Array.isArray(customers) ? customers : [])
      .filter(item => item && item.deleted !== true && Boolean(customerVipNumber(item))).length;
  }

  function groupBindingValues(source, accountId) {
    const values = [];
    for (const item of Array.isArray(source) ? source : []) {
      if (typeof item === 'string') {
        if (text(item)) values.push({ groupJid: text(item), groupName: '', accountId: '' });
        continue;
      }
      if (!item || typeof item !== 'object' || Array.isArray(item) || item.enabled === false) continue;
      const scopedAccount = text(item.accountId || item.wsAccountId);
      if (scopedAccount && scopedAccount !== String(accountId || 'default')) continue;
      const groupJid = text(item.groupJid || item.jid || item.conversationKey || item.externalId || item.groupId);
      const groupName = text(item.groupName || item.title || item.name);
      if (groupJid || groupName) values.push({ groupJid, groupName, accountId: scopedAccount });
    }
    return values;
  }

  /**
   * Canonical WS group-monitor bindings. `wsGroupAllowlist` is the new key;
   * the old `wsVip*` keys are read only for upgrade compatibility. This
   * function intentionally does not inspect customer VIP fields.
   */
  function normalizeWsGroupBindings(settings = {}, accountId = 'default') {
    const value = settings && typeof settings === 'object' && !Array.isArray(settings) ? settings : {};
    const sources = [
      value.wsGroupAllowlist,
      value.wsVipGroupAllowlist,
      value.wsVipGroups,
      value.vipGroupBindings,
    ];
    const result = [];
    const seen = new Set();
    for (const source of sources) {
      for (const item of groupBindingValues(source, accountId)) {
        const key = normalize(item.groupJid || item.groupName);
        if (!key || seen.has(key)) continue;
        seen.add(key);
        result.push({ ...item, groupJid: item.groupJid.slice(0, 240), groupName: item.groupName.slice(0, 200), enabled: true });
        if (result.length >= 500) return result;
      }
    }
    return result;
  }

  return { customerVipNumber, countVipCustomers, normalizeWsGroupBindings };
});
