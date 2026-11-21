(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ZhikeCustomerAttribution = Object.freeze(api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  // V5.0 §12 / §19 customer 360: where the customer came from, where they are
  // now, and what evidence says so.
  //
  // Rules:
  // - Only stored values are shown. A missing value is 未记录, never guessed.
  // - "WhatsApp" and similar generic labels are not a business channel; they
  //   are shown as 未确认 rather than presented as a real channel.
  // - Unknown in-group evidence is 待确认, never 已退群.
  const text = value => String(value == null ? '' : value).normalize('NFKC').trim();
  const list = value => Array.isArray(value) ? value.map(text).filter(Boolean) : text(value) ? [text(value)] : [];
  const GENERIC = /^(?:whatsapp|ws|未分配|未分类|未配置|暂无|unknown|none)$/i;
  const IN_GROUP = new Set(['在群', '已进群']);
  const LEFT = new Set(['已退群', '被移除']);
  const channelLabel = value => {
    const channel = text(value);
    if (!channel) return '';
    return GENERIC.test(channel) ? '' : channel;
  };
  const join = values => {
    const unique = [...new Set(values.map(channelLabel).filter(Boolean))];
    return unique.length ? unique.join('、') : '未记录';
  };

  function groupSummary(customer) {
    const relations = Array.isArray(customer?.groupMemberships) ? customer.groupMemberships.filter(item => item && typeof item === 'object') : [];
    let active = 0, left = 0, unknown = 0;
    for (const relation of relations) {
      const status = text(relation.status);
      if (IN_GROUP.has(status)) active += 1;
      else if (LEFT.has(status)) left += 1;
      else unknown += 1;
    }
    const names = relations.filter(relation => IN_GROUP.has(text(relation.status)))
      .map(relation => text(relation.groupName) || text(relation.groupJid)).filter(Boolean);
    return { relations: relations.length, active, left, unknown, names };
  }

  function overallGroupState(customer) {
    const summary = groupSummary(customer);
    if (summary.active > 0) return '在群';
    if (summary.relations && summary.left === summary.relations) return '已退群';
    const overall = text(customer?.groupStatus || customer?.status);
    if (IN_GROUP.has(overall) && !summary.unknown) return '在群';
    if (LEFT.has(overall) && !summary.unknown && !summary.active) return '已退群';
    return '待确认';
  }

  /** Label/value pairs for the 360 drawer. Missing data says 未记录. */
  function attributionFields(customer) {
    const c = customer && typeof customer === 'object' ? customer : {};
    const summary = groupSummary(c);
    const first = channelLabel(c.firstSourceChannel);
    const current = list(c.currentChannels);
    const history = list(c.channelHistory);
    const state = overallGroupState(c);
    const evidence = summary.relations
      ? `${summary.active} 个群组在群 · ${summary.left} 个已确认退群${summary.unknown ? ` · ${summary.unknown} 个待确认` : ''}`
      : (state === '待确认' ? '暂无群组关系记录，状态待确认' : `已记录：${state}`);
    return [
      ['首次来源渠道', first || '未记录'],
      ['首次来源群组', text(c.firstSourceGroupCode) || text(c.firstSourceGroupJid) || '未记录'],
      ['当前渠道', join(current)],
      ['历史渠道', join(history)],
      ['在群状态', state],
      ['群组证据', evidence],
      ['当前所在群组', summary.names.length ? summary.names.slice(0, 6).join('、') : '未记录'],
      ['来源账号', text(c.sourceAccountId) || '未记录'],
      ['负责助理', text(c.assistant) && !GENERIC.test(text(c.assistant)) ? text(c.assistant) : '未分配'],
    ];
  }

  return { attributionFields, overallGroupState, groupSummary };
});
