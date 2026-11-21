(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ZhikeFieldLocks = Object.freeze(api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  // V5.0 §16/§19: a field the user locks is never changed by AI, import or an
  // automatic fill. Every merge already honours customer.manualLockedFields;
  // this module is the user-facing way to set them.
  const text = value => String(value == null ? '' : value).trim();
  // Only business profile fields can be locked. Identity and relationship
  // evidence (id, ws ids, memberships, group status) are not user-lockable:
  // locking them would hide real evidence instead of protecting a decision.
  const LOCKABLE_FIELDS = Object.freeze([
    { key: 'name', label: '姓名' },
    { key: 'phone', label: '手机号' },
    { key: 'country', label: '地区' },
    { key: 'language', label: '语言' },
    { key: 'occupation', label: '职业' },
    { key: 'investment_years', label: '投资经验' },
    { key: 'investment_preferences', label: '投资偏好' },
    { key: 'holdings', label: '明确持仓' },
    { key: 'tags', label: '客户标签' },
    { key: 'channel', label: '渠道' },
    { key: 'assistant', label: '负责助理' },
    { key: 'phase', label: '客户阶段' },
    { key: 'qualification', label: '资质评级' },
    { key: 'note', label: '备注' },
  ]);
  const KEYS = new Set(LOCKABLE_FIELDS.map(item => item.key));
  const normalizeLockedFields = customer => {
    const raw = customer && Array.isArray(customer.manualLockedFields) ? customer.manualLockedFields : [];
    return [...new Set(raw.map(item => text(item)).filter(item => KEYS.has(item)))];
  };
  const isLocked = (customer, field) => normalizeLockedFields(customer).includes(text(field));

  /** Toggle one known field. Unknown fields are ignored, never stored. */
  function toggleLock(customer, field) {
    const key = text(field);
    if (!customer || typeof customer !== 'object') return { changed: false, locked: false, fields: [] };
    if (!KEYS.has(key)) return { changed: false, locked: false, fields: normalizeLockedFields(customer) };
    const current = normalizeLockedFields(customer);
    const locked = !current.includes(key);
    const fields = locked ? [...current, key] : current.filter(item => item !== key);
    customer.manualLockedFields = fields;
    return { changed: true, locked, fields };
  }

  function lockSummary(customer) {
    const fields = normalizeLockedFields(customer);
    return {
      fields,
      count: fields.length,
      labels: fields.map(key => (LOCKABLE_FIELDS.find(item => item.key === key) || { label: key }).label),
    };
  }

  return { LOCKABLE_FIELDS, normalizeLockedFields, isLocked, toggleLock, lockSummary };
});
