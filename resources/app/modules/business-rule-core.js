(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ZhikeBusinessRules = Object.freeze(api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const text = value => String(value == null ? '' : value).normalize('NFKC').trim();
  const sourceKey = value => text(value).toLocaleLowerCase().replace(/[\s_\-\/\\（）()【】\[\]：:，,。·]/g, '');
  const stableHash = value => {
    let hash = 2166136261;
    for (const char of String(value || '')) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
    return (hash >>> 0).toString(36);
  };
  const stableSourceId = value => {
    const key = sourceKey(value);
    if (key === '单导') return 'source-direct';
    if (key === '群粉') return 'source-group';
    return key ? `source-${stableHash(key)}` : '';
  };
  const statusEventKind = value => ['已进群', '在群'].includes(text(value)) ? 'joined' : ['已退群', '临时退群'].includes(text(value)) ? 'left' : '';

  const BUSINESS_RULES = Object.freeze({
    version: 1,
    customerMaster: Object.freeze({ identity: 'unique-phone-or-explicit-id', aiMayCreate: false, aiFillBlankOnly: true, aiMayOverwriteManual: false }),
    businessRecords: Object.freeze({ tickets: 'one-customer-many-records', deposits: 'one-customer-many-records', registrations: 'one-customer-many-records' }),
    import: Object.freeze({ localRulesFirst: true, aiAdvisoryOnly: true, aiFailureBlocksImport: false, rowLevelRouting: true, phoneRegistryUsesAi: false }),
    whatsapp: Object.freeze({ directOnly: true, vipGroupMemberException: true, skipUnread: true, collectBothDirections: true, backgroundAfterOpen: true, customerMustAlreadyExist: true }),
    reminders: Object.freeze({ evidenceRequired: true, oneActivePerCustomer: true, investmentYearsWeight: 0, sources: Object.freeze(['task-center', 'today-workbench']) }),
  });

  const DATA_DICTIONARY = Object.freeze({
    customer: Object.freeze({ primaryKey: 'id', identityFields: Object.freeze(['id', 'phone', 'wsExternalIds', 'wsConversationIds']), manualAuthorityFields: Object.freeze(['name', 'phone', 'source', 'channel', 'assistant', 'status', 'phase', 'qualification']), aiFillFields: Object.freeze(['country', 'language', 'origin', 'age', 'occupation', 'productInterest', 'budget']) }),
    channel: Object.freeze({ primaryKey: 'sourceId', displayField: 'name', aliasesField: 'aliases', deletePolicy: 'disable-and-remap' }),
    groupMembershipEvent: Object.freeze({ primaryKey: 'id', required: Object.freeze(['customerId', 'sourceId', 'type', 'date']), types: Object.freeze(['joined', 'left']) }),
    followupTask: Object.freeze({ identity: 'one-active-ai-task-per-customer', evidenceFields: Object.freeze(['qualificationReason', 'engagementReason', 'reason', 'objective', 'nextDate']) }),
  });

  function sourceType(name, groupFanSources = []) {
    const target = sourceKey(name);
    return groupFanSources.some(value => sourceKey(value) === target) || /群粉|群导|社群|groupfan|grouplead/.test(target) ? 'group-fan' : 'direct';
  }

  function reconcileSourceDefinitions(existing, sources = [], groupFanSources = [], aliases = {}) {
    const prior = Array.isArray(existing) ? existing.filter(item => item && typeof item === 'object') : [];
    const definitions = prior.map(item => ({
      id: text(item.id) || stableSourceId(item.name),
      name: text(item.name),
      type: text(item.type) || sourceType(item.name, groupFanSources),
      aliases: [...new Set((Array.isArray(item.aliases) ? item.aliases : []).map(text).filter(Boolean))],
      enabled: item.enabled !== false,
      updatedAt: text(item.updatedAt),
    })).filter(item => item.id && item.name);
    const byIdentity = value => {
      const key = sourceKey(value);
      return definitions.find(item => sourceKey(item.name) === key || item.aliases.some(alias => sourceKey(alias) === key));
    };
    for (const name of [...new Set([...sources, ...groupFanSources].map(text).filter(Boolean))]) {
      const current = byIdentity(name);
      if (current) { current.enabled = true; current.type = sourceType(name, groupFanSources); continue; }
      definitions.push({ id: stableSourceId(name), name, type: sourceType(name, groupFanSources), aliases: [], enabled: true, updatedAt: '' });
    }
    if (aliases && typeof aliases === 'object' && !Array.isArray(aliases)) {
      for (const [alias, target] of Object.entries(aliases)) {
        const current = byIdentity(target);
        const normalizedAlias = text(alias);
        if (current && normalizedAlias && sourceKey(normalizedAlias) !== sourceKey(current.name) && !current.aliases.some(value => sourceKey(value) === sourceKey(normalizedAlias))) current.aliases.push(normalizedAlias);
      }
    }
    return definitions.sort((a, b) => Number(b.enabled) - Number(a.enabled) || a.name.localeCompare(b.name, 'zh-CN'));
  }

  function renameSourceDefinition(existing, oldName, newName, groupFanSources = []) {
    // Do not seed the new display name before locating the old definition.
    // Doing so creates a second ID and resolveSourceDefinition may select it,
    // breaking the stable channel identity during a rename.
    const definitions = reconcileSourceDefinitions(existing, [], [], {});
    const oldKey = sourceKey(oldName), next = text(newName);
    const current = definitions.find(item => sourceKey(item.name) === oldKey || item.aliases.some(alias => sourceKey(alias) === oldKey));
    if (!current || !next) return definitions;
    if (sourceKey(current.name) !== sourceKey(next)) current.aliases = [...new Set([...current.aliases, current.name, text(oldName)].filter(Boolean))];
    current.name = next;
    current.type = sourceType(next, groupFanSources);
    current.enabled = true;
    current.updatedAt = new Date().toISOString();
    return definitions;
  }

  function disableSourceDefinition(existing, name, replacement = '') {
    const definitions = reconcileSourceDefinitions(existing, [], [], {});
    const current = resolveSourceDefinition(name, definitions);
    if (current) { current.enabled = false; current.replacedBy = resolveSourceDefinition(replacement, definitions)?.id || stableSourceId(replacement); current.updatedAt = new Date().toISOString(); }
    return definitions;
  }

  function resolveSourceDefinition(value, definitions = [], aliases = {}) {
    const raw = text(value), key = sourceKey(raw);
    if (!key) return null;
    const aliasTarget = aliases && typeof aliases === 'object' && !Array.isArray(aliases) ? text(aliases[raw]) : '';
    const targetKey = sourceKey(aliasTarget || raw);
    return (Array.isArray(definitions) ? definitions : []).find(item => sourceKey(item?.name) === targetKey || (Array.isArray(item?.aliases) && item.aliases.some(alias => sourceKey(alias) === key))) || null;
  }

  function stampSourceReferences(workspace = {}, definitions = [], aliases = {}) {
    let changed = 0;
    const stamp = (record, field, idField) => {
      if (!record || typeof record !== 'object') return;
      const definition = resolveSourceDefinition(record[field], definitions, aliases);
      const id = definition?.id || stableSourceId(record[field]);
      if (id && text(record[idField]) !== id) { record[idField] = id; changed++; }
    };
    for (const customer of Array.isArray(workspace.customers) ? workspace.customers : []) {
      stamp(customer, 'source', 'sourceId'); stamp(customer, 'channel', 'channelId');
      for (const event of Array.isArray(customer?.statusHistory) ? customer.statusHistory : []) stamp(event, 'source', 'sourceId');
    }
    for (const record of Array.isArray(workspace.tickets) ? workspace.tickets : []) stamp(record, 'channel', 'channelId');
    for (const record of Array.isArray(workspace.deposits) ? workspace.deposits : []) stamp(record, 'channel', 'channelId');
    for (const record of Array.isArray(workspace.registrations) ? workspace.registrations : []) stamp(record, 'source', 'sourceId');
    return changed;
  }

  function buildGroupMembershipLedger(customers = [], existing = [], definitions = [], aliases = {}) {
    const byId = new Map();
    // statusHistory is the source of truth.  Replaying the previously derived
    // ledger here retained events after a status-history rollback/removal and
    // produced phantom join/leave counts.  Keep the argument for API
    // compatibility, but always rebuild the projection from customer history.
    void existing;
    for (const customer of Array.isArray(customers) ? customers : []) {
      if (!customer || typeof customer !== 'object') continue;
      for (const event of Array.isArray(customer.statusHistory) ? customer.statusHistory : []) {
        const kind = text(event.type) || statusEventKind(event.to);
        if (!['joined', 'left'].includes(kind)) continue;
        const source = text(event.source || customer.channel || customer.source || '未分类');
        const definition = resolveSourceDefinition(source, definitions, aliases);
        const id = text(event.id) ? `membership-${text(event.id)}` : `membership-${stableHash([customer.id, event.at || event.date, kind, source, customer.group].join('|'))}`;
        byId.set(id, {
          id,
          customerId: text(customer.id),
          sourceId: definition?.id || text(event.sourceId) || stableSourceId(source),
          source,
          subgroup: text(event.group || customer.group || '—'),
          type: kind,
          date: text(event.date),
          at: text(event.at),
          initial: Boolean(event.initial),
          origin: 'customer-status-history',
        });
      }
    }
    return [...byId.values()].sort((a, b) => String(a.at || a.date).localeCompare(String(b.at || b.date)) || a.id.localeCompare(b.id));
  }

  function restoreImportStaging({ state, customerSnapshots, settingsBefore, sources, sourcesBefore, groupFanSources, groupFanSourcesBefore } = {}) {
    if (!state || typeof state !== 'object') return false;
    const snapshots = customerSnapshots instanceof Map ? customerSnapshots : new Map(Array.isArray(customerSnapshots) ? customerSnapshots : []);
    for (const [id, snapshot] of snapshots) {
      const current = Array.isArray(state.customers) ? state.customers.find(customer => text(customer?.id) === text(id)) : null;
      if (!current || !snapshot || typeof snapshot !== 'object') continue;
      for (const key of Object.keys(current)) delete current[key];
      Object.assign(current, typeof structuredClone === 'function' ? structuredClone(snapshot) : JSON.parse(JSON.stringify(snapshot)));
    }
    if (settingsBefore && typeof settingsBefore === 'object') state.settings = typeof structuredClone === 'function' ? structuredClone(settingsBefore) : JSON.parse(JSON.stringify(settingsBefore));
    if (Array.isArray(sources) && Array.isArray(sourcesBefore)) sources.splice(0, sources.length, ...sourcesBefore);
    if (Array.isArray(groupFanSources) && Array.isArray(groupFanSourcesBefore)) groupFanSources.splice(0, groupFanSources.length, ...groupFanSourcesBefore);
    return true;
  }

  function activeAiTask(task) { return Boolean(task?.aiGenerated) && task?.done !== true && !['done', 'dismissed', 'cancelled'].includes(text(task?.status).toLowerCase()); }
  function dedupeActiveFollowupTasks(tasks = []) {
    const seen = new Map(), dismissed = [];
    for (const task of (Array.isArray(tasks) ? tasks : []).filter(activeAiTask).sort((a, b) => String(b.updatedAt || b.createdAt || '').localeCompare(String(a.updatedAt || a.createdAt || '')))) {
      const key = text(task.customerId);
      if (!key || !seen.has(key)) { if (key) seen.set(key, task); continue; }
      task.status = 'dismissed'; task.dismissed = true; task.dismissedReason = 'superseded-by-newer-ai-reminder'; task.updatedAt = new Date().toISOString(); dismissed.push(task);
    }
    return { kept: [...seen.values()], dismissed };
  }

  return { BUSINESS_RULES, DATA_DICTIONARY, stableSourceId, sourceKey, sourceType, reconcileSourceDefinitions, renameSourceDefinition, disableSourceDefinition, resolveSourceDefinition, stampSourceReferences, buildGroupMembershipLedger, restoreImportStaging, dedupeActiveFollowupTasks, activeAiTask };
});
