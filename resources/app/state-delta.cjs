'use strict';
function applyDelta(current, delta) {
  if (!current || !delta || !Array.isArray(delta.upsert) || !Array.isArray(delta.remove) || !delta.fields || typeof delta.fields !== 'object' || Array.isArray(delta.fields)) throw new Error('增量保存格式无效');
  const allowed = new Set(['schemaVersion','savedViews','activities','tickets','deposits','followups','registrations','phoneRegistry','batchOperations','settings','channelAliases','importIssues','qualityDecisions']);
  for (const key of Object.keys(delta.fields)) if (!allowed.has(key)) throw new Error('不支持的增量字段');
  const rows = new Map((current.customers || []).map(row => [String(row.id), row]));
  const seen = new Set();
  for (const row of delta.upsert) {
    if (!row || typeof row !== 'object' || Array.isArray(row) || typeof row.id !== 'string' || seen.has(row.id)) throw new Error('增量客户编号无效');
    seen.add(row.id); rows.set(row.id, row);
  }
  for (const id of delta.remove) {
    if (typeof id !== 'string' || seen.has(id)) throw new Error('增量删除编号无效');
    rows.delete(id);
  }
  return {...current,...delta.fields,customers:[...rows.values()]};
}
module.exports = {applyDelta};
