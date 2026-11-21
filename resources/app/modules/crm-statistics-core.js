(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ZhikeCrmStatistics = Object.freeze(api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  // V5.0 §20 channel / assistant / group statistics.
  //
  // Explicit dedupe rules:
  // - Every CRM count is 唯一客户数量: distinct customer ids, never rows.
  // - A customer in several groups is counted once per CRM metric, but the
  //   group panel counts members per group (overlap is expected and stated).
  // - Unknown in-group evidence is 待确认, never 已退群.
  // - Only non-deleted customers are counted.
  const text = value => String(value == null ? '' : value).normalize('NFKC').trim();
  const list = value => Array.isArray(value) ? value : [];
  const GENERIC_CHANNEL = /^(?:whatsapp|ws|未分配|未分类|未配置|暂无|unknown|none)$/i;
  const IN_GROUP = new Set(['在群', '已进群']);
  const LEFT_GROUP = new Set(['已退群', '被移除']);
  const UNKNOWN_GROUP = new Set(['待确认', '状态未知', '未进群', '']);
  const activeCustomers = customers => list(customers).filter(customer => customer && typeof customer === 'object' && customer.deleted !== true);
  const customerKey = customer => text(customer?.id) || text(customer?.phone) || `anon:${text(customer?.name)}`;

  /** The channel a customer is attributed to, in V5.0 §12 priority order. */
  function customerChannel(customer) {
    const first = text(customer?.firstSourceChannel);
    if (first && !GENERIC_CHANNEL.test(first)) return { channel: first, origin: 'first' };
    const current = list(customer?.currentChannels).map(text).find(value => value && !GENERIC_CHANNEL.test(value));
    if (current) return { channel: current, origin: 'current' };
    for (const value of [customer?.channel, customer?.source]) {
      const channel = text(value);
      if (channel && !GENERIC_CHANNEL.test(channel)) return { channel, origin: 'legacy' };
    }
    return { channel: '', origin: '' };
  }

  function customerAssistant(customer) {
    const assistant = text(customer?.assistant);
    return !assistant || assistant === '未分配' ? '' : assistant;
  }

  /** Overall in-group state: reliable evidence only. */
  function customerGroupState(customer) {
    const relations = list(customer?.groupMemberships).filter(relation => relation && typeof relation === 'object');
    if (relations.some(relation => IN_GROUP.has(text(relation.status)))) return 'in-group';
    const overall = text(customer?.groupStatus || customer?.status);
    if (IN_GROUP.has(overall)) return 'in-group';
    if (relations.length && relations.every(relation => LEFT_GROUP.has(text(relation.status)))) return 'left';
    if (LEFT_GROUP.has(overall) && !relations.some(relation => UNKNOWN_GROUP.has(text(relation.status)))) return 'left';
    return 'pending';
  }

  function isAnalysed(customer) {
    return Boolean(text(customer?.wsAnalysisId) || text(customer?.aiProfile?.lastAnalysisId) || customer?.aiSyncedAt);
  }
  function needsProfile(customer) {
    if (Array.isArray(customer?.profileMissingFields)) return customer.profileMissingFields.length > 0;
    if (Number.isFinite(Number(customer?.profileCompleteness))) return Number(customer.profileCompleteness) < 100;
    return true;
  }
  function isDue(customer, today) {
    const due = text(customer?.due);
    return /^\d{4}-\d{2}-\d{2}$/.test(due) && due <= today;
  }
  function isNew(customer, sinceDay) {
    const raw = text(customer?.createdAt || customer?.registeredAt || customer?.registered);
    const day = raw.slice(0, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(day) && day >= sinceDay;
  }

  function computeStatistics(customers, options = {}) {
    const rows = activeCustomers(customers);
    const today = /^\d{4}-\d{2}-\d{2}$/.test(text(options.today)) ? text(options.today) : new Date().toISOString().slice(0, 10);
    const sinceDay = /^\d{4}-\d{2}-\d{2}$/.test(text(options.since))
      ? text(options.since)
      : new Date(Date.now() - 29 * 86400000).toISOString().slice(0, 10);
    const seen = new Set();
    const unique = [];
    for (const customer of rows) {
      const key = customerKey(customer);
      if (seen.has(key)) continue;
      seen.add(key);
      unique.push(customer);
    }
    const byChannel = new Map(), byAssistant = new Map();
    let unassigned = 0, inGroup = 0, left = 0, pending = 0, analysed = 0, incomplete = 0, due = 0, fresh = 0;
    for (const customer of unique) {
      const { channel } = customerChannel(customer);
      if (channel) byChannel.set(channel, (byChannel.get(channel) || 0) + 1);
      const assistant = customerAssistant(customer);
      if (assistant) byAssistant.set(assistant, (byAssistant.get(assistant) || 0) + 1);
      else unassigned += 1;
      const state = customerGroupState(customer);
      if (state === 'in-group') inGroup += 1;
      else if (state === 'left') left += 1;
      else pending += 1;
      if (isAnalysed(customer)) analysed += 1;
      if (needsProfile(customer)) incomplete += 1;
      if (isDue(customer, today)) due += 1;
      if (isNew(customer, sinceDay)) fresh += 1;
    }
    // Group membership is counted per group; one customer may appear in several
    // groups by design, so these numbers do not sum to the unique customer total.
    const groups = new Map();
    for (const customer of unique) {
      for (const relation of list(customer.groupMemberships)) {
        if (!relation || typeof relation !== 'object') continue;
        const jid = text(relation.groupJid);
        if (!jid) continue;
        if (!groups.has(jid)) groups.set(jid, { groupJid: jid, groupName: text(relation.groupName), members: new Set() });
        groups.get(jid).members.add(customerKey(customer));
      }
    }
    const sortDesc = (a, b) => b.value - a.value || a.label.localeCompare(b.label, 'zh-CN');
    const channels = [...byChannel].map(([label, value]) => ({ label, value })).sort(sortDesc);
    const assistants = [...byAssistant].map(([label, value]) => ({ label, value })).sort(sortDesc);
    const groupRows = [...groups.values()]
      .map(group => ({ groupJid: group.groupJid, groupName: group.groupName || group.groupJid, members: group.members.size }))
      .sort((a, b) => b.members - a.members || a.groupName.localeCompare(b.groupName, 'zh-CN'));
    return {
      asOf: today,
      since: sinceDay,
      uniqueCustomers: unique.length,
      channels,
      channelTotal: channels.reduce((sum, item) => sum + item.value, 0),
      unclassifiedChannel: unique.length - channels.reduce((sum, item) => sum + item.value, 0),
      assistants,
      unassigned,
      groups: groupRows,
      inGroup,
      left,
      pending,
      analysed,
      incomplete,
      due,
      newCustomers: fresh,
      notes: {
        crm: '所有 CRM 数字按客户唯一编号去重，同一客户只计一次。',
        groups: '群组成员按群分别统计，同一客户可以在多个群组中分别计入。',
        pending: '待确认包含证据不足和状态未知，绝不当作已退群。',
        period: `新发现客户统计区间：${sinceDay} 至 ${today}。`,
      },
    };
  }

  return { computeStatistics, customerChannel, customerGroupState, customerAssistant };
});
